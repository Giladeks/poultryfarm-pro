// app/api/feed/consumption/route.js — Feed consumption log: list + create
// Phase 8B update: POST now accepts bag-based fields (bagsUsed, remainingKg, bagWeightKg,
// feedTime) from the worker modal.  quantityKg is computed server-side.
// Backward-compatible: if only quantityKg is sent (old callers), that path still works.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { sendFeedLowStockEmail, resolveEmailSettings } from '@/lib/services/notifications';
import { calculateRequisitionQty, nextRequisitionNumber } from '@/lib/utils/feedRequisitionCalc';
import { autoSubmitSummary } from '@/lib/utils/autoSubmitSummary';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'PRODUCTION_STAFF',
  'STORE_MANAGER', 'STORE_CLERK',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

// Phase 8B bag-based schema (worker modal path)
const createSchemaBags = z.object({
  feedInventoryId: z.string().min(1),
  flockId:         z.string().min(1),
  penSectionId:    z.string().min(1),
  recordedDate:    z.string(),                       // YYYY-MM-DD
  bagsUsed:        z.number().int().min(0),           // full bags emptied
  remainingKg:     z.number().min(0),                // kg left in last opened bag
  feedTime:        z.string().optional().nullable(),  // ISO timestamp — optional
  notes:           z.string().max(500).nullable().optional(),
});

// Legacy simple-quantity schema (kept for backward compat with other callers)
const createSchemaLegacy = z.object({
  feedInventoryId: z.string().min(1),
  flockId:         z.string().min(1).nullable().optional(),
  penSectionId:    z.string().min(1).nullable().optional(),
  quantityKg:      z.number().positive(),
  consumptionDate: z.string().optional(),
  notes:           z.string().nullable().optional(),
});

