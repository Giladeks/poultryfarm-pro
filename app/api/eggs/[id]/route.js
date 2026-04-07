// app/api/eggs/[id]/route.js
// PATCH handles three distinct paths:
//
//   WORKER CORRECTION  (body.grading absent/false, body.override absent/false)
//     — Worker re-enters crate fields on a rejected (PENDING) record
//     — Clears all PM grading, resets to PENDING
//     — Requires: recordedById === user.sub
//
//   PM GRADING  (body.grading === true)
//     — PM enters gradeBCrates, gradeBLoose, crackedConfirmed
//     — Computes gradeBCount, gradeACount, gradeAPct
//     — Sets APPROVED, creates/updates Verification record (VERIFIED)
//     — Requires: PEN_MANAGER or above, passes COI guard
//
//   PM OVERRIDE  (body.override === true)
//     — PM corrects the worker's crate values directly with a mandatory reason
//     — Records originalValue + overriddenValue + overrideReason in audit log
//     — Sets APPROVED immediately; notifies worker
//     — Requires: PEN_MANAGER or above, passes COI guard

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { checkConflictOfInterest } from '@/lib/utils/conflictOfInterest';

const PM_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

// Worker correction schema
const workerEditSchema = z.object({
  grading:           z.literal(false).optional(),
  override:          z.literal(false).optional(),
  cratesCollected:   z.number().int().min(0),
  looseEggs:         z.number().int().min(0).max(29),
  crackedCount:      z.number().int().min(0),
  collectionDate:    z.string().optional(),
  collectionSession: z.number().int().min(1).max(2).optional(),
});

// PM grading schema
const gradingSchema = z.object({
  grading:          z.literal(true),
  gradeBCrates:     z.number().int().min(0),
  gradeBLoose:      z.number().int().min(0).max(29),
  crackedConfirmed: z.number().int().min(0),
});

// PM override schema
const overrideSchema = z.object({
  override:          z.literal(true),
  cratesCollected:   z.number().int().min(0),
  looseEggs:         z.number().int().min(0).max(29),
  crackedCount:      z.number().int().min(0),
  collectionSession: z.number().int().min(1).max(2).optional(),
  overrideReason:    z.string().min(10, 'Override reason must be at least 10 characters'),
});

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();

    // ── Route to the correct handler ──────────────────────────────────────────
    if (body.override === true) return handleOverride(params.id, body, user);
    if (body.grading  === true) return handleGrading(params.id, body, user);
    return handleWorkerEdit(params.id, body, user);

  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Egg PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }
}

