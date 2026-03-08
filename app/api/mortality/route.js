// app/api/mortality/route.js — Record and retrieve mortality events
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { sendMortalityAlert } from '@/lib/services/sms';

const createMortalitySchema = z.object({
  flockId: z.string().min(1),
  penSectionId: z.string().min(1),
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
  const flockId      = searchParams.get('flockId');
  const days         = parseInt(searchParams.get('days') || '30');
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
    const records = await prisma.mortalityRecord.findMany({
      where: {
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
        recordDate: { gte: since },
        ...(flockId && { flockId }),
        ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
        ...(rejectedOnly && { rejectionReason: { not: null } }),
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

async function checkMortalitySpike(tenantId, flockId, count) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const weekData = await prisma.mortalityRecord.groupBy({
    by: ['recordDate'],
    where: { flockId, recordDate: { gte: sevenDaysAgo } },
    _sum: { count: true },
  });

  const avgDaily = weekData.length >= 3
    ? weekData.reduce((s, d) => s + (d._sum.count || 0), 0) / weekData.length
    : null;

  const isSpike = (avgDaily !== null && count > avgDaily * 2 && count > 10) || count >= 20;
  if (!isSpike) return;

  // Check if tenant has SMS alerts enabled
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const smsSettings = tenant?.settings?.sms;
    if (!smsSettings?.enabled || !smsSettings?.mortalityAlert?.enabled) return;
    if (count < (smsSettings.mortalityAlert.threshold ?? 10)) return;

    // Get flock + section + pen info for the message
    const flock = await prisma.flock.findUnique({
      where: { id: flockId },
      include: {
        penSection: { include: { pen: { select: { name: true } } } },
      },
    });
    if (!flock) return;

    // Find Farm Manager + Pen Manager phone numbers
    const managers = await prisma.user.findMany({
      where: {
        tenantId,
        role:     { in: ['FARM_MANAGER', 'FARM_ADMIN', 'PEN_MANAGER', 'CHAIRPERSON'] },
        isActive: true,
        phone:    { not: null },
      },
      select: { phone: true, firstName: true },
    });

    // Also include any extra alert phones configured in settings
    const extraPhones = (smsSettings.alertPhones || []).map(p => ({ phone: p.phone }));
    const recipients  = [...managers, ...extraPhones].filter(r => r.phone);

    await sendMortalityAlert({
      count,
      flockBatchCode: flock.batchCode,
      penName:        flock.penSection?.pen?.name || 'Unknown Pen',
      sectionName:    flock.penSection?.name || 'Unknown Section',
      causeCode:      null, // not available at spike-check level
      recipients,
    });
  } catch (err) {
    console.error('[SMS] Mortality alert error:', err.message);
  }
}