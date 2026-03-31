'use client';
// app/worker/page.js — Pen Worker Daily Dashboard
// Redesigned: section-first layout — tasks nested per section, DailySummaryCard inline
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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

const TYPE_META = {
  EGG_COLLECTION:    { icon: '🥚', action: 'Log Eggs',      color: '#d97706', bg: '#fffbeb' },
  FEEDING:           { icon: '🍽️', action: 'Log Feed',       color: '#16a34a', bg: '#f0fdf4' },
  MORTALITY_CHECK:   { icon: '💀', action: 'Log Mortality',  color: '#dc2626', bg: '#fef2f2' },
  WEIGHT_RECORDING:  { icon: '⚖️', action: 'Weigh',          color: '#7c3aed', bg: '#f5f3ff' },
  CLEANING:          { icon: '🧹', action: 'Mark Done',      color: '#0284c7', bg: '#f0f9ff' },
  BIOSECURITY:       { icon: '🛡️', action: 'Mark Done',      color: '#0284c7', bg: '#f0f9ff' },
  STORE_COUNT:       { icon: '📦', action: 'Mark Done',      color: '#0284c7', bg: '#f0f9ff' },
  REPORT_SUBMISSION: { icon: '📋', action: 'Complete',       color: '#0284c7', bg: '#f0f9ff' },
  INSPECTION:        { icon: '🔍', action: 'Inspect',        color: '#0284c7', bg: '#f0f9ff' },
  VACCINATION:       { icon: '💉', action: 'Mark Done',      color: '#0284c7', bg: '#f0f9ff' },
  OTHER:             { icon: '📌', action: 'Mark Done',      color: '#64748b', bg: '#f8fafc' },
};

// ── Small reusable components ─────────────────────────────────────────────────

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg   = type === 'error' ? '#991b1b' : type === 'warn' ? '#92400e' : '#166534';
  const icon = type === 'error' ? '✕ '     : type === 'warn' ? '⚠️ '    : '✓ ';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: bg, color: '#fff', padding: '12px 20px', borderRadius: 10,
      fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      animation: 'fadeIn 0.25s ease', maxWidth: 340,
    }}>{icon}{msg}</div>
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

// ── Log Egg Modal ─────────────────────────────────────────────────────────────

