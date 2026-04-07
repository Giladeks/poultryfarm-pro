// app/api/rearing/[id]/advance/route.js
// POST — Advance a flock from REARING → PRODUCTION stage.
// Requires first egg collection record — logged as part of the advance action.
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const eggSchema = z.object({
  flockId:           z.string().min(1),
  penSectionId:      z.string().min(1),
  collectionDate:    z.string().min(1),
  collectionSession: z.number().int().min(1).max(2).default(1),
  cratesCollected:   z.number().int().min(0),
  looseEggs:         z.number().int().min(0).default(0),
  totalEggs:         z.number().int().min(1),
  layingRatePct:     z.number().min(0).max(100),
  gradeACount:       z.number().int().min(0).nullable().optional(),  // auto-calculated by client
  gradeBCrates:      z.number().int().min(0).nullable().optional(),
  gradeBLoose:       z.number().int().min(0).nullable().optional(),
  gradeBCount:       z.number().int().min(0).nullable().optional(),
  crackedCount:      z.number().int().min(0).nullable().optional(),
  gradeAPct:         z.number().min(0).max(100).nullable().optional(),
  submissionStatus:  z.string().default('PENDING'),
});

const schema = z.object({
  pointOfLayDate:     z.string().min(1),
  notes:              z.string().max(1000).optional().nullable(),
  firstEggCollection: eggSchema,
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

    const { pointOfLayDate, notes, firstEggCollection } = parsed.data;

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

    const [yr, mo, dy] = pointOfLayDate.split('-').map(Number);
    const polDateUTC   = new Date(Date.UTC(yr, mo - 1, dy));

    const [eyrC, emoC, edyC] = firstEggCollection.collectionDate.split('-').map(Number);
    const eggDateUTC = new Date(Date.UTC(eyrC, emoC - 1, edyC));

    // Create egg record and advance flock in a transaction
    const [updated, eggRecord] = await prisma.$transaction([
      // 1. Advance flock to PRODUCTION
      prisma.flock.update({
        where: { id: flock.id },
        data: {
          stage:          'PRODUCTION',
          stageUpdatedAt: new Date(),
          pointOfLayDate: polDateUTC,
        },
      }),
      // 2. Create first egg collection record — auto-approved since PM is the source
      prisma.eggProduction.create({
        data: {
          flockId:           firstEggCollection.flockId,
          penSectionId:      firstEggCollection.penSectionId,
          collectionDate:    eggDateUTC,
          collectionSession: firstEggCollection.collectionSession,
          cratesCollected:   firstEggCollection.cratesCollected,
          looseEggs:         firstEggCollection.looseEggs,
          totalEggs:         firstEggCollection.totalEggs,
          layingRatePct:     firstEggCollection.layingRatePct,
          gradeACount:       firstEggCollection.gradeACount ?? null,
          gradeBCrates:      firstEggCollection.gradeBCrates ?? null,
          gradeBLoose:       firstEggCollection.gradeBLoose  ?? null,
          gradeBCount:       firstEggCollection.gradeBCount  ?? null,
          crackedCount:      firstEggCollection.crackedCount ?? null,
          gradeAPct:         firstEggCollection.gradeAPct    ?? null,
          submissionStatus:  'APPROVED',   // PM-logged → auto-approved
          recordedById:      user.sub,
          approvedById:      user.sub,     // PM is also the approver
          approvedAt:        new Date(),
        },
      }),
    ]);

    // Notify workers on the current section
    const workers = flock.penSection?.workerAssignments?.map(a => a.user) ?? [];
    const penName = `${flock.penSection?.pen?.name} · ${flock.penSection?.name}`;

    for (const worker of workers) {
      await prisma.notification.create({
        data: {
          tenantId:    user.tenantId,
          recipientId: worker.id,
          senderId:    user.sub,
          type:        'SYSTEM',
          title:       `Flock Advanced to Production — ${flock.batchCode}`,
          message:     `${flock.batchCode} in ${penName} has reached Point-of-Lay. `
                     + `Stage is now Production. Egg collection tasks begin from tomorrow. `
                     + `First collection: ${firstEggCollection.totalEggs.toLocaleString()} eggs `
                     + `(${firstEggCollection.layingRatePct}% laying rate).`,
          channel:     'IN_APP',
          data: {
            flockId:      flock.id,
            batchCode:    flock.batchCode,
            fromStage:    'REARING',
            toStage:      'PRODUCTION',
            penSectionId: flock.penSectionId,
            eggRecordId:  eggRecord.id,
          },
        },
      }).catch(() => {});
    }

    // Notify IC and FM+ about the auto-approved first collection record
    const supervisors = await prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
        role: { in: ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'INTERNAL_CONTROL'] },
      },
      select: { id: true },
    });

    for (const supervisor of supervisors) {
      await prisma.notification.create({
        data: {
          tenantId:    user.tenantId,
          recipientId: supervisor.id,
          senderId:    user.sub,
          type:        'REPORT_SUBMITTED',
          title:       `📋 First Egg Collection Logged — ${flock.batchCode}`,
          message:     `${flock.batchCode} (${penName}) has advanced to Production. `
                     + `First egg collection: ${firstEggCollection.totalEggs.toLocaleString()} eggs, `
                     + `${firstEggCollection.layingRatePct}% laying rate`
                     + (firstEggCollection.gradeACount != null
                       ? `, ${firstEggCollection.gradeAPct?.toFixed(1)}% Grade A` : '')
                     + `. Record auto-approved (logged by Pen Manager).`,
          channel:     'IN_APP',
          data: {
            flockId:      flock.id,
            batchCode:    flock.batchCode,
            penSectionId: flock.penSectionId,
            eggRecordId:  eggRecord.id,
            autoApproved: true,
          },
        },
      }).catch(() => {});
    }

    // Auto-create egg_store_receipt for the first egg collection so the
    // Store Manager sees it in the Awaiting Receipt queue immediately.
    // Non-fatal — advance already succeeded if this fails.
    try {
      const penIdRows = await prisma.$queryRawUnsafe(
        `SELECT "penId" FROM pen_sections WHERE id = $1 LIMIT 1`,
        flock.penSectionId
      );
      const penId = penIdRows[0]?.penId ?? null;

      if (penId) {
        const gradeACount  = firstEggCollection.gradeACount  ?? 0;
        const gradeBCount  = firstEggCollection.gradeBCount  ?? 0;
        const crackedCount = firstEggCollection.crackedCount ?? 0;
        const gradeACrates = Math.floor(gradeACount / 30);
        const gradeALoose  = gradeACount % 30;
        const gradeBCrates = Math.floor(gradeBCount / 30);
        const gradeBLoose  = gradeBCount % 30;
        const totalEggs    = gradeACount + gradeBCount + crackedCount;

        const workerAssignment = await prisma.penWorkerAssignment.findFirst({
          where:   { penSectionId: flock.penSectionId, isActive: true },
          select:  { userId: true },
          orderBy: { assignedAt: 'desc' },
        });

        await prisma.$queryRawUnsafe(`
          INSERT INTO egg_store_receipts (
            "tenantId", "eggProductionId", "penSectionId", "penId",
            "collectionDate", "collectionSession", "flockId", "batchCode",
            "gradedGradeACrates", "gradedGradeALoose", "gradedGradeACount",
            "gradedGradeBCrates", "gradedGradeBLoose", "gradedGradeBCount",
            "gradedCrackedCount", "gradedTotalEggs",
            "deliveredById", "status"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16,
            $17, 'PENDING'
          )
          ON CONFLICT ("eggProductionId") DO NOTHING
        `,
          user.tenantId,
          eggRecord.id,
          flock.penSectionId,
          penId,
          eggRecord.collectionDate,
          eggRecord.collectionSession,
          flock.id,
          flock.batchCode,
          gradeACrates, gradeALoose, gradeACount,
          gradeBCrates, gradeBLoose, gradeBCount,
          crackedCount, totalEggs,
          workerAssignment?.userId || null,
        );
      }
    } catch (receiptErr) {
      console.error('[advance] autoCreateStoreReceipt failed:', receiptErr?.message);
    }

    return NextResponse.json({
      flock:          updated,
      eggRecord:      eggRecord,
      fromStage:      'REARING',
      toStage:        'PRODUCTION',
      notified:       workers.length,
      supervisorsNotified: supervisors.length,
      message:        `Flock advanced to Production. First egg collection auto-approved `
                    + `(${firstEggCollection.totalEggs} eggs, ${firstEggCollection.layingRatePct}% lay rate). `
                    + `${workers.length} worker(s) and ${supervisors.length} supervisor(s) notified.`,
    });
  } catch (err) {
    console.error('POST /api/rearing/[id]/advance error:', err);
    return NextResponse.json({ error: 'Failed to advance flock', detail: err?.message }, { status: 500 });
  }
}
