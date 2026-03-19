'use client';
// app/eggs/page.js — Layer Performance (formerly Egg Collection)
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import PortalModal from '@/components/ui/Modal';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const PERIOD_OPTIONS = [7, 14, 30, 90];
const GRADE_COLORS   = { gradeA: '#16a34a', gradeB: '#f59e0b', cracked: '#ef4444', dirty: '#9ca3af' };
const fmt            = n => Number(n || 0).toLocaleString('en-NG');
const fmtDate        = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

// ── Status helpers ────────────────────────────────────────────────────────────
function layRateStatus(r)     { if (r==null) return 'neutral'; return r>=82?'good':r>=70?'warn':'critical'; }
function gradeAStatus(p)      { if (p==null) return 'neutral'; return p>=85?'good':p>=75?'warn':'critical'; }
function mortalityStatus(r7d) { if (r7d==null) return 'neutral'; return r7d<=0.05?'good':r7d<=0.15?'warn':'critical'; }
function waterStatus(a, b)    { if (!a||!b) return 'neutral'; const r=a/b; return r>=0.85?'good':r>=0.65?'warn':'critical'; }
function layerWaterBenchmark(age) {
  if (!age) return 0.30;
  if (age < 28)  return 0.08;
  if (age < 119) return 0.18;
  return 0.30;
}

const STATUS_COLOR = { good:'#16a34a', warn:'#d97706', critical:'#ef4444', neutral:'#6b7280' };
const STATUS_BG    = { good:'#f0fdf4', warn:'#fffbeb', critical:'#fef2f2', neutral:'#f8fafc' };
const STATUS_BORDER= { good:'#bbf7d0', warn:'#fde68a', critical:'#fecaca', neutral:'#e2e8f0' };

