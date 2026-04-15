// app/api/eggs/route.js — Egg production recording and analytics (layers only)
// Phase 8B: worker enters cratesCollected/looseEggs/crackedCount/collectionSession
//           PM later enters gradeBCrates/gradeBLoose/crackedConfirmed → computes gradeA/B/Pct
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { autoSubmitSummary } from '@/lib/utils/autoSubmitSummary';

// Worker POST schema — what the worker enters in the field
const createEggSchema = z.object({
  flockId:           z.string().min(1),
  penSectionId:      z.string().min(1),
  collectionDate:    z.string(),
  collectionSession: z.number().int().min(1).max(2),  // 1 = morning, 2 = afternoon
  cratesCollected:   z.number().int().min(0),
  looseEggs:         z.number().int().min(0).max(29),  // sub-crate remainder (0-29)
  crackedCount:      z.number().int().min(0),
}).refine(d => d.looseEggs < 30, {
  message: 'looseEggs must be 0-29 (full crates go into cratesCollected)',
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId      = searchParams.get('flockId');
  const days         = parseInt(searchParams.get('days') || '30');
  const endDate      = searchParams.get('endDate'); // 'yesterday' for yesterday-only view
  const rejectedOnly = searchParams.get('rejected') === 'true';
  const pendingOnly  = searchParams.get('pending') === 'true';
  const _s   = new Date();
  const _off = endDate === 'yesterday' ? 1 : 0;
  const since  = new Date(Date.UTC(_s.getFullYear(), _s.getMonth(), _s.getDate() - days - _off + 1));
  const before = endDate === 'yesterday'
    ? new Date(Date.UTC(_s.getFullYear(), _s.getMonth(), _s.getDate()))
    : null;

  // Workers only see their own sections
  let allowedSectionIds = null;
  if (user.role === 'PEN_WORKER') {
    const assignments = await prisma.penWorkerAssignment.findMany({
      where:  { userId: user.sub, isActive: true },
      select: { penSectionId: true },
    });
    allowedSectionIds = assignments.map(a => a.penSectionId);
    if (allowedSectionIds.length === 0) {
      return NextResponse.json({
        records: [],
        summary: {
          totalEggs: 0, avgLayingRate: 0, totalGradeA: 0, totalGradeB: 0,
          totalCracked: 0, totalCrates: 0, avgDailyEggs: 0, pendingGradingCount: 0,
        },
      });
    }
  }

  try {
    const records = await prisma.eggProduction.findMany({
      where: {
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        collectionDate: { gte: since, ...(before ? { lt: before } : {}) },
        ...(flockId           && { flockId }),
        ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
        ...(rejectedOnly      && { rejectionReason: { not: null } }),
        ...(pendingOnly       && { gradeACount: null, submissionStatus: 'PENDING' }),
      },
      include: {
        flock:      { select: { batchCode: true, breed: true, operationType: true, currentCount: true } },
        penSection: { include: { pen: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ collectionDate: 'desc' }, { collectionSession: 'asc' }],
    });

    const totalEggs = records.reduce((s, r) => s + (r.totalEggs || 0), 0);
    // Compute avgLayingRate from totalEggs / daysWithData / totalBirds
    // Denominator = ALL active PRODUCTION flocks in scope (not just those with egg records)
    // This correctly dilutes the rate when sections haven't logged — making low rates
    // a visible signal for the PM to investigate missing collections
    const uniqueDays = new Set(
      records.map(r => new Date(r.collectionDate).toISOString().split('T')[0])
    ).size || 1;

    // Fetch all active PRODUCTION layer flocks in the same sections scope
    const productionFlocks = await prisma.flock.findMany({
      where: {
        tenantId:      user.tenantId,
        status:        'ACTIVE',
        stage:         'PRODUCTION',
        operationType: 'LAYER',
        ...(allowedSectionIds ? { penSectionId: { in: allowedSectionIds } } : {}),
        ...(flockId ? { id: flockId } : {}),
      },
      select: { currentCount: true },
    });
    const totalBirds = productionFlocks.reduce((s, f) => s + (f.currentCount || 0), 0);
    const avgLayingRate = totalBirds > 0
      ? parseFloat(((totalEggs / uniqueDays / totalBirds) * 100).toFixed(2))
      : 0;

    const approvedRecords = records.filter(r => r.gradeACount !== null);

    return NextResponse.json({
      records,
      summary: {
        totalEggs,
        avgLayingRate,
        totalGradeA:         approvedRecords.reduce((s, r) => s + (r.gradeACount  || 0), 0),
        totalGradeB:         approvedRecords.reduce((s, r) => s + (r.gradeBCount  || 0), 0),
        totalCracked:        records.reduce((s, r) => s + (r.crackedCount    || 0), 0),
        totalCrates:         records.reduce((s, r) => s + (r.cratesCollected || 0), 0),
        avgDailyEggs:        days > 0 ? Math.round(totalEggs / days) : 0,
        pendingGradingCount: records.filter(r => r.gradeACount === null).length,
      },
    });
  } catch (error) {
    console.error('Egg fetch error:', error?.message || error);
    return NextResponse.json({ error: 'Failed to fetch egg production', detail: error?.message }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const data = createEggSchema.parse(body);

    const flock = await prisma.flock.findFirst({
      where: {
        id: data.flockId,
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        status: 'ACTIVE',
      },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });
    if (flock.operationType !== 'LAYER')
      return NextResponse.json({ error: 'Egg production can only be recorded for layer flocks' }, { status: 422 });

    const existing = await prisma.eggProduction.findFirst({
      where: {
        flockId:           data.flockId,
        collectionDate:    new Date(data.collectionDate),
        collectionSession: data.collectionSession,
      },
    });
    if (existing)
      return NextResponse.json({
        error: `Session ${data.collectionSession === 1 ? 'morning' : 'afternoon'} already recorded for this flock today`,
      }, { status: 409 });

    // totalEggs = (cratesCollected x 30) + looseEggs + crackedCount
    const totalEggs = (data.cratesCollected * 30) + data.looseEggs + data.crackedCount;
    const layingRatePct = flock.currentCount > 0
      ? parseFloat(((totalEggs / flock.currentCount) * 100).toFixed(2))
      : 0;

    const record = await prisma.eggProduction.create({
      data: {
        flockId:            data.flockId,
        penSectionId:       data.penSectionId,
        collectionDate:     new Date(data.collectionDate),
        collectionSession:  data.collectionSession,
        cratesCollected:    data.cratesCollected,
        looseEggs:          data.looseEggs,
        crackedCount:       data.crackedCount,
        totalEggs,
        layingRatePct,
        birdsAtCollection:  flock.currentCount,   // ← snapshot at submission time
        recordedById:       user.sub,
        submissionStatus:   'PENDING',
      },
    });

    // Fire-and-forget: check if past autoSummaryTime and submit today's summary
    prisma.penSection.findUnique({
      where:   { id: data.penSectionId },
      include: { pen: { include: { farm: { select: { id: true, autoSummaryTime: true } } } } },
    }).then(sec => {
      if (sec)
        autoSubmitSummary(user.tenantId, data.penSectionId, sec.pen.farmId, sec.pen.farm.autoSummaryTime)
          .catch(() => {});
    }).catch(() => {});

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Egg create error:', error);
    return NextResponse.json({ error: 'Failed to record egg production' }, { status: 500 });
  }
}