'use client';
// app/eggs/page.js — Layer Performance (formerly Egg Collection)
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import PortalModal from '@/components/ui/Modal';
import {
  ComposedChart, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const PERIOD_OPTIONS = [7, 14, 30, 90];
const YESTERDAY_DAYS = 1; // special value for "yesterday" filter

// Format kg as bags + remainder using farm's bag weight (default 25kg)
function fmtBags(kg, bagWt = 25) {
  const q  = parseFloat(kg || 0);
  const bw = parseFloat(bagWt || 25);
  if (q <= 0) return null;
  const bags      = Math.floor(q / bw);
  const remainder = parseFloat((q % bw).toFixed(1));
  if (bags === 0)           return `${q} kg`;
  if (remainder < 0.1)     return `${bags} bag${bags !== 1 ? 's' : ''}`;
  return `${bags} bag${bags !== 1 ? 's' : ''} & ${remainder} kg`;
}
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
  const [bagWeightKg, setBagWeightKg] = useState(25); // farm's feed bag weight, default 25kg
  const [flocks,      setFlocks]      = useState([]);
  const [flockFilter, setFlockFilter] = useState('');
  const [loading,     setLoading]     = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [editRecord,  setEditRecord]  = useState(null);
  const [rearingChartData, setRearingChartData] = useState([]);
  const [weightData,  setWeightData]  = useState(null);
  const [stageTab,    setStageTab]    = useState('production'); // 'brooding' | 'rearing' | 'production' — for mixed mode
  const [tab,         setTab]         = useState('overview');

  // Section-level KPI data from dashboard API
  const [dashData, setDashData] = useState(null);

  const canLog = ['PEN_WORKER','PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(user?.role);
  const isWorker = user?.role === 'PEN_WORKER';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch eggs, farm-structure, dashboard, and charts (for feed-by-date)
      // We get the first layer section from dashboard to use for the charts feed query.
      const [eggRes, flockRes, dashRes, weightRes, weightSamplesRes, settingsRes] = await Promise.all([
        apiFetch(`/api/eggs?days=${days === YESTERDAY_DAYS ? 2 : days}${days === YESTERDAY_DAYS ? '&endDate=yesterday' : ''}${flockFilter ? `&flockId=${flockFilter}` : ''}`),
        apiFetch('/api/farm-structure'),
        apiFetch('/api/dashboard'),
        apiFetch(`/api/weight-records?days=${days}${flockFilter ? `&flockId=${flockFilter}` : ''}`),
        apiFetch(`/api/weight-samples?days=${days}${flockFilter ? `&flockId=${flockFilter}` : ''}`),
        apiFetch('/api/settings'),
      ]);
      // Parse dashRes once — it's used both for chart section lookup and for setDashData
      const dashJson = dashRes?.ok ? await dashRes.json().catch(() => null) : null;
      if (dashJson) setDashData(dashJson);
      if (settingsRes?.ok) {
        const s = await settingsRes.json().catch(() => null);
        if (s?.settings?.feedBagWeightKg) setBagWeightKg(s.settings.feedBagWeightKg);
      }

      if (eggRes.ok) {
        const eggData = await eggRes.json();
        // Fetch chart data for ALL production layer sections and aggregate feed per day
        if (dashJson) {
          const layerSecs = (dashJson.sections || []).filter(
            s => (s.penOperationType === 'LAYER' || s.metrics?.type === 'LAYER')
              && (s.metrics?.stage || s.flock?.stage || 'PRODUCTION') === 'PRODUCTION'
          );
          if (layerSecs.length > 0) {
            const feedByDate = {};
            // Fetch all sections in parallel and sum feed per date
            await Promise.all(layerSecs.map(async sec => {
              try {
                const chartRes = await apiFetch(
                  `/api/dashboard/charts?sectionId=${sec.id}&days=${days}`
                );
                if (chartRes?.ok) {
                  const chartJson = await chartRes.json();
                  (chartJson.series || chartJson.chart || []).forEach(pt => {
                    if (pt.date && pt.feedKg != null) {
                      feedByDate[pt.date] = parseFloat(
                        ((feedByDate[pt.date] || 0) + Number(pt.feedKg)).toFixed(1)
                      );
                    }
                  });
                }
              } catch {}
            }));
            eggData._feedByDate = feedByDate;
          }
        }
        setData(eggData);
      } else {
        const errBody = await eggRes.json().catch(() => ({}));
        console.error('Eggs API error', eggRes.status, errBody?.detail || errBody?.error || errBody);
      }
      // Merge weight data from both sources — prefer weight-records, fall back to weight-samples
      const wRecords = weightRes?.ok ? await weightRes.json().catch(() => null) : null;
      const wSamples = weightSamplesRes?.ok ? await weightSamplesRes.json().catch(() => null) : null;
      if (wRecords?.summary?.latestMeanWeightG || !wSamples?.summary?.latestMeanWeightG) {
        setWeightData(wRecords);
      } else {
        // weight_samples has data but weight_records doesn't — use samples
        // Normalise field names: meanWeightG → matches what the KPI cards expect
        setWeightData(wSamples);
      }
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

  // ── Split sections by stage ────────────────────────────────────────────────
  const broodingLayers   = layerSections.filter(s => (s.metrics?.stage || s.flock?.stage) === 'BROODING');
  const rearingLayers    = layerSections.filter(s =>
    (s.metrics?.stage || s.flock?.stage) === 'REARING' && s.currentBirds > 0
  );
  const productionLayers = layerSections.filter(s => {
    const st = s.metrics?.stage || s.flock?.stage || 'PRODUCTION';
    return st === 'PRODUCTION' && s.currentBirds > 0;
  });
  const hasBrooding     = broodingLayers.length > 0;
  const hasRearing      = rearingLayers.length > 0;
  const hasProduction   = productionLayers.length > 0;
  const hasMixed        = [hasBrooding, hasRearing, hasProduction].filter(Boolean).length > 1;
  const isLayerRearing  = hasRearing && !hasProduction && !hasBrooding;
  const isLayerBrooding = hasBrooding && !hasProduction && !hasRearing;

  // For REARING sections — fetch chart data from dashboard charts API
  // Use stable sectionId string (not the array ref) to keep dep array size constant
  const firstRearingSectionId = rearingLayers[0]?.id || null;
  useEffect(() => {
    if (!firstRearingSectionId) return;
    apiFetch(`/api/dashboard/charts?sectionId=${firstRearingSectionId}&days=${days}&stage=REARING`)
      .then(r => r.json())
      .then(d => setRearingChartData(d.series || d.chart || []))
      .catch(() => {});
  }, [firstRearingSectionId, days, apiFetch]);

  // ISA Brown target weight by age (weeks)
  const isaTarget = (ageDays) => { const w = Math.floor((ageDays||0)/7); return [40,60,100,150,210,280,360,450,550,660,770,880,990,1100,1200,1290,1370,1440][Math.min(w,17)] || 1440; };

  // ── PRODUCTION section metrics ──────────────────────────────────────────────
  const prodBirds   = productionLayers.reduce((a, s) => a + (s.currentBirds || 0), 0);
  // Build chart data using total production bird count for correct laying rate
  const chartData   = buildChartData(records, prodBirds);
  // Annotate each record with the day's aggregated laying rate
  // so the production records table shows the correct rate per date
  const dayRateMap  = Object.fromEntries(chartData.map(d => [d.date, d.layingRate]));
  const annotatedRecords = records.map(r => ({
    ...r,
    dayLayingRate: dayRateMap[new Date(r.collectionDate).toISOString().split('T')[0]] ?? r.layingRatePct,
  }));

  // Merge server-aggregated feed into chart data by date key FIRST
  if (data?._feedByDate && Object.keys(data._feedByDate).length > 0) {
    chartData.forEach(d => {
      const key    = d.date ? String(d.date).slice(0, 10) : '';
      const feedKg = data._feedByDate[key];
      d.feedKg     = feedKg != null ? parseFloat(Number(feedKg).toFixed(1)) : null;
    });
  }

  // Total feed from chart data — computed AFTER feed merge
  const totalFeedKg    = parseFloat(chartData.reduce((a,d)=>a+(d.feedKg||0),0).toFixed(1));
  const avgDailyFeedKg = chartData.filter(d=>d.feedKg!=null).length > 0
    ? parseFloat((totalFeedKg / chartData.filter(d=>d.feedKg!=null).length).toFixed(1)) : null;
  const feedGpbProd    = prodBirds > 0 && avgDailyFeedKg
    ? parseFloat((avgDailyFeedKg * 1000 / prodBirds).toFixed(1)) : null;
  const prodDead7   = productionLayers.reduce((a, s) => a + (s.metrics?.weekMortality || 0), 0);
  const prodMortRate= prodBirds > 0 ? parseFloat(((prodDead7 / prodBirds) * 100).toFixed(2)) : 0;

  const todayEggs   = productionLayers.reduce((a, s) => a + (s.metrics?.todayEggs || 0), 0);
  const weekEggs    = productionLayers.reduce((a, s) => a + (s.metrics?.weekEggs || 0), 0);

  // avgRate: compute correctly based on selected period
  //   Yesterday → last chartData entry (single day: total eggs that day / birds)
  //   Multi-day → average daily rate: total eggs across period / days with data / birds
  // Never use todayEggs from metrics (always today's live count — wrong for any non-today period).
  const lastChartDay    = chartData.length > 0 ? chartData[chartData.length - 1] : null;
  const daysWithEggs    = chartData.filter(d => (d.totalEggs || 0) > 0);
  const periodTotalEggsFromChart = chartData.reduce((a, d) => a + (d.totalEggs || 0), 0);

  let avgRate = null;
  if (prodBirds > 0) {
    if (days === YESTERDAY_DAYS) {
      // Single day: use last chart entry (yesterday's aggregated eggs)
      const yestEggs = lastChartDay?.totalEggs ?? 0;
      avgRate = yestEggs > 0
        ? parseFloat((yestEggs / prodBirds * 100).toFixed(1))
        : (todayEggs > 0 ? parseFloat((todayEggs / prodBirds * 100).toFixed(1)) : null);
    } else {
      // Multi-day: avg daily rate = total eggs / days that had collections / birds
      const activeDays = daysWithEggs.length || 1;
      avgRate = periodTotalEggsFromChart > 0
        ? parseFloat((periodTotalEggsFromChart / activeDays / prodBirds * 100).toFixed(1))
        : (todayEggs > 0 ? parseFloat((todayEggs / prodBirds * 100).toFixed(1)) : null);
    }
  }

  // periodEggsDisplay: eggs count for the KPI card
  const periodEggsDisplay = days === YESTERDAY_DAYS
    ? (lastChartDay?.totalEggs ?? todayEggs)
    : (periodTotalEggsFromChart > 0 ? periodTotalEggsFromChart : todayEggs);
  const eggsKpiLabel    = days === YESTERDAY_DAYS ? 'Eggs Yesterday'
    : days > 1 ? `Total Eggs (${days}d)` : 'Eggs Today';
  const layRateKpiLabel = days === YESTERDAY_DAYS ? 'Lay Rate (Yesterday)'
    : days > 1 ? `Avg Lay Rate (${days}d)` : 'Lay Rate (Today)';
  const gradeASecns = productionLayers.filter(s => (s.metrics?.todayGradeAPct || 0) > 0);
  // gradeAPct: derive from chartData's last day records rather than metrics.todayGradeAPct
  // metrics.todayGradeAPct always reflects today — wrong when Yesterday is selected.
  // Use the filtered records for the selected period to compute Grade A %.
  const periodRecords = days === YESTERDAY_DAYS
    ? records.filter(r => {
        const d = new Date(r.collectionDate).toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        return d === yesterday;
      })
    : records;
  const periodGradeACount  = periodRecords.reduce((a, r) => a + (r.gradeACount  || 0), 0);
  const periodTotalEggs    = periodRecords.reduce((a, r) => a + (r.totalEggs    || 0), 0);
  const periodGradedCount  = periodRecords.filter(r => r.gradeACount != null).length;
  // Only show Grade A % if at least one record in the period has been graded
  const gradeAPct = periodGradedCount > 0 && periodTotalEggs > 0
    ? parseFloat((periodGradeACount / periodTotalEggs * 100).toFixed(1))
    : (gradeASecns.length > 0
        ? parseFloat((gradeASecns.reduce((a, s) => a + (s.metrics?.todayGradeAPct || 0), 0) / gradeASecns.length).toFixed(1))
        : null);
  const prodWaterSecns = productionLayers.filter(s => s.metrics?.avgWaterLPB != null);
  const prodAvgWater   = prodWaterSecns.length ? parseFloat((prodWaterSecns.reduce((a, s) => a + (s.metrics?.avgWaterLPB || 0), 0) / prodWaterSecns.length).toFixed(2)) : null;
  const prodAvgAge  = productionLayers.length ? Math.round(productionLayers.reduce((a, s) => a + (s.ageInDays || 365), 0) / productionLayers.length) : 365;
  const prodWaterBench = layerWaterBenchmark(prodAvgAge);

  // ── REARING section metrics ─────────────────────────────────────────────────
  // Combine brooding + rearing for the "non-production" layer aggregates
  const nonProdLayers = [...broodingLayers, ...rearingLayers];

  // ── Feed aggregates ─────────────────────────────────────────────────────────
  const feedBenchmarkGpb = 120; // g/bird/day target for laying hens
  const feedStatus = (gpb) => gpb == null ? 'neutral'
    : gpb < feedBenchmarkGpb * 0.85 ? 'warn'
    : gpb > feedBenchmarkGpb * 1.15 ? 'warn' : 'good';

  // Production sections — today's feed
  const prodTodayFeedKg    = productionLayers.reduce((a,s)=>a+(s.metrics?.todayFeedKg||0),0);
  const prodAvgDailyFeedKg = productionLayers.reduce((a,s)=>a+(s.metrics?.avgDailyFeedKg||0),0);
  const prodFeedGpbToday   = prodBirds > 0 && prodTodayFeedKg > 0
    ? parseFloat((prodTodayFeedKg * 1000 / prodBirds).toFixed(1)) : null;
  const prodFeedGpb        = prodBirds > 0 && prodAvgDailyFeedKg > 0
    ? parseFloat((prodAvgDailyFeedKg * 1000 / prodBirds).toFixed(1)) : null;

  // Rearing/brooding sections — today's feed
  const rearTodayFeedKg  = nonProdLayers.reduce((a,s)=>a+(s.metrics?.todayFeedKg||0),0);
  const rearBirdsCount   = nonProdLayers.reduce((a,s)=>a+(s.currentBirds||0),0);
  const rearFeedGpbToday = rearBirdsCount > 0 && rearTodayFeedKg > 0
    ? parseFloat((rearTodayFeedKg * 1000 / rearBirdsCount).toFixed(1)) : null;

  const rearBirds   = nonProdLayers.reduce((a, s) => a + (s.currentBirds || 0), 0);
  const rearDead7   = nonProdLayers.reduce((a, s) => a + (s.metrics?.weekMortality || 0), 0);
  const rearMortRate= rearBirds > 0 ? parseFloat(((rearDead7 / rearBirds) * 100).toFixed(2)) : 0;
  const rearWtSecns = nonProdLayers.filter(s => s.metrics?.latestWeightG);
  const avgRearingWt= rearWtSecns.length ? parseFloat((rearWtSecns.reduce((a,s) => a + s.metrics.latestWeightG, 0) / rearWtSecns.length).toFixed(0)) : null;
  const rearFeedSecns = nonProdLayers.filter(s => s.metrics?.avgDailyFeedKg);
  const avgRearingFeed= rearFeedSecns.length ? parseFloat((rearFeedSecns.reduce((a,s) => a + (s.metrics?.avgDailyFeedKg||0), 0) / rearFeedSecns.length).toFixed(1)) : null;
  const rearWaterSecns = nonProdLayers.filter(s => s.metrics?.avgWaterLPB != null);
  const rearAvgWater   = rearWaterSecns.length ? parseFloat((rearWaterSecns.reduce((a, s) => a + (s.metrics?.avgWaterLPB || 0), 0) / rearWaterSecns.length).toFixed(2)) : null;
  const rearAvgAge  = nonProdLayers.length ? Math.round(nonProdLayers.reduce((a, s) => a + (s.ageInDays || 90), 0) / nonProdLayers.length) : 90;
  // Brooder temp — from brooding sections specifically
  const latestBrooderTemp = broodingLayers.map(s => s.metrics?.latestBrooderTemp).find(t => t != null) ?? null;
  const rearWaterBench = layerWaterBenchmark(rearAvgAge);
  const isaStd      = isaTarget(rearAvgAge);

  // ── Legacy aliases for single-mode compat ───────────────────────────────────
  const totBirds   = prodBirds + rearBirds;
  const totDead7   = prodDead7 + rearDead7;
  const mortRate   = totBirds > 0 ? parseFloat(((totDead7 / totBirds) * 100).toFixed(2)) : 0;
  const avgAge     = layerSections.length ? Math.round(layerSections.reduce((a, s) => a + (s.ageInDays || 180), 0) / layerSections.length) : 180;
  const avgWater   = prodAvgWater; // for production-mode compat
  const waterBench = prodWaterBench;

  // ── Per-group KPI cards ────────────────────────────────────────────────────
  const rearingKpis = nonProdLayers.length > 0 ? [
    { icon: isLayerBrooding ? '🐣' : '🌱', label: isLayerBrooding ? 'Live Chicks' : 'Live Pullets', value:fmt(rearBirds),
      sub:`${isLayerBrooding?'Brooding':'Week '+Math.floor(rearAvgAge/7)+' of rearing'} · ${nonProdLayers.length} section${nonProdLayers.length!==1?'s':''}`,
      delta:'', status:'neutral' },
    { icon:'🌾', label:'Feed Used Today',
      value: rearTodayFeedKg > 0 ? `${rearTodayFeedKg.toFixed(1)} kg` : '—',
      sub: (() => {
        const bags = rearTodayFeedKg > 0 ? fmtBags(rearTodayFeedKg, bagWeightKg) : null;
        const gpbStr = rearFeedGpbToday ? `${rearFeedGpbToday} g/bird` : null;
        if (rearTodayFeedKg > 0) return [bags, gpbStr].filter(Boolean).join(' · ');
        return avgRearingFeed ? `None yet today · 7d avg ${avgRearingFeed} kg/day` : `Target ~${feedBenchmarkGpb} g/bird/day`;
      })(),
      delta: rearTodayFeedKg > 0 ? 'Feed logged today' : 'No feed logged yet today',
      status: 'neutral' },
    ...(isLayerBrooding ? [{
      icon:'🌡️', label:'Brooder Temp',
      value: latestBrooderTemp!=null?`${Number(latestBrooderTemp).toFixed(1)}°C`:'—',
      sub:'Latest reading · Safe range 26–38°C',
      delta: latestBrooderTemp!=null?(latestBrooderTemp<26||latestBrooderTemp>38?'⚠ Out of range':'✓ In range'):'No reading yet',
      status: latestBrooderTemp==null?'neutral':latestBrooderTemp<26||latestBrooderTemp>38?'critical':latestBrooderTemp<28||latestBrooderTemp>35?'warn':'good',
    }] : []),
    { icon:'⚖️', label:'Avg Body Weight',
      value:avgRearingWt?`${(avgRearingWt/1000).toFixed(3)} kg`:'—',
      sub:`ISA Brown target wk${Math.floor(rearAvgAge/7)}: ${(isaStd/1000).toFixed(3)} kg`,
      delta:avgRearingWt?(avgRearingWt>=isaStd*0.95?'On target':avgRearingWt>=isaStd*0.85?'Slightly below target':'Below target'):'No weigh-in yet',
      status:avgRearingWt?(avgRearingWt>=isaStd*0.95?'good':avgRearingWt>=isaStd*0.85?'warn':'critical'):'neutral' },

    { icon:'💧', label:'Water Intake',
      value:rearAvgWater!=null?`${rearAvgWater} L/bird`:'—',
      sub:rearAvgWater!=null?`Benchmark ${rearWaterBench} L/bird · age ${rearAvgAge}d`:'Not tracked yet',
      delta:rearAvgWater!=null?(rearAvgWater>=rearWaterBench*0.85?'Within normal range':'Below recommended level'):'',
      status:rearAvgWater!=null?waterStatus(rearAvgWater,rearWaterBench):'neutral' },
    { icon:'📉', label:'Mortality (7d)', value:fmt(rearDead7),
      sub:`${rearMortRate}% of flock`,
      delta:rearMortRate<=0.05?'Within normal range':rearMortRate<=0.15?'Slightly elevated':'Elevated — investigate',
      status:mortalityStatus(rearMortRate) },
  ] : [];

  const productionKpis = productionLayers.length > 0 ? [
    { icon:'🐦', label:'Live Hens', value:fmt(prodBirds),
      sub:`${productionLayers.length} section${productionLayers.length!==1?'s':''}`,
      delta:'', status:'neutral' },
    { icon:'🌾', label:'Feed Used Today',
      value: prodTodayFeedKg > 0 ? `${prodTodayFeedKg.toFixed(1)} kg` : '—',
      sub: (() => {
        const bags = prodTodayFeedKg > 0 ? fmtBags(prodTodayFeedKg, bagWeightKg) : null;
        const gpbStr = prodFeedGpbToday ? `${prodFeedGpbToday} g/bird` : null;
        if (prodTodayFeedKg > 0) return [bags, gpbStr].filter(Boolean).join(' · ');
        return prodAvgDailyFeedKg > 0
          ? `None yet today · 7d avg ${prodAvgDailyFeedKg.toFixed(1)} kg/day`
          : `Target ~${feedBenchmarkGpb} g/bird/day`;
      })(),
      delta: prodFeedGpbToday
        ? (prodFeedGpbToday >= feedBenchmarkGpb * 0.85 && prodFeedGpbToday <= feedBenchmarkGpb * 1.15
          ? 'Within normal range'
          : prodFeedGpbToday < feedBenchmarkGpb * 0.85 ? 'Below recommended level' : 'Above recommended level')
        : 'No feed logged yet today',
      status: feedStatus(prodFeedGpbToday) },
    { icon:'📊', label:layRateKpiLabel,
      value:avgRate!=null?`${avgRate}%`:'—', sub:'Target 82%',
      delta:avgRate!=null?(avgRate>=82?`+${(avgRate-82).toFixed(1)}% above target`:`${(avgRate-82).toFixed(1)}% below target`):'No data yet',
      status:avgRate!=null?layRateStatus(avgRate):'neutral' },
    { icon:'🥚', label:eggsKpiLabel, value:fmt(periodEggsDisplay),
      sub:`7d total ${fmt(weekEggs)}`,
      delta:periodEggsDisplay>0?`${fmt(periodEggsDisplay)} collected`:'None recorded yet',
      status:periodEggsDisplay>0?'good':'neutral' },
    { icon:'⭐', label:'Grade A Rate',
      value:gradeAPct!=null?`${gradeAPct}%`:'—', sub:'Target ≥85%',
      delta:gradeAPct!=null?(gradeAPct>=85?`+${(gradeAPct-85).toFixed(1)}% above target`:`${(gradeAPct-85).toFixed(1)}% below target`):'No data yet',
      status:gradeAStatus(gradeAPct) },
    { icon:'💧', label:'Water Intake',
      value:prodAvgWater!=null?`${prodAvgWater} L/bird`:'—',
      sub:prodAvgWater!=null?`Benchmark ${prodWaterBench} L/bird · age ${prodAvgAge}d`:'Not tracked yet',
      delta:prodAvgWater!=null?(prodAvgWater>=prodWaterBench*0.85?'Within normal range':'Below recommended level'):'',
      status:prodAvgWater!=null?waterStatus(prodAvgWater,prodWaterBench):'neutral' },
    { icon:'📉', label:'Mortality (7d)', value:fmt(prodDead7),
      sub:`${prodMortRate}% of flock`,
      delta:prodMortRate<=0.05?'Within normal range':prodMortRate<=0.15?'Slightly elevated':'Elevated — investigate',
      status:mortalityStatus(prodMortRate) },
  ] : [];

  // Legacy: combined for single-mode
  const sectionKpis = hasMixed ? [] : (isLayerRearing ? rearingKpis : productionKpis);

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>
              {hasMixed ? '📊 Layer Performance' : isLayerRearing ? '🌱 Rearing Performance' : '📊 Layer Performance'}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
              {hasMixed ? 'Mixed flock stages — rearing & production sections' : isLayerRearing ? 'Pullet weight tracking, feed & mortality' : 'Layer section metrics & egg production records'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Yesterday special filter */}
            <button onClick={() => setDays(YESTERDAY_DAYS)} className="btn"
              style={{ fontSize: 11, padding: '5px 12px',
                background: days === YESTERDAY_DAYS ? 'var(--purple-light)' : '#fff',
                color:      days === YESTERDAY_DAYS ? 'var(--purple)' : 'var(--text-muted)',
                border:    `1px solid ${days === YESTERDAY_DAYS ? '#d4d8ff' : 'var(--border)'}`,
                fontWeight: days === YESTERDAY_DAYS ? 700 : 600 }}>
              Yesterday
            </button>
            {PERIOD_OPTIONS.map(d => (
              <button key={d} onClick={() => setDays(d)} className="btn"
                style={{ fontSize: 11, padding: '5px 12px', background: days === d ? 'var(--purple-light)' : '#fff', color: days === d ? 'var(--purple)' : 'var(--text-muted)', border: `1px solid ${days === d ? '#d4d8ff' : 'var(--border)'}`, fontWeight: days === d ? 700 : 600 }}>
                {d}d
              </button>
            ))}
            {canLog && hasProduction && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Log Collection</button>}
          </div>
        </div>

        {/* ── Stage toggle (mixed mode only) ── */}
        {hasMixed && (
          <div style={{ display:'flex', gap:6, marginBottom:20, background:'var(--bg-elevated)', borderRadius:10, padding:4, alignSelf:'flex-start', width:'fit-content' }}>
            {hasProduction && (
              <button onClick={()=>setStageTab('production')}
                style={{ padding:'6px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:700,
                  background:stageTab==='production'?'#fff':'transparent',
                  color:stageTab==='production'?'#d97706':'var(--text-muted)',
                  boxShadow:stageTab==='production'?'0 1px 4px rgba(0,0,0,0.10)':'none' }}>
                🥚 Production ({productionLayers.length})
              </button>
            )}
            {hasRearing && (
              <button onClick={()=>setStageTab('rearing')}
                style={{ padding:'6px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:700,
                  background:stageTab==='rearing'?'#fff':'transparent',
                  color:stageTab==='rearing'?'#16a34a':'var(--text-muted)',
                  boxShadow:stageTab==='rearing'?'0 1px 4px rgba(0,0,0,0.10)':'none' }}>
                🌱 Rearing ({rearingLayers.length})
              </button>
            )}
            {hasBrooding && (
              <button onClick={()=>setStageTab('brooding')}
                style={{ padding:'6px 16px', borderRadius:8, border:'none', cursor:'pointer', fontSize:12, fontWeight:700,
                  background:stageTab==='brooding'?'#fff':'transparent',
                  color:stageTab==='brooding'?'#6c63ff':'var(--text-muted)',
                  boxShadow:stageTab==='brooding'?'0 1px 4px rgba(0,0,0,0.10)':'none' }}>
                🐣 Brooding ({broodingLayers.length})
              </button>
            )}
          </div>
        )}

        {/* ── Section KPI cards ── */}
        {(() => {
          const kpis = hasMixed
            ? (stageTab==='brooding' ? rearingKpis  // brooding uses same weight/temp KPIs as rearing but labelled brooding
               : stageTab==='rearing' ? rearingKpis
               : productionKpis)
            : (isLayerBrooding || isLayerRearing ? rearingKpis : productionKpis);
          if (!kpis.length) return null;
          return (
            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                My Section Performance
                <span style={{ fontSize:10, fontWeight:600, color:'#6c63ff', background:'#eeecff', border:'1px solid #d4d8ff', borderRadius:4, padding:'1px 6px', textTransform:'none', letterSpacing:0 }}>
                  Live · Today
                </span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:`repeat(${kpis.length},1fr)`, gap:12 }}>
                {loading ? Array(kpis.length).fill(0).map((_,i)=><Skeleton key={i} h={110}/>)
                         : kpis.map(k=><PerfKpiCard key={k.label} {...k}/>)}
              </div>
            </div>
          );
        })()}

        {/* ── Records block ── */}
        {(() => {
          const showRearing    = hasMixed ? (stageTab==='rearing' || stageTab==='brooding') : (hasRearing || isLayerBrooding);
          const showProduction = hasMixed ? stageTab==='production' : hasProduction;
          return (
            <div style={{ borderTop:'1px solid var(--border)', marginBottom:20, paddingTop:20 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:16 }}>
                {showRearing ? `Weight Records · Last ${days} days` : `Production Records · ${days === YESTERDAY_DAYS ? 'Yesterday' : `Last ${days} days`}`}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 }}>
                {loading ? Array(5).fill(0).map((_,i)=><Skeleton key={i} h={88}/>) : showRearing ? (() => {
                  const wSummary  = weightData?.summary || {};
                  const latestWt  = wSummary.latestMeanWeightG;
                  const gain7d    = wSummary.weightGain7d;
                  const uniformity= wSummary.latestUniformityPct;
                  const totalSamp = wSummary.totalSamples || 0;
                  const latestDate= wSummary.latestSampleDate
                    ? new Date(wSummary.latestSampleDate).toLocaleDateString('en-NG',{day:'numeric',month:'short'})
                    : null;
                  const wtStatus = latestWt==null?'var(--text-muted)':latestWt>=isaStd*0.95?'var(--green)':latestWt>=isaStd*0.85?'var(--amber)':'var(--red)';
                  return (<>
                    <KpiCard icon="⚖️" label="Latest Avg Weight"
                      value={latestWt?`${(latestWt/1000).toFixed(3)} kg`:'—'}
                      sub={latestDate?`Weighed ${latestDate} · Target ${(isaStd/1000).toFixed(3)} kg`:'No weigh-in yet'}
                      color={wtStatus}/>
                    <KpiCard icon="📈" label="7d Weight Gain"
                      value={gain7d!=null?`+${gain7d}g`:'—'} sub="vs previous weigh-in"
                      color={gain7d!=null&&gain7d>0?'var(--green)':'var(--text-muted)'}/>
                    <KpiCard icon="📐" label="Uniformity"
                      value={uniformity!=null?`${uniformity}%`:'—'} sub="Target ≥80%"
                      color={uniformity==null?'var(--text-muted)':uniformity>=80?'var(--green)':uniformity>=70?'var(--amber)':'var(--red)'}/>
                    <KpiCard icon="🗂️" label="Total Weigh-ins"
                      value={fmt(totalSamp)} sub={`last ${days} days`} color="var(--purple)"/>
                    <KpiCard icon="📅" label="Days in Rearing"
                      value={rearAvgAge!=null?`${rearAvgAge}d`:'—'}
                      sub={`Week ${Math.floor((rearAvgAge||0)/7)} of rearing`} color="var(--blue)"/>
                  </>);
                })() : (<>
                  <KpiCard icon="🥚" label="Total Eggs"      value={fmt(periodTotalEggs || summary.totalEggs)} sub={`last ${days === YESTERDAY_DAYS ? 1 : days} days`}  color="var(--amber)"/>
                  <KpiCard icon="📊" label="Avg Laying Rate" value={avgRate!=null?`${avgRate}%`:`${summary.avgLayingRate||0}%`} sub="of active birds" color={Number(avgRate??summary.avgLayingRate)>=80?'var(--green)':'var(--amber)'}/>
                  <KpiCard icon="⭐" label="Grade A"         value={fmt(periodGradeACount || summary.totalGradeA)} sub={`${gradeAPct!=null?gradeAPct:gradeAPct2(summary)}% of total`} color="var(--green)"/>
                  <KpiCard icon="🧺" label="Total Crates"    value={fmt(periodRecords.reduce((a,r)=>a+(r.cratesCollected||0),0) || summary.totalCrates)} sub="30 eggs per crate" color="var(--purple)"/>
                  <KpiCard icon="🌾" label="Daily Feed Avg"
                    value={avgDailyFeedKg ? `${avgDailyFeedKg} kg` : '—'}
                    sub={(() => {
                      if (!avgDailyFeedKg) return 'No feed data';
                      const bags = fmtBags(avgDailyFeedKg, bagWeightKg);
                      const gpb = feedGpbProd ? `${feedGpbProd} g/bird` : null;
                      const total = `total ${totalFeedKg} kg`;
                      return [bags, gpb, total].filter(Boolean).join(' · ');
                    })()}
                    color="var(--purple)"/>
                </>)}
              </div>
            </div>
          );
        })()}

        {/* Flock filter */}
        {flocks.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <select className="input" style={{ maxWidth: 300 }} value={flockFilter} onChange={e => setFlockFilter(e.target.value)}>
              <option value="">All layer flocks</option>
              {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode}{f.stage?` (${f.stage})`:''} — {f.penSection?.pen?.name}</option>)}
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

        {/* ── Overview tab — stage-aware charts ── */}
        {tab === 'overview' && (() => {
          const showRearing = hasMixed ? (stageTab==='rearing'||stageTab==='brooding') : (hasRearing||isLayerBrooding);
          return showRearing ? (
            <div style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:16 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Pullet Weight Growth</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:16 }}>Mean body weight vs ISA Brown target — {days} days</div>
                  {loading ? <Skeleton h={240}/> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={rearingChartData} margin={{top:4,right:8,bottom:4,left:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                        <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fontSize:10,fill:'var(--text-muted)'}}/>
                        <YAxis tick={{fontSize:10,fill:'var(--text-muted)'}} width={50} unit="g"/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
                        <Line type="monotone" dataKey="avgWeightG" name="Avg Weight (g)" stroke="var(--purple)" strokeWidth={2.5} dot={{r:3}} connectNulls/>
                        <Line type="monotone" dataKey="targetWeightG" name="ISA Brown Target" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Daily Feed Intake</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:16 }}>Feed kg/day · {days} days</div>
                  {loading ? <Skeleton h={180}/> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <ComposedChart data={rearingChartData} margin={{top:4,right:8,bottom:4,left:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                        <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fontSize:10,fill:'var(--text-muted)'}}/>
                        <YAxis yAxisId="kg" tick={{fontSize:10}} width={45} unit="kg"/>
                        <YAxis yAxisId="r" orientation="right" tick={{fontSize:10}} width={38} unit="g"/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar yAxisId="kg" dataKey="feedKg" name="Feed (kg)" fill="#6c63ff" opacity={0.85} radius={[3,3,0,0]}/>
                        <Line yAxisId="r" type="monotone" dataKey="feedGpb" name="g/bird" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>Daily Mortality</div>
                  {loading ? <Skeleton h={220}/> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={rearingChartData} margin={{top:4,right:8,bottom:4,left:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                        <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fontSize:10,fill:'var(--text-muted)'}}/>
                        <YAxis tick={{fontSize:10}} width={35} allowDecimals={false}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Bar dataKey="deaths" name="Deaths" fill="#ef4444" opacity={0.8} radius={[3,3,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>Flock Uniformity</div>
                  {loading ? <Skeleton h={80}/> : (() => {
                    const uni = weightData?.summary?.latestUniformityPct ?? null;
                    const uniColor = !uni?'#94a3b8':uni>=80?'#16a34a':uni>=70?'#d97706':'#ef4444';
                    return (
                      <div>
                        <div style={{fontFamily:"'Poppins',sans-serif",fontSize:32,fontWeight:700,color:uniColor,lineHeight:1,marginBottom:4}}>
                          {uni!=null?`${uni}%`:'—'}
                        </div>
                        <div style={{fontSize:11,color:'var(--text-muted)'}}>
                          {uni==null?'No weigh-in yet':uni>=80?'✅ Good (target ≥80%)':uni>=70?'⚠ Moderate':'❌ Poor — investigate'}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:16 }}>
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Daily Eggs Collected &amp; Feed Consumed</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:16 }}>Eggs (bars, left axis) · Feed kg (line, right axis) — {days} days</div>
                  {loading ? <Skeleton h={240}/> : chartData.length===0 ? <EmptyState/> : (
                    <ResponsiveContainer width="100%" height={240}>
                      <ComposedChart data={chartData} margin={{top:4,right:44,bottom:4,left:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                        <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fontSize:10,fill:'var(--text-muted)'}}/>
                        <YAxis yAxisId="eggs" orientation="left" tick={{fontSize:10,fill:'var(--text-muted)'}} width={50} tickFormatter={v=>fmt(v)}/>
                        <YAxis yAxisId="feed" orientation="right" tick={{fontSize:10,fill:'#16a34a'}} width={44} tickFormatter={v=>`${v}kg`}/>
                        <Tooltip content={({active,payload,label})=>{
                          if(!active||!payload?.length) return null;
                          return(<div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',fontSize:12}}>
                            <div style={{fontWeight:700,color:'var(--text-muted)',marginBottom:6}}>{fmtDate(label)}</div>
                            {payload.map((p,i)=>(<div key={i} style={{color:p.color,marginBottom:2}}>{p.name}: <strong>{p.name==='Feed (kg)'?`${Number(p.value).toFixed(1)} kg`:fmt(p.value)}</strong></div>))}
                          </div>);
                        }}/>
                        <Legend iconSize={10} wrapperStyle={{fontSize:11}}/>
                        <Bar yAxisId="eggs" dataKey="totalEggs" name="Total Eggs" fill="var(--amber)" radius={[3,3,0,0]}/>
                        <Line yAxisId="feed" type="monotone" dataKey="feedKg" name="Feed (kg)" stroke="#16a34a" strokeWidth={2} dot={{r:3,fill:'#16a34a'}} activeDot={{r:5}} connectNulls/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Laying Rate Trend</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:16 }}>Daily laying rate % (target: 80%+)</div>
                  {loading ? <Skeleton h={180}/> : chartData.length===0 ? <EmptyState/> : (
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={chartData} margin={{top:4,right:8,bottom:4,left:0}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                        <XAxis dataKey="date" tickFormatter={fmtDate} tick={{fontSize:10,fill:'var(--text-muted)'}}/>
                        <YAxis domain={[0,100]} tick={{fontSize:10,fill:'var(--text-muted)'}} width={35} tickFormatter={v=>`${v}%`}/>
                        <Tooltip content={<ChartTooltip/>}/>
                        <Line type="monotone" dataKey="layingRate" name="Laying Rate %" stroke="var(--green)" strokeWidth={2} dot={false} activeDot={{r:4}}/>
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>Grade Breakdown</div>
                  {loading ? <Skeleton h={140}/> : gradeData.length===0 ? <EmptyState msg="No grade data recorded"/> : (
                    <div style={{display:'flex',flexDirection:'column',gap:10}}>
                      {[
                        {label:'Grade A',value:summary.totalGradeA, color:GRADE_COLORS.gradeA, pct:gradePct(summary.totalGradeA,summary.totalEggs)},
                        {label:'Grade B',value:summary.totalGradeB, color:GRADE_COLORS.gradeB, pct:gradePct(summary.totalGradeB,summary.totalEggs)},
                        {label:'Cracked',value:summary.totalCracked,color:GRADE_COLORS.cracked,pct:gradePct(summary.totalCracked,summary.totalEggs)},
                      ].map(g=>(
                        <div key={g.label}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                            <span style={{fontWeight:700,color:g.color}}>{g.label}</span>
                            <span style={{color:'var(--text-muted)'}}>{fmt(g.value)} ({g.pct}%)</span>
                          </div>
                          <div style={{height:6,background:'var(--border)',borderRadius:3}}>
                            <div style={{height:'100%',width:`${g.pct}%`,background:g.color,borderRadius:3,transition:'width 0.6s ease'}}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="card">
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>By Flock</div>
                  {loading ? <Skeleton h={160}/> : (
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {buildFlockSummary(annotatedRecords).map(f=>(
                        <div key={f.batchCode} style={{padding:'10px 12px',background:'var(--bg-elevated)',borderRadius:9,border:'1px solid var(--border)'}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                            <span style={{fontWeight:700,fontSize:12}}>{f.batchCode}</span>
                            <span style={{fontSize:12,fontWeight:700,color:'var(--amber)'}}>{fmt(f.total)} eggs</span>
                          </div>
                          <div style={{fontSize:11,color:'var(--text-muted)'}}>{f.pen} · avg {f.avgRate}% lay rate</div>
                        </div>
                      ))}
                      {records.length===0 && <EmptyState msg="No records in this period"/>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Daily Log tab */}
        {tab === 'log' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? <div style={{ padding: 40, textAlign: 'center' }}><Skeleton h={200} /></div> : records.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🥚</div>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>No egg records in this period</div>
                {canLog && hasProduction && <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>Log First Collection</button>}
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
                  {annotatedRecords.map(r => (
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
                        <span style={{ fontWeight: 700, color: Number(r.dayLayingRate ?? r.layingRatePct) >= 80 ? 'var(--green)' : 'var(--amber)' }}>
                      {Number((r.dayLayingRate ?? r.layingRatePct) || 0).toFixed(1)}%
                    </span>
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
function buildChartData(records, currentBirds) {
  const map = {};
  records.forEach(r => {
    const d = new Date(r.collectionDate).toISOString().split('T')[0];
    if (!map[d]) map[d] = { date: d, totalEggs: 0 };
    map[d].totalEggs += r.totalEggs || 0;
  });
  // Compute laying rate from daily totalEggs / bird count — not avg of per-record rates
  const birds = currentBirds || 0;
  return Object.values(map)
    .map(d => ({ ...d, layingRate: birds > 0 ? parseFloat((d.totalEggs / birds * 100).toFixed(1)) : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function buildFlockSummary(records) {
  // Compute avg laying rate as total eggs / (days spanned * bird count)
  // First group by flock, then by date to get unique days
  const map = {};
  records.forEach(r => {
    const k = r.flock?.batchCode;
    if (!k) return;
    if (!map[k]) map[k] = {
      batchCode: k,
      pen:       r.penSection?.pen?.name,
      total:     0,
      birds:     r.flock?.currentCount || 0,
      dates:     new Set(),
    };
    map[k].total += r.totalEggs || 0;
    map[k].dates.add(new Date(r.collectionDate).toISOString().split('T')[0]);
  });
  return Object.values(map).map(f => {
    const days   = f.dates.size || 1;
    const birds  = f.birds || 0;
    // Daily avg rate = total eggs over period / days / bird count
    const avgRate = birds > 0 ? (f.total / days / birds * 100).toFixed(1) : 0;
    return { batchCode: f.batchCode, pen: f.pen, total: f.total, avgRate };
  });
}
