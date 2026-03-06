'use client';
// components/feed/FeedReceiptModal.js
// Full-featured feed delivery receipt modal.
// Replaces the inline stub in app/feed/page.js — same props interface.
import { useState, useEffect, useCallback } from 'react';

// ─── Styles ───────────────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(0,0,0,0.38)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const modal = {
  background: '#fff', borderRadius: 16, width: '100%', maxWidth: 580,
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
  cursor: disabled ? 'not-allowed' : 'pointer',
});
const btnSecondary = {
  padding: '10px 18px', borderRadius: 9,
  border: '1px solid #e2e8f0', background: '#fff',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b',
};

const fmt    = (n, d = 2) => Number(n ?? 0).toLocaleString('en-NG', { maximumFractionDigits: d });
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

function SectionDivider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: '#f1f5f9' }} />
    </div>
  );
}

function CostPreview({ feedItem, quantityReceived, unitCost }) {
  if (!feedItem || !quantityReceived || !unitCost) return null;

  const qty        = parseFloat(quantityReceived) || 0;
  const newCost    = parseFloat(unitCost) || 0;
  const totalCost  = qty * newCost;

  // Weighted average cost calculation
  const curStock   = Number(feedItem.currentStockKg);
  const curCost    = Number(feedItem.costPerKg);
  const newStock   = curStock + qty;
  const weightedAvg = newStock > 0
    ? (curStock * curCost + qty * newCost) / newStock
    : newCost;

  const costChange = weightedAvg - curCost;
  const costColor  = costChange > 0 ? '#dc2626' : costChange < 0 ? '#16a34a' : '#64748b';

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 10 }}>Delivery Summary</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { label: 'Total Delivery Cost',  value: fmtCur(totalCost),          bold: true },
          { label: 'Stock After Delivery', value: `${fmt(newStock, 1)} kg`,    bold: false },
          { label: 'Current Cost/kg',      value: `₦${fmt(curCost, 2)}`,       bold: false },
          { label: 'New Avg Cost/kg',
            value: `₦${fmt(weightedAvg, 2)}`,
            sub: costChange !== 0
              ? `${costChange > 0 ? '▲' : '▼'} ₦${fmt(Math.abs(costChange), 2)}`
              : '— no change',
            subColor: costColor,
            bold: true },
        ].map(p => (
          <div key={p.label} style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', border: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{p.label}</div>
            <div style={{ fontSize: 13, fontWeight: p.bold ? 800 : 600, color: '#1e293b', marginTop: 2 }}>{p.value}</div>
            {p.sub && <div style={{ fontSize: 10, color: p.subColor, fontWeight: 700, marginTop: 1 }}>{p.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
export default function FeedReceiptModal({ preselectedItem, onClose, onSuccess }) {
  const [inventory,   setInventory]   = useState([]);
  const [suppliers,   setSuppliers]   = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [errors,      setErrors]      = useState({});
  const [apiError,    setApiError]    = useState(null);
  const [step,        setStep]        = useState(1); // 1 = delivery details, 2 = confirmation

  const [form, setForm] = useState({
    storeId:          preselectedItem?.store?.id || '',
    feedInventoryId:  preselectedItem?.id || '',
    supplierId:       preselectedItem?.supplier?.id || '',
    receiptDate:      new Date().toISOString().slice(0, 10),
    quantityReceived: '',
    unitCost:         preselectedItem ? String(preselectedItem.costPerKg) : '',
    currency:         'NGN',
    referenceNumber:  '',
    batchNumber:      '',
    expiryDate:       '',
    qualityNotes:     '',
    notes:            '',
  });

  // Derived
  const selectedFeed = inventory.find(i => i.id === form.feedInventoryId) || null;

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingData(true);
    Promise.all([
      fetch('/api/feed/inventory').then(r => r.json()),
      fetch('/api/feed/receipts?limit=20').then(r => r.json()),
    ]).then(([fi, fr]) => {
      const inv = fi.inventory || [];
      setInventory(inv);

      // Extract unique suppliers from recent receipts
      const seen = {}; const sups = [];
      (fr.receipts || []).forEach(r => {
        if (r.supplier && !seen[r.supplier.id]) {
          seen[r.supplier.id] = true;
          sups.push(r.supplier);
        }
      });
      setSuppliers(sups);

      // Pre-fill storeId from preselected item or first inventory item
      if (!form.storeId) {
        const storeId = preselectedItem?.store?.id || inv[0]?.store?.id || '';
        setForm(p => ({ ...p, storeId }));
      }
    }).catch(() => {
      setApiError('Failed to load form data. Please refresh.');
    }).finally(() => setLoadingData(false));
  }, []);

  // Auto-fill unit cost from selected feed's current cost
  useEffect(() => {
    if (selectedFeed && !form.unitCost) {
      setForm(p => ({ ...p, unitCost: String(selectedFeed.costPerKg), storeId: selectedFeed.store?.id || p.storeId }));
    }
    if (selectedFeed && selectedFeed.store?.id) {
      setForm(p => ({ ...p, storeId: selectedFeed.store.id }));
    }
  }, [form.feedInventoryId, selectedFeed]);

  // ── Validation ────────────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const e = {};
    if (!form.feedInventoryId)                                   e.feedInventoryId  = 'Please select a feed type';
    if (!form.receiptDate)                                       e.receiptDate      = 'Date is required';
    if (form.receiptDate > new Date().toISOString().slice(0,10)) e.receiptDate      = 'Date cannot be in the future';
    if (!form.quantityReceived || parseFloat(form.quantityReceived) <= 0)
                                                                 e.quantityReceived = 'Enter a quantity greater than 0';
    if (!form.unitCost || parseFloat(form.unitCost) <= 0)        e.unitCost         = 'Enter a unit cost greater than 0';
    return e;
  }, [form]);

  const set = (field, value) => {
    setForm(p => ({ ...p, [field]: value }));
    if (errors[field]) setErrors(p => { const n = { ...p }; delete n[field]; return n; });
  };

  const handleNext = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setStep(2);
  };

  // ── Submit ────────────────────────────────────────────────────────────────────
  const submit = async () => {
    setSaving(true); setApiError(null);
    try {
      const payload = {
        storeId:          form.storeId,
        feedInventoryId:  form.feedInventoryId,
        supplierId:       form.supplierId || null,
        receiptDate:      form.receiptDate,
        quantityReceived: parseFloat(form.quantityReceived),
        unitCost:         parseFloat(form.unitCost),
        currency:         form.currency,
        referenceNumber:  form.referenceNumber || null,
        batchNumber:      form.batchNumber     || null,
        expiryDate:       form.expiryDate      || null,
        qualityNotes:     form.qualityNotes    || null,
        notes:            form.notes           || null,
      };
      const res = await fetch('/api/feed/receipts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to record delivery');
      onSuccess(d.receipt);
    } catch (e) {
      setApiError(e.message);
      setStep(1);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes fadeInUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        .fr-input:focus  { border-color: var(--purple) !important; box-shadow: 0 0 0 3px #6c63ff18; }
        .fr-select:focus { border-color: var(--purple) !important; }
      `}</style>

      <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div style={modal}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📦</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', fontFamily: "'Poppins',sans-serif" }}>Record Feed Delivery</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Log incoming stock and update inventory</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Step indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {[1, 2].map(s => (
                  <div key={s} style={{ width: s === step ? 22 : 8, height: 8, borderRadius: 99, background: s === step ? 'var(--purple)' : s < step ? '#a5b4fc' : '#e2e8f0', transition: 'all 0.2s' }} />
                ))}
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8', lineHeight: 1, padding: 4 }}>×</button>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '22px 24px', flex: 1 }}>

            {apiError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#dc2626', marginBottom: 16, display: 'flex', gap: 8 }}>
                <span>⚠</span><span>{apiError}</span>
              </div>
            )}

            {loadingData ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 13 }}>Loading form data…</div>
            ) : step === 1 ? (
              <>
                {/* ── STEP 1: Delivery details ── */}
                <SectionDivider label="Delivery Details" />

                <Field label="Feed Type" required error={errors.feedInventoryId}
                  hint={selectedFeed ? `Current stock: ${fmt(selectedFeed.currentStockKg, 1)} kg` : undefined}>
                  <select className="fr-select" value={form.feedInventoryId}
                    onChange={e => set('feedInventoryId', e.target.value)}
                    style={{ ...inputSt, borderColor: errors.feedInventoryId ? '#ef4444' : '#e2e8f0' }}>
                    <option value="">Select feed type…</option>
                    {inventory.map(i => (
                      <option key={i.id} value={i.id}>{i.feedType} — {i.store?.name}</option>
                    ))}
                  </select>
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Receipt Date" required error={errors.receiptDate}>
                    <input type="date" className="fr-input"
                      value={form.receiptDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={e => set('receiptDate', e.target.value)}
                      style={{ ...inputSt, borderColor: errors.receiptDate ? '#ef4444' : '#e2e8f0' }} />
                  </Field>
                  <Field label="Supplier">
                    <select className="fr-select" value={form.supplierId}
                      onChange={e => set('supplierId', e.target.value)}
                      style={inputSt}>
                      <option value="">Select supplier (optional)…</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </Field>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Quantity Received (kg)" required error={errors.quantityReceived}>
                    <input type="number" className="fr-input"
                      min="0.1" step="0.1" placeholder="0.0"
                      value={form.quantityReceived}
                      onChange={e => set('quantityReceived', e.target.value)}
                      style={{ ...inputSt, borderColor: errors.quantityReceived ? '#ef4444' : '#e2e8f0' }} />
                  </Field>
                  <Field label="Unit Cost (₦/kg)" required error={errors.unitCost}
                    hint={selectedFeed ? `Current: ₦${fmt(selectedFeed.costPerKg, 2)}/kg` : undefined}>
                    <input type="number" className="fr-input"
                      min="0.01" step="0.01" placeholder="0.00"
                      value={form.unitCost}
                      onChange={e => set('unitCost', e.target.value)}
                      style={{ ...inputSt, borderColor: errors.unitCost ? '#ef4444' : '#e2e8f0' }} />
                  </Field>
                </div>

                {/* Live cost preview */}
                <CostPreview
                  feedItem={selectedFeed}
                  quantityReceived={form.quantityReceived}
                  unitCost={form.unitCost}
                />

                <SectionDivider label="Reference & Quality" />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Reference / Delivery Note #">
                    <input className="fr-input" placeholder="e.g. DN-2026-001"
                      value={form.referenceNumber}
                      onChange={e => set('referenceNumber', e.target.value)}
                      style={inputSt} />
                  </Field>
                  <Field label="Batch Number">
                    <input className="fr-input" placeholder="Supplier batch ref"
                      value={form.batchNumber}
                      onChange={e => set('batchNumber', e.target.value)}
                      style={inputSt} />
                  </Field>
                  <Field label="Expiry Date">
                    <input type="date" className="fr-input"
                      value={form.expiryDate}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={e => set('expiryDate', e.target.value)}
                      style={inputSt} />
                  </Field>
                </div>

                <Field label="Quality Observations">
                  <textarea className="fr-input" rows={2}
                    placeholder="e.g. Bags intact, smell normal, colour consistent…"
                    value={form.qualityNotes}
                    onChange={e => set('qualityNotes', e.target.value)}
                    style={{ ...inputSt, resize: 'vertical' }} />
                </Field>

                <Field label="Notes">
                  <textarea className="fr-input" rows={2}
                    placeholder="Any additional notes about this delivery…"
                    value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                    style={{ ...inputSt, resize: 'vertical' }} />
                </Field>
              </>
            ) : (
              <>
                {/* ── STEP 2: Confirmation ── */}
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>Confirm Delivery</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Please review before saving to inventory</div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                  {[
                    { label: 'Feed Type',         value: selectedFeed?.feedType || '—' },
                    { label: 'Store',             value: selectedFeed?.store?.name || '—' },
                    { label: 'Date',              value: new Date(form.receiptDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) },
                    { label: 'Quantity',          value: `${fmt(form.quantityReceived, 1)} kg` },
                    { label: 'Unit Cost',         value: `₦${fmt(form.unitCost, 2)}/kg` },
                    { label: 'Total Cost',        value: fmtCur(parseFloat(form.quantityReceived) * parseFloat(form.unitCost)), highlight: true },
                    ...(form.referenceNumber ? [{ label: 'Reference #', value: form.referenceNumber }] : []),
                    ...(form.batchNumber     ? [{ label: 'Batch #',     value: form.batchNumber     }] : []),
                    ...(form.expiryDate      ? [{ label: 'Expiry Date', value: new Date(form.expiryDate).toLocaleDateString('en-NG') }] : []),
                  ].map((row, i, arr) => (
                    <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: i < arr.length - 1 ? '1px solid #f1f5f9' : 'none', background: row.highlight ? '#f0fdf4' : 'transparent' }}>
                      <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{row.label}</span>
                      <span style={{ fontSize: 13, fontWeight: row.highlight ? 800 : 700, color: row.highlight ? '#16a34a' : '#1e293b' }}>{row.value}</span>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#92400e' }}>
                  ℹ Stock will be updated immediately and cost per kg recalculated using weighted average pricing.
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
            <button onClick={step === 1 ? onClose : () => setStep(1)} style={btnSecondary}>
              {step === 1 ? 'Cancel' : '← Back'}
            </button>
            {step === 1 ? (
              <button onClick={handleNext} style={btnPrimary(false)}>
                Review Delivery →
              </button>
            ) : (
              <button onClick={submit} disabled={saving} style={btnPrimary(saving)}>
                {saving ? '⏳ Saving…' : '✓ Confirm & Save'}
              </button>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
