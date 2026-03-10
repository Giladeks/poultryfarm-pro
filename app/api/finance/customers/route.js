// app/api/finance/customers/route.js
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];
const FINANCE_ROLES      = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT'];

const customerSchema = z.object({
  customerType:  z.enum(['B2C','B2B','OFFTAKER']).default('B2C'),
  name:          z.string().min(2).max(120),
  contactName:   z.string().max(100).optional().nullable(),
  phone:         z.string().max(30).optional().nullable(),
  email:         z.string().email().optional().nullable(),
  address:       z.string().max(200).optional().nullable(),
  taxId:         z.string().max(50).optional().nullable(),
  companyName:   z.string().max(120).optional().nullable(),
  creditLimit:   z.number().positive().optional().nullable(),
  paymentTerms:  z.string().max(50).optional().nullable(),
  currency:      z.enum(['NGN','USD','EUR','GBP','GHS','KES','ZAR']).default('NGN'),
  notes:         z.string().optional().nullable(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const search       = searchParams.get('search');
  const type         = searchParams.get('type');
  const activeOnly   = searchParams.get('activeOnly') !== 'false';

  try {
    const customers = await prisma.customer.findMany({
      where: {
        tenantId: user.tenantId,
        ...(activeOnly && { isActive: true }),
        ...(type       && { customerType: type }),
        ...(search && {
          OR: [
            { name:        { contains: search, mode: 'insensitive' } },
            { contactName: { contains: search, mode: 'insensitive' } },
            { email:       { contains: search, mode: 'insensitive' } },
            { companyName: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: {
        _count: { select: { salesInvoices: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Attach AR summary per customer
    const customerIds = customers.map(c => c.id);
    const invoiceSummary = await prisma.salesInvoice.groupBy({
      by: ['customerId', 'status'],
      where: { tenantId: user.tenantId, customerId: { in: customerIds } },
      _sum: { totalAmount: true, amountPaid: true },
    });

    const summaryMap = {};
    invoiceSummary.forEach(row => {
      if (!summaryMap[row.customerId]) summaryMap[row.customerId] = { totalBilled: 0, totalPaid: 0, overdueCount: 0 };
      summaryMap[row.customerId].totalBilled += parseFloat(row._sum.totalAmount || 0);
      summaryMap[row.customerId].totalPaid   += parseFloat(row._sum.amountPaid  || 0);
      if (row.status === 'OVERDUE') summaryMap[row.customerId].overdueCount += 1;
    });

    const enriched = customers.map(c => ({
      ...c,
      arSummary: summaryMap[c.id] || { totalBilled: 0, totalPaid: 0, overdueCount: 0 },
    }));

    return NextResponse.json({ customers: enriched });
  } catch (error) {
    console.error('Customers fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const data = customerSchema.parse(body);

    const customer = await prisma.customer.create({
      data: { ...data, tenantId: user.tenantId },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId, userId: user.sub,
        action: 'CREATE', entityType: 'Customer', entityId: customer.id,
        changes: { name: customer.name, customerType: customer.customerType },
      },
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 422 });
    console.error('Customer create error:', error);
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
  }
}
