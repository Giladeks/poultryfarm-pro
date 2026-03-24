// app/api/mortality/[id]/route.js
// PATCH handles two distinct paths:
//
//   WORKER CORRECTION  (body.override absent/false)
//     — Worker re-enters fields on a rejected (PENDING) record
//     — Requires: recordedById === user.sub
//
//   PM OVERRIDE  (body.override === true)
//     — PM corrects the worker's values directly with a mandatory reason
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

// Full MortalityCause enum — matches schema.prisma exactly
const CAUSE_CODES = [
  'DISEASE', 'INJURY', 'CULLED', 'UNKNOWN',
  'HEAT_STRESS', 'FEED_ISSUE', 'PREDATOR',
  'WATER_ISSUE', 'RESPIRATORY', 'OTHER',
];

// Worker correction schema
const workerEditSchema = z.object({
  override:   z.literal(false).optional(),
  count:      z.number().int().min(1),
  causeCode:  z.enum(CAUSE_CODES).optional(),
  recordDate: z.string().optional(),
  notes:      z.string().nullable().optional(),
});

// PM override schema
const overrideSchema = z.object({
  override:       z.literal(true),
  count:          z.number().int().min(1),
  causeCode:      z.enum(CAUSE_CODES).optional(),
  notes:          z.string().nullable().optional(),
  overrideReason: z.string().min(10, 'Override reason must be at least 10 characters'),
});

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();

    if (body.override === true) return handleOverride(params.id, body, user);
    return handleWorkerEdit(params.id, body, user);

  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Mortality PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }
}

// ── Worker correction path ────────────────────────────────────────────────────
async function handleWorkerEdit(id, body, user) {
  const data = workerEditSchema.parse(body);

  const record = await prisma.mortalityRecord.findFirst({
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

  if (data.count > record.flock.currentCount)
    return NextResponse.json({
      error: `Count (${data.count}) exceeds live bird count (${record.flock.currentCount})`,
    }, { status: 422 });

  const updated = await prisma.mortalityRecord.update({
    where: { id },
    data: {
      count:     data.count,
      causeCode: data.causeCode ?? record.causeCode,
      ...(data.recordDate !== undefined && { recordDate: new Date(data.recordDate) }),
      ...(data.notes !== undefined      && { notes: data.notes }),
      submissionStatus: 'PENDING',
      rejectionReason:  null,
    },
  });

  // Reset linked verification back to PENDING
  await prisma.verification.updateMany({
    where: { referenceId: id, tenantId: user.tenantId, status: 'DISCREPANCY_FOUND' },
    data:  { status: 'PENDING', discrepancyNotes: null },
  }).catch(() => {});

  await prisma.auditLog.create({
    data: {
      tenantId:   user.tenantId,
      userId:     user.sub,
      action:     'UPDATE',
      entityType: 'MortalityRecord',
      entityId:   id,
      changes:    { reason: 'Resubmitted after rejection', count: data.count, causeCode: data.causeCode },
    },
  }).catch(() => {});

  return NextResponse.json({ record: updated });
}

// ── PM Override path ──────────────────────────────────────────────────────────
async function handleOverride(id, body, user) {
  if (!PM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Pen Managers and above can override records' }, { status: 403 });

  const data = overrideSchema.parse(body);

  // COI guard
  const coi = await checkConflictOfInterest(prisma, user, 'MortalityRecord', id);
  if (coi.blocked) {
    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'MortalityRecord',
        entityId:   id,
        changes:    { blocked: true, coiType: coi.coiType, reason: coi.reason, action: 'PM_OVERRIDE_BLOCKED' },
      },
    }).catch(() => {});
    return NextResponse.json({ error: coi.reason, coiBlocked: true, coiType: coi.coiType }, { status: 403 });
  }

  const record = await prisma.mortalityRecord.findFirst({
    where: {
      id,
      flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
    },
    include: { flock: { select: { currentCount: true } } },
  });

  if (!record)
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  if (record.submissionStatus === 'APPROVED')
    return NextResponse.json({ error: 'This record has already been approved — flag it for investigation instead' }, { status: 409 });

  if (data.count > record.flock.currentCount)
    return NextResponse.json({
      error: `Count (${data.count}) exceeds live bird count (${record.flock.currentCount})`,
    }, { status: 422 });

  const now = new Date();

  const originalValues  = {
    count:     record.count,
    causeCode: record.causeCode,
    notes:     record.notes,
  };
  const overriddenValues = {
    count:     data.count,
    causeCode: data.causeCode ?? record.causeCode,
    notes:     data.notes     ?? record.notes,
  };

  const updated = await prisma.mortalityRecord.update({
    where: { id },
    data: {
      count:            data.count,
      causeCode:        data.causeCode ?? record.causeCode,
      ...(data.notes !== undefined && { notes: data.notes }),
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
      entityType: 'MortalityRecord',
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
      title:       'Mortality Record Corrected by PM',
      message:     `Your mortality record was corrected by your Pen Manager. `
                 + `Original count: ${originalValues.count}. `
                 + `Corrected count: ${overriddenValues.count}. `
                 + `Reason: ${data.overrideReason}`,
      data:        { entityType: 'MortalityRecord', entityId: id, action: 'PM_OVERRIDE' },
      channel:     'IN_APP',
    },
  }).catch(() => {});

  // Update / create verification record
  await upsertMortVerification(id, user, now);

  return NextResponse.json({
    record: updated,
    override: { originalValues, overriddenValues, reason: data.overrideReason },
  });
}

// ── Create / update verification record for overridden mortality ──────────────
async function upsertMortVerification(referenceId, user, now) {
  try {
    const existing = await prisma.verification.findFirst({
      where:   { referenceId, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && ['PENDING', 'DISCREPANCY_FOUND'].includes(existing.status)) {
      await prisma.verification.update({
        where: { id: existing.id },
        data:  { status: 'VERIFIED', verifiedById: user.sub, verificationDate: now },
      });
    } else if (!existing) {
      const firstStore = await prisma.store.findFirst({
        where:  { farm: { tenantId: user.tenantId } },
        select: { id: true },
      });
      if (!firstStore) return;

      await prisma.verification.create({
        data: {
          tenantId:         user.tenantId,
          storeId:          firstStore.id,
          verifiedById:     user.sub,
          verificationType: 'MORTALITY_REPORT',
          referenceId,
          referenceType:    'MortalityRecord',
          verificationDate: now,
          status:           'VERIFIED',
        },
      });
    }
  } catch (err) {
    console.error('[upsertMortVerification] Failed:', err?.message);
  }
}
