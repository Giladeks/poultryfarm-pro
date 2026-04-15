// FILE: app/api/dashboard/route.js

// app/api/dashboard/route.js — Role-aware dashboard data
// Returns different data shapes depending on the caller's role:
//   PEN_WORKER       → their sections only, layer or broiler KPIs
//   PEN_MANAGER      → their pens with per-section breakdown
//   FARM_MANAGER+    → all pens with per-pen + per-section breakdown

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
export const dynamic = 'force-dynamic';

const MANAGER_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Build date boundaries using local calendar date to avoid WAT/UTC shift bugs.
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get('date'); // 'yesterday' or null (today)

  const _now  = new Date();
  const _offset = dateParam === 'yesterday' ? 1 : 0; // shift back 1 day for yesterday
  const today = new Date(Date.UTC(_now.getFullYear(), _now.getMonth(), _now.getDate() - _offset));
  const todayEnd = new Date(Date.UTC(_now.getFullYear(), _now.getMonth(), _now.getDate() - _offset + 1));
  const sevenDaysAgo = new Date(Date.UTC(_now.getFullYear(), _now.getMonth(), _now.getDate() - _offset - 7));

  const isManager   = MANAGER_ROLES.includes(user.role);
  const isPenMgr    = user.role === 'PEN_MANAGER';
  const isPenWorker = user.role === 'PEN_WORKER';

  try {
    // ── Determine scope ───────────────────────────────────────────────────────
    let allowedSectionIds = null;

    if (!isManager) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where: { userId: user.sub, isActive: true },
        select: { penSectionId: true },
      });
      allowedSectionIds = assignments.map(a => a.penSectionId);
      if (allowedSectionIds.length === 0) {
        return NextResponse.json({ role: user.role, sections: [], pens: [], tasks: [] });
      }
    }

    // ── Fetch sections with full context ──────────────────────────────────────
    const sections = await prisma.penSection.findMany({
      where: {
        ...(allowedSectionIds ? { id: { in: allowedSectionIds } } : {}),
        isActive: true,
        pen: { isActive: true, farm: { tenantId: user.tenantId, isActive: true } },
      },
      include: {
        pen: {
          select: {
            id: true, name: true, operationType: true, capacity: true,
            farm: { select: { id: true, name: true } },
          },
        },
        flocks: {
          where: { status: 'ACTIVE' },
          select: {
            id: true, batchCode: true, operationType: true,
            currentCount: true, initialCount: true,
            dateOfPlacement: true, breed: true,
            expectedHarvestDate: true, expectedLayingStartDate: true,
            stage: true,   // ← Phase 8C: needed for stage-aware KPI cards
          },
        },
        workerAssignments: {
          where: { isActive: true },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
      },
      orderBy: [{ pen: { name: 'asc' } }, { name: 'asc' }],
    });

    const sectionIds = sections.map(s => s.id);

    // ── Fetch all metrics in parallel ─────────────────────────────────────────
    const [todayMort, weekMort, todayFeed, weekFeed, todayEggs, weekSummaries, weekWeights, todayTasks] =
      await Promise.all([
        // Today mortality
        prisma.mortalityRecord.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, recordDate: { gte: today, lt: todayEnd } },
          _sum: { count: true },
        }),

        // 7-day mortality
        prisma.mortalityRecord.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, recordDate: { gte: sevenDaysAgo } },
          _sum: { count: true },
        }),

        // Today feed
        prisma.feedConsumption.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, recordedDate: { gte: today, lt: todayEnd } },
          _sum: { quantityKg: true },
        }),

        // 7-day feed — sum only; gramsPerBird computed from totalKg/currentBirds
        prisma.feedConsumption.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, recordedDate: { gte: sevenDaysAgo, lt: todayEnd } },
          _sum: { quantityKg: true },
        }),

        // Today eggs — sum all sessions; lay rate computed from totalEggs/currentBirds
        prisma.eggProduction.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, collectionDate: { gte: today, lt: todayEnd } },
          _sum: { totalEggs: true, gradeACount: true, crackedCount: true },
        }),

        // 7-day daily summaries — for rolling rate calculations
        // Uses avgBirdsForEggs as denominator (correct n-day formula)
        prisma.dailySummary.findMany({
          where: {
            penSectionId: { in: sectionIds },
            summaryDate:  { gte: sevenDaysAgo, lt: todayEnd },
          },
          select: {
            penSectionId:       true,
            summaryDate:        true,
            totalEggsCollected: true,
            totalFeedKg:        true,
            avgBirdsForEggs:    true,
            avgBirdsForFeed:    true,
            closingBirdCount:   true,
          },
        }),

        // Latest weight records — reads from weight_records (weight-records API)
        // We also fetch weight_samples separately and merge to support both sources
        prisma.weightRecord.findMany({
          where: { penSectionId: { in: sectionIds }, recordDate: { gte: sevenDaysAgo } },
          orderBy: { recordDate: 'desc' },
          select: { penSectionId: true, avgWeightG: true, ageInDays: true, uniformityPct: true },
        }),

        // Today's tasks for this user
        prisma.task.findMany({
          where: {
            assignedToId: user.sub,
            dueDate: { gte: today },
            status: { not: 'CANCELLED' },
          },
          select: {
            id: true, title: true, taskType: true, status: true,
            priority: true, dueDate: true,
            penSection: { select: { name: true, pen: { select: { name: true } } } },
          },
          orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
          take: 20,
        }),
      ]);
	  
    // Fetch 7-day water consumption per section
    // consumptionLPB is pre-computed in the table (consumptionL / bird count at time of reading)
    let waterIdx = {};
    if (sectionIds.length > 0) {
      try {
        const placeholders = sectionIds.map((_, i) => `$${i + 1}`).join(',');
        const waterRows = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT ON ("penSectionId")
             "penSectionId",
             "consumptionL"::float    as consumption_l,
             "consumptionLPB"::float  as consumption_lpb
           FROM water_meter_readings
           WHERE "penSectionId" IN (${placeholders})
             AND "readingDate" >= $${sectionIds.length + 1}
             AND "consumptionL" IS NOT NULL
           ORDER BY "penSectionId", "readingDate" DESC`,
          ...sectionIds,
          sevenDaysAgo
        );
        waterIdx = Object.fromEntries(
          waterRows.map(r => [r.penSectionId, {
            latestConsumptionL:   parseFloat(Number(r.consumption_l  || 0).toFixed(2)),
            latestConsumptionLPB: parseFloat(Number(r.consumption_lpb || 0).toFixed(3)),
          }])
        );
      } catch (waterErr) {
        console.error('[Dashboard] water fetch error:', waterErr?.message);
      }
    }

    // Fetch brooder temperatures SEPARATELY — outside Promise.all to avoid position mismatch
    let latestTemps = [];
    if (sectionIds.length > 0) {
      try {
        const placeholders = sectionIds.map((_, i) => `$${i + 1}`).join(',');
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        latestTemps = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT ON ("penSectionId")
             "penSectionId", "tempCelsius"::float as "tempCelsius"
           FROM temperature_logs
           WHERE "penSectionId" IN (${placeholders})
             AND "loggedAt" >= $${sectionIds.length + 1}
           ORDER BY "penSectionId", "loggedAt" DESC`,
          ...sectionIds,
          cutoff
        );
      } catch (tempErr) {
        console.error('[TEMP] error:', tempErr?.message);
        latestTemps = [];
      }
    }

    // Also fetch from weight_samples (written by weight-samples API / rearing page)
    let weightSamplesRows = [];
    if (sectionIds.length > 0) {
      try {
        const placeholders = sectionIds.map((_, i) => `$${i + 1}`).join(',');
        weightSamplesRows = await prisma.$queryRawUnsafe(
          `SELECT DISTINCT ON ("penSectionId")
             "penSectionId",
             "meanWeightG"::float  as "avgWeightG",
             "uniformityPct"::float as "uniformityPct",
             "sampleDate"
           FROM weight_samples
           WHERE "penSectionId" IN (${placeholders})
             AND "sampleDate" >= $${sectionIds.length + 1}
           ORDER BY "penSectionId", "sampleDate" DESC`,
          ...sectionIds,
          sevenDaysAgo
        );
      } catch (wsErr) {
        console.error('[Dashboard] weight_samples fetch error:', wsErr?.message);
      }
    }

    // Index metrics
    const idx = {
      todayDead:  Object.fromEntries(todayMort.map(r => [r.penSectionId, r._sum.count || 0])),
      weekDead:   Object.fromEntries(weekMort.map(r  => [r.penSectionId, r._sum.count || 0])),
      todayFeed:  Object.fromEntries(todayFeed.map(r => [r.penSectionId, {
        kg: parseFloat((r._sum.quantityKg || 0).toFixed(1)),
      }])),
      weekFeed:   Object.fromEntries(weekFeed.map(r  => [r.penSectionId, {
        kg:  parseFloat((r._sum.quantityKg || 0).toFixed(1)),
        gpb: null, // computed per-section from totalKg/currentBirds in enrichment
      }])),
      // Laying rate is computed per-section from total eggs / current birds (not averaged)
      // This ensures multiple sessions in a day are correctly aggregated
      todayEggs:  Object.fromEntries(todayEggs.map(r => [r.penSectionId, {
        total:   r._sum.totalEggs   || 0,
        gradeA:  r._sum.gradeACount || 0,  // 0 until PM verifies — shown as pending in UI
        cracked: r._sum.crackedCount || 0,
        rate:    null, // computed after enrichment when currentBirds is known
      }])),
      // n-day lay rate = sum(dailyEggs) / avg(avgBirdsForEggs per day) * 100
// n-day feed rate = sum(dailyFeedKg) / avg(avgBirdsForFeed per day) * 1000

      weekEggs: (() => {
        // Group daily summary rows by penSectionId
        const bySec = {};
        (weekSummaries || []).forEach(row => {
          if (!bySec[row.penSectionId]) bySec[row.penSectionId] = [];
          bySec[row.penSectionId].push(row);
        });
        // For each section: sum eggs, compute avg(avgBirdsForEggs), derive rate
        return Object.fromEntries(
          Object.entries(bySec).map(([secId, rows]) => {
            const totalEggs  = rows.reduce((s, r) => s + (r.totalEggsCollected || 0), 0);
            const totalFeedKg= rows.reduce((s, r) => s + Number(r.totalFeedKg || 0), 0);
            // avgBirdsForEggs: average of the per-day avg-bird values
            const eggBirdRows   = rows.filter(r => r.avgBirdsForEggs != null);
            const feedBirdRows  = rows.filter(r => r.avgBirdsForFeed != null);
            const avgEggBirds   = eggBirdRows.length > 0
              ? eggBirdRows.reduce((s, r) => s + Number(r.avgBirdsForEggs), 0) / eggBirdRows.length
              : (rows[0]?.closingBirdCount ?? null);
            const avgFeedBirds  = feedBirdRows.length > 0
              ? feedBirdRows.reduce((s, r) => s + Number(r.avgBirdsForFeed), 0) / feedBirdRows.length
              : (rows[0]?.closingBirdCount ?? null);
            const rate = avgEggBirds && avgEggBirds > 0
              ? parseFloat((totalEggs / avgEggBirds * 100).toFixed(1))
              : null;
            const feedGpb = avgFeedBirds && avgFeedBirds > 0
              ? parseFloat((totalFeedKg * 1000 / avgFeedBirds).toFixed(1))
              : null;
            return [secId, { total: totalEggs, totalFeedKg, rate, feedGpb }];
          })
        );
      })(),
      // latestTemps from raw SQL DISTINCT ON already has one row per section
      latestBrooderTemp: Object.fromEntries(
        (latestTemps || []).map(t => [t.penSectionId, Number(t.tempCelsius)])
      ),
      latestWeight: (() => {
        // Merge weight_records and weight_samples — prefer most recent
        const acc = {};
        // First load weight_records
        weekWeights.forEach(w => {
          if (!acc[w.penSectionId]) acc[w.penSectionId] = w;
        });
        // Override with weight_samples if they have newer data or weight_records is missing
        weightSamplesRows.forEach(w => {
          const existing = acc[w.penSectionId];
          if (!existing) {
            acc[w.penSectionId] = w; // use sample if no record exists
          }
          // weight_samples sampleDate vs weight_records recordDate — use whichever is newer
          // Both are already sorted DESC by section so first one wins per section
        });
        return acc;
      })(),
    };

    // ── Build enriched sections ───────────────────────────────────────────────
    const enriched = sections.map(sec => {
      const isLayer   = sec.pen.operationType === 'LAYER';
      const flock     = sec.flocks[0] || null;
      const currBirds = sec.flocks.reduce((s, f) => s + f.currentCount, 0);
      const occ       = sec.capacity > 0 ? parseFloat(((currBirds / sec.capacity) * 100).toFixed(1)) : 0;
      const ageInDays = flock ? Math.floor((Date.now() - new Date(flock.dateOfPlacement)) / 86400000) : 0;

      const todayDead  = idx.todayDead[sec.id]  || 0;
      const weekDead   = idx.weekDead[sec.id]   || 0;
      const feedData   = idx.weekFeed[sec.id]   || { kg: 0, gpb: 0 };
      const todayFeedKg = idx.todayFeed[sec.id]?.kg ?? 0;
      const tEggRaw    = idx.todayEggs[sec.id]  || { total: 0, gradeA: 0, cracked: 0, rate: null };
      const wEggRaw    = idx.weekEggs[sec.id]   || { total: 0, totalFeedKg: 0, rate: null, feedGpb: null };
      // Today: computed live from eggProduction sum / currBirds (snapshot may not exist yet)
      const tEgg = { ...tEggRaw,
        rate: currBirds > 0 ? parseFloat(((tEggRaw.total / currBirds) * 100).toFixed(1)) : 0 };
      // 7-day: use pre-computed n-day rate from daily_summaries (correct formula)
      const wEgg = { ...wEggRaw,
        rate: wEggRaw.rate ?? (currBirds > 0
          ? parseFloat(((wEggRaw.total / currBirds) * 100).toFixed(1))
          : 0),
      };
      const wt         = idx.latestWeight[sec.id];

      const mortalityRate = flock?.initialCount > 0
        ? parseFloat(((weekDead / flock.initialCount) * 100).toFixed(2)) : 0;

      const avgDailyFeed  = feedData.kg > 0 ? parseFloat((feedData.kg / 7).toFixed(1)) : 0;
      // gramsPerBird = totalWeekKg * 1000 / 7 days / currentBirds (daily g/bird)
      const feedGpb = feedData.kg > 0 && currBirds > 0
        ? parseFloat((feedData.kg * 1000 / 7 / currBirds).toFixed(1)) : 0;
      const gradeAPct     = tEgg.total > 0  ? parseFloat(((tEgg.gradeA / tEgg.total) * 100).toFixed(1)) : 0;
      // weekEggs index is now built from dailySummary which has no grade breakdown.
// wEgg.gradeA is undefined — return null so the UI shows '—' rather than NaN.
      const wGradeAPct    = (wEgg.total > 0 && (wEgg.gradeA ?? 0) > 0)
        ? parseFloat(((wEgg.gradeA / wEgg.total) * 100).toFixed(1))
        : null;

      const latestWeightG = wt ? parseFloat(parseFloat(wt.avgWeightG).toFixed(0)) : null;
      const currentWeightKg = latestWeightG ? latestWeightG * currBirds / 1000 : null;
      const gainKg = currentWeightKg ? parseFloat((currentWeightKg - currBirds * 0.042).toFixed(1)) : null;
      const estimatedFCR = gainKg && gainKg > 0 && feedData.kg > 0
        ? parseFloat((feedData.kg / gainKg).toFixed(2)) : null;
      const daysToHarvest = flock?.expectedHarvestDate
        ? Math.max(0, Math.floor((new Date(flock.expectedHarvestDate) - Date.now()) / 86400000)) : null;

      // Performance flag for pen managers to spot issues
      const flags = [];
      if (mortalityRate > 1)        flags.push({ type: 'warn',     msg: `High mortality: ${mortalityRate}%` });
      if (mortalityRate > 2)        flags.push({ type: 'critical', msg: `Critical mortality: ${mortalityRate}%` });
      if (isLayer && tEgg.rate < 70 && flock) flags.push({ type: 'warn', msg: `Low laying rate: ${tEgg.rate}%` });
      if (estimatedFCR > 2.5)       flags.push({ type: 'warn',     msg: `High FCR: ${estimatedFCR}` });
      if (occ < 50 && flock)        flags.push({ type: 'info',     msg: `Low occupancy: ${occ}%` });

      const workers  = sec.workerAssignments.filter(a => a.user.role === 'PEN_WORKER').map(a => a.user);
      const managers = sec.workerAssignments.filter(a => a.user.role === 'PEN_MANAGER').map(a => a.user);

      return {
        id: sec.id, name: sec.name, capacity: sec.capacity,
        penId: sec.pen.id, penName: sec.pen.name,
        penOperationType: sec.pen.operationType,
        farmName: sec.pen.farm.name,
        currentBirds: currBirds, occupancyPct: occ,
        flock, ageInDays, workers, managers, flags,
        metrics: isLayer ? {
          type: 'LAYER',
          stage: flock?.stage || 'PRODUCTION',   // ← Phase 8C: expose lifecycle stage
          todayMortality: todayDead, weekMortality: weekDead, mortalityRate,
          todayEggs: tEgg.total, todayGradeA: tEgg.gradeA, todayCracked: tEgg.cracked,
          todayGradeAPending: tEgg.gradeA === 0 && tEgg.total > 0,
          todayGradeAPct: gradeAPct, todayLayingRate: tEgg.rate,
          weekEggs: wEgg.total, weekGradeAPct: wGradeAPct, avgLayingRate: wEgg.rate,
          todayFeedKg: todayFeedKg,
          avgDailyFeedKg: avgDailyFeed, feedGramsPerBird: feedGpb,
          avgWaterLPB: waterIdx[sec.id]?.latestConsumptionLPB ?? null,
          latestWaterL: waterIdx[sec.id]?.latestConsumptionL ?? null,
          // Only expose brooder temp when flock is actively in BROODING stage
          // Historical temp logs still exist after End Brooding — must gate on stage
          latestBrooderTemp: flock?.stage === 'BROODING'
            ? (idx.latestBrooderTemp[sec.id] !== undefined ? idx.latestBrooderTemp[sec.id] : null)
            : null,
          latestWeightG,
        } : {
          type: 'BROILER',
          stage: flock?.stage || 'PRODUCTION',   // ← expose stage for BROILER sections too
          todayMortality: todayDead, weekMortality: weekDead, mortalityRate,
          latestWeightG, uniformityPct: wt?.uniformityPct ? parseFloat(parseFloat(wt.uniformityPct).toFixed(1)) : null,
          estimatedFCR, daysToHarvest, ageInDays,
          todayFeedKg: todayFeedKg,
          weekFeedKg: feedData.kg, avgDailyFeedKg: avgDailyFeed, feedGramsPerBird: feedGpb,
          // Only expose brooder temp during BROODING stage for broilers too
          latestBrooderTemp: flock?.stage === 'BROODING'
            ? (idx.latestBrooderTemp[sec.id] !== undefined ? idx.latestBrooderTemp[sec.id] : null)
            : null,
          avgWaterLPB: waterIdx[sec.id]?.latestConsumptionLPB ?? null,
          latestWaterL: waterIdx[sec.id]?.latestConsumptionL ?? null,
        },
      };
    });

    // ── Group into pens (for pen managers + above) ────────────────────────────
    const penMap = {};
    enriched.forEach(sec => {
      if (!penMap[sec.penId]) {
        penMap[sec.penId] = {
          id: sec.penId, name: sec.penName,
          operationType: sec.penOperationType,
          farmName: sec.farmName,
          sections: [],
        };
      }
      penMap[sec.penId].sections.push(sec);
    });

    const pens = Object.values(penMap).map(pen => {
      const isLayer = pen.operationType === 'LAYER';
      const secs    = pen.sections;
      const totalBirds    = secs.reduce((s, sec) => s + sec.currentBirds, 0);
      const totalCapacity = secs.reduce((s, sec) => s + sec.capacity, 0);
      const occupancyPct  = totalCapacity > 0 ? parseFloat(((totalBirds / totalCapacity) * 100).toFixed(1)) : 0;

      const aggMetrics = isLayer ? {
        type: 'LAYER',
        todayMortality:  secs.reduce((s, sec) => s + sec.metrics.todayMortality, 0),
        weekMortality:   secs.reduce((s, sec) => s + sec.metrics.weekMortality,  0),
        mortalityRate:   totalBirds > 0 ? parseFloat(((secs.reduce((s, sec) => s + sec.metrics.weekMortality, 0) / totalBirds) * 100).toFixed(2)) : 0,
        todayEggs:       secs.reduce((s, sec) => s + (sec.metrics.todayEggs || 0), 0),
        weekEggs:        secs.reduce((s, sec) => s + (sec.metrics.weekEggs  || 0), 0),
        // avgLayingRate = today eggs / production-stage birds only
        // BROODING and REARING sections are excluded from the denominator
        // as they have no egg records and inflate the bird count
        avgLayingRate:   (() => {
          const productionSecs = secs.filter(s =>
            (s.metrics?.stage || 'PRODUCTION') === 'PRODUCTION'
          );
          const totalE = productionSecs.reduce((s, sec) => s + (sec.metrics.todayEggs || 0), 0);
          const layingBirds = productionSecs.reduce((s, sec) => s + (sec.currentBirds || 0), 0);
          return layingBirds > 0 ? parseFloat((totalE / layingBirds * 100).toFixed(1)) : 0;
        })(),
        avgDailyFeedKg:  parseFloat((secs.reduce((s, sec) => s + (sec.metrics.avgDailyFeedKg || 0), 0)).toFixed(1)),
      } : {
        type: 'BROILER',
        todayMortality:  secs.reduce((s, sec) => s + sec.metrics.todayMortality, 0),
        weekMortality:   secs.reduce((s, sec) => s + sec.metrics.weekMortality,  0),
        mortalityRate:   totalBirds > 0 ? parseFloat(((secs.reduce((s, sec) => s + sec.metrics.weekMortality, 0) / totalBirds) * 100).toFixed(2)) : 0,
        avgWeightG:      (() => { const ws = secs.filter(s => s.metrics.latestWeightG); return ws.length ? parseFloat((ws.reduce((s,sec)=>s+sec.metrics.latestWeightG,0)/ws.length).toFixed(0)) : null; })(),
        avgFCR:          (() => { const fs = secs.filter(s => s.metrics.estimatedFCR); return fs.length ? parseFloat((fs.reduce((s,sec)=>s+sec.metrics.estimatedFCR,0)/fs.length).toFixed(2)) : null; })(),
        nearestHarvest:  (() => { const hs = secs.filter(s => s.metrics.daysToHarvest != null); return hs.length ? Math.min(...hs.map(s=>s.metrics.daysToHarvest)) : null; })(),
        avgDailyFeedKg:  parseFloat((secs.reduce((s, sec) => s + (sec.metrics.avgDailyFeedKg || 0), 0)).toFixed(1)),
      };

      const worstFlags = secs.flatMap(s => s.flags).filter(f => f.type === 'critical').length;
      const warnFlags  = secs.flatMap(s => s.flags).filter(f => f.type === 'warn').length;

      return {
        ...pen, totalBirds, totalCapacity, occupancyPct,
        metrics: aggMetrics,
        alertLevel: worstFlags > 0 ? 'critical' : warnFlags > 0 ? 'warn' : 'ok',
        sectionCount: secs.length,
      };
    });

    // ── Org-level totals (managers only) ──────────────────────────────────────
    const orgTotals = isManager ? {
      totalBirds:    enriched.reduce((s, sec) => s + sec.currentBirds, 0),
      todayMortality:enriched.reduce((s, sec) => s + sec.metrics.todayMortality, 0),
      todayEggs:     enriched.filter(s => s.metrics.type === 'LAYER').reduce((s, sec) => s + (sec.metrics.todayEggs || 0), 0),
      // avgLayingRate = today total layer eggs / total layer birds
      avgLayingRate: (() => {
        const ls = enriched.filter(s =>
          s.metrics.type === 'LAYER' &&
          (s.metrics?.stage || 'PRODUCTION') === 'PRODUCTION'
        );
        const totalE = ls.reduce((s, sec) => s + (sec.metrics.todayEggs || 0), 0);
        const totalB = ls.reduce((s, sec) => s + (sec.currentBirds || 0), 0);
        return totalB > 0 ? parseFloat((totalE/totalB*100).toFixed(1)) : 0;
      })(),
      avgBroilerWeight: (() => {
        const bs = enriched.filter(s => s.metrics.type === 'BROILER' && s.metrics.latestWeightG);
        return bs.length ? parseFloat((bs.reduce((s,sec)=>s+sec.metrics.latestWeightG,0)/bs.length).toFixed(0)) : null;
      })(),
      totalFeedKg7d:  parseFloat(enriched.reduce((s, sec) => s + (sec.metrics.weekFeedKg || sec.metrics.avgDailyFeedKg * 7 || 0), 0).toFixed(1)),
      pensWithAlerts: pens.filter(p => p.alertLevel !== 'ok').length,
    } : null;

    return NextResponse.json({
      role:       user.role,
      isManager,
      isPenMgr,
      isPenWorker,
      sections:   enriched,
      pens,
      orgTotals,
      tasks:      todayTasks,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
