// app/api/feed/mill/route.js — Feed mill batches: list + create
// Only available when tenant.hasFeedMill === true
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MILL_ROLES    = ['FEED_MILL_MANAGER', 'PRODUCTION_STAFF', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MANAGER_ROLES = ['FEED_MILL_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const createBatchSchema = z.object({
  farmId:            z.string().uuid(),
  batchCode:         z.string().min(3).max(50),
  formulaId:         z.string().uuid().optional().nullable(),
  targetQuantityKg:  z.number().positive(),
  productionDate:    z.string(),
  notes:             z.string().optional().nullable(),
});

const batchCodeSchema = z.object({
  batchCode: z.string().min(3).max(50),
});

// ─── GET /api/feed/mill ───────────────────────────────────────────────────────
// Returns feed mill batches for this tenant.
// Query params: farmId, status, qcStatus, from, to, limit
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify tenant has feed mill add-on
  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { hasFeedMill: true },
  });
  if (!tenant?.hasFeedMill)
    return NextResponse.json({ error: 'Feed mill module is not enabled for this tenant' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const farmId   = searchParams.get('farmId');
  const status   = searchParams.get('status');
  const qcStatus = searchParams.get('qcStatus');
  const from     = searchParams.get('from');
  const to       = searchParams.get('to');
  const limit    = parseInt(searchParams.get('limit') || '50', 10);

  try {
    const where = {
      tenantId: user.tenantId,
      ...(farmId   && { farmId }),
      ...(status   && { status }),
      ...(qcStatus && { qcStatus }),
      ...((from || to) && {
        productionDate: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to) }),
        },
      }),
    };

    const batches = await prisma.feedMillBatch.findMany({
      where,
      include: {
        farm:       { select: { id: true, name: true } },
        producedBy: { select: { id: true, firstName: true, lastName: true } },
        qcTests:    {
          orderBy: { testDate: 'desc' },
          include: {
            testedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { productionDate: 'desc' },
      take: Math.min(limit, 200),
    });

    // Summary stats
    const summary = await prisma.feedMillBatch.groupBy({
      by: ['status'],
      where: { tenantId: user.tenantId },
      _count: true,
      _sum:   { targetQuantityKg: true, actualQuantityKg: true },
    });

    return NextResponse.json({ batches, summary });
  } catch (error) {
    console.error('Feed mill batch fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch feed mill batches' }, { status: 500 });
  }
}

// ─── POST /api/feed/mill ──────────────────────────────────────────────────────
// Creates a new feed mill batch (status: PLANNED). Mill manager+ only.
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  // Verify tenant has feed mill add-on
  const tenant = await prisma.tenant.findUnique({
    where: { id: user.tenantId },
    select: { hasFeedMill: true },
  });
  if (!tenant?.hasFeedMill)
    return NextResponse.json({ error: 'Feed mill module is not enabled for this tenant' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createBatchSchema.parse(body);

    // Verify farm belongs to this tenant
    const farm = await prisma.farm.findFirst({
      where: { id: data.farmId, tenantId: user.tenantId },
    });
    if (!farm)
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 });

    // Verify formula belongs to tenant (if provided)
    if (data.formulaId) {
      const formula = await prisma.feedFormula.findFirst({
        where: { id: data.formulaId, tenantId: user.tenantId },
      });
      if (!formula)
        return NextResponse.json({ error: 'Feed formula not found' }, { status: 404 });
    }

    const batch = await prisma.feedMillBatch.create({
      data: {
        tenantId:         user.tenantId,
        farmId:           data.farmId,
        batchCode:        data.batchCode,
        formulaId:        data.formulaId,
        targetQuantityKg: data.targetQuantityKg,
        productionDate:   new Date(data.productionDate),
        status:           'PLANNED',
        qcStatus:         'PENDING',
        producedById:     user.sub,
        notes:            data.notes,
      },
      include: {
        farm:       { select: { id: true, name: true } },
        producedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'FeedMillBatch',
        entityId:   batch.id,
        changes: {
          batchCode:        batch.batchCode,
          targetQuantityKg: batch.targetQuantityKg,
          productionDate:   batch.productionDate,
        },
      },
    }).catch(() => {});

    return NextResponse.json({ batch }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    if (error.code === 'P2002')
      return NextResponse.json({ error: 'Batch code already exists' }, { status: 409 });
    console.error('Feed mill batch create error:', error);
    return NextResponse.json({ error: 'Failed to create feed mill batch' }, { status: 500 });
  }
}
