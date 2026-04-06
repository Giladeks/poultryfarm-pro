// app/api/rearing/transfers/[transferId]/receive/route.js
// POST — Receiving PM confirms bird count on arrival.
//
// Two-path discrepancy handling:
//
// Path 1 — Minor discrepancy (≤1%):
//   Transfer completes immediately. Both PMs notified. FM gets a review task.
//   Flock moves to destination. transit_mortality recorded.
//
// Path 2 — Major discrepancy (>1%):
//   Transfer enters DISCREPANCY_REVIEW status. Flock does NOT move yet.
//   Farm Manager gets urgent notification with approve/override action.
//   24hr review deadline set — escalates to Farm Admin if no action.
//
// POST /api/rearing/transfers/[transferId]/dispute — separate dispute flow (unchanged)

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const DISCREPANCY_THRESHOLD_PCT = 1.0; // >1% triggers Path 2

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { action } = body; // 'confirm' | 'dispute'

  if (action === 'dispute') return handleDispute(params.transferId, body, user);
  return handleConfirm(params.transferId, body, user);
}

// ── Confirm receipt ───────────────────────────────────────────────────────────
async function handleConfirm(transferId, body, user) {
  const { birdsReceived, transitMortality = 0, receivingNotes } = body;

  if (birdsReceived == null || birdsReceived < 0)
    return NextResponse.json({ error: 'birdsReceived is required' }, { status: 400 });

  try {
    const transfer = await prisma.flock_transfers.findFirst({
      where: { id: transferId, tenantId: user.tenantId },
      include: {
        flocks: {
          select: { id: true, batchCode: true, penSectionId: true,
                    originalPenSectionId: true, stage: true, currentCount: true },
        },
        pen_sections_flock_transfers_fromPenSectionIdTopen_sections: {
          select: { id: true, name: true,
            workerAssignments: {
              where: { isActive: true },
              include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
            },
            pen: { select: { name: true } },
          },
        },
        pen_sections_flock_transfers_toPenSectionIdTopen_sections: {
          select: { id: true, name: true,
            workerAssignments: {
              where: { isActive: true },
              include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
            },
            pen: { select: { name: true } },
          },
        },
      },
    });

    if (!transfer)
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    if (!['PENDING', 'DISCREPANCY_REVIEW'].includes(transfer.status))
      return NextResponse.json({ error: `Transfer is already ${transfer.status}` }, { status: 409 });

    const flock     = transfer.flocks;
    const sourceSec = transfer.pen_sections_flock_transfers_fromPenSectionIdTopen_sections;
    const destSec   = transfer.pen_sections_flock_transfers_toPenSectionIdTopen_sections;
    const destName  = `${destSec?.pen?.name} · ${destSec?.name}`;
    const srcName   = `${sourceSec?.pen?.name} · ${sourceSec?.name}`;

    const birdsSent       = transfer.birds_sent || transfer.survivingCount;
    const discrepancy     = birdsSent - birdsReceived - transitMortality;
    const discrepancyPct  = birdsSent > 0
      ? parseFloat(Math.abs((discrepancy / birdsSent) * 100).toFixed(2)) : 0;
    const isMinor = discrepancyPct <= DISCREPANCY_THRESHOLD_PCT;

    // ── Fetch Farm Managers for notifications ─────────────────────────────────
    const farmMgrs = await prisma.user.findMany({
      where: { tenantId: user.tenantId, role: { in: ['FARM_MANAGER', 'FARM_ADMIN'] }, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
    });
    const farmMgrIds  = farmMgrs.filter(u => u.role === 'FARM_MANAGER').map(u => u.id);
    const farmAdmIds  = farmMgrs.filter(u => u.role === 'FARM_ADMIN').map(u => u.id);

    const sendingPMs = (sourceSec?.workerAssignments ?? [])
      .filter(a => ['PEN_MANAGER'].includes(a.user.role))
      .map(a => a.user.id);

    // ── PATH 1: Minor discrepancy (≤1%) or no discrepancy ─────────────────────
    if (discrepancyPct === 0 || isMinor) {
      // Complete the transfer — flock moves now
      await prisma.$transaction(async (tx) => {
        // Update transfer record
        await tx.flock_transfers.update({
          where: { id: transferId },
          data: {
            status:            'COMPLETED',
            birds_received:    birdsReceived,
            transit_mortality: transitMortality,
            received_by_id:    user.sub,
            received_at:       new Date(),
            receiving_notes:   receivingNotes || null,
            discrepancy_pct:   discrepancyPct,
          },
        });

        // Move flock to destination
        await tx.flock.update({
          where: { id: flock.id },
          data: {
            penSectionId:  transfer.toPenSectionId,
            currentCount:  birdsReceived,
          },
        });
      });

      // Notifications
      const notifBody = [];

      // Notify sending PM if there was any discrepancy
      if (discrepancyPct > 0) {
        for (const pmId of sendingPMs) {
          notifBody.push({
            tenantId:    user.tenantId,
            recipientId: pmId,
            type:        'ALERT',
            title:       `⚠ Minor discrepancy on ${flock.batchCode} transfer`,
            message:     `Transfer confirmed with a ${discrepancyPct}% discrepancy. ` +
                         `Sent: ${birdsSent}, Received: ${birdsReceived}, ` +
                         `Transit mortality: ${transitMortality}. ` +
                         `${discrepancy} birds unaccounted. Transfer completed.`,
            data:        { transferId, flockId: flock.id },
          });
        }

        // Auto-generate review task for Farm Manager
        for (const mgr of farmMgrs.filter(u => u.role === 'FARM_MANAGER')) {
          await prisma.task.create({
            data: {
              tenantId:     user.tenantId,
              penSectionId: transfer.toPenSectionId,  // destination section
              assignedToId: mgr.id,
              createdById:  user.sub,
              taskType:     'INSPECTION',
              title:        `Review transit discrepancy — ${flock.batchCode}`,
              description:  `Transfer from ${srcName} to ${destName} completed with a ` +
                            `${discrepancyPct}% discrepancy. ` +
                            `Sent: ${birdsSent} | Received: ${birdsReceived} | ` +
                            `Transit mortality: ${transitMortality} | Unaccounted: ${discrepancy} birds. ` +
                            `Please review and document findings.`,
              dueDate:      new Date(Date.now() + 48 * 60 * 60 * 1000), // 48hr to review
              priority:     'HIGH',
              status:       'PENDING',
            },
          }).catch(e => console.error('[Transfer] task create error:', e?.message));
        }
      }

      // Notify receiving PM (acknowledgement)
      notifBody.push({
        tenantId:    user.tenantId,
        recipientId: user.sub,
        type:        'ALERT',
        title:       `✅ Transfer confirmed — ${flock.batchCode}`,
        message:     `${birdsReceived.toLocaleString()} birds received at ${destName}.` +
                     (discrepancyPct > 0 ? ` Minor discrepancy of ${discrepancyPct}% noted.` : ''),
        data:        { transferId, flockId: flock.id, toPenSectionId: transfer.toPenSectionId },
      });

      if (notifBody.length > 0) {
        await prisma.notification.createMany({ data: notifBody });
      }

      const totalDestWorkers = (destSec?.workerAssignments ?? []).length;
      return NextResponse.json({
        status:           'COMPLETED',
        discrepancyPct,
        discrepancyPath:  discrepancyPct > 0 ? 1 : 0,
        workersAssigned:  0,
        noWorkerAlert:    totalDestWorkers === 0,
        message: discrepancyPct === 0
          ? `Transfer confirmed. ${birdsReceived.toLocaleString()} birds received at ${destName}.`
          : `Transfer confirmed with minor discrepancy (${discrepancyPct}%). ` +
            `${discrepancy} birds unaccounted. Farm Manager notified.`,
      });
    }

    // ── PATH 2: Major discrepancy (>1%) — requires FM sign-off ───────────────
    const reviewDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hr

    await prisma.flock_transfers.update({
      where: { id: transferId },
      data: {
        status:            'DISCREPANCY_REVIEW',
        birds_received:    birdsReceived,
        transit_mortality: transitMortality,
        received_by_id:    user.sub,
        received_at:       new Date(),
        receiving_notes:   receivingNotes || null,
        discrepancy_pct:   discrepancyPct,
        review_deadline:   reviewDeadline,
      },
    });

    // Flock does NOT move — stays in source section

    // Notify Farm Managers (urgent — action required)
    const urgentNotifs = farmMgrIds.map(mgId => ({
      tenantId:    user.tenantId,
      recipientId: mgId,
      type:        'ALERT',
      title:       `🚨 Transfer discrepancy requires your review — ${flock.batchCode}`,
      message:     `${discrepancyPct}% discrepancy detected on transfer from ${srcName} to ${destName}. ` +
                   `Sent: ${birdsSent} | Received: ${birdsReceived} | ` +
                   `${discrepancy} birds unaccounted (${discrepancyPct}%). ` +
                   `Transfer is on hold. Your approval is required within 24 hours.`,
      data:        { transferId, flockId: flock.id, action: 'REVIEW_DISCREPANCY',
                     reviewDeadline: reviewDeadline.toISOString() },
    }));

    // Notify sending PM
    const sendingNotifs = sendingPMs.map(pmId => ({
      tenantId:    user.tenantId,
      recipientId: pmId,
      type:        'ALERT',
      title:       `⚠ Transfer on hold — discrepancy detected (${flock.batchCode})`,
      message:     `${discrepancyPct}% discrepancy detected. ` +
                   `Sent: ${birdsSent} | Received: ${birdsReceived} | ` +
                   `${discrepancy} birds unaccounted. ` +
                   `Transfer is on hold pending Farm Manager review (24hr deadline).`,
      data:        { transferId, flockId: flock.id },
    }));

    // Notify receiving PM
    const receivingNotif = {
      tenantId:    user.tenantId,
      recipientId: user.sub,
      type:        'ALERT',
      title:       `⚠ Transfer on hold — awaiting FM review (${flock.batchCode})`,
      message:     `Your count (${birdsReceived}) differs from dispatch (${birdsSent}) by ${discrepancyPct}%. ` +
                   `Transfer is on hold. Farm Manager has been notified.`,
      data:        { transferId, flockId: flock.id },
    };

    await prisma.notification.createMany({
      data: [...urgentNotifs, ...sendingNotifs, receivingNotif],
    });

    return NextResponse.json({
      status:          'DISCREPANCY_REVIEW',
      discrepancyPct,
      discrepancyPath: 2,
      discrepancy,
      reviewDeadline:  reviewDeadline.toISOString(),
      message: `Major discrepancy detected (${discrepancyPct}%). Transfer is on hold. ` +
               `Farm Manager has been notified and must approve within 24 hours.`,
    });

  } catch (err) {
    console.error('POST /api/rearing/transfers receive error:', err);
    return NextResponse.json({ error: 'Failed to process receipt', detail: err?.message }, { status: 500 });
  }
}

// ── Dispute ───────────────────────────────────────────────────────────────────
async function handleDispute(transferId, body, user) {
  const { disputeReason } = body;
  if (!disputeReason || disputeReason.length < 10)
    return NextResponse.json({ error: 'Dispute reason must be at least 10 characters' }, { status: 400 });

  try {
    const transfer = await prisma.flock_transfers.findFirst({
      where: { id: transferId, tenantId: user.tenantId },
      include: {
        flocks: { select: { id: true, batchCode: true } },
        pen_sections_flock_transfers_fromPenSectionIdTopen_sections: {
          select: {
            name: true,
            pen: { select: { name: true } },
            workerAssignments: {
              where: { isActive: true },
              include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
            },
          },
        },
        pen_sections_flock_transfers_toPenSectionIdTopen_sections: {
          select: { name: true, pen: { select: { name: true } } },
        },
      },
    });

    if (!transfer)
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    if (transfer.status !== 'PENDING')
      return NextResponse.json({ error: `Cannot dispute a ${transfer.status} transfer` }, { status: 409 });

    const disputeDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24hr FM action window

    await prisma.flock_transfers.update({
      where: { id: transferId },
      data: {
        status:           'DISPUTED',
        dispute_reason:   disputeReason,
        received_by_id:   user.sub,
        received_at:      new Date(),
        dispute_deadline: disputeDeadline,
      },
    });

    const sourceSec  = transfer.pen_sections_flock_transfers_fromPenSectionIdTopen_sections;
    const destSec    = transfer.pen_sections_flock_transfers_toPenSectionIdTopen_sections;
    const srcName    = `${sourceSec?.pen?.name} · ${sourceSec?.name}`;
    const dstName    = `${destSec?.pen?.name} · ${destSec?.name}`;
    const batchCode  = transfer.flocks?.batchCode;
    const birdsSent  = transfer.birds_sent || transfer.survivingCount;

    const sendingPMs = (sourceSec?.workerAssignments ?? [])
      .filter(a => a.user.role === 'PEN_MANAGER').map(a => a.user.id);

    const farmMgrs = await prisma.user.findMany({
      where:  { tenantId: user.tenantId, role: { in: ['FARM_MANAGER', 'FARM_ADMIN'] }, isActive: true },
      select: { id: true, role: true },
    });
    const farmMgrIds = farmMgrs.filter(u => u.role === 'FARM_MANAGER').map(u => u.id);

    // FM gets urgent notification with action required
    const fmNotifs = farmMgrIds.map(id => ({
      tenantId:    user.tenantId,
      recipientId: id,
      type:        'ALERT',
      title:       `🚫 Transfer disputed — ${batchCode} (action required)`,
      message:     `Receiving PM disputed transfer of ${birdsSent?.toLocaleString()} birds ` +
                   `from ${srcName} to ${dstName}. ` +
                   `Reason: "${disputeReason}". ` +
                   `You must cancel or force-complete this transfer within 24 hours.`,
      data:        { transferId, flockId: transfer.flocks?.id,
                     action: 'RESOLVE_DISPUTE',
                     deadline: disputeDeadline.toISOString() },
    }));

    // Sending PM notified of the dispute
    const pmNotifs = sendingPMs.map(id => ({
      tenantId:    user.tenantId,
      recipientId: id,
      type:        'ALERT',
      title:       `🚫 Your transfer was disputed — ${batchCode}`,
      message:     `The receiving PM at ${dstName} has disputed your transfer. ` +
                   `Reason: "${disputeReason}". ` +
                   `Birds remain at ${srcName}. Farm Manager has been notified to resolve.`,
      data:        { transferId, flockId: transfer.flocks?.id },
    }));

    // Receiving PM acknowledgement
    const receivingNotif = {
      tenantId:    user.tenantId,
      recipientId: user.sub,
      type:        'ALERT',
      title:       `✓ Dispute submitted — ${batchCode}`,
      message:     `Your dispute has been logged. Farm Manager has been notified and must ` +
                   `act within 24 hours. Birds remain at source (${srcName}).`,
      data:        { transferId, flockId: transfer.flocks?.id },
    };

    await prisma.notification.createMany({
      data: [...fmNotifs, ...pmNotifs, receivingNotif],
    });

    return NextResponse.json({
      status:          'DISPUTED',
      disputeDeadline: disputeDeadline.toISOString(),
      message:         'Transfer disputed. Farm Manager notified and must resolve within 24 hours. Birds remain at source.',
    });
  } catch (err) {
    console.error('Dispute error:', err);
    return NextResponse.json({ error: 'Failed to dispute transfer', detail: err?.message }, { status: 500 });
  }
}
