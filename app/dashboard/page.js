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
  const [modal, setModal] = useState(false);
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
      <div style={{padding:'16px 18px'}}>
        {/* Header */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>{sec.penName} — {sec.name}</div>
            {sec.flock
              ? <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>{sec.flock.batchCode} · {sec.flock.breed} · {sec.ageInDays} days old</div>
              : <div style={{fontSize:11,color:'var(--text-faint)',marginTop:2}}>No active flock</div>}
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:18,fontWeight:700,color:occColor(sec.occupancyPct)}}>{sec.occupancyPct}%</div>
            <div style={{fontSize:10,color:'var(--text-muted)'}}>{fmt(sec.currentBirds)} / {fmt(sec.capacity)}</div>
          </div>
        </div>
        <OccBar pct={sec.occupancyPct} />

        {flag && <div style={{marginTop:8,fontSize:11,fontWeight:700,color:flag.type==='critical'?'#ef4444':'#d97706',background:flag.type==='critical'?'#fff5f5':'#fffbeb',border:`1px solid ${flag.type==='critical'?'#fecaca':'#fde68a'}`,borderRadius:6,padding:'4px 10px',display:'inline-block'}}>⚠ {flag.msg}</div>}

        {/* Core 4 */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginTop:14}}>
          {core.map(k => (
            <div key={k.label} style={{textAlign:'center',padding:'10px 8px',background:k.warn?'#fff5f5':'var(--bg-elevated)',border:`1px solid ${k.warn?'#fecaca':'var(--border)'}`,borderRadius:8}}>
              <div style={{fontSize:18,marginBottom:4}}>{k.icon}</div>
              <div style={{fontFamily:"'Poppins',sans-serif",fontSize:16,fontWeight:700,color:k.color}}>{k.val}</div>
              <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em',marginTop:2}}>{k.label}</div>
            </div>
          ))}
        </div>

        {sec.flock && (
          <button onClick={()=>setModal(true)} style={{marginTop:14,width:'100%',padding:'8px',background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600,color:'var(--text-secondary)',display:'flex',alignItems:'center',justifyContent:'center',gap:6,transition:'all .15s'}}>
            📈 View Trends & Charts
          </button>
        )}
      </div>

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

// ── Pen section table row ─────────────────────────────────────────────────────
function Cell({ v, c='var(--text-primary)' }) {
  return <div style={{textAlign:'center',fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:700,color:c}}>{v??'—'}</div>;
}

