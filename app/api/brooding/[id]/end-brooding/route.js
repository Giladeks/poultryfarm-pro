// app/api/brooding/[id]/end-brooding/route.js
// POST — Advance a flock from BROODING → REARING (layers) or BROODING → PRODUCTION (broilers).
// Also closes the associated chick_arrivals record (status → TRANSFERRED).
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const schema = z.object({
  endDate: z.string().min(1),   // YYYY-MM-DD
  notes:   z.string().max(1000).optional().nullable(),
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

    const { endDate, notes } = parsed.data;

    const flock = await prisma.flock.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        penSection: {
          select: {
            id: true, name: true,
            pen: { select: { operationType: true, name: true } },
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
    if (flock.stage !== 'BROODING')
      return NextResponse.json({ error: `Flock is not in BROODING stage (current: ${flock.stage})` }, { status: 409 });

    const operationType = flock.penSection?.pen?.operationType;
    const nextStage     = operationType === 'LAYER' ? 'REARING' : 'PRODUCTION';

    const [yr, mo, dy] = endDate.split('-').map(Number);
    const endDateUTC   = new Date(Date.UTC(yr, mo - 1, dy));

    // Run all updates in parallel
    const [updated] = await Promise.all([
      // 1. Advance flock stage
      prisma.flock.update({
        where: { id: flock.id },
        data: {
          stage:            nextStage,
          stageUpdatedAt:   new Date(),
          broodingEndDate:  endDateUTC,
          rearingStartDate: operationType === 'LAYER'   ? endDateUTC : null,
          pointOfLayDate:   operationType === 'BROILER' ? endDateUTC : null,
        },
      }),

      // 2. Close all ACTIVE chick_arrivals records for this flock
      prisma.chick_arrivals.updateMany({
        where:  { flockId: flock.id, tenantId: user.tenantId, status: 'ACTIVE' },
        data: {
          status:       'TRANSFERRED',
          transferDate: endDateUTC,
          notes:        notes || null,
        },
      }),
    ]);

    // 3. Notify workers on the section
    const workers      = flock.penSection?.workerAssignments?.map(a => a.user) ?? [];
    const stageLabel   = nextStage === 'REARING' ? 'Rearing / Growing' : 'Production';
    const notifTitle   = `Brooding Ended — ${flock.batchCode}`;
    const notifMessage = operationType === 'LAYER'
      ? `Flock ${flock.batchCode} in ${flock.penSection?.pen?.name} · ${flock.penSection?.name} has completed brooding. ` +
        `Stage is now Rearing. Birds stay in this pen until Week 13. Tasks update from tomorrow.`
      : `Flock ${flock.batchCode} in ${flock.penSection?.pen?.name} · ${flock.penSection?.name} has completed brooding. ` +
        `Stage is now Production. Grow-out tracking begins.`;

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
            flockId:      flock.id,
            batchCode:    flock.batchCode,
            fromStage:    'BROODING',
            toStage:      nextStage,
            penSectionId: flock.penSectionId,
          },
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      flock:     updated,
      fromStage: 'BROODING',
      toStage:   nextStage,
      notified:  workers.length,
      message:   `Brooding ended. Flock advanced to ${stageLabel}. Delivery records closed.`,
    });

  } catch (err) {
    console.error('POST /api/brooding/[id]/end-brooding error:', err);
    return NextResponse.json({ error: 'Failed to end brooding', detail: err?.message }, { status: 500 });
  }
}
