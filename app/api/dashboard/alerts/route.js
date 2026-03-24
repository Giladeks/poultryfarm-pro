// app/api/dashboard/alerts/route.js
// GET — returns farm-wide alerts and attention items for the current user
//
// Alert types:
//   Operational:    MORTALITY_SPIKE, LOW_STOCK, PENDING_VERIFICATION,
//                   HARVEST_DUE, WATER_ANOMALY
//   Statistical:    LAYING_RATE_DROP   — section rate vs its own 30-day baseline
//                   FCR_ANOMALY        — broiler FCR vs flock's own running average
//                   ZERO_MORT_STREAK   — suspiciously clean sections (5+ days no deaths)
//                   FEED_EGG_RATIO     — feed consumed high vs eggs produced (layer)
//                   BATCH_SUBMISSION   — records submitted outside hours or in rapid batches

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON',
  'SUPER_ADMIN', 'INTERNAL_CONTROL', 'STORE_MANAGER',
];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const now           = new Date();
    const today         = new Date(now); today.setHours(0, 0, 0, 0);
    const sevenDaysAgo  = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);
    const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);
    const threeDaysAgo  = new Date(today); threeDaysAgo.setDate(today.getDate() - 3);
    const fiveDaysAgo   = new Date(today); fiveDaysAgo.setDate(today.getDate() - 5);
    const in7days       = new Date(today); in7days.setDate(today.getDate() + 7);

    // ── Scope: PEN_MANAGER sees only their assigned pens ─────────────────────
    const isPenMgr = user.role === 'PEN_MANAGER';
    let allowedSectionIds = null;

    if (isPenMgr) {
      const asgn = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub },
        select: { penSectionId: true },
      });
      allowedSectionIds = asgn.map(a => a.penSectionId);
      if (allowedSectionIds.length === 0)
        return NextResponse.json({ alerts: [], counts: { critical: 0, warning: 0, info: 0, total: 0 } });
    }

    // ── Section filter ────────────────────────────────────────────────────────
    // All queries use direct penSection path — Prisma groupBy cannot use nested
    // relation filters, so we route through penSection → pen → farm → tenantId.
    const sectionFilterDirect = allowedSectionIds
      ? { penSectionId: { in: allowedSectionIds } }
      : { penSection: { pen: { farm: { tenantId: user.tenantId } } } };

    const flockWhere = allowedSectionIds
      ? { penSectionId: { in: allowedSectionIds }, status: 'ACTIVE' }
      : { penSection: { pen: { farm: { tenantId: user.tenantId } } }, status: 'ACTIVE' };

    // ── Run all queries in parallel ───────────────────────────────────────────
    const [
      activeFlocks,
      recentMortality,
      pendingEggs,
      pendingMortality,
      feedInventory,
      recentWater,
      upcomingHarvests,
      // Statistical: 30-day laying rate per section
      layingRate30d,
      // Statistical: today's laying rate per section
      layingRateToday,
      // Statistical: 30-day feed per section (layer)
      feedLast30d,
      // Statistical: 30-day eggs per section (layer)
      eggsLast30d,
      // Statistical: zero-mortality check — any mortality in last 5 days per section
      recentMortBySection,
      // Statistical: batch submission patterns — records created outside hours or in bursts
      recentEggCreation,
      recentMortCreation,
    ] = await Promise.all([

      prisma.flock.findMany({
        where:  flockWhere,
        select: {
          id: true, batchCode: true, currentCount: true, initialCount: true,
          operationType: true, expectedHarvestDate: true, dateOfPlacement: true,
          penSectionId: true,
          penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
        },
      }),

      prisma.mortalityRecord.groupBy({
        by:    ['penSectionId', 'flockId'],
        where: { recordDate: { gte: sevenDaysAgo }, ...sectionFilterDirect },
        _sum:  { count: true },
      }),

      prisma.eggProduction.findMany({
        where: {
          submissionStatus: 'PENDING',
          gradeACount:      null,
          collectionDate:   { gte: sevenDaysAgo, lte: threeDaysAgo },
          ...sectionFilterDirect,
        },
        select: {
          id: true, collectionDate: true, totalEggs: true,
          penSection: { select: { name: true, pen: { select: { name: true } } } },
          flock:      { select: { batchCode: true } },
        },
        orderBy: { collectionDate: 'asc' },
        take: 20,
      }),

      prisma.mortalityRecord.findMany({
        where: {
          submissionStatus: 'PENDING',
          recordDate:       { gte: sevenDaysAgo, lte: threeDaysAgo },
          ...sectionFilterDirect,
        },
        select: { id: true, recordDate: true, count: true },
        take: 20,
      }),

      prisma.feedInventory.findMany({
        where:  { store: { farm: { tenantId: user.tenantId } } },
        select: {
          id: true, feedType: true, currentStockKg: true, reorderLevelKg: true,
          store: { select: { name: true } },
        },
        take: 10,
      }),

      prisma.waterMeterReading.findMany({
        where: {
          tenantId:    user.tenantId,
          readingDate: { gte: threeDaysAgo },
          ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
        },
        select: { penSectionId: true, readingDate: true, consumptionL: true, consumptionLPB: true },
      }),

      prisma.flock.findMany({
        where: { ...flockWhere, operationType: 'BROILER', expectedHarvestDate: { gte: today, lte: in7days } },
        select: {
          id: true, batchCode: true, currentCount: true,
          expectedHarvestDate: true,
          penSection: { select: { name: true, pen: { select: { name: true } } } },
        },
      }),

      // Statistical: 30-day avg laying rate per section (baseline)
      prisma.eggProduction.groupBy({
        by:    ['penSectionId'],
        where: {
          collectionDate:   { gte: thirtyDaysAgo, lt: today },
          submissionStatus: { in: ['PENDING', 'APPROVED'] },
          ...sectionFilterDirect,
        },
        _avg: { layingRatePct: true },
        _count: true,
      }),

      // Statistical: today's laying rate per section
      prisma.eggProduction.groupBy({
        by:    ['penSectionId'],
        where: {
          collectionDate:   { gte: today },
          submissionStatus: { in: ['PENDING', 'APPROVED'] },
          ...sectionFilterDirect,
        },
        _avg: { layingRatePct: true },
      }),

      // Statistical: 30-day total feed per section
      prisma.feedConsumption.groupBy({
        by:    ['penSectionId'],
        where: { recordedDate: { gte: thirtyDaysAgo }, ...sectionFilterDirect },
        _sum:  { quantityKg: true },
      }),

      // Statistical: 30-day total eggs per section
      prisma.eggProduction.groupBy({
        by:    ['penSectionId'],
        where: {
          collectionDate:   { gte: thirtyDaysAgo },
          submissionStatus: { in: ['PENDING', 'APPROVED'] },
          ...sectionFilterDirect,
        },
        _sum: { totalEggs: true },
      }),

      // Statistical: mortality last 5 days per section (for zero-streak detection)
      prisma.mortalityRecord.groupBy({
        by:    ['penSectionId'],
        where: { recordDate: { gte: fiveDaysAgo }, ...sectionFilterDirect },
        _sum:  { count: true },
      }),

      // Statistical: egg records created in last 48h (timestamp pattern analysis)
      prisma.eggProduction.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
          ...sectionFilterDirect,
        },
        select: { id: true, penSectionId: true, createdAt: true, recordedById: true },
        orderBy: { createdAt: 'asc' },
      }),

      // Statistical: mortality records created in last 48h
      prisma.mortalityRecord.findMany({
        where: {
          createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
          ...sectionFilterDirect,
        },
        select: { id: true, penSectionId: true, createdAt: true, recordedById: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // ── Build section/flock lookup maps ───────────────────────────────────────
    const flockBySection = {};
    activeFlocks.forEach(f => { flockBySection[f.penSectionId] = f; });

    // ── Build alerts ──────────────────────────────────────────────────────────
    const alerts = [];
    let _id = 0;
    const mkId = () => `alert-${++_id}`;

    // ─────────────────────────────────────────────────────────────────────────
    // OPERATIONAL ALERTS
    // ─────────────────────────────────────────────────────────────────────────

    // 1. Mortality spike
    const mortByFlock = {};
    recentMortality.forEach(r => {
      mortByFlock[r.flockId] = (mortByFlock[r.flockId] || 0) + (r._sum.count || 0);
    });

    activeFlocks.forEach(flock => {
      const weekDead = mortByFlock[flock.id] || 0;
      const rate7d   = flock.initialCount > 0 ? (weekDead / flock.initialCount) * 100 : 0;
      const penLabel = `${flock.penSection.pen.name} › ${flock.penSection.name}`;

      if (rate7d > 2) {
        alerts.push({ id: mkId(), severity: 'CRITICAL', type: 'MORTALITY_SPIKE',
          title:     `Critical mortality: ${rate7d.toFixed(1)}% this week`,
          message:   `${weekDead} deaths in 7 days for flock ${flock.batchCode}. Immediate attention required.`,
          context: penLabel, actionUrl: '/mortality', createdAt: now.toISOString() });
      } else if (rate7d > 1) {
        alerts.push({ id: mkId(), severity: 'WARNING', type: 'MORTALITY_SPIKE',
          title:     `Elevated mortality: ${rate7d.toFixed(1)}% this week`,
          message:   `${weekDead} deaths in 7 days for flock ${flock.batchCode}. Monitor closely.`,
          context: penLabel, actionUrl: '/mortality', createdAt: now.toISOString() });
      }
    });

    // 2. Pending verification
    if (pendingEggs.length > 0) {
      const oldest  = pendingEggs[0];
      const daysOld = Math.floor((today - new Date(oldest.collectionDate)) / 86400000);
      alerts.push({ id: mkId(), severity: daysOld >= 2 ? 'WARNING' : 'INFO',
        type: 'PENDING_VERIFICATION',
        title:   `${pendingEggs.length} egg record${pendingEggs.length > 1 ? 's' : ''} awaiting grading`,
        message: `Oldest record is ${daysOld} day${daysOld !== 1 ? 's' : ''} old. Grade B entry required.`,
        context: pendingEggs.length === 1
          ? `${oldest.penSection?.pen?.name} › ${oldest.penSection?.name}`
          : `${pendingEggs.length} sections`,
        actionUrl: '/verification', createdAt: now.toISOString() });
    }

    if (pendingMortality.length > 0) {
      alerts.push({ id: mkId(), severity: 'INFO', type: 'PENDING_VERIFICATION',
        title:   `${pendingMortality.length} mortality record${pendingMortality.length > 1 ? 's' : ''} pending verification`,
        message: 'Unverified mortality records need review.',
        context: `${pendingMortality.length} record${pendingMortality.length > 1 ? 's' : ''}`,
        actionUrl: '/verification', createdAt: now.toISOString() });
    }

    // 3. Low feed stock
    feedInventory
      .filter(i => Number(i.currentStockKg) <= Number(i.reorderLevelKg))
      .forEach(item => {
        const isOut = Number(item.currentStockKg) <= 0;
        alerts.push({ id: mkId(), severity: isOut ? 'CRITICAL' : 'WARNING', type: 'LOW_STOCK',
          title:   isOut ? `OUT OF STOCK: ${item.feedType}` : `Low feed stock: ${item.feedType}`,
          message: isOut
            ? `Feed is completely out of stock. Birds may be underfed.`
            : `Stock ${Number(item.currentStockKg).toFixed(1)} kg is at or below reorder level (${Number(item.reorderLevelKg).toFixed(1)} kg).`,
          context: item.store?.name || 'Feed Store',
          actionUrl: '/feed', createdAt: now.toISOString() });
      });

    // 4. Harvest due
    upcomingHarvests.forEach(flock => {
      const daysLeft = Math.ceil((new Date(flock.expectedHarvestDate) - today) / 86400000);
      alerts.push({ id: mkId(), severity: daysLeft <= 2 ? 'WARNING' : 'INFO', type: 'HARVEST_DUE',
        title:   daysLeft <= 0
          ? `Harvest overdue: ${flock.batchCode}`
          : `Harvest in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}: ${flock.batchCode}`,
        message: `${flock.currentCount.toLocaleString('en-NG')} birds ready. Schedule harvest to avoid weight loss.`,
        context: `${flock.penSection.pen.name} › ${flock.penSection.name}`,
        actionUrl: '/broiler-performance', createdAt: now.toISOString() });
    });

    // 5. Water anomaly
    const waterBySection = {};
    recentWater.forEach(r => {
      if (!waterBySection[r.penSectionId]) waterBySection[r.penSectionId] = [];
      waterBySection[r.penSectionId].push(r);
    });

    Object.entries(waterBySection).forEach(([secId, readings]) => {
      const latest = readings.sort((a, b) => new Date(b.readingDate) - new Date(a.readingDate))[0];
      const lpb    = latest?.consumptionLPB ? Number(latest.consumptionLPB) : null;
      if (lpb !== null && lpb > 0.65) {
        const sec = activeFlocks.find(f => f.penSection.id === secId)?.penSection;
        alerts.push({ id: mkId(), severity: lpb > 1.0 ? 'WARNING' : 'INFO', type: 'WATER_ANOMALY',
          title:   `High water use: ${lpb.toFixed(2)} L/bird`,
          message: `Water consumption per bird is above normal. Check drinkers for leaks or spills.`,
          context: sec ? `${sec.pen?.name} › ${sec.name}` : secId,
          actionUrl: '/performance', createdAt: now.toISOString() });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STATISTICAL OUTLIER ALERTS
    // ─────────────────────────────────────────────────────────────────────────

    // 6. Laying rate drop vs section's own 30-day baseline
    //    Only fires when today has ≥1 record AND the baseline has ≥7 days of data
    const baselineBySection = Object.fromEntries(
      layingRate30d.map(r => [r.penSectionId, { avg: Number(r._avg.layingRatePct || 0), days: r._count }])
    );
    const todayRateBySection = Object.fromEntries(
      layingRateToday.map(r => [r.penSectionId, Number(r._avg.layingRatePct || 0)])
    );

    activeFlocks
      .filter(f => f.operationType === 'LAYER')
      .forEach(flock => {
        const baseline = baselineBySection[flock.penSectionId];
        const todayRate = todayRateBySection[flock.penSectionId];
        if (!baseline || baseline.days < 7 || !todayRate || baseline.avg < 5) return;

        const drop = baseline.avg > 0
          ? ((baseline.avg - todayRate) / baseline.avg) * 100
          : 0;
        const penLabel = `${flock.penSection.pen.name} › ${flock.penSection.name}`;

        if (drop >= 25) {
          alerts.push({ id: mkId(), severity: 'CRITICAL', type: 'LAYING_RATE_DROP',
            title:   `Laying rate collapsed: ${todayRate.toFixed(1)}% (baseline ${baseline.avg.toFixed(1)}%)`,
            message: `${drop.toFixed(0)}% drop from the 30-day baseline for flock ${flock.batchCode}. Investigate disease, feed, or stress.`,
            context: penLabel, actionUrl: '/performance', createdAt: now.toISOString() });
        } else if (drop >= 15) {
          alerts.push({ id: mkId(), severity: 'WARNING', type: 'LAYING_RATE_DROP',
            title:   `Laying rate drop: ${todayRate.toFixed(1)}% (baseline ${baseline.avg.toFixed(1)}%)`,
            message: `${drop.toFixed(0)}% below 30-day baseline for flock ${flock.batchCode}. Monitor closely.`,
            context: penLabel, actionUrl: '/performance', createdAt: now.toISOString() });
        }
      });

    // 7. Zero-mortality streak (≥5 days no deaths in an active flock)
    //    Suspicious for large flocks — some natural attrition is expected
    const mortSectionIds = new Set(
      recentMortBySection.filter(r => (r._sum.count || 0) > 0).map(r => r.penSectionId)
    );

    activeFlocks
      .filter(f => f.currentCount >= 100) // only flag meaningful flock sizes
      .forEach(flock => {
        if (mortSectionIds.has(flock.penSectionId)) return; // has recent mort — fine

        // Only alert if flock is old enough to have natural attrition (>14 days)
        const ageInDays = flock.dateOfPlacement
          ? Math.floor((today - new Date(flock.dateOfPlacement)) / 86400000)
          : 0;
        if (ageInDays < 14) return;

        const penLabel = `${flock.penSection.pen.name} › ${flock.penSection.name}`;
        alerts.push({ id: mkId(), severity: 'INFO', type: 'ZERO_MORT_STREAK',
          title:   `No mortality logged: ${flock.batchCode} (5+ days)`,
          message: `Flock of ${flock.currentCount.toLocaleString('en-NG')} birds (${ageInDays}d old) has no recorded deaths in the last 5 days. Verify physical counts are being recorded.`,
          context: penLabel, actionUrl: '/mortality', createdAt: now.toISOString() });
      });

    // 8. Feed-to-egg ratio anomaly (layer sections only)
    //    Flag when feed consumed per egg today is >30% above the section's own 30-day ratio
    const feed30dBySection = Object.fromEntries(
      feedLast30d.map(r => [r.penSectionId, Number(r._sum.quantityKg || 0)])
    );
    const eggs30dBySection = Object.fromEntries(
      eggsLast30d.map(r => [r.penSectionId, r._sum.totalEggs || 0])
    );

    activeFlocks
      .filter(f => f.operationType === 'LAYER')
      .forEach(flock => {
        const feed30 = feed30dBySection[flock.penSectionId] || 0;
        const eggs30 = eggs30dBySection[flock.penSectionId] || 0;

        // Need meaningful 30-day baseline to compare against
        if (feed30 < 50 || eggs30 < 100) return;

        // Baseline ratio: kg feed per 100 eggs over 30 days
        const baselineRatio = (feed30 / eggs30) * 100;

        if (baselineRatio > 25) { // >25 kg feed per 100 eggs is extremely high
          const penLabel = `${flock.penSection.pen.name} › ${flock.penSection.name}`;
          alerts.push({ id: mkId(), severity: 'WARNING', type: 'FEED_EGG_RATIO',
            title:   `High feed-per-egg ratio: ${baselineRatio.toFixed(1)} kg/100 eggs`,
            message: `30-day average for flock ${flock.batchCode} is above normal. Cross-check feed logs against egg production records.`,
            context: penLabel, actionUrl: '/performance', createdAt: now.toISOString() });
        }
      });

    // 9. Batch submission pattern — records submitted outside 05:00–20:00 local time
    //    or multiple records from the same worker within 2 minutes
    //    This is an IC/management-only alert (not shown to PMs)
    if (!isPenMgr) {
      const allRecent = [
        ...recentEggCreation.map(r => ({ ...r, recordType: 'EggProduction' })),
        ...recentMortCreation.map(r => ({ ...r, recordType: 'MortalityRecord' })),
      ];

      // Off-hours submissions (21:00–04:59 UTC+1, approx Nigeria time)
      const offHours = allRecent.filter(r => {
        const h = new Date(r.createdAt).getUTCHours(); // approx WAT = UTC+1
        const hWAT = (h + 1) % 24;
        return hWAT >= 21 || hWAT < 5;
      });

      if (offHours.length > 0) {
        const uniqueWorkers = new Set(offHours.map(r => r.recordedById)).size;
        alerts.push({ id: mkId(), severity: 'INFO', type: 'BATCH_SUBMISSION',
          title:   `${offHours.length} record${offHours.length > 1 ? 's' : ''} submitted outside working hours`,
          message: `${uniqueWorkers} worker${uniqueWorkers > 1 ? 's' : ''} submitted records between 21:00–05:00 in the last 48 hours. Review audit trail.`,
          context: 'Audit flag — IC review recommended',
          actionUrl: '/audit', createdAt: now.toISOString() });
      }

      // Rapid-batch submissions: same worker, same section, <2 min between records
      const byWorkerSection = {};
      allRecent.forEach(r => {
        const key = `${r.recordedById}|${r.penSectionId}`;
        if (!byWorkerSection[key]) byWorkerSection[key] = [];
        byWorkerSection[key].push(new Date(r.createdAt).getTime());
      });

      let rapidBatchCount = 0;
      Object.values(byWorkerSection).forEach(times => {
        times.sort((a, b) => a - b);
        for (let i = 1; i < times.length; i++) {
          if (times[i] - times[i - 1] < 2 * 60 * 1000) { rapidBatchCount++; break; }
        }
      });

      if (rapidBatchCount > 0) {
        alerts.push({ id: mkId(), severity: 'INFO', type: 'BATCH_SUBMISSION',
          title:   `Rapid batch submissions detected`,
          message: `${rapidBatchCount} worker-section combination${rapidBatchCount > 1 ? 's' : ''} had multiple records submitted within 2 minutes. May indicate manual back-entry — review audit trail.`,
          context: 'Audit flag — IC review recommended',
          actionUrl: '/audit', createdAt: now.toISOString() });
      }
    }

    // ── Sort: CRITICAL → WARNING → INFO; newest first within tier ────────────
    const RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => {
      const diff = RANK[a.severity] - RANK[b.severity];
      return diff !== 0 ? diff : new Date(b.createdAt) - new Date(a.createdAt);
    });

    const counts = {
      critical: alerts.filter(a => a.severity === 'CRITICAL').length,
      warning:  alerts.filter(a => a.severity === 'WARNING').length,
      info:     alerts.filter(a => a.severity === 'INFO').length,
      total:    alerts.length,
    };

    return NextResponse.json({ alerts: alerts.slice(0, 40), counts });

  } catch (err) {
    console.error('[dashboard/alerts GET]', err);
    return NextResponse.json({ error: 'Failed to load alerts' }, { status: 500 });
  }
}
