'use client';
// app/mortality/page.js — Mortality Records Module
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import PortalModal from '@/components/ui/Modal';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

const PERIODS = [7, 14, 30, 90];

const CAUSE_META = {
  DISEASE:     { label:'Disease',      color:'#ef4444', icon:'🦠' },
  INJURY:      { label:'Injury',       color:'#f97316', icon:'🩹' },
  CULLED:      { label:'Culled',       color:'#8b5cf6', icon:'✂' },
  HEAT_STRESS: { label:'Heat Stress',  color:'#f59e0b', icon:'🌡' },
  FEED_ISSUE:  { label:'Feed Issue',   color:'#84cc16', icon:'🌾' },
  PREDATOR:    { label:'Predator',     color:'#6b7280', icon:'🦅' },
  WATER_ISSUE: { label:'Water Issue',  color:'#3b82f6', icon:'💧' },
  RESPIRATORY: { label:'Respiratory',  color:'#ec4899', icon:'🫁' },
  UNKNOWN:     { label:'Unknown',      color:'#9ca3af', icon:'❓' },
};

const fmt     = n => Number(n || 0).toLocaleString('en-NG');
const fmtDate = d => new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short' });

function KpiCard({ icon, label, value, sub, color, warn=false }) {
  return (
    <div className="card" style={{ padding:'16px 20px', border: warn ? '1.5px solid var(--red-border)' : undefined, background: warn ? '#fff8f8' : undefined }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize:20 }}>{icon}</span>
      </div>
      <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:24, fontWeight:700, color:color||'var(--text-primary)', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:6 }}>{sub}</div>}
    </div>
  );
}
function Skel({ h=80 }) {
  return <div style={{ height:h, background:'var(--bg-elevated)', borderRadius:8, animation:'pulse 1.5s infinite' }} />;
}
function Empty({ msg='No data for this period' }) {
  return <div style={{ height:100, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', fontSize:12 }}>{msg}</div>;
}
function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'#fff', border:'1px solid var(--border)', borderRadius:9, padding:'10px 14px', fontSize:12, boxShadow:'0 4px 16px rgba(0,0,0,.08)' }}>
      <div style={{ fontWeight:700, marginBottom:6 }}>{fmtDate(label)}</div>
      {payload.map((p,i) => (
        <div key={i} style={{ display:'flex', gap:6, alignItems:'center', marginTop:3 }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:p.color, display:'inline-block' }} />
          <span style={{ color:'var(--text-secondary)' }}>{p.name}:</span>
          <span style={{ fontWeight:700, color:p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Log Mortality Modal ───────────────────────────────────────────────────────
function LogModal({ flocks, apiFetch, onClose, onSave }) {
  const today = new Date().toISOString().split('T')[0];
  const [f, setF]       = useState({ flockId:'', penSectionId:'', recordDate:today, count:'', causeCode:'UNKNOWN', notes:'' });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const set = (k,v) => setF(p=>({...p,[k]:v}));

  const selectedFlock = flocks.find(fl=>fl.id===f.flockId);
  const count = Number(f.count)||0;
  const mortRate = selectedFlock?.currentCount > 0 ? ((count/selectedFlock.currentCount)*100).toFixed(2) : null;
  const isSpikeWarning = selectedFlock && count > 0 && count > selectedFlock.currentCount * 0.01;

  const onFlockChange = id => {
    const fl = flocks.find(x=>x.id===id);
    setF(p=>({...p, flockId:id, penSectionId:fl?.penSectionId||''}));
  };

  async function save() {
    if (!f.flockId) return setErr('Select a flock');
    if (count <= 0) return setErr('Enter number of deaths');
    if (selectedFlock && count > selectedFlock.currentCount) return setErr(`Count (${count}) exceeds live bird count (${fmt(selectedFlock.currentCount)})`);
    setSaving(true); setErr('');
    try {
      const res = await apiFetch('/api/mortality', { method:'POST', body:JSON.stringify({
        flockId:f.flockId, penSectionId:f.penSectionId,
        recordDate:f.recordDate, count, causeCode:f.causeCode,
        ...(f.notes.trim() && { notes:f.notes.trim() }),
      })});
      const d = await res.json();
      if (!res.ok) return setErr(d.error||'Save failed');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <PortalModal title="💀 Record Mortality" width={480} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save Record'}</button></>}>
      {err && <div className="alert alert-red" style={{ marginBottom:12 }}>⚠ {err}</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <label className="label">Flock *</label>
          <select className="input" value={f.flockId} onChange={e=>onFlockChange(e.target.value)}>
            <option value="">— Select flock —</option>
            {flocks.map(fl=><option key={fl.id} value={fl.id}>{fl.batchCode} · {fl.penName} › {fl.sectionName} · {fmt(fl.currentCount)} live birds</option>)}
          </select>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={f.recordDate} onChange={e=>set('recordDate',e.target.value)} max={today} />
          </div>
          <div>
            <label className="label">Number of Deaths *</label>
            <input type="number" className="input" min="0" value={f.count} onChange={e=>set('count',e.target.value)} placeholder="0" />
            {mortRate !== null && (
              <div style={{ fontSize:11, marginTop:4, color:Number(mortRate)>1?'#ef4444':'var(--text-muted)' }}>
                Mortality rate: <strong>{mortRate}%</strong>
                {isSpikeWarning && <span style={{ marginLeft:6, color:'#ef4444' }}>⚠ Above 1% threshold</span>}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">Cause of Death</label>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
            {Object.entries(CAUSE_META).map(([code,meta])=>(
              <button key={code} onClick={()=>set('causeCode',code)} type="button"
                style={{ padding:'8px', border:`1.5px solid ${f.causeCode===code?meta.color:'var(--border)'}`, borderRadius:8, background:f.causeCode===code?`${meta.color}12`:'#fff', cursor:'pointer', textAlign:'center' }}>
                <div style={{ fontSize:16 }}>{meta.icon}</div>
                <div style={{ fontSize:10, fontWeight:700, color:f.causeCode===code?meta.color:'var(--text-muted)', marginTop:2 }}>{meta.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Notes <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(optional)</span></label>
          <textarea className="input" rows={2} value={f.notes} onChange={e=>set('notes',e.target.value)} placeholder="Observations, symptoms, actions taken…" style={{ resize:'vertical' }} />
        </div>
      </div>
    </PortalModal>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
// ── Edit Mortality Modal (for rejected/returned records) ──────────────────────
function EditMortalityModal({ record, apiFetch, onClose, onSave }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    count:      String(record.count),
    causeCode:  record.causeCode || 'UNKNOWN',
    recordDate: record.recordDate?.split('T')[0] || today,
    notes:      record.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const count = Number(form.count) || 0;
  const mortRate = record.flock?.currentCount > 0
    ? ((count / record.flock.currentCount) * 100).toFixed(2) : null;
  const isSpikeWarning = count > 0 && record.flock?.currentCount > 0 && count > record.flock.currentCount * 0.01;

  async function save() {
    if (count <= 0) return setError('Enter number of deaths');
    if (record.flock?.currentCount && count > record.flock.currentCount)
      return setError(`Count (${count}) exceeds live bird count (${fmt(record.flock.currentCount)})`);
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/mortality/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          count,
          causeCode:  form.causeCode,
          recordDate: form.recordDate,
          notes:      form.notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <PortalModal title="✏️ Correct & Resubmit" width={480} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Resubmit Record'}</button></>}>
      {record.rejectionReason && (
        <div style={{ marginBottom: 14, padding: '10px 14px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 2 }}>↩ Returned for correction</div>
          <div style={{ color: '#7f1d1d' }}>{record.rejectionReason}</div>
        </div>
      )}
      {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>⚠ {error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label">Flock</label>
          <div style={{ padding: '9px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
            {record.flock?.batchCode} · {record.penName} › {record.sectionName}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={form.recordDate} onChange={e => set('recordDate', e.target.value)} max={today} />
          </div>
          <div>
            <label className="label">Number of Deaths *</label>
            <input type="number" className="input" min="1" value={form.count} onChange={e => set('count', e.target.value)} />
            {mortRate !== null && (
              <div style={{ fontSize: 11, marginTop: 4, color: Number(mortRate) > 1 ? '#ef4444' : 'var(--text-muted)' }}>
                Mortality rate: <strong>{mortRate}%</strong>
                {isSpikeWarning && <span style={{ marginLeft: 6, color: '#ef4444' }}>⚠ Above 1% threshold</span>}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">Cause of Death</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {Object.entries(CAUSE_META).map(([code, meta]) => (
              <button key={code} onClick={() => set('causeCode', code)} type="button"
                style={{ padding: '8px', border: `1.5px solid ${form.causeCode === code ? meta.color : 'var(--border)'}`, borderRadius: 8, background: form.causeCode === code ? `${meta.color}12` : '#fff', cursor: 'pointer', textAlign: 'center' }}>
                <div style={{ fontSize: 16 }}>{meta.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: form.causeCode === code ? meta.color : 'var(--text-muted)', marginTop: 2 }}>{meta.label}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Notes <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Observations, symptoms, actions taken…" style={{ resize: 'vertical' }} />
        </div>
      </div>
    </PortalModal>
  );
}


export default function MortalityPage() {
  const { apiFetch, user } = useAuth();
  const [days,    setDays]    = useState(30);
  const [data,    setData]    = useState(null);
  const [flocks,  setFlocks]  = useState([]);
  const [flock,   setFlock]   = useState('');
  const [loading, setLoading] = useState(true);
  const [modal,      setModal]      = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [tab,     setTab]     = useState('overview');

  const canLog = ['PEN_WORKER','PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mortRes, fsRes] = await Promise.all([
        apiFetch(`/api/mortality?days=${days}${flock?`&flockId=${flock}`:''}`),
        apiFetch('/api/farm-structure'),
      ]);
      if (mortRes.ok) setData(await mortRes.json());
      if (fsRes.ok) {
        const { farms=[] } = await fsRes.json();
        setFlocks(farms.flatMap(farm =>
          farm.pens.flatMap(pen =>
            pen.sections
              .filter(sec => sec.activeFlock)
              .map(sec => ({
                ...sec.activeFlock, penSectionId:sec.id, sectionName:sec.name, penName:pen.name,
              }))
          )
        ));
      }
    } finally { setLoading(false); }
  }, [apiFetch, days, flock]);

  useEffect(() => { load(); }, [load]);

  const { summary={}, records=[] } = data || {};

  // Build daily chart data from summary.dailyTotals
  const chartData = Object.entries(summary.dailyTotals || {})
    .map(([date, count]) => ({ date, count }))
    .sort((a,b) => a.date.localeCompare(b.date));

  // Compute avg for anomaly reference line
  const avgDaily = summary.avgDaily || 0;
  const spikeThreshold = Math.max(avgDaily * 2, 10);

  // Cause breakdown
  const causeData = Object.entries(summary.causeBreakdown || {})
    .map(([code, count]) => ({ code, count, ...CAUSE_META[code] }))
    .sort((a,b) => b.count - a.count);

  // Per-flock summary from records
  const flockSummary = (() => {
    const map = {};
    records.forEach(r => {
      const k = r.flock?.batchCode; if (!k) return;
      if (!map[k]) map[k]={ batchCode:k, pen:r.penSection?.pen?.name, total:0, causes:{} };
      map[k].total += r.count;
      map[k].causes[r.causeCode] = (map[k].causes[r.causeCode]||0) + r.count;
    });
    return Object.values(map).sort((a,b)=>b.total-a.total);
  })();

  const totalDeaths   = summary.totalDeaths || 0;
  const hasAnomaly    = chartData.some(d => d.count >= spikeThreshold);

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Header ── */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, margin:0 }}>💀 Mortality Records</h1>
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>Daily death records, cause analysis, and anomaly detection</p>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ display:'flex', gap:4 }}>
              {PERIODS.map(d=>(
                <button key={d} onClick={()=>setDays(d)}
                  style={{ padding:'5px 12px', fontSize:11, fontWeight:days===d?700:600, border:`1px solid ${days===d?'#d4d8ff':'var(--border)'}`, borderRadius:7, background:days===d?'var(--purple-light)':'#fff', color:days===d?'var(--purple)':'var(--text-muted)', cursor:'pointer' }}>
                  {d}d
                </button>
              ))}
            </div>
            {canLog && <button className="btn btn-primary" onClick={()=>setModal(true)}>+ Record Death</button>}
          </div>
        </div>

        {/* Anomaly alert banner */}
        {!loading && hasAnomaly && (
          <div style={{ marginBottom:16, padding:'12px 16px', background:'#fff5f5', border:'1.5px solid var(--red-border)', borderRadius:10, display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:20 }}>🚨</span>
            <div>
              <div style={{ fontWeight:700, color:'var(--red)', fontSize:13 }}>Mortality spike detected in this period</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>One or more days exceeded 2× the average daily rate ({avgDaily.toFixed(1)} avg → {spikeThreshold.toFixed(0)} threshold). Review records below.</div>
            </div>
          </div>
        )}

        {/* ── KPIs ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {loading ? Array(4).fill(0).map((_,i)=><Skel key={i} h={90}/>) : <>
            <KpiCard icon="💀" label="Total Deaths"  value={fmt(totalDeaths)}          sub={`last ${days} days`}       color={totalDeaths>50?'#ef4444':'var(--text-primary)'} warn={totalDeaths>50} />
            <KpiCard icon="📅" label="Daily Average" value={avgDaily.toFixed(1)}        sub="deaths per day"            color={avgDaily>5?'#ef4444':'var(--text-primary)'} />
            <KpiCard icon="🦠" label="Top Cause"     value={causeData[0]?.label||'—'}   sub={causeData[0]?`${fmt(causeData[0].count)} deaths`:'No records'} color={causeData[0]?.color} />
            <KpiCard icon="📋" label="Records"       value={fmt(records.length)}        sub={`${days}-day period`}      color="var(--blue)" />
          </>}
        </div>

        {/* Flock filter */}
        {flocks.length > 1 && (
          <div style={{ marginBottom:16 }}>
            <select className="input" style={{ maxWidth:300 }} value={flock} onChange={e=>setFlock(e.target.value)}>
              <option value="">All flocks</option>
              {flocks.map(fl=><option key={fl.id} value={fl.id}>{fl.batchCode} — {fl.penName}</option>)}
            </select>
          </div>
        )}

        {/* ── Tabs ── */}
        <div style={{ display:'flex', borderBottom:'2px solid var(--border)', marginBottom:20 }}>
          {[['overview','📊 Overview'],['log','📋 Records']].map(([key,lbl])=>(
            <button key={key} onClick={()=>setTab(key)}
              style={{ padding:'10px 20px', border:'none', background:'none', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit', color:tab===key?'var(--purple)':'var(--text-muted)', borderBottom:`3px solid ${tab===key?'var(--purple)':'transparent'}`, marginBottom:-2 }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* ── Overview ── */}
        {tab==='overview' && (
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* Daily trend */}
              <div className="card">
                <div style={{ fontWeight:700, fontSize:14, marginBottom:2 }}>Daily Mortality</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:16 }}>Deaths per day — red dashed line = spike threshold (2× avg)</div>
                {loading ? <Skel h={200}/> : chartData.length===0 ? <Empty/> : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top:4, right:8, bottom:4, left:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize:10, fill:'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize:10, fill:'var(--text-muted)' }} width={36} />
                      <Tooltip content={<ChartTip/>} />
                      {spikeThreshold > 0 && (
                        <ReferenceLine y={spikeThreshold} stroke="#ef4444" strokeDasharray="5 5" label={{ value:'Spike', position:'insideTopRight', fontSize:9, fill:'#ef4444' }} />
                      )}
                      <Bar dataKey="count" name="Deaths" radius={[3,3,0,0]}>
                        {chartData.map((d,i)=>(
                          <Cell key={i} fill={d.count>=spikeThreshold?'#ef4444':'#f97316'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Per-flock table */}
              <div className="card">
                <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>By Flock</div>
                {loading ? <Skel h={120}/> : flockSummary.length===0 ? <Empty msg="No mortality recorded this period"/> : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {flockSummary.map(fl=>{
                      const topCause = Object.entries(fl.causes).sort((a,b)=>b[1]-a[1])[0];
                      return (
                        <div key={fl.batchCode} style={{ display:'flex', alignItems:'center', gap:14, padding:'10px 14px', background:'var(--bg-elevated)', borderRadius:9, border:'1px solid var(--border)' }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:12 }}>{fl.batchCode}</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{fl.pen}</div>
                          </div>
                          <div style={{ textAlign:'right' }}>
                            <div style={{ fontWeight:700, fontSize:14, color:'#ef4444' }}>{fmt(fl.total)}</div>
                            <div style={{ fontSize:10, color:'var(--text-muted)' }}>deaths</div>
                          </div>
                          {topCause && (
                            <div style={{ padding:'4px 10px', background:`${CAUSE_META[topCause[0]]?.color}15`, border:`1px solid ${CAUSE_META[topCause[0]]?.color}40`, borderRadius:6, fontSize:10, fontWeight:700, color:CAUSE_META[topCause[0]]?.color, whiteSpace:'nowrap' }}>
                              {CAUSE_META[topCause[0]]?.icon} {CAUSE_META[topCause[0]]?.label}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* Cause breakdown */}
              <div className="card">
                <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>Cause Breakdown</div>
                {loading ? <Skel h={200}/> : causeData.length===0 ? <Empty msg="No records this period"/> : (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {causeData.map(c=>{
                      const p = totalDeaths > 0 ? +((c.count/totalDeaths)*100).toFixed(1) : 0;
                      return (
                        <div key={c.code}>
                          <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                            <span style={{ fontWeight:700, color:c.color }}>{c.icon} {c.label}</span>
                            <span style={{ color:'var(--text-muted)' }}>{fmt(c.count)} ({p}%)</span>
                          </div>
                          <div style={{ height:6, background:'var(--border)', borderRadius:3 }}>
                            <div style={{ height:'100%', width:`${p}%`, background:c.color, borderRadius:3, transition:'width .6s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Spike days */}
              {chartData.filter(d=>d.count>=spikeThreshold).length > 0 && (
                <div className="card" style={{ border:'1.5px solid var(--red-border)', background:'#fff8f8' }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'#ef4444', marginBottom:12 }}>🚨 Spike Days</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {chartData.filter(d=>d.count>=spikeThreshold).map(d=>(
                      <div key={d.date} style={{ display:'flex', justifyContent:'space-between', padding:'8px 10px', background:'#fff', borderRadius:8, border:'1px solid var(--red-border)' }}>
                        <span style={{ fontSize:12, fontWeight:600 }}>{fmtDate(d.date)}</span>
                        <span style={{ fontSize:12, fontWeight:700, color:'#ef4444' }}>{fmt(d.count)} deaths</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Records log ── */}
        {tab==='log' && (
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            {loading ? <div style={{ padding:40 }}><Skel h={200}/></div> : records.length===0 ? (
              <div style={{ padding:60, textAlign:'center' }}>
                <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
                <div style={{ fontWeight:600, color:'var(--text-muted)' }}>No mortality records in this period</div>
                {canLog && <button className="btn btn-primary" style={{ marginTop:16 }} onClick={()=>setModal(true)}>Record Death</button>}
              </div>
            ) : (
              <table className="table">
                <thead><tr>
                  <th>Date</th><th>Flock</th><th>Pen › Section</th>
                  <th style={{textAlign:'right'}}>Count</th>
                  <th>Cause</th>
                  <th>Notes</th>
                  <th>Recorded By</th>
                </tr></thead>
                <tbody>
                  {records.map(r=>{
                    const cause = CAUSE_META[r.causeCode]||CAUSE_META.UNKNOWN;
                    return (
                      <tr key={r.id} style={{ background: r.rejectionReason ? '#fff5f5' : undefined }}>
                        <td style={{ fontWeight:600, whiteSpace:'nowrap' }}>
                          {fmtDate(r.recordDate)}
                          {r.rejectionReason && (
                            <div style={{ fontSize:10, fontWeight:700, color:'#dc2626', marginTop:2 }}>↩ Needs correction</div>
                          )}
                        </td>
                        <td><span style={{ fontWeight:700 }}>{r.flock?.batchCode}</span></td>
                        <td style={{ fontSize:11, color:'var(--text-muted)' }}>{r.penSection?.pen?.name} › {r.penSection?.name}</td>
                        <td style={{ textAlign:'right', fontWeight:700, color:r.count>10?'#ef4444':'var(--text-primary)', fontSize:15 }}>{r.count}</td>
                        <td>
                          <span style={{ fontSize:11, fontWeight:700, color:cause.color, padding:'2px 8px', background:`${cause.color}12`, border:`1px solid ${cause.color}30`, borderRadius:5 }}>
                            {cause.icon} {cause.label}
                          </span>
                        </td>
                        <td style={{ fontSize:11, color:'var(--text-muted)', maxWidth:200 }}>
                          <span style={{ display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.notes || '—'}</span>
                        </td>
                        <td style={{ fontSize:11, color:'var(--text-muted)' }}>
                          {r.rejectionReason ? (
                            <button onClick={() => setEditRecord(r)}
                              style={{ fontSize:11, padding:'4px 10px', borderRadius:6, border:'1px solid #fecaca', background:'#fff5f5', color:'#dc2626', fontWeight:700, cursor:'pointer' }}>
                              ✏️ Fix & Resubmit
                            </button>
                          ) : (
                            <>{r.recordedBy?.firstName} {r.recordedBy?.lastName?.[0]}.</>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
      {modal && <LogModal flocks={flocks} apiFetch={apiFetch} onClose={()=>setModal(false)} onSave={()=>{setModal(false);load();}} />}
      {editRecord && <EditMortalityModal record={editRecord} apiFetch={apiFetch} onClose={()=>setEditRecord(null)} onSave={()=>{setEditRecord(null);load();}} />}
    </AppShell>
  );
}
