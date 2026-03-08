// app/api/feed/mill/[id]/route.js — Single mill batch: GET + PATCH (status + QC)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['FEED_MILL_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const QC_ROLES      = ['QC_TECHNICIAN', 'FEED_MILL_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'SUPER_ADMIN'];

// Valid status transitions
const STATUS_TRANSITIONS = {
  PLANNED:       ['IN_PRODUCTION', 'REJECTED'],
  IN_PRODUCTION: ['PRODUCED', 'REJECTED'],
  PRODUCED:      ['QC_PASSED', 'QC_FAILED'],
  QC_PASSED:     ['RELEASED'],
  QC_FAILED:     ['REJECTED', 'IN_PRODUCTION'],  // can retry
  RELEASED:      [],
  REJECTED:      [],
};

const patchSchema = z.object({
  // Status transition
  status:           z.enum(['PLANNED','IN_PRODUCTION','PRODUCED','QC_PASSED','QC_FAILED','RELEASED','REJECTED']).optional(),
  actualQuantityKg: z.number().positive().optional(),
  costPerKg:        z.number().min(0).optional(),
  notes:            z.string().nullable().optional(),

  // QC test to add inline
  qcTest: z.object({
    testType:    z.string().min(2),
    testDate:    z.string(),
    result:      z.string(),
    passedSpec:  z.boolean(),
    specMin:     z.number().optional().nullable(),
    specMax:     z.number().optional().nullable(),
    notes:       z.string().optional().nullable(),
  }).optional(),

  // Release to store: link to a FeedInventory item
  releaseToStoreId: z.string().uuid().optional(),
});

// ─── GET /api/feed/mill/[id] ──────────────────────────────────────────────────
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const batch = await prisma.feedMillBatch.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        farm:       { select: { id: true, name: true } },
        producedBy: { select: { id: true, firstName: true, lastName: true } },
        qcTests: {
          orderBy: { testDate: 'desc' },
          include: {
            testedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
      },
    });

    if (!batch)
      return NextResponse.json({ error: 'Feed mill batch not found' }, { status: 404 });

    // Derive QC summary
    const passedTests  = batch.qcTests.filter(t => t.passedSpec).length;
    const failedTests  = batch.qcTests.filter(t => !t.passedSpec).length;
    const qcSummary    = {
      total:  batch.qcTests.length,
      passed: passedTests,
      failed: failedTests,
      passRate: batch.qcTests.length > 0
        ? parseFloat(((passedTests / batch.qcTests.length) * 100).toFixed(1))
        : null,
    };

    return NextResponse.json({ batch, qcSummary });
  } catch (error) {
    console.error('Feed mill batch get error:', error);
    return NextResponse.json({ error: 'Failed to fetch feed mill batch' }, { status: 500 });
  }
}