// ── Performance KPI card ──────────────────────────────────────────────────────
function PerfKpiCard({ icon, label, value, sub, delta, status = 'neutral' }) {
  const col = STATUS_COLOR[status] || STATUS_COLOR.neutral;
  const bg  = STATUS_BG[status]    || STATUS_BG.neutral;
  const bdr = STATUS_BORDER[status]|| STATUS_BORDER.neutral;
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

// ── Simple egg-page KPI card (period aggregates) ───────────────────────────────
function KpiCard({ icon, label, value, sub, color }) {
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

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 14px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, display: 'inline-block' }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Log Egg Modal ─────────────────────────────────────────────────────────────
function LogEggModal({ flocks, onClose, onSave, apiFetch }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    flockId: '', penSectionId: '',
    collectionDate:   today,
    collectionSession: '1',
    cratesCollected:  '',
    looseEggs:        '',
    crackedCount:     '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectedFlock = flocks.find(f => f.id === form.flockId);
  const crates  = Math.max(0, Number(form.cratesCollected) || 0);
  const loose   = Math.max(0, Number(form.looseEggs)       || 0);
  const cracked = Math.max(0, Number(form.crackedCount)    || 0);
  const total   = (crates * 30) + loose + cracked;
  const layingPct = selectedFlock?.currentCount > 0 ? ((total / selectedFlock.currentCount) * 100).toFixed(1) : null;

  async function save() {
    if (!form.flockId)             return setError('Select a flock');
    if (crates <= 0 && loose <= 0) return setError('Enter at least crates or loose eggs collected');
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/eggs', {
        method: 'POST',
        body: JSON.stringify({
          flockId: form.flockId, penSectionId: form.penSectionId,
          collectionDate:   form.collectionDate,
          collectionSession: Number(form.collectionSession),
          cratesCollected:  crates,
          looseEggs:        loose,
          crackedCount:     cracked,
          totalEggs:        total,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <PortalModal title="🥚 Log Egg Collection" width={480} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Record'}</button></>}>
      {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>⚠ {error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label className="label">Layer Flock *</label>
          <select className="input" value={form.flockId} onChange={e => { const f = flocks.find(x => x.id === e.target.value); set('flockId', e.target.value); set('penSectionId', f?.penSectionId || ''); }}>
            <option value="">— Select flock —</option>
            {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} · {f.penSection?.pen?.name} › {f.penSection?.name} · {fmt(f.currentCount)} birds</option>)}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Collection Date *</label>
            <input type="date" className="input" value={form.collectionDate} onChange={e => set('collectionDate', e.target.value)} max={today} />
          </div>
          <div>
            <label className="label">Session *</label>
            <select className="input" value={form.collectionSession} onChange={e => set('collectionSession', e.target.value)}>
              <option value="1">Morning (Batch 1)</option>
              <option value="2">Afternoon (Batch 2)</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          <div>
            <label className="label">Full Crates *</label>
            <input type="number" className="input" min="0" value={form.cratesCollected} onChange={e => set('cratesCollected', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>30 eggs each</div>
          </div>
          <div>
            <label className="label">Loose Eggs</label>
            <input type="number" className="input" min="0" max="29" value={form.looseEggs} onChange={e => set('looseEggs', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Under 1 crate</div>
          </div>
          <div>
            <label className="label">Cracked</label>
            <input type="number" className="input" min="0" value={form.crackedCount} onChange={e => set('crackedCount', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Reduced price</div>
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--purple-light)', borderRadius: 9, border: '1px solid #d4d8ff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}>Total: {fmt(total)} eggs</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({crates} × 30) + {loose} loose + {cracked} cracked</span>
          </div>
          {layingPct && (
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Laying rate: <strong style={{ color: Number(layingPct) >= 80 ? 'var(--green)' : Number(layingPct) >= 70 ? 'var(--amber)' : 'var(--red)' }}>{layingPct}%</strong>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>Grade A % set by Pen Manager on verification</span>
            </div>
          )}
        </div>
      </div>
    </PortalModal>
  );
}

// ── Edit Egg Modal ────────────────────────────────────────────────────────────
function EditEggModal({ record, flocks, onClose, onSave, apiFetch }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    collectionDate:   record.collectionDate?.split('T')[0] || today,
    collectionSession: String(record.collectionSession || '1'),
    cratesCollected:  String(record.cratesCollected || ''),
    looseEggs:        String(record.looseEggs        || ''),
    crackedCount:     String(record.crackedCount     || ''),
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectedFlock = flocks.find(f => f.id === record.flockId);
  const crates  = Math.max(0, Number(form.cratesCollected) || 0);
  const loose   = Math.max(0, Number(form.looseEggs)       || 0);
  const cracked = Math.max(0, Number(form.crackedCount)    || 0);
  const total   = (crates * 30) + loose + cracked;
  const layingPct = selectedFlock?.currentCount > 0 ? ((total / selectedFlock.currentCount) * 100).toFixed(1) : null;

  async function save() {
    if (crates <= 0 && loose <= 0) return setError('Enter at least crates or loose eggs collected');
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/eggs/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          collectionDate:   form.collectionDate,
          collectionSession: Number(form.collectionSession),
          cratesCollected:  crates,
          looseEggs:        loose,
          crackedCount:     cracked,
          totalEggs:        total,
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
        <div style={{ padding: '9px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
          {record.flock?.batchCode} · {record.penSection?.pen?.name} › {record.penSection?.name}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Collection Date *</label>
            <input type="date" className="input" value={form.collectionDate} onChange={e => set('collectionDate', e.target.value)} max={today} />
          </div>
          <div>
            <label className="label">Session *</label>
            <select className="input" value={form.collectionSession} onChange={e => set('collectionSession', e.target.value)}>
              <option value="1">Morning (Batch 1)</option>
              <option value="2">Afternoon (Batch 2)</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          <div>
            <label className="label">Full Crates *</label>
            <input type="number" className="input" min="0" value={form.cratesCollected} onChange={e => set('cratesCollected', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>30 eggs each</div>
          </div>
          <div>
            <label className="label">Loose Eggs</label>
            <input type="number" className="input" min="0" max="29" value={form.looseEggs} onChange={e => set('looseEggs', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Under 1 crate</div>
          </div>
          <div>
            <label className="label">Cracked</label>
            <input type="number" className="input" min="0" value={form.crackedCount} onChange={e => set('crackedCount', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Reduced price</div>
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--purple-light)', borderRadius: 9, border: '1px solid #d4d8ff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}>Total: {fmt(total)} eggs</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({crates} × 30) + {loose} + {cracked}</span>
          </div>
          {layingPct && <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>Laying rate: <strong style={{ color: Number(layingPct) >= 80 ? 'var(--green)' : Number(layingPct) >= 70 ? 'var(--amber)' : 'var(--red)' }}>{layingPct}%</strong></div>}
        </div>
      </div>
    </PortalModal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EggsPage() {
  const { apiFetch, user } = useAuth();

  const [days,        setDays]        = useState(30);
  const [data,        setData]        = useState(null);
  const [flocks,      setFlocks]      = useState([]);
  const [flockFilter, setFlockFilter] = useState('');
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [editRecord,  setEditRecord]  = useState(null);
  const [tab,         setTab]         = useState('overview');

  // Section-level KPI data from dashboard API
  const [dashData, setDashData] = useState(null);

  const canLog = ['PEN_WORKER','PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(user?.role);
  const isWorker = user?.role === 'PEN_WORKER';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eggRes, flockRes, dashRes] = await Promise.all([
        apiFetch(`/api/eggs?days=${days}${flockFilter ? `&flockId=${flockFilter}` : ''}`),
        apiFetch('/api/farm-structure'),
        apiFetch('/api/dashboard'),
      ]);
      if (eggRes.ok) {
        setData(await eggRes.json());
      } else {
        const errBody = await eggRes.json().catch(() => ({}));
        console.error('Eggs API error', eggRes.status, errBody?.detail || errBody?.error || errBody);
      }
      if (dashRes.ok)  setDashData(await dashRes.json());
      if (flockRes.ok) {
        const d = await flockRes.json();
        const layerFlocks = (d.farms || []).flatMap(farm =>
          farm.pens.filter(p => p.operationType === 'LAYER').flatMap(pen =>
            pen.sections
              .filter(sec => sec.activeFlock)
              .map(sec => ({ ...sec.activeFlock, penSectionId: sec.id, penSection: { id: sec.id, name: sec.name, pen: { name: pen.name } } }))
          )
        );
        setFlocks(layerFlocks);
      }
    } finally { setLoading(false); }
  }, [apiFetch, days, flockFilter]);

  useEffect(() => { load(); }, [load]);

  const { summary = {}, records = [] } = data || {};
  const chartData = buildChartData(records, days);
  const gradeData = [
    { name: 'Grade A', value: summary.totalGradeA || 0, color: GRADE_COLORS.gradeA },
    { name: 'Grade B', value: summary.totalGradeB || 0, color: GRADE_COLORS.gradeB },
    { name: 'Cracked', value: summary.totalCracked || 0, color: GRADE_COLORS.cracked },
    { name: 'Dirty',   value: summary.totalDirty || 0,   color: GRADE_COLORS.dirty },
  ].filter(g => g.value > 0);

  // ── Build section-scoped KPI cards from dashboard data ─────────────────────
  // For PEN_WORKER: use sections[]. For PEN_MANAGER/FARM_MANAGER: use pens[].
  const sections = dashData?.sections || [];
  const layerSections = sections.filter(s => s.penOperationType === 'LAYER' || s.metrics?.type === 'LAYER');

  const totBirds   = layerSections.reduce((a, s) => a + (s.currentBirds || 0), 0);
  const totDead7   = layerSections.reduce((a, s) => a + (s.metrics?.weekMortality || 0), 0);
  const mortRate   = totBirds > 0 ? parseFloat(((totDead7 / totBirds) * 100).toFixed(2)) : 0;
  const todayEggs  = layerSections.reduce((a, s) => a + (s.metrics?.todayEggs || 0), 0);
  const weekEggs   = layerSections.reduce((a, s) => a + (s.metrics?.weekEggs || 0), 0);
  const rateSecns  = layerSections.filter(s => (s.metrics?.todayLayingRate || 0) > 0);
  const avgRate    = rateSecns.length ? parseFloat((rateSecns.reduce((a, s) => a + (s.metrics?.todayLayingRate || 0), 0) / rateSecns.length).toFixed(1)) : null;
  const gradeASecns= layerSections.filter(s => (s.metrics?.todayGradeAPct || 0) > 0);
  const gradeAPct  = gradeASecns.length ? parseFloat((gradeASecns.reduce((a, s) => a + (s.metrics?.todayGradeAPct || 0), 0) / gradeASecns.length).toFixed(1)) : null;
  const waterSecns = layerSections.filter(s => s.metrics?.avgWaterLPB != null);
  const avgWater   = waterSecns.length ? parseFloat((waterSecns.reduce((a, s) => a + (s.metrics?.avgWaterLPB || 0), 0) / waterSecns.length).toFixed(2)) : null;
  const avgAge     = layerSections.length ? Math.round(layerSections.reduce((a, s) => a + (s.ageInDays || 180), 0) / layerSections.length) : 180;
  const waterBench = layerWaterBenchmark(avgAge);

  const sectionKpis = layerSections.length > 0 ? [
    {
      icon: '🐦', label: 'Live Birds',
      value: fmt(totBirds),
      sub: `${layerSections.length} section${layerSections.length !== 1 ? 's' : ''}`,
      delta: '', status: 'neutral',
    },
    {
      icon: '📊', label: 'Lay Rate (Today)',
      value: avgRate != null ? `${avgRate}%` : '—',
      sub: 'Target 82%',
      delta: avgRate != null ? (avgRate >= 82 ? `+${(avgRate - 82).toFixed(1)}% above target` : `${(avgRate - 82).toFixed(1)}% below target`) : 'No data yet',
      status: avgRate != null ? layRateStatus(avgRate) : 'neutral',
    },
    {
      icon: '🥚', label: 'Eggs Today',
      value: fmt(todayEggs),
      sub: `7d total ${fmt(weekEggs)}`,
      delta: todayEggs > 0 ? `${fmt(todayEggs)} collected today` : 'None recorded yet',
      status: todayEggs > 0 ? 'good' : 'neutral',
    },
    {
      icon: '⭐', label: 'Grade A Rate',
      value: gradeAPct != null ? `${gradeAPct}%` : '—',
      sub: 'Target ≥85%',
      delta: gradeAPct != null ? (gradeAPct >= 85 ? `+${(gradeAPct - 85).toFixed(1)}% above target` : `${(gradeAPct - 85).toFixed(1)}% below target`) : 'No data yet',
      status: gradeAStatus(gradeAPct),
    },
    {
      icon: '💧', label: 'Water Intake',
      value: avgWater != null ? `${avgWater} L/bird` : '—',
      sub: avgWater != null ? `Benchmark ${waterBench} L/bird · age ${avgAge}d` : 'Not tracked yet',
      delta: avgWater != null ? (avgWater >= waterBench * 0.85 ? 'Within normal range' : 'Below recommended level') : '',
      status: avgWater != null ? waterStatus(avgWater, waterBench) : 'neutral',
    },
    {
      icon: '📉', label: 'Mortality (7d)',
      value: fmt(totDead7),
      sub: `${mortRate}% of flock`,
      delta: mortRate <= 0.05 ? 'Within normal range' : mortRate <= 0.15 ? 'Slightly elevated' : 'Elevated — investigate',
      status: mortalityStatus(mortRate),
    },
  ] : [];

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>📊 Performance</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>Layer section metrics & egg production records</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {PERIOD_OPTIONS.map(d => (
              <button key={d} onClick={() => setDays(d)} className="btn"
                style={{ fontSize: 11, padding: '5px 12px', background: days === d ? 'var(--purple-light)' : '#fff', color: days === d ? 'var(--purple)' : 'var(--text-muted)', border: `1px solid ${days === d ? '#d4d8ff' : 'var(--border)'}`, fontWeight: days === d ? 700 : 600 }}>
                {d}d
              </button>
            ))}
            {canLog && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Log Collection</button>}
          </div>
        </div>

        {/* ── Section KPI cards — scoped to this worker/manager's sections ── */}
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

        {/* ── Divider ── */}
        <div style={{ borderTop: '1px solid var(--border)', marginBottom: 20, paddingTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 16 }}>
            Production Records · Last {days} days
          </div>

          {/* Period aggregate KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
            {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} h={88} />) : <>
              <KpiCard icon="🥚" label="Total Eggs"      value={fmt(summary.totalEggs)}           sub={`last ${days} days`}              color="var(--amber)" />
              <KpiCard icon="📊" label="Avg Laying Rate" value={`${summary.avgLayingRate || 0}%`} sub="of active birds"                  color={Number(summary.avgLayingRate) >= 80 ? 'var(--green)' : 'var(--amber)'} />
              <KpiCard icon="⭐" label="Grade A"         value={fmt(summary.totalGradeA)}         sub={`${gradeAPct2(summary)}% of total`} color="var(--green)" />
              <KpiCard icon="🧺" label="Total Crates"    value={fmt(summary.totalCrates)}         sub="30 eggs per crate"                color="var(--purple)" />
              <KpiCard icon="📅" label="Daily Average"   value={fmt(summary.avgDailyEggs)}        sub="eggs per day"                     color="var(--blue)" />
            </>}
          </div>
        </div>

        {/* Flock filter */}
        {flocks.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <select className="input" style={{ maxWidth: 300 }} value={flockFilter} onChange={e => setFlockFilter(e.target.value)}>
              <option value="">All layer flocks</option>
              {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} — {f.penSection?.pen?.name}</option>)}
            </select>
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
          {[['overview', '📊 Overview'], ['log', '📋 Daily Log']].map(([key, label]) => (
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
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Daily Eggs Collected</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Total eggs per day over {days} days</div>
                {loading ? <Skeleton h={220} /> : chartData.length === 0 ? <EmptyState /> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={50} tickFormatter={v => fmt(v)} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="totalEggs" name="Total Eggs" fill="var(--amber)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Laying Rate Trend</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Daily laying rate % (target: 80%+)</div>
                {loading ? <Skeleton h={180} /> : chartData.length === 0 ? <EmptyState /> : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={35} tickFormatter={v => `${v}%`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Line type="monotone" dataKey="layingRate" name="Laying Rate %" stroke="var(--green)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Grade Breakdown</div>
                {loading ? <Skeleton h={140} /> : gradeData.length === 0 ? <EmptyState msg="No grade data recorded" /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      { label: 'Grade A', value: summary.totalGradeA,  color: GRADE_COLORS.gradeA,   pct: gradePct(summary.totalGradeA,  summary.totalEggs) },
                      { label: 'Grade B', value: summary.totalGradeB,  color: GRADE_COLORS.gradeB,   pct: gradePct(summary.totalGradeB,  summary.totalEggs) },
                      { label: 'Cracked', value: summary.totalCracked, color: GRADE_COLORS.cracked,  pct: gradePct(summary.totalCracked, summary.totalEggs) },
                    ].map(g => (
                      <div key={g.label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: g.color }}>{g.label}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{fmt(g.value)} ({g.pct}%)</span>
                        </div>
                        <div style={{ height: 6, background: 'var(--border)', borderRadius: 3 }}>
                          <div style={{ height: '100%', width: `${g.pct}%`, background: g.color, borderRadius: 3, transition: 'width 0.6s ease' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>By Flock</div>
                {loading ? <Skeleton h={160} /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {buildFlockSummary(records).map(f => (
                      <div key={f.batchCode} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 9, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 12 }}>{f.batchCode}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)' }}>{fmt(f.total)} eggs</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.pen} · avg {f.avgRate}% lay rate</div>
                      </div>
                    ))}
                    {records.length === 0 && <EmptyState msg="No records in this period" />}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Daily Log tab */}
        {tab === 'log' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center' }}><Skeleton h={200} /></div> : records.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🥚</div>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>No egg records in this period</div>
                {canLog && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>Log First Collection</button>}
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th><th>Session</th><th>Flock</th><th>Pen · Section</th>
                    <th style={{ textAlign: 'right' }}>Crates</th>
                    <th style={{ textAlign: 'right' }}>Loose</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Grade A</th>
                    <th style={{ textAlign: 'right' }}>Grade B</th>
                    <th style={{ textAlign: 'right' }}>Cracked</th>
                    <th style={{ textAlign: 'right' }}>Lay Rate</th>
                    <th>Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  {[...records].reverse().map(r => (
                    <tr key={r.id} style={{ background: r.rejectionReason ? '#fff5f5' : undefined }}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {fmtDate(r.collectionDate)}
                        {r.rejectionReason && <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', marginTop: 2 }}>↩ Needs correction</div>}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.collectionSession === 2 ? 'Afternoon' : 'Morning'}</td>
                      <td><span style={{ fontWeight: 700, color: 'var(--amber)' }}>{r.flock?.batchCode}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.penSection?.pen?.name} › {r.penSection?.name}</td>
                      <td style={{ textAlign: 'right' }}>{r.cratesCollected ?? Math.floor((r.totalEggs || 0) / 30)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{r.looseEggs ?? ((r.totalEggs || 0) % 30)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.totalEggs)}</td>
                      <td style={{ textAlign: 'right', color: GRADE_COLORS.gradeA, fontWeight: 600 }}>
                        {r.gradeACount != null ? fmt(r.gradeACount) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Pending</span>}
                      </td>
                      <td style={{ textAlign: 'right', color: GRADE_COLORS.gradeB, fontWeight: 600 }}>
                        {r.gradeBCount != null ? fmt(r.gradeBCount) : <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', color: GRADE_COLORS.cracked, fontWeight: 600 }}>{fmt(r.crackedCount)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: Number(r.layingRatePct) >= 80 ? 'var(--green)' : 'var(--amber)' }}>{Number(r.layingRatePct || 0).toFixed(1)}%</span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.rejectionReason ? (
                          <button onClick={() => setEditRecord(r)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff5f5', color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}>✏️ Fix & Resubmit</button>
                        ) : (
                          <>{r.recordedBy?.firstName} {r.recordedBy?.lastName?.[0]}.</>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showModal  && <LogEggModal  flocks={flocks} apiFetch={apiFetch} onClose={() => setShowModal(false)}  onSave={() => { setShowModal(false);  load(); }} />}
      {editRecord && <EditEggModal record={editRecord} flocks={flocks} apiFetch={apiFetch} onClose={() => setEditRecord(null)} onSave={() => { setEditRecord(null); load(); }} />}
    </AppShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function EmptyState({ msg = 'No data for this period' }) {
  return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{msg}</div>;
}
function gradeAPct2(s) { return s.totalEggs > 0 ? ((s.totalGradeA / s.totalEggs) * 100).toFixed(1) : 0; }
function gradePct(val, total) { return total > 0 ? ((val / total) * 100).toFixed(1) : 0; }
function buildChartData(records) {
  const map = {};
  records.forEach(r => {
    const d = new Date(r.collectionDate).toISOString().split('T')[0];
    if (!map[d]) map[d] = { date: d, totalEggs: 0, layingRate: 0, count: 0 };
    map[d].totalEggs  += r.totalEggs;
    map[d].layingRate += Number(r.layingRatePct || 0);
    map[d].count++;
  });
  return Object.values(map).map(d => ({ ...d, layingRate: d.count > 0 ? parseFloat((d.layingRate / d.count).toFixed(1)) : 0 })).sort((a, b) => a.date.localeCompare(b.date));
}
function buildFlockSummary(records) {
  const map = {};
  records.forEach(r => {
    const k = r.flock?.batchCode;
    if (!k) return;
    if (!map[k]) map[k] = { batchCode: k, pen: r.penSection?.pen?.name, total: 0, rateSum: 0, count: 0 };
    map[k].total   += r.totalEggs;
    map[k].rateSum += Number(r.layingRatePct || 0);
    map[k].count++;
  });
  return Object.values(map).map(f => ({ ...f, avgRate: f.count > 0 ? (f.rateSum / f.count).toFixed(1) : 0 }));
}