// ── PM Override path ──────────────────────────────────────────────────────────
async function handleOverride(id, body, user) {
  if (!PM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Pen Managers and above can override records' }, { status: 403 });

  const data = overrideSchema.parse(body);

  // COI guard — same rule as grading
  const coi = await checkConflictOfInterest(prisma, user, 'EggProduction', id);
  if (coi.blocked) {
    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'EggProduction',
        entityId:   id,
        changes:    { blocked: true, coiType: coi.coiType, reason: coi.reason, action: 'PM_OVERRIDE_BLOCKED' },
      },
    }).catch(() => {});
    return NextResponse.json({ error: coi.reason, coiBlocked: true, coiType: coi.coiType }, { status: 403 });
  }

  const record = await prisma.eggProduction.findFirst({
    where: {
      id,
      flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
    },
    include: {
      flock: {
        select: {
          currentCount: true,
          batchCode:    true,   // needed for egg_store_receipt.batchCode
        },
      },
      penSection: {
        select: {
          id:    true,
          penId: true,          // needed for egg_store_receipt.penId
        },
      },
    },
  });

  if (!record)
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  if (record.submissionStatus === 'APPROVED')
    return NextResponse.json({ error: 'This record has already been approved — flag it for investigation instead' }, { status: 409 });

  const newTotal      = (data.cratesCollected * 30) + data.looseEggs + data.crackedCount;
  const layingRatePct = record.flock.currentCount > 0
    ? parseFloat(((newTotal / record.flock.currentCount) * 100).toFixed(2))
    : 0;

  const now = new Date();

  const originalValues  = {
    cratesCollected:   record.cratesCollected,
    looseEggs:         record.looseEggs,
    crackedCount:      record.crackedCount,
    collectionSession: record.collectionSession,
    totalEggs:         record.totalEggs,
    layingRatePct:     Number(record.layingRatePct),
  };
  const overriddenValues = {
    cratesCollected:   data.cratesCollected,
    looseEggs:         data.looseEggs,
    crackedCount:      data.crackedCount,
    collectionSession: data.collectionSession ?? record.collectionSession,
    totalEggs:         newTotal,
    layingRatePct,
  };

  const updated = await prisma.eggProduction.update({
    where: { id },
    data: {
      cratesCollected:   data.cratesCollected,
      looseEggs:         data.looseEggs,
      crackedCount:      data.crackedCount,
      collectionSession: data.collectionSession ?? record.collectionSession,
      totalEggs:         newTotal,
      layingRatePct,
      // Clear prior grading — PM must re-grade after override
      gradeBCrates:     null,
      gradeBLoose:      null,
      crackedConfirmed: null,
      gradeBCount:      null,
      gradeACount:      null,
      gradeAPct:        null,
      approvedById:     user.sub,
      approvedAt:       now,
      submissionStatus: 'APPROVED',
      rejectionReason:  null,
    },
  });

  // Permanent side-by-side audit trail
  await prisma.auditLog.create({
    data: {
      tenantId:   user.tenantId,
      userId:     user.sub,
      action:     'APPROVE',
      entityType: 'EggProduction',
      entityId:   id,
      changes: {
        action:          'PM_OVERRIDE',
        overrideReason:  data.overrideReason,
        originalValues,
        overriddenValues,
        overriddenBy:    user.sub,
        overriddenAt:    now.toISOString(),
      },
    },
  });

  // Notify worker
  await prisma.notification.create({
    data: {
      tenantId:    user.tenantId,
      recipientId: record.recordedById,
      type:        'REPORT_APPROVED',
      title:       'Egg Record Corrected by PM',
      message:     `Your egg record was corrected by your Pen Manager. `
                 + `Original: ${originalValues.totalEggs} eggs. `
                 + `Corrected: ${newTotal} eggs. `
                 + `Reason: ${data.overrideReason}`,
      data:        { entityType: 'EggProduction', entityId: id, action: 'PM_OVERRIDE' },
      channel:     'IN_APP',
    },
  }).catch(() => {});

  await upsertVerification(id, user, now);

  // Auto-create egg store receipt — override also sets APPROVED so store must acknowledge
  // gradeACount/gradeBCount are null after override (PM must re-grade),
  // so we pass 0 for grade counts — the receipt will update when PM re-grades
  // Note: override clears grading so gradeACount = 0 until PM grades again.
  // The receipt is created as a placeholder; inventory only updates on acknowledgement.
  await autoCreateStoreReceipt(
    { ...record, totalEggs: newTotal },
    0, 0, data.crackedCount,
    user
  );

  return NextResponse.json({
    record: updated,
    override: { originalValues, overriddenValues, reason: data.overrideReason },
  });
}

