'use client';
import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import { ProfitabilityChart } from '@/components/ui/DashboardWidgets';

const MOCK_FORECAST = [
  { month: 'April 2026', totalRevenue: 58000, confidence: 90 },
  { month: 'May 2026', totalRevenue: 61000, confidence: 75 },
  { month: 'June 2026', totalRevenue: 64000, confidence: 60 },
];
const MOCK_HARVEST = [
  { batchCode: 'BRO-2026-001', projectedWeightG: 2450, projectedRevenue: 25519, projectedMargin: 31.4 },
  { batchCode: 'BRO-2026-002', projectedWeightG: 2450, projectedRevenue: 25323, projectedMargin: 31.4 },
  { batchCode: 'BRO-2026-003', projectedWeightG: 2450, projectedRevenue: 24593, projectedMargin: 31.4 },
];

export default function OwnerPage() {
  const { apiFetch } = useAuth();
  const [overview, setOverview] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [mortality, setMortality] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);

  useEffect(() => { loadAll(); }, [period]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ovRes, fcRes, mortRes] = await Promise.all([
        apiFetch(`/api/analytics?report=overview&days=${period}`),
        apiFetch(`/api/analytics?report=forecast&days=${period}`),
        apiFetch(`/api/analytics?report=mortality_analysis&days=${period}`),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (fcRes.ok) setForecast(await fcRes.json());
      if (mortRes.ok) setMortality(await mortRes.json());
    } finally { setLoading(false); }
  };

  const { penProfitability = [], totals = {}, costBreakdown = {} } = overview || {};
  const forecastList = forecast?.forecast || MOCK_FORECAST;
  const harvestList = forecast?.harvestPredictions?.length ? forecast.harvestPredictions : MOCK_HARVEST;

  return (
    <AppShell>
      <div className="animate-in">
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:'var(--text-primary)', margin:0 }}>Business Intelligence</h1>
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>Profitability, forecasting and cost analysis</p>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {[7,30,90].map(d => (
              <button key={d} onClick={() => setPeriod(d)} className="btn"
                style={{ background: period===d ? 'var(--purple-light)' : '#fff', color: period===d ? 'var(--purple)' : 'var(--text-muted)', border: `1px solid ${period===d ? '#d4d8ff' : 'var(--border)'}`, fontWeight: period===d ? 700 : 600 }}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {[
            { label:'Revenue', value: loading ? '—' : `$${Number(totals.revenue||0).toLocaleString()}`, color:'var(--purple)', icon:'💰', sub:`last ${period} days` },
            { label:'Total Costs', value: loading ? '—' : `$${Number(totals.costs||0).toLocaleString()}`, color:'var(--amber)', icon:'📊', sub:'feed, labour, meds' },
            { label:'Gross Profit', value: loading ? '—' : `$${Number(totals.profit||0).toLocaleString()}`, color: Number(totals.profit)>=0 ? 'var(--green)' : 'var(--red)', icon:'📈', sub:`${totals.margin||0}% margin` },
            { label:'FCR Average', value:'1.84', color:'#8b5cf6', icon:'🌾', sub:'feed conversion ratio' },
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

        <div style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:16 }}>
          {/* Left */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* Profitability by pen */}
            <div className="card">
              <div className="section-header">Profitability by Pen</div>
              {loading ? <Skeleton h={180} /> : penProfitability.length === 0 ? (
                <EmptyState msg="No profitability data yet — add consumption and production records." />
              ) : (
                <>
                  <ProfitabilityChart data={penProfitability} />
                  <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:16 }}>
                    {penProfitability.map(p => (
                      <div key={p.penId} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:'var(--bg-elevated)', borderRadius:9, border:'1px solid var(--border)', transition:'all 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.background='var(--purple-light)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, color:'var(--text-primary)', fontWeight:700 }}>{p.penName}</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>{p.totalBirds?.toLocaleString()} birds · {p.birdType}</div>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:14, fontWeight:700, color: p.margin>=20 ? 'var(--green)' : p.margin>=0 ? 'var(--amber)' : 'var(--red)' }}>{p.margin}% margin</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)' }}>${p.revenue?.toLocaleString()} rev · ${p.totalCost?.toLocaleString()} cost</div>
                        </div>
                        <span className={`status-badge ${p.margin>=20?'status-green':p.margin>=0?'status-amber':'status-red'}`}>
                          {p.margin>=20?'Healthy':p.margin>=0?'Tight':'Loss'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Cost breakdown */}
            <div className="card">
              <div className="section-header">Cost Breakdown</div>
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                {[
                  { label:'Feed & Nutrition', pct: costBreakdown.feed||68, color:'var(--green)' },
                  { label:'Labour', pct: costBreakdown.labour||18, color:'var(--blue)' },
                  { label:'Medication & Vaccines', pct: costBreakdown.medication||9, color:'#8b5cf6' },
                  { label:'Utilities & Other', pct: costBreakdown.other||5, color:'var(--amber)' },
                ].map(c => (
                  <div key={c.label} style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:38, fontSize:13, color:c.color, fontWeight:700, textAlign:'right', flexShrink:0 }}>{c.pct}%</div>
                    <div style={{ flex:1, height:8, background:'var(--border)', borderRadius:4 }}>
                      <div style={{ height:'100%', width:`${c.pct}%`, background:c.color, borderRadius:4, transition:'width 0.8s ease' }} />
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-secondary)', width:160, flexShrink:0 }}>{c.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:16, padding:'14px 16px', background:'var(--purple-light)', borderRadius:9, border:'1px solid #d4d8ff' }}>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Cost per egg produced</div>
                <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:26, fontWeight:700, color:'var(--purple)' }}>$0.14</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>Target: &lt;$0.16 · Industry avg: $0.17</div>
              </div>
            </div>

            {/* Mortality analysis */}
            <div className="card">
              <div className="section-header">Mortality Analysis — {period}-Day Window</div>
              {loading ? <Skeleton h={80} /> : (
                <div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                    {[
                      { label:'Total Deaths', value: mortality?.totalDeaths||0, color:'var(--red)' },
                      { label:'Daily Average', value: mortality?.avgDaily||'0.0', color:'var(--text-secondary)' },
                      { label:'Anomalies', value: mortality?.anomalies?.length||0, color: (mortality?.anomalies?.length||0)>0 ? 'var(--amber)' : 'var(--green)' },
                    ].map(s => (
                      <div key={s.label} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, padding:'12px', textAlign:'center' }}>
                        <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3, textTransform:'uppercase', letterSpacing:'0.06em' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {(mortality?.anomalies?.length||0) > 0 && (
                    <div className="alert alert-amber">
                      <span style={{ fontSize:18 }}>⚡</span>
                      <div>
                        <div style={{ fontWeight:700, marginBottom:4 }}>{mortality.anomalies.length} anomalous day{mortality.anomalies.length>1?'s':''} detected</div>
                        {mortality.anomalies.slice(0,3).map((a,i) => (
                          <div key={i} style={{ fontSize:11, marginTop:2 }}>
                            {new Date(a.date).toLocaleDateString('en-NG',{day:'numeric',month:'short'})} — {a.value} deaths (z-score: {a.zScore?.toFixed(1)})
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right */}
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

            {/* Revenue forecast */}
            <div className="card" style={{ border:'1px solid #d4d8ff' }}>
              <div className="section-header">90-Day Revenue Forecast</div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {forecastList.map((f,i) => (
                  <div key={i} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, padding:'14px 16px', transition:'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.background='var(--purple-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                      <div>
                        <div style={{ fontSize:13, color:'var(--text-primary)', fontWeight:700 }}>{f.month}</div>
                        <span style={{ fontSize:10, background:'var(--amber-bg)', color:'var(--amber)', border:'1px solid var(--amber-border)', borderRadius:4, padding:'1px 7px', display:'inline-block', marginTop:4 }}>
                          {f.confidence}% conf.
                        </span>
                      </div>
                      <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:'var(--purple)' }}>
                        ${Number(f.totalRevenue||f.total||0).toLocaleString()}
                      </div>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width:`${f.confidence}%`, background:'var(--purple)' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Harvest predictor */}
            <div className="card" style={{ border:'1px solid #ede9fe' }}>
              <div className="section-header">🤖 AI Harvest Predictor</div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {harvestList.map((h,i) => (
                  <div key={i} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, padding:'14px 16px', transition:'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor='#8b5cf6'; e.currentTarget.style.background='#faf5ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
                    <div style={{ fontSize:13, color:'var(--text-primary)', fontWeight:700, marginBottom:10 }}>{h.batchCode}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:12 }}>
                      <div>
                        <div style={{ color:'var(--text-muted)', marginBottom:2 }}>Optimal harvest</div>
                        <div style={{ color:'var(--blue)', fontWeight:700 }}>
                          {h.optimalHarvestDate ? new Date(h.optimalHarvestDate).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}) : '18 Mar 2026'}
                        </div>
                      </div>
                      <div>
                        <div style={{ color:'var(--text-muted)', marginBottom:2 }}>Projected weight</div>
                        <div style={{ color:'var(--green)', fontWeight:700 }}>{h.projectedWeightG ? `${h.projectedWeightG}g` : '2,450g'}</div>
                      </div>
                      <div>
                        <div style={{ color:'var(--text-muted)', marginBottom:2 }}>Est. revenue</div>
                        <div style={{ color:'var(--purple)', fontWeight:700 }}>${Number(h.projectedRevenue||0).toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ color:'var(--text-muted)', marginBottom:2 }}>Proj. margin</div>
                        <div style={{ color:'var(--green)', fontWeight:700 }}>{h.projectedMargin||31.4}%</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Export center */}
            <div className="card">
              <div className="section-header">Export Center</div>
              {[
                { name:'Monthly Production Report', icon:'📊' },
                { name:'Financial Summary', icon:'💰' },
                { name:'Compliance Report', icon:'📋' },
                { name:'Feed Analysis', icon:'🌾' },
                { name:'Mortality Records', icon:'📉' },
              ].map(r => (
                <div key={r.name} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:'1px solid var(--border)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span>{r.icon}</span>
                    <span style={{ fontSize:12, color:'var(--text-secondary)', fontWeight:600 }}>{r.name}</span>
                  </div>
                  <div style={{ display:'flex', gap:5 }}>
                    <button className="btn btn-outline" style={{ padding:'3px 10px', fontSize:11 }}>PDF</button>
                    <button className="btn btn-ghost" style={{ padding:'3px 10px', fontSize:11 }}>CSV</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
function Skeleton({ h=60 }) {
  return <div style={{ height:h, background:'var(--bg-elevated)', borderRadius:8, animation:'pulse 1.5s infinite' }} />;
}
function EmptyState({ msg }) {
  return <div style={{ color:'var(--text-muted)', fontSize:12, padding:'20px 0', textAlign:'center' }}>{msg}</div>;
}