// ── Pen card (pen manager + farm manager) ─────────────────────────────────────
function PenCard({ pen }) {
  const [sectionsOpen, setSectionsOpen] = useState(true);
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

  const colHeaders = isL
    ? ['Section','Occupancy','Dead','Laying','Eggs','Grade A','Feed/d','Charts']
    : ['Section','Occupancy','Dead','Weight','FCR','Harvest','Feed/d','Charts'];
  const colTemplate = 'minmax(140px,1.2fr) minmax(100px,1fr) 60px 70px 70px 72px 64px 72px';

  return (
    <div style={{marginBottom:16}}>
      <div className="card" style={{padding:0,overflow:'hidden',borderLeft:`4px solid ${alertBorder}`}}>
        <div style={{padding:'16px 18px'}}>
          {/* Pen header */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:38,height:38,borderRadius:10,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{OP_ICON[pen.operationType]}</div>
              <div>
                <div style={{fontWeight:700,fontSize:15}}>{pen.name}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{pen.farmName} · {pen.sectionCount} sections · {fmt(pen.totalBirds)} birds</div>
              </div>
            </div>
            {pen.alertLevel !== 'ok' && (
              <span style={{fontSize:10,fontWeight:700,color:pen.alertLevel==='critical'?'#ef4444':'#d97706',background:pen.alertLevel==='critical'?'#fff5f5':'#fffbeb',border:`1px solid ${pen.alertLevel==='critical'?'#fecaca':'#fde68a'}`,borderRadius:20,padding:'3px 10px'}}>
                {pen.alertLevel==='critical'?'🔴 Alert':'🟡 Warning'}
              </span>
            )}
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

          <button onClick={()=>setSectionsOpen(o=>!o)} style={{marginTop:12,width:'100%',padding:'7px',background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600,color:'var(--text-secondary)'}}>
            {sectionsOpen ? '▲ Hide Section Breakdown' : '▼ Section Breakdown'}
          </button>
        </div>

        {/* Section table */}
        {sectionsOpen && (
          <div style={{borderTop:'1px solid var(--border)'}}>
            {/* Header row */}
            <div style={{display:'grid',gridTemplateColumns:colTemplate,gap:6,padding:'8px 16px',background:'var(--bg-page)',borderBottom:'1px solid var(--border)'}}>
              {colHeaders.map((h,i) => (
                <div key={h} style={{fontSize:9,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',textAlign:i<2?'left':'center'}}>{h}</div>
              ))}
            </div>

            {pen.sections.map(sec => {
              const smx = sec.metrics;
              const flg = sec.flags[0];
              return (
                <div key={sec.id}>
                  <div style={{display:'grid',gridTemplateColumns:colTemplate,gap:6,padding:'10px 16px',alignItems:'center',borderBottom:'1px solid var(--border)',background:flg?.type==='critical'?'#fff5f5':flg?.type==='warn'?'#fffbeb':'#fff'}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:12}}>{sec.name}</div>
                      {sec.flock
                        ? <div style={{fontSize:10,color:'var(--text-muted)'}}>{sec.flock.batchCode} · {sec.ageInDays}d</div>
                        : <div style={{fontSize:10,color:'var(--text-faint)'}}>Empty</div>}
                      {sec.workers.length>0 && <div style={{fontSize:10,color:'var(--purple)',marginTop:1}}>{sec.workers.map(w=>`${w.firstName} ${w.lastName[0]}.`).join(', ')}</div>}
                      {flg && <div style={{fontSize:9,fontWeight:700,color:flg.type==='critical'?'#ef4444':'#d97706',marginTop:2}}>⚠ {flg.msg}</div>}
                    </div>
                    <div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--text-muted)',marginBottom:3}}>
                        <span>{fmt(sec.currentBirds)}</span>
                        <span style={{fontWeight:700,color:occColor(sec.occupancyPct)}}>{sec.occupancyPct}%</span>
                      </div>
                      <OccBar pct={sec.occupancyPct} h={4} />
                    </div>
                    {isL ? <>
                      <Cell v={fmt(smx.todayMortality)}        c={smx.todayMortality>5?'#ef4444':'var(--text-primary)'} />
                      <Cell v={`${smx.todayLayingRate??0}%`}   c={rateColor(smx.todayLayingRate)} />
                      <Cell v={fmt(smx.todayEggs)}              c='#f59e0b' />
                      <Cell v={`${smx.todayGradeAPct??0}%`}    c={rateColor(smx.todayGradeAPct)} />
                      <Cell v={`${smx.avgDailyFeedKg??0}kg`} />
                    </> : <>
                      <Cell v={fmt(smx.todayMortality)}        c={smx.todayMortality>5?'#ef4444':'var(--text-primary)'} />
                      <Cell v={smx.latestWeightG?`${fmt(smx.latestWeightG)}g`:'—'} c='#3b82f6' />
                      <Cell v={smx.estimatedFCR??'—'}          c={fcrColor(smx.estimatedFCR||0)} />
                      <Cell v={smx.daysToHarvest!=null?`${smx.daysToHarvest}d`:'—'} c='#8b5cf6' />
                      <Cell v={`${smx.avgDailyFeedKg??0}kg`} />
                    </>}
                    {/* Chart toggle */}
                    <div style={{textAlign:'center'}}>
                      {sec.flock && (
                        <button onClick={()=>setModalSec({ id:sec.id, name:sec.name })} style={{fontSize:11,padding:'4px 8px',border:'1px solid var(--border)',borderRadius:6,background:'var(--bg-elevated)',color:'var(--text-muted)',cursor:'pointer',fontWeight:600}}>
                          📈 Trends
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
function WorkerDashboard({ sections, tasks, user }) {
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
        </p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
        {kpis.map(k=><KpiCard key={k.label} {...k} />)}
      </div>
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
  const alerts = pens.filter(p=>p.alertLevel!=='ok').length;
  const roleLabel = { FARM_MANAGER:'Farm Manager', FARM_ADMIN:'Farm Admin', CHAIRPERSON:'Chairperson', SUPER_ADMIN:'Super Admin' }[user?.role] || user?.role || '';

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:24}}>
        <div>
          <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0}}>Farm Overview</h1>
          <p style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
            {roleLabel} · {pens.length} pens — click 📈 Trends on any section for charts
            {alerts>0&&<span style={{color:'#ef4444',fontWeight:700,marginLeft:8}}>· {alerts} need attention</span>}
          </p>
        </div>
      </div>
      {orgTotals && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:24}}>
          <KpiCard icon="🐦" value={fmt(orgTotals.totalBirds)}    label="Total Live Birds"   color="var(--purple)" />
          <KpiCard icon="💀" value={fmt(orgTotals.todayMortality)} label="Deaths Today"       warn={orgTotals.todayMortality>30} />
          <KpiCard icon="🥚" value={fmt(orgTotals.todayEggs)}      label="Layer Eggs Today"   color="#f59e0b" />
          <KpiCard icon="📊" value={`${orgTotals.avgLayingRate??0}%`} label="Avg Laying Rate" color="#16a34a" warn={orgTotals.avgLayingRate<70} />
          <KpiCard icon="🔔" value={orgTotals.pensWithAlerts}      label="Pens With Alerts"  warn={orgTotals.pensWithAlerts>0} />
        </div>
      )}
      {['LAYER','BROILER'].map(opType => {
        const tp = pens.filter(p=>p.operationType===opType);
        if (!tp.length) return null;
        return (
          <div key={opType} style={{marginBottom:24}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
              <span style={{fontSize:16}}>{OP_ICON[opType]}</span>
              <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em'}}>
                {opType==='LAYER'?'Layer Operations':'Broiler Operations'} · {tp.length} pen{tp.length!==1?'s':''}
              </div>
            </div>
            {tp.map(pen=><PenCard key={pen.id} pen={pen}/>)}
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  if (!user) return null;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', { credentials:'include' });
      if (res.ok) { setData(await res.json()); setError(null); }
      else setError('Could not load dashboard data');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t=setInterval(load,60000); return ()=>clearInterval(t); }, [load]);

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
        {isPenWorker && sections.length>0 && <WorkerDashboard sections={sections} tasks={tasks} user={user}/>}
        {isPenMgr    && <PenManagerDashboard pens={pens} tasks={tasks} user={user}/>}
        {isManager   && <ManagerDashboard pens={pens} orgTotals={orgTotals} user={user}/>}
      </div>
    </AppShell>
  );
}
