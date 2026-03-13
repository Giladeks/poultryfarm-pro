'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import KpiCard from '@/components/ui/KpiCard';
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

// ── KPI status helpers ────────────────────────────────────────────────────────
function layRateStatus(r)       { if (r==null) return 'neutral'; return r>=82?'good':r>=70?'warn':'critical'; }
function mortalityStatus(r7d)   { if (r7d==null) return 'neutral'; return r7d<=0.05?'good':r7d<=0.15?'warn':'critical'; }
function fcrStatus(f, broiler)  { if (!f) return 'neutral'; const hi=broiler?2.0:2.2; return f<=(broiler?1.9:2.0)?'good':f<=hi?'warn':'critical'; }
function uniformityStatus(p)    { if (p==null) return 'neutral'; return p>=80?'good':p>=70?'warn':'critical'; }
function gradeAStatus(p)        { if (p==null) return 'neutral'; return p>=85?'good':p>=75?'warn':'critical'; }

function layerWaterBenchmark(ageInDays) {
  if (!ageInDays) return 0.30;
  if (ageInDays < 28)  return 0.08;
  if (ageInDays < 119) return 0.18;
  return 0.30;
}
function broilerWaterBenchmark(ageInDays) {
  if (!ageInDays) return 0.25;
  if (ageInDays <= 7)  return 0.04;
  if (ageInDays <= 21) return 0.12;
  if (ageInDays <= 35) return 0.22;
  return 0.30;
}
function waterStatus(actual, benchmark) {
  if (actual == null || !benchmark) return 'neutral';
  const pct = actual / benchmark;
  if (pct >= 0.85) return 'good';
  if (pct >= 0.65) return 'warn';
  return 'critical';
}
function waterDelta(actual, benchmark) {
  if (actual == null) return 'Not tracked yet';
  if (!benchmark) return actual.toFixed(2) + ' L/bird';
  const pct = Math.round((actual / benchmark) * 100);
  return pct + '% of age benchmark';
}
function mortCountStatus(n,thr) { if (n==null) return 'neutral'; return n===0?'good':n<=thr?'warn':'critical'; }