// ─── GET /api/feed/consumption ────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId         = searchParams.get('flockId');
  const penSectionId    = searchParams.get('penSectionId');
  const feedInventoryId = searchParams.get('feedInventoryId');
  const from            = searchParams.get('from');
  const to              = searchParams.get('to');
  const limit           = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  try {
    const where = {
      flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      ...(flockId         && { flockId }),
      ...(penSectionId    && { penSectionId }),
      ...(feedInventoryId && { feedInventoryId }),
      ...((from || to)    && {
        recordedDate: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to)   }),
        },
      }),
    };

    const consumption = await prisma.feedConsumption.findMany({
      where,
      include: {
        flock:         { select: { id: true, batchCode: true, operationType: true, currentCount: true } },
        penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
        feedInventory: { select: { id: true, feedType: true, costPerKg: true, bagWeightKg: true, currency: true } },
        recordedBy:    { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { recordedDate: 'desc' },
      take: limit,
    });

    const agg = await prisma.feedConsumption.aggregate({
      where,
      _sum:   { quantityKg: true },
      _count: true,
    });

    return NextResponse.json({
      consumption,
      summary: {
        totalRecords: agg._count,
        totalKg:      parseFloat(Number(agg._sum.quantityKg || 0).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('Feed consumption fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch consumption records' }, { status: 500 });
  }
}

// ─── POST /api/feed/consumption ───────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();

    // ── Determine which path: bag-based (has bagsUsed) or legacy (has quantityKg) ──
    const isBagBased = body.bagsUsed !== undefined;

    let feedInventoryId, flockId, penSectionId, quantityKg,
        bagsUsed, remainingKg, bagWeightKg, costAtTime,
        recordedDate, feedTime, notes;

    if (isBagBased) {
      // ── Phase 8B bag-based path ───────────────────────────────────────────
      const data = createSchemaBags.parse(body);

      // Fetch feed inventory to get bagWeightKg and costPerKg
      const feedItem = await prisma.feedInventory.findFirst({
        where: {
          id:    data.feedInventoryId,
          store: { farm: { tenantId: user.tenantId } },
        },
      });
      if (!feedItem)
        return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

      bagWeightKg = Number(feedItem.bagWeightKg) || 25;
      costAtTime  = Number(feedItem.costPerKg);

      // quantityKg = (bagsUsed × bagWeightKg) + partialConsumed
      // partialConsumed = (bagWeightKg − remainingKg) only when a partial bag was opened.
      // If remainingKg is 0 or absent, no partial bag was opened — no extra kg added.
      const hasPartialBag  = (data.remainingKg ?? 0) > 0.1;
      const partialConsumed = hasPartialBag ? (bagWeightKg - data.remainingKg) : 0;
      quantityKg = parseFloat(
        ((data.bagsUsed * bagWeightKg) + partialConsumed).toFixed(2)
      );

      if (quantityKg <= 0)
        return NextResponse.json({ error: 'Calculated quantity is zero — check bagsUsed and remainingKg' }, { status: 422 });

      const currentStock = Number(feedItem.currentStockKg);
      if (currentStock < quantityKg)
        return NextResponse.json({
          error:     'Insufficient feed stock',
          available: currentStock,
          requested: quantityKg,
        }, { status: 422 });

      feedInventoryId = data.feedInventoryId;
      flockId         = data.flockId;
      penSectionId    = data.penSectionId;
      bagsUsed        = data.bagsUsed;
      remainingKg     = data.remainingKg;
      recordedDate    = new Date(data.recordedDate);
      feedTime        = data.feedTime ? new Date(data.feedTime) : new Date();
      notes           = data.notes ?? null;

      // Validate section assignment for workers
      if (user.role === 'PEN_WORKER') {
        const assigned = await prisma.penWorkerAssignment.findFirst({
          where: { userId: user.sub, penSectionId },
        });
        if (!assigned)
          return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
      }

    } else {
      // ── Legacy simple-quantity path ───────────────────────────────────────
      const data = createSchemaLegacy.parse(body);

      const feedItem = await prisma.feedInventory.findFirst({
        where: {
          id:    data.feedInventoryId,
          store: { farm: { tenantId: user.tenantId } },
        },
      });
      if (!feedItem)
        return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

      const currentStock = Number(feedItem.currentStockKg);
      if (currentStock < data.quantityKg)
        return NextResponse.json({
          error:     'Insufficient feed stock',
          available: currentStock,
          requested: data.quantityKg,
        }, { status: 422 });

      feedInventoryId = data.feedInventoryId;
      flockId         = data.flockId ?? null;
      penSectionId    = data.penSectionId ?? null;
      quantityKg      = data.quantityKg;
      bagWeightKg     = Number(feedItem.bagWeightKg) || 25;
      bagsUsed        = Math.floor(quantityKg / bagWeightKg);
      remainingKg     = parseFloat((bagWeightKg - (quantityKg % bagWeightKg)).toFixed(2));
      costAtTime      = Number(feedItem.costPerKg);
      recordedDate    = data.consumptionDate ? new Date(data.consumptionDate) : new Date();
      feedTime        = new Date();
      notes           = data.notes ?? null;
    }

    // ── Resolve flock for gramsPerBird ────────────────────────────────────────
    let flock = null;
    if (flockId) {
      flock = await prisma.flock.findFirst({
        where: {
          id:         flockId,
          penSection: { pen: { farm: { tenantId: user.tenantId } } },
        },
        select: { id: true, currentCount: true, penSectionId: true },
      });
      if (!flock)
        return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
      if (!penSectionId) penSectionId = flock.penSectionId;
    }

    const gramsPerBird = (flock && flock.currentCount > 0)
      ? parseFloat(((quantityKg * 1000) / flock.currentCount).toFixed(2))
      : null;

    // Re-fetch feedItem for stock-deduction (needed for both paths)
    const feedItemFinal = await prisma.feedInventory.findUnique({
      where: { id: feedInventoryId },
      select: { currentStockKg: true, reorderLevelKg: true, feedType: true, costPerKg: true, bagWeightKg: true },
    });
    const stockAfter = parseFloat((Number(feedItemFinal.currentStockKg) - quantityKg).toFixed(2));

    const [record] = await prisma.$transaction([
      prisma.feedConsumption.create({
        data: {
          feedInventoryId,
          flockId:      flockId   ?? undefined,
          penSectionId: penSectionId ?? undefined,
          recordedDate,
          feedTime,
          bagsUsed,
          remainingKg,
          bagWeightKg,
          quantityKg,
          gramsPerBird,
          costAtTime,
          currency:         'NGN',
          recordedById:     user.sub,
          submissionStatus: 'PENDING',
          notes,
        },
        include: {
          flock:         { select: { id: true, batchCode: true, operationType: true } },
          penSection:    { select: { id: true, name: true, pen: { select: { name: true } } } },
          feedInventory: { select: { id: true, feedType: true, bagWeightKg: true } },
          recordedBy:    { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.feedInventory.update({
        where: { id: feedInventoryId },
        data:  { currentStockKg: { decrement: quantityKg } },
      }),
    ]);

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'FeedConsumption',
        entityId:   record.id,
        changes: {
          feedType:    feedItemFinal.feedType,
          quantityKg,
          gramsPerBird,
          stockAfter,
          ...(isBagBased && { bagsUsed, remainingKg, bagWeightKg }),
        },
      },
    }).catch(() => {});

    // Low-stock alert (fire-and-forget)
    checkLowFeedStock(user.tenantId, feedInventoryId, feedItemFinal, stockAfter).catch(console.error);

    // Auto-submit daily summary if past farm's autoSummaryTime (fire-and-forget)
    if (penSectionId) {
      prisma.penSection.findUnique({
        where:   { id: penSectionId },
        include: { pen: { include: { farm: { select: { id: true, autoSummaryTime: true } } } } },
      }).then(sec => {
        if (sec)
          autoSubmitSummary(user.tenantId, penSectionId, sec.pen.farmId, sec.pen.farm.autoSummaryTime)
            .catch(() => {});
      }).catch(() => {});
    }

    // ── Phase 8B+: Requisition draft trigger (fire-and-forget) ───────────────
    // After a worker logs feed, the system auto-calculates tomorrow's need and
    // upserts a DRAFT requisition for the PM to review and submit.
    upsertDraftRequisition({
      tenantId:       user.tenantId,
      penSectionId:   penSectionId,
      flockId:        flockId,
      feedInventoryId,
      triggerLogId:   record.id,
      recordedDate,
    }).catch(err => console.error('[REQUISITION] Draft upsert error:', err.message));

    return NextResponse.json({
      consumption: record,
      computed: { quantityKg, gramsPerBird, stockAfter },
    }, { status: 201 });

  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed consumption create error:', error);
    return NextResponse.json({ error: 'Failed to record consumption' }, { status: 500 });
  }
}

// ─── Low-stock check helper ───────────────────────────────────────────────────
async function checkLowFeedStock(tenantId, feedInventoryId, feedItem, stockAfterKg) {
  const reorderLevel = Number(feedItem.reorderLevelKg);
  const wasAbove = Number(feedItem.currentStockKg) > reorderLevel;
  const isBelow  = stockAfterKg <= reorderLevel;
  if (!wasAbove || !isBelow) return;

  const tenant = await prisma.tenant.findUnique({
    where:  { id: tenantId },
    select: { farmName: true, settings: true },
  });

  const emailSettings = resolveEmailSettings(tenant?.settings);
  if (!emailSettings?.enabled || !emailSettings?.lowFeedAlert?.enabled) return;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const usageAgg = await prisma.feedConsumption.aggregate({
    where: { feedInventoryId, recordedDate: { gte: sevenDaysAgo } },
    _sum:  { quantityKg: true },
  });

  const dailyUsageKg  = Number(usageAgg._sum.quantityKg || 0) / 7;
  const daysRemaining = dailyUsageKg > 0
    ? Math.floor(stockAfterKg / dailyUsageKg)
    : null;

  const threshold = emailSettings.lowFeedAlert.daysRemainingThreshold ?? 14;
  if (daysRemaining !== null && daysRemaining > threshold) return;

  const managers = await prisma.user.findMany({
    where: {
      tenantId,
      role:     { in: ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'] },
      isActive: true,
      email:    { not: null },
    },
    select: { email: true },
  });

  const toEmails = managers.map(m => m.email).filter(Boolean);
  if (toEmails.length === 0) return;

  await sendFeedLowStockEmail({
    to:             toEmails,
    farmName:       tenant?.farmName || 'Farm',
    feedType:       feedItem.feedType,
    currentStockKg: stockAfterKg,
    reorderLevelKg: reorderLevel,
    daysRemaining,
    dailyUsageKg,
  }).catch(err => console.error('[EMAIL] Feed low-stock error:', err.message));
}

// ─── Requisition draft upsert (pen-level) ────────────────────────────────────
// Called fire-and-forget after a feed consumption record is saved.
// Creates or updates a DRAFT FeedRequisition at the PEN level for the next day.
//
// Design:
//   • One requisition per pen per feed type per day (not per section).
//   • sectionBreakdown (JSONB) stores per-section quantities so the store
//     knows exactly how much to issue to each section.
//   • When any section in the pen logs feed, the pen-level requisition is
//     refreshed to include ALL active sections in that pen for the same feed type.
async function upsertDraftRequisition({
  tenantId, penSectionId, flockId, feedInventoryId, triggerLogId, recordedDate,
}) {
  if (!penSectionId || !flockId || !feedInventoryId) return;

  // The requisition is FOR the next day
  const feedForDate = new Date(recordedDate);
  feedForDate.setDate(feedForDate.getDate() + 1);
  feedForDate.setHours(0, 0, 0, 0);

  // Resolve pen and feed inventory
  const [section, feedInv] = await Promise.all([
    prisma.penSection.findUnique({
      where:  { id: penSectionId },
      select: { id: true, name: true, penId: true, pen: { select: { id: true, name: true } } },
    }),
    prisma.feedInventory.findUnique({
      where:  { id: feedInventoryId },
      select: { storeId: true, bagWeightKg: true, feedType: true },
    }),
  ]);
  if (!section || !feedInv) return;

  const penId      = section.pen.id;
  const bagWeightKg = Number(feedInv.bagWeightKg) || 25;

  // Find ALL active sections in this pen that have an active flock
  const siblingFlocks = await prisma.flock.findMany({
    where: {
      status:     'ACTIVE',
      penSection: { penId, isActive: true },
    },
    select: {
      id: true, currentCount: true, batchCode: true,
      penSection: { select: { id: true, name: true } },
    },
  });

  if (siblingFlocks.length === 0) return;

  const sevenDaysAgo = new Date(recordedDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);
  const recordedEnd = new Date(recordedDate);
  recordedEnd.setHours(23, 59, 59, 999);

  // Calculate per-section quantities
  const breakdownEntries = await Promise.all(siblingFlocks.map(async (f) => {
    const recentLogs = await prisma.feedConsumption.findMany({
      where: {
        penSectionId:   f.penSection.id,
        feedInventoryId,
        recordedDate:   { gte: sevenDaysAgo, lte: recordedEnd },
      },
      select:  { quantityKg: true, recordedDate: true },
      orderBy: { recordedDate: 'desc' },
    });

    const calc = calculateRequisitionQty({
      recentLogs,
      currentBirdCount: f.currentCount,
      bufferPct:        5,
      lookbackDays:     7,
    });

    // Bag breakdown for this section
    const bags        = Math.floor(calc.calculatedQtyKg / bagWeightKg);
    const remainderKg = parseFloat((calc.calculatedQtyKg % bagWeightKg).toFixed(2));

    return {
      penSectionId:          f.penSection.id,
      sectionName:           f.penSection.name,
      flockId:               f.id,
      batchCode:             f.batchCode,
      birdCount:             f.currentCount,
      avgConsumptionPerBirdG: calc.avgConsumptionPerBirdG,
      calculatedQtyKg:       calc.calculatedQtyKg,
      bags,
      remainderKg,
      requestedQtyKg:        null,  // PM fills on submit
      issuedQtyKg:           null,  // Store fills on issue
      acknowledgedQtyKg:     null,  // PM fills on acknowledge
    };
  }));

  // Sum across all sections for the pen total
  const totalCalcKg = parseFloat(
    breakdownEntries.reduce((s, e) => s + e.calculatedQtyKg, 0).toFixed(2)
  );
  if (totalCalcKg <= 0) return;

  const totalBags      = Math.floor(totalCalcKg / bagWeightKg);
  const totalRemainKg  = parseFloat((totalCalcKg % bagWeightKg).toFixed(2));

  // Representative values (for backward compat fields) — use triggering section
  const trigger = breakdownEntries.find(e => e.penSectionId === penSectionId) || breakdownEntries[0];

  // Upsert: update if DRAFT exists for this pen/feedType/date
  const existing = await prisma.feedRequisition.findFirst({
    where: { penId, feedInventoryId, feedForDate, status: 'DRAFT' },
    select: { id: true },
  });

  if (existing) {
    await prisma.feedRequisition.update({
      where: { id: existing.id },
      data: {
        calculatedQtyKg:        totalCalcKg,
        avgConsumptionPerBirdG: trigger.avgConsumptionPerBirdG,
        currentBirdCount:       breakdownEntries.reduce((s, e) => s + e.birdCount, 0),
        calculationDays:        7,
        triggerLogId,
        sectionBreakdown:       breakdownEntries,
      },
    });
  } else {
    const reqNumber = await nextRequisitionNumber(prisma, tenantId);

    await prisma.feedRequisition.create({
      data: {
        tenantId,
        requisitionNumber:      reqNumber,
        penId,
        penSectionId:           null,           // pen-level — no single section
        flockId:                trigger.flockId, // representative flock
        feedInventoryId,
        storeId:                feedInv?.storeId ?? undefined,
        feedForDate,
        triggerLogId,
        calculatedQtyKg:        totalCalcKg,
        avgConsumptionPerBirdG: trigger.avgConsumptionPerBirdG,
        currentBirdCount:       breakdownEntries.reduce((s, e) => s + e.birdCount, 0),
        calculationDays:        7,
        sectionBreakdown:       breakdownEntries,
        status:                 'DRAFT',
      },
    });

    // Notify PMs assigned to any section in this pen
    const penSectionIds = breakdownEntries.map(e => e.penSectionId);
    const pmAssignments = await prisma.penWorkerAssignment.findMany({
      where: {
        penSectionId: { in: penSectionIds },
        user: { role: 'PEN_MANAGER', isActive: true },
      },
      select:  { userId: true },
      distinct: ['userId'],
    });

    if (pmAssignments.length > 0) {
      const totalBagsStr = totalRemainKg > 0
        ? `${totalBags} bags + ${totalRemainKg} kg`
        : `${totalBags} bags`;
      await prisma.notification.createMany({
        data: pmAssignments.map(a => ({
          tenantId,
          recipientId: a.userId,
          type:        'ALERT',
          title:       'Feed Requisition Ready for Review',
          message:     `Draft requisition for ${section.pen.name} on ${feedForDate.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}. Total: ${totalCalcKg} kg (${totalBagsStr}) across ${breakdownEntries.length} section${breakdownEntries.length !== 1 ? 's' : ''}.`,
          data:        {
            entityType:        'FeedRequisition',
            requisitionNumber: reqNumber,
            penId,
            feedForDate:       feedForDate.toISOString(),
            calculatedQtyKg:   totalCalcKg,
          },
          channel: 'IN_APP',
        })),
        skipDuplicates: true,
      });
    }
  }
}
