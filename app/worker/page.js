'use client';
// app/worker/page.js — Pen Worker Daily Dashboard
// Updated: added 💧 Water Meter + 🍽️ Feed Log modal integration
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import WaterMeterModal from '@/components/water/WaterMeterModal';
import WorkerFeedModal from '@/components/feed/WorkerFeedModal';
import SpotCheckCompleteModal from '@/components/tasks/SpotCheckCompleteModal';
import DailySummaryCard from '@/components/daily/DailySummaryCard';

const fmt    = n => Number(n || 0).toLocaleString('en-NG');
const fmtPct = n => `${Number(n || 0).toFixed(1)}%`;

const CAUSE_OPTIONS = [
  { value: 'UNKNOWN',     label: 'Unknown' },
  { value: 'DISEASE',     label: 'Disease' },
  { value: 'HEAT_STRESS', label: 'Heat Stress' },
  { value: 'FEED_ISSUE',  label: 'Feed Issue' },
  { value: 'INJURY',      label: 'Injury' },
  { value: 'PREDATOR',    label: 'Predator' },
  { value: 'RESPIRATORY', label: 'Respiratory' },
];

// ── Small reusable components ─────────────────────────────────────────────────

function KpiChip({ label, value, color = 'var(--purple)' }) {
  return (
    <div style={{ padding: '10px 14px', background: '#fff', borderRadius: 10, border: '1px solid var(--border-card)', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: "'Poppins',sans-serif" }}>{value}</div>
    </div>
  );
}

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg    = type === 'error' ? '#991b1b' : type === 'warn' ? '#92400e' : '#166534';
  const icon  = type === 'error' ? '✕ '      : type === 'warn' ? '⚠️ '     : '✓ ';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: bg, color: '#fff', padding: '12px 20px', borderRadius: 10,
      fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      animation: 'fadeIn 0.25s ease', maxWidth: 340,
    }}>{icon}{msg}</div>
  );
}

// ── Log Egg Modal ─────────────────────────────────────────────────────────────

