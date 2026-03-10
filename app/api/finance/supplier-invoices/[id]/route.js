// app/api/finance/supplier-invoices/[id]/route.js
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const FINANCE_VIEW_ROLES     = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];
const FINANCE_ROLES          = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT'];
const INVOICE_APPROVAL_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','FARM_MANAGER'];

// ─── Reminder recipient roles — INTERNAL_CONTROL/ACCOUNTANT may not exist in
//     UserRole enum yet (Phase 7 migration). Filter by roles that are confirmed
//     in the current enum to avoid Prisma validation errors.
const FINANCE_NOTIFY_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN'];

const approveSchema = z.object({ action: z.literal('approve') });

const paySchema = z.object({
  action:        z.literal('pay'),
  amountPaid:    z.number().positive(),
  paymentMethod: z.string().min(1),
  paymentRef:    z.string().optional().nullable(),
  paidAt:        z.string().optional().nullable(),
});

const disputeSchema = z.object({
  action: z.literal('dispute'),
  reason: z.string().min(3),
});

const voidSchema = z.object({
  action: z.literal('void'),
  reason: z.string().min(3),
});

const reminderSchema = z.object({
  action:  z.literal('reminder'),
  channel: z.enum(['IN_APP','EMAIL']).default('IN_APP'),
});

const patchSchema = z.discriminatedUnion('action', [
  approveSchema,
  paySchema,
  disputeSchema,
  voidSchema,
  reminderSchema,
]);

