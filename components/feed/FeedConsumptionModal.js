'use client';
// components/feed/FeedConsumptionModal.js
// Full-featured feed consumption logging modal.
// Replaces the inline stub in app/feed/page.js — same props interface.
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/layout/AuthProvider';

// ─── Styles ───────────────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.38)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const modal = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560,
  boxShadow: '0 12px 48px rgba(0,0,0,0.2)',
  animation: 'fadeInUp 0.22s ease',
  maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column',
};
const inputSt = {
  width: '100%', padding: '9px 12px', borderRadius: 9,
  border: '1px solid #e2e8f0', fontSize: 13,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};
const btnPrimary = (disabled) => ({
  padding: '10px 22px', borderRadius: 9, border: 'none',
  background: disabled ? '#a5b4fc' : 'var(--purple)',
  color: '#fff', fontSize: 13, fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer', transition: 'opacity 0.15s',
});
const btnSecondary = {
  padding: '10px 18px', borderRadius: 9,
  border: '1px solid #e2e8f0', background: '#fff',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b',
};

const fmt    = (n, d = 1) => Number(n ?? 0).toLocaleString('en-NG', { maximumFractionDigits: d });
const fmtCur = (n) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n ?? 0));

// ─── Sub-components ───────────────────────────────────────────────────────────
function Field({ label, required, error, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {hint  && !error && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 3 }}>{error}</div>}
    </div>
  );
}

