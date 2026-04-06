// app/api/weight-samples/route.js
// GET  — weight sample history for performance pages (all flock types)
// POST — log a new weigh-in (workers and PMs)
//
// Fix: removed consumptionDate reference (wrong field — caused 500 on POST).
//      FCR estimation removed from POST — it's computed by the dashboard API.
//      Scope check now requires isActive: true on worker assignment.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES   = ['PEN_WORKER','PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const FARM_WIDE_ROLES = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

// ── GET /api/weight-samples ───────────────────────────────────────────────────
export async function GET(request) {
  try {
    const user = await verifyToken(request);
    if (!user)                              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },    { status: 403 });

    const { searchParams } = new URL(request.url);
    const days        = Math.min(parseInt(searchParams.get('days') || '90'), 365);
    const flockId     = searchParams.get('flockId')     || null;
    const penSectionId = searchParams.get('penSectionId') || null;
    const since       = new Date(Date.now() - days * 86_400_000);

    let sectionFilter = null;
    if (!FARM_WIDE_ROLES.includes(user.role)) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub, isActive: true },
        select: { penSectionId: true },
      });
      sectionFilter = assignments.map(a => a.penSectionId);
      if (sectionFilter.length === 0) return NextResponse.json({ summary: {}, samples: [] });
    }

    const samples = await prisma.weight_samples.findMany({
      where: {
        tenantId:   user.tenantId,
        sampleDate: { gte: since },
        ...(flockId      && { flockId }),
        ...(penSectionId && { penSectionId }),
        ...(sectionFilter && { penSectionId: { in: sectionFilter } }),
      },
      orderBy: { sampleDate: 'asc' },
    });

    // Manually enrich with flock + section data
    const flockIds   = [...new Set(samples.map(s => s.flockId).filter(Boolean))];
    const sectionIds = [...new Set(samples.map(s => s.penSectionId).filter(Boolean))];
    const userIds    = [...new Set(samples.map(s => s.recordedById).filter(Boolean))];

    const [flocks, sections, users] = await Promise.all([
      flockIds.length   ? prisma.flock.findMany({ where: { id: { in: flockIds } },
          select: { id: true, batchCode: true, currentCount: true, dateOfPlacement: true } }) : [],
      sectionIds.length ? prisma.penSection.findMany({ where: { id: { in: sectionIds } },
          select: { id: true, name: true, pen: { select: { id: true, name: true } } } }) : [],
      userIds.length    ? prisma.user.findMany({ where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true } }) : [],
    ]);

    const flockMap   = Object.fromEntries(flocks.map(f => [f.id, f]));
    const sectionMap = Object.fromEntries(sections.map(s => [s.id, s]));
    const userMap    = Object.fromEntries(users.map(u => [u.id, u]));

    const enriched = samples.map(s => {
      const flock     = flockMap[s.flockId]     || null;
      const section   = sectionMap[s.penSectionId] || null;
      const recorder  = userMap[s.recordedById]  || null;
      return {
        ...s,
        meanWeightG:   Number(s.meanWeightG),
        minWeightG:    s.minWeightG    ? Number(s.minWeightG)    : null,
        maxWeightG:    s.maxWeightG    ? Number(s.maxWeightG)    : null,
        uniformityPct: s.uniformityPct ? Number(s.uniformityPct) : null,
        estimatedFCR:  s.estimatedFCR  ? Number(s.estimatedFCR)  : null,
        ageInDays: flock?.dateOfPlacement
          ? Math.floor((new Date(s.sampleDate) - new Date(flock.dateOfPlacement)) / 86_400_000)
          : null,
        flock,
        penSection: section,
        recordedBy: recorder,
      };
    });

    const summary = buildSummary(enriched);

    return NextResponse.json({ summary, samples: enriched });
  } catch (err) {
    console.error('GET /api/weight-samples error:', err);
    return NextResponse.json({ error: 'Failed to load weight samples', detail: err?.message }, { status: 500 });
  }
}

