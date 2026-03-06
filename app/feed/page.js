'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line
} from 'recharts';

// ─── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n, d = 1) => (n == null ? '—' : Number(n).toFixed(d));
const fmtCurrency = (n) => n == null ? '—' : `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const ROLE_FULL = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'SUPER_ADMIN'];
const ROLE_MID  = [...ROLE_FULL, 'PEN_MANAGER'];

const PO_STATUS_COLORS = {
  DRAFT:     'status-badge',
  SUBMITTED: 'status-badge status-blue',
  APPROVED:  'status-badge status-green',
  REJECTED:  'status-badge status-red',
  FULFILLED: 'status-badge status-green',
  CANCELLED: 'status-badge status-red',
};

const QC_COLORS = {
  PASSED:  'status-badge status-green',
  FAILED:  'status-badge status-red',
  PENDING: 'status-badge status-amber',
};

// ─── Alert component ───────────────────────────────────────────────────────

function Alert({ type = 'red', message, onClose }) {
  if (!message) return null;
  return (
    <div className={`alert alert-${type}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <span>{message}</span>
      {onClose && <button onClick={onClose} className="btn btn-ghost" style={{ padding: '0 8px' }}>✕</button>}
    </div>
  );
}

// ─── Modal wrapper ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in" style={{ maxWidth: wide ? 720 : 480, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'Poppins,sans-serif', fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <button onClick={onClose} className="btn btn-ghost" style={{ fontSize: 20, lineHeight: 1, padding: '4px 10px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Tab Bar ───────────────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--border)', marginBottom: 24, overflowX: 'auto' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: '10px 18px',
            fontFamily: 'Nunito,sans-serif',
            fontWeight: 700,
            fontSize: 14,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            borderBottom: active === t.id ? '3px solid var(--purple)' : '3px solid transparent',
            color: active === t.id ? 'var(--purple)' : 'var(--text-muted)',
            whiteSpace: 'nowrap',
            transition: 'all .15s',
            marginBottom: -2,
          }}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── INVENTORY TAB ─────────────────────────────────────────────────────────

