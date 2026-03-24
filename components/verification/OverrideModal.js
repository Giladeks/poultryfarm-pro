'use client';
// components/verification/OverrideModal.js
// PM Override — PM enters the correct value themselves instead of sending back
// to the worker. The override is recorded in the audit trail with:
//   originalValue   — exactly what the worker submitted
//   overriddenValue — what the PM corrected it to
//   overrideReason  — mandatory explanation (PM takes ownership)
//   overriddenBy    — PM's user ID + name
//
// The record is set to APPROVED immediately. The worker receives a notification
// explaining what was changed and why.
//
// Supported record types: EggProduction, MortalityRecord
//
// Props:
//   item     — pending item from /api/verification GET
//              must have referenceType, referenceId, summary, context,
//              submittedBy, date, verificationId, totalEggs / count etc.
//   apiFetch — from useAuth()
//   onClose  — close handler
//   onSave   — called after successful override

import { useState } from 'react';
import Modal from '@/components/ui/Modal';

const MORT_CAUSES = [
  ['UNKNOWN',     'Unknown'],
  ['DISEASE',     'Disease'],
  ['HEAT_STRESS', 'Heat Stress'],
  ['FEED_ISSUE',  'Feed Issue'],
  ['INJURY',      'Injury'],
  ['PREDATOR',    'Predator'],
  ['RESPIRATORY', 'Respiratory'],
  ['CULLED',      'Culled'],
  ['WATER_ISSUE', 'Water Issue'],
  ['OTHER',       'Other'],
];

const fmt = n => Number(n || 0).toLocaleString('en-NG');

