// app/api/verification/[id]/route.js — Single verification: GET + PATCH (escalate / resolve)
import { NextResponse } from 'next/server';
import { sendRejectionAlert } from '@/lib/services/sms';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const VERIFIER_ROLES = ['PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MANAGER_ROLES  = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const REJECT_ROLES   = ['PEN_MANAGER', 'STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// Valid status transitions
const STATUS_TRANSITIONS = {
  PENDING:           ['VERIFIED', 'DISCREPANCY_FOUND'],
  DISCREPANCY_FOUND: ['ESCALATED', 'RESOLVED'],
  ESCALATED:         ['RESOLVED'],
  VERIFIED:          [],   // terminal
  RESOLVED:          [],   // terminal
};

const patchSchema = z.object({
  status:            z.enum(['VERIFIED', 'DISCREPANCY_FOUND', 'ESCALATED', 'RESOLVED']).optional(),
  discrepancyAmount: z.number().nullable().optional(),
  discrepancyNotes:  z.string().nullable().optional(),
  resolution:        z.string().nullable().optional(),
  escalatedToId:     z.string().min(1).nullable().optional(),
  // When rejecting (sending back to worker for resubmission)
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
        store:      true,
        verifiedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    if (!verification)
      return NextResponse.json({ error: 'Verification not found' }, { status: 404 });

    // Fetch the original source record for full context
    const sourceRecord = await fetchSourceRecord(
      verification.referenceType,
      verification.referenceId
    );

    return NextResponse.json({ verification, sourceRecord });
  } catch (error) {
    console.error('Verification get error:', error);
    return NextResponse.json({ error: 'Failed to fetch verification' }, { status: 500 });
  }
}

// ─── PATCH /api/verification/[id] ────────────────────────────────────────────
// Handles:
//  - Escalating a discrepancy to farm manager
//  - Resolving a discrepancy
//  - Rejecting a record (sends back to worker)
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
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

    // ── Role checks for sensitive transitions ──────────────────────────────────
    if (data.status === 'ESCALATED' && !VERIFIER_ROLES.includes(user.role))
      return NextResponse.json({ error: 'Insufficient permissions to escalate' }, { status: 403 });

    if (data.status === 'RESOLVED' && !MANAGER_ROLES.includes(user.role))
      return NextResponse.json({ error: 'Only managers can mark discrepancies as resolved' }, { status: 403 });

    // ── Validate status transition ─────────────────────────────────────────────
    if (data.status && data.status !== existing.status) {
      const allowed = STATUS_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        return NextResponse.json({
          error: `Invalid transition: ${existing.status} → ${data.status}`,
          allowedTransitions: allowed,
        }, { status: 422 });
      }
    }

    // ── Handle rejection (send back to worker) ─────────────────────────────────
    if (data.reject) {
      if (!REJECT_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Insufficient permissions to reject records' }, { status: 403 });

      await rejectSourceRecord(existing.referenceType, existing.referenceId, data.rejectReason);

      // Notify the original submitter
      await notifyRejection(existing, data.rejectReason, user.tenantId).catch(() => {});
      await sendRejectionSms(existing, data.rejectReason, user.tenantId).catch(() => {});

      const updated = await prisma.verification.update({
        where: { id: params.id },
        data:  { status: 'DISCREPANCY_FOUND', discrepancyNotes: data.rejectReason || 'Record rejected for resubmission' },
        include: { verifiedBy: { select: { id: true, firstName: true, lastName: true } } },
      });

      return NextResponse.json({ verification: updated });
    }

    // ── Standard status update ─────────────────────────────────────────────────
    const updateData = {
      ...(data.status            !== undefined && { status: data.status }),
      ...(data.discrepancyAmount !== undefined && { discrepancyAmount: data.discrepancyAmount }),
      ...(data.discrepancyNotes  !== undefined && { discrepancyNotes: data.discrepancyNotes }),
      ...(data.resolution        !== undefined && { resolution: data.resolution }),
      // Escalation fields
      ...(data.status === 'ESCALATED' && {
        escalatedAt:    new Date(),
        escalatedToId:  data.escalatedToId ?? null,
      }),
      // Resolution fields
      ...(data.status === 'RESOLVED' && {
        resolvedById: user.sub,
        resolvedAt:   new Date(),
      }),
    };

    const updated = await prisma.verification.update({
      where: { id: params.id },
      data:  updateData,
      include: {
        store:      { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Update source record if resolving
    if (data.status === 'RESOLVED') {
      await updateSourceRecord(existing.referenceType, existing.referenceId, 'APPROVED', user.sub).catch(() => {});
    }

    // Notify escalation target
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
  } catch {
    return null;
  }
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
  // Return to PENDING with rejectionReason so worker can see and correct it
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
  // Find who submitted the original record and notify them
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
      data: {
        verificationId: verification.id,
        referenceType:  verification.referenceType,
        referenceId:    verification.referenceId,
      },
      channel: 'IN_APP',
    },
  });
}

async function sendRejectionSms(verification, reason, tenantId) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const smsSettings = tenant?.settings?.sms;
    if (!smsSettings?.enabled || !smsSettings?.rejectionAlert?.enabled) return;

    const sourceRecord = await fetchSourceRecord(verification.referenceType, verification.referenceId);
    if (!sourceRecord) return;

    const submitterId = sourceRecord.recordedById || sourceRecord.submittedById;
    if (!submitterId) return;

    const worker = await prisma.user.findUnique({
      where: { id: submitterId },
      select: { phone: true, firstName: true },
    });
    if (!worker?.phone) return;

    // Get pen name from source record
    let penName = 'your pen';
    if (sourceRecord.penSection?.pen?.name) {
      penName = `${sourceRecord.penSection.pen.name} › ${sourceRecord.penSection.name}`;
    }

    await sendRejectionAlert({
      workerName:  worker.firstName || 'Worker',
      recordType:  verification.referenceType,
      penName,
      reason,
      recipients:  [{ phone: worker.phone }],
    });
  } catch (err) {
    console.error('[SMS] Rejection alert error:', err.message);
  }
}

async function notifyEscalation(verification, escalatedToId, tenantId) {
  await prisma.notification.create({
    data: {
      tenantId,
      recipientId: escalatedToId,
      type:        'ALERT',
      title:       `Verification Escalated to You`,
      message:     `A ${verification.verificationType.replace(/_/g, ' ')} discrepancy has been escalated and requires your review.`,
      data: {
        verificationId: verification.id,
        verificationType: verification.verificationType,
      },
      channel: 'IN_APP',
    },
  });
}