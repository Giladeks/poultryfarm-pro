// app/api/flocks/[id]/cull/route.js
// Phase 8-Supplement · Flock Lifecycle — Partial Cull
//
// POST /api/flocks/[id]/cull
//   dispositions:
//     CULLED              → mortality record only, flock stays ACTIVE
//     DIED                → same as CULLED but causeCode UNKNOWN
//     TRANSFERRED_TO_STORE → mortality record + auto StoreReceipt for live birds
//
// Roles: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

const cullSchema = z.object({
  cullCount:             z.number().int().positive(),
  reason:                z.string().min(3).max(500),
  disposition:           z.enum(['CULLED','DIED','TRANSFERRED_TO_STORE']).default('CULLED'),
  cullDate:              z.string().optional(),
  notes:                 z.string().max(1000).optional(),
  // Required when disposition === TRANSFERRED_TO_STORE
  storeId:               z.string().min(1).optional(),
  estimatedValuePerBird: z.number().min(0).optional(),
  currency:              z.string().default('NGN'),
});

export async function POST(request, { params: rawParams }) {
  const params  = await rawParams;                     // Next.js 16 async params
  const user    = await verifyToken(request);
  if (!user)                              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },   { status: 403 });

  const { id: flockId } = params;

  try {
    const body = await request.json();
    const data = cullSchema.parse(body);

    if (data.disposition === 'TRANSFERRED_TO_STORE' && !data.storeId)
      return NextResponse.json({ error: 'storeId is required when transferring to store' }, { status: 422 });

    // ── Validate flock ────────────────────────────────────────────────────────
    const flock = await prisma.flock.findFirst({
      where:  { id: flockId, tenantId: user.tenantId },
      select: { id: true, batchCode: true, currentCount: true, status: true, penSectionId: true },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
    if (flock.status !== 'ACTIVE')
      return NextResponse.json({ error: `Cannot cull a ${flock.status} flock` }, { status: 422 });
    if (data.cullCount > flock.currentCount)
      return NextResponse.json({ error: `cullCount (${data.cullCount}) exceeds currentCount (${flock.currentCount})` }, { status: 422 });

    // ── Validate store when needed ────────────────────────────────────────────
    if (data.storeId) {
      const store = await prisma.store.findFirst({
        where: { id: data.storeId, farm: { tenantId: user.tenantId } },
        select: { id: true },
      });
      if (!store)
        return NextResponse.json({ error: 'Store not found or not accessible' }, { status: 404 });
    }

    const recordDate = data.cullDate ? new Date(data.cullDate) : new Date();
    const causeCode  = data.disposition === 'DIED' ? 'UNKNOWN' : 'CULLED';

    const mortalityNote = [
      `Disposition: ${data.disposition}`,
      `Reason: ${data.reason}`,
      data.notes || null,
    ].filter(Boolean).join(' | ');

    // ── Build transaction ops ─────────────────────────────────────────────────
    const txOps = [
      // 1. Decrement flock count
      prisma.flock.update({
        where: { id: flockId },
        data:  { currentCount: { decrement: data.cullCount } },
        select: { id: true, batchCode: true, currentCount: true, status: true },
      }),

      // 2. Mortality record (auto-approved for FM+)
      prisma.mortalityRecord.create({
        data: {
          flockId,
          penSectionId:     flock.penSectionId,
          recordedById:     user.sub,
          recordDate,
          count:            data.cullCount,
          causeCode,
          submissionStatus: 'APPROVED',
          notes:            mortalityNote,
        },
        select: { id: true, count: true, recordDate: true, causeCode: true },
      }),
    ];

    // 3. If transferring to store — resolve/create InventoryItem + StoreReceipt
    let storeReceipt = null;
    if (data.disposition === 'TRANSFERRED_TO_STORE') {
      const unitCost  = data.estimatedValuePerBird ?? 0;
      const totalCost = unitCost * data.cullCount;
      const itemName  = `Live Birds — ${flock.batchCode}`;

      // Upsert InventoryItem for this flock's live birds in the target store
      let liveBirdsItem = await prisma.inventoryItem.findFirst({
        where: { storeId: data.storeId, tenantId: user.tenantId, name: itemName, category: 'LIVE_BIRDS' },
        select: { id: true },
      });
      if (!liveBirdsItem) {
        liveBirdsItem = await prisma.inventoryItem.create({
          data: {
            storeId:      data.storeId,
            tenantId:     user.tenantId,
            name:         itemName,
            category:     'LIVE_BIRDS',
            unit:         'birds',
            currentStock: 0,
            reorderLevel: 0,
            costPerUnit:  unitCost,
            currency:     data.currency,
            isActive:     true,
          },
          select: { id: true },
        });
      }

      storeReceipt = await prisma.storeReceipt.create({
        data: {
          storeId:          data.storeId,
          receivedById:     user.sub,
          receiptDate:      recordDate,
          inventoryItemId:  liveBirdsItem.id,
          flockId,
          fromSectionId:    flock.penSectionId,
          quantityReceived: data.cullCount,
          unitCost,
          currency:         data.currency,
          totalCost,
          referenceNumber:  `CULL-${flock.batchCode}-${recordDate.toISOString().slice(0,10)}`,
          notes:            mortalityNote,
          qualityStatus:    'PENDING',
        },
        select: { id: true, quantityReceived: true, storeId: true },
      });
    }

    const [updatedFlock, mortalityRecord] = await prisma.$transaction(txOps);

    return NextResponse.json({
      message:        `Culled ${data.cullCount} birds from ${updatedFlock.batchCode}`,
      flock:          updatedFlock,
      mortalityRecord,
      ...(storeReceipt && { storeReceipt, nextStep: 'Store Manager must acknowledge the receipt.' }),
    });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/flocks/[id]/cull]', err);
    return NextResponse.json({ error: 'Cull operation failed', detail: err?.message }, { status: 500 });
  }
}
