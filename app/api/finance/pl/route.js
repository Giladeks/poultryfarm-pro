// app/api/finance/pl/route.js
// GET /api/finance/pl?from=2026-01-01&to=2026-03-31&groupBy=month
//
// Computes a full P&L from:
//   Revenue   → SalesInvoice (status: PAID or PARTIALLY_PAID, by amountPaid)
//   COGS/OpEx → SupplierInvoice (status: PAID or PARTIALLY_PAID, by amountPaid)
//               categorised by supplier.supplierType
//
// Returns:
//   summary   — top-level totals
//   revenue   — per-invoice breakdown
//   costs     — per-category breakdown
//   timeline  — grouped by month/week for the sparkline chart

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];

// SupplierType → P&L cost category label
const COST_CATEGORY = {
  FEED:       'Feed & Nutrition',
  MEDICATION: 'Veterinary & Medication',
  CHICKS:     'Day-Old Chicks / Stock',
  EQUIPMENT:  'Equipment & Assets',
  PACKAGING:  'Packaging',
  SERVICES:   'Services & Utilities',
  OTHER:      'Other Costs',
};

// Which SupplierTypes count as COGS vs OpEx (for gross profit split)
const COGS_TYPES = new Set(['FEED','MEDICATION','CHICKS']);

function toNGN(amount, exchangeRate) {
  return parseFloat(amount || 0) * parseFloat(exchangeRate || 1);
}

// Build monthly buckets between from–to
function buildMonthBuckets(from, to) {
  const buckets = {};
  const cur = new Date(from);
  cur.setDate(1);
  const end = new Date(to);
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
    buckets[key] = { label: cur.toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }), revenue: 0, costs: 0 };
    cur.setMonth(cur.getMonth() + 1);
  }
  return buckets;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const from    = searchParams.get('from');
  const to      = searchParams.get('to');

  if (!from || !to)
    return NextResponse.json({ error: 'from and to params required' }, { status: 400 });

  const fromDate = new Date(from);
  const toDate   = new Date(to + 'T23:59:59');

  try {
    // ── Revenue: sales invoices with any payment in period ───────────────────
    const salesInvoices = await prisma.salesInvoice.findMany({
      where: {
        tenantId: user.tenantId,
        status:   { in: ['PAID', 'PARTIALLY_PAID'] },
        // Use paidAt for PAID; invoiceDate for PARTIALLY_PAID (paidAt may be null)
        OR: [
          { paidAt:      { gte: fromDate, lte: toDate } },
          { invoiceDate: { gte: fromDate, lte: toDate }, status: 'PARTIALLY_PAID' },
        ],
      },
      include: {
        customer: { select: { id: true, name: true, customerType: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    // ── Costs: supplier invoices with any payment in period ──────────────────
    const supplierInvoices = await prisma.supplierInvoice.findMany({
      where: {
        tenantId: user.tenantId,
        status:   { in: ['PAID', 'PARTIALLY_PAID'] },
        OR: [
          { paidAt:      { gte: fromDate, lte: toDate } },
          { invoiceDate: { gte: fromDate, lte: toDate }, status: 'PARTIALLY_PAID' },
        ],
      },
      include: {
        supplier: { select: { id: true, name: true, supplierType: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    // ── Compute revenue ───────────────────────────────────────────────────────
    const revenueItems = salesInvoices.map(inv => {
      const amountNGN = toNGN(inv.amountPaid, inv.exchangeRate);
      return {
        id:           inv.id,
        invoiceNumber:inv.invoiceNumber,
        customer:     inv.customer?.name || '—',
        customerType: inv.customer?.customerType || '—',
        invoiceDate:  inv.invoiceDate,
        currency:     inv.currency,
        amount:       parseFloat(inv.amountPaid),
        amountNGN,
        status:       inv.status,
      };
    });

    const totalRevenue = revenueItems.reduce((s, i) => s + i.amountNGN, 0);

    // ── Compute costs by category ─────────────────────────────────────────────
    const costsByCategory = {};
    const costItems = supplierInvoices.map(inv => {
      const supplierType = inv.supplier?.supplierType || 'OTHER';
      const category     = COST_CATEGORY[supplierType] || 'Other Costs';
      const amountNGN    = toNGN(inv.amountPaid, inv.exchangeRate);
      const isCOGS       = COGS_TYPES.has(supplierType);

      if (!costsByCategory[category]) {
        costsByCategory[category] = { category, supplierType, isCOGS, totalNGN: 0, count: 0, items: [] };
      }
      costsByCategory[category].totalNGN += amountNGN;
      costsByCategory[category].count    += 1;

      return {
        id:            inv.id,
        invoiceNumber: inv.invoiceNumber,
        supplier:      inv.supplier?.name || '—',
        supplierType,
        category,
        isCOGS,
        invoiceDate:   inv.invoiceDate,
        currency:      inv.currency,
        amount:        parseFloat(inv.amountPaid),
        amountNGN,
        status:        inv.status,
      };
    });

    const totalCOGS  = costItems.filter(i => i.isCOGS) .reduce((s, i) => s + i.amountNGN, 0);
    const totalOpEx  = costItems.filter(i => !i.isCOGS).reduce((s, i) => s + i.amountNGN, 0);
    const totalCosts = totalCOGS + totalOpEx;

    const grossProfit      = totalRevenue - totalCOGS;
    const netProfit        = totalRevenue - totalCosts;
    const grossMarginPct   = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netMarginPct     = totalRevenue > 0 ? (netProfit   / totalRevenue) * 100 : 0;

    // ── Timeline (monthly buckets) ────────────────────────────────────────────
    const buckets = buildMonthBuckets(from, to);
    revenueItems.forEach(i => {
      const k = monthKey(i.invoiceDate);
      if (buckets[k]) buckets[k].revenue += i.amountNGN;
    });
    costItems.forEach(i => {
      const k = monthKey(i.invoiceDate);
      if (buckets[k]) buckets[k].costs += i.amountNGN;
    });
    const timeline = Object.entries(buckets).map(([key, b]) => ({
      key,
      label:  b.label,
      revenue:b.revenue,
      costs:  b.costs,
      profit: b.revenue - b.costs,
    }));

    return NextResponse.json({
      period: { from, to },
      summary: {
        totalRevenue,
        totalCOGS,
        totalOpEx,
        totalCosts,
        grossProfit,
        netProfit,
        grossMarginPct,
        netMarginPct,
        revenueInvoiceCount: revenueItems.length,
        costInvoiceCount:    costItems.length,
      },
      revenue:        revenueItems,
      costsByCategory: Object.values(costsByCategory).sort((a, b) => b.totalNGN - a.totalNGN),
      costs:          costItems,
      timeline,
    });
  } catch (error) {
    console.error('P&L fetch error:', error);
    return NextResponse.json({ error: 'Failed to compute P&L' }, { status: 500 });
  }
}
