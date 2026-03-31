// app/api/flocks/route.js — List and create flocks
// Phase 8C update: POST now accepts optional `stage` field (BROODING | REARING | PRODUCTION).
// Defaults to BROODING so new day-old placements start in the correct lifecycle stage.
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const createFlockSchema = z.object({
  batchCode:               z.string().min(3).max(50),
  operationType:           z.enum(['LAYER', 'BROILER', 'BREEDER', 'TURKEY']),
  breed:                   z.string().min(2).max(100),
  penSectionId:            z.string().min(1),
  dateOfPlacement:         z.string(),
  initialCount:            z.number().int().positive(),
  // Phase 8C: starting lifecycle stage — defaults to BROODING for day-old intakes
  stage:                   z.enum(['BROODING', 'REARING', 'PRODUCTION']).default('BROODING'),
  targetWeightG:           z.number().optional(),
  expectedHarvestDate:     z.string().optional(),
  expectedLayingStartDate: z.string().optional(),
  source:                  z.enum(['OWN_HATCHERY', 'PURCHASED', 'TRANSFERRED']).default('PURCHASED'),
  purchaseCost:            z.number().optional(),
});

const MANAGER_ROLES     = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const PEN_MANAGER_ROLES = ['PEN_MANAGER'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status        = searchParams.get('status') || 'ACTIVE';
  const penId         = searchParams.get('penId');
  const operationType = searchParams.get('operationType') || searchParams.get('birdType');
  const stage         = searchParams.get('stage'); // optional filter by stage

  try {
    // PEN_MANAGER: only see flocks in their assigned sections
    let allowedSectionIds = null;
    if (PEN_MANAGER_ROLES.includes(user.role)) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub, isActive: true },
        select: { penSectionId: true },
      });
      allowedSectionIds = assignments.map(a => a.penSectionId);
      if (allowedSectionIds.length === 0) return NextResponse.json({ flocks: [] });
    }

    const where = {
      penSection: { pen: { farm: { tenantId: user.tenantId } } },
      ...(status !== 'ALL' && { status }),
      ...(operationType    && { operationType }),
      ...(stage            && { stage }),
      ...(penId            && { penSection: { penId } }),
      ...(allowedSectionIds && { penSectionId: { in: allowedSectionIds } }),
    };

    const flocks = await prisma.flock.findMany({
      where,
      include: {
        penSection: {
          include: {
            pen: { select: { id: true, name: true, operationType: true, penPurpose: true } },
          },
        },
      },
      orderBy: { dateOfPlacement: 'desc' },
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const enriched = await Promise.all(flocks.map(async (flock) => {
      const [recentMortality, latestWeight, recentEggs] = await Promise.all([
        prisma.mortalityRecord.aggregate({
          where:  { flockId: flock.id, recordDate: { gte: sevenDaysAgo } },
          _sum:   { count: true },
        }),
        flock.operationType === 'BROILER' || flock.stage === 'REARING'
          ? prisma.weightRecord.findFirst({
              where:   { flockId: flock.id },
              orderBy: { recordDate: 'desc' },
              select:  { avgWeightG: true, recordDate: true },
            })
          : null,
        flock.operationType === 'LAYER' && flock.stage === 'PRODUCTION'
          ? prisma.eggProduction.aggregate({
              where: { flockId: flock.id, collectionDate: { gte: sevenDaysAgo } },
              _sum:  { totalEggs: true },
              _avg:  { layingRatePct: true },
            })
          : null,
      ]);

      const ageInDays = Math.floor(
        (new Date() - new Date(flock.dateOfPlacement)) / (1000 * 60 * 60 * 24)
      );

      return {
        ...flock,
        birdType:        flock.operationType, // alias for UI compatibility
        ageInDays,
        latestWeightG:   latestWeight?.avgWeightG || null,
        weeklyMortality: recentMortality._sum.count || 0,
        avgLayingRate:   recentEggs?._avg?.layingRatePct || null,
        weeklyEggs:      recentEggs?._sum?.totalEggs || null,
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
      where:   { id: data.penSectionId, pen: { farm: { tenantId: user.tenantId } } },
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
        tenantId:                user.tenantId,
        batchCode:               data.batchCode,
        operationType:           data.operationType,
        breed:                   data.breed,
        penSectionId:            data.penSectionId,
        dateOfPlacement:         new Date(data.dateOfPlacement),
        initialCount:            data.initialCount,
        currentCount:            data.initialCount,
        stage:                   data.stage,           // ← Phase 8C: persist stage
        stageUpdatedAt:          new Date(),
        source:                  data.source,
        purchaseCost:            data.purchaseCost     || null,
        targetWeightG:           data.targetWeightG    || null,
        expectedHarvestDate:     data.expectedHarvestDate
          ? new Date(data.expectedHarvestDate) : null,
        expectedLayingStartDate: data.expectedLayingStartDate
          ? new Date(data.expectedLayingStartDate) : null,
      },
      include: { penSection: { include: { pen: true } } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'Flock',
        entityId:   flock.id,
        changes:    { batchCode: flock.batchCode, initialCount: flock.initialCount, operationType: flock.operationType, stage: flock.stage },
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
