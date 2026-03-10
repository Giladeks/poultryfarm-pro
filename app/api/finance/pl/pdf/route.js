// app/api/finance/pl/pdf/route.js
// GET /api/finance/pl/pdf?from=2026-01-01&to=2026-03-31
//
// Uses pdfmake v0.2.x server-side printer (pdfmake/src/printer.js)
// Run: npm install pdfmake@0.2.x --legacy-peer-deps

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const FINANCE_VIEW_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];

const PURPLE = '#6c63ff';
const DARK   = '#1e293b';
const MUTED  = '#94a3b8';
const GREEN  = '#16a34a';
const RED    = '#dc2626';
const AMBER  = '#d97706';

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '-';
const fmtCur  = n => `NGN ${Number(n||0).toLocaleString('en-NG', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
const fmtPct  = n => `${Number(n||0).toFixed(1)}%`;

const COST_CATEGORY = {
  FEED:'Feed & Nutrition', MEDICATION:'Veterinary & Medication', CHICKS:'Day-Old Chicks',
  EQUIPMENT:'Equipment & Assets', PACKAGING:'Packaging', SERVICES:'Services & Utilities', OTHER:'Other Costs',
};
const COGS_TYPES = new Set(['FEED','MEDICATION','CHICKS']);
const toNGN = (amount, rate) => parseFloat(amount||0) * parseFloat(rate||1);

function buildDocDef({ farmName, dateRange, summary, revenueRows, costRows, categoryRows }) {
  const now         = new Date().toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' });
  const profitColor = summary.netProfit   >= 0 ? GREEN : RED;
  const grossColor  = summary.grossProfit >= 0 ? GREEN : RED;

  const makeTable = (headers, rows, widths) => {
    if (!rows.length) return { text:'No records for this period.', color:MUTED, fontSize:9, margin:[0,4,0,20] };
    return {
      margin:[0,0,0,20],
      table:{
        headerRows:1,
        widths: widths || Array(headers.length).fill('*'),
        body:[
          headers.map(h => ({ text:h, bold:true, fontSize:8, color:'#ffffff', fillColor:PURPLE, margin:[4,5,4,5] })),
          ...rows.map(row => row.map(cell => ({ text:String(cell??'-'), fontSize:8, margin:[4,4,4,4] }))),
        ],
      },
    };
  };

  const plBody = [
    [
      { text:'Item',   bold:true, fontSize:8, color:'#ffffff', fillColor:PURPLE, margin:[4,5,4,5] },
      { text:'Amount', bold:true, fontSize:8, color:'#ffffff', fillColor:PURPLE, margin:[4,5,4,5], alignment:'right' },
    ],
    [{ text:'Revenue',             bold:true,  fontSize:10, color:PURPLE,     margin:[4,8,4,2]  }, { text:fmtCur(summary.totalRevenue),   bold:true,  fontSize:10, color:PURPLE,     alignment:'right', margin:[4,8,4,2]  }],
    [{ text:'  Sales Revenue',     bold:false, fontSize:8,  color:DARK,       margin:[4,2,4,6]  }, { text:fmtCur(summary.totalRevenue),   bold:false, fontSize:8,  color:DARK,       alignment:'right', margin:[4,2,4,6]  }],
    [{ text:'Cost of Goods Sold',  bold:true,  fontSize:10, color:AMBER,      margin:[4,8,4,2]  }, { text:fmtCur(summary.totalCOGS),      bold:true,  fontSize:10, color:AMBER,      alignment:'right', margin:[4,8,4,2]  }],
    [{ text:'  Feed, Med & Chicks',bold:false, fontSize:8,  color:DARK,       margin:[4,2,4,6]  }, { text:fmtCur(summary.totalCOGS),      bold:false, fontSize:8,  color:DARK,       alignment:'right', margin:[4,2,4,6]  }],
    [{ text:'Gross Profit',        bold:true,  fontSize:11, color:grossColor, margin:[4,10,4,2] }, { text:fmtCur(summary.grossProfit),    bold:true,  fontSize:11, color:grossColor, alignment:'right', margin:[4,10,4,2] }],
    [{ text:'  Gross Margin',      bold:false, fontSize:8,  color:MUTED,      margin:[4,2,4,6]  }, { text:fmtPct(summary.grossMarginPct), bold:false, fontSize:8,  color:MUTED,      alignment:'right', margin:[4,2,4,6]  }],
    [{ text:'Operating Expenses',  bold:true,  fontSize:10, color:AMBER,      margin:[4,8,4,2]  }, { text:fmtCur(summary.totalOpEx),      bold:true,  fontSize:10, color:AMBER,      alignment:'right', margin:[4,8,4,2]  }],
    [{ text:'  Equip, Pack & Svcs',bold:false, fontSize:8,  color:DARK,       margin:[4,2,4,6]  }, { text:fmtCur(summary.totalOpEx),      bold:false, fontSize:8,  color:DARK,       alignment:'right', margin:[4,2,4,6]  }],
    [{ text:'Net Profit / (Loss)', bold:true,  fontSize:12, color:profitColor,margin:[4,10,4,2] }, { text:fmtCur(summary.netProfit),      bold:true,  fontSize:12, color:profitColor,alignment:'right', margin:[4,10,4,2] }],
    [{ text:'  Net Margin',        bold:false, fontSize:8,  color:MUTED,      margin:[4,2,4,8]  }, { text:fmtPct(summary.netMarginPct),   bold:false, fontSize:8,  color:MUTED,      alignment:'right', margin:[4,2,4,8]  }],
  ];

  return {
    pageSize:'A4', pageOrientation:'portrait', pageMargins:[40,70,40,50],
    header: () => ({ margin:[40,18,40,0], columns:[{ text:'PoultryFarm Pro', fontSize:10, bold:true, color:PURPLE },{ text:farmName, fontSize:9, color:MUTED, alignment:'right' }] }),
    footer: () => ({ margin:[40,0,40,16], columns:[{ text:`Generated: ${now}`, fontSize:7, color:MUTED },{ text:'CONFIDENTIAL', fontSize:7, color:MUTED, alignment:'right' }] }),
    content:[
      { text:'Profit & Loss Statement', fontSize:22, bold:true, color:DARK, margin:[0,0,0,4] },
      { text:`Period: ${dateRange}`,    fontSize:11, color:MUTED, margin:[0,0,0,2] },
      { text:`Farm: ${farmName}`,       fontSize:9,  color:MUTED, margin:[0,0,0,20] },
      { margin:[0,0,0,24], columns:[
        { stack:[{ text:'REVENUE',     fontSize:7, bold:true, color:MUTED },{ text:fmtCur(summary.totalRevenue),  fontSize:10, bold:true, color:PURPLE      }] },
        { stack:[{ text:'GROSS PROFIT',fontSize:7, bold:true, color:MUTED },{ text:fmtCur(summary.grossProfit),   fontSize:10, bold:true, color:grossColor  }] },
        { stack:[{ text:'NET PROFIT',  fontSize:7, bold:true, color:MUTED },{ text:fmtCur(summary.netProfit),     fontSize:10, bold:true, color:profitColor }] },
        { stack:[{ text:'NET MARGIN',  fontSize:7, bold:true, color:MUTED },{ text:fmtPct(summary.netMarginPct),  fontSize:10, bold:true, color:profitColor }] },
      ]},
      { text:'Income Statement', fontSize:13, bold:true, color:DARK, margin:[0,0,0,8] },
      { margin:[0,0,0,24], table:{ headerRows:1, widths:['*',160], body:plBody } },
      { text:'Cost Breakdown by Category', fontSize:13, bold:true, color:DARK, margin:[0,0,0,8] },
      makeTable(['Category','Supplier Type','Invoices','Total (NGN)','% of Costs'], categoryRows, ['*',100,50,130,70]),
      { text:'Revenue Detail', fontSize:13, bold:true, color:DARK, margin:[0,0,0,8] },
      makeTable(['Invoice #','Customer','Type','Date','CCY','Amount (NGN)','Status'], revenueRows, [70,'*',55,65,30,110,50]),
      { text:'Cost Detail', fontSize:13, bold:true, color:DARK, margin:[0,0,0,8] },
      makeTable(['Invoice #','Supplier','Category','Date','CCY','Amount (NGN)','COGS?'], costRows, [70,'*',90,65,30,110,40]),
    ],
    defaultStyle:{ font:'Helvetica', fontSize:9, color:DARK, lineHeight:1.4 },
    styles:{},
  };
}

// ── CSV fallback ──────────────────────────────────────────────────────────────
function buildCsv({ from, to, farmName, summary, revenueRows, costRows }) {
  return [
    `P&L Report,${fmtDate(from)} to ${fmtDate(to)}`,`Farm,${farmName}`,'',
    'SUMMARY',`Revenue,${fmtCur(summary.totalRevenue)}`,`COGS,${fmtCur(summary.totalCOGS)}`,
    `Gross Profit,${fmtCur(summary.grossProfit)}`,`Gross Margin,${fmtPct(summary.grossMarginPct)}`,
    `Operating Expenses,${fmtCur(summary.totalOpEx)}`,`Net Profit,${fmtCur(summary.netProfit)}`,`Net Margin,${fmtPct(summary.netMarginPct)}`,
    '','REVENUE','Invoice #,Customer,Type,Date,Currency,Amount NGN,Status',...revenueRows.map(r=>r.join(',')),
    '','COSTS','Invoice #,Supplier,Category,Date,Currency,Amount NGN,COGS?',...costRows.map(r=>r.join(',')),
  ].join('\n');
}

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  if (!FINANCE_VIEW_ROLES.includes(user.role)) return NextResponse.json({ error:'Forbidden' }, { status:403 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to   = searchParams.get('to');
  if (!from || !to) return NextResponse.json({ error:'from and to params required' }, { status:400 });

  try {
    const fromDate = new Date(from);
    const toDate   = new Date(to + 'T23:59:59');
    const farm     = await prisma.farm.findFirst({ where:{ tenantId:user.tenantId }, select:{ name:true } });
    const farmName = farm?.name || 'PoultryFarm Pro';

    const [salesInvoices, supplierInvoices] = await Promise.all([
      prisma.salesInvoice.findMany({
        where:{ tenantId:user.tenantId, status:{ in:['PAID','PARTIALLY_PAID'] }, OR:[{ paidAt:{ gte:fromDate, lte:toDate } },{ invoiceDate:{ gte:fromDate, lte:toDate }, status:'PARTIALLY_PAID' }] },
        include:{ customer:{ select:{ name:true, customerType:true } } }, orderBy:{ invoiceDate:'asc' },
      }),
      prisma.supplierInvoice.findMany({
        where:{ tenantId:user.tenantId, status:{ in:['PAID','PARTIALLY_PAID'] }, OR:[{ paidAt:{ gte:fromDate, lte:toDate } },{ invoiceDate:{ gte:fromDate, lte:toDate }, status:'PARTIALLY_PAID' }] },
        include:{ supplier:{ select:{ name:true, supplierType:true } } }, orderBy:{ invoiceDate:'asc' },
      }),
    ]);

    const revenueItems = salesInvoices.map(inv => ({ ...inv, amountNGN:toNGN(inv.amountPaid, inv.exchangeRate) }));
    const costItems    = supplierInvoices.map(inv => ({ ...inv, amountNGN:toNGN(inv.amountPaid, inv.exchangeRate), supplierType:inv.supplier?.supplierType||'OTHER', isCOGS:COGS_TYPES.has(inv.supplier?.supplierType||'OTHER') }));

    const totalRevenue = revenueItems.reduce((s,i)=>s+i.amountNGN,0);
    const totalCOGS    = costItems.filter(i=>i.isCOGS).reduce((s,i)=>s+i.amountNGN,0);
    const totalOpEx    = costItems.filter(i=>!i.isCOGS).reduce((s,i)=>s+i.amountNGN,0);
    const totalCosts   = totalCOGS + totalOpEx;
    const grossProfit  = totalRevenue - totalCOGS;
    const netProfit    = totalRevenue - totalCosts;
    const summary = { totalRevenue, totalCOGS, totalOpEx, totalCosts, grossProfit, netProfit,
      grossMarginPct: totalRevenue>0 ? (grossProfit/totalRevenue)*100 : 0,
      netMarginPct:   totalRevenue>0 ? (netProfit/totalRevenue)*100   : 0,
    };

    const catMap = {};
    costItems.forEach(i => {
      const cat = COST_CATEGORY[i.supplierType]||'Other Costs';
      if (!catMap[cat]) catMap[cat] = { cat, supplierType:i.supplierType, total:0, count:0 };
      catMap[cat].total += i.amountNGN; catMap[cat].count++;
    });
    const categoryRows = Object.values(catMap).sort((a,b)=>b.total-a.total).map(c=>[c.cat,c.supplierType,String(c.count),fmtCur(c.total),totalCosts>0?fmtPct((c.total/totalCosts)*100):'0%']);
    const revenueRows  = revenueItems.map(i=>[i.invoiceNumber,i.customer?.name||'-',i.customer?.customerType||'-',fmtDate(i.invoiceDate),i.currency,fmtCur(i.amountNGN),i.status]);
    const costRows     = costItems.map(i=>[i.invoiceNumber,i.supplier?.name||'-',COST_CATEGORY[i.supplierType]||'Other',fmtDate(i.invoiceDate),i.currency,fmtCur(i.amountNGN),i.isCOGS?'Yes':'No']);

    // ── Try pdfmake v0.2.x printer (requires: npm install pdfmake@0.2.x --legacy-peer-deps)
    let pdfBuffer = null;
    try {
      const PdfPrinter = (await import('pdfmake/src/printer.js')).default;
      if (typeof PdfPrinter === 'function') {
        const docDef  = buildDocDef({ farmName, dateRange:`${fmtDate(from)} to ${fmtDate(to)}`, summary, revenueRows, costRows, categoryRows });
        const fonts   = { Helvetica:{ normal:'Helvetica', bold:'Helvetica-Bold', italics:'Helvetica-Oblique', bolditalics:'Helvetica-BoldOblique' } };
        const printer = new PdfPrinter(fonts);
        const pdfDoc  = printer.createPdfKitDocument(docDef);
        const chunks  = [];
        await new Promise((resolve, reject) => {
          pdfDoc.on('data', c => chunks.push(c));
          pdfDoc.on('end',  resolve);
          pdfDoc.on('error',reject);
          pdfDoc.end();
        });
        pdfBuffer = Buffer.concat(chunks);
      }
    } catch (pdfErr) {
      console.warn('[pl pdf] pdfmake unavailable, falling back to CSV:', pdfErr.message);
    }

    if (pdfBuffer) {
      return new NextResponse(pdfBuffer, {
        status:200,
        headers:{ 'Content-Type':'application/pdf', 'Content-Disposition':`attachment; filename="pl_${from}_to_${to}.pdf"`, 'Content-Length':String(pdfBuffer.length), 'Cache-Control':'no-store' },
      });
    }

    // ── CSV fallback ────────────────────────────────────────────────────────
    const csv = buildCsv({ from, to, farmName, summary, revenueRows, costRows });
    return new NextResponse(csv, {
      status:200,
      headers:{ 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename="pl_${from}_to_${to}.csv"`, 'Cache-Control':'no-store', 'X-Pdf-Fallback':'true' },
    });

  } catch (err) {
    console.error('[pl pdf error]', err);
    return NextResponse.json({ error:`Export failed: ${err.message}` }, { status:500 });
  }
}
