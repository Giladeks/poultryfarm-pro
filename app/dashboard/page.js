'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import KpiCard from '@/components/ui/KpiCard';
import GradingModal from '@/components/eggs/GradingModal';
import MortalityVerifyModal from '@/components/verification/MortalityVerifyModal';
import OverrideModal from '@/components/verification/OverrideModal';
import SpotCheckPanel from '@/components/dashboard/SpotCheckPanel';
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
function ChartModal({ sectionId, sectionName, penName, opType, stage = 'PRODUCTION', onClose }) {
  const isL        = opType === 'LAYER';
  const isBrooding = stage === 'BROODING';
  console.log('[ChartModal] stage:', stage, '| isBrooding:', isBrooding, '| opType:', opType);
  const [days, setDays] = useState(isL ? 7 : 14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sectionId) return;
    setLoading(true);
    fetch(`/api/dashboard/charts?sectionId=${sectionId}&days=${days}&stage=${stage}`, { credentials: 'include' })
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

  const chart     = data?.chart || [];
  const isRearing = data?.isRearing || (stage === 'REARING');

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
      <Tile title={isBrooding ? "🌾 Feed Consumption & Brooder Temperature" : "🌾 Daily Feed Consumption"}>
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="kg" tick={{ fontSize: 10 }} width={45} unit="kg" />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }}
                width={isBrooding ? 38 : 40}
                unit={isBrooding ? '°C' : 'g'}
                domain={isBrooding ? [20, 42] : ['auto', 'auto']} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="kg" dataKey="feedKg" name="Feed (kg)" fill="#6c63ff" opacity={0.8} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone"
                dataKey={isBrooding ? 'avgTemp' : 'feedGpb'}
                name={isBrooding ? 'Avg Temp °C' : 'g/bird/day'}
                stroke={isBrooding ? '#ef4444' : '#f59e0b'}
                strokeWidth={2}
                dot={isBrooding
                  ? (props) => {
                      const { cx, cy, value } = props;
                      if (value == null || cx == null) return <g key={`empty-${index ?? cx ?? Math.random()}`}/>;
                      return <circle key={`t-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fff" strokeWidth={1.5}/>;
                    }
                  : { r: 2 }
                }
                activeDot={{ r: 6 }}
                connectNulls />
              {isBrooding && <ReferenceLine yAxisId="right" y={38} stroke="#ef4444" strokeDasharray="3 3"
                label={{ value: 'Max 38°C', fontSize: 9, fill: '#ef4444' }} />}
              {isBrooding && <ReferenceLine yAxisId="right" y={26} stroke="#3b82f6" strokeDasharray="3 3"
                label={{ value: 'Min 26°C', fontSize: 9, fill: '#3b82f6' }} />}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Tile>
    </div>
  );

  const broilerCharts = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
      <Tile title={isRearing ? "⚖ Pullet Weight vs ISA Brown Target" : "⚖ Live Weight vs Ross 308 Target"}>
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
      <Tile title={isBrooding ? "🌾 Feed Intake & Brooder Temperature" : "🌾 Daily Feed Intake"}>
        {loading ? <Spinner /> : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="kg" tick={{ fontSize: 10 }} width={45} unit="kg" />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }}
                width={isBrooding ? 38 : 40}
                unit={isBrooding ? '°C' : 'g'}
                domain={isBrooding ? [20, 42] : ['auto', 'auto']} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="kg" dataKey="feedKg" name="Feed (kg)" fill="#6c63ff" opacity={0.8} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone"
                dataKey={isBrooding ? 'avgTemp' : 'feedGpb'}
                name={isBrooding ? 'Avg Temp °C' : 'g/bird/day'}
                stroke={isBrooding ? '#ef4444' : '#f59e0b'}
                strokeWidth={2}
                dot={isBrooding
                  ? (props) => {
                      const { cx, cy, value } = props;
                      if (value == null || cx == null) return <g key={`empty-${index ?? cx ?? Math.random()}`}/>;
                      return <circle key={`t-${cx}-${cy}`} cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fff" strokeWidth={1.5}/>;
                    }
                  : { r: 2 }
                }
                activeDot={{ r: 6 }}
                connectNulls />
              {isBrooding && <ReferenceLine yAxisId="right" y={38} stroke="#ef4444" strokeDasharray="3 3"
                label={{ value: 'Max 38°C', fontSize: 9, fill: '#ef4444' }} />}
              {isBrooding && <ReferenceLine yAxisId="right" y={26} stroke="#3b82f6" strokeDasharray="3 3"
                label={{ value: 'Min 26°C', fontSize: 9, fill: '#3b82f6' }} />}
            </ComposedChart>
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
          {isL && !isRearing && !isBrooding ? layerCharts : broilerCharts}
        </div>

      </div>
    </div>
  , document.body);
}

function Spinner() {
  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>;
}

// ── Section card (pen worker) — mockup style ─────────────────────────────────
// ── Worker section grid card — click anywhere to open chart modal ─────────────
// Each card lives in a 3-column grid. Entire surface is the click target.
// No expand/collapse; all key metrics are visible at a glance.
function WorkerSectionGridCard({ sec, highlighted = false }) {
  const [modal, setModal] = useState(false);
  const cardRef = useRef(null);
  const mx      = sec.metrics;
  const isL     = sec.penOperationType === 'LAYER';
  const flag    = (sec.flags||[])[0];
  const isCrit  = flag?.type === 'critical';
  const isWarn  = flag?.type === 'warn';
  const hasFlock = !!sec.flock;

  // Scroll + pulse when attention pill navigates here
  useEffect(() => {
    if (!highlighted) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [highlighted]);

  const secStage   = sec.flock?.stage || sec.metrics?.stage || 'PRODUCTION';
  const isRearing  = isL && secStage === 'REARING';
  const isBrooding = secStage === 'BROODING';
  const layRate    = mx.todayLayingRate > 0 ? mx.todayLayingRate : null;
  const rateColor  = layRate == null ? 'var(--text-muted)'
    : layRate < 70 ? '#ef4444' : layRate < 80 ? '#d97706' : '#16a34a';

  const borderColor = highlighted ? '#fb923c'
    : isCrit ? '#fecaca' : isWarn ? '#fde68a' : '#e2e8f0';
  const shadow = highlighted
    ? '0 0 0 3px rgba(251,146,60,0.30)'
    : isCrit ? '0 0 0 2px rgba(239,68,68,0.07)' : 'none';

  return (
    <>
      <div
        ref={cardRef}
        onClick={() => hasFlock && setModal(true)}
        style={{
          background: highlighted ? '#fff7ed' : '#fff',
          border: `1.5px solid ${borderColor}`,
          borderRadius: 14,
          padding: '14px 16px',
          cursor: hasFlock ? 'pointer' : 'default',
          boxShadow: shadow,
          animation: highlighted ? 'harvestBreath 0.8s ease-in-out infinite' : 'none',
          transition: 'box-shadow 0.2s, border-color 0.2s, background 0.2s',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          position: 'relative',
          overflow: 'hidden',
        }}
        onMouseEnter={e => { if (hasFlock) e.currentTarget.style.boxShadow = '0 4px 16px rgba(108,99,255,0.12)'; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = shadow; }}
      >
        {/* ── Header row ── */}
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:700,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {sec.name}
            </div>
            <div style={{fontSize:10,color:'var(--text-muted)',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {sec.penName}
              {hasFlock && <span> · {sec.flock.batchCode}</span>}
              {hasFlock && sec.ageInDays != null && <span> · {sec.ageInDays}d</span>}
            </div>
          </div>
          {/* Status dot */}
          <div style={{
            width:9, height:9, borderRadius:'50%', flexShrink:0, marginTop:2,
            background: isCrit?'#ef4444':isWarn?'#f59e0b':'#22c55e',
          }}/>
        </div>

        {/* ── Flag banner ── */}
        {flag && (
          <div style={{fontSize:10,fontWeight:700,color:isCrit?'#ef4444':'#d97706',background:isCrit?'#fef2f2':'#fffbeb',border:`1px solid ${isCrit?'#fecaca':'#fde68a'}`,borderRadius:5,padding:'3px 8px',lineHeight:1.4}}>
            ⚠ {flag.msg}
          </div>
        )}

        {/* ── Metric grid — stage-aware ── */}
        {hasFlock ? (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {isRearing ? (<>
              {/* LAYER REARING — weight & feed, no eggs */}
              <MiniStat label="Avg Weight"   value={mx.latestWeightG?`${(mx.latestWeightG/1000).toFixed(3)} kg`:'—'} color="#6c63ff" />
              <MiniStat label="Feed/Day"     value={mx.avgDailyFeedKg!=null?`${mx.avgDailyFeedKg}kg`:'—'} color="#6c63ff" />
              <MiniStat label="Deaths Today" value={fmt(mx.todayMortality||0)} color={mx.todayMortality>5?'#ef4444':'var(--text-secondary)'} />
              <MiniStat label="7d Mortality" value={fmt(mx.weekMortality||0)} color="var(--text-secondary)" />
            </>) : isBrooding ? (<>
              {/* BROODING — live birds & temp */}
              <MiniStat label="Live Chicks"  value={fmt(sec.currentBirds||0)} color="#6c63ff" />
              <MiniStat label="Brooder Temp" value={mx.latestBrooderTemp!=null?`${Number(mx.latestBrooderTemp).toFixed(1)}°C`:'—'} color={mx.latestBrooderTemp>38||mx.latestBrooderTemp<26?'#ef4444':'#16a34a'} />
              <MiniStat label="Deaths Today" value={fmt(mx.todayMortality||0)} color={mx.todayMortality>5?'#ef4444':'var(--text-secondary)'} />
              <MiniStat label="7d Mortality" value={fmt(mx.weekMortality||0)} color="var(--text-secondary)" />
            </>) : isL ? (<>
              {/* LAYER PRODUCTION — eggs, lay rate, weight (if recorded) */}
              <MiniStat label="Eggs Today"   value={fmt(mx.todayEggs||0)} color="#f59e0b" />
              <MiniStat label="Lay Rate"     value={layRate!=null?`${layRate}%`:'—'} color={rateColor} />
              {mx.latestWeightG && (
                <MiniStat label="Avg Weight"
                  value={`${Math.round(mx.latestWeightG)}g`}
                  color={mx.latestWeightG<1700||mx.latestWeightG>2200?'#ef4444':mx.latestWeightG<1800||mx.latestWeightG>2000?'#d97706':'#16a34a'} />
              )}
              <MiniStat label="Deaths Today" value={fmt(mx.todayMortality||0)} color={mx.todayMortality>5?'#ef4444':'var(--text-secondary)'} />
              <MiniStat label="7d Mortality" value={fmt(mx.weekMortality||0)} color="var(--text-secondary)" />
            </>) : (<>
              {/* BROILER PRODUCTION — weight & FCR */}
              <MiniStat label="Avg Weight"  value={mx.latestWeightG?`${(mx.latestWeightG/1000).toFixed(2)} kg`:'—'} color="#3b82f6" />
              <MiniStat label="Est. FCR"    value={mx.estimatedFCR!=null?`${mx.estimatedFCR}`:'—'} color={fcrColor(mx.estimatedFCR||0)} />
              <MiniStat label="Deaths Today" value={fmt(mx.todayMortality||0)} color={mx.todayMortality>5?'#ef4444':'var(--text-secondary)'} />
              <MiniStat label="To Harvest"  value={mx.daysToHarvest!=null?`${mx.daysToHarvest}d`:'—'} color="#8b5cf6" />
            </>)}
          </div>
        ) : (
          <div style={{fontSize:11,color:'var(--text-muted)',textAlign:'center',padding:'8px 0'}}>No active flock</div>
        )}

        {/* ── Occupancy bar ── */}
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--text-muted)',marginBottom:3}}>
            <span>Occupancy</span>
            <span>{fmt(sec.currentBirds)}/{fmt(sec.capacity)} birds · {sec.occupancyPct}%</span>
          </div>
          <div style={{height:4,background:'#f1f5f9',borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${Math.min(sec.occupancyPct||0,100)}%`,background:occColor(sec.occupancyPct||0),borderRadius:2,transition:'width .5s ease'}}/>
          </div>
        </div>

        {/* ── Chart hint ── */}
        {hasFlock && (
          <div style={{fontSize:10,color:'var(--purple)',fontWeight:600,textAlign:'center',marginTop:2}}>
            📈 Tap to view trends
          </div>
        )}
      </div>

      {modal && (
        <ChartModal
          sectionId={sec.id}
          sectionName={sec.name}
          penName={sec.penName}
          opType={sec.penOperationType}
          stage={sec.flock?.stage || sec.metrics?.stage || 'PRODUCTION'}
          onClose={() => setModal(false)}
        />
      )}
    </>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{background:'var(--bg-elevated)',borderRadius:8,padding:'7px 10px'}}>
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

  // Dominant stage across this pen's sections
  const penStage     = (() => {
    const secs = pen.sections || [];
    if (secs.some(s => (s.metrics?.stage || s.flock?.stage) === 'BROODING')) return 'BROODING';
    if (secs.some(s => (s.metrics?.stage || s.flock?.stage) === 'REARING'))  return 'REARING';
    return 'PRODUCTION';
  })();
  const penIsRearing  = isL && penStage === 'REARING';
  const penIsBrooding = isL && penStage === 'BROODING';
  // todayLayingRate is per-section correct (totalEggs/currBirds); avgLayingRate is 7d inflated
  const avgRate      = (mx.todayLayingRate > 0) ? mx.todayLayingRate : null;
  const primaryVal   = penIsBrooding || penIsRearing
    ? (mx.latestWeightG ? `${(Number(mx.latestWeightG)/1000).toFixed(3)} kg` : '—')
    : isL
      ? (avgRate != null ? `${avgRate}%` : '—')
      : (mx.avgWeightG != null ? `${(mx.avgWeightG/1000).toFixed(2)} kg` : '—');
  const primaryLabel = penIsBrooding ? 'avg weight' : penIsRearing ? 'avg weight' : isL ? 'lay rate' : 'avg weight';
  const primaryCrit  = isL && !penIsBrooding && !penIsRearing ? (avgRate != null && avgRate < 70) : false;
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
                  {sec.flock&&<button onClick={e=>{e.stopPropagation();setModalSec({id:sec.id,name:sec.name,stage:sec.flock?.stage||'PRODUCTION'});}} style={{background:'#eeecff',border:'none',borderRadius:7,padding:'5px 11px',fontSize:11,fontWeight:600,color:'#6c63ff',cursor:'pointer',whiteSpace:'nowrap'}}>View Trends →</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {modalSec&&<ChartModal sectionId={modalSec.id} sectionName={modalSec.name} penName={pen.name} opType={pen.operationType} stage={modalSec.stage||'PRODUCTION'} onClose={()=>setModalSec(null)}/>}
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

// ── Yesterday banner ─────────────────────────────────────────────────────────
function YesterdayBanner({ show }) {
  if (!show) return null;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const label = yesterday.toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  return (
    <div style={{ background:'#eeecff', border:'1px solid #c7d2fe', borderRadius:10,
      padding:'8px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:8,
      fontSize:13, color:'#4338ca', fontWeight:600 }}>
      📅 Showing data for <strong style={{marginLeft:4}}>{label}</strong>
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
    <div className="dash-modal-overlay" style={{position:'fixed',inset:0,zIndex:1200,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="dash-modal-inner" style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:460,boxShadow:'0 12px 48px rgba(0,0,0,0.2)',display:'flex',flexDirection:'column',maxHeight:'90vh'}}>
        <div style={{padding:'18px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <span style={{fontSize:15,fontWeight:800,color:'var(--text-primary)',fontFamily:"'Poppins',sans-serif"}}>{title}</span>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:22,cursor:'pointer',color:'var(--text-muted)',lineHeight:1,minHeight:44,minWidth:44,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>
        <div style={{padding:'18px 20px',overflowY:'auto',flexGrow:1}}>{children}</div>
        <div style={{padding:'14px 20px',borderTop:'1px solid var(--border-card)',display:'flex',gap:10,justifyContent:'flex-end',flexShrink:0,flexWrap:'wrap'}}>{footer}</div>
      </div>
    </div>,
    document.body
  );
}

// ── Edit/correct a rejected record ────────────────────────────────────────────
// Workers resubmit after PM rejection.
// Egg records use the Phase 8B crate-based schema:
//   cratesCollected + looseEggs (0–29) + crackedCount  →  totalEggs computed server-side
// Mortality records use count + causeCode + recordDate + notes.
function EditRecordModal({ item, apiFetch, onClose, onSave }) {
  const { record, type } = item;
  const today = new Date().toISOString().split('T')[0];

  // ── Egg form — crate-based (Phase 8B) ───────────────────────────────────────
  const [eggForm, setEggForm] = useState({
    collectionDate:    record.collectionDate?.split('T')[0] || today,
    collectionSession: record.collectionSession || 1,
    cratesCollected:   String(record.cratesCollected ?? ''),
    looseEggs:         String(record.looseEggs        ?? ''),
    crackedCount:      String(record.crackedCount      ?? ''),
  });
  const [mortForm, setMortForm] = useState({
    recordDate: record.recordDate?.split('T')[0] || today,
    count:     String(record.count     || ''),
    causeCode: record.causeCode || 'UNKNOWN',
    notes:     record.notes    || '',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const setE = (k, v) => setEggForm(p => ({...p, [k]: v}));
  const setM = (k, v) => setMortForm(p => ({...p, [k]: v}));

  // Live egg total: (crates × 30) + looseEggs + crackedCount
  const crates  = Math.max(0, parseInt(eggForm.cratesCollected) || 0);
  const loose   = Math.max(0, parseInt(eggForm.looseEggs)       || 0);
  const cracked = Math.max(0, parseInt(eggForm.crackedCount)    || 0);
  const totalEggs = (crates * 30) + loose + cracked;
  const mortCount = Number(mortForm.count) || 0;
  const isEgg = type === 'egg';

  async function save() {
    setSaving(true); setErr('');
    try {
      let endpoint, body;
      if (isEgg) {
        if (crates <= 0 && loose <= 0) return setErr('Enter at least crates collected or loose eggs');
        if (loose > 29)                return setErr('Loose eggs must be 0–29 (above 29 is a full crate)');
        endpoint = `/api/eggs/${record.id}`;
        body = {
          cratesCollected:   crates,
          looseEggs:         loose,
          crackedCount:      cracked,
          collectionDate:    eggForm.collectionDate,
          collectionSession: Number(eggForm.collectionSession),
        };
      } else {
        if (mortCount <= 0) return setErr('Enter number of deaths');
        endpoint = `/api/mortality/${record.id}`;
        body = { count: mortCount, causeCode: mortForm.causeCode, recordDate: mortForm.recordDate, notes: mortForm.notes.trim() || null };
      }

      const res = await apiFetch(endpoint, { method: 'PATCH', body: JSON.stringify(body) });

      // Safe JSON parse — guard against empty bodies (204) or non-JSON errors
      let d = {};
      const ct = res.headers?.get('content-type') || '';
      if (ct.includes('application/json')) {
        try { d = await res.json(); } catch { /* empty body — treat as success if res.ok */ }
      }

      if (!res.ok) { setErr(d.error || `Save failed (${res.status})`); return; }
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <DashModalShell title={isEgg ? '🥚 Correct Egg Record' : '💀 Correct Mortality Record'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
               <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Resubmit Record'}</button></>}>
      {err && <div className="alert alert-red" style={{marginBottom:12}}>⚠ {err}</div>}
      {/* Rejection reason */}
      <div style={{marginBottom:16,padding:'10px 14px',background:'#fff5f5',border:'1px solid #fecaca',borderRadius:8,fontSize:12}}>
        <div style={{fontWeight:700,color:'#991b1b',marginBottom:3}}>⚠ Returned for correction</div>
        <div style={{color:'#7f1d1d'}}>{record.rejectionReason}</div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        {isEgg ? (<>
          {/* Date + session */}
          <div className="modal-input-grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label className="label">Collection Date *</label>
              <input type="date" className="input" value={eggForm.collectionDate}
                onChange={e=>setE('collectionDate',e.target.value)} max={today}/>
            </div>
            <div>
              <label className="label">Session</label>
              <select className="input" value={eggForm.collectionSession}
                onChange={e=>setE('collectionSession',e.target.value)}>
                <option value={1}>Morning</option>
                <option value={2}>Afternoon</option>
              </select>
            </div>
          </div>
          {/* Crate-based fields */}
          <div className="modal-input-grid-3" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
            <div>
              <label className="label">Full Crates *</label>
              <input type="number" inputMode="numeric" className="input" min="0" value={eggForm.cratesCollected}
                onChange={e=>setE('cratesCollected',e.target.value)} placeholder="0" autoFocus/>
              <div style={{fontSize:9,color:'var(--text-muted)',marginTop:3}}>30 eggs each</div>
            </div>
            <div>
              <label className="label">Loose Eggs</label>
              <input type="number" inputMode="numeric" className="input" min="0" max="29" value={eggForm.looseEggs}
                onChange={e=>setE('looseEggs',e.target.value)} placeholder="0–29"/>
            </div>
            <div>
              <label className="label">Cracked</label>
              <input type="number" inputMode="numeric" className="input" min="0" value={eggForm.crackedCount}
                onChange={e=>setE('crackedCount',e.target.value)} placeholder="0"/>
            </div>
          </div>
          {/* Live total preview */}
          {(crates > 0 || loose > 0 || cracked > 0) && (
            <div style={{padding:'8px 12px',background:'var(--purple-light)',border:'1px solid #d4d8ff',borderRadius:8,fontSize:12}}>
              <span style={{color:'var(--text-muted)'}}>
                ({crates} × 30) + {loose} + {cracked} cracked =&nbsp;
              </span>
              <strong style={{color:'var(--purple)',fontSize:14}}>{totalEggs.toLocaleString()} eggs total</strong>
            </div>
          )}
        </>) : (<>
          <div className="modal-input-grid-2" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={mortForm.recordDate}
                onChange={e=>setM('recordDate',e.target.value)} max={today}/>
            </div>
            <div>
              <label className="label">Number of Deaths *</label>
              <input type="number" inputMode="numeric" className="input" min="1" value={mortForm.count}
                onChange={e=>setM('count',e.target.value)} placeholder="0"/>
            </div>
          </div>
          <div>
            <label className="label">Cause of Death</label>
            <select className="input" value={mortForm.causeCode}
              onChange={e=>setM('causeCode',e.target.value)}>
              {MORT_CAUSES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Notes <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional)</span></label>
            <textarea className="input" rows={2} value={mortForm.notes}
              onChange={e=>setM('notes',e.target.value)}
              placeholder="Observations…" style={{resize:'vertical'}}/>
          </div>
        </>)}
      </div>
    </DashModalShell>
  );
}

function WorkerDashboard({ sections, tasks, user, apiFetch, showYesterday }) {
  const isL      = sections.some(s=>s.penOperationType==='LAYER');
  const totDead  = sections.reduce((s,sec)=>s+sec.metrics.todayMortality,0);
  const totBirds = sections.reduce((s,sec)=>s+sec.currentBirds,0);
  const todayEggs= sections.filter(s=>s.metrics.type==='LAYER').reduce((s,sec)=>s+(sec.metrics.todayEggs||0),0);
  // avgRate = total today eggs / total birds (not avg of section rates)
  const prodSecsTot = sections.filter(s=>s.metrics.type==='LAYER');
  const totEggsToday = prodSecsTot.reduce((s,sec)=>s+(sec.metrics.todayEggs||0),0);
  const totBirdsToday= prodSecsTot.reduce((s,sec)=>s+(sec.currentBirds||0),0);
  const avgRate  = totBirdsToday > 0 ? parseFloat((totEggsToday/totBirdsToday*100).toFixed(1)) : 0;
  const rates    = sections.filter(s=>s.metrics.type==='LAYER'&&(s.metrics.todayLayingRate||0)>0);
  const weights  = sections.filter(s=>s.metrics.type==='BROILER'&&s.metrics.latestWeightG);
  const avgWt    = weights.length ? parseFloat((weights.reduce((s,sec)=>s+sec.metrics.latestWeightG,0)/weights.length).toFixed(0)) : null;
  const fcrs     = sections.filter(s=>s.metrics.type==='BROILER'&&s.metrics.estimatedFCR);
  const avgFCR   = fcrs.length ? parseFloat((fcrs.reduce((s,sec)=>s+sec.metrics.estimatedFCR,0)/fcrs.length).toFixed(2)) : null;
  const overdue  = tasks.filter(t=>t.status==='OVERDUE').length;
  // Today's total feed across all sections
  const todayFeedKg = parseFloat(sections.reduce((a,s)=>a+(s.metrics?.todayFeedKg||0),0).toFixed(1));
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

  // ── Build KPI cards (4 cards for both layer and broiler workers) ──────────────
  // highlightedSection: which section name to pulse when attention pill is clicked
  const [highlightedSection, setHighlightedSection] = useState(null);

  // Dominant stage across this worker's sections
  const dominantStage = (() => {
    const counts = {};
    sections.forEach(s => {
      const st = s.metrics?.stage || s.flock?.stage || 'PRODUCTION';
      counts[st] = (counts[st] || 0) + 1;
    });
    if (counts.BROODING > 0) return 'BROODING';
    if (counts.REARING  > 0) return 'REARING';
    return 'PRODUCTION';
  })();

  const latestBrooderTemp = sections.map(s => s.metrics?.latestBrooderTemp).find(t => t != null) || null;
  const tempStatus = latestBrooderTemp == null ? 'neutral'
    : (latestBrooderTemp < 26 || latestBrooderTemp > 38) ? 'critical'
    : (latestBrooderTemp < 28 || latestBrooderTemp > 35) ? 'warn' : 'good';

  const rearingWtSecs = sections.filter(s => s.metrics?.latestWeightG);
  const avgRearingWt  = rearingWtSecs.length
    ? parseFloat((rearingWtSecs.reduce((a,s)=>a+s.metrics.latestWeightG,0)/rearingWtSecs.length).toFixed(0)) : null;

  const mortCard = {
    label:'Mortality Today', value:fmt(totDead),
    sub:`7d total: ${fmt(sections.reduce((a,s)=>a+(s.metrics?.weekMortality||0),0))}`,
    delta:totDead===0?'All clear':totDead<=2?'Normal':'Spike detected',
    trend:totDead===0?'up':totDead>5?'down':'stable',
    status:mortCountStatus(totDead,5), icon:'💀', context:'Your sections',
  };
  const feedCard = {
    label:'Feed Used Today', value:todayFeedKg>0?`${todayFeedKg} kg`:'—',
    sub:todayFeedKg>0&&totBirds>0?`${parseFloat((todayFeedKg*1000/totBirds).toFixed(0))} g/bird`:'Log feed via tasks',
    delta:todayFeedKg>0?`${todayFeedKg} kg distributed`:'No feed logged yet',
    trend:'stable', status:todayFeedKg>0?'good':'neutral', icon:'🌾', context:'Your sections',
  };

  const workerKpis = isL && dominantStage==='BROODING' ? [
    { label:'Live Chicks', value:fmt(totBirds),
      sub:`${sections.length} brooding section${sections.length!==1?'s':''}`,
      delta:'', trend:'stable', status:'neutral', icon:'🐣', context:'Your sections' },
    { label:'Brooder Temp',
      value:latestBrooderTemp!=null?`${Number(latestBrooderTemp).toFixed(1)}°C`:'—',
      sub:'Latest reading · Safe range 26–38°C',
      delta:latestBrooderTemp!=null?(latestBrooderTemp<26||latestBrooderTemp>38?'⚠ Out of range':'✓ In range'):'No reading yet',
      trend:tempStatus==='critical'?'down':'stable', status:tempStatus,
      icon:'🌡️', context:'Log in Brooding page' },
    mortCard, taskCard,
  ] : isL && dominantStage==='REARING' ? [
    { label:'Live Pullets', value:fmt(totBirds),
      sub:`Wk ${sections[0]?.ageInDays!=null?Math.floor(sections[0].ageInDays/7):'—'} of rearing`,
      delta:'', trend:'stable', status:'neutral', icon:'🌱', context:'Your sections' },
    { label:'Avg Weight',
      value:avgRearingWt?`${(avgRearingWt/1000).toFixed(3)} kg`:'—',
      sub:avgRearingWt?`${avgRearingWt}g avg body weight`:'No weigh-in yet',
      delta:avgRearingWt?`${avgRearingWt}g`:'Weigh-in pending',
      trend:'stable', status:avgRearingWt?'good':'neutral', icon:'⚖️', context:'Weekly weigh-in task' },
    mortCard, taskCard,
  ] : isL ? [
    { label:'Live Birds', value:fmt(totBirds),
      sub:`${sections.length} section${sections.length!==1?'s':''}`,
      delta:'', trend:'stable', status:'neutral', icon:'🐦', context:'Your sections' },
    feedCard,
    { label:'Eggs Today', value:fmt(todayEggs),
      sub:`Lay rate ${avgRate>0?avgRate+'%':'—'}`,
      delta:todayEggs>0?`${fmt(todayEggs)} collected`:'None yet',
      trend:'stable', status:todayEggs>0?'good':'neutral', icon:'🥚', context:'Your sections' },
    mortCard, taskCard,
  ] : dominantStage==='BROODING' ? [
    // Broiler worker in BROODING stage — show Brooder Temp prominently
    { label:'Live Chicks', value:fmt(totBirds),
      sub:`${sections.length} brooding section${sections.length!==1?'s':''}`,
      delta:'', trend:'stable', status:'neutral', icon:'🐣', context:'Your sections' },
    { label:'Brooder Temp',
      value:latestBrooderTemp!=null?`${Number(latestBrooderTemp).toFixed(1)}°C`:'—',
      sub:'Latest reading · Safe range 26–38°C',
      delta:latestBrooderTemp!=null?(latestBrooderTemp<26||latestBrooderTemp>38?'⚠ Out of range':'✓ In range'):'No reading yet',
      trend:tempStatus==='critical'?'down':'stable', status:tempStatus,
      icon:'🌡️', context:'Log in Brooding page' },
    mortCard, taskCard,
  ] : [
    // Broiler worker in PRODUCTION stage
    {
      label:'Live Birds', value: fmt(totBirds),
      sub:`${sections.length} section${sections.length!==1?'s':''}`,
      delta:'', trend:'stable', status:'neutral',
      icon:'🐓', context:'Your sections',
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
        <AttentionPill
          pens={pillPens}
          mode='sections'
          onNavigate={(penId, sectionName) => {
            setHighlightedSection(sectionName);
            // auto-clear highlight after 3.5 s
            setTimeout(() => setHighlightedSection(null), 3500);
          }}
        />
      </div>

      {/* ── KPI row (4 cards) ── */}
      <div style={{display:'grid',gridTemplateColumns:`repeat(${workerKpis.length},1fr)`,gap:14,marginBottom:24}}>
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

      {/* ── Section grid — all sections visible at a glance, click opens chart modal ── */}
      <div>
        {flaggedSections.length > 0 && (
          <div style={{fontSize:11,fontWeight:700,color:'#ef4444',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>
            ⚠ Needs Attention ({flaggedSections.length})
          </div>
        )}
        {/* Flagged sections shown first */}
        {flaggedSections.length > 0 && (
          <div className="worker-section-grid" style={{marginBottom:flaggedSections.length&&okSections.length?20:0}}>
            {flaggedSections.map(sec => (
              <WorkerSectionGridCard
                key={sec.id}
                sec={sec}
                highlighted={highlightedSection === sec.name}
              />
            ))}
          </div>
        )}
        {/* Divider + label when both groups present */}
        {flaggedSections.length > 0 && okSections.length > 0 && (
          <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',margin:'0 0 10px'}}>
            All Clear ({okSections.length})
          </div>
        )}
        {okSections.length > 0 && !flaggedSections.length && (
          <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:10}}>
            My Sections ({okSections.length})
          </div>
        )}
        <div className="worker-section-grid">
          {okSections.map(sec => (
            <WorkerSectionGridCard
              key={sec.id}
              sec={sec}
              highlighted={highlightedSection === sec.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Pen Manager dashboard ─────────────────────────────────────────────────────
function PenManagerDashboard({ pens, tasks, user, apiFetch, showYesterday }) {
  const router = useRouter();
  const [navTarget, setNavTarget] = useState(null); // { penId, sectionName }

  // ── Pending verifications (PM's action queue) ────────────────────────────────
  const [pendingVerifs, setPendingVerifs] = useState([]);
  const [verifLoading,  setVerifLoading]  = useState(false);
  const [verifToast,    setVerifToast]    = useState(null);
  // Specialist modals — opened when PM clicks Verify on egg or mortality items
  const [gradingModal,      setGradingModal]      = useState(null); // EggProduction item
  const [mortalityModal,    setMortalityModal]    = useState(null); // MortalityRecord item
  const [overrideModal,     setOverrideModal]     = useState(null); // egg or mortality override
  // Reject modal state
  const [rejectItem,        setRejectItem]        = useState(null);
  const [rejectNote,        setRejectNote]        = useState('');
  const [rejectErr,         setRejectErr]         = useState('');
  const [rejectSaving,      setRejectSaving]      = useState(false);

  // Build a set of pen names this PM manages — used to scope verification records
  const myPenNames = new Set(pens.map(p => p.name));

  const showVerifToast = (msg, ok = true) => {
    setVerifToast({ msg, ok });
    setTimeout(() => setVerifToast(null), 3500);
  };

  const loadVerifs = useCallback(() => {
    if (!apiFetch || myPenNames.size === 0) return;
    setVerifLoading(true);
    apiFetch('/api/verification?pendingOnly=true')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.pendingQueue) {
          setPendingVerifs(
            d.pendingQueue
              .filter(i => {
                if (!['DAILY_PRODUCTION', 'MORTALITY_REPORT', 'FEED_RECEIPT'].includes(i.type)) return false;
                if (i.context) {
                  const ctxPenSection = i.context.split(' | ')[0];
                  return [...myPenNames].some(pn => ctxPenSection.startsWith(pn));
                }
                return true;
              })
              .slice(0, 15)
          );
        }
      })
      .catch(() => {})
      .finally(() => setVerifLoading(false));
  }, [apiFetch, pens.length]);

  useEffect(() => { loadVerifs(); }, [loadVerifs]);

  // ── Verify click — intercept to specialist modal for eggs / mortality ─────
  const handleVerifyClick = (item) => {
    if (item.referenceType === 'EggProduction') {
      setGradingModal(item);
      return;
    }
    if (item.referenceType === 'MortalityRecord') {
      setMortalityModal(item);
      return;
    }
    // Feed / other: direct verify (PATCH if verificationId exists, else POST)
    submitVerify(item);
  };

  // ── Direct verify for feed / store records ────────────────────────────────
  const submitVerify = async (item) => {
    try {
      let res;
      if (item.verificationId) {
        res = await apiFetch(`/api/verification/${item.verificationId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'VERIFIED' }),
        });
      } else {
        res = await apiFetch('/api/verification', {
          method: 'POST',
          body: JSON.stringify({
            verificationType: item.type,
            referenceId:      item.referenceId,
            referenceType:    item.referenceType,
            verificationDate: new Date().toISOString().slice(0, 10),
            status:           'VERIFIED',
          }),
        });
      }
      const d = await res.json();
      if (!res.ok) {
        if (d.coiBlocked) {
          showVerifToast('🔒 ' + d.error, false);
        } else {
          showVerifToast(d.error || 'Verification failed', false);
        }
        return;
      }
      setPendingVerifs(prev => prev.filter(i => i.referenceId !== item.referenceId));
      showVerifToast('✓ Record verified');
    } catch { showVerifToast('Network error', false); }
  };

  // ── Reject submission ─────────────────────────────────────────────────────
  const submitReject = async () => {
    if (!rejectNote.trim()) { setRejectErr('Enter a reason for rejection'); return; }
    setRejectSaving(true); setRejectErr('');
    try {
      let res;
      if (rejectItem.verificationId) {
        res = await apiFetch(`/api/verification/${rejectItem.verificationId}`, {
          method: 'PATCH',
          body: JSON.stringify({ reject: true, rejectReason: rejectNote.trim() }),
        });
      } else {
        // Create verification record first, then reject
        const createRes = await apiFetch('/api/verification', {
          method: 'POST',
          body: JSON.stringify({
            verificationType: rejectItem.type,
            referenceId:      rejectItem.referenceId,
            referenceType:    rejectItem.referenceType,
            verificationDate: new Date().toISOString().slice(0, 10),
            status:           'DISCREPANCY_FOUND',
            discrepancyNotes: rejectNote.trim(),
          }),
        });
        const created = await createRes.json();
        if (!createRes.ok) { showVerifToast(created.error || 'Reject failed', false); return; }
        res = await apiFetch(`/api/verification/${created.verification.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ reject: true, rejectReason: rejectNote.trim() }),
        });
      }
      const d = await res.json();
      if (!res.ok) { showVerifToast(d.error || 'Reject failed', false); return; }
      setPendingVerifs(prev => prev.filter(i => i.referenceId !== rejectItem.referenceId));
      setRejectItem(null);
      setRejectNote('');
      showVerifToast('↩️ Record rejected — worker notified');
    } catch { showVerifToast('Network error', false); }
    finally { setRejectSaving(false); }
  };

  const totBirds = pens.reduce((s,p)=>s+p.totalBirds,0);
  const totDead  = pens.reduce((s,p)=>s+p.metrics.todayMortality,0);
  const todayEggs= pens.filter(p=>p.operationType==='LAYER').reduce((s,p)=>s+(p.metrics.todayEggs||0),0);
  const alerts   = pens.filter(p=>p.alertLevel!=='ok').length;
  const h = new Date().getHours();
  const greet = h<12?'morning':h<17?'afternoon':'evening';

  const layerPens  = pens.filter(p=>p.operationType==='LAYER');
  const hasLayer   = layerPens.length > 0;

  // Determine dominant stage per layer pen
  // Classify at SECTION level — a single pen can have mixed-stage sections
  const allLayerSections = layerPens.flatMap(p => (p.sections || []).map(s => ({
    ...s, penOperationType: p.operationType, penName: p.name,
  })));
  const getSectionStage = (s) => s.metrics?.stage || s.flock?.stage || 'PRODUCTION';
  const broodingLayerSecs    = allLayerSections.filter(s => getSectionStage(s) === 'BROODING');
  const rearingLayerSecs     = allLayerSections.filter(s => getSectionStage(s) === 'REARING');
  const productionLayerSecs  = allLayerSections.filter(s => getSectionStage(s) === 'PRODUCTION');

  // Keep pen-level arrays for backward compat (pen cards etc.) but base KPI split on sections
  const getPenStage = (pen) => {
    const secs = pen.sections || [];
    if (secs.some(s => getSectionStage(s) === 'BROODING')) return 'BROODING';
    if (secs.some(s => getSectionStage(s) === 'REARING'))  return 'REARING';
    return 'PRODUCTION';
  };
  const broodingLayerPens   = layerPens.filter(p => getPenStage(p) === 'BROODING');
  const rearingLayerPens    = layerPens.filter(p => getPenStage(p) === 'REARING');
  const productionLayerPens = layerPens.filter(p => getPenStage(p) === 'PRODUCTION');
  // Mixed: use section-level counts (works even when all sections are in the same pen)
  const hasMixedLayerStages = (broodingLayerSecs.length > 0 || rearingLayerSecs.length > 0)
                            && productionLayerSecs.length > 0;

  // Aggregate lay rate across production layer sections only
  // avgLayRate = today's total eggs / total birds — matches the "today" context on the KPI card
  // Using today not 7-day avg keeps this consistent with the performance page LAY RATE TODAY
  const prodTotalTodayEggs = productionLayerSecs.reduce((s,sec)=>s+(sec.metrics?.todayEggs||0),0);
  const prodTotalBirds     = productionLayerSecs.reduce((s,sec)=>s+(sec.currentBirds||0),0);
  const avgLayRate = prodTotalBirds > 0
    ? parseFloat((prodTotalTodayEggs / prodTotalBirds * 100).toFixed(1))
    : 0;
  const layRateSecs = productionLayerSecs.filter(s=>(s.metrics?.todayEggs||0)>0);

  // ── Per-pen aggregates scoped to this manager's pens ────────────────────────
  const broilerPens   = pens.filter(p=>p.operationType==='BROILER');
  const hasBroiler    = broilerPens.length > 0;

  // Layer aggregates — split by stage at SECTION level
  const lBirds        = layerPens.reduce((s,p)=>s+p.totalBirds,0);
  const lEggs         = productionLayerSecs.reduce((s,sec)=>s+(sec.metrics?.todayEggs||0),0);
  const lWeekEggs     = productionLayerSecs.reduce((s,sec)=>s+(sec.metrics?.weekEggs||0),0);
  const lDead7        = allLayerSections.reduce((s,sec)=>s+(sec.metrics?.weekMortality||0),0);
  const lMortR        = lBirds>0 ? parseFloat(((lDead7/lBirds)*100).toFixed(2)) : 0;
  const lGASecs       = productionLayerSecs.filter(s=>(s.metrics?.todayGradeAPct||0)>0);
  const lGradeA       = lGASecs.length ? parseFloat((lGASecs.reduce((s,sec)=>s+(sec.metrics?.todayGradeAPct||0),0)/lGASecs.length).toFixed(1)) : null;
  const lWaterSecs    = allLayerSections.filter(s=>s.metrics?.avgWaterLPB!=null);
  const lAvgWater     = lWaterSecs.length ? parseFloat((lWaterSecs.reduce((s,sec)=>s+(sec.metrics?.avgWaterLPB||0),0)/lWaterSecs.length).toFixed(2)) : null;
  const lAvgAge       = allLayerSections.length ? Math.round(allLayerSections.reduce((s,sec)=>s+(sec.ageInDays||180),0)/allLayerSections.length) : 180;
  const lWaterBench   = layerWaterBenchmark(lAvgAge);
  // Brooding/rearing aggregates — section level
  const nonProdLayerSecs = [...broodingLayerSecs, ...rearingLayerSecs];
  const lBroodBirds   = nonProdLayerSecs.reduce((s,sec)=>s+(sec.currentBirds||0),0);
  const lBroodTemp    = nonProdLayerSecs.map(s=>s.metrics?.latestBrooderTemp).find(t=>t!=null) ?? null;
  const lBroodWtSecs  = nonProdLayerSecs.filter(s=>s.metrics?.latestWeightG);
  const lBroodAvgWt   = lBroodWtSecs.length ? parseFloat((lBroodWtSecs.reduce((s,sec)=>s+(sec.metrics?.latestWeightG||0),0)/lBroodWtSecs.length).toFixed(0)) : null;
  const lBroodDead7   = nonProdLayerSecs.reduce((s,sec)=>s+(sec.metrics?.weekMortality||0),0);
  const lBroodBirdsAll= nonProdLayerSecs.reduce((s,sec)=>s+(sec.currentBirds||0),0);
  const lBroodMortR   = lBroodBirdsAll>0 ? parseFloat(((lBroodDead7/lBroodBirdsAll)*100).toFixed(2)) : 0;
  const lBroodAvgAge  = nonProdLayerSecs.length ? Math.round(nonProdLayerSecs.reduce((s,sec)=>s+(sec.ageInDays||30),0)/nonProdLayerSecs.length) : 30;
  const isaTargetPM   = (d) => { const w=Math.floor((d||0)/7); return [40,60,100,150,210,280,360,450,550,660,770,880,990,1100,1200,1290,1370,1440][Math.min(w,17)]||1440; };
  const lBroodIsaStd  = isaTargetPM(lBroodAvgAge);
  const tempStatusPM  = lBroodTemp==null?'neutral':lBroodTemp<26||lBroodTemp>38?'critical':lBroodTemp<28||lBroodTemp>35?'warn':'good';

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
  // Layer KPIs — stage-aware
  const broodingLayerKpis = (broodingLayerSecs.length > 0 || rearingLayerSecs.length > 0) ? [
    { label: rearingLayerSecs.length > 0 && broodingLayerSecs.length === 0 ? 'Live Pullets' : 'Live Chicks/Pullets',
      value:fmt(lBroodBirds), sub:nonProdLayerSecs.length+' section'+(nonProdLayerSecs.length!==1?'s':''),
      delta:'', trend:'stable', status:'neutral', icon:broodingLayerPens.length>0?'🐣':'🌱', context:'Brooding/Rearing' },
    // Only show Brooder Temp when pens are actively in BROODING stage
    ...(broodingLayerSecs.length > 0 ? [
      { label:'Brooder Temp', value:lBroodTemp!=null?`${Number(lBroodTemp).toFixed(1)}°C`:'—', sub:'Latest reading · Safe range 26–38°C', delta:lBroodTemp!=null?(lBroodTemp<26||lBroodTemp>38?'⚠ Out of range':'✓ In range'):'No reading yet', trend:tempStatusPM==='critical'?'down':'stable', status:tempStatusPM, icon:'🌡️', context:'Brooding' },
    ] : []),
    { label:'Avg Body Weight',    value:lBroodAvgWt?`${(lBroodAvgWt/1000).toFixed(3)} kg`:'—', sub:`ISA Brown target wk${Math.floor(lBroodAvgAge/7)}: ${(lBroodIsaStd/1000).toFixed(3)} kg`, delta:lBroodAvgWt?(lBroodAvgWt>=lBroodIsaStd*0.95?'On target':lBroodAvgWt>=lBroodIsaStd*0.85?'Slightly below':'Below target'):'No weigh-in yet', trend:'stable', status:lBroodAvgWt?(lBroodAvgWt>=lBroodIsaStd*0.95?'good':lBroodAvgWt>=lBroodIsaStd*0.85?'warn':'critical'):'neutral', icon:'⚖️', context:'Growth' },
    { label:'Water Intake',       value:lAvgWater?lAvgWater+' L/bird':'—', sub:'Benchmark '+lWaterBench+' L/bird', delta:waterDelta(lAvgWater,lWaterBench), trend:lAvgWater?(lAvgWater>=lWaterBench*0.85?'up':'down'):'stable', status:lAvgWater?waterStatus(lAvgWater,lWaterBench):'neutral', icon:'💧', context:'Health' },
    { label:'Mortality (7d)',     value:fmt(lBroodDead7), sub:lBroodMortR+'% of flock', delta:lBroodMortR<=0.05?'Within normal range':lBroodMortR<=0.15?'Slightly elevated':'Elevated — investigate', trend:lBroodMortR<=0.05?'up':'down', status:mortalityStatus(lBroodMortR), icon:'📉', context:'Health losses' },
  ] : [];

  const productionLayerKpis = productionLayerSecs.length > 0 ? [
    { label:'Total Birds',    value: fmt(productionLayerSecs.reduce((s,sec)=>s+(sec.currentBirds||0),0)), sub: productionLayerSecs.length+' section'+(productionLayerSecs.length!==1?'s':''), delta:'', trend:'stable', status:'neutral', icon:'🐦', context:'Layer production' },
    { label:'Lay Rate (Today)', value: avgLayRate>0 ? avgLayRate+'%' : '—', sub: 'Target 82%', delta:avgLayRate>0?(avgLayRate>=82?'+'+((avgLayRate-82).toFixed(1))+'% above target':((avgLayRate-82).toFixed(1))+'% below target'):'No data yet', trend:avgLayRate>=82?'up':avgLayRate>0?'down':'stable', status:layRateSecs.length?layRateStatus(avgLayRate):'neutral', icon:'📊', context:'Performance' },
    { label:'Eggs Today',     value: fmt(lEggs),  sub: '7d total '+fmt(lWeekEggs), delta:lEggs>0?fmt(lEggs)+' collected today':'None recorded yet', trend:'stable', status:lEggs>0?'good':'neutral', icon:'🥚', context:'Output' },
    { label:'Grade A Rate',   value: lGradeA ? lGradeA+'%' : '—', sub: 'Target ≥85%', delta:lGradeA?(lGradeA>=85?'+'+((lGradeA-85).toFixed(1))+'% above target':((lGradeA-85).toFixed(1))+'% below target'):'No data yet', trend:lGradeA>=85?'up':'down', status:gradeAStatus(lGradeA), icon:'⭐', context:'Quality' },
    { label:'Water Intake',   value: lAvgWater ? lAvgWater+' L/bird' : '—', sub: 'Benchmark '+lWaterBench+' L/bird · age '+lAvgAge+'d', delta:waterDelta(lAvgWater,lWaterBench), trend:lAvgWater?(lAvgWater>=lWaterBench*0.85?'up':'down'):'stable', status:lAvgWater?waterStatus(lAvgWater,lWaterBench):'neutral', icon:'💧', context:'Health signal' },
    { label:'Mortality (7d)', value: fmt(lDead7), sub: lMortR+'% of flock', delta:lMortR<=0.05?'Within normal range':lMortR<=0.15?'Slightly elevated':'Elevated — investigate', trend:lMortR<=0.05?'up':'down', status:mortalityStatus(lMortR), icon:'📉', context:'Health losses' },
  ] : [];

  // Combined: if mixed show both sets; if pure brooding/rearing show brooding set; else production
  const layerKpis = hasLayer
    ? (productionLayerPens.length === 0 ? broodingLayerKpis
       : broodingLayerKpis.length === 0 ? productionLayerKpis
       : [...broodingLayerKpis, ...productionLayerKpis])
    : [];

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
    <>
      <YesterdayBanner show={showYesterday} />
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
      {/* ── KPI cards — split by stage when mixed ── */}
      {broodingLayerKpis.length > 0 && (broodingLayerSecs.length > 0 || rearingLayerSecs.length > 0) && (
        <OpKpiBlock
          title={broodingLayerSecs.length > 0 && rearingLayerSecs.length > 0
            ? 'Brooding & Rearing'
            : broodingLayerSecs.length > 0 ? 'Layer Brooding' : 'Layer Rearing'}
          opIcon={broodingLayerSecs.length > 0 ? '🐣' : '🌱'}
          isLayer={true}
          cards={broodingLayerKpis} />
      )}
      {productionLayerKpis.length > 0 && (
        <OpKpiBlock
          title="Layer Production"
          opIcon="🥚"
          isLayer={true}
          cards={productionLayerKpis} />
      )}
      <div>
        {broilerKpis.length > 0 && <OpKpiBlock title="Broiler Production" opIcon="🍗" isLayer={false} cards={broilerKpis} />}
      </div>

      {/* ── Toast ── */}
      {verifToast && (
        <div style={{position:'fixed',bottom:24,right:24,zIndex:9999,background:verifToast.ok?'#166534':'#991b1b',color:'#fff',padding:'11px 20px',borderRadius:10,fontSize:13,fontWeight:600,boxShadow:'0 4px 16px rgba(0,0,0,0.2)'}}>
          {verifToast.msg}
        </div>
      )}

      {/* ── Pending Verifications panel ── */}
      <div style={{marginBottom:20,background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',overflow:'hidden'}}>
        {/* Panel header */}
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 16px',borderBottom:'1px solid var(--border-card)',background:'var(--bg-elevated)'}}>
          <span style={{fontSize:14}}>✅</span>
          <span style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:700,color:'var(--text-primary)',flex:1}}>
            Pending Verifications
          </span>
          {!verifLoading && pendingVerifs.length > 0 && (
            <span style={{fontSize:10,fontWeight:800,background:'#fffbeb',color:'#d97706',border:'1px solid #fde68a',borderRadius:99,padding:'2px 9px',animation:'pulse 2s infinite'}}>
              ⏳ {pendingVerifs.length}
            </span>
          )}
          <a href="/verification" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none',marginLeft:8}}>
            All →
          </a>
        </div>

        {verifLoading ? (
          <div style={{padding:'14px 16px',color:'var(--text-muted)',fontSize:12,textAlign:'center'}}>Loading…</div>
        ) : pendingVerifs.length === 0 ? (
          <div style={{padding:'14px 16px',display:'flex',alignItems:'center',gap:8}}>
            <span>🎉</span>
            <span style={{fontSize:12,color:'#16a34a',fontWeight:600}}>All caught up — no records pending</span>
          </div>
        ) : (
          <div style={{maxHeight:320,overflowY:'auto',padding:'8px 10px'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
              {pendingVerifs.map((item, idx) => {
                const TYPE_META = {
                  DAILY_PRODUCTION: { icon:'🥚', color:'#f59e0b', bg:'#fffbeb' },
                  MORTALITY_REPORT: { icon:'💀', color:'#ef4444', bg:'#fef2f2' },
                  FEED_RECEIPT:     { icon:'🌾', color:'#6c63ff', bg:'#f5f3ff' },
                };
                const meta    = TYPE_META[item.type] || { icon:'📋', color:'#64748b', bg:'#f8fafc' };
                const penCtx  = item.context ? item.context.split(' | ')[0].trim() : '—';
                const dateStr = item.date
                  ? new Date(item.date).toLocaleDateString('en-NG',{day:'numeric',month:'short'})
                  : '—';
                const isBlocked = item.coiBlocked;
                // Session label: eggs → Batch 1/2, feed → task session
                const sessionChip = item.referenceType === 'EggProduction' && item.collectionSession != null
                  ? (Number(item.collectionSession) === 1 ? '🌅 Batch 1' : '🌇 Batch 2')
                  : item.referenceType === 'FeedConsumption' && item.sessionLabel
                    ? `🌾 ${item.sessionLabel}`
                    : null;

                return (
                  <div key={item.id || idx} style={{
                    background: isBlocked ? '#fdf4ff' : meta.bg,
                    border: `1px solid ${isBlocked ? '#e9d5ff' : meta.color + '30'}`,
                    borderRadius: 9,
                    padding: '9px 11px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}>
                    {/* Type + date row */}
                    <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'space-between'}}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <span style={{fontSize:12}}>{isBlocked ? '🔒' : meta.icon}</span>
                        <span style={{fontSize:10,fontWeight:700,color:isBlocked?'#9333ea':meta.color,textTransform:'uppercase',letterSpacing:'.04em'}}>
                          {item.type === 'DAILY_PRODUCTION' ? 'Eggs' : item.type === 'MORTALITY_REPORT' ? 'Mortality' : 'Feed'}
                        </span>
                      </div>
                      <span style={{fontSize:9,color:'var(--text-muted)',flexShrink:0}}>{dateStr}</span>
                    </div>

                    {/* Summary */}
                    <div style={{fontSize:11,fontWeight:600,color:'var(--text-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {item.summary}
                    </div>

                    {/* Context */}
                    <div style={{fontSize:10,color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {penCtx}
                    </div>

                    {/* Session chip */}
                    {sessionChip && (
                      <div style={{display:'inline-block',fontSize:9,fontWeight:700,color:'#6c63ff',background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:5,padding:'2px 6px',alignSelf:'flex-start'}}>
                        {sessionChip}
                      </div>
                    )}

                    {/* COI block reason */}
                    {isBlocked && (
                      <div style={{fontSize:9,color:'#7c3aed',fontWeight:600,lineHeight:1.4,background:'#ede9fe',borderRadius:5,padding:'4px 7px'}}>
                        {item.coiReason}
                      </div>
                    )}

                    {/* Action buttons */}
                    {isBlocked ? (
                      <div style={{fontSize:9,color:'#9333ea',fontWeight:700,textAlign:'center',padding:'3px 0',background:'#ede9fe',borderRadius:5}}>
                        Requires Farm Manager
                      </div>
                    ) : (
                      <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:2}}>
                        <div style={{display:'flex',gap:5}}>
                          <button
                            onClick={() => handleVerifyClick(item)}
                            style={{flex:1,padding:'5px 0',borderRadius:5,border:'1px solid #16a34a',background:'#f0fdf4',color:'#16a34a',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                            ✅ Verify
                          </button>
                          <button
                            onClick={() => { setRejectItem(item); setRejectNote(''); setRejectErr(''); }}
                            style={{flex:1,padding:'5px 0',borderRadius:5,border:'1px solid #dc2626',background:'#fef2f2',color:'#dc2626',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                            ↩️ Reject
                          </button>
                        </div>
                        {/* Override — egg/mortality only */}
                        {['EggProduction','MortalityRecord'].includes(item.referenceType) && (
                          <button
                            onClick={() => setOverrideModal(item)}
                            style={{width:'100%',padding:'4px 0',borderRadius:5,border:'1px solid #fde68a',background:'#fffbeb',color:'#92400e',fontSize:9,fontWeight:700,cursor:'pointer'}}>
                            ✏️ PM Override
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Today's Feed Log per Section ── */}
      {(() => {
        // Collect all sections that have feed logged today (task-driven)
        const feedSecs = pens.flatMap(p =>
          (p.sections || [])
            .filter(s => (s.metrics?.todayFeedKg || 0) > 0)
            .map(s => ({
              penName:     p.name,
              sectionName: s.name,
              feedKg:      parseFloat((s.metrics.todayFeedKg || 0).toFixed(1)),
              birds:       s.currentBirds || 0,
              gPerBird:    s.currentBirds > 0
                ? parseFloat(((s.metrics.todayFeedKg||0)*1000/s.currentBirds).toFixed(0))
                : null,
            }))
        );
        return (
          <div style={{marginBottom:20,background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 16px',borderBottom:'1px solid var(--border-card)',background:'var(--bg-elevated)'}}>
              <span style={{fontSize:14}}>🌾</span>
              <span style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:700,color:'var(--text-primary)',flex:1}}>
                Today's Feed Log
              </span>
              <span style={{fontSize:11,color:'var(--text-muted)'}}>Task-driven · per section</span>
              <a href="/feed-requisitions" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none',marginLeft:8}}>
                Requisitions →
              </a>
            </div>
            {feedSecs.length === 0 ? (
              <div style={{padding:'14px 16px',display:'flex',alignItems:'center',gap:8}}>
                <span>⏳</span>
                <span style={{fontSize:12,color:'var(--text-muted)'}}>No feed logged yet today — workers log via feed tasks</span>
              </div>
            ) : (
              <div style={{padding:'8px 12px',display:'flex',flexDirection:'column',gap:6}}>
                {feedSecs.map((s, i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 10px',background:'#fafafa',borderRadius:8,border:'1px solid #f1f5f9'}}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--text-primary)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      {s.penName} › {s.sectionName}
                    </span>
                    <span style={{fontSize:12,fontWeight:800,color:'#6c63ff',flexShrink:0}}>{s.feedKg} kg</span>
                    {s.gPerBird != null && (
                      <span style={{
                        fontSize:10,fontWeight:700,flexShrink:0,padding:'2px 7px',borderRadius:5,
                        background: s.gPerBird > 160 ? '#fef2f2' : s.gPerBird < 80 ? '#eff6ff' : '#f0fdf4',
                        color:      s.gPerBird > 160 ? '#dc2626' : s.gPerBird < 80 ? '#3b82f6' : '#16a34a',
                        border:     `1px solid ${s.gPerBird > 160 ? '#fecaca' : s.gPerBird < 80 ? '#bfdbfe' : '#bbf7d0'}`,
                      }}>
                        {s.gPerBird} g/bird
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Reject modal ── */}
      {rejectItem && (
        <div style={{position:'fixed',inset:0,zIndex:1100,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={e => e.target === e.currentTarget && setRejectItem(null)}>
          <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:420,boxShadow:'0 12px 48px rgba(0,0,0,0.2)',padding:'20px 22px'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:15,marginBottom:14}}>↩️ Reject & Return to Worker</div>
            <div style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px',marginBottom:14,fontSize:12}}>
              <div style={{fontWeight:700,color:'#1e293b',marginBottom:2}}>{rejectItem.summary}</div>
              <div style={{color:'#64748b'}}>{rejectItem.context?.split(' | ')[0]}</div>
            </div>
            {rejectErr && <div style={{background:'#fef2f2',borderRadius:7,padding:'7px 10px',fontSize:12,color:'#dc2626',marginBottom:10}}>{rejectErr}</div>}
            <label style={{display:'block',fontSize:12,fontWeight:700,color:'#475569',marginBottom:5}}>Reason for rejection *</label>
            <textarea
              autoFocus
              rows={3}
              value={rejectNote}
              onChange={e => { setRejectNote(e.target.value); setRejectErr(''); }}
              placeholder="Explain what is incorrect — the worker will be notified to resubmit…"
              style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box'}}
            />
            <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:14}}>
              <button onClick={() => setRejectItem(null)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #e2e8f0',background:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',color:'#64748b'}}>
                Cancel
              </button>
              <button onClick={submitReject} disabled={rejectSaving} style={{padding:'8px 18px',borderRadius:8,border:'none',background:rejectSaving?'#94a3b8':'#dc2626',color:'#fff',fontSize:13,fontWeight:700,cursor:rejectSaving?'not-allowed':'pointer'}}>
                {rejectSaving ? 'Rejecting…' : 'Reject & Notify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── GradingModal — Verify on EggProduction ── */}
      {gradingModal && (
        <GradingModal
          record={gradingModal}
          apiFetch={apiFetch}
          onClose={() => setGradingModal(null)}
          onSave={() => {
            setPendingVerifs(prev => prev.filter(i => i.referenceId !== gradingModal.referenceId));
            setGradingModal(null);
            showVerifToast('✓ Egg record graded and approved');
          }}
        />
      )}

      {/* ── MortalityVerifyModal — Verify on MortalityRecord ── */}
      {mortalityModal && (
        <MortalityVerifyModal
          item={mortalityModal}
          apiFetch={apiFetch}
          onClose={() => setMortalityModal(null)}
          onSave={() => {
            setPendingVerifs(prev => prev.filter(i => i.referenceId !== mortalityModal.referenceId));
            setMortalityModal(null);
            showVerifToast('✓ Mortality record verified');
          }}
        />
      )}

      {/* ── OverrideModal — PM corrects values with mandatory reason ── */}
      {overrideModal && (
        <OverrideModal
          item={overrideModal}
          apiFetch={apiFetch}
          onClose={() => setOverrideModal(null)}
          onSave={() => {
            setPendingVerifs(prev => prev.filter(i => i.referenceId !== overrideModal.referenceId));
            setOverrideModal(null);
            showVerifToast('✓ Override applied — audit trail recorded');
          }}
        />
      )}
      <div style={{fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:12,marginTop:8}}>My Pens</div>
      {pens.map(pen=><PenCard key={pen.id} pen={pen} autoOpen={navTarget?.penId===pen.id} highlightSection={navTarget?.penId===pen.id?navTarget.sectionName:null}/>)}
    </div>
    </>
  );
}

// ── Operation KPI block (Farm Manager / Admin) — cards always visible ────────
// Compact stat for the rearing/brooding awareness strip
function StripStat({ label, value, note, status }) {
  const color = status==='good'?'#16a34a':status==='warn'?'#d97706':status==='critical'?'#dc2626':'#166534';
  return (
    <div style={{display:'flex',flexDirection:'column',gap:1}}>
      <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',color:'#4b7a5c'}}>{label}</span>
      <span style={{fontSize:13,fontWeight:800,color}}>{typeof value==='number'?value.toLocaleString('en-NG'):value}</span>
      {note && <span style={{fontSize:10,color:'#166534'}}>{note}</span>}
    </div>
  );
}

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
      // Farm Manager / Farm Admin: ONE row per pen — never enumerate sections here.
      // Collect the worst flag message from all sections + pen-level flags.
      let worstLevel = penLevel;
      let worstMsg   = null;
      (pen.sections || []).forEach(sec => {
        (sec.flags || []).forEach(flag => {
          const isNoData = flag.msg && /:\s*0(\.0)?%/.test(flag.msg);
          if (isNoData) return;
          const lv = normLevel(flag.type);
          if (!worstMsg || lv === 'critical') { worstLevel = lv === 'critical' ? 'critical' : worstLevel; worstMsg = flag.msg; }
        });
      });
      (pen.flags || []).forEach(flag => {
        const isNoData = flag.msg && /:\s*0(\.0)?%/.test(flag.msg);
        if (!isNoData && !worstMsg) worstMsg = flag.msg;
      });
      const displayMsg = worstMsg || (worstLevel === 'critical' ? 'Critical issue — expand pen to review' : 'Flagged for attention — expand pen to review');
      // sectionName is always null for pens-mode so clicking navigates to the pen card only
      items.push({ penId: pen.id, penName: pen.name, operationType: pen.operationType, sectionName: null, level: worstLevel, msg: displayMsg });
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
function ManagerDashboard({ pens, orgTotals, user, apiFetch , showYesterday }) {
  const router       = useRouter();
  const [navTarget, setNavTarget]       = useState(null); // { penId, sectionName, opType }

  const alerts      = pens.filter(p => p.alertLevel !== 'ok').length;
  const isFarmAdmin = user?.role === 'FARM_ADMIN';
  const roleLabel   = { FARM_MANAGER:'Farm Manager', FARM_ADMIN:'Farm Admin', CHAIRPERSON:'Chairperson', SUPER_ADMIN:'Super Admin' }[user?.role] || user?.role || '';

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

  // ── Layer aggregates — split by stage at SECTION level ─────────────────────
  // Stage splitting uses section-level data to correctly exclude rearing birds
  // from the lay rate denominator. Egg/grade/water metrics use pen-level aggregates
  // which are pre-computed by the API and reliably populated for yesterday mode too.
  const lPens     = layerPens;
  const allLayerSecs = lPens.flatMap(p => (p.sections || []).map(s => ({
    ...s, penName: p.name,
  })));
  const getSectionStage = (s) => s.metrics?.stage || s.flock?.stage || 'PRODUCTION';
  const prodLayerSecs    = allLayerSecs.filter(s => getSectionStage(s) === 'PRODUCTION' && (s.currentBirds || 0) > 0);
  const rearingLayerSecs = allLayerSecs.filter(s => getSectionStage(s) === 'REARING'    && (s.currentBirds || 0) > 0);
  const broodingLayerSecs= allLayerSecs.filter(s => getSectionStage(s) === 'BROODING'   && (s.currentBirds || 0) > 0);
  const nonProdLayerSecs = [...rearingLayerSecs, ...broodingLayerSecs];

  // Bird counts — section level (accurate stage split)
  const lProdBirds = prodLayerSecs.reduce((s,sec)=>s+(sec.currentBirds||0),0);
  const lAllBirds  = lPens.reduce((s,p)=>s+(p.totalBirds||0),0);
  // Use pen-level bird count for total if section-level gives 0 (e.g. sections array empty)
  const lBirds     = lProdBirds > 0 ? lProdBirds : Math.max(0, lAllBirds - nonProdLayerSecs.reduce((s,sec)=>s+(sec.currentBirds||0),0));

  // Egg/grade/water metrics — use pen-level aggregates (reliably populated for yesterday mode)
  const lEggs     = lPens.reduce((s,p)=>s+(p.metrics?.todayEggs||0),0);
  const lWeekEggs = lPens.reduce((s,p)=>s+(p.metrics?.weekEggs||0),0);
  const lDead7    = lPens.reduce((s,p)=>s+(p.metrics?.weekMortality||0),0);
  const lMortR    = lBirds>0 ? parseFloat(((lDead7/lBirds)*100).toFixed(2)) : 0;
  // Lay rate denominator = production birds only (excludes rearing/brooding)
  const lAvgRate  = lBirds > 0 ? parseFloat((lEggs / lBirds * 100).toFixed(1)) : 0;
  const lRates    = lEggs > 0 ? [1] : [];

  // Grade A — pen-level
  const lGAPens   = lPens.filter(p=>(p.metrics?.todayGradeAPct||0)>0);
  const lGradeA   = lGAPens.length ? parseFloat((lGAPens.reduce((s,p)=>s+(p.metrics?.todayGradeAPct||0),0)/lGAPens.length).toFixed(1)) : null;

  // Water — pen-level
  const lWaterPens  = lPens.filter(p=>p.metrics?.avgWaterLPB!=null);
  const lAvgWater   = lWaterPens.length ? parseFloat((lWaterPens.reduce((s,p)=>s+(p.metrics?.avgWaterLPB||0),0)/lWaterPens.length).toFixed(2)) : null;
  const lAvgAge     = prodLayerSecs.length ? Math.round(prodLayerSecs.reduce((s,sec)=>s+(sec.ageInDays||180),0)/prodLayerSecs.length) : 180;
  const lWaterBench = layerWaterBenchmark(lAvgAge);

  // Feed today — section-level (same field as worker chips; not 7d average)
  const lFeedToday  = parseFloat(allLayerSecs.reduce((s,sec)=>s+(sec.metrics?.todayFeedKg||0),0).toFixed(1));

  // Rearing/brooding aggregate for compact awareness strip
  const rearBirds    = nonProdLayerSecs.reduce((s,sec)=>s+(sec.currentBirds||0),0);
  const rearDead7    = nonProdLayerSecs.reduce((s,sec)=>s+(sec.metrics?.weekMortality||0),0);
  const rearMortR    = rearBirds>0 ? parseFloat(((rearDead7/rearBirds)*100).toFixed(2)) : 0;
  const rearWtSecs   = nonProdLayerSecs.filter(sec=>sec.metrics?.latestWeightG!=null);
  const rearAvgWtG   = rearWtSecs.length ? Math.round(rearWtSecs.reduce((s,sec)=>s+(sec.metrics.latestWeightG||0),0)/rearWtSecs.length) : null;
  const rearAvgAge   = nonProdLayerSecs.length ? Math.round(nonProdLayerSecs.reduce((s,sec)=>s+(sec.ageInDays||0),0)/nonProdLayerSecs.length) : null;
  const rearAvgWeeks = rearAvgAge != null ? Math.floor(rearAvgAge / 7) : null;
  // ISA Brown weight target for rearing age
  const isaRearTarget = rearAvgWeeks != null ? ([40,60,100,150,210,280,360,450,550,660,770,880,990,1100,1200,1290,1370,1440][Math.min(rearAvgWeeks,17)] || 1440) : null;
  const rearWeightStatus = rearAvgWtG==null||isaRearTarget==null ? 'neutral'
    : rearAvgWtG >= isaRearTarget * 0.95 ? 'good'
    : rearAvgWtG >= isaRearTarget * 0.85 ? 'warn' : 'critical';
  const hasNonProd = nonProdLayerSecs.length > 0;

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
  // Only count pens that have production sections for the pen count label
  const lProdPens = lPens.filter(p => (p.sections||[]).some(s => getSectionStage(s) === 'PRODUCTION'));
  const eggsLabel = showYesterday ? 'Eggs Yesterday' : 'Eggs Today';
  // Use weekEggs as lay rate source when no same-day eggs (yesterday mode or no collections today)
  const lRateEggs = lEggs > 0 ? lEggs : lWeekEggs;
  const lRateDays = lEggs > 0 ? 1 : 7;
  const lAvgRateCalc = lBirds > 0 && lRateEggs > 0
    ? parseFloat((lRateEggs / lRateDays / lBirds * 100).toFixed(1)) : 0;
  const layerCards = lPens.length ? [
    { label:'Total Birds',    value: fmt(lBirds),                              sub: lProdPens.length + ' production pen' + (lProdPens.length!==1?'s':'') + (nonProdLayerSecs.length>0?' · excl. brooding/rearing':''),  delta:'',  trend:'stable', status:'neutral', icon:'🐦', context:'Layer flock' },
    { label:'Lay Rate',       value: lAvgRateCalc>0 ? lAvgRateCalc+'%' : '—', sub: lEggs>0?'Today vs target 82%':'7d avg vs target 82%',                   delta:lAvgRateCalc>0?(lAvgRateCalc>=82?'+'+((lAvgRateCalc-82).toFixed(1))+'% above target':((lAvgRateCalc-82).toFixed(1))+'% below target'):'No data yet', trend:lAvgRateCalc>=82?'up':lAvgRateCalc>0?'down':'stable', status:lAvgRateCalc>0?layRateStatus(lAvgRateCalc):'neutral', icon:'📊', context:'Performance' },
    { label:'Feed Used Today', value: lFeedToday>0?`${lFeedToday} kg`:'—',    sub: lFeedToday>0&&lBirds>0?`${parseFloat((lFeedToday*1000/lBirds).toFixed(0))} g/bird`:'Task-driven logging', delta:lFeedToday>0?`${lFeedToday} kg distributed`:'No feed logged yet', trend:'stable', status:lFeedToday>0?'good':'neutral', icon:'🌾', context:'All layer pens' },
    { label:eggsLabel,        value: fmt(lEggs),                               sub: '7d total ' + fmt(lWeekEggs),                                            delta:lEggs>0?fmt(lEggs)+' collected':'None recorded yet', trend:'stable', status:lEggs>0?'good':lWeekEggs>0?'warn':'neutral', icon:'🥚', context:'Output' },
    { label:'Grade A Rate',   value: lGradeA ? lGradeA+'%' : '—',             sub: 'Target ≥85%',                                                           delta:lGradeA?(lGradeA>=85?'+'+((lGradeA-85).toFixed(1))+'% above target':((lGradeA-85).toFixed(1))+'% below target'):'No data yet', trend:lGradeA>=85?'up':'down', status:gradeAStatus(lGradeA), icon:'⭐', context:'Quality' },
    { label:'Water Intake',   value: lAvgWater ? lAvgWater+' L/bird' : '—',   sub: 'Benchmark '+lWaterBench+' L/bird · age '+lAvgAge+'d',                   delta:waterDelta(lAvgWater, lWaterBench), trend:lAvgWater?(lAvgWater>=lWaterBench*0.85?'up':'down'):'stable', status:lAvgWater?waterStatus(lAvgWater,lWaterBench):'neutral', icon:'💧', context:'Health signal' },
    { label:'Mortality (7d)', value: fmt(lDead7),                              sub: lMortR+'% of flock',                                                     delta:lMortR<=0.05?'Within normal range':lMortR<=0.15?'Slightly elevated':'Elevated — investigate', trend:lMortR<=0.05?'up':'down', status:mortalityStatus(lMortR), icon:'📉', context:'Health losses' },
    ...(isFarmAdmin ? [{ label:'Est. Revenue (Eggs)', value: lWeekEggs>0?'₦'+Math.round(lWeekEggs*280).toLocaleString():'—', sub:'Est. @ ₦280/egg · 7d total', delta:'Projection', trend:'stable', status:'neutral', icon:'💰', context:'Financial' }] : []),
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
    <>
      <YesterdayBanner show={showYesterday} />
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

      {/* ── Layer Rearing / Brooding compact awareness strip ── */}
      {hasNonProd && (
        <div style={{
          background:'#f0fdf4', borderRadius:10, border:'1px solid #bbf7d0',
          padding:'10px 16px', marginBottom:12,
          display:'flex', alignItems:'center', flexWrap:'wrap', gap:16,
        }}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginRight:4}}>
            <span style={{fontSize:16}}>{broodingLayerSecs.length>0&&rearingLayerSecs.length===0?'🐣':'🌱'}</span>
            <span style={{fontSize:12,fontWeight:700,color:'#166534'}}>
              {broodingLayerSecs.length>0&&rearingLayerSecs.length===0?'Layer Brooding':'Layer Rearing'}
            </span>
          </div>
          <StripStat label="Pullets" value={rearBirds.toLocaleString('en-NG')} />
          {rearAvgWeeks!=null && <StripStat label="Avg Age" value={`Wk ${rearAvgWeeks}`} />}
          {rearAvgWtG!=null && (
            <StripStat
              label="Avg Weight"
              value={`${(rearAvgWtG/1000).toFixed(3)} kg`}
              note={isaRearTarget ? `Target ${(isaRearTarget/1000).toFixed(3)} kg` : null}
              status={rearWeightStatus}
            />
          )}
          <StripStat
            label="Mortality (7d)"
            value={rearDead7}
            note={`${rearMortR}% of flock`}
            status={rearMortR<=0.05?'good':rearMortR<=0.15?'warn':'critical'}
          />
          <div style={{marginLeft:'auto',fontSize:11,color:'#166534',fontStyle:'italic'}}>
            {nonProdLayerSecs.length} section{nonProdLayerSecs.length!==1?'s':''} · not yet in production
          </div>
        </div>
      )}

      {/* Broiler block + harvest popover anchored below it */}
      <div>
        {broilerCards.length>0 && <OpKpiBlock title="Broiler Production" opIcon="🍗" isLayer={false} cards={broilerCards} />}
      </div>

      {/* ── Spot-check tasks panel ── */}
      <SpotCheckPanel apiFetch={apiFetch} user={user} />

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
    </>
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
  const [invSummary,    setInvSummary]    = useState(null);
  const [investigations,setInvestigations]= useState([]);
  const [auditMeta,     setAuditMeta]     = useState(null);
  const [recentAudit,   setRecentAudit]   = useState([]);
  const [overrides,     setOverrides]     = useState([]);
  const [flaggedVerifs, setFlaggedVerifs] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [actionModal,   setActionModal]   = useState(null); // { inv, action }
  const [actionNote,    setActionNote]    = useState('');
  const [actionSaving,  setActionSaving]  = useState(false);
  const [actionErr,     setActionErr]     = useState('');
  const [activeTab,     setActiveTab]     = useState('queue'); // queue | overrides | audit | flagged
  // Override review state: maps entityId → 'acknowledged' | 'flagged'
  const [reviewedOverrides, setReviewedOverrides] = useState({});
  const [overrideModal,     setOverrideModal]     = useState(null); // { log, action }
  const [overrideNote,      setOverrideNote]      = useState('');
  const [overrideSaving,    setOverrideSaving]    = useState(false);
  const [overrideErr,       setOverrideErr]       = useState('');

  const timeAgo = d => {
    const mins = Math.floor((Date.now() - new Date(d)) / 60000);
    if (mins < 60)   return `${mins}m ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
    return `${Math.floor(mins / 1440)}d ago`;
  };
  const fmtDate = d => new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, auditRes, auditFeedRes, verifRes] = await Promise.all([
        apiFetch('/api/investigations?limit=20'),
        apiFetch('/api/audit?limit=1'),
        apiFetch('/api/audit?limit=15&action=APPROVE'),
        apiFetch('/api/verification?status=DISCREPANCY_FOUND&limit=20'),
      ]);
      if (invRes.ok)      { const d = await invRes.json();      setInvSummary(d.summary||{}); setInvestigations(d.investigations||[]); }
      if (auditRes.ok)    { const d = await auditRes.json();    setAuditMeta(d.meta); }
      if (auditFeedRes.ok){ const d = await auditFeedRes.json();
        // Separate overrides (PM_OVERRIDE in changes) from regular approvals
        const all = d.logs || [];
        setOverrides(all.filter(l => l.changes?.action === 'PM_OVERRIDE'));
        setRecentAudit(all.filter(l => l.changes?.action !== 'PM_OVERRIDE').slice(0, 10));

        // Pre-populate reviewed state for any overrides already acknowledged/flagged
        const reviewed = {};
        all.filter(l => l.changes?.action === 'IC_OVERRIDE_ACKNOWLEDGED' || l.changes?.action === 'IC_OVERRIDE_FLAGGED')
          .forEach(l => { reviewed[l.entityId] = l.changes.action === 'IC_OVERRIDE_ACKNOWLEDGED' ? 'acknowledged' : 'flagged'; });
        setReviewedOverrides(reviewed);
      }
      if (verifRes.ok)    { const d = await verifRes.json();    setFlaggedVerifs(d.pendingQueue || []); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const INV_STATUS_META = {
    OPEN:         { label:'Open',         color:'#d97706', bg:'#fffbeb', border:'#fde68a', icon:'🔓' },
    UNDER_REVIEW: { label:'Under Review', color:'#6c63ff', bg:'#f5f3ff', border:'#ddd6fe', icon:'🔍' },
    ESCALATED:    { label:'Escalated',    color:'#9333ea', bg:'#fdf4ff', border:'#e9d5ff', icon:'🔺' },
    CLOSED:       { label:'Closed',       color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', icon:'✓'  },
  };

  const openCount      = invSummary?.OPEN         || 0;
  const reviewCount    = invSummary?.UNDER_REVIEW  || 0;
  const escalatedCount = invSummary?.ESCALATED     || 0;
  const closedCount    = invSummary?.CLOSED        || 0;
  const activeCount    = openCount + reviewCount + escalatedCount;

  // ── Investigation inline actions ─────────────────────────────────────────────
  const openAction = (inv, action) => {
    setActionModal({ inv, action });
    setActionNote('');
    setActionErr('');
  };

  const submitAction = async () => {
    const { inv, action } = actionModal;
    if ((action === 'escalate' || action === 'close') && !actionNote.trim()) {
      setActionErr(action === 'close' ? 'Findings are required to close an investigation' : 'Notes are required to escalate');
      return;
    }
    setActionSaving(true); setActionErr('');
    try {
      const body = { action };
      if (action === 'escalate') body.findings  = actionNote.trim();
      if (action === 'close')    body.findings  = actionNote.trim();
      const res = await apiFetch(`/api/investigations/${inv.id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      let d = {};
      try { d = await res.json(); } catch {}
      if (!res.ok) { setActionErr(d.error || `Failed to ${action}`); return; }
      setActionModal(null);
      // Optimistically update local state
      setInvestigations(prev => prev.map(i =>
        i.id === inv.id ? { ...i, ...d.investigation } : i
      ));
      // Refresh summary counts
      const sumRes = await apiFetch('/api/investigations?limit=1');
      if (sumRes.ok) { const sd = await sumRes.json(); setInvSummary(sd.summary || {}); }
    } catch { setActionErr('Network error — please try again'); }
    finally  { setActionSaving(false); }
  };

  // ── Override review submit ───────────────────────────────────────────────────
  const submitOverrideReview = async () => {
    if (!overrideNote.trim()) { setOverrideErr('A review note is required'); return; }
    setOverrideSaving(true); setOverrideErr('');
    try {
      const res = await apiFetch('/api/audit/acknowledge', {
        method: 'POST',
        body: JSON.stringify({
          entityType: overrideModal.log.entityType,
          entityId:   overrideModal.log.entityId,
          action:     overrideModal.action, // 'IC_OVERRIDE_ACKNOWLEDGED' | 'IC_OVERRIDE_FLAGGED'
          reviewNote: overrideNote.trim(),
        }),
      });
      let d = {};
      try { d = await res.json(); } catch {}
      if (!res.ok) { setOverrideErr(d.error || 'Failed to record review'); return; }
      // Mark this override as reviewed in local state
      setReviewedOverrides(prev => ({
        ...prev,
        [overrideModal.log.entityId]: overrideModal.action === 'IC_OVERRIDE_ACKNOWLEDGED' ? 'acknowledged' : 'flagged',
      }));
      setOverrideModal(null);
    } catch { setOverrideErr('Network error — please try again'); }
    finally  { setOverrideSaving(false); }
  };

  const TABS = [
    { key:'queue',    label:'🔍 Investigation Queue', badge: activeCount || null },
    { key:'flagged',  label:'🚩 Flagged Records',     badge: flaggedVerifs.length || null },
    { key:'overrides',label:'✏️ PM Overrides',         badge: overrides.length  || null },
    { key:'audit',    label:'📋 Audit Feed',           badge: null },
  ];

  const ACTION_LABELS = {
    review:   { title:'Mark Under Review',  btn:'Start Review',  color:'#6c63ff', needsNote:false },
    escalate: { title:'Escalate to Chair',  btn:'Escalate',      color:'#9333ea', needsNote:true,  placeholder:'Summarise findings and reason for escalation…' },
    close:    { title:'Close Investigation',btn:'Close & Record', color:'#16a34a', needsNote:true,  placeholder:'Record your findings and conclusion…' },
  };

  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {[1,2,3].map(i=><div key={i} className="card" style={{height:80,opacity:.4,animation:'pulse 1.5s ease-in-out infinite'}}/>)}
    </div>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>

      {/* ── Header ── */}
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

      {/* ── KPI row ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12}}>
        {[
          { icon:'🔓', label:'Open',              value:openCount,      color:'#d97706', urgent:openCount>5 },
          { icon:'🔍', label:'Under Review',       value:reviewCount,    color:'#6c63ff', urgent:false },
          { icon:'🔺', label:'Escalated',          value:escalatedCount, color:'#9333ea', urgent:escalatedCount>0 },
          { icon:'✓',  label:'Closed (All Time)',  value:closedCount,    color:'#16a34a', urgent:false },
          { icon:'✏️', label:'PM Overrides',        value:overrides.length, color:'#d97706', urgent:false },
          { icon:'📋', label:'Total Audit Events', value:auditMeta ? auditMeta.actionCounts.reduce((s,a)=>s+a.count,0).toLocaleString():'—', color:'var(--purple)', urgent:false },
        ].map(k=>(
          <div key={k.label} style={{background:k.urgent?'#fef2f2':'#fff',borderRadius:12,padding:'16px 18px',border:`1px solid ${k.urgent?'#fecaca':'var(--border-card)'}`,boxShadow:'0 1px 4px rgba(0,0,0,0.04)',display:'flex',alignItems:'flex-start',gap:12}}>
            <div style={{width:38,height:38,borderRadius:9,flexShrink:0,background:`${k.urgent?'#ef4444':k.color}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{k.icon}</div>
            <div>
              <div style={{fontSize:20,fontWeight:800,color:k.urgent?'#dc2626':'var(--text-primary)',lineHeight:1.1}}>{k.value}</div>
              <div style={{fontSize:11,fontWeight:600,color:'var(--text-secondary)',marginTop:2}}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Active investigations banner ── */}
      {activeCount > 0 && (
        <div style={{padding:'13px 18px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:12,display:'flex',alignItems:'center',gap:14}}>
          <span style={{fontSize:22}}>⚠️</span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:'#92400e'}}>{activeCount} active investigation{activeCount!==1?'s':''} require attention</div>
            <div style={{fontSize:11,color:'#d97706',marginTop:2}}>
              {openCount>0&&`${openCount} open`}{openCount>0&&reviewCount>0?' · ':''}{reviewCount>0&&`${reviewCount} under review`}{escalatedCount>0&&` · ${escalatedCount} escalated`}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{display:'flex',gap:4,background:'var(--bg-elevated)',borderRadius:11,padding:4,border:'1px solid var(--border)',width:'fit-content',flexWrap:'wrap'}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:8,border:'none',fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:'pointer',transition:'all 0.15s',
              background:activeTab===t.key?'#fff':'transparent',
              color:activeTab===t.key?'var(--purple)':'var(--text-muted)',
              boxShadow:activeTab===t.key?'0 1px 4px rgba(0,0,0,0.08)':'none',
            }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{background:activeTab===t.key?'var(--purple)':'#94a3b8',color:'#fff',borderRadius:99,fontSize:9,fontWeight:800,padding:'1px 6px',lineHeight:'14px'}}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════ TAB: INVESTIGATION QUEUE ══════════ */}
      {activeTab === 'queue' && (
        <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:800,color:'var(--text-primary)'}}>🚩 Investigation Queue</div>
            <a href="/audit" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none'}}>Full audit page →</a>
          </div>
          {investigations.length === 0 ? (
            <div style={{padding:'48px 24px',textAlign:'center',color:'var(--text-muted)'}}>
              <div style={{fontSize:36,marginBottom:10}}>🎉</div>
              <div style={{fontSize:14,fontWeight:600,color:'#16a34a'}}>No open investigations</div>
              <div style={{fontSize:12,marginTop:4}}>All records clear</div>
            </div>
          ) : (
            <div>
              {investigations.map((inv, idx) => {
                const sm  = INV_STATUS_META[inv.status] || INV_STATUS_META.OPEN;
                const isActive = ['OPEN','UNDER_REVIEW'].includes(inv.status);
                return (
                  <div key={inv.id} style={{padding:'14px 20px',borderBottom:idx<investigations.length-1?'1px solid var(--border-card)':'none',display:'flex',alignItems:'flex-start',gap:14,background:inv.status==='ESCALATED'?'#fdf4ff':'#fff'}}>
                    {/* Status icon */}
                    <div style={{width:34,height:34,borderRadius:9,flexShrink:0,background:sm.bg,border:`1px solid ${sm.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>{sm.icon}</div>

                    {/* Content */}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                        <span style={{fontSize:12,fontWeight:700,color:'var(--text-primary)'}}>{inv.referenceType}</span>
                        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:99,background:sm.bg,color:sm.color,border:`1px solid ${sm.border}`}}>{sm.label}</span>
                        <span style={{fontSize:10,color:'var(--text-muted)'}}>{timeAgo(inv.createdAt)}</span>
                      </div>
                      <div style={{fontSize:12,color:'var(--text-secondary)',marginBottom:4,lineHeight:1.4}}>{inv.flagReason}</div>
                      {inv.findings && (
                        <div style={{fontSize:11,color:'var(--text-muted)',background:'var(--bg-elevated)',padding:'5px 9px',borderRadius:6,marginBottom:4,fontStyle:'italic'}}>
                          Findings: {inv.findings}
                        </div>
                      )}
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>
                        Flagged by {inv.flaggedBy?.firstName} {inv.flaggedBy?.lastName}
                        {inv.escalatedTo && ` · Escalated to ${inv.escalatedTo.firstName} ${inv.escalatedTo.lastName}`}
                      </div>
                    </div>

                    {/* Action buttons — only for active investigations */}
                    {isActive && (
                      <div style={{display:'flex',flexDirection:'column',gap:5,flexShrink:0}}>
                        {inv.status === 'OPEN' && (
                          <button onClick={() => openAction(inv, 'review')}
                            style={{padding:'5px 11px',borderRadius:7,border:'1px solid #ddd6fe',background:'#f5f3ff',color:'#6c63ff',fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                            🔍 Review
                          </button>
                        )}
                        <button onClick={() => openAction(inv, 'escalate')}
                          style={{padding:'5px 11px',borderRadius:7,border:'1px solid #e9d5ff',background:'#fdf4ff',color:'#9333ea',fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                          🔺 Escalate
                        </button>
                        <button onClick={() => openAction(inv, 'close')}
                          style={{padding:'5px 11px',borderRadius:7,border:'1px solid #bbf7d0',background:'#f0fdf4',color:'#16a34a',fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                          ✓ Close
                        </button>
                      </div>
                    )}
                    {inv.status === 'CLOSED' && (
                      <span style={{fontSize:9,fontWeight:700,color:'#16a34a',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:99,padding:'3px 8px',flexShrink:0,alignSelf:'flex-start'}}>CLOSED</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: FLAGGED RECORDS ══════════ */}
      {activeTab === 'flagged' && (
        <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:800,color:'var(--text-primary)'}}>🚩 Flagged Records (Verification Queue)</div>
            <a href="/verification" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none'}}>Go to verification →</a>
          </div>
          {flaggedVerifs.length === 0 ? (
            <div style={{padding:'48px 24px',textAlign:'center',color:'var(--text-muted)'}}>
              <div style={{fontSize:36,marginBottom:10}}>✅</div>
              <div style={{fontSize:14,fontWeight:600,color:'#16a34a'}}>No flagged records</div>
            </div>
          ) : (
            <div>
              {flaggedVerifs.map((item, idx) => (
                <div key={item.id||idx} style={{padding:'13px 20px',borderBottom:idx<flaggedVerifs.length-1?'1px solid var(--border-card)':'none',display:'flex',alignItems:'flex-start',gap:12}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:'#9333ea',flexShrink:0,marginTop:5}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,color:'var(--text-primary)',marginBottom:2}}>{item.summary}</div>
                    <div style={{fontSize:11,color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.context}</div>
                    {item.discrepancyNotes && (
                      <div style={{fontSize:11,color:'#9333ea',marginTop:3,fontStyle:'italic'}}>⚑ {item.discrepancyNotes}</div>
                    )}
                    <div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>
                      Submitted by {item.submittedBy} · {item.date ? fmtDate(item.date) : ''}
                    </div>
                  </div>
                  <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:99,background:'#fdf4ff',color:'#9333ea',border:'1px solid #e9d5ff',flexShrink:0}}>
                    Flagged
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: PM OVERRIDES ══════════ */}
      {activeTab === 'overrides' && (
        <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',overflow:'hidden'}}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:800,color:'var(--text-primary)'}}>✏️ Recent PM Overrides</div>
            <a href="/audit" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none'}}>Full audit log →</a>
          </div>
          {overrides.length === 0 ? (
            <div style={{padding:'48px 24px',textAlign:'center',color:'var(--text-muted)'}}>
              <div style={{fontSize:36,marginBottom:10}}>✅</div>
              <div style={{fontSize:14,fontWeight:600,color:'#16a34a'}}>No PM overrides recorded</div>
            </div>
          ) : (
            <div>
              {overrides.map((log, idx) => {
                const orig = log.changes?.originalValues  || {};
                const corr = log.changes?.overriddenValues || {};
                const reason = log.changes?.overrideReason || '—';
                const isEgg = log.entityType === 'EggProduction';
                return (
                  <div key={log.id} style={{padding:'14px 20px',borderBottom:idx<overrides.length-1?'1px solid var(--border-card)':'none'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
                      <div style={{width:34,height:34,borderRadius:9,flexShrink:0,background:'#fffbeb',border:'1px solid #fde68a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>✏️</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                          <span style={{fontSize:12,fontWeight:700,color:'var(--text-primary)'}}>{log.entityType} Override</span>
                          <span style={{fontSize:10,color:'var(--text-muted)'}}>{timeAgo(log.createdAt)}</span>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                          <div style={{padding:'8px 10px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:7,fontSize:11}}>
                            <div style={{fontWeight:700,color:'var(--text-muted)',marginBottom:4,fontSize:9,textTransform:'uppercase',letterSpacing:'0.05em'}}>📋 Original</div>
                            {isEgg ? (<>
                              <div>Crates: <strong>{orig.cratesCollected ?? '—'}</strong></div>
                              <div>Loose: <strong>{orig.looseEggs ?? '—'}</strong> · Cracked: <strong>{orig.crackedCount ?? '—'}</strong></div>
                              <div style={{marginTop:3,fontWeight:700}}>Total: {orig.totalEggs ?? '—'} eggs</div>
                            </>) : (<>
                              <div>Deaths: <strong>{orig.count ?? '—'}</strong></div>
                              <div>Cause: <strong>{orig.causeCode?.replace(/_/g,' ') ?? '—'}</strong></div>
                            </>)}
                          </div>
                          <div style={{padding:'8px 10px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:7,fontSize:11}}>
                            <div style={{fontWeight:700,color:'#92400e',marginBottom:4,fontSize:9,textTransform:'uppercase',letterSpacing:'0.05em'}}>✏️ Corrected</div>
                            {isEgg ? (<>
                              <div>Crates: <strong>{corr.cratesCollected ?? '—'}</strong></div>
                              <div>Loose: <strong>{corr.looseEggs ?? '—'}</strong> · Cracked: <strong>{corr.crackedCount ?? '—'}</strong></div>
                              <div style={{marginTop:3,fontWeight:700,color:'#d97706'}}>Total: {corr.totalEggs ?? '—'} eggs</div>
                            </>) : (<>
                              <div>Deaths: <strong>{corr.count ?? '—'}</strong></div>
                              <div>Cause: <strong>{corr.causeCode?.replace(/_/g,' ') ?? '—'}</strong></div>
                            </>)}
                          </div>
                        </div>
                        <div style={{padding:'7px 10px',background:'#f5f3ff',border:'1px solid #ddd6fe',borderRadius:7,fontSize:11,color:'var(--text-secondary)'}}>
                          <span style={{fontWeight:700,color:'var(--purple)'}}>Override Reason: </span>{reason}
                        </div>
                        <div style={{fontSize:10,color:'var(--text-muted)',marginTop:6}}>
                          By {log.user?.firstName} {log.user?.lastName} ({log.user?.role?.replace(/_/g,' ')})
                        </div>
                      </div>

                      {/* Action buttons — right side, vertically centred */}
                      <div style={{display:'flex',flexDirection:'column',gap:5,flexShrink:0,alignSelf:'center'}}>
                        {reviewedOverrides[log.entityId] === 'acknowledged' && (
                          <span style={{fontSize:9,fontWeight:700,padding:'4px 9px',borderRadius:99,background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0',textAlign:'center'}}>✓ Acknowledged</span>
                        )}
                        {reviewedOverrides[log.entityId] === 'flagged' && (
                          <span style={{fontSize:9,fontWeight:700,padding:'4px 9px',borderRadius:99,background:'#fdf4ff',color:'#9333ea',border:'1px solid #e9d5ff',textAlign:'center'}}>🚩 Flagged</span>
                        )}
                        {!reviewedOverrides[log.entityId] && (<>
                          <button
                            onClick={() => { setOverrideModal({ log, action:'IC_OVERRIDE_ACKNOWLEDGED' }); setOverrideNote(''); setOverrideErr(''); }}
                            style={{padding:'5px 11px',borderRadius:7,border:'1px solid #bbf7d0',background:'#f0fdf4',color:'#16a34a',fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                            ✓ Acknowledge
                          </button>
                          <button
                            onClick={() => { setOverrideModal({ log, action:'IC_OVERRIDE_FLAGGED' }); setOverrideNote(''); setOverrideErr(''); }}
                            style={{padding:'5px 11px',borderRadius:7,border:'1px solid #e9d5ff',background:'#fdf4ff',color:'#9333ea',fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>
                            🚩 Flag
                          </button>
                        </>)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: AUDIT FEED ══════════ */}
      {activeTab === 'audit' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {/* Recent approvals feed */}
          <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',overflow:'hidden'}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border-card)',fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:800,color:'var(--text-primary)'}}>
              ✅ Recent Approvals
            </div>
            {recentAudit.length === 0 ? (
              <div style={{padding:'32px',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>No recent approvals</div>
            ) : (
              <div style={{maxHeight:340,overflowY:'auto'}}>
                {recentAudit.map((log, idx) => (
                  <div key={log.id} style={{padding:'10px 16px',borderBottom:idx<recentAudit.length-1?'1px solid var(--border-card)':'none',display:'flex',alignItems:'flex-start',gap:10}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:'#16a34a',flexShrink:0,marginTop:5}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--text-primary)'}}>{log.entityType}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {log.user?.firstName} {log.user?.lastName} · {timeAgo(log.createdAt)}
                      </div>
                    </div>
                    <span style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:99,background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0',flexShrink:0}}>
                      {log.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit action breakdown */}
          <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',overflow:'hidden'}}>
            <div style={{padding:'14px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:800,color:'var(--text-primary)'}}>📊 Audit Breakdown</div>
              <a href="/audit" style={{fontSize:11,fontWeight:700,color:'var(--purple)',textDecoration:'none'}}>Full log →</a>
            </div>
            {!auditMeta ? (
              <div style={{padding:'32px',textAlign:'center',color:'var(--text-muted)',fontSize:12}}>No audit data</div>
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
      )}

      {/* ── Spot-check panel ── */}
      <SpotCheckPanel apiFetch={apiFetch} user={user} />

      {/* ── Quick links ── */}
      <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)',padding:'16px 20px'}}>
        <div style={{fontSize:12,fontWeight:800,color:'var(--text-primary)',fontFamily:"'Poppins',sans-serif",marginBottom:12}}>🔗 Quick Actions</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8}}>
          {[
            {href:'/audit',        icon:'📋', label:'Audit Log',      sub:'Browse all events'},
            {href:'/audit',        icon:'🚩', label:'Investigations', sub:'Manage flags'},
            {href:'/verification', icon:'✅', label:'Verifications',  sub:'Flagged records'},
            {href:'/feed',         icon:'🌾', label:'Feed Records',   sub:'Receipts & issuances'},
            {href:'/farm',         icon:'🐦', label:'Flock Records',  sub:'Production & health'},
          ].map(link=>(
            <a key={link.label} href={link.href}
              style={{display:'flex',flexDirection:'column',gap:3,padding:'12px 14px',borderRadius:9,border:'1px solid var(--border-card)',textDecoration:'none',background:'#fafafa'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--purple)';e.currentTarget.style.background='#f5f3ff';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border-card)';e.currentTarget.style.background='#fafafa';}}>
              <span style={{fontSize:18}}>{link.icon}</span>
              <span style={{fontSize:11,fontWeight:700,color:'var(--text-primary)'}}>{link.label}</span>
              <span style={{fontSize:10,color:'var(--text-muted)'}}>{link.sub}</span>
            </a>
          ))}
        </div>
      </div>

      {/* ── Investigation action modal ── */}
      {actionModal && (() => {
        const meta = ACTION_LABELS[actionModal.action];
        return createPortal(
          <div style={{position:'fixed',inset:0,zIndex:1200,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
            onClick={e=>e.target===e.currentTarget&&setActionModal(null)}>
            <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:440,boxShadow:'0 12px 48px rgba(0,0,0,0.2)'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:14,color:'var(--text-primary)'}}>{meta.title}</span>
                <button onClick={()=>setActionModal(null)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--text-muted)'}}>×</button>
              </div>
              <div style={{padding:'16px 20px'}}>
                {/* Investigation summary */}
                <div style={{padding:'10px 14px',background:'var(--bg-elevated)',borderRadius:9,marginBottom:14,fontSize:12}}>
                  <div style={{fontWeight:700,color:'var(--text-primary)',marginBottom:2}}>{actionModal.inv.referenceType}</div>
                  <div style={{color:'var(--text-muted)'}}>{actionModal.inv.flagReason}</div>
                </div>
                {actionErr && (
                  <div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:12,color:'#dc2626',marginBottom:12}}>⚠ {actionErr}</div>
                )}
                {meta.needsNote && (
                  <div style={{marginBottom:4}}>
                    <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-secondary)',marginBottom:5}}>
                      {actionModal.action === 'close' ? 'Findings *' : 'Notes *'}
                    </label>
                    <textarea autoFocus rows={3} value={actionNote}
                      onChange={e=>{setActionNote(e.target.value);setActionErr('');}}
                      placeholder={meta.placeholder}
                      style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:12,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box'}}
                    />
                  </div>
                )}
              </div>
              <div style={{padding:'12px 20px',borderTop:'1px solid var(--border-card)',display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setActionModal(null)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border-card)',background:'#fff',color:'var(--text-secondary)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                  Cancel
                </button>
                <button onClick={submitAction} disabled={actionSaving}
                  style={{padding:'8px 18px',borderRadius:8,border:'none',background:actionSaving?'#94a3b8':meta.color,color:'#fff',fontSize:12,fontWeight:700,cursor:actionSaving?'not-allowed':'pointer'}}>
                  {actionSaving ? 'Saving…' : meta.btn}
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
      {/* ── Override review modal ── */}
      {overrideModal && (() => {
        const isFlag = overrideModal.action === 'IC_OVERRIDE_FLAGGED';
        return createPortal(
          <div style={{position:'fixed',inset:0,zIndex:1200,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
            onClick={e=>e.target===e.currentTarget&&setOverrideModal(null)}>
            <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:460,boxShadow:'0 12px 48px rgba(0,0,0,0.2)'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:14,color:'var(--text-primary)'}}>
                  {isFlag ? '🚩 Flag Override for Investigation' : '✓ Acknowledge Override'}
                </span>
                <button onClick={()=>setOverrideModal(null)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--text-muted)'}}>×</button>
              </div>
              <div style={{padding:'16px 20px'}}>
                {/* Context */}
                <div style={{padding:'10px 14px',background:isFlag?'#fdf4ff':'#f0fdf4',border:`1px solid ${isFlag?'#e9d5ff':'#bbf7d0'}`,borderRadius:9,marginBottom:14,fontSize:12}}>
                  <div style={{fontWeight:700,color:isFlag?'#9333ea':'#16a34a',marginBottom:3}}>
                    {isFlag ? '⚠️ You are flagging this override for investigation' : '✅ You are acknowledging this override as reviewed'}
                  </div>
                  <div style={{color:'var(--text-secondary)',lineHeight:1.5}}>
                    {isFlag
                      ? 'A formal investigation will be opened linked to this record. The override reason and your findings will be recorded in the audit trail.'
                      : 'Your review will be permanently recorded in the audit trail confirming this override was independently checked by IC.'}
                  </div>
                </div>
                {/* Override reason reminder */}
                <div style={{padding:'8px 12px',background:'var(--bg-elevated)',borderRadius:8,marginBottom:14,fontSize:11}}>
                  <span style={{fontWeight:700,color:'var(--purple)'}}>PM's override reason: </span>
                  <span style={{color:'var(--text-secondary)'}}>{overrideModal.log.changes?.overrideReason || '—'}</span>
                </div>
                {overrideErr && (
                  <div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:12,color:'#dc2626',marginBottom:12}}>⚠ {overrideErr}</div>
                )}
                <div>
                  <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-secondary)',marginBottom:5}}>
                    {isFlag ? 'Reason for flagging *' : 'Review note *'}
                  </label>
                  <textarea autoFocus rows={3} value={overrideNote}
                    onChange={e=>{setOverrideNote(e.target.value);setOverrideErr('');}}
                    placeholder={isFlag
                      ? 'State why this override appears suspicious or requires investigation…'
                      : 'Note your findings — e.g. recount verified, reason accepted…'}
                    style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:12,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box'}}
                  />
                </div>
              </div>
              <div style={{padding:'12px 20px',borderTop:'1px solid var(--border-card)',display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setOverrideModal(null)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border-card)',background:'#fff',color:'var(--text-secondary)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                  Cancel
                </button>
                <button onClick={submitOverrideReview} disabled={overrideSaving}
                  style={{padding:'8px 18px',borderRadius:8,border:'none',background:overrideSaving?'#94a3b8':isFlag?'#9333ea':'#16a34a',color:'#fff',fontSize:12,fontWeight:700,cursor:overrideSaving?'not-allowed':'pointer'}}>
                  {overrideSaving ? 'Saving…' : isFlag ? '🚩 Flag for Investigation' : '✓ Acknowledge & Record'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}
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
  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [showYesterday, setShowYesterday] = useState(false);

  const STORE_ROLES = ['STORE_MANAGER', 'STORE_CLERK'];
  const MILL_ROLES  = ['FEED_MILL_MANAGER'];
  const QC_ROLES    = ['QC_TECHNICIAN'];
  const role        = user?.role;

  const useStoreDashboard = role && (STORE_ROLES.includes(role) || MILL_ROLES.includes(role) || QC_ROLES.includes(role));

  const load = useCallback(async () => {
    try {
      const endpoint = useStoreDashboard ? '/api/dashboard/store' : '/api/dashboard';
      const url = showYesterday
        ? endpoint + '?date=yesterday'
        : endpoint;
      const res = await apiFetch(url);
      if (res.ok) { setData(await res.json()); setError(null); }
      else setError('Could not load dashboard data');
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }, [apiFetch, useStoreDashboard, showYesterday]);

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
        {/* Yesterday toggle — visible for all farm operation roles */}
        {(isPenWorker || isPenMgr || isManager) && (
          <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
            <button
              onClick={() => setShowYesterday(v => !v)}
              className="yesterday-toggle"
              style={{
                padding:'5px 14px', borderRadius:20, border:'1.5px solid',
                borderColor: showYesterday ? '#6c63ff' : '#e2e8f0',
                background:  showYesterday ? '#eeecff' : '#fff',
                color:       showYesterday ? '#6c63ff' : '#64748b',
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              {showYesterday ? '📅 Yesterday' : '📅 Yesterday'}
              <span style={{
                width: 28, height: 16, borderRadius: 99,
                background: showYesterday ? '#6c63ff' : '#cbd5e1',
                position: 'relative', display: 'inline-flex',
                alignItems: 'center', transition: 'background .2s',
              }}>
                <span style={{
                  width: 12, height: 12, borderRadius: '50%', background: '#fff',
                  position: 'absolute', left: showYesterday ? 14 : 2,
                  transition: 'left .2s',
                }}/>
              </span>
            </button>
          </div>
        )}
        {isPenWorker && sections.length>0 && <WorkerDashboard sections={sections} tasks={tasks} user={user} apiFetch={apiFetch} showYesterday={showYesterday}/>}
        {isPenMgr    && <PenManagerDashboard pens={pens} tasks={tasks} user={user} apiFetch={apiFetch} showYesterday={showYesterday}/>}
        {isManager   && <ManagerDashboard pens={pens} orgTotals={orgTotals} user={user} apiFetch={apiFetch} showYesterday={showYesterday}/>}
      </div>
    </AppShell>
  );
}
