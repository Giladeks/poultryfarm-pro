// app/api/dashboard/charts/route.js
// Returns daily time-series data for a section, 7d or 30d
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sectionId = searchParams.get('sectionId');
  const days      = Math.min(parseInt(searchParams.get('days') || '7'), 90);

  if (!sectionId) return NextResponse.json({ error: 'sectionId required' }, { status: 400 });

  // Verify user has access to this section
  const section = await prisma.penSection.findFirst({
    where: {
      id: sectionId,
      pen: { farm: { tenantId: user.tenantId } },
    },
    include: { pen: { select: { operationType: true, name: true } } },
  });
  if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 });

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  const isLayer = section.pen.operationType === 'LAYER';

  // Build a full date range so we have an entry per day even with no data
  const dateRange = Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  });

  if (isLayer) {
    const [eggs, mortality, feed] = await Promise.all([
      prisma.eggProduction.findMany({
        where: { penSectionId: sectionId, collectionDate: { gte: from } },
        select: { collectionDate: true, totalEggs: true, gradeACount: true, layingRatePct: true, cratesCount: true },
        orderBy: { collectionDate: 'asc' },
      }),
      prisma.mortalityRecord.findMany({
        where: { penSectionId: sectionId, recordDate: { gte: from } },
        select: { recordDate: true, count: true },
        orderBy: { recordDate: 'asc' },
      }),
      prisma.feedConsumption.findMany({
        where: { penSectionId: sectionId, recordedDate: { gte: from } },
        select: { recordedDate: true, quantityKg: true, gramsPerBird: true },
        orderBy: { recordedDate: 'asc' },
      }),
    ]);

    // Index by date string
    const eggIdx  = Object.fromEntries(eggs.map(r     => [r.collectionDate.toISOString().slice(0,10), r]));
    const mortIdx = Object.fromEntries(mortality.map(r => [r.recordDate.toISOString().slice(0,10), r]));
    const feedIdx = Object.fromEntries(feed.map(r      => [r.recordedDate.toISOString().slice(0,10), r]));

    const chart = dateRange.map(date => ({
      date,
      label:       new Date(date).toLocaleDateString('en-NG', { day:'numeric', month:'short' }),
      totalEggs:   eggIdx[date]?.totalEggs    || null,
      gradeACount: eggIdx[date]?.gradeACount  || null,
      gradeAPct:   eggIdx[date] ? parseFloat(((eggIdx[date].gradeACount / eggIdx[date].totalEggs) * 100).toFixed(1)) : null,
      layingRate:  eggIdx[date] ? parseFloat(parseFloat(eggIdx[date].layingRatePct).toFixed(1)) : null,
      crates:      eggIdx[date]?.cratesCount  || null,
      mortality:   mortIdx[date]?.count       || 0,
      feedKg:      feedIdx[date] ? parseFloat(parseFloat(feedIdx[date].quantityKg).toFixed(1)) : null,
      feedGpb:     feedIdx[date] ? parseFloat(parseFloat(feedIdx[date].gramsPerBird).toFixed(0)) : null,
    }));

    return NextResponse.json({ type: 'LAYER', sectionName: section.name, penName: section.pen.name, days, chart });

  } else {
    const [weights, mortality, feed] = await Promise.all([
      prisma.weightRecord.findMany({
        where: { penSectionId: sectionId, recordDate: { gte: from } },
        select: { recordDate: true, avgWeightG: true, minWeightG: true, maxWeightG: true, uniformityPct: true, ageInDays: true },
        orderBy: { recordDate: 'asc' },
      }),
      prisma.mortalityRecord.findMany({
        where: { penSectionId: sectionId, recordDate: { gte: from } },
        select: { recordDate: true, count: true },
        orderBy: { recordDate: 'asc' },
      }),
      prisma.feedConsumption.findMany({
        where: { penSectionId: sectionId, recordedDate: { gte: from } },
        select: { recordedDate: true, quantityKg: true, gramsPerBird: true },
        orderBy: { recordedDate: 'asc' },
      }),
    ]);

    const wtIdx   = Object.fromEntries(weights.map(r   => [r.recordDate.toISOString().slice(0,10), r]));
    const mortIdx = Object.fromEntries(mortality.map(r  => [r.recordDate.toISOString().slice(0,10), r]));
    const feedIdx = Object.fromEntries(feed.map(r       => [r.recordedDate.toISOString().slice(0,10), r]));

    // Ross 308 standard growth curve (g) by age in days
    const ross308 = (age) => Math.round(42 * Math.pow(1.085, age / 7) * 10) / 10;

    const chart = dateRange.map(date => {
      const wt = wtIdx[date];
      return {
        date,
        label:      new Date(date).toLocaleDateString('en-NG', { day:'numeric', month:'short' }),
        avgWeightG: wt ? parseFloat(parseFloat(wt.avgWeightG).toFixed(0)) : null,
        minWeightG: wt ? parseFloat(parseFloat(wt.minWeightG).toFixed(0)) : null,
        maxWeightG: wt ? parseFloat(parseFloat(wt.maxWeightG).toFixed(0)) : null,
        targetWeightG: wt ? ross308(wt.ageInDays) : null,
        uniformityPct: wt?.uniformityPct ? parseFloat(parseFloat(wt.uniformityPct).toFixed(1)) : null,
        mortality:  mortIdx[date]?.count  || 0,
        feedKg:     feedIdx[date] ? parseFloat(parseFloat(feedIdx[date].quantityKg).toFixed(1)) : null,
        feedGpb:    feedIdx[date] ? parseFloat(parseFloat(feedIdx[date].gramsPerBird).toFixed(0)) : null,
      };
    });

    return NextResponse.json({ type: 'BROILER', sectionName: section.name, penName: section.pen.name, days, chart });
  }
}
