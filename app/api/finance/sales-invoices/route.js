// app/api/finance/sales-invoices/route.js
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];
const FINANCE_ROLES      = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT'];

// ── Invoice number generator ──────────────────────────────────────────────────
// Format: INV-YYYY-NNNN  (e.g. INV-2026-0001)
async function generateSalesInvoiceNumber(tenantId) {
  const year   = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last   = await prisma.salesInvoice.findFirst({
    where:   { tenantId, invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select:  { invoiceNumber: true },
  });
  const seq = last
    ? parseInt(last.invoiceNumber.slice(prefix.length), 10) + 1
    : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity:    z.number().positive(),
  unit:        z.string().optional().default(''),
  unitPrice:   z.number().min(0),
  totalPrice:  z.number().min(0),
});

const createSchema = z.object({
  invoiceNumber: z.string().min(1).optional(),   // ignored — server generates it
  customerId:    z.string().min(1),
  flockId:       z.string().min(1).optional().nullable(),
  farmId:        z.string().min(1).optional().nullable(),
  invoiceDate:   z.string(),
  dueDate:       z.string(),
  currency:      z.enum(['NGN','USD','EUR','GBP','GHS','KES','ZAR']).default('NGN'),
  exchangeRate:  z.number().positive().default(1.0),
  subtotal:      z.number().min(0),
  taxAmount:     z.number().min(0).default(0),
  totalAmount:   z.number().min(0),
  lineItems:     z.array(lineItemSchema).default([]),
  notes:         z.string().optional().nullable(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);

  // ?action=next-number — preview the next invoice number for the create modal
  if (searchParams.get('action') === 'next-number') {
    const number = await generateSalesInvoiceNumber(user.tenantId);
    return NextResponse.json({ invoiceNumber: number });
  }

  const status     = searchParams.get('status');
  const customerId = searchParams.get('customerId');
  const from       = searchParams.get('from');
  const to         = searchParams.get('to');
  const search     = searchParams.get('search');
  const page       = parseInt(searchParams.get('page') || '1', 10);
  const limit      = parseInt(searchParams.get('limit') || '50', 10);

  try {
    const now = new Date();

    // Auto-mark overdue: SENT invoices past due date → OVERDUE
    await prisma.salesInvoice.updateMany({
      where: {
        tenantId: user.tenantId,
        status:   'SENT',
        dueDate:  { lt: now },
      },
      data: { status: 'OVERDUE' },
    });

    const where = {
      tenantId: user.tenantId,
      ...(status     && { status }),
      ...(customerId && { customerId }),
      ...(from       && { invoiceDate: { gte: new Date(from) } }),
      ...(to         && { invoiceDate: { lte: new Date(to) } }),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [invoices, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where,
        include: {
          customer:   { select: { id: true, name: true, customerType: true, email: true } },
          createdBy:  { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { invoiceDate: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      prisma.salesInvoice.count({ where }),
    ]);

    const enriched = invoices.map(inv => {
      const due = new Date(inv.dueDate);
      const daysOverdue = ['OVERDUE'].includes(inv.status)
        ? Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)))
        : 0;
      const balance = parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
      return { ...inv, daysOverdue, balance };
    });

    // Summary across all AR invoices
    const allForSummary = await prisma.salesInvoice.findMany({
      where:  { tenantId: user.tenantId },
      select: { status: true, totalAmount: true, amountPaid: true },
    });
    const summary = {
      total:           allForSummary.length,
      draft:           allForSummary.filter(i => i.status === 'DRAFT').length,
      sent:            allForSummary.filter(i => i.status === 'SENT').length,
      overdue:         allForSummary.filter(i => i.status === 'OVERDUE').length,
      paid:            allForSummary.filter(i => i.status === 'PAID').length,
      totalBilled:     allForSummary
        .filter(i => !['VOID'].includes(i.status))
        .reduce((s, i) => s + parseFloat(i.totalAmount), 0),
      totalOutstanding:allForSummary
        .filter(i => !['PAID','VOID'].includes(i.status))
        .reduce((s, i) => s + (parseFloat(i.totalAmount) - parseFloat(i.amountPaid)), 0),
      overdueAmount:   allForSummary
        .filter(i => i.status === 'OVERDUE')
        .reduce((s, i) => s + (parseFloat(i.totalAmount) - parseFloat(i.amountPaid)), 0),
    };

    return NextResponse.json({
      invoices: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary,
    });
  } catch (error) {
    console.error('Sales invoices fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch sales invoices' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, tenantId: user.tenantId },
    });
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });

    // Generate invoice number server-side (ignore any client-supplied value)
    const invoiceNumber = await generateSalesInvoiceNumber(user.tenantId);

    const invoice = await prisma.salesInvoice.create({
      data: {
        tenantId:      user.tenantId,
        invoiceNumber,
        customerId:    data.customerId,
        flockId:       data.flockId   || null,
        farmId:        data.farmId    || null,
        invoiceDate:   new Date(data.invoiceDate),
        dueDate:       new Date(data.dueDate),
        currency:      data.currency,
        exchangeRate:  data.exchangeRate,
        subtotal:      data.subtotal,
        taxAmount:     data.taxAmount,
        totalAmount:   data.totalAmount,
        amountPaid:    0,
        status:        'DRAFT',
        lineItems:     data.lineItems,
        notes:         data.notes || null,
        createdById:   user.sub,
      },
      include: {
        customer:  { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId, userId: user.sub,
        action: 'CREATE', entityType: 'SalesInvoice', entityId: invoice.id,
        changes: { invoiceNumber, customerId: data.customerId, totalAmount: data.totalAmount },
      },
    });

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 422 });
    console.error('Sales invoice create error:', error);
    return NextResponse.json({ error: 'Failed to create sales invoice' }, { status: 500 });
  }
}
