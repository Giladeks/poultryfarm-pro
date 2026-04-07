// app/api/production/layers/route.js — Phase 8D · Layer Production Analytics API
//
// GET /api/production/layers?days=30
//
// Roles: FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN only
//
// Response shape (consumed by app/production/layers/page.js):
// {
//   kpis:               KpiCard[],        // 6 top-level KPI cards
//   chartData:          DayPoint[],       // daily series for Overview charts (30d default)
//   curveData:          WeekPoint[],      // laying rate by flock-age week (Production tab)
//   peakWeek:           { week, rate } | null,
//   postPeakDeclineRate: number | null,   // %/week avg drop since peak
//   costData:           WeekCostPoint[],  // weekly feed cost vs revenue (Feed & Cost tab)
//   costSummary:        CostSummary,
//   mortData:           WeekMortPoint[],  // weekly deaths (Mortality tab)
//   cumulData:          WeekPoint[],      // cumulative mortality % by flock-age week
//   mortSummary:        MortSummary,
//   flocks:             FlockRow[],       // per-flock breakdown (Flocks tab)
// }
//
// DATA RULES
//   • Laying rate   = totalEggs / currentBirds × 100  (never avg of per-record rates)
//   • Feed cost/crate = (feedKg × costPerKg) / (totalEggs / 30)
//   • Date boundaries: Date.UTC(y, m, d)  — server runs WAT UTC+1
//   • snake_case tables (flock_transfers, temperature_logs, weight_samples)
//     must use prisma.$queryRawUnsafe() — NEVER prisma accessor
//   • All queries scoped by tenantId

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ROLES  = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MAX_DAYS       = 365;
const DEFAULT_DAYS   = 30;
const EGGS_PER_CRATE = 30;
const LAY_TARGET_PCT = 82;   // % — reference for KPI status
const LAY_CRIT_PCT   = 70;
const HH_TARGET_PCT  = 78;
const FEED_GPB_TARGET= 120;  // g/bird/day
const CULL_WEEKS     = 2;    // consecutive weeks cost > revenue before cull flag

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Timezone-safe YYYY-MM-DD from any Date — avoids WAT/UTC shift bugs
function toDateKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

// Build from-date at UTC midnight for the given day-count window
// Uses Date.UTC to avoid WAT shift (server is UTC+1)
function buildFrom(days) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

function kpiStatus(val, target, critical) {
  if (val == null) return 'neutral';
  if (val >= target)   return 'good';
  if (val >= critical) return 'warn';
  return 'bad';
}

