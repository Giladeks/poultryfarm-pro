// app/api/rearing/[id]/advance/route.js
// POST — Advance a flock from REARING → PRODUCTION stage.
// No pen move. PM confirms first consistent laying has begun.
// Stamps pointOfLayDate, notifies all workers on the current section.
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const schema = z.object({
  pointOfLayDate:    z.string().min(1),         // YYYY-MM-DD
  initialLayingRate: z.number().min(0).max(100).optional().nullable(),
  notes:             z.string().max(1000).optional().nullable(),
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

    const { pointOfLayDate, initialLayingRate, notes } = parsed.data;

    const flock = await prisma.flock.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        penSection: {
          select: {
            id: true, name: true,
            pen: { select: { name: true } },
            workerAssignments: {
              where:  { isActive: true },
              select: { user: { select: { id: true, firstName: true } } },
            },
          },
        },
      },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
    if (flock.stage !== 'REARING')
      return NextResponse.json({ error: `Flock must be in REARING stage (current: ${flock.stage})` }, { status: 409 });
    if (flock.operationType !== 'LAYER')
      return NextResponse.json({ error: 'Only layer flocks advance to PRODUCTION via this route' }, { status: 409 });

    const [yr, mo, dy]  = pointOfLayDate.split('-').map(Number);
    const polDateUTC    = new Date(Date.UTC(yr, mo - 1, dy));

    const updated = await prisma.flock.update({
      where: { id: flock.id },
      data: {
        stage:           'PRODUCTION',
        stageUpdatedAt:  new Date(),
        pointOfLayDate:  polDateUTC,
        // Persist initialLayingRate as a note in peakLayingRatePct only if not already set
        ...(initialLayingRate != null && !flock.peakLayingRatePct
          ? { peakLayingRatePct: initialLayingRate }
          : {}),
      },
    });

    // Notify workers on the current section
    const workers      = flock.penSection?.workerAssignments?.map(a => a.user) ?? [];
    const notifTitle   = `🥚 Production Stage Started — ${flock.batchCode}`;
    const notifMessage = `Flock ${flock.batchCode} in ${flock.penSection?.pen?.name} · ${flock.penSection?.name} ` +
      `has entered the Production stage. Egg collection tasks will begin from tomorrow. ` +
      `${initialLayingRate != null ? `Initial laying rate recorded: ${initialLayingRate}%.` : ''}`;

    for (const worker of workers) {
      await prisma.notification.create({
        data: {
          tenantId:    user.tenantId,
          recipientId: worker.id,
          senderId:    user.sub,
          type:        'SYSTEM',
          title:       notifTitle,
          message:     notifMessage,
          channel:     'IN_APP',
          data: {
            flockId:       flock.id,
            batchCode:     flock.batchCode,
            fromStage:     'REARING',
            toStage:       'PRODUCTION',
            penSectionId:  flock.penSectionId,
            pointOfLayDate,
          },
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      flock:    updated,
      fromStage: 'REARING',
      toStage:   'PRODUCTION',
      notified:  workers.length,
      message:  `Flock ${flock.batchCode} advanced to Production. Point-of-Lay: ${pointOfLayDate}.`,
    });

  } catch (err) {
    console.error('POST /api/rearing/[id]/advance error:', err);
    return NextResponse.json({ error: 'Failed to advance stage', detail: err?.message }, { status: 500 });
  }
}