function OccBar({ pct, h=5 }) {
  return (
    <div style={{height:h,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
      <div style={{height:'100%',width:`${Math.min(pct||0,100)}%`,background:occColor(pct||0),borderRadius:2,transition:'width .5s ease'}}/>
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

// ── Section card (pen worker) — mockup style ─────────────────────────────────
function WorkerSectionCard({ sec, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [modal,    setModal]    = useState(false);
  const mx    = sec.metrics;
  const isL   = sec.penOperationType === 'LAYER';
  const flag  = (sec.flags||[])[0];
  const isCrit = flag?.type === 'critical';
  const isWarn = flag?.type === 'warn';

  // Primary metric for collapsed row
  const layRate      = mx.todayLayingRate > 0 ? mx.todayLayingRate : null;
  const primaryVal   = isL
    ? (layRate != null ? `${layRate}%` : '—')
    : (mx.latestWeightG != null ? `${(mx.latestWeightG/1000).toFixed(2)} kg` : '—');
  const primaryColor = isL
    ? (layRate == null ? 'var(--text-muted)' : layRate < 70 ? '#ef4444' : layRate < 80 ? '#d97706' : '#16a34a')
    : 'var(--text-primary)';

  return (
    <div style={{background:'#fff',border:`1px solid ${isCrit?'#fecaca':isWarn?'#fde68a':'#e2e8f0'}`,borderRadius:12,overflow:'hidden',boxShadow:isCrit?'0 0 0 2px rgba(239,68,68,0.07)':'none',marginBottom:8}}>

      {/* ── Collapsed header row ── */}
      <div onClick={()=>setExpanded(e=>!e)} style={{padding:'12px 15px',cursor:'pointer',display:'flex',alignItems:'center',gap:10,borderBottom:expanded?'1px solid #f1f5f9':'none',background:expanded?'#f8fafc':'#fff'}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:isCrit?'#ef4444':isWarn?'#f59e0b':'#16a34a',flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:600,color:'var(--text-primary)'}}>{sec.penName} — {sec.name}</div>
          {sec.flock
            ? <div style={{fontSize:11,color:'var(--text-muted)',marginTop:1}}>{sec.flock.batchCode} · {sec.flock.breed} · {sec.ageInDays}d old</div>
            : <div style={{fontSize:11,color:'var(--text-faint)',marginTop:1}}>No active flock</div>}
        </div>
        {/* Inline stats */}
        <div style={{display:'flex',alignItems:'center',gap:16,flexShrink:0}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:15,fontWeight:700,color:primaryColor}}>{primaryVal}</div>
            <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em'}}>{isL?'Lay rate':'Avg weight'}</div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:15,fontWeight:700,color:occColor(sec.occupancyPct)}}>{sec.occupancyPct}%</div>
            <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em'}}>{fmt(sec.currentBirds)}/{fmt(sec.capacity)}</div>
          </div>
        </div>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{transform:expanded?'rotate(180deg)':'none',transition:'transform 0.2s',flexShrink:0}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* ── Expanded: detailed stats + flag + trends button ── */}
      {expanded && (
        <div style={{padding:'12px 15px',background:'#f8fafc'}}>
          {flag && <div style={{marginBottom:10,fontSize:11,fontWeight:700,color:isCrit?'#ef4444':'#d97706',background:isCrit?'#fef2f2':'#fffbeb',border:`1px solid ${isCrit?'#fecaca':'#fde68a'}`,borderRadius:6,padding:'5px 10px',display:'inline-block'}}>⚠ {flag.msg}</div>}
          <div style={{display:'flex',gap:10,marginBottom:sec.flock?10:0,flexWrap:'wrap'}}>
            {isL ? <>
              <StatChip label="Eggs Today"   value={fmt(mx.todayEggs)} color="#f59e0b"/>
              <StatChip label="Lay Rate"     value={`${mx.todayLayingRate??0}%`} color={rateColor(mx.todayLayingRate)}/>
              <StatChip label="Deaths"       value={fmt(mx.todayMortality)} color={mx.todayMortality>5?'#ef4444':'var(--text-secondary)'}/>
              <StatChip label="7d Deaths"    value={fmt(mx.weekMortality)} color="var(--text-secondary)"/>
            </> : <>
              <StatChip label="Avg Weight"   value={mx.latestWeightG?`${fmt(mx.latestWeightG)}g`:'—'} color="#3b82f6"/>
              <StatChip label="Est. FCR"     value={mx.estimatedFCR??'—'} color={fcrColor(mx.estimatedFCR||0)}/>
              <StatChip label="Deaths"       value={fmt(mx.todayMortality)} color={mx.todayMortality>5?'#ef4444':'var(--text-secondary)'}/>
              <StatChip label="To Harvest"   value={mx.daysToHarvest!=null?`${mx.daysToHarvest}d`:'—'} color="#8b5cf6"/>
            </>}
          </div>
          {sec.flock && (
            <button onClick={e=>{e.stopPropagation();setModal(true);}} style={{width:'100%',padding:'7px',background:'#eeecff',border:'none',borderRadius:8,cursor:'pointer',fontSize:11,fontWeight:600,color:'#6c63ff',display:'flex',alignItems:'center',justifyContent:'center',gap:5}}>
              📈 View Trends →
            </button>
          )}
        </div>
      )}

      {modal && <ChartModal sectionId={sec.id} sectionName={sec.name} penName={sec.penName} opType={sec.penOperationType} onClose={()=>setModal(false)}/>}
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:8,padding:'7px 12px',textAlign:'center',minWidth:70}}>
      <div style={{fontFamily:"'Poppins',sans-serif",fontSize:14,fontWeight:700,color:color||'var(--text-primary)',lineHeight:1}}>{value}</div>
      <div style={{fontSize:9,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.04em',marginTop:3}}>{label}</div>
    </div>
  );
}
// ── Pen card (pen manager + farm manager) — mockup style ─────────────────────
function PenCard({ pen, autoOpen = false, highlightSection = null }) {
  const [open,     setOpen]    = useState(autoOpen);
  const [modalSec, setModalSec]= useState(null);
  const cardRef = useRef(null);
  const [breathSection, setBreathSection] = useState(null);
  const [cardBreath,    setCardBreath]    = useState(false);

  // When autoOpen becomes true: force-open card, scroll, start breathing highlight
  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
    const scrollT = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    if (highlightSection) {
      setBreathSection(highlightSection);
      const clearT = setTimeout(() => setBreathSection(null), 3000);
      return () => { clearTimeout(scrollT); clearTimeout(clearT); };
    } else {
      setCardBreath(true);
      const clearT = setTimeout(() => setCardBreath(false), 3000);
      return () => { clearTimeout(scrollT); clearTimeout(clearT); };
    }
  }, [autoOpen, highlightSection]);
  const isL    = pen.operationType === 'LAYER';
  const mx     = pen.metrics;
  const isCrit = pen.alertLevel === 'critical';
  const isWarn = pen.alertLevel === 'warn';

  const avgRate      = (mx.avgLayingRate > 0) ? mx.avgLayingRate : null;
  const primaryVal   = isL
    ? (avgRate != null ? `${avgRate}%` : '—')
    : (mx.avgWeightG != null ? `${(mx.avgWeightG/1000).toFixed(2)} kg` : '—');
  const primaryLabel = isL ? 'lay rate' : 'avg weight';
  const primaryCrit  = isL ? (avgRate != null && avgRate < 70) : false;
  const deaths7d     = mx.weekMortality ?? 0;
  const firstFlag    = (pen.sections||[]).flatMap(s=>s.flags||[]).find(f=>f.type==='critical')
                    || (pen.sections||[]).flatMap(s=>s.flags||[]).find(f=>f.type==='warn')
                    || (pen.flags||[])[0];

  return (
    <div ref={cardRef} id={`pen-${pen.id}`} style={{marginBottom:10}}>
      <div style={{background:'#fff',border:`1.5px solid ${cardBreath?'#fb923c':isCrit?'#fecaca':isWarn?'#fde68a':'#e2e8f0'}`,borderRadius:14,overflow:'hidden',boxShadow:isCrit?'0 0 0 2px rgba(239,68,68,0.07)':'none',animation:cardBreath?'harvestBreath 0.8s ease-in-out infinite':'none'}}>

        {/* Collapsed header row */}
        <div onClick={()=>setOpen(o=>!o)} style={{padding:'13px 16px',cursor:'pointer',display:'flex',alignItems:'center',gap:11,borderBottom:open?'1px solid #f1f5f9':'none',background:open?'#f8fafc':'#fff'}}>
          <div style={{width:10,height:10,borderRadius:'50%',background:isCrit?'#ef4444':isWarn?'#f59e0b':'#16a34a',flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:3}}>
              <span style={{fontFamily:"'Poppins',sans-serif",fontSize:14,fontWeight:600,color:'var(--text-primary)'}}>{pen.name}</span>
              <span style={{fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:99,background:isL?'#eeecff':'#fff7ed',color:isL?'#6c63ff':'#ea580c'}}>{isL?'Layer':'Broiler'}</span>
              {(isCrit||isWarn)&&<span style={{fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:99,background:isCrit?'#fef2f2':'#fffbeb',color:isCrit?'#ef4444':'#d97706'}}>{isCrit?'critical':'warning'}</span>}
            </div>
            <div style={{display:'flex',gap:14,alignItems:'center'}}>
              <span style={{fontSize:12,color:'var(--text-muted)'}}><b style={{color:'var(--text-primary)',fontWeight:600}}>{pen.totalBirds?.toLocaleString()}</b> birds</span>
              <span style={{fontSize:12,color:'var(--text-muted)'}}><b style={{color:primaryCrit?'#ef4444':'var(--text-primary)',fontWeight:600}}>{primaryVal}</b> {primaryLabel}</span>
              <span style={{fontSize:12,color:deaths7d>15?'#ef4444':'var(--text-muted)'}}><b style={{color:deaths7d>15?'#ef4444':'var(--text-primary)',fontWeight:600}}>{deaths7d}</b> deaths/7d</span>
            </div>
            {firstFlag&&<div style={{marginTop:3,fontSize:11,color:firstFlag.type==='critical'?'#ef4444':'#d97706',fontWeight:500}}>↳ {firstFlag.msg}</div>}
          </div>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transform:open?'rotate(180deg)':'none',transition:'transform 0.2s',flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>
        </div>

        {/* Expanded: section rows */}
        {open&&(
          <div style={{padding:'11px 15px',display:'flex',flexDirection:'column',gap:7}}>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:2}}>📍 {pen.sectionCount} sections · click "View Trends" for charts</div>
            {(pen.sections||[]).map(sec=>{
              const isBreathing = breathSection && sec.name === breathSection;
              const smx=sec.metrics;
              const sFlg=(sec.flags||[])[0];
              const sPrimary=isL?(smx.todayLayingRate!=null?`${smx.todayLayingRate}%`:'—'):(smx.latestWeightG!=null?`${(smx.latestWeightG/1000).toFixed(2)} kg`:'—');
              const sPrimaryColor=isL?(smx.todayLayingRate<70?'#ef4444':smx.todayLayingRate<80?'#d97706':'#16a34a'):'var(--text-primary)';
              return(
                <div key={sec.id} style={{borderRadius:9,padding:'9px 13px',display:'flex',alignItems:'center',gap:11,border:`1px solid ${isBreathing?'#fb923c':'#e2e8f0'}`,background:isBreathing?'#fff7ed':'#f8fafc',animation:isBreathing?'harvestBreath 0.8s ease-in-out infinite':'none',transition:'background 0.4s,border-color 0.4s'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--text-secondary)',marginBottom:3}}>{sec.name}</div>
                    <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
                      <span style={{fontSize:11,color:'var(--text-muted)'}}>{sec.currentBirds?.toLocaleString()} birds</span>
                      <span style={{fontSize:11,fontWeight:700,color:sPrimaryColor}}>{sPrimary} {isL?'lay rate':'avg weight'}</span>
                      {smx.todayMortality!=null&&<span style={{fontSize:11,color:smx.todayMortality>5?'#ef4444':'var(--text-muted)'}}>{smx.todayMortality} deaths today</span>}
                      {sec.flock&&<span style={{fontSize:11,color:'var(--text-muted)'}}>{sec.ageInDays}d old</span>}
                    </div>
                  </div>
                  {sFlg&&<span style={{fontSize:10,fontWeight:600,color:'#d97706',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:5,padding:'2px 7px',whiteSpace:'nowrap'}}>{sFlg.msg}</span>}
                  {sec.flock&&<button onClick={e=>{e.stopPropagation();setModalSec({id:sec.id,name:sec.name});}} style={{background:'#eeecff',border:'none',borderRadius:7,padding:'5px 11px',fontSize:11,fontWeight:600,color:'#6c63ff',cursor:'pointer',whiteSpace:'nowrap'}}>View Trends →</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {modalSec&&<ChartModal sectionId={modalSec.id} sectionName={modalSec.name} penName={pen.name} opType={pen.operationType} onClose={()=>setModalSec(null)}/>}
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

  // ── Task completion rate ─────────────────────────────────────────────────────
  const totalTasks = tasks.length;
  const doneTasks  = tasks.filter(t => t.status === 'COMPLETED').length;
  const taskRate   = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : null;
  const taskStatus = taskRate == null ? 'neutral' : taskRate === 100 ? 'good' : taskRate >= 70 ? 'warn' : 'critical';
  const taskDelta  = taskRate == null ? 'No tasks today' : taskRate === 100 ? 'All tasks done 🎉' : `${totalTasks - doneTasks} remaining`;
  const taskCard   = {
    label:'Task Completion', value: taskRate != null ? `${taskRate}%` : '—',
    sub: totalTasks > 0 ? `${doneTasks} of ${totalTasks} tasks done` : 'No tasks assigned today',
    delta: taskDelta, trend: taskRate===100?'up':taskRate!=null&&taskRate<70?'down':'stable',
    status: taskStatus, icon:'✅', context:'Today',
  };

  // ── Build status-colour KPI cards ───────────────────────────────────────────
  const workerKpis = isL ? [
    {
      label:'Live Birds', value: fmt(totBirds),
      sub:`${sections.length} section${sections.length!==1?'s':''}`,
      delta:'', trend:'stable', status:'neutral',
      icon:'🐦', context:'Your sections',
    },
    {
      label:'Eggs Collected Today', value: fmt(todayEggs),
      sub:`7d avg ${fmt(Math.round(sections.filter(s=>s.metrics.type==='LAYER').reduce((a,s)=>a+(s.metrics.weekEggs||0),0)/7))}`,
      delta: todayEggs>0?`${fmt(todayEggs)} collected`:'None yet',
      trend:'stable', status: todayEggs>0?'good':'neutral',
      icon:'🥚', context:'Your sections',
    },
    {
      label:'Mortality Today', value: fmt(totDead),
      sub:`7d total: ${fmt(sections.reduce((a,s)=>a+(s.metrics.weekMortality||0),0))}`,
      delta: totDead===0?'All clear':totDead<=2?'Normal':'Spike detected',
      trend: totDead===0?'up':totDead>5?'down':'stable',
      status: mortCountStatus(totDead, 5),
      icon:'📉', context:'Your sections',
    },
    taskCard,
  ] : [
    {
      label:'Live Birds', value: fmt(totBirds),
      sub:`${sections.length} section${sections.length!==1?'s':''}`,
      delta:'', trend:'stable', status:'neutral',
      icon:'🐔', context:'Your sections',
    },
    {
      label:'Avg Live Weight', value: avgWt?`${(avgWt/1000).toFixed(2)} kg`:'—',
      sub:`Age ${sections[0]?.ageInDays||'—'}d`,
      delta: avgWt?`${avgWt}g avg`:'No weigh-in yet',
      trend:'stable', status:'neutral',
      icon:'⚖️', context:'Your sections',
    },
    {
      label:'Mortality Today', value: fmt(totDead),
      sub:`7d total: ${fmt(sections.reduce((a,s)=>a+(s.metrics.weekMortality||0),0))}`,
      delta: totDead===0?'All clear':totDead<=2?'Normal':'Spike detected',
      trend: totDead===0?'up':totDead>5?'down':'stable',
      status: mortCountStatus(totDead, 5),
      icon:'📉', context:'Your sections',
    },
    taskCard,
  ];

  // ── Sort sections: flagged (critical first, then warn) then ok ───────────────
  function secLevel(sec) {
    const f = (sec.flags||[])[0];
    if (!f) return 2;
    if (f.type === 'critical') return 0;
    return 1;
  }
  const sortedSections = [...sections].sort((a, b) => secLevel(a) - secLevel(b));
  const flaggedSections = sortedSections.filter(s => (s.flags||[]).length > 0);
  const okSections      = sortedSections.filter(s => (s.flags||[]).length === 0);

  // Build a synthetic pens-like structure for AttentionPill from worker sections
  const pillPens = sections.reduce((acc, sec) => {
    const existing = acc.find(p => p.id === sec.penId);
    const flag = (sec.flags||[])[0];
    const secEntry = { name: sec.name, flags: sec.flags||[] };
    if (existing) {
      existing.sections.push(secEntry);
      if (flag) {
        const cur = existing.alertLevel;
        existing.alertLevel = (flag.type==='critical'||cur==='critical') ? 'critical' : 'warn';
      }
    } else {
      acc.push({
        id: sec.penId,
        name: sec.penName,
        operationType: sec.penOperationType,
        alertLevel: flag ? flag.type : 'ok',
        sections: [secEntry],
      });
    }
    return acc;
  }, []);

  return (
    <div>
      {/* ── Header ── */}
      <div style={{marginBottom:16}}>
        <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0}}>Good {greet}, {user.firstName} 👋</h1>
        <p style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
          {isL?'🥚 Layer':'🍗 Broiler'} · {sections.length} section{sections.length!==1?'s':''} assigned
          {rejected.length>0&&<span style={{color:'#dc2626',fontWeight:700,marginLeft:8}}>· {rejected.length} correction{rejected.length!==1?'s':''} needed</span>}
        </p>
      </div>

      {/* ── Attention banner ── */}
      <div style={{marginBottom:16}}>
        <AttentionPill pens={pillPens} mode='sections' onNavigate={() => {}} />
      </div>

      {/* ── KPI row: Live Birds first ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
        {workerKpis.map(k=><KpiCard key={k.label} label={k.label} value={k.value} sub={k.sub} delta={k.delta} trend={k.trend} status={k.status} icon={k.icon} context={k.context} />)}
      </div>

      {/* ── Needs Correction banner ── */}
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

      {/* ── Sections — flagged first, then ok ── */}
      <div style={{display:'flex',flexDirection:'column',gap:0}}>
        {flaggedSections.length > 0 && (
          <>
            <div style={{fontSize:11,fontWeight:700,color:'#ef4444',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>
              ⚠ Needs Attention ({flaggedSections.length})
            </div>
            {flaggedSections.map(sec=><WorkerSectionCard key={sec.id} sec={sec} defaultExpanded />)}
            {okSections.length > 0 && (
              <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',margin:'18px 0 10px'}}>
                All Clear ({okSections.length})
              </div>
            )}
          </>
        )}
        {okSections.length > 0 && !flaggedSections.length && (
          <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12}}>My Sections</div>
        )}
        {okSections.map(sec=><WorkerSectionCard key={sec.id} sec={sec}/>)}
      </div>
    </div>
  );
}

// ── Pen Manager dashboard ─────────────────────────────────────────────────────
function PenManagerDashboard({ pens, tasks, user }) {
  const router = useRouter();
  const [navTarget, setNavTarget] = useState(null); // { penId, sectionName }
  const totBirds = pens.reduce((s,p)=>s+p.totalBirds,0);
  const totDead  = pens.reduce((s,p)=>s+p.metrics.todayMortality,0);
  const todayEggs= pens.filter(p=>p.operationType==='LAYER').reduce((s,p)=>s+(p.metrics.todayEggs||0),0);
  const alerts   = pens.filter(p=>p.alertLevel!=='ok').length;
  const h = new Date().getHours();
  const greet = h<12?'morning':h<17?'afternoon':'evening';

  const layerPens  = pens.filter(p=>p.operationType==='LAYER');
  const hasLayer   = layerPens.length > 0;

  // Aggregate lay rate across layer pens
  const layRates   = layerPens.filter(p=>(p.metrics.avgLayingRate||0)>0);
  const avgLayRate = layRates.length ? parseFloat((layRates.reduce((s,p)=>s+(p.metrics.avgLayingRate||0),0)/layRates.length).toFixed(1)) : 0;

  // ── Per-pen aggregates scoped to this manager's pens ────────────────────────
  const broilerPens   = pens.filter(p=>p.operationType==='BROILER');
  const hasBroiler    = broilerPens.length > 0;

  // Layer aggregates
  const lBirds        = layerPens.reduce((s,p)=>s+p.totalBirds,0);
  const lEggs         = layerPens.reduce((s,p)=>s+(p.metrics.todayEggs||0),0);
  const lWeekEggs     = layerPens.reduce((s,p)=>s+(p.metrics.weekEggs||0),0);
  const lDead7        = layerPens.reduce((s,p)=>s+(p.metrics.weekMortality||0),0);
  const lMortR        = lBirds>0 ? parseFloat(((lDead7/lBirds)*100).toFixed(2)) : 0;
  const lGAPens       = layerPens.filter(p=>(p.metrics.todayGradeAPct||0)>0);
  const lGradeA       = lGAPens.length ? parseFloat((lGAPens.reduce((s,p)=>s+(p.metrics.todayGradeAPct||0),0)/lGAPens.length).toFixed(1)) : null;
  const lWaterPens    = layerPens.filter(p=>p.metrics.avgWaterLPB!=null);
  const lAvgWater     = lWaterPens.length ? parseFloat((lWaterPens.reduce((s,p)=>s+(p.metrics.avgWaterLPB||0),0)/lWaterPens.length).toFixed(2)) : null;
  const lAvgAge       = layerPens.length ? Math.round(layerPens.reduce((s,p)=>s+(p.sections&&p.sections[0]?p.sections[0].ageInDays||180:180),0)/layerPens.length) : 180;
  const lWaterBench   = layerWaterBenchmark(lAvgAge);

  // Broiler aggregates
  const bBirds        = broilerPens.reduce((s,p)=>s+p.totalBirds,0);
  const bDead7        = broilerPens.reduce((s,p)=>s+(p.metrics.weekMortality||0),0);
  const bMortR        = bBirds>0 ? parseFloat(((bDead7/bBirds)*100).toFixed(2)) : 0;
  const bWts          = broilerPens.filter(p=>p.metrics.avgWeightG);
  const bAvgWt        = bWts.length ? parseFloat((bWts.reduce((s,p)=>s+p.metrics.avgWeightG,0)/bWts.length).toFixed(0)) : null;
  const bFcrs         = broilerPens.filter(p=>p.metrics.avgFCR);
  const bAvgFCR       = bFcrs.length ? parseFloat((bFcrs.reduce((s,p)=>s+p.metrics.avgFCR,0)/bFcrs.length).toFixed(2)) : null;
  const bWaterPens    = broilerPens.filter(p=>p.metrics.avgWaterLPB!=null);
  const bAvgWater     = bWaterPens.length ? parseFloat((bWaterPens.reduce((s,p)=>s+(p.metrics.avgWaterLPB||0),0)/bWaterPens.length).toFixed(2)) : null;
  const bAvgAge       = broilerPens.length ? Math.round(broilerPens.reduce((s,p)=>s+(p.sections&&p.sections[0]?p.sections[0].ageInDays||28:28),0)/broilerPens.length) : 28;
  const bWaterBench   = broilerWaterBenchmark(bAvgAge);
  const bNearHarvest  = broilerPens.filter(p=>p.metrics.nearestHarvest!=null&&p.metrics.nearestHarvest<=7).length;

  // Layer KPI story: Total Birds → Lay Rate → Eggs Today → Grade A → Water → Mortality
  const layerKpis = hasLayer ? [
    { label:'Total Birds',    value: fmt(lBirds),                           sub: layerPens.length+' pen'+(layerPens.length!==1?'s':''),      delta:'', trend:'stable', status:'neutral', icon:'🐦', context:'Your layer pen' },
    { label:'Lay Rate',       value: avgLayRate>0 ? avgLayRate+'%' : '—',   sub: 'Target 82%',                                               delta:avgLayRate>0?(avgLayRate>=82?'+'+((avgLayRate-82).toFixed(1))+'% above target':((avgLayRate-82).toFixed(1))+'% below target'):'No data yet', trend:avgLayRate>=82?'up':avgLayRate>0?'down':'stable', status:layRates.length?layRateStatus(avgLayRate):'neutral', icon:'📊', context:'Performance' },
    { label:'Eggs Today',     value: fmt(lEggs),                            sub: '7d total '+fmt(lWeekEggs),                                 delta:lEggs>0?fmt(lEggs)+' collected today':'None recorded yet', trend:'stable', status:lEggs>0?'good':'neutral', icon:'🥚', context:'Output' },
    { label:'Grade A Rate',   value: lGradeA ? lGradeA+'%' : '—',          sub: 'Target ≥85%',                                         delta:lGradeA?(lGradeA>=85?'+'+((lGradeA-85).toFixed(1))+'% above target':((lGradeA-85).toFixed(1))+'% below target'):'No data yet', trend:lGradeA>=85?'up':'down', status:gradeAStatus(lGradeA), icon:'⭐', context:'Quality' },
    { label:'Water Intake',   value: lAvgWater ? lAvgWater+' L/bird' : '—', sub: 'Benchmark '+lWaterBench+' L/bird · age '+lAvgAge+'d', delta:waterDelta(lAvgWater,lWaterBench), trend:lAvgWater?(lAvgWater>=lWaterBench*0.85?'up':'down'):'stable', status:lAvgWater?waterStatus(lAvgWater,lWaterBench):'neutral', icon:'💧', context:'Health signal' },
    { label:'Mortality (7d)', value: fmt(lDead7),                           sub: lMortR+'% of flock',                                        delta:lMortR<=0.05?'Within normal range':lMortR<=0.15?'Slightly elevated':'Elevated — investigate', trend:lMortR<=0.05?'up':'down', status:mortalityStatus(lMortR), icon:'📉', context:'Health losses' },
  ] : [];

  // Broiler KPI story: Total Birds → Avg Weight → Harvest → FCR → Water → Mortality
  const broilerKpis = hasBroiler ? [
    { label:'Total Birds',       value: fmt(bBirds),                             sub: broilerPens.length+' pen'+(broilerPens.length!==1?'s':''), delta:'', trend:'stable', status:'neutral', icon:'🐔', context:'Your broiler pen' },
    { label:'Avg Live Weight',   value: bAvgWt ? (bAvgWt/1000).toFixed(2)+' kg' : '—', sub: 'Age ~'+bAvgAge+'d',                              delta:bAvgWt?bAvgWt+'g avg':'No weigh-in yet', trend:'stable', status:'neutral', icon:'⚖️', context:'Growth' },
    { label:'Harvest Countdown', value: ''+bNearHarvest,                          sub: 'Sections due ≤ 7 days',                            delta:bNearHarvest>0?bNearHarvest+' section'+(bNearHarvest!==1?'s':'')+' ready':'None due this week', trend:'stable', status:bNearHarvest>0?'warn':'neutral', icon:'📅', context:'Planning' },
    { label:'Feed Conv. Ratio',  value: bAvgFCR ? ''+bAvgFCR : '—',              sub: 'Target ≤1.9',                                       delta:bAvgFCR?(bAvgFCR<=1.9?'On target':(bAvgFCR-1.9).toFixed(2)+' above target'):'No data yet', trend:bAvgFCR?(bAvgFCR<=1.9?'up':'down'):'stable', status:fcrStatus(bAvgFCR,true), icon:'🌾', context:'Efficiency' },
    { label:'Water Intake',      value: bAvgWater ? bAvgWater+' L/bird' : '—',   sub: 'Benchmark '+bWaterBench+' L/bird · age '+bAvgAge+'d', delta:waterDelta(bAvgWater,bWaterBench), trend:bAvgWater?(bAvgWater>=bWaterBench*0.85?'up':'down'):'stable', status:bAvgWater?waterStatus(bAvgWater,bWaterBench):'neutral', icon:'💧', context:'Health signal' },
    { label:'Mortality (7d)',    value: fmt(bDead7),                             sub: bMortR+'% of flock',                                      delta:bMortR<=0.1?'Within normal range':bMortR<=0.2?'Slightly elevated':'Elevated — investigate', trend:bMortR<=0.1?'up':'down', status:mortalityStatus(bMortR), icon:'📉', context:'Health losses' },
  ] : [];

  const mgrKpis = [...layerKpis, ...broilerKpis];

  // ── Harvest sections for broiler pens ────────────────────────────────────────
  const harvestSections = [];
  broilerPens.forEach(pen => {
    (pen.sections || []).forEach(sec => {
      if (sec.metrics?.daysToHarvest != null && sec.metrics.daysToHarvest <= 7) {
        harvestSections.push({ penId: pen.id, penName: pen.name, sectionName: sec.name, daysToHarvest: sec.metrics.daysToHarvest, birds: sec.currentBirds });
      }
    });
  });
  if (harvestSections.length === 0) {
    broilerPens.filter(p => p.metrics.nearestHarvest != null && p.metrics.nearestHarvest <= 7).forEach(pen => {
      harvestSections.push({ penId: pen.id, penName: pen.name, sectionName: null, daysToHarvest: pen.metrics.nearestHarvest, birds: pen.totalBirds });
    });
  }

  // Wire harvest countdown onClick
  return (
    <div>
      <div style={{marginBottom:16}}>
        <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0}}>Good {greet}, {user.firstName} 👋</h1>
        <p style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
          Pen Manager · {pens.length} pen{pens.length!==1?'s':''} — click any pen to expand sections
        </p>
      </div>
      {/* ── Attention pill ── */}
      <div style={{marginBottom:16}}>
        <AttentionPill pens={pens} mode='sections' onNavigate={(penId, sectionName) => setNavTarget({ penId, sectionName })} />
      </div>
      {/* ── KPI cards ── */}
      {layerKpis.length > 0 && <OpKpiBlock title="Layer Production" opIcon="🥚" isLayer={true} cards={layerKpis} />}
      <div>
        {broilerKpis.length > 0 && <OpKpiBlock title="Broiler Production" opIcon="🍗" isLayer={false} cards={broilerKpis} />}

      </div>
      <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12,marginTop:8}}>My Pens</div>
      {pens.map(pen=><PenCard key={pen.id} pen={pen} autoOpen={navTarget?.penId===pen.id} highlightSection={navTarget?.penId===pen.id?navTarget.sectionName:null}/>)}
    </div>
  );
}

// ── Operation KPI block (Farm Manager / Admin) — cards always visible ────────
function OpKpiBlock({ title, opIcon, isLayer, cards }) {
  const crit = cards.filter(c=>c.status==='critical').length;
  const warn = cards.filter(c=>c.status==='warn').length;
  const accentColor = isLayer ? '#6c63ff' : '#ea580c';
  const iconBg      = isLayer ? '#eeecff' : '#fff7ed';
  const iconBorder  = isLayer ? '#c7d2fe' : '#fed7aa';
  return (
    <div style={{marginBottom:20}}>
      {/* Header row — flat, non-clickable, with divider line */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <div style={{width:30,height:30,borderRadius:8,background:iconBg,border:`1px solid ${iconBorder}`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:14}}>
          {opIcon}
        </div>
        <span style={{fontFamily:"'Poppins',sans-serif",fontSize:14,fontWeight:700,color:'var(--text-primary)',whiteSpace:'nowrap'}}>{title}</span>
        <div style={{display:'flex',gap:4,alignItems:'center',marginLeft:4}}>
          {crit>0&&<span style={{fontSize:10,fontWeight:700,background:'#fef2f2',color:'#ef4444',border:'1px solid #fecaca',borderRadius:5,padding:'2px 8px'}}>{crit} critical</span>}
          {warn>0&&<span style={{fontSize:10,fontWeight:700,background:'#fffbeb',color:'#d97706',border:'1px solid #fde68a',borderRadius:5,padding:'2px 8px'}}>{warn} warn</span>}
          {crit===0&&warn===0&&<span style={{fontSize:10,fontWeight:700,background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0',borderRadius:5,padding:'2px 8px'}}>All good</span>}
        </div>
        {/* Divider line fills remaining space */}
        <div style={{flex:1,height:1,background:'#e2e8f0',marginLeft:4}}/>
      </div>
      {/* Cards — always visible */}
      <div style={{display:'grid',gridTemplateColumns:`repeat(${cards.length},1fr)`,gap:10}}>
        {cards.map(c=><KpiCard key={c.label} label={c.label} value={c.value} sub={c.sub} delta={c.delta} trend={c.trend} status={c.status} icon={c.icon} context={c.context} onClick={c.onClick||null} compact />)}
      </div>
    </div>
  );
}

// ── Attention Pill — collapsed pill with popover, replaces AlertsPanel ────────
function AttentionPill({ pens, onNavigate, mode = 'pens' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Normalise alertLevel — API may return 'warn' or 'warning', both mean amber
  function normLevel(lvl) {
    if (!lvl) return 'ok';
    if (lvl === 'critical') return 'critical';
    if (lvl === 'warn' || lvl === 'warning') return 'warn';
    return 'ok';
  }

  // Build items — sections mode (Pen Manager) or pens mode (Farm Manager)
  const items = [];
  pens.forEach(pen => {
    const penLevel = normLevel(pen.alertLevel);
    if (penLevel === 'ok') return;

    if (mode === 'sections') {
      // Pen Manager: enumerate each flagged section individually.
      // A section is flagged if it has any flags at all (even 0% no-data ones —
      // the pen is flagged so something is wrong). Show section name always;
      // use the flag msg if meaningful, otherwise a clean generic message.
      const flaggedSections = (pen.sections || []).filter(sec =>
        (sec.flags || []).length > 0
      );
      if (flaggedSections.length > 0) {
        flaggedSections.forEach(sec => {
          const allFlags = sec.flags || [];
          // Prefer a meaningful (non-zero) message
          const meaningfulFlag = allFlags.find(f => f.msg && !/:\s*0(\.0)?%/.test(f.msg));
          const topFlag = meaningfulFlag || allFlags[0];
          const topLevel = allFlags.reduce((worst, f) => {
            const l = normLevel(f.type);
            return l === 'critical' ? 'critical' : worst === 'critical' ? 'critical' : l;
          }, 'warn');
          const topMsg = (meaningfulFlag?.msg) || (topLevel === 'critical' ? 'Critical — review this section' : 'Flagged for attention');
          items.push({ penId: pen.id, penName: pen.name, operationType: pen.operationType, sectionName: sec.name, level: topLevel, msg: topMsg });
        });
      } else {
        // Pen flagged but sections have no flags — show pen-level fallback
        items.push({ penId: pen.id, penName: pen.name, operationType: pen.operationType, sectionName: null, level: penLevel, msg: penLevel === 'critical' ? 'Critical issue — review this pen' : 'Flagged for attention — review this pen' });
      }
    } else {
      // Farm Manager: one row per pen
      const meaningfulMsgs = [];
      (pen.sections || []).forEach(sec => {
        (sec.flags || []).forEach(flag => {
          const isNoData = flag.msg && /:\s*0(\.0)?%/.test(flag.msg);
          if (!isNoData) meaningfulMsgs.push({ sectionName: sec.name, level: normLevel(flag.type), msg: flag.msg });
        });
      });
      (pen.flags || []).forEach(flag => {
        const isNoData = flag.msg && /:\s*0(\.0)?%/.test(flag.msg);
        if (!isNoData) meaningfulMsgs.push({ sectionName: null, level: normLevel(flag.type), msg: flag.msg });
      });
      if (meaningfulMsgs.length > 0) {
        meaningfulMsgs.forEach(f => {
          items.push({ penId: pen.id, penName: pen.name, operationType: pen.operationType, sectionName: f.sectionName, level: f.level, msg: f.msg });
        });
      } else {
        items.push({ penId: pen.id, penName: pen.name, operationType: pen.operationType, sectionName: null, level: penLevel, msg: penLevel === 'critical' ? 'Critical issue — review this pen' : 'Flagged for attention — review this pen' });
      }
    }
  });

  const critCount = items.filter(a => a.level === 'critical').length;
  const warnCount = items.filter(a => a.level === 'warn').length;
  const total     = items.length;
  const allOk     = total === 0;

  const accentColor  = allOk ? '#16a34a' : critCount > 0 ? '#ef4444' : '#d97706';
  const bannerBg     = allOk ? '#f0fdf4' : critCount > 0 ? '#fff8f8' : '#fffdf0';
  const bannerBorder = allOk ? '#bbf7d0' : critCount > 0 ? '#fca5a5' : '#fcd34d';

  return (
    <div ref={ref} style={{position:'relative', marginBottom: 16}}>

      {/* ── Banner button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          background: bannerBg,
          border: `1.5px solid ${bannerBorder}`,
          borderLeft: `5px solid ${accentColor}`,
          borderRadius: 10, padding: '12px 16px',
          cursor: 'pointer', textAlign: 'left', transition: 'box-shadow 0.15s',
          boxShadow: !allOk ? `0 2px 10px ${accentColor}20` : 'none',
        }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = `0 4px 14px ${accentColor}28`}
        onMouseLeave={e => e.currentTarget.style.boxShadow = !allOk ? `0 2px 10px ${accentColor}20` : 'none'}
      >
        {/* Icon bubble */}
        <div style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0,
          background: accentColor + '20', border: `1.5px solid ${accentColor}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>
          {allOk ? '✅' : critCount > 0 ? '🚨' : '⚠️'}
        </div>

        {/* Label + sub */}
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 13, fontWeight: 700, color: accentColor, lineHeight: 1.3}}>
            {allOk
              ? (mode === 'sections' ? 'All sections operating normally' : 'All pens operating normally')
              : mode === 'sections'
                ? `${total} section${total !== 1 ? 's' : ''} need${total === 1 ? 's' : ''} attention`
                : `${total} pen${total !== 1 ? 's' : ''} need${total === 1 ? 's' : ''} attention`}
          </div>
          <div style={{fontSize: 11, color: 'var(--text-muted)', marginTop: 2}}>
            {allOk
              ? (mode === 'sections' ? 'No section warnings or critical issues detected' : 'No warnings or critical issues detected')
              : [critCount > 0 && `${critCount} critical`, warnCount > 0 && `${warnCount} warning`].filter(Boolean).join(' · ') + ' — click to review'}
          </div>
        </div>

        {/* Count badges */}
        {critCount > 0 && (
          <span style={{background:'#fef2f2', color:'#ef4444', border:'1px solid #fecaca', borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 800, flexShrink: 0, whiteSpace:'nowrap'}}>
            {critCount} critical
          </span>
        )}
        {warnCount > 0 && (
          <span style={{background:'#fffbeb', color:'#d97706', border:'1px solid #fde68a', borderRadius: 99, padding: '3px 10px', fontSize: 11, fontWeight: 800, flexShrink: 0, whiteSpace:'nowrap'}}>
            {warnCount} warning{warnCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Pulsing live dot */}
        {!allOk && (
          <span style={{width: 10, height: 10, borderRadius: '50%', background: accentColor, flexShrink: 0, animation: 'pillPulse 1.8s ease-in-out infinite'}}/>
        )}

        {/* Chevron */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0, opacity: 0.8}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* ── Dropdown popover ── */}
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 6px)', left: 0, right: 0, zIndex: 300,
          background:'#fff', border:'1px solid #e2e8f0', borderRadius: 12,
          boxShadow:'0 12px 40px rgba(0,0,0,0.14)', overflow:'hidden',
          animation:'fadeSlideDown 0.15s ease both',
        }}>
          {/* Popover header */}
          <div style={{padding:'10px 16px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', gap:8}}>
            <span style={{fontSize:13, fontWeight:700, color:'var(--text-primary)', flex:1}}>
              {allOk ? (mode==='sections'?'✅ All sections OK':'✅ All pens OK') : mode==='sections' ? `${total} section${total!==1?'s':''} flagged` : `${total} pen${total!==1?'s':''} flagged`}
            </span>
            <button onClick={e=>{e.stopPropagation();setOpen(false);}} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:17,lineHeight:1,padding:'0 3px'}}>✕</button>
          </div>

          {allOk ? (
            <div style={{padding:'24px 16px', textAlign:'center', color:'#16a34a', fontSize:13, fontWeight:600}}>
              {mode==='sections' ? 'All sections are operating normally 🎉' : 'All pens are operating normally 🎉'}
            </div>
          ) : (
            <div style={{maxHeight:340, overflowY:'auto'}}>
              {items.map((item, i) => {
                const crit = item.level === 'critical';
                const rowColor = crit ? '#ef4444' : '#d97706';
                return (
                  <div
                    key={i}
                    onClick={() => { onNavigate?.(item.penId, item.sectionName, item.operationType); setOpen(false); }}
                    style={{
                      display:'flex', alignItems:'center', gap:12,
                      padding:'11px 16px', cursor:'pointer',
                      borderBottom: i < items.length - 1 ? '1px solid #f8fafc' : 'none',
                      background:'transparent', transition:'background 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = crit ? '#fef2f2' : '#fffbeb'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Status dot */}
                    <div style={{width:9, height:9, borderRadius:'50%', background:rowColor, flexShrink:0}}/>
                    {/* Text */}
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:13, fontWeight:600, color:'var(--text-primary)'}}>
                        {item.penName}
                        {item.sectionName && <span style={{fontWeight:400, color:'var(--text-muted)'}}> › {item.sectionName}</span>}
                      </div>
                      <div style={{fontSize:11, color:'var(--text-muted)', marginTop:2}}>{item.msg}</div>
                    </div>
                    {/* Level badge */}
                    <span style={{
                      background: crit ? '#fef2f2' : '#fffbeb',
                      color: rowColor, border:`1px solid ${crit?'#fecaca':'#fde68a'}`,
                      borderRadius:99, padding:'3px 9px', fontSize:10, fontWeight:800,
                      flexShrink:0, whiteSpace:'nowrap',
                    }}>{crit ? 'Critical' : 'Warning'}</span>
                    {/* Arrow */}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pillPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.55; transform: scale(0.85); }
        }
        @keyframes fadeSlideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes harvestBreath {
          0%, 100% { background: #fff7ed; border-color: #fb923c; box-shadow: 0 0 0 0 rgba(251,146,60,0); }
          50%       { background: #ffedd5; border-color: #f97316; box-shadow: 0 0 0 4px rgba(251,146,60,0.18); }
        }
      `}</style>
    </div>
  );
}

// ── Farm Manager+ dashboard ───────────────────────────────────────────────────
function ManagerDashboard({ pens, orgTotals, user }) {
  const router       = useRouter();
  const [navTarget, setNavTarget]       = useState(null); // { penId, sectionName, opType }

  const alerts    = pens.filter(p => p.alertLevel !== 'ok').length;
  const isFarmAdmin = user?.role === 'FARM_ADMIN';
  const roleLabel = { FARM_MANAGER:'Farm Manager', FARM_ADMIN:'Farm Admin', CHAIRPERSON:'Chairperson', SUPER_ADMIN:'Super Admin' }[user?.role] || user?.role || '';

  const layerPens   = pens.filter(p => p.operationType === 'LAYER');
  const broilerPens = pens.filter(p => p.operationType === 'BROILER');

  // Default to the tab that has pens; prefer LAYER
  const defaultTab  = layerPens.length ? 'LAYER' : 'BROILER';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // If navTarget specifies an opType, override the active tab
  const effectiveTab = navTarget?.opType || activeTab;

  // If one operation type is empty, lock to the one that exists
  const hasBoth = layerPens.length > 0 && broilerPens.length > 0;
  const visiblePens = effectiveTab === 'LAYER' ? layerPens : broilerPens;

  const tabs = [
    { key: 'LAYER',   icon: '🥚', label: 'Layer Operations',   count: layerPens.length },
    { key: 'BROILER', icon: '🍗', label: 'Broiler Operations', count: broilerPens.length },
  ].filter(t => t.count > 0);

  // ── Layer aggregates ─────────────────────────────────────────────────────────
  const lPens     = layerPens;
  const lBirds    = lPens.reduce((s,p)=>s+p.totalBirds,0);
  const lEggs     = lPens.reduce((s,p)=>s+(p.metrics.todayEggs||0),0);
  const lWeekEggs = lPens.reduce((s,p)=>s+(p.metrics.weekEggs||0),0);
  const lDead7    = lPens.reduce((s,p)=>s+(p.metrics.weekMortality||0),0);
  const lMortR    = lBirds>0 ? parseFloat(((lDead7/lBirds)*100).toFixed(2)) : 0;
  const lRates    = lPens.filter(p=>(p.metrics.avgLayingRate||0)>0);
  const lAvgRate  = lRates.length ? parseFloat((lRates.reduce((s,p)=>s+(p.metrics.avgLayingRate||0),0)/lRates.length).toFixed(1)) : 0;
  const lGAPens   = lPens.filter(p=>(p.metrics.todayGradeAPct||0)>0);
  const lGradeA   = lGAPens.length ? parseFloat((lGAPens.reduce((s,p)=>s+(p.metrics.todayGradeAPct||0),0)/lGAPens.length).toFixed(1)) : null;
  const lWaterPens  = lPens.filter(p => p.metrics.avgWaterLPB != null);
  const lAvgWater   = lWaterPens.length ? parseFloat((lWaterPens.reduce((s,p)=>s+(p.metrics.avgWaterLPB||0),0)/lWaterPens.length).toFixed(2)) : null;
  const lAvgAge     = lPens.length ? Math.round(lPens.reduce((s,p)=>s+(p.sections&&p.sections[0]?p.sections[0].ageInDays||180:180),0)/lPens.length) : 180;
  const lWaterBench = layerWaterBenchmark(lAvgAge);

  // ── Broiler aggregates ───────────────────────────────────────────────────────
  const bPens     = broilerPens;
  const bBirds    = bPens.reduce((s,p)=>s+p.totalBirds,0);
  const bDead7    = bPens.reduce((s,p)=>s+(p.metrics.weekMortality||0),0);
  const bMortR    = bBirds>0 ? parseFloat(((bDead7/bBirds)*100).toFixed(2)) : 0;
  const bWts      = bPens.filter(p=>p.metrics.avgWeightG);
  const bAvgWt    = bWts.length ? parseFloat((bWts.reduce((s,p)=>s+p.metrics.avgWeightG,0)/bWts.length).toFixed(0)) : null;
  const bFcrs     = bPens.filter(p=>p.metrics.avgFCR);
  const bAvgFCR   = bFcrs.length ? parseFloat((bFcrs.reduce((s,p)=>s+p.metrics.avgFCR,0)/bFcrs.length).toFixed(2)) : null;
  const bHarvest  = bPens.filter(p=>p.metrics.nearestHarvest!=null&&p.metrics.nearestHarvest<=7).length;
  const bUnis     = bPens.filter(p=>p.metrics.uniformityPct!=null);
  const bAvgUni   = bUnis.length ? parseFloat((bUnis.reduce((s,p)=>s+(p.metrics.uniformityPct||0),0)/bUnis.length).toFixed(1)) : null;
  const bWaterPens  = bPens.filter(p => p.metrics.avgWaterLPB != null);
  const bAvgWater   = bWaterPens.length ? parseFloat((bWaterPens.reduce((s,p)=>s+(p.metrics.avgWaterLPB||0),0)/bWaterPens.length).toFixed(2)) : null;
  const bAvgAge     = bPens.length ? Math.round(bPens.reduce((s,p)=>s+(p.sections&&p.sections[0]?p.sections[0].ageInDays||28:28),0)/bPens.length) : 28;
  const bWaterBench = broilerWaterBenchmark(bAvgAge);

  // ── Harvest-ready sections (broiler sections with daysToHarvest ≤ 7) ─────────
  const harvestSections = [];
  bPens.forEach(pen => {
    (pen.sections || []).forEach(sec => {
      if (sec.metrics?.daysToHarvest != null && sec.metrics.daysToHarvest <= 7) {
        harvestSections.push({ penId: pen.id, penName: pen.name, sectionName: sec.name, daysToHarvest: sec.metrics.daysToHarvest, birds: sec.currentBirds });
      }
    });
  });
  if (harvestSections.length === 0) {
    bPens.filter(p => p.metrics.nearestHarvest != null && p.metrics.nearestHarvest <= 7).forEach(pen => {
      harvestSections.push({ penId: pen.id, penName: pen.name, sectionName: null, daysToHarvest: pen.metrics.nearestHarvest, birds: pen.totalBirds });
    });
  }

  // ── Layer story: Total Birds → Lay Rate → Eggs Today → Grade A → Water → Mortality
  const layerCards = lPens.length ? [
    { label:'Total Birds',    value: fmt(lBirds),                         sub: lPens.length + ' pen' + (lPens.length!==1?'s':''),                                         delta:'',                                                                                            trend:'stable', status:'neutral',                  icon:'🐦', context:'Layer flock'    },
    { label:'Lay Rate',       value: lAvgRate>0 ? lAvgRate+'%' : '—',     sub: 'Target 82%',                                                                              delta:lAvgRate>0?(lAvgRate>=82?'+'+((lAvgRate-82).toFixed(1))+'% above target':((lAvgRate-82).toFixed(1))+'% below target'):'No data yet', trend:lAvgRate>=82?'up':lAvgRate>0?'down':'stable', status:lRates.length?layRateStatus(lAvgRate):'neutral', icon:'📊', context:'Performance' },
    { label:'Eggs Today',     value: fmt(lEggs),                           sub: '7d total ' + fmt(lWeekEggs),                                                              delta:lEggs>0?fmt(lEggs)+' collected today':'None recorded yet',                                       trend:'stable', status:lEggs>0?'good':'neutral', icon:'🥚', context:'Output'         },
    { label:'Grade A Rate',   value: lGradeA ? lGradeA+'%' : '—',         sub: 'Target ≥85%',                                                                        delta:lGradeA?(lGradeA>=85?'+'+((lGradeA-85).toFixed(1))+'% above target':((lGradeA-85).toFixed(1))+'% below target'):'No data yet', trend:lGradeA>=85?'up':'down', status:gradeAStatus(lGradeA), icon:'⭐', context:'Quality'       },
    { label:'Water Intake',   value: lAvgWater ? lAvgWater+' L/bird' : '—', sub: 'Benchmark '+lWaterBench+' L/bird · age '+lAvgAge+'d',                                  delta:waterDelta(lAvgWater, lWaterBench),                                                               trend:lAvgWater?(lAvgWater>=lWaterBench*0.85?'up':'down'):'stable', status:lAvgWater?waterStatus(lAvgWater,lWaterBench):'neutral', icon:'💧', context:'Health signal' },
    { label:'Mortality (7d)', value: fmt(lDead7),                          sub: lMortR+'% of flock',                                                                       delta:lMortR<=0.05?'Within normal range':lMortR<=0.15?'Slightly elevated':'Elevated — investigate', trend:lMortR<=0.05?'up':'down', status:mortalityStatus(lMortR), icon:'📉', context:'Health losses' },
    ...(isFarmAdmin ? [{ label:'Est. Revenue (Eggs)', value: lEggs>0?'₦'+Math.round(lEggs*280).toLocaleString():'—', sub:'Est. @ ₦280/egg', delta:'Projection', trend:'stable', status:'neutral', icon:'💰', context:'Financial' }] : []),
  ] : [];

  // ── Broiler story: Total Birds → Avg Weight → Harvest → FCR → Water → Mortality
  const broilerCards = bPens.length ? [
    { label:'Total Birds',       value: fmt(bBirds),                           sub: bPens.length+' pen'+(bPens.length!==1?'s':''),                                     delta:'',                                                                                              trend:'stable', status:'neutral',                   icon:'🐔', context:'Broiler flock' },
    { label:'Avg Live Weight',   value: bAvgWt ? (bAvgWt/1000).toFixed(2)+' kg' : '—', sub: 'Age ~'+bAvgAge+'d',                                                      delta:bAvgWt?bAvgWt+'g avg across pens':'No weigh-in yet',                                             trend:'stable', status:'neutral',                   icon:'⚖️', context:'Growth'        },
    { label:'Harvest Countdown', value: ''+(harvestSections.length||bHarvest),  sub: 'Sections due ≤ 7 days',                                                      delta:harvestSections.length>0?harvestSections.length+' section'+(harvestSections.length!==1?'s':'')+' ready':'None due this week', trend:'stable', status:harvestSections.length>0?'warn':'neutral', icon:'📅', context:'Planning', },
    { label:'Feed Conv. Ratio',  value: bAvgFCR ? ''+bAvgFCR : '—',             sub: 'Target ≤1.9',                                                               delta:bAvgFCR?(bAvgFCR<=1.9?'On target':(bAvgFCR-1.9).toFixed(2)+' above target'):'No data yet',      trend:bAvgFCR?(bAvgFCR<=1.9?'up':'down'):'stable', status:fcrStatus(bAvgFCR,true), icon:'🌾', context:'Efficiency'  },
    { label:'Water Intake',      value: bAvgWater ? bAvgWater+' L/bird' : '—',  sub: 'Benchmark '+bWaterBench+' L/bird · age '+bAvgAge+'d',                       delta:waterDelta(bAvgWater, bWaterBench),                                                               trend:bAvgWater?(bAvgWater>=bWaterBench*0.85?'up':'down'):'stable', status:bAvgWater?waterStatus(bAvgWater,bWaterBench):'neutral', icon:'💧', context:'Health signal' },
    { label:'Mortality (7d)',    value: fmt(bDead7),                             sub: bMortR+'% of flock',                                                               delta:bMortR<=0.1?'Within normal range':bMortR<=0.2?'Slightly elevated':'Elevated — investigate', trend:bMortR<=0.1?'up':'down', status:mortalityStatus(bMortR), icon:'📉', context:'Health losses' },
    ...(isFarmAdmin ? [{ label:'Est. Revenue (Harvest)', value: bHarvest>0?'₦'+Math.round(bBirds*0.1*2800).toLocaleString():'—', sub:'Est. harvest value', delta:'Projection', trend:'stable', status:'neutral', icon:'💰', context:'Financial' }] : []),
  ] : [];

  return (
    <div>
      {/* ── Page header with attention pill ── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
        <div>
          <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0}}>Farm Overview</h1>
          <p style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
            {roleLabel} · {pens.length} pen{pens.length!==1?'s':''} — click any pen to expand sections
          </p>
        </div>
      </div>
      {/* ── Attention pill — above KPI blocks ── */}
      <div style={{marginBottom:16}}>
        <AttentionPill pens={pens} onNavigate={(penId, sectionName, opType) => {
          setNavTarget({ penId, sectionName, opType });
        }} />
      </div>

      {/* ── KPI blocks — always visible, flat headers ── */}
      {layerCards.length>0   && <OpKpiBlock title="Layer Production"   opIcon="🥚" isLayer={true}  cards={layerCards} />}
      {/* Broiler block + harvest popover anchored below it */}
      <div>
        {broilerCards.length>0 && <OpKpiBlock title="Broiler Production" opIcon="🍗" isLayer={false} cards={broilerCards} />}

      </div>

      {/* ── Operation type tabs + pen list ── */}
      <div style={{marginTop:8}}>
        {hasBoth && (
          <div style={{display:'flex',gap:6,marginBottom:16,background:'var(--bg-elevated)',borderRadius:12,padding:4,border:'1px solid var(--border)',width:'fit-content'}}>
            {tabs.map(t => {
              const isActive = effectiveTab === t.key;
              const tabColor = t.key === 'LAYER' ? '#f59e0b' : '#3b82f6';
              return (
                <button key={t.key} style={{display:'inline-flex',alignItems:'center',gap:8,padding:'9px 20px',borderRadius:9,border:'none',background:isActive?'#fff':'transparent',boxShadow:isActive?'var(--shadow-sm,0 1px 4px rgba(0,0,0,0.08))':'none',cursor:'pointer',fontFamily:'inherit',fontWeight:isActive?700:500,fontSize:13,color:isActive?tabColor:'var(--text-muted)',transition:'all 0.15s'}} onClick={()=>{setActiveTab(t.key);setNavTarget(null);}}>
                  <span style={{fontSize:16}}>{t.icon}</span>
                  {t.label}
                  <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:10,background:isActive?`${tabColor}18`:'var(--bg-page)',color:isActive?tabColor:'var(--text-muted)',border:`1px solid ${isActive?tabColor+'30':'var(--border)'}`,minWidth:20,textAlign:'center'}}>{t.count}</span>
                </button>
              );
            })}
          </div>
        )}
        {!hasBoth && tabs.length > 0 && (
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
            <span style={{fontSize:16}}>{tabs[0].icon}</span>
            <span style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em'}}>
              {tabs[0].label} · {tabs[0].count} pen{tabs[0].count!==1?'s':''}
            </span>
          </div>
        )}
        {visiblePens.map(pen => <PenCard key={pen.id} pen={pen} autoOpen={navTarget?.penId===pen.id} highlightSection={navTarget?.penId===pen.id?navTarget.sectionName:null}/>)}
      </div>
    </div>
  );
}
// ── Main ──────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// ROLE DASHBOARDS — Store Manager, Store Clerk, Feed Mill Manager, QC Technician
// ═══════════════════════════════════════════════════════════════════════════════

function fmtKg(n)  { return n != null ? `${parseFloat(n).toLocaleString('en-NG', {maximumFractionDigits:1})} kg` : '—'; }
function fmtCur(n) { return n != null ? `₦${parseFloat(n).toLocaleString('en-NG', {minimumFractionDigits:0, maximumFractionDigits:0})}` : '—'; }
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day:'2-digit', month:'short', year:'numeric' });
}
function timeAgo(d) {
  if (!d) return '—';
  const diff = Math.floor((Date.now() - new Date(d)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function RoleBadge({ label, color='#6c63ff' }) {
  return (
    <span style={{ padding:'2px 10px', borderRadius:99, fontSize:11, fontWeight:700,
      background:`${color}18`, color, display:'inline-block' }}>{label}</span>
  );
}
function StatusBadge({ status }) {
  const map = {
    PASS:'#16a34a', FAIL:'#dc2626', PASSED:'#16a34a', FAILED:'#dc2626',
    PENDING:'#d97706', IN_PROGRESS:'#6c63ff', PLANNED:'#64748b', COMPLETED:'#16a34a',
  };
  const labels = {
    PASS:'Pass', FAIL:'Fail', PASSED:'Passed', FAILED:'Failed',
    PENDING:'Pending', IN_PROGRESS:'In Progress', PLANNED:'Planned', COMPLETED:'Completed',
  };
  const color = map[status] || '#64748b';
  return <RoleBadge label={labels[status] || status} color={color} />;
}
function RoleKpiTile({ icon, label, value, sub, color='#6c63ff', warn }) {
  return (
    <div className="card" style={{ padding:'18px 20px', borderTop:`3px solid ${warn?'#ef4444':color}` }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
        <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--text-muted)' }}>{label}</span>
        <div style={{ width:34, height:34, borderRadius:9, background:`${warn?'#ef4444':color}18`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>{icon}</div>
      </div>
      <div style={{ fontSize:26, fontWeight:800, color:warn?'#ef4444':'var(--text-primary)', lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4 }}>{sub}</div>}
    </div>
  );
}
function RoleSectionHeader({ title, sub }) {
  return (
    <div style={{ margin:'24px 0 10px' }}>
      <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)' }}>{title}</div>
      {sub && <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}
function RoleEmptyCard({ icon='📭', msg }) {
  return (
    <div style={{ padding:'28px 20px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
      <div style={{ fontSize:26, marginBottom:8 }}>{icon}</div>{msg}
    </div>
  );
}

// ── Store Manager / Store Clerk ───────────────────────────────────────────────
function StoreDashboard({ data, isClerk }) {
  const {
    inventory = { items:[], lowStock:[], lowStockCount:0, totalStockKg:0, stockValue:0 },
    receipts = [], issuances = [], consumption = { weekTotalKg:0, trend:[] },
    pendingVerifications = 0,
  } = data || {};
  return (
    <div style={{ padding:'24px 28px', maxWidth:1400 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(165px,1fr))', gap:14, marginBottom:4 }}>
        <RoleKpiTile icon="📦" label="Feed Lines"       value={inventory.items.length}               sub="Active stock lines"          color="#6c63ff" />
        <RoleKpiTile icon="⚠️" label="Low Stock"        value={inventory.lowStockCount}              sub="At or below reorder"         color="#ef4444" warn={inventory.lowStockCount>0} />
        <RoleKpiTile icon="🌾" label="Total Stock"      value={fmtKg(inventory.totalStockKg)}        sub="Across all stores"           color="#0ea5e9" />
        <RoleKpiTile icon="💰" label="Stock Value"      value={fmtCur(inventory.stockValue)}         sub="Current cost basis"          color="#10b981" />
        <RoleKpiTile icon="🚚" label="7d Consumption"   value={fmtKg(consumption.weekTotalKg)}       sub="All pens this week"          color="#f59e0b" />
        {!isClerk && <RoleKpiTile icon="✅" label="Pending Verif." value={pendingVerifications} sub="Store records to check" color="#9333ea" warn={pendingVerifications>0} />}
      </div>

      {inventory.lowStockCount > 0 && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'12px 16px', marginTop:16, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:20 }}>🚨</span>
          <div>
            <div style={{ fontWeight:700, color:'#dc2626', fontSize:13 }}>{inventory.lowStockCount} feed line{inventory.lowStockCount>1?'s':''} below reorder level</div>
            <div style={{ fontSize:12, color:'#ef4444', marginTop:2 }}>{inventory.lowStock.map(i=>i.feedType).join(', ')}</div>
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:20 }}>
        {/* Inventory table */}
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border-card)', fontWeight:700, fontSize:13 }}>📦 Feed Inventory</div>
          {inventory.items.length===0 ? <RoleEmptyCard msg="No inventory items" /> : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg-secondary)' }}>
                  {['Feed Type','Stock (kg)','Reorder (kg)','Status'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inventory.items.slice(0,8).map(item => {
                  const isLow = parseFloat(item.currentStockKg) <= parseFloat(item.reorderLevelKg);
                  return (
                    <tr key={item.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                      <td style={{ padding:'9px 12px', fontWeight:600 }}>{item.feedType}</td>
                      <td style={{ padding:'9px 12px', color:isLow?'#dc2626':'var(--text-primary)', fontWeight:isLow?700:400 }}>{parseFloat(item.currentStockKg).toFixed(1)}</td>
                      <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{parseFloat(item.reorderLevelKg).toFixed(1)}</td>
                      <td style={{ padding:'9px 12px' }}><RoleBadge label={isLow?'Low Stock':'OK'} color={isLow?'#ef4444':'#16a34a'} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 7-day consumption chart */}
        <div className="card" style={{ padding:'14px 18px' }}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:14 }}>📊 7-Day Consumption (kg)</div>
          {consumption.trend.length===0 ? <RoleEmptyCard icon="📈" msg="No consumption data this week" /> : (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={consumption.trend} margin={{ top:4, right:8, left:-10, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tickFormatter={d=>new Date(d).toLocaleDateString('en-NG',{day:'2-digit',month:'short'})} tick={{ fontSize:10 }} />
                <YAxis tick={{ fontSize:10 }} />
                <Tooltip formatter={v=>[`${parseFloat(v).toFixed(1)} kg`,'Consumed']} contentStyle={{ fontSize:12, borderRadius:8 }} />
                <Bar dataKey="totalKg" fill="#6c63ff" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <RoleSectionHeader title="Recent Receipts (GRNs)" sub="Last 30 days" />
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        {receipts.length===0 ? <RoleEmptyCard msg="No receipts in the last 30 days" /> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'var(--bg-secondary)' }}>
                {['Date','Feed Type','Supplier','Qty (kg)','QC Status','Received By'].map(h=>(
                  <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {receipts.map(r=>(
                <tr key={r.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                  <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{fmtDate(r.receiptDate)}</td>
                  <td style={{ padding:'9px 12px', fontWeight:600 }}>{r.feedInventory?.feedType||'—'}</td>
                  <td style={{ padding:'9px 12px' }}>{r.supplier?.name||'—'}</td>
                  <td style={{ padding:'9px 12px' }}>{r.quantityReceived ? parseFloat(r.quantityReceived).toFixed(1) : '—'}</td>
                  <td style={{ padding:'9px 12px' }}><StatusBadge status={r.qualityStatus||'PENDING'} /></td>
                  <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{r.receivedBy?`${r.receivedBy.firstName} ${r.receivedBy.lastName}`:'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {issuances.length>0 && (
        <>
          <RoleSectionHeader title="Recent Issuances" sub="Last 7 days" />
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg-secondary)' }}>
                  {['Date','Feed Type','Qty (kg)','Purpose','Issued By'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issuances.map(r=>(
                  <tr key={r.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{fmtDate(r.issuanceDate)}</td>
                    <td style={{ padding:'9px 12px', fontWeight:600 }}>{r.feedInventory?.feedType||'—'}</td>
                    <td style={{ padding:'9px 12px' }}>{r.quantityIssued ? parseFloat(r.quantityIssued).toFixed(1) : '—'}</td>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{r.purpose||'—'}</td>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{r.issuedBy?`${r.issuedBy.firstName} ${r.issuedBy.lastName}`:'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Feed Mill Manager ─────────────────────────────────────────────────────────
function FeedMillDashboard({ data }) {
  const {
    inventory = { items:[], lowStock:[], lowStockCount:0 },
    consumption = { weekTotalKg:0, trend:[] },
    mill = { batches:[], stats:{ planned:0, inProgress:0, completed7d:0 } },
    qc   = { pending:[], recent:[], passRate7d:null },
  } = data || {};
  return (
    <div style={{ padding:'24px 28px', maxWidth:1400 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:14, marginBottom:4 }}>
        <RoleKpiTile icon="🏭" label="In Progress"      value={mill.stats.inProgress}   sub="Currently producing"    color="#6c63ff" />
        <RoleKpiTile icon="📋" label="Planned"          value={mill.stats.planned}       sub="Queued batches"         color="#0ea5e9" />
        <RoleKpiTile icon="✅" label="Completed (7d)"   value={mill.stats.completed7d}   sub="Finished this week"     color="#10b981" />
        <RoleKpiTile icon="🔬" label="QC Pending"       value={qc.pending.length}        sub="Tests awaiting results" color="#f59e0b" warn={qc.pending.length>0} />
        <RoleKpiTile icon="📊" label="Pass Rate (7d)"   value={qc.passRate7d!=null?`${qc.passRate7d}%`:'—'} sub="This week" color="#16a34a" />
        <RoleKpiTile icon="⚠️" label="Low Stock Lines"  value={inventory.lowStockCount}  sub="At reorder level"       color="#ef4444" warn={inventory.lowStockCount>0} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:20 }}>
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border-card)', fontWeight:700, fontSize:13 }}>🏭 Production Batches</div>
          {mill.batches.length===0 ? <RoleEmptyCard msg="No recent batches" /> : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg-secondary)' }}>
                  {['Batch','Formula','Planned kg','Status'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mill.batches.map(b=>(
                  <tr key={b.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                    <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, fontWeight:600 }}>{b.batchCode}</td>
                    <td style={{ padding:'9px 12px' }}>{b.formulaName||'—'}</td>
                    <td style={{ padding:'9px 12px' }}>{b.plannedQtyKg?parseFloat(b.plannedQtyKg).toFixed(0):'—'}</td>
                    <td style={{ padding:'9px 12px' }}><StatusBadge status={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border-card)', fontWeight:700, fontSize:13 }}>🔬 QC Tests Pending</div>
          {qc.pending.length===0 ? <RoleEmptyCard icon="✅" msg="No pending QC tests" /> : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg-secondary)' }}>
                  {['Batch','Test Type','Logged'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {qc.pending.map(t=>(
                  <tr key={t.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                    <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11 }}>{t.feedMillBatch?.batchCode||'—'}</td>
                    <td style={{ padding:'9px 12px', fontWeight:600 }}>{t.testType}</td>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <RoleSectionHeader title="7-Day Feed Consumption Trend" sub="Total kg issued to pens" />
      <div className="card" style={{ padding:'14px 18px' }}>
        {consumption.trend.length===0 ? <RoleEmptyCard icon="📈" msg="No data this week" /> : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={consumption.trend} margin={{ top:4, right:8, left:-10, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tickFormatter={d=>new Date(d).toLocaleDateString('en-NG',{day:'2-digit',month:'short'})} tick={{ fontSize:10 }} />
              <YAxis tick={{ fontSize:10 }} />
              <Tooltip formatter={v=>[`${parseFloat(v).toFixed(1)} kg`,'Consumed']} contentStyle={{ fontSize:12, borderRadius:8 }} />
              <Bar dataKey="totalKg" fill="#6c63ff" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {qc.recent.length>0 && (
        <>
          <RoleSectionHeader title="Recent QC Results" sub="Last 7 days" />
          <div className="card" style={{ padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg-secondary)' }}>
                  {['Batch','Test Type','Result','Date'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {qc.recent.map(t=>(
                  <tr key={t.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                    <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11 }}>{t.feedMillBatch?.batchCode||'—'}</td>
                    <td style={{ padding:'9px 12px', fontWeight:600 }}>{t.testType}</td>
                    <td style={{ padding:'9px 12px' }}><StatusBadge status={t.result} /></td>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── QC Technician ─────────────────────────────────────────────────────────────
function QCDashboard({ data }) {
  const {
    qc   = { pending:[], recent:[], passRate7d:null },
    mill = { batches:[], stats:{ planned:0, inProgress:0, completed7d:0 } },
  } = data || {};
  const passCount = qc.recent.filter(t=>t.result==='PASS').length;
  const failCount = qc.recent.filter(t=>t.result==='FAIL').length;
  return (
    <div style={{ padding:'24px 28px', maxWidth:1400 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:14, marginBottom:4 }}>
        <RoleKpiTile icon="⏳" label="Tests Pending"    value={qc.pending.length}  sub="Awaiting your results"  color="#f59e0b" warn={qc.pending.length>0} />
        <RoleKpiTile icon="✅" label="Passed (7d)"      value={passCount}           sub="This week"              color="#16a34a" />
        <RoleKpiTile icon="❌" label="Failed (7d)"      value={failCount}           sub="Requires follow-up"     color="#ef4444" warn={failCount>0} />
        <RoleKpiTile icon="📊" label="Pass Rate (7d)"  value={qc.passRate7d!=null?`${qc.passRate7d}%`:'—'} sub="7-day average" color="#6c63ff" />
        <RoleKpiTile icon="🏭" label="Active Batches"  value={mill.stats.inProgress+mill.stats.planned} sub="Planned + in progress" color="#0ea5e9" />
      </div>

      {qc.pending.length>0 && (
        <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'12px 16px', marginTop:16, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:20 }}>🔬</span>
          <div>
            <div style={{ fontWeight:700, color:'#92400e', fontSize:13 }}>{qc.pending.length} test{qc.pending.length>1?'s':''} awaiting your results</div>
            <div style={{ fontSize:12, color:'#b45309', marginTop:2 }}>Go to Feed → Feed Mill to log results</div>
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:20 }}>
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border-card)', fontWeight:700, fontSize:13 }}>⏳ Tests Pending</div>
          {qc.pending.length===0 ? <RoleEmptyCard icon="✅" msg="All tests completed — great work!" /> : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg-secondary)' }}>
                  {['Batch','Formula','Test Type','Logged'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {qc.pending.map(t=>(
                  <tr key={t.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                    <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, fontWeight:600 }}>{t.feedMillBatch?.batchCode||'—'}</td>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{t.feedMillBatch?.formulaName||'—'}</td>
                    <td style={{ padding:'9px 12px', fontWeight:600 }}>{t.testType}</td>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border-card)', fontWeight:700, fontSize:13 }}>📋 Recent Results (7d)</div>
          {qc.recent.length===0 ? <RoleEmptyCard msg="No results logged this week" /> : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--bg-secondary)' }}>
                  {['Batch','Test','Result','When'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {qc.recent.map(t=>(
                  <tr key={t.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                    <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11 }}>{t.feedMillBatch?.batchCode||'—'}</td>
                    <td style={{ padding:'9px 12px', fontWeight:600 }}>{t.testType}</td>
                    <td style={{ padding:'9px 12px' }}><StatusBadge status={t.result} /></td>
                    <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{timeAgo(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <RoleSectionHeader title="Production Batches" sub="Recent batches for reference" />
      <div className="card" style={{ padding:0, overflow:'hidden' }}>
        {mill.batches.length===0 ? <RoleEmptyCard msg="No recent batches" /> : (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'var(--bg-secondary)' }}>
                {['Batch Code','Formula','Planned kg','Actual kg','Status','Date'].map(h=>(
                  <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mill.batches.map(b=>(
                <tr key={b.id} style={{ borderBottom:'1px solid var(--border-card)' }}>
                  <td style={{ padding:'9px 12px', fontFamily:'monospace', fontSize:11, fontWeight:600 }}>{b.batchCode}</td>
                  <td style={{ padding:'9px 12px' }}>{b.formulaName||'—'}</td>
                  <td style={{ padding:'9px 12px' }}>{b.plannedQtyKg?parseFloat(b.plannedQtyKg).toFixed(0):'—'}</td>
                  <td style={{ padding:'9px 12px' }}>{b.actualQtyKg?parseFloat(b.actualQtyKg).toFixed(0):'—'}</td>
                  <td style={{ padding:'9px 12px' }}><StatusBadge status={b.status} /></td>
                  <td style={{ padding:'9px 12px', color:'var(--text-muted)' }}>{fmtDate(b.productionDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── IC Officer Dashboard ──────────────────────────────────────────────────────
function IcDashboard({ user, apiFetch }) {
  const [invSummary, setInvSummary] = useState(null);
  const [recentInvs, setRecentInvs] = useState([]);
  const [auditMeta,  setAuditMeta]  = useState(null);
  const [loading,    setLoading]    = useState(true);

  const timeAgo = d => {
    const mins = Math.floor((Date.now() - new Date(d)) / 60000);
    if (mins < 60)   return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [invRes, auditRes] = await Promise.all([
          apiFetch('/api/investigations?limit=5'),
          apiFetch('/api/audit?limit=1'),
        ]);
        if (invRes.ok)   { const d = await invRes.json();   setInvSummary(d.summary || {}); setRecentInvs(d.investigations || []); }
        if (auditRes.ok) { const d = await auditRes.json(); setAuditMeta(d.meta); }
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [apiFetch]);

  const INV_STATUS_META = {
    OPEN:         { label: 'Open',         color: '#d97706', bg: '#fffbeb', icon: '🔓' },
    UNDER_REVIEW: { label: 'Under Review', color: '#6c63ff', bg: '#f5f3ff', icon: '🔍' },
    ESCALATED:    { label: 'Escalated',    color: '#9333ea', bg: '#fdf4ff', icon: '🔺' },
    CLOSED:       { label: 'Closed',       color: '#16a34a', bg: '#f0fdf4', icon: '✓'  },
  };

  const openCount      = invSummary?.OPEN         || 0;
  const reviewCount    = invSummary?.UNDER_REVIEW  || 0;
  const escalatedCount = invSummary?.ESCALATED     || 0;
  const closedCount    = invSummary?.CLOSED        || 0;
  const activeCount    = openCount + reviewCount + escalatedCount;

  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {[1,2,3].map(i=><div key={i} className="card" style={{height:80,opacity:.4,animation:'pulse 1.5s ease-in-out infinite'}}/>)}
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
            <span style={{fontSize:26}}>🛡️</span>
            <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:800,color:'var(--text-primary)',margin:0}}>Internal Control</h1>
          </div>
          <p style={{fontSize:13,color:'var(--text-muted)',margin:0}}>Welcome back, {user?.firstName}. Here's your audit overview.</p>
        </div>
        {escalatedCount > 0 && (
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 16px',background:'#fdf4ff',border:'1px solid #e9d5ff',borderRadius:10}}>
            <span style={{fontSize:16}}>🔺</span>
            <span style={{fontSize:13,fontWeight:700,color:'#9333ea'}}>{escalatedCount} escalated to Chairperson</span>
          </div>
        )}
      </div>
      {/* KPI row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:14}}>
        {[
          { icon:'🔓', label:'Open',              value:openCount,      color:'#d97706', urgent:openCount>5 },
          { icon:'🔍', label:'Under Review',       value:reviewCount,    color:'#6c63ff', urgent:false },
          { icon:'🔺', label:'Escalated',          value:escalatedCount, color:'#9333ea', urgent:escalatedCount>0 },
          { icon:'✓',  label:'Closed',             value:closedCount,    color:'#16a34a', urgent:false },
          { icon:'📋', label:'Total Audit Events', value: auditMeta ? auditMeta.actionCounts.reduce((s,a)=>s+a.count,0).toLocaleString() : '—', color:'var(--purple)', urgent:false },
        ].map(k=>(
          <div key={k.label} style={{background:k.urgent?'#fef2f2':'#fff',borderRadius:12,padding:'18px 20px',border:`1px solid ${k.urgent?'#fecaca':'var(--border-card)'}`,boxShadow:'0 1px 4px rgba(0,0,0,0.04)',display:'flex',alignItems:'flex-start',gap:14}}>
            <div style={{width:42,height:42,borderRadius:10,flexShrink:0,background:`${k.urgent?'#ef4444':k.color}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>{k.icon}</div>
            <div>
              <div style={{fontSize:22,fontWeight:800,color:k.urgent?'#dc2626':'var(--text-primary)',lineHeight:1.1}}>{k.value}</div>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text-secondary)',marginTop:2}}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>
      {/* Active investigations banner */}
      {activeCount > 0 && (
        <div style={{padding:'14px 18px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:12,display:'flex',alignItems:'center',gap:14}}>
          <span style={{fontSize:24}}>⚠️</span>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:700,color:'#92400e'}}>{activeCount} active investigation{activeCount!==1?'s':''} require attention</div>
            <div style={{fontSize:12,color:'#d97706',marginTop:2}}>
              {openCount>0&&`${openCount} open`}{openCount>0&&reviewCount>0?' · ':''}{reviewCount>0&&`${reviewCount} under review`}{escalatedCount>0&&` · ${escalatedCount} escalated`}
            </div>
          </div>
          <a href="/audit" style={{padding:'8px 16px',borderRadius:8,border:'1px solid #fde68a',background:'#fff',color:'#d97706',fontSize:12,fontWeight:700,textDecoration:'none',whiteSpace:'nowrap'}}>View Investigations →</a>
        </div>
      )}
      {/* Two-column section */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        {/* Recent investigations */}
        <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',boxShadow:'0 1px 4px rgba(0,0,0,0.04)',overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:13,fontWeight:800,color:'var(--text-primary)',fontFamily:"'Poppins',sans-serif"}}>🚩 Recent Investigations</div>
            <a href="/audit" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none'}}>View all →</a>
          </div>
          {recentInvs.length===0 ? (
            <div style={{padding:'40px 24px',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>
              <div style={{fontSize:32,marginBottom:8}}>🎉</div>No open investigations
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column'}}>
              {recentInvs.map((inv,idx)=>{
                const sm=INV_STATUS_META[inv.status]||INV_STATUS_META.OPEN;
                return (
                  <div key={inv.id} style={{padding:'14px 20px',borderBottom:idx<recentInvs.length-1?'1px solid var(--border-card)':'none',display:'flex',alignItems:'flex-start',gap:12}}>
                    <div style={{width:32,height:32,borderRadius:8,flexShrink:0,background:sm.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15}}>{sm.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:'var(--text-primary)',marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inv.referenceType}</div>
                      <div style={{fontSize:11,color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{inv.flagReason}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)',marginTop:2}}>{timeAgo(inv.createdAt)}</div>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:99,background:sm.bg,color:sm.color,whiteSpace:'nowrap',flexShrink:0}}>{sm.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/* Audit activity breakdown */}
        <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',boxShadow:'0 1px 4px rgba(0,0,0,0.04)',overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:13,fontWeight:800,color:'var(--text-primary)',fontFamily:"'Poppins',sans-serif"}}>📋 Audit Activity Breakdown</div>
            <a href="/audit" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none'}}>Open log →</a>
          </div>
          {!auditMeta ? (
            <div style={{padding:'40px 24px',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>No audit data</div>
          ) : (
            <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:10}}>
              {auditMeta.actionCounts.slice(0,6).map(({action,count})=>{
                const maxCount=Math.max(...auditMeta.actionCounts.map(a=>a.count));
                const pct=maxCount>0?(count/maxCount)*100:0;
                const colors={CREATE:'#16a34a',UPDATE:'#f59e0b',DELETE:'#ef4444',LOGIN:'#3b82f6',APPROVE:'#8b5cf6',REJECT:'#ef4444',ROLE_CHANGE:'#ec4899'};
                const color=colors[action]||'#64748b';
                return (
                  <div key={action}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                      <span style={{fontSize:11,fontWeight:700,color:'var(--text-secondary)'}}>{action}</span>
                      <span style={{fontSize:11,fontWeight:700,color}}>{count.toLocaleString()}</span>
                    </div>
                    <div style={{height:6,background:'var(--bg-elevated)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:3,transition:'width 0.5s ease'}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* Quick access links */}
      <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',padding:20,boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
        <div style={{fontSize:13,fontWeight:800,color:'var(--text-primary)',fontFamily:"'Poppins',sans-serif",marginBottom:14}}>🔗 Quick Actions</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10}}>
          {[
            {href:'/audit',        icon:'📋', label:'Audit Log',      sub:'Browse all events'},
            {href:'/audit',        icon:'🚩', label:'Investigations', sub:'Manage flags'},
            {href:'/verification', icon:'✅', label:'Verifications',  sub:'View verified records'},
            {href:'/feed',         icon:'🌾', label:'Feed Records',   sub:'Receipts & issuances'},
            {href:'/farm',         icon:'🐦', label:'Flock Records',  sub:'Production & health'},
          ].map(link=>(
            <a key={link.label} href={link.href}
              style={{display:'flex',flexDirection:'column',gap:4,padding:'14px 16px',borderRadius:10,border:'1px solid var(--border-card)',textDecoration:'none',background:'#fafafa'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--purple)';e.currentTarget.style.background='#f5f3ff';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border-card)';e.currentTarget.style.background='#fafafa';}}>
              <span style={{fontSize:20}}>{link.icon}</span>
              <span style={{fontSize:12,fontWeight:700,color:'var(--text-primary)'}}>{link.label}</span>
              <span style={{fontSize:11,color:'var(--text-muted)'}}>{link.sub}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

// ── Accountant Dashboard ──────────────────────────────────────────────────────
function AccountantDashboard({ user, apiFetch }) {
  const [arSummary,  setArSummary]  = useState(null);
  const [apSummary,  setApSummary]  = useState(null);
  const [arInvoices, setArInvoices] = useState([]);
  const [apInvoices, setApInvoices] = useState([]);
  const [pl,         setPl]         = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  function fmtAmt(n, currency = 'NGN') {
    const num = parseFloat(n || 0);
    if (num >= 1_000_000) return `${currency} ${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000)     return `${currency} ${(num / 1_000).toFixed(0)}K`;
    return `${currency} ${num.toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;
  }

  function fmtFull(n, currency = 'NGN') {
    return `${currency} ${parseFloat(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function daysUntil(d) {
    if (!d) return null;
    return Math.floor((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
  }

  const STATUS_META = {
    DRAFT:          { bg: '#f3f4f6', color: '#6b7280', label: 'Draft' },
    SENT:           { bg: '#eff6ff', color: '#3b82f6', label: 'Sent' },
    APPROVED:       { bg: '#f0fdf4', color: '#16a34a', label: 'Approved' },
    PARTIALLY_PAID: { bg: '#faf5ff', color: '#9333ea', label: 'Part. Paid' },
    PAID:           { bg: '#f0fdf4', color: '#16a34a', label: 'Paid' },
    OVERDUE:        { bg: '#fef2f2', color: '#dc2626', label: 'Overdue' },
    VOID:           { bg: '#f9fafb', color: '#9ca3af', label: 'Void' },
    DISPUTED:       { bg: '#fffbeb', color: '#d97706', label: 'Disputed' },
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const now  = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const to   = now.toISOString().split('T')[0];

      const [arRes, apRes, plRes] = await Promise.all([
        apiFetch('/api/finance/sales-invoices?limit=50'),
        apiFetch('/api/finance/supplier-invoices?limit=50'),
        apiFetch(`/api/finance/pl?from=${from}&to=${to}`),
      ]);

      const [arData, apData, plData] = await Promise.all([
        arRes.json(), apRes.json(), plRes.json(),
      ]);

      const arAll     = arData.invoices || [];
      const arUnpaid  = arAll.filter(i => ['SENT','OVERDUE','PARTIALLY_PAID'].includes(i.status));
      const arOverdue = arAll.filter(i => i.status === 'OVERDUE');
      setArSummary({
        outstanding: arUnpaid.reduce((s, i) => s + parseFloat(i.totalAmount) - parseFloat(i.amountPaid||0), 0),
        overdueAmt:  arOverdue.reduce((s, i) => s + parseFloat(i.totalAmount) - parseFloat(i.amountPaid||0), 0),
        overdueCount: arOverdue.length,
      });
      setArInvoices(arUnpaid.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 8));

      const apAll     = apData.invoices || [];
      const apUnpaid  = apAll.filter(i => ['APPROVED','OVERDUE','PARTIALLY_PAID'].includes(i.status));
      const apOverdue = apAll.filter(i => i.status === 'OVERDUE');
      setApSummary({
        outstanding: apUnpaid.reduce((s, i) => s + parseFloat(i.totalAmount) - parseFloat(i.amountPaid||0), 0),
        overdueAmt:  apOverdue.reduce((s, i) => s + parseFloat(i.totalAmount) - parseFloat(i.amountPaid||0), 0),
        overdueCount: apOverdue.length,
      });
      setApInvoices(apUnpaid.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 8));

      setPl(plData.summary || null);
    } catch (e) {
      setError('Failed to load dashboard data');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const now      = new Date();
  const monthStr = now.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

  function KpiCard({ label, value, sub, icon, color, alert }) {
    return (
      <div style={{ background:'#fff', border:`1px solid ${alert?'#fecaca':'#e5e7eb'}`, borderRadius:14, padding:'18px 20px', position:'relative', overflow:'hidden' }}>
        {alert && <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'#dc2626', borderRadius:'14px 14px 0 0' }} />}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)' }}>{label}</span>
          <div style={{ width:34, height:34, borderRadius:9, background:`${color}18`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:17 }}>{icon}</div>
        </div>
        {loading
          ? <div style={{ height:30, background:'#f3f4f6', borderRadius:6, marginBottom:8 }} />
          : <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color, marginBottom:4, lineHeight:1.2 }}>{value}</div>
        }
        {sub && <div style={{ fontSize:11, color:'var(--text-muted)' }}>{sub}</div>}
      </div>
    );
  }

  function StatusPill({ status }) {
    const s = STATUS_META[status] || { bg:'#f3f4f6', color:'#6b7280', label: status };
    return <span style={{ background:s.bg, color:s.color, fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:20, whiteSpace:'nowrap' }}>{s.label}</span>;
  }

  function InvoiceTable({ invoices, type, total, totalColor }) {
    if (loading) return (
      <div style={{ padding:16 }}>
        {[1,2,3].map(i => <div key={i} style={{ height:36, background:'#f3f4f6', borderRadius:6, marginBottom:8 }} />)}
      </div>
    );
    if (invoices.length === 0) return (
      <div style={{ padding:'32px 16px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
        ✅ All clear
      </div>
    );
    return (
      <>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#f9fafb' }}>
                {['Invoice','Party','Balance','Due','Status'].map(h => (
                  <th key={h} style={{ padding:'8px 12px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-muted)', textAlign:'left', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const balance   = parseFloat(inv.totalAmount) - parseFloat(inv.amountPaid||0);
                const days      = daysUntil(inv.dueDate);
                const isOverdue = days !== null && days < 0;
                const isDueSoon = days !== null && days >= 0 && days <= 3;
                return (
                  <tr key={inv.id} style={{ borderBottom:'1px solid #f3f4f6', cursor:'pointer' }}
                    onClick={() => window.location.href='/finance'}
                    onMouseEnter={e => e.currentTarget.style.background='#f9fafb'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <td style={{ padding:'10px 12px', fontSize:12, fontWeight:700, color:'#6c63ff', whiteSpace:'nowrap' }}>{inv.invoiceNumber}</td>
                    <td style={{ padding:'10px 12px', fontSize:12, color:'#374151', maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {type==='ar' ? inv.customer?.name : inv.supplier?.name}
                    </td>
                    <td style={{ padding:'10px 12px', fontSize:12, color:'#374151', whiteSpace:'nowrap' }}>{fmtFull(balance, inv.currency)}</td>
                    <td style={{ padding:'10px 12px', fontSize:11, fontWeight:700, whiteSpace:'nowrap', color: isOverdue?'#dc2626': isDueSoon?'#d97706':'#6b7280' }}>
                      {isOverdue ? `${Math.abs(days)}d overdue` : days===0 ? 'Due today' : isDueSoon ? `Due in ${days}d` : fmtDate(inv.dueDate)}
                    </td>
                    <td style={{ padding:'10px 12px' }}><StatusPill status={inv.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'10px 16px', borderTop:'1px solid #f3f4f6', display:'flex', justifyContent:'space-between', fontSize:12 }}>
          <span style={{ color:'var(--text-muted)' }}>Total Outstanding</span>
          <span style={{ fontWeight:700, color:totalColor }}>{fmtFull(total)}</span>
        </div>
      </>
    );
  }

  return (
    <div style={{ padding:'24px 28px', maxWidth:1200, margin:'0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28 }}>
        <div>
          <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:24, fontWeight:700, margin:'0 0 4px', color:'#111827' }}>
            Finance Overview
          </h1>
          <p style={{ fontSize:13, color:'var(--text-muted)', margin:0 }}>
            {now.toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long', year:'numeric' })} · {monthStr} P&L
          </p>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <a href="/finance" style={{ background:'#6c63ff', color:'#fff', padding:'9px 18px', borderRadius:9, fontSize:13, fontWeight:600, textDecoration:'none' }}>
            💰 Open Finance
          </a>
          <button onClick={load} style={{ background:'#fff', border:'1px solid #e5e7eb', color:'#374151', padding:'9px 14px', borderRadius:9, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:10, padding:'12px 16px', marginBottom:20, color:'#dc2626', fontSize:13 }}>
          ⚠ {error}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:28 }}>
        <KpiCard label="Revenue MTD"     value={fmtAmt(pl?.totalRevenue)}    sub={`${pl?.revenueInvoiceCount||0} invoices`}         icon="📈" color="#6c63ff" />
        <KpiCard label="Outstanding AR"  value={fmtAmt(arSummary?.outstanding)} sub={`${arSummary?.overdueCount||0} overdue`}        icon="🧾" color="#3b82f6" alert={arSummary?.overdueCount>0} />
        <KpiCard label="Payables Due"    value={fmtAmt(apSummary?.outstanding)} sub={`${apSummary?.overdueCount||0} overdue`}        icon="📤" color="#f59e0b" alert={apSummary?.overdueCount>0} />
        <KpiCard label="Net Profit MTD"  value={fmtAmt(pl?.netProfit)}       sub={pl?`${pl.netMarginPct?.toFixed(1)}% margin`:'—'} icon="💹" color={pl?.netProfit>=0?'#16a34a':'#dc2626'} />
      </div>

      {/* Invoice Tables */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, marginBottom:24 }}>
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid #f3f4f6', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <p style={{ margin:0, fontFamily:"'Poppins',sans-serif", fontSize:14, fontWeight:700, color:'#111827' }}>Receivables</p>
              <p style={{ margin:0, fontSize:11, color:'var(--text-muted)' }}>Unpaid sales invoices</p>
            </div>
            <a href="/finance" style={{ fontSize:11, color:'#6c63ff', fontWeight:600, textDecoration:'none' }}>View all →</a>
          </div>
          <InvoiceTable invoices={arInvoices} type="ar" total={arSummary?.outstanding} totalColor="#3b82f6" />
        </div>

        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'14px 16px', borderBottom:'1px solid #f3f4f6', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <p style={{ margin:0, fontFamily:"'Poppins',sans-serif", fontSize:14, fontWeight:700, color:'#111827' }}>Payables</p>
              <p style={{ margin:0, fontSize:11, color:'var(--text-muted)' }}>Approved supplier invoices due</p>
            </div>
            <a href="/finance" style={{ fontSize:11, color:'#6c63ff', fontWeight:600, textDecoration:'none' }}>View all →</a>
          </div>
          <InvoiceTable invoices={apInvoices} type="ap" total={apSummary?.outstanding} totalColor="#f59e0b" />
        </div>
      </div>

      {/* P&L Strip */}
      {pl && !loading && (
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14, padding:'16px 20px' }}>
          <p style={{ margin:'0 0 14px', fontFamily:"'Poppins',sans-serif", fontSize:14, fontWeight:700, color:'#111827' }}>
            P&L Summary — {monthStr}
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10 }}>
            {[
              { label:'Revenue',      value:fmtAmt(pl.totalRevenue),  color:'#6c63ff' },
              { label:'COGS',         value:fmtAmt(pl.totalCOGS),     color:'#f59e0b' },
              { label:'Gross Profit', value:fmtAmt(pl.grossProfit),   color:pl.grossProfit>=0?'#16a34a':'#dc2626' },
              { label:'OpEx',         value:fmtAmt(pl.totalOpEx),     color:'#f59e0b' },
              { label:'Net Profit',   value:fmtAmt(pl.netProfit),     color:pl.netProfit>=0?'#16a34a':'#dc2626' },
              { label:'Net Margin',   value:`${pl.netMarginPct?.toFixed(1)}%`, color:pl.netMarginPct>=0?'#16a34a':'#dc2626' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign:'center', background:'#f9fafb', borderRadius:10, padding:'10px 8px' }}>
                <p style={{ margin:'0 0 4px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-muted)' }}>{label}</p>
                <p style={{ margin:0, fontFamily:"'Poppins',sans-serif", fontSize:15, fontWeight:700, color }}>{value}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop:12, textAlign:'right' }}>
            <a href="/finance" style={{ fontSize:12, color:'#6c63ff', fontWeight:600, textDecoration:'none' }}>View full P&L report →</a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user, apiFetch } = useAuth();
  const router = useRouter();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const STORE_ROLES = ['STORE_MANAGER', 'STORE_CLERK'];
  const MILL_ROLES  = ['FEED_MILL_MANAGER'];
  const QC_ROLES    = ['QC_TECHNICIAN'];
  const role        = user?.role;

  const useStoreDashboard = role && (STORE_ROLES.includes(role) || MILL_ROLES.includes(role) || QC_ROLES.includes(role));

  const load = useCallback(async () => {
    try {
      const endpoint = useStoreDashboard ? '/api/dashboard/store' : '/api/dashboard';
      const res = await apiFetch(endpoint);
      if (res.ok) { setData(await res.json()); setError(null); }
      else setError('Could not load dashboard data');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [apiFetch, useStoreDashboard]);

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

  // ── Accountant ───────────────────────────────────────────────────────────────
  if (role === 'ACCOUNTANT') {
    return (
      <AppShell>
        <div className="animate-in">
          <AccountantDashboard user={user} apiFetch={apiFetch} />
        </div>
      </AppShell>
    );
  }

  // ── Internal Control Officer ──────────────────────────────────────────────
  if (role === 'INTERNAL_CONTROL') {
    return (
      <AppShell>
        <div className="animate-in">
          <IcDashboard user={user} apiFetch={apiFetch} />
        </div>
      </AppShell>
    );
  }

  // ── Store / Feed Mill / QC roles ──────────────────────────────────────────
  if (useStoreDashboard && data) {
    return (
      <AppShell>
        <div className="animate-in">
          {STORE_ROLES.includes(role) && <StoreDashboard data={data} isClerk={role==='STORE_CLERK'} />}
          {MILL_ROLES.includes(role)  && <FeedMillDashboard data={data} />}
          {QC_ROLES.includes(role)    && <QCDashboard data={data} />}
        </div>
      </AppShell>
    );
  }

  // ── Pen worker / Pen manager / Farm manager+ (existing logic) ─────────────
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
