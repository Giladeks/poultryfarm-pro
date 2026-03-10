// app/api/finance/reconciliation/[id]/route.js
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const RECONCILIATION_ROLES = ['SUPER_ADMIN','FARM_ADMIN','ACCOUNTANT'];
const FINANCE_VIEW_ROLES   = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];

const matchSchema = z.object({
  action:           z.enum(['match', 'unmatch', 'delete']),
  invoiceType:      z.enum(['sales', 'supplier']).optional(),
  invoiceId:        z.string().min(1).optional(),
});

// GET /api/finance/reconciliation/[id] — get single transaction
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const tx = await prisma.bankTransaction.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        matchedSalesInvoice:    {
          select: {
            id: true, invoiceNumber: true, totalAmount: true, amountPaid: true,
            status: true, invoiceDate: true,
            customer: { select: { name: true } },
          },
        },
        matchedSupplierInvoice: {
          select: {
            id: true, invoiceNumber: true, totalAmount: true, amountPaid: true,
            status: true, invoiceDate: true,
            supplier: { select: { name: true } },
          },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        matchedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!tx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ transaction: tx });
  } catch (err) {
    console.error('[RECON GET ID]', err);
    return NextResponse.json({ error: 'Failed to load transaction' }, { status: 500 });
  }
}

// PATCH /api/finance/reconciliation/[id]
// action: "match"   → link this tx to an invoice + set reconciledAt on the invoice
// action: "unmatch" → clear match fields and reconciledAt from the linked invoice
// action: "delete"  → delete this tx (only MANUAL source, unmatched)
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!RECONCILIATION_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = matchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Validation error', issues: parsed.error.issues }, { status: 400 });

    const { action, invoiceType, invoiceId } = parsed.data;

    const tx = await prisma.bankTransaction.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (tx.source !== 'MANUAL')
        return NextResponse.json({ error: 'Only manual transactions can be deleted' }, { status: 400 });
      if (tx.matchedAt)
        return NextResponse.json({ error: 'Unmatched the transaction before deleting' }, { status: 400 });

      await prisma.bankTransaction.delete({ where: { id: params.id } });

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.id,
          action:     'DELETE',
          entityType: 'BankTransaction',
          entityId:   params.id,
          changes:    { amount: Number(tx.amount), description: tx.description },
        },
      });

      return NextResponse.json({ ok: true });
    }

    // ── UNMATCH ───────────────────────────────────────────────────────────────
    if (action === 'unmatch') {
      if (!tx.matchedAt)
        return NextResponse.json({ error: 'Transaction is not matched' }, { status: 400 });

      // Clear reconciliation from the linked invoice
      const clearRecon = { reconciledAt: null, reconciledById: null };

      await prisma.$transaction(async (trx) => {
        if (tx.matchedSalesInvoiceId) {
          await trx.salesInvoice.update({
            where: { id: tx.matchedSalesInvoiceId },
            data:  clearRecon,
          });
        }
        if (tx.matchedSupplierInvoiceId) {
          await trx.supplierInvoice.update({
            where: { id: tx.matchedSupplierInvoiceId },
            data:  clearRecon,
          });
        }
        await trx.bankTransaction.update({
          where: { id: params.id },
          data: {
            matchedAt:              null,
            matchedById:            null,
            matchedSalesInvoiceId:  null,
            matchedSupplierInvoiceId: null,
          },
        });
      });

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.id,
          action:     'UPDATE',
          entityType: 'BankTransaction',
          entityId:   params.id,
          changes:    { action: 'unmatch' },
        },
      });

      return NextResponse.json({ ok: true });
    }

    // ── MATCH ─────────────────────────────────────────────────────────────────
    if (action === 'match') {
      if (!invoiceType || !invoiceId)
        return NextResponse.json({ error: 'invoiceType and invoiceId required for match' }, { status: 400 });
      if (tx.matchedAt)
        return NextResponse.json({ error: 'Transaction already matched — unmatch first' }, { status: 400 });

      const now = new Date();

      await prisma.$transaction(async (trx) => {
        if (invoiceType === 'sales') {
          const inv = await trx.salesInvoice.findFirst({ where: { id: invoiceId, tenantId: user.tenantId } });
          if (!inv) throw new Error('Sales invoice not found');

          await trx.salesInvoice.update({
            where: { id: invoiceId },
            data:  { reconciledAt: now, reconciledById: user.id },
          });
          await trx.bankTransaction.update({
            where: { id: params.id },
            data:  {
              matchedAt:             now,
              matchedById:           user.id,
              matchedSalesInvoiceId: invoiceId,
            },
          });
        } else {
          const inv = await trx.supplierInvoice.findFirst({ where: { id: invoiceId, tenantId: user.tenantId } });
          if (!inv) throw new Error('Supplier invoice not found');

          await trx.supplierInvoice.update({
            where: { id: invoiceId },
            data:  { reconciledAt: now, reconciledById: user.id },
          });
          await trx.bankTransaction.update({
            where: { id: params.id },
            data:  {
              matchedAt:                 now,
              matchedById:               user.id,
              matchedSupplierInvoiceId:  invoiceId,
            },
          });
        }
      });

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.id,
          action:     'UPDATE',
          entityType: 'BankTransaction',
          entityId:   params.id,
          changes:    { action: 'match', invoiceType, invoiceId },
        },
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[RECON PATCH]', err.message);
    return NextResponse.json({ error: err.message || 'Failed to update transaction' }, { status: 500 });
  }
}