function LogEggModal({ section, apiFetch, onClose, onSave }) {
  const flock = section.flock || null;
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    collectionDate: today, collectionSession: '1',
    cratesCollected: '', looseEggs: '', crackedCount: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const crates  = Math.max(0, Number(form.cratesCollected) || 0);
  const loose   = Math.max(0, Number(form.looseEggs)       || 0);
  const cracked = Math.max(0, Number(form.crackedCount)    || 0);
  const total   = (crates * 30) + loose + cracked;
  const layRate = flock?.currentCount > 0 ? ((total / flock.currentCount) * 100).toFixed(1) : null;

  async function save() {
    if (!flock) return setError('No active flock in this section');
    if (crates <= 0 && loose <= 0) return setError('Enter at least crates or loose eggs collected');
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/eggs', {
        method: 'POST',
        body: JSON.stringify({
          flockId: flock.id, penSectionId: section.id,
          collectionDate: form.collectionDate,
          collectionSession: Number(form.collectionSession),
          cratesCollected: crates, looseEggs: loose,
          crackedCount: cracked, totalEggs: total,
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
          <strong>{section.penName} › {section.name}</strong>
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
  const flock = section.flock || null;
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ recordDate: today, count: '', causeCode: 'UNKNOWN', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
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
          flockId: flock.id, penSectionId: section.id,
          recordDate: form.recordDate, count,
          causeCode: form.causeCode,
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
          <strong>{section.penName} › {section.name}</strong>
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

// ── Edit Rejected Record Modal ────────────────────────────────────────────────

function EditRecordModal({ item, sections, apiFetch, onClose, onSave }) {
  const { record, type } = item;
  const today = new Date().toISOString().split('T')[0];

  const section = sections.find(s => s.id === record.penSectionId) || null;
  const flock   = section?.flock || null;

  const [eggForm, setEggForm] = useState({
    collectionDate:    record.collectionDate?.split('T')[0] || today,
    collectionSession: String(record.collectionSession || '1'),
    cratesCollected:   String(record.cratesCollected   || ''),
    looseEggs:         String(record.looseEggs         || ''),
    crackedCount:      String(record.crackedCount      || ''),
  });
  const [mortForm, setMortForm] = useState({
    recordDate: record.recordDate?.split('T')[0] || today,
    count:      String(record.count     || ''),
    causeCode:  record.causeCode || 'UNKNOWN',
    notes:      record.notes    || '',
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
        body = { collectionDate: eggForm.collectionDate, collectionSession: Number(eggForm.collectionSession), cratesCollected: crates, looseEggs: loose, crackedCount: cracked, totalEggs: total };
      } else {
        if (count <= 0) return setError('Enter number of deaths');
        endpoint = `/api/mortality/${record.id}`;
        body = { recordDate: mortForm.recordDate, count, causeCode: mortForm.causeCode, ...(mortForm.notes.trim() && { notes: mortForm.notes.trim() }) };
      }
      const res = await apiFetch(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
      const d   = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } finally { setSaving(false); }
  }

  const isEgg = type === 'egg';
  return (
    <ModalShell title={isEgg ? '🥚 Correct Egg Record' : '💀 Correct Mortality Record'} onClose={onClose}
      footer={
        <><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Resubmit Record'}</button></>
      }>
      {error && <div className="alert alert-red" style={{ marginBottom: 12 }}>⚠ {error}</div>}
      <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: 3 }}>⚠ Returned for correction</div>
        <div style={{ color: '#7f1d1d' }}>{record.rejectionReason}</div>
      </div>
      {section && (
        <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, fontSize: 13, marginBottom: 14 }}>
          <strong>{section.penName} › {section.name}</strong>
          {flock && <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {flock.batchCode} · {Number(flock.currentCount||0).toLocaleString('en-NG')} birds</span>}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isEgg ? (
          <>
            <div>
              <label className="label">Collection Date *</label>
              <input type="date" className="input" value={eggForm.collectionDate} onChange={e => setE('collectionDate', e.target.value)} max={today} />
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
                <input type="number" className="input" min="0" value={eggForm.cratesCollected} onChange={e => setE('cratesCollected', e.target.value)} placeholder="0" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>30 eggs each</div>
              </div>
              <div>
                <label className="label">Loose Eggs</label>
                <input type="number" className="input" min="0" max="29" value={eggForm.looseEggs} onChange={e => setE('looseEggs', e.target.value)} placeholder="0" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Under 1 crate</div>
              </div>
              <div>
                <label className="label">Cracked</label>
                <input type="number" className="input" min="0" value={eggForm.crackedCount} onChange={e => setE('crackedCount', e.target.value)} placeholder="0" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Reduced price</div>
              </div>
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--purple-light)', borderRadius: 9, border: '1px solid #d4d8ff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}>Total: {fmt(total)} eggs</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({crates} × 30) + {loose} + {cracked}</span>
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
                <input type="date" className="input" value={mortForm.recordDate} onChange={e => setM('recordDate', e.target.value)} max={today} />
              </div>
              <div>
                <label className="label">Number of Deaths *</label>
                <input type="number" className="input" min="0" value={mortForm.count} onChange={e => setM('count', e.target.value)} placeholder="0" />
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
              <textarea className="input" rows={2} value={mortForm.notes} onChange={e => setM('notes', e.target.value)} placeholder="Observations, symptoms…" style={{ resize: 'vertical' }} />
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

// ── Log Temperature Modal (Brooding workers) ─────────────────────────────────
function LogTempModal({ section, apiFetch, onClose, onSave }) {
  const flock = section.flock;
  const [form, setForm] = useState({ zone:'Zone A', tempCelsius:'', humidity:'', notes:'' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function save() {
    if (!form.tempCelsius || Number(form.tempCelsius) <= 0)
      return setError('Temperature is required');
    if (!flock?.id) return setError('No active flock found for this section');
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/brooding/temperature', {
        method: 'POST',
        body: JSON.stringify({
          flockId:     flock.id,
          penSectionId: section.id,
          zone:        form.zone,
          tempCelsius: parseFloat(form.tempCelsius),
          humidity:    form.humidity ? parseFloat(form.humidity) : null,
          notes:       form.notes || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save');
      onSave();
    } catch { setError('Network error'); }
    setSaving(false);
  }

  const temp = Number(form.tempCelsius);
  const tempOk = temp >= 26 && temp <= 38;
  const tempColor = !form.tempCelsius ? 'var(--text-muted)'
    : tempOk ? '#16a34a' : temp < 26 ? '#2563eb' : '#dc2626';

  return (
    <ModalShell title="🌡️ Log Brooder Temperature" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Reading'}
        </button>
      </>}>
      {error && <div className="alert alert-red" style={{marginBottom:12}}>⚠ {error}</div>}
      <div style={{marginBottom:12,fontSize:12,color:'var(--text-muted)'}}>
        {flock?.batchCode} · {section.penName} › {section.name} · Safe range: 26–38°C
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div>
            <label className="label">Zone</label>
            <select className="input" value={form.zone} onChange={e=>set('zone',e.target.value)}>
              {['Zone A','Zone B','Zone C','Zone D'].map(z=>(
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Temperature (°C) *</label>
            <input type="number" className="input" step="0.1" min="0" max="50"
              value={form.tempCelsius} placeholder="e.g. 32"
              onChange={e=>set('tempCelsius',e.target.value)}
              style={{borderColor: form.tempCelsius ? (tempOk?'#bbf7d0':'#fecaca') : undefined}}/>
            {form.tempCelsius && (
              <div style={{fontSize:11,marginTop:3,color:tempColor,fontWeight:600}}>
                {tempOk ? '✓ Within safe range' : temp < 26 ? '⚠ Below safe range (too cold)' : '⚠ Above safe range (too hot)'}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">Humidity (%)</label>
          <input type="number" className="input" min="0" max="100" step="1"
            value={form.humidity} placeholder="Optional"
            onChange={e=>set('humidity',e.target.value)}/>
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes}
            placeholder="Heat source status, tarpaulin adjustments…"
            onChange={e=>set('notes',e.target.value)}/>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Log Weight Modal (Rearing + Broiler workers) ─────────────────────────────
function LogWeightModal({ section, apiFetch, onClose, onSave }) {
  const flock = section.flock;
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    sampleDate: today, sampleCount:'30', meanWeightG:'',
    minWeightG:'', maxWeightG:'', uniformityPct:'', notes:'',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function save() {
    if (!form.meanWeightG||Number(form.meanWeightG)<=0) return setError('Average weight is required');
    if (!form.sampleCount||Number(form.sampleCount)<1)  return setError('Sample count must be at least 1');
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/weight-samples', {
        method:'POST',
        body: JSON.stringify({
          flockId:       flock?.id,
          penSectionId:  section.id,
          sampleDate:    form.sampleDate||today,
          sampleCount:   parseInt(form.sampleCount,10),
          meanWeightG:   parseFloat(form.meanWeightG),
          minWeightG:    form.minWeightG    ? parseFloat(form.minWeightG)    : null,
          maxWeightG:    form.maxWeightG    ? parseFloat(form.maxWeightG)    : null,
          uniformityPct: form.uniformityPct ? parseFloat(form.uniformityPct) : null,
          notes:         form.notes||null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error||'Failed to save');
      onSave();
    } catch { setError('Network error'); }
    setSaving(false);
  }

  return (
    <ModalShell title="⚖️ Log Weekly Weigh-In" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving?'Saving…':'Save Weight Record'}
        </button>
      </>}>
      {error&&<div className="alert alert-red" style={{marginBottom:12}}>⚠ {error}</div>}
      <div style={{marginBottom:12,fontSize:12,color:'var(--text-muted)'}}>
        {flock?.batchCode} · {section.penName} › {section.name} ·
        Weigh a random sample of at least 30 birds
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div><label className="label">Date</label>
            <input type="date" className="input" value={form.sampleDate}
              onChange={e=>set('sampleDate',e.target.value)}/></div>
          <div><label className="label">Sample Size (birds)</label>
            <input type="number" className="input" min="1" value={form.sampleCount}
              onChange={e=>set('sampleCount',e.target.value)}/></div>
        </div>
        <div><label className="label">Avg Weight (g) *</label>
          <input type="number" className="input" min="1" value={form.meanWeightG}
            placeholder="e.g. 850" onChange={e=>set('meanWeightG',e.target.value)}/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          <div><label className="label">Min (g)</label>
            <input type="number" className="input" min="1" value={form.minWeightG}
              placeholder="Optional" onChange={e=>set('minWeightG',e.target.value)}/></div>
          <div><label className="label">Max (g)</label>
            <input type="number" className="input" min="1" value={form.maxWeightG}
              placeholder="Optional" onChange={e=>set('maxWeightG',e.target.value)}/></div>
          <div><label className="label">Uniformity (%)</label>
            <input type="number" className="input" min="0" max="100" step="0.1"
              value={form.uniformityPct} placeholder="e.g. 82"
              onChange={e=>set('uniformityPct',e.target.value)}/></div>
        </div>
        <div><label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes}
            placeholder="Body condition observations…"
            onChange={e=>set('notes',e.target.value)}/></div>
      </div>
    </ModalShell>
  );
}

// ── Section Task Card ─────────────────────────────────────────────────────────
// Each section gets its own card. Tasks for that section are listed inline.
// The DailySummaryCard sits below the task list inside the same card.

function SectionTaskCard({ sec, sectionTasks, onComplete, saving, apiFetch, onLogEggs, onLogMortality, onLogWater, onLogFeed, onLogWeight, onLogTemp, refreshKey = 0 }) {
  const flock      = sec.flock || null;                          // API returns sec.flock (singular, pre-resolved)
  const isLayer    = sec.penOperationType === 'LAYER';           // API returns sec.penOperationType (flat field)
  const secStage   = sec.metrics?.stage || flock?.stage || 'PRODUCTION';
  const isBroodingOrRearing = isLayer && (secStage === 'BROODING' || secStage === 'REARING');
  const metrics    = sec.metrics || {};
  const hasFlock   = !!flock;
  const opColor    = isLayer ? '#d97706' : '#3b82f6';
  const opIcon     = isBroodingOrRearing ? '🐣' : isLayer ? '🥚' : '🍗';

  const sectionDone  = sectionTasks.filter(t => t.status === 'COMPLETED').length;
  const sectionTotal = sectionTasks.length;
  const sectionPct   = sectionTotal > 0 ? Math.round((sectionDone / sectionTotal) * 100) : 0;
  const allDone      = sectionTotal > 0 && sectionDone === sectionTotal;

  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      border: `1.5px solid ${allDone ? '#bbf7d0' : 'var(--border-card)'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      overflow: 'hidden',
      transition: 'border-color 0.3s ease',
    }}>

      {/* ── Section header ── */}
      <div style={{
        padding: '14px 16px',
        background: allDone ? '#f0fdf4' : 'var(--bg-base)',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        {/* Op-type icon badge */}
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: `${opColor}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>
          {allDone ? '✅' : opIcon}
        </div>

        {/* Section name + flock info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif" }}>
            {sec.penName} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>›</span> {sec.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {hasFlock ? (
              <span>{flock.batchCode} · {fmt(flock.currentCount)} birds</span>
            ) : (
              <span style={{ color: '#f59e0b' }}>No active flock</span>
            )}
            <span style={{
              padding: '1px 7px', borderRadius: 99,
              background: `${opColor}15`, color: opColor,
              fontWeight: 700, fontSize: 10, letterSpacing: '0.02em',
            }}>
              {isLayer ? 'Layer' : 'Broiler'}
            </span>
          </div>
        </div>

        {/* Section progress pill */}
        <div style={{ flexShrink: 0, textAlign: 'right' }}>
          {sectionTotal > 0 ? (
            <>
              <div style={{
                fontSize: 13, fontWeight: 800,
                color: allDone ? '#16a34a' : sectionPct > 0 ? 'var(--purple)' : 'var(--text-muted)',
                fontFamily: "'Poppins',sans-serif",
              }}>
                {sectionDone}/{sectionTotal}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>tasks done</div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No tasks</div>
          )}
        </div>
      </div>

      {/* ── Quick-log buttons — direct shortcuts to log forms without needing a task ── */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex', gap: 6, flexWrap: 'wrap',
      }}>
        {isLayer && !isBroodingOrRearing && (
          <button onClick={onLogEggs} title="Log egg collection"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: '1px solid #fde68a', background: '#fffbeb', color: '#d97706', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            🥚 Log Eggs
          </button>
        )}
        {((secStage === 'REARING') || (!isLayer && secStage !== 'BROODING')) && hasFlock && (
          <button onClick={onLogWeight} title="Log weekly weigh-in"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6c63ff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            ⚖️ Log Weight
          </button>
        )}
        <button onClick={onLogFeed} title="Log feed distribution"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          🍽️ Log Feed
        </button>
        <button onClick={onLogMortality} title="Log mortality"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          💀 Log Mortality
        </button>
        <button onClick={onLogWater} title="Log water meter reading"
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#2563eb', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          💧 Log Water
        </button>
      </div>

      {/* ── Progress bar (only when tasks exist and not 100%) ── */}
      {sectionTotal > 0 && !allDone && (
        <div style={{ height: 3, background: 'var(--bg-elevated)' }}>
          <div style={{
            height: '100%', width: `${sectionPct}%`,
            background: 'linear-gradient(90deg,#6c63ff,#48c774)',
            transition: 'width 0.5s ease',
          }} />
        </div>
      )}

      {/* ── KPI chips (shown when flock is active) ── */}
      {hasFlock && (
        <div style={{ padding: '12px 16px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <KpiChip label="Live Birds"  value={fmt(flock.currentCount)}         color="var(--text-primary)" />
          {isBroodingOrRearing && <KpiChip label="Feed/Day" value={metrics.avgDailyFeedKg!=null?`${metrics.avgDailyFeedKg}kg`:'—'} color="#6c63ff" />}
          {isBroodingOrRearing && secStage === 'REARING' && metrics.latestWeightG && <KpiChip label="Avg Weight" value={`${metrics.latestWeightG}g`} color="#6c63ff" />}
          {!isBroodingOrRearing && isLayer && <KpiChip label="Today's Eggs"  value={fmt(metrics.todayEggs || 0)}       color="var(--amber)" />}
          {!isBroodingOrRearing && isLayer && <KpiChip label="7d Lay Rate"   value={fmtPct(metrics.avgLayingRate)}     color="var(--amber)" />}
          {!isLayer && metrics.latestWeight && <KpiChip label="Avg Weight" value={`${metrics.latestWeight.avgWeightG}g`} color="#3b82f6" />}
          <KpiChip
            label="Deaths Today"
            value={metrics.todayMortality || 0}
            color={(metrics.todayMortality || 0) > 5 ? 'var(--red)' : 'var(--text-muted)'}
          />
        </div>
      )}

      {/* ── Task list ── */}
      <div style={{ padding: '12px 16px' }}>
        {!hasFlock ? (
          <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No active flock — tasks unavailable
          </div>
        ) : sectionTasks.length === 0 ? (
          <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <span style={{ marginRight: 6 }}>✅</span>No tasks assigned for this section today
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {sectionTasks.map(task => {
              const done    = task.status === 'COMPLETED';
              const overdue = task.status === 'OVERDUE';
              const inProg  = task.status === 'IN_PROGRESS';
              const meta    = TYPE_META[task.taskType] || TYPE_META.OTHER;

              // Status-driven border and background
              let borderColor = 'var(--border)';
              let bgColor     = '#fff';
              if (done)    { borderColor = '#bbf7d0'; bgColor = '#f0fdf4'; }
              else if (overdue) { borderColor = '#fecaca'; bgColor = '#fff5f5'; }
              else if (inProg)  { borderColor = '#ddd6fe'; bgColor = '#f5f3ff'; }

              return (
                <div key={task.id} style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${borderColor}`,
                  background: bgColor,
                  display: 'flex', gap: 10, alignItems: 'center',
                  opacity: done ? 0.72 : 1,
                  transition: 'opacity 0.2s, background 0.2s',
                }}>
                  {/* Status / type icon */}
                  <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0, width: 22, textAlign: 'center' }}>
                    {done ? '✅' : overdue ? '🔴' : meta.icon}
                  </span>

                  {/* Task label + time */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: done ? '#15803d' : overdue ? '#dc2626' : 'var(--text-primary)',
                      textDecoration: done ? 'line-through' : 'none',
                    }}>
                      {task.title}
                    </div>
                    {task.dueDate && !done && (
                      <div style={{ fontSize: 10, color: overdue ? '#dc2626' : 'var(--text-muted)', marginTop: 2 }}>
                        {overdue ? '⚠ Overdue · ' : ''}Due {new Date(task.dueDate).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>

                  {/* Action button */}
                  {!done && (
                    <button
                      onClick={() => onComplete(task)}
                      disabled={saving}
                      style={{
                        flexShrink: 0,
                        padding: '5px 12px',
                        borderRadius: 7,
                        border: 'none',
                        background: overdue ? '#dc2626' : meta.bg,
                        color: overdue ? '#fff' : meta.color,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: saving ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap',
                        outline: `1px solid ${overdue ? '#dc2626' : meta.color}30`,
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

      {/* ── Daily Summary Card — sits at the bottom of every section ── */}
      {hasFlock && (
        <div style={{ padding: '0 16px 16px' }}>
          <DailySummaryCard penSectionId={sec.id} isLayer={isLayer} stage={secStage} apiFetch={apiFetch} refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}

function KpiChip({ label, value, color = 'var(--purple)' }) {
  return (
    <div style={{ padding: '9px 12px', background: 'var(--bg-elevated)', borderRadius: 9, border: '1px solid var(--border-card)', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "'Poppins',sans-serif" }}>{value}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkerPage() {
  const { apiFetch, user } = useAuth();
  const router = useRouter();

  // This page is PEN_WORKER only. PEN_MANAGER has their own dashboard.
  useEffect(() => {
    if (user && user.role !== 'PEN_WORKER') {
      router.replace('/dashboard');
    }
  }, [user, router]);
  const [sections,       setSections]       = useState([]);
  const [tasks,          setTasks]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [eggModal,       setEggModal]       = useState(null);  // section
  const [mortModal,      setMortModal]      = useState(null);  // section
  const [waterModal,     setWaterModal]     = useState(null);  // section
  const [feedModal,      setFeedModal]      = useState(null);  // section
  const [weightModal,    setWeightModal]    = useState(null);  // section
  const [tempModal,      setTempModal]      = useState(null);  // section
  const [editRecord,     setEditRecord]     = useState(null);  // { record, type, section }
  const [rejected,       setRejected]       = useState([]);
  const [toast,          setToast]          = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [spotCheckTask,  setSpotCheckTask]  = useState(null);
  const [taskLinkedModal,setTaskLinkedModal] = useState(null); // { task, type }
  const [saveCount,      setSaveCount]      = useState(0);    // bumped on every save to refresh DailySummaryCards

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };
  // Increment saveCount to trigger DailySummaryCard re-fetch in all section cards
  const bumpSave = () => setSaveCount(c => c + 1);

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
        loadedSections = (d.sections || []).map(s => ({
			...s,
			flock: s.flock ?? s.activeFlock ?? null,
		}));
        setSections(loadedSections);
      }
      if (loadedSections.length > 0) {
        const ids = loadedSections.map(s => s.id).join(',');
        const taskRes = await apiFetch(`/api/tasks?sectionIds=${ids}`);
        if (taskRes.ok) { const d = await taskRes.json(); setTasks(d.tasks || []); }
      }
      const rejectedList = [];
      if (eggRes.ok) {
        const d = await eggRes.json();
        (d.records || []).filter(r => r.rejectionReason).forEach(r => rejectedList.push({ record: r, type: 'egg' }));
      }
      if (mortRes.ok) {
        const d = await mortRes.json();
        (d.records || []).filter(r => r.rejectionReason).forEach(r => rejectedList.push({ record: r, type: 'mortality' }));
      }
      setRejected(rejectedList);
    } finally { setLoading(false); }
  }, [apiFetch]);

  const generateTasksIfNeeded = useCallback(async () => {
    // Always POST for both frequencies — the server deduplicates per section+title,
    // so sections that already have tasks are skipped. This avoids the tenant-wide
    // idempotency check incorrectly blocking sections that have no tasks yet.
    // load() is called in finally so the page always populates even if generation fails.
    try {
      const [dailyRes, weeklyRes] = await Promise.all([
        apiFetch('/api/tasks/generate', { method: 'POST', body: JSON.stringify({ frequency: 'daily' }) }),
        apiFetch('/api/tasks/generate', { method: 'POST', body: JSON.stringify({ frequency: 'weekly' }) }),
      ]);
      const dailyData  = dailyRes.ok  ? await dailyRes.json()  : { error: await dailyRes.text() };
      const weeklyData = weeklyRes.ok ? await weeklyRes.json() : { error: await weeklyRes.text() };
      console.log('[tasks/generate] daily:', dailyData);
      console.log('[tasks/generate] weekly:', weeklyData);
    } catch (err) { console.error('[tasks/generate] error:', err); }
    finally { load(); }
  }, [apiFetch, load]);

  useEffect(() => {
    // generateTasksIfNeeded always calls load() after POSTing tasks,
    // so we don't need a separate load() call here.
    generateTasksIfNeeded();
  }, [generateTasksIfNeeded]);

  const completeLinkedTask = useCallback(async (taskId) => {
    if (!taskId) return;
    await apiFetch('/api/tasks?action=complete', {
      method: 'POST',
      body: JSON.stringify({ taskId, completionNotes: 'Completed via task data entry' }),
    }).catch(() => {});
    setTaskLinkedModal(null);
  }, [apiFetch]);

  const handleComplete = async (task) => {
    // Spot-check tasks
    const isSpotCheck = task.description?.includes('SPOT-CHECK');
    if (isSpotCheck && (task.taskType === 'WEIGHT_RECORDING' || task.taskType === 'INSPECTION')) {
      setSpotCheckTask(task);
      return;
    }
    // Data-entry tasks — open the relevant modal and link the task
    const section = sections.find(s => s.id === task.penSectionId);
    if (section) {
      if (task.taskType === 'EGG_COLLECTION') {
        setTaskLinkedModal({ task, type: 'egg' }); setEggModal(section); return;
      }
      if (task.taskType === 'FEEDING') {
        setTaskLinkedModal({ task, type: 'feed' }); setFeedModal(section); return;
      }
      if (task.taskType === 'MORTALITY_CHECK') {
        setTaskLinkedModal({ task, type: 'mortality' }); setMortModal(section); return;
      }
      if (task.taskType === 'INSPECTION') {
        // BROODING sections: Inspect = temperature check; others: water meter
        const secStage = section?.metrics?.stage || section?.flock?.stage || 'PRODUCTION';
        if (secStage === 'BROODING') {
          setTaskLinkedModal({ task, type: 'temp' }); setTempModal(section); return;
        }
        setTaskLinkedModal({ task, type: 'water' }); setWaterModal(section); return;
      }
    }
    // REPORT_SUBMISSION task — submit the day's summary then mark task complete
    if (task.taskType === 'REPORT_SUBMISSION' && section) {
      setSaving(true);
      try {
        // Submit the daily summary first
        await apiFetch('/api/daily-summary', {
          method: 'POST',
          body: JSON.stringify({ penSectionId: section.id }),
        }).catch(() => {});
        // Then mark the task complete
        await apiFetch('/api/tasks?action=complete', {
          method: 'POST',
          body: JSON.stringify({ taskId: task.id, completionNotes: 'Daily summary submitted' }),
        });
        bumpSave(); load(); showToast('Daily summary submitted ✓');
      } finally { setSaving(false); }
      return;
    }
    // Generic / checklist tasks — mark complete immediately
    setSaving(true);
    try {
      const res = await apiFetch('/api/tasks?action=complete', {
        method: 'POST',
        body: JSON.stringify({ taskId: task.id, completionNotes: 'Completed via worker dashboard' }),
      });
      if (res.ok) { load(); showToast('Task marked complete ✓'); }
    } finally { setSaving(false); }
  };

  // Overall progress
  const completedCount = tasks.filter(t => t.status === 'COMPLETED').length;
  const totalCount     = tasks.length;
  const pct            = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Group tasks by section — this drives the section-first layout
  const tasksBySection = tasks.reduce((acc, t) => {
    if (!acc[t.penSectionId]) acc[t.penSectionId] = [];
    acc[t.penSectionId].push(t);
    return acc;
  }, {});

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <AppShell>
      <style>{`
        @keyframes fadeIn   { from{opacity:0;transform:translateY(8px)}  to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        .sections-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 640px) {
          .sections-grid { grid-template-columns: 1fr; }
        }
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

      {/* ── Page header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {greeting}, {user?.firstName || 'Worker'} 👋
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
          {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {loading ? (
        /* Skeleton */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[1,2,3].map(i => <div key={i} style={{ height: 180, background: 'var(--bg-elevated)', borderRadius: 14, animation: 'pulse 1.5s infinite' }} />)}
        </div>
      ) : sections.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>No sections assigned</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Contact your pen manager to get assigned to a section.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Overall progress bar ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)', padding: '14px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {totalCount === 0 ? 'No tasks today' : `${completedCount}/${totalCount} tasks complete`}
              </span>
              <span style={{ fontFamily: "'Poppins',sans-serif", fontSize: 18, fontWeight: 800, color: pct === 100 ? '#16a34a' : 'var(--purple)' }}>
                {pct}%
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'linear-gradient(90deg,#22c55e,#16a34a)' : 'linear-gradient(90deg,#6c63ff,#48c774)', borderRadius: 99, transition: 'width 0.6s ease' }} />
            </div>
            {totalCount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>{completedCount} completed</span>
                <span>{totalCount - completedCount} remaining</span>
              </div>
            )}
          </div>

          {/* ── Section cards — 2-up on desktop, 1-up on mobile ── */}
          <div className="sections-grid">
            {sections.map(sec => (
              <SectionTaskCard
                key={sec.id}
                sec={sec}
                sectionTasks={tasksBySection[sec.id] || []}
                onComplete={handleComplete}
                saving={saving}
                apiFetch={apiFetch}
                onLogEggs={() => setEggModal(sec)}
                onLogMortality={() => setMortModal(sec)}
                onLogWater={() => setWaterModal(sec)}
                onLogFeed={() => setFeedModal(sec)}
                onLogWeight={() => setWeightModal(sec)}
                onLogTemp={() => setTempModal(sec)}
                refreshKey={saveCount}
              />
            ))}
          </div>

        </div>
      )}

      {/* ── Modals ── */}
      {eggModal && (
        <LogEggModal section={eggModal} apiFetch={apiFetch}
          onClose={() => { setEggModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setEggModal(null); bumpSave(); load(); showToast('Egg collection recorded ✓');
            if (taskLinkedModal?.type === 'egg') completeLinkedTask(taskLinkedModal.task.id);
          }} />
      )}
      {mortModal && (
        <LogMortalityModal section={mortModal} apiFetch={apiFetch}
          onClose={() => { setMortModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setMortModal(null); bumpSave(); load(); showToast('Mortality recorded ✓');
            if (taskLinkedModal?.type === 'mortality') completeLinkedTask(taskLinkedModal.task.id);
          }} />
      )}
      {waterModal && (
        <WaterMeterModal section={waterModal} apiFetch={apiFetch}
          onClose={() => { setWaterModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setWaterModal(null); bumpSave(); showToast('Water meter reading saved ✓');
            if (taskLinkedModal?.type === 'water') completeLinkedTask(taskLinkedModal.task.id);
          }} />
      )}
      {tempModal && (
        <LogTempModal section={tempModal} apiFetch={apiFetch}
          onClose={() => { setTempModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setTempModal(null);
            if (taskLinkedModal?.type === 'temp') completeLinkedTask(taskLinkedModal.task.id);
            bumpSave(); load(); showToast('Temperature reading saved ✓');
          }}
        />
      )}
      {weightModal && (
        <LogWeightModal section={weightModal} apiFetch={apiFetch}
          onClose={() => setWeightModal(null)}
          onSave={() => { setWeightModal(null); bumpSave(); load(); showToast('Weight record saved ✓'); }}
        />
      )}
      {feedModal && (
        <WorkerFeedModal section={feedModal} apiFetch={apiFetch}
          onClose={() => { setFeedModal(null); setTaskLinkedModal(null); }}
          onSave={() => {
            setFeedModal(null); bumpSave(); load(); showToast('Feed distribution logged ✓');
            if (taskLinkedModal?.type === 'feed') completeLinkedTask(taskLinkedModal.task.id);
          }} />
      )}
      {editRecord && (
        <EditRecordModal item={editRecord} sections={sections} apiFetch={apiFetch}
          onClose={() => setEditRecord(null)}
          onSave={() => { setEditRecord(null); load(); showToast('Record corrected and resubmitted for verification ✓'); }} />
      )}
      {spotCheckTask && (
        <SpotCheckCompleteModal task={spotCheckTask} apiFetch={apiFetch}
          onClose={() => setSpotCheckTask(null)}
          onSave={({ deviationFlag, failCount }) => {
            setSpotCheckTask(null); load();
            if (deviationFlag)    showToast('Weight recorded — deviation flagged to IC ⚠️', 'warn');
            else if (failCount > 0) showToast('Inspection submitted — IC notified of failures ⚠️', 'warn');
            else                    showToast('Spot check completed ✓');
          }} />
      )}
    </AppShell>
  );
}