// Week label: "Wk 18" from age in days
function weekLabel(days) {
  return `Wk ${Math.floor((days || 0) / 7)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get('days') || DEFAULT_DAYS), MAX_DAYS);
  const from = buildFrom(days);

  try {
    // ── 1. Load all active PRODUCTION layer flocks for this tenant ────────────
    const flocks = await prisma.flock.findMany({
      where: {
        tenantId:      user.tenantId,
        operationType: 'LAYER',
        stage:         'PRODUCTION',
        status:        'ACTIVE',
      },
      select: {
        id:              true,
        batchCode:       true,
        dateOfPlacement: true,
        pointOfLayDate:  true,
        initialCount:    true,
        currentCount:    true,
        penSectionId:    true,
        penSection: {
          select: {
            id:   true,
            name: true,
            pen:  { select: { name: true } },
          },
        },
      },
      orderBy: { dateOfPlacement: 'asc' },
    });

    if (!flocks.length) {
      return NextResponse.json(buildEmptyResponse());
    }

    const flockIds     = flocks.map(f => f.id);
    const sectionIds   = flocks.map(f => f.penSectionId);
    const totalBirds   = flocks.reduce((s, f) => s + (f.currentCount || 0), 0);
    const totalInitial = flocks.reduce((s, f) => s + (f.initialCount || 0), 0);

    // ── 2. Tenant settings: feedBagWeightKg, Grade A/B sale prices ────────────
    const tenant = await prisma.tenant.findUnique({
      where:  { id: user.tenantId },
      select: { settings: true },
    });
    const settings               = tenant?.settings || {};
    const feedBagWeightKg        = parseFloat(settings.feedBagWeightKg            || 25);
    const priceGradeA            = parseFloat(settings.eggSalePriceGradeAPerCrate || 0);
    const priceGradeB            = parseFloat(settings.eggSalePriceGradeBPerCrate || 0);
    const hasSalePrice           = priceGradeA > 0 || priceGradeB > 0;
    // Weighted blended price — used for simple single-value displays
    // Will be replaced by per-grade revenue in cost calculations below

    // ── 3. Parallel data fetch ────────────────────────────────────────────────
    const [eggRows, feedRows, mortRows, feedInventory] = await Promise.all([

      // Egg production for all production layer sections in window
      prisma.eggProduction.findMany({
        where: {
          penSectionId:   { in: sectionIds },
          flockId:        { in: flockIds },
          collectionDate: { gte: from },
        },
        select: {
          flockId:        true,
          penSectionId:   true,
          collectionDate: true,
          totalEggs:      true,
          gradeACount:    true,
          gradeBCount:    true,
          crackedCount:   true,
          cratesCollected:true,
        },
        orderBy: { collectionDate: 'asc' },
      }),

      // Feed consumption for all production layer sections in window
      prisma.feedConsumption.findMany({
        where: {
          penSectionId: { in: sectionIds },
          flockId:      { in: flockIds },
          recordedDate: { gte: from },
        },
        select: {
          flockId:         true,
          penSectionId:    true,
          recordedDate:    true,
          quantityKg:      true,
          feedInventoryId: true,
        },
        orderBy: { recordedDate: 'asc' },
      }),

      // Mortality for all production layer sections — full history for cumulative chart
      // (not bounded by `from` — we need from dateOfPlacement for cumulative curve)
      prisma.mortalityRecord.findMany({
        where: {
          penSectionId: { in: sectionIds },
          flockId:      { in: flockIds },
        },
        select: {
          flockId:    true,
          recordDate: true,
          count:      true,
        },
        orderBy: { recordDate: 'asc' },
      }),

      // Feed inventory items to get costPerKg per feedInventoryId
      prisma.feedInventory.findMany({
        where: {
          store: { farm: { tenantId: user.tenantId } },
        },
        select: {
          id:         true,
          costPerKg:  true,
          bagWeightKg:true,
        },
      }),
    ]);

    // ── 4. Build lookup maps ──────────────────────────────────────────────────
    const feedCostMap = Object.fromEntries(
      feedInventory.map(fi => [fi.id, parseFloat(fi.costPerKg || 0)])
    );

    // Flock lookup by id
    const flockById = Object.fromEntries(flocks.map(f => [f.id, f]));

    // ── 5. Aggregate egg data by DATE (cross-flock, for Overview chart) ───────
    // Key: YYYY-MM-DD → { totalEggs, gradeACount, gradeBCount, cratesCollected }
    const eggByDate = {};
    eggRows.forEach(r => {
      const dk = toDateKey(r.collectionDate);
      if (!eggByDate[dk]) eggByDate[dk] = { totalEggs: 0, gradeACount: 0, gradeBCount: 0, cratesCollected: 0 };
      eggByDate[dk].totalEggs      += r.totalEggs      || 0;
      eggByDate[dk].gradeACount    += r.gradeACount    || 0;
      eggByDate[dk].gradeBCount    += r.gradeBCount    || 0;
      eggByDate[dk].cratesCollected+= r.cratesCollected|| 0;
    });

    // ── 6. Aggregate feed data by DATE with cost ──────────────────────────────
    const feedByDate = {};
    feedRows.forEach(r => {
      const dk    = toDateKey(r.recordedDate);
      const kg    = parseFloat(r.quantityKg || 0);
      const cPkg  = feedCostMap[r.feedInventoryId] || 0;
      const cost  = kg * cPkg;
      if (!feedByDate[dk]) feedByDate[dk] = { kg: 0, cost: 0 };
      feedByDate[dk].kg   += kg;
      feedByDate[dk].cost += cost;
    });

    // ── 7. Build Overview chartData (daily series for date window) ────────────
    const dateRange = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setUTCDate(d.getUTCDate() + i);
      dateRange.push(toDateKey(d));
    }

    const chartData = dateRange.map(date => {
      const egg  = eggByDate[date]  || { totalEggs: 0, gradeACount: 0, gradeBCount: 0 };
      const feed = feedByDate[date] || { kg: 0, cost: 0 };
      const layingRate = totalBirds > 0 && egg.totalEggs > 0
        ? parseFloat((egg.totalEggs / totalBirds * 100).toFixed(2)) : null;
      const feedGpb = totalBirds > 0 && feed.kg > 0
        ? parseFloat((feed.kg * 1000 / totalBirds).toFixed(1)) : null;
      const gradeAPct = egg.totalEggs > 0 && egg.gradeACount > 0
        ? parseFloat((egg.gradeACount / egg.totalEggs * 100).toFixed(1)) : null;
      // Feed cost per crate = (feedKg × costPerKg) / (totalEggs / 30)
      const crates = egg.totalEggs / EGGS_PER_CRATE;
      const feedCostPerCrate = crates > 0 && feed.cost > 0
        ? parseFloat((feed.cost / crates).toFixed(2)) : null;
      // Grade-split revenue per crate (blended: gradeA revenue + gradeB revenue / total crates)
      const gradeACrates = egg.gradeACount / EGGS_PER_CRATE;
      const gradeBCrates = egg.gradeBCount / EGGS_PER_CRATE;
      const revenueTotal = (gradeACrates * priceGradeA) + (gradeBCrates * priceGradeB);
      const revenuePerCrate = hasSalePrice && crates > 0
        ? parseFloat((revenueTotal / crates).toFixed(2)) : null;
      return { date, totalEggs: egg.totalEggs || null, layingRate, feedGpb, gradeAPct, feedKg: feed.kg || null, feedCostPerCrate, revenuePerCrate };
    });

    // ── 8. Overview KPI cards ─────────────────────────────────────────────────
    // 8a. Hen-Housed Production Rate %
    //     = totalEggsToDate / (initialCount × daysInLay) × 100
    //     daysInLay = days since earliest pointOfLayDate (or dateOfPlacement if null)
    const earliestLayStart = flocks.reduce((earliest, f) => {
      const d = f.pointOfLayDate || f.dateOfPlacement;
      return !earliest || d < earliest ? d : earliest;
    }, null);
    const daysInLay     = earliestLayStart
      ? Math.max(1, Math.floor((Date.now() - new Date(earliestLayStart)) / 86400000))
      : days;
    const totalEggsToDate = Object.values(eggByDate).reduce((s, d) => s + d.totalEggs, 0);
    const hhRate = totalInitial > 0 && daysInLay > 0
      ? parseFloat((totalEggsToDate / (totalInitial * daysInLay) * 100).toFixed(2)) : null;

    // 8b. Laying rate today
    const today = toDateKey(new Date());
    const todayEggs = eggByDate[today]?.totalEggs || 0;
    const todayLayingRate = totalBirds > 0 && todayEggs > 0
      ? parseFloat((todayEggs / totalBirds * 100).toFixed(1)) : null;

    // 8c. Feed cost per crate (last `days` window average)
    const totalFeedKg   = Object.values(feedByDate).reduce((s, d) => s + d.kg, 0);
    const totalFeedCost = Object.values(feedByDate).reduce((s, d) => s + d.cost, 0);
    const totalCrates   = totalEggsToDate / EGGS_PER_CRATE;
    const avgFeedCostPerCrate = totalCrates > 0 && totalFeedCost > 0
      ? parseFloat((totalFeedCost / totalCrates).toFixed(2)) : null;

    // 8d. Peak week (from curve data — computed below; placeholder here)
    // 8e. Cumulative mortality
    const totalDeaths    = totalInitial - totalBirds;
    const cumulMortPct   = totalInitial > 0
      ? parseFloat((totalDeaths / totalInitial * 100).toFixed(2)) : null;

    // 8f. Grade A rate (7-day rolling)
    const sevenDaysAgo7d = new Date(Date.now() - 7 * 86400000);
    const last7Keys      = dateRange.filter(dk => new Date(dk) >= sevenDaysAgo7d);
    const last7Eggs      = last7Keys.reduce((s, dk) => s + (eggByDate[dk]?.totalEggs || 0), 0);
    const last7GradeA    = last7Keys.reduce((s, dk) => s + (eggByDate[dk]?.gradeACount || 0), 0);
    const gradeARate7d   = last7Eggs > 0 ? parseFloat((last7GradeA / last7Eggs * 100).toFixed(1)) : null;

    const kpis = [
      {
        icon: '📊', label: 'Hen-Housed Rate',
        value: hhRate != null ? `${hhRate.toFixed(1)}%` : '—',
        sub:   `Target ≥${HH_TARGET_PCT}% · ${daysInLay}d since lay start`,
        delta: hhRate != null ? (hhRate >= HH_TARGET_PCT ? `+${(hhRate - HH_TARGET_PCT).toFixed(1)}% above target` : `${(hhRate - HH_TARGET_PCT).toFixed(1)}% below target`) : 'No data yet',
        status: kpiStatus(hhRate, HH_TARGET_PCT, HH_TARGET_PCT - 8),
      },
      {
        icon: '🥚', label: 'Laying Rate Today',
        value: todayLayingRate != null ? `${todayLayingRate}%` : '—',
        sub:   `Target ≥${LAY_TARGET_PCT}% · ${totalBirds.toLocaleString('en-NG')} birds`,
        delta: todayLayingRate != null ? (todayLayingRate >= LAY_TARGET_PCT ? `+${(todayLayingRate - LAY_TARGET_PCT).toFixed(1)}% above target` : `${(todayLayingRate - LAY_TARGET_PCT).toFixed(1)}% below target`) : 'No eggs recorded today',
        status: kpiStatus(todayLayingRate, LAY_TARGET_PCT, LAY_CRIT_PCT),
      },
      {
        icon: '🌾', label: 'Feed Cost / Crate',
        value: avgFeedCostPerCrate != null ? `₦${avgFeedCostPerCrate.toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : '—',
        sub:   `Last ${days} days · (feedKg × cost/kg) ÷ crates`,
        delta: avgFeedCostPerCrate != null && hasSalePrice
          ? (avgFeedCostPerCrate < priceGradeA ? 'Below Grade A price ✓' : '⚠️ Exceeds Grade A price')
          : hasSalePrice ? 'No feed cost data' : 'Set egg sale prices in Settings',
        status: avgFeedCostPerCrate != null && hasSalePrice
          ? (avgFeedCostPerCrate < priceGradeA ? 'good' : 'bad') : 'neutral',
      },
      {
        icon: '📈', label: 'Peak Week',
        value: '—', // filled in after curveData computed below
        sub:   'Highest 7-day laying rate week',
        delta: '',
        status: 'neutral',
        _placeholder: 'peakWeek',
      },
      {
        icon: '📉', label: 'Cumulative Mortality',
        value: cumulMortPct != null ? `${cumulMortPct}%` : '—',
        sub:   `${totalDeaths.toLocaleString('en-NG')} deaths since placement`,
        delta: cumulMortPct != null ? (cumulMortPct <= 3 ? 'Normal range' : cumulMortPct <= 6 ? 'Slightly elevated' : 'Elevated — investigate') : '',
        status: cumulMortPct != null ? (cumulMortPct <= 3 ? 'good' : cumulMortPct <= 6 ? 'warn' : 'bad') : 'neutral',
      },
      {
        icon: '⭐', label: 'Grade A Rate (7d)',
        value: gradeARate7d != null ? `${gradeARate7d}%` : '—',
        sub:   'Target ≥85%',
        delta: gradeARate7d != null ? (gradeARate7d >= 85 ? `+${(gradeARate7d - 85).toFixed(1)}% above target` : `${(gradeARate7d - 85).toFixed(1)}% below target`) : 'No graded data yet',
        status: gradeARate7d != null ? (gradeARate7d >= 85 ? 'good' : gradeARate7d >= 78 ? 'warn' : 'bad') : 'neutral',
      },
    ];

    // ── 9. Production Curve — laying rate by flock-age week ───────────────────
    // Aggregate across all flocks: for each calendar week of production,
    // compute the avg flock age and the laying rate for that week.
    // Key: weeksSincePlacement (integer) → { totalEggs, ageInDays }
    const weekBuckets = {};
    eggRows.forEach(r => {
      const flock = flockById[r.flockId];
      if (!flock) return;
      const placement  = new Date(flock.dateOfPlacement);
      const colDate    = new Date(r.collectionDate);
      const ageDays    = Math.floor((colDate - placement) / 86400000);
      const ageWeek    = Math.floor(ageDays / 7);
      if (!weekBuckets[ageWeek]) weekBuckets[ageWeek] = { totalEggs: 0, ageInDays: ageDays, birds: flock.currentCount };
      weekBuckets[ageWeek].totalEggs += r.totalEggs || 0;
    });

    const curveData = Object.entries(weekBuckets)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([week, d]) => ({
        week:       Number(week),
        weekLabel:  `Wk ${week}`,
        ageInDays:  d.ageInDays,
        layingRate: d.birds > 0 ? parseFloat((d.totalEggs / (d.birds * 7) * 100).toFixed(2)) : null,
        totalEggs:  d.totalEggs,
      }));

    // ── 9b. Per-flock curves for overlay lines ────────────────────────────────
    // Same bucketing as aggregate but filtered per flock.
    // Each entry: { flockId, batchCode, points: [{ week, weekLabel, layingRate }] }
    const flockCurves = flocks.map(flock => {
      const flockWeekBuckets = {};
      eggRows
        .filter(r => r.flockId === flock.id)
        .forEach(r => {
          const placement = new Date(flock.dateOfPlacement);
          const colDate   = new Date(r.collectionDate);
          const ageDays   = Math.floor((colDate - placement) / 86400000);
          const ageWeek   = Math.floor(ageDays / 7);
          if (!flockWeekBuckets[ageWeek]) flockWeekBuckets[ageWeek] = { totalEggs: 0 };
          flockWeekBuckets[ageWeek].totalEggs += r.totalEggs || 0;
        });
      const points = Object.entries(flockWeekBuckets)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([week, d]) => ({
          week:       Number(week),
          weekLabel:  `Wk ${week}`,
          // Rate: eggs per week / (birds × 7 days)
          layingRate: flock.currentCount > 0
            ? parseFloat((d.totalEggs / (flock.currentCount * 7) * 100).toFixed(2)) : null,
        }));
      return { flockId: flock.id, batchCode: flock.batchCode, points };
    }).filter(f => f.points.length > 0);

    // Peak week detection
    let peakWeek = null;
    let postPeakDeclineRate = null;
    if (curveData.length > 0) {
      const peak = curveData.reduce((best, w) =>
        (w.layingRate ?? 0) > (best.layingRate ?? 0) ? w : best, curveData[0]);
      peakWeek = { week: peak.week, rate: peak.layingRate };

      // Post-peak decline rate: avg weekly drop for weeks after peak
      const postPeak = curveData.filter(w => w.week > peak.week && w.layingRate != null);
      if (postPeak.length >= 2) {
        const drops = [];
        for (let i = 1; i < postPeak.length; i++) {
          drops.push((postPeak[i-1].layingRate - postPeak[i].layingRate));
        }
        postPeakDeclineRate = parseFloat((drops.reduce((s, d) => s + d, 0) / drops.length).toFixed(2));
      }

      // Back-fill the peak week KPI card
      const peakKpi = kpis.find(k => k._placeholder === 'peakWeek');
      if (peakKpi) {
        peakKpi.value = `Week ${peakWeek.week}`;
        peakKpi.sub   = `${peakWeek.rate?.toFixed(1)}% laying rate`;
        peakKpi.delta = postPeakDeclineRate != null ? `Declining ${postPeakDeclineRate.toFixed(2)}%/week post-peak` : 'Still at or near peak';
        peakKpi.status = 'good';
        delete peakKpi._placeholder;
      }
    }

    // ── 10. Feed & Cost — weekly feed cost vs revenue ─────────────────────────
    // Group by ISO week (Monday-start); compute feedCostPerCrate and revenuePerCrate
    const costWeekMap = {};
    feedRows.forEach(r => {
      const d      = new Date(r.recordedDate);
      // ISO week key: YYYY-WNN
      const jan4   = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      const weekNo = Math.ceil(((d - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7);
      const wk     = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
      const kg     = parseFloat(r.quantityKg || 0);
      const cost   = kg * (feedCostMap[r.feedInventoryId] || 0);
      if (!costWeekMap[wk]) costWeekMap[wk] = { feedCostTotal: 0, eggsTotal: 0, label: wk };
      costWeekMap[wk].feedCostTotal += cost;
    });
    // Add eggs per week
    eggRows.forEach(r => {
      const d      = new Date(r.collectionDate);
      const jan4   = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
      const weekNo = Math.ceil(((d - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7);
      const wk     = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
      if (!costWeekMap[wk]) costWeekMap[wk] = { feedCostTotal: 0, eggsTotal: 0, label: wk };
      costWeekMap[wk].eggsTotal += r.totalEggs || 0;
    });

    // Track consecutive weeks where feedCostPerCrate > blended revenuePerCrate
    let consecutiveCullWeeks = 0;
    const costData = Object.entries(costWeekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, d]) => {
        const crates = d.eggsTotal / EGGS_PER_CRATE;
        const feedCostPerCrate = crates > 0 && d.feedCostTotal > 0
          ? parseFloat((d.feedCostTotal / crates).toFixed(2)) : null;
        // Grade-split revenue: need per-week grade counts
        // Use the eggRows already loaded — filter by ISO week
        const weekEggRows = eggRows.filter(r => {
          const rd   = new Date(r.collectionDate);
          const j4   = new Date(Date.UTC(rd.getUTCFullYear(), 0, 4));
          const wkNo = Math.ceil(((rd - j4) / 86400000 + j4.getUTCDay() + 1) / 7);
          return `${rd.getUTCFullYear()}-W${String(wkNo).padStart(2,'0')}` === wk;
        });
        const wkGradeACrates = weekEggRows.reduce((s, r) => s + (r.gradeACount || 0), 0) / EGGS_PER_CRATE;
        const wkGradeBCrates = weekEggRows.reduce((s, r) => s + (r.gradeBCount || 0), 0) / EGGS_PER_CRATE;
        const revenueTotal   = (wkGradeACrates * priceGradeA) + (wkGradeBCrates * priceGradeB);
        const revenuePerCrate = hasSalePrice && crates > 0
          ? parseFloat((revenueTotal / crates).toFixed(2)) : null;
        const costExceedsRevenue = feedCostPerCrate != null && revenuePerCrate != null
          && feedCostPerCrate > revenuePerCrate;
        if (costExceedsRevenue) consecutiveCullWeeks++;
        else consecutiveCullWeeks = 0;
        return { weekLabel: wk, feedCostPerCrate, revenuePerCrate, costExceedsRevenue,
          gradeAPrice: priceGradeA || null, gradeBPrice: priceGradeB || null };
      });

    // Cost summary
    const costDataWithValues  = costData.filter(d => d.feedCostPerCrate != null);
    const avgFeedCostPerCrate2 = costDataWithValues.length
      ? parseFloat((costDataWithValues.reduce((s, d) => s + d.feedCostPerCrate, 0) / costDataWithValues.length).toFixed(2))
      : null;
    // Blended avg revenue: weight Grade A/B by their share of total eggs
    const totalGradeAEggs = eggRows.reduce((s, r) => s + (r.gradeACount || 0), 0);
    const totalGradeBEggs = eggRows.reduce((s, r) => s + (r.gradeBCount || 0), 0);
    const totalGradedEggs = totalGradeAEggs + totalGradeBEggs;
    const blendedRevenuePerCrate = totalGradedEggs > 0 && hasSalePrice
      ? parseFloat((
          (totalGradeAEggs / totalGradedEggs * priceGradeA) +
          (totalGradeBEggs / totalGradedEggs * priceGradeB)
        ).toFixed(2))
      : (hasSalePrice ? priceGradeA : null);
    const feedCostPct = avgFeedCostPerCrate2 != null && blendedRevenuePerCrate
      ? parseFloat((avgFeedCostPerCrate2 / blendedRevenuePerCrate * 100).toFixed(1)) : null;

    const costSummary = {
      avgFeedCostPerCrate: avgFeedCostPerCrate2,
      avgRevenuePerCrate:  blendedRevenuePerCrate,
      gradeAPrice:         priceGradeA || null,
      gradeBPrice:         priceGradeB || null,
      feedCostPct,
    };

    // ── 11. Mortality — weekly deaths & cumulative by flock-age week ──────────
    // Weekly deaths (calendar-week buckets for the `days` window)
    const mortWeekMap = {};
    mortRows
      .filter(r => new Date(r.recordDate) >= from)
      .forEach(r => {
        const d      = new Date(r.recordDate);
        const jan4   = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        const weekNo = Math.ceil(((d - jan4) / 86400000 + jan4.getUTCDay() + 1) / 7);
        const wk     = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
        if (!mortWeekMap[wk]) mortWeekMap[wk] = { deaths: 0 };
        mortWeekMap[wk].deaths += r.count || 0;
      });

    const mortData = Object.entries(mortWeekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, d]) => ({ weekLabel: wk, deaths: d.deaths }));

    // Cumulative mortality by flock-age week (uses full mortRows history)
    const cumulWeekMap = {};
    mortRows.forEach(r => {
      const flock   = flockById[r.flockId];
      if (!flock) return;
      const ageDays = Math.floor((new Date(r.recordDate) - new Date(flock.dateOfPlacement)) / 86400000);
      const ageWeek = Math.floor(ageDays / 7);
      if (!cumulWeekMap[ageWeek]) cumulWeekMap[ageWeek] = 0;
      cumulWeekMap[ageWeek] += r.count || 0;
    });

    let runningDeaths = 0;
    const cumulData = Object.entries(cumulWeekMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([week, deaths]) => {
        runningDeaths += deaths;
        return {
          week:         Number(week),
          weekLabel:    `Wk ${week}`,
          deaths,
          cumulDeaths:  runningDeaths,
          cumulMortPct: totalInitial > 0
            ? parseFloat((runningDeaths / totalInitial * 100).toFixed(3)) : null,
        };
      });

    // Mortality summary
    const weekDeaths = mortRows
      .filter(r => new Date(r.recordDate) >= new Date(Date.now() - 7 * 86400000))
      .reduce((s, r) => s + (r.count || 0), 0);
    const weekMortRate = totalBirds > 0
      ? parseFloat((weekDeaths / totalBirds * 100).toFixed(3)) : null;

    const mortSummary = { cumulMortPct, weekDeaths, weekMortRate };

    // ── 12. Per-flock rows (Flocks tab) ───────────────────────────────────────
    // For each flock: laying rate, hen-housed rate, feed g/bird, cumul mort, cull flag
    const flockRows = flocks.map(flock => {
      const ageInDays = Math.floor((Date.now() - new Date(flock.dateOfPlacement)) / 86400000);
      const ageWeeks  = Math.floor(ageInDays / 7);

      // Today's eggs for this flock
      const todayEggRows = eggRows.filter(r =>
        r.flockId === flock.id && toDateKey(r.collectionDate) === today
      );
      const flockTodayEggs = todayEggRows.reduce((s, r) => s + (r.totalEggs || 0), 0);
      const flockLayingRate = flock.currentCount > 0 && flockTodayEggs > 0
        ? parseFloat((flockTodayEggs / flock.currentCount * 100).toFixed(1)) : null;

      // Hen-housed rate for this flock
      const flockTotalEggs = eggRows
        .filter(r => r.flockId === flock.id)
        .reduce((s, r) => s + (r.totalEggs || 0), 0);
      const flockDaysInLay = flock.pointOfLayDate
        ? Math.max(1, Math.floor((Date.now() - new Date(flock.pointOfLayDate)) / 86400000))
        : daysInLay;
      const flockHHRate = flock.initialCount > 0 && flockDaysInLay > 0
        ? parseFloat((flockTotalEggs / (flock.initialCount * flockDaysInLay) * 100).toFixed(2)) : null;

      // Feed g/bird (avg daily over window)
      const flockFeedRows = feedRows.filter(r => r.flockId === flock.id);
      const flockFeedKg   = flockFeedRows.reduce((s, r) => s + parseFloat(r.quantityKg || 0), 0);
      const feedDays      = Math.min(days, ageInDays);
      const flockFeedGpb  = flock.currentCount > 0 && flockFeedKg > 0 && feedDays > 0
        ? parseFloat((flockFeedKg * 1000 / flock.currentCount / feedDays).toFixed(1)) : null;

      // Cumulative mortality for this flock
      const flockDeaths     = flock.initialCount - flock.currentCount;
      const flockCumulMort  = flock.initialCount > 0
        ? parseFloat((flockDeaths / flock.initialCount * 100).toFixed(2)) : null;

      // Feed cost per crate for this flock (window)
      const flockFeedCost = flockFeedRows.reduce((s, r) =>
        s + parseFloat(r.quantityKg || 0) * (feedCostMap[r.feedInventoryId] || 0), 0
      );
      const flockCrates   = flockTotalEggs / EGGS_PER_CRATE;
      const flockFeedCostPerCrate = flockCrates > 0 && flockFeedCost > 0
        ? parseFloat((flockFeedCost / flockCrates).toFixed(2)) : null;

      // Per-flock grade-split revenue for cull signal
      const flockGradeACrates = eggRows
        .filter(r => r.flockId === flock.id)
        .reduce((s, r) => s + (r.gradeACount || 0), 0) / EGGS_PER_CRATE;
      const flockGradeBCrates = eggRows
        .filter(r => r.flockId === flock.id)
        .reduce((s, r) => s + (r.gradeBCount || 0), 0) / EGGS_PER_CRATE;
      const flockBlendedRevenue = flockCrates > 0 && hasSalePrice
        ? parseFloat((((flockGradeACrates * priceGradeA) + (flockGradeBCrates * priceGradeB)) / flockCrates).toFixed(2))
        : null;

      // Cull recommendation: feedCostPerCrate > blended revenuePerCrate
      const cullRecommended = hasSalePrice && flockFeedCostPerCrate != null
        && flockBlendedRevenue != null
        && flockFeedCostPerCrate > flockBlendedRevenue
        && consecutiveCullWeeks >= CULL_WEEKS;

      return {
        flockId:        flock.id,
        batchCode:      flock.batchCode,
        sectionName:    `${flock.penSection.pen.name} · ${flock.penSection.name}`,
        currentBirds:   flock.currentCount,
        ageWeeks,
        ageInDays,
        layingRate:     flockLayingRate,
        henHousedRate:  flockHHRate,
        feedGpb:        flockFeedGpb,
        cumulMortPct:   flockCumulMort,
        feedCostPerCrate: flockFeedCostPerCrate,
        cullRecommended,
      };
    });

    // ── 13. Assemble and return ───────────────────────────────────────────────
    return NextResponse.json({
      kpis,
      chartData,
      curveData,
      flockCurves,
      peakWeek,
      postPeakDeclineRate,
      costData,
      costSummary,
      mortData,
      cumulData,
      mortSummary,
      flocks: flockRows,
      // Meta — useful for debug / client logging
      _meta: {
        tenantId:      user.tenantId,
        flockCount:    flocks.length,
        totalBirds,
        days,
        hasSalePrice,
        priceGradeA,
        priceGradeB,
        feedBagWeightKg,
      },
    });

  } catch (err) {
    console.error('[API /production/layers] error:', err);
    return NextResponse.json({ error: 'Failed to load layer analytics' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY RESPONSE — returned when no active production layer flocks exist
// ─────────────────────────────────────────────────────────────────────────────
function buildEmptyResponse() {
  return {
    kpis: [
      { icon: '📊', label: 'Hen-Housed Rate',      value: '—', sub: 'No active production flocks', status: 'neutral' },
      { icon: '🥚', label: 'Laying Rate Today',    value: '—', sub: 'No active production flocks', status: 'neutral' },
      { icon: '🌾', label: 'Feed Cost / Crate',    value: '—', sub: 'No active production flocks', status: 'neutral' },
      { icon: '📈', label: 'Peak Week',             value: '—', sub: 'No active production flocks', status: 'neutral' },
      { icon: '📉', label: 'Cumulative Mortality',  value: '—', sub: 'No active production flocks', status: 'neutral' },
      { icon: '⭐', label: 'Grade A Rate (7d)',      value: '—', sub: 'No active production flocks', status: 'neutral' },
    ],
    chartData:           [],
    curveData:           [],
    flockCurves:         [],
    peakWeek:            null,
    postPeakDeclineRate: null,
    costData:            [],
    costSummary:         { avgFeedCostPerCrate: null, avgRevenuePerCrate: null, feedCostPct: null },
    mortData:            [],
    cumulData:           [],
    mortSummary:         { cumulMortPct: null, weekDeaths: 0, weekMortRate: null },
    flocks:              [],
    _meta:               { flockCount: 0 },
  };
}
