'use client';
// app/broiler-performance/page.js — Broiler Performance (formerly Weight Tracking)
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import PortalModal from '@/components/ui/Modal';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const PERIOD_OPTIONS = [7, 14, 30, 60];
const fmt      = n => Number(n || 0).toLocaleString('en-NG');
const fmtDate  = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
const fmtWt    = g => g != null ? `${(g / 1000).toFixed(2)} kg` : '—';

// ── Ross 308 standard weight curve (g) by age in days ────────────────────────
const ROSS_308 = {
  7:190, 14:430, 21:790, 28:1240, 35:1780, 42:2380, 49:2900,
};
function getStandardWeight(ageInDays) {
  const keys = Object.keys(ROSS_308).map(Number).sort((a,b)=>a-b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (ageInDays >= keys[i]) return ROSS_308[keys[i]];
  }
  return ROSS_308[7];
}

// ── Status helpers ────────────────────────────────────────────────────────────
function fcrStatus(f)         { if (!f) return 'neutral'; return f<=1.9?'good':f<=2.0?'warn':'critical'; }
function mortalityStatus(r7d) { if (r7d==null) return 'neutral'; return r7d<=0.1?'good':r7d<=0.2?'warn':'critical'; }
function waterStatus(a, b)    { if (!a||!b) return 'neutral'; const r=a/b; return r>=0.85?'good':r>=0.65?'warn':'critical'; }
function weightStatus(actual, standard) {
  if (!actual || !standard) return 'neutral';
  const pct = actual / standard;
  return pct >= 0.95 ? 'good' : pct >= 0.85 ? 'warn' : 'critical';
}
function broilerWaterBenchmark(age) {
  if (!age) return 0.25;
  if (age <= 7)  return 0.04;
  if (age <= 21) return 0.12;
  if (age <= 35) return 0.22;
  return 0.30;
}

const STATUS_COLOR  = { good:'#16a34a', warn:'#d97706', critical:'#ef4444', neutral:'#6b7280' };
const STATUS_BG     = { good:'#f0fdf4', warn:'#fffbeb', critical:'#fef2f2', neutral:'#f8fafc' };
const STATUS_BORDER = { good:'#bbf7d0', warn:'#fde68a', critical:'#fecaca', neutral:'#e2e8f0' };

