'use client';
// components/feed/WorkerFeedModal.js
// Worker logs daily feed distribution for their pen section (Phase 8B bag-based).
//
// Business logic:
//   quantityKg = (bagsUsed × bagWeightKg) + (bagWeightKg − remainingKg)
//   gramsPerBird = quantityKg × 1000 / flock.currentCount   (computed server-side)
//
// Props:
//   section  — section object from /api/dashboard
//   apiFetch — from useAuth()
//   onClose  — close handler
//   onSave   — called after successful save

import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';

const fmt    = (n, d = 1) => Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: d });
const fmtCur = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n || 0));

// Grams-per-bird status thresholds (typical layer/broiler range)
function gpbStatus(gpb, opType) {
  if (gpb == null || gpb <= 0) return null;
  // Layers: 100–140 g/bird/day; Broilers: 80–160 g/bird/day
  const [low, high] = opType === 'LAYER' ? [80, 160] : [60, 180];
  if (gpb < low)  return { label: 'Low',    color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' };
  if (gpb > high) return { label: 'High',   color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
  return             { label: 'Normal', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' };
}

export default function WorkerFeedModal({ section, apiFetch, onClose, onSave }) {
  const flock  = section.flock ?? section.activeFlock ?? null;
  const opType = section?.pen?.operationType || 'LAYER';
  const today  = new Date().toISOString().split('T')[0];

  const [inventory,   setInventory]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [form, setForm] = useState({
    feedInventoryId: '',
    recordedDate:    today,
    bagsUsed:        '',
    remainingKg:     '',
    notes:           '',
  });

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setError(''); };

  // ── Load feed inventory for this tenant ────────────────────────────────────
  useEffect(() => {
    apiFetch('/api/feed/inventory')
      .then(r => r.json())
      .then(d => setInventory((d.inventory || []).filter(i => Number(i.currentStockKg) > 0)))
      .catch(() => setError('Failed to load feed inventory'))
      .finally(() => setLoading(false));
  }, []);

  // ── Derived calculations ───────────────────────────────────────────────────
  const selectedFeed = inventory.find(i => i.id === form.feedInventoryId) || null;
  const bagWt        = selectedFeed ? Number(selectedFeed.bagWeightKg) || 25 : 25;
  const bagsUsed     = Math.max(0, parseInt(form.bagsUsed)  || 0);
  const remainingKg  = Math.max(0, parseFloat(form.remainingKg) || 0);

  // quantityKg = (bagsUsed × bagWt) + partialConsumed
  // partialConsumed = (bagWt − remainingKg) only when a bag is opened (remainingKg > 0.1)
  // If remainingKg is 0 or empty, no partial bag was opened — add nothing extra.
  const hasPartialBag = remainingKg > 0.1;
  const partialConsumed = hasPartialBag ? (bagWt - remainingKg) : 0;
  const quantityKg = (bagsUsed > 0 || hasPartialBag)
    ? parseFloat(((bagsUsed * bagWt) + partialConsumed).toFixed(2))
    : 0;

  const birdCount  = flock?.currentCount || 0;
  const gpb        = (quantityKg > 0 && birdCount > 0)
    ? parseFloat((quantityKg * 1000 / birdCount).toFixed(1))
    : null;
  const gpbSt      = gpbStatus(gpb, opType);

  const stockAfter = selectedFeed
    ? parseFloat((Number(selectedFeed.currentStockKg) - quantityKg).toFixed(2))
    : null;
  const willOverdraw = stockAfter !== null && stockAfter < 0;

  const costPreview = selectedFeed && quantityKg > 0
    ? quantityKg * Number(selectedFeed.costPerKg)
    : null;

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate() {
    if (!flock)                     return 'No active flock in this section';
    if (!form.feedInventoryId)      return 'Select a feed type';
    if (bagsUsed <= 0 && remainingKg <= 0)
      return 'Enter bags used (or at least a partial bag amount)';
    if (remainingKg > bagWt)
      return `Remaining kg (${remainingKg}) cannot exceed bag weight (${bagWt} kg)`;
    if (willOverdraw)
      return `Insufficient stock — only ${fmt(selectedFeed?.currentStockKg, 1)} kg available`;
    return null;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function save() {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/feed/consumption', {
        method: 'POST',
        body: JSON.stringify({
          feedInventoryId: form.feedInventoryId,
          flockId:         flock.id,
          penSectionId:    section.id,
          recordedDate:    form.recordedDate,
          bagsUsed,
          remainingKg,
          notes:           form.notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to save'); return; }
      onSave(d.consumption);
    } catch { setError('Network error — please try again'); }
    finally { setSaving(false); }
  }

  return (
    <Modal
      title="🍽️ Log Feed Distribution"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || loading || willOverdraw}
          >
            {saving ? 'Saving…' : 'Save Record'}
          </button>
        </>
      }
    >
      {/* Section context */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, fontSize: 13, marginBottom: 16 }}>
        <strong>{section?.penName || section?.pen?.name} › {section?.name}</strong>
        {flock && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
            · {flock.batchCode} · {fmt(flock.currentCount, 0)} birds
          </span>
        )}
      </div>

      {error && (
        <div className="alert alert-red" style={{ marginBottom: 14 }}>⚠ {error}</div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading feed inventory…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Feed type */}
          <div>
            <label className="label">Feed Type *</label>
            <select
              className="input"
              value={form.feedInventoryId}
              onChange={e => set('feedInventoryId', e.target.value)}
            >
              <option value="">— Select feed type —</option>
              {inventory.map(i => (
                <option key={i.id} value={i.id}>
                  {i.feedType} — {fmt(i.currentStockKg, 1)} kg in stock
                  {i.stockStatus === 'LOW' ? ' ⚠ Low' : ''}
                </option>
              ))}
            </select>
            {selectedFeed && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                Bag weight: <strong>{bagWt} kg</strong>
                {' · '}Cost: <strong>₦{fmt(selectedFeed.costPerKg, 2)}/kg</strong>
                {' · '}Stock: <strong style={{ color: selectedFeed.stockStatus === 'LOW' ? 'var(--amber)' : 'inherit' }}>
                  {fmt(selectedFeed.currentStockKg, 1)} kg
                </strong>
              </div>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="label">Date *</label>
            <input
              type="date"
              className="input"
              value={form.recordedDate}
              max={today}
              onChange={e => set('recordedDate', e.target.value)}
            />
          </div>

          {/* Bag inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Full Bags Used *</label>
              <input
                type="number"
                className="input"
                min="0"
                step="1"
                value={form.bagsUsed}
                onChange={e => set('bagsUsed', e.target.value)}
                placeholder="0"
                autoFocus
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Completely emptied bags
              </div>
            </div>
            <div>
              <label className="label">Remaining in Last Bag (kg)</label>
              <input
                type="number"
                className="input"
                min="0"
                max={bagWt}
                step="0.1"
                value={form.remainingKg}
                onChange={e => set('remainingKg', e.target.value)}
                placeholder={`0 – ${bagWt}`}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Kg left in the partial bag
              </div>
            </div>
          </div>

          {/* Live calculation preview */}
          {(bagsUsed > 0 || remainingKg > 0) && selectedFeed && (
            <div style={{
              padding: '12px 14px',
              background: willOverdraw ? 'var(--red-bg)' : 'var(--purple-light)',
              border: `1px solid ${willOverdraw ? 'var(--red-border)' : '#d4d8ff'}`,
              borderRadius: 9,
            }}>
              {/* Formula breakdown */}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                ({bagsUsed} bags × {bagWt} kg)
                {hasPartialBag
                  ? ` + (${bagWt} − ${remainingKg} kg remaining) = `
                  : ' = '}
                <strong style={{ color: willOverdraw ? 'var(--red)' : 'var(--purple)', fontSize: 13 }}>
                  {fmt(quantityKg, 2)} kg total
                </strong>
                {!hasPartialBag && bagsUsed > 0 && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                    (no partial bag)
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Stock after */}
                <div style={{ fontSize: 12 }}>
                  Stock after:{' '}
                  <strong style={{ color: willOverdraw ? 'var(--red)' : stockAfter < Number(selectedFeed.reorderLevelKg) ? 'var(--amber)' : 'var(--green)' }}>
                    {willOverdraw ? '⚠ Overdraw' : `${fmt(stockAfter, 1)} kg`}
                  </strong>
                </div>

                {/* Cost preview */}
                {costPreview !== null && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Cost: <strong>{fmtCur(costPreview)}</strong>
                  </div>
                )}

                {/* Grams per bird */}
                {gpbSt && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px',
                    background: gpbSt.bg, border: `1px solid ${gpbSt.border}`,
                    borderRadius: 20, fontSize: 11,
                  }}>
                    <span style={{ color: gpbSt.color, fontWeight: 700 }}>{fmt(gpb, 1)} g/bird</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: 99,
                      background: gpbSt.color, color: '#fff',
                      fontSize: 9, fontWeight: 700,
                    }}>{gpbSt.label}</span>
                  </div>
                )}
              </div>
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
              placeholder="e.g. switched to new batch, spillage noted…"
              style={{ resize: 'vertical' }}
            />
          </div>

        </div>
      )}
    </Modal>
  );
}
