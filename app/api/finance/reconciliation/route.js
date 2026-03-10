// app/api/finance/reconciliation/route.js
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const RECONCILIATION_ROLES = ['SUPER_ADMIN','FARM_ADMIN','ACCOUNTANT'];
const FINANCE_VIEW_ROLES   = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];

const txSchema = z.object({
  txDate:      z.string(),
  description: z.string().min(1),
  reference:   z.string().optional().nullable(),
  amount:      z.number(),   // positive = credit (money in), negative = debit (money out)
  currency:    z.enum(['NGN','USD','EUR','GBP','GHS','KES','ZAR']).default('NGN'),
  bankAccount: z.string().optional().nullable(),
});

// GET /api/finance/reconciliation
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const from        = searchParams.get('from');
  const to          = searchParams.get('to');
  const unmatchedOnly = searchParams.get('unmatched') === 'true';
  const search      = searchParams.get('search');
  const page        = parseInt(searchParams.get('page') || '1',  10);
  const limit       = parseInt(searchParams.get('limit') || '50', 10);

  try {
    const where = {
      tenantId: user.tenantId,
      ...(from || to ? {
        txDate: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to)   } : {}),
        },
      } : {}),
      ...(unmatchedOnly ? { matchedAt: null } : {}),
      ...(search ? {
        OR: [
          { description: { contains: search, mode: 'insensitive' } },
          { reference:   { contains: search, mode: 'insensitive' } },
          { bankAccount: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.bankTransaction.count({ where }),
      prisma.bankTransaction.findMany({
        where,
        orderBy: [{ matchedAt: 'asc' }, { txDate: 'desc' }],
        skip:  (page - 1) * limit,
        take:  limit,
        include: {
          matchedSalesInvoice:    { select: { id: true, invoiceNumber: true, totalAmount: true, status: true, customer: { select: { name: true } } } },
          matchedSupplierInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true, supplier: { select: { name: true } } } },
          createdBy:              { select: { id: true, firstName: true, lastName: true } },
          matchedBy:              { select: { id: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    // Summary across ALL transactions (no date/filter restriction)
    const [creditAgg, debitAgg, unmatchedCount, matchedCount] = await Promise.all([
      prisma.bankTransaction.aggregate({ where: { tenantId: user.tenantId, amount: { gt: 0 } }, _sum: { amount: true } }),
      prisma.bankTransaction.aggregate({ where: { tenantId: user.tenantId, amount: { lt: 0 } }, _sum: { amount: true } }),
      prisma.bankTransaction.count({ where: { tenantId: user.tenantId, matchedAt: null } }),
      prisma.bankTransaction.count({ where: { tenantId: user.tenantId, matchedAt: { not: null } } }),
    ]);

    return NextResponse.json({
      transactions: rows,
      total,
      page,
      pages: Math.ceil(total / limit),
      summary: {
        totalCredit:    Number(creditAgg._sum.amount  || 0),
        totalDebit:     Math.abs(Number(debitAgg._sum.amount || 0)),
        unmatchedCount,
        matchedCount,
      },
    });
  } catch (err) {
    console.error('[RECON GET]', err);
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
  }
}

// POST /api/finance/reconciliation — create single manual transaction
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!RECONCILIATION_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = txSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Validation error', issues: parsed.error.issues }, { status: 400 });

    const d = parsed.data;

    const tx = await prisma.bankTransaction.create({
      data: {
        tenantId:    user.tenantId,
        txDate:      new Date(d.txDate),
        description: d.description,
        reference:   d.reference   || null,
        amount:      d.amount,
        currency:    d.currency,
        bankAccount: d.bankAccount || null,
        source:      'MANUAL',
        createdById: user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.id,
        action:     'CREATE',
        entityType: 'BankTransaction',
        entityId:   tx.id,
        changes:    { amount: d.amount, description: d.description, reference: d.reference },
      },
    });

    return NextResponse.json({ transaction: tx }, { status: 201 });
  } catch (err) {
    console.error('[RECON POST]', err);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
