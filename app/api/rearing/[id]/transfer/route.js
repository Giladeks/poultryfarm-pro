// app/api/rearing/[id]/transfer/route.js
// POST — Sending PM initiates a transfer (status: PENDING).
//        Flock location does NOT change yet.
// Prisma relation names (from db pull):
//   workerAssignments on penSection → penWorkerAssignment (standard)
//   pen relation on penSection      → pen (standard)
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN',
];

const schema = z.object({
  toPenSectionId:       z.string().min(1),
  transferDate:         z.string().min(1),
  birdsSent:            z.number().int().min(1),
  avgWeightAtTransferG: z.number().min(0).optional().nullable(),
  culledAtTransfer:     z.number().int().min(0).default(0),
  notes:                z.string().max(1000).optional().nullable(),
});

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

    // ── Validate flock ────────────────────────────────────────────────────────
    const flock = await prisma.flock.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        penSection: {
          include: {
            pen: { select: { name: true } },
            workerAssignments: {
              where:   { isActive: true },
              include: { user: { select: { id: true, firstName: true, role: true } } },
            },
          },
        },
      },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
    if (flock.operationType !== 'LAYER')
      return NextResponse.json({ error: 'Only layer flocks can be pen-transferred during rearing' }, { status: 409 });
    if (flock.stage !== 'REARING')
      return NextResponse.json({ error: `Flock must be in REARING stage (current: ${flock.stage})` }, { status: 409 });
    if (flock.penSectionId === data.toPenSectionId)
      return NextResponse.json({ error: 'Destination is the same as the current section' }, { status: 409 });

    // Block if already a PENDING transfer for this flock
    const existing = await prisma.flock_transfers.findFirst({
      where: { flockId: flock.id, status: 'PENDING' },
    });
    if (existing)
      return NextResponse.json({
        error: 'This flock already has a pending transfer awaiting confirmation.',
        transferId: existing.id,
      }, { status: 409 });

    // ── Validate destination section ──────────────────────────────────────────
    const destSection = await prisma.penSection.findFirst({
      where: { id: data.toPenSectionId, pen: { farm: { tenantId: user.tenantId } } },
      include: {
        pen: { select: { name: true, penPurpose: true } },
        workerAssignments: {
          where:   { isActive: true },
          include: { user: { select: { id: true, firstName: true, role: true } } },
        },
      },
    });
    if (!destSection)
      return NextResponse.json({ error: 'Destination section not found' }, { status: 404 });

    const [yr, mo, dy]    = data.transferDate.split('-').map(Number);
    const transferDateUTC = new Date(Date.UTC(yr, mo - 1, dy));

    // ── Create PENDING transfer ───────────────────────────────────────────────
    const transfer = await prisma.flock_transfers.create({
      data: {
        tenantId:             user.tenantId,
        flockId:              flock.id,
        fromPenSectionId:     flock.penSectionId,
        toPenSectionId:       data.toPenSectionId,
        transferDate:         transferDateUTC,
        fromStage:            'REARING',
        toStage:              'REARING',
        survivingCount:       data.birdsSent,
        birds_sent:           data.birdsSent,         // snake_case in DB
        avgWeightAtTransferG: data.avgWeightAtTransferG ?? null,
        culledAtTransfer:     data.culledAtTransfer,
        notes:                data.notes || null,
        recordedById:         user.sub,
        status:               'PENDING',
        transit_mortality:    0,                      // snake_case in DB
      },
    });

    // ── Notify receiving section PMs ──────────────────────────────────────────
    const receivingPMs = destSection.workerAssignments
      .filter(a => ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN'].includes(a.user.role))
      .map(a => a.user);

    let notifyIds = receivingPMs.map(u => u.id);
    if (notifyIds.length === 0) {
      const farmMgrs = await prisma.user.findMany({
        where:  { tenantId: user.tenantId, role: { in: ['FARM_MANAGER','FARM_ADMIN'] }, isActive: true },
        select: { id: true },
      });
      notifyIds = farmMgrs.map(u => u.id);
    }

    const sourceName = `${flock.penSection?.pen?.name} · ${flock.penSection?.name}`;
    const destName   = `${destSection.pen?.name} · ${destSection.name}`;

    for (const recipientId of notifyIds) {
      await prisma.notification.create({
        data: {
          tenantId:    user.tenantId,
          recipientId,
          senderId:    user.sub,
          type:        'TASK_ASSIGNED',
          title:       `📦 Incoming Transfer — ${flock.batchCode}`,
          message:     `${data.birdsSent.toLocaleString()} birds (${flock.batchCode}) are being transferred ` +
            `from ${sourceName} to ${destName}. ` +
            `Please confirm receipt and count when birds arrive. Open the Rearing page to confirm.`,
          channel:     'IN_APP',
          data: {
            transferId:    transfer.id,
            flockId:       flock.id,
            batchCode:     flock.batchCode,
            toPenSectionId: data.toPenSectionId,
            action:        'CONFIRM_TRANSFER',
          },
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      transfer,
      status:   'PENDING',
      notified: notifyIds.length,
      message:  `Transfer initiated. ${destName} PM notified to confirm receipt of ${data.birdsSent.toLocaleString()} birds.`,
    });

  } catch (err) {
    console.error('POST /api/rearing/[id]/transfer error:', err);
    return NextResponse.json({ error: 'Failed to initiate transfer', detail: err?.message }, { status: 500 });
  }
}
