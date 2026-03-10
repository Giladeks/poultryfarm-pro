// app/api/finance/supplier-invoices/route.js
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];
const FINANCE_ROLES      = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT'];

// ── Invoice number generator ──────────────────────────────────────────────────
// Format: SINV-YYYY-NNNN  (e.g. SINV-2026-0001)
async function generateSupplierInvoiceNumber(tenantId) {
  const year   = new Date().getFullYear();
  const prefix = `SINV-${year}-`;
  const last   = await prisma.supplierInvoice.findFirst({
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
  invoiceNumber:   z.string().min(1).optional(),   // ignored — server generates it
  supplierId:      z.string().min(1),
  linkedReceiptId: z.string().min(1).optional().nullable(),
  linkedPOId:      z.string().min(1).optional().nullable(),
  invoiceDate:     z.string(),
  dueDate:         z.string(),
  currency:        z.enum(['NGN','USD','EUR','GBP','GHS','KES','ZAR']).default('NGN'),
  exchangeRate:    z.number().positive().default(1.0),
  subtotal:        z.number().min(0),
  taxAmount:       z.number().min(0).default(0),
  totalAmount:     z.number().min(0),
  lineItems:       z.array(lineItemSchema).default([]),
  notes:           z.string().optional().nullable(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);

  // ?action=next-number — preview the next invoice number for the create modal
  if (searchParams.get('action') === 'next-number') {
    const number = await generateSupplierInvoiceNumber(user.tenantId);
    return NextResponse.json({ invoiceNumber: number });
  }

  const status     = searchParams.get('status');
  const supplierId = searchParams.get('supplierId');
  const from       = searchParams.get('from');
  const to         = searchParams.get('to');
  const search     = searchParams.get('search');
  const page       = parseInt(searchParams.get('page') || '1', 10);
  const limit      = parseInt(searchParams.get('limit') || '50', 10);

  try {
    // Auto-mark overdue: PENDING or APPROVED invoices past due date → OVERDUE
    const now = new Date();
    await prisma.supplierInvoice.updateMany({
      where: {
        tenantId: user.tenantId,
        status:   { in: ['PENDING', 'APPROVED'] },
        dueDate:  { lt: now },
      },
      data: { status: 'OVERDUE' },
    });

    const where = {
      tenantId: user.tenantId,
      ...(status     && { status }),
      ...(supplierId && { supplierId }),
      ...(from       && { invoiceDate: { gte: new Date(from) } }),
      ...(to         && { invoiceDate: { lte: new Date(to) } }),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { supplier: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [invoices, total] = await Promise.all([
      prisma.supplierInvoice.findMany({
        where,
        include: {
          supplier:  { select: { id: true, name: true, contactName: true, email: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy:{ select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { invoiceDate: 'desc' },
        skip:    (page - 1) * limit,
        take:    limit,
      }),
      prisma.supplierInvoice.count({ where }),
    ]);

    // Fetch linked receipts separately — no Prisma @relation on SupplierInvoice → StoreReceipt
    const receiptIds = invoices.map(i => i.linkedReceiptId).filter(Boolean);
    let receiptsMap = {};
    if (receiptIds.length > 0) {
      const receipts = await prisma.storeReceipt.findMany({
        where:  { id: { in: receiptIds } },
        select: { id: true, batchNumber: true, receiptDate: true },
      });
      receipts.forEach(r => { receiptsMap[r.id] = r; });
    }

    // Compute aging and balance per invoice
    const enriched = invoices.map(inv => {
      const due = new Date(inv.dueDate);
      const daysOverdue = ['OVERDUE','DISPUTED'].includes(inv.status)
        ? Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)))
        : 0;
      const balance = parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid);
      const linkedReceipt = inv.linkedReceiptId ? receiptsMap[inv.linkedReceiptId] || null : null;
      return { ...inv, daysOverdue, balance, linkedReceipt };
    });

    // Summary stats (unfiltered — always whole-tenant view)
    const allForSummary = await prisma.supplierInvoice.findMany({
      where:  { tenantId: user.tenantId },
      select: { status: true, totalAmount: true, amountPaid: true },
    });
    const summary = {
      total:         allForSummary.length,
      pending:       allForSummary.filter(i => i.status === 'PENDING').length,
      approved:      allForSummary.filter(i => i.status === 'APPROVED').length,
      overdue:       allForSummary.filter(i => i.status === 'OVERDUE').length,
      paid:          allForSummary.filter(i => i.status === 'PAID').length,
      disputed:      allForSummary.filter(i => i.status === 'DISPUTED').length,
      totalOwed:     allForSummary
        .filter(i => !['PAID','VOID'].includes(i.status))
        .reduce((s, i) => s + (parseFloat(i.totalAmount) - parseFloat(i.amountPaid)), 0),
      overdueAmount: allForSummary
        .filter(i => i.status === 'OVERDUE')
        .reduce((s, i) => s + (parseFloat(i.totalAmount) - parseFloat(i.amountPaid)), 0),
    };

    return NextResponse.json({
      invoices: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary,
    });
  } catch (error) {
    console.error('Supplier invoices fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch supplier invoices' }, { status: 500 });
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

    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplierId, tenantId: user.tenantId },
    });
    if (!supplier) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });

    // Generate invoice number server-side (ignore any client-supplied value)
    const invoiceNumber = await generateSupplierInvoiceNumber(user.tenantId);

    const invoice = await prisma.supplierInvoice.create({
      data: {
        tenantId:        user.tenantId,
        invoiceNumber,
        supplierId:      data.supplierId,
        linkedReceiptId: data.linkedReceiptId || null,
        linkedPOId:      data.linkedPOId || null,
        invoiceDate:     new Date(data.invoiceDate),
        dueDate:         new Date(data.dueDate),
        currency:        data.currency,
        exchangeRate:    data.exchangeRate,
        subtotal:        data.subtotal,
        taxAmount:       data.taxAmount,
        totalAmount:     data.totalAmount,
        amountPaid:      0,
        status:          'PENDING',
        lineItems:       data.lineItems,
        notes:           data.notes || null,
        createdById:     user.sub,
      },
      include: {
        supplier:  { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'SupplierInvoice',
        entityId:   invoice.id,
        changes:    { invoiceNumber, supplierId: data.supplierId, totalAmount: data.totalAmount },
      },
    });

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 422 });
    console.error('Supplier invoice create error:', error);
    return NextResponse.json({ error: 'Failed to create supplier invoice' }, { status: 500 });
  }
}
