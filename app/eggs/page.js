'use client';
// app/eggs/page.js — Egg Production Module
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import PortalModal from '@/components/ui/Modal';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';

const PERIOD_OPTIONS = [7, 14, 30, 90];
const GRADE_COLORS   = { gradeA: '#16a34a', gradeB: '#f59e0b', cracked: '#ef4444', dirty: '#9ca3af' };
const fmt            = n => Number(n || 0).toLocaleString('en-NG');
const fmtDate        = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

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
  const [form, setForm]   = useState({ flockId: '', penSectionId: '', collectionDate: new Date().toISOString().split('T')[0], totalEggs: '', gradeACount: '', gradeBCount: '', crackedCount: '', dirtyCount: '' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectedFlock = flocks.find(f => f.id === form.flockId);

  const handleFlockChange = (flockId) => {
    const flock = flocks.find(f => f.id === flockId);
    set('flockId', flockId);
    set('penSectionId', flock?.penSectionId || '');
  };

  const total     = Number(form.totalEggs) || 0;
  const gradeSum  = (Number(form.gradeACount) || 0) + (Number(form.gradeBCount) || 0) + (Number(form.crackedCount) || 0) + (Number(form.dirtyCount) || 0);
  const layingPct = selectedFlock?.currentCount > 0 ? ((total / selectedFlock.currentCount) * 100).toFixed(1) : null;

  async function save() {
    if (!form.flockId)     return setError('Select a flock');
    if (!form.totalEggs || total <= 0) return setError('Enter total eggs collected');
    if (gradeSum > total)  return setError('Grade breakdown exceeds total eggs');
    setSaving(true); setError('');
    try {
      const payload = {
        flockId:       form.flockId,
        penSectionId:  form.penSectionId,
        collectionDate: form.collectionDate,
        totalEggs:     total,
        ...(form.gradeACount  && { gradeACount:  Number(form.gradeACount) }),
        ...(form.gradeBCount  && { gradeBCount:  Number(form.gradeBCount) }),
        ...(form.crackedCount && { crackedCount: Number(form.crackedCount) }),
        ...(form.dirtyCount   && { dirtyCount:   Number(form.dirtyCount) }),
      };
      const res = await apiFetch('/api/eggs', { method: 'POST', body: JSON.stringify(payload) });
      const d   = await res.json();
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
          <select className="input" value={form.flockId} onChange={e => handleFlockChange(e.target.value)}>
            <option value="">— Select flock —</option>
            {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} · {f.penSection?.pen?.name} › {f.penSection?.name} · {fmt(f.currentCount)} birds</option>)}
          </select>
        </div>
        <div>
          <label className="label">Collection Date *</label>
          <input type="date" className="input" value={form.collectionDate} onChange={e => set('collectionDate', e.target.value)} max={new Date().toISOString().split('T')[0]} />
        </div>
        <div>
          <label className="label">Total Eggs Collected *</label>
          <input type="number" className="input" min="0" value={form.totalEggs} onChange={e => set('totalEggs', e.target.value)} placeholder="e.g. 1800" />
          {layingPct && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Laying rate: <strong style={{ color: Number(layingPct) >= 80 ? 'var(--green)' : 'var(--amber)' }}>{layingPct}%</strong></div>}
        </div>
        <div>
          <label className="label">Grade Breakdown <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {[['gradeACount','Grade A','var(--green)'],['gradeBCount','Grade B','var(--amber)'],['crackedCount','Cracked','var(--red)'],['dirtyCount','Dirty','#9ca3af']].map(([k, label, color]) => (
              <div key={k}>
                <div style={{ fontSize: 10, fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
                <input type="number" className="input" min="0" value={form[k]} onChange={e => set(k, e.target.value)} placeholder="0" style={{ padding: '7px 10px' }} />
              </div>
            ))}
          </div>
          {gradeSum > 0 && <div style={{ fontSize: 11, color: gradeSum > total ? 'var(--red)' : 'var(--text-muted)', marginTop: 4 }}>{gradeSum} / {total} accounted for</div>}
        </div>
        {total > 0 && <div style={{ padding: '10px 14px', background: 'var(--purple-light)', borderRadius: 9, border: '1px solid #d4d8ff', fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: 'var(--purple)', marginBottom: 2 }}>Crates: {Math.floor(total / 30)}</div>
          <div style={{ color: 'var(--text-muted)' }}>{total} eggs ÷ 30 = {Math.floor(total / 30)} crates, {total % 30} loose</div>
        </div>}
      </div>
    </PortalModal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
// ── Edit Egg Modal (for rejected/returned records) ────────────────────────────
function EditEggModal({ record, flocks, onClose, onSave, apiFetch }) {
  const [form, setForm] = useState({
    totalEggs:     String(record.totalEggs),
    gradeACount:   String(record.gradeACount || ''),
    gradeBCount:   String(record.gradeBCount || ''),
    crackedCount:  String(record.crackedCount || ''),
    dirtyCount:    String(record.dirtyCount   || ''),
    collectionDate: record.collectionDate?.split('T')[0] || new Date().toISOString().split('T')[0],
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const selectedFlock = flocks.find(f => f.id === record.flockId);
  const total    = Number(form.totalEggs) || 0;
  const gradeSum = (Number(form.gradeACount) || 0) + (Number(form.gradeBCount) || 0) + (Number(form.crackedCount) || 0) + (Number(form.dirtyCount) || 0);
  const layingPct = selectedFlock?.currentCount > 0 ? ((total / selectedFlock.currentCount) * 100).toFixed(1) : null;

  async function save() {
    if (total <= 0) return setError('Enter total eggs collected');
    if (gradeSum > total) return setError('Grade breakdown exceeds total eggs');
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/eggs/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          totalEggs:     total,
          gradeACount:   form.gradeACount  ? Number(form.gradeACount)  : undefined,
          gradeBCount:   form.gradeBCount  ? Number(form.gradeBCount)  : undefined,
          crackedCount:  form.crackedCount ? Number(form.crackedCount) : undefined,
          dirtyCount:    form.dirtyCount   ? Number(form.dirtyCount)   : undefined,
          collectionDate: form.collectionDate,
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
      {/* Rejection reason banner */}
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
            {record.flock?.batchCode} · {record.penSection?.pen?.name} › {record.penSection?.name}
          </div>
        </div>
        <div>
          <label className="label">Collection Date *</label>
          <input type="date" className="input" value={form.collectionDate} onChange={e => set('collectionDate', e.target.value)} max={new Date().toISOString().split('T')[0]} />
        </div>
        <div>
          <label className="label">Total Eggs Collected *</label>
          <input type="number" className="input" min="0" value={form.totalEggs} onChange={e => set('totalEggs', e.target.value)} />
          {layingPct && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Laying rate: <strong style={{ color: Number(layingPct) >= 80 ? 'var(--green)' : 'var(--amber)' }}>{layingPct}%</strong></div>}
        </div>
        <div>
          <label className="label">Grade Breakdown <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {[['gradeACount','Grade A','var(--green)'],['gradeBCount','Grade B','var(--amber)'],['crackedCount','Cracked','var(--red)'],['dirtyCount','Dirty','#9ca3af']].map(([k, label, color]) => (
              <div key={k}>
                <div style={{ fontSize: 10, fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
                <input type="number" className="input" min="0" value={form[k]} onChange={e => set(k, e.target.value)} placeholder="0" style={{ padding: '7px 10px' }} />
              </div>
            ))}
          </div>
          {gradeSum > 0 && <div style={{ fontSize: 11, color: gradeSum > total ? 'var(--red)' : 'var(--text-muted)', marginTop: 4 }}>{gradeSum} / {total} accounted for</div>}
        </div>
      </div>
    </PortalModal>
  );
}


export default function EggsPage() {
  const { apiFetch, user } = useAuth();

  const [days,      setDays]      = useState(30);
  const [data,      setData]      = useState(null);
  const [flocks,    setFlocks]    = useState([]);
  const [flockFilter, setFlockFilter] = useState('');
  const [loading,   setLoading]   = useState(true);
  const [showModal,   setShowModal]   = useState(false);
  const [editRecord,  setEditRecord]  = useState(null); // record to correct & resubmit
  const [tab,       setTab]       = useState('overview'); // overview | log

  const canLog = ['PEN_WORKER','PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eggRes, flockRes] = await Promise.all([
        apiFetch(`/api/eggs?days=${days}${flockFilter ? `&flockId=${flockFilter}` : ''}`),
        apiFetch('/api/farm-structure'),
      ]);
      if (eggRes.ok)   setData(await eggRes.json());
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

  const { summary = {}, records = [], aggregated = [] } = data || {};

  // Build chart series from records grouped by date
  const chartData = buildChartData(records, days);

  // Cause breakdown for grade pie
  const gradeData = [
    { name: 'Grade A', value: summary.totalGradeA || 0, color: GRADE_COLORS.gradeA },
    { name: 'Grade B', value: summary.totalGradeB || 0, color: GRADE_COLORS.gradeB },
    { name: 'Cracked', value: summary.totalCracked || 0, color: GRADE_COLORS.cracked },
    { name: 'Dirty',   value: summary.totalDirty || 0,   color: GRADE_COLORS.dirty },
  ].filter(g => g.value > 0);

  return (
    <AppShell>
      <div className="animate-in">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>🥚 Egg Production</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>Layer flock collection records & trends</p>
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

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
          {loading ? Array(5).fill(0).map((_, i) => <Skeleton key={i} h={88} />) : <>
            <KpiCard icon="🥚" label="Total Eggs"      value={fmt(summary.totalEggs)}       sub={`last ${days} days`}           color="var(--amber)" />
            <KpiCard icon="📊" label="Avg Laying Rate" value={`${summary.avgLayingRate || 0}%`} sub="of active birds"           color={Number(summary.avgLayingRate) >= 80 ? 'var(--green)' : 'var(--amber)'} />
            <KpiCard icon="⭐" label="Grade A"         value={fmt(summary.totalGradeA)}     sub={`${gradeAPct(summary)}% of total`} color="var(--green)" />
            <KpiCard icon="🧺" label="Total Crates"    value={fmt(summary.totalCrates)}     sub="30 eggs per crate"             color="var(--purple)" />
            <KpiCard icon="📅" label="Daily Average"   value={fmt(summary.avgDailyEggs)}    sub="eggs per day"                  color="var(--blue)" />
          </>}
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

              {/* Eggs collected trend */}
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

              {/* Laying rate trend */}
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

              {/* Grade breakdown */}
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Grade Breakdown</div>
                {loading ? <Skeleton h={140} /> : gradeData.length === 0 ? <EmptyState msg="No grade data recorded" /> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      { label: 'Grade A', value: summary.totalGradeA, color: GRADE_COLORS.gradeA, pct: gradePct(summary.totalGradeA, summary.totalEggs) },
                      { label: 'Grade B', value: summary.totalGradeB, color: GRADE_COLORS.gradeB, pct: gradePct(summary.totalGradeB, summary.totalEggs) },
                      { label: 'Cracked', value: summary.totalCracked, color: GRADE_COLORS.cracked, pct: gradePct(summary.totalCracked, summary.totalEggs) },
                      { label: 'Dirty',   value: summary.totalDirty,   color: GRADE_COLORS.dirty,   pct: gradePct(summary.totalDirty, summary.totalEggs) },
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

              {/* Per-flock summary */}
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
                    <th>Date</th>
                    <th>Flock</th>
                    <th>Pen · Section</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Grade A</th>
                    <th style={{ textAlign: 'right' }}>Grade B</th>
                    <th style={{ textAlign: 'right' }}>Cracked</th>
                    <th style={{ textAlign: 'right' }}>Crates</th>
                    <th style={{ textAlign: 'right' }}>Lay Rate</th>
                    <th>Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  {[...records].reverse().map(r => (
                    <tr key={r.id} style={{ background: r.rejectionReason ? '#fff5f5' : undefined }}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {fmtDate(r.collectionDate)}
                        {r.rejectionReason && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', marginTop: 2 }}>↩ Needs correction</div>
                        )}
                      </td>
                      <td><span style={{ fontWeight: 700, color: 'var(--amber)' }}>{r.flock?.batchCode}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.penSection?.pen?.name} › {r.penSection?.name}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.totalEggs)}</td>
                      <td style={{ textAlign: 'right', color: GRADE_COLORS.gradeA, fontWeight: 600 }}>{fmt(r.gradeACount)}</td>
                      <td style={{ textAlign: 'right', color: GRADE_COLORS.gradeB, fontWeight: 600 }}>{fmt(r.gradeBCount)}</td>
                      <td style={{ textAlign: 'right', color: GRADE_COLORS.cracked, fontWeight: 600 }}>{fmt(r.crackedCount)}</td>
                      <td style={{ textAlign: 'right' }}>{r.cratesCount || Math.floor(r.totalEggs / 30)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: Number(r.layingRatePct) >= 80 ? 'var(--green)' : 'var(--amber)' }}>{Number(r.layingRatePct || 0).toFixed(1)}%</span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.rejectionReason ? (
                          <button onClick={() => setEditRecord(r)}
                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff5f5', color: '#dc2626', fontWeight: 700, cursor: 'pointer' }}>
                            ✏️ Fix & Resubmit
                          </button>
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

      {showModal && <LogEggModal flocks={flocks} apiFetch={apiFetch} onClose={() => setShowModal(false)} onSave={() => { setShowModal(false); load(); }} />}
      {editRecord && <EditEggModal record={editRecord} flocks={flocks} apiFetch={apiFetch} onClose={() => setEditRecord(null)} onSave={() => { setEditRecord(null); load(); }} />}
    </AppShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function EmptyState({ msg = 'No data for this period' }) {
  return <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{msg}</div>;
}
function gradeAPct(s) {
  return s.totalEggs > 0 ? ((s.totalGradeA / s.totalEggs) * 100).toFixed(1) : 0;
}
function gradePct(val, total) {
  return total > 0 ? ((val / total) * 100).toFixed(1) : 0;
}
function buildChartData(records, days) {
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
