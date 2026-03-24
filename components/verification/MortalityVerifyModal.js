'use client';
// components/verification/MortalityVerifyModal.js
// Shown when a PM clicks "Verify" on a pending MortalityRecord.
// PM selects the disposal method used for the dead birds, optionally adjusts
// the confirmed count, and adds notes. Submits as VERIFIED.
//
// Props:
//   item     — pending item from /api/verification GET
//              must have: id (= referenceId), count, causeCode, context,
//                         submittedBy, date, verificationId
//   apiFetch — from useAuth()
//   onClose  — close handler
//   onSave   — called after successful verification

import { useState } from 'react';
import Modal from '@/components/ui/Modal';

const DISPOSAL_OPTIONS = [
  { value: 'BURIED',       label: 'Buried',              icon: '⛏️',  desc: 'Buried on-site in designated area' },
  { value: 'INCINERATED',  label: 'Incinerated',         icon: '🔥',  desc: 'Burned in incinerator or open pit' },
  { value: 'COMPOSTED',    label: 'Composted',           icon: '♻️',  desc: 'Added to compost heap' },
  { value: 'SOLD_OFFCUT',  label: 'Sold (off-cut)',      icon: '🏪',  desc: 'Sold to local market or processors' },
  { value: 'VET_COLLECTED',label: 'Collected by vet',    icon: '🩺',  desc: 'Collected by veterinarian for analysis' },
  { value: 'OTHER',        label: 'Other',               icon: '📋',  desc: 'Specify in notes' },
];

const fmt = n => Number(n || 0).toLocaleString('en-NG');

export default function MortalityVerifyModal({ item, apiFetch, onClose, onSave }) {
  const [disposal,  setDisposal]  = useState('');
  const [confirmed, setConfirmed] = useState(String(item?.count ?? ''));
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const confirmedCount = parseInt(confirmed) || 0;
  const workerCount    = item?.count || 0;
  const countMismatch  = confirmedCount !== workerCount;

  const dateLabel = item?.date
    ? new Date(item.date).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  async function save() {
    if (!disposal)            return setError('Select a disposal method');
    if (confirmedCount <= 0)  return setError('Confirmed count must be greater than 0');
    setSaving(true); setError('');

    const disposalLabel = DISPOSAL_OPTIONS.find(d => d.value === disposal)?.label || disposal;
    const autoNote = `Disposal: ${disposalLabel}${countMismatch ? `. PM adjusted count from ${workerCount} to ${confirmedCount}` : ''}.${notes.trim() ? ` ${notes.trim()}` : ''}`;

    try {
      let res;
      if (item.verificationId) {
        // PATCH existing pending verification record
        res = await apiFetch(`/api/verification/${item.verificationId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status:           'VERIFIED',
            discrepancyNotes: countMismatch ? `Worker count: ${workerCount}, PM confirmed: ${confirmedCount}` : null,
            resolution:       autoNote,
          }),
        });
      } else {
        // POST new verification record
        res = await apiFetch('/api/verification', {
          method: 'POST',
          body: JSON.stringify({
            verificationType: 'MORTALITY_REPORT',
            referenceId:      item.referenceId,
            referenceType:    'MortalityRecord',
            verificationDate: new Date().toISOString().slice(0, 10),
            status:           'VERIFIED',
            discrepancyNotes: countMismatch ? `Worker count: ${workerCount}, PM confirmed: ${confirmedCount}` : null,
          }),
        });
      }

      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to verify'); return; }

      // If count was adjusted, also PATCH the mortality record's notes
      if (countMismatch && item.referenceId) {
        await apiFetch(`/api/mortality/${item.referenceId}`, {
          method: 'PATCH',
          body: JSON.stringify({ notes: autoNote }),
        }).catch(() => {});
      }

      onSave(d.verification || d);
    } catch { setError('Network error — please try again'); }
    finally   { setSaving(false); }
  }

  return (
    <Modal
      title="💀 Confirm Mortality Verification"
      width={500}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || !disposal}
            style={{ background: !disposal ? '#94a3b8' : undefined }}
          >
            {saving ? 'Saving…' : 'Confirm Verified'}
          </button>
        </>
      }
    >
      {/* Record context */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, marginBottom: 16, fontSize: 13 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{item?.context}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Submitted by {item?.submittedBy} · {dateLabel}
        </div>
      </div>

      {/* Worker submission summary */}
      <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 9, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>📋 Worker Report</div>
        <div style={{ display: 'flex', gap: 20 }}>
          <span>Birds: <strong style={{ fontSize: 14 }}>{fmt(workerCount)}</strong></span>
          <span>Cause: <strong>{item?.summary?.split('—')?.[1]?.trim() || item?.causeCode || '—'}</strong></span>
        </div>
      </div>

      {error && (
        <div className="alert alert-red" style={{ marginBottom: 14 }}>⚠ {error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Disposal method selection */}
        <div>
          <label className="label">Disposal Method Used *</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
            {DISPOSAL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setDisposal(opt.value); setError(''); }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 9,
                  border: `1.5px solid ${disposal === opt.value ? 'var(--purple)' : 'var(--border)'}`,
                  background: disposal === opt.value ? 'var(--purple-light)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 16, marginBottom: 3 }}>{opt.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: disposal === opt.value ? 'var(--purple)' : 'var(--text-primary)' }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.3 }}>
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Confirmed count — PM can adjust if physical count differs */}
        <div>
          <label className="label">Confirmed Bird Count *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="number"
              className="input"
              min="1"
              value={confirmed}
              onChange={e => setConfirmed(e.target.value)}
              style={{ maxWidth: 140 }}
            />
            {countMismatch && (
              <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', color: '#92400e', fontWeight: 600 }}>
                ⚠ Differs from worker's {fmt(workerCount)}
              </span>
            )}
            {!countMismatch && confirmed && (
              <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Matches worker count</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Adjust if your physical count differs from the worker's submission
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
          <textarea
            className="input"
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Any additional observations or actions taken…"
            style={{ resize: 'vertical' }}
          />
        </div>

      </div>
    </Modal>
  );
}
