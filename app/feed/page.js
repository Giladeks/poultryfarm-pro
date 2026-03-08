'use client';
// app/feed/page.js — v4c  (Batch 5 bug-fix drop-in)
// Changes from v4b:
//   • ReceiptsTab no longer owns the GRN form inline.
//     It delegates entirely to <FeedReceiptModal>, the full-featured component
//     in components/feed/FeedReceiptModal.js that already uses:
//       - storeId    → resolved from the inventory item (real UUID, not 'store-feed')
//       - receiptDate (was deliveryDate in the broken inline form)
//       - referenceNumber (was invoiceNumber in the broken inline form)
//       - POSTs to /api/feed/receipts (not the wrong /api/feed?action=grn endpoint)
//   • Everything else (InventoryTab, ConsumptionTab, MillTab, SupplierTab,
//     all chart logic, AppShell wiring) is UNCHANGED from v4b.
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import Modal from '@/components/ui/Modal';
import FeedReceiptModal from '@/components/feed/FeedReceiptModal';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from 'recharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n, d = 0) => Number(n ?? 0).toLocaleString('en-NG', { maximumFractionDigits: d });
const fmtCur = (n) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n ?? 0));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const stockColor = (pct) => pct <= 20 ? '#ef4444' : pct <= 40 ? '#f59e0b' : '#22c55e';

