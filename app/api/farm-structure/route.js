// app/api/farm-structure/route.js — Role-aware farm structure + metrics
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

const MANAGER_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isManager = MANAGER_ROLES.includes(user.role);

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // ── Determine which sections this user can see ──────────────────────────
    let allowedSectionIds = null;
    let allowedOpTypes    = null;

    if (!isManager) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where: { userId: user.sub },
        include: {
          penSection: {
            select: { id: true, pen: { select: { operationType: true } } },
          },
        },
      });
      allowedSectionIds = assignments.map(a => a.penSection.id);
      const opTypes = [...new Set(assignments.map(a => a.penSection.pen.operationType))];
      allowedOpTypes = opTypes.length > 0 ? opTypes : ['NONE'];
    }

    // ── Fetch farm structure ────────────────────────────────────────────────
    const farms = await prisma.farm.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      include: {
        pens: {
          where: {
            ...(allowedOpTypes && { operationType: { in: allowedOpTypes } }),
          },
          include: {
            sections: {
              where: {
                ...(allowedSectionIds && { id: { in: allowedSectionIds } }),
              },
              include: {
                flocks: {
                  where: { status: 'ACTIVE' },
                  select: {
                    id: true, batchCode: true, operationType: true,
                    currentCount: true, initialCount: true,
                    dateOfPlacement: true, breed: true,
                    expectedHarvestDate: true, expectedLayingStartDate: true,
                  },
                },
                workerAssignments: {
                  where: { isActive: true },
                  include: {
                    user: { select: { id: true, firstName: true, lastName: true, role: true } },
                  },
                },
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const filteredFarms = farms.map(farm => ({
      ...farm,
      pens: farm.pens.filter(pen => pen.sections.length > 0),
    })).filter(farm => farm.pens.length > 0);

    // ── Fetch metrics ───────────────────────────────────────────────────────
    const sectionFilter = allowedSectionIds
      ? { penSectionId: { in: allowedSectionIds } }
      : { flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } } };

    const eggSectionFilter = allowedSectionIds
      ? { penSectionId: { in: allowedSectionIds } }
      : { flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } } };

    const [todayMortality, weekMortality, weekFeed, todayEggs, weekEggs, weekWeights] = await Promise.all([
      // Today mortality
      prisma.mortalityRecord.groupBy({
        by: ['penSectionId'],
        where: { ...sectionFilter, recordDate: { gte: today } },
        _sum: { count: true },
      }),
      // 7-day mortality
      prisma.mortalityRecord.groupBy({
        by: ['penSectionId'],
        where: { ...sectionFilter, recordDate: { gte: sevenDaysAgo } },
        _sum: { count: true },
      }),
      // 7-day feed
      prisma.feedConsumption.groupBy({
        by: ['penSectionId'],
        where: {
          ...(allowedSectionIds
            ? { penSectionId: { in: allowedSectionIds } }
            : { flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } } }),
          recordedDate: { gte: sevenDaysAgo },
        },
        _sum: { quantityKg: true },
        _avg: { gramsPerBird: true },
      }),
      // Today eggs — Phase 8B fields only (no dirtyCount, gradeACount is nullable/PM-set)
      prisma.eggProduction.groupBy({
        by: ['penSectionId'],
        where: {
          ...eggSectionFilter,
          collectionDate: { gte: today },
        },
        _sum: { totalEggs: true, gradeACount: true, crackedCount: true },
        _avg: { layingRatePct: true },
      }),
      // 7-day eggs
      prisma.eggProduction.groupBy({
        by: ['penSectionId'],
        where: {
          ...eggSectionFilter,
          collectionDate: { gte: sevenDaysAgo },
        },
        _sum: { totalEggs: true, gradeACount: true },
        _avg: { layingRatePct: true },
      }),
      // Latest weight per section (BROILER only)
      prisma.weightRecord.findMany({
        where: {
          ...(allowedSectionIds
            ? { penSectionId: { in: allowedSectionIds } }
            : { penSection: { pen: { farm: { tenantId: user.tenantId } } } }),
          recordDate: { gte: sevenDaysAgo },
        },
        orderBy: { recordDate: 'desc' },
        select: {
          penSectionId: true, avgWeightG: true, ageInDays: true,
          uniformityPct: true, recordDate: true,
        },
      }),
    ]);

    // Index metrics by penSectionId
    const idx = {
      todayDead:  Object.fromEntries(todayMortality.map(r => [r.penSectionId, r._sum.count || 0])),
      weekDead:   Object.fromEntries(weekMortality.map(r  => [r.penSectionId, r._sum.count || 0])),
      weekFeed:   Object.fromEntries(weekFeed.map(r       => [r.penSectionId, {
        kg:  parseFloat((r._sum.quantityKg || 0).toFixed(1)),
        gpb: parseFloat((r._avg.gramsPerBird || 0).toFixed(0)),
      }])),
      todayEggs:  Object.fromEntries(todayEggs.map(r => [r.penSectionId, {
        total:   r._sum.totalEggs  || 0,
        gradeA:  r._sum.gradeACount || 0,   // null until PM grades — treat 0 as pending
        cracked: r._sum.crackedCount || 0,
        rate:    parseFloat((r._avg.layingRatePct || 0).toFixed(1)),
        // flag: true when eggs exist but gradeA hasn't been set yet by PM
        gradePending: (r._sum.totalEggs || 0) > 0 && !r._sum.gradeACount,
      }])),
      weekEggs:   Object.fromEntries(weekEggs.map(r => [r.penSectionId, {
        total:  r._sum.totalEggs   || 0,
        gradeA: r._sum.gradeACount || 0,
        rate:   parseFloat((r._avg.layingRatePct || 0).toFixed(1)),
      }])),
      latestWeight: weekWeights.reduce((acc, w) => {
        if (!acc[w.penSectionId]) acc[w.penSectionId] = w;
        return acc;
      }, {}),
    };

    // ── Enrich with metrics ─────────────────────────────────────────────────
    const enriched = filteredFarms.map(farm => {
      const pens = farm.pens.map(pen => {
        const isLayer   = pen.operationType === 'LAYER';
        const isBroiler = pen.operationType === 'BROILER';

        const penManagers = [...new Map(
          pen.sections
            .flatMap(s => s.workerAssignments)
            .filter(a => a.user.role === 'PEN_MANAGER')
            .map(a => [a.user.id, a.user])
        ).values()];

        const sections = pen.sections.map(sec => {
          const activeFlock  = sec.flocks[0] || null;
          const currentBirds = sec.flocks.reduce((s, f) => s + f.currentCount, 0);
          const occupancyPct = sec.capacity > 0
            ? parseFloat(((currentBirds / sec.capacity) * 100).toFixed(1)) : 0;

          const workers  = sec.workerAssignments.filter(a => a.user.role === 'PEN_WORKER').map(a => a.user);
          const managers = sec.workerAssignments.filter(a => a.user.role === 'PEN_MANAGER').map(a => a.user);
          const ageInDays = activeFlock
            ? Math.floor((Date.now() - new Date(activeFlock.dateOfPlacement)) / 86400000) : 0;

          const todayDead  = idx.todayDead[sec.id]  || 0;
          const weekDead   = idx.weekDead[sec.id]   || 0;
          const feedData   = idx.weekFeed[sec.id]   || { kg: 0, gpb: 0 };
          const tEgg       = idx.todayEggs[sec.id]  || { total: 0, gradeA: 0, cracked: 0, rate: 0, gradePending: false };
          const wEgg       = idx.weekEggs[sec.id]   || { total: 0, gradeA: 0, rate: 0 };
          const wt         = idx.latestWeight[sec.id];

          const mortalityRate = activeFlock?.initialCount > 0
            ? parseFloat(((weekDead / activeFlock.initialCount) * 100).toFixed(2)) : 0;

          const currentWeightKg = wt
            ? parseFloat(wt.avgWeightG) * currentBirds / 1000 : null;
          const placementWeightKg = currentBirds * 0.042;
          const estimatedGainKg  = currentWeightKg
            ? parseFloat((currentWeightKg - placementWeightKg).toFixed(1)) : null;
          const estimatedFCR = estimatedGainKg && feedData.kg > 0 && estimatedGainKg > 0
            ? parseFloat((feedData.kg / estimatedGainKg).toFixed(2)) : null;

          // gradeA % — only meaningful once PM has graded
          const gradeAPct = tEgg.total > 0 && tEgg.gradeA > 0
            ? parseFloat(((tEgg.gradeA / tEgg.total) * 100).toFixed(1)) : 0;
          const weekGradeAPct = wEgg.total > 0 && wEgg.gradeA > 0
            ? parseFloat(((wEgg.gradeA / wEgg.total) * 100).toFixed(1)) : 0;

          const daysToHarvest = activeFlock?.expectedHarvestDate
            ? Math.max(0, Math.floor((new Date(activeFlock.expectedHarvestDate) - Date.now()) / 86400000)) : null;

          return {
            id: sec.id, name: sec.name, capacity: sec.capacity,
            currentBirds, occupancyPct, activeFlock, ageInDays,
            workers, managers,
            metrics: isLayer ? {
              type: 'LAYER',
              todayMortality:   todayDead,
              weekMortality:    weekDead,
              mortalityRate,
              todayEggs:        tEgg.total,
              todayGradeA:      tEgg.gradeA,
              todayCracked:     tEgg.cracked,
              todayGradeAPct:   gradeAPct,
              todayGradeAPending: tEgg.gradePending,   // true = eggs logged but PM hasn't graded yet
              todayLayingRate:  tEgg.rate,
              weekEggs:         wEgg.total,
              weekGradeA:       wEgg.gradeA,
              weekGradeAPct,
              avgLayingRate:    wEgg.rate,
              avgDailyFeedKg:   feedData.kg > 0
                ? parseFloat((feedData.kg / 7).toFixed(1)) : 0,
              feedGramsPerBird: feedData.gpb,
            } : {
              type: 'BROILER',
              todayMortality:  todayDead,
              weekMortality:   weekDead,
              mortalityRate,
              ageInDays,
              daysToHarvest,
              latestWeightG:   wt ? parseFloat(parseFloat(wt.avgWeightG).toFixed(0)) : null,
              uniformityPct:   wt?.uniformityPct ? parseFloat(parseFloat(wt.uniformityPct).toFixed(1)) : null,
              weekFeedKg:      feedData.kg,
              avgDailyFeedKg:  feedData.kg > 0 ? parseFloat((feedData.kg / 7).toFixed(1)) : 0,
              feedGramsPerBird: feedData.gpb,
              estimatedFCR,
            },
          };
        });

        // Aggregate pen metrics
        const totalCapacity = sections.reduce((s, sec) => s + sec.capacity, 0);
        const currentBirds  = sections.reduce((s, sec) => s + sec.currentBirds, 0);

        const penMetrics = isLayer ? {
          type: 'LAYER',
          todayMortality: sections.reduce((s, sec) => s + sec.metrics.todayMortality, 0),
          weekMortality:  sections.reduce((s, sec) => s + sec.metrics.weekMortality, 0),
          mortalityRate:  currentBirds > 0
            ? parseFloat(((sections.reduce((s, sec) => s + sec.metrics.weekMortality, 0) / currentBirds) * 100).toFixed(2)) : 0,
          todayEggs:      sections.reduce((s, sec) => s + (sec.metrics.todayEggs || 0), 0),
          weekEggs:       sections.reduce((s, sec) => s + (sec.metrics.weekEggs  || 0), 0),
          avgLayingRate:  (() => {
            const ls = sections.filter(s => s.metrics.avgLayingRate > 0);
            return ls.length > 0 ? parseFloat((ls.reduce((s, sec) => s + sec.metrics.avgLayingRate, 0) / ls.length).toFixed(1)) : 0;
          })(),
          weekFeedKg: parseFloat(sections.reduce((s, sec) => s + (sec.metrics.avgDailyFeedKg || 0) * 7, 0).toFixed(1)),
        } : {
          type: 'BROILER',
          todayMortality: sections.reduce((s, sec) => s + sec.metrics.todayMortality, 0),
          weekMortality:  sections.reduce((s, sec) => s + sec.metrics.weekMortality,  0),
          mortalityRate:  currentBirds > 0
            ? parseFloat(((sections.reduce((s, sec) => s + sec.metrics.weekMortality, 0) / currentBirds) * 100).toFixed(2)) : 0,
          avgWeightG: (() => {
            const ws = sections.filter(s => s.metrics.latestWeightG);
            return ws.length > 0 ? parseFloat((ws.reduce((s, sec) => s + sec.metrics.latestWeightG, 0) / ws.length).toFixed(0)) : null;
          })(),
          avgFCR: (() => {
            const fs = sections.filter(s => s.metrics.estimatedFCR);
            return fs.length > 0 ? parseFloat((fs.reduce((s, sec) => s + sec.metrics.estimatedFCR, 0) / fs.length).toFixed(2)) : null;
          })(),
          weekFeedKg: parseFloat(sections.reduce((s, sec) => s + (sec.metrics.weekFeedKg || 0), 0).toFixed(1)),
        };

        return {
          id: pen.id, name: pen.name, operationType: pen.operationType,
          capacity: pen.capacity, location: pen.location, buildYear: pen.buildYear,
          sections, penManagers, totalCapacity, currentBirds,
          occupancyPct: totalCapacity > 0
            ? parseFloat(((currentBirds / totalCapacity) * 100).toFixed(1)) : 0,
          sectionCount: sections.length,
          activeSections: sections.filter(s => s.activeFlock).length,
          metrics: penMetrics,
        };
      });

      const totalCapacity  = pens.reduce((s, p) => s + p.totalCapacity, 0);
      const totalBirds     = pens.reduce((s, p) => s + p.currentBirds, 0);
      const layerPens      = pens.filter(p => p.operationType === 'LAYER');
      const broilerPens    = pens.filter(p => p.operationType === 'BROILER');

      const farmMetrics = {
        todayMortality:  pens.reduce((s, p) => s + p.metrics.todayMortality, 0),
        weekMortality:   pens.reduce((s, p) => s + p.metrics.weekMortality,  0),
        mortalityRate:   totalBirds > 0
          ? parseFloat(((pens.reduce((s, p) => s + p.metrics.weekMortality, 0) / totalBirds) * 100).toFixed(2)) : 0,
        weekFeedKg:      parseFloat(pens.reduce((s, p) => s + (p.metrics.weekFeedKg || 0), 0).toFixed(1)),
        todayEggs:       layerPens.reduce((s, p) => s + (p.metrics.todayEggs || 0), 0),
        weekEggs:        layerPens.reduce((s, p) => s + (p.metrics.weekEggs  || 0), 0),
        avgLayingRate:   (() => {
          const lp = layerPens.filter(p => p.metrics.avgLayingRate > 0);
          return lp.length > 0 ? parseFloat((lp.reduce((s, p) => s + p.metrics.avgLayingRate, 0) / lp.length).toFixed(1)) : 0;
        })(),
        avgBroilerWeightG: (() => {
          const bp = broilerPens.filter(p => p.metrics.avgWeightG);
          return bp.length > 0 ? parseFloat((bp.reduce((s, p) => s + p.metrics.avgWeightG, 0) / bp.length).toFixed(0)) : null;
        })(),
        avgFCR: (() => {
          const bp = broilerPens.filter(p => p.metrics.avgFCR);
          return bp.length > 0 ? parseFloat((bp.reduce((s, p) => s + p.metrics.avgFCR, 0) / bp.length).toFixed(2)) : null;
        })(),
      };

      return {
        id: farm.id, name: farm.name, location: farm.location,
        address: farm.address, phone: farm.phone, email: farm.email,
        managerId: farm.managerId,
        pens, totalCapacity, totalBirds,
        occupancyPct: totalCapacity > 0
          ? parseFloat(((totalBirds / totalCapacity) * 100).toFixed(1)) : 0,
        metrics: farmMetrics,
      };
    });

    return NextResponse.json({ farms: enriched });

  } catch (error) {
    console.error('Farm structure error:', error);
    return NextResponse.json({ error: 'Failed to fetch farm structure' }, { status: 500 });
  }
}
