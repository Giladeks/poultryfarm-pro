// app/api/verification/route.js — List pending items + create verifications
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const VERIFIER_ROLES  = ['STORE_MANAGER', 'STORE_CLERK', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MANAGER_ROLES   = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const createVerificationSchema = z.object({
  storeId:           z.string().uuid().optional().nullable(),  // optional — resolved server-side if omitted
  verificationType:  z.enum(['DAILY_PRODUCTION', 'FEED_RECEIPT', 'INVENTORY_COUNT', 'FINANCIAL_RECORD', 'MORTALITY_REPORT']),
  referenceId:       z.string(),
  referenceType:     z.string(),
  verificationDate:  z.string(),
  status:            z.enum(['VERIFIED', 'DISCREPANCY_FOUND']),
  discrepancyAmount: z.number().optional().nullable(),
  discrepancyNotes:  z.string().optional().nullable(),
  resolution:        z.string().optional().nullable(),
});

// ─── GET /api/verification ─────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VERIFIER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const type        = searchParams.get('type');
  const status      = searchParams.get('status');
  const from        = searchParams.get('from');
  const to          = searchParams.get('to');
  const pendingOnly = searchParams.get('pendingOnly') === 'true';
  const limit       = parseInt(searchParams.get('limit') || '50', 10);

  try {
    const tenantStores = await prisma.store.findMany({
      where: { farm: { tenantId: user.tenantId } },
      select: { id: true },
    });
    const storeIds = tenantStores.map(s => s.id);

    const verifications = pendingOnly ? [] : await prisma.verification.findMany({
      where: {
        tenantId: user.tenantId,
        ...(type   && { verificationType: type }),
        ...(status && { status }),
        ...((from || to) && {
          verificationDate: {
            ...(from && { gte: new Date(from) }),
            ...(to   && { lte: new Date(to) }),
          },
        }),
      },
      include: {
        store:      { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });

    const alreadyVerifiedIds = await prisma.verification.findMany({
      where: { tenantId: user.tenantId },
      select: { referenceId: true },
    }).then(rows => new Set(rows.map(r => r.referenceId)));

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Egg production — PENDING
    const pendingEggs = await prisma.eggProduction.findMany({
      where: {
        submissionStatus: 'PENDING',
        collectionDate:   { gte: sevenDaysAgo },
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: {
        flock:      { select: { id: true, batchCode: true } },
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { collectionDate: 'desc' },
      take: 50,
    }).then(rows => rows
      .filter(r => !alreadyVerifiedIds.has(r.id))
      .map(r => ({
        id:            r.id,
        referenceId:   r.id,
        referenceType: 'EggProduction',
        type:          'DAILY_PRODUCTION',
        date:          r.collectionDate,
        summary:       `${r.totalEggs} eggs (${r.gradeACount} Grade A, ${r.gradeBCount} Grade B, ${r.crackedCount} cracked)`,
        submittedBy:   `${r.recordedBy.firstName} ${r.recordedBy.lastName}`,
        context:       `${r.penSection.pen?.name} — ${r.penSection.name} | Flock: ${r.flock.batchCode}`,
        layingRate:    r.layingRatePct,
        storeId:       null,
      }))
    );

    // Mortality records — PENDING
    const pendingMortality = await prisma.mortalityRecord.findMany({
      where: {
        submissionStatus: 'PENDING',
        recordDate:       { gte: sevenDaysAgo },
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: {
        flock:      { select: { id: true, batchCode: true, operationType: true } },
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { recordDate: 'desc' },
      take: 50,
    }).then(rows => rows
      .filter(r => !alreadyVerifiedIds.has(r.id))
      .map(r => ({
        id:            r.id,
        referenceId:   r.id,
        referenceType: 'MortalityRecord',
        type:          'MORTALITY_REPORT',
        date:          r.recordDate,
        summary:       `${r.count} bird${r.count !== 1 ? 's' : ''} — ${r.causeCode.replace(/_/g, ' ')}`,
        submittedBy:   `${r.recordedBy.firstName} ${r.recordedBy.lastName}`,
        context:       `${r.penSection.pen?.name} — ${r.penSection.name} | Flock: ${r.flock.batchCode} (${r.flock.operationType})`,
        severity:      r.count >= 10 ? 'HIGH' : r.count >= 5 ? 'MEDIUM' : 'LOW',
        storeId:       null,
      }))
    );

    // Feed consumption — unverified
    const pendingFeed = await prisma.feedConsumption.findMany({
      where: {
        recordedDate: { gte: sevenDaysAgo },
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: {
        flock:         { select: { id: true, batchCode: true } },
        penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
        feedInventory: { select: { id: true, feedType: true, costPerKg: true } },
        recordedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { recordedDate: 'desc' },
      take: 50,
    }).then(rows => rows
      .filter(r => !alreadyVerifiedIds.has(r.id))
      .map(r => ({
        id:            r.id,
        referenceId:   r.id,
        referenceType: 'FeedConsumption',
        type:          'FEED_RECEIPT',
        date:          r.recordedDate,
        summary:       `${Number(r.quantityKg).toFixed(1)} kg of ${r.feedInventory?.feedType}`,
        submittedBy:   `${r.recordedBy.firstName} ${r.recordedBy.lastName}`,
        context:       `${r.penSection.pen?.name} — ${r.penSection.name} | Flock: ${r.flock.batchCode}`,
        costAtTime:    Number(r.quantityKg) * Number(r.costAtTime),
        storeId:       null,
      }))
    );

    // Feed store receipts — PENDING QC
    const pendingReceipts = await prisma.storeReceipt.findMany({
      where: {
        storeId:         { in: storeIds },
        feedInventoryId: { not: null },
        qualityStatus:   'PENDING',
        receiptDate:     { gte: sevenDaysAgo },
      },
      include: {
        store:         { select: { id: true, name: true } },
        feedInventory: { select: { id: true, feedType: true } },
        supplier:      { select: { id: true, name: true } },
        receivedBy:    { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { receiptDate: 'desc' },
      take: 30,
    }).then(rows => rows
      .filter(r => !alreadyVerifiedIds.has(r.id))
      .map(r => ({
        id:            r.id,
        referenceId:   r.id,
        referenceType: 'StoreReceipt',
        type:          'FEED_RECEIPT',
        date:          r.receiptDate,
        summary:       `${Number(r.quantityReceived).toFixed(1)} kg received — ${fmtNGN(r.totalCost)}`,
        submittedBy:   `${r.receivedBy.firstName} ${r.receivedBy.lastName}`,
        context:       `${r.feedInventory?.feedType} | Supplier: ${r.supplier?.name || '—'} | Ref: ${r.referenceNumber || '—'}`,
        storeId:       r.storeId,
      }))
    );

    // Daily reports — PENDING approval
    const pendingReports = await prisma.dailyReport.findMany({
      where: {
        status:     'PENDING',
        reportDate: { gte: sevenDaysAgo },
        farm:       { tenantId: user.tenantId },
      },
      include: {
        farm:        { select: { id: true, name: true } },
        penSection:  { select: { id: true, name: true } },
        submittedBy: { select: { id: true, firstName: true, lastName: true } },
        flock:       { select: { id: true, batchCode: true } },
      },
      orderBy: { reportDate: 'desc' },
      take: 30,
    }).then(rows => rows
      .filter(r => !alreadyVerifiedIds.has(r.id))
      .map(r => ({
        id:            r.id,
        referenceId:   r.id,
        referenceType: 'DailyReport',
        type:          'DAILY_PRODUCTION',
        date:          r.reportDate,
        summary:       `Mortality: ${r.totalMortality} | Feed: ${Number(r.totalFeedKg).toFixed(1)} kg${r.totalEggs ? ` | Eggs: ${r.totalEggs}` : ''}`,
        submittedBy:   `${r.submittedBy.firstName} ${r.submittedBy.lastName}`,
        context:       `${r.farm.name} — ${r.penSection.name}${r.flock ? ` | Flock: ${r.flock.batchCode}` : ''}`,
        storeId:       null,
      }))
    );

    let pendingQueue = [
      ...pendingEggs,
      ...pendingMortality,
      ...pendingFeed,
      ...pendingReceipts,
      ...pendingReports,
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (type) {
      pendingQueue = pendingQueue.filter(i => i.type === type);
    }

    const summary = {
      totalPending:     pendingQueue.length,
      byType: {
        DAILY_PRODUCTION: pendingQueue.filter(i => i.type === 'DAILY_PRODUCTION').length,
        FEED_RECEIPT:     pendingQueue.filter(i => i.type === 'FEED_RECEIPT').length,
        MORTALITY_REPORT: pendingQueue.filter(i => i.type === 'MORTALITY_REPORT').length,
        INVENTORY_COUNT:  pendingQueue.filter(i => i.type === 'INVENTORY_COUNT').length,
        FINANCIAL_RECORD: pendingQueue.filter(i => i.type === 'FINANCIAL_RECORD').length,
      },
      discrepancies: verifications.filter(v => v.status === 'DISCREPANCY_FOUND').length,
      escalated:     verifications.filter(v => v.status === 'ESCALATED').length,
    };

    return NextResponse.json({ verifications, pendingQueue, summary });
  } catch (error) {
    console.error('Verification fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 });
  }
}

// ─── POST /api/verification ────────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VERIFIER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createVerificationSchema.parse(body);

    // ── Resolve storeId server-side if not provided ────────────────────────────
    let resolvedStoreId = data.storeId;
    if (!resolvedStoreId) {
      const firstStore = await prisma.store.findFirst({
        where: { farm: { tenantId: user.tenantId } },
        select: { id: true },
      });
      if (!firstStore)
        return NextResponse.json({ error: 'No store found for this tenant' }, { status: 404 });
      resolvedStoreId = firstStore.id;
    } else {
      const store = await prisma.store.findFirst({
        where: { id: resolvedStoreId, farm: { tenantId: user.tenantId } },
      });
      if (!store)
        return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    // Prevent duplicate verification
    const existing = await prisma.verification.findFirst({
      where: { tenantId: user.tenantId, referenceId: data.referenceId },
    });
    if (existing)
      return NextResponse.json({ error: 'This record has already been verified', verification: existing }, { status: 409 });

    // Create verification record
    const verification = await prisma.verification.create({
      data: {
        tenantId:          user.tenantId,
        storeId:           resolvedStoreId,
        verifiedById:      user.sub,
        verificationType:  data.verificationType,
        referenceId:       data.referenceId,
        referenceType:     data.referenceType,
        verificationDate:  new Date(data.verificationDate),
        status:            data.status,
        discrepancyAmount: data.discrepancyAmount ?? null,
        discrepancyNotes:  data.discrepancyNotes  ?? null,
        resolution:        data.resolution        ?? null,
      },
      include: {
        store:      { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Update source record status
    const newStatus = data.status === 'VERIFIED' ? 'APPROVED' : 'PENDING';
    await updateSourceRecord(data.referenceType, data.referenceId, newStatus, user.sub).catch(() => {});

    // Notify on discrepancy
    if (data.status === 'DISCREPANCY_FOUND') {
      await notifyDiscrepancy(verification, data, user.tenantId).catch(() => {});
    }

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'Verification',
        entityId:   verification.id,
        changes: {
          referenceType:     data.referenceType,
          referenceId:       data.referenceId,
          status:            data.status,
          discrepancyAmount: data.discrepancyAmount,
        },
      },
    }).catch(() => {});

    return NextResponse.json({ verification }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Verification create error:', error);
    return NextResponse.json({ error: 'Failed to create verification' }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function updateSourceRecord(referenceType, referenceId, status, approverId) {
  const approvalData = status === 'APPROVED'
    ? { submissionStatus: 'APPROVED', approvedById: approverId, approvedAt: new Date() }
    : { submissionStatus: 'PENDING' };

  switch (referenceType) {
    case 'EggProduction':
      return prisma.eggProduction.update({ where: { id: referenceId }, data: approvalData });
    case 'MortalityRecord':
      return prisma.mortalityRecord.update({ where: { id: referenceId }, data: approvalData });
    case 'BroilerHarvest':
      return prisma.broilerHarvest.update({ where: { id: referenceId }, data: approvalData });
    case 'DailyReport':
      return prisma.dailyReport.update({
        where: { id: referenceId },
        data: status === 'APPROVED'
          ? { status: 'APPROVED', approvedById: approverId, approvedAt: new Date() }
          : { status: 'PENDING' },
      });
    case 'StoreReceipt':
      return prisma.storeReceipt.update({
        where: { id: referenceId },
        data: { qualityStatus: status === 'APPROVED' ? 'PASSED' : 'PENDING', verifiedById: approverId, verifiedAt: new Date() },
      });
    default:
      return null;
  }
}

async function notifyDiscrepancy(verification, data, tenantId) {
  const recipients = await prisma.user.findMany({
    where: {
      tenantId,
      role:     { in: ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON'] },
      isActive: true,
    },
    select: { id: true },
  });

  if (!recipients.length) return;

  await prisma.notification.createMany({
    data: recipients.map(r => ({
      tenantId,
      recipientId: r.id,
      type:        'ALERT',
      title:       `Verification Discrepancy: ${data.referenceType}`,
      message:     data.discrepancyNotes || 'A discrepancy was found during verification and requires review.',
      data: {
        verificationId:    verification.id,
        referenceType:     data.referenceType,
        referenceId:       data.referenceId,
        discrepancyAmount: data.discrepancyAmount,
      },
      channel: 'IN_APP',
    })),
  });
}

function fmtNGN(n) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n ?? 0));
}
