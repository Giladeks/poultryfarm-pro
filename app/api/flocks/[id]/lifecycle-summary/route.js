// app/api/flocks/[id]/lifecycle-summary/route.js
// Phase 8-Supplement · Flock Lifecycle P&L
//
// GET /api/flocks/[id]/lifecycle-summary
//   Read-only aggregation. Works for ACTIVE and DEPLETED flocks.
//
// Cost sources:
//   chickCost      → chick_arrivals (chicksReceived × chickCostPerBird)
//   feedCost       → feed_consumption (quantityKg × costAtTime)
//   medicationCost → store_issuances (MEDICATION category items, flock lifespan window)
//
// Revenue sources (LAYER):
//   eggRevenue     → egg_production (APPROVED) × farm grade pricing
//
// Revenue sources (BROILER):
//   broilerRevenue → broiler_harvests.totalRevenue
//
// Store transfer revenue (both types):
//   Estimated from FlockLifecycleEvent APPROVED TRANSFERRED_TO_STORE events.
//   These are estimates until a Sales Order is raised — labelled clearly in the UI.
//   Actual revenue is recorded via SalesOrder, not stored on the flock.
//
// Roles: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN, INTERNAL_CONTROL

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'INTERNAL_CONTROL',
];

const EGGS_PER_CRATE = 30;

