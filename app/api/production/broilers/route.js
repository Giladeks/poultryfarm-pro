// app/api/production/broilers/route.js — Phase 8E · Broiler Production Analytics API
//
// GET /api/production/broilers?days=30
//
// Roles: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
//
// Response shape:
// {
//   kpis:           KpiCard[]       — 6 top-level KPI cards
//   flocks:         FlockRow[]      — per-flock breakdown (Flocks tab)
//   weightSeries:   WeekPoint[]     — weight-by-age-week series for all active flocks
//   feedSeries:     DayPoint[]      — daily feed g/bird over the window
//   mortSeries:     DayPoint[]      — daily mortality over the window
//   harvests:       HarvestEntry[]  — upcoming/recent harvests for the scheduler
//   batchHistory:   BatchRow[]      — last 5 completed batches for profitability comparison
//   summary:        Summary         — tenant-wide aggregates
// }
//
// DATA RULES (inherited from project)
//   • snake_case tables: $queryRawUnsafe only (weight_samples, flock_lifecycle_events)
//   • Date boundaries: Date.UTC(y, m, d)
//   • FCR = totalFeedKg / (weightGainKg × currentBirds) — not per-record avg

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MAX_DAYS      = 365;
const DEFAULT_DAYS  = 30;

// ── Ross 308 standard weight by age in days (g) ───────────────────────────────
const ROSS_308 = {
  1: 42, 7: 190, 14: 430, 21: 790, 28: 1240, 35: 1780, 42: 2380, 49: 2900,
};
// ── Cobb 500 standard weight by age in days (g) ───────────────────────────────
const COBB_500 = {
  1: 40, 7: 180, 14: 410, 21: 760, 28: 1200, 35: 1730, 42: 2310, 49: 2850,
};

function getStdWeight(curve, ageInDays) {
  const keys = Object.keys(curve).map(Number).sort((a, b) => a - b);
  let val = curve[keys[0]];
  for (const k of keys) {
    if (ageInDays >= k) val = curve[k];
    else break;
  }
  return val;
}

// Linear interpolation between standard curve points
function interpStdWeight(curve, ageInDays) {
  const keys = Object.keys(curve).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (ageInDays >= a && ageInDays <= b) {
      const t = (ageInDays - a) / (b - a);
      return Math.round(curve[a] + t * (curve[b] - curve[a]));
    }
  }
  if (ageInDays < keys[0]) return curve[keys[0]];
  return curve[keys[keys.length - 1]];
}

// Project harvest date from current growth rate
function projectHarvestDate(flock, latestWeightG) {
  if (!flock.targetWeightG || !latestWeightG || !flock.dateOfPlacement) return null;
  const ageInDays = Math.floor((Date.now() - new Date(flock.dateOfPlacement)) / 86_400_000);
  const target    = Number(flock.targetWeightG);
  if (latestWeightG >= target) return new Date(); // already at target

  // Estimate daily weight gain from the standard curve slope at current age
  const stdNow  = interpStdWeight(ROSS_308, ageInDays);
  const stdNext = interpStdWeight(ROSS_308, ageInDays + 7);
  const dailyGainG = (stdNext - stdNow) / 7;
  if (dailyGainG <= 0) return null;

  const daysNeeded = Math.ceil((target - latestWeightG) / dailyGainG);
  const projected  = new Date();
  projected.setDate(projected.getDate() + daysNeeded);
  return projected;
}

function toDateKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const days  = Math.min(MAX_DAYS, parseInt(searchParams.get('days') || String(DEFAULT_DAYS)));

  const _t    = new Date();
  const today = new Date(Date.UTC(_t.getFullYear(), _t.getMonth(), _t.getDate()));
  const since = new Date(today);
  since.setDate(since.getDate() - days);

  try {
    // ── 1. Active broiler flocks ──────────────────────────────────────────────
    const activeFlocks = await prisma.flock.findMany({
      where: {
        tenantId:      user.tenantId,
        operationType: 'BROILER',
        status:        'ACTIVE',
      },
      include: {
        penSection: {
          select: {
            id: true, name: true,
            pen: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { dateOfPlacement: 'desc' },
    });

    const activeSectionIds = activeFlocks.map(f => f.penSectionId);

    // ── 2. Weight samples (primary source — dual-written by rearing/production pages) ──
    const weightSamplesRaw = activeSectionIds.length > 0
      ? await prisma.$queryRawUnsafe(`
          SELECT ws."flockId", ws."penSectionId", ws."sampleDate", ws."meanWeightG",
                 ws."minWeightG", ws."maxWeightG", ws."uniformityPct", ws."estimatedFCR"
          FROM weight_samples ws
          WHERE ws."tenantId" = $1
            AND ws."sampleDate" >= $2
          ORDER BY ws."sampleDate" ASC
        `, user.tenantId, since)
      : [];

    // ── 3. Mortality in window ────────────────────────────────────────────────
    const mortalityRows = activeSectionIds.length > 0
      ? await prisma.mortalityRecord.findMany({
          where: {
            penSectionId: { in: activeSectionIds },
            recordDate:   { gte: since },
          },
          select: { flockId: true, penSectionId: true, recordDate: true, count: true },
          orderBy: { recordDate: 'asc' },
        })
      : [];

    // ── 4. Feed consumption in window ─────────────────────────────────────────
    const feedRows = activeSectionIds.length > 0
      ? await prisma.feedConsumption.findMany({
          where: {
            penSectionId: { in: activeSectionIds },
            recordedDate: { gte: since },
          },
          select: {
            flockId: true, penSectionId: true, recordedDate: true,
            quantityKg: true, gramsPerBird: true,
          },
          orderBy: { recordedDate: 'asc' },
        })
      : [];

    // ── 5. Completed batches (last 5) for batch profitability comparison ──────
    const completedFlocks = await prisma.flock.findMany({
      where: {
        tenantId:      user.tenantId,
        operationType: 'BROILER',
        status:        { in: ['DEPLETED', 'SOLD', 'CULLED'] },
      },
      include: {
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    const completedIds        = completedFlocks.map(f => f.id);
    const completedSectionIds = completedFlocks.map(f => f.penSectionId);

    // Feed totals for completed batches
    const completedFeedAgg = completedIds.length > 0
      ? await prisma.feedConsumption.groupBy({
          by:    ['flockId'],
          where: { flockId: { in: completedIds } },
          _sum:  { quantityKg: true },
        })
      : [];
    const completedFeedMap = Object.fromEntries(
      completedFeedAgg.map(r => [r.flockId, Number(r._sum.quantityKg || 0)])
    );

    // Mortality totals for completed batches
    const completedMortAgg = completedIds.length > 0
      ? await prisma.mortalityRecord.groupBy({
          by:    ['flockId'],
          where: { flockId: { in: completedIds } },
          _sum:  { count: true },
        })
      : [];
    const completedMortMap = Object.fromEntries(
      completedMortAgg.map(r => [r.flockId, Number(r._sum.count || 0)])
    );

    // Last weight record per completed batch
    const completedWeights = completedSectionIds.length > 0
      ? await prisma.$queryRawUnsafe(`
          SELECT DISTINCT ON ("flockId") "flockId", "meanWeightG", "sampleDate"
          FROM weight_samples
          WHERE "flockId" = ANY($1::text[])
          ORDER BY "flockId", "sampleDate" DESC
        `, completedIds)
      : [];
    const completedWeightMap = Object.fromEntries(
      completedWeights.map(r => [r.flockId, Number(r.meanWeightG)])
    );

    // Revenue from FlockLifecycleEvents (DEPLETE/CULL TRANSFERRED_TO_STORE)
    const completedRevenue = completedIds.length > 0
      ? await prisma.flockLifecycleEvent.findMany({
          where: {
            flockId:     { in: completedIds },
            status:      { in: ['STORE_ACKNOWLEDGED', 'APPROVED'] },
            disposition: 'TRANSFERRED_TO_STORE',
          },
          select: {
            flockId: true,
            birdCount: true,
            estimatedValuePerBird: true,
          },
        })
      : [];
    const completedRevenueMap = {};
    for (const ev of completedRevenue) {
      const rev = Number(ev.birdCount) * Number(ev.estimatedValuePerBird || 0);
      completedRevenueMap[ev.flockId] = (completedRevenueMap[ev.flockId] || 0) + rev;
    }

    // ── 6. Build per-flock rows (active) ─────────────────────────────────────
    const flockRows = activeFlocks.map(flock => {
      const ageInDays = Math.floor(
        (Date.now() - new Date(flock.dateOfPlacement)) / 86_400_000
      );

      const flockWeights = weightSamplesRaw
        .filter(w => w.flockId === flock.id)
        .sort((a, b) => new Date(a.sampleDate) - new Date(b.sampleDate));

      const latestWeight  = flockWeights.at(-1);
      const latestWeightG = latestWeight ? Number(latestWeight.meanWeightG) : null;
      const firstWeight   = flockWeights[0];

      // FCR estimation: totalFeedKg / (totalWeightGainKg × birds)
      const flockFeedKg = feedRows
        .filter(r => r.flockId === flock.id)
        .reduce((s, r) => s + Number(r.quantityKg), 0);
      const weightGainKg = (latestWeightG && firstWeight)
        ? ((latestWeightG - Number(firstWeight.meanWeightG)) / 1000) * flock.currentCount
        : null;
      const fcr = weightGainKg && weightGainKg > 0
        ? parseFloat((flockFeedKg / weightGainKg).toFixed(2)) : null;

      // 7d mortality rate
      const cutoff7 = new Date(today);
      cutoff7.setDate(cutoff7.getDate() - 7);
      const deaths7d = mortalityRows
        .filter(r => r.flockId === flock.id && new Date(r.recordDate) >= cutoff7)
        .reduce((s, r) => s + r.count, 0);
      const mortRate7d = flock.currentCount > 0
        ? parseFloat(((deaths7d / flock.currentCount) * 100).toFixed(2)) : 0;

      const targetG    = flock.targetWeightG ? Number(flock.targetWeightG) : null;
      const ross308G   = interpStdWeight(ROSS_308, ageInDays);
      const cobb500G   = interpStdWeight(COBB_500, ageInDays);
      const daysToHarv = flock.expectedHarvestDate
        ? Math.max(0, Math.floor((new Date(flock.expectedHarvestDate) - new Date()) / 86_400_000))
        : null;

      // Project harvest from growth rate
      const projectedHarvest = projectHarvestDate(flock, latestWeightG);

      // Weight alert: >5% below target with ≤7 days to harvest
      const belowTargetPct = targetG && latestWeightG
        ? ((targetG - latestWeightG) / targetG) * 100 : 0;
      const harvestAlert = daysToHarv != null && daysToHarv <= 7
        && belowTargetPct > 5;

      // ADG (Average Daily Gain g/day) over last 7d
      const prev7Weight = flockWeights.filter(
        w => new Date(w.sampleDate) >= cutoff7
      )[0];
      const adg7d = (latestWeightG && prev7Weight && latestWeightG !== Number(prev7Weight.meanWeightG))
        ? parseFloat(((latestWeightG - Number(prev7Weight.meanWeightG)) / 7).toFixed(1))
        : null;

      return {
        flockId:          flock.id,
        batchCode:        flock.batchCode,
        breed:            flock.breed || 'Unknown',
        penName:          flock.penSection.pen.name,
        sectionName:      flock.penSection.name,
        currentBirds:     flock.currentCount,
        initialCount:     flock.initialCount,
        ageInDays,
        ageInWeeks:       parseFloat((ageInDays / 7).toFixed(1)),
        dateOfPlacement:  flock.dateOfPlacement,
        expectedHarvest:  flock.expectedHarvestDate,
        projectedHarvest: projectedHarvest?.toISOString() || null,
        daysToHarvest:    daysToHarv,
        targetWeightG:    targetG,
        latestWeightG,
        latestUniformity: latestWeight ? Number(latestWeight.uniformityPct) : null,
        latestSampleDate: latestWeight?.sampleDate || null,
        ross308G,
        cobb500G,
        belowTargetPct:   parseFloat(belowTargetPct.toFixed(1)),
        harvestAlert,
        fcr,
        adg7d,
        deaths7d,
        mortRate7d,
        feedKgTotal:      parseFloat(flockFeedKg.toFixed(1)),
        targetFCR:        flock.targetFCR ? Number(flock.targetFCR) : 1.85,
      };
    });

    // ── 7. Weight series for chart (by age week, averaged across all active flocks) ──
    const weightByAgeWeek = {};
    for (const w of weightSamplesRaw) {
      const flock = activeFlocks.find(f => f.id === w.flockId);
      if (!flock) continue;
      const ageInDays = Math.floor(
        (new Date(w.sampleDate) - new Date(flock.dateOfPlacement)) / 86_400_000
      );
      const ageWeek = Math.floor(ageInDays / 7);
      if (!weightByAgeWeek[ageWeek]) weightByAgeWeek[ageWeek] = { weights: [], days: ageInDays };
      weightByAgeWeek[ageWeek].weights.push(Number(w.meanWeightG));
      weightByAgeWeek[ageWeek].days = Math.max(weightByAgeWeek[ageWeek].days, ageInDays);
    }

    const weightSeries = Object.entries(weightByAgeWeek)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([week, { weights, days }]) => {
        const avgG = parseFloat((weights.reduce((s, w) => s + w, 0) / weights.length).toFixed(0));
        return {
          week:     Number(week),
          label:    `Wk ${week}`,
          avgG,
          ross308G: interpStdWeight(ROSS_308, days),
          cobb500G: interpStdWeight(COBB_500, days),
        };
      });

    // ── 8. Daily feed series (g/bird, averaged across all active sections) ────
    const feedDayMap = {};
    for (const r of feedRows) {
      const dk   = toDateKey(r.recordedDate);
      const flock = activeFlocks.find(f => f.id === r.flockId);
      if (!feedDayMap[dk]) feedDayMap[dk] = { kg: 0, birds: 0 };
      feedDayMap[dk].kg    += Number(r.quantityKg);
      feedDayMap[dk].birds += flock?.currentCount || 0;
    }
    const feedSeries = Object.entries(feedDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { kg, birds }]) => ({
        date,
        label:    new Date(date + 'T12:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
        feedKg:   parseFloat(kg.toFixed(1)),
        feedGpb:  birds > 0 ? parseFloat((kg * 1000 / birds).toFixed(1)) : null,
      }));

    // ── 9. Daily mortality series ─────────────────────────────────────────────
    const mortDayMap = {};
    for (const r of mortalityRows) {
      const dk = toDateKey(r.recordDate);
      mortDayMap[dk] = (mortDayMap[dk] || 0) + r.count;
    }
    const mortSeries = Object.entries(mortDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({
        date,
        label:  new Date(date + 'T12:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
        deaths: count,
      }));

    // ── 10. Harvest scheduler ─────────────────────────────────────────────────
    const harvests = flockRows
      .filter(f => f.expectedHarvest || f.projectedHarvest)
      .map(f => ({
        flockId:         f.flockId,
        batchCode:       f.batchCode,
        penName:         f.penName,
        sectionName:     f.sectionName,
        currentBirds:    f.currentBirds,
        daysToHarvest:   f.daysToHarvest,
        expectedHarvest: f.expectedHarvest,
        projectedHarvest: f.projectedHarvest,
        latestWeightG:   f.latestWeightG,
        targetWeightG:   f.targetWeightG,
        harvestAlert:    f.harvestAlert,
        belowTargetPct:  f.belowTargetPct,
      }))
      .sort((a, b) => (a.daysToHarvest ?? 999) - (b.daysToHarvest ?? 999));

    // ── 11. Batch history (completed flocks) ──────────────────────────────────
    const batchHistory = completedFlocks.map(flock => {
      const totalFeedKg    = completedFeedMap[flock.id] || 0;
      const finalWeightG   = completedWeightMap[flock.id] || null;
      const deaths         = completedMortMap[flock.id] || 0;
      const mortPct        = flock.initialCount > 0
        ? parseFloat(((deaths / flock.initialCount) * 100).toFixed(2)) : 0;

      const weightGainKg = finalWeightG
        ? (finalWeightG / 1000) * flock.currentCount : null;
      const fcr = weightGainKg && weightGainKg > 0
        ? parseFloat((totalFeedKg / weightGainKg).toFixed(2)) : null;

      const totalRevenue = completedRevenueMap[flock.id] || 0;
      const revenuePerBird = flock.currentCount > 0 && totalRevenue > 0
        ? parseFloat((totalRevenue / flock.currentCount).toFixed(2)) : null;

      const placementDate = new Date(flock.dateOfPlacement);
      const endDate       = flock.depletionDate
        ? new Date(flock.depletionDate)
        : new Date(flock.updatedAt);
      const cycleLength   = Math.floor((endDate - placementDate) / 86_400_000);

      return {
        flockId:       flock.id,
        batchCode:     flock.batchCode,
        breed:         flock.breed || 'Unknown',
        penName:       flock.penSection.pen.name,
        sectionName:   flock.penSection.name,
        placementDate: flock.dateOfPlacement,
        initialCount:  flock.initialCount,
        finalCount:    flock.currentCount,
        deaths,
        mortPct,
        finalWeightG,
        fcr,
        totalFeedKg:   parseFloat(totalFeedKg.toFixed(1)),
        totalRevenue:  parseFloat(totalRevenue.toFixed(2)),
        revenuePerBird,
        cycleLength,
        status:        flock.status,
      };
    });

    // ── 12. KPI cards ─────────────────────────────────────────────────────────
    const totalBirds   = flockRows.reduce((s, f) => s + f.currentBirds, 0);
    const avgWeightG   = flockRows.filter(f => f.latestWeightG).length
      ? parseFloat((flockRows.filter(f => f.latestWeightG).reduce((s, f) => s + f.latestWeightG, 0)
          / flockRows.filter(f => f.latestWeightG).length).toFixed(0))
      : null;
    const avgFCR       = flockRows.filter(f => f.fcr).length
      ? parseFloat((flockRows.filter(f => f.fcr).reduce((s, f) => s + f.fcr, 0)
          / flockRows.filter(f => f.fcr).length).toFixed(2))
      : null;
    const avgAge       = flockRows.length
      ? Math.round(flockRows.reduce((s, f) => s + f.ageInDays, 0) / flockRows.length) : 0;
    const avgMort7d    = flockRows.length
      ? parseFloat((flockRows.reduce((s, f) => s + f.mortRate7d, 0) / flockRows.length).toFixed(2))
      : 0;
    const harvestAlertCount = flockRows.filter(f => f.harvestAlert).length;
    const ross308Target = interpStdWeight(ROSS_308, avgAge);
    const weightPct     = avgWeightG ? ((avgWeightG / ross308Target) * 100).toFixed(0) : null;

    const kpis = [
      {
        icon: '🐔', label: 'Live Birds',
        value: totalBirds.toLocaleString('en-NG'),
        sub:   `${flockRows.length} active batch${flockRows.length !== 1 ? 'es' : ''}`,
        status: 'neutral',
      },
      {
        icon: '📅', label: 'Harvest Due',
        value: harvests.filter(h => (h.daysToHarvest ?? 999) <= 7).length || '—',
        sub:   'Batches due within 7 days',
        status: harvests.filter(h => (h.daysToHarvest ?? 999) <= 7).length > 0 ? 'warn' : 'neutral',
        delta: harvestAlertCount > 0 ? `${harvestAlertCount} weight alert${harvestAlertCount !== 1 ? 's' : ''}` : null,
      },
      {
        icon: '⚖️', label: 'Avg Live Weight',
        value: avgWeightG ? `${(avgWeightG / 1000).toFixed(2)} kg` : '—',
        sub:   avgAge ? `Age ~${avgAge}d · Ross 308 target ${(ross308Target / 1000).toFixed(2)} kg` : 'No weigh-in',
        status: !avgWeightG ? 'neutral'
          : avgWeightG >= ross308Target * 0.95 ? 'good'
          : avgWeightG >= ross308Target * 0.85 ? 'warn' : 'critical',
        delta: weightPct ? `${weightPct}% of Ross 308 standard` : null,
      },
      {
        icon: '🌾', label: 'Avg FCR',
        value: avgFCR != null ? String(avgFCR) : '—',
        sub:   'Feed Conversion Ratio (target ≤ 1.9)',
        status: !avgFCR ? 'neutral' : avgFCR <= 1.9 ? 'good' : avgFCR <= 2.1 ? 'warn' : 'critical',
        delta: avgFCR ? (avgFCR <= 1.9 ? 'On target' : `${(avgFCR - 1.9).toFixed(2)} above target`) : null,
      },
      {
        icon: '📉', label: 'Mortality (7d)',
        value: `${avgMort7d}%`,
        sub:   'Avg across all active sections',
        status: avgMort7d <= 0.1 ? 'good' : avgMort7d <= 0.2 ? 'warn' : 'critical',
      },
      {
        icon: '📊', label: 'Batches Completed',
        value: batchHistory.length,
        sub:   batchHistory.length > 0
          ? `Avg FCR: ${(batchHistory.filter(b => b.fcr).reduce((s, b) => s + b.fcr, 0) / (batchHistory.filter(b => b.fcr).length || 1)).toFixed(2)}`
          : 'No completed batches yet',
        status: 'neutral',
      },
    ];

    return NextResponse.json({
      kpis,
      flocks:       flockRows,
      weightSeries,
      feedSeries,
      mortSeries,
      harvests,
      batchHistory,
      summary: {
        totalBirds,
        activeBatches:     flockRows.length,
        completedBatches:  batchHistory.length,
        harvestAlerts:     harvestAlertCount,
        avgWeightG,
        avgFCR,
        avgMortRate7d:     avgMort7d,
      },
    });

  } catch (err) {
    console.error('[GET /api/production/broilers]', err);
    return NextResponse.json({ error: 'Failed to load broiler analytics', detail: err?.message }, { status: 500 });
  }
}