export default function OverrideModal({ item, apiFetch, onClose, onSave }) {
  const isEgg  = item.referenceType === 'EggProduction';
  const isMort = item.referenceType === 'MortalityRecord';

  // ── Egg override form ──────────────────────────────────────────────────────
  const [eggForm, setEggForm] = useState({
    cratesCollected:   String(item.cratesCollected   ?? ''),
    looseEggs:         String(item.looseEggs          ?? ''),
    crackedCount:      String(item.crackedCount        ?? ''),
    collectionSession: item.collectionSession || 1,
  });

  // ── Mortality override form ────────────────────────────────────────────────
  const [mortForm, setMortForm] = useState({
    count:     String(item.count     ?? ''),
    causeCode: item.causeCode || 'UNKNOWN',
    notes:     item.notes     || '',
  });

  const [reason,  setReason]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const setE = (k, v) => { setEggForm(p  => ({ ...p, [k]: v })); setError(''); };
  const setM = (k, v) => { setMortForm(p => ({ ...p, [k]: v })); setError(''); };

  // ── Live egg total preview ─────────────────────────────────────────────────
  const crates  = Math.max(0, parseInt(eggForm.cratesCollected) || 0);
  const loose   = Math.max(0, parseInt(eggForm.looseEggs)       || 0);
  const cracked = Math.max(0, parseInt(eggForm.crackedCount)    || 0);
  const newTotal = (crates * 30) + loose + cracked;
  const origTotal = item.totalEggs || 0;
  const origCrates  = item.cratesCollected  ?? 0;
  const origLoose   = item.looseEggs         ?? 0;
  const origCracked = item.crackedCount      ?? 0;

  // Composition changed if ANY field differs — not just the total
  const eggChanged = crates  !== origCrates
                  || loose   !== origLoose
                  || cracked !== origCracked
                  || Number(eggForm.collectionSession) !== (item.collectionSession || 1);

  const newMortCount  = parseInt(mortForm.count) || 0;
  const origMortCount = item.count || 0;
  const mortChanged   = newMortCount !== origMortCount
                     || mortForm.causeCode !== (item.causeCode || 'UNKNOWN')
                     || (mortForm.notes.trim() || '') !== (item.notes || '');

  const hasChanges = isEgg ? eggChanged : isMort ? mortChanged : false;

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate() {
    if (!reason.trim()) return 'Override reason is required — you are taking ownership of this correction';
    if (isEgg) {
      if (crates <= 0 && loose <= 0) return 'Enter at least crates collected or loose eggs';
      if (loose > 29) return 'Loose eggs must be 0–29';
      if (!eggChanged)
        return 'No changes detected — all values match the original submission';
    }
    if (isMort) {
      if (newMortCount <= 0) return 'Enter number of deaths';
      if (!mortChanged)
        return 'No changes detected — values match the original submission';
    }
    return null;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function save() {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true); setError('');

    try {
      let res;

      if (isEgg) {
        res = await apiFetch(`/api/eggs/${item.referenceId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            override:          true,
            cratesCollected:   crates,
            looseEggs:         loose,
            crackedCount:      cracked,
            collectionSession: Number(eggForm.collectionSession),
            overrideReason:    reason.trim(),
          }),
        });
      } else {
        res = await apiFetch(`/api/mortality/${item.referenceId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            override:       true,
            count:          newMortCount,
            causeCode:      mortForm.causeCode,
            notes:          mortForm.notes.trim() || null,
            overrideReason: reason.trim(),
          }),
        });
      }

      let d = {};
      const ct = res.headers?.get('content-type') || '';
      if (ct.includes('application/json')) {
        try { d = await res.json(); } catch { /* empty body */ }
      }

      if (!res.ok) {
        if (d.coiBlocked) {
          setError(d.error);
        } else {
          setError(d.error || `Override failed (${res.status})`);
        }
        return;
      }

      onSave(d.record);
    } catch { setError('Network error — please try again'); }
    finally   { setSaving(false); }
  }

  const dateLabel = item.date
    ? new Date(item.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <Modal
      title="✏️ PM Override"
      width={520}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving}
            style={{ background: saving ? '#94a3b8' : '#f59e0b', color: '#fff' }}
          >
            {saving ? 'Saving…' : 'Apply Override'}
          </button>
        </>
      }
    >
      {/* Override notice */}
      <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, marginBottom: 16, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 3 }}>⚠️ You are overriding a worker submission</div>
        <div style={{ color: '#78350f', lineHeight: 1.5 }}>
          The original values and your correction will be permanently recorded in the audit trail side by side. The worker will be notified of the change and the reason.
        </div>
      </div>

      {/* Record context */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, marginBottom: 16, fontSize: 13 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{item.context}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Submitted by {item.submittedBy} · {dateLabel}
        </div>
      </div>

      {error && (
        <div className="alert alert-red" style={{ marginBottom: 14 }}>⚠ {error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Original vs Corrected — side by side ──────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

          {/* Original (read-only) */}
          <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              📋 Worker Submitted
            </div>
            {isEgg ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
                <div>Crates: <strong>{fmt(item.cratesCollected)}</strong></div>
                <div>Loose:  <strong>{item.looseEggs ?? 0}</strong></div>
                <div>Cracked: <strong>{item.crackedCount ?? 0}</strong></div>
                <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid #e2e8f0', fontWeight: 700 }}>
                  Total: {fmt(origTotal)} eggs
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
                <div>Deaths: <strong>{fmt(origMortCount)}</strong></div>
                <div>Cause: <strong>{item.causeCode?.replace(/_/g, ' ') || '—'}</strong></div>
                {item.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.notes}</div>}
              </div>
            )}
          </div>

          {/* Corrected (editable) */}
          <div style={{ padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              ✏️ Your Correction
            </div>
            {isEgg ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Crates</div>
                  <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12 }}
                    min="0" value={eggForm.cratesCollected}
                    onChange={e => setE('cratesCollected', e.target.value)} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Loose (0–29)</div>
                    <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12 }}
                      min="0" max="29" value={eggForm.looseEggs}
                      onChange={e => setE('looseEggs', e.target.value)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Cracked</div>
                    <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12 }}
                      min="0" value={eggForm.crackedCount}
                      onChange={e => setE('crackedCount', e.target.value)} />
                  </div>
                </div>
                {/* Total preview */}
                <div style={{
                  marginTop: 2, paddingTop: 6, borderTop: '1px solid #fde68a',
                  fontWeight: 700, fontSize: 12,
                  color: eggChanged ? '#d97706' : 'var(--text-secondary)',
                }}>
                  Total: {fmt(newTotal)} eggs
                  {eggChanged && newTotal !== origTotal && (
                    <span style={{ fontSize: 10, marginLeft: 6, color: '#d97706' }}>
                      ({newTotal > origTotal ? '+' : ''}{newTotal - origTotal} from original)
                    </span>
                  )}
                  {eggChanged && newTotal === origTotal && (
                    <span style={{ fontSize: 10, marginLeft: 6, color: '#d97706' }}>
                      (same total, composition changed)
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Deaths</div>
                  <input type="number" className="input" style={{ padding: '5px 8px', fontSize: 12 }}
                    min="1" value={mortForm.count}
                    onChange={e => setM('count', e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Cause</div>
                  <select className="input" style={{ padding: '5px 8px', fontSize: 12 }}
                    value={mortForm.causeCode}
                    onChange={e => setM('causeCode', e.target.value)}>
                    {MORT_CAUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Notes</div>
                  <textarea className="input" style={{ padding: '5px 8px', fontSize: 12, resize: 'vertical' }}
                    rows={2} value={mortForm.notes}
                    onChange={e => setM('notes', e.target.value)}
                    placeholder="Optional…" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mandatory override reason */}
        <div>
          <label className="label">
            Override Reason *
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>
              — permanently recorded in the audit trail
            </span>
          </label>
          <textarea
            className="input"
            rows={3}
            value={reason}
            onChange={e => { setReason(e.target.value); setError(''); }}
            placeholder="e.g. Physical recount found 2 crates fewer than logged. Worker appears to have miscounted the afternoon session…"
            style={{ resize: 'vertical' }}
            autoFocus
          />
        </div>

      </div>
    </Modal>
  );
}