const TABS = [
  { key: 'inventory',    label: '📦 Inventory'    },
  { key: 'receipts',     label: '📋 Receipts'     },
  { key: 'consumption',  label: '🌾 Consumption'  },
  { key: 'mill',         label: '🏭 Feed Mill'    },
  { key: 'suppliers',    label: '🚛 Suppliers'    },
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon, value, label, sub, color = 'var(--purple)', warn = false }) {
  return (
    <div className="card" style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, borderLeft: `4px solid ${warn ? '#ef4444' : color}` }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: `${warn ? '#ef4444' : color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 24, fontWeight: 700, color: warn ? '#ef4444' : color, lineHeight: 1 }}>{value ?? '—'}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 4 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────
function TabBar({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
      {TABS.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          background: 'transparent', border: 'none',
          borderBottom: active === t.key ? '3px solid var(--purple)' : '3px solid transparent',
          marginBottom: -2, padding: '10px 18px', fontSize: 13,
          fontWeight: active === t.key ? 700 : 600,
          color: active === t.key ? 'var(--purple)' : 'var(--text-muted)',
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ h = 60, w = '100%' }) {
  return <div style={{ height: h, width: w, background: 'var(--bg-elevated)', borderRadius: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />;
}

// ─── Flock split chart (in a portal modal) ────────────────────────────────────
function FlockSplitModal({ item, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  if (!mounted) return null;

  const splits = item.flockSplits || [];
  const COLORS = ['#6c63ff', '#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#8b5cf6'];

  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.2)', width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 16 }}>🌾 Flock Split — {item.feedType}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDate(item.consumptionDate || item.date)} · {fmt(item.totalQuantityKg, 1)} kg total</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px' }}>
          {splits.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)', fontSize: 13 }}>No flock breakdown available</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={splits} dataKey="quantityKg" nameKey="flockBatchCode" cx="50%" cy="50%" outerRadius={75} label={({ flockBatchCode, pct }) => `${flockBatchCode} ${pct}%`}>
                    {splits.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${fmt(v, 1)} kg`} />
                </PieChart>
              </ResponsiveContainer>
              <table className="table" style={{ marginTop: 16 }}>
                <thead><tr><th>Flock</th><th>Feed Type</th><th style={{ textAlign: 'right' }}>Qty (kg)</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
                <tbody>
                  {splits.map((s, i) => (
                    <tr key={i}>
                      <td><span style={{ color: COLORS[i % COLORS.length], fontWeight: 700 }}>{s.flockBatchCode}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{s.feedType || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(s.quantityKg, 1)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{s.pct ?? '—'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Inventory Tab ────────────────────────────────────────────────────────────
function InventoryTab({ apiFetch }) {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ reorderLevel: '', costPerKg: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/feed/inventory');
      if (res.ok) { const d = await res.json(); setInventory(d.inventory || []); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (item) => {
    setEditItem(item);
    setForm({ reorderLevel: item.reorderLevelKg ?? '', costPerKg: item.costPerKg ?? '' });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/feed/inventory/${editItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          reorderLevelKg: parseFloat(form.reorderLevel),
          costPerKg: parseFloat(form.costPerKg),
        }),
      });
      if (res.ok) { setEditItem(null); load(); }
    } finally { setSaving(false); }
  };

  const barData = inventory.map(i => ({
    name: i.feedType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    stock: Number(i.currentStockKg),
    reorder: Number(i.reorderLevelKg),
  }));

  return (
    <div>
      {/* Chart */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 12 }}>Stock Levels vs Reorder Points</div>
        {loading ? <Skeleton h={180} /> : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="kg" width={55} />
              <Tooltip formatter={(v) => `${fmt(v, 1)} kg`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="stock" name="Current Stock" radius={[4, 4, 0, 0]}>
                {barData.map((d, i) => {
                  const pct = d.reorder > 0 ? (d.stock / d.reorder) * 100 : 100;
                  return <Cell key={i} fill={stockColor(pct > 100 ? 100 : pct)} />;
                })}
              </Bar>
              <Bar dataKey="reorder" name="Reorder Level" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Feed Type</th>
              <th>Store</th>
              <th style={{ textAlign: 'right' }}>Current Stock</th>
              <th style={{ textAlign: 'right' }}>Reorder Level</th>
              <th style={{ textAlign: 'right' }}>Cost/kg</th>
              <th style={{ textAlign: 'right' }}>Stock %</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3].map(i => (
                <tr key={i}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><Skeleton h={14} /></td>)}
                </tr>
              ))
            ) : inventory.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No inventory items</td></tr>
            ) : inventory.map(item => {
              const pct = item.reorderLevelKg > 0
                ? Math.min(100, Math.round((item.currentStockKg / item.reorderLevelKg) * 100))
                : 100;
              const low = item.currentStockKg <= item.reorderLevelKg;
              return (
                <tr key={item.id}>
                  <td style={{ fontWeight: 700 }}>{item.feedType.replace(/_/g, ' ')}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{item.store?.name || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: low ? '#ef4444' : 'var(--text-primary)' }}>{fmt(item.currentStockKg, 1)} kg</td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(item.reorderLevelKg, 1)} kg</td>
                  <td style={{ textAlign: 'right' }}>₦{fmt(item.costPerKg, 2)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ width: 60, height: 6, background: 'var(--border)', borderRadius: 3 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: stockColor(pct), borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, color: stockColor(pct), fontWeight: 700, minWidth: 32 }}>{pct}%</span>
                    </div>
                  </td>
                  <td>
                    {low
                      ? <span className="status-badge status-red">Low Stock</span>
                      : <span className="status-badge status-green">OK</span>}
                  </td>
                  <td>
                    <button onClick={() => openEdit(item)} className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editItem && (
        <Modal
          title={`✏️ Edit — ${editItem.feedType.replace(/_/g, ' ')}`}
          width={360}
          onClose={() => setEditItem(null)}
          footer={
            <>
              <button onClick={() => setEditItem(null)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="label">Reorder Level (kg)</label>
              <input type="number" className="input" value={form.reorderLevel} onChange={e => setForm(p => ({ ...p, reorderLevel: e.target.value }))} />
            </div>
            <div>
              <label className="label">Cost per kg (₦)</label>
              <input type="number" className="input" value={form.costPerKg} onChange={e => setForm(p => ({ ...p, costPerKg: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Receipts Tab ─────────────────────────────────────────────────────────────
// BUG FIX (Batch 5): The previous inline GRN form had three bugs:
//   1. storeId hardcoded to 'store-feed' (fake string, fails UUID validation)
//   2. POST went to /api/feed?action=grn (action doesn't exist; endpoint is /api/feed/receipts)
//   3. Form used deliveryDate / invoiceNumber; API expects receiptDate / referenceNumber
//
// Fix: We now delegate entirely to <FeedReceiptModal>, the fully-correct component
// in components/feed/FeedReceiptModal.js, which resolves storeId from the inventory
// item, uses the correct field names, and posts to /api/feed/receipts.
function ReceiptsTab({ apiFetch }) {
  const [receipts, setReceipts]     = useState([]);
  const [summary,  setSummary]      = useState(null);
  const [loading,  setLoading]      = useState(true);
  const [showModal, setShowModal]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/feed/receipts?limit=50');
      if (res.ok) {
        const d = await res.json();
        setReceipts(d.receipts || []);
        setSummary(d.summary   || null);
      }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { label: 'Total Deliveries', value: summary ? fmt(summary.totalReceipts) : '—', color: 'var(--purple)' },
            { label: 'Total kg Received', value: summary ? `${fmt(summary.totalKgReceived, 1)} kg` : '—', color: '#22c55e' },
            { label: 'Total Cost',        value: summary ? fmtCur(summary.totalCost) : '—',               color: '#f59e0b' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', minWidth: 140 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 18, fontWeight: 700, color: s.color, marginTop: 3 }}>{s.value}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ flexShrink: 0 }}>
          + Record Delivery
        </button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Feed Type</th>
              <th>Store</th>
              <th>Supplier</th>
              <th style={{ textAlign: 'right' }}>Qty (kg)</th>
              <th style={{ textAlign: 'right' }}>Cost/kg</th>
              <th style={{ textAlign: 'right' }}>Total Cost</th>
              <th>Ref #</th>
              <th>Received By</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3, 4].map(i => (
                <tr key={i}>{[1,2,3,4,5,6,7,8,9].map(j => <td key={j}><Skeleton h={13} /></td>)}</tr>
              ))
            ) : receipts.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No delivery receipts yet — click <strong>Record Delivery</strong> to add one</td></tr>
            ) : receipts.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.receiptDate)}</td>
                <td style={{ fontWeight: 600 }}>{r.feedInventory?.feedType?.replace(/_/g, ' ') || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{r.store?.name || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{r.supplier?.name || <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.quantityReceived, 1)}</td>
                <td style={{ textAlign: 'right' }}>₦{fmt(r.unitCost, 2)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--purple)' }}>{fmtCur(r.totalCost)}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.referenceNumber || '—'}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {r.receivedBy ? `${r.receivedBy.firstName} ${r.receivedBy.lastName}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* GRN Modal — delegated to the correct, fully-featured FeedReceiptModal component */}
      {showModal && (
        <FeedReceiptModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Consumption Tab ──────────────────────────────────────────────────────────
function ConsumptionTab({ apiFetch }) {
  const [records, setRecords]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [splitModal, setSplitModal] = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [opTab, setOpTab]           = useState('ALL'); // 'ALL' | 'LAYER' | 'BROILER'
  const [inventory, setInventory]   = useState([]);
  const [flocks, setFlocks]         = useState([]);
  const [form, setForm]             = useState({ feedInventoryId: '', flockId: '', quantityKg: '', consumptionDate: new Date().toISOString().split('T')[0], notes: '' });
  const [saving, setSaving]         = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, iRes, fRes] = await Promise.all([
        apiFetch('/api/feed/consumption?limit=50'),
        apiFetch('/api/feed/inventory'),
        apiFetch('/api/flocks?status=ACTIVE'),
      ]);
      if (cRes.ok) { const d = await cRes.json(); setRecords(d.consumption || []); }
      if (iRes.ok) { const d = await iRes.json(); setInventory(d.inventory || []); }
      if (fRes.ok) { const d = await fRes.json(); setFlocks(d.flocks || []); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/feed/consumption', {
        method: 'POST',
        body: JSON.stringify({
          feedInventoryId: form.feedInventoryId,
          flockId: form.flockId || null,
          quantityKg: parseFloat(form.quantityKg),
          consumptionDate: form.consumptionDate,
          notes: form.notes || null,
        }),
      });
      if (res.ok) { setShowAdd(false); setForm({ feedInventoryId: '', flockId: '', quantityKg: '', consumptionDate: new Date().toISOString().split('T')[0], notes: '' }); load(); }
    } finally { setSaving(false); }
  };

  const hasLayers   = records.some(r => (r.flock?.operationType || r.flock?.birdType) === 'LAYER');
  const hasBroilers = records.some(r => (r.flock?.operationType || r.flock?.birdType) === 'BROILER');
  const hasBoth     = hasLayers && hasBroilers;
  const visibleRecs = opTab === 'ALL'
    ? records
    : records.filter(r => (r.flock?.operationType || r.flock?.birdType) === opTab);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        {/* Op type pill switcher */}
        {hasBoth ? (
          <div style={{ display:'flex', gap:5, background:'var(--bg-elevated)', borderRadius:12, padding:3, border:'1px solid var(--border)' }}>
            {[
              { key:'ALL',     icon:'📋', label:'All',      color:'var(--purple)' },
              { key:'LAYER',   icon:'🥚', label:'Layers',   color:'#f59e0b' },
              { key:'BROILER', icon:'🍗', label:'Broilers', color:'#3b82f6' },
            ].map(t => {
              const isActive = opTab === t.key;
              return (
                <button key={t.key} onClick={() => setOpTab(t.key)}
                  style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'none',
                    background: isActive ? '#fff' : 'transparent',
                    boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    cursor:'pointer', fontFamily:'inherit', fontWeight: isActive ? 700 : 500,
                    fontSize:12, color: isActive ? t.color : 'var(--text-muted)', transition:'all 0.15s' }}>
                  <span>{t.icon}</span>{t.label}
                </button>
              );
            })}
          </div>
        ) : <div />}
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Log Consumption</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Feed Type</th>
              <th>Flock</th>
              <th style={{ textAlign: 'right' }}>Qty (kg)</th>
              <th>Recorded By</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3].map(i => <tr key={i}>{[1,2,3,4,5,6,7].map(j => <td key={j}><Skeleton h={13} /></td>)}</tr>)
            ) : visibleRecs.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No consumption records yet</td></tr>
            ) : visibleRecs.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.consumptionDate)}</td>
                <td style={{ fontWeight: 600 }}>{r.feedInventory?.feedType?.replace(/_/g, ' ') || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{r.flock?.batchCode || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.quantityKg, 1)}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {r.recordedBy ? `${r.recordedBy.firstName} ${r.recordedBy.lastName}` : '—'}
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.notes || '—'}</td>
                <td>
                  {(r.flockSplits?.length > 0) && (
                    <button onClick={() => setSplitModal(r)} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>Splits</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {splitModal && <FlockSplitModal item={splitModal} onClose={() => setSplitModal(null)} />}

      {showAdd && (
        <Modal
          title="🌾 Log Feed Consumption"
          width={420}
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <button onClick={() => setShowAdd(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleAdd} disabled={saving || !form.feedInventoryId || !form.quantityKg} className="btn btn-primary">{saving ? 'Saving…' : 'Log Consumption'}</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="label">Feed Type *</label>
              <select className="input" value={form.feedInventoryId} onChange={e => setForm(p => ({ ...p, feedInventoryId: e.target.value }))}>
                <option value="">Select feed…</option>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.feedType.replace(/_/g, ' ')} — {fmt(i.currentStockKg, 1)} kg available</option>)}
              </select>
            </div>
            <div>
              <label className="label">Flock (optional)</label>
              <select className="input" value={form.flockId} onChange={e => setForm(p => ({ ...p, flockId: e.target.value }))}>
                <option value="">— General / no specific flock —</option>
                {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} ({f.birdType})</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="label">Quantity (kg) *</label>
                <input type="number" className="input" min="0.1" step="0.1" value={form.quantityKg} onChange={e => setForm(p => ({ ...p, quantityKg: e.target.value }))} placeholder="0.0" />
              </div>
              <div>
                <label className="label">Date *</label>
                <input type="date" className="input" value={form.consumptionDate} max={new Date().toISOString().split('T')[0]} onChange={e => setForm(p => ({ ...p, consumptionDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Mill Tab ─────────────────────────────────────────────────────────────────
function MillTab({ apiFetch }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/feed/mill');
      if (res.ok) { const d = await res.json(); setBatches(d.batches || []); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const STATUS_CLASS = {
    MIXING: 'status-blue', MILLING: 'status-blue', QC_PENDING: 'status-amber',
    QC_PASSED: 'status-green', QC_FAILED: 'status-red', COMPLETED: 'status-green', CANCELLED: 'status-grey',
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Batch Code</th>
            <th>Date</th>
            <th style={{ textAlign: 'right' }}>Target (kg)</th>
            <th style={{ textAlign: 'right' }}>Actual (kg)</th>
            <th style={{ textAlign: 'right' }}>Cost/kg</th>
            <th>QC Status</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [1, 2, 3].map(i => <tr key={i}>{[1,2,3,4,5,6,7,8].map(j => <td key={j}><Skeleton h={13} /></td>)}</tr>)
          ) : batches.length === 0 ? (
            <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No feed mill batches</td></tr>
          ) : batches.map(b => (
            <tr key={b.id}>
              <td style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{b.batchCode}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.productionDate)}</td>
              <td style={{ textAlign: 'right' }}>{fmt(b.targetQuantityKg, 1)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{b.actualQuantityKg ? fmt(b.actualQuantityKg, 1) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{b.costPerKg ? `₦${fmt(b.costPerKg, 2)}` : '—'}</td>
              <td><span className={`status-badge ${b.qcStatus === 'PASSED' ? 'status-green' : b.qcStatus === 'FAILED' ? 'status-red' : 'status-amber'}`}>{b.qcStatus || 'PENDING'}</span></td>
              <td><span className={`status-badge ${STATUS_CLASS[b.status] || 'status-grey'}`}>{b.status}</span></td>
              <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{b.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Suppliers Tab ────────────────────────────────────────────────────────────
function SuppliersTab({ apiFetch }) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showAdd,   setShowAdd]   = useState(false);
  const [editItem,  setEditItem]  = useState(null);
  const [delItem,   setDelItem]   = useState(null);
  const [form,      setForm]      = useState({ name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' });
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/suppliers');
      if (res.ok) { const d = await res.json(); setSuppliers(d.suppliers || []); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setForm({ name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' }); setShowAdd(true); };
  const openEdit = (s) => { setEditItem(s); setForm({ name: s.name, contactPerson: s.contactPerson || '', phone: s.phone || '', email: s.email || '', address: s.address || '', notes: s.notes || '' }); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const url = editItem ? `/api/suppliers/${editItem.id}` : '/api/suppliers';
      const res = await apiFetch(url, { method: editItem ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      if (res.ok) { setShowAdd(false); setEditItem(null); load(); }
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/suppliers/${delItem.id}`, { method: 'DELETE' });
      if (res.ok) { setDelItem(null); load(); }
    } finally { setSaving(false); }
  };

  const SupplierForm = ({ onClose }) => (
    <Modal
      title={editItem ? `✏️ Edit Supplier` : '+ New Supplier'}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.name} className="btn btn-primary">{saving ? 'Saving…' : editItem ? 'Save Changes' : 'Add Supplier'}</button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Company Name *</label>
          <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. FeedCo Nigeria Ltd" />
        </div>
        <div>
          <label className="label">Contact Person</label>
          <input className="input" value={form.contactPerson} onChange={e => setForm(p => ({ ...p, contactPerson: e.target.value }))} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Email</label>
          <input type="email" className="input" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Address</label>
          <input className="input" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Notes</label>
          <input className="input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
      </div>
    </Modal>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={openAdd} className="btn btn-primary">+ Add Supplier</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr><th>Supplier</th><th>Contact Person</th><th>Phone</th><th>Email</th><th>Notes</th><th /></tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3].map(i => <tr key={i}>{[1,2,3,4,5,6].map(j => <td key={j}><Skeleton h={13} /></td>)}</tr>)
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No suppliers yet — add one to link to receipts</td></tr>
            ) : suppliers.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 700 }}>{s.name}</td>
                <td style={{ color: 'var(--text-muted)' }}>{s.contactPerson || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{s.phone || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{s.email || '—'}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>{s.notes || '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openEdit(s)} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>Edit</button>
                    <button onClick={() => setDelItem(s)} className="btn btn-danger" style={{ fontSize: 11, padding: '3px 8px' }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showAdd || editItem) && <SupplierForm onClose={() => { setShowAdd(false); setEditItem(null); }} />}

      {delItem && (
        <Modal
          width={380}
          onClose={() => setDelItem(null)}
          footer={
            <>
              <button onClick={() => setDelItem(null)} className="btn btn-ghost" style={{ flex: 1 }}>Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="btn btn-danger" style={{ flex: 1 }}>{saving ? 'Deleting…' : 'Delete'}</button>
            </>
          }
        >
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <h3 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete {delItem.name}?</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>This action cannot be undone. Historical receipts referencing this supplier will be preserved.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FeedPage() {
  const { apiFetch, user } = useAuth();
  const [activeTab, setActiveTab] = useState('inventory');
  const [kpis,      setKpis]      = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/feed');
        if (res.ok) { const d = await res.json(); setKpis(d); }
      } finally { setLoading(false); }
    })();
  }, [apiFetch]);

  return (
    <AppShell>
      <div className="animate-in">
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>Feed Management</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>Inventory, deliveries, consumption, mill & supplier management</p>
        </div>

        {/* KPI Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {loading ? (
            [1,2,3,4].map(i => <div key={i} className="card" style={{ height: 88 }}><Skeleton h={40} /></div>)
          ) : [
            { icon: '📦', value: kpis?.inventory?.totalItems ?? '—', label: 'Feed Types Tracked', color: 'var(--purple)' },
            { icon: '⚠', value: kpis?.inventory?.lowStockCount ?? '—', label: 'Low Stock Alerts', warn: (kpis?.inventory?.lowStockCount ?? 0) > 0 },
            { icon: '🌾', value: kpis?.consumption?.lastWeekKg ? `${fmt(kpis.consumption.lastWeekKg, 0)} kg` : '—', label: '7-Day Consumption', color: '#f59e0b' },
            { icon: '💰', value: kpis?.inventory?.totalStockValue ? fmtCur(kpis.inventory.totalStockValue) : '—', label: 'Total Stock Value', color: 'var(--green)' },
          ].map(k => <KpiCard key={k.label} {...k} />)}
        </div>

        {/* Tabs */}
        <TabBar active={activeTab} onChange={setActiveTab} />

        {/* Tab content */}
        {activeTab === 'inventory'   && <InventoryTab   apiFetch={apiFetch} />}
        {activeTab === 'receipts'    && <ReceiptsTab    apiFetch={apiFetch} />}
        {activeTab === 'consumption' && <ConsumptionTab apiFetch={apiFetch} />}
        {activeTab === 'mill'        && <MillTab        apiFetch={apiFetch} />}
        {activeTab === 'suppliers'   && <SuppliersTab   apiFetch={apiFetch} />}
      </div>
    </AppShell>
  );
}
