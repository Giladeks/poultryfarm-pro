// ─────────────────────────────────────────────────────────────────────────────
// app/api/broiler-harvests/route.js
// Phase 8-Supplement Final
//
// POST /api/broiler-harvests
//   Records a broiler harvest batch and automatically creates a StoreReceipt
//   for the harvested live birds so the Store Manager can acknowledge receipt
//   and raise a SalesOrder.
//
//   The harvest record captures physical data (weight, FCR, grades).
//   Revenue flows through SalesOrder — never directly on the harvest record.
//
// GET /api/broiler-harvests?flockId=xxx
//   Returns all harvest records for a flock (for the lifecycle summary and
//   broiler performance page).
//
// Roles (POST): FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
// Roles (GET):  all of the above + INTERNAL_CONTROL
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const WRITE_ROLES = [
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];
const READ_ROLES = [
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'INTERNAL_CONTROL',
];

const harvestSchema = z.object({
  flockId:            z.string().min(1),
  penSectionId:       z.string().min(1),
  harvestDate:        z.string(),                        // ISO date
  birdsHarvested:     z.number().int().positive(),
  birdsRejected:      z.number().int().min(0).default(0),
  totalLiveWeightKg:  z.number().positive(),
  avgLiveWeightG:     z.number().positive(),
  totalDressWeightKg: z.number().positive().optional(),
  dressingPct:        z.number().min(0).max(100).optional(),
  grade1Count:        z.number().int().min(0).default(0),
  grade2Count:        z.number().int().min(0).default(0),
  grade3Count:        z.number().int().min(0).default(0),
  finalFCR:           z.number().min(0).optional(),
  totalFeedKg:        z.number().min(0).optional(),
  notes:              z.string().max(1000).optional(),
  // Store transfer details — required to auto-create StoreReceipt
  storeId:            z.string().min(1),
  estimatedValuePerBird: z.number().min(0).optional(),
  currency:           z.string().default('NGN'),
});

// ── GET /api/broiler-harvests ─────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user)                            return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!READ_ROLES.includes(user.role))  return NextResponse.json({ error: 'Forbidden' },     { status: 403 });

  const { searchParams } = new URL(request.url);
  const flockId = searchParams.get('flockId');

  try {
    const harvests = await prisma.broilerHarvest.findMany({
      where: {
        flock: { tenantId: user.tenantId },
        ...(flockId && { flockId }),
      },
      include: {
        flock:      { select: { id: true, batchCode: true, breed: true } },
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { harvestDate: 'desc' },
    });

    return NextResponse.json({ harvests });
  } catch (err) {
    console.error('[GET /api/broiler-harvests]', err);
    return NextResponse.json({ error: 'Failed to load harvests', detail: err?.message }, { status: 500 });
  }
}

