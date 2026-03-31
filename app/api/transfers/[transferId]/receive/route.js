// app/api/rearing/transfers/[transferId]/receive/route.js
// POST — Receiving PM confirms bird receipt.
//        Flock location updates here. Workers auto-assigned. PM alerted if no workers.
// POST with { action: 'dispute', disputeReason } — raises a dispute instead.
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN',
];

const confirmSchema = z.object({
  action:           z.literal('confirm'),
  birdsReceived:    z.number().int().min(0),
  transitMortality: z.number().int().min(0).default(0),
  receivingNotes:   z.string().max(1000).optional().nullable(),
});

const disputeSchema = z.object({
  action:        z.literal('dispute'),
  disputeReason: z.string().min(10).max(1000),
});

const schema = z.discriminatedUnion('action', [confirmSchema, disputeSchema]);

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.errors }, { status: 422 });

    const data = parsed.data;

    // ── Fetch the pending transfer ────────────────────────────────────────────
    const transfer = await prisma.flock_transfers.findFirst({
      where: { id: params.transferId, tenantId: user.tenantId },
      include: {
        flocks:            { select: { id: true, batchCode: true, currentCount: true, stage: true, penSectionId: true, originalPenSectionId: true } },
        fromPenSection:    { include: { pen: { select: { name: true } }, workerAssignments: { where: { isActive: true }, select: { userId: true, user: { select: { id: true, firstName: true, role: true } } } } } },
        toPenSection:      { include: { pen: { select: { name: true, penPurpose: true } }, workerAssignments: { where: { isActive: true }, select: { userId: true, user: { select: { id: true, firstName: true, role: true } } } } } },
      },
    });

    if (!transfer)
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    if (transfer.status !== 'PENDING')
      return NextResponse.json({ error: `Transfer is already ${transfer.status}` }, { status: 409 });

    const flock       = transfer.flocks;
    const sourceSec   = transfer.fromPenSection;
    const destSec     = transfer.toPenSection;
    const sourceName  = `${sourceSec?.pen?.name} · ${sourceSec?.name}`;
    const destName    = `${destSec?.pen?.name} · ${destSec?.name}`;

    // ── DISPUTE path ──────────────────────────────────────────────────────────
    if (data.action === 'dispute') {
      const updated = await prisma.flock_transfers.update({
        where: { id: transfer.id },
        data: {
          status:        'DISPUTED',
          receivedById:  user.sub,
          receivedAt:    new Date(),
          disputeReason: data.disputeReason,
        },
      });

      // Notify sending PM, Farm Manager, and the initiating user
      const sendingPMs = (sourceSec?.workerAssignments ?? [])
        .filter(a => ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN'].includes(a.user.role))
        .map(a => a.user.id);

      const farmMgrs = await prisma.user.findMany({
        where: { tenantId: user.tenantId, role: { in: ['FARM_MANAGER','FARM_ADMIN'] }, isActive: true },
        select: { id: true },
      });

      const notifyIds = new Set([...sendingPMs, ...farmMgrs.map(u => u.id), transfer.recordedById]);

      for (const recipientId of notifyIds) {
        await prisma.notification.create({
          data: {
            tenantId:    user.tenantId,
            recipientId,
            senderId:    user.sub,
            type:        'ALERT',
            title:       `⚠️ Transfer Disputed — ${flock.batchCode}`,
            message:     `The receiving PM for ${destName} has disputed the transfer of ${flock.batchCode}. ` +
              `Reason: ${data.disputeReason}. Please review and resolve.`,
            channel:     'IN_APP',
            data: { transferId: transfer.id, flockId: flock.id, action: 'RESOLVE_DISPUTE' },
          },
        }).catch(() => {});
      }

      return NextResponse.json({
        transfer: updated,
        status:   'DISPUTED',
        message:  'Transfer disputed. Sending PM and Farm Manager notified.',
      });
    }

    // ── CONFIRM path ──────────────────────────────────────────────────────────
    const { birdsReceived, transitMortality, receivingNotes } = data;
    const birdsSent = transfer.birdsSent || transfer.survivingCount;

    // Flag significant discrepancy (>2% difference) for the response — informational only
    const discrepancy    = birdsSent - birdsReceived - transitMortality;
    const discrepancyPct = birdsSent > 0
      ? parseFloat(Math.abs(((discrepancy) / birdsSent) * 100).toFixed(1)) : 0;
    const hasDiscrepancy = discrepancyPct > 2;

    // 1. Mark transfer COMPLETED
    const updatedTransfer = await prisma.flock_transfers.update({
      where: { id: transfer.id },
      data: {
        status:          'COMPLETED',
        birdsReceived,
        transitMortality,
        survivingCount:  birdsReceived,       // reconciled count
        receivedById:    user.sub,
        receivedAt:      new Date(),
        receivingNotes:  receivingNotes || null,
      },
    });

    // 2. Move the flock to the destination section, update count
    const updatedFlock = await prisma.flock.update({
      where: { id: flock.id },
      data: {
        penSectionId:         transfer.toPenSectionId,
        currentCount:         birdsReceived,
        originalPenSectionId: flock.originalPenSectionId || flock.penSectionId,
        stageUpdatedAt:       new Date(),
      },
    });

    // 3. Worker auto-assignment — PEN_WORKERs follow the birds
    const sourceWorkers = (sourceSec?.workerAssignments ?? [])
      .filter(a => a.user.role === 'PEN_WORKER');
    const destWorkerIds = new Set((destSec?.workerAssignments ?? []).map(a => a.userId));
    const toAssign      = sourceWorkers.filter(a => !destWorkerIds.has(a.userId));

    let workersAssigned = 0;
    for (const assignment of toAssign) {
      await prisma.penWorkerAssignment.upsert({
        where:  { userId_penSectionId: { userId: assignment.userId, penSectionId: transfer.toPenSectionId } },
        create: { userId: assignment.userId, penSectionId: transfer.toPenSectionId, isActive: true },
        update: { isActive: true },
      });
      await prisma.penWorkerAssignment.updateMany({
        where: { userId: assignment.userId, penSectionId: transfer.fromPenSectionId },
        data:  { isActive: false },
      });
      workersAssigned++;
    }

    // 4. Notify all workers now on destination + sending PM
    const allDestWorkers = [
      ...(destSec?.workerAssignments ?? []).map(a => a.user),
      ...toAssign.map(a => a.user),
    ];
    const notifTitle   = `✅ Transfer Confirmed — ${flock.batchCode}`;
    const notifMessage = `${birdsReceived.toLocaleString()} birds received at ${destName}. ` +
      (transitMortality > 0 ? `Transit mortality: ${transitMortality}. ` : '') +
      `Rearing continues — target Point-of-Lay is Week 18.`;

    for (const worker of allDestWorkers) {
      await prisma.notification.create({
        data: {
          tenantId: user.tenantId, recipientId: worker.id, senderId: user.sub,
          type: 'TASK_ASSIGNED', title: notifTitle, message: notifMessage, channel: 'IN_APP',
          data: { transferId: transfer.id, flockId: flock.id, toPenSectionId: transfer.toPenSectionId },
        },
      }).catch(() => {});
    }

    // Also notify the sending PM that their transfer was confirmed
    await prisma.notification.create({
      data: {
        tenantId: user.tenantId, recipientId: transfer.recordedById, senderId: user.sub,
        type: 'SYSTEM',
        title: `✅ Transfer Confirmed — ${flock.batchCode}`,
        message: `${birdsReceived.toLocaleString()} of ${birdsSent.toLocaleString()} birds confirmed received at ${destName}` +
          (transitMortality > 0 ? `. Transit mortality: ${transitMortality}.` : '.') +
          (hasDiscrepancy ? ` ⚠ Count discrepancy of ${discrepancyPct}% — please review.` : ''),
        channel: 'IN_APP',
        data: { transferId: transfer.id, flockId: flock.id },
      },
    }).catch(() => {});

    // 5. Alert if destination ends up with no workers
    const totalDestWorkers = destWorkerIds.size + workersAssigned;
    let noWorkerAlert = false;
    if (totalDestWorkers === 0) {
      noWorkerAlert = true;
      const destManagers = await prisma.penWorkerAssignment.findMany({
        where: { penSectionId: transfer.toPenSectionId, isActive: true, user: { role: 'PEN_MANAGER', isActive: true } },
        select: { userId: true },
      });
      const pmIds = new Set([...destManagers.map(m => m.userId), user.sub]);
      for (const pmId of pmIds) {
        await prisma.notification.create({
          data: {
            tenantId: user.tenantId, recipientId: pmId, senderId: user.sub,
            type: 'ALERT',
            title: `⚠️ No Worker Assigned — ${destSec?.pen?.name} · ${destSec?.name}`,
            message: `Flock ${flock.batchCode} has arrived at ${destName} but this section has no active pen workers. Please assign a worker.`,
            channel: 'IN_APP',
            data: { flockId: flock.id, penSectionId: transfer.toPenSectionId, action: 'ASSIGN_WORKER' },
          },
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      transfer:        updatedTransfer,
      flock:           updatedFlock,
      workersAssigned,
      noWorkerAlert,
      hasDiscrepancy,
      discrepancyPct,
      message: hasDiscrepancy
        ? `Transfer confirmed with discrepancy (${discrepancyPct}%). Sending PM notified.`
        : `Transfer confirmed. ${birdsReceived.toLocaleString()} birds now in ${destName}.`,
    });

  } catch (err) {
    console.error('POST /api/rearing/transfers/[transferId]/receive error:', err);
    return NextResponse.json({ error: 'Failed to process transfer receipt', detail: err?.message }, { status: 500 });
  }
}
