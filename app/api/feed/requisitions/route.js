// app/api/feed/requisitions/route.js
// GET  — list requisitions (role-scoped)
// POST — two modes:
//   1. Bootstrap (first issuance): { bootstrap: true, penId, feedInventoryId, feedForDate,
//      sectionBags: [{penSectionId, flockId, bags}] }
//      Creates a pen-level requisition at SUBMITTED status immediately.
//      PM and FM can use this to anchor the rolling stock formula on day 0.
//   2. Manual draft: { penSectionId, flockId, feedInventoryId, feedForDate }
//      Creates a DRAFT using the 7-day fallback formula (legacy path).

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';
import {
  calculateRequisitionQty,
  nextRequisitionNumber,
  calcDeviationPct,
} from '@/lib/utils/feedRequisitionCalc';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK',
  'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const BOOTSTRAP_ROLES = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// FeedRequisition has no Prisma relations in the generated client (stale client).
// All related data is fetched manually via separate queries and merged by ID.
// This is equivalent to include but works without prisma generate.
async function enrichRequisitions(reqs) {
  if (!reqs.length) return reqs;

  const flockIds    = [...new Set(reqs.map(r => r.flockId).filter(Boolean))];
  const invIds      = [...new Set(reqs.map(r => r.feedInventoryId).filter(Boolean))];
  const storeIds    = [...new Set(reqs.map(r => r.storeId).filter(Boolean))];
  const userIds     = [...new Set([
    ...reqs.map(r => r.submittedById),
    ...reqs.map(r => r.approvedById),
    ...reqs.map(r => r.rejectedById),
    ...reqs.map(r => r.issuedById),
    ...reqs.map(r => r.acknowledgedById),
  ].filter(Boolean))];

  const [flocks, invs, stores, users] = await Promise.all([
    flockIds.length ? prisma.flock.findMany({
      where:  { id: { in: flockIds } },
      select: { id: true, batchCode: true, currentCount: true, operationType: true },
    }) : [],
    invIds.length ? prisma.feedInventory.findMany({
      where:  { id: { in: invIds } },
      select: { id: true, feedType: true, currentStockKg: true, bagWeightKg: true },
    }) : [],
    storeIds.length ? prisma.store.findMany({
      where:  { id: { in: storeIds } },
      select: { id: true, name: true },
    }) : [],
    userIds.length ? prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true },
    }) : [],
  ]);

  const flockMap = Object.fromEntries(flocks.map(f => [f.id, f]));
  const invMap   = Object.fromEntries(invs.map(i => [i.id, i]));
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s]));
  const userMap  = Object.fromEntries(users.map(u => [u.id, u]));

  return reqs.map(r => ({
    ...r,
    flock:         flockMap[r.flockId]         ?? null,
    feedInventory: invMap[r.feedInventoryId]    ?? null,
    store:         storeMap[r.storeId]          ?? null,
    submittedBy:   userMap[r.submittedById]     ?? null,
    approvedBy:    userMap[r.approvedById]      ?? null,
    rejectedBy:    userMap[r.rejectedById]      ?? null,
    issuedBy:      userMap[r.issuedById]        ?? null,
    acknowledgedBy:userMap[r.acknowledgedById]  ?? null,
    penSection:    null, // not available without relation — use sectionBreakdown
  }));
}

