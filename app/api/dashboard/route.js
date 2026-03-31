// FILE: app/api/dashboard/route.js

// app/api/dashboard/route.js — Role-aware dashboard data
// Returns different data shapes depending on the caller's role:
//   PEN_WORKER       → their sections only, layer or broiler KPIs
//   PEN_MANAGER      → their pens with per-section breakdown
//   FARM_MANAGER+    → all pens with per-pen + per-section breakdown

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

const MANAGER_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

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
    const [todayMort, weekMort, weekFeed, todayEggs, weekEggs, weekWeights, todayTasks, latestTemps] =
      await Promise.all([
        // Today mortality
        prisma.mortalityRecord.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, recordDate: { gte: today } },
          _sum: { count: true },
        }),

        // 7-day mortality
        prisma.mortalityRecord.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, recordDate: { gte: sevenDaysAgo } },
          _sum: { count: true },
        }),

        // 7-day feed
        prisma.feedConsumption.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, recordedDate: { gte: sevenDaysAgo } },
          _sum: { quantityKg: true },
          _avg: { gramsPerBird: true },
        }),

        // Today eggs
        // gradeACount is PM-computed on verification (nullable until PM approves)
        // crackedCount replaces dirtyCount as the tracked waste/reduced-price category
        prisma.eggProduction.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, collectionDate: { gte: today } },
          _sum: { totalEggs: true, gradeACount: true, crackedCount: true },
          _avg: { layingRatePct: true },
        }),

        // 7-day eggs
        prisma.eggProduction.groupBy({
          by: ['penSectionId'],
          where: { penSectionId: { in: sectionIds }, collectionDate: { gte: sevenDaysAgo } },
          _sum: { totalEggs: true, gradeACount: true, crackedCount: true },
          _avg: { layingRatePct: true },
        }),

        // Latest weight records (broiler)
        prisma.weightRecord.findMany({
          where: { penSectionId: { in: sectionIds }, recordDate: { gte: sevenDaysAgo } },
          orderBy: { recordDate: 'desc' },
          select: { penSectionId: true, avgWeightG: true, ageInDays: true, uniformityPct: true },
        }),

        // Latest brooder temperature per section (for BROODING sections)
        prisma.temperature_logs.findMany({
          where:   { penSectionId: { in: sectionIds }, loggedAt: { gte: sevenDaysAgo } },
          orderBy: { loggedAt: 'desc' },
          select:  { penSectionId: true, tempCelsius: true, loggedAt: true },
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

    // Index metrics
    const idx = {
      todayDead:  Object.fromEntries(todayMort.map(r => [r.penSectionId, r._sum.count || 0])),
      weekDead:   Object.fromEntries(weekMort.map(r  => [r.penSectionId, r._sum.count || 0])),
      weekFeed:   Object.fromEntries(weekFeed.map(r  => [r.penSectionId, {
        kg:  parseFloat((r._sum.quantityKg || 0).toFixed(1)),
        gpb: parseFloat((r._avg.gramsPerBird || 0).toFixed(0)),
      }])),
      todayEggs:  Object.fromEntries(todayEggs.map(r => [r.penSectionId, {
        total:   r._sum.totalEggs   || 0,
        gradeA:  r._sum.gradeACount || 0,  // 0 until PM verifies — shown as pending in UI
        cracked: r._sum.crackedCount || 0,
        rate:    parseFloat((r._avg.layingRatePct || 0).toFixed(1)),
      }])),
      weekEggs:   Object.fromEntries(weekEggs.map(r => [r.penSectionId, {
        total:   r._sum.totalEggs   || 0,
        gradeA:  r._sum.gradeACount || 0,
        cracked: r._sum.crackedCount || 0,
        rate:    parseFloat((r._avg.layingRatePct || 0).toFixed(1)),
      }])),
      latestBrooderTemp: latestTemps.reduce((acc, t) => {
        if (!acc[t.penSectionId]) acc[t.penSectionId] = Number(t.tempCelsius);
        return acc;
      }, {}),
      latestWeight: weekWeights.reduce((acc, w) => {
        if (!acc[w.penSectionId]) acc[w.penSectionId] = w;
        return acc;
      }, {}),
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
      const tEgg       = idx.todayEggs[sec.id]  || { total: 0, gradeA: 0, cracked: 0, rate: 0 };
      const wEgg       = idx.weekEggs[sec.id]   || { total: 0, gradeA: 0, cracked: 0, rate: 0 };
      const wt         = idx.latestWeight[sec.id];

      const mortalityRate = flock?.initialCount > 0
        ? parseFloat(((weekDead / flock.initialCount) * 100).toFixed(2)) : 0;

      const avgDailyFeed  = feedData.kg > 0 ? parseFloat((feedData.kg / 7).toFixed(1)) : 0;
      const gradeAPct     = tEgg.total > 0  ? parseFloat(((tEgg.gradeA / tEgg.total) * 100).toFixed(1)) : 0;
      const wGradeAPct    = wEgg.total > 0  ? parseFloat(((wEgg.gradeA / wEgg.total) * 100).toFixed(1)) : 0;

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
          avgDailyFeedKg: avgDailyFeed, feedGramsPerBird: feedData.gpb,
        } : {
          type: 'BROILER',
          todayMortality: todayDead, weekMortality: weekDead, mortalityRate,
          latestWeightG, uniformityPct: wt?.uniformityPct ? parseFloat(parseFloat(wt.uniformityPct).toFixed(1)) : null,
          estimatedFCR, daysToHarvest, ageInDays,
          weekFeedKg: feedData.kg, avgDailyFeedKg: avgDailyFeed, feedGramsPerBird: feedData.gpb,
          latestBrooderTemp: idx.latestBrooderTemp[sec.id] ?? null,
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
        avgLayingRate:   (() => { const ls = secs.filter(s => s.metrics.avgLayingRate > 0); return ls.length ? parseFloat((ls.reduce((s,sec)=>s+sec.metrics.avgLayingRate,0)/ls.length).toFixed(1)) : 0; })(),
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
      avgLayingRate: (() => {
        const ls = enriched.filter(s => s.metrics.type === 'LAYER' && s.metrics.avgLayingRate > 0);
        return ls.length ? parseFloat((ls.reduce((s,sec)=>s+sec.metrics.avgLayingRate,0)/ls.length).toFixed(1)) : 0;
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
