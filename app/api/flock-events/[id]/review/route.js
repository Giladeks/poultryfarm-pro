// app/api/flock-events/[id]/review/route.js
// Phase 8-Supplement · FlockLifecycleEvent — FM Review
//
// POST /api/flock-events/[id]/review
//
// Body: { action: 'APPROVE' | 'REJECT', rejectionReason?: string }
//
// On APPROVE — executes all effects in a single $transaction:
//   CULL:
//     • flock.currentCount decremented
//     • MortalityRecord created (CULLED/DIED/DISPOSED → causeCode CULLED or UNKNOWN)
//     • InventoryItem + StoreReceipt created (TRANSFERRED_TO_STORE only)
//   DEPLETE:
//     • flock.status → DEPLETED, currentCount → 0
//     • penSection.isActive → false
//     • Task CLEANING created
//     • InventoryItem + StoreReceipt created (non-DIED dispositions)
//   Both:
//     • FlockLifecycleEvent.status → APPROVED
//     • Linked record IDs stored back on the event
//
// COI rule: reviewedById ≠ submittedById
// Roles: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const REVIEW_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const reviewSchema = z.object({
  action:          z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().min(5).max(1000).optional().nullable(),
});

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user)                              return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!REVIEW_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden — only Farm Manager and above can approve lifecycle events' }, { status: 403 });

  try {
    const body = await request.json();
    const data = reviewSchema.parse(body);

    if (data.action === 'REJECT' && !data.rejectionReason)
      return NextResponse.json({ error: 'rejectionReason is required when rejecting' }, { status: 422 });

    // ── Load event ────────────────────────────────────────────────────────────
    const event = await prisma.flockLifecycleEvent.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        flock: {
          select: {
            id: true, batchCode: true, currentCount: true,
            status: true, operationType: true, notes: true,
            penSection: {
              select: {
                id: true, name: true,
                workerAssignments: {
                  where:  { isActive: true },
                  select: { userId: true, user: { select: { id: true, role: true } } },
                },
              },
            },
          },
        },
        penSection:  { select: { id: true, name: true } },
        submittedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        store:       { select: { id: true, name: true } },
      },
    });

    if (!event)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.status !== 'PENDING_APPROVAL')
      return NextResponse.json({ error: `Event is already ${event.status}` }, { status: 422 });
    if (event.flock.status !== 'ACTIVE')
      return NextResponse.json({ error: `Flock is no longer ACTIVE (current: ${event.flock.status})` }, { status: 422 });

    // ── COI check ─────────────────────────────────────────────────────────────
    if (event.submittedById === user.sub)
      return NextResponse.json({
        error: 'Conflict of interest — you cannot approve your own lifecycle event submission',
        coiBlocked: true,
      }, { status: 403 });

    // ── REJECT path ───────────────────────────────────────────────────────────
    if (data.action === 'REJECT') {
      const updated = await prisma.flockLifecycleEvent.update({
        where: { id: params.id },
        data: {
          status:          'REJECTED',
          reviewedById:    user.sub,
          reviewedAt:      new Date(),
          rejectionReason: data.rejectionReason,
        },
        select: { id: true, status: true, rejectionReason: true },
      });

      await notifySubmitter(event, 'REJECTED', user, data.rejectionReason).catch(() => {});
      await auditLog(user, params.id, 'REJECT', event).catch(() => {});

      return NextResponse.json({
        message: 'Event rejected',
        event:   updated,
      });
    }

    // ── APPROVE path ──────────────────────────────────────────────────────────
    // Re-validate bird count against current flock state (race condition guard)
    if (event.birdCount > event.flock.currentCount)
      return NextResponse.json({
        error: `Cannot approve — flock now has ${event.flock.currentCount} birds but event requests ${event.birdCount}. The flock count may have changed since submission.`,
      }, { status: 422 });

    const now        = new Date();
    const isCull     = event.eventType === 'CULL';
    const isDepleted = event.eventType === 'DEPLETE';
    const toStore    = event.disposition === 'TRANSFERRED_TO_STORE';
    const isDisposed = event.disposition === 'DISPOSED';
    const causeCode  = event.disposition === 'DIED' ? 'UNKNOWN' : 'CULLED';

    // ── Resolve store inventory item (if transferring to store) ───────────────
    let liveBirdsItemId = null;
    if (toStore && event.storeId) {
      const itemName = `Live Birds — ${event.flock.batchCode}`;
      let item = await prisma.inventoryItem.findFirst({
        where: { storeId: event.storeId, tenantId: user.tenantId, name: itemName, category: 'LIVE_BIRDS' },
        select: { id: true },
      });
      if (!item) {
        item = await prisma.inventoryItem.create({
          data: {
            storeId:      event.storeId,
            tenantId:     user.tenantId,
            name:         itemName,
            category:     'LIVE_BIRDS',
            unit:         'birds',
            currentStock: 0,
            reorderLevel: 0,
            costPerUnit:  Number(event.estimatedValuePerBird ?? 0),
            currency:     event.currency,
            isActive:     true,
          },
          select: { id: true },
        });
      }
      liveBirdsItemId = item.id;
    }

    // ── Resolve cleaning task assignee (deplete only) ─────────────────────────
    let cleaningAssigneeId = user.sub;
    if (isDepleted) {
      const assignments = event.flock.penSection?.workerAssignments ?? [];
      const worker = assignments.find(a => a.user.role === 'PEN_WORKER')?.user
                  || assignments[0]?.user;
      if (worker) cleaningAssigneeId = worker.id;
    }

    // ── Build transaction ops ─────────────────────────────────────────────────
    const txOps = [];

    // 1. Update flock
    if (isCull) {
      txOps.push(
        prisma.flock.update({
          where: { id: event.flockId },
          data:  { currentCount: { decrement: event.birdCount } },
          select: { id: true, batchCode: true, currentCount: true, status: true },
        })
      );
    } else {
      // DEPLETE
      const mergedNotes = event.notes
        ? (event.flock.notes ? `${event.flock.notes}\n---\n${event.notes}` : event.notes)
        : event.flock.notes;
      txOps.push(
        prisma.flock.update({
          where: { id: event.flockId },
          data: {
            status:               'DEPLETED',
            currentCount:         0,
            depletionDate:        now,
            depletionDisposition: event.disposition,
            notes:                mergedNotes,
          },
          select: { id: true, batchCode: true, currentCount: true, status: true, depletionDisposition: true },
        })
      );
    }

    // 2. Mortality record (cull/dispose/die — not for HARVESTED or TRANSFERRED_TO_STORE alone)
    let mortalityRecordOp = null;
    if (['CULLED', 'DIED', 'DISPOSED'].includes(event.disposition)) {
      mortalityRecordOp = prisma.mortalityRecord.create({
        data: {
          flockId:          event.flockId,
          penSectionId:     event.penSectionId,
          recordedById:     user.sub,          // FM approved = FM is the recorder
          recordDate:       now,
          count:            event.birdCount,
          causeCode,
          submissionStatus: 'APPROVED',        // FM-approved events are auto-approved
          notes: [
            `Lifecycle event: ${event.eventType}`,
            `Disposition: ${event.disposition}`,
            event.disposalMethod   ? `Disposal: ${event.disposalMethod}` : null,
            event.disposalLocation ? `Location: ${event.disposalLocation}` : null,
            `Approved by: ${user.firstName} ${user.lastName}`,
            event.notes || null,
          ].filter(Boolean).join(' | '),
        },
        select: { id: true },
      });
      txOps.push(mortalityRecordOp);
    }

    // 3. StoreReceipt (TRANSFERRED_TO_STORE)
    let storeReceiptOp = null;
    if (toStore && event.storeId && liveBirdsItemId) {
      const unitCost  = Number(event.estimatedValuePerBird ?? 0);
      const totalCost = unitCost * event.birdCount;
      storeReceiptOp = prisma.storeReceipt.create({
        data: {
          storeId:          event.storeId,
          receivedById:     user.sub,
          receiptDate:      now,
          inventoryItemId:  liveBirdsItemId,
          flockId:          event.flockId,
          fromSectionId:    event.penSectionId,
          quantityReceived: event.birdCount,
          unitCost,
          currency:         event.currency,
          totalCost,
          referenceNumber:  `${event.eventType}-${event.flock.batchCode}-${now.toISOString().slice(0,10)}`,
          notes: [
            `${event.eventType === 'CULL' ? 'Partial cull' : 'Full depletion'} — ${event.flock.batchCode}`,
            `Approved by: ${user.firstName} ${user.lastName}`,
            event.notes || null,
          ].filter(Boolean).join(' | '),
          qualityStatus: 'PENDING',
        },
        select: { id: true, quantityReceived: true },
      });
      txOps.push(storeReceiptOp);
    }

    // 4. Pen section deactivation + cleaning task (DEPLETE only)
    let cleaningTaskOp = null;
    if (isDepleted) {
      txOps.push(
        prisma.penSection.update({
          where: { id: event.penSectionId },
          data:  { isActive: false },
          select: { id: true, name: true },
        })
      );
      cleaningTaskOp = prisma.task.create({
        data: {
          tenantId:     user.tenantId,
          penSectionId: event.penSectionId,
          assignedToId: cleaningAssigneeId,
          createdById:  user.sub,
          taskType:     'CLEANING',
          title:        `Post-depletion cleaning — ${event.penSection.name}`,
          description: [
            `Flock ${event.flock.batchCode} depleted (${event.disposition}).`,
            'Clean, disinfect, and prepare section before next batch.',
            event.notes ? `Notes: ${event.notes}` : null,
          ].filter(Boolean).join(' '),
          dueDate:     now,
          priority:    'HIGH',
          status:      'PENDING',
          isRecurring: false,
        },
        select: { id: true, title: true },
      });
      txOps.push(cleaningTaskOp);
    }

    // ── Execute transaction ───────────────────────────────────────────────────
    const results = await prisma.$transaction(txOps);

    // Map results back by position
    let txIdx = 0;
    const updatedFlock    = results[txIdx++];
    const mortalityRecord = mortalityRecordOp ? results[txIdx++] : null;
    const storeReceipt    = storeReceiptOp    ? results[txIdx++] : null;
    const updatedSection  = isDepleted        ? results[txIdx++] : null;
    const cleaningTask    = cleaningTaskOp    ? results[txIdx++] : null;

    // ── Update the FlockLifecycleEvent with output record IDs ─────────────────
    const updatedEvent = await prisma.flockLifecycleEvent.update({
      where: { id: params.id },
      data: {
        status:             'APPROVED',
        reviewedById:       user.sub,
        reviewedAt:         now,
        mortalityRecordId:  mortalityRecord?.id ?? null,
        storeReceiptId:     storeReceipt?.id    ?? null,
        cleaningTaskId:     cleaningTask?.id    ?? null,
      },
      select: {
        id: true, status: true, eventType: true, disposition: true,
        birdCount: true, mortalityRecordId: true,
        storeReceiptId: true, cleaningTaskId: true,
      },
    });

    // ── Notifications ─────────────────────────────────────────────────────────
    await notifySubmitter(event, 'APPROVED', user, null).catch(() => {});
    if (storeReceipt && event.storeId) {
      await notifyStoreManagers(event, user, storeReceipt.id).catch(() => {});
    }

    await auditLog(user, params.id, 'APPROVE', event).catch(() => {});

    return NextResponse.json({
      message: `${event.eventType} approved — ${event.birdCount} birds from ${event.flock.batchCode}`,
      event:   updatedEvent,
      flock:   updatedFlock,
      ...(mortalityRecord && { mortalityRecord }),
      ...(storeReceipt    && { storeReceipt, nextStep: 'Store Manager must acknowledge receipt and verify bird count.' }),
      ...(updatedSection  && { section: updatedSection }),
      ...(cleaningTask    && { cleaningTask }),
    });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/flock-events/[id]/review]', err);
    return NextResponse.json({ error: 'Review action failed', detail: err?.message }, { status: 500 });
  }
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function notifySubmitter(event, decision, reviewer, rejectionReason) {
  const isApproved = decision === 'APPROVED';
  const typeLabel  = event.eventType === 'CULL' ? 'Partial Cull' : 'Full Depletion';
  await prisma.notification.create({
    data: {
      tenantId:    event.tenantId,
      recipientId: event.submittedById,
      type:        isApproved ? 'REPORT_APPROVED' : 'REPORT_REJECTED',
      title:       isApproved
        ? `✅ ${typeLabel} Approved — ${event.flock?.batchCode}`
        : `❌ ${typeLabel} Rejected — ${event.flock?.batchCode}`,
      message: isApproved
        ? `Your ${typeLabel.toLowerCase()} request for ${event.birdCount.toLocaleString()} birds has been approved by ${reviewer.firstName} ${reviewer.lastName}. Effects have been applied.`
        : `Your ${typeLabel.toLowerCase()} request was rejected by ${reviewer.firstName} ${reviewer.lastName}. Reason: ${rejectionReason}`,
      data: { eventId: event.id, flockId: event.flockId },
      channel: 'IN_APP',
    },
  });
}

