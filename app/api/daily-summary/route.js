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
  // Return UTC midnight for today's local calendar date.
  // getFullYear/Month/Date use local time, Date.UTC builds a clean UTC timestamp.
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// ── Live aggregate computation ────────────────────────────────────────────────
// Returns two objects:
//   dbFields  — only the fields that exist on the DailySummary model (safe to spread into Prisma)
//   taskMeta  — extra counts used by the worker page task-linking logic (NOT written to DB)
export async function computeAggregates(penSectionId, forDate) {
  // Build the date range from the calendar date only — never from a timezone-shifted
  // timestamp. forDate may be a Date object that already has a UTC offset applied
  // (e.g. 2026-03-25T23:00:00Z when the intended date is 2026-03-26 local time).
  // We extract the local Y/M/D components and build UTC midnight boundaries so that
  // the range always covers the full calendar day regardless of server timezone.
  const d = new Date(forDate);
  // Use local date parts to reconstruct the intended calendar date
  const year  = d.getFullYear();
  const month = d.getMonth();
  const day   = d.getDate();
  // dateStart = midnight UTC on that calendar day
  const dateStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  // dateEnd = midnight UTC on the next calendar day
  const dateEnd   = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));

  const [eggAgg, feedAgg, mortAgg, waterRow, pendingEgg, pendingFeed, pendingMort] =
    await Promise.all([
      prisma.eggProduction.aggregate({
        where: { penSectionId, collectionDate: { gte: dateStart, lt: dateEnd } },
        _sum:   { totalEggs: true },
        _count: true,
      }),
      prisma.feedConsumption.aggregate({
        where: { penSectionId, recordedDate: { gte: dateStart, lt: dateEnd } },
        _sum:   { quantityKg: true },
        _count: true,
      }),
      prisma.mortalityRecord.aggregate({
        where: { penSectionId, recordDate: { gte: dateStart, lt: dateEnd } },
        _sum:   { count: true },
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

  // Only fields that exist on the DailySummary Prisma model — safe to spread into create/update/upsert
  const dbFields = {
    totalEggsCollected:            eggAgg._sum.totalEggs || 0,
    totalFeedKg:                   Number(feedAgg._sum.quantityKg || 0),
    totalMortality:                mortAgg._sum.count || 0,
    waterConsumptionL:             waterRow?.consumptionL ? Number(waterRow.consumptionL) : null,
    pendingEggVerifications:       pendingEgg,
    pendingFeedVerifications:      pendingFeed,
    pendingMortalityVerifications: pendingMort,
  };

  // Extra counts for task-linking (returned in API response, never written to DB)
  const taskMeta = {
    eggRecordsToday:  eggAgg._count,
    feedRecordsToday: feedAgg._count,
    mortRecordsToday: mortAgg._count,
  };


  return { dbFields, taskMeta };
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
  const pmView       = searchParams.get('pmView') === 'true';

  // ── PM list mode: GET /api/daily-summary?pmView=true&date=YYYY-MM-DD ──────────
  // Returns all summaries for the PM's sections on a given date.
  // Used by the PM Daily Summaries review page.
  if (pmView) {
    if (!PM_ROLES.includes(user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
      const summaryDate = dateParam
        ? (() => { const [y,m,d] = dateParam.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); })()
        : localToday();

      // Find all sections this PM manages that have an active flock.
      // Sections without an active flock are excluded — no production = nothing to review.
      const sectionWhere = ['PEN_MANAGER'].includes(user.role)
        ? {
            workerAssignments: { some: { userId: user.sub } },
            pen:               { farm: { tenantId: user.tenantId } },
            flocks:            { some: { status: 'ACTIVE' } },
            isActive:          true,
          }
        : {
            pen:      { farm: { tenantId: user.tenantId } },
            flocks:   { some: { status: 'ACTIVE' } },
            isActive: true,
          };

      const sections = await prisma.penSection.findMany({
        where:   sectionWhere,
        select:  { id: true, name: true, pen: { select: { name: true, operationType: true } } },
        orderBy: [{ pen: { name: 'asc' } }, { name: 'asc' }],
      });

      const sectionIds = sections.map(s => s.id);

      // Fetch existing summaries for these sections on this date
      const summaries = await prisma.dailySummary.findMany({
        where:   { penSectionId: { in: sectionIds }, summaryDate },
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { penSectionId: 'asc' },
      });

      // Build a map sectionId → summary
      const summaryMap = Object.fromEntries(summaries.map(s => [s.penSectionId, s]));

      // Return one entry per section (summary may be null if workers haven't submitted yet)
      const result = sections.map(sec => ({
        section:  sec,
        summary:  summaryMap[sec.id] || null,
      }));

      return NextResponse.json({ date: summaryDate.toISOString(), sections: result });
    } catch (err) {
      console.error('[GET /api/daily-summary pmView]', err);
      return NextResponse.json({ error: 'Failed to load PM summary view' }, { status: 500 });
    }
  }

  if (!penSectionId)
    return NextResponse.json({ error: 'penSectionId is required' }, { status: 400 });

  try {
    const section = await prisma.penSection.findFirst({
      where:   { id: penSectionId, pen: { farm: { tenantId: user.tenantId } } },
      include: { pen: { include: { farm: { select: { id: true, autoSummaryTime: true } } } } },
    });
    if (!section)
      return NextResponse.json({ error: 'Section not found' }, { status: 404 });

    // Parse dateParam as a UTC calendar date to avoid timezone shifts.
    // "2026-03-26" must always mean 2026-03-26T00:00:00.000Z regardless of server TZ.
    const summaryDate = dateParam
      ? (() => {
          const [y, m, day] = dateParam.split('-').map(Number);
          return new Date(Date.UTC(y, m - 1, day));
        })()
      : localToday();

    const { dbFields, taskMeta } = await computeAggregates(penSectionId, summaryDate);

    let summary = await prisma.dailySummary.findUnique({
      where:   { penSectionId_summaryDate: { penSectionId, summaryDate } },
      include: { reviewedBy: { select: { firstName: true, lastName: true } } },
    });

    if (!summary) {
      // Auto-create today's record with live aggregates
      summary = await prisma.dailySummary.create({
        data: {
          tenantId:    user.tenantId,
          farmId:      section.pen.farmId,
          penSectionId,
          summaryDate,
          status:      'PENDING',
          ...dbFields,
        },
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
      });
    } else if (summary.status === 'PENDING') {
      // While still in progress, persist refreshed aggregates so the DB stays current
      summary = await prisma.dailySummary.update({
        where:   { id: summary.id },
        data:    dbFields,
        include: { reviewedBy: { select: { firstName: true, lastName: true } } },
      });
    } else {
      // For SUBMITTED / FLAGGED / REVIEWED summaries, don't overwrite the DB snapshot
      // but DO return live aggregate counts in the response so the UI shows current data.
      // We merge liveAggregates into the summary object in-memory only.
      summary = { ...summary, ...dbFields };
    }

    return NextResponse.json({
      summary,
      taskMeta,
      autoSummaryTime: section.pen.farm.autoSummaryTime,
    });
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
    const { dbFields } = await computeAggregates(penSectionId, today);

    const hasPending = dbFields.pendingEggVerifications > 0
      || dbFields.pendingFeedVerifications > 0
      || dbFields.pendingMortalityVerifications > 0;

    const newStatus = hasPending ? 'FLAGGED' : 'SUBMITTED';

    const summary = await prisma.dailySummary.upsert({
      where:  { penSectionId_summaryDate: { penSectionId, summaryDate: today } },
      update: { ...dbFields, status: newStatus, submittedAt: new Date() },  // ← only DB-valid fields
      create: {
        tenantId:    user.tenantId,
        farmId:      section.pen.farmId,
        penSectionId,
        summaryDate: today,
        status:      newStatus,
        submittedAt: new Date(),
        ...dbFields,                                                          // ← only DB-valid fields
      },
      include: { reviewedBy: { select: { firstName: true, lastName: true } } },
    });

    return NextResponse.json({ summary, wasSubmitted: true });
  } catch (err) {
    console.error('[POST /api/daily-summary]', err);
    return NextResponse.json({ error: 'Failed to submit daily summary' }, { status: 500 });
  }
}