// ─── PATCH /api/feed/mill/[id] ────────────────────────────────────────────────
// Handles status transitions, QC test logging, and release to store.
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    const existing = await prisma.feedMillBatch.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!existing)
      return NextResponse.json({ error: 'Feed mill batch not found' }, { status: 404 });

    // ── Role checks ────────────────────────────────────────────────────────────
    // QC tests can be added by QC roles
    if (data.qcTest && !QC_ROLES.includes(user.role))
      return NextResponse.json({ error: 'Insufficient permissions to add QC tests' }, { status: 403 });

    // Status changes require manager role
    if (data.status && !MANAGER_ROLES.includes(user.role) && !QC_ROLES.includes(user.role))
      return NextResponse.json({ error: 'Insufficient permissions to change batch status' }, { status: 403 });

    // ── Validate status transition ─────────────────────────────────────────────
    if (data.status && data.status !== existing.status) {
      const allowed = STATUS_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        return NextResponse.json({
          error: `Invalid status transition: ${existing.status} → ${data.status}`,
          allowedTransitions: allowed,
        }, { status: 422 });
      }
    }

    const ops = [];

    // ── Update batch ───────────────────────────────────────────────────────────
    const batchUpdateData = {
      ...(data.status           !== undefined && { status: data.status }),
      ...(data.actualQuantityKg !== undefined && { actualQuantityKg: data.actualQuantityKg }),
      ...(data.costPerKg        !== undefined && { costPerKg: data.costPerKg }),
      ...(data.notes            !== undefined && { notes: data.notes }),
      // Auto-set QC certified fields
      ...(data.status === 'QC_PASSED' && {
        qcStatus:         'PASSED',
        qcCertifiedById:  user.sub,
        qcCertifiedAt:    new Date(),
      }),
      ...(data.status === 'QC_FAILED' && { qcStatus: 'FAILED' }),
      ...(data.status === 'RELEASED'  && { releasedToStoreAt: new Date() }),
    };

    ops.push(
      prisma.feedMillBatch.update({
        where: { id: params.id },
        data: batchUpdateData,
        include: {
          farm:       { select: { id: true, name: true } },
          producedBy: { select: { id: true, firstName: true, lastName: true } },
          qcTests:    { orderBy: { testDate: 'desc' } },
        },
      })
    );

    // ── Add QC test ────────────────────────────────────────────────────────────
    if (data.qcTest) {
      ops.push(
        prisma.qCTest.create({
          data: {
            feedMillBatchId: params.id,
            testType:        data.qcTest.testType,
            testedById:      user.sub,
            testDate:        new Date(data.qcTest.testDate),
            result:          data.qcTest.result,
            passedSpec:      data.qcTest.passedSpec,
            specMin:         data.qcTest.specMin ?? null,
            specMax:         data.qcTest.specMax ?? null,
            notes:           data.qcTest.notes ?? null,
          },
        })
      );
    }

    // ── Release to store: add quantity to FeedInventory ───────────────────────
    if (data.status === 'RELEASED' && data.releaseToStoreId) {
      const releasedQty = data.actualQuantityKg ?? Number(existing.targetQuantityKg);
      ops.push(
        prisma.feedInventory.update({
          where: { id: data.releaseToStoreId },
          data:  { currentStockKg: { increment: releasedQty } },
        })
      );
    }

    const [updated] = await prisma.$transaction(ops);

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'FeedMillBatch',
        entityId:   params.id,
        changes: {
          statusBefore: existing.status,
          statusAfter:  data.status ?? existing.status,
          qcTestAdded:  !!data.qcTest,
          released:     data.status === 'RELEASED',
        },
      },
    }).catch(() => {});

    // Notify on RELEASED or QC_FAILED
    if (data.status === 'RELEASED' || data.status === 'QC_FAILED') {
      await notifyMillEvent(existing.batchCode, data.status, user.tenantId).catch(() => {});
    }

    return NextResponse.json({ batch: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed mill batch update error:', error);
    return NextResponse.json({ error: 'Failed to update feed mill batch' }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function notifyMillEvent(batchCode, status, tenantId) {
  const notifyRoles = status === 'QC_FAILED'
    ? ['FEED_MILL_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN']
    : ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN'];

  const recipients = await prisma.user.findMany({
    where: { tenantId, role: { in: notifyRoles }, isActive: true },
    select: { id: true },
  });

  if (!recipients.length) return;

  const isFailure = status === 'QC_FAILED';

  await prisma.notification.createMany({
    data: recipients.map(r => ({
      tenantId,
      recipientId: r.id,
      type:        'ALERT',
      title:       isFailure
        ? `Feed Mill QC Failed: Batch ${batchCode}`
        : `Feed Batch Released to Store: ${batchCode}`,
      message: isFailure
        ? `Batch ${batchCode} failed QC inspection and requires review.`
        : `Batch ${batchCode} has passed QC and been released to the feed store.`,
      data:    { batchCode, status },
      channel: 'IN_APP',
    })),
  });
}