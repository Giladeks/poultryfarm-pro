// app/api/eggs/route.js — Egg production recording and analytics (layers only)
// Phase 8B: worker enters cratesCollected/looseEggs/crackedCount/collectionSession
//           PM later enters gradeBCrates/gradeBLoose/crackedConfirmed → computes gradeA/B/Pct
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { aggregateProduction } from '@/lib/services/analytics';

// Worker POST schema — what the worker enters in the field
const createEggSchema = z.object({
  flockId:           z.string().min(1),
  penSectionId:      z.string().min(1),
  collectionDate:    z.string(),
  collectionSession: z.number().int().min(1).max(2),           // 1 = morning, 2 = afternoon
  cratesCollected:   z.number().int().min(0),
  looseEggs:         z.number().int().min(0).max(29),           // sub-crate remainder
  crackedCount:      z.number().int().min(0),
}).refine(d => d.looseEggs < 30, {
  message: 'looseEggs must be 0–29 (full crates go into cratesCollected)',
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId      = searchParams.get('flockId');
  const days         = parseInt(searchParams.get('days') || '30');
  const groupBy      = searchParams.get('groupBy') || 'day';
  const rejectedOnly = searchParams.get('rejected') === 'true';
  const pendingOnly  = searchParams.get('pending') === 'true';    // new: PM grading queue
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Workers only see their own sections
  const WORKER_ROLES = ['PEN_WORKER'];
  let allowedSectionIds = null;
  if (WORKER_ROLES.includes(user.role)) {
    const assignments = await prisma.penWorkerAssignment.findMany({
      where: { userId: user.sub },
      select: { penSectionId: true },
    });
    allowedSectionIds = assignments.map(a => a.penSectionId);
  }

  try {
    const records = await prisma.eggProduction.findMany({
      where: {
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
        collectionDate: { gte: since },
        ...(flockId && { flockId }),
        ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
        ...(rejectedOnly && { rejectionReason: { not: null } }),
        // pendingOnly: records where PM hasn't graded yet (gradeACount is null)
        ...(pendingOnly && { gradeACount: null, submissionStatus: 'PENDING' }),
      },
      include: {
        flock: { select: { batchCode: true, breed: true, operationType: true } },
        penSection: { include: { pen: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ collectionDate: 'desc' }, { collectionSession: 'asc' }],
    });

    const aggregated = aggregateProduction(records, groupBy);
    const totalEggs  = records.reduce((s, r) => s + r.totalEggs, 0);
    const avgLayingRate = records.length > 0
      ? parseFloat((records.reduce((s, r) => s + Number(r.layingRatePct), 0) / records.length).toFixed(2))
      : 0;

    // Grade A/B totals are only meaningful for approved records
    const approvedRecords = records.filter(r => r.gradeACount !== null);

    return NextResponse.json({
      records,
      aggregated,
      summary: {
        totalEggs,
        avgLayingRate,
        totalGradeA:  approvedRecords.reduce((s, r) => s + (r.gradeACount  || 0), 0),
        totalGradeB:  approvedRecords.reduce((s, r) => s + (r.gradeBCount  || 0), 0),
        totalCracked: records.reduce((s, r) => s + (r.crackedCount || 0), 0),
        totalCrates:  records.reduce((s, r) => s + (r.cratesCollected || 0), 0),
        avgDailyEggs: Math.round(totalEggs / days),
        pendingGradingCount: records.filter(r => r.gradeACount === null).length,
      },
    });
  } catch (error) {
    console.error('Egg fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch egg production' }, { status: 500 });
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

    // Check duplicate: same flock + date + session
    const existing = await prisma.eggProduction.findFirst({
      where: {
        flockId: data.flockId,
        collectionDate: new Date(data.collectionDate),
        collectionSession: data.collectionSession,
      },
    });
    if (existing)
      return NextResponse.json({
        error: `Session ${data.collectionSession === 1 ? 'morning' : 'afternoon'} already recorded for this flock today`,
      }, { status: 409 });

    // Calculate total from crate inputs
    // totalEggs = (cratesCollected × 30) + looseEggs + crackedCount
    const totalEggs = (data.cratesCollected * 30) + data.looseEggs + data.crackedCount;
    const layingRatePct = flock.currentCount > 0
      ? parseFloat(((totalEggs / flock.currentCount) * 100).toFixed(2))
      : 0;

    const record = await prisma.eggProduction.create({
      data: {
        flockId:           data.flockId,
        penSectionId:      data.penSectionId,
        collectionDate:    new Date(data.collectionDate),
        collectionSession: data.collectionSession,
        cratesCollected:   data.cratesCollected,
        looseEggs:         data.looseEggs,
        crackedCount:      data.crackedCount,
        totalEggs,
        layingRatePct,
        // PM grading fields left null — set later via PATCH /api/eggs/[id]/grade
        recordedById:     user.sub,
        submissionStatus: 'PENDING',
      },
    });

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Egg create error:', error);
    return NextResponse.json({ error: 'Failed to record egg production' }, { status: 500 });
  }
}
