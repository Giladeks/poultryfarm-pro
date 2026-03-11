// app/api/finance/sales-invoices/[id]/pdf/route.js
// GET /api/finance/sales-invoices/[id]/pdf
// Returns a pdfmake-generated PDF for the given SalesInvoice
// Requires pdfmake v0.2.x — run: npm install pdfmake@0.2.x --legacy-peer-deps

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];

// ── Colours (matches PoultryFarm Pro design system) ──────────────────────────
const PURPLE = '#6c63ff';
const DARK   = '#1e293b';
const MUTED  = '#94a3b8';
const GREEN  = '#16a34a';
const RED    = '#dc2626';
const LIGHT  = '#f8f9ff';
const BORDER = '#e2e8f0';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const fmtCur  = (n, ccy = 'NGN') => {
  // Helvetica only covers basic Latin — use ASCII-safe symbols for all currencies
  const sym = { NGN: 'NGN ', USD: '$', EUR: 'EUR ', GBP: 'GBP ', GHS: 'GHS ', KES: 'KSh ', ZAR: 'R' };
  return `${sym[ccy] || ccy} ${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const STATUS_COLOR = {
  DRAFT:          MUTED,
  SENT:           '#2563eb',
  PARTIALLY_PAID: '#d97706',
  PAID:           GREEN,
  OVERDUE:        RED,
  VOID:           MUTED,
};

// ── pdfmake docDef builder ─────────────────────────────────────────────────────
async function buildDocDef({ invoice, tenant, qrDataUri }) {
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poultryfarm.pro';
  const invoiceUrl = `${appUrl}/finance?inv=${invoice.id}`;
  const now       = new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

  const lineItems  = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  const balance    = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid || 0);
  const isPaid     = invoice.status === 'PAID';
  const isOverdue  = invoice.status === 'OVERDUE';
  const statusColor = STATUS_COLOR[invoice.status] || MUTED;

  // Line items table body
  const liHeader = [
    { text: '#',           bold: true, fontSize: 8, color: '#fff', fillColor: PURPLE, margin: [4,5,4,5], alignment: 'center' },
    { text: 'Description', bold: true, fontSize: 8, color: '#fff', fillColor: PURPLE, margin: [4,5,4,5] },
    { text: 'Qty',         bold: true, fontSize: 8, color: '#fff', fillColor: PURPLE, margin: [4,5,4,5], alignment: 'right' },
    { text: 'Unit',        bold: true, fontSize: 8, color: '#fff', fillColor: PURPLE, margin: [4,5,4,5] },
    { text: 'Unit Price',  bold: true, fontSize: 8, color: '#fff', fillColor: PURPLE, margin: [4,5,4,5], alignment: 'right' },
    { text: 'Total',       bold: true, fontSize: 8, color: '#fff', fillColor: PURPLE, margin: [4,5,4,5], alignment: 'right' },
  ];

  const liRows = lineItems.length > 0
    ? lineItems.map((li, i) => [
        { text: String(i+1),                       fontSize: 8, margin: [4,4,4,4], alignment: 'center', color: MUTED },
        { text: li.description || '',               fontSize: 8, margin: [4,4,4,4] },
        { text: String(li.quantity ?? ''),           fontSize: 8, margin: [4,4,4,4], alignment: 'right' },
        { text: li.unit || '',                      fontSize: 8, margin: [4,4,4,4], color: MUTED },
        { text: fmtCur(li.unitPrice, invoice.currency),  fontSize: 8, margin: [4,4,4,4], alignment: 'right' },
        { text: fmtCur(li.totalPrice, invoice.currency), fontSize: 8, margin: [4,4,4,4], alignment: 'right', bold: true },
      ])
    : [[{ text: 'No line items', colSpan: 6, fontSize: 8, color: MUTED, margin: [4,8,4,8], alignment: 'center' }, {},{},{},{},{}]];

  // Totals rows
  const totalsStack = [
    { columns: [{ text: 'Subtotal',  fontSize: 9, color: MUTED, width: '*' }, { text: fmtCur(invoice.subtotal, invoice.currency),  fontSize: 9, alignment: 'right', width: 120 }], margin: [0,3,0,3] },
    { columns: [{ text: 'Tax',       fontSize: 9, color: MUTED, width: '*' }, { text: fmtCur(invoice.taxAmount, invoice.currency),  fontSize: 9, alignment: 'right', width: 120 }], margin: [0,3,0,3] },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 240, y2: 0, lineWidth: 0.5, lineColor: BORDER }], margin: [0,4,0,4] },
    { columns: [
        { text: 'Total',     fontSize: 11, bold: true, color: DARK,  width: '*' },
        { text: fmtCur(invoice.totalAmount, invoice.currency), fontSize: 11, bold: true, color: PURPLE, alignment: 'right', width: 120 },
      ], margin: [0,3,0,3] },
    { columns: [
        { text: 'Amount Paid', fontSize: 9, color: GREEN, width: '*' },
        { text: fmtCur(invoice.amountPaid, invoice.currency), fontSize: 9, color: GREEN, alignment: 'right', width: 120 },
      ], margin: [0,3,0,3] },
    { columns: [
        { text: 'Balance Due', fontSize: 11, bold: true, color: isPaid ? GREEN : RED, width: '*' },
        { text: fmtCur(balance, invoice.currency), fontSize: 11, bold: true, color: isPaid ? GREEN : RED, alignment: 'right', width: 120 },
      ], margin: [0,3,0,3] },
  ];

  if (invoice.currency !== 'NGN' && parseFloat(invoice.exchangeRate) > 1) {
    const ngnTotal = parseFloat(invoice.totalAmount) * parseFloat(invoice.exchangeRate);
    totalsStack.push({
      text: `≈ NGN equivalent: ${fmtCur(ngnTotal, 'NGN')} at rate ×${invoice.exchangeRate}`,
      fontSize: 8, color: MUTED, margin: [0,4,0,0], italics: true,
    });
  }

  // Payment info box (if paid or partially paid)
  const paymentInfo = (invoice.paymentRef || invoice.paymentMethod || invoice.paidAt) ? {
    margin: [0,0,0,20],
    table: { widths: ['*'], body: [[
      {
        stack: [
          { text: '💳  Payment Details', bold: true, fontSize: 9, color: PURPLE, margin: [0,0,0,6] },
          invoice.paidAt       ? { columns: [{ text: 'Paid On',    fontSize: 8, color: MUTED, width: 80 }, { text: fmtDate(invoice.paidAt),     fontSize: 8, width: '*' }], margin:[0,2,0,2] } : null,
          invoice.paymentMethod? { columns: [{ text: 'Method',     fontSize: 8, color: MUTED, width: 80 }, { text: invoice.paymentMethod,        fontSize: 8, width: '*' }], margin:[0,2,0,2] } : null,
          invoice.paymentRef   ? { columns: [{ text: 'Reference',  fontSize: 8, color: MUTED, width: 80 }, { text: invoice.paymentRef,           fontSize: 8, width: '*' }], margin:[0,2,0,2] } : null,
        ].filter(Boolean),
        margin: [12,10,12,10],
        fillColor: '#f0fdf4',
      }
    ]]},
    layout: 'noBorders',
  } : null;


  const farmName   = tenant.farmName || 'PoultryFarm Pro';
  const farmAddr   = tenant.address  || '';
  const farmPhone  = tenant.phone    || '';
  const farmEmail  = tenant.email    || '';
  const customerName = invoice.customer?.name || '—';
  const customerAddr = invoice.customer?.address || '';
  const customerPhone= invoice.customer?.phone  || '';
  const customerEmail= invoice.customer?.email  || '';

  return {
    pageSize:        'A4',
    pageOrientation: 'portrait',
    pageMargins:     [40, 60, 40, 50],

    defaultStyle: { font: 'Helvetica', fontSize: 9, color: DARK, lineHeight: 1.3 },

    header: () => ({
      margin: [40, 14, 40, 0],
      columns: [
        { text: 'PoultryFarm Pro', fontSize: 9, bold: true, color: PURPLE },
        { text: `Generated: ${now}`, fontSize: 8, color: MUTED, alignment: 'right' },
      ],
    }),

    footer: (currentPage, pageCount) => ({
      margin: [40, 0, 40, 14],
      columns: [
        { text: `${invoice.invoiceNumber} — ${farmName}`, fontSize: 7, color: MUTED },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: MUTED, alignment: 'right' },
      ],
    }),

    content: [
      // ── Header: Farm info left, QR right ────────────────────────────────────
      {
        columns: [
          {
            stack: [
              { text: farmName, fontSize: 18, bold: true, color: DARK },
              farmAddr  ? { text: farmAddr,   fontSize: 9, color: MUTED, margin: [0,2,0,0] } : null,
              farmPhone ? { text: farmPhone,  fontSize: 9, color: MUTED, margin: [0,1,0,0] } : null,
              farmEmail ? { text: farmEmail,  fontSize: 9, color: MUTED, margin: [0,1,0,0] } : null,
            ].filter(Boolean),
            width: '*',
          },
          {
            stack: [
              { image: qrDataUri, width: 52, height: 52, alignment: 'right' },
              { text: 'Scan to view', fontSize: 6, color: MUTED, alignment: 'right', margin: [0,2,0,0] },
            ],
            width:     'auto',
          },
        ],
        margin: [0, 0, 0, 16],
      },

      // ── Divider ──────────────────────────────────────────────────────────────
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: PURPLE }], margin: [0, 0, 0, 16] },

      // ── Invoice title + status ────────────────────────────────────────────────
      {
        columns: [
          {
            stack: [
              { text: 'SALES INVOICE', fontSize: 22, bold: true, color: DARK },
              { text: invoice.invoiceNumber, fontSize: 13, color: PURPLE, bold: true, margin: [0, 4, 0, 0] },
            ],
          },
          {
            stack: [
              { text: invoice.status.replace('_', ' '), fontSize: 12, bold: true, color: statusColor, alignment: 'right' },
              isOverdue ? { text: 'OVERDUE', fontSize: 9, bold: true, color: RED, alignment: 'right', margin: [0, 2, 0, 0] } : null,
            ].filter(Boolean),
            width: 120,
          },
        ],
        margin: [0, 0, 0, 20],
      },

      // ── Bill to / invoice meta ────────────────────────────────────────────────
      {
        columns: [
          {
            stack: [
              { text: 'BILL TO', fontSize: 7, bold: true, color: MUTED, letterSpacing: 1 },
              { text: customerName,  fontSize: 11, bold: true, color: DARK,  margin: [0,4,0,0] },
              customerAddr  ? { text: customerAddr,  fontSize: 9, color: MUTED, margin: [0,2,0,0] } : null,
              customerPhone ? { text: customerPhone, fontSize: 9, color: MUTED, margin: [0,1,0,0] } : null,
              customerEmail ? { text: customerEmail, fontSize: 9, color: MUTED, margin: [0,1,0,0] } : null,
            ].filter(Boolean),
            width: '*',
          },
          {
            table: {
              widths: [80, '*'],
              body: [
                [{ text: 'Invoice Date', fontSize: 8, color: MUTED, margin: [4,4,4,4] }, { text: fmtDate(invoice.invoiceDate), fontSize: 8, bold: true, margin: [4,4,4,4] }],
                [{ text: 'Due Date',     fontSize: 8, color: MUTED, margin: [4,4,4,4] }, { text: fmtDate(invoice.dueDate),     fontSize: 8, bold: true, color: isOverdue ? RED : DARK, margin: [4,4,4,4] }],
                [{ text: 'Currency',     fontSize: 8, color: MUTED, margin: [4,4,4,4] }, { text: invoice.currency,             fontSize: 8, bold: true, color: PURPLE, margin: [4,4,4,4] }],
                invoice.createdBy ? [
                  { text: 'Issued By', fontSize: 8, color: MUTED, margin: [4,4,4,4] },
                  { text: `${invoice.createdBy.firstName} ${invoice.createdBy.lastName}`, fontSize: 8, margin: [4,4,4,4] },
                ] : null,
              ].filter(Boolean),
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0,
              hLineColor: () => BORDER,
              fillColor:  (i) => i % 2 === 0 ? LIGHT : '#ffffff',
            },
            width: 220,
          },
        ],
        margin: [0, 0, 0, 20],
      },

      // ── Line items table ──────────────────────────────────────────────────────
      { text: 'LINE ITEMS', fontSize: 7, bold: true, color: MUTED, letterSpacing: 1, margin: [0, 0, 0, 6] },
      {
        margin: [0, 0, 0, 16],
        table: {
          headerRows: 1,
          widths: [20, '*', 35, 35, 70, 70],
          body: [liHeader, ...liRows],
        },
        layout: {
          hLineWidth: (i) => (i === 0 || i === 1) ? 0 : 0.5,
          vLineWidth: () => 0,
          hLineColor: () => BORDER,
          fillColor:  (i) => i === 0 ? PURPLE : (i % 2 === 0 ? LIGHT : '#ffffff'),
        },
      },

      // ── Totals (right-aligned) ────────────────────────────────────────────────
      { columns: [{ text: '', width: '*' }, { stack: totalsStack, width: 240 }], margin: [0, 0, 0, 20] },

      // ── Payment info (conditional) ────────────────────────────────────────────
      paymentInfo,

      // ── Notes ─────────────────────────────────────────────────────────────────
      invoice.notes ? {
        stack: [
          { text: 'NOTES', fontSize: 7, bold: true, color: MUTED, letterSpacing: 1, margin: [0, 0, 0, 4] },
          { text: invoice.notes, fontSize: 9, color: DARK, italics: true },
        ],
        margin: [0, 0, 0, 20],
      } : null,

      // ── Footer note ───────────────────────────────────────────────────────────
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: BORDER }],
        margin: [0, 0, 0, 8],
      },
      { text: 'Thank you for your business.', fontSize: 9, color: MUTED, alignment: 'center', italics: true },
    ].filter(Boolean),
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [invoice, tenant] = await Promise.all([
      prisma.salesInvoice.findFirst({
        where:   { id: params.id, tenantId: user.tenantId },
        include: {
          customer:  { select: { name: true, address: true, phone: true, email: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.tenant.findUnique({
        where:  { id: user.tenantId },
        select: { farmName: true, logoUrl: true, address: true, phone: true, email: true },
      }),
    ]);

    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // ── Try pdfmake v0.2.x ───────────────────────────────────────────────────
    let PdfPrinter;
    try {
      PdfPrinter = (await import('pdfmake/src/printer.js')).default;
    } catch {
      return NextResponse.json({ error: 'pdfmake not available. Run: npm install pdfmake@0.2.x --legacy-peer-deps' }, { status: 500 });
    }

    const fonts = {
      Helvetica: {
        normal:      'Helvetica',
        bold:        'Helvetica-Bold',
        italics:     'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    };

    const printer = new PdfPrinter(fonts);

    // Generate QR code as PNG data URI (requires: npm install qrcode)
    const appUrl     = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poultryfarm.pro';
    const invoiceUrl = `${appUrl}/finance?inv=${invoice.id}`;
    let qrDataUri;
    try {
      const QRCode = (await import('qrcode')).default;
      qrDataUri = await QRCode.toDataURL(invoiceUrl, { width: 104, margin: 1, color: { dark: '#1e293b', light: '#ffffff' } });
    } catch {
      // qrcode not installed — fall back to a blank white PNG
      qrDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
    }

    const docDef  = await buildDocDef({ invoice, tenant: tenant || {}, qrDataUri });
    const pdfDoc  = printer.createPdfKitDocument(docDef);

    const chunks = [];
    await new Promise((resolve, reject) => {
      pdfDoc.on('data',  chunk => chunks.push(chunk));
      pdfDoc.on('end',   resolve);
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });

    const pdfBuffer = Buffer.concat(chunks);
    const filename  = `${invoice.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;

    return new NextResponse(pdfBuffer, {
      status:  200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(pdfBuffer.length),
      },
    });
  } catch (err) {
    console.error('[SALES INVOICE PDF]', err);
    return NextResponse.json({ error: err.message || 'Failed to generate PDF' }, { status: 500 });
  }
}



