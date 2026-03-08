// app/api/eggs/route.js — Egg production recording and analytics (layers only)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { aggregateProduction } from '@/lib/services/analytics';

const createEggSchema = z.object({
  flockId: z.string().min(1),
  penSectionId: z.string().min(1),
  collectionDate: z.string(),
  totalEggs: z.number().int().min(0),
  gradeACount: z.number().int().min(0).default(0),
  gradeBCount: z.number().int().min(0).default(0),
  crackedCount: z.number().int().min(0).default(0),
  dirtyCount: z.number().int().min(0).default(0),
}).refine(d => d.gradeACount + d.gradeBCount + d.crackedCount + d.dirtyCount <= d.totalEggs, {
  message: 'Grade counts cannot exceed total eggs',
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId      = searchParams.get('flockId');
  const days         = parseInt(searchParams.get('days') || '30');
  const groupBy      = searchParams.get('groupBy') || 'day';
  const rejectedOnly = searchParams.get('rejected') === 'true';
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Workers only see their own sections' records
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
      },
      include: {
        flock: { select: { batchCode: true, breed: true, operationType: true } },
        penSection: { include: { pen: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { collectionDate: 'asc' },
    });

    const aggregated = aggregateProduction(records, groupBy);
    const totalEggs = records.reduce((s, r) => s + r.totalEggs, 0);
    const avgLayingRate = records.length > 0
      ? parseFloat((records.reduce((s, r) => s + Number(r.layingRatePct), 0) / records.length).toFixed(2))
      : 0;

    return NextResponse.json({
      records,
      aggregated,
      summary: {
        totalEggs,
        avgLayingRate,
        totalGradeA: records.reduce((s, r) => s + r.gradeACount, 0),
        totalGradeB: records.reduce((s, r) => s + r.gradeBCount, 0),
        totalCracked: records.reduce((s, r) => s + r.crackedCount, 0),
        totalDirty: records.reduce((s, r) => s + r.dirtyCount, 0),
        totalCrates: records.reduce((s, r) => s + (r.cratesCount || 0), 0),
        avgDailyEggs: Math.round(totalEggs / days),
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

    const layingRatePct = flock.currentCount > 0
      ? parseFloat(((data.totalEggs / flock.currentCount) * 100).toFixed(2))
      : 0;

    const cratesCount = Math.floor(data.totalEggs / 30);

    const record = await prisma.eggProduction.create({
      data: {
        ...data,
        collectionDate: new Date(data.collectionDate),
        layingRatePct,
        cratesCount,
        recordedById: user.sub,
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