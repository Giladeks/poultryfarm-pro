// app/api/flock-events/[id]/dispute/route.js
// POST /api/flock-events/[id]/dispute
//
// Handles all dispute-related state transitions for a FlockLifecycleEvent
// that has been approved and involves TRANSFERRED_TO_STORE disposition.
//
// Actions:
//   'dispute'      — STORE_MANAGER: APPROVED → STORE_DISPUTED (without counting)
//   'withdraw'     — STORE_MANAGER: STORE_DISPUTED → APPROVED (own dispute only)
//   'force_accept' — IC / FM+: STORE_DISPUTED → STORE_ACKNOWLEDGED
//                    Accepts the FM-approved bird count, increments inventory
//   'override'     — IC / FM+: STORE_DISPUTED → STORE_ACKNOWLEDGED
//                    Accepts a manually specified count, increments inventory

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const STORE_ROLES  = ['STORE_MANAGER', 'STORE_CLERK'];
const IC_ROLES     = ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const ALL_ROLES    = [...STORE_ROLES, ...IC_ROLES];

const schema = z.object({
  action:         z.enum(['dispute', 'withdraw', 'force_accept', 'override']),
  notes:          z.string().min(5).max(1000).optional().nullable(),
  overrideCount:  z.number().int().min(0).optional().nullable(),
});

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user)                           return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALL_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },   { status: 403 });

  try {
    const body = await request.json();
    const data = schema.parse(body);

    // ── Load event ────────────────────────────────────────────────────────────
    const event = await prisma.flockLifecycleEvent.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        flock: { select: { id: true, batchCode: true, currentCount: true, status: true } },
        store: { select: { id: true, name: true } },
      },
    });
    if (!event)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.disposition !== 'TRANSFERRED_TO_STORE')
      return NextResponse.json({ error: 'Dispute actions only apply to TRANSFERRED_TO_STORE events' }, { status: 422 });

    const now = new Date();

    // ── DISPUTE ───────────────────────────────────────────────────────────────
    if (data.action === 'dispute') {
      if (!STORE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Store Manager or Store Clerk can raise a dispute' }, { status: 403 });
      if (event.status !== 'APPROVED')
        return NextResponse.json({ error: `Cannot dispute an event with status ${event.status}` }, { status: 422 });
      if (!data.notes || data.notes.trim().length < 5)
        return NextResponse.json({ error: 'Dispute notes are required (min 5 characters)' }, { status: 422 });

      await prisma.flockLifecycleEvent.update({
        where: { id: params.id },
        data: {
          status:               'STORE_DISPUTED',
          storeAcknowledgedById: user.sub,
          storeAcknowledgedAt:  now,
          storeDiscrepancyNotes: data.notes.trim(),
        },
      });

      // Notify FM+ of dispute
      const managers = await prisma.user.findMany({
        where: { tenantId: user.tenantId, role: { in: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','INTERNAL_CONTROL'] }, isActive: true },
        select: { id: true },
      });
      await prisma.notification.createMany({
        data: managers.map(m => ({
          tenantId:    user.tenantId,
          recipientId: m.id,
          type:        'ALERT',
          title:       `⚑ Store Dispute — ${event.flock.batchCode}`,
          message:     `${user.firstName} ${user.lastName} has disputed the bird receipt for ${event.flock.batchCode}. Notes: ${data.notes}`,
          data:        { eventId: event.id, flockId: event.flockId, actionUrl: '/store' },
          channel:     'IN_APP',
        })),
      });

      return NextResponse.json({ message: 'Dispute raised. IC/FM has been notified.', status: 'STORE_DISPUTED' });
    }

    // ── WITHDRAW ──────────────────────────────────────────────────────────────
    if (data.action === 'withdraw') {
      if (!STORE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Store Manager or Store Clerk can withdraw a dispute' }, { status: 403 });
      if (event.status !== 'STORE_DISPUTED')
        return NextResponse.json({ error: 'Can only withdraw a STORE_DISPUTED event' }, { status: 422 });
      // COI: only the person who raised the dispute can withdraw
      if (event.storeAcknowledgedById !== user.sub)
        return NextResponse.json({ error: 'You can only withdraw your own disputes' }, { status: 403 });

      await prisma.flockLifecycleEvent.update({
        where: { id: params.id },
        data: {
          status:                'APPROVED',
          storeAcknowledgedById: null,
          storeAcknowledgedAt:   null,
          storeDiscrepancyNotes: null,
        },
      });

      return NextResponse.json({ message: 'Dispute withdrawn. Receipt returned to pending.', status: 'APPROVED' });
    }

    // ── FORCE ACCEPT ──────────────────────────────────────────────────────────
    if (data.action === 'force_accept') {
      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Internal Control and Farm Managers can force accept' }, { status: 403 });
      if (event.status !== 'STORE_DISPUTED')
        return NextResponse.json({ error: 'Can only force accept a STORE_DISPUTED event' }, { status: 422 });

      // Accept the original FM-approved bird count
      const acceptedCount = event.birdCount;

      await prisma.flockLifecycleEvent.update({
        where: { id: params.id },
        data: {
          status:               'STORE_ACKNOWLEDGED',
          storeAcknowledgedAt:  now,
          storeActualCount:     acceptedCount,
          storeDiscrepancyNotes: data.notes
            ? `FORCE ACCEPTED by ${user.firstName} ${user.lastName}: ${data.notes}`
            : `FORCE ACCEPTED by ${user.firstName} ${user.lastName}. Original count of ${acceptedCount} birds accepted.`,
        },
      });

      // Increment inventory
      await incrementInventory(event, acceptedCount, user.tenantId);

      // Notify Store Manager and submitter
      await notifyResolution(event, user, 'FORCE_ACCEPTED', acceptedCount);

      return NextResponse.json({ message: `Force accepted — ${acceptedCount.toLocaleString()} birds added to inventory.`, status: 'STORE_ACKNOWLEDGED' });
    }

    // ── OVERRIDE (IC specifies a different count) ─────────────────────────────
    if (data.action === 'override') {
      if (!IC_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Only Internal Control and Farm Managers can override' }, { status: 403 });
      if (event.status !== 'STORE_DISPUTED')
        return NextResponse.json({ error: 'Can only override a STORE_DISPUTED event' }, { status: 422 });
      if (data.overrideCount == null || data.overrideCount < 0)
        return NextResponse.json({ error: 'overrideCount is required for override action' }, { status: 422 });
      if (!data.notes || data.notes.trim().length < 5)
        return NextResponse.json({ error: 'Resolution notes are required for override' }, { status: 422 });
      if (data.overrideCount > event.birdCount)
        return NextResponse.json({ error: `Override count (${data.overrideCount}) cannot exceed the FM-approved bird count (${event.birdCount})` }, { status: 422 });

      const overrideCount  = data.overrideCount;
      // The difference is birds that left the pen but didn't actually arrive at the store
      // (transit mortality, miscounting, etc.) — these must be restored to the flock
      // so total birds remain consistent: penBirds + storeBirds = initialCount - deaths
      const diff           = event.birdCount - overrideCount; // e.g. 51 approved - 50 received = 1

      await prisma.$transaction(async (tx) => {
        // 1. Update event status
        await tx.flockLifecycleEvent.update({
          where: { id: params.id },
          data: {
            status:                'STORE_ACKNOWLEDGED',
            storeAcknowledgedAt:   now,
            storeActualCount:      overrideCount,
            storeDiscrepancyNotes: `OVERRIDE by ${user.firstName} ${user.lastName}: count set to ${overrideCount} (FM approved ${event.birdCount}). Notes: ${data.notes}`,
          },
        });

        // 2. Restore the difference back to the flock (only if flock is still ACTIVE)
        //    For a CULL the flock is still active — birds in transit that didn't arrive
        //    are treated as confirmed missing; we restore them to the pen count so the
        //    records balance. The mortality/loss is implicit in the difference.
        if (diff > 0 && event.flock.status === 'ACTIVE') {
          await tx.flock.update({
            where: { id: event.flockId },
            data:  { currentCount: { increment: diff } },
          });
        }
      });

      // 3. Increment inventory with override count (outside tx — non-critical)
      await incrementInventory(event, overrideCount, user.tenantId);

      // 4. Notify
      await notifyResolution(event, user, 'OVERRIDE', overrideCount, diff);

      const diffMsg = diff > 0 ? ` ${diff} bird${diff !== 1 ? 's' : ''} restored to flock.` : '';
      return NextResponse.json({
        message: `Override accepted — ${overrideCount.toLocaleString()} birds added to inventory.${diffMsg}`,
        status:  'STORE_ACKNOWLEDGED',
      });
    }

    return NextResponse.json({ error: `Unknown action: ${data.action}` }, { status: 400 });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/flock-events/[id]/dispute]', err);
    return NextResponse.json({ error: 'Action failed', detail: err?.message }, { status: 500 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function incrementInventory(event, count, tenantId) {
  if (!event.storeId || count <= 0) return;
  const itemName = `Live Birds — ${event.flock.batchCode}`;
  const item = await prisma.inventoryItem.findFirst({
    where: { storeId: event.storeId, tenantId, name: itemName, category: 'LIVE_BIRDS' },
    select: { id: true },
  });
  if (item) {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data:  { currentStock: { increment: count } },
    });
  }
}

async function notifyResolution(event, resolver, action, finalCount, diff = 0) {
  const recipients = new Set();

  // Notify the original submitter
  if (event.submittedById) recipients.add(event.submittedById);

  // Notify store managers
  const storeManagers = await prisma.user.findMany({
    where: { tenantId: event.tenantId, role: 'STORE_MANAGER', isActive: true },
    select: { id: true },
  });
  storeManagers.forEach(sm => recipients.add(sm.id));

  const label   = action === 'FORCE_ACCEPTED' ? 'Force Accepted' : 'Count Overridden';
  const diffMsg = diff > 0 ? ` ${diff} bird${diff !== 1 ? 's' : ''} returned to flock.` : '';
  await prisma.notification.createMany({
    data: [...recipients].map(id => ({
      tenantId:    event.tenantId,
      recipientId: id,
      type:        'REPORT_APPROVED',
      title:       `✓ Dispute Resolved (${label}) — ${event.flock.batchCode}`,
      message:     `${resolver.firstName} ${resolver.lastName} resolved the dispute for ${event.flock.batchCode}. Final count: ${finalCount.toLocaleString()} birds added to ${event.store?.name || 'store'}.${diffMsg}`,
      data:        { eventId: event.id, flockId: event.flockId, finalCount, action, actionUrl: '/store' },
      channel:     'IN_APP',
    })),
  });
}
