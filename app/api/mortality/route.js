// app/api/mortality/route.js — Record and retrieve mortality events
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const createMortalitySchema = z.object({
  flockId: z.string().uuid(),
  penSectionId: z.string().uuid(),
  recordDate: z.string(),
  count: z.number().int().min(0).max(10000),
  causeCode: z.enum([
    'DISEASE','INJURY','CULLED','UNKNOWN',
    'HEAT_STRESS','FEED_ISSUE','PREDATOR','WATER_ISSUE','RESPIRATORY',
  ]).default('UNKNOWN'),
  notes: z.string().max(1000).optional(),
  photoUrl: z.string().url().optional(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId = searchParams.get('flockId');
  const days = parseInt(searchParams.get('days') || '30');
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const records = await prisma.mortalityRecord.findMany({
      where: {
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
        recordDate: { gte: since },
        ...(flockId && { flockId }),
      },
      include: {
        flock: { select: { batchCode: true, operationType: true } },
        penSection: { include: { pen: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { recordDate: 'desc' },
    });

    const dailyTotals = records.reduce((acc, r) => {
      const day = r.recordDate.toISOString().split('T')[0];
      acc[day] = (acc[day] || 0) + r.count;
      return acc;
    }, {});

    const totalDeaths = records.reduce((s, r) => s + r.count, 0);
    const causeBreakdown = records.reduce((acc, r) => {
      acc[r.causeCode] = (acc[r.causeCode] || 0) + r.count;
      return acc;
    }, {});

    return NextResponse.json({
      records,
      summary: {
        totalDeaths,
        dailyTotals,
        causeBreakdown,
        avgDaily: parseFloat((totalDeaths / days).toFixed(1)),
      },
    });
  } catch (error) {
    console.error('Mortality fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch mortality records' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const data = createMortalitySchema.parse(body);

    const flock = await prisma.flock.findFirst({
      where: {
        id: data.flockId,
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        status: 'ACTIVE',
      },
    });
    if (!flock) return NextResponse.json({ error: 'Flock not found or inactive' }, { status: 404 });
    if (data.count > flock.currentCount)
      return NextResponse.json({ error: 'Count exceeds current live bird count' }, { status: 422 });

    const [record] = await prisma.$transaction([
      prisma.mortalityRecord.create({
        data: {
          flockId: data.flockId,
          penSectionId: data.penSectionId,
          recordedById: user.sub,
          recordDate: new Date(data.recordDate),
          count: data.count,
          causeCode: data.causeCode,
          notes: data.notes,
          photoUrl: data.photoUrl,
          submissionStatus: 'PENDING',
        },
      }),
      prisma.flock.update({
        where: { id: data.flockId },
        data: { currentCount: { decrement: data.count } },
      }),
    ]);

    checkMortalitySpike(user.tenantId, data.flockId, data.count).catch(console.error);

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Mortality create error:', error);
    return NextResponse.json({ error: 'Failed to record mortality' }, { status: 500 });
  }
}

async function checkMortalitySpike(tenantId, flockId, todayCount) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekData = await prisma.mortalityRecord.groupBy({
    by: ['recordDate'],
    where: { flockId, recordDate: { gte: sevenDaysAgo } },
    _sum: { count: true },
  });
  if (weekData.length < 3) return;
  const avgDaily = weekData.reduce((s, d) => s + (d._sum.count || 0), 0) / weekData.length;
  if (todayCount > avgDaily * 2 && todayCount > 10) {
    console.log(`[ALERT] Mortality spike: ${todayCount} vs avg ${avgDaily.toFixed(1)}`);
    // Module 16 (Notifications) will send real alerts
  }
}
