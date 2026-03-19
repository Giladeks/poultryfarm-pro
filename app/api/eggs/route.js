// app/api/eggs/route.js — Egg production recording and analytics (layers only)
// Phase 8B: worker enters cratesCollected/looseEggs/crackedCount/collectionSession
//           PM later enters gradeBCrates/gradeBLoose/crackedConfirmed → computes gradeA/B/Pct
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

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
  const rejectedOnly = searchParams.get('rejected') === 'true';
  const pendingOnly  = searchParams.get('pending') === 'true';    // new: PM grading queue
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);  // normalize to midnight for @db.Date column comparison

  // Workers only see their own sections
  const WORKER_ROLES = ['PEN_WORKER'];
  let allowedSectionIds = null;
  if (WORKER_ROLES.includes(user.role)) {
    const assignments = await prisma.penWorkerAssignment.findMany({
      where: { userId: user.sub },
      select: { penSectionId: true },
    });
    allowedSectionIds = assignments.map(a => a.penSectionId);
    // If no assignments found, return empty — don't fall through to all-records query
    if (allowedSectionIds.length === 0) {
      return NextResponse.json({ records: [], summary: { totalEggs:0, avgLayingRate:0, totalGradeA:0, totalGradeB:0, totalCracked:0, totalCrates:0, avgDailyEggs:0, pendingGradingCount:0 } });
    }
  }

  try {
    const records = await prisma.eggProduction.findMany({
      where: {
        // Scope to tenant via EggProduction's own penSection relation (3-hop, always valid)
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        collectionDate: { gte: since },
        ...(flockId            && { flockId }),
        ...(allowedSectionIds  && { penSectionId: { in: allowedSectionIds } }),
        ...(rejectedOnly       && { rejectionReason: { not: null } }),
        ...(pendingOnly        && { gradeACount: null, submissionStatus: 'PENDING' }),
      },
      include: {
        flock: { select: { batchCode: true, breed: true, operationType: true } },
        penSection: { include: { pen: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ collectionDate: 'desc' }, { collectionSession: 'asc' }],
    });

    const totalEggs = records.reduce((s, r) => s + (r.totalEggs || 0), 0);
    const avgLayingRate = records.length > 0
      ? parseFloat((records.reduce((s, r) => s + Number(r.layingRatePct || 0), 0) / records.length).toFixed(2))
      : 0;

    // Grade totals only meaningful for approved (PM-graded) records
    const approvedRecords = records.filter(r => r.gradeACount !== null);

    return NextResponse.json({
      records,
      summary: {
        totalEggs,
        avgLayingRate,
        totalGradeA:  approvedRecords.reduce((s, r) => s + (r.gradeACount  || 0), 0),
        totalGradeB:  approvedRecords.reduce((s, r) => s + (r.gradeBCount  || 0), 0),
        totalCracked: records.reduce((s, r) => s + (r.crackedCount || 0), 0),
        totalCrates:  records.reduce((s, r) => s + (r.cratesCollected || 0), 0),
        avgDailyEggs: days > 0 ? Math.round(totalEggs / days) : 0,
        pendingGradingCount: records.filter(r => r.gradeACount === null).length,
      },
    });
  } catch (error) {
    console.error('Egg fetch error:', error?.message || error);
    // Return the actual error message in development so we can see it client-side
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
