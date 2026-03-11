// lib/services/invoiceEmail.js
// Invoice-specific email templates for PoultryFarm Pro finance module.
//
// Exports:
//   sendInvoiceEmail(invoice, tenant)        — AR: sends invoice to customer on "Mark as Sent"
//   sendArReminderEmail(invoice, tenant)     — AR: payment reminder to customer
//   sendApReminderEmail(invoice, tenant)     — AP: payment reminder to internal finance team

import { sendEmail } from './notifications.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const PURPLE   = '#6c63ff';
const DARK     = '#111827';
const MUTED    = '#6b7280';
const RED      = '#dc2626';
const GREEN    = '#16a34a';
const BG_LIGHT = '#f9fafb';
const BORDER   = '#e5e7eb';

function fmtAmount(n, currency = 'NGN') {
  const num = parseFloat(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${num}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function emailShell({ title, preheader, body }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poultryfarm.pro';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:24px 16px;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <!--[if mso]><table width="600" align="center"><tr><td><![endif]-->
  <div style="max-width:600px;margin:0 auto;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,${PURPLE} 0%,#4f46e5 100%);padding:28px 32px;border-radius:12px 12px 0 0;">
      <p style="margin:0 0 4px;color:#c7d2fe;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">PoultryFarm Pro</p>
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3">${title}</h1>
      ${preheader ? `<p style="margin:8px 0 0;color:#e0e7ff;font-size:13px">${preheader}</p>` : ''}
    </div>

    <!-- Body -->
    <div style="background:#ffffff;padding:28px 32px;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};">
      ${body}
    </div>

    <!-- Footer -->
    <div style="background:${BG_LIGHT};padding:16px 32px 24px;border:1px solid ${BORDER};border-top:none;border-radius:0 0 12px 12px;">
      <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.6">
        This email was sent via <a href="${appUrl}" style="color:${PURPLE};text-decoration:none">PoultryFarm Pro</a>.
        If you have questions, reply to this email or contact the farm directly.
      </p>
    </div>

  </div>
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`;
}

function infoTable(rows) {
  const cells = rows.map(([label, value, highlight]) => `
    <tr>
      <td style="padding:7px 0;color:${MUTED};font-size:13px;width:44%;vertical-align:top">${label}</td>
      <td style="padding:7px 0;font-size:13px;font-weight:600;color:${highlight ? highlight : DARK};vertical-align:top">${value}</td>
    </tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">${cells}</table>`;
}

function ctaButton(label, url) {
  return `<div style="margin:24px 0 8px">
    <a href="${url}" style="display:inline-block;background:${PURPLE};color:#ffffff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">${label}</a>
  </div>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid ${BORDER};margin:20px 0">`;
}

function lineItemsTable(lineItems = []) {
  if (!lineItems.length) return '';
  const rows = lineItems.map((li, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : BG_LIGHT}">
      <td style="padding:8px 10px;font-size:12px;color:${DARK}">${li.description || '—'}</td>
      <td style="padding:8px 10px;font-size:12px;color:${MUTED};text-align:center">${li.quantity} ${li.unit || ''}</td>
      <td style="padding:8px 10px;font-size:12px;color:${DARK};text-align:right">${parseFloat(li.unitPrice || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
      <td style="padding:8px 10px;font-size:12px;font-weight:600;color:${DARK};text-align:right">${parseFloat(li.totalPrice || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</td>
    </tr>`).join('');
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:13px;border:1px solid ${BORDER};border-radius:8px;overflow:hidden">
    <thead>
      <tr style="background:${PURPLE}">
        <th style="padding:9px 10px;color:#fff;font-size:11px;text-align:left;font-weight:700">Description</th>
        <th style="padding:9px 10px;color:#fff;font-size:11px;text-align:center;font-weight:700">Qty</th>
        <th style="padding:9px 10px;color:#fff;font-size:11px;text-align:right;font-weight:700">Unit Price</th>
        <th style="padding:9px 10px;color:#fff;font-size:11px;text-align:right;font-weight:700">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ── AR: Send Invoice to Customer ───────────────────────────────────────────────

export async function sendInvoiceEmail(invoice, tenant = {}) {
  const customerEmail = invoice.customer?.email;
  if (!customerEmail) return { skipped: true, reason: 'No customer email on file' };

  const appUrl     = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poultryfarm.pro';
  const invoiceUrl = `${appUrl}/finance?inv=${invoice.id}`;
  const farmName   = tenant.farmName || 'PoultryFarm Pro';
  const balance    = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid || 0);
  const lineItems  = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${DARK}">
      Dear <strong>${invoice.customer?.contactName || invoice.customer?.name || 'Valued Customer'}</strong>,
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6">
      Please find your invoice from <strong>${farmName}</strong> below. Kindly arrange payment before the due date.
    </p>

    ${infoTable([
      ['Invoice Number', invoice.invoiceNumber, PURPLE],
      ['Invoice Date',   fmtDate(invoice.invoiceDate)],
      ['Due Date',       fmtDate(invoice.dueDate), RED],
      ['Currency',       invoice.currency || 'NGN'],
      ['Payment Terms',  invoice.customer?.paymentTerms || '—'],
    ])}

    ${divider()}
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${MUTED}">Line Items</p>
    ${lineItemsTable(lineItems)}

    ${infoTable([
      ['Subtotal', fmtAmount(invoice.subtotal,     invoice.currency)],
      ['Tax',      fmtAmount(invoice.taxAmount,    invoice.currency)],
    ])}
    <div style="background:${BG_LIGHT};border:1px solid ${BORDER};border-radius:8px;padding:14px 16px;margin:8px 0 20px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td style="font-size:15px;font-weight:700;color:${DARK}">Total Amount Due</td>
          <td style="font-size:17px;font-weight:700;color:${PURPLE};text-align:right">${fmtAmount(invoice.totalAmount, invoice.currency)}</td>
        </tr>
        ${parseFloat(invoice.amountPaid) > 0 ? `
        <tr>
          <td style="font-size:13px;color:${GREEN};padding-top:6px">Amount Received</td>
          <td style="font-size:13px;color:${GREEN};text-align:right;padding-top:6px">${fmtAmount(invoice.amountPaid, invoice.currency)}</td>
        </tr>
        <tr>
          <td style="font-size:14px;font-weight:700;color:${RED};padding-top:6px">Balance Due</td>
          <td style="font-size:15px;font-weight:700;color:${RED};text-align:right;padding-top:6px">${fmtAmount(balance, invoice.currency)}</td>
        </tr>` : ''}
      </table>
    </div>

    ${invoice.notes ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#1e40af">${invoice.notes}</div>` : ''}

    ${ctaButton('View Invoice Online', invoiceUrl)}
    ${divider()}
    <p style="margin:0;font-size:13px;color:${MUTED};font-style:italic">Thank you for your business.</p>
  `;

  const html = emailShell({
    title:     `Invoice ${invoice.invoiceNumber}`,
    preheader: `${fmtAmount(invoice.totalAmount, invoice.currency)} due by ${fmtDate(invoice.dueDate)}`,
    body,
  });

  const text = `Invoice ${invoice.invoiceNumber} from ${farmName}\n\nAmount Due: ${fmtAmount(invoice.totalAmount, invoice.currency)}\nDue Date: ${fmtDate(invoice.dueDate)}\n\nView online: ${invoiceUrl}`;

  return sendEmail({
    to:      customerEmail,
    subject: `Invoice ${invoice.invoiceNumber} from ${farmName} — ${fmtAmount(invoice.totalAmount, invoice.currency)} due ${fmtDate(invoice.dueDate)}`,
    html,
    text,
  });
}

// ── AR: Payment Reminder to Customer ──────────────────────────────────────────

export async function sendArReminderEmail(invoice, tenant = {}) {
  const customerEmail = invoice.customer?.email;
  if (!customerEmail) return { skipped: true, reason: 'No customer email on file' };

  const appUrl     = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poultryfarm.pro';
  const invoiceUrl = `${appUrl}/finance?inv=${invoice.id}`;
  const farmName   = tenant.farmName || 'PoultryFarm Pro';
  const balance    = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid || 0);
  const now        = new Date();
  const due        = new Date(invoice.dueDate);
  const daysOverdue = Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)));
  const isOverdue  = daysOverdue > 0;

  const urgencyColour = daysOverdue > 14 ? RED : daysOverdue > 0 ? '#d97706' : PURPLE;
  const overdueLabel  = isOverdue
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:${RED};font-size:13px;font-weight:600">
        ⚠ This invoice is <strong>${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue</strong>. Please arrange payment immediately.
       </div>`
    : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:#92400e;font-size:13px">
        This is a friendly reminder that payment is due on <strong>${fmtDate(invoice.dueDate)}</strong>.
       </div>`;

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${DARK}">
      Dear <strong>${invoice.customer?.contactName || invoice.customer?.name || 'Valued Customer'}</strong>,
    </p>

    ${overdueLabel}

    ${infoTable([
      ['Invoice Number', invoice.invoiceNumber,                              PURPLE],
      ['Invoice Date',   fmtDate(invoice.invoiceDate)],
      ['Due Date',       fmtDate(invoice.dueDate),                          isOverdue ? RED : DARK],
      ['Original Total', fmtAmount(invoice.totalAmount, invoice.currency)],
      ['Amount Received',fmtAmount(invoice.amountPaid,  invoice.currency), GREEN],
    ])}

    <div style="background:${BG_LIGHT};border:2px solid ${urgencyColour};border-radius:8px;padding:16px;margin:16px 0 24px;text-align:center">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${MUTED}">Outstanding Balance</p>
      <p style="margin:0;font-size:26px;font-weight:700;color:${urgencyColour}">${fmtAmount(balance, invoice.currency)}</p>
    </div>

    ${ctaButton('Pay Now / View Invoice', invoiceUrl)}
    ${divider()}
    <p style="margin:0;font-size:13px;color:${MUTED}">
      If you have already made this payment, please disregard this reminder or reply with your payment reference so we can update your account.
    </p>
  `;

  const html = emailShell({
    title:     isOverdue ? `Overdue: Invoice ${invoice.invoiceNumber}` : `Payment Reminder: Invoice ${invoice.invoiceNumber}`,
    preheader: `Balance of ${fmtAmount(balance, invoice.currency)} ${isOverdue ? `is ${daysOverdue} days overdue` : `due ${fmtDate(invoice.dueDate)}`}`,
    body,
  });

  const text = `Payment Reminder — ${invoice.invoiceNumber}\n\nOutstanding Balance: ${fmtAmount(balance, invoice.currency)}\nDue: ${fmtDate(invoice.dueDate)}${isOverdue ? ` (${daysOverdue} days overdue)` : ''}\n\n${invoiceUrl}`;

  return sendEmail({
    to:      customerEmail,
    subject: isOverdue
      ? `OVERDUE ${daysOverdue}d: Invoice ${invoice.invoiceNumber} — ${fmtAmount(balance, invoice.currency)} outstanding`
      : `Payment Reminder: Invoice ${invoice.invoiceNumber} — ${fmtAmount(balance, invoice.currency)} due ${fmtDate(invoice.dueDate)}`,
    html,
    text,
  });
}

// ── AP: Payment Due Reminder to Finance Team ───────────────────────────────────
// Sends to finance team members (emails passed in as array) to remind them
// that a supplier invoice needs to be paid.

export async function sendApReminderEmail(invoice, tenant = {}, recipientEmails = []) {
  if (!recipientEmails.length) return { skipped: true, reason: 'No recipient emails' };

  const appUrl     = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poultryfarm.pro';
  const invoiceUrl = `${appUrl}/finance?sinv=${invoice.id}`;
  const farmName   = tenant.farmName || 'PoultryFarm Pro';
  const balance    = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid || 0);
  const now        = new Date();
  const due        = new Date(invoice.dueDate);
  const daysOverdue = Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)));
  const isOverdue  = daysOverdue > 0;

  const urgencyColour = daysOverdue > 14 ? RED : daysOverdue > 0 ? '#d97706' : PURPLE;

  const body = `
    <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">
      This is an internal reminder that a supplier invoice from <strong>${invoice.supplier?.name || 'Unknown Supplier'}</strong> requires payment.
    </p>

    ${isOverdue ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:${RED};font-size:13px;font-weight:600">
      ⚠ Payment is <strong>${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue</strong>. Please process immediately to avoid supplier disputes.
    </div>` : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:#92400e;font-size:13px">
      Payment is due on <strong>${fmtDate(invoice.dueDate)}</strong>. Please process before the due date.
    </div>`}

    ${infoTable([
      ['Supplier',        invoice.supplier?.name || '—'],
      ['Invoice Number',  invoice.invoiceNumber,         PURPLE],
      ['Invoice Date',    fmtDate(invoice.invoiceDate)],
      ['Due Date',        fmtDate(invoice.dueDate),      isOverdue ? RED : DARK],
      ['Payment Method',  invoice.supplier?.bankName ? `${invoice.supplier.bankName}` : '—'],
      ['Bank Account',    invoice.supplier?.bankAccount || '—'],
    ])}

    <div style="background:${BG_LIGHT};border:2px solid ${urgencyColour};border-radius:8px;padding:16px;margin:16px 0 24px;text-align:center">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${MUTED}">Amount to Pay</p>
      <p style="margin:0;font-size:26px;font-weight:700;color:${urgencyColour}">${fmtAmount(balance, invoice.currency)}</p>
    </div>

    ${ctaButton('View Invoice in App', invoiceUrl)}
    ${divider()}
    <p style="margin:0;font-size:12px;color:${MUTED}">Sent on behalf of <strong>${farmName}</strong> finance management system.</p>
  `;

  const html = emailShell({
    title:     `AP Payment ${isOverdue ? 'OVERDUE' : 'Due'}: ${invoice.invoiceNumber}`,
    preheader: `${invoice.supplier?.name} — ${fmtAmount(balance, invoice.currency)} ${isOverdue ? `${daysOverdue}d overdue` : `due ${fmtDate(invoice.dueDate)}`}`,
    body,
  });

  const text = `AP Payment Reminder — ${invoice.invoiceNumber}\nSupplier: ${invoice.supplier?.name}\nAmount: ${fmtAmount(balance, invoice.currency)}\nDue: ${fmtDate(invoice.dueDate)}\n\n${invoiceUrl}`;

  return sendEmail({
    to:      recipientEmails.join(', '),
    subject: isOverdue
      ? `AP OVERDUE ${daysOverdue}d: ${invoice.invoiceNumber} — ${invoice.supplier?.name} — ${fmtAmount(balance, invoice.currency)}`
      : `AP Payment Due: ${invoice.invoiceNumber} — ${invoice.supplier?.name} — ${fmtAmount(balance, invoice.currency)}`,
    html,
    text,
  });
}
