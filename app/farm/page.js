'use client';
// app/farm/page.js — Flock management page
// Phase 8-Supplement (Store Flow Revision):
//   - CullModal: disposition SOLD removed → TRANSFERRED_TO_STORE added with store selector
//   - DepletionModal: revenue fields removed → store selector added, SOLD removed
//   - LifecycleSummaryModal: depletionRevenue removed from display (now via SalesOrder)

import { useState, useEffect, useCallback, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import AppShell   from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CAN_CREATE_ROLES = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const LIFECYCLE_ROLES  = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const REVIEW_ROLES     = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const OP_META = {
  layer:   { title: 'Layer Flocks',  subtitle: 'ISA Brown, Bovans White, Hy-Line', icon: '🥚', emptyIcon: '🥚' },
  broiler: { title: 'Broiler Flocks', subtitle: 'Ross 308, Cobb 500',              icon: '🍗', emptyIcon: '🍗' },
  all:     { title: 'All Flocks',    subtitle: null,                                icon: '🐦', emptyIcon: '🐦' },
};
const OP_BIRD_TYPE = { layer: 'LAYER', broiler: 'BROILER', all: null };
const TYPE_COLOR   = { LAYER: '#f59e0b', BROILER: '#3b82f6', BREEDER: '#8b5cf6', TURKEY: '#22c55e' };

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function fmt(n) { return n != null ? Number(n).toLocaleString() : '—'; }
function fmtCurrency(n, currency = 'NGN') {
  if (!n || n === 0) return '—';
  const symbol = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : currency;
  return `${symbol}${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function buildKpis(flocks, op) {
  const active = flocks.filter(f => f.status === 'ACTIVE').length;
  const total  = flocks.filter(f => f.status === 'ACTIVE').reduce((s, f) => s + f.currentCount, 0);
  const deaths = flocks.reduce((s, f) => s + (f.weeklyMortality || 0), 0);
  if (op === 'layer') {
    const rates  = flocks.filter(f => f.avgLayingRate).map(f => Number(f.avgLayingRate));
    const avgLay = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    return [
      { label: 'Live Birds',     value: total.toLocaleString(), icon: '🥚', color: '#f59e0b' },
      { label: 'Active Batches', value: active,                 icon: '📋', color: 'var(--purple)' },
      { label: 'Weekly Deaths',  value: deaths,                 icon: '📉', color: 'var(--red)' },
      { label: 'Avg Lay Rate',   value: avgLay ? `${avgLay.toFixed(0)}%` : '—', icon: '🥚', color: '#f59e0b' },
    ];
  }
  if (op === 'broiler') {
    const due = flocks.filter(f => f.expectedHarvestDate && new Date(f.expectedHarvestDate) <= new Date(Date.now() + 7 * 86400000)).length;
    return [
      { label: 'Live Birds',        value: total.toLocaleString(), icon: '🐦', color: '#3b82f6' },
      { label: 'Active Batches',    value: active,                 icon: '📋', color: 'var(--purple)' },
      { label: 'Weekly Deaths',     value: deaths,                 icon: '📉', color: 'var(--red)' },
      { label: 'Harvest This Week', value: due,                    icon: '🏭', color: '#3b82f6' },
    ];
  }
  return [
    { label: 'Total Live Birds', value: total.toLocaleString(),                            icon: '🐦', color: 'var(--purple)' },
    { label: 'Active Batches',   value: active,                                            icon: '📋', color: 'var(--blue)'   },
    { label: 'Weekly Mortality', value: deaths,                                            icon: '📉', color: 'var(--amber)'  },
    { label: 'Layer Batches',    value: flocks.filter(f => f.birdType === 'LAYER').length, icon: '🥚', color: 'var(--amber)'  },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 18, border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite' }}>
      {[80, 50, 60, 40].map((w, i) => (
        <div key={i} style={{ height: 12, background: 'var(--border)', borderRadius: 6, marginBottom: 10, width: `${w}%` }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function Modal({ title, subtitle, width = 520, onClose, footer, children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg-surface)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.2)', width: '100%', maxWidth: width, maxHeight: '92vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ padding: '20px 24px', flex: 1, overflowY: 'auto' }}>{children}</div>
        {footer && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, flexShrink: 0 }}>{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PENDING EVENTS BANNER — shown to FM+ when lifecycle events await review
// ─────────────────────────────────────────────────────────────────────────────
function PendingEventsBanner({ events, onReview }) {
  if (!events || events.length === 0) return null;
  return (
    <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: events.length > 1 ? 12 : 0 }}>
        <span style={{ fontSize: 16 }}>⏳</span>
        <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 13, color: '#92400e' }}>
          {events.length} lifecycle event{events.length > 1 ? 's' : ''} awaiting your approval
        </span>
      </div>
      {events.map(ev => (
        <div key={ev.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid #fde68a' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#78350f' }}>
              {ev.eventType === 'CULL' ? '✂️ Partial Cull' : '🏁 Depletion'} — {ev.flock?.batchCode}
            </div>
            <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>
              {fmt(ev.birdCount)} birds · {ev.disposition} · Submitted by {ev.submittedBy?.firstName} {ev.submittedBy?.lastName}
            </div>
            {ev.reason && (
              <div style={{ fontSize: 11, color: '#78350f', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                "{ev.reason}"
              </div>
            )}
          </div>
          <button onClick={() => onReview(ev)} className="btn btn-outline"
            style={{ fontSize: 11, fontWeight: 700, borderColor: '#d97706', color: '#d97706', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Review →
          </button>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW MODAL — FM approves or rejects a pending lifecycle event
// ─────────────────────────────────────────────────────────────────────────────
function ReviewModal({ event, apiFetch, onClose, onSuccess }) {
  const [action,          setAction]          = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState('');

  const typeLabel = event.eventType === 'CULL' ? 'Partial Cull' : 'Depletion';

  async function submit() {
    if (!action) return setError('Select an action — Approve or Reject.');
    if (action === 'REJECT' && rejectionReason.trim().length < 5)
      return setError('Provide a rejection reason (min 5 characters).');
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/flock-events/${event.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          rejectionReason: action === 'REJECT' ? rejectionReason : null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Review action failed.');
      onSuccess(d.message || `${typeLabel} ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully.`);
    } finally { setSaving(false); }
  }

  return (
    <Modal
      title={`Review ${typeLabel} Request`}
      subtitle={`${event.flock?.batchCode} · submitted by ${event.submittedBy?.firstName} ${event.submittedBy?.lastName}`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button onClick={submit} disabled={saving || !action}
            className="btn btn-primary"
            style={{ background: action === 'APPROVE' ? 'var(--green)' : action === 'REJECT' ? 'var(--red)' : undefined }}>
            {saving ? 'Processing…' : action === 'APPROVE' ? '✅ Confirm Approval' : action === 'REJECT' ? '❌ Confirm Rejection' : 'Select action'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Event summary */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12, textAlign: 'center' }}>
            {[
              { label: 'Event Type',   value: event.eventType === 'CULL' ? '✂️ Cull' : '🏁 Deplete' },
              { label: 'Birds',        value: fmt(event.birdCount) },
              { label: 'Disposition',  value: event.disposition },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <strong>Reason:</strong> {event.reason}
          </div>
          {event.notes && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              <strong>Notes:</strong> {event.notes}
            </div>
          )}
          {event.disposition === 'TRANSFERRED_TO_STORE' && event.store && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              <strong>Destination:</strong> {event.store.name}
              {event.estimatedValuePerBird && ` · Est. ₦${Number(event.estimatedValuePerBird).toLocaleString()}/bird`}
            </div>
          )}
          {event.disposition === 'DISPOSED' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              <strong>Disposal method:</strong> {event.disposalMethod}
              {event.disposalLocation && ` · ${event.disposalLocation}`}
            </div>
          )}
        </div>

        {/* Action selector */}
        <div>
          <label className="label">Your decision *</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { value: 'APPROVE', label: '✅ Approve', desc: 'Confirm this event. All effects (count change, mortality record, store receipt) will execute immediately.', color: 'var(--green)' },
              { value: 'REJECT',  label: '❌ Reject',  desc: 'Decline this request. No flock data will change. The submitter will be notified with your reason.', color: 'var(--red)' },
            ].map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                border: `1.5px solid ${action === opt.value ? opt.color : 'var(--border)'}`,
                background: action === opt.value ? `${opt.color}12` : 'var(--bg-elevated)' }}>
                <input type="radio" name="reviewAction" value={opt.value}
                  checked={action === opt.value}
                  onChange={() => setAction(opt.value)}
                  style={{ marginTop: 3, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: opt.color }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Rejection reason */}
        {action === 'REJECT' && (
          <div>
            <label className="label">Rejection reason *</label>
            <textarea value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}
              className="input" rows={3} placeholder="Explain why this request is being rejected so the submitter can correct and resubmit…"
              style={{ resize: 'vertical' }} />
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
// Fetches available stores for the tenant and renders a select.
// ─────────────────────────────────────────────────────────────────────────────
// STORE SELECTOR — auto-selects the first GENERAL store.
// Live birds can only go to GENERAL type stores.
// Shows as read-only confirmation; only shows a dropdown if multiple GENERAL
// stores exist, or an error if none exist.
function StoreSelector({ apiFetch, value, onChange, required = false }) {
  const [stores,  setStores]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/stores');
        if (!res.ok) { setError('Could not load stores.'); return; }
        const d = await res.json();
        // Only GENERAL stores can receive live birds
        const generalStores = (d.stores || []).filter(s => s.storeType === 'GENERAL');
        setStores(generalStores);
        // Auto-select the first GENERAL store immediately
        if (generalStores.length > 0 && !value) {
          onChange(generalStores[0].id);
        }
      } catch { setError('Failed to load store list.'); }
      finally  { setLoading(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return (
    <div style={{ height: 42, background: 'var(--bg-elevated)', borderRadius: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
  );

  if (error || stores.length === 0) return (
    <div style={{ padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 8, fontSize: 12, color: 'var(--red)' }}>
      ⚠ No General Store found. Ask a Farm Admin to create a General Store before transferring live birds.
    </div>
  );

  // Single GENERAL store — show as read-only confirmation chip
  if (stores.length === 1) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <span style={{ fontSize: 16 }}>🏪</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{stores[0].name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Auto-selected · General Store</div>
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>✓ Selected</span>
    </div>
  );

  // Multiple GENERAL stores — show a dropdown (rare but possible for large farms)
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="input"
      required={required}
    >
      <option value="">— Select General Store —</option>
      {stores.map(s => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOCK CARD
// ─────────────────────────────────────────────────────────────────────────────
function FlockCard({ flock, onClick }) {
  const tc          = TYPE_COLOR[flock.birdType] || '#9ca3af';
  const survivalPct = flock.initialCount > 0
    ? ((flock.currentCount / flock.initialCount) * 100).toFixed(1)
    : '—';
  const daysToHarvest = flock.expectedHarvestDate
    ? Math.max(0, Math.floor((new Date(flock.expectedHarvestDate) - new Date()) / 86400000))
    : null;
  const isDepleted = flock.status === 'DEPLETED';

  return (
    <div
      onClick={() => onClick(flock)}
      style={{ background: 'var(--bg-surface)', border: `1.5px solid ${isDepleted ? 'var(--border)' : tc + '40'}`, borderRadius: 12, padding: 18, cursor: 'pointer', transition: 'all 0.15s', opacity: isDepleted ? 0.7 : 1 }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = tc; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = isDepleted ? 'var(--border)' : tc + '40'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{flock.batchCode}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{flock.breed}</div>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: isDepleted ? 'var(--bg-elevated)' : tc + '18', color: isDepleted ? 'var(--text-muted)' : tc, border: `1px solid ${isDepleted ? 'var(--border)' : tc + '40'}` }}>
          {isDepleted ? 'Depleted' : flock.birdType}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Birds',    value: fmt(flock.currentCount), color: 'var(--text-primary)' },
          { label: 'Survival', value: `${survivalPct}%`,       color: 'var(--green)' },
          flock.birdType === 'LAYER'
            ? { label: 'Lay Rate', value: flock.avgLayingRate ? `${Number(flock.avgLayingRate).toFixed(0)}%` : '—', color: '#f59e0b' }
            : { label: 'Harvest',  value: daysToHarvest !== null ? `${daysToHarvest}d` : '—', color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        📍 {flock.penSection?.pen?.name} — {flock.penSection?.name}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOCK DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────
function FlockModal({ flock, apiFetch, userRole, onClose, onLifecycleAction }) {
  const daysToHarvest = flock.expectedHarvestDate
    ? Math.max(0, Math.floor((new Date(flock.expectedHarvestDate) - new Date()) / 86400000))
    : null;
  const canLifecycle = LIFECYCLE_ROLES.includes(userRole);
  const canReview    = REVIEW_ROLES.includes(userRole);
  const isActive     = flock.status === 'ACTIVE';

  return (
    <Modal
      title={flock.batchCode}
      subtitle={`${flock.breed} · ${flock.birdType}`}
      width={520}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
          {canLifecycle && isActive && (
            <>
              <button onClick={() => onLifecycleAction('cull', flock)} className="btn btn-outline"
                style={{ flex: 1, minWidth: 110, fontSize: 12, borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                ✂️ Partial Cull
              </button>
              <button onClick={() => onLifecycleAction('deplete', flock)} className="btn btn-outline"
                style={{ flex: 1, minWidth: 110, fontSize: 12, borderColor: 'var(--red)', color: 'var(--red)' }}>
                🏁 Deplete Flock
              </button>
            </>
          )}
          {canReview && (
            <button onClick={() => onLifecycleAction('summary', flock)} className="btn btn-outline"
              style={{ flex: 1, minWidth: 110, fontSize: 12 }}>
              📊 Lifecycle P&L
            </button>
          )}
          <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1, minWidth: 80, fontSize: 12 }}>Close</button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Current Birds', value: fmt(flock.currentCount), color: 'var(--purple)' },
          { label: 'Survival Rate', value: `${flock.initialCount > 0 ? ((flock.currentCount / flock.initialCount) * 100).toFixed(1) : '—'}%`, color: 'var(--green)' },
          flock.birdType === 'LAYER'
            ? { label: 'Laying Rate',     value: flock.avgLayingRate ? `${Number(flock.avgLayingRate).toFixed(0)}%` : '—', color: '#f59e0b' }
            : { label: 'Days to Harvest', value: daysToHarvest !== null ? `${daysToHarvest}d` : '—', color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 9, padding: 12, textAlign: 'center' }}>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {flock.status === 'DEPLETED' && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>🏁</span>
          <span>Depleted on <strong>{new Date(flock.depletionDate).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</strong>. View <em>Lifecycle P&L</em> for the full summary.</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
        {[
          ['Pen Location',  `${flock.penSection?.pen?.name} — ${flock.penSection?.name}`],
          ['Date Placed',   new Date(flock.dateOfPlacement).toLocaleDateString('en-NG', { dateStyle: 'medium' })],
          ['Source',        flock.source?.replace('_', ' ')],
          ['Purchase Cost', flock.purchaseCost ? `₦${Number(flock.purchaseCost).toLocaleString('en-NG')}` : '—'],
          ['Initial Count', fmt(flock.initialCount)],
          ['Status',        flock.status],
        ].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{l}</div>
            <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{v || '—'}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CULL MODAL — store-mediated
// ─────────────────────────────────────────────────────────────────────────────
function CullModal({ flock, apiFetch, onClose, onSuccess, userRole }) {
  const isPM  = userRole === 'PEN_MANAGER';
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    cullCount:             '',
    disposition:           'CULLED',
    reason:                '',
    notes:                 '',
    storeId:               '',
    estimatedValuePerBird: '',
    currency:              'NGN',
    disposalMethod:        '',
    disposalLocation:      '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const needsStore   = form.disposition === 'TRANSFERRED_TO_STORE';
  const needsDisposal = form.disposition === 'DISPOSED';
  const remaining    = flock.currentCount - (parseInt(form.cullCount) || 0);
  const estTotal     = needsStore && !isPM && form.estimatedValuePerBird && form.cullCount
    ? parseInt(form.cullCount) * parseFloat(form.estimatedValuePerBird)
    : null;

  async function submit() {
    if (!form.cullCount || parseInt(form.cullCount) <= 0) return setError('Enter the number of birds to cull.');
    if (!form.reason.trim() || form.reason.trim().length < 10) return setError('Reason must be at least 10 characters.');
    if (parseInt(form.cullCount) > flock.currentCount)
      return setError(`Cannot cull more than current count (${fmt(flock.currentCount)}).`);
    if (needsStore && !form.storeId) return setError('Select a destination store.');
    if (form.disposition === 'DISPOSED' && !form.disposalMethod) return setError('Select a disposal method.');
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/flock-events', {
        method: 'POST',
        body: JSON.stringify({
          flockId:               flock.id,
          eventType:             'CULL',
          birdCount:             parseInt(form.cullCount),
          disposition:           form.disposition,
          reason:                form.reason,
          notes:                 form.notes || null,
          storeId:               needsStore ? form.storeId : null,
          estimatedValuePerBird: needsStore && form.estimatedValuePerBird
            ? parseFloat(form.estimatedValuePerBird) : null,
          currency:              form.currency,
          disposalMethod:        form.disposition === 'DISPOSED' ? form.disposalMethod : null,
          disposalLocation:      form.disposalLocation || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Submission failed.');
      onSuccess(d.message || 'Cull request submitted — awaiting Farm Manager approval.');
    } finally { setSaving(false); }
  }

  return (
    <Modal
      title="✂️ Partial Cull"
      subtitle={`${flock.batchCode} · ${fmt(flock.currentCount)} birds currently`}
      width={500}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={saving}
            style={{ flex: 2, background: '#f59e0b', borderColor: '#f59e0b' }}>
            {saving ? 'Submitting…' : 'Submit for FM Approval'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Live count preview */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(flock.currentCount)}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Before</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>−{form.cullCount ? fmt(parseInt(form.cullCount)) : 0}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Culled</div>
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: remaining < 0 ? '#ef4444' : 'var(--green)' }}>
              {remaining < 0 ? '—' : fmt(remaining)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Remaining</div>
          </div>
        </div>

        <div>
          <label className="label">Number of birds *</label>
          <input type="number" min="1" max={flock.currentCount} value={form.cullCount}
            onChange={e => set('cullCount', e.target.value)} className="input"
            placeholder={`1 – ${fmt(flock.currentCount)}`} />
        </div>

        {/* Disposition selector — the key control */}
        <div>
          <label className="label">What happens to these birds? *</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              {
                value: 'CULLED',
                label: 'Culled / Discarded',
                desc:  'Birds are removed and discarded — disease culling, unproductive hens. No store entry.',
                icon:  '🗑️',
              },
              {
                value: 'TRANSFERRED_TO_STORE',
                label: 'Transfer to Store',
                desc:  'Birds physically move to the store. A store receipt is created. Revenue is recorded via a Sales Order.',
                icon:  '🏪',
              },
              {
                value: 'DIED',
                label: 'Natural Deaths',
                desc:  'Birds died of natural causes / disease. Logged as mortality only.',
                icon:  '📉',
              },
              {
                value: 'DISPOSED',
                label: 'Disposed On-Site',
                desc:  'Birds are buried, cremated, or incinerated on-farm. IC will verify disposal.',
                icon:  '🪦',
              },
            ].map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${form.disposition === opt.value ? 'var(--purple)' : 'var(--border)'}`, background: form.disposition === opt.value ? 'var(--purple-light)' : 'var(--bg-elevated)', cursor: 'pointer' }}>
                <input type="radio" name="cullDisposition" value={opt.value}
                  checked={form.disposition === opt.value}
                  onChange={() => set('disposition', opt.value)}
                  style={{ marginTop: 3, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{opt.icon} {opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Store fields — only shown for TRANSFERRED_TO_STORE */}
        {needsStore && (
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Store Details
            </div>
            <div>
              <label className="label">Destination store *</label>
              <StoreSelector apiFetch={apiFetch} value={form.storeId} onChange={v => set('storeId', v)} required />
            </div>
            {!isPM && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                  <div>
                    <label className="label">Estimated value per bird</label>
                    <input type="number" min="0" value={form.estimatedValuePerBird}
                      onChange={e => set('estimatedValuePerBird', e.target.value)}
                      className="input" placeholder="e.g. 2500" />
                    {estTotal != null && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Est. receipt value: {fmtCurrency(estTotal, form.currency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label">Currency</label>
                    <select value={form.currency} onChange={e => set('currency', e.target.value)} className="input">
                      {['NGN', 'USD', 'GBP', 'GHS', 'KES'].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', background: '#fff8e1', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                  💡 Revenue is <strong>not</strong> recorded here. After the Store Manager acknowledges the receipt, raise a <strong>Sales Order</strong> from the store to record actual revenue.
                </div>
              </>
            )}
          </div>
        )}

        {/* Disposal fields — only shown for DISPOSED */}
        {needsDisposal && (
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Disposal Details</div>
            <div>
              <label className="label">Disposal method *</label>
              <select value={form.disposalMethod} onChange={e => set('disposalMethod', e.target.value)} className="input">
                <option value="">— Select method —</option>
                <option value="BURIED">Buried</option>
                <option value="CREMATED">Cremated</option>
                <option value="INCINERATED">Incinerated</option>
              </select>
            </div>
            <div>
              <label className="label">Disposal location</label>
              <input value={form.disposalLocation} onChange={e => set('disposalLocation', e.target.value)}
                className="input" placeholder="e.g. Back field, Pit 2…" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', background: '#fff8e1', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
              🔍 IC or a Farm Manager will physically verify this disposal before the event is closed.
            </div>
          </div>
        )}

        <div>
          <label className="label">Reason * <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>(min 10 characters)</span></label>
          <input value={form.reason} onChange={e => set('reason', e.target.value)}
            className="input" placeholder="e.g. Unproductive hens removed, poor weight gain…" />
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            className="input" rows={2} placeholder="Optional" style={{ resize: 'vertical' }} />
        </div>

        {error && (
          <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPLETION MODAL — store-mediated, no direct revenue entry
// ─────────────────────────────────────────────────────────────────────────────
function DepletionModal({ flock, apiFetch, onClose, onSuccess, userRole }) {
  const today = new Date().toISOString().split('T')[0];
  const isPM  = userRole === 'PEN_MANAGER';

  const [form, setForm] = useState({
    disposition:           'TRANSFERRED_TO_STORE',
    finalCount:            String(flock.currentCount),
    reason:                '',
    notes:                 '',
    storeId:               '',
    estimatedValuePerBird: '',
    currency:              'NGN',
  });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [confirm, setConfirm] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const needsStore   = form.disposition === 'TRANSFERRED_TO_STORE';
  const estTotal     = needsStore && !isPM && form.estimatedValuePerBird && form.finalCount
    ? parseInt(form.finalCount) * parseFloat(form.estimatedValuePerBird)
    : null;

  async function submit() {
    if (!confirm) { setConfirm(true); return; }
    if (!form.finalCount || parseInt(form.finalCount) < 0) return setError('Final count is required.');
    if (parseInt(form.finalCount) > flock.currentCount)
      return setError(`Final count cannot exceed current count (${fmt(flock.currentCount)}).`);
    if (needsStore && !form.storeId)
      return setError('Select a destination store. Birds must go through the store before sale.');
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/flock-events', {
        method: 'POST',
        body: JSON.stringify({
          flockId:               flock.id,
          eventType:             'DEPLETE',
          birdCount:             parseInt(form.finalCount),
          disposition:           form.disposition,
          reason:                form.reason?.trim() || `Full depletion — ${form.disposition}`,
          notes:                 form.notes || null,
          storeId:               needsStore ? form.storeId : null,
          estimatedValuePerBird: (!isPM && needsStore && form.estimatedValuePerBird)
            ? parseFloat(form.estimatedValuePerBird) : null,
          currency:              form.currency,
        }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Submission failed.');
      onSuccess(d.message);
    } finally { setSaving(false); }
  }

  return (
    <Modal
      title="🏁 Deplete Flock"
      subtitle={`${flock.batchCode} · ${fmt(flock.currentCount)} birds · irreversible`}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => { if (confirm) setConfirm(false); else onClose(); }} disabled={saving}>
            {confirm ? '← Back' : 'Cancel'}
          </button>
          <button onClick={submit} disabled={saving} className="btn btn-primary"
            style={{ flex: 2, background: confirm ? '#ef4444' : 'var(--purple)', borderColor: confirm ? '#ef4444' : 'var(--purple)' }}>
            {saving ? 'Depleting…' : confirm ? '⚠ Confirm Depletion' : 'Review & Deplete →'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Confirmation checklist */}
        {confirm && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px', fontSize: 13 }}>
            <div style={{ fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>⚠ Please confirm</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#7f1d1d', lineHeight: 1.9, fontSize: 12 }}>
              <li>Flock <strong>{flock.batchCode}</strong> → <strong>DEPLETED</strong></li>
              <li>Section <strong>{flock.penSection?.name}</strong> → <strong>VACANT</strong></li>
              {needsStore && <li>Store receipt created — <strong>pending Store Manager acknowledgement</strong></li>}
              <li>Cleaning task auto-created for section workers</li>
              <li>Cannot be undone</li>
            </ul>
          </div>
        )}

        {/* Disposition — no HARVESTED option; that decision belongs to the store */}
        <div>
          <label className="label">What happens to these birds? *</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { value: 'TRANSFERRED_TO_STORE', label: 'Transfer to Store (live birds)',  desc: 'Birds physically move to the General Store. Store Manager acknowledges receipt, then decides split between live sales and processing.', icon: '🏪' },
              { value: 'CULLED',               label: 'Full Flock Culled',               desc: 'Entire flock culled and sent to store for disposal or sale.', icon: '✂️' },
              { value: 'DIED',                 label: 'All Died (disease / emergency)',  desc: 'Complete flock loss. No store entry. Mortality logged only.', icon: '📉' },
            ].map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${form.disposition === opt.value ? 'var(--purple)' : 'var(--border)'}`, background: form.disposition === opt.value ? 'var(--purple-light)' : 'var(--bg-elevated)', cursor: 'pointer' }}>
                <input type="radio" name="depleteDisposition" value={opt.value}
                  checked={form.disposition === opt.value}
                  onChange={() => set('disposition', opt.value)}
                  style={{ marginTop: 3, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{opt.icon} {opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Final bird count *</label>
          <input type="number" min="0" max={flock.currentCount} value={form.finalCount}
            onChange={e => set('finalCount', e.target.value)} className="input" />
          {parseInt(form.finalCount) < flock.currentCount && form.finalCount !== '' && (
            <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
              ⚠ {fmt(flock.currentCount - parseInt(form.finalCount))} birds unaccounted vs current count
            </div>
          )}
        </div>

        {/* Depletion date — auto-set to today, no back-dating allowed */}
        <div>
          <label className="label">Depletion date</label>
          <input type="date" value={today} disabled className="input"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'not-allowed' }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Auto-set to today — depletion is logged at the time of submission.
          </div>
        </div>

        {/* Store fields — estimatedValuePerBird hidden from PM */}
        {needsStore && (
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Store Receipt Details
            </div>
            <div>
              <label className="label">Destination store *</label>
              <StoreSelector apiFetch={apiFetch} value={form.storeId} onChange={v => set('storeId', v)} required />
            </div>
            {!isPM && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                  <div>
                    <label className="label">Estimated value per bird</label>
                    <input type="number" min="0" value={form.estimatedValuePerBird}
                      onChange={e => set('estimatedValuePerBird', e.target.value)}
                      className="input" placeholder="Optional — for store costing" />
                    {estTotal != null && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Est. receipt value: {fmtCurrency(estTotal, form.currency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label">Currency</label>
                    <select value={form.currency} onChange={e => set('currency', e.target.value)} className="input">
                      {['NGN', 'USD', 'GBP', 'GHS', 'KES'].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', background: '#fff8e1', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px' }}>
                  💡 Revenue is recorded when the Store Manager raises a <strong>Sales Order</strong> after acknowledging this receipt. The value entered here is for store cost tracking only.
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <label className="label">Reason *</label>
          <textarea value={form.reason} onChange={e => set('reason', e.target.value)}
            className="input" rows={2} placeholder="Why is this flock being depleted?" style={{ resize: 'vertical' }} />
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
            className="input" rows={2} placeholder="Any additional context…" style={{ resize: 'vertical' }} />
        </div>

        {error && <div className="error-banner">⚠ {error}</div>}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE SUMMARY MODAL
// ─────────────────────────────────────────────────────────────────────────────
function LifecycleSummaryModal({ flock, apiFetch, onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/flocks/${flock.id}/lifecycle-summary`);
        const d   = await res.json();
        if (!res.ok) { setError(d.error || 'Failed to load summary'); return; }
        setData(d);
      } catch { setError('Network error'); }
      finally { setLoading(false); }
    })();
  }, [flock.id]);

  const statusColor = {
    PROFITABLE: { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' },
    LOSS:       { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
    BREAKEVEN:  { bg: 'var(--bg-elevated)', border: 'var(--border)', text: 'var(--text-muted)' },
  };

  return (
    <Modal title="📊 Lifecycle P&L" subtitle={`${flock.batchCode} · ${flock.breed}`} width={560} onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Close</button>}>
      {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: 'var(--red)' }}>⚠ {error}</div>}
      {data && !loading && (() => {
        const sc  = statusColor[data.profitStatus] || statusColor.BREAKEVEN;
        const cur = data.currency || 'NGN';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: sc.text, marginBottom: 4 }}>{data.profitStatus}</div>
                <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 26, fontWeight: 700, color: sc.text }}>
                  {data.profitLoss >= 0 ? '+' : ''}{fmtCurrency(data.profitLoss, cur)}
                </div>
                <div style={{ fontSize: 11, color: sc.text, marginTop: 2, opacity: 0.8 }}>
                  {data.margin != null ? `${data.margin}% margin` : 'Add farm pricing in Settings to calculate margin'}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                <div>{data.dates.lifespanDays} days</div>
                <div>{new Date(data.dates.placement).toLocaleDateString('en-NG', { dateStyle: 'medium' })} → {data.dates.depletion ? new Date(data.dates.depletion).toLocaleDateString('en-NG', { dateStyle: 'medium' }) : 'Present'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--red)', marginBottom: 12 }}>Costs — {fmtCurrency(data.costs.total, cur)}</div>
                {[['Chick / DOC', data.costs.chickCost], ['Feed', data.costs.feedCost], ['Medication', data.costs.medicationCost]].map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8, color: 'var(--text-secondary)' }}>
                    <span>{l}</span><span style={{ fontWeight: 600 }}>{fmtCurrency(v, cur)}</span>
                  </div>
                ))}
                {data.costs.total > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
                    Feed is {((data.costs.feedCost / data.costs.total) * 100).toFixed(0)}% of total costs
                  </div>
                )}
              </div>
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--green)', marginBottom: 12 }}>Revenue — {fmtCurrency(data.revenue.total, cur)}</div>
                {[
                  data.operationType === 'LAYER'   && ['Egg Sales',     data.revenue.eggRevenue],
                  data.operationType === 'BROILER'  && ['Harvest Sales', data.revenue.broilerRevenue],
                ].filter(Boolean).map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8, color: 'var(--text-secondary)' }}>
                    <span>{l}</span><span style={{ fontWeight: 600 }}>{fmtCurrency(v, cur)}</span>
                  </div>
                ))}
                {data.revenue.total === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    Revenue flows through Sales Orders raised from the store. Check with your Store Manager.
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>Bird Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, textAlign: 'center' }}>
                {[
                  { label: 'Placed',    value: fmt(data.birds.totalChicksIn),  color: 'var(--text-primary)' },
                  { label: 'Mortality', value: fmt(data.birds.totalMortality), color: 'var(--red)' },
                  { label: 'Surviving', value: fmt(data.birds.surviving),      color: 'var(--purple)' },
                  { label: 'Survival %', value: data.birds.survivalPct != null ? `${data.birds.survivalPct}%` : '—', color: 'var(--green)' },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE FLOCK MODAL
// ─────────────────────────────────────────────────────────────────────────────
function CreateFlockModal({ apiFetch, defaultBirdType, onClose, onCreated }) {
  const [form, setForm] = useState({
    batchCode: '', birdType: defaultBirdType || 'LAYER', breed: '', penSectionId: '',
    dateOfPlacement: new Date().toISOString().split('T')[0],
    initialCount: '', source: 'PURCHASED', purchaseCost: '',
    targetWeightG: '', expectedHarvestDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCreate = async () => {
    if (!form.batchCode || !form.breed || !form.initialCount) { setError('Fill in all required fields.'); return; }
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/flocks', {
        method: 'POST',
        body: JSON.stringify({ ...form, initialCount: parseInt(form.initialCount), purchaseCost: form.purchaseCost ? parseFloat(form.purchaseCost) : undefined }),
      });
      const d = await res.json();
      if (res.ok) onCreated();
      else setError(d.error || 'Failed to create flock');
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`🐦 New ${defaultBirdType ? defaultBirdType.charAt(0) + defaultBirdType.slice(1).toLowerCase() + ' ' : ''}Flock Batch`} width={500} onClose={onClose}
      footer={<><button onClick={onClose} className="btn btn-ghost">Cancel</button><button onClick={handleCreate} disabled={saving} className="btn btn-primary" style={{ flex: 2 }}>{saving ? 'Creating…' : '+ Create Flock Batch'}</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1/-1' }}><label className="label">Batch Code *</label><input value={form.batchCode} onChange={e => up('batchCode', e.target.value)} className="input" placeholder="e.g. LAY-2026-005" /></div>
        <div><label className="label">Bird Type *</label><select value={form.birdType} onChange={e => up('birdType', e.target.value)} className="input">{['LAYER','BROILER','BREEDER','TURKEY'].map(t => <option key={t}>{t}</option>)}</select></div>
        <div><label className="label">Breed *</label><input value={form.breed} onChange={e => up('breed', e.target.value)} className="input" placeholder="e.g. Isa Brown" /></div>
        <div><label className="label">Date of Placement *</label><input type="date" value={form.dateOfPlacement} onChange={e => up('dateOfPlacement', e.target.value)} className="input" /></div>
        <div><label className="label">Initial Count *</label><input type="number" value={form.initialCount} onChange={e => up('initialCount', e.target.value)} className="input" /></div>
        <div><label className="label">Source</label><select value={form.source} onChange={e => up('source', e.target.value)} className="input">{['PURCHASED','OWN_HATCHERY','TRANSFERRED'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></div>
        <div><label className="label">Purchase Cost (₦)</label><input type="number" value={form.purchaseCost} onChange={e => up('purchaseCost', e.target.value)} className="input" /></div>
        {form.birdType === 'BROILER' && (<>
          <div><label className="label">Target Weight (g)</label><input type="number" value={form.targetWeightG} onChange={e => up('targetWeightG', e.target.value)} className="input" /></div>
          <div><label className="label">Expected Harvest Date</label><input type="date" value={form.expectedHarvestDate} onChange={e => up('expectedHarvestDate', e.target.value)} className="input" /></div>
        </>)}
        {error && <div style={{ gridColumn:'1/-1', background:'var(--red-bg)', border:'1px solid var(--red-border)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--red)' }}>⚠ {error}</div>}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
function FarmPageInner() {
  const { apiFetch, user } = useAuth();
  const searchParams       = useSearchParams();

  const op       = searchParams.get('op') || 'all';
  const meta     = OP_META[op] || OP_META.all;
  const birdType = OP_BIRD_TYPE[op] || null;

  const [flocks,         setFlocks]         = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [filter,         setFilter]         = useState({ status: 'ACTIVE' });
  const [selected,       setSelected]       = useState(null);
  const [showCreate,     setShowCreate]     = useState(false);
  const [lifecycleModal, setLifecycleModal] = useState(null);
  const [toast,          setToast]          = useState(null);
  const [reviewEvent,    setReviewEvent]    = useState(null);  // event awaiting FM review
  const [pendingEvents,  setPendingEvents]  = useState([]);    // PENDING_APPROVAL events for FM banner

  const isReviewer = REVIEW_ROLES.includes(user?.role);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadFlocks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: filter.status || 'ALL' });
      if (birdType) params.set('birdType', birdType);
      const res = await apiFetch(`/api/flocks?${params}`);
      if (res.ok) { const d = await res.json(); setFlocks(d.flocks || []); }
    } finally { setLoading(false); }
  }, [apiFetch, op, filter.status]);

  const loadPendingEvents = useCallback(async () => {
    if (!isReviewer) return;
    try {
      const res = await apiFetch('/api/flock-events?status=PENDING_APPROVAL');
      if (res.ok) { const d = await res.json(); setPendingEvents(d.events || []); }
    } catch { /* silent */ }
  }, [apiFetch, isReviewer]);

  useEffect(() => { loadFlocks(); loadPendingEvents(); }, [loadFlocks, loadPendingEvents]);

  function handleLifecycleAction(type, flock) {
    setSelected(null);
    setLifecycleModal({ type, flock });
  }

  function handleLifecycleSuccess(msg) {
    setLifecycleModal(null);
    showToast(msg, 'success');
    loadFlocks();
    loadPendingEvents();
  }

  function handleReviewSuccess(msg) {
    setReviewEvent(null);
    showToast(msg, 'success');
    loadFlocks();
    loadPendingEvents();
  }

  const canCreate  = CAN_CREATE_ROLES.includes(user?.role);
  const kpis       = buildKpis(flocks, op);
  const totalBirds = flocks.filter(f => f.status === 'ACTIVE').reduce((s, f) => s + f.currentCount, 0);

  return (
    <AppShell>
      <div className="animate-in">

        {toast && (
          <div style={{ position: 'fixed', top: 20, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: toast.type === 'error' ? 'var(--red-bg)' : 'var(--green-bg)', color: toast.type === 'error' ? 'var(--red)' : '#16a34a', border: `1px solid ${toast.type === 'error' ? 'var(--red-border)' : 'var(--green-border)'}`, boxShadow: 'var(--shadow-md)', animation: 'fadeInUp 0.2s ease' }}>
            {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.msg}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 24 }}>{meta.icon}</span>
              <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{meta.title}</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 0 }}>
              {meta.subtitle ? `${meta.subtitle} · ` : ''}{flocks.length} {flocks.length === 1 ? 'batch' : 'batches'} · {totalBirds.toLocaleString()} live birds
            </p>
          </div>
          {canCreate && <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ New {op !== 'all' ? meta.title.replace(' Flocks', '') + ' ' : ''}Flock Batch</button>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          {kpis.map(k => (
            <div key={k.label} className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{k.label}</span>
                <span style={{ fontSize: 20 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 26, fontWeight: 700, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {['ACTIVE', 'DEPLETED', 'ALL'].map(s => (
            <button key={s} onClick={() => setFilter(p => ({ ...p, status: s }))} className="btn"
              style={{ display: 'inline-flex', width: 'auto', padding: '6px 14px', fontSize: 12, background: filter.status === s ? 'var(--purple-light)' : '#fff', color: filter.status === s ? 'var(--purple)' : 'var(--text-muted)', border: `1px solid ${filter.status === s ? '#d4d8ff' : 'var(--border)'}`, fontWeight: filter.status === s ? 700 : 600, borderRadius: 8, cursor: 'pointer' }}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* FM+ pending approval banner */}
        {isReviewer && (
          <PendingEventsBanner
            events={pendingEvents}
            onReview={ev => setReviewEvent(ev)}
          />
        )}

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {[1,2,3,4,5,6].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : flocks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{meta.emptyIcon}</div>
            <div style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 600 }}>No {op !== 'all' ? meta.title.toLowerCase() : 'flocks'} found</div>
            {canCreate && <button onClick={() => setShowCreate(true)} className="btn btn-primary" style={{ marginTop: 16 }}>+ Add Flock Batch</button>}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {flocks.map(f => <FlockCard key={f.id} flock={f} onClick={setSelected} />)}
          </div>
        )}
      </div>

      {selected && <FlockModal flock={selected} apiFetch={apiFetch} userRole={user?.role} onClose={() => setSelected(null)} onLifecycleAction={handleLifecycleAction} />}
      {showCreate && <CreateFlockModal apiFetch={apiFetch} defaultBirdType={birdType} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadFlocks(); }} />}
      {lifecycleModal?.type === 'cull'    && <CullModal     flock={lifecycleModal.flock} apiFetch={apiFetch} onClose={() => setLifecycleModal(null)} onSuccess={handleLifecycleSuccess} userRole={user?.role} />}
      {lifecycleModal?.type === 'deplete' && <DepletionModal flock={lifecycleModal.flock} apiFetch={apiFetch} onClose={() => setLifecycleModal(null)} onSuccess={handleLifecycleSuccess} userRole={user?.role} />}
      {lifecycleModal?.type === 'summary' && <LifecycleSummaryModal flock={lifecycleModal.flock} apiFetch={apiFetch} onClose={() => setLifecycleModal(null)} />}
      {reviewEvent && <ReviewModal event={reviewEvent} apiFetch={apiFetch} onClose={() => setReviewEvent(null)} onSuccess={handleReviewSuccess} />}
    </AppShell>
  );
}

export default function FarmPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div></AppShell>}>
      <FarmPageInner />
    </Suspense>
  );
}