// ── Worker correction path ────────────────────────────────────────────────────
async function handleWorkerEdit(id, body, user) {
  const data = workerEditSchema.parse(body);

  const record = await prisma.eggProduction.findFirst({
    where: {
      id,
      flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
    },
    include: { flock: { select: { currentCount: true } } },
  });

  if (!record)
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  if (record.recordedById !== user.sub)
    return NextResponse.json({ error: 'You can only edit your own records' }, { status: 403 });
  if (record.submissionStatus !== 'PENDING')
    return NextResponse.json({ error: 'Only pending records can be edited' }, { status: 422 });

  const cratesCollected = data.cratesCollected;
  const looseEggs       = data.looseEggs;
  const crackedCount    = data.crackedCount;
  const totalEggs       = (cratesCollected * 30) + looseEggs + crackedCount;
  const layingRatePct   = record.flock.currentCount > 0
    ? parseFloat(((totalEggs / record.flock.currentCount) * 100).toFixed(2))
    : 0;

  const updated = await prisma.eggProduction.update({
    where: { id },
    data: {
      cratesCollected,
      looseEggs,
      crackedCount,
      totalEggs,
      layingRatePct,
      ...(data.collectionDate    && { collectionDate:    new Date(data.collectionDate) }),
      ...(data.collectionSession && { collectionSession: data.collectionSession }),
      // Clear PM grading — worker input changed so PM must re-grade
      gradeBCrates:     null,
      gradeBLoose:      null,
      crackedConfirmed: null,
      gradeBCount:      null,
      gradeACount:      null,
      gradeAPct:        null,
      approvedById:     null,
      approvedAt:       null,
      submissionStatus: 'PENDING',
      rejectionReason:  null,
    },
  });

  // Reset linked verification to PENDING so it re-appears in the queue
  await prisma.verification.updateMany({
    where: { referenceId: id, tenantId: user.tenantId, status: 'DISCREPANCY_FOUND' },
    data:  { status: 'PENDING', discrepancyNotes: null },
  }).catch(() => {});

  await prisma.auditLog.create({
    data: {
      tenantId:   user.tenantId,
      userId:     user.sub,
      action:     'UPDATE',
      entityType: 'EggProduction',
      entityId:   id,
      changes:    { reason: 'Resubmitted after rejection', cratesCollected, looseEggs, crackedCount, totalEggs },
    },
  }).catch(() => {});

  return NextResponse.json({ record: updated });
}

// ── PM grading path ───────────────────────────────────────────────────────────
async function handleGrading(id, body, user) {
  if (!PM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Pen Managers and above can grade egg records' }, { status: 403 });

  const data = gradingSchema.parse(body);

  const record = await prisma.eggProduction.findFirst({
    where: {
      id,
      flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
    },
    include: {
      flock: {
        select: {
          currentCount: true,
          batchCode:    true,   // needed for egg_store_receipt.batchCode
        },
      },
      penSection: {
        select: {
          id:    true,
          penId: true,          // needed for egg_store_receipt.penId
        },
      },
    },
  });

  if (!record)
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  if (record.submissionStatus === 'APPROVED')
    return NextResponse.json({ error: 'This record has already been graded' }, { status: 409 });

  // ── Conflict-of-interest guard ──────────────────────────────────────────────
  // The PM performing the grading cannot be the same person who submitted the
  // egg collection record, nor can they have submitted any records in the same
  // section on the same collection date.
  const coi = await checkConflictOfInterest(prisma, user, 'EggProduction', id);
  if (coi.blocked) {
    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'EggProduction',
        entityId:   id,
        changes: {
          blocked: true,
          coiType: coi.coiType,
          reason:  coi.reason,
          action:  'PM_GRADING_BLOCKED',
        },
      },
    }).catch(() => {});
    return NextResponse.json(
      { error: coi.reason, coiBlocked: true, coiType: coi.coiType },
      { status: 403 }
    );
  }

  // Compute grade breakdown
  // gradeBCount = (gradeBCrates × 30) + gradeBLoose
  const gradeBCount    = (data.gradeBCrates * 30) + data.gradeBLoose;
  const crackedConfirmed = data.crackedConfirmed;

  // gradeACount = totalEggs − gradeBCount − crackedConfirmed
  const gradeACount    = record.totalEggs - gradeBCount - crackedConfirmed;

  if (gradeACount < 0)
    return NextResponse.json({
      error: `Grade B (${gradeBCount}) + Cracked (${crackedConfirmed}) exceeds total eggs (${record.totalEggs})`,
    }, { status: 422 });

  // gradeAPct = gradeACount / totalEggs × 100
  const gradeAPct = record.totalEggs > 0
    ? parseFloat(((gradeACount / record.totalEggs) * 100).toFixed(2))
    : 0;

  const now = new Date();

  const updated = await prisma.eggProduction.update({
    where: { id },
    data: {
      gradeBCrates:     data.gradeBCrates,
      gradeBLoose:      data.gradeBLoose,
      crackedConfirmed,
      gradeBCount,
      gradeACount,
      gradeAPct,
      approvedById:     user.sub,
      approvedAt:       now,
      submissionStatus: 'APPROVED',
      rejectionReason:  null,
    },
  });

  // Create or update a Verification record (VERIFIED) for this egg record
  await upsertVerification(id, user, now);

  // Auto-create egg store receipt so Store Manager can acknowledge delivery
  await autoCreateStoreReceipt(record, gradeACount, gradeBCount, crackedConfirmed, user);

  await prisma.auditLog.create({
    data: {
      tenantId:   user.tenantId,
      userId:     user.sub,
      action:     'APPROVE',
      entityType: 'EggProduction',
      entityId:   id,
      changes: {
        gradeBCrates: data.gradeBCrates,
        gradeBLoose:  data.gradeBLoose,
        gradeBCount,
        gradeACount,
        gradeAPct,
        crackedConfirmed,
      },
    },
  }).catch(() => {});

  return NextResponse.json({
    record: updated,
    computed: { gradeBCount, gradeACount, gradeAPct, crackedConfirmed },
  });
}