// ─── GET /api/feed/requisitions ───────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const status      = searchParams.get('status');
  const penSectionId= searchParams.get('penSectionId');
  const from        = searchParams.get('from');
  const to          = searchParams.get('to');
  const limit       = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  try {
    let where = {};

    if (['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'].includes(user.role)) {
      where = { tenantId: user.tenantId };

    } else if (user.role === 'PEN_MANAGER') {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub },
        select: { penSection: { select: { id: true, penId: true } } },
      });
      const penIds     = [...new Set(assignments.map(a => a.penSection?.penId).filter(Boolean))];
      const sectionIds = assignments.map(a => a.penSection?.id).filter(Boolean);
      if (penIds.length === 0 && sectionIds.length === 0)
        return NextResponse.json({ requisitions: [], summary: {} });
      where = {
        tenantId: user.tenantId,
        OR: [
          ...(penIds.length     ? [{ penId:        { in: penIds     } }] : []),
          ...(sectionIds.length ? [{ penSectionId: { in: sectionIds } }] : []),
        ],
      };

    } else if (user.role === 'INTERNAL_CONTROL') {
      where = { tenantId: user.tenantId, status: { notIn: ['DRAFT'] } };

    } else if (['STORE_MANAGER', 'STORE_CLERK'].includes(user.role)) {
      where = { tenantId: user.tenantId, status: { in: ['APPROVED', 'ISSUED', 'ISSUED_PARTIAL'] } };
    }

    if (status)       where.status = status;
    if (penSectionId) where.penSectionId = penSectionId;
    if (from || to) {
      where.feedForDate = {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to)   }),
      };
    }

    const raw = await prisma.feedRequisition.findMany({
      where,
      orderBy: [{ feedForDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    const requisitions = await enrichRequisitions(raw);

    const statusCounts = await prisma.feedRequisition.groupBy({
      by:    ['status'],
      where: { tenantId: user.tenantId },
      _count: { status: true },
    });
    const summary = Object.fromEntries(statusCounts.map(r => [r.status, r._count.status]));

    return NextResponse.json({ requisitions, summary });

  } catch (err) {
    console.error('[GET /api/feed/requisitions]', err);
    return NextResponse.json({ error: 'Failed to load requisitions' }, { status: 500 });
  }
}

// ─── POST /api/feed/requisitions ──────────────────────────────────────────────
const bootstrapSchema = z.object({
  bootstrap:       z.literal(true),
  penId:           z.string().min(1),
  feedInventoryId: z.string().min(1),
  feedForDate:     z.string(),   // YYYY-MM-DD
  sectionBags:     z.array(z.object({
    penSectionId: z.string().min(1),
    flockId:      z.string().min(1),
    bags:         z.number().int().min(1),
  })).min(1),
  pmNotes: z.string().max(500).nullable().optional(),
});

const createSchema = z.object({
  penSectionId:    z.string().min(1),
  flockId:         z.string().min(1),
  feedInventoryId: z.string().min(1),
  feedForDate:     z.string(),
});

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const PM_ROLES = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
  if (!PM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Pen Managers and above can create requisitions' }, { status: 403 });

  try {
    const body = await request.json();

    // ── BOOTSTRAP PATH ────────────────────────────────────────────────────────
    if (body.bootstrap === true) {
      if (!BOOTSTRAP_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Pen Managers and Farm Managers can create bootstrap requisitions' }, { status: 403 });

      const data = bootstrapSchema.parse(body);

      const [yr, mo, dy] = data.feedForDate.split('-').map(Number);
      const feedForDate  = new Date(Date.UTC(yr, mo - 1, dy));

      // Prevent duplicate bootstrap for same pen + feed + date
      const existing = await prisma.feedRequisition.findFirst({
        where: {
          penId:           data.penId,
          feedInventoryId: data.feedInventoryId,
          feedForDate,
          tenantId:        user.tenantId,
        },
        select: { id: true, requisitionNumber: true, status: true },
      });
      if (existing)
        return NextResponse.json({
          error: `A requisition already exists for this pen and date (${existing.requisitionNumber} — ${existing.status})`,
          existing,
        }, { status: 409 });

      // Verify PM ownership — FM and above are always allowed
      if (user.role === 'PEN_MANAGER') {
        const sectionIds = data.sectionBags.map(s => s.penSectionId);
        const assigned = await prisma.penWorkerAssignment.findFirst({
          where: { userId: user.sub, penSectionId: { in: sectionIds } },
        });
        if (!assigned)
          return NextResponse.json({ error: 'You are not assigned to any of these sections' }, { status: 403 });
      }

      // Fetch feedInventory for bagWeightKg and storeId
      const feedInv = await prisma.feedInventory.findFirst({
        where:  { id: data.feedInventoryId, store: { farm: { tenantId: user.tenantId } } },
        select: { storeId: true, bagWeightKg: true, feedType: true },
      });
      if (!feedInv) return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

      const bw = Number(feedInv.bagWeightKg) || 25;

      // Build sectionBreakdown from the explicitly specified bag counts
      const sectionBreakdown = await Promise.all(data.sectionBags.map(async (s) => {
        const flock = await prisma.flock.findFirst({
          where:  { id: s.flockId, penSection: { pen: { farm: { tenantId: user.tenantId } } } },
          select: { currentCount: true, batchCode: true, penSection: { select: { name: true, pen: { select: { name: true } } } } },
        });
        const issuedQtyKg = parseFloat((s.bags * bw).toFixed(2));
        return {
          penSectionId:           s.penSectionId,
          sectionName:            flock?.penSection?.name ?? s.penSectionId,
          penName:                flock?.penSection?.pen?.name ?? null,
          flockId:                s.flockId,
          batchCode:              flock?.batchCode ?? '',
          birdCount:              flock?.currentCount ?? 0,
          bagsRequired:           s.bags,
          remainderKg:            0,
          carryOverKg:            null,  // filled on acknowledgement
          calculatedQtyKg:        issuedQtyKg,
          issuedQtyKg:            null,
          acknowledgedQtyKg:      null,
          requestedQtyKg:         issuedQtyKg,
          formulaUsed:            'BOOTSTRAP',
          isBootstrap:            true,
          basis:                  `Bootstrap: ${s.bags} bag${s.bags !== 1 ? 's' : ''} manually specified for first issuance.`,
        };
      }));

      const totalBagsRequired = data.sectionBags.reduce((s, e) => s + e.bags, 0);
      const totalCalcKg       = parseFloat((totalBagsRequired * bw).toFixed(2));

      // Use the first sectionBags entry for scalar FK fields
      const trigger = sectionBreakdown[0];

      const reqNumber = await nextRequisitionNumber(prisma, user.tenantId);

      const created = await prisma.feedRequisition.create({
        data: {
          tenantId:               user.tenantId,
          requisitionNumber:      reqNumber,
          penId:                  data.penId,
          penSectionId:           null,
          flockId:                trigger.flockId,
          feedInventoryId:        data.feedInventoryId,
          storeId:                feedInv.storeId ?? undefined,
          feedForDate,
          calculatedQtyKg:        totalCalcKg,
          requestedQtyKg:         totalCalcKg,
          totalBagsRequired,
          totalRemainderKg:       0,
          currentBirdCount:       sectionBreakdown.reduce((s, e) => s + (e.birdCount || 0), 0),
          calculationDays:        0,
          sectionBreakdown,
          pmNotes:                data.pmNotes ?? `Bootstrap requisition — first feed issuance for this pen.`,
          submittedById:          user.sub,
          submittedAt:            new Date(),
          status:                 'SUBMITTED',  // skip DRAFT — goes straight to IC for approval
        },
      });
      const [requisition] = await enrichRequisitions([created]);

      return NextResponse.json({ requisition, isBootstrap: true }, { status: 201 });
    }

    // ── STANDARD MANUAL DRAFT PATH ────────────────────────────────────────────
    const data = createSchema.parse(body);

    const [yr, mo, dy] = data.feedForDate.split('-').map(Number);
    const feedForDate  = new Date(Date.UTC(yr, mo - 1, dy));

    const existing = await prisma.feedRequisition.findFirst({
      where: { penSectionId: data.penSectionId, feedInventoryId: data.feedInventoryId, feedForDate, tenantId: user.tenantId },
    });
    if (existing)
      return NextResponse.json({
        error: `A requisition already exists for this section and date (${existing.requisitionNumber})`,
        existing,
      }, { status: 409 });

    if (user.role === 'PEN_MANAGER') {
      const assigned = await prisma.penWorkerAssignment.findFirst({
        where: { userId: user.sub, penSectionId: data.penSectionId },
      });
      if (!assigned)
        return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
    }

    const flock = await prisma.flock.findFirst({
      where:  { id: data.flockId, penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      select: { currentCount: true, status: true },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    const feedInv = await prisma.feedInventory.findFirst({
      where:  { id: data.feedInventoryId, store: { farm: { tenantId: user.tenantId } } },
      select: { storeId: true },
    });
    if (!feedInv) return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

    const sevenDaysAgo = new Date(feedForDate);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const recentLogs = await prisma.feedConsumption.findMany({
      where:   { penSectionId: data.penSectionId, feedInventoryId: data.feedInventoryId, recordedDate: { gte: sevenDaysAgo, lt: feedForDate } },
      select:  { quantityKg: true, recordedDate: true },
    });

    const calc = calculateRequisitionQty({
      recentLogs,
      currentBirdCount: flock.currentCount,
      bufferPct: 5,
    });

    const reqNumber = await nextRequisitionNumber(prisma, user.tenantId);

    const created = await prisma.feedRequisition.create({
      data: {
        tenantId:               user.tenantId,
        requisitionNumber:      reqNumber,
        penSectionId:           data.penSectionId,
        flockId:                data.flockId,
        feedInventoryId:        data.feedInventoryId,
        storeId:                feedInv.storeId,
        feedForDate,
        calculatedQtyKg:        calc.calculatedQtyKg,
        avgConsumptionPerBirdG: calc.avgConsumptionPerBirdG,
        currentBirdCount:       flock.currentCount,
        calculationDays:        calc.calculationDays,
        status:                 'DRAFT',
      },
    });
    const [requisition] = await enrichRequisitions([created]);

    return NextResponse.json({ requisition }, { status: 201 });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    if (err.code === 'P2002')
      return NextResponse.json({ error: 'A requisition already exists for this section and date' }, { status: 409 });
    console.error('[POST /api/feed/requisitions]', err);
    return NextResponse.json({ error: 'Failed to create requisition' }, { status: 500 });
  }
}
