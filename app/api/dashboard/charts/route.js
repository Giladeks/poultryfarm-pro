// app/api/dashboard/charts/route.js
// Returns daily time-series data for a section (7d–90d window).
// Response shape:
//   { isLayer, sectionName, penName, days, series: [...], chart: [...] }
//   'series' is the canonical array for the new ChartModal.
//   'chart'  is preserved for backward compat with any legacy callers.
//
// Fix: all date keys are built using toLocaleDateString('en-CA') which gives
// YYYY-MM-DD in local time, avoiding UTC shift bugs when the server runs in
// a non-UTC timezone (e.g. WAT UTC+1).
// Phase 8C: broiler series now includes avgTemp from temperature_logs (raw SQL).

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

// Timezone-safe YYYY-MM-DD from any Date object
function toDateKey(d) {
  const dt = new Date(d);
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const day= String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sectionId = searchParams.get('sectionId');
  const days      = Math.min(parseInt(searchParams.get('days') || '14'), 90);
  const stage     = searchParams.get('stage') || 'PRODUCTION'; // BROODING | REARING | PRODUCTION

  if (!sectionId) return NextResponse.json({ error: 'sectionId required' }, { status: 400 });

  const section = await prisma.penSection.findFirst({
    where:   { id: sectionId, pen: { farm: { tenantId: user.tenantId } } },
    include: { pen: { select: { operationType: true, name: true } } },
  });
  if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 });

  // Build `from` at local midnight
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  const isLayer   = section.pen.operationType === 'LAYER';
  // For LAYER flocks in REARING stage, show weight/feed/mortality charts (not eggs)
  const isRearing = isLayer && stage === 'REARING';
  const isBrooding = stage === 'BROODING';

  // Build dateRange using local date parts
  const dateRange = Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return toDateKey(d);
  });

  // Ross 308 rough estimate for broiler target weight curve
  const ross308 = (age) => Math.round(42 * Math.pow(1.085, age / 7) * 10) / 10;

  // LAYER REARING — same charts as broiler (weight growth, feed, mortality)
  // No eggs during rearing period
  if (isRearing) {
    const [weightRecords, weightSamplesRaw, mortality, feed] = await Promise.all([
      // weight_records — written by /api/weight-records
      prisma.weightRecord.findMany({
        where:   { penSectionId: sectionId, recordDate: { gte: from } },
        select:  { recordDate: true, avgWeightG: true, minWeightG: true, maxWeightG: true, uniformityPct: true, ageInDays: true },
        orderBy: { recordDate: 'asc' },
      }),
      // weight_samples — written by /api/weight-samples (rearing page may use either)
      prisma.$queryRawUnsafe(
        `SELECT "sampleDate" as "recordDate", "meanWeightG" as "avgWeightG",
                "minWeightG", "maxWeightG", "uniformityPct", NULL as "ageInDays"
         FROM weight_samples
         WHERE "penSectionId" = $1 AND "sampleDate" >= $2
         ORDER BY "sampleDate" ASC`,
        sectionId, from
      ).catch(() => []),
      prisma.mortalityRecord.findMany({
        where:   { penSectionId: sectionId, recordDate: { gte: from } },
        select:  { recordDate: true, count: true },
        orderBy: { recordDate: 'asc' },
      }),
      prisma.feedConsumption.findMany({
        where:   { penSectionId: sectionId, recordedDate: { gte: from } },
        select:  { recordedDate: true, quantityKg: true, gramsPerBird: true },
        orderBy: { recordedDate: 'asc' },
      }),
    ]);

    // Fetch temperature (for BROODING layer sections)
    let tempIdx = {};
    if (isBrooding) {
      try {
        const tempRows = await prisma.$queryRawUnsafe(
          `SELECT date_trunc('day', "loggedAt") as day, AVG("tempCelsius"::float) as avg_temp
           FROM temperature_logs WHERE "penSectionId" = $1 AND "loggedAt" >= $2
           GROUP BY date_trunc('day', "loggedAt") ORDER BY day ASC`,
          sectionId, from
        );
        tempIdx = Object.fromEntries(tempRows.map(r => [
          r.day instanceof Date ? r.day.toLocaleDateString('en-CA') : String(r.day).slice(0, 10),
          parseFloat(Number(r.avg_temp).toFixed(1)),
        ]));
      } catch (e) { console.error('[Charts] rearing temp error:', e?.message); }
    }

    // Merge: prefer weight_records, fall back to weight_samples for same date
    const mergedWeights = [...weightRecords];
    const recordDates = new Set(weightRecords.map(r => toDateKey(r.recordDate)));
    (weightSamplesRaw || []).forEach(r => {
      const dk = toDateKey(r.recordDate);
      if (!recordDates.has(dk)) mergedWeights.push(r);
    });
    mergedWeights.sort((a, b) => toDateKey(a.recordDate).localeCompare(toDateKey(b.recordDate)));
    const weights = mergedWeights;
    const wtIdx   = Object.fromEntries(weights.map(r  => [toDateKey(r.recordDate), r]));

    // Aggregate mortality per day — sum all records
    const mortDayMap = {};
    mortality.forEach(r => {
      const dk = toDateKey(r.recordDate);
      mortDayMap[dk] = (mortDayMap[dk] || 0) + (r.count || 0);
    });
    const mortIdx = Object.fromEntries(Object.entries(mortDayMap).map(([dk, c]) => [dk, { count: c }]));
    // Aggregate feed per day — sum all distributions (multiple per day)
    const rearingFlock = await prisma.flock.findFirst({
      where:  { penSectionId: sectionId, status: 'ACTIVE' },
      select: { currentCount: true },
    });
    const sectionBirds = rearingFlock?.currentCount || 0;

    const feedDayMap = {};
    feed.forEach(r => {
      const dk = toDateKey(r.recordedDate);
      if (!feedDayMap[dk]) feedDayMap[dk] = { kg: 0 };
      feedDayMap[dk].kg += parseFloat(r.quantityKg || 0);
    });
    const feedIdx = Object.fromEntries(
      Object.entries(feedDayMap).map(([dk, d]) => [dk, {
        quantityKg:   parseFloat(d.kg.toFixed(1)),
        // gramsPerBird computed from totalKg/sectionBirds in series map below
        gramsPerBird: sectionBirds > 0 ? parseFloat((d.kg * 1000 / sectionBirds).toFixed(1)) : null,
      }])
    );

    // ISA Brown target weight by week (rearing)
    const isaTarget = (ageInDays) => {
      if (!ageInDays) return null;
      const week = Math.floor(ageInDays / 7);
      const targets = {0:40,1:60,2:100,3:150,4:210,5:280,6:360,7:450,8:550,9:660,10:770,11:880,12:990,13:1100,14:1200,15:1290,16:1370,17:1440};
      return targets[Math.min(week, 17)] || 1440;
    };

    const series = dateRange.map(date => {
      const wt = wtIdx[date];
      return {
        date,
        label:         new Date(date + 'T12:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
        avgWeightG:    wt ? parseFloat(parseFloat(wt.avgWeightG).toFixed(0)) : null,
        minWeightG:    wt?.minWeightG ? parseFloat(parseFloat(wt.minWeightG).toFixed(0)) : null,
        maxWeightG:    wt?.maxWeightG ? parseFloat(parseFloat(wt.maxWeightG).toFixed(0)) : null,
        targetWeightG: wt ? isaTarget(wt.ageInDays) : null,
        uniformityPct: wt?.uniformityPct ? parseFloat(parseFloat(wt.uniformityPct).toFixed(1)) : null,
        deaths:        mortIdx[date]?.count ?? 0,
        mortality:     mortIdx[date]?.count ?? 0,
        feedKg:        feedIdx[date] ? feedIdx[date].quantityKg : null,
        feedGpb:       feedIdx[date]?.gramsPerBird ?? null,
        avgTemp:       tempIdx[date] ?? null,
      };
    });

    return NextResponse.json({
      isLayer:     true,
      isRearing:   true,
      sectionName: section.name,
      penName:     section.pen.name,
      days,
      series,
      chart: series,
    });
  }

  if (isLayer) {
    const [eggs, mortality, feed] = await Promise.all([
      prisma.eggProduction.findMany({
        where:   { penSectionId: sectionId, collectionDate: { gte: from } },
        select:  { collectionDate: true, totalEggs: true, gradeACount: true, gradeBCount: true, crackedCount: true, layingRatePct: true, cratesCollected: true },
        orderBy: { collectionDate: 'asc' },
      }),
      prisma.mortalityRecord.findMany({
        where:   { penSectionId: sectionId, recordDate: { gte: from } },
        select:  { recordDate: true, count: true },
        orderBy: { recordDate: 'asc' },
      }),
      prisma.feedConsumption.findMany({
        where:   { penSectionId: sectionId, recordedDate: { gte: from } },
        select:  { recordedDate: true, quantityKg: true, gramsPerBird: true },
        orderBy: { recordedDate: 'asc' },
      }),
    ]);

    // Aggregate all sessions per day — summing eggs, computing rate from total/birds
    const flock = await prisma.flock.findFirst({
      where:   { penSectionId: sectionId, status: 'ACTIVE' },
      select:  { currentCount: true },
    });
    const sectionBirds = flock?.currentCount || 0;

    const eggDayMap = {};
    eggs.forEach(r => {
      const dk = toDateKey(r.collectionDate);
      if (!eggDayMap[dk]) eggDayMap[dk] = { totalEggs: 0, gradeACount: null, gradeBCount: null, crackedCount: null, cratesCollected: 0 };
      eggDayMap[dk].totalEggs     += r.totalEggs || 0;
      eggDayMap[dk].cratesCollected += r.cratesCollected || 0;
      if (r.gradeACount != null)  eggDayMap[dk].gradeACount  = (eggDayMap[dk].gradeACount  || 0) + r.gradeACount;
      if (r.gradeBCount != null)  eggDayMap[dk].gradeBCount  = (eggDayMap[dk].gradeBCount  || 0) + r.gradeBCount;
      if (r.crackedCount != null) eggDayMap[dk].crackedCount = (eggDayMap[dk].crackedCount || 0) + r.crackedCount;
    });
    // Compute laying rate from daily total / bird count
    Object.values(eggDayMap).forEach(d => {
      d.layingRatePct = sectionBirds > 0
        ? parseFloat((d.totalEggs / sectionBirds * 100).toFixed(2))
        : 0;
    });
    const eggIdx = eggDayMap;

    // Aggregate mortality per day — sum all records
    const mortDayMap = {};
    mortality.forEach(r => {
      const dk = toDateKey(r.recordDate);
      mortDayMap[dk] = (mortDayMap[dk] || 0) + (r.count || 0);
    });
    const mortIdx = Object.fromEntries(Object.entries(mortDayMap).map(([dk, c]) => [dk, { count: c }]));
    // Aggregate feed per day — sum all distributions
    const feedDayMap2 = {};
    feed.forEach(r => {
      const dk = toDateKey(r.recordedDate);
      if (!feedDayMap2[dk]) feedDayMap2[dk] = { kg: 0 };
      feedDayMap2[dk].kg += parseFloat(r.quantityKg || 0);
    });
    const feedIdx = Object.fromEntries(
      Object.entries(feedDayMap2).map(([dk, d]) => [dk, {
        quantityKg:   parseFloat(d.kg.toFixed(1)),
        gramsPerBird: sectionBirds > 0 ? parseFloat((d.kg * 1000 / sectionBirds).toFixed(1)) : null,
      }])
    );

    // Also fetch temperature for BROODING layer sections
    let tempIdx = {};
    try {
      const tempRows = await prisma.$queryRawUnsafe(
        `SELECT
           date_trunc('day', "loggedAt") as day,
           AVG("tempCelsius"::float)     as avg_temp
         FROM temperature_logs
         WHERE "penSectionId" = $1
           AND "loggedAt" >= $2
         GROUP BY date_trunc('day', "loggedAt")
         ORDER BY day ASC`,
        sectionId, from
      );
      tempIdx = Object.fromEntries(
        tempRows.map(r => [
          // r.day is a JS Date from Prisma raw — use toLocaleDateString to avoid UTC shift
          r.day instanceof Date
            ? r.day.toLocaleDateString('en-CA')   // 'en-CA' gives YYYY-MM-DD in local time
            : String(r.day).slice(0, 10),           // fallback: slice the ISO string
          parseFloat(Number(r.avg_temp).toFixed(1)),
        ])
      );
    } catch (e) {
      console.error('[Charts] layer temp fetch error:', e?.message);
    }

    const series = dateRange.map(date => {
      const e = eggIdx[date];
      const gradeAPct = (e?.totalEggs > 0 && e?.gradeACount != null)
        ? parseFloat(((e.gradeACount / e.totalEggs) * 100).toFixed(1)) : null;
      const gradeBPct = (e?.totalEggs > 0 && e?.gradeBCount != null)
        ? parseFloat(((e.gradeBCount / e.totalEggs) * 100).toFixed(1)) : null;
      return {
        date,
        label:         new Date(date + 'T12:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
        totalEggs:     e?.totalEggs    ?? null,
        gradeACount:   e?.gradeACount  ?? null,
        gradeBCount:   e?.gradeBCount  ?? null,
        gradeAPct,
        gradeBPct,
        layingRatePct: e ? parseFloat(parseFloat(e.layingRatePct).toFixed(1)) : null,
        layingRate:    e ? parseFloat(parseFloat(e.layingRatePct).toFixed(1)) : null,
        crates:        e?.cratesCollected ?? null,
        deaths:        mortIdx[date]?.count ?? 0,
        mortality:     mortIdx[date]?.count ?? 0,
        feedKg:        feedIdx[date] ? feedIdx[date].quantityKg : null,
        feedGpb:       feedIdx[date]?.gramsPerBird ?? null,
        avgTemp:       tempIdx[date] ?? null,
      };
    });

    return NextResponse.json({
      isLayer:     true,
      sectionName: section.name,
      penName:     section.pen.name,
      days,
      series,
      chart: series,
    });

  } else {
    // ── BROILER ───────────────────────────────────────────────────────────────
    const [weights, mortality, feed] = await Promise.all([
      prisma.weightRecord.findMany({
        where:   { penSectionId: sectionId, recordDate: { gte: from } },
        select:  { recordDate: true, avgWeightG: true, minWeightG: true, maxWeightG: true, uniformityPct: true, ageInDays: true },
        orderBy: { recordDate: 'asc' },
      }),
      prisma.mortalityRecord.findMany({
        where:   { penSectionId: sectionId, recordDate: { gte: from } },
        select:  { recordDate: true, count: true },
        orderBy: { recordDate: 'asc' },
      }),
      prisma.feedConsumption.findMany({
        where:   { penSectionId: sectionId, recordedDate: { gte: from } },
        select:  { recordedDate: true, quantityKg: true, gramsPerBird: true },
        orderBy: { recordedDate: 'asc' },
      }),
    ]);

    // Fetch temperature separately using raw SQL (prisma.temperature_logs has naming conflicts)
    let tempIdx = {};
    try {
      const tempRows = await prisma.$queryRawUnsafe(
        `SELECT
           date_trunc('day', "loggedAt") as day,
           AVG("tempCelsius"::float)     as avg_temp
         FROM temperature_logs
         WHERE "penSectionId" = $1
           AND "loggedAt" >= $2
         GROUP BY date_trunc('day', "loggedAt")
         ORDER BY day ASC`,
        sectionId, from
      );
      tempIdx = Object.fromEntries(
        tempRows.map(r => [
          r.day instanceof Date
            ? r.day.toLocaleDateString('en-CA')
            : String(r.day).slice(0, 10),
          parseFloat(Number(r.avg_temp).toFixed(1)),
        ])
      );
    } catch (e) {
      console.error('[Charts] broiler temp fetch error:', e?.message);
    }
    console.log('[Charts] broiler tempIdx:', JSON.stringify(tempIdx));

    const wtIdx   = Object.fromEntries(weights.map(r   => [toDateKey(r.recordDate), r]));

    // Aggregate mortality per day — sum all records
    const mortDayMap = {};
    mortality.forEach(r => {
      const dk = toDateKey(r.recordDate);
      mortDayMap[dk] = (mortDayMap[dk] || 0) + (r.count || 0);
    });
    const mortIdx = Object.fromEntries(Object.entries(mortDayMap).map(([dk, c]) => [dk, { count: c }]));
    // Aggregate feed per day — sum all distributions
    const broilerFlock = await prisma.flock.findFirst({
      where:  { penSectionId: sectionId, status: 'ACTIVE' },
      select: { currentCount: true },
    });
    const sectionBirds = broilerFlock?.currentCount || 0;

    const feedDayMapB = {};
    feed.forEach(r => {
      const dk = toDateKey(r.recordedDate);
      if (!feedDayMapB[dk]) feedDayMapB[dk] = { kg: 0 };
      feedDayMapB[dk].kg += parseFloat(r.quantityKg || 0);
    });
    const feedIdx = Object.fromEntries(
      Object.entries(feedDayMapB).map(([dk, d]) => [dk, {
        quantityKg:   parseFloat(d.kg.toFixed(1)),
        gramsPerBird: sectionBirds > 0 ? parseFloat((d.kg * 1000 / sectionBirds).toFixed(1)) : null,
      }])
    );

    const series = dateRange.map(date => {
      const wt = wtIdx[date];
      return {
        date,
        label:         new Date(date + 'T12:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
        avgWeightG:    wt ? parseFloat(parseFloat(wt.avgWeightG).toFixed(0)) : null,
        minWeightG:    wt?.minWeightG ? parseFloat(parseFloat(wt.minWeightG).toFixed(0)) : null,
        maxWeightG:    wt?.maxWeightG ? parseFloat(parseFloat(wt.maxWeightG).toFixed(0)) : null,
        targetWeightG: wt ? ross308(wt.ageInDays) : null,
        uniformityPct: wt?.uniformityPct ? parseFloat(parseFloat(wt.uniformityPct).toFixed(1)) : null,
        deaths:        mortIdx[date]?.count ?? 0,
        mortality:     mortIdx[date]?.count ?? 0,
        feedKg:        feedIdx[date] ? feedIdx[date].quantityKg : null,
        feedGpb:       feedIdx[date]?.gramsPerBird ?? null,
        avgTemp:       tempIdx[date] ?? null,
      };
    });

    // Debug: log entries that have avgTemp
    const tempEntries = series.filter(s => s.avgTemp != null);
    console.log('[Charts] series entries with avgTemp:', JSON.stringify(tempEntries));

    return NextResponse.json({
      isLayer:     false,
      sectionName: section.name,
      penName:     section.pen.name,
      days,
      series,
      chart: series,
    });
  }
}
