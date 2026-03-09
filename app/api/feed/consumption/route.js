// app/api/feed/consumption/route.js — Feed consumption log: list + create
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'PRODUCTION_STAFF',
  'STORE_MANAGER', 'STORE_CLERK',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const createSchema = z.object({
  feedInventoryId: z.string().min(1),
  flockId:         z.string().min(1).nullable().optional(),
  penSectionId:    z.string().min(1).nullable().optional(),
  quantityKg:      z.number().positive(),
  consumptionDate: z.string().optional(),
  notes:           z.string().nullable().optional(),
});

// ─── GET /api/feed/consumption ────────────────────────────────────────────────
// Returns recent consumption records for this tenant.
// Query params: flockId, penSectionId, feedInventoryId, from, to, limit
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId         = searchParams.get('flockId');
  const penSectionId    = searchParams.get('penSectionId');
  const feedInventoryId = searchParams.get('feedInventoryId');
  const from            = searchParams.get('from');
  const to              = searchParams.get('to');
  const limit           = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  try {
    const where = {
      flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      ...(flockId         && { flockId }),
      ...(penSectionId    && { penSectionId }),
      ...(feedInventoryId && { feedInventoryId }),
      ...((from || to)    && {
        recordedDate: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to)   }),
        },
      }),
    };

    const consumption = await prisma.feedConsumption.findMany({
      where,
      include: {
        flock:         { select: { id: true, batchCode: true, birdType: true, operationType: true, currentCount: true } },
        penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
        feedInventory: { select: { id: true, feedType: true, costPerKg: true, currency: true } },
        recordedBy:    { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { recordedDate: 'desc' },
      take: limit,
    });

    // Aggregate summary for the filtered set
    const agg = await prisma.feedConsumption.aggregate({
      where,
      _sum:   { quantityKg: true },
      _count: true,
    });

    return NextResponse.json({
      consumption,
      summary: {
        totalRecords: agg._count,
        totalKg:      parseFloat(Number(agg._sum.quantityKg || 0).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('Feed consumption fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch consumption records' }, { status: 500 });
  }
}

// ─── POST /api/feed/consumption ───────────────────────────────────────────────
// Records feed usage. Deducts from FeedInventory stock.
// Calculates gramsPerBird from flock's currentCount.
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    // Verify feed inventory item belongs to this tenant
    const feedItem = await prisma.feedInventory.findFirst({
      where: {
        id:    data.feedInventoryId,
        store: { farm: { tenantId: user.tenantId } },
      },
    });
    if (!feedItem)
      return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

    // Check sufficient stock
    const currentStock = Number(feedItem.currentStockKg);
    if (currentStock < data.quantityKg) {
      return NextResponse.json({
        error:     'Insufficient feed stock',
        available: currentStock,
        requested: data.quantityKg,
      }, { status: 422 });
    }

    // Resolve flock for gramsPerBird calculation
    let flock = null;
    let penSectionId = data.penSectionId ?? null;

    if (data.flockId) {
      flock = await prisma.flock.findFirst({
        where: {
          id:         data.flockId,
          penSection: { pen: { farm: { tenantId: user.tenantId } } },
        },
        select: { id: true, currentCount: true, penSectionId: true },
      });
      if (!flock)
        return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
      penSectionId = penSectionId ?? flock.penSectionId;
    }

    const gramsPerBird = (flock && flock.currentCount > 0)
      ? parseFloat(((data.quantityKg * 1000) / flock.currentCount).toFixed(2))
      : null;

    const recordedDate = data.consumptionDate
      ? new Date(data.consumptionDate)
      : new Date();

    const [record] = await prisma.$transaction([
      prisma.feedConsumption.create({
        data: {
          feedInventoryId: data.feedInventoryId,
          flockId:         data.flockId ?? null,
          penSectionId:    penSectionId,
          quantityKg:      data.quantityKg,
          gramsPerBird,
          recordedDate,
          recordedById:    user.sub,
          notes:           data.notes ?? null,
        },
        include: {
          flock:         { select: { id: true, batchCode: true, birdType: true } },
          penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
          feedInventory: { select: { id: true, feedType: true } },
          recordedBy:    { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.feedInventory.update({
        where: { id: data.feedInventoryId },
        data:  { currentStockKg: { decrement: data.quantityKg } },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'FeedConsumption',
        entityId:   record.id,
        changes: {
          feedType:    feedItem.feedType,
          quantityKg:  data.quantityKg,
          gramsPerBird,
          stockAfter:  parseFloat((currentStock - data.quantityKg).toFixed(2)),
        },
      },
    }).catch(() => {});

    return NextResponse.json({ consumption: record }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed consumption create error:', error);
    return NextResponse.json({ error: 'Failed to record consumption' }, { status: 500 });
  }
}
