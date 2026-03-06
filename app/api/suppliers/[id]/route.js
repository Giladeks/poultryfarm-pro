// app/api/suppliers/[id]/route.js — Get, update or delete a single supplier
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const updateSupplierSchema = z.object({
  name:         z.string().min(2).max(120).optional(),
  supplierType: z.enum(['FEED', 'CHICKS', 'MEDICATION', 'EQUIPMENT', 'OTHER']).optional(),
  contactName:  z.string().max(100).optional().nullable(),
  phone:        z.string().max(30).optional().nullable(),
  email:        z.string().email().optional().nullable(),
  address:      z.string().max(200).optional().nullable(),
  paymentTerms: z.string().max(50).optional().nullable(),
  rating:       z.number().int().min(1).max(5).optional().nullable(),
});

// ─── GET /api/suppliers/[id] ──────────────────────────────────────────────────
export async function GET(request, { params }) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const supplier = await prisma.supplier.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        _count:         { select: { purchaseOrders: true } },
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, poNumber: true, status: true, totalAmount: true, createdAt: true },
        },
      },
    });

    if (!supplier)
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    return NextResponse.json({ supplier });
  } catch (error) {
    console.error('Supplier fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch supplier' }, { status: 500 });
  }
}

// ─── PATCH /api/suppliers/[id] ────────────────────────────────────────────────
export async function PATCH(request, { params }) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    // Verify supplier belongs to this tenant
    const existing = await prisma.supplier.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!existing)
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    const body = await request.json();
    const data = updateSupplierSchema.parse(body);

    const supplier = await prisma.supplier.update({
      where: { id: params.id },
      data,
      include: {
        _count: { select: { purchaseOrders: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'Supplier',
        entityId:   supplier.id,
        changes:    data,
      },
    }).catch(() => {});

    return NextResponse.json({ supplier });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Supplier update error:', error);
    return NextResponse.json({ error: 'Failed to update supplier' }, { status: 500 });
  }
}

// ─── DELETE /api/suppliers/[id] ───────────────────────────────────────────────
export async function DELETE(request, { params }) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const existing = await prisma.supplier.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: { _count: { select: { purchaseOrders: true } } },
    });
    if (!existing)
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    if (existing._count.purchaseOrders > 0)
      return NextResponse.json(
        { error: 'Cannot delete supplier with existing purchase orders' },
        { status: 422 }
      );

    await prisma.supplier.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Supplier delete error:', error);
    return NextResponse.json({ error: 'Failed to delete supplier' }, { status: 500 });
  }
}