function StockPreview({ feedItem, quantityKg }) {
  if (!feedItem) return null;
  const current  = Number(feedItem.currentStockKg);
  const qty      = parseFloat(quantityKg) || 0;
  const after    = current - qty;
  const reorder  = Number(feedItem.reorderLevelKg);
  const willLow  = after <= reorder && after > 0;
  const willOut  = after <= 0;
  const color    = willOut ? '#dc2626' : willLow ? '#d97706' : '#16a34a';
  const pctBefore = Math.min((current / Math.max(current, reorder * 2)) * 100, 100);
  const pctAfter  = Math.max(Math.min((after  / Math.max(current, reorder * 2)) * 100, 100), 0);

  return (
    <div style={{ background: willOut ? '#fef2f2' : willLow ? '#fffbeb' : '#f0fdf4', border: `1px solid ${willOut ? '#fecaca' : willLow ? '#fde68a' : '#bbf7d0'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 8 }}>Stock Preview — {feedItem.feedType}</div>
      {/* Bar */}
      <div style={{ position: 'relative', height: 8, background: '#e2e8f0', borderRadius: 99, marginBottom: 8, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, height: '100%', width: `${pctBefore}%`, background: '#cbd5e1', borderRadius: 99 }} />
        <div style={{ position: 'absolute', left: 0, height: '100%', width: `${pctAfter}%`, background: color, borderRadius: 99, transition: 'width 0.3s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: '#64748b' }}>Before: <b>{fmt(current, 1)} kg</b></span>
        <span style={{ color, fontWeight: 700 }}>After: {fmt(after, 1)} kg {willOut ? '⚠ OUT OF STOCK' : willLow ? '⚠ Below reorder' : '✓'}</span>
      </div>
      {qty > 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
          Cost at time: {fmtCur(qty * Number(feedItem.costPerKg))} &nbsp;·&nbsp; ₦{fmt(feedItem.costPerKg, 2)}/kg
        </div>
      )}
    </div>
  );
}

function GramsPerBirdDisplay({ quantityKg, birdCount }) {
  if (!quantityKg || !birdCount || birdCount === 0) return null;
  const gpb = (parseFloat(quantityKg) * 1000) / birdCount;
  const status = gpb < 80 ? { color: '#d97706', label: 'Low' }
               : gpb > 160 ? { color: '#dc2626', label: 'High' }
               : { color: '#16a34a', label: 'Normal' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontSize: 12, marginBottom: 14 }}>
      <span style={{ fontSize: 16 }}>🐔</span>
      <span style={{ color: '#64748b' }}>
        Grams per bird: <b style={{ color: status.color }}>{fmt(gpb, 1)}g</b>
        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '2px 7px', background: `${status.color}18`, color: status.color, borderRadius: 99 }}>{status.label}</span>
      </span>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function FeedConsumptionModal({ preselectedItem, onClose, onSuccess }) {
  const { user } = useAuth();

  const [flocks,      setFlocks]      = useState([]);
  const [inventory,   setInventory]   = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [errors,      setErrors]      = useState({});
  const [apiError,    setApiError]    = useState(null);

  const [form, setForm] = useState({
    flockId:         '',
    penSectionId:    '',
    feedInventoryId: preselectedItem?.id || '',
    recordedDate:    new Date().toISOString().slice(0, 10),
    quantityKg:      '',
    notes:           '',
  });

  // Derived selections
  const selectedFlock   = flocks.find(f => f.id === form.flockId) || null;
  const selectedFeed    = inventory.find(i => i.id === form.feedInventoryId) || null;
  const birdCount       = selectedFlock?.currentCount || 0;

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingData(true);
    Promise.all([
      fetch('/api/flocks?status=ACTIVE').then(r => r.json()),
      fetch('/api/feed/inventory').then(r => r.json()),
    ]).then(([fd, fi]) => {
      setFlocks(fd.flocks || []);
      setInventory(fi.inventory || []);
    }).catch(() => {
      setApiError('Failed to load form data. Please refresh.');
    }).finally(() => setLoadingData(false));
  }, []);

  // Auto-fill penSectionId when flock is selected
  useEffect(() => {
    if (form.flockId && selectedFlock) {
      setForm(p => ({ ...p, penSectionId: selectedFlock.penSectionId || '' }));
    }
  }, [form.flockId, selectedFlock]);

  // ── Validation ────────────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const e = {};
    if (!form.flockId)         e.flockId         = 'Please select a flock';
    if (!form.feedInventoryId) e.feedInventoryId = 'Please select a feed type';
    if (!form.recordedDate)    e.recordedDate    = 'Date is required';
    if (!form.quantityKg || parseFloat(form.quantityKg) <= 0)
                               e.quantityKg      = 'Enter a quantity greater than 0';
    // Check sufficient stock
    if (selectedFeed && parseFloat(form.quantityKg) > Number(selectedFeed.currentStockKg)) {
      e.quantityKg = `Insufficient stock. Available: ${fmt(selectedFeed.currentStockKg, 1)} kg`;
    }
    // Prevent future date
    if (form.recordedDate > new Date().toISOString().slice(0, 10)) {
      e.recordedDate = 'Date cannot be in the future';
    }
    return e;
  }, [form, selectedFeed]);

  const set = (field, value) => {
    setForm(p => ({ ...p, [field]: value }));
    if (errors[field]) setErrors(p => { const n = { ...p }; delete n[field]; return n; });
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true); setApiError(null);
    try {
      const res = await fetch('/api/feed/consumption', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flockId:         form.flockId,
          penSectionId:    form.penSectionId,
          feedInventoryId: form.feedInventoryId,
          recordedDate:    form.recordedDate,
          quantityKg:      parseFloat(form.quantityKg),
          notes:           form.notes || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to log consumption');
      onSuccess(d.consumption);
    } catch (e) {
      setApiError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes fadeInUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        .fc-input:focus { border-color: var(--purple) !important; box-shadow: 0 0 0 3px #6c63ff18; }
        .fc-select:focus { border-color: var(--purple) !important; }
      `}</style>

      <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={modal}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🍽️</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', fontFamily: "'Poppins',sans-serif" }}>Log Feed Consumption</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Record daily feed usage for a flock</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1, padding: 4 }}>×</button>
          </div>

          {/* Body */}
          <div style={{ padding: '22px 24px', flex: 1 }}>

            {apiError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#dc2626', marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span>⚠</span><span>{apiError}</span>
              </div>
            )}

            {loadingData ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>Loading form data…</div>
            ) : (
              <>
                {/* Flock selector */}
                <Field label="Flock" required error={errors.flockId}>
                  <select
                    className="fc-select"
                    value={form.flockId}
                    onChange={e => set('flockId', e.target.value)}
                    style={{ ...inputSt, borderColor: errors.flockId ? '#ef4444' : '#e2e8f0' }}
                  >
                    <option value="">Select active flock…</option>
                    {flocks.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.batchCode} — {f.penSection?.pen?.name} · {f.penSection?.name} ({f.operationType})
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Flock summary pill */}
                {selectedFlock && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Bird Count', value: selectedFlock.currentCount?.toLocaleString() },
                      { label: 'Type', value: selectedFlock.operationType },
                      { label: 'Age', value: selectedFlock.ageInDays != null ? `${selectedFlock.ageInDays}d` : '—' },
                    ].map(p => (
                      <div key={p.label} style={{ flex: 1, minWidth: 90, background: '#f8fafc', borderRadius: 8, padding: '8px 12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{p.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', marginTop: 2 }}>{p.value ?? '—'}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Feed type selector */}
                <Field label="Feed Type" required error={errors.feedInventoryId}
                  hint={selectedFeed ? `Current stock: ${fmt(selectedFeed.currentStockKg, 1)} kg · ₦${fmt(selectedFeed.costPerKg, 2)}/kg` : undefined}>
                  <select
                    className="fc-select"
                    value={form.feedInventoryId}
                    onChange={e => set('feedInventoryId', e.target.value)}
                    style={{ ...inputSt, borderColor: errors.feedInventoryId ? '#ef4444' : '#e2e8f0' }}
                  >
                    <option value="">Select feed type…</option>
                    {inventory.map(i => (
                      <option key={i.id} value={i.id} disabled={Number(i.currentStockKg) <= 0}>
                        {i.feedType} — {fmt(i.currentStockKg, 1)}kg {Number(i.currentStockKg) <= 0 ? '(OUT OF STOCK)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Date + Quantity row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Date" required error={errors.recordedDate}>
                    <input
                      type="date"
                      className="fc-input"
                      value={form.recordedDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={e => set('recordedDate', e.target.value)}
                      style={{ ...inputSt, borderColor: errors.recordedDate ? '#ef4444' : '#e2e8f0' }}
                    />
                  </Field>
                  <Field label="Quantity (kg)" required error={errors.quantityKg}>
                    <input
                      type="number"
                      className="fc-input"
                      min="0.1" step="0.1"
                      placeholder="0.0"
                      value={form.quantityKg}
                      onChange={e => set('quantityKg', e.target.value)}
                      style={{ ...inputSt, borderColor: errors.quantityKg ? '#ef4444' : '#e2e8f0' }}
                    />
                  </Field>
                </div>

                {/* Grams per bird indicator */}
                <GramsPerBirdDisplay quantityKg={form.quantityKg} birdCount={birdCount} />

                {/* Stock preview */}
                <StockPreview feedItem={selectedFeed} quantityKg={form.quantityKg} />

                {/* Notes */}
                <Field label="Notes">
                  <textarea
                    className="fc-input"
                    rows={2}
                    placeholder="Optional — e.g. feed change, spillage noted…"
                    value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                    style={{ ...inputSt, resize: 'vertical' }}
                  />
                </Field>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={submit} disabled={saving || loadingData} style={btnPrimary(saving || loadingData)}>
              {saving ? '⏳ Saving…' : '✓ Log Consumption'}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
