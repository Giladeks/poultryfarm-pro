// app/api/feed/requisitions/route.js
// GET  — list requisitions (role-scoped)
// POST — PM manually creates/confirms a draft (rarely needed; usually auto-created)
//
// Role visibility:
//   PEN_MANAGER    — own sections only, all statuses
//   INTERNAL_CONTROL — SUBMITTED + all active statuses for approval queue
//   STORE_MANAGER  — APPROVED + ISSUED_PARTIAL (ready to issue)
//   FARM_MANAGER+  — all requisitions

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

const INCLUDE = {
  penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
  flock:         { select: { id: true, batchCode: true, currentCount: true, operationType: true } },
  feedInventory: { select: { id: true, feedType: true, currentStockKg: true, bagWeightKg: true } },
  store:         { select: { id: true, name: true } },
  submittedBy:   { select: { id: true, firstName: true, lastName: true } },
  approvedBy:    { select: { id: true, firstName: true, lastName: true } },
  rejectedBy:    { select: { id: true, firstName: true, lastName: true } },
  issuedBy:      { select: { id: true, firstName: true, lastName: true } },
  acknowledgedBy:{ select: { id: true, firstName: true, lastName: true } },
};

// ─── GET /api/feed/requisitions ───────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const status      = searchParams.get('status');       // filter by status
  const penSectionId= searchParams.get('penSectionId');
  const from        = searchParams.get('from');
  const to          = searchParams.get('to');
  const limit       = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  try {
    // ── Build scope filter ────────────────────────────────────────────────────
    let where = {};

    if (['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'].includes(user.role)) {
      // Full farm visibility
      where = { tenantId: user.tenantId };

    } else if (user.role === 'PEN_MANAGER') {
      // Only sections this PM is assigned to
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub },
        select: { penSectionId: true },
      });
      const sectionIds = assignments.map(a => a.penSectionId);
      if (sectionIds.length === 0)
        return NextResponse.json({ requisitions: [], summary: {} });
      where = { tenantId: user.tenantId, penSectionId: { in: sectionIds } };

    } else if (user.role === 'INTERNAL_CONTROL') {
      // IC sees all except DRAFT (they only need to act on submitted ones)
      where = {
        tenantId: user.tenantId,
        status:   { notIn: ['DRAFT'] },
      };

    } else if (['STORE_MANAGER', 'STORE_CLERK'].includes(user.role)) {
      // Store sees APPROVED and ISSUED_PARTIAL (need action) + recent closed
      where = {
        tenantId: user.tenantId,
        status:   { in: ['APPROVED', 'ISSUED', 'ISSUED_PARTIAL'] },
      };
    }

    // Optional filters on top of role scope
    if (status)         where.status = status;
    if (penSectionId)   where.penSectionId = penSectionId;
    if (from || to) {
      where.feedForDate = {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to)   }),
      };
    }

    const requisitions = await prisma.feedRequisition.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ feedForDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    // Summary counts by status (scoped to tenant)
    const statusCounts = await prisma.feedRequisition.groupBy({
      by:    ['status'],
      where: { tenantId: user.tenantId },
      _count: { status: true },
    });
    const summary = Object.fromEntries(
      statusCounts.map(r => [r.status, r._count.status])
    );

    return NextResponse.json({ requisitions, summary });

  } catch (err) {
    console.error('[GET /api/feed/requisitions]', err);
    return NextResponse.json({ error: 'Failed to load requisitions' }, { status: 500 });
  }
}

// ─── POST /api/feed/requisitions ──────────────────────────────────────────────
// PM manually triggers a requisition calculation for a section + date.
// Rarely needed — normally auto-created by the feed consumption trigger.
const createSchema = z.object({
  penSectionId:    z.string().uuid(),
  flockId:         z.string().uuid(),
  feedInventoryId: z.string().uuid(),
  feedForDate:     z.string(),   // YYYY-MM-DD — the date feed is needed FOR
});

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const PM_ROLES = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
  if (!PM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Pen Managers and above can create requisitions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    const feedForDate = new Date(data.feedForDate);
    feedForDate.setHours(0, 0, 0, 0);

    // Prevent duplicate
    const existing = await prisma.feedRequisition.findFirst({
      where: { penSectionId: data.penSectionId, feedInventoryId: data.feedInventoryId, feedForDate },
    });
    if (existing)
      return NextResponse.json({
        error: `A requisition already exists for this section and date (${existing.requisitionNumber})`,
        existing,
      }, { status: 409 });

    // Verify ownership
    if (user.role === 'PEN_MANAGER') {
      const assigned = await prisma.penWorkerAssignment.findFirst({
        where: { userId: user.sub, penSectionId: data.penSectionId },
      });
      if (!assigned)
        return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
    }

    // Fetch flock
    const flock = await prisma.flock.findFirst({
      where: { id: data.flockId, penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      select: { currentCount: true, status: true },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    // Fetch feedInventory for storeId
    const feedInv = await prisma.feedInventory.findFirst({
      where: { id: data.feedInventoryId, store: { farm: { tenantId: user.tenantId } } },
      select: { storeId: true },
    });
    if (!feedInv) return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

    // Calculate recommended quantity from last 7 days
    const sevenDaysAgo = new Date(feedForDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentLogs = await prisma.feedConsumption.findMany({
      where: { penSectionId: data.penSectionId, feedInventoryId: data.feedInventoryId, recordedDate: { gte: sevenDaysAgo, lt: feedForDate } },
      select: { quantityKg: true, recordedDate: true },
    });

    const calc = calculateRequisitionQty({
      recentLogs,
      currentBirdCount: flock.currentCount,
      bufferPct: 5,
    });

    const reqNumber = await nextRequisitionNumber(prisma, user.tenantId);

    const requisition = await prisma.feedRequisition.create({
      data: {
        tenantId:              user.tenantId,
        requisitionNumber:     reqNumber,
        penSectionId:          data.penSectionId,
        flockId:               data.flockId,
        feedInventoryId:       data.feedInventoryId,
        storeId:               feedInv.storeId,
        feedForDate,
        calculatedQtyKg:       calc.calculatedQtyKg,
        avgConsumptionPerBirdG:calc.avgConsumptionPerBirdG,
        currentBirdCount:      calc.currentBirdCount,
        calculationDays:       calc.calculationDays,
        status:                'DRAFT',
      },
      include: INCLUDE,
    });

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
