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

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

// Timezone-safe YYYY-MM-DD from any Date object
// Uses local date parts so a date stored as 2026-03-20T00:00:00Z is always
// keyed as '2026-03-20' regardless of server timezone.
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

  if (!sectionId) return NextResponse.json({ error: 'sectionId required' }, { status: 400 });

  const section = await prisma.penSection.findFirst({
    where:   { id: sectionId, pen: { farm: { tenantId: user.tenantId } } },
    include: { pen: { select: { operationType: true, name: true } } },
  });
  if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 });

  // Build `from` at local midnight to match how @db.Date records are stored
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  const isLayer = section.pen.operationType === 'LAYER';

  // Build dateRange using local date parts — avoids UTC shift
  const dateRange = Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return toDateKey(d);
  });

  // Ross 308 rough estimate for broiler target weight curve
  const ross308 = (age) => Math.round(42 * Math.pow(1.085, age / 7) * 10) / 10;

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

    // Key all indexes using timezone-safe date keys
    const eggIdx  = Object.fromEntries(eggs.map(r     => [toDateKey(r.collectionDate), r]));
    const mortIdx = Object.fromEntries(mortality.map(r => [toDateKey(r.recordDate), r]));
    const feedIdx = Object.fromEntries(feed.map(r      => [toDateKey(r.recordedDate), r]));

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
        feedKg:        feedIdx[date] ? parseFloat(parseFloat(feedIdx[date].quantityKg).toFixed(1)) : null,
        feedGpb:       feedIdx[date]?.gramsPerBird ? parseFloat(parseFloat(feedIdx[date].gramsPerBird).toFixed(0)) : null,
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

    const wtIdx   = Object.fromEntries(weights.map(r   => [toDateKey(r.recordDate), r]));
    const mortIdx = Object.fromEntries(mortality.map(r  => [toDateKey(r.recordDate), r]));
    const feedIdx = Object.fromEntries(feed.map(r       => [toDateKey(r.recordedDate), r]));

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
        feedKg:        feedIdx[date] ? parseFloat(parseFloat(feedIdx[date].quantityKg).toFixed(1)) : null,
        feedGpb:       feedIdx[date]?.gramsPerBird ? parseFloat(parseFloat(feedIdx[date].gramsPerBird).toFixed(0)) : null,
      };
    });

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
