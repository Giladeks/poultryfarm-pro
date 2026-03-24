'use client';
// components/eggs/GradingModal.js
// PM enters Grade B crates/loose and confirms cracked count for a pending egg record.
// System computes gradeBCount, gradeACount, gradeAPct on the server.
//
// Props:
//   record   — EggProduction record from /api/verification GET (pendingItem)
//              must have: id, totalEggs, cratesCollected, looseEggs, crackedCount,
//                         penSection.name, penSection.pen.name, flock.batchCode,
//                         collectionDate, collectionSession
//   apiFetch — from useAuth()
//   onClose  — close handler
//   onSave   — called after successful grading with the updated record

import { useState } from 'react';
import Modal from '@/components/ui/Modal';

const fmt    = n => Number(n || 0).toLocaleString('en-NG');
const fmtPct = n => `${Number(n || 0).toFixed(1)}%`;

// Grade A % colour coding
function gradeAColor(pct) {
  if (pct >= 90) return '#16a34a';
  if (pct >= 80) return '#d97706';
  return '#dc2626';
}

export default function GradingModal({ record, apiFetch, onClose, onSave }) {
  const totalEggs = record?.totalEggs || 0;

  const [form, setForm] = useState({
    gradeBCrates:     '',
    gradeBLoose:      '',
    crackedConfirmed: String(record?.crackedCount ?? ''),  // prefill with worker's count
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setError(''); };

  // ── Live calculation preview ────────────────────────────────────────────────
  const gradeBCrates     = Math.max(0, parseInt(form.gradeBCrates)     || 0);
  const gradeBLoose      = Math.max(0, parseInt(form.gradeBLoose)      || 0);
  const crackedConfirmed = Math.max(0, parseInt(form.crackedConfirmed) || 0);

  const gradeBCount = (gradeBCrates * 30) + gradeBLoose;
  const gradeACount = totalEggs - gradeBCount - crackedConfirmed;
  const gradeAPct   = totalEggs > 0 ? (gradeACount / totalEggs) * 100 : 0;

  const overflowError = gradeACount < 0;

  const sessionLabel = record?.collectionSession === 1 ? 'Morning' : 'Afternoon';
  const dateLabel    = record?.collectionDate
    ? new Date(record.collectionDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function save() {
    if (form.gradeBCrates === '' && form.gradeBLoose === '')
      return setError('Enter Grade B count (crates and/or loose eggs)');
    if (overflowError)
      return setError(`Grade B (${fmt(gradeBCount)}) + Cracked (${fmt(crackedConfirmed)}) exceeds total eggs (${fmt(totalEggs)})`);

    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/eggs/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          grading:          true,
          gradeBCrates,
          gradeBLoose,
          crackedConfirmed,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to save grading'); return; }
      onSave(d.record);
    } catch { setError('Network error — please try again'); }
    finally  { setSaving(false); }
  }

  return (
    <Modal
      title="🥚 Grade B Grading"
      width={500}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || overflowError}
          >
            {saving ? 'Saving…' : 'Confirm Grading'}
          </button>
        </>
      }
    >
      {/* Record context */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, marginBottom: 16, fontSize: 13 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
          {record?.penSection?.pen?.name} › {record?.penSection?.name}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          {record?.flock?.batchCode}
          {' · '}
          {dateLabel}
          {' · '}
          <span style={{ padding: '1px 8px', borderRadius: 99, background: 'var(--purple-light)', color: 'var(--purple)', fontSize: 11, fontWeight: 700 }}>
            {sessionLabel}
          </span>
        </div>
      </div>

      {/* Worker submission summary */}
      <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--blue-bg)', border: '1px solid var(--blue-border)', borderRadius: 9, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: 'var(--blue)', marginBottom: 6 }}>📋 Worker Submission</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span>Crates: <strong>{fmt(record?.cratesCollected)}</strong></span>
          <span>Loose: <strong>{record?.looseEggs ?? 0}</strong></span>
          <span>Cracked (worker): <strong>{record?.crackedCount ?? 0}</strong></span>
          <span style={{ fontWeight: 700 }}>Total: <strong>{fmt(totalEggs)}</strong> eggs</span>
        </div>
      </div>

      {error && (
        <div className="alert alert-red" style={{ marginBottom: 14 }}>⚠ {error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Grade B entry */}
        <div>
          <label className="label" style={{ marginBottom: 8 }}>Grade B Count</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Full Crates</div>
              <input
                type="number"
                className="input"
                min="0"
                value={form.gradeBCrates}
                onChange={e => set('gradeBCrates', e.target.value)}
                placeholder="0"
                autoFocus
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>30 eggs each</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Loose Eggs</div>
              <input
                type="number"
                className="input"
                min="0"
                max="29"
                value={form.gradeBLoose}
                onChange={e => set('gradeBLoose', e.target.value)}
                placeholder="0"
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Under 1 crate</div>
            </div>
          </div>
        </div>

        {/* Cracked confirmed */}
        <div>
          <label className="label">Cracked — Confirmed Count</label>
          <input
            type="number"
            className="input"
            min="0"
            value={form.crackedConfirmed}
            onChange={e => set('crackedConfirmed', e.target.value)}
            placeholder="0"
            style={{ maxWidth: 160 }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
            Worker reported {record?.crackedCount ?? 0} — adjust if different after physical count
          </div>
        </div>

        {/* Live grade breakdown preview */}
        <div style={{
          padding: '14px 16px',
          background: overflowError ? 'var(--red-bg)' : gradeAPct >= 80 ? 'var(--green-bg)' : 'var(--amber-bg)',
          border: `1px solid ${overflowError ? 'var(--red-border)' : gradeAPct >= 80 ? 'var(--green-border)' : 'var(--amber-border)'}`,
          borderRadius: 10,
        }}>
          {overflowError ? (
            <div style={{ color: 'var(--red)', fontWeight: 700, fontSize: 13 }}>
              ⚠ Grade B + Cracked ({fmt(gradeBCount + crackedConfirmed)}) exceeds total ({fmt(totalEggs)})
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Calculated Grade Breakdown
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Grade A',  value: fmt(gradeACount),  sub: fmtPct(gradeAPct), color: gradeAColor(gradeAPct), highlight: true },
                  { label: 'Grade B',  value: fmt(gradeBCount),  sub: fmtPct(totalEggs > 0 ? (gradeBCount / totalEggs) * 100 : 0), color: '#d97706', highlight: false },
                  { label: 'Cracked',  value: fmt(crackedConfirmed), sub: fmtPct(totalEggs > 0 ? (crackedConfirmed / totalEggs) * 100 : 0), color: '#dc2626', highlight: false },
                ].map(g => (
                  <div key={g.label} style={{
                    background: g.highlight ? '#fff' : 'rgba(255,255,255,0.6)',
                    borderRadius: 8, padding: '10px 12px', textAlign: 'center',
                    border: g.highlight ? `2px solid ${g.color}30` : '1px solid rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{g.label}</div>
                    <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 20, fontWeight: 700, color: g.color, lineHeight: 1 }}>{g.value}</div>
                    <div style={{ fontSize: 11, color: g.color, fontWeight: 600, marginTop: 3 }}>{g.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                {fmt(gradeACount)} + {fmt(gradeBCount)} + {fmt(crackedConfirmed)} = {fmt(gradeACount + gradeBCount + crackedConfirmed)}
                {' '}(total submitted: {fmt(totalEggs)})
              </div>
            </>
          )}
        </div>

      </div>
    </Modal>
  );
}
