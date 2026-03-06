// app/api/suppliers/route.js — List and create suppliers
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const supplierSchema = z.object({
  name:         z.string().min(2).max(120),
  supplierType: z.enum(['FEED', 'CHICKS', 'MEDICATION', 'EQUIPMENT', 'OTHER']).default('FEED'),
  contactName:  z.string().max(100).optional().nullable(),
  phone:        z.string().max(30).optional().nullable(),
  email:        z.string().email().optional().nullable(),
  address:      z.string().max(200).optional().nullable(),
  paymentTerms: z.string().max(50).optional().nullable(),
  rating:       z.number().int().min(1).max(5).optional().nullable(),
});

// ─── GET /api/suppliers ───────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // optional filter e.g. ?type=FEED

  try {
    const suppliers = await prisma.supplier.findMany({
      where: {
        tenantId: user.tenantId,
        ...(type && { supplierType: type }),
      },
      include: {
        _count: { select: { purchaseOrders: true } },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ suppliers });
  } catch (error) {
    console.error('Suppliers fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch suppliers' }, { status: 500 });
  }
}

// ─── POST /api/suppliers ──────────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = supplierSchema.parse(body);

    const supplier = await prisma.supplier.create({
      data: {
        ...data,
        tenantId: user.tenantId,
      },
      include: {
        _count: { select: { purchaseOrders: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'Supplier',
        entityId:   supplier.id,
        changes:    { name: supplier.name, supplierType: supplier.supplierType },
      },
    }).catch(() => {});

    return NextResponse.json({ supplier }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Supplier create error:', error);
    return NextResponse.json({ error: 'Failed to create supplier' }, { status: 500 });
  }
}
