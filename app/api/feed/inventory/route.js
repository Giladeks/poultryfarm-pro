// app/api/feed/inventory/route.js — Feed inventory list + create
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'STORE_MANAGER'];

const createFeedInventorySchema = z.object({
  storeId:         z.string().uuid(),
  feedType:        z.string().min(2).max(100),
  formulaId:       z.string().uuid().optional().nullable(),
  supplierId:      z.string().uuid().optional().nullable(),
  currentStockKg:  z.number().min(0),
  reorderLevelKg:  z.number().min(0),
  maxStockKg:      z.number().min(0).optional().nullable(),
  costPerKg:       z.number().min(0),
  currency:        z.enum(['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR']).default('NGN'),
  batchNumber:     z.string().optional().nullable(),
  expiryDate:      z.string().optional().nullable(),
});

const updateFeedInventorySchema = z.object({
  feedType:       z.string().min(2).max(100).optional(),
  reorderLevelKg: z.number().min(0).optional(),
  maxStockKg:     z.number().min(0).optional().nullable(),
  costPerKg:      z.number().min(0).optional(),
  supplierId:     z.string().uuid().optional().nullable(),
  batchNumber:    z.string().optional().nullable(),
  expiryDate:     z.string().optional().nullable(),
});

// ─── GET /api/feed/inventory ──────────────────────────────────────────────────
// Returns all feed inventory for the tenant with stock status flags.
// Query params: storeId, lowStockOnly=true
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const storeId       = searchParams.get('storeId');
  const lowStockOnly  = searchParams.get('lowStockOnly') === 'true';

  try {
    // Resolve stores belonging to this tenant
    const tenantStores = await prisma.store.findMany({
      where: { farm: { tenantId: user.tenantId } },
      select: { id: true },
    });
    const storeIds = tenantStores.map(s => s.id);

    const where = {
      storeId: { in: storeIds },
      ...(storeId && { storeId }),
      // Low stock filter: currentStockKg <= reorderLevelKg
      ...(lowStockOnly && {
        currentStockKg: { lte: prisma.feedInventory.fields.reorderLevelKg },
      }),
    };

    const inventory = await prisma.feedInventory.findMany({
      where: { storeId: { in: storeIds }, ...(storeId && { storeId }) },
      include: {
        store:    { select: { id: true, name: true, storeType: true } },
        formula:  { select: { id: true, name: true, birdType: true } },
        supplier: { select: { id: true, name: true, phone: true, email: true } },
        _count:   { select: { consumption: true } },
      },
      orderBy: { feedType: 'asc' },
    });

    // Enrich with stock status + 7-day consumption rate
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const enriched = await Promise.all(inventory.map(async (item) => {
      // Stock status
      let stockStatus = 'OK';
      if (item.currentStockKg <= 0) {
        stockStatus = 'OUT_OF_STOCK';
      } else if (Number(item.currentStockKg) <= Number(item.reorderLevelKg)) {
        stockStatus = 'LOW';
      } else if (item.maxStockKg && Number(item.currentStockKg) >= Number(item.maxStockKg) * 0.9) {
        stockStatus = 'NEAR_CAPACITY';
      }

      // 7-day consumption
      const recentConsumption = await prisma.feedConsumption.aggregate({
        where: {
          feedInventoryId: item.id,
          recordedDate: { gte: sevenDaysAgo },
        },
        _sum: { quantityKg: true },
      });

      const weeklyUsageKg = Number(recentConsumption._sum.quantityKg || 0);
      const dailyUsageKg  = weeklyUsageKg / 7;

      // Days of stock remaining
      const daysRemaining = dailyUsageKg > 0
        ? Math.floor(Number(item.currentStockKg) / dailyUsageKg)
        : null;

      // Stock value
      const stockValueNGN = Number(item.currentStockKg) * Number(item.costPerKg);

      return {
        ...item,
        stockStatus,
        weeklyUsageKg: parseFloat(weeklyUsageKg.toFixed(2)),
        dailyUsageKg:  parseFloat(dailyUsageKg.toFixed(2)),
        daysRemaining,
        stockValueNGN: parseFloat(stockValueNGN.toFixed(2)),
        isExpired: item.expiryDate ? new Date(item.expiryDate) < new Date() : false,
        isExpiringSoon: item.expiryDate
          ? new Date(item.expiryDate) < new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          : false,
      };
    }));

    // Apply low-stock filter post-enrichment (avoids raw SQL comparison of same-row columns)
    const filtered = lowStockOnly
      ? enriched.filter(i => i.stockStatus === 'LOW' || i.stockStatus === 'OUT_OF_STOCK')
      : enriched;

    // Summary stats
    const summary = {
      totalItems:     filtered.length,
      lowStockItems:  filtered.filter(i => i.stockStatus === 'LOW').length,
      outOfStock:     filtered.filter(i => i.stockStatus === 'OUT_OF_STOCK').length,
      totalValueNGN:  parseFloat(filtered.reduce((sum, i) => sum + i.stockValueNGN, 0).toFixed(2)),
    };

    return NextResponse.json({ inventory: filtered, summary });
  } catch (error) {
    console.error('Feed inventory fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch feed inventory' }, { status: 500 });
  }
}

// ─── POST /api/feed/inventory ─────────────────────────────────────────────────
// Creates a new feed inventory record. Manager+ only.
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createFeedInventorySchema.parse(body);

    // Verify store belongs to this tenant
    const store = await prisma.store.findFirst({
      where: { id: data.storeId, farm: { tenantId: user.tenantId } },
    });
    if (!store)
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });

    if (store.storeType !== 'FEED' && store.storeType !== 'GENERAL')
      return NextResponse.json({ error: 'Store is not a feed store' }, { status: 422 });

    // Verify formula belongs to tenant (if provided)
    if (data.formulaId) {
      const formula = await prisma.feedFormula.findFirst({
        where: { id: data.formulaId, tenantId: user.tenantId },
      });
      if (!formula)
        return NextResponse.json({ error: 'Feed formula not found' }, { status: 404 });
    }

    const feedInventory = await prisma.feedInventory.create({
      data: {
        ...data,
        tenantId:   user.tenantId,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      },
      include: {
        store:    { select: { id: true, name: true } },
        formula:  { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'FeedInventory',
        entityId:   feedInventory.id,
        changes:    { feedType: feedInventory.feedType, currentStockKg: feedInventory.currentStockKg },
      },
    }).catch(() => {});

    return NextResponse.json({ feedInventory }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed inventory create error:', error);
    return NextResponse.json({ error: 'Failed to create feed inventory' }, { status: 500 });
  }
}
