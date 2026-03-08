// app/api/feed/receipts/[id]/route.js — Single feed receipt: GET + PATCH (QC update)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const patchSchema = z.object({
  qualityStatus: z.enum(['PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED', 'WAIVED']).optional(),
  qualityNotes:  z.string().nullable().optional(),
  notes:         z.string().nullable().optional(),
  // If QC FAILED, optionally adjust the accepted quantity
  acceptedQtyKg: z.number().min(0).optional(),
});

// ─── GET /api/feed/receipts/[id] ─────────────────────────────────────────────
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const receipt = await prisma.storeReceipt.findFirst({
      where: {
        id:    params.id,
        store: { farm: { tenantId: user.tenantId } },
        feedInventoryId: { not: null },
      },
      include: {
        store:         true,
        feedInventory: { select: { id: true, feedType: true, currentStockKg: true, costPerKg: true } },
        supplier:      true,
        receivedBy:    { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    if (!receipt)
      return NextResponse.json({ error: 'Feed receipt not found' }, { status: 404 });

    return NextResponse.json({ receipt });
  } catch (error) {
    console.error('Feed receipt get error:', error);
    return NextResponse.json({ error: 'Failed to fetch feed receipt' }, { status: 500 });
  }
}

// ─── PATCH /api/feed/receipts/[id] ───────────────────────────────────────────
// Update QC status. If FAILED with partial acceptance, adjusts stock accordingly.
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    const existing = await prisma.storeReceipt.findFirst({
      where: {
        id:    params.id,
        store: { farm: { tenantId: user.tenantId } },
        feedInventoryId: { not: null },
      },
    });
    if (!existing)
      return NextResponse.json({ error: 'Feed receipt not found' }, { status: 404 });

    // If QC failed with partial acceptance, reverse excess stock
    let stockAdjustment = 0;
    if (
      data.qualityStatus === 'FAILED' &&
      data.acceptedQtyKg !== undefined &&
      data.acceptedQtyKg < Number(existing.quantityReceived)
    ) {
      stockAdjustment = data.acceptedQtyKg - Number(existing.quantityReceived); // negative
    }

    const updateOps = [
      prisma.storeReceipt.update({
        where: { id: params.id },
        data: {
          ...(data.qualityStatus !== undefined && { qualityStatus: data.qualityStatus }),
          ...(data.qualityNotes  !== undefined && { qualityNotes: data.qualityNotes }),
          ...(data.notes         !== undefined && { notes: data.notes }),
          // Record who verified
          ...(data.qualityStatus === 'PASSED' || data.qualityStatus === 'FAILED'
            ? { verifiedById: user.sub, verifiedAt: new Date() }
            : {}
          ),
        },
        include: {
          feedInventory: { select: { id: true, feedType: true } },
          receivedBy:    { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ];

    if (stockAdjustment !== 0) {
      updateOps.push(
        prisma.feedInventory.update({
          where: { id: existing.feedInventoryId },
          data:  { currentStockKg: { increment: stockAdjustment } },
        })
      );
    }

    const [updated] = await prisma.$transaction(updateOps);

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'StoreReceipt',
        entityId:   params.id,
        changes: {
          qualityStatus:  data.qualityStatus,
          stockAdjustment,
          acceptedQtyKg:  data.acceptedQtyKg,
        },
      },
    }).catch(() => {});

    return NextResponse.json({ receipt: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed receipt update error:', error);
    return NextResponse.json({ error: 'Failed to update feed receipt' }, { status: 500 });
  }
}