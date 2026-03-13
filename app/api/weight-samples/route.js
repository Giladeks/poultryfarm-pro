import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN',
  'CHAIRPERSON', 'SUPER_ADMIN',
];
const FARM_WIDE_ROLES = [
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

// ── GET /api/weight-samples ───────────────────────────────────────────────────
// Query params:
//   days=30        — lookback window (default 30)
//   flockId=...    — optional filter by flock
// Returns: { summary, samples }
export async function GET(request) {
  try {
    const user = await verifyToken(request);
    if (!user)                          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const days     = Math.min(parseInt(searchParams.get('days') || '30'), 365);
    const flockId  = searchParams.get('flockId') || null;
    const since    = new Date(Date.now() - days * 86_400_000);

    // ── Scope to assigned sections for PEN_WORKER / PEN_MANAGER ──────────────
    let sectionFilter = null;
    if (!FARM_WIDE_ROLES.includes(user.role)) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub },
        select: { penSectionId: true },
      });
      const ids = assignments.map(a => a.penSectionId);
      if (ids.length === 0) {
        return NextResponse.json({ summary: {}, samples: [] });
      }
      sectionFilter = ids;
    }

    // ── Build where clause ────────────────────────────────────────────────────
    const where = {
      tenantId:   user.tenantId,
      sampleDate: { gte: since },
      ...(flockId       && { flockId }),
      ...(sectionFilter && { penSectionId: { in: sectionFilter } }),
      // Only broiler sections
      penSection: {
        pen: { operationType: 'BROILER' },
        ...(user.farmId ? { pen: { farmId: user.farmId, operationType: 'BROILER' } } : {}),
      },
    };

    const samples = await prisma.weightSample.findMany({
      where,
      orderBy: { sampleDate: 'asc' },
      include: {
        flock: {
          select: { id: true, batchCode: true, currentCount: true },
        },
        penSection: {
          select: {
            id: true, name: true,
            pen: { select: { id: true, name: true } },
          },
        },
        recordedBy: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    // Attach age in days to each sample (relative to flock placement date)
    const enriched = samples.map(s => {
      const ageInDays = s.flock?.dateOfPlacement
        ? Math.floor((new Date(s.sampleDate) - new Date(s.flock.dateOfPlacement)) / 86_400_000)
        : null;
      return { ...s, ageInDays };
    });

    // ── Summary aggregates ────────────────────────────────────────────────────
    const summary = buildSummary(enriched, days);

    return NextResponse.json({ summary, samples: enriched });
  } catch (err) {
    console.error('GET /api/weight-samples error:', err);
    return NextResponse.json({ error: 'Failed to load weight samples' }, { status: 500 });
  }
}

// ── POST /api/weight-samples ──────────────────────────────────────────────────
// Body: { flockId, penSectionId, sampleDate, sampleCount, meanWeightG,
//         minWeightG?, maxWeightG?, uniformityPct? }
export async function POST(request) {
  try {
    const user = await verifyToken(request);
    if (!user)                          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const { flockId, penSectionId, sampleDate, sampleCount, meanWeightG,
            minWeightG, maxWeightG, uniformityPct } = body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!flockId)                      return NextResponse.json({ error: 'flockId is required' }, { status: 400 });
    if (!sampleDate)                   return NextResponse.json({ error: 'sampleDate is required' }, { status: 400 });
    if (!sampleCount || sampleCount < 1) return NextResponse.json({ error: 'sampleCount must be ≥ 1' }, { status: 400 });
    if (!meanWeightG || meanWeightG <= 0) return NextResponse.json({ error: 'meanWeightG must be > 0' }, { status: 400 });
    if (minWeightG && maxWeightG && minWeightG > maxWeightG)
      return NextResponse.json({ error: 'minWeightG cannot exceed maxWeightG' }, { status: 400 });
    if (uniformityPct != null && (uniformityPct < 0 || uniformityPct > 100))
      return NextResponse.json({ error: 'uniformityPct must be 0–100' }, { status: 400 });

    // ── Verify flock belongs to this tenant ───────────────────────────────────
    const flock = await prisma.flock.findFirst({
      where:  { id: flockId, tenantId: user.tenantId },
      select: { id: true, dateOfPlacement: true, currentCount: true },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    // ── Scope check for workers ───────────────────────────────────────────────
    if (!FARM_WIDE_ROLES.includes(user.role) && penSectionId) {
      const assignment = await prisma.penWorkerAssignment.findFirst({
        where: { userId: user.sub, penSectionId },
      });
      if (!assignment) return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
    }

    // ── Estimate FCR if we have enough data ───────────────────────────────────
    // FCR = total feed consumed / total weight gained
    // We approximate using the previous sample for this flock
    let estimatedFCR = null;
    if (penSectionId) {
      const prevSample = await prisma.weightSample.findFirst({
        where:   { flockId, penSectionId, tenantId: user.tenantId, sampleDate: { lt: new Date(sampleDate) } },
        orderBy: { sampleDate: 'desc' },
        select:  { meanWeightG: true, sampleDate: true },
      });
      if (prevSample && prevSample.meanWeightG) {
        const weightGainPerBird = meanWeightG - prevSample.meanWeightG;
        const daysBetween = Math.max(1,
          Math.floor((new Date(sampleDate) - new Date(prevSample.sampleDate)) / 86_400_000)
        );
        // Pull feed consumed in that window
        const feedRecords = await prisma.feedConsumption.aggregate({
          where: {
            tenantId:    user.tenantId,
            penSectionId,
            consumptionDate: {
              gte: prevSample.sampleDate,
              lte: new Date(sampleDate),
            },
          },
          _sum: { quantityKg: true },
        });
        const totalFeedKg = feedRecords._sum.quantityKg || 0;
        if (totalFeedKg > 0 && weightGainPerBird > 0 && flock.currentCount > 0) {
          const totalWeightGainKg = (weightGainPerBird / 1000) * flock.currentCount;
          estimatedFCR = parseFloat((totalFeedKg / totalWeightGainKg).toFixed(2));
        }
      }
    }

    const sample = await prisma.weightSample.create({
      data: {
        tenantId:      user.tenantId,
        flockId,
        penSectionId:  penSectionId || null,
        sampleDate:    new Date(sampleDate),
        sampleCount,
        meanWeightG,
        minWeightG:    minWeightG    || null,
        maxWeightG:    maxWeightG    || null,
        uniformityPct: uniformityPct || null,
        estimatedFCR:  estimatedFCR,
        recordedById:  user.sub,
      },
      include: {
        flock:      { select: { batchCode: true } },
        penSection: { select: { name: true, pen: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return NextResponse.json(sample, { status: 201 });
  } catch (err) {
    console.error('POST /api/weight-samples error:', err);
    return NextResponse.json({ error: 'Failed to save weight sample' }, { status: 500 });
  }
}

// ── Summary builder ───────────────────────────────────────────────────────────
function buildSummary(samples, days) {
  if (!samples.length) return {};

  const sorted  = [...samples].sort((a, b) => new Date(a.sampleDate) - new Date(b.sampleDate));
  const latest  = sorted[sorted.length - 1];
  const cutoff7 = new Date(Date.now() - 7 * 86_400_000);
  const prev7   = [...sorted].reverse().find(s => new Date(s.sampleDate) < cutoff7);

  const weightGain7d = (latest && prev7 && latest.meanWeightG && prev7.meanWeightG)
    ? Math.round(latest.meanWeightG - prev7.meanWeightG)
    : null;

  // Average FCR across all samples that have it
  const fcrSamples = samples.filter(s => s.estimatedFCR);
  const estimatedFCR = fcrSamples.length
    ? parseFloat((fcrSamples.reduce((a, s) => a + s.estimatedFCR, 0) / fcrSamples.length).toFixed(2))
    : null;

  return {
    latestMeanWeightG:    latest?.meanWeightG    || null,
    latestSampleCount:    latest?.sampleCount    || null,
    latestUniformityPct:  latest?.uniformityPct  || null,
    latestSampleDate:     latest?.sampleDate     || null,
    weightGain7d,
    estimatedFCR,
    totalSamples: samples.length,
  };
}
