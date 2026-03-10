// app/api/finance/customers/[id]/route.js
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];
const FINANCE_ROLES      = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT'];

const updateSchema = z.object({
  customerType:  z.enum(['B2C','B2B','OFFTAKER']).optional(),
  name:          z.string().min(2).max(120).optional(),
  contactName:   z.string().max(100).optional().nullable(),
  phone:         z.string().max(30).optional().nullable(),
  email:         z.string().email().optional().nullable(),
  address:       z.string().max(200).optional().nullable(),
  taxId:         z.string().max(50).optional().nullable(),
  companyName:   z.string().max(120).optional().nullable(),
  creditLimit:   z.number().positive().optional().nullable(),
  paymentTerms:  z.string().max(50).optional().nullable(),
  currency:      z.enum(['NGN','USD','EUR','GBP','GHS','KES','ZAR']).optional(),
  notes:         z.string().optional().nullable(),
  isActive:      z.boolean().optional(),
});

export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        salesInvoices: {
          orderBy: { invoiceDate: 'desc' },
          take: 10,
          select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, totalAmount: true, amountPaid: true, status: true, currency: true },
        },
        _count: { select: { salesInvoices: true } },
      },
    });

    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    return NextResponse.json({ customer });
  } catch (error) {
    console.error('Customer GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 });
  }
}

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    const customer = await prisma.customer.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    const updated = await prisma.customer.update({
      where: { id: params.id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId, userId: user.sub,
        action: 'UPDATE', entityType: 'Customer', entityId: customer.id,
        changes: data,
      },
    });

    return NextResponse.json({ customer: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 422 });
    console.error('Customer PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 });
  }
}
