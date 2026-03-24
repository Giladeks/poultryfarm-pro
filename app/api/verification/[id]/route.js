// app/api/verification/[id]/route.js — Single verification: GET + PATCH
// Update: PATCH now enforces the conflict-of-interest guard before allowing
// VERIFIED status. A PM who submitted records in the same section on the same
// day cannot verify those records — they are automatically blocked.
import { NextResponse } from 'next/server';
import { sendRejectionAlert } from '@/lib/services/sms';
import { sendVerificationRejectedEmail, resolveEmailSettings } from '@/lib/services/notifications';
import { prisma }      from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z }           from 'zod';
import { checkConflictOfInterest } from '@/lib/utils/conflictOfInterest';

const VERIFIER_ROLES = [
  'PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK',
  'INTERNAL_CONTROL', 'ACCOUNTANT',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];
const MANAGER_ROLES  = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const REJECT_ROLES   = ['PEN_MANAGER', 'STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const MANAGEMENT_OVERRIDE = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const RECORD_TYPE_VERIFIERS = {
  EggProduction:   [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
  MortalityRecord: [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
  FeedConsumption: [...new Set(['STORE_MANAGER', 'STORE_CLERK',   ...MANAGEMENT_OVERRIDE])],
  StoreReceipt:    [...new Set(['STORE_MANAGER',                  ...MANAGEMENT_OVERRIDE])],
  DailyReport:     [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
};
function canVerifyRecordType(role, referenceType) {
  const allowed = RECORD_TYPE_VERIFIERS[referenceType];
  return !allowed || allowed.includes(role);
}

const STATUS_TRANSITIONS = {
  PENDING:           ['VERIFIED', 'DISCREPANCY_FOUND'],
  DISCREPANCY_FOUND: ['ESCALATED', 'RESOLVED'],
  ESCALATED:         ['RESOLVED'],
  VERIFIED:          [],
  RESOLVED:          [],
};

const patchSchema = z.object({
  status:            z.enum(['VERIFIED', 'DISCREPANCY_FOUND', 'ESCALATED', 'RESOLVED']).optional(),
  discrepancyAmount: z.number().nullable().optional(),
  discrepancyNotes:  z.string().nullable().optional(),
  resolution:        z.string().nullable().optional(),
  escalatedToId:     z.string().min(1).nullable().optional(),
  reject:            z.boolean().optional(),
  rejectReason:      z.string().optional(),
});

// ─── GET /api/verification/[id] ───────────────────────────────────────────────
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VERIFIER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const verification = await prisma.verification.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        store:       true,
        verifiedBy:  { select: { id: true, firstName: true, lastName: true, role: true } },
        escalatedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    if (!verification)
      return NextResponse.json({ error: 'Verification not found' }, { status: 404 });

    const sourceRecord = await fetchSourceRecord(verification.referenceType, verification.referenceId);
    return NextResponse.json({ verification, sourceRecord });
  } catch (error) {
    console.error('Verification get error:', error);
    return NextResponse.json({ error: 'Failed to fetch verification' }, { status: 500 });
  }
}

// ─── PATCH /api/verification/[id] ────────────────────────────────────────────
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VERIFIER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    const existing = await prisma.verification.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!existing)
      return NextResponse.json({ error: 'Verification not found' }, { status: 404 });

    if (!canVerifyRecordType(user.role, existing.referenceType)) {
      return NextResponse.json({
        error: `Your role (${user.role}) is not authorised to act on ${existing.referenceType} records.`,
        allowedRoles: RECORD_TYPE_VERIFIERS[existing.referenceType] || VERIFIER_ROLES,
      }, { status: 403 });
    }

    // ── Conflict-of-interest guard ────────────────────────────────────────────
    // Applied when setting status to VERIFIED (not for flag/reject/escalate/resolve)
    const targetStatus = data.status ?? (data.reject ? 'DISCREPANCY_FOUND' : null);
    if (targetStatus === 'VERIFIED') {
      const coi = await checkConflictOfInterest(
        prisma, user, existing.referenceType, existing.referenceId
      );
      if (coi.blocked) {
        await prisma.auditLog.create({
          data: {
            tenantId:   user.tenantId,
            userId:     user.sub,
            action:     'UPDATE',
            entityType: 'Verification',
            entityId:   params.id,
            changes: {
              blocked:       true,
              coiType:       coi.coiType,
              reason:        coi.reason,
              referenceType: existing.referenceType,
              referenceId:   existing.referenceId,
            },
          },
        }).catch(() => {});
        return NextResponse.json(
          { error: coi.reason, coiBlocked: true, coiType: coi.coiType },
          { status: 403 }
        );
      }
    }

    if (data.status === 'ESCALATED' && !VERIFIER_ROLES.includes(user.role))
      return NextResponse.json({ error: 'Insufficient permissions to escalate' }, { status: 403 });

    if (data.status === 'RESOLVED' && !MANAGER_ROLES.includes(user.role))
      return NextResponse.json({ error: 'Only managers can mark records as resolved' }, { status: 403 });

    if (data.status && data.status !== existing.status) {
      const allowed = STATUS_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        return NextResponse.json({
          error: `Invalid transition: ${existing.status} → ${data.status}`,
          allowedTransitions: allowed,
        }, { status: 422 });
      }
    }

    // ── Rejection path (send back to worker) ──────────────────────────────────
    if (data.reject) {
      if (!REJECT_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Insufficient permissions to reject records' }, { status: 403 });

      await rejectSourceRecord(existing.referenceType, existing.referenceId, data.rejectReason);
      await notifyRejection(existing, data.rejectReason, user.tenantId).catch(() => {});
      await sendRejectionSms(existing, data.rejectReason, user.tenantId).catch(() => {});
      await sendRejectionEmail(existing, data.rejectReason, user, user.tenantId).catch(() => {});

      const updated = await prisma.verification.update({
        where: { id: params.id },
        data:  { status: 'DISCREPANCY_FOUND', discrepancyNotes: data.rejectReason || 'Record rejected for resubmission' },
        include: { verifiedBy: { select: { id: true, firstName: true, lastName: true } } },
      });

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.sub,
          action:     'REJECT',
          entityType: 'Verification',
          entityId:   params.id,
          changes:    { rejectReason: data.rejectReason, referenceType: existing.referenceType },
        },
      }).catch(() => {});

      return NextResponse.json({ verification: updated });
    }

    // ── Standard status update ────────────────────────────────────────────────
    const updateData = {
      ...(data.status            !== undefined && { status: data.status }),
      ...(data.discrepancyAmount !== undefined && { discrepancyAmount: data.discrepancyAmount }),
      ...(data.discrepancyNotes  !== undefined && { discrepancyNotes: data.discrepancyNotes }),
      ...(data.resolution        !== undefined && { resolution: data.resolution }),
      ...(data.status === 'VERIFIED' && {
        verifiedById:    user.sub,
        verificationDate: new Date(),
      }),
      ...(data.status === 'ESCALATED' && {
        escalatedAt:   new Date(),
        escalatedToId: data.escalatedToId ?? null,
      }),
      ...(data.status === 'RESOLVED' && {
        resolvedById: user.sub,
        resolvedAt:   new Date(),
      }),
    };

    const updated = await prisma.verification.update({
      where: { id: params.id },
      data:  updateData,
      include: {
        store:       { select: { id: true, name: true } },
        verifiedBy:  { select: { id: true, firstName: true, lastName: true } },
        escalatedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (data.status === 'VERIFIED') {
      await updateSourceRecord(existing.referenceType, existing.referenceId, 'APPROVED', user.sub).catch(() => {});
    }
    if (data.status === 'RESOLVED') {
      await updateSourceRecord(existing.referenceType, existing.referenceId, 'APPROVED', user.sub).catch(() => {});
      await notifyResolution(existing, updated, user, user.tenantId).catch(() => {});
    }
    if (data.status === 'ESCALATED' && data.escalatedToId) {
      await notifyEscalation(updated, data.escalatedToId, user.tenantId).catch(() => {});
    }

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'Verification',
        entityId:   params.id,
        changes: {
          statusBefore: existing.status,
          statusAfter:  data.status ?? existing.status,
          resolution:   data.resolution,
        },
      },
    }).catch(() => {});

    return NextResponse.json({ verification: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Verification update error:', error);
    return NextResponse.json({ error: 'Failed to update verification' }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchSourceRecord(referenceType, referenceId) {
  try {
    switch (referenceType) {
      case 'EggProduction':
        return prisma.eggProduction.findUnique({
          where: { id: referenceId },
          include: {
            flock:      { select: { id: true, batchCode: true, currentCount: true } },
            penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
            recordedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });
      case 'MortalityRecord':
        return prisma.mortalityRecord.findUnique({
          where: { id: referenceId },
          include: {
            flock:      { select: { id: true, batchCode: true, currentCount: true } },
            penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
            recordedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });
      case 'FeedConsumption':
        return prisma.feedConsumption.findUnique({
          where: { id: referenceId },
          include: {
            flock:         { select: { id: true, batchCode: true, currentCount: true } },
            penSection:    { select: { id: true, name: true } },
            feedInventory: { select: { id: true, feedType: true } },
            recordedBy:    { select: { id: true, firstName: true, lastName: true } },
          },
        });
      case 'StoreReceipt':
        return prisma.storeReceipt.findUnique({
          where: { id: referenceId },
          include: {
            feedInventory: { select: { id: true, feedType: true } },
            supplier:      { select: { id: true, name: true } },
            receivedBy:    { select: { id: true, firstName: true, lastName: true } },
          },
        });
      case 'DailyReport':
        return prisma.dailyReport.findUnique({
          where: { id: referenceId },
          include: {
            penSection:  { select: { id: true, name: true } },
            submittedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });
      default:
        return null;
    }
  } catch { return null; }
}

async function updateSourceRecord(referenceType, referenceId, status, approverId) {
  const approvalData = status === 'APPROVED'
    ? { submissionStatus: 'APPROVED', approvedById: approverId, approvedAt: new Date() }
    : { submissionStatus: 'REJECTED' };

  switch (referenceType) {
    case 'EggProduction':
      return prisma.eggProduction.update({ where: { id: referenceId }, data: approvalData });
    case 'MortalityRecord':
      return prisma.mortalityRecord.update({ where: { id: referenceId }, data: approvalData });
    case 'DailyReport':
      return prisma.dailyReport.update({
        where: { id: referenceId },
        data: status === 'APPROVED'
          ? { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() }
          : { status: 'REJECTED' },
      });
    case 'StoreReceipt':
      return prisma.storeReceipt.update({
        where: { id: referenceId },
        data: { qualityStatus: 'PASSED', verifiedById: approverId, verifiedAt: new Date() },
      });
    default:
      return null;
  }
}

async function rejectSourceRecord(referenceType, referenceId, reason) {
  const rejectionData = {
    submissionStatus: 'PENDING',
    rejectionReason:  reason || 'Returned for correction',
  };
  switch (referenceType) {
    case 'EggProduction':
      return prisma.eggProduction.update({ where: { id: referenceId }, data: rejectionData });
    case 'MortalityRecord':
      return prisma.mortalityRecord.update({ where: { id: referenceId }, data: rejectionData });
    case 'DailyReport':
      return prisma.dailyReport.update({
        where: { id: referenceId },
        data:  { status: 'PENDING', rejectedReason: reason || 'Returned for correction' },
      });
    default:
      return null;
  }
}

async function notifyRejection(verification, reason, tenantId) {
  const sourceRecord = await fetchSourceRecord(verification.referenceType, verification.referenceId);
  if (!sourceRecord) return;
  const submitterId = sourceRecord.recordedById || sourceRecord.submittedById;
  if (!submitterId) return;
  await prisma.notification.create({
    data: {
      tenantId,
      recipientId: submitterId,
      type:        'REPORT_REJECTED',
      title:       `Record Rejected: ${verification.referenceType.replace(/([A-Z])/g, ' $1').trim()}`,
      message:     reason || 'Your submission was rejected. Please review and resubmit.',
      data: { verificationId: verification.id, referenceType: verification.referenceType, referenceId: verification.referenceId },
      channel: 'IN_APP',
    },
  });
}

async function sendRejectionSms(verification, reason, tenantId) {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const smsSettings = tenant?.settings?.sms;
    if (!smsSettings?.enabled || !smsSettings?.rejectionAlert?.enabled) return;
    const sourceRecord = await fetchSourceRecord(verification.referenceType, verification.referenceId);
    if (!sourceRecord) return;
    const submitterId = sourceRecord.recordedById || sourceRecord.submittedById;
    if (!submitterId) return;
    const worker = await prisma.user.findUnique({ where: { id: submitterId }, select: { phone: true, firstName: true } });
    if (!worker?.phone) return;
    let penName = 'your pen';
    if (sourceRecord.penSection?.pen?.name) penName = `${sourceRecord.penSection.pen.name} › ${sourceRecord.penSection.name}`;
    await sendRejectionAlert({
      workerName:  worker.firstName || 'Worker',
      recordType:  verification.referenceType,
      penName,
      reason,
      recipients:  [{ phone: worker.phone }],
    });
  } catch (err) { console.error('[SMS] Rejection alert error:', err.message); }
}

async function sendRejectionEmail(verification, reason, rejector, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { farmName: true, settings: true } });
  const emailSettings = resolveEmailSettings(tenant?.settings);
  if (!emailSettings?.enabled || !emailSettings?.verificationRejected?.enabled) return;
  const sourceRecord = await fetchSourceRecord(verification.referenceType, verification.referenceId);
  if (!sourceRecord) return;
  const submitterId = sourceRecord.recordedById || sourceRecord.submittedById;
  if (!submitterId) return;
  const worker = await prisma.user.findUnique({ where: { id: submitterId }, select: { email: true, firstName: true } });
  if (!worker?.email) return;
  let penName = null;
  if (sourceRecord.penSection?.pen?.name) penName = `${sourceRecord.penSection.pen.name} › ${sourceRecord.penSection.name}`;
  else if (sourceRecord.penSection?.name) penName = sourceRecord.penSection.name;
  const rejectorName = rejector ? [rejector.firstName, rejector.lastName].filter(Boolean).join(' ') || null : null;
  await sendVerificationRejectedEmail({
    to: worker.email, workerName: worker.firstName || 'Team member',
    farmName: tenant?.farmName || 'Farm', recordType: verification.referenceType,
    penName, rejectorName, reason,
  });
}

async function notifyResolution(existing, updated, resolver, tenantId) {
  const sourceRecord = await fetchSourceRecord(existing.referenceType, existing.referenceId);
  const resolverName = [resolver.firstName, resolver.lastName].filter(Boolean).join(' ');
  const recordLabel  = existing.referenceType.replace(/([A-Z])/g, ' $1').trim();
  const title   = `Discrepancy Resolved: ${recordLabel}`;
  const message = `${resolverName} has resolved the discrepancy.${updated.resolution ? ` Resolution: ${updated.resolution}` : ''}`;
  const recipientIds = new Set();
  if (existing.verifiedById) recipientIds.add(existing.verifiedById);
  if (sourceRecord) {
    const submitterId = sourceRecord.recordedById || sourceRecord.submittedById;
    if (submitterId) recipientIds.add(submitterId);
  }
  recipientIds.delete(resolver.sub);
  if (recipientIds.size === 0) return;
  await prisma.notification.createMany({
    data: [...recipientIds].map(id => ({
      tenantId, recipientId: id, type: 'REPORT_APPROVED',
      title, message,
      data: { verificationId: existing.id, referenceType: existing.referenceType },
      channel: 'IN_APP',
    })),
  });
}

async function notifyEscalation(verification, escalatedToId, tenantId) {
  await prisma.notification.create({
    data: {
      tenantId,
      recipientId: escalatedToId,
      type:        'ALERT',
      title:       `Escalated: ${verification.referenceType?.replace(/([A-Z])/g, ' $1').trim()}`,
      message:     `A ${verification.verificationType?.replace(/_/g, ' ')} discrepancy has been escalated and requires your review.`,
      data: { verificationId: verification.id, verificationType: verification.verificationType, referenceId: verification.referenceId },
      channel: 'IN_APP',
    },
  }).catch(() => {});
}