async function notifyStoreManagers(event, approver, storeReceiptId) {
  const storeManagers = await prisma.user.findMany({
    where: { tenantId: event.tenantId, role: 'STORE_MANAGER', isActive: true },
    select: { id: true },
  });
  if (!storeManagers.length) return;
  const typeLabel = event.eventType === 'CULL' ? 'Cull' : 'Depletion';
  await prisma.notification.createMany({
    data: storeManagers.map(sm => ({
      tenantId:    event.tenantId,
      recipientId: sm.id,
      type:        'REPORT_SUBMITTED',
      title:       `🐔 ${event.birdCount.toLocaleString()} Live Birds Incoming — ${event.flock?.batchCode}`,
      message:     `${typeLabel} approved by ${approver.firstName} ${approver.lastName}. ${event.birdCount.toLocaleString()} birds from ${event.flock?.batchCode} are being transferred to store. Please acknowledge receipt and verify the count.`,
      data: {
        eventId:       event.id,
        storeReceiptId,
        flockId:       event.flockId,
        birdCount:     event.birdCount,
        actionUrl:     '/store',
      },
      channel: 'IN_APP',
    })),
  });
}

async function auditLog(user, eventId, action, event) {
  await prisma.auditLog.create({
    data: {
      tenantId:   user.tenantId,
      userId:     user.sub,
      action:     'APPROVE',
      entityType: 'FlockLifecycleEvent',
      entityId:   eventId,
      changes: {
        reviewAction: action,
        eventType:    event.eventType,
        disposition:  event.disposition,
        birdCount:    event.birdCount,
        flockId:      event.flockId,
      },
    },
  });
}