// ── POST /api/weight-samples ──────────────────────────────────────────────────
export async function POST(request) {
  try {
    const user = await verifyToken(request);
    if (!user)                              return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },    { status: 403 });

    const body = await request.json();
    const { flockId, penSectionId, sampleDate, sampleCount, meanWeightG,
            minWeightG, maxWeightG, uniformityPct, notes } = body;

    // Validation
    if (!flockId)                         return NextResponse.json({ error: 'flockId is required' },           { status: 400 });
    if (!sampleDate)                      return NextResponse.json({ error: 'sampleDate is required' },        { status: 400 });
    if (!sampleCount || sampleCount < 1)  return NextResponse.json({ error: 'sampleCount must be ≥ 1' },       { status: 400 });
    if (!meanWeightG || meanWeightG <= 0) return NextResponse.json({ error: 'meanWeightG must be > 0' },       { status: 400 });
    if (minWeightG && maxWeightG && minWeightG > maxWeightG)
      return NextResponse.json({ error: 'minWeightG cannot exceed maxWeightG' }, { status: 400 });

    // Verify flock belongs to tenant
    const flock = await prisma.flock.findFirst({
      where:  { id: flockId, tenantId: user.tenantId },
      select: { id: true, dateOfPlacement: true, currentCount: true },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    // Scope check for workers — must be actively assigned to this section
    if (!FARM_WIDE_ROLES.includes(user.role) && penSectionId) {
      const assignment = await prisma.penWorkerAssignment.findFirst({
        where: { userId: user.sub, penSectionId, isActive: true },
      });
      if (!assignment)
        return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
    }

    const ageInDays = flock.dateOfPlacement
      ? Math.floor((new Date(sampleDate) - new Date(flock.dateOfPlacement)) / 86_400_000)
      : null;

    // Write to weight_samples (primary — used by rearing/broiler performance pages)
    // AND weight_records (used by dashboard, charts API, performance page metrics)
    const [sample] = await Promise.all([
      prisma.weight_samples.create({
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
          recordedById:  user.sub,
        },
      }),
      // Mirror to weight_records so dashboard/charts pick it up immediately
      penSectionId ? prisma.weightRecord.create({
        data: {
          flockId,
          penSectionId,
          recordDate:    new Date(sampleDate),
          ageInDays:     ageInDays || 0,
          sampleSize:    sampleCount,
          avgWeightG:    meanWeightG,
          minWeightG:    minWeightG    || null,
          maxWeightG:    maxWeightG    || null,
          uniformityPct: uniformityPct || null,
          recordedById:  user.sub,
        },
      }).catch(e => {
        // Ignore duplicate key errors — weight_records has no unique constraint
        // but log other errors
        if (!e?.message?.includes('Unique constraint')) {
          console.error('[weight-samples] mirror to weight_records failed:', e?.message);
        }
      }) : Promise.resolve(),
    ]);

    return NextResponse.json({ sample }, { status: 201 });

  } catch (err) {
    console.error('POST /api/weight-samples error:', err);
    return NextResponse.json({ error: 'Failed to save weight sample', detail: err?.message }, { status: 500 });
  }
}

// ── Summary builder ────────────────────────────────────────────────────────────
function buildSummary(samples) {
  if (!samples.length) return {};
  const sorted   = [...samples].sort((a, b) => new Date(a.sampleDate) - new Date(b.sampleDate));
  const latest   = sorted[sorted.length - 1];
  const cutoff7  = new Date(Date.now() - 7 * 86_400_000);
  const prev7    = [...sorted].reverse().find(s => new Date(s.sampleDate) < cutoff7);
  const weightGain7d = (latest && prev7)
    ? Math.round(latest.meanWeightG - prev7.meanWeightG) : null;
  return {
    latestMeanWeightG:   latest?.meanWeightG   || null,
    latestSampleCount:   latest?.sampleCount   || null,
    latestUniformityPct: latest?.uniformityPct || null,
    latestSampleDate:    latest?.sampleDate    || null,
    weightGain7d,
    totalSamples:        samples.length,
  };
}
