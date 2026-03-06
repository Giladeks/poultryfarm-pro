'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt    = (n, d = 1) => (n == null ? '—' : Number(n).toFixed(d));
const fmtN   = (n)        => (n == null ? '—' : Number(n).toLocaleString('en-NG'));
const fmtCur = (n)        => n == null ? '—' : `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;
const fmtDate = (d)       => d ? new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const todayStr = ()       => new Date().toISOString().slice(0, 10);

const MANAGER_ROLES = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const QC_BADGE = {
  PASSED:  'status-badge status-green',
  FAILED:  'status-badge status-red',
  PENDING: 'status-badge status-amber',
};
const PO_BADGE = {
  DRAFT:     'status-badge status-grey',
  SUBMITTED: 'status-badge status-blue',
  APPROVED:  'status-badge status-green',
  REJECTED:  'status-badge status-red',
  FULFILLED: 'status-badge status-green',
  CANCELLED: 'status-badge status-red',
};

// ─── Portal-based modal — always renders centred over the page ─────────────

function Modal({ title, subtitle, onClose, children, wide }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal animate-in" style={{ maxWidth: wide ? 680 : 500, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              {title}
            </h2>
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1, padding: '2px 6px' }}
          >✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ─── Tiny shared components ───────────────────────────────────────────────────

function Toast({ msg, type }) {
  if (!msg) return null;
  const isErr = type === 'error';
  return (
    <div style={{
      position: 'fixed', top: 20, right: 24, zIndex: 9999,
      padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
      background: isErr ? '#fff5f5' : '#f0fdf4',
      color: isErr ? '#dc2626' : '#16a34a',
      border: `1px solid ${isErr ? '#fecaca' : '#bbf7d0'}`,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', animation: 'fadeInUp 0.2s ease',
    }}>
      {isErr ? '⚠ ' : '✓ '}{msg}
    </div>
  );
}

function InlineAlert({ type = 'red', msg }) {
  if (!msg) return null;
  return (
    <div className={`alert alert-${type}`} style={{ marginBottom: 14 }}>
      <span>{type === 'red' ? '⚠' : type === 'green' ? '✓' : 'ℹ'}</span>
      <span>{msg}</span>
    </div>
  );
}

function Field({ label, required, children, hint, error }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="label">
        {label}{required && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {hint  && !error && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{hint}</div>}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 3 }}>{error}</div>}
    </div>
  );
}

// Day-range toggle that matches the dashboard pattern
function DayToggle({ value, onChange, options = [7, 14, 30] }) {
  return (
    <div style={{ display: 'flex', gap: 3, background: 'var(--bg-elevated)', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
      {options.map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          style={{
            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, fontFamily: "'Nunito',sans-serif",
            background: value === d ? 'var(--purple)' : 'transparent',
            color:      value === d ? '#fff' : 'var(--text-muted)',
            transition: 'all .15s',
          }}
        >{d}d</button>
      ))}
    </div>
  );
}

// ─── INVENTORY TAB ────────────────────────────────────────────────────────────

function InventoryTab({ apiFetch, user }) {
  const [inventory,   setInventory]   = useState([]);
  const [summary,     setSummary]     = useState(null);
  const [consumption, setConsumption] = useState([]);
  const [chartDays,   setChartDays]   = useState(7);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);
  const [modal,       setModal]       = useState(null); // { type: 'restock'|'add', item? }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const isManager = MANAGER_ROLES.includes(user?.role);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/feed/inventory');
      if (res.ok) {
        const d = await res.json();
        setInventory(d.inventory || []);
        setSummary(d.summary   || null);
      }
    } finally { setLoading(false); }
  }, [apiFetch]);

  const loadConsumption = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - chartDays);
    const res = await apiFetch(`/api/feed/consumption?limit=500&from=${since.toISOString().slice(0, 10)}`);
    if (res.ok) {
      const d = await res.json();
      setConsumption(d.consumption || []);
    }
  }, [apiFetch, chartDays]);

  useEffect(() => { loadInventory();   }, [loadInventory]);
  useEffect(() => { loadConsumption(); }, [loadConsumption]);

  // Build chart data split by Layer vs Broiler
  const chartData = (() => {
    const map = {};
    consumption.forEach(c => {
      const label = new Date(c.recordedDate).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' });
      if (!map[label]) map[label] = { date: label, Layer: 0, Broiler: 0 };
      const type = c.flock?.operationType === 'LAYER' ? 'Layer' : 'Broiler';
      map[label][type] += Number(c.quantityKg);
    });
    return Object.values(map)
      .map(r => ({ ...r, Layer: parseFloat(r.Layer.toFixed(1)), Broiler: parseFloat(r.Broiler.toFixed(1)) }))
      .slice(-chartDays);
  })();

  return (
    <div>
      <Toast msg={toast?.msg} type={toast?.type} />

      {/* ── KPI bar ── */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Feed Types',   value: summary.totalItems,              icon: '📦', color: 'var(--purple)' },
            { label: 'Low Stock',    value: summary.lowStockItems,            icon: '⚠',  color: 'var(--amber)'  },
            { label: 'Out of Stock', value: summary.outOfStock,               icon: '🚨', color: 'var(--red)'    },
            { label: 'Total Value',  value: fmtCur(summary.totalValueNGN),    icon: '💰', color: 'var(--green)'  },
          ].map(k => (
            <div key={k.label} className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span className="section-header" style={{ margin: 0 }}>{k.label}</span>
                <span style={{ fontSize: 20 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 26, fontWeight: 700, color: k.color }}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Alert banners ── */}
      {inventory.filter(i => i.stockStatus === 'OUT_OF_STOCK').map(i => (
        <div key={`out-${i.id}`} className="alert alert-red" style={{ marginBottom: 8 }}>
          <span>🚨</span>
          <span><strong>{i.feedType}</strong> is out of stock — immediate restock required</span>
        </div>
      ))}
      {inventory.filter(i => i.stockStatus === 'LOW').map(i => (
        <div key={`low-${i.id}`} className="alert alert-amber" style={{ marginBottom: 8 }}>
          <span>⚠</span>
          <span>
            <strong>{i.feedType}</strong> is below reorder level — {fmt(i.currentStockKg, 0)} kg remaining (reorder at {fmt(i.reorderLevelKg, 0)} kg)
          </span>
        </div>
      ))}

      {/* ── Section header + Add button ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, marginTop: 4, gap: 12 }}>
        <h3 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 15, fontWeight: 700, margin: 0 }}>Stock Overview</h3>
        {isManager && (
          <div style={{ flexShrink: 0 }}>
            <button className="btn btn-primary" onClick={() => setModal({ type: 'add' })}>
              + Add Feed Type
            </button>
          </div>
        )}
      </div>

      {/* ── Stock cards ── */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 28 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="card" style={{ height: 200, opacity: 0.35 }} />
          ))}
        </div>
      ) : inventory.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60, marginBottom: 28 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No feed inventory yet</div>
          {isManager && (
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setModal({ type: 'add' })}>
              + Add First Feed Type
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 28 }}>
          {inventory.map(item => {
            const pct = item.reorderLevelKg > 0
              ? Math.min(100, (Number(item.currentStockKg) / (Number(item.reorderLevelKg) * 3)) * 100)
              : 100;
            const accent = item.stockStatus === 'OUT_OF_STOCK' ? 'var(--red)'
              : item.stockStatus === 'LOW'  ? 'var(--amber)'
              : 'var(--purple)';

            return (
              <div
                key={item.id}
                className="card"
                style={{ borderLeft: `4px solid ${accent}` }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = '';                 e.currentTarget.style.boxShadow = '';                }}
              >
                {/* Card header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 15 }}>{item.feedType}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{item.store?.name || 'Main Feed Store'}</div>
                  </div>
                  {item.stockStatus !== 'OK' && (
                    <span className={item.stockStatus === 'OUT_OF_STOCK' ? 'status-badge status-red' : 'status-badge status-amber'}>
                      {item.stockStatus === 'OUT_OF_STOCK' ? 'OUT' : 'LOW'}
                    </span>
                  )}
                </div>

                {/* Big number */}
                <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 30, fontWeight: 800, color: accent, lineHeight: 1 }}>
                  {fmtN(Math.round(Number(item.currentStockKg)))}
                  <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>kg</span>
                </div>

                {/* Progress bar */}
                <div className="progress-bar" style={{ margin: '10px 0' }}>
                  <div className="progress-fill" style={{ width: `${pct}%`, background: accent }} />
                </div>

                {/* Stats row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 12, marginBottom: 12 }}>
                  {[
                    { label: 'Reorder At', value: `${fmt(item.reorderLevelKg, 0)} kg` },
                    { label: 'Cost/kg',    value: fmtCur(item.costPerKg) },
                    {
                      label: 'Days Left',
                      value: item.daysRemaining != null ? `~${item.daysRemaining}d` : '—',
                      warn:  item.daysRemaining != null && item.daysRemaining < 7,
                    },
                  ].map(s => (
                    <div key={s.label}>
                      <div style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                      <div style={{ fontWeight: 700, color: s.warn ? 'var(--red)' : 'inherit' }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {item.supplier?.name && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                    🏭 {item.supplier.name}
                  </div>
                )}

                {isManager && (
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', fontSize: 13 }}
                    onClick={() => setModal({ type: 'restock', item })}
                  >
                    + Restock
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Feed usage chart — Layer vs Broiler, with day toggle ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div className="section-header" style={{ margin: 0 }}>Feed Usage — Layer vs Broiler</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Daily kg consumed, split by flock type</div>
          </div>
          <DayToggle value={chartDays} onChange={setChartDays} />
        </div>
        {chartData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            No consumption data in the last {chartDays} days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} unit=" kg" />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e8eaf0', borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [`${v} kg`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Layer"   name="Layer"   fill="#6c63ff" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Broiler" name="Broiler" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Recent consumption log ── */}
      {consumption.length > 0 && (
        <div className="card">
          <div className="section-header">Recent Consumption Log</div>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Flock</th><th>Type</th><th>Feed</th>
                <th>Qty (kg)</th><th>g/Bird</th>
              </tr>
            </thead>
            <tbody>
              {consumption.slice(0, 20).map(c => (
                <tr key={c.id}>
                  <td>{fmtDate(c.recordedDate)}</td>
                  <td>{c.flock?.batchCode || '—'}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c.flock?.operationType === 'LAYER' ? 'var(--amber)' : '#22c55e' }}>
                      {c.flock?.operationType || '—'}
                    </span>
                  </td>
                  <td>{c.feedInventory?.feedType || '—'}</td>
                  <td>{fmt(c.quantityKg, 2)}</td>
                  <td>{c.gramsPerBird ? fmt(c.gramsPerBird, 1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals (portal-rendered) ── */}
      {modal?.type === 'restock' && (
        <RestockModal
          item={modal.item}
          apiFetch={apiFetch}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); loadInventory(); showToast('Stock restocked successfully.'); }}
        />
      )}
      {modal?.type === 'add' && (
        <AddFeedTypeModal
          apiFetch={apiFetch}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); loadInventory(); showToast('Feed type added.'); }}
        />
      )}
    </div>
  );
}

function RestockModal({ item, apiFetch, onClose, onSuccess }) {
  const [qty,    setQty]    = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const handleSubmit = async () => {
    if (!qty || isNaN(qty) || Number(qty) <= 0) { setError('Enter a valid quantity.'); return; }
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/feed/inventory/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ currentStockKg: Number(item.currentStockKg) + Number(qty) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Restock failed');
      onSuccess();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const newTotal = qty && !isNaN(qty) && Number(qty) > 0
    ? Number(item.currentStockKg) + Number(qty) : null;

  return (
    <Modal
      title={`Restock — ${item.feedType}`}
      subtitle={`Current stock: ${fmt(item.currentStockKg, 1)} kg`}
      onClose={onClose}
    >
      <InlineAlert type="red" msg={error} />
      <Field label="Quantity to Add (kg)" required>
        <input
          className="input" type="number" min="0" step="0.1"
          value={qty} onChange={e => setQty(e.target.value)}
          placeholder="e.g. 500" autoFocus
        />
      </Field>
      {newTotal && (
        <div style={{ padding: '10px 14px', background: 'rgba(108,99,255,0.06)', borderRadius: 9, border: '1px solid #d4d8ff', fontSize: 13, marginBottom: 16 }}>
          Stock after restock: <strong style={{ color: 'var(--purple)' }}>{fmt(newTotal, 1)} kg</strong>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost"   onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Confirm Restock'}
        </button>
      </div>
    </Modal>
  );
}

function AddFeedTypeModal({ apiFetch, onClose, onSuccess }) {
  const [form, setForm] = useState({ feedType: '', currentStockKg: '', reorderLevelKg: '', costPerKg: '' });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const up = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(p => { const n = { ...p }; delete n[k]; return n; }); };

  const handleSubmit = async () => {
    const e = {};
    if (!form.feedType)       e.feedType       = 'Required';
    if (!form.currentStockKg) e.currentStockKg = 'Required';
    if (!form.reorderLevelKg) e.reorderLevelKg = 'Required';
    if (!form.costPerKg)      e.costPerKg      = 'Required';
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/api/feed/inventory', {
        method: 'POST',
        body: JSON.stringify({
          feedType:       form.feedType.trim(),
          currentStockKg: Number(form.currentStockKg),
          reorderLevelKg: Number(form.reorderLevelKg),
          costPerKg:      Number(form.costPerKg),
          currency:       'NGN',
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to add feed type');
      onSuccess();
    } catch (e) { setErrors({ _api: e.message }); } finally { setSaving(false); }
  };

  return (
    <Modal title="Add Feed Type" onClose={onClose}>
      <InlineAlert type="red" msg={errors._api} />
      <Field label="Feed Type Name" required error={errors.feedType}>
        <input className="input" value={form.feedType} onChange={e => up('feedType', e.target.value)}
          placeholder="e.g. Layer Mash" autoFocus />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Current Stock (kg)" required error={errors.currentStockKg}>
          <input className="input" type="number" min="0" step="0.1" value={form.currentStockKg}
            onChange={e => up('currentStockKg', e.target.value)} placeholder="e.g. 2000" />
        </Field>
        <Field label="Reorder Level (kg)" required error={errors.reorderLevelKg}>
          <input className="input" type="number" min="0" step="0.1" value={form.reorderLevelKg}
            onChange={e => up('reorderLevelKg', e.target.value)} placeholder="e.g. 500" />
        </Field>
        <Field label="Cost per kg (₦)" required error={errors.costPerKg} style={{ gridColumn: '1 / -1' }}>
          <input className="input" type="number" min="0" step="0.01" value={form.costPerKg}
            onChange={e => up('costPerKg', e.target.value)} placeholder="e.g. 180" />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn btn-ghost"   onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Adding…' : '+ Add Feed Type'}
        </button>
      </div>
    </Modal>
  );
}

// ─── LOG CONSUMPTION TAB ──────────────────────────────────────────────────────

function ConsumptionTab({ apiFetch }) {
  const [inventory,   setInventory]   = useState([]);
  const [flocks,      setFlocks]      = useState([]);
  const [sections,    setSections]    = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [toast,       setToast]       = useState(null);
  const [errors,      setErrors]      = useState({});

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const [form, setForm] = useState({
    flockId: '', penSectionId: '', feedInventoryId: '',
    quantityKg: '', recordedDate: todayStr(), notes: '',
  });
  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(p => { const n = { ...p }; delete n[k]; return n; }); };

  useEffect(() => {
    setLoadingData(true);
    Promise.all([
      apiFetch('/api/feed/inventory').then(r => r.json()),
      apiFetch('/api/flocks?status=ACTIVE').then(r => r.json()),
      apiFetch('/api/farm-structure').then(r => r.json()),
    ]).then(([fi, ff, fs]) => {
      setInventory(fi.inventory || []);
      setFlocks(ff.flocks || []);
      const all = (fs.farms || []).flatMap(f =>
        (f.pens || []).flatMap(p => (p.sections || []).map(s => ({ ...s, penName: p.name })))
      );
      setSections(all);
    }).catch(() => {}).finally(() => setLoadingData(false));
  }, [apiFetch]);

  const selectedFlock = flocks.find(f => f.id === form.flockId);
  const selectedFeed  = inventory.find(i => i.id === form.feedInventoryId);
  const gramsPerBird  = (form.quantityKg && selectedFlock?.currentCount)
    ? ((Number(form.quantityKg) * 1000) / selectedFlock.currentCount).toFixed(1)
    : null;
  const stockInsufficient = selectedFeed && form.quantityKg &&
    Number(form.quantityKg) > Number(selectedFeed.currentStockKg);

  const validate = () => {
    const e = {};
    if (!form.flockId)         e.flockId         = 'Select a flock';
    if (!form.feedInventoryId) e.feedInventoryId = 'Select a feed type';
    if (!form.quantityKg || Number(form.quantityKg) <= 0) e.quantityKg = 'Enter a valid quantity';
    if (!form.recordedDate)    e.recordedDate    = 'Date is required';
    if (stockInsufficient)     e.quantityKg      = `Exceeds available stock (${fmt(selectedFeed?.currentStockKg, 1)} kg)`;
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const payload = {
        flockId:         form.flockId,
        feedInventoryId: form.feedInventoryId,
        quantityKg:      Number(form.quantityKg),
        recordedDate:    form.recordedDate,
      };
      if (form.penSectionId) payload.penSectionId = form.penSectionId;
      if (form.notes)        payload.notes        = form.notes;

      const res = await apiFetch('/api/feed/consumption', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to log consumption');
      showToast('Consumption logged. Stock updated.');
      setForm({ flockId: '', penSectionId: '', feedInventoryId: '', quantityKg: '', recordedDate: todayStr(), notes: '' });
    } catch (e) { showToast(e.message, 'error'); } finally { setSaving(false); }
  };

  return (
    <div>
      <Toast msg={toast?.msg} type={toast?.type} />
      <div style={{ maxWidth: 620 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 14px', background: 'rgba(108,99,255,0.06)', borderRadius: 9, border: '1px solid #d4d8ff' }}>
            <span style={{ fontSize: 22 }}>🌾</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Log Feed Consumption</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>Stock is deducted automatically on save</div>
            </div>
          </div>

          {loadingData ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Field label="Flock" required error={errors.flockId}>
                  <select className="input" value={form.flockId} onChange={e => set('flockId', e.target.value)}>
                    <option value="">Select flock…</option>
                    {flocks.map(f => (
                      <option key={f.id} value={f.id}>{f.batchCode} ({(f.currentCount || 0).toLocaleString()} birds)</option>
                    ))}
                  </select>
                </Field>

                <Field label="Pen Section (optional)">
                  <select className="input" value={form.penSectionId} onChange={e => set('penSectionId', e.target.value)}>
                    <option value="">— None —</option>
                    {sections.map(s => <option key={s.id} value={s.id}>{s.penName} — {s.name}</option>)}
                  </select>
                </Field>

                <Field label="Feed Type" required error={errors.feedInventoryId}>
                  <select className="input" value={form.feedInventoryId} onChange={e => set('feedInventoryId', e.target.value)}>
                    <option value="">Select feed…</option>
                    {inventory.map(i => (
                      <option key={i.id} value={i.id}>{i.feedType} ({fmt(i.currentStockKg, 0)} kg avail.)</option>
                    ))}
                  </select>
                </Field>

                <Field label="Date" required error={errors.recordedDate}>
                  <input className="input" type="date" value={form.recordedDate} onChange={e => set('recordedDate', e.target.value)} />
                </Field>

                <Field label="Quantity (kg)" required error={errors.quantityKg}>
                  <input className="input" type="number" min="0" step="0.1" value={form.quantityKg}
                    onChange={e => set('quantityKg', e.target.value)} placeholder="e.g. 25.5" />
                </Field>

                <Field label="g / Bird" hint="Auto-calculated from flock size">
                  <div className="input" style={{
                    background: 'var(--bg-elevated)',
                    fontFamily: "'Poppins',sans-serif",
                    fontWeight: gramsPerBird ? 800 : 400,
                    color: gramsPerBird ? 'var(--purple)' : 'var(--text-muted)',
                  }}>
                    {gramsPerBird ? `${gramsPerBird} g/bird` : '—'}
                  </div>
                </Field>
              </div>

              <Field label="Notes (optional)">
                <textarea className="input" rows={2} value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Any feeding observations…" style={{ resize: 'vertical' }} />
              </Field>

              {/* Stock preview */}
              {selectedFeed && form.quantityKg && Number(form.quantityKg) > 0 && (
                <div style={{
                  padding: '10px 14px', borderRadius: 9, marginBottom: 14, fontSize: 13,
                  border: `1px solid ${stockInsufficient ? '#fecaca' : '#bbf7d0'}`,
                  background: stockInsufficient ? '#fff5f5' : '#f0fdf4',
                  color: stockInsufficient ? '#dc2626' : '#16a34a',
                }}>
                  {stockInsufficient ? (
                    '⚠ Insufficient stock — cannot log this quantity'
                  ) : (
                    <>✓ Stock after logging: <strong>{fmt(Number(selectedFeed.currentStockKg) - Number(form.quantityKg), 1)} kg</strong></>
                  )}
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={saving || stockInsufficient}
                style={{ width: '100%' }}
              >
                {saving ? 'Logging…' : '✓ Log Consumption'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RECEIPTS (GRN) TAB ───────────────────────────────────────────────────────

function ReceiptsTab({ apiFetch, user }) {
  const [receipts,  setReceipts]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast  = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const isManager  = MANAGER_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/feed/receipts?limit=100');
      if (res.ok) { const d = await res.json(); setReceipts(d.receipts || []); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const totalKg    = receipts.reduce((s, r) => s + Number(r.quantityReceived || 0), 0);
  const totalValue = receipts.reduce((s, r) => s + Number(r.quantityReceived || 0) * Number(r.unitCost || 0), 0);

  return (
    <div>
      <Toast msg={toast?.msg} type={toast?.type} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 18, fontWeight: 700, margin: 0 }}>Goods Received Notes</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
            {receipts.length} receipt{receipts.length !== 1 ? 's' : ''} · {fmt(totalKg, 0)} kg total · {fmtCur(totalValue)} value
          </p>
        </div>
        {isManager && (
          <div style={{ flexShrink: 0, paddingTop: 2 }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              + Record Delivery
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
        ) : receipts.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
            <div style={{ fontWeight: 600 }}>No deliveries recorded yet</div>
            {isManager && (
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>
                + Record First Delivery
              </button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Feed Type</th><th>Supplier</th>
                <th>Qty (kg)</th><th>Unit Cost</th><th>Total Value</th>
                <th>QC</th><th>Ref #</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => (
                <tr key={r.id}>
                  <td>{fmtDate(r.receiptDate || r.createdAt)}</td>
                  <td style={{ fontWeight: 600 }}>{r.feedInventory?.feedType || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.supplier?.name || '—'}</td>
                  <td>{fmt(r.quantityReceived, 1)}</td>
                  <td>{fmtCur(r.unitCost)}</td>
                  <td style={{ fontWeight: 700, color: 'var(--purple)' }}>
                    {fmtCur(Number(r.quantityReceived) * Number(r.unitCost))}
                  </td>
                  <td><span className={QC_BADGE[r.qualityStatus] || 'status-badge status-grey'}>{r.qualityStatus || 'PENDING'}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.referenceNumber || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <GRNModal
          apiFetch={apiFetch}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); load(); showToast('Delivery recorded. Stock updated.'); }}
        />
      )}
    </div>
  );
}

function GRNModal({ apiFetch, onClose, onSuccess }) {
  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [errors,    setErrors]    = useState({});

  const [form, setForm] = useState({
    feedInventoryId: '', supplierId: '', quantityReceived: '',
    unitCost: '', receiptDate: todayStr(),
    qualityStatus: 'PENDING', referenceNumber: '', batchNumber: '', notes: '',
  });
  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(p => { const n = { ...p }; delete n[k]; return n; }); };

  useEffect(() => {
    Promise.all([
      apiFetch('/api/feed/inventory').then(r => r.json()),
      apiFetch('/api/suppliers').then(r => r.json()),
    ]).then(([fi, sup]) => {
      setInventory(fi.inventory  || []);
      setSuppliers(sup.suppliers || []);
    }).finally(() => setLoading(false));
  }, [apiFetch]);

  const selectedFeed = inventory.find(i => i.id === form.feedInventoryId);
  const total = form.quantityReceived && form.unitCost
    ? Number(form.quantityReceived) * Number(form.unitCost) : null;

  const validate = () => {
    const e = {};
    if (!form.feedInventoryId) e.feedInventoryId  = 'Select a feed type';
    if (!form.quantityReceived || Number(form.quantityReceived) <= 0) e.quantityReceived = 'Enter quantity';
    if (!form.unitCost || Number(form.unitCost) <= 0) e.unitCost = 'Enter unit cost';
    if (!form.receiptDate) e.receiptDate = 'Date required';
    return e;
  };

  const handleSubmit = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/api/feed/receipts', {
        method: 'POST',
        body: JSON.stringify({
          storeId:          selectedFeed?.store?.id,
          feedInventoryId:  form.feedInventoryId,
          supplierId:       form.supplierId   || null,
          receiptDate:      form.receiptDate,
          quantityReceived: Number(form.quantityReceived),
          unitCost:         Number(form.unitCost),
          qualityStatus:    form.qualityStatus,
          referenceNumber:  form.referenceNumber || null,
          batchNumber:      form.batchNumber     || null,
          notes:            form.notes           || null,
          currency:         'NGN',
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to record delivery');
      onSuccess();
    } catch (e) { setErrors({ _api: e.message }); } finally { setSaving(false); }
  };

  return (
    <Modal title="Record Delivery (GRN)" onClose={onClose} wide>
      <InlineAlert type="red" msg={errors._api} />
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Feed Type" required error={errors.feedInventoryId}>
              <select className="input" value={form.feedInventoryId} onChange={e => set('feedInventoryId', e.target.value)}>
                <option value="">Select…</option>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.feedType}</option>)}
              </select>
            </Field>
            <Field label="Supplier">
              <select className="input" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                <option value="">— None —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Qty Received (kg)" required error={errors.quantityReceived}>
              <input className="input" type="number" min="0" step="0.1" value={form.quantityReceived}
                onChange={e => set('quantityReceived', e.target.value)} placeholder="e.g. 1000" />
            </Field>
            <Field label="Unit Cost (₦/kg)" required error={errors.unitCost}>
              <input className="input" type="number" min="0" step="0.01" value={form.unitCost}
                onChange={e => set('unitCost', e.target.value)} placeholder="e.g. 185" />
            </Field>
            <Field label="Receipt Date" required error={errors.receiptDate}>
              <input className="input" type="date" value={form.receiptDate} onChange={e => set('receiptDate', e.target.value)} />
            </Field>
            <Field label="QC Status">
              <select className="input" value={form.qualityStatus} onChange={e => set('qualityStatus', e.target.value)}>
                <option value="PENDING">Pending</option>
                <option value="PASSED">Passed</option>
                <option value="FAILED">Failed</option>
              </select>
            </Field>
            <Field label="Reference / Invoice #">
              <input className="input" value={form.referenceNumber} onChange={e => set('referenceNumber', e.target.value)} placeholder="INV-001" />
            </Field>
            <Field label="Batch Number">
              <input className="input" value={form.batchNumber} onChange={e => set('batchNumber', e.target.value)} placeholder="BAT-001" />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} />
          </Field>
          {total && (
            <div style={{ padding: '10px 14px', background: 'rgba(108,99,255,0.06)', border: '1px solid #d4d8ff', borderRadius: 9, fontSize: 13, marginBottom: 16 }}>
              Total Delivery Value: <strong style={{ fontFamily: "'Poppins',sans-serif", color: 'var(--purple)', fontSize: 15 }}>{fmtCur(total)}</strong>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost"   onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>{saving ? 'Saving…' : 'Record GRN'}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── PURCHASE ORDERS TAB ──────────────────────────────────────────────────────

function PurchaseOrdersTab({ apiFetch, user }) {
  const [orders,    setOrders]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const isManager = MANAGER_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/feed?tab=orders');
      if (res.ok) { const d = await res.json(); setOrders(d.orders || []); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (po, status) => {
    try {
      const res = await apiFetch('/api/feed?action=update-po', {
        method: 'POST',
        body: JSON.stringify({ poId: po.id, status }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Update failed');
      showToast(`PO ${status.toLowerCase()}.`);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div>
      <Toast msg={toast?.msg} type={toast?.type} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 18, fontWeight: 700, margin: 0 }}>Purchase Orders</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
            {orders.length} order{orders.length !== 1 ? 's' : ''}
          </p>
        </div>
        {isManager && (
          <div style={{ flexShrink: 0 }}>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
              + Create PO
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => <div key={i} className="card" style={{ height: 100, opacity: 0.35 }} />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🛒</div>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>No purchase orders yet</div>
          {isManager && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>
              + Create First PO
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {orders.map(po => (
            <div key={po.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 800, fontSize: 16 }}>{po.poNumber}</span>
                    <span className={PO_BADGE[po.status] || 'status-badge status-grey'}>{po.status}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {po.supplier?.name} · {fmtDate(po.createdAt)}
                    {po.expectedDelivery && ` · Expected ${fmtDate(po.expectedDelivery)}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 800, fontSize: 22, color: 'var(--purple)' }}>
                    {fmtCur(po.totalAmount)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {po.lineItems?.length || 0} item{(po.lineItems?.length || 0) !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>

              {po.lineItems?.length > 0 && (
                <table className="table" style={{ marginTop: 12 }}>
                  <thead>
                    <tr><th>Feed Type</th><th>Qty (kg)</th><th>Unit Price</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    {po.lineItems.map((li, idx) => (
                      <tr key={idx}>
                        <td>{li.feedInventory?.feedType || li.feedType || '—'}</td>
                        <td>{fmt(li.quantityKg, 1)}</td>
                        <td>{fmtCur(li.unitPrice)}</td>
                        <td style={{ fontWeight: 600 }}>{fmtCur(Number(li.quantityKg) * Number(li.unitPrice))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {isManager && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {po.status === 'DRAFT'     && <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => updateStatus(po, 'SUBMITTED')}>Submit PO</button>}
                  {po.status === 'SUBMITTED' && <button className="btn btn-primary" style={{ fontSize: 13 }} onClick={() => updateStatus(po, 'APPROVED')}>✓ Approve</button>}
                  {po.status === 'SUBMITTED' && <button className="btn btn-danger"  style={{ fontSize: 13 }} onClick={() => updateStatus(po, 'REJECTED')}>✕ Reject</button>}
                  {po.status === 'APPROVED'  && <button className="btn btn-outline" style={{ fontSize: 13 }} onClick={() => updateStatus(po, 'FULFILLED')}>Mark Fulfilled</button>}
                  {['DRAFT', 'SUBMITTED'].includes(po.status) && (
                    <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => updateStatus(po, 'CANCELLED')}>Cancel</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <CreatePOModal
          apiFetch={apiFetch}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); load(); showToast('Purchase Order created.'); }}
        />
      )}
    </div>
  );
}

function CreatePOModal({ apiFetch, onClose, onSuccess }) {
  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const [form, setForm] = useState({
    supplierId: '', expectedDelivery: '', notes: '',
    lineItems: [{ feedInventoryId: '', quantityKg: '', unitPrice: '' }],
  });
  const set     = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setLine = (i, k, v) => setForm(p => {
    const items = [...p.lineItems];
    items[i] = { ...items[i], [k]: v };
    return { ...p, lineItems: items };
  });
  const addLine    = () => setForm(p => ({ ...p, lineItems: [...p.lineItems, { feedInventoryId: '', quantityKg: '', unitPrice: '' }] }));
  const removeLine = i  => setForm(p => ({ ...p, lineItems: p.lineItems.filter((_, idx) => idx !== i) }));

  useEffect(() => {
    Promise.all([
      apiFetch('/api/feed/inventory').then(r => r.json()),
      apiFetch('/api/suppliers').then(r => r.json()),
    ]).then(([fi, sup]) => {
      setInventory(fi.inventory  || []);
      setSuppliers(sup.suppliers || []);
    }).finally(() => setLoading(false));
  }, [apiFetch]);

  const total = form.lineItems.reduce((sum, l) => sum + (Number(l.quantityKg) * Number(l.unitPrice) || 0), 0);

  const handleSubmit = async () => {
    if (!form.supplierId || form.lineItems.some(l => !l.feedInventoryId || !l.quantityKg || !l.unitPrice)) {
      setError('Please fill in all required fields and complete all line items.');
      return;
    }
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/feed?action=purchase-order', {
        method: 'POST',
        body: JSON.stringify({
          supplierId:       form.supplierId,
          expectedDelivery: form.expectedDelivery || undefined,
          notes:            form.notes            || undefined,
          lineItems: form.lineItems.map(l => ({
            feedInventoryId: l.feedInventoryId,
            quantityKg:      Number(l.quantityKg),
            unitPrice:       Number(l.unitPrice),
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to create PO');
      onSuccess();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal title="Create Purchase Order" onClose={onClose} wide>
      <InlineAlert type="red" msg={error} />
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 4 }}>
            <Field label="Supplier" required>
              <select className="input" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                <option value="">Select supplier…</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Expected Delivery">
              <input className="input" type="date" value={form.expectedDelivery} onChange={e => set('expectedDelivery', e.target.value)} />
            </Field>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label className="label" style={{ margin: 0 }}>Line Items *</label>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 12px' }} onClick={addLine}>+ Add Item</button>
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
                  <input className="input" type="number" min="0" step="0.1" value={li.quantityKg}
                    onChange={e => setLine(i, 'quantityKg', e.target.value)} placeholder="500" />
                </div>
                <div>
                  {i === 0 && <label className="label">Unit Price (₦)</label>}
                  <input className="input" type="number" min="0" step="0.01" value={li.unitPrice}
                    onChange={e => setLine(i, 'unitPrice', e.target.value)} placeholder="180" />
                </div>
                <button
                  onClick={() => removeLine(i)}
                  disabled={form.lineItems.length === 1}
                  style={{ background: form.lineItems.length === 1 ? 'var(--bg-elevated)' : '#fff5f5', border: `1px solid ${form.lineItems.length === 1 ? 'var(--border)' : '#fecaca'}`, borderRadius: 8, padding: '8px 10px', cursor: form.lineItems.length === 1 ? 'not-allowed' : 'pointer', color: form.lineItems.length === 1 ? 'var(--text-muted)' : '#dc2626', fontSize: 14 }}
                >✕</button>
              </div>
            ))}
          </div>

          <Field label="Notes">
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} />
          </Field>

          {total > 0 && (
            <div style={{ padding: '10px 14px', background: 'rgba(108,99,255,0.06)', border: '1px solid #d4d8ff', borderRadius: 9, fontSize: 13, marginBottom: 16 }}>
              Order Total: <strong style={{ fontFamily: "'Poppins',sans-serif", color: 'var(--purple)', fontSize: 16 }}>{fmtCur(total)}</strong>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost"   onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Creating…' : 'Create PO'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ─── SUPPLIERS TAB ────────────────────────────────────────────────────────────

const TYPE_BADGE = {
  FEED:       'status-badge status-purple',
  CHICKS:     'status-badge status-amber',
  MEDICATION: 'status-badge status-blue',
  EQUIPMENT:  'status-badge status-grey',
  OTHER:      'status-badge status-grey',
};

function SuppliersTab({ apiFetch, user }) {
  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null); // null | { edit: supplier|null }
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };
  const isManager = MANAGER_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/suppliers');
      if (res.ok) { const d = await res.json(); setSuppliers(d.suppliers || []); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const starRating = (n) => n
    ? <span style={{ color: '#f59e0b', letterSpacing: 1 }}>{'★'.repeat(Math.round(n))}{'☆'.repeat(5 - Math.round(n))}</span>
    : null;

  return (
    <div>
      <Toast msg={toast?.msg} type={toast?.type} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12 }}>
        <div>
          <h3 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 18, fontWeight: 700, margin: 0 }}>Suppliers</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
            {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''} registered
          </p>
        </div>
        {isManager && (
          <div style={{ flexShrink: 0, paddingTop: 2 }}>
            <button className="btn btn-primary" onClick={() => setModal({ edit: null })}>
              + Add Supplier
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {[1, 2, 3].map(i => <div key={i} className="card" style={{ height: 220, opacity: 0.35 }} />)}
        </div>
      ) : suppliers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏭</div>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No suppliers registered</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Add suppliers to link them to POs, deliveries and inventory
          </div>
          {isManager && (
            <button className="btn btn-primary" onClick={() => setModal({ edit: null })}>
              + Add First Supplier
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {suppliers.map(s => (
            <div
              key={s.id}
              className="card"
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--purple)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = '';                 e.currentTarget.style.boxShadow = '';                e.currentTarget.style.borderColor = 'var(--border-card)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 5 }}>{s.name}</div>
                  <span className={TYPE_BADGE[s.supplierType] || 'status-badge status-grey'}>
                    {(s.supplierType || 'OTHER').charAt(0) + (s.supplierType || 'other').slice(1).toLowerCase()}
                  </span>
                </div>
                {s.rating && <div style={{ flexShrink: 0 }}>{starRating(s.rating)}</div>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                {s.contactName && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>Contact</span>
                    <span style={{ fontWeight: 600 }}>{s.contactName}</span>
                  </div>
                )}
                {s.phone && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>Phone</span>
                    <a href={`tel:${s.phone}`} style={{ color: 'var(--purple)', fontWeight: 600, textDecoration: 'none' }}>{s.phone}</a>
                  </div>
                )}
                {s.email && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>Email</span>
                    <a href={`mailto:${s.email}`} style={{ color: 'var(--purple)', fontWeight: 600, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.email}</a>
                  </div>
                )}
                {s.paymentTerms && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', minWidth: 56 }}>Terms</span>
                    <span style={{ fontWeight: 600 }}>{s.paymentTerms}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <strong style={{ fontFamily: "'Poppins',sans-serif", fontSize: 15, color: 'var(--purple)' }}>
                    {s._count?.purchaseOrders ?? 0}
                  </strong>{' '}PO{(s._count?.purchaseOrders ?? 0) !== 1 ? 's' : ''}
                </div>
                {isManager && (
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '5px 12px' }}
                    onClick={() => setModal({ edit: s })}
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <SupplierModal
          supplier={modal.edit}
          apiFetch={apiFetch}
          onClose={() => setModal(null)}
          onSuccess={msg => { setModal(null); load(); showToast(msg); }}
        />
      )}
    </div>
  );
}

function SupplierModal({ supplier, apiFetch, onClose, onSuccess }) {
  const isEdit = !!supplier;
  const [form, setForm] = useState({
    name:         supplier?.name         || '',
    supplierType: supplier?.supplierType || 'FEED',
    contactName:  supplier?.contactName  || '',
    phone:        supplier?.phone        || '',
    email:        supplier?.email        || '',
    address:      supplier?.address      || '',
    paymentTerms: supplier?.paymentTerms || '',
    rating:       supplier?.rating       || '',
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const up = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(p => { const n = { ...p }; delete n[k]; return n; }); };

  const handleSubmit = async () => {
    const e = {};
    if (!form.name.trim())  e.name        = 'Supplier name is required';
    if (!form.supplierType) e.supplierType = 'Select a type';
    if (Object.keys(e).length) { setErrors(e); return; }

    setSaving(true);
    try {
      const url    = isEdit ? `/api/suppliers/${supplier.id}` : '/api/suppliers';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify({
          name:         form.name.trim(),
          supplierType: form.supplierType,
          contactName:  form.contactName  || null,
          phone:        form.phone        || null,
          email:        form.email        || null,
          address:      form.address      || null,
          paymentTerms: form.paymentTerms || null,
          rating:       form.rating       ? Number(form.rating) : null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || (isEdit ? 'Update failed' : 'Failed to add supplier'));
      onSuccess(isEdit ? 'Supplier updated.' : 'Supplier added.');
    } catch (e) { setErrors({ _api: e.message }); } finally { setSaving(false); }
  };

  return (
    <Modal title={isEdit ? `Edit — ${supplier.name}` : 'Add Supplier'} onClose={onClose} wide>
      <InlineAlert type="red" msg={errors._api} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Supplier Name" required error={errors.name}>
            <input className="input" value={form.name} onChange={e => up('name', e.target.value)}
              placeholder="e.g. Lagos Agro Feeds Ltd" autoFocus />
          </Field>
        </div>
        <Field label="Type" required error={errors.supplierType}>
          <select className="input" value={form.supplierType} onChange={e => up('supplierType', e.target.value)}>
            {['FEED', 'CHICKS', 'MEDICATION', 'EQUIPMENT', 'OTHER'].map(t => (
              <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </Field>
        <Field label="Rating (1–5)">
          <select className="input" value={form.rating} onChange={e => up('rating', e.target.value)}>
            <option value="">— None —</option>
            {[1, 2, 3, 4, 5].map(n => (
              <option key={n} value={n}>{'★'.repeat(n)} ({n}/5)</option>
            ))}
          </select>
        </Field>
        <Field label="Contact Name">
          <input className="input" value={form.contactName} onChange={e => up('contactName', e.target.value)} placeholder="e.g. Mr. Babatunde" />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={e => up('phone', e.target.value)} placeholder="+234-801-234-5678" />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={e => up('email', e.target.value)} placeholder="sales@supplier.ng" />
        </Field>
        <Field label="Payment Terms">
          <input className="input" value={form.paymentTerms} onChange={e => up('paymentTerms', e.target.value)} placeholder="e.g. Net 30" />
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Address">
            <input className="input" value={form.address} onChange={e => up('address', e.target.value)} placeholder="e.g. Apapa, Lagos" />
          </Field>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button className="btn btn-ghost"   onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : '+ Add Supplier'}
        </button>
      </div>
    </Modal>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'inventory',   label: 'Inventory',       icon: '📦' },
  { id: 'consumption', label: 'Log Consumption',  icon: '🌾' },
  { id: 'receipts',    label: 'Receipts (GRN)',   icon: '📋' },
  { id: 'orders',      label: 'Purchase Orders',  icon: '🛒' },
  { id: 'suppliers',   label: 'Suppliers',         icon: '🏭' },
];

export default function FeedPage() {
  const { user, apiFetch } = useAuth();
  const [activeTab, setActiveTab] = useState('inventory');

  const isManager    = MANAGER_ROLES.includes(user?.role);
  const visibleTabs  = TABS.filter(t => {
    if (t.id === 'inventory'   || t.id === 'consumption') return true;
    return isManager;
  });

  if (!user) return null;

  return (
    <AppShell>
      <div className="animate-in">

        {/* Page header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            🌾 Feed Management
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
            Track inventory, log consumption, record deliveries and manage purchase orders
          </p>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 24, overflowX: 'auto' }}>
          {visibleTabs.map(t => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '10px 18px',
                  fontFamily: "'Nunito',sans-serif",
                  fontWeight: 700,
                  fontSize: 13,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  borderBottom: active ? '3px solid var(--purple)' : '3px solid transparent',
                  color: active ? 'var(--purple)' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  transition: 'all .15s',
                  marginBottom: -2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {t.icon} {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab panels */}
        {activeTab === 'inventory'   && <InventoryTab      apiFetch={apiFetch} user={user} />}
        {activeTab === 'consumption' && <ConsumptionTab    apiFetch={apiFetch} />}
        {activeTab === 'receipts'    && <ReceiptsTab       apiFetch={apiFetch} user={user} />}
        {activeTab === 'orders'      && <PurchaseOrdersTab apiFetch={apiFetch} user={user} />}
        {activeTab === 'suppliers'   && <SuppliersTab      apiFetch={apiFetch} user={user} />}

      </div>
    </AppShell>
  );
}
