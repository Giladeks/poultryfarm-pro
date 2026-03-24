// app/api/daily-summary/route.js
// GET  — fetch (or auto-create) today's DailySummary for a pen section.
//        Recomputes live aggregates from production records on every GET while PENDING.
// POST — PM manually submits a section's summary for the day.
//
// Auto-submit is triggered fire-and-forget from each production record save
// (egg, feed, mortality). See lib/utils/autoSubmitSummary.js

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'PRODUCTION_STAFF',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
  'INTERNAL_CONTROL',
];

const PM_ROLES = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// ── Date helpers (timezone-safe) ──────────────────────────────────────────────
function localToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function localTomorrow() {
  const d = localToday();
  d.setDate(d.getDate() + 1);
  return d;
}

// ── Live aggregate computation ────────────────────────────────────────────────
export async function computeAggregates(penSectionId, forDate) {
  const dateStart = new Date(forDate);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(dateStart);
  dateEnd.setDate(dateEnd.getDate() + 1);

  const [eggAgg, feedAgg, mortAgg, waterRow, pendingEgg, pendingFeed, pendingMort] =
    await Promise.all([
      prisma.eggProduction.aggregate({
        where: { penSectionId, collectionDate: { gte: dateStart, lt: dateEnd } },
        _sum:  { totalEggs: true },
        _count: true,
      }),
      prisma.feedConsumption.aggregate({
        where: { penSectionId, recordedDate: { gte: dateStart, lt: dateEnd } },
        _sum:  { quantityKg: true },
        _count: true,
      }),
      prisma.mortalityRecord.aggregate({
        where: { penSectionId, recordDate: { gte: dateStart, lt: dateEnd } },
        _sum:  { count: true },
        _count: true,
      }),
      prisma.waterMeterReading.findFirst({
        where:   { penSectionId, readingDate: { gte: dateStart, lt: dateEnd } },
        orderBy: { readingDate: 'desc' },
        select:  { consumptionL: true },
      }),
      prisma.eggProduction.count({
        where: { penSectionId, collectionDate: { gte: dateStart, lt: dateEnd }, submissionStatus: 'PENDING' },
      }),
      prisma.feedConsumption.count({
        where: { penSectionId, recordedDate: { gte: dateStart, lt: dateEnd }, submissionStatus: 'PENDING' },
      }),
      prisma.mortalityRecord.count({
        where: { penSectionId, recordDate: { gte: dateStart, lt: dateEnd }, submissionStatus: 'PENDING' },
      }),
    ]);

  return {
    totalEggsCollected:             eggAgg._sum.totalEggs || 0,
    totalFeedKg:                    Number(feedAgg._sum.quantityKg || 0),
    totalMortality:                 mortAgg._sum.count || 0,
    waterConsumptionL:              waterRow?.consumptionL ? Number(waterRow.consumptionL) : null,
    pendingEggVerifications:        pendingEgg,
    pendingFeedVerifications:       pendingFeed,
    pendingMortalityVerifications:  pendingMort,
    // Record counts for task linking
    eggRecordsToday:  eggAgg._count,
    feedRecordsToday: feedAgg._count,
    mortRecordsToday: mortAgg._count,
  };
}

// ── GET /api/daily-summary ────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const penSectionId = searchParams.get('penSectionId');
  const dateParam    = searchParams.get('date');
  if (!penSectionId)
    return NextResponse.json({ error: 'penSectionId is required' }, { status: 400 });

  try {
    const section = await prisma.penSection.findFirst({
      where:   { id: penSectionId, pen: { farm: { tenantId: user.tenantId } } },
      include: { pen: { include: { farm: { select: { id: true, autoSummaryTime: true } } } } },
    });
    if (!section)
      return NextResponse.json({ error: 'Section not found' }, { status: 404 });

    const summaryDate = dateParam
      ? (() => { const d = new Date(dateParam); d.setHours(0,0,0,0); return d; })()
      : localToday();

    const agg = await computeAggregates(penSectionId, summaryDate);

    let summary = await prisma.dailySummary.findUnique({
      where:   { penSectionId_summaryDate: { penSectionId, summaryDate } },
      include: { reviewedBy: { select: { firstName: true, lastName: true } } },
    });

    if (!summary) {
      summary = await prisma.dailySummary.create({
        data: {
          tenantId:    user.tenantId,
          farmId:      section.pen.farmId,
          penSectionId,
          summaryDate,
          status:      'PENDING',
          ...agg,
        },
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
      });
    } else if (summary.status === 'PENDING') {
      // Refresh aggregates while still in progress
      summary = await prisma.dailySummary.update({
        where:   { id: summary.id },
        data:    agg,
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
      });
    }

    return NextResponse.json({ summary, autoSummaryTime: section.pen.farm.autoSummaryTime });
  } catch (err) {
    console.error('[GET /api/daily-summary]', err);
    return NextResponse.json({ error: 'Failed to load daily summary' }, { status: 500 });
  }
}

// ── POST /api/daily-summary ───────────────────────────────────────────────────
// PM manually submits a summary. Refreshes aggregates, determines SUBMITTED vs FLAGGED.
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!PM_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Pen Managers and above can submit summaries' }, { status: 403 });

  try {
    const body         = await request.json();
    const penSectionId = body.penSectionId;
    if (!penSectionId)
      return NextResponse.json({ error: 'penSectionId is required' }, { status: 400 });

    const section = await prisma.penSection.findFirst({
      where:   { id: penSectionId, pen: { farm: { tenantId: user.tenantId } } },
      include: { pen: { include: { farm: true } } },
    });
    if (!section)
      return NextResponse.json({ error: 'Section not found' }, { status: 404 });

    const today = localToday();
    const agg   = await computeAggregates(penSectionId, today);

    const hasPending = agg.pendingEggVerifications > 0
      || agg.pendingFeedVerifications > 0
      || agg.pendingMortalityVerifications > 0;

    const newStatus = hasPending ? 'FLAGGED' : 'SUBMITTED';

    const summary = await prisma.dailySummary.upsert({
      where:  { penSectionId_summaryDate: { penSectionId, summaryDate: today } },
      update: { ...agg, status: newStatus, submittedAt: new Date() },
      create: {
        tenantId:    user.tenantId,
        farmId:      section.pen.farmId,
        penSectionId,
        summaryDate: today,
        status:      newStatus,
        submittedAt: new Date(),
        ...agg,
      },
      include: { reviewedBy: { select: { firstName: true, lastName: true } } },
    });

    return NextResponse.json({ summary, wasSubmitted: true });
  } catch (err) {
    console.error('[POST /api/daily-summary]', err);
    return NextResponse.json({ error: 'Failed to submit daily summary' }, { status: 500 });
  }
}
