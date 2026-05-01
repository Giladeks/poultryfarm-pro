'use client';
export const dynamic = 'force-dynamic';
// app/reports/page.js — Reports & Export Engine
import { useState, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const fmtCur  = n => `₦${Number(n||0).toLocaleString('en-NG', { minimumFractionDigits:0 })}`;
const fmt     = n => Number(n||0).toLocaleString('en-NG');
const fmtDate = d => new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' });

const REPORT_TYPES = [
  {
    id:   'egg_production',
    icon: '🥚',
    title: 'Egg Production Report',
    desc: 'Daily collection totals, grade breakdown, laying rates, crate counts by flock',
    roles: ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
    color: '#f59e0b',
  },
  {
    id:   'mortality',
    icon: '💀',
    title: 'Mortality Report',
    desc: 'Daily death records, cause analysis, anomaly flags, cumulative mortality rates',
    roles: ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
    color: '#ef4444',
  },
  {
    id:   'feed_consumption',
    icon: '🌾',
    title: 'Feed Consumption Report',
    desc: 'Feed usage per flock, FCR estimates, inventory movements and cost analysis',
    roles: ['STORE_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
    color: '#16a34a',
  },
  {
    id:   'flock_summary',
    icon: '🐦',
    title: 'Flock Summary Report',
    desc: 'All active and completed flocks with survival rates, ages, and performance metrics',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
    color: '#3b82f6',
  },
  {
    id:   'financial',
    icon: '💰',
    title: 'Financial Summary',
    desc: 'Revenue, costs, margins by pen — requires analytics access',
    roles: ['CHAIRPERSON','FARM_ADMIN','SUPER_ADMIN'],
    color: '#8b5cf6',
  },
  {
    id:   'health_vaccination',
    icon: '💉',
    title: 'Health & Vaccination Report',
    desc: 'Vaccination schedule compliance, overdue alerts, completed doses by flock',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
    color: '#ec4899',
  },
];

const PRESET_RANGES = [
  { label:'Last 7 days',   days:7 },
  { label:'Last 30 days',  days:30 },
  { label:'Last 90 days',  days:90 },
  { label:'This month',    days:null, preset:'this_month' },
  { label:'Last month',    days:null, preset:'last_month' },
];

function getDateRange(selection) {
  const today = new Date();
  const pad = n => String(n).padStart(2,'0');
  const iso  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  if (selection.days) {
    const from = new Date(today);
    from.setDate(from.getDate() - selection.days);
    return { from: iso(from), to: iso(today) };
  }
  if (selection.preset === 'this_month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: iso(from), to: iso(today) };
  }
  if (selection.preset === 'last_month') {
    const from = new Date(today.getFullYear(), today.getMonth()-1, 1);
    const to   = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: iso(from), to: iso(to) };
  }
  return { from: selection.customFrom, to: selection.customTo };
}

// ── CSV Builders ─────────────────────────────────────────────────────────────
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function generateEggCSV(apiFetch, from, to) {
  const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
  const res  = await apiFetch(`/api/eggs?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch egg data');
  const { records=[] } = await res.json();
  const filtered = records.filter(r => r.collectionDate >= from && r.collectionDate <= to + 'T23:59:59');
  const rows = [
    ['Date','Flock','Pen','Section','Total Eggs','Grade A','Grade B','Cracked','Dirty','Crates','Laying Rate %'],
    ...filtered.map(r=>[
      r.collectionDate?.split('T')[0],
      r.flock?.batchCode,
      r.penSection?.pen?.name,
      r.penSection?.name,
      r.totalEggs,
      r.gradeACount,
      r.gradeBCount,
      r.crackedCount,
      r.dirtyCount,
      r.cratesCount??Math.floor(r.totalEggs/30),
      Number(r.layingRatePct||0).toFixed(2),
    ]),
  ];
  downloadCSV(`egg_production_${from}_to_${to}.csv`, rows);
  return filtered.length;
}

async function generateMortalityCSV(apiFetch, from, to) {
  const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
  const res  = await apiFetch(`/api/mortality?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch mortality data');
  const { records=[] } = await res.json();
  const filtered = records.filter(r => r.recordDate >= from && r.recordDate <= to + 'T23:59:59');
  const rows = [
    ['Date','Flock','Pen','Section','Deaths','Cause','Notes','Recorded By'],
    ...filtered.map(r=>[
      r.recordDate?.split('T')[0],
      r.flock?.batchCode,
      r.penSection?.pen?.name,
      r.penSection?.name,
      r.count,
      r.causeCode,
      r.notes||'',
      `${r.recordedBy?.firstName||''} ${r.recordedBy?.lastName||''}`.trim(),
    ]),
  ];
  downloadCSV(`mortality_${from}_to_${to}.csv`, rows);
  return filtered.length;
}

async function generateFeedCSV(apiFetch, from, to) {
  const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
  const res  = await apiFetch(`/api/feed/consumption?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch feed data');
  const { records=[] } = await res.json();
  const rows = [
    ['Date','Flock','Feed Type','Quantity (kg)','Per Bird (g)','Recorded By'],
    ...records.map(r=>[
      r.consumedAt?.split('T')[0]||r.recordedDate?.split('T')[0],
      r.flock?.batchCode,
      r.feedInventory?.feedType?.name||r.feedType?.name||'',
      Number(r.quantityKg||0).toFixed(2),
      Number(r.perBirdGrams||0).toFixed(1),
      `${r.recordedBy?.firstName||''} ${r.recordedBy?.lastName||''}`.trim(),
    ]),
  ];
  downloadCSV(`feed_consumption_${from}_to_${to}.csv`, rows);
  return records.length;
}

async function generateFlockCSV(apiFetch) {
  const res = await apiFetch('/api/farm?status=all');
  if (!res.ok) throw new Error('Failed to fetch flock data');
  const { flocks=[] } = await res.json();
  const rows = [
    ['Batch Code','Breed','Type','Pen','Section','Status','Start Count','Current Count','Age (days)','Mortality Rate %','Start Date','End Date'],
    ...flocks.map(f=>[
      f.batchCode, f.breed, f.operationType,
      f.penSection?.pen?.name, f.penSection?.name,
      f.status,
      f.initialCount, f.currentCount,
      f.ageInDays??'',
      f.mortalityRate??'',
      f.startDate?.split('T')[0],
      f.endDate?.split('T')[0]||'Active',
    ]),
  ];
  downloadCSV(`flocks_${new Date().toISOString().split('T')[0]}.csv`, rows);
  return flocks.length;
}

async function generateHealthCSV(apiFetch, from, to) {
  const res = await apiFetch('/api/health/vaccinations');
  if (!res.ok) throw new Error('Failed to fetch health data');
  const { vaccinations=[] } = await res.json();
  const rows = [
    ['Vaccine','Flock','Pen','Scheduled Date','Status','Completed Date','Batch Number','Notes'],
    ...vaccinations.map(v=>[
      v.vaccineName, v.flock?.batchCode,
      v.penSection?.pen?.name,
      v.scheduledDate?.split('T')[0],
      v.status,
      v.completedDate?.split('T')[0]||'',
      v.batchNumber||'',
      v.notes||'',
    ]),
  ];
  downloadCSV(`vaccinations_${from}_to_${to}.csv`, rows);
  return vaccinations.length;
}

async function generateFinancialCSV(apiFetch, from, to) {
  const days = Math.ceil((new Date(to) - new Date(from)) / 86400000) + 1;
  const res  = await apiFetch(`/api/analytics?report=overview&days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch analytics data');
  const { penProfitability=[] } = await res.json();
  const rows = [
    ['Pen','Type','Birds','Revenue (₦)','Feed Cost (₦)','Labour Cost (₦)','Total Cost (₦)','Profit (₦)','Margin %'],
    ...penProfitability.map(p=>[
      p.penName, p.operationType, p.totalBirds,
      p.revenue, p.feedCost, p.labourCost, p.totalCost, p.profit, p.margin,
    ]),
  ];
  downloadCSV(`financial_summary_${from}_to_${to}.csv`, rows);
  return penProfitability.length;
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { apiFetch, user } = useAuth();

  const [rangeMode,   setRangeMode]   = useState(1); // index into PRESET_RANGES or -1 for custom
  const [customFrom,  setCustomFrom]  = useState('');
  const [customTo,    setCustomTo]    = useState('');
  const [generating,  setGenerating]  = useState(null); // report id currently generating CSV
  const [generatingPdf, setGeneratingPdf] = useState(null); // report id currently generating PDF
  const [results,     setResults]     = useState({}); // { [id]: { count, ts } | { error } }

  const availableTypes = REPORT_TYPES.filter(r => r.roles.includes(user?.role));

  const dateRange = rangeMode === -1
    ? { from:customFrom, to:customTo }
    : getDateRange(PRESET_RANGES[rangeMode]);

  const rangeLabel = rangeMode === -1
    ? (customFrom && customTo ? `${fmtDate(customFrom)} – ${fmtDate(customTo)}` : 'Custom range')
    : PRESET_RANGES[rangeMode].label;

  async function generate(reportId) {
    if (!dateRange.from || !dateRange.to) return;
    setGenerating(reportId);
    try {
      let count = 0;
      const { from, to } = dateRange;
      if (reportId === 'egg_production')    count = await generateEggCSV(apiFetch, from, to);
      if (reportId === 'mortality')         count = await generateMortalityCSV(apiFetch, from, to);
      if (reportId === 'feed_consumption')  count = await generateFeedCSV(apiFetch, from, to);
      if (reportId === 'flock_summary')     count = await generateFlockCSV(apiFetch);
      if (reportId === 'health_vaccination') count = await generateHealthCSV(apiFetch, from, to);
      if (reportId === 'financial')         count = await generateFinancialCSV(apiFetch, from, to);
      setResults(p=>({ ...p, [reportId]:{ count, ts:new Date().toLocaleTimeString() } }));
    } catch(e) {
      setResults(p=>({ ...p, [reportId]:{ error: e.message } }));
    } finally { setGenerating(null); }
  }


  async function generatePdf(reportId) {
    if (!dateRange.from || !dateRange.to) return;
    setGeneratingPdf(reportId);
    try {
      const { from, to } = dateRange;
      const res = await apiFetch(`/api/reports/pdf?type=${reportId}&from=${from}&to=${to}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'PDF generation failed' }));
        throw new Error(err.error || 'PDF generation failed');
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${reportId}_${from}_to_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setResults(p => ({ ...p, [`${reportId}_pdf`]: { ts: new Date().toLocaleTimeString() } }));
    } catch(e) {
      setResults(p => ({ ...p, [`${reportId}_pdf`]: { error: e.message } }));
    } finally {
      setGeneratingPdf(null);
    }
  }

  const canGenerate = dateRange.from && dateRange.to && dateRange.from <= dateRange.to;

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Header ── */}
        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, margin:0 }}>📄 Reports & Export</h1>
          <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>Download CSV reports for any date range</p>
        </div>

        {/* ── Date range selector ── */}
        <div className="card" style={{ marginBottom:24 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>📅 Report Period</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:rangeMode===-1?16:0 }}>
            {PRESET_RANGES.map((p,i)=>(
              <button key={i} onClick={()=>setRangeMode(i)}
                style={{ padding:'7px 16px', fontSize:12, fontWeight:rangeMode===i?700:600, border:`1px solid ${rangeMode===i?'#d4d8ff':'var(--border)'}`, borderRadius:8, background:rangeMode===i?'var(--purple-light)':'#fff', color:rangeMode===i?'var(--purple)':'var(--text-secondary)', cursor:'pointer' }}>
                {p.label}
              </button>
            ))}
            <button onClick={()=>setRangeMode(-1)}
              style={{ padding:'7px 16px', fontSize:12, fontWeight:rangeMode===-1?700:600, border:`1px solid ${rangeMode===-1?'#d4d8ff':'var(--border)'}`, borderRadius:8, background:rangeMode===-1?'var(--purple-light)':'#fff', color:rangeMode===-1?'var(--purple)':'var(--text-secondary)', cursor:'pointer' }}>
              Custom range
            </button>
          </div>
          {rangeMode === -1 && (
            <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:12 }}>
              <div>
                <label className="label" style={{ marginBottom:4 }}>From</label>
                <input type="date" className="input" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} max={customTo||new Date().toISOString().split('T')[0]} />
              </div>
              <div style={{ marginTop:18, color:'var(--text-muted)', fontWeight:700 }}>→</div>
              <div>
                <label className="label" style={{ marginBottom:4 }}>To</label>
                <input type="date" className="input" value={customTo} onChange={e=>setCustomTo(e.target.value)} min={customFrom} max={new Date().toISOString().split('T')[0]} />
              </div>
            </div>
          )}
          {canGenerate && rangeMode !== -1 && (
            <div style={{ marginTop:12, fontSize:12, color:'var(--text-muted)' }}>
              Period: <strong style={{ color:'var(--purple)' }}>{fmtDate(dateRange.from)}</strong> → <strong style={{ color:'var(--purple)' }}>{fmtDate(dateRange.to)}</strong>
            </div>
          )}
        </div>

        {/* ── Report cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
          {availableTypes.map(report => {
            const result    = results[report.id];
            const isRunning = generating === report.id;

            return (
              <div key={report.id} className="card" style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
                  <div style={{ width:44, height:44, borderRadius:12, background:`${report.color}15`, border:`1px solid ${report.color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>
                    {report.icon}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:14 }}>{report.title}</div>
                    <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4, lineHeight:1.5 }}>{report.desc}</div>
                  </div>
                </div>

                {result && (
                  <div style={{ padding:'8px 12px', borderRadius:8, background: result.error ? '#fff5f5' : '#f0fdf4', border:`1px solid ${result.error ? 'var(--red-border)' : '#bbf7d0'}` }}>
                    {result.error
                      ? <div style={{ fontSize:12, color:'#ef4444' }}>⚠ CSV: {result.error}</div>
                      : <div style={{ fontSize:12, color:'#16a34a' }}>✓ CSV downloaded · {result.count} records · {result.ts}</div>
                    }
                  </div>
                )}
                {results[`${report.id}_pdf`] && (
                  <div style={{ padding:'8px 12px', borderRadius:8, background: results[`${report.id}_pdf`].error ? '#fff5f5' : '#eff6ff', border:`1px solid ${results[`${report.id}_pdf`].error ? 'var(--red-border)' : '#bfdbfe'}` }}>
                    {results[`${report.id}_pdf`].error
                      ? <div style={{ fontSize:12, color:'#ef4444' }}>⚠ PDF: {results[`${report.id}_pdf`].error}</div>
                      : <div style={{ fontSize:12, color:'#3b82f6' }}>✓ PDF downloaded · {results[`${report.id}_pdf`].ts}</div>
                    }
                  </div>
                )}

                <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
                  <button
                    onClick={() => generate(report.id)}
                    disabled={!canGenerate || !!generating}
                    className="btn btn-primary"
                    style={{ flex:1, justifyContent:'center', fontSize:12, opacity: !canGenerate ? 0.5 : 1 }}>
                    {isRunning ? (
                      <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ width:12, height:12, border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', display:'inline-block', animation:'spin 0.7s linear infinite' }}/>
                        Generating…
                      </span>
                    ) : '⬇ Download CSV'}
                  </button>
                  <button
                    onClick={() => generatePdf(report.id)}
                    disabled={!canGenerate || !!generating || !!generatingPdf}
                    style={{
                      display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
                      padding:'9px 14px', borderRadius:8, fontSize:12, fontWeight:700, fontFamily:'inherit',
                      border:'1px solid #bfdbfe', background:'#eff6ff', color:'#3b82f6',
                      cursor: !canGenerate || !!generating || !!generatingPdf ? 'not-allowed' : 'pointer',
                      opacity: !canGenerate ? 0.5 : 1, transition:'background 0.15s',
                      whiteSpace:'nowrap',
                    }}>
                    {generatingPdf === report.id ? (
                      <span style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ width:11, height:11, border:'2px solid #bfdbfe', borderTopColor:'#3b82f6', borderRadius:'50%', display:'inline-block', animation:'spin 0.7s linear infinite' }}/>
                        PDF…
                      </span>
                    ) : '📄 PDF'}
                  </button>
                </div>
                {!canGenerate && (
                  <div style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', marginTop:-8 }}>
                    {rangeMode === -1 ? 'Select a from and to date above' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {availableTypes.length === 0 && (
          <div className="card" style={{ textAlign:'center', padding:60 }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
            <div style={{ fontWeight:700, color:'var(--text-muted)' }}>No reports available for your role</div>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </AppShell>
  );
}
