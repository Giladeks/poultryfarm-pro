'use client';
// components/water/WaterMeterModal.js
// Worker logs daily water meter odometer reading for their pen section.
// Props:
//   section  — section object from /api/dashboard (id, name, flocks, pen)
//   apiFetch — from useAuth()
//   onClose  — close handler
//   onSave   — called after successful save (triggers page refresh)

import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';

const fmt = n => Number(n || 0).toLocaleString('en-NG');

// Litres-per-bird benchmarks by operation type
// Layer adults ~0.25–0.35 L/bird/day; broilers ~0.20–0.30 L/bird/day
function lpbStatus(lpb, opType) {
  if (lpb == null) return null;
  const high = opType === 'LAYER' ? 0.55 : 0.50;
  const low  = opType === 'LAYER' ? 0.12 : 0.10;
  if (lpb > high) return { color: '#d97706', label: 'High', bg: '#fffbeb', border: '#fde68a' };
  if (lpb < low)  return { color: '#3b82f6', label: 'Low',  bg: '#eff6ff', border: '#bfdbfe' };
  return { color: '#16a34a', label: 'Normal', bg: '#f0fdf4', border: '#bbf7d0' };
}

export default function WaterMeterModal({ section, apiFetch, onClose, onSave }) {
  const flock  = section?.flocks?.[0] || null;
  const opType = section?.pen?.operationType || 'LAYER';
  const today  = new Date().toISOString().split('T')[0];

  const [form,    setForm]    = useState({ readingDate: today, meterReading: '', notes: '' });
  const [prev,    setPrev]    = useState(null);   // yesterday's reading (fetched on mount)
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Fetch last reading for this section ────────────────────────────────────
  useEffect(() => {
    if (!section?.id) return;
    apiFetch(`/api/water-readings?penSectionId=${section.id}&days=3`)
      .then(r => r.json())
      .then(d => {
        const readings = d.readings || [];
        // Find most recent reading before today
        const past = readings
          .filter(r => r.readingDate?.split('T')[0] < today)
          .sort((a, b) => b.readingDate.localeCompare(a.readingDate));
        setPrev(past[0] || null);

        // Check if today already has a reading
        const todayReading = readings.find(r => r.readingDate?.split('T')[0] === today);
        if (todayReading) {
          setError(`Today's reading already recorded: ${Number(todayReading.meterReading).toLocaleString('en-NG')} L`);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [section?.id]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const meterVal      = parseFloat(form.meterReading) || 0;
  const prevMeterVal  = prev ? Number(prev.meterReading) : null;
  const birdCount     = flock?.currentCount || 0;

  const consumptionL   = (prevMeterVal !== null && meterVal > prevMeterVal)
    ? parseFloat((meterVal - prevMeterVal).toFixed(2)) : null;
  const consumptionLPB = (consumptionL !== null && birdCount > 0)
    ? parseFloat((consumptionL / birdCount).toFixed(4)) : null;

  const lpbSt = lpbStatus(consumptionLPB, opType);

  // ── Validation & save ─────────────────────────────────────────────────────
  async function save() {
    if (!form.meterReading || meterVal <= 0)
      return setError('Enter the current meter reading in litres');
    if (prevMeterVal !== null && meterVal < prevMeterVal)
      return setError(`Meter reading (${meterVal.toLocaleString()}) is lower than the previous reading (${prevMeterVal.toLocaleString()}). Check for meter reset.`);

    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/water-readings', {
        method: 'POST',
        body: JSON.stringify({
          penSectionId: section.id,
          flockId:      flock?.id || null,
          readingDate:  form.readingDate,
          meterReading: meterVal,
          notes:        form.notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save reading');
      onSave(d.reading);
    } finally { setSaving(false); }
  }

  return (
    <Modal
      title="💧 Log Water Meter Reading"
      width={460}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || loading}
          >
            {saving ? 'Saving…' : 'Save Reading'}
          </button>
        </>
      }
    >
      {/* Section context pill */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, fontSize: 13, marginBottom: 16 }}>
        <strong>{section?.pen?.name} › {section?.name}</strong>
        {flock && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
            · {flock.batchCode} · {fmt(flock.currentCount)} birds
          </span>
        )}
      </div>

      {error && (
        <div className="alert alert-red" style={{ marginBottom: 14 }}>⚠ {error}</div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading previous readings…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Previous reading info */}
          {prev ? (
            <div style={{ padding: '10px 14px', background: 'var(--blue-bg)', border: '1px solid var(--blue-border)', borderRadius: 9, fontSize: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--blue)', marginBottom: 2 }}>📊 Previous Reading</div>
              <div style={{ color: 'var(--text-secondary)' }}>
                {new Date(prev.readingDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                {' — '}
                <strong>{Number(prev.meterReading).toLocaleString('en-NG')} L</strong>
                {prev.consumptionL != null && (
                  <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                    (used {Number(prev.consumptionL).toLocaleString('en-NG')} L that day)
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding: '10px 14px', background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 9, fontSize: 12, color: '#92400e' }}>
              ⚡ No previous reading found. Consumption won't be calculated for today — that's okay for a first reading.
            </div>
          )}

          {/* Date + meter reading */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Reading Date *</label>
              <input
                type="date"
                className="input"
                value={form.readingDate}
                max={today}
                onChange={e => set('readingDate', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Meter Reading (L) *</label>
              <input
                type="number"
                className="input"
                min="0"
                step="0.01"
                value={form.meterReading}
                onChange={e => set('meterReading', e.target.value)}
                placeholder="e.g. 12450.50"
                autoFocus
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Current odometer value in litres
              </div>
            </div>
          </div>

          {/* Calculated consumption preview */}
          {meterVal > 0 && (
            <div style={{
              padding: '12px 14px',
              background: consumptionL !== null ? 'var(--purple-light)' : 'var(--bg-elevated)',
              border: `1px solid ${consumptionL !== null ? '#d4d8ff' : 'var(--border)'}`,
              borderRadius: 9,
            }}>
              {consumptionL !== null ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple)' }}>
                      Daily Usage: {consumptionL.toLocaleString('en-NG')} L
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {meterVal.toLocaleString('en-NG')} − {prevMeterVal.toLocaleString('en-NG')}
                    </span>
                  </div>
                  {consumptionLPB !== null && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px',
                      background: lpbSt?.bg || '#f3f4f6',
                      border: `1px solid ${lpbSt?.border || '#e5e7eb'}`,
                      borderRadius: 20, fontSize: 11,
                    }}>
                      <span style={{ color: lpbSt?.color || '#6b7280', fontWeight: 700 }}>
                        {consumptionLPB.toFixed(3)} L/bird
                      </span>
                      <span style={{
                        padding: '1px 7px', borderRadius: 99,
                        background: lpbSt?.color || '#6b7280',
                        color: '#fff', fontSize: 9, fontWeight: 700,
                      }}>
                        {lpbSt?.label || '—'}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {meterVal > 0 && prevMeterVal !== null && meterVal < prevMeterVal
                    ? '⚠ Meter reading is lower than previous — check for a reset or entry error'
                    : 'Enter reading above to see consumption calculation'
                  }
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="label">Notes <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="e.g. Drinker line B dripping, reset at midnight…"
              style={{ resize: 'vertical' }}
            />
          </div>

        </div>
      )}
    </Modal>
  );
}