// ── POST /api/broiler-harvests ────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user)                             return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!WRITE_ROLES.includes(user.role))  return NextResponse.json({ error: 'Forbidden' },   { status: 403 });

  try {
    const body = await request.json();
    const data = harvestSchema.parse(body);

    // ── Validate flock ────────────────────────────────────────────────────────
    const flock = await prisma.flock.findFirst({
      where:  { id: data.flockId, tenantId: user.tenantId, operationType: 'BROILER' },
      select: {
        id: true, batchCode: true, currentCount: true, status: true,
        penSectionId: true,
      },
    });
    if (!flock)
      return NextResponse.json({ error: 'Broiler flock not found' }, { status: 404 });
    if (flock.status !== 'ACTIVE')
      return NextResponse.json({ error: `Cannot harvest a flock with status ${flock.status}` }, { status: 422 });
    if (data.birdsHarvested > flock.currentCount)
      return NextResponse.json(
        { error: `birdsHarvested (${data.birdsHarvested}) exceeds currentCount (${flock.currentCount})` },
        { status: 422 },
      );

    // ── Validate store ────────────────────────────────────────────────────────
    const store = await prisma.store.findFirst({
      where: { id: data.storeId, farm: { tenantId: user.tenantId } },
      select: { id: true },
    });
    if (!store)
      return NextResponse.json({ error: 'Store not found or not accessible' }, { status: 404 });

    const harvestDate = new Date(data.harvestDate);
    const unitCost    = data.estimatedValuePerBird ?? 0;
    const totalCost   = unitCost * data.birdsHarvested;

    // ── Resolve or create LIVE_BIRDS inventory item ───────────────────────────
    const itemName = `Live Birds — ${flock.batchCode}`;
    let liveBirdsItemId: string;
    const existing = await prisma.inventoryItem.findFirst({
      where: { storeId: data.storeId, tenantId: user.tenantId, name: itemName, category: 'LIVE_BIRDS' },
      select: { id: true },
    });
    if (existing) {
      liveBirdsItemId = existing.id;
    } else {
      const created = await prisma.inventoryItem.create({
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
      liveBirdsItemId = created.id;
    }

    // ── Transaction: harvest record + flock count decrement + store receipt ───
    const [harvest, , storeReceipt] = await prisma.$transaction([

      // 1. Create harvest record
      prisma.broilerHarvest.create({
        data: {
          flockId:            data.flockId,
          penSectionId:       data.penSectionId,
          harvestDate,
          birdsHarvested:     data.birdsHarvested,
          birdsRejected:      data.birdsRejected,
          totalLiveWeightKg:  data.totalLiveWeightKg,
          avgLiveWeightG:     data.avgLiveWeightG,
          totalDressWeightKg: data.totalDressWeightKg ?? null,
          dressingPct:        data.dressingPct        ?? null,
          grade1Count:        data.grade1Count,
          grade2Count:        data.grade2Count,
          grade3Count:        data.grade3Count,
          finalFCR:           data.finalFCR            ?? null,
          totalFeedKg:        data.totalFeedKg         ?? null,
          // Revenue is NOT stored here — it flows through SalesOrder
          currency:           data.currency,
          recordedById:       user.sub,
          submissionStatus:   'PENDING',
          notes:              data.notes ?? null,
        },
        select: {
          id: true, flockId: true, harvestDate: true,
          birdsHarvested: true, totalLiveWeightKg: true, avgLiveWeightG: true,
        },
      }),

      // 2. Decrement flock currentCount
      prisma.flock.update({
        where: { id: data.flockId },
        data:  { currentCount: { decrement: data.birdsHarvested } },
        select: { id: true, currentCount: true },
      }),

      // 3. Auto-create StoreReceipt for live birds
      prisma.storeReceipt.create({
        data: {
          storeId:          data.storeId,
          receivedById:     user.sub,
          receiptDate:      harvestDate,
          inventoryItemId:  liveBirdsItemId,
          quantityReceived: data.birdsHarvested,
          unitCost,
          currency:         data.currency,
          totalCost,
          flockId:          data.flockId,
          fromSectionId:    data.penSectionId,
          referenceNumber:  `HARVEST-${flock.batchCode}-${data.harvestDate}`,
          notes: [
            `Harvest from flock ${flock.batchCode}`,
            `Live weight: ${data.totalLiveWeightKg}kg total, ${data.avgLiveWeightG}g avg`,
            data.finalFCR ? `FCR: ${data.finalFCR}` : null,
            data.notes    ? `Notes: ${data.notes}` : null,
          ].filter(Boolean).join(' | '),
          qualityStatus: 'PENDING',
        },
        select: { id: true, quantityReceived: true, storeId: true },
      }),
    ]);

    return NextResponse.json(
      {
        message:      `Harvest recorded for ${flock.batchCode} — ${data.birdsHarvested} birds`,
        harvest,
        storeReceipt,
        nextStep:     'Store Manager must acknowledge the receipt. Raise a Sales Order to record revenue.',
      },
      { status: 201 },
    );

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/broiler-harvests]', err);
    return NextResponse.json({ error: 'Harvest recording failed', detail: err?.message }, { status: 500 });
  }
}