// ── KPI Cards ─────────────────────────────────────────────────────────────────
function PerfKpiCard({ icon, label, value, sub, delta, status = 'neutral' }) {
  const col = STATUS_COLOR[status];
  const bg  = STATUS_BG[status];
  const bdr = STATUS_BORDER[status];
  return (
    <div style={{ background: bg, border: `1.5px solid ${bdr}`, borderRadius: 14, padding: '16px 18px', display:'flex', flexDirection:'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 24, fontWeight: 700, color: col, lineHeight: 1 }}>{value}</div>
      {sub   && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
      {delta && <div style={{ fontSize: 11, fontWeight: 600, color: col }}>{delta}</div>}
    </div>
  );
}

function SimpleKpiCard({ icon, label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 24, fontWeight: 700, color: color || 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Skeleton({ h = 60 }) {
  return <div style={{ height: h, background: 'var(--bg-elevated)', borderRadius: 8, animation: 'pulse 1.5s infinite' }} />;
}

function EmptyState({ msg = 'No data for this period' }) {
  return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{msg}</div>;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 14px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Log Weight Modal ──────────────────────────────────────────────────────────
function LogWeightModal({ flocks, onClose, onSave, apiFetch }) {
  const [form, setForm] = useState({
    flockId: '', penSectionId: '', sampleDate: new Date().toISOString().split('T')[0],
    sampleCount: '', meanWeightG: '', minWeightG: '', maxWeightG: '', uniformityPct: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectedFlock = flocks.find(f => f.id === form.flockId);
  const standard = selectedFlock?.ageInDays ? getStandardWeight(selectedFlock.ageInDays) : null;
  const meanG    = Number(form.meanWeightG) || 0;
  const vsStd    = standard && meanG ? ((meanG / standard - 1) * 100).toFixed(1) : null;

  async function save() {
    if (!form.flockId)    return setError('Select a flock');
    if (!form.sampleCount || Number(form.sampleCount) < 1) return setError('Enter sample count');
    if (!form.meanWeightG || meanG <= 0) return setError('Enter mean weight');
    setSaving(true); setError('');
    try {
      const payload = {
        flockId:       form.flockId,
        penSectionId:  form.penSectionId,
        sampleDate:    form.sampleDate,
        sampleCount:   Number(form.sampleCount),
        meanWeightG:   meanG,
        ...(form.minWeightG   && { minWeightG:   Number(form.minWeightG) }),
        ...(form.maxWeightG   && { maxWeightG:   Number(form.maxWeightG) }),
        ...(form.uniformityPct && { uniformityPct: Number(form.uniformityPct) }),
      };
      const res = await apiFetch('/api/weight-samples', { method: 'POST', body: JSON.stringify(payload) });
      const d   = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <PortalModal title="⚖️ Log Weight Sample" width={480} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Record'}</button></>}>
      {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>⚠ {error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label">Broiler Flock *</label>
          <select className="input" value={form.flockId} onChange={e => {
            const f = flocks.find(x => x.id === e.target.value);
            set('flockId', e.target.value);
            set('penSectionId', f?.penSectionId || '');
          }}>
            <option value="">— Select flock —</option>
            {flocks.map(f => (
              <option key={f.id} value={f.id}>
                {f.batchCode} · {f.penSection?.pen?.name} › {f.penSection?.name} · {fmt(f.currentCount)} birds · age {f.ageInDays}d
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Sample Date *</label>
          <input type="date" className="input" value={form.sampleDate} onChange={e => set('sampleDate', e.target.value)} max={new Date().toISOString().split('T')[0]} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Birds Sampled *</label>
            <input type="number" className="input" min="1" value={form.sampleCount} onChange={e => set('sampleCount', e.target.value)} placeholder="e.g. 50" />
          </div>
          <div>
            <label className="label">Mean Weight (g) *</label>
            <input type="number" className="input" min="1" value={form.meanWeightG} onChange={e => set('meanWeightG', e.target.value)} placeholder="e.g. 1850" />
            {vsStd != null && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                vs Ross 308 standard ({fmt(standard)}g): <strong style={{ color: Number(vsStd) >= 0 ? 'var(--green)' : 'var(--red)' }}>{vsStd > 0 ? '+' : ''}{vsStd}%</strong>
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">Weight Range <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Min (g)</div>
              <input type="number" className="input" min="0" value={form.minWeightG} onChange={e => set('minWeightG', e.target.value)} placeholder="0" style={{ padding: '7px 10px' }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>Max (g)</div>
              <input type="number" className="input" min="0" value={form.maxWeightG} onChange={e => set('maxWeightG', e.target.value)} placeholder="0" style={{ padding: '7px 10px' }} />
            </div>
          </div>
        </div>
        <div>
          <label className="label">Uniformity % <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional — birds within ±10% of mean)</span></label>
          <input type="number" className="input" min="0" max="100" value={form.uniformityPct} onChange={e => set('uniformityPct', e.target.value)} placeholder="e.g. 85" />
        </div>
        {meanG > 0 && (
          <div style={{ padding: '10px 14px', background: 'var(--purple-light)', borderRadius: 9, border: '1px solid #d4d8ff', fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 2 }}>Est. Live Weight: {fmtWt(meanG)}</div>
            {standard && <div style={{ color: 'var(--text-muted)' }}>Ross 308 target at this age: {fmtWt(standard)}</div>}
          </div>
        )}
      </div>
    </PortalModal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BroilerPerformancePage() {
  const { apiFetch, user } = useAuth();

  const [days,        setDays]        = useState(30);
  const [weightData,  setWeightData]  = useState(null);
  const [flocks,      setFlocks]      = useState([]);
  const [flockFilter, setFlockFilter] = useState('');
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [tab,         setTab]         = useState('overview');
  const [dashData,    setDashData]    = useState(null);

  const canLog = ['PEN_WORKER','PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, flockRes, dashRes] = await Promise.all([
        apiFetch(`/api/weight-samples?days=${days}${flockFilter ? `&flockId=${flockFilter}` : ''}`),
        apiFetch('/api/farm-structure'),
        apiFetch('/api/dashboard'),
      ]);
      if (wRes.ok)    setWeightData(await wRes.json());
      if (dashRes.ok) setDashData(await dashRes.json());
      if (flockRes.ok) {
        const d = await flockRes.json();
        const broilerFlocks = (d.farms || []).flatMap(farm =>
          farm.pens.filter(p => p.operationType === 'BROILER').flatMap(pen =>
            pen.sections
              .filter(sec => sec.activeFlock)
              .map(sec => ({
                ...sec.activeFlock,
                ageInDays:    sec.ageInDays,
                penSectionId: sec.id,
                penSection:   { id: sec.id, name: sec.name, pen: { name: pen.name } },
              }))
          )
        );
        setFlocks(broilerFlocks);
      }
    } finally { setLoading(false); }
  }, [apiFetch, days, flockFilter]);

  useEffect(() => { load(); }, [load]);

  const { summary = {}, samples = [] } = weightData || {};

  // ── Section KPI cards from dashboard data ────────────────────────────────────
  const sections       = dashData?.sections || [];
  const broilerSections = sections.filter(s => s.penOperationType === 'BROILER' || s.metrics?.type === 'BROILER');

  const totBirds   = broilerSections.reduce((a, s) => a + (s.currentBirds || 0), 0);
  const totDead7   = broilerSections.reduce((a, s) => a + (s.metrics?.weekMortality || 0), 0);
  const mortRate   = totBirds > 0 ? parseFloat(((totDead7 / totBirds) * 100).toFixed(2)) : 0;
  const wtSections = broilerSections.filter(s => s.metrics?.latestWeightG);
  const avgWt      = wtSections.length ? parseFloat((wtSections.reduce((a,s) => a + s.metrics.latestWeightG, 0) / wtSections.length).toFixed(0)) : null;
  const fcrSections= broilerSections.filter(s => s.metrics?.estimatedFCR);
  const avgFCR     = fcrSections.length ? parseFloat((fcrSections.reduce((a,s) => a + s.metrics.estimatedFCR, 0) / fcrSections.length).toFixed(2)) : null;
  const waterSecs  = broilerSections.filter(s => s.metrics?.avgWaterLPB != null);
  const avgWater   = waterSecs.length ? parseFloat((waterSecs.reduce((a,s) => a + (s.metrics.avgWaterLPB||0), 0) / waterSecs.length).toFixed(2)) : null;
  const avgAge     = broilerSections.length ? Math.round(broilerSections.reduce((a,s) => a + (s.ageInDays || 28), 0) / broilerSections.length) : 28;
  const waterBench = broilerWaterBenchmark(avgAge);
  const stdWt      = getStandardWeight(avgAge);
  const harvestDue = broilerSections.filter(s => s.metrics?.daysToHarvest != null && s.metrics.daysToHarvest <= 7).length;

  const sectionKpis = broilerSections.length > 0 ? [
    {
      icon: '🐔', label: 'Live Birds',
      value: fmt(totBirds),
      sub: `${broilerSections.length} section${broilerSections.length !== 1 ? 's' : ''}`,
      delta: '', status: 'neutral',
    },
    {
      icon: '⚖️', label: 'Avg Live Weight',
      value: avgWt ? fmtWt(avgWt) : '—',
      sub: `Age ~${avgAge}d · Ross 308 target ${fmtWt(stdWt)}`,
      delta: avgWt ? (avgWt >= stdWt * 0.95 ? 'On target' : avgWt >= stdWt * 0.85 ? 'Slightly below target' : 'Below target — investigate') : 'No weigh-in yet',
      status: weightStatus(avgWt, stdWt),
    },
    {
      icon: '🌾', label: 'Feed Conv. Ratio',
      value: avgFCR != null ? `${avgFCR}` : '—',
      sub: 'Target ≤ 1.9',
      delta: avgFCR != null ? (avgFCR <= 1.9 ? 'On target' : `${(avgFCR - 1.9).toFixed(2)} above target`) : 'No data yet',
      status: fcrStatus(avgFCR),
    },
    {
      icon: '💧', label: 'Water Intake',
      value: avgWater != null ? `${avgWater} L/bird` : '—',
      sub: avgWater != null ? `Benchmark ${waterBench} L/bird · age ${avgAge}d` : 'Not tracked yet',
      delta: avgWater != null ? (avgWater >= waterBench * 0.85 ? 'Within normal range' : 'Below recommended level') : '',
      status: waterStatus(avgWater, waterBench),
    },
    {
      icon: '📉', label: 'Mortality (7d)',
      value: fmt(totDead7),
      sub: `${mortRate}% of flock`,
      delta: mortRate <= 0.1 ? 'Within normal range' : mortRate <= 0.2 ? 'Slightly elevated' : 'Elevated — investigate',
      status: mortalityStatus(mortRate),
    },
    {
      icon: '📅', label: 'Harvest Countdown',
      value: `${harvestDue}`,
      sub: 'Sections due ≤ 7 days',
      delta: harvestDue > 0 ? `${harvestDue} section${harvestDue !== 1 ? 's' : ''} ready soon` : 'None due this week',
      status: harvestDue > 0 ? 'warn' : 'neutral',
    },
  ] : [];

  // ── Chart data ───────────────────────────────────────────────────────────────
  const weightChartData = buildWeightChartData(samples);
  const fcrChartData    = buildFcrChartData(samples);

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>🍗 Performance</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>Broiler section metrics & weight records</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {PERIOD_OPTIONS.map(d => (
              <button key={d} onClick={() => setDays(d)} className="btn"
                style={{ fontSize: 11, padding: '5px 12px', background: days === d ? 'var(--purple-light)' : '#fff', color: days === d ? 'var(--purple)' : 'var(--text-muted)', border: `1px solid ${days === d ? '#d4d8ff' : 'var(--border)'}`, fontWeight: days === d ? 700 : 600 }}>
                {d}d
              </button>
            ))}
            {canLog && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Log Weight</button>}
          </div>
        </div>

        {/* ── Section KPI cards ── */}
        {sectionKpis.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
              My Section Performance
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
              {loading
                ? Array(6).fill(0).map((_, i) => <Skeleton key={i} h={110} />)
                : sectionKpis.map(k => <PerfKpiCard key={k.label} {...k} />)
              }
            </div>
          </div>
        )}

        {/* ── Divider + period records ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 16 }}>
            Weight Records · Last {days} days
          </div>

          {/* Period aggregate cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {loading ? Array(4).fill(0).map((_, i) => <Skeleton key={i} h={88} />) : <>
              <SimpleKpiCard icon="⚖️" label="Latest Avg Weight" value={fmtWt(summary.latestMeanWeightG)}  sub={`from ${fmt(summary.latestSampleCount || 0)} birds sampled`} color="var(--purple)" />
              <SimpleKpiCard icon="📈" label="Weight Gain (7d)"  value={summary.weightGain7d ? `+${fmt(summary.weightGain7d)}g` : '—'} sub="grams gained last 7 days" color="var(--green)" />
              <SimpleKpiCard icon="🌾" label="Est. FCR"          value={summary.estimatedFCR || '—'}       sub="feed consumed / weight gained" color={Number(summary.estimatedFCR) <= 1.9 ? 'var(--green)' : 'var(--amber)'} />
              <SimpleKpiCard icon="📊" label="Uniformity"        value={summary.latestUniformityPct ? `${summary.latestUniformityPct}%` : '—'} sub="birds within ±10% of mean" color="var(--blue)" />
            </>}
          </div>
        </div>

        {/* Flock filter */}
        {flocks.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <select className="input" style={{ maxWidth: 300 }} value={flockFilter} onChange={e => setFlockFilter(e.target.value)}>
              <option value="">All broiler flocks</option>
              {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} — {f.penSection?.pen?.name} · age {f.ageInDays}d</option>)}
            </select>
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
          {[['overview', '📊 Overview'], ['log', '📋 Weight Log']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', color: tab === key ? 'var(--purple)' : 'var(--text-muted)', borderBottom: `3px solid ${tab === key ? 'var(--purple)' : 'transparent'}`, marginBottom: -2, transition: 'all 0.15s' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Weight growth chart */}
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Weight Growth Trend</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Mean live weight vs Ross 308 standard curve</div>
                {loading ? <Skeleton h={220} /> : weightChartData.length === 0 ? <EmptyState /> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={weightChartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={55} tickFormatter={v => `${(v/1000).toFixed(1)}kg`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="meanWeightG" name="Actual (g)" stroke="var(--purple)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="standardG"  name="Ross 308 (g)" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* FCR trend */}
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Feed Conversion Ratio Trend</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Lower is better · target ≤ 1.9</div>
                {loading ? <Skeleton h={180} /> : fcrChartData.length === 0 ? <EmptyState /> : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={fcrChartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis domain={[1, 3]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={35} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={1.9} stroke="#f59e0b" strokeDasharray="4 3" label={{ value: 'Target', position: 'right', fontSize: 10, fill: '#f59e0b' }} />
                      <Line type="monotone" dataKey="fcr" name="FCR" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Uniformity */}
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Flock Uniformity</div>
                {loading ? <Skeleton h={120} /> : samples.length === 0 ? <EmptyState msg="No weight samples recorded" /> : (() => {
                  const latest = [...samples].sort((a,b) => new Date(b.sampleDate) - new Date(a.sampleDate))[0];
                  const uni = latest?.uniformityPct;
                  const uniColor = !uni ? '#94a3b8' : uni >= 80 ? '#16a34a' : uni >= 70 ? '#d97706' : '#ef4444';
                  return (
                    <div>
                      <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 36, fontWeight: 700, color: uniColor, lineHeight: 1, marginBottom: 6 }}>
                        {uni != null ? `${uni}%` : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                        {uni == null ? 'Not recorded yet' : uni >= 80 ? '✅ Good uniformity (target ≥80%)' : uni >= 70 ? '⚠ Acceptable — monitor flock' : '🔴 Poor — check feeding distribution'}
                      </div>
                      <div style={{ height: 8, background: 'var(--border)', borderRadius: 4 }}>
                        <div style={{ height: '100%', width: `${Math.min(uni || 0, 100)}%`, background: uniColor, borderRadius: 4, transition: 'width 0.6s ease' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                        <span>0%</span><span style={{ color: '#d97706' }}>70%</span><span style={{ color: '#16a34a' }}>80%</span><span>100%</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* By flock */}
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>By Flock</div>
                {loading ? <Skeleton h={160} /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {buildFlockSummary(samples).map(f => (
                      <div key={f.batchCode} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 9, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 12 }}>{f.batchCode}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>{fmtWt(f.latestWeight)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.pen} · {f.sampleCount} sample{f.sampleCount !== 1 ? 's' : ''}</div>
                      </div>
                    ))}
                    {samples.length === 0 && <EmptyState msg="No records in this period" />}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Weight Log tab */}
        {tab === 'log' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center' }}><Skeleton h={200} /></div> : samples.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚖️</div>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>No weight records in this period</div>
                {canLog && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>Log First Sample</button>}
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Flock</th>
                    <th>Pen · Section</th>
                    <th style={{ textAlign: 'right' }}>Sample Size</th>
                    <th style={{ textAlign: 'right' }}>Mean Weight</th>
                    <th style={{ textAlign: 'right' }}>Min</th>
                    <th style={{ textAlign: 'right' }}>Max</th>
                    <th style={{ textAlign: 'right' }}>Uniformity</th>
                    <th style={{ textAlign: 'right' }}>vs Standard</th>
                    <th>Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  {[...samples].sort((a,b) => new Date(b.sampleDate) - new Date(a.sampleDate)).map(s => {
                    const std = s.ageInDays ? getStandardWeight(s.ageInDays) : null;
                    const vsStd = std && s.meanWeightG ? ((s.meanWeightG / std - 1) * 100).toFixed(1) : null;
                    return (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(s.sampleDate)}</td>
                        <td><span style={{ fontWeight: 700, color: 'var(--purple)' }}>{s.flock?.batchCode}</span></td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.penSection?.pen?.name} › {s.penSection?.name}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(s.sampleCount)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtWt(s.meanWeightG)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{s.minWeightG ? fmtWt(s.minWeightG) : '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: 12 }}>{s.maxWeightG ? fmtWt(s.maxWeightG) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {s.uniformityPct != null
                            ? <span style={{ fontWeight: 700, color: s.uniformityPct >= 80 ? 'var(--green)' : s.uniformityPct >= 70 ? 'var(--amber)' : 'var(--red)' }}>{s.uniformityPct}%</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {vsStd != null
                            ? <span style={{ fontWeight: 700, color: Number(vsStd) >= 0 ? 'var(--green)' : Number(vsStd) >= -10 ? 'var(--amber)' : 'var(--red)' }}>{vsStd > 0 ? '+' : ''}{vsStd}%</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.recordedBy?.firstName} {s.recordedBy?.lastName?.[0]}.</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showModal && <LogWeightModal flocks={flocks} apiFetch={apiFetch} onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); load(); }} />}
    </AppShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildWeightChartData(samples) {
  const map = {};
  samples.forEach(s => {
    const d = new Date(s.sampleDate).toISOString().split('T')[0];
    if (!map[d] || s.meanWeightG > map[d].meanWeightG) {
      map[d] = { date: d, meanWeightG: s.meanWeightG, ageInDays: s.ageInDays };
    }
  });
  return Object.values(map)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ ...d, standardG: d.ageInDays ? getStandardWeight(d.ageInDays) : null }));
}
function buildFcrChartData(samples) {
  return samples
    .filter(s => s.estimatedFCR)
    .reduce((acc, s) => {
      const d = new Date(s.sampleDate).toISOString().split('T')[0];
      const existing = acc.find(x => x.date === d);
      if (existing) { existing.fcr = parseFloat(((existing.fcr + s.estimatedFCR) / 2).toFixed(2)); }
      else acc.push({ date: d, fcr: s.estimatedFCR });
      return acc;
    }, [])
    .sort((a, b) => a.date.localeCompare(b.date));
}
function buildFlockSummary(samples) {
  const map = {};
  samples.forEach(s => {
    const k = s.flock?.batchCode;
    if (!k) return;
    if (!map[k]) map[k] = { batchCode: k, pen: s.penSection?.pen?.name, latestWeight: 0, sampleCount: 0, latestDate: '' };
    map[k].sampleCount++;
    if (!map[k].latestDate || s.sampleDate > map[k].latestDate) {
      map[k].latestDate  = s.sampleDate;
      map[k].latestWeight = s.meanWeightG;
    }
  });
  return Object.values(map);
}