// ── Helper: create or update a VERIFIED verification record ───────────────────
async function upsertVerification(referenceId, user, now) {
  try {
    const existing = await prisma.verification.findFirst({
      where:   { referenceId, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && ['PENDING', 'DISCREPANCY_FOUND'].includes(existing.status)) {
      await prisma.verification.update({
        where: { id: existing.id },
        data: {
          status:           'VERIFIED',
          verifiedById:     user.sub,
          verificationDate: now,
        },
      });
    } else if (!existing) {
      // storeId is non-nullable on Verification — resolve the tenant's first store
      const firstStore = await prisma.store.findFirst({
        where:  { farm: { tenantId: user.tenantId } },
        select: { id: true },
      });
      if (!firstStore) {
        console.error('[upsertVerification] No store found for tenant', user.tenantId);
        return; // non-fatal — grading succeeded; verification record skipped
      }

      await prisma.verification.create({
        data: {
          tenantId:         user.tenantId,
          storeId:          firstStore.id,
          verifiedById:     user.sub,
          verificationType: 'DAILY_PRODUCTION',
          referenceId,
          referenceType:    'EggProduction',
          verificationDate: now,
          status:           'VERIFIED',
        },
      });
    }
    // If already VERIFIED / RESOLVED — leave it alone
  } catch (err) {
    // Non-fatal — grading already succeeded; log for visibility
    console.error('[upsertVerification] Failed to create verification record:', err?.message);
  }
}

// ── Helper: auto-create egg_store_receipt when PM grades/approves ─────────────
// Called after PM grading and PM override — creates a PENDING receipt so the
// Store Manager can acknowledge delivery on the /egg-store page.
// Non-fatal: grading already succeeded if this fails.
// Uses $queryRawUnsafe — egg_store_receipts is a snake_case table.
async function autoCreateStoreReceipt(record, gradeACount, gradeBCount, crackedConfirmed, user) {
  try {
    const penId = record.penSection?.penId;
    if (!penId) {
      console.error('[autoCreateStoreReceipt] Could not resolve penId for section', record.penSectionId);
      return;
    }

    // Resolve the active pen worker for this section (most recently assigned)
    const workerAssignment = await prisma.penWorkerAssignment.findFirst({
      where:   { penSectionId: record.penSectionId, isActive: true },
      select:  { userId: true },
      orderBy: { assignedAt: 'desc' },
    });

    // Derive crate breakdown from grade counts
    const gradeACrates = Math.floor(gradeACount / 30);
    const gradeALoose  = gradeACount % 30;
    const gradeBCrates = Math.floor(gradeBCount / 30);
    const gradeBLoose  = gradeBCount % 30;
    const totalEggs    = gradeACount + gradeBCount + crackedConfirmed;

    // ON CONFLICT:
    //   - If receipt is RECOUNT_REQUESTED → update with new graded counts, reset to PENDING
    //     so Store Manager sees it again in the Awaiting Receipt queue
    //   - Any other status → do nothing (idempotent, preserves existing receipt state)
    await prisma.$queryRawUnsafe(`
      INSERT INTO egg_store_receipts (
        "tenantId",
        "eggProductionId",
        "penSectionId",
        "penId",
        "collectionDate",
        "collectionSession",
        "flockId",
        "batchCode",
        "gradedGradeACrates",
        "gradedGradeALoose",
        "gradedGradeACount",
        "gradedGradeBCrates",
        "gradedGradeBLoose",
        "gradedGradeBCount",
        "gradedCrackedCount",
        "gradedTotalEggs",
        "deliveredById",
        "status"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16,
        $17, 'PENDING'
      )
      ON CONFLICT ("eggProductionId") DO UPDATE SET
        -- Only update when IC has requested a recount — PM has now re-graded
        "gradedGradeACrates"  = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedGradeACrates"
                                     ELSE egg_store_receipts."gradedGradeACrates" END,
        "gradedGradeALoose"   = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedGradeALoose"
                                     ELSE egg_store_receipts."gradedGradeALoose" END,
        "gradedGradeACount"   = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedGradeACount"
                                     ELSE egg_store_receipts."gradedGradeACount" END,
        "gradedGradeBCrates"  = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedGradeBCrates"
                                     ELSE egg_store_receipts."gradedGradeBCrates" END,
        "gradedGradeBLoose"   = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedGradeBLoose"
                                     ELSE egg_store_receipts."gradedGradeBLoose" END,
        "gradedGradeBCount"   = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedGradeBCount"
                                     ELSE egg_store_receipts."gradedGradeBCount" END,
        "gradedCrackedCount"  = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedCrackedCount"
                                     ELSE egg_store_receipts."gradedCrackedCount" END,
        "gradedTotalEggs"     = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN EXCLUDED."gradedTotalEggs"
                                     ELSE egg_store_receipts."gradedTotalEggs" END,
        -- Reset status to PENDING and clear dispute/resolution fields
        "status"              = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN 'PENDING'
                                     ELSE egg_store_receipts."status" END,
        "disputeNotes"        = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NULL
                                     ELSE egg_store_receipts."disputeNotes" END,
        "disputedById"        = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NULL
                                     ELSE egg_store_receipts."disputedById" END,
        "disputedAt"          = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NULL
                                     ELSE egg_store_receipts."disputedAt" END,
        "resolvedById"        = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NULL
                                     ELSE egg_store_receipts."resolvedById" END,
        "resolvedAt"          = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NULL
                                     ELSE egg_store_receipts."resolvedAt" END,
        "resolutionAction"    = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NULL
                                     ELSE egg_store_receipts."resolutionAction" END,
        "resolutionNotes"     = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NULL
                                     ELSE egg_store_receipts."resolutionNotes" END,
        "updatedAt"           = CASE WHEN egg_store_receipts."status" = 'RECOUNT_REQUESTED'
                                     THEN NOW()
                                     ELSE egg_store_receipts."updatedAt" END
    `,
      user.tenantId,
      record.id,
      record.penSectionId,
      penId,
      record.collectionDate,
      record.collectionSession,
      record.flockId,
      record.flock.batchCode,
      gradeACrates,
      gradeALoose,
      gradeACount,
      gradeBCrates,
      gradeBLoose,
      gradeBCount,
      crackedConfirmed,
      totalEggs,
      workerAssignment?.userId || null,
    );

  } catch (err) {
    console.error('[autoCreateStoreReceipt] Failed:', err?.message);
  }
}
