// app/api/feed/changes/route.js
// Phase 8H — Feed Change Request: list + create
// Flow: PM creates → FM approves → SM executes (return old + issue new) → PM acknowledges
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const VIEW_ROLES    = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','STORE_MANAGER','INTERNAL_CONTROL'];
const CREATE_ROLES  = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

const REASON_LABELS = {
  AGE_TRANSITION:     'Age Transition',
  WEIGHT_MILESTONE:   'Weight Milestone',
  VET_RECOMMENDATION: 'Vet Recommendation',
  FEED_SHORTAGE:      'Feed Shortage',
  QUALITY_ISSUE:      'Quality Issue',
  OTHER:              'Other',
};

const createSchema = z.object({
  penSectionId:         z.string().min(1),
  flockId:              z.string().min(1),
  fromFeedInventoryId:  z.string().min(1),
  fromStoreId:          z.string().min(1),
  toFeedInventoryId:    z.string().min(1),
  toStoreId:            z.string().min(1),
  returnBags:           z.number().int().min(0),
  returnQtyKg:          z.number().min(0),
  requestedBags:        z.number().int().min(1),
  requestedQtyKg:       z.number().min(0),
  effectiveDate:        z.string().min(1),
  reason:               z.enum(['AGE_TRANSITION','WEIGHT_MILESTONE','VET_RECOMMENDATION','FEED_SHORTAGE','QUALITY_ISSUE','OTHER']).default('AGE_TRANSITION'),
  notes:                z.string().max(1000).optional().nullable(),
});

// ── Enrich a raw FeedChangeRequest with related entities ─────────────────────
async function enrich(raw) {
  if (!raw) return null;
  const ids = [...new Set([
    raw.requestedById, raw.approvedById, raw.rejectedById,
    raw.executedById,  raw.acknowledgedById,
  ].filter(Boolean))];

  const [fromInv, toInv, section, flock, users] = await Promise.all([
    prisma.feedInventory.findUnique({
      where:  { id: raw.fromFeedInventoryId },
      select: { id: true, feedType: true, bagWeightKg: true, currentStockKg: true, feedPhase: true },
    }),
    prisma.feedInventory.findUnique({
      where:  { id: raw.toFeedInventoryId },
      select: { id: true, feedType: true, bagWeightKg: true, currentStockKg: true, feedPhase: true },
    }),
    prisma.penSection.findUnique({
      where:  { id: raw.penSectionId },
      select: { id: true, name: true, pen: { select: { name: true } } },
    }),
    prisma.flock.findUnique({
      where:  { id: raw.flockId },
      select: { id: true, batchCode: true, operationType: true, stage: true },
    }),
    ids.length ? prisma.user.findMany({
      where:  { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, role: true },
    }) : Promise.resolve([]),
  ]);

  const um = Object.fromEntries(users.map(u => [u.id, u]));
  return {
    ...raw,
    fromFeedInventory:  fromInv,
    toFeedInventory:    toInv,
    penSection:         section,
    flock,
    requestedBy:        um[raw.requestedById]    ?? null,
    approvedBy:         um[raw.approvedById]     ?? null,
    rejectedBy:         um[raw.rejectedById]     ?? null,
    executedBy:         um[raw.executedById]     ?? null,
    acknowledgedBy:     um[raw.acknowledgedById] ?? null,
    reasonLabel:        REASON_LABELS[raw.reason] ?? raw.reason,
  };
}

// ── GET /api/feed/changes ─────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const status      = searchParams.get('status');       // comma-separated
  const penSectionId = searchParams.get('penSectionId');
  const flockId     = searchParams.get('flockId');

  // Role-based scoping
  let sectionFilter = {};
  if (user.role === 'PEN_MANAGER') {
    const assignments = await prisma.penWorkerAssignment.findMany({
      where:  { userId: user.sub, isActive: true },
      select: { penSectionId: true },
    });
    const ids = assignments.map(a => a.penSectionId);
    sectionFilter = { penSectionId: { in: ids } };
  } else if (user.role === 'STORE_MANAGER') {
    // SM sees requests referencing their store
    const stores = await prisma.store.findMany({
      where:  { farm: { tenantId: user.tenantId } },
      select: { id: true },
    });
    const storeIds = stores.map(s => s.id);
    sectionFilter = { OR: [{ fromStoreId: { in: storeIds } }, { toStoreId: { in: storeIds } }] };
  } else {
    sectionFilter = { tenantId: user.tenantId };
  }

  const where = {
    ...sectionFilter,
    ...(status      && { status: { in: status.split(',') } }),
    ...(penSectionId && { penSectionId }),
    ...(flockId     && { flockId }),
  };

  const raws = await prisma.feedChangeRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const changes = await Promise.all(raws.map(enrich));
  return NextResponse.json({ changes });
}

// ── POST /api/feed/changes ────────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!CREATE_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.errors }, { status: 422 });

    const d = parsed.data;

    // Validate from/to are different feed types
    if (d.fromFeedInventoryId === d.toFeedInventoryId)
      return NextResponse.json({ error: 'From and To feed must be different' }, { status: 422 });

    // Validate flock belongs to this section
    const flock = await prisma.flock.findFirst({
      where: { id: d.flockId, penSectionId: d.penSectionId, tenantId: user.tenantId },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found in this section' }, { status: 404 });

    // Check no active feed change already in progress for this section
    const existing = await prisma.feedChangeRequest.findFirst({
      where: {
        penSectionId: d.penSectionId,
        status: { in: ['DRAFT','SUBMITTED','APPROVED','IN_PROGRESS'] },
      },
    });
    if (existing)
      return NextResponse.json({
        error: 'A feed change request is already active for this section',
        existingId: existing.id,
        existingStatus: existing.status,
      }, { status: 409 });

    const [yr, mo, dy] = d.effectiveDate.split('-').map(Number);

    const raw = await prisma.feedChangeRequest.create({
      data: {
        tenantId:             user.tenantId,
        penSectionId:         d.penSectionId,
        flockId:              d.flockId,
        requestedById:        user.sub,
        status:               'DRAFT',
        fromFeedInventoryId:  d.fromFeedInventoryId,
        fromStoreId:          d.fromStoreId,
        returnBags:           d.returnBags,
        returnQtyKg:          d.returnQtyKg,
        toFeedInventoryId:    d.toFeedInventoryId,
        toStoreId:            d.toStoreId,
        requestedBags:        d.requestedBags,
        requestedQtyKg:       d.requestedQtyKg,
        effectiveDate:        new Date(Date.UTC(yr, mo - 1, dy)),
        reason:               d.reason,
        notes:                d.notes || null,
      },
    });

    const change = await enrich(raw);
    return NextResponse.json({ change }, { status: 201 });
  } catch (err) {
    console.error('POST /api/feed/changes error:', err);
    return NextResponse.json({ error: 'Failed to create request', detail: err?.message }, { status: 500 });
  }
}
