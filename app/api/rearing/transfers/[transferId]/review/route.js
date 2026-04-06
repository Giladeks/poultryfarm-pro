// app/api/rearing/transfers/[transferId]/review/route.js
// POST — Farm Manager approves or overrides a DISCREPANCY_REVIEW transfer.
//
// Body: { action: 'APPROVE' | 'OVERRIDE', reviewNotes?: string, overrideCount?: number }
//
// APPROVE  — accepts birds_received as the official count, completes transfer
// OVERRIDE — Farm Manager sets a manual count (overrideCount), completes transfer

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const FM_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Farm Managers can review discrepancies' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { action, reviewNotes, overrideCount } = body;

  if (!['APPROVE', 'OVERRIDE'].includes(action))
    return NextResponse.json({ error: 'action must be APPROVE or OVERRIDE' }, { status: 400 });
  if (action === 'OVERRIDE' && (!overrideCount || overrideCount < 0))
    return NextResponse.json({ error: 'overrideCount is required for OVERRIDE action' }, { status: 400 });

  try {
    const transfer = await prisma.flock_transfers.findFirst({
      where: { id: params.transferId, tenantId: user.tenantId },
      include: {
        flocks: { select: { id: true, batchCode: true, penSectionId: true } },
        pen_sections_flock_transfers_fromPenSectionIdTopen_sections: {
          select: { name: true, pen: { select: { name: true } },
            workerAssignments: {
              where: { isActive: true },
              include: { user: { select: { id: true, role: true } } },
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
    if (transfer.status !== 'DISCREPANCY_REVIEW')
      return NextResponse.json({
        error: `Transfer is ${transfer.status} — only DISCREPANCY_REVIEW transfers can be reviewed`,
      }, { status: 409 });

    const flock      = transfer.flocks;
    const destSec    = transfer.pen_sections_flock_transfers_toPenSectionIdTopen_sections;
    const sourceSec  = transfer.pen_sections_flock_transfers_fromPenSectionIdTopen_sections;
    const destName   = `${destSec?.pen?.name} · ${destSec?.name}`;
    const finalCount = action === 'OVERRIDE' ? overrideCount : transfer.birds_received;

    // Complete the transfer
    await prisma.$transaction(async (tx) => {
      await tx.flock_transfers.update({
        where: { id: params.transferId },
        data: {
          status:       'COMPLETED',
          reviewed_by_id: user.sub,
          reviewed_at:  new Date(),
          review_action: action,
          review_notes: reviewNotes || null,
          // If overriding, update birds_received to the FM's count
          ...(action === 'OVERRIDE' && { birds_received: overrideCount }),
        },
      });

      // Move flock to destination with final count
      await tx.flock.update({
        where: { id: flock.id },
        data: {
          penSectionId: transfer.toPenSectionId,
          currentCount: finalCount,
        },
      });
    });

    // Notify both PMs
    const sendingPMs = (sourceSec?.workerAssignments ?? [])
      .filter(a => a.user.role === 'PEN_MANAGER').map(a => a.user.id);

    const actionLabel  = action === 'APPROVE' ? 'approved' : 'overridden';
    const countMessage = action === 'OVERRIDE'
      ? `Official count set to ${overrideCount.toLocaleString()} by Farm Manager.`
      : `Received count of ${finalCount.toLocaleString()} accepted.`;

    const notifIds = new Set([...sendingPMs, transfer.received_by_id].filter(Boolean));
    await prisma.notification.createMany({
      data: [...notifIds].map(id => ({
        tenantId:    user.tenantId,
        recipientId: id,
        type:        'ALERT',
        title:       `✅ Discrepancy ${actionLabel} — ${flock.batchCode} transfer complete`,
        message:     `Farm Manager has ${actionLabel} the discrepancy review. ` +
                     `${countMessage} Flock has moved to ${destName}.` +
                     (reviewNotes ? ` Notes: ${reviewNotes}` : ''),
        data:        { transferId: params.transferId, flockId: flock.id,
                       toPenSectionId: transfer.toPenSectionId },
      })),
    });

    return NextResponse.json({
      status:      'COMPLETED',
      action,
      finalCount,
      message: `Transfer ${actionLabel}. ${flock.batchCode} moved to ${destName} with ${finalCount.toLocaleString()} birds.`,
    });

  } catch (err) {
    console.error('POST transfer review error:', err);
    return NextResponse.json({ error: 'Failed to process review', detail: err?.message }, { status: 500 });
  }
}
