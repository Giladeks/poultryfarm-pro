// app/api/reports/pdf/route.js
// GET /api/reports/pdf?type=egg_production&from=2026-01-01&to=2026-03-31
//
// Generates a branded PDF server-side using pdfmake.
// Requires: npm install pdfmake
//
// Supported types:
//   egg_production | mortality | feed_consumption
//   flock_summary  | financial | health_vaccination

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

// ── Role guards per report type ───────────────────────────────────────────────
const REPORT_ROLES = {
  egg_production:    ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
  mortality:         ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
  feed_consumption:  ['STORE_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
  flock_summary:     ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
  financial:         ['CHAIRPERSON','FARM_ADMIN','SUPER_ADMIN'],
  health_vaccination:['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const PURPLE  = '#6c63ff';
const DARK    = '#1e293b';
const MUTED   = '#64748b';
const BORDER  = '#e2e8f0';
const RED     = '#ef4444';
const GREEN   = '#16a34a';
const AMBER   = '#f59e0b';
const BLUE    = '#3b82f6';

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '—';
const fmtNum  = n => Number(n || 0).toLocaleString('en-NG');
const fmtCur  = n => `NGN ${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits:2 })}`;
const fmtPct  = n => `${Number(n || 0).toFixed(1)}%`;

// ── PDF document builder ──────────────────────────────────────────────────────
function buildDocDef({ title, subtitle, farmName, dateRange, sections, meta = [] }) {
  const now = new Date().toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' });

  return {
    pageSize:        'A4',
    pageOrientation: 'landscape',
    pageMargins:     [36, 60, 36, 48],

    header: (currentPage, pageCount) => ({
      columns: [
        {
          stack: [
            { text: 'PoultryFarm Pro', fontSize: 10, color: PURPLE, bold: true, margin: [36, 16, 0, 0] },
            { text: farmName, fontSize: 8, color: MUTED, margin: [36, 2, 0, 0] },
          ],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: 'right',
          fontSize: 8,
          color: MUTED,
          margin: [0, 20, 36, 0],
        },
      ],
    }),

    footer: {
      columns: [
        { text: `Generated ${now}`, fontSize: 7, color: MUTED, margin: [36, 0, 0, 0] },
        { text: 'CONFIDENTIAL — Internal Use Only', alignment: 'right', fontSize: 7, color: MUTED, margin: [0, 0, 36, 0] },
      ],
    },

    content: [
      // ── Cover block ──────────────────────────────────────────
      {
        canvas: [{ type: 'rect', x: 0, y: 0, w: 759, h: 6, color: PURPLE }],
        margin: [0, 0, 0, 20],
      },
      { text: title, fontSize: 20, bold: true, color: DARK, fontFamily: 'Helvetica' },
      { text: subtitle || '', fontSize: 11, color: MUTED, margin: [0, 4, 0, 0] },
      {
        columns: [
          { text: `Farm: ${farmName}`, fontSize: 9, color: MUTED },
          { text: `Period: ${dateRange}`, fontSize: 9, color: MUTED, alignment: 'right' },
        ],
        margin: [0, 8, 0, 0],
      },

      // ── Meta chips (summary KPIs) ─────────────────────────────
      ...(meta.length > 0 ? [
        {
          margin: [0, 16, 0, 24],
          columns: meta.map(m => ({
            stack: [
              { text: m.label, fontSize: 7, color: MUTED, bold: true, characterSpacing: 0.5 },
              { text: m.value, fontSize: 14, bold: true, color: m.color || DARK },
            ],
            border: [false, false, false, false],
            margin: [0, 0, 12, 0],
          })),
        },
      ] : [{ text: '', margin: [0, 0, 0, 20] }]),

      // ── Sections (tables) ─────────────────────────────────────
      ...sections,
    ],

    defaultStyle: {
      font:     'Helvetica',
      fontSize:  9,
      color:     DARK,
      lineHeight: 1.3,
    },

    styles: {
      tableHeader: {
        bold:       true,
        fontSize:   8,
        color:      '#fff',
        fillColor:  PURPLE,
        alignment:  'left',
      },
      sectionTitle: {
        fontSize:  11,
        bold:      true,
        color:     DARK,
        margin:    [0, 20, 0, 8],
      },
      oddRow:   { fillColor: '#f8fafc' },
      evenRow:  { fillColor: '#ffffff' },
    },
  };
}

// Table builder with zebra striping
function makeTable(headers, rows, widths = null) {
  if (rows.length === 0) {
    return { text: 'No records for this period.', color: MUTED, fontSize: 9, margin: [0, 4, 0, 16] };
  }

  const colWidths = widths || Array(headers.length).fill('*');

  const headerRow = headers.map(h => ({
    text: h, style: 'tableHeader',
    border: [false, false, false, false],
    margin: [4, 5, 4, 5],
  }));

  const dataRows = rows.map((row, ri) =>
    row.map(cell => ({
      text:   String(cell ?? '—'),
      border: [false, false, false, true],
      borderColor: [BORDER, BORDER, BORDER, BORDER],
      fillColor: ri % 2 === 0 ? '#f8fafc' : '#ffffff',
      margin: [4, 4, 4, 4],
      fontSize: 8,
    }))
  );

  return {
    margin: [0, 0, 0, 24],
    table: {
      headerRows: 1,
      widths:     colWidths,
      body:       [headerRow, ...dataRows],
    },
    layout: {
      hLineWidth:  () => 0.5,
      vLineWidth:  () => 0,
      hLineColor:  () => BORDER,
    },
  };
}

// ── Data fetchers per report type ─────────────────────────────────────────────

async function fetchEggData(tenantId, from, to) {
  const records = await prisma.eggProduction.findMany({
    where: {
      flock: { penSection: { pen: { farm: { tenantId } } } },
      collectionDate: { gte: new Date(from), lte: new Date(to + 'T23:59:59') },
    },
    include: {
      flock:      { select: { batchCode: true, operationType: true } },
      penSection: { include: { pen: { select: { name: true } } } },
    },
    orderBy: { collectionDate: 'asc' },
  });

  const total    = records.reduce((s, r) => s + r.totalEggs,    0);
  const gradeA   = records.reduce((s, r) => s + r.gradeACount,  0);
  const cracked  = records.reduce((s, r) => s + r.crackedCount, 0);
  const avgRate  = records.length ? (records.reduce((s,r)=>s+Number(r.layingRatePct||0),0)/records.length).toFixed(1) : 0;

  return {
    records,
    meta: [
      { label: 'TOTAL EGGS',    value: fmtNum(total),                   color: AMBER },
      { label: 'GRADE A',       value: `${fmtNum(gradeA)} (${total>0?(gradeA/total*100).toFixed(1):0}%)`, color: GREEN },
      { label: 'CRACKED',       value: fmtNum(cracked),                 color: RED },
      { label: 'AVG LAY RATE',  value: `${avgRate}%`,                   color: PURPLE },
      { label: 'CRATES',        value: fmtNum(Math.floor(total / 30)),  color: BLUE },
      { label: 'RECORDS',       value: fmtNum(records.length),          color: MUTED },
    ],
    rows: records.map(r => [
      r.collectionDate?.toISOString().split('T')[0],
      r.flock?.batchCode || '—',
      r.penSection?.pen?.name || '—',
      r.penSection?.name || '—',
      fmtNum(r.totalEggs),
      fmtNum(r.gradeACount),
      fmtNum(r.gradeBCount),
      fmtNum(r.crackedCount),
      fmtNum(r.dirtyCount),
      fmtNum(r.cratesCount ?? Math.floor(r.totalEggs / 30)),
      `${Number(r.layingRatePct || 0).toFixed(1)}%`,
    ]),
  };
}

async function fetchMortalityData(tenantId, from, to) {
  const records = await prisma.mortalityRecord.findMany({
    where: {
      flock: { penSection: { pen: { farm: { tenantId } } } },
      recordDate: { gte: new Date(from), lte: new Date(to + 'T23:59:59') },
    },
    include: {
      flock:      { select: { batchCode: true, operationType: true } },
      penSection: { include: { pen: { select: { name: true } } } },
      recordedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { recordDate: 'asc' },
  });

  const total   = records.reduce((s, r) => s + r.count, 0);
  const causes  = records.reduce((acc, r) => { acc[r.causeCode] = (acc[r.causeCode]||0)+r.count; return acc; }, {});
  const topCause = Object.entries(causes).sort((a,b)=>b[1]-a[1])[0];
  const days    = Math.ceil((new Date(to)-new Date(from))/86400000) + 1;

  return {
    records,
    meta: [
      { label: 'TOTAL DEATHS',  value: fmtNum(total),                            color: RED },
      { label: 'DAILY AVERAGE', value: (total/days).toFixed(1),                  color: RED },
      { label: 'TOP CAUSE',     value: topCause?.[0]?.replace(/_/g,' ') || '—',  color: AMBER },
      { label: 'RECORDS',       value: fmtNum(records.length),                   color: MUTED },
    ],
    rows: records.map(r => [
      r.recordDate?.toISOString().split('T')[0],
      r.flock?.batchCode || '—',
      r.flock?.operationType || '—',
      r.penSection?.pen?.name || '—',
      r.penSection?.name || '—',
      fmtNum(r.count),
      r.causeCode?.replace(/_/g,' ') || '—',
      r.notes || '—',
      `${r.recordedBy?.firstName||''} ${r.recordedBy?.lastName||''}`.trim() || '—',
    ]),
  };
}

async function fetchFeedData(tenantId, from, to) {
  const records = await prisma.feedConsumption.findMany({
    where: {
      flock: { penSection: { pen: { farm: { tenantId } } } },
      recordedDate: { gte: new Date(from), lte: new Date(to + 'T23:59:59') },
    },
    include: {
      flock:         { select: { batchCode: true } },
      feedInventory: { include: { feedType: { select: { name: true } } } },
      recordedBy:    { select: { firstName: true, lastName: true } },
    },
    orderBy: { recordedDate: 'asc' },
  });

  const totalKg = records.reduce((s, r) => s + Number(r.quantityKg || 0), 0);

  return {
    records,
    meta: [
      { label: 'TOTAL KG',  value: `${totalKg.toFixed(1)} kg`, color: GREEN },
      { label: 'RECORDS',   value: fmtNum(records.length),     color: MUTED },
    ],
    rows: records.map(r => [
      r.recordedDate?.toISOString().split('T')[0],
      r.flock?.batchCode || '—',
      r.feedInventory?.feedType?.name || '—',
      `${Number(r.quantityKg || 0).toFixed(2)} kg`,
      `${Number(r.perBirdGrams || 0).toFixed(1)} g`,
      `${r.recordedBy?.firstName||''} ${r.recordedBy?.lastName||''}`.trim() || '—',
    ]),
  };
}

async function fetchFlockData(tenantId) {
  const flocks = await prisma.flock.findMany({
    where: { penSection: { pen: { farm: { tenantId } } } },
    include: {
      penSection: { include: { pen: { select: { name: true } } } },
    },
    orderBy: { dateOfPlacement: 'desc' },
  });

  const active   = flocks.filter(f => f.status === 'ACTIVE').length;
  const total    = flocks.reduce((s, f) => s + (f.currentCount || 0), 0);

  return {
    records: flocks,
    meta: [
      { label: 'TOTAL FLOCKS',  value: fmtNum(flocks.length), color: BLUE },
      { label: 'ACTIVE',        value: fmtNum(active),        color: GREEN },
      { label: 'LIVE BIRDS',    value: fmtNum(total),         color: PURPLE },
    ],
    rows: flocks.map(f => {
      const age = f.dateOfPlacement
        ? Math.floor((Date.now() - new Date(f.dateOfPlacement)) / 86400000)
        : '—';
      const mort = f.initialCount && f.currentCount
        ? (((f.initialCount - f.currentCount) / f.initialCount) * 100).toFixed(1)
        : '—';
      return [
        f.batchCode,
        f.breed || '—',
        f.operationType,
        f.penSection?.pen?.name || '—',
        f.penSection?.name || '—',
        f.status,
        fmtNum(f.initialCount),
        fmtNum(f.currentCount),
        typeof age === 'number' ? `${age}d` : age,
        typeof mort === 'string' && mort !== '—' ? `${mort}%` : mort,
        f.dateOfPlacement?.toISOString().split('T')[0] || '—',
      ];
    }),
  };
}

async function fetchHealthData(tenantId) {
  const vaccinations = await prisma.vaccination.findMany({
    where: { flock: { penSection: { pen: { farm: { tenantId } } } } },
    include: {
      flock:          { select: { batchCode: true } },
      administeredBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { scheduledDate: 'asc' },
  });

  const completed = vaccinations.filter(v => v.status === 'COMPLETED').length;
  const overdue   = vaccinations.filter(v => v.status === 'OVERDUE').length;

  return {
    records: vaccinations,
    meta: [
      { label: 'TOTAL',     value: fmtNum(vaccinations.length), color: PURPLE },
      { label: 'COMPLETED', value: fmtNum(completed),           color: GREEN },
      { label: 'OVERDUE',   value: fmtNum(overdue),             color: RED },
    ],
    rows: vaccinations.map(v => [
      v.vaccineName,
      v.flock?.batchCode || '—',
      v.scheduledDate?.toISOString().split('T')[0] || '—',
      v.status,
      v.completedDate?.toISOString().split('T')[0] || '—',
      v.batchNumber || '—',
      v.notes || '—',
      v.administeredBy ? `${v.administeredBy.firstName} ${v.administeredBy.lastName}` : '—',
    ]),
  };
}

async function fetchFinancialData(tenantId, from, to) {
  const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
  const since = new Date(from);

  const pens = await prisma.pen.findMany({
    where: { farm: { tenantId }, isActive: true },
    include: {
      sections: { include: { flocks: { where: { status: 'ACTIVE' } } } },
    },
  });

  const rows = [];
  let totalRevenue = 0, totalCost = 0;

  for (const pen of pens) {
    const flockIds = pen.sections.flatMap(s => s.flocks.map(f => f.id));
    if (flockIds.length === 0) continue;

    const [feedAgg, eggAgg, mortAgg] = await Promise.all([
      prisma.feedConsumption.aggregate({
        where: { flockId: { in: flockIds }, recordedDate: { gte: since } },
        _sum: { quantityKg: true },
      }),
      pen.operationType === 'LAYER'
        ? prisma.eggProduction.aggregate({
            where: { flockId: { in: flockIds }, collectionDate: { gte: since } },
            _sum: { totalEggs: true, gradeACount: true },
          })
        : Promise.resolve(null),
      prisma.mortalityRecord.aggregate({
        where: { flockId: { in: flockIds }, recordDate: { gte: since } },
        _sum: { count: true },
      }),
    ]);

    const feedKg      = Number(feedAgg._sum.quantityKg || 0);
    const feedCost    = feedKg * 175;                         // ₦175/kg avg
    const labourCost  = days * 5000;                          // ₦5,000/pen/day
    const totalBirds  = pen.sections.reduce((s,sec)=>s+sec.flocks.reduce((fs,f)=>fs+f.currentCount,0),0);

    let revenue = 0;
    if (pen.operationType === 'LAYER' && eggAgg) {
      const gradeA = Number(eggAgg._sum.gradeACount || 0);
      const other  = Number(eggAgg._sum.totalEggs   || 0) - gradeA;
      revenue = gradeA * 70 + other * 45;                    // ₦70 Grade A, ₦45 others
    } else if (pen.operationType === 'BROILER') {
      revenue = totalBirds * 3500;                           // ₦3,500/bird avg sale
    }

    const totalCostPen = feedCost + labourCost;
    const profit       = revenue - totalCostPen;
    const margin       = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0.0';

    totalRevenue += revenue;
    totalCost    += totalCostPen;

    rows.push([
      pen.name,
      pen.operationType,
      fmtNum(totalBirds),
      fmtCur(revenue),
      fmtCur(feedCost),
      fmtCur(labourCost),
      fmtCur(totalCostPen),
      fmtCur(profit),
      `${margin}%`,
    ]);
  }

  const totalProfit = totalRevenue - totalCost;
  const totalMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0.0';

  return {
    records: rows,
    meta: [
      { label: 'TOTAL REVENUE', value: fmtCur(totalRevenue), color: GREEN },
      { label: 'TOTAL COST',    value: fmtCur(totalCost),    color: RED },
      { label: 'NET PROFIT',    value: fmtCur(totalProfit),  color: totalProfit >= 0 ? GREEN : RED },
      { label: 'MARGIN',        value: `${totalMargin}%`,    color: PURPLE },
    ],
    rows,
  };
}

// ── Table column configs per report ──────────────────────────────────────────
const TABLE_CONFIGS = {
  egg_production:    { headers: ['Date','Flock','Pen','Section','Total Eggs','Grade A','Grade B','Cracked','Dirty','Crates','Lay Rate'], widths: [55,55,55,55,50,50,50,50,40,40,45] },
  mortality:         { headers: ['Date','Flock','Type','Pen','Section','Deaths','Cause','Notes','Recorded By'], widths: [55,55,45,55,55,40,60,80,'*'] },
  feed_consumption:  { headers: ['Date','Flock','Feed Type','Qty (kg)','Per Bird (g)','Recorded By'], widths: [60,60,'*',60,70,80] },
  flock_summary:     { headers: ['Batch Code','Breed','Type','Pen','Section','Status','Initial','Current','Age','Mort %','Start Date'], widths: [60,60,45,55,55,50,45,45,35,40,60] },
  health_vaccination:{ headers: ['Vaccine','Flock','Scheduled','Status','Completed','Batch No.','Notes','Administered By'], widths: [80,55,55,55,55,55,'*',80] },
  financial:         { headers: ['Pen','Type','Birds','Revenue','Feed Cost','Labour Cost','Total Cost','Profit','Margin'], widths: [55,45,40,75,75,75,75,75,45] },
};

const REPORT_META = {
  egg_production:    { title: 'Egg Production Report',    subtitle: 'Daily collection records by flock — grade breakdown and laying rates' },
  mortality:         { title: 'Mortality Report',          subtitle: 'Death records with cause analysis and cumulative totals' },
  feed_consumption:  { title: 'Feed Consumption Report',  subtitle: 'Feed usage per flock with per-bird calculations' },
  flock_summary:     { title: 'Flock Summary Report',     subtitle: 'All flocks — active and completed — with performance metrics' },
  health_vaccination:{ title: 'Health & Vaccination Report', subtitle: 'Vaccination schedule compliance and completion status' },
  financial:         { title: 'Financial Summary',         subtitle: 'Revenue, costs and margin by pen — estimated figures' },
};

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  if (!type || !REPORT_ROLES[type])
    return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
  if (!from || !to)
    return NextResponse.json({ error: 'from and to date params required' }, { status: 400 });
  if (!REPORT_ROLES[type].includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions for this report' }, { status: 403 });

  try {
    // ── Fetch farm name ───────────────────────────────────────
    const farm = await prisma.farm.findFirst({
      where: { tenantId: user.tenantId },
      select: { name: true },
    });
    const farmName = farm?.name || 'PoultryFarm Pro';

    // ── Fetch report-specific data ────────────────────────────
    let data;
    if (type === 'egg_production')    data = await fetchEggData(user.tenantId, from, to);
    if (type === 'mortality')         data = await fetchMortalityData(user.tenantId, from, to);
    if (type === 'feed_consumption')  data = await fetchFeedData(user.tenantId, from, to);
    if (type === 'flock_summary')     data = await fetchFlockData(user.tenantId);
    if (type === 'health_vaccination')data = await fetchHealthData(user.tenantId);
    if (type === 'financial')         data = await fetchFinancialData(user.tenantId, from, to);

    const cfg        = TABLE_CONFIGS[type];
    const reportMeta = REPORT_META[type];
    const dateRange  = `${fmtDate(from)} – ${fmtDate(to)}`;

    const docDef = buildDocDef({
      title:     reportMeta.title,
      subtitle:  reportMeta.subtitle,
      farmName,
      dateRange,
      meta:      data.meta,
      sections: [
        { text: `${data.rows.length} record${data.rows.length !== 1 ? 's' : ''} in period`, style: 'sectionTitle' },
        makeTable(cfg.headers, data.rows, cfg.widths),
      ],
    });

    // ── Generate PDF buffer ───────────────────────────────────
    let PdfPrinter;
    try {
      const mod = await import('pdfmake/build/pdfmake.server.js');
      PdfPrinter = mod.default ?? mod;
    } catch {
      try {
        const mod = await import('pdfmake/src/printer.js');
        PdfPrinter = mod.default ?? mod;
      } catch {
        PdfPrinter = null;
      }
    }
    if (!PdfPrinter) {
      return NextResponse.json({ error: 'PDF generation unavailable. Run: npm install pdfmake --legacy-peer-deps' }, { status: 503 });
    }
    const fonts = {
      Helvetica: {
        normal:      'Helvetica',
        bold:        'Helvetica-Bold',
        italics:     'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    };
    const printer  = new PdfPrinter(fonts);
    const pdfDoc   = printer.createPdfKitDocument(docDef);

    const chunks = [];
    await new Promise((resolve, reject) => {
      pdfDoc.on('data',  chunk => chunks.push(chunk));
      pdfDoc.on('end',   resolve);
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });

    const buffer   = Buffer.concat(chunks);
    const filename = `${type}_${from}_to_${to}.pdf`;

    return new NextResponse(buffer, {
      status:  200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(buffer.length),
        'Cache-Control':       'no-store',
      },
    });
  } catch (err) {
    console.error('[pdf report]', err);

    // Friendly error if pdfmake not installed
    if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('pdfmake')) {
      return NextResponse.json({
        error: 'PDF generation requires pdfmake. Run: npm install pdfmake',
      }, { status: 503 });
    }

    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}



================================================
FILE: app/api/search/route.js
================================================
// app/api/search/route.js — Global cross-entity search
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'PEN_MANAGER'];
const STORE_ROLES   = ['STORE_MANAGER', 'STORE_CLERK'];

// Map entity type → the page href to navigate to