function InventoryTab({ data, userRole, onRefresh }) {
  const [alert, setAlert] = useState(null);
  const [restockItem, setRestockItem] = useState(null);
  const [restockQty, setRestockQty] = useState('');
  const [loading, setLoading] = useState(false);

  const canManage = ROLE_FULL.includes(userRole);

  const handleRestock = async () => {
    if (!restockQty || isNaN(restockQty) || Number(restockQty) <= 0) {
      setAlert({ type: 'red', msg: 'Enter a valid quantity.' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/feed?action=restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryId: restockItem.id, quantityKg: Number(restockQty) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Restock failed');
      setRestockItem(null);
      setRestockQty('');
      setAlert({ type: 'green', msg: 'Stock updated.' });
      onRefresh();
    } catch (e) {
      setAlert({ type: 'red', msg: e.message });
    } finally {
      setLoading(false);
    }
  };

  const items = data?.inventory || [];
  const consumptionChart = data?.dailyUsageChart || [];
  const fcrTable = data?.fcrTable || [];

  return (
    <div>
      <Alert type={alert?.type} message={alert?.msg} onClose={() => setAlert(null)} />

      {/* Low-stock alerts */}
      {items.filter(i => i.currentStockKg <= i.reorderLevelKg).map(i => (
        <Alert key={i.id} type="red" message={`⚠ Low stock: ${i.feedType} — only ${fmt(i.currentStockKg)} kg remaining (reorder at ${fmt(i.reorderLevelKg)} kg)`} />
      ))}

      {/* Stock cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        {items.map(item => {
          const pct = Math.min(100, item.reorderLevelKg > 0 ? (item.currentStockKg / (item.reorderLevelKg * 3)) * 100 : 100);
          const low = item.currentStockKg <= item.reorderLevelKg;
          const daysLeft = item.avgDailyUsageKg > 0 ? Math.floor(item.currentStockKg / item.avgDailyUsageKg) : null;

          return (
            <div key={item.id} className="card" style={{ borderLeft: `4px solid ${low ? 'var(--red)' : 'var(--purple)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, fontSize: 16 }}>{item.feedType}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.store?.name || 'Main Store'}</div>
                </div>
                {low && <span className="status-badge status-red">Low Stock</span>}
              </div>

              <div style={{ fontSize: 28, fontFamily: 'Poppins,sans-serif', fontWeight: 800, color: low ? 'var(--red)' : 'var(--purple)' }}>
                {fmt(item.currentStockKg, 0)} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>kg</span>
              </div>

              <div className="progress-bar" style={{ margin: '10px 0' }}>
                <div className="progress-fill" style={{ width: `${pct}%`, background: low ? 'var(--red)' : 'var(--purple)' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Reorder At</div>
                  <div style={{ fontWeight: 700 }}>{fmt(item.reorderLevelKg, 0)} kg</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Cost/kg</div>
                  <div style={{ fontWeight: 700 }}>{fmtCurrency(item.costPerKg)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Days Left</div>
                  <div style={{ fontWeight: 700, color: daysLeft != null && daysLeft < 7 ? 'var(--red)' : 'inherit' }}>
                    {daysLeft != null ? `~${daysLeft}d` : '—'}
                  </div>
                </div>
              </div>

              {canManage && (
                <button
                  className="btn btn-outline"
                  style={{ width: '100%', marginTop: 12, fontSize: 13 }}
                  onClick={() => { setRestockItem(item); setRestockQty(''); }}
                >
                  + Restock
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
        {consumptionChart.length > 0 && (
          <div className="card">
            <div style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, marginBottom: 12 }}>Avg Daily Usage (kg)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={consumptionChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="totalKg" fill="var(--purple)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* FCR Table */}
        {fcrTable.length > 0 && (
          <div className="card">
            <div style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, marginBottom: 12 }}>FCR by Flock</div>
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Flock</th>
                  <th>Feed Consumed (kg)</th>
                  <th>Weight Gain (kg)</th>
                  <th>FCR</th>
                </tr>
              </thead>
              <tbody>
                {fcrTable.map((row, i) => (
                  <tr key={i}>
                    <td>{row.flockName}</td>
                    <td>{fmt(row.feedKg, 1)}</td>
                    <td>{fmt(row.weightGainKg, 1)}</td>
                    <td style={{ fontWeight: 700, color: row.fcr > 2.5 ? 'var(--red)' : 'var(--green)' }}>{fmt(row.fcr, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent consumption log */}
      {data?.recentConsumption?.length > 0 && (
        <div className="card">
          <div style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, marginBottom: 12 }}>Recent Consumption Log</div>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Flock / Section</th><th>Feed Type</th><th>Qty (kg)</th><th>g/Bird</th><th>Recorded By</th></tr>
            </thead>
            <tbody>
              {data.recentConsumption.map(c => (
                <tr key={c.id}>
                  <td>{fmtDate(c.recordedDate)}</td>
                  <td>{c.flock?.name || '—'} {c.penSection ? `/ ${c.penSection.name}` : ''}</td>
                  <td>{c.feedInventory?.feedType || '—'}</td>
                  <td>{fmt(c.quantityKg, 2)}</td>
                  <td>{fmt(c.gramsPerBird, 1)}</td>
                  <td>{c.recordedBy?.name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Restock modal */}
      {restockItem && (
        <Modal title={`Restock — ${restockItem.feedType}`} onClose={() => setRestockItem(null)}>
          <Alert type={alert?.type} message={alert?.msg} onClose={() => setAlert(null)} />
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
              Current stock: <strong>{fmt(restockItem.currentStockKg, 1)} kg</strong>
            </div>
            <label className="label">Quantity to Add (kg)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.1"
              value={restockQty}
              onChange={e => setRestockQty(e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={() => setRestockItem(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleRestock} disabled={loading}>
              {loading ? 'Saving…' : 'Confirm Restock'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── LOG CONSUMPTION TAB ───────────────────────────────────────────────────

function ConsumptionTab({ data, onRefresh }) {
  const [form, setForm] = useState({
    flockId: '', penSectionId: '', feedInventoryId: '',
    quantityKg: '', recordedDate: new Date().toISOString().slice(0,10), notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  const flocks   = data?.flocks || [];
  const sections = data?.sections || [];
  const inventory = data?.inventory || [];

  const selectedInventory = inventory.find(i => i.id === form.feedInventoryId);
  const selectedFlock     = flocks.find(f => f.id === form.flockId);
  const gramsPerBird      = (form.quantityKg && selectedFlock?.birdCount)
    ? ((Number(form.quantityKg) * 1000) / selectedFlock.birdCount).toFixed(1)
    : null;

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.flockId || !form.feedInventoryId || !form.quantityKg || !form.recordedDate) {
      setAlert({ type: 'red', msg: 'Please fill in all required fields.' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/feed?action=consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flockId: form.flockId,
          penSectionId: form.penSectionId || undefined,
          feedInventoryId: form.feedInventoryId,
          quantityKg: Number(form.quantityKg),
          recordedDate: form.recordedDate,
          notes: form.notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to log consumption');
      setAlert({ type: 'green', msg: 'Consumption logged successfully.' });
      setForm({ flockId: '', penSectionId: '', feedInventoryId: '', quantityKg: '', recordedDate: new Date().toISOString().slice(0,10), notes: '' });
      onRefresh();
    } catch (e) {
      setAlert({ type: 'red', msg: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <Alert type={alert?.type} message={alert?.msg} onClose={() => setAlert(null)} />
      <div className="card">
        <div className="section-header" style={{ marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, fontSize: 16, margin: 0 }}>Log Feed Consumption</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label className="label">Flock *</label>
            <select className="input" value={form.flockId} onChange={e => set('flockId', e.target.value)}>
              <option value="">Select flock…</option>
              {flocks.map(f => <option key={f.id} value={f.id}>{f.name} ({f.birdCount} birds)</option>)}
            </select>
          </div>

          <div>
            <label className="label">Section (optional)</label>
            <select className="input" value={form.penSectionId} onChange={e => set('penSectionId', e.target.value)}>
              <option value="">— None —</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Feed Type *</label>
            <select className="input" value={form.feedInventoryId} onChange={e => set('feedInventoryId', e.target.value)}>
              <option value="">Select feed…</option>
              {inventory.map(i => (
                <option key={i.id} value={i.id}>{i.feedType} ({fmt(i.currentStockKg,0)} kg avail.)</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Date *</label>
            <input className="input" type="date" value={form.recordedDate} onChange={e => set('recordedDate', e.target.value)} />
          </div>

          <div>
            <label className="label">Quantity (kg) *</label>
            <input className="input" type="number" min="0" step="0.1" value={form.quantityKg} onChange={e => set('quantityKg', e.target.value)} placeholder="e.g. 25.5" />
          </div>

          <div>
            <label className="label">Auto-calculated g/Bird</label>
            <div className="input" style={{ background: 'var(--bg-elevated)', color: gramsPerBird ? 'var(--purple)' : 'var(--text-muted)', fontWeight: 700 }}>
              {gramsPerBird ? `${gramsPerBird} g/bird` : 'Select flock + qty'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="label">Notes (optional)</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any observations…" style={{ resize: 'vertical' }} />
        </div>

        {selectedInventory && form.quantityKg && Number(form.quantityKg) > selectedInventory.currentStockKg && (
          <Alert type="red" message={`⚠ Quantity exceeds available stock (${fmt(selectedInventory.currentStockKg, 1)} kg)`} />
        )}

        <div style={{ marginTop: 20 }}>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Logging…' : '✓ Log Consumption'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RECEIPTS (GRN) TAB ────────────────────────────────────────────────────

function ReceiptsTab({ data, userRole, onRefresh }) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ storeId: 'store-feed', feedInventoryId: '', supplierId: '', quantityReceived: '', unitCost: '', deliveryDate: new Date().toISOString().slice(0,10), invoiceNumber: '', qualityStatus: 'PENDING', notes: '' });
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  const canManage = ROLE_FULL.includes(userRole);
  const receipts  = data?.receipts || [];
  const inventory = data?.inventory || [];
  const suppliers = data?.suppliers || [];

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.feedInventoryId || !form.supplierId || !form.quantityReceived || !form.unitCost) {
      setAlert({ type: 'red', msg: 'Fill in all required fields.' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/feed?action=grn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: form.storeId,
          feedInventoryId: form.feedInventoryId,
          supplierId: form.supplierId,
          quantityReceived: Number(form.quantityReceived),
          unitCost: Number(form.unitCost),
          deliveryDate: form.deliveryDate,
          invoiceNumber: form.invoiceNumber || undefined,
          qualityStatus: form.qualityStatus,
          notes: form.notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'GRN failed');
      setShowModal(false);
      setAlert({ type: 'green', msg: 'GRN recorded. Stock updated.' });
      onRefresh();
    } catch (e) {
      setAlert({ type: 'red', msg: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, fontSize: 18, margin: 0 }}>Goods Received Notes (GRN)</h3>
        {canManage && <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Record Delivery</button>}
      </div>

      <Alert type={alert?.type} message={alert?.msg} onClose={() => setAlert(null)} />

      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead>
            <tr><th>GRN #</th><th>Date</th><th>Feed Type</th><th>Supplier</th><th>Qty (kg)</th><th>Unit Cost</th><th>Total Value</th><th>QC Status</th><th>Invoice</th></tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No receipts yet</td></tr>
            ) : receipts.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 700, color: 'var(--purple)' }}>{r.grnNumber || r.id.slice(0,8)}</td>
                <td>{fmtDate(r.deliveryDate || r.createdAt)}</td>
                <td>{r.feedInventory?.feedType || '—'}</td>
                <td>{r.supplier?.name || '—'}</td>
                <td>{fmt(r.quantityReceived, 1)}</td>
                <td>{fmtCurrency(r.unitCost)}</td>
                <td>{fmtCurrency(r.quantityReceived * r.unitCost)}</td>
                <td><span className={QC_COLORS[r.qualityStatus] || 'status-badge'}>{r.qualityStatus}</span></td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.invoiceNumber || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal title="Record Delivery (GRN)" onClose={() => setShowModal(false)}>
          <Alert type={alert?.type} message={alert?.msg} onClose={() => setAlert(null)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Feed Type *</label>
              <select className="input" value={form.feedInventoryId} onChange={e => set('feedInventoryId', e.target.value)}>
                <option value="">Select…</option>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.feedType}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Supplier *</label>
              <select className="input" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                <option value="">Select…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Quantity Received (kg) *</label>
              <input className="input" type="number" min="0" step="0.1" value={form.quantityReceived} onChange={e => set('quantityReceived', e.target.value)} />
            </div>
            <div>
              <label className="label">Unit Cost (₦/kg) *</label>
              <input className="input" type="number" min="0" step="0.01" value={form.unitCost} onChange={e => set('unitCost', e.target.value)} />
            </div>
            <div>
              <label className="label">Delivery Date</label>
              <input className="input" type="date" value={form.deliveryDate} onChange={e => set('deliveryDate', e.target.value)} />
            </div>
            <div>
              <label className="label">QC Status</label>
              <select className="input" value={form.qualityStatus} onChange={e => set('qualityStatus', e.target.value)}>
                <option value="PENDING">Pending</option>
                <option value="PASSED">Passed</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
            <div>
              <label className="label">Invoice Number</label>
              <input className="input" type="text" value={form.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} placeholder="INV-001" />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} />
          </div>
          {form.quantityReceived && form.unitCost && (
            <div style={{ margin: '12px 0', padding: '10px 14px', background: 'var(--purple-light)', borderRadius: 8, fontSize: 14 }}>
              Total Value: <strong>{fmtCurrency(Number(form.quantityReceived) * Number(form.unitCost))}</strong>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>{loading ? 'Saving…' : 'Record GRN'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── PURCHASE ORDERS TAB ───────────────────────────────────────────────────

function PurchaseOrdersTab({ data, userRole, onRefresh }) {
  const [showCreate, setShowCreate] = useState(false);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ supplierId: '', expectedDelivery: '', notes: '', lineItems: [{ feedInventoryId: '', quantityKg: '', unitPrice: '', notes: '' }] });

  const canManage  = ROLE_FULL.includes(userRole);
  const orders     = data?.orders || [];
  const suppliers  = data?.suppliers || [];
  const inventory  = data?.inventory || [];

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setLine = (i, k, v) => setForm(p => {
    const items = [...p.lineItems];
    items[i] = { ...items[i], [k]: v };
    return { ...p, lineItems: items };
  });
  const addLine = () => setForm(p => ({ ...p, lineItems: [...p.lineItems, { feedInventoryId: '', quantityKg: '', unitPrice: '', notes: '' }] }));
  const removeLine = (i) => setForm(p => ({ ...p, lineItems: p.lineItems.filter((_, idx) => idx !== i) }));

  const totalAmount = form.lineItems.reduce((sum, l) => sum + (Number(l.quantityKg) * Number(l.unitPrice) || 0), 0);

  const handleCreate = async () => {
    if (!form.supplierId || form.lineItems.some(l => !l.feedInventoryId || !l.quantityKg || !l.unitPrice)) {
      setAlert({ type: 'red', msg: 'Fill in all required fields including all line items.' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/feed?action=purchase-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: form.supplierId,
          expectedDelivery: form.expectedDelivery || undefined,
          notes: form.notes || undefined,
          lineItems: form.lineItems.map(l => ({
            feedInventoryId: l.feedInventoryId,
            quantityKg: Number(l.quantityKg),
            unitPrice: Number(l.unitPrice),
            notes: l.notes || undefined,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create PO');
      setShowCreate(false);
      setAlert({ type: 'green', msg: `PO ${json.poNumber || ''} created.` });
      onRefresh();
    } catch (e) {
      setAlert({ type: 'red', msg: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (po, status) => {
    try {
      const res = await fetch('/api/feed?action=update-po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poId: po.id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      setAlert({ type: 'green', msg: `PO status updated to ${status}.` });
      onRefresh();
    } catch (e) {
      setAlert({ type: 'red', msg: e.message });
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, fontSize: 18, margin: 0 }}>Purchase Orders</h3>
        {canManage && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create PO</button>}
      </div>

      <Alert type={alert?.type} message={alert?.msg} onClose={() => setAlert(null)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {orders.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 48 }}>No purchase orders yet</div>
        ) : orders.map(po => (
          <div key={po.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 800, fontSize: 16 }}>{po.poNumber}</span>
                  <span className={PO_STATUS_COLORS[po.status] || 'status-badge'}>{po.status}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {po.supplier?.name} · Created {fmtDate(po.createdAt)}
                  {po.expectedDelivery && ` · Expected ${fmtDate(po.expectedDelivery)}`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 800, fontSize: 20, color: 'var(--purple)' }}>{fmtCurrency(po.totalAmount)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{po.lineItems?.length || 0} line item(s)</div>
              </div>
            </div>

            {po.lineItems?.length > 0 && (
              <table className="table" style={{ marginTop: 12, fontSize: 13 }}>
                <thead>
                  <tr><th>Feed Type</th><th>Qty (kg)</th><th>Unit Price</th><th>Total</th></tr>
                </thead>
                <tbody>
                  {po.lineItems.map((li, i) => (
                    <tr key={i}>
                      <td>{li.feedInventory?.feedType || li.feedType || '—'}</td>
                      <td>{fmt(li.quantityKg, 1)}</td>
                      <td>{fmtCurrency(li.unitPrice)}</td>
                      <td>{fmtCurrency(li.quantityKg * li.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canManage && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {po.status === 'DRAFT' && (
                  <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => handleUpdateStatus(po, 'SUBMITTED')}>Submit PO</button>
                )}
                {po.status === 'SUBMITTED' && (
                  <>
                    <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => handleUpdateStatus(po, 'APPROVED')}>Approve</button>
                    <button className="btn btn-outline" style={{ fontSize: 13, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => handleUpdateStatus(po, 'REJECTED')}>Reject</button>
                  </>
                )}
                {po.status === 'APPROVED' && (
                  <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => handleUpdateStatus(po, 'FULFILLED')}>Mark Fulfilled</button>
                )}
                {['DRAFT','SUBMITTED'].includes(po.status) && (
                  <button className="btn btn-ghost" style={{ fontSize: 13, color: 'var(--text-muted)' }} onClick={() => handleUpdateStatus(po, 'CANCELLED')}>Cancel</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showCreate && (
        <Modal title="Create Purchase Order" onClose={() => setShowCreate(false)} wide>
          <Alert type={alert?.type} message={alert?.msg} onClose={() => setAlert(null)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label className="label">Supplier *</label>
              <select className="input" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                <option value="">Select supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Expected Delivery</label>
              <input className="input" type="date" value={form.expectedDelivery} onChange={e => set('expectedDelivery', e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="label" style={{ margin: 0 }}>Line Items *</label>
              <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={addLine}>+ Add Item</button>
            </div>
            {form.lineItems.map((li, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                <div>
                  {i === 0 && <label className="label">Feed Type</label>}
                  <select className="input" value={li.feedInventoryId} onChange={e => setLine(i, 'feedInventoryId', e.target.value)}>
                    <option value="">Select…</option>
                    {inventory.map(inv => <option key={inv.id} value={inv.id}>{inv.feedType}</option>)}
                  </select>
                </div>
                <div>
                  {i === 0 && <label className="label">Qty (kg)</label>}
                  <input className="input" type="number" min="0" step="0.1" value={li.quantityKg} onChange={e => setLine(i, 'quantityKg', e.target.value)} placeholder="500" />
                </div>
                <div>
                  {i === 0 && <label className="label">Unit Price</label>}
                  <input className="input" type="number" min="0" step="0.01" value={li.unitPrice} onChange={e => setLine(i, 'unitPrice', e.target.value)} placeholder="350" />
                </div>
                <button className="btn btn-ghost" style={{ color: 'var(--red)', padding: '8px 10px' }} onClick={() => removeLine(i)} disabled={form.lineItems.length === 1}>✕</button>
              </div>
            ))}
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} />
          </div>

          <div style={{ margin: '12px 0', padding: '10px 14px', background: 'var(--purple-light)', borderRadius: 8, fontFamily: 'Poppins,sans-serif', fontWeight: 700 }}>
            Total: {fmtCurrency(totalAmount)}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>{loading ? 'Creating…' : 'Create PO'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SUPPLIERS TAB ─────────────────────────────────────────────────────────

function SuppliersTab({ data, userRole }) {
  const suppliers = data?.suppliers || [];

  const STAR = (n) => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, fontSize: 18, margin: 0 }}>Suppliers</h3>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {suppliers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 48 }}>No suppliers found</div>
        ) : suppliers.map(s => (
          <div key={s.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 700, fontSize: 16 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.supplierType}</div>
              </div>
              <span className="status-badge status-green">Active</span>
            </div>

            {s.rating && (
              <div style={{ color: '#f59e0b', letterSpacing: 2, marginBottom: 10, fontSize: 14 }}>{STAR(s.rating)}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              {s.contactName && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', width: 80 }}>Contact</span>
                  <span style={{ fontWeight: 600 }}>{s.contactName}</span>
                </div>
              )}
              {s.phone && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', width: 80 }}>Phone</span>
                  <a href={`tel:${s.phone}`} style={{ color: 'var(--purple)', fontWeight: 600, textDecoration: 'none' }}>{s.phone}</a>
                </div>
              )}
              {s.email && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--text-muted)', width: 80 }}>Email</span>
                  <a href={`mailto:${s.email}`} style={{ color: 'var(--purple)', fontWeight: 600, textDecoration: 'none' }}>{s.email}</a>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', width: 80 }}>Total POs</span>
                <span style={{ fontWeight: 700, color: 'var(--purple)' }}>{s._count?.purchaseOrders ?? s.poCount ?? 0}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────

export default function FeedPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('inventory');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userRole, setUserRole] = useState(null);

  const TABS = [
    { id: 'inventory',    label: 'Inventory',       icon: '📦' },
    { id: 'consumption',  label: 'Log Consumption',  icon: '🌾' },
    { id: 'receipts',     label: 'Receipts (GRN)',   icon: '📋' },
    { id: 'orders',       label: 'Purchase Orders',  icon: '🛒' },
    { id: 'suppliers',    label: 'Suppliers',         icon: '🏭' },
  ];

  // Role-filter tabs
  const visibleTabs = TABS.filter(t => {
    if (t.id === 'consumption') return true; // all roles
    if (t.id === 'inventory')   return ROLE_MID.includes(userRole) || userRole === 'PEN_WORKER';
    return ROLE_FULL.includes(userRole);
  });

  const fetchTab = useCallback(async (tab) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feed?tab=${tab}`);
      if (res.status === 401) { router.push('/login'); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load data');
      setData(prev => ({ ...prev, [tab]: json }));
      if (json.userRole) setUserRole(json.userRole);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { fetchTab(activeTab); }, [activeTab, fetchTab]);

  const tabData = data[activeTab] || {};

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Poppins,sans-serif', fontWeight: 800, fontSize: 26, margin: 0, color: 'var(--text-primary)' }}>
          🌾 Feed Management
        </h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 4, fontFamily: 'Nunito,sans-serif' }}>
          Track inventory, log consumption, manage deliveries and purchase orders
        </p>
      </div>

      <TabBar tabs={visibleTabs} active={activeTab} onChange={setActiveTab} />

      {loading && (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div>Loading…</div>
        </div>
      )}

      {error && !loading && (
        <div className="alert alert-red">{error}</div>
      )}

      {!loading && !error && (
        <>
          {activeTab === 'inventory'   && <InventoryTab      data={tabData} userRole={userRole} onRefresh={() => fetchTab('inventory')} />}
          {activeTab === 'consumption' && <ConsumptionTab    data={tabData} onRefresh={() => fetchTab('consumption')} />}
          {activeTab === 'receipts'    && <ReceiptsTab       data={tabData} userRole={userRole} onRefresh={() => fetchTab('receipts')} />}
          {activeTab === 'orders'      && <PurchaseOrdersTab data={tabData} userRole={userRole} onRefresh={() => fetchTab('orders')} />}
          {activeTab === 'suppliers'   && <SuppliersTab      data={tabData} userRole={userRole} />}
        </>
      )}
    </div>
  );
}
