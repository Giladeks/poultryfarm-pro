// app/api/verification/route.js — List pending items + create verifications
// Update: pending EggProduction items now carry needsGrading flag + worker fields
// so the GradingModal can be opened directly from the verification queue.
// Update: POST and GET now enforce the conflict-of-interest guard.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { checkConflictOfInterest } from '@/lib/utils/conflictOfInterest';

const VERIFIER_ROLES  = ['PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MANAGER_ROLES   = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const MANAGEMENT_OVERRIDE = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const RECORD_TYPE_VERIFIERS = {
  EggProduction:   [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
  MortalityRecord: [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
  FeedConsumption: [...new Set(['PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK', ...MANAGEMENT_OVERRIDE])],
  StoreReceipt:    [...new Set(['STORE_MANAGER',                  ...MANAGEMENT_OVERRIDE])],
  DailyReport:     [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
};
const ROLE_VISIBLE_TYPES = {
  PEN_MANAGER:   ['EggProduction', 'MortalityRecord', 'DailyReport', 'FeedConsumption'],
  STORE_CLERK:   ['FeedConsumption'],
  STORE_MANAGER: ['FeedConsumption', 'StoreReceipt'],
  FARM_MANAGER:  null,
  FARM_ADMIN:    null,
  CHAIRPERSON:   null,
  SUPER_ADMIN:   null,
};
function canVerifyRecordType(role, referenceType) {
  const allowed = RECORD_TYPE_VERIFIERS[referenceType];
  return !allowed || allowed.includes(role);
}

const createVerificationSchema = z.object({
  storeId:           z.string().uuid().optional().nullable(),
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
  const statusParam = searchParams.getAll('status');
  const status      = statusParam.length > 0 ? statusParam : null;
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
        ...(status && {
          status: status.length === 1 ? status[0] : { in: status },
        }),
        ...((from || to) && {
          verificationDate: {
            ...(from && { gte: new Date(from) }),
            ...(to   && { lte: new Date(to) }),
          },
        }),
      },
      include: {
        store:       { select: { id: true, name: true } },
        verifiedBy:  { select: { id: true, firstName: true, lastName: true, role: true } },
        escalatedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });

    const existingVerifications = await prisma.verification.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, referenceId: true, status: true },
    });
    const alreadyVerifiedIds = new Set(
      existingVerifications
        .filter(v => ['VERIFIED', 'RESOLVED'].includes(v.status))
        .map(v => v.referenceId)
    );
    const verificationIdByRef = Object.fromEntries(
      existingVerifications.map(v => [v.referenceId, v.id])
    );

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // ── PM section scoping ────────────────────────────────────────────────────
    // PEN_MANAGER should only see pending items from their assigned sections.
    // Management roles (FARM_MANAGER+) see all sections.
    const PM_SCOPED_ROLES = ['PEN_MANAGER'];
    let allowedSectionIds = null;

    if (PM_SCOPED_ROLES.includes(user.role)) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub },
        select: { penSectionId: true },
      });
      allowedSectionIds = assignments.map(a => a.penSectionId);
      // If a PM has no assignments, return empty pending queue
      if (allowedSectionIds.length === 0) {
        const [discrepancyCount, escalatedCount] = await Promise.all([
          prisma.verification.count({ where: { tenantId: user.tenantId, status: 'DISCREPANCY_FOUND' } }),
          prisma.verification.count({ where: { tenantId: user.tenantId, status: 'ESCALATED' } }),
        ]);
        return NextResponse.json({
          verifications: [],
          pendingQueue:  [],
          summary: { totalPending: 0, byType: { DAILY_PRODUCTION: 0, FEED_RECEIPT: 0, MORTALITY_REPORT: 0, INVENTORY_COUNT: 0, FINANCIAL_RECORD: 0 }, discrepancies: discrepancyCount, escalated: escalatedCount },
          viewerRole: user.role,
        });
      }
    }

    // Helper: build Prisma where clause filtered by allowed sections
    const withSectionScope = (baseWhere) => ({
      ...baseWhere,
      ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
    });

    // ── Egg production — PENDING ───────────────────────────────────────────────
    const pendingEggs = await prisma.eggProduction.findMany({
      where: withSectionScope({
        submissionStatus: 'PENDING',
        collectionDate:   { gte: sevenDaysAgo },
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      }),
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
        // Show grading-pending label when PM hasn't entered Grade B yet
        summary: r.gradeACount !== null
          ? `${r.totalEggs} eggs (${r.gradeACount} Grade A, ${r.gradeBCount} Grade B, ${r.crackedCount} cracked)`
          : `${r.totalEggs} eggs — awaiting Grade B entry`,
        submittedBy:   `${r.recordedBy.firstName} ${r.recordedBy.lastName}`,
        context:       `${r.penSection.pen?.name} — ${r.penSection.name} | Flock: ${r.flock.batchCode}`,
        layingRate:    r.layingRatePct,
        storeId:       null,
        resubmitted:   !!r.rejectionReason,
        verificationId: verificationIdByRef[r.id] || null,
        // ── Grading fields — consumed by GradingModal ──────────────────────
        needsGrading:      r.gradeACount === null,
        totalEggs:         r.totalEggs,
        cratesCollected:   r.cratesCollected,
        looseEggs:         r.looseEggs,
        crackedCount:      r.crackedCount,
        collectionDate:    r.collectionDate,
        collectionSession: r.collectionSession,
        penSection:        { name: r.penSection.name, pen: { name: r.penSection.pen?.name } },
        flock:             { batchCode: r.flock.batchCode },
        // ── COI detection fields ───────────────────────────────────────────
        penSectionId:  r.penSectionId,
        recordedById:  r.recordedBy.id,
      }))
    );

    // ── Mortality records — PENDING ───────────────────────────────────────────
    const pendingMortality = await prisma.mortalityRecord.findMany({
      where: withSectionScope({
        submissionStatus: 'PENDING',
        recordDate:       { gte: sevenDaysAgo },
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      }),
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
        severity:       r.count >= 10 ? 'HIGH' : r.count >= 5 ? 'MEDIUM' : 'LOW',
        storeId:       null,
        resubmitted:   !!r.rejectionReason,
        verificationId: verificationIdByRef[r.id] || null,
        // ── COI detection fields ───────────────────────────────────────────
        penSectionId:  r.penSectionId,
        recordedById:  r.recordedBy.id,
      }))
    );

    // ── Feed consumption — unverified ─────────────────────────────────────────
    const pendingFeed = await prisma.feedConsumption.findMany({
      where: withSectionScope({
        recordedDate: { gte: sevenDaysAgo },
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      }),
      include: {
        flock:         { select: { id: true, batchCode: true } },
        penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
        feedInventory: { select: { id: true, feedType: true, costPerKg: true, storeId: true } },
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
        storeId:       r.feedInventory?.storeId || null,
        recordedById:  r.recordedBy.id,
        penSectionId:  r.penSectionId,
        verificationId: verificationIdByRef[r.id] || null,
      }))
    );

    // ── Feed store receipts — PENDING QC ──────────────────────────────────────
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
        recordedById:  r.receivedBy.id,
        verificationId: verificationIdByRef[r.id] || null,
      }))
    );

    // ── Daily reports — PENDING approval ─────────────────────────────────────
    const pendingReports = await prisma.dailyReport.findMany({
      where: withSectionScope({
        status:     'PENDING',
        reportDate: { gte: sevenDaysAgo },
        farm:       { tenantId: user.tenantId },
      }),
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
        verificationId: verificationIdByRef[r.id] || null,
      }))
    );

    let pendingQueue = [
      ...pendingEggs,
      ...pendingMortality,
      ...pendingFeed,
      ...pendingReceipts,
      ...pendingReports,
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    // Scope pending queue to what this role can act on
    const visibleTypes = ROLE_VISIBLE_TYPES[user.role]; // null = see all
    if (visibleTypes) {
      pendingQueue = pendingQueue.filter(i => visibleTypes.includes(i.referenceType));
    }
    pendingQueue = pendingQueue.map(i => ({
      ...i,
      canVerify: canVerifyRecordType(user.role, i.referenceType),
    }));

    // ── Conflict-of-interest check for each pending item ──────────────────────
    const COI_EXEMPT       = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
    const STORE_SCOPED_COI = ['STORE_MANAGER','STORE_CLERK'];

    if (!COI_EXEMPT.includes(user.role)) {
      // ── Store-scoped COI (Store Manager / Store Clerk) ────────────────────
      if (STORE_SCOPED_COI.includes(user.role)) {
        // Collect all store receipts and feed consumption the user logged in the last 7 days
        const [ownReceipts, ownStoreFeed] = await Promise.all([
          prisma.storeReceipt.findMany({
            where:  { receivedById: user.sub, receiptDate: { gte: sevenDaysAgo } },
            select: { storeId: true, receiptDate: true },
          }),
          prisma.feedConsumption.findMany({
            where:  { recordedById: user.sub, recordedDate: { gte: sevenDaysAgo } },
            select: { feedInventory: { select: { storeId: true } }, recordedDate: true },
          }),
        ]);

        // Build set of "storeId|YYYY-MM-DD" strings the user submitted
        const ownStoreSubmissions = new Set();
        const toStoreKey = (storeId, date) =>
          `${storeId}|${new Date(date).toISOString().slice(0, 10)}`;

        ownReceipts.forEach(r => ownStoreSubmissions.add(toStoreKey(r.storeId, r.receiptDate)));
        ownStoreFeed.forEach(r => {
          if (r.feedInventory?.storeId)
            ownStoreSubmissions.add(toStoreKey(r.feedInventory.storeId, r.recordedDate));
        });

        pendingQueue = pendingQueue.map(item => {
          const selfSubmitted = item.recordedById === user.sub;
          const itemDate  = item.date ? new Date(item.date).toISOString().slice(0, 10) : null;
          const sameStore = item.storeId && itemDate
            ? ownStoreSubmissions.has(toStoreKey(item.storeId, itemDate))
            : false;

          const coiBlocked = selfSubmitted || sameStore;
          const coiReason  = selfSubmitted
            ? 'You logged this record — a different Store Manager must verify it'
            : sameStore
              ? 'You logged records in this store today — a different Store Manager must verify'
              : null;

          return { ...item, coiBlocked, coiReason };
        });

      } else {
        // ── Pen-scoped COI (Pen Manager) ────────────────────────────────────
        const [ownEggs, ownMort, ownFeed] = await Promise.all([
          prisma.eggProduction.findMany({
            where: {
              recordedById: user.sub,
              collectionDate: { gte: sevenDaysAgo },
              ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
            },
            select: { penSectionId: true, collectionDate: true },
          }),
          prisma.mortalityRecord.findMany({
            where: {
              recordedById: user.sub,
              recordDate: { gte: sevenDaysAgo },
              ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
            },
            select: { penSectionId: true, recordDate: true },
          }),
          prisma.feedConsumption.findMany({
            where: {
              recordedById: user.sub,
              recordedDate: { gte: sevenDaysAgo },
              ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
            },
            select: { penSectionId: true, recordedDate: true },
          }),
        ]);

        const ownSubmissions = new Set();
        const toKey = (sectionId, date) =>
          `${sectionId}|${new Date(date).toISOString().slice(0, 10)}`;

        ownEggs.forEach(r => ownSubmissions.add(toKey(r.penSectionId, r.collectionDate)));
        ownMort.forEach(r => ownSubmissions.add(toKey(r.penSectionId, r.recordDate)));
        ownFeed.forEach(r => ownSubmissions.add(toKey(r.penSectionId, r.recordedDate)));

        pendingQueue = pendingQueue.map(item => {
          const itemDate     = item.date ? new Date(item.date).toISOString().slice(0, 10) : null;
          const selfSubmitted = item.recordedById === user.sub;
          const sameSection  = item.penSectionId && itemDate
            ? ownSubmissions.has(toKey(item.penSectionId, itemDate))
            : false;

          const coiBlocked = selfSubmitted || sameSection;
          const coiReason  = selfSubmitted
            ? 'You submitted this record — a different Pen Manager must verify it'
            : sameSection
              ? 'You submitted records in this section today — a different Pen Manager must verify'
              : null;

          return { ...item, coiBlocked, coiReason };
        });
      }
    }

    if (type) {
      pendingQueue = pendingQueue.filter(i => i.type === type);
    }

    const [discrepancyCount, escalatedCount] = await Promise.all([
      prisma.verification.count({ where: { tenantId: user.tenantId, status: 'DISCREPANCY_FOUND' } }),
      prisma.verification.count({ where: { tenantId: user.tenantId, status: 'ESCALATED' } }),
    ]);

    const summary = {
      totalPending: pendingQueue.length,
      byType: {
        DAILY_PRODUCTION: pendingQueue.filter(i => i.type === 'DAILY_PRODUCTION').length,
        FEED_RECEIPT:     pendingQueue.filter(i => i.type === 'FEED_RECEIPT').length,
        MORTALITY_REPORT: pendingQueue.filter(i => i.type === 'MORTALITY_REPORT').length,
        INVENTORY_COUNT:  pendingQueue.filter(i => i.type === 'INVENTORY_COUNT').length,
        FINANCIAL_RECORD: pendingQueue.filter(i => i.type === 'FINANCIAL_RECORD').length,
      },
      discrepancies: discrepancyCount,
      escalated:     escalatedCount,
    };

    return NextResponse.json({ verifications, pendingQueue, summary, viewerRole: user.role });
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

    if (!canVerifyRecordType(user.role, data.referenceType)) {
      return NextResponse.json({
        error: `Your role (${user.role}) is not authorised to verify ${data.referenceType} records.`,
        allowedRoles: RECORD_TYPE_VERIFIERS[data.referenceType] || VERIFIER_ROLES,
      }, { status: 403 });
    }

    // ── Conflict-of-interest guard (VERIFIED actions only) ────────────────────
    // A PM cannot verify records from a section where they also submitted data
    // on the same production date. Flagging is exempt from this check.
    if (data.status === 'VERIFIED') {
      const coi = await checkConflictOfInterest(prisma, user, data.referenceType, data.referenceId);
      if (coi.blocked) {
        // Log the attempted COI bypass in the audit trail
        await prisma.auditLog.create({
          data: {
            tenantId:   user.tenantId,
            userId:     user.sub,
            action:     'UPDATE',
            entityType: 'Verification',
            entityId:   data.referenceId,
            changes: {
              blocked:   true,
              coiType:   coi.coiType,
              reason:    coi.reason,
              referenceType: data.referenceType,
              referenceId:   data.referenceId,
            },
          },
        }).catch(() => {});
        return NextResponse.json({ error: coi.reason, coiBlocked: true, coiType: coi.coiType }, { status: 403 });
      }
    }

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

    const allExisting = await prisma.verification.findMany({
      where: { tenantId: user.tenantId, referenceId: data.referenceId },
      orderBy: { createdAt: 'desc' },
    });

    const pendingRecord = allExisting.find(v => v.status === 'PENDING');
    if (pendingRecord) {
      const staleIds = allExisting.filter(v => v.id !== pendingRecord.id).map(v => v.id);
      if (staleIds.length > 0) {
        await prisma.verification.deleteMany({ where: { id: { in: staleIds } } }).catch(() => {});
      }
      const verification = await prisma.verification.update({
        where: { id: pendingRecord.id },
        data: {
          verifiedById:      user.sub,
          verificationType:  data.verificationType,
          verificationDate:  new Date(data.verificationDate),
          status:            data.status,
          discrepancyAmount: data.discrepancyAmount ?? null,
          discrepancyNotes:  data.discrepancyNotes  ?? null,
        },
      });
      await updateSourceRecord(data.referenceType, data.referenceId, data.status, user.sub);
      return NextResponse.json({ verification }, { status: 200 });
    }

    const finalRecord = allExisting.find(v => ['VERIFIED', 'RESOLVED', 'ESCALATED'].includes(v.status));
    if (finalRecord)
      return NextResponse.json({ error: 'This record has already been verified', verification: finalRecord }, { status: 409 });

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

    const newStatus = data.status === 'VERIFIED' ? 'APPROVED' : 'PENDING';
    await updateSourceRecord(data.referenceType, data.referenceId, newStatus, user.sub).catch(() => {});

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
    if (error.name === 'ZodError') {
      const fieldErrors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return NextResponse.json({ error: `Validation failed: ${fieldErrors}`, details: error.errors }, { status: 422 });
    }
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
