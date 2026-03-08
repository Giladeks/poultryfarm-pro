// app/api/feed/consumption/[id]/route.js — Single consumption: GET + PATCH + DELETE
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'STORE_MANAGER'];

const patchSchema = z.object({
  quantityKg:   z.number().positive().optional(),
  recordedDate: z.string().optional(),
  notes:        z.string().nullable().optional(),
});

// ─── GET /api/feed/consumption/[id] ──────────────────────────────────────────
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const record = await prisma.feedConsumption.findFirst({
      where: {
        id:    params.id,
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: {
        flock:         { select: { id: true, batchCode: true, operationType: true, currentCount: true } },
        penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
        feedInventory: { select: { id: true, feedType: true, costPerKg: true, currency: true } },
        recordedBy:    { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    if (!record)
      return NextResponse.json({ error: 'Consumption record not found' }, { status: 404 });

    return NextResponse.json({ consumption: record });
  } catch (error) {
    console.error('Feed consumption get error:', error);
    return NextResponse.json({ error: 'Failed to fetch consumption record' }, { status: 500 });
  }
}

// ─── PATCH /api/feed/consumption/[id] ────────────────────────────────────────
// Update a consumption record. Managers only. Re-adjusts inventory stock delta.
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    const existing = await prisma.feedConsumption.findFirst({
      where: {
        id:    params.id,
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: {
        flock:         { select: { currentCount: true } },
        feedInventory: true,
      },
    });
    if (!existing)
      return NextResponse.json({ error: 'Consumption record not found' }, { status: 404 });

    // If quantityKg is changing, reconcile inventory
    const oldQty = Number(existing.quantityKg);
    const newQty = data.quantityKg ?? oldQty;
    const delta  = newQty - oldQty; // positive = used more, negative = used less

    // Prevent inventory going negative
    if (delta > 0) {
      const currentStock = Number(existing.feedInventory.currentStockKg);
      if (currentStock < delta) {
        return NextResponse.json({
          error: 'Insufficient feed stock for this adjustment',
          available: currentStock,
          additionalRequired: delta,
        }, { status: 422 });
      }
    }

    const gramsPerBird = (data.quantityKg && existing.flock.currentCount > 0)
      ? parseFloat(((newQty * 1000) / existing.flock.currentCount).toFixed(2))
      : existing.gramsPerBird;

    const [updated] = await prisma.$transaction([
      prisma.feedConsumption.update({
        where: { id: params.id },
        data: {
          ...(data.quantityKg   !== undefined && { quantityKg: data.quantityKg, gramsPerBird }),
          ...(data.recordedDate !== undefined && { recordedDate: new Date(data.recordedDate) }),
          ...(data.notes        !== undefined && { notes: data.notes }),
        },
        include: {
          flock:         { select: { id: true, batchCode: true } },
          feedInventory: { select: { id: true, feedType: true } },
        },
      }),
      // Reconcile inventory stock: reverse old qty, apply new qty
      ...(delta !== 0 ? [
        prisma.feedInventory.update({
          where: { id: existing.feedInventoryId },
          data: { currentStockKg: { decrement: delta } },
        }),
      ] : []),
    ]);

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'FeedConsumption',
        entityId:   params.id,
        changes:    { before: { quantityKg: oldQty }, after: { quantityKg: newQty }, delta },
      },
    }).catch(() => {});

    return NextResponse.json({ consumption: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed consumption update error:', error);
    return NextResponse.json({ error: 'Failed to update consumption record' }, { status: 500 });
  }
}

// ─── DELETE /api/feed/consumption/[id] ───────────────────────────────────────
// Soft-delete by reversing the stock deduction. Managers only.
export async function DELETE(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const existing = await prisma.feedConsumption.findFirst({
      where: {
        id:    params.id,
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
    });
    if (!existing)
      return NextResponse.json({ error: 'Consumption record not found' }, { status: 404 });

    // Reverse stock deduction before deleting
    await prisma.$transaction([
      prisma.feedInventory.update({
        where: { id: existing.feedInventoryId },
        data:  { currentStockKg: { increment: Number(existing.quantityKg) } },
      }),
      prisma.feedConsumption.delete({ where: { id: params.id } }),
    ]);

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'DELETE',
        entityType: 'FeedConsumption',
        entityId:   params.id,
        changes:    { quantityKg: existing.quantityKg, stockRestored: true },
      },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Feed consumption delete error:', error);
    return NextResponse.json({ error: 'Failed to delete consumption record' }, { status: 500 });
  }
}