export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const invoice = await prisma.supplierInvoice.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        supplier:    { select: { id: true, name: true, contactName: true, email: true, phone: true, bankName: true, bankAccount: true } },
        createdBy:   { select: { id: true, firstName: true, lastName: true } },
        approvedBy:  { select: { id: true, firstName: true, lastName: true } },
        reconciledBy:{ select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // Fetch linked receipt manually (no Prisma relation)
    let linkedReceipt = null;
    if (invoice.linkedReceiptId) {
      linkedReceipt = await prisma.storeReceipt.findUnique({
        where:  { id: invoice.linkedReceiptId },
        select: { id: true, batchNumber: true, receiptDate: true, quantityReceived: true, totalCost: true },
      });
    }

    const now = new Date();
    const due = new Date(invoice.dueDate);
    const daysOverdue = ['OVERDUE','DISPUTED'].includes(invoice.status)
      ? Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)))
      : 0;
    const balance = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);

    return NextResponse.json({ invoice: { ...invoice, linkedReceipt, daysOverdue, balance } });
  } catch (error) {
    console.error('Supplier invoice GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch invoice' }, { status: 500 });
  }
}

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    const invoice = await prisma.supplierInvoice.findFirst({
      where:   { id: params.id, tenantId: user.tenantId },
      include: { supplier: { select: { name: true } } },
    });
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    let updateData   = {};
    let auditAction  = 'UPDATE'; // default — AuditAction enum only has UPDATE for most mutations
    let auditChanges = {};

    // ── APPROVE ──────────────────────────────────────────────────────────────
    if (data.action === 'approve') {
      if (!INVOICE_APPROVAL_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Insufficient permissions to approve invoices' }, { status: 403 });
      if (!['PENDING'].includes(invoice.status))
        return NextResponse.json({ error: `Cannot approve an invoice with status ${invoice.status}` }, { status: 400 });

      updateData   = { status: 'APPROVED', approvedById: user.sub, approvedAt: new Date() };
      auditAction  = 'APPROVE';
      auditChanges = { from: invoice.status, to: 'APPROVED' };

    // ── PAY ───────────────────────────────────────────────────────────────────
    } else if (data.action === 'pay') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Insufficient permissions to record payments' }, { status: 403 });
      if (!['APPROVED','OVERDUE','PARTIALLY_PAID'].includes(invoice.status))
        return NextResponse.json({ error: `Cannot record payment on invoice with status ${invoice.status}` }, { status: 400 });

      const totalPaid = parseFloat(invoice.amountPaid) + data.amountPaid;
      const totalAmt  = parseFloat(invoice.totalAmount);
      const newStatus = totalPaid >= totalAmt ? 'PAID'
        : totalPaid > 0 ? 'PARTIALLY_PAID'
        : invoice.status;

      updateData = {
        amountPaid:    totalPaid,
        status:        newStatus,
        paymentMethod: data.paymentMethod,
        paymentRef:    data.paymentRef || null,
        paidAt:        newStatus === 'PAID'
          ? (data.paidAt ? new Date(data.paidAt) : new Date())
          : invoice.paidAt,
      };
      auditAction  = 'UPDATE';
      auditChanges = { payment: data.amountPaid, totalPaid, newStatus, method: data.paymentMethod };

    // ── DISPUTE ───────────────────────────────────────────────────────────────
    } else if (data.action === 'dispute') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (['PAID','VOID'].includes(invoice.status))
        return NextResponse.json({ error: 'Cannot dispute a paid or void invoice' }, { status: 400 });

      updateData   = { status: 'DISPUTED', notes: `[DISPUTED] ${data.reason}${invoice.notes ? '\n' + invoice.notes : ''}` };
      auditAction  = 'UPDATE';
      auditChanges = { action: 'dispute', reason: data.reason, from: invoice.status };

    // ── VOID ──────────────────────────────────────────────────────────────────
    } else if (data.action === 'void') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (invoice.status === 'PAID')
        return NextResponse.json({ error: 'Cannot void a paid invoice' }, { status: 400 });

      updateData   = { status: 'VOID', notes: `[VOID] ${data.reason}${invoice.notes ? '\n' + invoice.notes : ''}` };
      auditAction  = 'UPDATE';
      auditChanges = { action: 'void', reason: data.reason, from: invoice.status };

    // ── REMINDER ─────────────────────────────────────────────────────────────
    } else if (data.action === 'reminder') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!['APPROVED','OVERDUE','PARTIALLY_PAID'].includes(invoice.status))
        return NextResponse.json({ error: 'Reminders only apply to unpaid approved invoices' }, { status: 400 });

      const balance    = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
      const due        = new Date(invoice.dueDate);
      const now        = new Date();
      const days       = Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)));
      const overdueStr = days > 0 ? ` (${days} day(s) overdue)` : ' (due today)';

      // Notify confirmed-enum finance roles only — ACCOUNTANT/INTERNAL_CONTROL
      // may not be in UserRole enum yet depending on migration state
      const notifyUsers = await prisma.user.findMany({
        where:  { tenantId: user.tenantId, role: { in: FINANCE_NOTIFY_ROLES }, isActive: true },
        select: { id: true },
      });

      if (notifyUsers.length > 0) {
        await prisma.notification.createMany({
          data: notifyUsers.map(u => ({
            tenantId:    user.tenantId,
            recipientId: u.id,
            type:        'ALERT',
            channel:     'IN_APP',
            title:       `Payment Reminder — ${invoice.invoiceNumber}`,
            message:     `Supplier invoice ${invoice.invoiceNumber} from ${invoice.supplier.name} has a balance of ₦${balance.toLocaleString('en-NG')}${overdueStr}. Please arrange payment.`,
            data:        { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
          })),
        });
      }

      // Log the reminder in PaymentReminder table
      await prisma.paymentReminder.create({
        data: {
          tenantId:          user.tenantId,
          invoiceType:       'SUPPLIER',
          supplierInvoiceId: invoice.id,
          sentById:          user.sub,
          channel:           data.channel,
          message:           `Payment reminder for ${invoice.invoiceNumber} — balance ${balance}${overdueStr}`,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId:   user.tenantId,
          userId:     user.sub,
          action:     'UPDATE',
          entityType: 'SupplierInvoice',
          entityId:   invoice.id,
          changes:    { action: 'reminder', channel: data.channel, notified: notifyUsers.length },
        },
      });

      return NextResponse.json({
        success: true,
        message: `Payment reminder sent to ${notifyUsers.length} team member(s)`,
      });
    }

    const updated = await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data:  updateData,
      include: {
        supplier:  { select: { id: true, name: true } },
        approvedBy:{ select: { firstName: true, lastName: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     auditAction,
        entityType: 'SupplierInvoice',
        entityId:   invoice.id,
        changes:    auditChanges,
      },
    });

    return NextResponse.json({ invoice: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 422 });
    console.error('Supplier invoice PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update supplier invoice' }, { status: 500 });
  }
}
