// app/api/finance/sales-invoices/[id]/route.js
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];
const FINANCE_ROLES      = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT'];
// Roles that can notify customers (send invoice)
const FINANCE_NOTIFY_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN'];

const sendSchema = z.object({ action: z.literal('send') });

const paySchema = z.object({
  action:        z.literal('pay'),
  amountPaid:    z.number().positive(),
  paymentMethod: z.string().min(1),
  paymentRef:    z.string().optional().nullable(),
  paidAt:        z.string().optional().nullable(),
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
  sendSchema,
  paySchema,
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
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        customer:    { select: { id: true, name: true, customerType: true, contactName: true, email: true, phone: true, paymentTerms: true } },
        createdBy:   { select: { id: true, firstName: true, lastName: true } },
        approvedBy:  { select: { id: true, firstName: true, lastName: true } },
        reconciledBy:{ select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const now = new Date();
    const due = new Date(invoice.dueDate);
    const daysOverdue = invoice.status === 'OVERDUE'
      ? Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)))
      : 0;
    const balance = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);

    return NextResponse.json({ invoice: { ...invoice, daysOverdue, balance } });
  } catch (error) {
    console.error('Sales invoice GET error:', error);
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

    const invoice = await prisma.salesInvoice.findFirst({
      where:   { id: params.id, tenantId: user.tenantId },
      include: { customer: { select: { name: true, email: true } } },
    });
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    let updateData   = {};
    let auditAction  = 'UPDATE';
    let auditChanges = {};

    // ── SEND ─────────────────────────────────────────────────────────────────
    if (data.action === 'send') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (invoice.status !== 'DRAFT')
        return NextResponse.json({ error: 'Only DRAFT invoices can be sent' }, { status: 400 });

      updateData   = { status: 'SENT' };
      auditAction  = 'UPDATE';
      auditChanges = { from: 'DRAFT', to: 'SENT' };

    // ── PAY ───────────────────────────────────────────────────────────────────
    } else if (data.action === 'pay') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!['SENT','OVERDUE','PARTIALLY_PAID'].includes(invoice.status))
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
        paidAt: newStatus === 'PAID'
          ? (data.paidAt ? new Date(data.paidAt) : new Date())
          : invoice.paidAt,
      };
      auditChanges = { payment: data.amountPaid, totalPaid, newStatus, method: data.paymentMethod };

    // ── VOID ──────────────────────────────────────────────────────────────────
    } else if (data.action === 'void') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (invoice.status === 'PAID')
        return NextResponse.json({ error: 'Cannot void a paid invoice' }, { status: 400 });

      updateData   = { status: 'VOID', notes: `[VOID] ${data.reason}${invoice.notes ? '\n' + invoice.notes : ''}` };
      auditChanges = { action: 'void', reason: data.reason, from: invoice.status };

    // ── REMINDER ─────────────────────────────────────────────────────────────
    } else if (data.action === 'reminder') {
      if (!FINANCE_ROLES.includes(user.role))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (!['SENT','OVERDUE','PARTIALLY_PAID'].includes(invoice.status))
        return NextResponse.json({ error: 'Reminders only apply to unpaid sent invoices' }, { status: 400 });

      const balance    = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
      const due        = new Date(invoice.dueDate);
      const now        = new Date();
      const days       = Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)));
      const overdueStr = days > 0 ? ` (${days} day(s) overdue)` : '';

      // Notify finance team (in-app)
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
            title:       `AR Reminder — ${invoice.invoiceNumber}`,
            message:     `Sales invoice ${invoice.invoiceNumber} for ${invoice.customer.name} has an outstanding balance of ₦${balance.toLocaleString('en-NG')}${overdueStr}. Follow up with the customer.`,
            data:        { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
          })),
        });
      }

      await prisma.paymentReminder.create({
        data: {
          tenantId:       user.tenantId,
          invoiceType:    'SALES',
          salesInvoiceId: invoice.id,
          sentById:       user.sub,
          channel:        data.channel,
          message:        `Payment reminder for ${invoice.invoiceNumber} — balance ${balance}${overdueStr}`,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: user.tenantId, userId: user.sub,
          action: 'UPDATE', entityType: 'SalesInvoice', entityId: invoice.id,
          changes: { action: 'reminder', channel: data.channel, notified: notifyUsers.length },
        },
      });

      return NextResponse.json({ success: true, message: `Reminder sent to ${notifyUsers.length} team member(s)` });
    }

    const updated = await prisma.salesInvoice.update({
      where: { id: invoice.id },
      data:  updateData,
      include: {
        customer:  { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId, userId: user.sub,
        action: auditAction, entityType: 'SalesInvoice', entityId: invoice.id,
        changes: auditChanges,
      },
    });

    return NextResponse.json({ invoice: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 422 });
    console.error('Sales invoice PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update sales invoice' }, { status: 500 });
  }
}
