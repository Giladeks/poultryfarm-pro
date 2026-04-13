// app/api/flock-events/route.js
// Phase 8-Supplement · FlockLifecycleEvent
//
// GET  /api/flock-events?flockId=&status=&eventType=
//   Returns events visible to the caller.
//   PM sees only events they submitted.
//   FM+ sees all events for their tenant.
//
// POST /api/flock-events
//   PM or FM+ submits a new cull or deplete request.
//   Creates a FlockLifecycleEvent with status PENDING_APPROVAL.
//   No flock data changes yet — all effects happen on FM approval.
//   Notifies all Farm Managers in the tenant.

import { NextResponse }  from 'next/server';
import { prisma }        from '@/lib/db/prisma';
import { verifyToken }   from '@/lib/middleware/auth';
import { z }             from 'zod';

// ── Role buckets ──────────────────────────────────────────────────────────────
const SUBMIT_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
  'STORE_MANAGER', 'STORE_CLERK',  // store roles need GET access for the store inventory page
];
const MANAGER_ROLES = [
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

// ── Validation ────────────────────────────────────────────────────────────────
const submitSchema = z.object({
  flockId:    z.string().min(1),
  eventType:  z.enum(['CULL', 'DEPLETE']),
  birdCount:  z.number().int().positive(),
  disposition: z.enum([
    'CULLED',
    'DIED',
    'TRANSFERRED_TO_STORE',
    'DISPOSED',
    'HARVESTED',
  ]),
  reason:     z.string().min(10).max(1000),
  notes:      z.string().max(1000).optional().nullable(),

  // Required when disposition === TRANSFERRED_TO_STORE
  storeId:               z.string().min(1).optional().nullable(),
  estimatedValuePerBird: z.number().min(0).optional().nullable(),
  currency:              z.string().default('NGN'),

  // Required when disposition === DISPOSED
  disposalMethod:   z.enum(['BURIED', 'CREMATED', 'INCINERATED']).optional().nullable(),
  disposalLocation: z.string().max(200).optional().nullable(),
});

// ── GET /api/flock-events ─────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user)                              return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!SUBMIT_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },     { status: 403 });

  const { searchParams } = new URL(request.url);
  const flockId   = searchParams.get('flockId');
  const status    = searchParams.get('status');
  const eventType = searchParams.get('eventType');

  try {
    const isManager      = MANAGER_ROLES.includes(user.role);
    const isStoreManager = user.role === 'STORE_MANAGER' || user.role === 'STORE_CLERK';

    const events = await prisma.flockLifecycleEvent.findMany({
      where: {
        tenantId: user.tenantId,
        // Managers see all; Store Manager sees store-transfer events; PM sees own
        ...(!isManager && !isStoreManager && { submittedById: user.sub }),
        ...(isStoreManager && { disposition: 'TRANSFERRED_TO_STORE' }),
        ...(flockId   && { flockId }),
        ...(status    && { status }),
        ...(eventType && { eventType }),
      },
      include: {
        flock:      { select: { id: true, batchCode: true, operationType: true, currentCount: true } },
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
        submittedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        reviewedBy:  { select: { id: true, firstName: true, lastName: true, role: true } },
        store:       { select: { id: true, name: true, storeType: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 100,
    });

    return NextResponse.json({ events });
  } catch (err) {
    console.error('[GET /api/flock-events]', err);
    return NextResponse.json({ error: 'Failed to load flock events', detail: err?.message }, { status: 500 });
  }
}

// ── POST /api/flock-events ────────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user)                              return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!SUBMIT_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },     { status: 403 });

  try {
    const body = await request.json();
    const data = submitSchema.parse(body);

    // ── Cross-field validation ────────────────────────────────────────────────
    if (data.disposition === 'TRANSFERRED_TO_STORE' && !data.storeId)
      return NextResponse.json({ error: 'storeId is required when disposition is TRANSFERRED_TO_STORE' }, { status: 422 });

    if (data.disposition === 'DISPOSED' && !data.disposalMethod)
      return NextResponse.json({ error: 'disposalMethod is required when disposition is DISPOSED' }, { status: 422 });

    if (data.eventType === 'DEPLETE' && data.disposition === 'DISPOSED')
      return NextResponse.json({ error: 'DISPOSED is not a valid disposition for a full depletion — use CULLED or DIED' }, { status: 422 });

    if (data.eventType === 'CULL' && data.disposition === 'HARVESTED')
      return NextResponse.json({ error: 'HARVESTED is only valid for a full depletion — use /api/broiler-harvests for partial harvests' }, { status: 422 });

    // ── Validate flock ────────────────────────────────────────────────────────
    const flock = await prisma.flock.findFirst({
      where:  { id: data.flockId, tenantId: user.tenantId },
      select: {
        id: true, batchCode: true, currentCount: true, status: true,
        penSectionId: true, operationType: true,
      },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
    if (flock.status !== 'ACTIVE')
      return NextResponse.json({ error: `Flock is ${flock.status} — only ACTIVE flock can have lifecycle events` }, { status: 422 });
    if (data.birdCount > flock.currentCount)
      return NextResponse.json({
        error: `birdCount (${data.birdCount}) exceeds currentCount (${flock.currentCount})`,
      }, { status: 422 });

    // ── Validate store (if needed) ────────────────────────────────────────────
    if (data.storeId) {
      const store = await prisma.store.findFirst({
        where: { id: data.storeId, farm: { tenantId: user.tenantId } },
        select: { id: true },
      });
      if (!store)
        return NextResponse.json({ error: 'Store not found or not accessible' }, { status: 404 });
    }

    // ── Block if a PENDING_APPROVAL event already exists for this flock ───────
    const existingPending = await prisma.flockLifecycleEvent.findFirst({
      where: { flockId: data.flockId, status: 'PENDING_APPROVAL' },
      select: { id: true, eventType: true, submittedAt: true },
    });
    if (existingPending)
      return NextResponse.json({
        error: `A ${existingPending.eventType} request is already pending FM approval for this flock. Cancel it before submitting a new one.`,
        existingEventId: existingPending.id,
      }, { status: 409 });

    const remainingCount = data.eventType === 'DEPLETE'
      ? 0
      : flock.currentCount - data.birdCount;

    // ── Create the lifecycle event ────────────────────────────────────────────
    const event = await prisma.flockLifecycleEvent.create({
      data: {
        tenantId:              user.tenantId,
        flockId:               data.flockId,
        penSectionId:          flock.penSectionId,
        eventType:             data.eventType,
        status:                'PENDING_APPROVAL',
        birdCount:             data.birdCount,
        remainingCount,
        disposition:           data.disposition,
        disposalMethod:        data.disposalMethod   ?? null,
        disposalLocation:      data.disposalLocation ?? null,
        storeId:               data.storeId               ?? null,
        estimatedValuePerBird: data.estimatedValuePerBird ?? null,
        currency:              data.currency,
        reason:                data.reason,
        notes:                 data.notes ?? null,
        submittedById:         user.sub,
        submittedAt:           new Date(),
      },
      include: {
        flock:       { select: { id: true, batchCode: true, currentCount: true } },
        penSection:  { select: { id: true, name: true, pen: { select: { name: true } } } },
        submittedBy: { select: { id: true, firstName: true, lastName: true } },
        store:       { select: { id: true, name: true } },
      },
    });

    // ── Notify Farm Managers ──────────────────────────────────────────────────
    await notifyManagers(event, flock, user).catch(e =>
      console.error('[flock-events POST] notify error:', e?.message)
    );

    // ── Audit log ─────────────────────────────────────────────────────────────
    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'FlockLifecycleEvent',
        entityId:   event.id,
        changes: {
          eventType:   data.eventType,
          disposition: data.disposition,
          birdCount:   data.birdCount,
          flockId:     data.flockId,
          batchCode:   flock.batchCode,
        },
      },
    }).catch(() => {});

    return NextResponse.json(
      {
        message: `${data.eventType} request submitted for FM approval — ${data.birdCount} birds from ${flock.batchCode}`,
        event,
        nextStep: 'Awaiting Farm Manager approval. You will be notified when a decision is made.',
      },
      { status: 201 },
    );

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/flock-events]', err);
    return NextResponse.json({ error: 'Failed to submit lifecycle event', detail: err?.message }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function notifyManagers(event, flock, submitter) {
  const managers = await prisma.user.findMany({
    where: {
      tenantId: submitter.tenantId,
      role:     { in: ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON'] },
      isActive: true,
      id:       { not: submitter.sub }, // don't notify if submitter is FM+
    },
    select: { id: true },
  });
  if (!managers.length) return;

  const penName = `${event.penSection?.pen?.name} › ${event.penSection?.name}`;
  const typeLabel = event.eventType === 'CULL' ? 'Partial Cull' : 'Full Depletion';

  await prisma.notification.createMany({
    data: managers.map(m => ({
      tenantId:    submitter.tenantId,
      recipientId: m.id,
      type:        'REPORT_SUBMITTED',
      title:       `⚠ ${typeLabel} Request — ${flock.batchCode}`,
      message:     `${submitter.firstName} ${submitter.lastName} (${submitter.role}) has submitted a ${typeLabel.toLowerCase()} request for ${flock.batchCode} (${event.birdCount.toLocaleString()} birds · ${event.disposition}). Awaiting your approval.`,
      data: {
        eventId:    event.id,
        eventType:  event.eventType,
        flockId:    flock.id,
        batchCode:  flock.batchCode,
        birdCount:  event.birdCount,
        penName,
        actionUrl:  `/farm?op=${flock.operationType?.toLowerCase() || 'all'}&event=${event.id}`,
      },
      channel: 'IN_APP',
    })),
  });
}
