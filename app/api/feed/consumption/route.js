// app/api/feed/consumption/route.js — Feed consumption log: list + create
// Phase 8B update: POST now accepts bag-based fields (bagsUsed, remainingKg, bagWeightKg,
// feedTime) from the worker modal.  quantityKg is computed server-side.
// Backward-compatible: if only quantityKg is sent (old callers), that path still works.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { sendFeedLowStockEmail, resolveEmailSettings } from '@/lib/services/notifications';
import {
  calculateSectionRequisition,
  calculateRequisitionQty,
  nextRequisitionNumber,
} from '@/lib/utils/feedRequisitionCalc';
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

      // Correct carry-over formula:
      // Fetch the most recent FeedConsumption record for this section today to get
      // prevRemainingKg (kg left in the open bag from the last session).
      //
      // If prevRemainingKg > 0: the open bag was carried in; worker used some of it.
      //   openBagConsumed = prevRemainingKg - data.remainingKg
      // If prevRemainingKg = 0: first session today, a new bag was opened.
      //   openBagConsumed = bagWeightKg - data.remainingKg  (original formula)
      //
      // This prevents double-counting carry-over kg across sessions.
      let prevRemainingKg = 0;
      try {
        // Step 1: most recent FeedConsumption for this section+feedType.
        // Scoped by feedInventoryId so a feed type change (Starter→Grower) starts fresh.
        const lastSession = await prisma.feedConsumption.findFirst({
          where: {
            penSectionId:    data.penSectionId,
            feedInventoryId: data.feedInventoryId,
          },
          orderBy: { feedTime: 'desc' },
          select:  { remainingKg: true },
        });
        if (lastSession?.remainingKg != null && Number(lastSession.remainingKg) > 0) {
          prevRemainingKg = parseFloat(Number(lastSession.remainingKg).toFixed(2));
        } else {
          // Step 2: no prior consumption for this feed type on this section.
          // First issuance (or feed type just changed) — use today's acknowledged
          // requisition's issuedQtyKg for this section as the opening stock.
          const [yr, mo, dy] = data.recordedDate.split('-').map(Number);
          const dayStart = new Date(Date.UTC(yr, mo - 1, dy));
          const dayEnd   = new Date(Date.UTC(yr, mo - 1, dy + 1));
          const todayReq = await prisma.feedRequisition.findFirst({
            where: {
              penSectionId:    data.penSectionId,
              feedInventoryId: data.feedInventoryId,
              status:          { in: ['ACKNOWLEDGED', 'CLOSED'] },
              acknowledgedAt:  { gte: dayStart, lt: dayEnd },
            },
            orderBy: { acknowledgedAt: 'desc' },
            select:  { issuedQtyKg: true, sectionBreakdown: true },
          });
          if (todayReq) {
            // Try section-level issued qty first (more accurate for multi-section pens)
            let sectionIssued = 0;
            if (todayReq.sectionBreakdown && Array.isArray(todayReq.sectionBreakdown)) {
              const entry = todayReq.sectionBreakdown.find(s => s.penSectionId === data.penSectionId);
              sectionIssued = Number(entry?.acknowledgedQtyKg ?? entry?.issuedQtyKg ?? 0);
            }
            prevRemainingKg = sectionIssued > 0
              ? parseFloat(sectionIssued.toFixed(2))
              : parseFloat(Number(todayReq.issuedQtyKg || 0).toFixed(2));
          }
        }
      } catch { /* non-fatal — fall back to original formula */ }

      const currentRemainingKg = data.remainingKg ?? 0;

      // Correct bag-level consumption formula — two branches:
      // Branch A (bagsUsed > 0): carry-over fully used + new bags + partial new bag
      //   consumed = prevRemainingKg + (bagsUsed × bagWt) + (bagWt - remainingKg)
      //   Day 1: prev=0, bags=8, rem=20 → 0 + 200 + 5 = 205 kg ✓
      //   Day 2: prev=20, bags=7, rem=10 → 20 + 175 + 15 = 210 kg ✓
      // Branch B (bagsUsed = 0): worker only used carry-over bag
      //   consumed = prevRemainingKg - remainingKg
      // Empty-bags formula:
      // data.bagsUsed = total empty bags this session (incl. carry-over bag if emptied).
      // If prevRemainingKg > 0, one of those empties is the carry-over bag.
      //   fullNewBagsEmptied = data.bagsUsed - 1
      //   consumed = prevRemainingKg + (fullNewBagsEmptied × bagWt) + (bagWt - remainingKg)
      // Day 1: prev=0, empty=8, rem=20 → 0 + 8×25 + (25-20) = 205 kg ✓
      // Day 2: prev=20, empty=8, rem=10 → 20 + 7×25 + (25-10) = 210 kg ✓
      const fullNewBagsEmptied = prevRemainingKg > 0
        ? Math.max(0, data.bagsUsed - 1)
        : data.bagsUsed;
      const fromNewPartialBag = currentRemainingKg > 0
        ? parseFloat((bagWeightKg - currentRemainingKg).toFixed(2))
        : 0;
      // Also active if worker opened a first bag but hasn't emptied it yet
      const hasActivity = data.bagsUsed > 0 || (prevRemainingKg > 0 && currentRemainingKg === 0) || (data.bagsUsed === 0 && prevRemainingKg === 0 && currentRemainingKg > 0);

      quantityKg = hasActivity
        ? Math.max(0, parseFloat(
            (prevRemainingKg + (fullNewBagsEmptied * bagWeightKg) + fromNewPartialBag).toFixed(2)
          ))
        : 0;

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

    const gramsPerBird = (quantityKg && flock.currentCount > 0)
      ? parseFloat(((quantityKg * 1000) / flock.currentCount).toFixed(2))
      : null;
    // Snapshot bird count at distribution time — used by computeAggregates
    // for accurate avgBirdsForFeed calculation in daily_summaries
    const birdsAtDistribution = flock.currentCount > 0 ? flock.currentCount : null;

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
		  birdsAtDistribution,   // ← snapshot at distribution time
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

    // ── Requisition draft + auto-submit (fire-and-forget) ────────────────────
    // 1. Upsert the DRAFT with today's bag-count data
    // 2. If past the farm's cutoff time, auto-escalate to SUBMITTED
    if (penSectionId) {
      prisma.penSection.findUnique({
        where:   { id: penSectionId },
        include: { pen: { include: { farm: { select: { id: true, autoSummaryTime: true } } } } },
      }).then(async sec => {
        if (!sec) return;
        const cutoffTime = sec.pen.farm.autoSummaryTime || '19:00';

        // Step 1 — upsert draft
        await upsertDraftRequisition({
          tenantId:       user.tenantId,
          penSectionId,
          flockId,
          feedInventoryId,
          triggerLogId:   record.id,
          recordedDate,
        });

        // Step 2 — auto-submit if past cutoff
        await autoSubmitRequisition({
          tenantId:       user.tenantId,
          penSectionId,
          feedInventoryId,
          recordedDate,
          autoSummaryTime: cutoffTime,
        });
      }).catch(err => console.error('[REQUISITION] Trigger error:', err?.message));
    }

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
//   • One requisition per pen per FEED TYPE per day.
//   • Only sections that have consumed this specific feedInventoryId in the
//     past 7 days are included — prevents rearing/production cross-contamination
//     in mixed-stage pens where different feed types are used simultaneously.
//   • sectionBreakdown (JSONB) stores per-section bag counts for the store.
//   • Primary formula: emptyBagsToday + 1 − fullBagsRemainingInSection
//   • Fallback: 7-day kg average when no bag-count data is available.
async function upsertDraftRequisition({
  tenantId, penSectionId, flockId, feedInventoryId, triggerLogId, recordedDate,
}) {
  if (!penSectionId || !flockId || !feedInventoryId) return;

  // The requisition is FOR the next day
  const rd = typeof recordedDate === 'string' ? new Date(recordedDate) : recordedDate;
  const feedForDate = new Date(Date.UTC(rd.getFullYear(), rd.getMonth(), rd.getDate() + 1));

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

  const penId       = section.pen.id;
  const bagWeightKg = Number(feedInv.bagWeightKg) || 25;

  // Date boundaries for today and 7-day lookback
  // Use UTC to avoid WAT/UTC shift issues (server runs WAT = UTC+1)
  const todayStart   = new Date(Date.UTC(rd.getFullYear(), rd.getMonth(), rd.getDate()));
  const todayEnd     = new Date(Date.UTC(rd.getFullYear(), rd.getMonth(), rd.getDate() + 1));
  const sevenDaysAgo = new Date(Date.UTC(rd.getFullYear(), rd.getMonth(), rd.getDate() - 6));

  // ── Find sibling flocks scoped to this feed type ──────────────────────────
  // Only include sections that have consumed THIS feedInventoryId in the past 7 days.
  // This prevents rearing-stage pullets (eating grower feed) appearing on the
  // layer mash requisition for the same pen, and vice versa.
  // The triggering section is always included even if it's the first day.
  const siblingFlocks = await prisma.flock.findMany({
    where: {
      status:     'ACTIVE',
      penSection: { penId, isActive: true },
      OR: [
        // Always include the section that triggered this upsert
        { penSectionId },
        // Include siblings that have consumed this feed type recently
        {
          feedConsumption: {
            some: {
              feedInventoryId,
              recordedDate: { gte: sevenDaysAgo, lt: todayEnd },
            },
          },
        },
      ],
    },
    select: {
      id: true, currentCount: true, batchCode: true,
      penSection: { select: { id: true, name: true } },
    },
  });

  if (siblingFlocks.length === 0) return;

  // ── Compute per-section bag requirements ──────────────────────────────────
  const breakdownEntries = await Promise.all(siblingFlocks.map(async (f) => {
    // Today's logs — used for primary bag-count formula
    const todayLogs = await prisma.feedConsumption.findMany({
      where: {
        penSectionId:   f.penSection.id,
        feedInventoryId,
        recordedDate:   { gte: todayStart, lt: todayEnd },
      },
      select: {
        bagsUsed:    true,
        remainingKg: true,
        bagWeightKg: true,
        quantityKg:  true,
        recordedDate: true,
        feedTime:    true,
      },
      orderBy: { feedTime: 'asc' },
    });

    // 7-day logs — fallback formula when no bag-count data
    const recentLogs = await prisma.feedConsumption.findMany({
      where: {
        penSectionId:   f.penSection.id,
        feedInventoryId,
        recordedDate:   { gte: sevenDaysAgo, lt: todayStart }, // exclude today
      },
      select:  { quantityKg: true, recordedDate: true },
      orderBy: { recordedDate: 'desc' },
    });

    const calc = calculateSectionRequisition({
      todayLogs,
      recentLogs,
      currentBirdCount: f.currentCount,
      bagWeightKg,
      bufferPct:        5,
    });

    return {
      penSectionId:           f.penSection.id,
      sectionName:            f.penSection.name,
      flockId:                f.id,
      batchCode:              f.batchCode,
      birdCount:              f.currentCount,
      avgConsumptionPerBirdG: calc.avgConsumptionPerBirdG,
      bagsRequired:           calc.bagsRequired,
      remainderKg:            calc.remainderKg,
      calculatedQtyKg:        calc.calculatedQtyKg,
      formulaUsed:            calc.formulaUsed,
      basis:                  calc.basis,
      // Lifecycle fields filled by later workflow stages
      requestedQtyKg:         null,
      issuedQtyKg:            null,
      acknowledgedQtyKg:      null,
    };
  }));

  // ── Pen-level totals ──────────────────────────────────────────────────────
  const totalBagsRequired = breakdownEntries.reduce((s, e) => s + (e.bagsRequired || 0), 0);
  const totalRemainderKg  = parseFloat(
    breakdownEntries.reduce((s, e) => s + (e.remainderKg || 0), 0).toFixed(2)
  );
  const totalCalcKg = parseFloat(
    breakdownEntries.reduce((s, e) => s + (e.calculatedQtyKg || 0), 0).toFixed(2)
  );

  if (totalCalcKg <= 0 && totalBagsRequired <= 0) return;

  // Representative trigger entry for backward-compat scalar fields
  const trigger = breakdownEntries.find(e => e.penSectionId === penSectionId)
    || breakdownEntries[0];

  // ── Upsert the pen-level requisition ─────────────────────────────────────
  const existing = await prisma.feedRequisition.findFirst({
    where:  { penId, feedInventoryId, feedForDate, status: 'DRAFT' },
    select: { id: true },
  });

  if (existing) {
    await prisma.feedRequisition.update({
      where: { id: existing.id },
      data: {
        calculatedQtyKg:        totalCalcKg,
        totalBagsRequired,
        totalRemainderKg,
        avgConsumptionPerBirdG: trigger.avgConsumptionPerBirdG,
        currentBirdCount:       breakdownEntries.reduce((s, e) => s + e.birdCount, 0),
        calculationDays:        1,
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
        penSectionId:           null,             // pen-level — no single section
        flockId:                trigger.flockId,  // representative flock
        feedInventoryId,
        storeId:                feedInv?.storeId ?? undefined,
        feedForDate,
        triggerLogId,
        calculatedQtyKg:        totalCalcKg,
        totalBagsRequired,
        totalRemainderKg,
        avgConsumptionPerBirdG: trigger.avgConsumptionPerBirdG,
        currentBirdCount:       breakdownEntries.reduce((s, e) => s + e.birdCount, 0),
        calculationDays:        1,
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
      select:   { userId: true },
      distinct: ['userId'],
    });

    if (pmAssignments.length > 0) {
      const bagStr = totalRemainderKg > 0
        ? `${totalBagsRequired} bags + ${totalRemainderKg} kg`
        : `${totalBagsRequired} bag${totalBagsRequired !== 1 ? 's' : ''}`;

      await prisma.notification.createMany({
        data: pmAssignments.map(a => ({
          tenantId,
          recipientId: a.userId,
          type:        'ALERT',
          title:       'Feed Requisition Ready for Review',
          message:     `Draft requisition for ${section.pen.name} — ${feedInv.feedType} on ${
            feedForDate.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
          }. Total: ${bagStr} across ${breakdownEntries.length} section${breakdownEntries.length !== 1 ? 's' : ''}.`,
          data: {
            entityType:        'FeedRequisition',
            requisitionNumber: reqNumber,
            penId,
            feedForDate:       feedForDate.toISOString(),
            totalBagsRequired,
            totalCalcKg,
          },
          channel: 'IN_APP',
        })),
        skipDuplicates: true,
      });
    }
  }
}

// ─── Requisition auto-submit (cutoff-time gated) ─────────────────────────────
// Called fire-and-forget after each feed record save, same as autoSubmitSummary.
// Checks if it's past the farm's autoSummaryTime. If so, any DRAFT requisition
// for tomorrow that belongs to this pen is automatically submitted (DRAFT → SUBMITTED),
// saving the PM from having to act before the store's preparation window closes.
//
// The PM still has until the cutoff to make manual adjustments. If they've already
// submitted or the requisition doesn't exist yet (first feed of the day), nothing happens.
async function autoSubmitRequisition({ tenantId, penSectionId, feedInventoryId, recordedDate, autoSummaryTime = '19:00' }) {
  try {
    // Check if we're past the cutoff
    const [cutoffH, cutoffM] = autoSummaryTime.split(':').map(Number);
    const now        = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const cutoffMins = cutoffH * 60 + (cutoffM || 0);
    if (nowMinutes < cutoffMins) return; // before cutoff — PM still has time

    // Resolve penId
    const section = await prisma.penSection.findUnique({
      where:  { id: penSectionId },
      select: { penId: true },
    });
    if (!section) return;

    const rd = typeof recordedDate === 'string' ? new Date(recordedDate) : recordedDate;
    const feedForDate = new Date(Date.UTC(rd.getFullYear(), rd.getMonth(), rd.getDate() + 1));

    // Find DRAFT requisition for this pen + feed type + tomorrow
    const draft = await prisma.feedRequisition.findFirst({
      where: {
        penId:          section.penId,
        feedInventoryId,
        feedForDate,
        status:         'DRAFT',
      },
      select: {
        id: true, requisitionNumber: true, calculatedQtyKg: true,
        totalBagsRequired: true, totalRemainderKg: true,
        sectionBreakdown: true,
      },
    });
    if (!draft) return; // no draft — upsert hasn't run yet or was already submitted

    // Auto-submit: set requestedQtyKg = calculatedQtyKg (system recommendation)
    const updated = await prisma.feedRequisition.update({
      where: { id: draft.id },
      data: {
        status:          'SUBMITTED',
        requestedQtyKg:  draft.calculatedQtyKg,
        submittedAt:     new Date(),
        // No submittedById — system submission; IC can see this in audit
        pmNotes:         'Auto-submitted by system at cutoff time. PM had not reviewed.',
        deviationPct:    0, // system used its own recommendation
      },
    });

    // Notify IC team
    const icUsers = await prisma.user.findMany({
      where: {
        tenantId,
        role:     { in: ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'] },
        isActive: true,
      },
      select: { id: true },
    });

    if (icUsers.length > 0) {
      const bagStr = (draft.totalRemainderKg && Number(draft.totalRemainderKg) > 0)
        ? `${draft.totalBagsRequired} bags + ${Number(draft.totalRemainderKg).toFixed(1)} kg`
        : `${draft.totalBagsRequired ?? '?'} bags`;

      await prisma.notification.createMany({
        data: icUsers.map(u => ({
          tenantId,
          recipientId: u.id,
          type:        'ALERT',
          title:       `Feed Requisition Auto-Submitted — ${draft.requisitionNumber}`,
          message:     `Requisition ${draft.requisitionNumber} for ${
            feedForDate.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
          } was auto-submitted at cutoff (${bagStr}). PM did not review. Awaiting IC approval.`,
          data: {
            entityType:        'FeedRequisition',
            entityId:          draft.id,
            requisitionNumber: draft.requisitionNumber,
            autoSubmitted:     true,
          },
          channel: 'IN_APP',
        })),
        skipDuplicates: true,
      });
    }

    console.log(`[REQUISITION] Auto-submitted ${draft.requisitionNumber} at cutoff (${autoSummaryTime})`);
  } catch (err) {
    console.error('[REQUISITION] Auto-submit error:', err?.message);
  }
}