function LogEggModal({ section, apiFetch, onClose, onSave }) {
  const flock = section.flocks?.[0] || null;
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    collectionDate:  today,
    collectionSession: '1',   // 1=morning, 2=afternoon
    cratesCollected: '',
    looseEggs:       '',
    crackedCount:    '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const crates  = Math.max(0, Number(form.cratesCollected) || 0);
  const loose   = Math.max(0, Number(form.looseEggs)       || 0);
  const cracked = Math.max(0, Number(form.crackedCount)    || 0);
  // Total = (crates × 30) + loose eggs + cracked eggs
  const total   = (crates * 30) + loose + cracked;
  const layRate = flock?.currentCount > 0 ? ((total / flock.currentCount) * 100).toFixed(1) : null;

  async function save() {
    if (!flock)     return setError('No active flock in this section');
    if (crates <= 0 && loose <= 0) return setError('Enter at least crates or loose eggs collected');
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/eggs', {
        method: 'POST',
        body: JSON.stringify({
          flockId:          flock.id,
          penSectionId:     section.id,
          collectionDate:   form.collectionDate,
          collectionSession: Number(form.collectionSession),
          cratesCollected:  crates,
          looseEggs:        loose,
          crackedCount:     cracked,
          totalEggs:        total,   // system-calculated, sent for server-side confirmation
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="🥚 Log Egg Collection" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Record'}</button></>}>
      {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>⚠ {error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, fontSize: 13 }}>
          <strong>{section.pen?.name} › {section.name}</strong>
          {flock && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {flock.batchCode} · {fmt(flock.currentCount)} birds</span>}
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
            <input type="number" className="input" min="0" value={form.cratesCollected}
              onChange={e => set('cratesCollected', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>30 eggs each</div>
          </div>
          <div>
            <label className="label">Loose Eggs</label>
            <input type="number" className="input" min="0" max="29" value={form.looseEggs}
              onChange={e => set('looseEggs', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Under 1 crate</div>
          </div>
          <div>
            <label className="label">Cracked</label>
            <input type="number" className="input" min="0" value={form.crackedCount}
              onChange={e => set('crackedCount', e.target.value)} placeholder="0" />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Reduced price</div>
          </div>
        </div>

        {/* Live total preview */}
        <div style={{ padding: '12px 14px', background: 'var(--purple-light)', borderRadius: 9, border: '1px solid #d4d8ff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}>
              Total: {fmt(total)} eggs
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              ({crates} × 30) + {loose} loose + {cracked} cracked
            </span>
          </div>
          {layRate && (
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Laying rate: <strong style={{ color: Number(layRate) >= 80 ? 'var(--green)' : Number(layRate) >= 70 ? 'var(--amber)' : 'var(--red)' }}>{layRate}%</strong>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>Grade A % calculated by Pen Manager after verification</span>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── Log Mortality Modal ───────────────────────────────────────────────────────

function LogMortalityModal({ section, apiFetch, onClose, onSave }) {
  const flock = section.flocks?.[0] || null;
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ recordDate: today, count: '', causeCode: 'UNKNOWN', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const count    = Number(form.count) || 0;
  const mortRate = flock?.currentCount > 0 ? ((count / flock.currentCount) * 100).toFixed(2) : null;
  const isSpike  = count > 0 && flock?.currentCount > 0 && count > flock.currentCount * 0.01;

  async function save() {
    if (!flock)    return setError('No active flock in this section');
    if (count <= 0) return setError('Enter number of deaths');
    if (flock.currentCount && count > flock.currentCount)
      return setError(`Count (${count}) exceeds live bird count (${fmt(flock.currentCount)})`);
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/mortality', {
        method: 'POST',
        body: JSON.stringify({
          flockId:      flock.id,
          penSectionId: section.id,
          recordDate:   form.recordDate,
          count,
          causeCode:    form.causeCode,
          ...(form.notes.trim() && { notes: form.notes.trim() }),
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <ModalShell title="💀 Record Mortality" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Record'}</button></>}>
      {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>⚠ {error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, fontSize: 13 }}>
          <strong>{section.pen?.name} › {section.name}</strong>
          {flock && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {flock.batchCode} · {fmt(flock.currentCount)} birds</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={form.recordDate} onChange={e => set('recordDate', e.target.value)} max={today} />
          </div>
          <div>
            <label className="label">Number of Deaths *</label>
            <input type="number" className="input" min="0" value={form.count} onChange={e => set('count', e.target.value)} placeholder="0" />
            {mortRate !== null && (
              <div style={{ fontSize: 11, marginTop: 4, color: Number(mortRate) > 1 ? 'var(--red)' : 'var(--text-muted)' }}>
                Mortality rate: <strong>{mortRate}%</strong>
                {isSpike && <span style={{ marginLeft: 6, color: 'var(--red)' }}>⚠ Above 1% threshold</span>}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">Cause of Death</label>
          <select className="input" value={form.causeCode} onChange={e => set('causeCode', e.target.value)}>
            {CAUSE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Notes <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Observations, symptoms…" style={{ resize: 'vertical' }} />
        </div>
      </div>
    </ModalShell>
  );
}

// ── Modal Shell ───────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, footer, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 12px 48px rgba(0,0,0,0.2)', animation: 'fadeInUp 0.2s ease', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif" }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '18px 20px', overflowY: 'auto', flexGrow: 1 }}>{children}</div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-card)', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>{footer}</div>
      </div>
    </div>
  );
}

// ── Section Card ──────────────────────────────────────────────────────────────
// Updated: accepts onLogWater prop; adds 💧 Water button in the action row

function SectionCard({ sec, onLogEggs, onLogMortality, onLogWater, onLogFeed, apiFetch }) {
  const [expanded, setExpanded] = useState(false);
  const flock     = sec.flocks?.[0] || null;
  const isLayer   = sec.pen?.operationType === 'LAYER';
  const metrics   = sec.metrics || {};
  const hasFlock  = !!flock;

  const opColor   = isLayer ? '#f59e0b' : '#3b82f6';
  const opIcon    = isLayer ? '🥚' : '🍗';
  const opLabel   = isLayer ? 'Layer' : 'Broiler';

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
      {/* Header row — always visible, click to expand */}
      <div onClick={() => setExpanded(e => !e)}
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, userSelect: 'none' }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${opColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
          {opIcon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>{sec.pen?.name} › {sec.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {hasFlock ? `${flock.batchCode} · ${fmt(flock.currentCount)} birds` : 'No active flock'}
            <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 99, background: `${opColor}15`, color: opColor, fontWeight: 700, fontSize: 10 }}>{opLabel}</span>
          </div>
        </div>
        {/* Today's quick stats */}
        <div style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'center' }}>
          {isLayer && hasFlock && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Today</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--amber)' }}>{fmt(metrics.todayEggs || 0)} 🥚</div>
            </div>
          )}
          {hasFlock && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Deaths</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: (metrics.todayMortality || 0) > 5 ? 'var(--red)' : 'var(--text-primary)' }}>{metrics.todayMortality || 0} 💀</div>
            </div>
          )}
          <span style={{ fontSize: 18, color: 'var(--text-muted)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>›</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-card)', padding: '14px 16px', background: 'var(--bg-base)', animation: 'fadeIn 0.15s ease' }}>
          {!hasFlock ? (
            <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 13 }}>No active flock in this section</div>
          ) : (
            <>
              {/* KPI chips */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <KpiChip label="Live Birds" value={fmt(flock.currentCount)} color="var(--text-primary)" />
                <KpiChip label="Occupancy" value={fmtPct(sec.occupancy)} color="var(--purple)" />
                {isLayer && <KpiChip label="7d Laying Rate" value={fmtPct(metrics.avgLayingRate)} color="var(--amber)" />}
                {!isLayer && metrics.latestWeight && <KpiChip label="Avg Weight" value={`${metrics.latestWeight.avgWeightG}g`} color="var(--blue)" />}
                <KpiChip label="7d Mortality" value={fmt(metrics.weekMortality || 0)} color={(metrics.weekMortality || 0) > 10 ? 'var(--red)' : 'var(--text-muted)'} />
                {isLayer && <KpiChip label="7d Eggs" value={fmt(metrics.weekEggs || 0)} color="var(--amber)" />}
              </div>

              {/* Action buttons row */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {isLayer && (
                  <button onClick={() => onLogEggs(sec)}
                    style={{ flex: 1, minWidth: 100, padding: '10px', borderRadius: 9, border: 'none', background: '#fffbeb', color: '#d97706', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    🥚 Log Eggs
                  </button>
                )}
                <button onClick={() => onLogMortality(sec)}
                  style={{ flex: 1, minWidth: 100, padding: '10px', borderRadius: 9, border: 'none', background: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  💀 Log Mortality
                </button>
                {/* NEW — Water meter reading button */}
                <button onClick={() => onLogWater(sec)}
                  style={{ flex: 1, minWidth: 100, padding: '10px', borderRadius: 9, border: 'none', background: '#eff6ff', color: '#2563eb', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  💧 Log Water
                </button>
                {/* NEW — Feed distribution button */}
                <button onClick={() => onLogFeed(sec)}
                  style={{ flex: 1, minWidth: 100, padding: '10px', borderRadius: 9, border: 'none', background: '#f0fdf4', color: '#16a34a', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  🍽️ Log Feed
                </button>
              </div>

              {/* Daily summary checklist */}
              <DailySummaryCard penSectionId={sec.id} apiFetch={apiFetch} />
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ── Edit Rejected Record Modal ────────────────────────────────────────────────
function EditRecordModal({ item, sections, apiFetch, onClose, onSave }) {
  const { record, type } = item;
  const today = new Date().toISOString().split('T')[0];

  // Find matching section from assigned sections
  const section = sections.find(s => s.id === record.penSectionId) || null;
  const flock   = section?.flocks?.[0] || null;

  // Egg form state — worker corrects crate-based fields only, no grade entry
  const [eggForm, setEggForm] = useState({
    collectionDate:   record.collectionDate?.split('T')[0] || today,
    collectionSession: String(record.collectionSession || '1'),
    cratesCollected:  String(record.cratesCollected || ''),
    looseEggs:        String(record.looseEggs        || ''),
    crackedCount:     String(record.crackedCount     || ''),
  });

  // Mortality form state
  const [mortForm, setMortForm] = useState({
    recordDate: record.recordDate?.split('T')[0] || today,
    count:     String(record.count     || ''),
    causeCode: record.causeCode || 'UNKNOWN',
    notes:     record.notes    || '',
  });

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const setE = (k, v) => setEggForm(p  => ({ ...p, [k]: v }));
  const setM = (k, v) => setMortForm(p => ({ ...p, [k]: v }));

  const crates  = Math.max(0, Number(eggForm.cratesCollected) || 0);
  const loose   = Math.max(0, Number(eggForm.looseEggs)       || 0);
  const cracked = Math.max(0, Number(eggForm.crackedCount)    || 0);
  const total   = (crates * 30) + loose + cracked;
  const layRate = flock?.currentCount > 0 ? ((total / flock.currentCount) * 100).toFixed(1) : null;
  const count    = Number(mortForm.count) || 0;
  const mortRate = flock?.currentCount > 0 ? ((count / flock.currentCount) * 100).toFixed(2) : null;

  async function save() {
    setSaving(true); setError('');
    try {
      let body, endpoint;
      if (type === 'egg') {
        if (crates <= 0 && loose <= 0) return setError('Enter at least crates or loose eggs collected');
        endpoint = `/api/eggs/${record.id}`;
        body = {
          collectionDate:   eggForm.collectionDate,
          collectionSession: Number(eggForm.collectionSession),
          cratesCollected:  crates,
          looseEggs:        loose,
          crackedCount:     cracked,
          totalEggs:        total,
        };
      } else {
        if (count <= 0) return setError('Enter number of deaths');
        endpoint = `/api/mortality/${record.id}`;
        body = {
          recordDate: mortForm.recordDate,
          count,
          causeCode: mortForm.causeCode,
          ...(mortForm.notes.trim() && { notes: mortForm.notes.trim() }),
        };
      }
      const res = await apiFetch(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
      const d   = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  const isEgg = type === 'egg';
  const title = isEgg ? '🥚 Correct Egg Record' : '💀 Correct Mortality Record';

  return (
    <ModalShell title={title} onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Resubmit Record'}
          </button>
        </>
      }>
      {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>⚠ {error}</div>}

      {/* Rejection reason banner */}
      <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 3 }}>⚠ Returned for correction</div>
        <div style={{ color: '#7f1d1d' }}>{record.rejectionReason}</div>
      </div>

      {section && (
        <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, fontSize: 13, marginBottom: 14 }}>
          <strong>{section.pen?.name} › {section.name}</strong>
          {flock && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {flock.batchCode} · {Number(flock.currentCount||0).toLocaleString('en-NG')} birds</span>}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isEgg ? (
          <>
            <div>
              <label className="label">Collection Date *</label>
              <input type="date" className="input" value={eggForm.collectionDate}
                onChange={e => setE('collectionDate', e.target.value)} max={today} />
            </div>
            <div>
              <label className="label">Session *</label>
              <select className="input" value={eggForm.collectionSession} onChange={e => setE('collectionSession', e.target.value)}>
                <option value="1">Morning (Batch 1)</option>
                <option value="2">Afternoon (Batch 2)</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              <div>
                <label className="label">Full Crates *</label>
                <input type="number" className="input" min="0" value={eggForm.cratesCollected}
                  onChange={e => setE('cratesCollected', e.target.value)} placeholder="0" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>30 eggs each</div>
              </div>
              <div>
                <label className="label">Loose Eggs</label>
                <input type="number" className="input" min="0" max="29" value={eggForm.looseEggs}
                  onChange={e => setE('looseEggs', e.target.value)} placeholder="0" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Under 1 crate</div>
              </div>
              <div>
                <label className="label">Cracked</label>
                <input type="number" className="input" min="0" value={eggForm.crackedCount}
                  onChange={e => setE('crackedCount', e.target.value)} placeholder="0" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Reduced price</div>
              </div>
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--purple-light)', borderRadius: 9, border: '1px solid #d4d8ff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}>
                  Total: {fmt(total)} eggs
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  ({crates} × 30) + {loose} + {cracked}
                </span>
              </div>
              {layRate !== null && (
                <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>
                  Laying rate: <strong style={{ color: Number(layRate) >= 80 ? 'var(--green)' : Number(layRate) >= 70 ? 'var(--amber)' : 'var(--red)' }}>{layRate}%</strong>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="label">Date *</label>
                <input type="date" className="input" value={mortForm.recordDate}
                  onChange={e => setM('recordDate', e.target.value)} max={today} />
              </div>
              <div>
                <label className="label">Number of Deaths *</label>
                <input type="number" className="input" min="0" value={mortForm.count}
                  onChange={e => setM('count', e.target.value)} placeholder="0" />
                {mortRate !== null && (
                  <div style={{ fontSize: 11, marginTop: 4, color: Number(mortRate) > 1 ? 'var(--red)' : 'var(--text-muted)' }}>
                    Mortality rate: <strong>{mortRate}%</strong>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="label">Cause of Death</label>
              <select className="input" value={mortForm.causeCode} onChange={e => setM('causeCode', e.target.value)}>
                {[['UNKNOWN','Unknown'],['DISEASE','Disease'],['HEAT_STRESS','Heat Stress'],['FEED_ISSUE','Feed Issue'],
                  ['INJURY','Injury'],['PREDATOR','Predator'],['RESPIRATORY','Respiratory'],['CULLED','Culled'],['WATER_ISSUE','Water Issue']
                ].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Notes <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
              <textarea className="input" rows={2} value={mortForm.notes}
                onChange={e => setM('notes', e.target.value)}
                placeholder="Observations, symptoms…" style={{ resize: 'vertical' }} />
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkerPage() {
  const { apiFetch, user } = useAuth();
  const [sections,    setSections]    = useState([]);
  const [tasks,       setTasks]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [eggModal,    setEggModal]    = useState(null);   // section
  const [mortModal,   setMortModal]   = useState(null);   // section
  const [waterModal,  setWaterModal]  = useState(null);   // section
  const [feedModal,   setFeedModal]   = useState(null);   // section ← NEW
  const [editRecord,  setEditRecord]  = useState(null);   // { record, type, section }
  const [rejected,    setRejected]    = useState([]);
  const [toast,       setToast]       = useState(null);
  const [saving,      setSaving]      = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, eggRes, mortRes] = await Promise.all([
        apiFetch('/api/dashboard'),
        apiFetch('/api/eggs?rejected=true'),
        apiFetch('/api/mortality?rejected=true'),
      ]);
      let loadedSections = [];
      if (dashRes.ok) {
        const d = await dashRes.json();
        loadedSections = d.sections || [];
        setSections(loadedSections);
      }
      // Fetch tasks scoped to all assigned sections so layer + broiler tasks all appear
      if (loadedSections.length > 0) {
        const ids = loadedSections.map(s => s.id).join(',');
        const taskRes = await apiFetch(`/api/tasks?sectionIds=${ids}`);
        if (taskRes.ok) { const d = await taskRes.json(); setTasks(d.tasks || []); }
      }
      const rejectedList = [];
      if (eggRes.ok) {
        const d = await eggRes.json();
        (d.records || []).filter(r => r.rejectionReason).forEach(r =>
          rejectedList.push({ record: r, type: 'egg' })
        );
      }
      if (mortRes.ok) {
        const d = await mortRes.json();
        (d.records || []).filter(r => r.rejectionReason).forEach(r =>
          rejectedList.push({ record: r, type: 'mortality' })
        );
      }
      setRejected(rejectedList);
    } finally { setLoading(false); }
  }, [apiFetch]);

  // ── Generate daily + weekly tasks on first load of the day ───────────────────
  const generateTasksIfNeeded = useCallback(async () => {
    try {
      const res = await apiFetch('/api/tasks/generate');
      if (!res.ok) return;
      const { dailyGenerated, weeklyGenerated } = await res.json();
      const promises = [];
      if (!dailyGenerated)  promises.push(apiFetch('/api/tasks/generate', { method: 'POST', body: JSON.stringify({ frequency: 'daily' }) }));
      if (!weeklyGenerated) promises.push(apiFetch('/api/tasks/generate', { method: 'POST', body: JSON.stringify({ frequency: 'weekly' }) }));
      if (promises.length > 0) {
        await Promise.all(promises);
        load(); // reload everything including tasks after generation
      }
    } catch { /* silent */ }
  }, [apiFetch, load]);

  useEffect(() => {
    load();
    generateTasksIfNeeded();
  }, [load, generateTasksIfNeeded]);

  const [spotCheckTask, setSpotCheckTask] = useState(null);
  // taskLinkedModal: { task, section } — tracks which task triggered a data-entry modal
  const [taskLinkedModal, setTaskLinkedModal] = useState(null);

  // ── Complete a task after a linked data-entry form is saved ──────────────────
  const completeLinkedTask = useCallback(async (taskId) => {
    if (!taskId) return;
    await apiFetch('/api/tasks?action=complete', {
      method: 'POST',
      body: JSON.stringify({ taskId, completionNotes: 'Completed via task data entry' }),
    }).catch(() => {});
    setTaskLinkedModal(null);
  }, [apiFetch]);

  const handleComplete = async (task) => {
    // Spot-check tasks — open specialist completion modal
    const isSpotCheck = task.description?.includes('SPOT-CHECK');
    if (isSpotCheck && (task.taskType === 'WEIGHT_RECORDING' || task.taskType === 'INSPECTION')) {
      setSpotCheckTask(task);
      return;
    }

    // Data-entry tasks — find the section and open the relevant log modal,
    // then auto-complete the task when the record is saved
    const section = sections.find(s => s.id === task.penSectionId);
    if (section) {
      if (task.taskType === 'EGG_COLLECTION') {
        setTaskLinkedModal({ task, type: 'egg' });
        setEggModal(section);
        return;
      }
      if (task.taskType === 'FEEDING') {
        setTaskLinkedModal({ task, type: 'feed' });
        setFeedModal(section);
        return;
      }
      if (task.taskType === 'MORTALITY_CHECK') {
        setTaskLinkedModal({ task, type: 'mortality' });
        setMortModal(section);
        return;
      }
    }

    // Generic / checklist tasks — mark complete immediately
    setSaving(true);
    try {
      const res = await apiFetch('/api/tasks?action=complete', {
        method: 'POST',
        body: JSON.stringify({ taskId: task.id, completionNotes: 'Completed via worker dashboard' }),
      });
      if (res.ok) { load(); showToast('Task marked complete'); }
    } finally { setSaving(false); }
  };

  const completedCount = tasks.filter(t => t.status === 'COMPLETED').length;
  const totalCount     = tasks.length;
  const pct            = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Group tasks by penSectionId for inline display
  const tasksBySection = tasks.reduce((acc, t) => {
    if (!acc[t.penSectionId]) acc[t.penSectionId] = [];
    acc[t.penSectionId].push(t);
    return acc;
  }, {});

  const TYPE_META = {
    EGG_COLLECTION:    { icon: '🥚', action: 'Log Eggs' },
    FEEDING:           { icon: '🍽️', action: 'Log Feed' },
    MORTALITY_CHECK:   { icon: '💀', action: 'Log Mortality' },
    WEIGHT_RECORDING:  { icon: '⚖️', action: 'Weigh' },
    CLEANING:          { icon: '🧹', action: 'Mark Done' },
    BIOSECURITY:       { icon: '🛡️', action: 'Mark Done' },
    STORE_COUNT:       { icon: '📦', action: 'Mark Done' },
    REPORT_SUBMISSION: { icon: '📋', action: 'Complete' },
    INSPECTION:        { icon: '🔍', action: 'Inspect' },
    VACCINATION:       { icon: '💉', action: 'Mark Done' },
    OTHER:             { icon: '📌', action: 'Mark Done' },
  };

  const layerSections   = sections.filter(s => s.pen?.operationType === 'LAYER');
  const broilerSections = sections.filter(s => s.pen?.operationType === 'BROILER');

  return (
    <AppShell>
      <style>{`
        @keyframes fadeIn    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {toast && <Toast msg={toast.msg} type={toast.type} />}

      {/* ── Needs Correction banner ── */}
      {rejected.length > 0 && (
        <div style={{ marginBottom: 24, background: '#fff5f5', border: '1.5px solid #fecaca', borderRadius: 12, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>⚠</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#991b1b' }}>
              {rejected.length} record{rejected.length > 1 ? 's' : ''} returned for correction
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rejected.map(item => (
              <div key={item.record.id} style={{ background: '#fff', borderRadius: 8, border: '1px solid #fecaca', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {item.type === 'egg' ? '🥚 Egg Collection' : '💀 Mortality Record'}
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                      · {new Date(item.record.collectionDate || item.record.recordDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#dc2626', marginTop: 3, fontStyle: 'italic' }}>
                    "{item.record.rejectionReason}"
                  </div>
                </div>
                <button
                  onClick={() => setEditRecord(item)}
                  style={{ flexShrink: 0, padding: '7px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Fix & Resubmit
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.firstName || 'Worker'} 👋
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
          Daily check-in · {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 70, background: 'var(--bg-elevated)', borderRadius: 12, animation: 'pulse 1.5s infinite' }} />)}
        </div>
      ) : sections.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No sections assigned</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Contact your pen manager to get assigned to a section.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

          {/* ── Left: Sections ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Progress */}
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Today's Tasks</span>
                <span style={{ fontFamily: "'Poppins',sans-serif", fontSize: 20, fontWeight: 800, color: 'var(--purple)' }}>{pct}%</span>
              </div>
              <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#6c63ff,#48c774)', borderRadius: 99, transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>{completedCount} completed</span>
                <span>{totalCount - completedCount} remaining</span>
              </div>
            </div>

            {/* Layer sections */}
            {layerSections.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, paddingLeft: 2 }}>
                  🥚 Layer Sections ({layerSections.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {layerSections.map(sec => (
                    <SectionCard key={sec.id} sec={sec}
                      apiFetch={apiFetch}
                      onLogEggs={() => setEggModal(sec)}
                      onLogMortality={() => setMortModal(sec)}
                      onLogWater={() => setWaterModal(sec)}
                      onLogFeed={() => setFeedModal(sec)} />
                  ))}
                </div>
              </div>
            )}

            {/* Broiler sections */}
            {broilerSections.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, paddingLeft: 2 }}>
                  🍗 Broiler Sections ({broilerSections.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {broilerSections.map(sec => (
                    <SectionCard key={sec.id} sec={sec}
                      apiFetch={apiFetch}
                      onLogEggs={() => setEggModal(sec)}
                      onLogMortality={() => setMortModal(sec)}
                      onLogWater={() => setWaterModal(sec)}
                      onLogFeed={() => setFeedModal(sec)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Tasks ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>My Tasks Today ({totalCount})</div>
                {totalCount > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>{completedCount}</span>/{totalCount} done
                  </div>
                )}
              </div>
              {tasks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>✅</div>
                  No tasks assigned today
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tasks.map(task => {
                    const done    = task.status === 'COMPLETED';
                    const overdue = task.status === 'OVERDUE';
                    const inProg  = task.status === 'IN_PROGRESS';

                    // Task type → icon + action label
                    const TYPE_META = {
                      EGG_COLLECTION:    { icon: '🥚', action: 'Log Eggs' },
                      FEEDING:           { icon: '🍽️', action: 'Log Feed' },
                      MORTALITY_CHECK:   { icon: '💀', action: 'Log Mortality' },
                      WEIGHT_RECORDING:  { icon: '⚖️', action: 'Weigh' },
                      CLEANING:          { icon: '🧹', action: 'Mark Done' },
                      BIOSECURITY:       { icon: '🛡️', action: 'Mark Done' },
                      STORE_COUNT:       { icon: '📦', action: 'Mark Done' },
                      REPORT_SUBMISSION: { icon: '📋', action: 'Complete' },
                      INSPECTION:        { icon: '🔍', action: 'Inspect' },
                      VACCINATION:       { icon: '💉', action: 'Mark Done' },
                      OTHER:             { icon: '📌', action: 'Mark Done' },
                    };
                    const meta = TYPE_META[task.taskType] || { icon: '📌', action: 'Mark Done' };

                    return (
                      <div key={task.id} style={{
                        padding: '10px 12px', borderRadius: 9,
                        border: `1px solid ${done ? 'var(--green-border)' : overdue ? 'var(--red-border)' : inProg ? '#ddd6fe' : 'var(--border)'}`,
                        background: done ? 'var(--green-bg)' : overdue ? 'var(--red-bg)' : inProg ? '#f5f3ff' : '#fff',
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                        opacity: done ? 0.75 : 1,
                      }}>
                        <span style={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>
                          {done ? '✅' : overdue ? '🔴' : meta.icon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: done ? '#166534' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none' }}>
                            {task.title}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            {task.penSection?.pen?.name} › {task.penSection?.name}
                            {task.dueDate && (
                              <span style={{ marginLeft: 6, color: overdue ? '#dc2626' : 'var(--text-muted)' }}>
                                · {overdue ? '⚠ Overdue ' : ''}Due {new Date(task.dueDate).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                        {!done && (
                          <button
                            onClick={() => handleComplete(task)}
                            disabled={saving}
                            style={{
                              flexShrink: 0, padding: '4px 10px', borderRadius: 6, border: 'none',
                              background: overdue ? '#dc2626' : 'var(--purple)',
                              color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}>
                            {meta.action}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── Modals ── */}
      {eggModal && (
        <LogEggModal section={eggModal} apiFetch={apiFetch}
          onClose={() => { setEggModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setEggModal(null);
            load();
            showToast('Egg collection recorded ✓');
            if (taskLinkedModal?.type === 'egg') completeLinkedTask(taskLinkedModal.task.id);
          }} />
      )}
      {mortModal && (
        <LogMortalityModal section={mortModal} apiFetch={apiFetch}
          onClose={() => { setMortModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setMortModal(null);
            load();
            showToast('Mortality recorded ✓');
            if (taskLinkedModal?.type === 'mortality') completeLinkedTask(taskLinkedModal.task.id);
          }} />
      )}

      {/* ── NEW: Water meter modal ── */}
      {waterModal && (
        <WaterMeterModal
          section={waterModal}
          apiFetch={apiFetch}
          onClose={() => setWaterModal(null)}
          onSave={() => { setWaterModal(null); showToast('Water meter reading saved ✓'); }}
        />
      )}

      {/* ── NEW: Feed distribution modal ── */}
      {feedModal && (
        <WorkerFeedModal
          section={feedModal}
          apiFetch={apiFetch}
          onClose={() => { setFeedModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setFeedModal(null);
            load();
            showToast('Feed distribution logged ✓');
            if (taskLinkedModal?.type === 'feed') completeLinkedTask(taskLinkedModal.task.id);
          }}
        />
      )}

      {editRecord && (
        <EditRecordModal item={editRecord} sections={sections} apiFetch={apiFetch}
          onClose={() => setEditRecord(null)}
          onSave={() => { setEditRecord(null); load(); showToast('Record corrected and resubmitted for verification ✓'); }} />
      )}

      {spotCheckTask && (
        <SpotCheckCompleteModal
          task={spotCheckTask}
          apiFetch={apiFetch}
          onClose={() => setSpotCheckTask(null)}
          onSave={({ deviationFlag, failCount }) => {
            setSpotCheckTask(null);
            load();
            if (deviationFlag) showToast('Weight recorded — deviation flagged to IC ⚠️', 'warn');
            else if (failCount > 0) showToast('Inspection submitted — IC notified of failures ⚠️', 'warn');
            else showToast('Spot check completed ✓');
          }}
        />
      )}
    </AppShell>
  );
}

function quickBtnStyle(color) {
  return {
    width: 28, height: 28, borderRadius: 7, border: `1px solid ${color}30`,
    background: `${color}12`, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  };
}
