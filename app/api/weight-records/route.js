// app/api/weight-records/route.js
// GET  — returns WeightRecord rows for the broiler performance page.
//        Field names are aliased to match what the page expects:
//          recordDate    → sampleDate
//          avgWeightG    → meanWeightG
//          sampleSize    → sampleCount
// POST — creates a new WeightRecord (workers / PMs logging a weigh-in).

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

const ALLOWED_ROLES   = ['PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const FARM_WIDE_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// ── GET /api/weight-records ────────────────────────────────────────────────────
export async function GET(request) {
  try {
    const user = await verifyToken(request);
    if (!user)                              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },    { status: 403 });

    const { searchParams } = new URL(request.url);
    const days    = Math.min(parseInt(searchParams.get('days') || '30'), 365);
    const flockId = searchParams.get('flockId') || null;
    const since   = new Date(Date.now() - days * 86_400_000);

    // Scope to assigned sections for non-farm-wide roles
    let sectionFilter = null;
    if (!FARM_WIDE_ROLES.includes(user.role)) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub },
        select: { penSectionId: true },
      });
      const ids = assignments.map(a => a.penSectionId);
      if (ids.length === 0) return NextResponse.json({ summary: {}, samples: [] });
      sectionFilter = ids;
    }

    const where = {
      recordDate:  { gte: since },
      penSection:  {
        pen: {
          operationType: 'BROILER',
          farm: { tenantId: user.tenantId },
          ...(user.farmId ? { farmId: user.farmId } : {}),
        },
      },
      ...(flockId       && { flockId }),
      ...(sectionFilter && { penSectionId: { in: sectionFilter } }),
    };

    const records = await prisma.weightRecord.findMany({
      where,
      orderBy: { recordDate: 'asc' },
      include: {
        flock:      { select: { id: true, batchCode: true, currentCount: true, dateOfPlacement: true } },
        penSection: { select: { id: true, name: true, pen: { select: { id: true, name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
    });

    // Alias fields to match what the broiler performance page expects
    const samples = records.map(r => {
      const ageInDays = r.ageInDays ??
        (r.flock?.dateOfPlacement
          ? Math.floor((new Date(r.recordDate) - new Date(r.flock.dateOfPlacement)) / 86_400_000)
          : null);
      return {
        id:            r.id,
        // Aliased names expected by page
        sampleDate:    r.recordDate,
        meanWeightG:   Number(r.avgWeightG),
        sampleCount:   r.sampleSize,
        minWeightG:    r.minWeightG ? Number(r.minWeightG) : null,
        maxWeightG:    r.maxWeightG ? Number(r.maxWeightG) : null,
        uniformityPct: r.uniformityPct ? Number(r.uniformityPct) : null,
        estimatedFCR:  null,   // WeightRecord has no FCR — dashboard metric uses a separate calc
        ageInDays,
        notes:         r.notes || null,
        // Relations
        flock:      r.flock,
        penSection: {
          id:   r.penSection.id,
          name: r.penSection.name,
          pen:  { name: r.penSection.pen.name },
        },
        recordedBy: r.recordedBy,
      };
    });

    // Summary aggregates
    const summary = buildSummary(samples, days);

    return NextResponse.json({ summary, samples });
  } catch (err) {
    console.error('GET /api/weight-records error:', err);
    return NextResponse.json({ error: 'Failed to load weight records' }, { status: 500 });
  }
}

// ── POST /api/weight-records ───────────────────────────────────────────────────
export async function POST(request) {
  try {
    const user = await verifyToken(request);
    if (!user)                              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },    { status: 403 });

    const body = await request.json();
    const { flockId, penSectionId, sampleDate, sampleCount, meanWeightG,
            minWeightG, maxWeightG, uniformityPct, notes } = body;

    if (!flockId)                        return NextResponse.json({ error: 'flockId required' },               { status: 400 });
    if (!sampleDate)                     return NextResponse.json({ error: 'sampleDate required' },            { status: 400 });
    if (!sampleCount || sampleCount < 1) return NextResponse.json({ error: 'sampleCount must be ≥ 1' },        { status: 400 });
    if (!meanWeightG || meanWeightG <= 0) return NextResponse.json({ error: 'meanWeightG must be > 0' },       { status: 400 });

    // Verify flock belongs to tenant
    const flock = await prisma.flock.findFirst({
      where:  { id: flockId, tenantId: user.tenantId },
      select: { id: true, dateOfPlacement: true },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    // Scope check for workers
    if (!FARM_WIDE_ROLES.includes(user.role) && penSectionId) {
      const assignment = await prisma.penWorkerAssignment.findFirst({
        where: { userId: user.sub, penSectionId },
      });
      if (!assignment) return NextResponse.json({ error: 'Not assigned to this section' }, { status: 403 });
    }

    const ageInDays = flock.dateOfPlacement
      ? Math.floor((new Date(sampleDate) - new Date(flock.dateOfPlacement)) / 86_400_000)
      : 0;

    const record = await prisma.weightRecord.create({
      data: {
        flockId,
        penSectionId:  penSectionId || null,
        recordDate:    new Date(sampleDate),
        ageInDays,
        sampleSize:    sampleCount,
        avgWeightG:    meanWeightG,
        minWeightG:    minWeightG  || null,
        maxWeightG:    maxWeightG  || null,
        uniformityPct: uniformityPct || null,
        notes:         notes || null,
        recordedById:  user.sub,
      },
      include: {
        flock:      { select: { batchCode: true } },
        penSection: { select: { name: true, pen: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
    });

    // Return aliased shape
    return NextResponse.json({
      ...record,
      sampleDate:  record.recordDate,
      meanWeightG: Number(record.avgWeightG),
      sampleCount: record.sampleSize,
    }, { status: 201 });
  } catch (err) {
    console.error('POST /api/weight-records error:', err);
    return NextResponse.json({ error: 'Failed to save weight record' }, { status: 500 });
  }
}

// ── Summary builder ────────────────────────────────────────────────────────────
function buildSummary(samples, days) {
  if (!samples.length) return {};
  const sorted  = [...samples].sort((a, b) => new Date(a.sampleDate) - new Date(b.sampleDate));
  const latest  = sorted[sorted.length - 1];
  const cutoff7 = new Date(Date.now() - 7 * 86_400_000);
  const prev7   = [...sorted].reverse().find(s => new Date(s.sampleDate) < cutoff7);
  const weightGain7d = (latest && prev7)
    ? Math.round(latest.meanWeightG - prev7.meanWeightG) : null;
  return {
    latestMeanWeightG:   latest?.meanWeightG   || null,
    latestSampleCount:   latest?.sampleCount   || null,
    latestUniformityPct: latest?.uniformityPct || null,
    latestSampleDate:    latest?.sampleDate    || null,
    weightGain7d,
    estimatedFCR:        null,   // not available from WeightRecord
    totalSamples:        samples.length,
  };
}
