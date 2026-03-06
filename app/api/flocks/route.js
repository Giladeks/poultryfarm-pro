// app/api/flocks/route.js — List and create flocks
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const createFlockSchema = z.object({
  batchCode: z.string().min(3).max(50),
  operationType: z.enum(['LAYER', 'BROILER', 'BREEDER', 'TURKEY']),
  breed: z.string().min(2).max(100),
  penSectionId: z.string().uuid(),
  dateOfPlacement: z.string(),
  initialCount: z.number().int().positive(),
  targetWeightG: z.number().optional(),
  expectedHarvestDate: z.string().optional(),
  expectedLayingStartDate: z.string().optional(),
  source: z.enum(['OWN_HATCHERY', 'PURCHASED', 'TRANSFERRED']).default('PURCHASED'),
  purchaseCost: z.number().optional(),
});

const MANAGER_ROLES = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'ACTIVE';
  const penId = searchParams.get('penId');
  const operationType = searchParams.get('operationType') || searchParams.get('birdType');

  try {
    const where = {
      penSection: { pen: { farm: { tenantId: user.tenantId } } },
      ...(status !== 'ALL' && { status }),
      ...(operationType && { operationType }),
      ...(penId && { penSection: { penId } }),
    };

    const flocks = await prisma.flock.findMany({
      where,
      include: {
        penSection: {
          include: { pen: { select: { id: true, name: true, operationType: true } } },
        },
        _count: { select: { mortalityRecords: true, vaccinations: true } },
      },
      orderBy: { dateOfPlacement: 'desc' },
    });

    const enriched = await Promise.all(flocks.map(async (flock) => {
      const latestWeight = await prisma.weightRecord.findFirst({
        where: { flockId: flock.id },
        orderBy: { recordDate: 'desc' },
      });

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentMortality = await prisma.mortalityRecord.aggregate({
        where: { flockId: flock.id, recordDate: { gte: sevenDaysAgo } },
        _sum: { count: true },
      });

      const recentEggs = flock.operationType === 'LAYER'
        ? await prisma.eggProduction.aggregate({
            where: { flockId: flock.id, collectionDate: { gte: sevenDaysAgo } },
            _sum: { totalEggs: true },
            _avg: { layingRatePct: true },
          })
        : null;

      const ageInDays = Math.floor(
        (new Date() - new Date(flock.dateOfPlacement)) / (1000 * 60 * 60 * 24)
      );

      return {
        ...flock,
        // keep birdType alias for UI compatibility
        birdType: flock.operationType,
        ageInDays,
        latestWeightG: latestWeight?.avgWeightG || null,
        weeklyMortality: recentMortality._sum.count || 0,
        avgLayingRate: recentEggs?._avg?.layingRatePct || null,
        weeklyEggs: recentEggs?._sum?.totalEggs || null,
      };
    }));

    return NextResponse.json({ flocks: enriched });
  } catch (error) {
    console.error('Flocks fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch flocks' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createFlockSchema.parse(body);

    // Verify section belongs to this tenant
    const section = await prisma.penSection.findFirst({
      where: { id: data.penSectionId, pen: { farm: { tenantId: user.tenantId } } },
      include: { pen: true },
    });
    if (!section)
      return NextResponse.json({ error: 'Pen section not found' }, { status: 404 });

    // Validate operationType matches pen type
    if (section.pen.operationType !== data.operationType) {
      return NextResponse.json({
        error: `Cannot place a ${data.operationType} flock in a ${section.pen.operationType} pen`,
      }, { status: 422 });
    }

    const flock = await prisma.flock.create({
      data: {
        ...data,
        tenantId: user.tenantId,
        currentCount: data.initialCount,
        dateOfPlacement: new Date(data.dateOfPlacement),
        expectedHarvestDate: data.expectedHarvestDate ? new Date(data.expectedHarvestDate) : null,
        expectedLayingStartDate: data.expectedLayingStartDate ? new Date(data.expectedLayingStartDate) : null,
      },
      include: { penSection: { include: { pen: true } } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.sub,
        action: 'CREATE',
        entityType: 'Flock',
        entityId: flock.id,
        changes: { batchCode: flock.batchCode, initialCount: flock.initialCount, operationType: flock.operationType },
      },
    }).catch(() => {});

    return NextResponse.json({ flock }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    if (error.code === 'P2002')
      return NextResponse.json({ error: 'Batch code already exists for this farm' }, { status: 409 });
    console.error('Flock create error:', error);
    return NextResponse.json({ error: 'Failed to create flock' }, { status: 500 });
  }
}
