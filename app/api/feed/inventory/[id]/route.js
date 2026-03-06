// app/api/feed/inventory/[id]/route.js — Single feed inventory: GET + PATCH
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'STORE_MANAGER'];

const patchSchema = z.object({
  feedType:       z.string().min(2).max(100).optional(),
  reorderLevelKg: z.number().min(0).optional(),
  maxStockKg:     z.number().min(0).nullable().optional(),
  costPerKg:      z.number().min(0).optional(),
  supplierId:     z.string().uuid().nullable().optional(),
  batchNumber:    z.string().nullable().optional(),
  expiryDate:     z.string().nullable().optional(),
  // Manual stock adjustment (e.g. physical count correction)
  adjustStockKg:  z.number().optional(),   // signed delta, e.g. +50 or -10
  adjustReason:   z.string().optional(),
});

// ─── GET /api/feed/inventory/[id] ────────────────────────────────────────────
export async function GET(request, { params }) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const item = await prisma.feedInventory.findFirst({
      where: {
        id:    params.id,
        store: { farm: { tenantId: user.tenantId } },
      },
      include: {
        store:    true,
        formula:  { include: { ingredients: true } },
        supplier: true,
        consumption: {
          orderBy: { recordedDate: 'desc' },
          take: 30,
          include: {
            flock:      { select: { id: true, batchCode: true, operationType: true } },
            penSection: { select: { id: true, name: true } },
            recordedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        storeReceipts: {
          orderBy: { receiptDate: 'desc' },
          take: 10,
          include: {
            receivedBy: { select: { id: true, firstName: true, lastName: true } },
            supplier:   { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!item)
      return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

    // 30-day consumption total
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthlyConsumption = await prisma.feedConsumption.aggregate({
      where: { feedInventoryId: item.id, recordedDate: { gte: thirtyDaysAgo } },
      _sum: { quantityKg: true },
      _avg: { quantityKg: true },
    });

    return NextResponse.json({
      feedInventory: item,
      stats: {
        monthlyUsageKg: Number(monthlyConsumption._sum.quantityKg || 0).toFixed(2),
        avgDailyUsageKg: Number(monthlyConsumption._avg.quantityKg || 0).toFixed(2),
        stockValueNGN: (Number(item.currentStockKg) * Number(item.costPerKg)).toFixed(2),
      },
    });
  } catch (error) {
    console.error('Feed inventory fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch feed inventory item' }, { status: 500 });
  }
}

// ─── PATCH /api/feed/inventory/[id] ──────────────────────────────────────────
// Update feed inventory metadata or apply a manual stock adjustment.
export async function PATCH(request, { params }) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    // Verify ownership
    const existing = await prisma.feedInventory.findFirst({
      where: { id: params.id, store: { farm: { tenantId: user.tenantId } } },
    });
    if (!existing)
      return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

    const { adjustStockKg, adjustReason, ...updateFields } = data;

    // Build update payload
    const updateData = {
      ...updateFields,
      ...(updateFields.expiryDate !== undefined && {
        expiryDate: updateFields.expiryDate ? new Date(updateFields.expiryDate) : null,
      }),
      // Apply stock adjustment if provided
      ...(adjustStockKg !== undefined && {
        currentStockKg: Math.max(0, Number(existing.currentStockKg) + adjustStockKg),
      }),
    };

    const updated = await prisma.feedInventory.update({
      where: { id: params.id },
      data: updateData,
      include: {
        store:    { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'FeedInventory',
        entityId:   updated.id,
        changes: {
          before: { currentStockKg: existing.currentStockKg },
          after:  { currentStockKg: updated.currentStockKg },
          ...(adjustStockKg !== undefined && { adjustReason }),
        },
      },
    }).catch(() => {});

    return NextResponse.json({ feedInventory: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed inventory update error:', error);
    return NextResponse.json({ error: 'Failed to update feed inventory' }, { status: 500 });
  }
}
