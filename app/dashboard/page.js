'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, ComposedChart,
} from 'recharts';

const OP_COLOR   = { LAYER:'#f59e0b', BROILER:'#3b82f6' };
const OP_ICON    = { LAYER:'🥚', BROILER:'🍗' };
const PRIORITY_COLOR = { URGENT:'#ef4444', HIGH:'#f59e0b', NORMAL:'#6c63ff', LOW:'#9ca3af' };
const STATUS_CLASS   = { PENDING:'status-amber', IN_PROGRESS:'status-blue', COMPLETED:'status-green', OVERDUE:'status-red' };

function occColor(p)  { return p>=90?'#ef4444':p>=70?'#f59e0b':'#22c55e'; }
function fcrColor(f)  { return f>2.5?'#ef4444':f>2.0?'#f59e0b':'#22c55e'; }
function rateColor(r) { return r>=85?'#16a34a':r>=70?'#f59e0b':'#ef4444'; }
function fmt(n)       { return n!=null ? parseFloat(n).toLocaleString(undefined,{maximumFractionDigits:0}) : '—'; }

function OccBar({ pct, h=5 }) {
  return (
    <div style={{height:h,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
      <div style={{height:'100%',width:`${Math.min(pct||0,100)}%`,background:occColor(pct||0),borderRadius:2,transition:'width .5s ease'}}/>
    </div>
  );
}

// ── Shared KPI card ───────────────────────────────────────────────────────────
function KpiCard({ icon, value, label, sub, color='var(--purple)', warn=false }) {
  return (
    <div className="card" style={{padding:'18px 20px',display:'flex',alignItems:'center',gap:14,borderLeft:`4px solid ${warn?'#ef4444':color}`}}>
      <div style={{width:44,height:44,borderRadius:12,background:`${warn?'#ef4444':color}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{icon}</div>
      <div style={{flex:1}}>
        <div style={{fontFamily:"'Poppins',sans-serif",fontSize:24,fontWeight:700,color:warn?'#ef4444':color,lineHeight:1}}>{value??'—'}</div>
        <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.05em',marginTop:4}}>{label}</div>
        {sub && <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Day range toggle ──────────────────────────────────────────────────────────
function DayToggle({ value, onChange }) {
  return (
    <div style={{display:'flex',gap:4,background:'var(--bg-elevated)',borderRadius:8,padding:3,border:'1px solid var(--border)'}}>
      {[7,14,30].map(d => (
        <button key={d} onClick={()=>onChange(d)} style={{
          padding:'4px 12px',borderRadius:6,border:'none',cursor:'pointer',fontSize:11,fontWeight:700,
          background: value===d ? 'var(--purple)' : 'transparent',
          color: value===d ? '#fff' : 'var(--text-muted)',
          transition:'all .15s',
        }}>{d}d</button>
      ))}
    </div>
  );
}

// ── Chart title row ───────────────────────────────────────────────────────────
function ChartHeader({ title, days, onDaysChange }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
      <div style={{fontSize:12,fontWeight:700,color:'var(--text-secondary)'}}>{title}</div>
      <DayToggle value={days} onChange={onDaysChange} />
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label, unit='' }) {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:11,boxShadow:'var(--shadow-md)'}}>
      <div style={{fontWeight:700,marginBottom:4,color:'var(--text-primary)'}}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{display:'flex',alignItems:'center',gap:6,color:'var(--text-secondary)'}}>
          <span style={{width:8,height:8,borderRadius:'50%',background:p.color,display:'inline-block'}}/>
          <span>{p.name}:</span>
          <span style={{fontWeight:700,color:p.color}}>{p.value!=null?`${p.value}${unit}`:'-'}</span>
        </div>
      ))}
    </div>
  );
}

// ── Floating chart modal ─────────────────────────────────────────────────────
function ChartModal({ sectionId, sectionName, penName, opType, onClose }) {
  const isL = opType === 'LAYER';
  const [days, setDays] = useState(isL ? 7 : 14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sectionId) return;
    setLoading(true);
    fetch(`/api/dashboard/charts?sectionId=${sectionId}&days=${days}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sectionId, days]);

  // Close on Escape
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const chart = data?.chart || [];

  const Tile = ({ title, children }) => (
    <div style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );

  const layerCharts = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
      <Tile title="🥚 Eggs Collected & Laying Rate">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="eggs" tick={{ fontSize: 10 }} width={45} />
              <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 10 }} domain={[0, 100]} width={35} unit="%" />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="eggs" dataKey="totalEggs" name="Eggs" fill="#f59e0b" opacity={0.85} radius={[3, 3, 0, 0]} />
              <Line yAxisId="rate" type="monotone" dataKey="layingRate" name="Laying %" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <ReferenceLine yAxisId="rate" y={80} stroke="#16a34a" strokeDasharray="4 4" label={{ value: '80%', fontSize: 9, fill: '#16a34a' }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Tile>
      <Tile title="⭐ Grade A Percentage">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={[60, 100]} tick={{ fontSize: 10 }} width={35} unit="%" />
              <Tooltip content={<ChartTip unit="%" />} />
              <Line type="monotone" dataKey="gradeAPct" name="Grade A %" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
              <ReferenceLine y={90} stroke="#8b5cf6" strokeDasharray="4 4" label={{ value: '90%', fontSize: 9, fill: '#8b5cf6' }} />
              <ReferenceLine y={85} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '85% min', fontSize: 9, fill: '#f59e0b' }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Tile>
      <Tile title="💀 Daily Mortality">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={35} allowDecimals={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="mortality" name="Deaths" fill="#ef4444" opacity={0.8} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Tile>
      <Tile title="🌾 Daily Feed Consumption">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="kg" tick={{ fontSize: 10 }} width={45} unit="kg" />
              <YAxis yAxisId="gpb" orientation="right" tick={{ fontSize: 10 }} width={40} unit="g" />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="kg" dataKey="feedKg" name="Feed (kg)" fill="#6c63ff" opacity={0.8} radius={[3, 3, 0, 0]} />
              <Line yAxisId="gpb" type="monotone" dataKey="feedGpb" name="g/bird/day" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Tile>
    </div>
  );

  const broilerCharts = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
      <Tile title="⚖ Live Weight vs Ross 308 Target">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={50} unit="g" />
              <Tooltip content={<ChartTip unit="g" />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Area type="monotone" dataKey="minWeightG" name="Min" stroke="none" fill="#bfdbfe" opacity={0.4} connectNulls />
              <Area type="monotone" dataKey="maxWeightG" name="Max" stroke="none" fill="#bfdbfe" opacity={0.2} connectNulls />
              <Line type="monotone" dataKey="targetWeightG" name="Target" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls />
              <Line type="monotone" dataKey="avgWeightG" name="Avg Weight" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Tile>
      <Tile title="📐 Flock Uniformity %">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={[60, 100]} tick={{ fontSize: 10 }} width={35} unit="%" />
              <Tooltip content={<ChartTip unit="%" />} />
              <Line type="monotone" dataKey="uniformityPct" name="Uniformity %" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
              <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="4 4" label={{ value: '80% good', fontSize: 9, fill: '#22c55e' }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Tile>
      <Tile title="💀 Daily Mortality">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={35} allowDecimals={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="mortality" name="Deaths" fill="#ef4444" opacity={0.8} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Tile>
      <Tile title="🌾 Daily Feed Intake">
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="kg" tick={{ fontSize: 10 }} width={45} unit="kg" />
              <YAxis yAxisId="gpb" orientation="right" tick={{ fontSize: 10 }} width={40} unit="g" />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="kg" dataKey="feedKg" name="Feed (kg)" fill="#6c63ff" opacity={0.8} radius={[3, 3, 0, 0]} />
              <Line yAxisId="gpb" type="monotone" dataKey="feedGpb" name="g/bird/day" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Tile>
    </div>
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', width: '100%', maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Modal header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 16 }}>
              {OP_ICON[opType]} {penName} — {sectionName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {isL ? 'Layer production trends' : 'Broiler growth & performance trends'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <DayToggle value={days} onChange={setDays} />
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>✕</button>
          </div>
        </div>

        {/* Charts 2×2 grid */}
        <div style={{ flex: 1, padding: '16px 20px 20px', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {!data && !loading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>No data available</div>}
          {isL ? layerCharts : broilerCharts}
        </div>

      </div>
    </div>
  , document.body);
}

function Spinner() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>;
}

// ── Section card (pen worker) ─────────────────────────────────────────────────
function WorkerSectionCard({ sec }) {
  const [expanded, setExpanded] = useState(false);
  const [modal,    setModal]    = useState(false);
  const mx    = sec.metrics;
  const isL   = mx.type === 'LAYER';
  const color = OP_COLOR[sec.penOperationType];
  const flag  = sec.flags[0];
  const alertBorder = flag?.type==='critical'?'#ef4444':flag?.type==='warn'?'#f59e0b':color;

  const core = isL ? [
    { icon:'🥚', val:fmt(mx.todayEggs),          label:'Eggs Today',   color:'#f59e0b' },
    { icon:'📊', val:`${mx.todayLayingRate??0}%`, label:'Laying Rate',  color:rateColor(mx.todayLayingRate) },
    { icon:'💀', val:fmt(mx.todayMortality),      label:'Deaths Today', color:mx.todayMortality>5?'#ef4444':'var(--text-primary)', warn:mx.todayMortality>5 },
    { icon:'🐦', val:fmt(sec.currentBirds),       label:'Live Birds',   color:'var(--purple)' },
  ] : [
    { icon:'⚖',  val:mx.latestWeightG?`${fmt(mx.latestWeightG)}g`:'—', label:'Avg Weight',  color:'#3b82f6' },
    { icon:'🔄', val:mx.estimatedFCR??'—',                              label:'Est. FCR',    color:fcrColor(mx.estimatedFCR||0) },
    { icon:'💀', val:fmt(mx.todayMortality),                             label:'Deaths Today',color:mx.todayMortality>5?'#ef4444':'var(--text-primary)', warn:mx.todayMortality>5 },
    { icon:'📅', val:mx.daysToHarvest!=null?`${mx.daysToHarvest}d`:'—',label:'To Harvest',  color:'#8b5cf6' },
  ];

  return (
    <div className="card" style={{padding:0,overflow:'hidden',borderLeft:`4px solid ${alertBorder}`}}>
      {/* ── Clickable header row — always visible ── */}
      <div
        onClick={()=>setExpanded(e=>!e)}
        style={{padding:'14px 18px',cursor:'pointer',userSelect:'none',display:'flex',justifyContent:'space-between',alignItems:'center'}}
      >
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:14}}>{sec.penName} — {sec.name}</div>
          {sec.flock
            ? <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{sec.flock.batchCode} · {sec.flock.breed} · {sec.ageInDays} days old</div>
            : <div style={{fontSize:11,color:'var(--text-faint)',marginTop:2}}>No active flock</div>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0,marginLeft:12}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:17,fontWeight:700,color:occColor(sec.occupancyPct)}}>{sec.occupancyPct}%</div>
            <div style={{fontSize:10,color:'var(--text-muted)'}}>{fmt(sec.currentBirds)} / {fmt(sec.capacity)}</div>
          </div>
          <span style={{fontSize:20,color:'var(--text-muted)',transform:expanded?'rotate(90deg)':'rotate(0deg)',transition:'transform 0.2s ease',display:'inline-block',lineHeight:1}}>›</span>
        </div>
      </div>

      {/* ── Expanded content ── */}
      {expanded && (
        <div style={{borderTop:'1px solid var(--border)',padding:'14px 18px',background:'var(--bg-page)'}}>
          <OccBar pct={sec.occupancyPct} />

          {flag && <div style={{marginTop:8,marginBottom:10,fontSize:11,fontWeight:700,color:flag.type==='critical'?'#ef4444':'#d97706',background:flag.type==='critical'?'#fff5f5':'#fffbeb',border:`1px solid ${flag.type==='critical'?'#fecaca':'#fde68a'}`,borderRadius:6,padding:'4px 10px',display:'inline-block'}}>⚠ {flag.msg}</div>}

          {/* Core 4 KPIs */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginTop:flag?0:8}}>
            {core.map(k => (
              <div key={k.label} style={{textAlign:'center',padding:'10px 8px',background:k.warn?'#fff5f5':'var(--bg-elevated)',border:`1px solid ${k.warn?'#fecaca':'var(--border)'}`,borderRadius:8}}>
                <div style={{fontSize:18,marginBottom:4}}>{k.icon}</div>
                <div style={{fontFamily:"'Poppins',sans-serif",fontSize:16,fontWeight:700,color:k.color}}>{k.val}</div>
                <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em',marginTop:2}}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Charts — click button inside expanded panel */}
          {sec.flock && (
            <button
              onClick={e=>{ e.stopPropagation(); setModal(true); }}
              style={{marginTop:12,width:'100%',padding:'8px',background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600,color:'var(--text-secondary)',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}
            >
              📈 View Trends & Charts
            </button>
          )}
        </div>
      )}

      {modal && (
        <ChartModal
          sectionId={sec.id}
          sectionName={sec.name}
          penName={sec.penName}
          opType={sec.penOperationType}
          onClose={()=>setModal(false)}
        />
      )}
    </div>
  );
}

// ── Pen card (pen manager + farm manager) ─────────────────────────────────────
function PenCard({ pen }) {
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [modalSec,     setModalSec]     = useState(null); // { id, name }
  const isL   = pen.operationType === 'LAYER';
  const color = OP_COLOR[pen.operationType];
  const mx    = pen.metrics;
  const alertBorder = pen.alertLevel==='critical'?'#ef4444':pen.alertLevel==='warn'?'#f59e0b':color;

  const core = isL ? [
    { icon:'🥚', val:fmt(mx.todayEggs),        label:'Eggs Today',     color:'#f59e0b' },
    { icon:'📊', val:`${mx.avgLayingRate??0}%`, label:'Avg Laying Rate',color:rateColor(mx.avgLayingRate) },
    { icon:'💀', val:fmt(mx.todayMortality),    label:'Deaths Today',   color:mx.todayMortality>10?'#ef4444':'var(--text-primary)', warn:mx.todayMortality>10 },
    { icon:'🐦', val:fmt(pen.totalBirds),       label:'Live Birds',     color:'var(--purple)' },
  ] : [
    { icon:'⚖',  val:mx.avgWeightG?`${fmt(mx.avgWeightG)}g`:'—',        label:'Avg Weight',      color:'#3b82f6' },
    { icon:'🔄', val:mx.avgFCR??'—',                                      label:'Avg FCR',         color:fcrColor(mx.avgFCR||0) },
    { icon:'💀', val:fmt(mx.todayMortality),                               label:'Deaths Today',    color:mx.todayMortality>10?'#ef4444':'var(--text-primary)', warn:mx.todayMortality>10 },
    { icon:'📅', val:mx.nearestHarvest!=null?`${mx.nearestHarvest}d`:'—', label:'Nearest Harvest', color:'#8b5cf6' },
  ];

  return (
    <div style={{marginBottom:16}}>
      <div className="card" style={{padding:0,overflow:'hidden',borderLeft:`4px solid ${alertBorder}`}}>

        {/* ── Clickable header + KPIs ── */}
        <div
          onClick={()=>setSectionsOpen(o=>!o)}
          style={{padding:'16px 18px',cursor:'pointer',userSelect:'none'}}
        >
          {/* Pen header */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:38,height:38,borderRadius:10,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{OP_ICON[pen.operationType]}</div>
              <div>
                <div style={{fontWeight:700,fontSize:15}}>{pen.name}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{pen.farmName} · {pen.sectionCount} sections · {fmt(pen.totalBirds)} birds</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              {pen.alertLevel !== 'ok' && (
                <span style={{fontSize:10,fontWeight:700,color:pen.alertLevel==='critical'?'#ef4444':'#d97706',background:pen.alertLevel==='critical'?'#fff5f5':'#fffbeb',border:`1px solid ${pen.alertLevel==='critical'?'#fecaca':'#fde68a'}`,borderRadius:20,padding:'3px 10px'}}>
                  {pen.alertLevel==='critical'?'🔴 Alert':'🟡 Warning'}
                </span>
              )}
              <span style={{fontSize:20,color:'var(--text-muted)',transform:sectionsOpen?'rotate(90deg)':'rotate(0deg)',transition:'transform 0.2s ease',display:'inline-block',lineHeight:1}}>›</span>
            </div>
          </div>

          {/* Core 4 KPIs */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
            {core.map(k => (
              <div key={k.label} style={{textAlign:'center',padding:'10px 8px',background:k.warn?'#fff5f5':'var(--bg-elevated)',border:`1px solid ${k.warn?'#fecaca':'var(--border)'}`,borderRadius:8}}>
                <div style={{fontSize:18,marginBottom:3}}>{k.icon}</div>
                <div style={{fontFamily:"'Poppins',sans-serif",fontSize:17,fontWeight:700,color:k.color}}>{k.val}</div>
                <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em',marginTop:2}}>{k.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section cards (revealed on click) ── */}
        {sectionsOpen && (
          <div style={{borderTop:'1px solid var(--border)',padding:'14px 16px',background:'var(--bg-page)'}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
              {pen.sections.map(sec => {
                const smx = sec.metrics;
                const flg = sec.flags[0];
                const secBorder = flg?.type==='critical'?'#ef4444':flg?.type==='warn'?'#f59e0b':color;
                const secCore = isL ? [
                  { icon:'🥚', val:fmt(smx.todayEggs),          label:'Eggs Today',   color:'#f59e0b' },
                  { icon:'📊', val:`${smx.todayLayingRate??0}%`, label:'Laying Rate',  color:rateColor(smx.todayLayingRate) },
                  { icon:'💀', val:fmt(smx.todayMortality),      label:'Deaths Today', color:smx.todayMortality>5?'#ef4444':'var(--text-primary)', warn:smx.todayMortality>5 },
                  { icon:'🐦', val:fmt(sec.currentBirds),        label:'Live Birds',   color:'var(--purple)' },
                ] : [
                  { icon:'⚖',  val:smx.latestWeightG?`${fmt(smx.latestWeightG)}g`:'—', label:'Avg Weight',   color:'#3b82f6' },
                  { icon:'🔄', val:smx.estimatedFCR??'—',                               label:'Est. FCR',     color:fcrColor(smx.estimatedFCR||0) },
                  { icon:'💀', val:fmt(smx.todayMortality),                              label:'Deaths Today', color:smx.todayMortality>5?'#ef4444':'var(--text-primary)', warn:smx.todayMortality>5 },
                  { icon:'📅', val:smx.daysToHarvest!=null?`${smx.daysToHarvest}d`:'—',label:'To Harvest',   color:'#8b5cf6' },
                ];
                return (
                  <div key={sec.id} style={{background:'#fff',border:`1.5px solid ${secBorder}`,borderRadius:10,padding:14,display:'flex',flexDirection:'column',gap:10}}>
                    {/* Section header */}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontWeight:700,fontSize:13}}>{sec.name}</div>
                        {sec.flock
                          ? <div style={{fontSize:10,color:'var(--text-muted)',marginTop:1}}>{sec.flock.batchCode} · {sec.flock.breed} · {sec.ageInDays}d</div>
                          : <div style={{fontSize:10,color:'var(--text-faint)',marginTop:1}}>Empty</div>}
                        {sec.workers.length>0 && <div style={{fontSize:10,color:'var(--purple)',marginTop:2}}>{sec.workers.map(w=>`${w.firstName} ${w.lastName[0]}.`).join(', ')}</div>}
                      </div>
                      <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
                        <div style={{fontFamily:"'Poppins',sans-serif",fontSize:16,fontWeight:700,color:occColor(sec.occupancyPct)}}>{sec.occupancyPct}%</div>
                        <div style={{fontSize:10,color:'var(--text-muted)'}}>{fmt(sec.currentBirds)}/{fmt(sec.capacity)}</div>
                      </div>
                    </div>
                    <OccBar pct={sec.occupancyPct} h={4} />
                    {flg && (
                      <div style={{fontSize:10,fontWeight:700,color:flg.type==='critical'?'#ef4444':'#d97706',background:flg.type==='critical'?'#fff5f5':'#fffbeb',border:`1px solid ${flg.type==='critical'?'#fecaca':'#fde68a'}`,borderRadius:6,padding:'4px 10px'}}>
                        ⚠ {flg.msg}
                      </div>
                    )}
                    {/* KPI chips */}
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                      {secCore.map(k => (
                        <div key={k.label} style={{textAlign:'center',padding:'8px 6px',background:k.warn?'#fff5f5':'var(--bg-elevated)',border:`1px solid ${k.warn?'#fecaca':'var(--border)'}`,borderRadius:8}}>
                          <div style={{fontSize:16,marginBottom:2}}>{k.icon}</div>
                          <div style={{fontFamily:"'Poppins',sans-serif",fontSize:14,fontWeight:700,color:k.color}}>{k.val}</div>
                          <div style={{fontSize:8,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em',marginTop:1}}>{k.label}</div>
                        </div>
                      ))}
                    </div>
                    {/* Charts button — stopPropagation so clicking it doesn't collapse the pen */}
                    {sec.flock && (
                      <button
                        onClick={e => { e.stopPropagation(); setModalSec({ id:sec.id, name:sec.name }); }}
                        style={{width:'100%',padding:'7px',background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:11,fontWeight:600,color:'var(--text-secondary)',display:'flex',alignItems:'center',justifyContent:'center',gap:5}}
                      >
                        📈 View Trends & Charts
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {modalSec && (
        <ChartModal
          sectionId={modalSec.id}
          sectionName={modalSec.name}
          penName={pen.name}
          opType={pen.operationType}
          onClose={()=>setModalSec(null)}
        />
      )}
    </div>
  );
}

// ── Task list ─────────────────────────────────────────────────────────────────
function TaskList({ tasks }) {
  if (!tasks?.length) return <div style={{textAlign:'center',padding:24,color:'var(--text-muted)',fontSize:13}}>✅ No tasks today</div>;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {tasks.map(t => (
        <div key={t.id} style={{padding:'10px 14px',background:'#fff',border:'1px solid var(--border)',borderLeft:`3px solid ${PRIORITY_COLOR[t.priority]||'#9ca3af'}`,borderRadius:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{fontWeight:600,fontSize:13,color:'var(--text-primary)',lineHeight:1.4}}>{t.title}</div>
            <span className={`status-badge ${STATUS_CLASS[t.status]||'status-grey'}`} style={{fontSize:9,flexShrink:0}}>{t.status}</span>
          </div>
          {t.penSection && <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>📍 {t.penSection.pen.name} — {t.penSection.name}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Pen Worker dashboard ──────────────────────────────────────────────────────

// ── Mortality cause options ───────────────────────────────────────────────────
const MORT_CAUSES = [
  ['UNKNOWN','Unknown'],['DISEASE','Disease'],['HEAT_STRESS','Heat Stress'],
  ['FEED_ISSUE','Feed Issue'],['INJURY','Injury'],['PREDATOR','Predator'],
  ['RESPIRATORY','Respiratory'],['CULLED','Culled'],['WATER_ISSUE','Water Issue'],
];

// ── Simple portal modal shell ─────────────────────────────────────────────────
function DashModalShell({ title, onClose, footer, children }) {
  return createPortal(
    <div style={{position:'fixed',inset:0,zIndex:1200,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:460,boxShadow:'0 12px 48px rgba(0,0,0,0.2)',display:'flex',flexDirection:'column',maxHeight:'90vh'}}>
        <div style={{padding:'18px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <span style={{fontSize:15,fontWeight:800,color:'var(--text-primary)',fontFamily:"'Poppins',sans-serif"}}>{title}</span>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--text-muted)',lineHeight:1}}>×</button>
        </div>
        <div style={{padding:'18px 20px',overflowY:'auto',flexGrow:1}}>{children}</div>
        <div style={{padding:'14px 20px',borderTop:'1px solid var(--border-card)',display:'flex',gap:10,justifyContent:'flex-end',flexShrink:0}}>{footer}</div>
      </div>
    </div>,
    document.body
  );
}

// ── Edit/correct a rejected record ────────────────────────────────────────────
function EditRecordModal({ item, apiFetch, onClose, onSave }) {
  const { record, type } = item;
  const today = new Date().toISOString().split('T')[0];
  const [eggForm, setEggForm] = useState({
    collectionDate: record.collectionDate?.split('T')[0] || today,
    totalEggs:    String(record.totalEggs    || ''),
    gradeACount:  String(record.gradeACount  || ''),
    gradeBCount:  String(record.gradeBCount  || ''),
    crackedCount: String(record.crackedCount || ''),
    dirtyCount:   String(record.dirtyCount   || ''),
  });
  const [mortForm, setMortForm] = useState({
    recordDate: record.recordDate?.split('T')[0] || today,
    count:     String(record.count     || ''),
    causeCode: record.causeCode || 'UNKNOWN',
    notes:     record.notes    || '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const setE = (k,v) => setEggForm(p=>({...p,[k]:v}));
  const setM = (k,v) => setMortForm(p=>({...p,[k]:v}));

  const total    = Number(eggForm.totalEggs)||0;
  const gradeSum = (Number(eggForm.gradeACount)||0)+(Number(eggForm.gradeBCount)||0)
                 + (Number(eggForm.crackedCount)||0)+(Number(eggForm.dirtyCount)||0);
  const count    = Number(mortForm.count)||0;
  const isEgg    = type === 'egg';

  async function save() {
    setSaving(true); setErr('');
    try {
      let endpoint, body;
      if (isEgg) {
        if (total <= 0)       return setErr('Enter total eggs collected');
        if (gradeSum > total) return setErr('Grade breakdown exceeds total');
        endpoint = `/api/eggs/${record.id}`;
        body = {
          collectionDate: eggForm.collectionDate,
          totalEggs: total,
          gradeACount:  Number(eggForm.gradeACount)  || 0,
          gradeBCount:  Number(eggForm.gradeBCount)  || 0,
          crackedCount: Number(eggForm.crackedCount) || 0,
          dirtyCount:   Number(eggForm.dirtyCount)   || 0,
        };
      } else {
        if (count <= 0) return setErr('Enter number of deaths');
        endpoint = `/api/mortality/${record.id}`;
        body = { recordDate: mortForm.recordDate, count, causeCode: mortForm.causeCode, notes: mortForm.notes.trim() || undefined };
      }
      const res = await apiFetch(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
      const d   = await res.json();
      if (!res.ok) return setErr(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <DashModalShell title={isEgg ? '🥚 Correct Egg Record' : '💀 Correct Mortality Record'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
               <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Resubmit Record'}</button></>}>
      {err && <div className="alert alert-red" style={{marginBottom:12}}>⚠ {err}</div>}
      {/* Rejection reason */}
      <div style={{marginBottom:16,padding:'10px 14px',background:'#fff5f5',border:'1px solid #fecaca',borderRadius:8,fontSize:12}}>
        <div style={{fontWeight:700,color:'#991b1b',marginBottom:3}}>⚠ Returned for correction</div>
        <div style={{color:'#7f1d1d'}}>{record.rejectionReason}</div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        {isEgg ? (<>
          <div>
            <label className="label">Collection Date *</label>
            <input type="date" className="input" value={eggForm.collectionDate} onChange={e=>setE('collectionDate',e.target.value)} max={today}/>
          </div>
          <div>
            <label className="label">Total Eggs *</label>
            <input type="number" className="input" min="0" value={eggForm.totalEggs} onChange={e=>setE('totalEggs',e.target.value)} placeholder="e.g. 1800"/>
          </div>
          <div>
            <label className="label">Grade Breakdown <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional)</span></label>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
              {[['gradeACount','Grade A','#16a34a'],['gradeBCount','Grade B','#d97706'],['crackedCount','Cracked','#dc2626'],['dirtyCount','Dirty','#6b7280']].map(([k,lbl,col])=>(
                <div key={k}>
                  <div style={{fontSize:10,fontWeight:700,color:col,marginBottom:4}}>{lbl}</div>
                  <input type="number" className="input" style={{padding:'6px 8px',textAlign:'center'}} min="0" value={eggForm[k]} onChange={e=>setE(k,e.target.value)} placeholder="0"/>
                </div>
              ))}
            </div>
            {gradeSum > 0 && <div style={{fontSize:11,marginTop:6,color:gradeSum>total?'#dc2626':'var(--text-muted)'}}>{gradeSum}/{total} accounted for</div>}
          </div>
        </>) : (<>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={mortForm.recordDate} onChange={e=>setM('recordDate',e.target.value)} max={today}/>
            </div>
            <div>
              <label className="label">Number of Deaths *</label>
              <input type="number" className="input" min="0" value={mortForm.count} onChange={e=>setM('count',e.target.value)} placeholder="0"/>
            </div>
          </div>
          <div>
            <label className="label">Cause of Death</label>
            <select className="input" value={mortForm.causeCode} onChange={e=>setM('causeCode',e.target.value)}>
              {MORT_CAUSES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional)</span></label>
            <textarea className="input" rows={2} value={mortForm.notes} onChange={e=>setM('notes',e.target.value)} placeholder="Observations…" style={{resize:'vertical'}}/>
          </div>
        </>)}
      </div>
    </DashModalShell>
  );
}

function WorkerDashboard({ sections, tasks, user, apiFetch }) {
  const isL      = sections.some(s=>s.penOperationType==='LAYER');
  const totDead  = sections.reduce((s,sec)=>s+sec.metrics.todayMortality,0);
  const totBirds = sections.reduce((s,sec)=>s+sec.currentBirds,0);
  const todayEggs= sections.filter(s=>s.metrics.type==='LAYER').reduce((s,sec)=>s+(sec.metrics.todayEggs||0),0);
  const rates    = sections.filter(s=>s.metrics.type==='LAYER'&&(s.metrics.todayLayingRate||0)>0);
  const avgRate  = rates.length ? parseFloat((rates.reduce((s,sec)=>s+(sec.metrics.todayLayingRate||0),0)/rates.length).toFixed(1)) : 0;
  const weights  = sections.filter(s=>s.metrics.type==='BROILER'&&s.metrics.latestWeightG);
  const avgWt    = weights.length ? parseFloat((weights.reduce((s,sec)=>s+sec.metrics.latestWeightG,0)/weights.length).toFixed(0)) : null;
  const fcrs     = sections.filter(s=>s.metrics.type==='BROILER'&&s.metrics.estimatedFCR);
  const avgFCR   = fcrs.length ? parseFloat((fcrs.reduce((s,sec)=>s+sec.metrics.estimatedFCR,0)/fcrs.length).toFixed(2)) : null;
  const overdue  = tasks.filter(t=>t.status==='OVERDUE').length;
  const h = new Date().getHours();
  const greet = h<12?'morning':h<17?'afternoon':'evening';

  // Fetch rejected records that need correction
  const [rejected,   setRejected]   = useState([]);
  const [editRecord, setEditRecord] = useState(null);

  useEffect(() => {
    async function loadRejected() {
      try {
        const [eggRes, mortRes] = await Promise.all([
          apiFetch('/api/eggs?rejected=true'),
          apiFetch('/api/mortality?rejected=true'),
        ]);
        const list = [];
        if (eggRes.ok)  { const d = await eggRes.json();  (d.records||[]).forEach(r => list.push({ record:r, type:'egg' })); }
        if (mortRes.ok) { const d = await mortRes.json(); (d.records||[]).forEach(r => list.push({ record:r, type:'mortality' })); }
        setRejected(list);
      } catch {}
    }
    loadRejected();
  }, [apiFetch]);

  const kpis = isL ? [
    { icon:'🥚', val:fmt(todayEggs),    label:'Eggs Collected Today',    color:'#f59e0b' },
    { icon:'📊', val:`${avgRate}%`,     label:'Avg Laying Rate',          color:rateColor(avgRate), warn:avgRate<70&&sections.some(s=>s.flock) },
    { icon:'💀', val:fmt(totDead),      label:'Deaths Today',             warn:totDead>10 },
    { icon:'🐦', val:fmt(totBirds),     label:'Live Birds (My Sections)', color:'var(--purple)' },
  ] : [
    { icon:'⚖',  val:avgWt?`${fmt(avgWt)}g`:'—', label:'Avg Live Weight',       color:'#3b82f6' },
    { icon:'🔄', val:avgFCR??'—',                  label:'Est. Feed Conv. Ratio', color:fcrColor(avgFCR||0), warn:avgFCR>2.5 },
    { icon:'💀', val:fmt(totDead),                  label:'Deaths Today',          warn:totDead>10 },
    { icon:'🐦', val:fmt(totBirds),                 label:'Live Birds (My Sections)',color:'var(--purple)' },
  ];

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0}}>Good {greet}, {user.firstName} 👋</h1>
        <p style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
          {isL?'🥚 Layer':'🍗 Broiler'} · {sections.length} section{sections.length!==1?'s':''} assigned
          {overdue>0&&<span style={{color:'#ef4444',fontWeight:700,marginLeft:8}}>· {overdue} overdue</span>}
          {rejected.length>0&&<span style={{color:'#dc2626',fontWeight:700,marginLeft:8}}>· {rejected.length} correction{rejected.length!==1?'s':''} needed</span>}
        </p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
        {kpis.map(k=><KpiCard key={k.label} {...k} />)}
      </div>
      {/* ── Needs Correction banner ─────────────────────────────────────────── */}
      {rejected.length > 0 && (
        <div style={{marginBottom:20,background:'#fff5f5',border:'1.5px solid #fecaca',borderRadius:12,padding:'14px 18px'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <span style={{fontSize:16}}>⚠</span>
            <span style={{fontWeight:700,fontSize:14,color:'#991b1b'}}>
              {rejected.length} record{rejected.length!==1?'s':''} returned for correction
            </span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {rejected.map(item=>(
              <div key={item.record.id} style={{background:'#fff',borderRadius:8,border:'1px solid #fecaca',padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:'var(--text-primary)'}}>
                    {item.type==='egg'?'🥚 Egg Collection':'💀 Mortality Record'}
                    <span style={{fontWeight:400,color:'var(--text-muted)',marginLeft:8}}>
                      · {new Date(item.record.collectionDate||item.record.recordDate).toLocaleDateString('en-NG',{day:'numeric',month:'short'})}
                    </span>
                  </div>
                  <div style={{fontSize:12,color:'#dc2626',marginTop:3,fontStyle:'italic'}}>
                    "{item.record.rejectionReason}"
                  </div>
                </div>
                <button onClick={()=>setEditRecord(item)}
                  style={{flexShrink:0,padding:'7px 14px',background:'#dc2626',color:'#fff',border:'none',borderRadius:7,fontSize:12,fontWeight:700,cursor:'pointer'}}>
                  Fix & Resubmit
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {editRecord && (
        <EditRecordModal item={editRecord} apiFetch={apiFetch}
          onClose={()=>setEditRecord(null)}
          onSave={()=>{ setEditRecord(null); setRejected(r=>r.filter(i=>i.record.id!==editRecord.record.id)); }} />
      )}

      <div style={{display:'grid',gridTemplateColumns:'3fr 2fr',gap:16}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12}}>My Sections</div>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {sections.map(sec=><WorkerSectionCard key={sec.id} sec={sec}/>)}
          </div>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12}}>
            Today's Tasks {overdue>0&&<span style={{color:'#ef4444'}}>({overdue} overdue)</span>}
          </div>
          <TaskList tasks={tasks}/>
        </div>
      </div>
    </div>
  );
}

// ── Pen Manager dashboard ─────────────────────────────────────────────────────
function PenManagerDashboard({ pens, tasks, user }) {
  const totBirds = pens.reduce((s,p)=>s+p.totalBirds,0);
  const totDead  = pens.reduce((s,p)=>s+p.metrics.todayMortality,0);
  const todayEggs= pens.filter(p=>p.operationType==='LAYER').reduce((s,p)=>s+(p.metrics.todayEggs||0),0);
  const alerts   = pens.filter(p=>p.alertLevel!=='ok').length;
  const h = new Date().getHours();
  const greet = h<12?'morning':h<17?'afternoon':'evening';

  return (
    <div>
      <div style={{marginBottom:24}}>
        <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0}}>Good {greet}, {user.firstName} 👋</h1>
        <p style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
          Pen Manager · {pens.length} pen{pens.length!==1?'s':''} — click 📈 Trends on any section
          {alerts>0&&<span style={{color:'#ef4444',fontWeight:700,marginLeft:8}}>· {alerts} need attention</span>}
        </p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
        <KpiCard icon="🐦" value={fmt(totBirds)} label="Total Live Birds"       color="var(--purple)" />
        <KpiCard icon="💀" value={fmt(totDead)}  label="Deaths Today"           warn={totDead>20} />
        {pens.some(p=>p.operationType==='LAYER') && <KpiCard icon="🥚" value={fmt(todayEggs)} label="Layer Eggs Today" color="#f59e0b" />}
        <KpiCard icon="🔔" value={alerts}        label="Pens Needing Attention" warn={alerts>0} />
      </div>
      <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12}}>My Pens</div>
      {pens.map(pen=><PenCard key={pen.id} pen={pen}/>)}
    </div>
  );
}

// ── Farm Manager+ dashboard ───────────────────────────────────────────────────
function ManagerDashboard({ pens, orgTotals, user }) {
  const alerts    = pens.filter(p => p.alertLevel !== 'ok').length;
  const roleLabel = { FARM_MANAGER:'Farm Manager', FARM_ADMIN:'Farm Admin', CHAIRPERSON:'Chairperson', SUPER_ADMIN:'Super Admin' }[user?.role] || user?.role || '';

  const layerPens   = pens.filter(p => p.operationType === 'LAYER');
  const broilerPens = pens.filter(p => p.operationType === 'BROILER');

  // Default to the tab that has pens; prefer LAYER
  const defaultTab  = layerPens.length ? 'LAYER' : 'BROILER';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // If one operation type is empty, lock to the one that exists
  const hasBoth = layerPens.length > 0 && broilerPens.length > 0;
  const visiblePens = activeTab === 'LAYER' ? layerPens : broilerPens;

  const tabs = [
    { key: 'LAYER',   icon: '🥚', label: 'Layer Operations',   count: layerPens.length },
    { key: 'BROILER', icon: '🍗', label: 'Broiler Operations', count: broilerPens.length },
  ].filter(t => t.count > 0);

  return (
    <div>
      {/* ── Page header ── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0}}>Farm Overview</h1>
          <p style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
            {roleLabel} · {pens.length} pen{pens.length!==1?'s':''} — click any pen to expand sections
            {alerts>0&&<span style={{color:'#ef4444',fontWeight:700,marginLeft:8}}>· {alerts} need attention</span>}
          </p>
        </div>
      </div>

      {/* ── Org-level KPIs ── */}
      {orgTotals && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:24}}>
          <KpiCard icon="🐦" value={fmt(orgTotals.totalBirds)}         label="Total Live Birds"  color="var(--purple)" />
          <KpiCard icon="💀" value={fmt(orgTotals.todayMortality)}      label="Deaths Today"      warn={orgTotals.todayMortality>30} />
          <KpiCard icon="🥚" value={fmt(orgTotals.todayEggs)}           label="Layer Eggs Today"  color="#f59e0b" />
          <KpiCard icon="📊" value={`${orgTotals.avgLayingRate??0}%`}   label="Avg Laying Rate"   color="#16a34a" warn={orgTotals.avgLayingRate<70} />
          <KpiCard icon="🔔" value={orgTotals.pensWithAlerts}           label="Pens With Alerts"  warn={orgTotals.pensWithAlerts>0} />
        </div>
      )}

      {/* ── Operation type tabs ── */}
      {hasBoth && (
        <div style={{display:'flex',gap:6,marginBottom:20,background:'var(--bg-elevated)',borderRadius:12,padding:4,border:'1px solid var(--border)',width:'fit-content'}}>
          {tabs.map(t => {
            const isActive = activeTab === t.key;
            const tabColor = t.key === 'LAYER' ? '#f59e0b' : '#3b82f6';
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  display:'inline-flex', alignItems:'center', gap:8,
                  padding:'9px 20px', borderRadius:9, border:'none',
                  background: isActive ? '#fff' : 'transparent',
                  boxShadow: isActive ? 'var(--shadow-sm,0 1px 4px rgba(0,0,0,0.08))' : 'none',
                  cursor:'pointer', fontFamily:'inherit', fontWeight: isActive ? 700 : 500,
                  fontSize:13, color: isActive ? tabColor : 'var(--text-muted)',
                  transition:'all 0.15s',
                }}
              >
                <span style={{fontSize:16}}>{t.icon}</span>
                {t.label}
                <span style={{
                  fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10,
                  background: isActive ? `${tabColor}18` : 'var(--bg-page)',
                  color: isActive ? tabColor : 'var(--text-muted)',
                  border:`1px solid ${isActive ? tabColor+'30' : 'var(--border)'}`,
                  minWidth:20, textAlign:'center',
                }}>{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Pen list for active tab ── */}
      <div>
        {!hasBoth && tabs.length > 0 && (
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
            <span style={{fontSize:16}}>{tabs[0].icon}</span>
            <span style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em'}}>
              {tabs[0].label} · {tabs[0].count} pen{tabs[0].count!==1?'s':''}
            </span>
          </div>
        )}
        {visiblePens.map(pen => <PenCard key={pen.id} pen={pen} />)}
      </div>
    </div>
  );
}
// ── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user, apiFetch } = useAuth();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/dashboard');
      if (res.ok) { setData(await res.json()); setError(null); }
      else setError('Could not load dashboard data');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); const t=setInterval(load,60000); return ()=>clearInterval(t); }, [load]);

  if (!user) return null;

  if (loading) return (
    <AppShell>
      <div style={{display:'flex',flexDirection:'column',gap:14,padding:24}}>
        {[1,2,3].map(i=><div key={i} className="card" style={{height:80,opacity:.4}}/>)}
      </div>
    </AppShell>
  );

  if (error) return (
    <AppShell>
      <div className="card" style={{textAlign:'center',padding:60}}>
        <div style={{fontSize:32,marginBottom:12}}>⚠</div>
        <div style={{fontWeight:700,marginBottom:8}}>{error}</div>
        <button className="btn btn-primary" onClick={load}>Retry</button>
      </div>
    </AppShell>
  );

  const { isManager, isPenMgr, isPenWorker, sections=[], pens=[], orgTotals, tasks=[] } = data||{};

  return (
    <AppShell>
      <div className="animate-in">
        {isPenWorker && sections.length===0 && (
          <div className="card" style={{textAlign:'center',padding:60}}>
            <div style={{fontSize:48,marginBottom:12}}>🏡</div>
            <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>No sections assigned yet</div>
            <div style={{color:'var(--text-muted)',fontSize:13}}>Contact your pen manager to get assigned to a section.</div>
          </div>
        )}
        {isPenWorker && sections.length>0 && <WorkerDashboard sections={sections} tasks={tasks} user={user} apiFetch={apiFetch}/>}
        {isPenMgr    && <PenManagerDashboard pens={pens} tasks={tasks} user={user}/>}
        {isManager   && <ManagerDashboard pens={pens} orgTotals={orgTotals} user={user}/>}
      </div>
    </AppShell>
  );
}