export async function GET(request, { params: rawParams }) {
  const params = await rawParams;                          // Next.js 16 async params
  const user   = await verifyToken(request);
  if (!user)                              return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },     { status: 403 });

  const { id: flockId } = params;

  try {
    // ── 1. Flock header ───────────────────────────────────────────────────────
    const flock = await prisma.flock.findFirst({
      where: { id: flockId, tenantId: user.tenantId },
      select: {
        id:                   true,
        batchCode:            true,
        breed:                true,
        operationType:        true,
        dateOfPlacement:      true,
        depletionDate:        true,
        status:               true,
        initialCount:         true,
        currentCount:         true,
        depletionDisposition: true,
        purchaseCurrency:     true,
        penSection: {
          select: {
            name: true,
            pen: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    // Fetch tenant settings separately (Farm model has no settings field)
    const tenant = await prisma.tenant.findUnique({
      where:  { id: user.tenantId },
      select: { settings: true },
    });

    const placedDate   = new Date(flock.dateOfPlacement);
    const endDate      = flock.depletionDate ? new Date(flock.depletionDate) : new Date();
    const lifespanDays = Math.round((endDate - placedDate) / 86_400_000);

    // ── 2. Chick cost ─────────────────────────────────────────────────────────
    const chickArrivals = await prisma.chick_arrivals.findMany({
      where:  { flockId, tenantId: user.tenantId },
      select: { chicksReceived: true, chickCostPerBird: true, doaCount: true },
    });

    const totalChicksIn = chickArrivals.reduce((s, a) => s + (a.chicksReceived || 0), 0);
    const totalDOA      = chickArrivals.reduce((s, a) => s + (a.doaCount || 0), 0);
    const chickCost     = chickArrivals.reduce(
      (s, a) => s + (a.chicksReceived || 0) * parseFloat(a.chickCostPerBird || 0), 0
    );

    // ── 3. Feed cost ──────────────────────────────────────────────────────────
    const feedRows = await prisma.feedConsumption.findMany({
      where:  { flockId },
      select: { quantityKg: true, costAtTime: true },
    });

    const totalFeedKg = feedRows.reduce((s, r) => s + parseFloat(r.quantityKg || 0), 0);
    const feedCost    = feedRows.reduce(
      (s, r) => s + parseFloat(r.quantityKg || 0) * parseFloat(r.costAtTime || 0), 0
    );

    // ── 4. Medication cost ────────────────────────────────────────────────────
    const medIssuances = await prisma.storeIssuance.findMany({
      where: {
        penSection: { flocks: { some: { id: flockId } } },
        issuanceDate: { gte: placedDate, lte: endDate },
        inventoryItem: { category: 'MEDICATION' },
      },
      select: {
        quantityIssued: true,
        inventoryItem:  { select: { costPerUnit: true } },
      },
    });

    const medicationCost = medIssuances.reduce(
      (s, i) => s + parseFloat(i.quantityIssued || 0) * parseFloat(i.inventoryItem?.costPerUnit || 0), 0
    );

    // ── 5. Mortality breakdown ────────────────────────────────────────────────
    const mortalityRows = await prisma.mortalityRecord.findMany({
      where:  { flockId },
      select: { count: true, causeCode: true },
    });

    const totalMortality = mortalityRows.reduce((s, r) => s + (r.count || 0), 0);
    const cullMortality  = mortalityRows
      .filter(r => r.causeCode === 'CULLED')
      .reduce((s, r) => s + (r.count || 0), 0);

    // ── 6. Revenue ────────────────────────────────────────────────────────────
    let eggRevenue     = 0;
    let broilerRevenue = 0;
    let totalEggs      = 0;
    let totalCrates    = 0;

    if (flock.operationType === 'LAYER') {
      const farmSettings = tenant?.settings ?? {};
      const priceGradeA  = parseFloat(farmSettings.salePriceGradeA || 0);
      const priceGradeB  = parseFloat(farmSettings.salePriceGradeB || 0);

      const eggRows = await prisma.eggProduction.findMany({
        where:  { flockId, submissionStatus: 'APPROVED' },
        select: { totalEggs: true, gradeACount: true, gradeBCount: true },
      });

      totalEggs   = eggRows.reduce((s, r) => s + (r.totalEggs || 0), 0);
      totalCrates = totalEggs / EGGS_PER_CRATE;

      if (priceGradeA > 0 || priceGradeB > 0) {
        const gradeACrates = eggRows.reduce((s, r) => s + (r.gradeACount || 0), 0) / EGGS_PER_CRATE;
        const gradeBCrates = eggRows.reduce((s, r) => s + (r.gradeBCount || 0), 0) / EGGS_PER_CRATE;
        eggRevenue = (gradeACrates * priceGradeA) + (gradeBCrates * priceGradeB);
      }
    }

    if (flock.operationType === 'BROILER') {
      const harvestRows = await prisma.broilerHarvest.findMany({
        where:  { flockId },
        select: { totalRevenue: true },
      });
      broilerRevenue = harvestRows.reduce((s, r) => s + parseFloat(r.totalRevenue || 0), 0);
    }

    // ── 7. Store transfer revenue estimate (from FlockLifecycleEvents) ────────
    // Revenue from TRANSFERRED_TO_STORE events is an estimate until a SalesOrder
    // is raised against the store inventory. Labelled as estimated in the UI.
    let storeTransferEstimate = 0;
    let storeTransferBirds    = 0;
    let storeTransferEvents   = [];

    try {
      const transferEvents = await prisma.flockLifecycleEvent.findMany({
        where: {
          flockId,
          tenantId:    user.tenantId,
          disposition: 'TRANSFERRED_TO_STORE',
          status:      { in: ['APPROVED', 'STORE_ACKNOWLEDGED', 'STORE_DISPUTED'] },
        },
        select: {
          id:                    true,
          eventType:             true,
          birdCount:             true,
          storeActualCount:      true,
          estimatedValuePerBird: true,
          currency:              true,
          status:                true,
          store: { select: { name: true } },
        },
      });

      storeTransferEvents = transferEvents;
      storeTransferBirds  = transferEvents.reduce((s, e) => {
        // Use store-confirmed count if acknowledged, else requested birdCount
        const count = e.storeActualCount ?? e.birdCount;
        return s + count;
      }, 0);
      storeTransferEstimate = transferEvents.reduce((s, e) => {
        const count = e.storeActualCount ?? e.birdCount;
        return s + count * parseFloat(e.estimatedValuePerBird || 0);
      }, 0);
    } catch {
      // FlockLifecycleEvent table may not exist yet — non-fatal
    }

    // ── 8. Totals & derived metrics ───────────────────────────────────────────
    const birdsDispatched = Math.max(0, flock.initialCount - totalMortality);

    // Revenue total — note storeTransferEstimate is flagged as estimated
    const confirmedRevenue = eggRevenue + broilerRevenue;
    const totalRevenue     = confirmedRevenue + storeTransferEstimate;
    const totalCost        = chickCost + feedCost + medicationCost;
    const profitLoss       = totalRevenue - totalCost;

    const margin = totalRevenue > 0
      ? parseFloat(((profitLoss / totalRevenue) * 100).toFixed(1))
      : null;

    const survivalPct = totalChicksIn > 0
      ? parseFloat(((flock.currentCount / totalChicksIn) * 100).toFixed(1))
      : null;

    const totalDozens      = totalEggs / 12;
    const feedCostPerDozen = totalDozens > 0 && feedCost > 0
      ? parseFloat((feedCost / totalDozens).toFixed(2))
      : null;

    let fcr = null;
    if (flock.operationType === 'BROILER' && totalFeedKg > 0 && birdsDispatched > 0) {
      const avgLiveWeightKg    = 2.5; // conservative default
      const totalLiveweightKg  = birdsDispatched * avgLiveWeightKg;
      if (totalLiveweightKg > 0)
        fcr = parseFloat((totalFeedKg / totalLiveweightKg).toFixed(3));
    }

    const profitStatus =
      profitLoss > 0   ? 'PROFITABLE' :
      profitLoss === 0  ? 'BREAKEVEN'  :
                          'LOSS';

    return NextResponse.json({
      flockId:              flock.id,
      batchCode:            flock.batchCode,
      breed:                flock.breed,
      operationType:        flock.operationType,
      status:               flock.status,
      sectionName:          `${flock.penSection.pen.name} · ${flock.penSection.name}`,
      depletionDisposition: flock.depletionDisposition ?? null,

      dates: {
        placement:    flock.dateOfPlacement,
        depletion:    flock.depletionDate ?? null,
        lifespanDays,
      },

      birds: {
        initial:         flock.initialCount,
        totalChicksIn,
        totalDOA,
        totalMortality,
        cullMortality,
        surviving:       flock.currentCount,
        birdsDispatched,
        survivalPct,
        storeTransferBirds,
      },

      costs: {
        chickCost:      parseFloat(chickCost.toFixed(2)),
        feedCost:       parseFloat(feedCost.toFixed(2)),
        medicationCost: parseFloat(medicationCost.toFixed(2)),
        total:          parseFloat(totalCost.toFixed(2)),
      },

      revenue: {
        eggRevenue:             parseFloat(eggRevenue.toFixed(2)),
        broilerRevenue:         parseFloat(broilerRevenue.toFixed(2)),
        // Store transfer revenue is an estimate — actual via SalesOrder
        storeTransferEstimate:  parseFloat(storeTransferEstimate.toFixed(2)),
        storeTransferIsEstimate: true,          // flag for UI to show "Est." label
        storeTransferEvents,
        confirmedRevenue:       parseFloat(confirmedRevenue.toFixed(2)),
        total:                  parseFloat(totalRevenue.toFixed(2)),
      },

      profitLoss:   parseFloat(profitLoss.toFixed(2)),
      margin,
      profitStatus,
      // Revenue note for the UI
      revenueNote: storeTransferEstimate > 0
        ? 'Store transfer revenue is estimated from approved lifecycle events. Actual revenue is recorded when a Sales Order is raised against the store.'
        : null,
      currency:    flock.purchaseCurrency ?? 'NGN',

      production: {
        totalEggs,
        totalCrates:    parseFloat(totalCrates.toFixed(1)),
        totalFeedKg:    parseFloat(totalFeedKg.toFixed(1)),
        feedCostPerDozen,
        fcr,
      },
    });

  } catch (err) {
    console.error('[GET /api/flocks/[id]/lifecycle-summary]', err);
    return NextResponse.json(
      { error: 'Failed to load lifecycle summary', detail: err?.message },
      { status: 500 },
    );
  }
}
