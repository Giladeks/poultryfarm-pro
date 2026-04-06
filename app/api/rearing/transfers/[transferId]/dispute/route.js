// app/api/rearing/transfers/[transferId]/dispute/route.js
// POST — Resolve a DISPUTED transfer.
//
// Actions:
//   CANCEL         — FM or sending PM cancels. Transfer voided, flock stays at source.
//   FORCE_COMPLETE — FM overrides dispute and completes the transfer (with optional count override).
//   WITHDRAW       — Sending PM withdraws their own transfer (must be done before FM acts).
//
// Role gates:
//   CANCEL:         FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
//   FORCE_COMPLETE: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
//   WITHDRAW:       PEN_MANAGER (sending PM only)

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const FM_ROLES     = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const VALID_ACTIONS = ['CANCEL', 'FORCE_COMPLETE', 'WITHDRAW'];

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { action, resolveNotes, overrideCount } = body;

  if (!VALID_ACTIONS.includes(action))
    return NextResponse.json({
      error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
    }, { status: 400 });

  // Role gate
  if (action === 'FORCE_COMPLETE' && !FM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Farm Managers can force-complete a disputed transfer' }, { status: 403 });
  if (action === 'CANCEL' && !FM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Farm Managers can cancel a disputed transfer' }, { status: 403 });

  try {
    const transfer = await prisma.flock_transfers.findFirst({
      where: { id: params.transferId, tenantId: user.tenantId },
      include: {
        flocks: {
          select: { id: true, batchCode: true, penSectionId: true, currentCount: true },
        },
        pen_sections_flock_transfers_fromPenSectionIdTopen_sections: {
          select: {
            id: true, name: true,
            pen: { select: { name: true } },
            workerAssignments: {
              where: { isActive: true },
              include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
            },
          },
        },
        pen_sections_flock_transfers_toPenSectionIdTopen_sections: {
          select: { id: true, name: true, pen: { select: { name: true } } },
        },
      },
    });

    if (!transfer)
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    if (transfer.status !== 'DISPUTED')
      return NextResponse.json({
        error: `Transfer is ${transfer.status} — only DISPUTED transfers can be resolved here`,
      }, { status: 409 });

    const flock     = transfer.flocks;
    const sourceSec = transfer.pen_sections_flock_transfers_fromPenSectionIdTopen_sections;
    const destSec   = transfer.pen_sections_flock_transfers_toPenSectionIdTopen_sections;
    const srcName   = `${sourceSec?.pen?.name} · ${sourceSec?.name}`;
    const dstName   = `${destSec?.pen?.name} · ${destSec?.name}`;
    const birdsSent = transfer.birds_sent || transfer.survivingCount;

    const sendingPMs = (sourceSec?.workerAssignments ?? [])
      .filter(a => a.user.role === 'PEN_MANAGER').map(a => a.user);

    // Check if WITHDRAW is by the sending PM
    if (action === 'WITHDRAW') {
      const isSendingPM = sendingPMs.some(pm => pm.id === user.sub);
      if (!isSendingPM && !FM_ROLES.includes(user.role))
        return NextResponse.json({
          error: 'Only the sending Pen Manager can withdraw this transfer',
        }, { status: 403 });
    }

    const resolvedAt = new Date();
    let   responseMessage = '';

    if (action === 'CANCEL' || action === 'WITHDRAW') {
      // ── Cancel / Withdraw — transfer voided, flock stays at source ────────────
      await prisma.flock_transfers.update({
        where: { id: params.transferId },
        data: {
          status:               'CANCELLED',
          dispute_resolved_by:  user.sub,
          dispute_resolved_at:  resolvedAt,
          dispute_resolution:   action,
          dispute_notes:        resolveNotes || null,
        },
      });

      responseMessage = action === 'WITHDRAW'
        ? `Transfer withdrawn by sending PM. ${flock.batchCode} remains at ${srcName}.`
        : `Transfer cancelled by Farm Manager. ${flock.batchCode} remains at ${srcName}.`;

      // Notify all parties
      const notifyParties = [
        ...sendingPMs.map(pm => pm.id),
        transfer.received_by_id,
        user.sub,
      ].filter(Boolean);

      const farmMgrs = await prisma.user.findMany({
        where:  { tenantId: user.tenantId, role: { in: FM_ROLES }, isActive: true },
        select: { id: true },
      });
      const allNotify = [...new Set([...notifyParties, ...farmMgrs.map(u => u.id)])];

      await prisma.notification.createMany({
        data: allNotify.map(id => ({
          tenantId:    user.tenantId,
          recipientId: id,
          type:        'ALERT',
          title:       `❌ Transfer ${action === 'WITHDRAW' ? 'withdrawn' : 'cancelled'} — ${flock.batchCode}`,
          message:     action === 'WITHDRAW'
            ? `The sending PM has withdrawn the transfer of ${birdsSent?.toLocaleString()} birds. ` +
              `${flock.batchCode} remains at ${srcName}.` +
              (resolveNotes ? ` Notes: ${resolveNotes}` : '')
            : `Farm Manager has cancelled this transfer. ` +
              `${flock.batchCode} remains at ${srcName}. ` +
              (resolveNotes ? `Resolution notes: ${resolveNotes}` : ''),
          data: { transferId: params.transferId, flockId: flock.id },
        })),
      });

    } else if (action === 'FORCE_COMPLETE') {
      // ── Force Complete — FM overrides dispute, transfer completes ─────────────
      const finalCount = overrideCount ?? birdsSent;

      if (finalCount == null || finalCount < 0)
        return NextResponse.json({ error: 'finalCount is required for FORCE_COMPLETE' }, { status: 400 });

      await prisma.$transaction(async (tx) => {
        await tx.flock_transfers.update({
          where: { id: params.transferId },
          data: {
            status:               'COMPLETED',
            birds_received:       finalCount,
            dispute_resolved_by:  user.sub,
            dispute_resolved_at:  resolvedAt,
            dispute_resolution:   'FORCE_COMPLETED',
            dispute_notes:        resolveNotes || null,
          },
        });

        // Move flock to destination
        await tx.flock.update({
          where: { id: flock.id },
          data: {
            penSectionId: transfer.toPenSectionId,
            currentCount: finalCount,
          },
        });
      });

      responseMessage = `Transfer force-completed by Farm Manager. ` +
        `${flock.batchCode} moved to ${dstName} with ${finalCount.toLocaleString()} birds.`;

      // Notify all parties
      const notifyParties = [
        ...sendingPMs.map(pm => pm.id),
        transfer.received_by_id,
      ].filter(Boolean);
      const allNotify = [...new Set(notifyParties)];

      await prisma.notification.createMany({
        data: allNotify.map(id => ({
          tenantId:    user.tenantId,
          recipientId: id,
          type:        'ALERT',
          title:       `✅ Disputed transfer force-completed — ${flock.batchCode}`,
          message:     `Farm Manager has overridden the dispute and completed the transfer. ` +
                       `${finalCount.toLocaleString()} birds officially moved to ${dstName}.` +
                       (resolveNotes ? ` FM notes: ${resolveNotes}` : ''),
          data:        { transferId: params.transferId, flockId: flock.id,
                         toPenSectionId: transfer.toPenSectionId },
        })),
      });
    }

    return NextResponse.json({
      status:  action === 'FORCE_COMPLETE' ? 'COMPLETED' : 'CANCELLED',
      action,
      message: responseMessage,
    });

  } catch (err) {
    console.error('POST transfer dispute resolve error:', err);
    return NextResponse.json({ error: 'Failed to resolve dispute', detail: err?.message }, { status: 500 });
  }
}
