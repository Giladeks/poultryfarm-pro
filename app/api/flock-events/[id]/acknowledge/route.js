// app/api/flock-events/[id]/acknowledge/route.js
// Phase 8-Supplement · FlockLifecycleEvent — Store Acknowledgement
//
// POST /api/flock-events/[id]/acknowledge
//
// Called by Store Manager after physically counting birds received.
// Body: { actualCount: Int, notes?: string }
//
// If actualCount === event.birdCount → STORE_ACKNOWLEDGED
//   → InventoryItem.currentStock incremented by event.birdCount
//
// If actualCount !== event.birdCount → STORE_DISPUTED
//   → InventoryItem.currentStock incremented by actualCount (what was actually received)
//   → FM notified of discrepancy
//   → Event status → STORE_DISPUTED for FM to review
//
// Roles: STORE_MANAGER, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ACK_ROLES = [
  'STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const ackSchema = z.object({
  actualCount: z.number().int().min(0),
  notes:       z.string().max(1000).optional().nullable(),
});

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user)                           return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!ACK_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden — Store Manager role required' }, { status: 403 });

  try {
    const body = await request.json();
    const data = ackSchema.parse(body);

    // ── Load event ────────────────────────────────────────────────────────────
    const event = await prisma.flockLifecycleEvent.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        flock: { select: { id: true, batchCode: true } },
        store: { select: { id: true, name: true } },
      },
    });

    if (!event)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.status !== 'APPROVED')
      return NextResponse.json({
        error: `Cannot acknowledge — event is ${event.status}. Only APPROVED events can be acknowledged.`,
      }, { status: 422 });
    if (event.disposition !== 'TRANSFERRED_TO_STORE')
      return NextResponse.json({
        error: `This event has disposition ${event.disposition} — only TRANSFERRED_TO_STORE events require store acknowledgement.`,
      }, { status: 422 });
    if (!event.storeId || !event.storeReceiptId)
      return NextResponse.json({
        error: 'No store receipt linked to this event — contact a Farm Manager.',
      }, { status: 422 });

    const hasDiscrepancy    = data.actualCount !== event.birdCount;
    const discrepancyCount  = event.birdCount - data.actualCount;
    const discrepancyPct    = event.birdCount > 0
      ? parseFloat(((Math.abs(discrepancyCount) / event.birdCount) * 100).toFixed(2))
      : 0;
    const newStatus = hasDiscrepancy ? 'STORE_DISPUTED' : 'STORE_ACKNOWLEDGED';
    const now       = new Date();

    // ── Resolve the linked InventoryItem for this flock's live birds ──────────
    const itemName  = `Live Birds — ${event.flock.batchCode}`;
    const invItem   = await prisma.inventoryItem.findFirst({
      where: { storeId: event.storeId, tenantId: user.tenantId, name: itemName, category: 'LIVE_BIRDS' },
      select: { id: true, currentStock: true },
    });

    // ── Atomic: update event + increment inventory ────────────────────────────
    const stockIncrement = data.actualCount; // increment by what was actually received

    const [updatedEvent] = await prisma.$transaction([
      // 1. Update event status
      prisma.flockLifecycleEvent.update({
        where: { id: params.id },
        data: {
          status:                   newStatus,
          storeAcknowledgedById:    user.sub,
          storeAcknowledgedAt:      now,
          storeActualCount:         data.actualCount,
          storeDiscrepancyNotes:    hasDiscrepancy
            ? [
                `Discrepancy: ${Math.abs(discrepancyCount)} birds (${discrepancyPct}%)`,
                discrepancyCount > 0
                  ? `${discrepancyCount} birds short — expected ${event.birdCount}, received ${data.actualCount}`
                  : `${Math.abs(discrepancyCount)} birds excess — expected ${event.birdCount}, received ${data.actualCount}`,
                data.notes || null,
              ].filter(Boolean).join(' | ')
            : data.notes || null,
        },
        select: {
          id: true, status: true, birdCount: true,
          storeActualCount: true, storeDiscrepancyNotes: true,
        },
      }),

      // 2. Increment InventoryItem stock by actual count received
      ...(invItem ? [
        prisma.inventoryItem.update({
          where: { id: invItem.id },
          data:  { currentStock: { increment: stockIncrement } },
          select: { id: true, currentStock: true },
        }),
      ] : []),
    ]);

    // ── Notify FM of discrepancy ──────────────────────────────────────────────
    if (hasDiscrepancy) {
      await notifyDiscrepancy(event, user, data.actualCount, discrepancyCount, discrepancyPct).catch(() => {});
    }

    // ── Notify submitter of completion ────────────────────────────────────────
    await prisma.notification.create({
      data: {
        tenantId:    event.tenantId,
        recipientId: event.submittedById,
        type:        hasDiscrepancy ? 'ALERT' : 'REPORT_APPROVED',
        title:       hasDiscrepancy
          ? `⚠ Store Discrepancy — ${event.flock.batchCode}`
          : `✅ Store Receipt Acknowledged — ${event.flock.batchCode}`,
        message: hasDiscrepancy
          ? `Store Manager counted ${data.actualCount.toLocaleString()} birds but ${event.birdCount.toLocaleString()} were expected (${discrepancyPct}% difference). FM has been notified.`
          : `All ${event.birdCount.toLocaleString()} birds from ${event.flock.batchCode} have been confirmed received at ${event.store?.name}.`,
        data:    { eventId: event.id },
        channel: 'IN_APP',
      },
    }).catch(() => {});

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'FlockLifecycleEvent',
        entityId:   params.id,
        changes: {
          action:           'STORE_ACKNOWLEDGE',
          actualCount:      data.actualCount,
          expectedCount:    event.birdCount,
          hasDiscrepancy,
          discrepancyCount,
          discrepancyPct,
          newStatus,
        },
      },
    }).catch(() => {});

    return NextResponse.json({
      message: hasDiscrepancy
        ? `Discrepancy recorded — ${Math.abs(discrepancyCount)} birds ${discrepancyCount > 0 ? 'short' : 'excess'}. FM has been notified.`
        : `Receipt acknowledged — ${data.actualCount.toLocaleString()} birds confirmed.`,
      event:   updatedEvent,
      hasDiscrepancy,
      ...(hasDiscrepancy && { discrepancyCount, discrepancyPct }),
    });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/flock-events/[id]/acknowledge]', err);
    return NextResponse.json({ error: 'Acknowledgement failed', detail: err?.message }, { status: 500 });
  }
}

async function notifyDiscrepancy(event, storeManager, actualCount, discrepancyCount, discrepancyPct) {
  const managers = await prisma.user.findMany({
    where: { tenantId: event.tenantId, role: { in: ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON'] }, isActive: true },
    select: { id: true },
  });
  if (!managers.length) return;
  await prisma.notification.createMany({
    data: managers.map(m => ({
      tenantId:    event.tenantId,
      recipientId: m.id,
      type:        'ALERT',
      title:       `⚠ Bird Count Discrepancy — ${event.flock?.batchCode}`,
      message:     `Store Manager ${storeManager.firstName} ${storeManager.lastName} counted ${actualCount.toLocaleString()} birds but ${event.birdCount.toLocaleString()} were sent (${discrepancyPct}% difference, ${Math.abs(discrepancyCount)} birds). Review required.`,
      data: {
        eventId:       event.id,
        flockId:       event.flockId,
        expectedCount: event.birdCount,
        actualCount,
        discrepancyCount,
        discrepancyPct,
        actionUrl:     `/farm?event=${event.id}`,
      },
      channel: 'IN_APP',
    })),
  });
}
