'use client';
export const dynamic = 'force-dynamic';
// app/owner/page.js — Business Intelligence & Analytics (Batch 8)
import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine, Cell,
} from 'recharts';

// ── Constants ──────────────────────────────────────────────────────────────────
const FCR_COLORS   = { excellent: '#16a34a', good: '#6c63ff', fair: '#f59e0b', poor: '#ef4444', unknown: '#9ca3af' };
const FCR_LABELS   = { excellent: '< 1.7 Excellent', good: '1.7–2.0 Good', fair: '2.0–2.5 Fair', poor: '> 2.5 Poor' };
const PEN_COLORS   = ['#6c63ff','#22c55e','#f59e0b','#3b82f6','#ec4899','#8b5cf6'];
const fmt          = (n) => `₦${Number(n||0).toLocaleString('en-NG')}`;
const fmtK         = (n) => n >= 1_000_000 ? `₦${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `₦${(n/1000).toFixed(0)}K` : `₦${n}`;

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, prefix = '', suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'#fff', border:'1px solid var(--border-card)', borderRadius:9, padding:'10px 14px', boxShadow:'0 4px 16px rgba(0,0,0,0.1)', fontSize:12, fontFamily:"'Nunito',sans-serif" }}>
      <div style={{ fontWeight:700, color:'var(--text-primary)', marginBottom:6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, color:'var(--text-secondary)', marginTop:2 }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:p.color, display:'inline-block', flexShrink:0 }} />
          <span style={{ fontWeight:600 }}>{p.name}:</span>
          <span style={{ color: p.color, fontWeight:700 }}>{prefix}{p.value?.toLocaleString()}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

// ── FCR gauge bar ──────────────────────────────────────────────────────────────
function FcrBar({ fcr }) {
  if (fcr === null) return <span style={{ color:'var(--text-muted)', fontSize:11 }}>No weight data</span>;
  const rating = fcr < 1.7 ? 'excellent' : fcr < 2.0 ? 'good' : fcr < 2.5 ? 'fair' : 'poor';
  const pct    = Math.min(100, (fcr / 3.5) * 100);
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
        <span style={{ fontSize:13, fontWeight:700, color: FCR_COLORS[rating] }}>{fcr}</span>
        <span style={{ fontSize:10, color: FCR_COLORS[rating], fontWeight:700, textTransform:'uppercase' }}>{rating}</span>
      </div>
      <div style={{ height:6, background:'var(--border)', borderRadius:3 }}>
        <div style={{ height:'100%', width:`${pct}%`, background: FCR_COLORS[rating], borderRadius:3, transition:'width 0.6s ease' }} />
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHead({ title, sub }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontFamily:"'Poppins',sans-serif", fontWeight:700, fontSize:14, color:'var(--text-primary)' }}>{title}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function Skeleton({ h = 60 }) {
  return <div style={{ height:h, background:'var(--bg-elevated)', borderRadius:8, animation:'pulse 1.5s infinite' }} />;
}
function EmptyChart({ msg = 'No data for this period' }) {
  return (
    <div style={{ height:160, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', gap:8 }}>
      <span style={{ fontSize:28 }}>📊</span>
      <span style={{ fontSize:12 }}>{msg}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function OwnerPage() {
  const { apiFetch } = useAuth();

  const [period,    setPeriod]    = useState(30);
  const [tab,       setTab]       = useState('overview'); // overview | mortality | fcr
  const [overview,  setOverview]  = useState(null);
  const [mortality, setMortality] = useState(null);
  const [mortTrend, setMortTrend] = useState(null);
  const [fcrData,   setFcrData]   = useState(null);
  const [forecast,  setForecast]  = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => { loadAll(); }, [period]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ovRes, fcRes, mortRes, mortTrendRes, fcrRes] = await Promise.all([
        apiFetch(`/api/analytics?report=overview&days=${period}`),
        apiFetch(`/api/analytics?report=forecast&days=${period}`),
        apiFetch(`/api/analytics?report=mortality_analysis&days=${period}`),
        apiFetch(`/api/analytics?report=mortality_trend&days=${period}`),
        apiFetch(`/api/analytics?report=fcr_analysis&days=${period}`),
      ]);
      if (ovRes.ok)        setOverview(await ovRes.json());
      if (fcRes.ok)        setForecast(await fcRes.json());
      if (mortRes.ok)      setMortality(await mortRes.json());
      if (mortTrendRes.ok) setMortTrend(await mortTrendRes.json());
      if (fcrRes.ok)       setFcrData(await fcrRes.json());
    } finally { setLoading(false); }
  };

  const { penProfitability = [], totals = {}, costBreakdown = {} } = overview || {};
  const forecastList  = forecast?.forecast || [];
  const harvestList   = forecast?.harvestPredictions || [];
  const fcrList       = fcrData?.fcrData || [];
  const mortSeries    = mortTrend?.combined || [];
  const penLines      = mortTrend?.pens || [];

  // KPIs
  const avgFCR = fcrList.length > 0
    ? (fcrList.filter(f => f.fcr).reduce((s, f) => s + f.fcr, 0) / fcrList.filter(f => f.fcr).length).toFixed(2)
    : '—';

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Header ── */}
        <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:'var(--text-primary)', margin:0 }}>📈 Business Intelligence</h1>
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>Profitability · Mortality Trends · FCR Analysis</p>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setPeriod(d)} className="btn"
                style={{ background: period===d ? 'var(--purple-light)' : '#fff', color: period===d ? 'var(--purple)' : 'var(--text-muted)', border:`1px solid ${period===d ? '#d4d8ff' : 'var(--border)'}`, fontWeight: period===d ? 700 : 600 }}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* ── KPI row ── */}
        <div className="grid-kpi" style={{ marginBottom:20 }}>
          {[
            { label:'Total Revenue',  value: loading ? '—' : fmtK(totals.revenue||0),  color:'var(--purple)', icon:'💰', sub:`last ${period} days` },
            { label:'Total Costs',    value: loading ? '—' : fmtK(totals.costs||0),    color:'var(--amber)',  icon:'📊', sub:'feed + labour' },
            { label:'Gross Profit',   value: loading ? '—' : fmtK(totals.profit||0),   color: Number(totals.profit)>=0 ? 'var(--green)' : 'var(--red)', icon:'📈', sub:`${totals.margin||0}% margin` },
            { label:'Avg FCR',        value: loading ? '—' : avgFCR,                   color:'#8b5cf6', icon:'🌾', sub:'feed conversion ratio' },
          ].map(k => (
            <div key={k.label} className="card" style={{ padding:'18px 20px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)' }}>{k.label}</span>
                <span style={{ fontSize:20 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:26, fontWeight:700, color:k.color, lineHeight:1 }}>{k.value}</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:6 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display:'flex', gap:0, marginBottom:20, background:'var(--bg-elevated)', borderRadius:10, padding:4, width:'fit-content', border:'1px solid var(--border)' }}>
          {[
            { key:'overview',  label:'💰 Profitability' },
            { key:'mortality', label:'💀 Mortality Trends' },
            { key:'fcr',       label:'🌾 FCR Analysis' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding:'7px 18px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit', transition:'all 0.15s',
                background: tab===t.key ? '#fff' : 'transparent',
                color:      tab===t.key ? 'var(--purple)' : 'var(--text-muted)',
                boxShadow:  tab===t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════ TAB: PROFITABILITY ══════════════════ */}
        {tab === 'overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:16 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* Revenue per pen — bar chart */}
              <div className="card">
                <SectionHead title="Revenue by Pen" sub={`Last ${period} days · ₦ Nigerian Naira`} />
                {loading ? <Skeleton h={200} /> : penProfitability.length === 0 ? <EmptyChart /> : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={penProfitability} margin={{ top:4, right:8, bottom:4, left:8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="penName" tick={{ fontSize:11, fill:'var(--text-muted)' }} />
                      <YAxis tickFormatter={v => fmtK(v)} tick={{ fontSize:10, fill:'var(--text-muted)' }} width={60} />
                      <Tooltip content={<ChartTooltip prefix="₦" />} />
                      <Legend wrapperStyle={{ fontSize:11 }} />
                      <Bar dataKey="revenue"   name="Revenue"    radius={[4,4,0,0]}>
                        {penProfitability.map((_, i) => <Cell key={i} fill={PEN_COLORS[i % PEN_COLORS.length]} />)}
                      </Bar>
                      <Bar dataKey="totalCost" name="Total Cost" fill="#e5e7eb" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Pen profitability table */}
              <div className="card">
                <SectionHead title="Profitability by Pen" />
                {loading ? <Skeleton h={120} /> : penProfitability.length === 0 ? (
                  <EmptyChart msg="No profitability data — add consumption and production records." />
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {penProfitability.map((p, i) => (
                      <div key={p.penId} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--bg-elevated)', borderRadius:9, border:'1px solid var(--border)', transition:'all 0.15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.background='var(--purple-light)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
                        <div style={{ width:10, height:10, borderRadius:'50%', background: PEN_COLORS[i % PEN_COLORS.length], flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>{p.penName}</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>{p.totalBirds?.toLocaleString()} birds · {p.operationType}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:14, fontWeight:700, color: p.margin>=20 ? 'var(--green)' : p.margin>=0 ? 'var(--amber)' : 'var(--red)' }}>{p.margin}% margin</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)' }}>{fmt(p.revenue)} rev · {fmt(p.totalCost)} cost</div>
                        </div>
                        <span className={`status-badge ${p.margin>=20?'status-green':p.margin>=0?'status-amber':'status-red'}`}>
                          {p.margin>=20?'Healthy':p.margin>=0?'Tight':'Loss'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cost breakdown */}
              <div className="card">
                <SectionHead title="Cost Breakdown" />
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {[
                    { label:'Feed & Nutrition',      pct: costBreakdown.feed||68,       color:'var(--green)' },
                    { label:'Labour',                pct: costBreakdown.labour||18,     color:'var(--blue)' },
                    { label:'Medication & Vaccines', pct: costBreakdown.medication||9,  color:'#8b5cf6' },
                    { label:'Utilities & Other',     pct: costBreakdown.other||5,       color:'var(--amber)' },
                  ].map(c => (
                    <div key={c.label} style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ width:38, fontSize:13, color:c.color, fontWeight:700, textAlign:'right', flexShrink:0 }}>{c.pct}%</div>
                      <div style={{ flex:1, height:8, background:'var(--border)', borderRadius:4 }}>
                        <div style={{ height:'100%', width:`${c.pct}%`, background:c.color, borderRadius:4, transition:'width 0.8s ease' }} />
                      </div>
                      <div style={{ fontSize:12, color:'var(--text-secondary)', width:180, flexShrink:0 }}>{c.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* 90-day forecast */}
              <div className="card" style={{ border:'1px solid #d4d8ff' }}>
                <SectionHead title="90-Day Revenue Forecast" />
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {forecastList.length === 0 ? <EmptyChart msg="Not enough data for forecast" /> : forecastList.map((f, i) => (
                    <div key={i} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, padding:'14px 16px', transition:'all 0.15s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.background='var(--purple-light)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>{f.month}</div>
                          <span style={{ fontSize:10, background:'var(--amber-bg)', color:'var(--amber)', border:'1px solid var(--amber-border)', borderRadius:4, padding:'1px 7px', display:'inline-block', marginTop:4 }}>
                            {f.confidence}% conf.
                          </span>
                        </div>
                        <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:20, fontWeight:700, color:'var(--purple)' }}>
                          {fmtK(f.totalRevenue || f.total || 0)}
                        </div>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width:`${f.confidence}%`, background:'var(--purple)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Harvest predictor */}
              {harvestList.length > 0 && (
                <div className="card" style={{ border:'1px solid #ede9fe' }}>
                  <SectionHead title="🤖 Harvest Predictor" />
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {harvestList.map((h, i) => (
                      <div key={i} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, padding:'12px 14px' }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:8 }}>{h.batchCode}</div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:12 }}>
                          {[
                            { label:'Optimal harvest', val: h.optimalHarvestDate ? new Date(h.optimalHarvestDate).toLocaleDateString('en-NG',{day:'numeric',month:'short'}) : '—', color:'var(--blue)' },
                            { label:'Proj. weight',    val: h.projectedWeightG ? `${h.projectedWeightG}g` : '—', color:'var(--green)' },
                            { label:'Est. revenue',    val: fmtK(h.projectedRevenue||0), color:'var(--purple)' },
                            { label:'Proj. margin',    val: `${h.projectedMargin||0}%`, color:'var(--green)' },
                          ].map(s => (
                            <div key={s.label}>
                              <div style={{ color:'var(--text-muted)', marginBottom:2 }}>{s.label}</div>
                              <div style={{ color:s.color, fontWeight:700 }}>{s.val}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Export center */}
              <div className="card">
                <SectionHead title="Export Center" />
                {[
                  { name:'Monthly Production Report', icon:'📊' },
                  { name:'Financial Summary',          icon:'💰' },
                  { name:'Compliance Report',          icon:'📋' },
                  { name:'Feed Analysis',              icon:'🌾' },
                  { name:'Mortality Records',          icon:'📉' },
                ].map(r => (
                  <div key={r.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span>{r.icon}</span>
                      <span style={{ fontSize:12, color:'var(--text-secondary)', fontWeight:600 }}>{r.name}</span>
                    </div>
                    <div style={{ display:'flex', gap:5 }}>
                      <button className="btn btn-outline" style={{ padding:'3px 10px', fontSize:11 }}>PDF</button>
                      <button className="btn btn-ghost"   style={{ padding:'3px 10px', fontSize:11 }}>CSV</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ TAB: MORTALITY TRENDS ══════════════════ */}
        {tab === 'mortality' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* Summary KPIs */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
              {[
                { label:'Total Deaths',   value: mortality?.totalDeaths || 0,       color:'var(--red)' },
                { label:'Daily Average',  value: mortality?.avgDaily    || '0.0',    color:'var(--text-secondary)' },
                { label:'Anomalies',      value: mortality?.anomalies?.length || 0,  color: (mortality?.anomalies?.length||0) > 0 ? 'var(--amber)' : 'var(--green)' },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding:'18px 20px', textAlign:'center' }}>
                  <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:28, fontWeight:700, color:s.color, lineHeight:1 }}>{s.value}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Mortality trend line chart */}
            <div className="card">
              <SectionHead title={`Daily Mortality Trend — Last ${period} Days`} sub="Deaths per day across all pens" />
              {loading ? <Skeleton h={240} /> : mortSeries.length === 0 ? <EmptyChart msg="No mortality records in this period" /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={mortSeries} margin={{ top:8, right:16, bottom:4, left:0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={d => { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth()+1}`; }} tick={{ fontSize:10, fill:'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize:10, fill:'var(--text-muted)' }} width={30} />
                    <Tooltip content={<ChartTooltip suffix=" deaths" />} />
                    <Legend wrapperStyle={{ fontSize:11 }} />
                    {/* Line per pen */}
                    {penLines.map((pen, i) => (
                      <Line key={pen.id} type="monotone" dataKey={pen.name} stroke={PEN_COLORS[i % PEN_COLORS.length]}
                        strokeWidth={2} dot={false} activeDot={{ r:4 }} />
                    ))}
                    {/* Anomaly reference lines */}
                    {(mortality?.anomalies || []).slice(0, 5).map((a, i) => (
                      <ReferenceLine key={i}
                        x={new Date(a.date).toISOString().split('T')[0]}
                        stroke="var(--red)" strokeDasharray="4 2" strokeWidth={1.5}
                        label={{ value:'⚠', position:'top', fontSize:10 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Per-pen mortality breakdown */}
            {!loading && (mortTrend?.seriesByPen || []).length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12 }}>
                {mortTrend.seriesByPen.map((pen, i) => (
                  <div key={pen.penId} className="card">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13, color:'var(--text-primary)' }}>{pen.penName}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>{pen.opType}</div>
                      </div>
                      <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color: pen.total > 20 ? 'var(--red)' : 'var(--text-primary)' }}>
                        {pen.total}
                      </div>
                    </div>
                    {pen.series.length > 0 ? (
                      <ResponsiveContainer width="100%" height={80}>
                        <BarChart data={pen.series} margin={{ top:0, right:0, bottom:0, left:0 }}>
                          <Bar dataKey="value" fill={PEN_COLORS[i % PEN_COLORS.length]} radius={[2,2,0,0]} />
                          <XAxis hide />
                          <YAxis hide />
                          <Tooltip content={({ active, payload }) =>
                            active && payload?.[0] ? (
                              <div style={{ background:'#fff', border:'1px solid var(--border)', borderRadius:6, padding:'6px 10px', fontSize:11 }}>
                                <strong>{payload[0].value} deaths</strong>
                              </div>
                            ) : null
                          } />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{ height:80, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', fontSize:11 }}>No deaths recorded</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Anomaly alerts */}
            {(mortality?.anomalies?.length || 0) > 0 && (
              <div className="card">
                <SectionHead title="⚡ Anomaly Detection" sub="Statistical outliers (z-score > 2.0)" />
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {mortality.anomalies.map((a, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'var(--amber-bg)', borderRadius:9, border:'1px solid var(--amber-border)' }}>
                      <span style={{ fontSize:20 }}>⚠️</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>
                          {new Date(a.date).toLocaleDateString('en-NG', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}
                        </div>
                        <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>
                          {a.value} deaths recorded · z-score: {a.zScore?.toFixed(2)} · {a.zScore > 3 ? 'Severe spike' : 'Notable spike'}
                        </div>
                      </div>
                      <span style={{ fontSize:22, fontWeight:700, color:'var(--red)', fontFamily:"'Poppins',sans-serif" }}>{a.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB: FCR ANALYSIS ══════════════════ */}
        {tab === 'fcr' && (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* FCR explainer */}
            <div className="card" style={{ background:'var(--purple-light)', border:'1px solid #d4d8ff' }}>
              <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                <div style={{ flex:1, minWidth:180 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'var(--purple)', marginBottom:4 }}>Feed Conversion Ratio (FCR)</div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.6 }}>
                    FCR = Total Feed Consumed (kg) ÷ Total Weight Gain (kg).
                    Lower is better. Broilers typically target 1.6–1.9.
                  </div>
                </div>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                  {Object.entries(FCR_LABELS).filter(([k]) => k !== 'unknown').map(([rating, label]) => (
                    <div key={rating} style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ width:10, height:10, borderRadius:'50%', background: FCR_COLORS[rating], display:'inline-block' }} />
                      <span style={{ fontSize:11, color:'var(--text-secondary)', fontWeight:600 }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* FCR bar chart */}
            <div className="card">
              <SectionHead title="FCR by Flock (Broilers)" sub={`Feed consumed vs weight gain · last ${period} days`} />
              {loading ? <Skeleton h={200} /> : fcrList.length === 0 ? (
                <EmptyChart msg="No broiler flocks with feed and weight data" />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, fcrList.length * 50)}>
                  <BarChart data={fcrList} layout="vertical" margin={{ top:4, right:40, bottom:4, left:8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" domain={[0, 3.5]} tick={{ fontSize:10, fill:'var(--text-muted)' }} tickFormatter={v => v.toFixed(1)} />
                    <YAxis type="category" dataKey="batchCode" tick={{ fontSize:11, fill:'var(--text-secondary)' }} width={100} />
                    <Tooltip content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <div style={{ background:'#fff', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:12 }}>
                          <div style={{ fontWeight:700, marginBottom:4 }}>{payload[0].payload.batchCode}</div>
                          <div>FCR: <strong style={{ color: FCR_COLORS[payload[0].payload.fcrRating] }}>{payload[0].value}</strong></div>
                          <div style={{ color:'var(--text-muted)', marginTop:2 }}>Feed: {payload[0].payload.totalFeedKg}kg · Age: {payload[0].payload.ageInDays}d</div>
                        </div>
                      ) : null
                    } />
                    {/* Industry target reference */}
                    <ReferenceLine x={1.8} stroke="var(--green)" strokeDasharray="4 2" label={{ value:'Target 1.8', position:'right', fontSize:10, fill:'var(--green)' }} />
                    <Bar dataKey="fcr" name="FCR" radius={[0,4,4,0]}>
                      {fcrList.map((entry, i) => (
                        <Cell key={i} fill={FCR_COLORS[entry.fcrRating] || '#9ca3af'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* FCR detail cards */}
            {!loading && fcrList.length > 0 && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12 }}>
                {fcrList.map((f, i) => (
                  <div key={f.flockId} className="card">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                      <div>
                        <div style={{ fontWeight:700, fontSize:13 }}>{f.batchCode}</div>
                        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>{f.penName} › {f.sectionName}</div>
                      </div>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background: FCR_COLORS[f.fcrRating] + '15', color: FCR_COLORS[f.fcrRating], border:`1px solid ${FCR_COLORS[f.fcrRating]}30`, textTransform:'uppercase' }}>
                        {f.fcrRating}
                      </span>
                    </div>
                    <FcrBar fcr={f.fcr} />
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginTop:12, fontSize:11 }}>
                      {[
                        { label:'Birds',    value: f.currentCount?.toLocaleString() },
                        { label:'Feed',     value: `${f.totalFeedKg}kg` },
                        { label:'Age',      value: `${f.ageInDays}d` },
                      ].map(s => (
                        <div key={s.label} style={{ textAlign:'center', background:'var(--bg-elevated)', borderRadius:7, padding:'8px 4px' }}>
                          <div style={{ fontWeight:700, color:'var(--text-primary)', fontSize:13 }}>{s.value}</div>
                          <div style={{ color:'var(--text-muted)', fontSize:10, marginTop:1 }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    {f.currentWeightG && (
                      <div style={{ marginTop:8, fontSize:11, color:'var(--text-muted)', padding:'6px 10px', background:'var(--bg-elevated)', borderRadius:6 }}>
                        Latest avg weight: <strong style={{ color:'var(--green)' }}>{Number(f.currentWeightG).toFixed(0)}g</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!loading && fcrList.length === 0 && (
              <div className="card" style={{ textAlign:'center', padding:'40px 20px' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🌾</div>
                <div style={{ fontWeight:700, color:'var(--text-secondary)', marginBottom:8 }}>No FCR data available</div>
                <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                  FCR requires active broiler flocks with feed consumption logs and at least one weight record.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
