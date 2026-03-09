'use client';
// app/verification/page.js — Verification & Reconciliation Dashboard
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ─── Role helpers ─────────────────────────────────────────────────────────────
const VERIFIER_ROLES = ['PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MANAGER_ROLES  = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const REJECT_ROLES   = ['PEN_MANAGER', 'STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const MANAGEMENT_OVERRIDE = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const RECORD_TYPE_VERIFIERS = {
  EggProduction:   [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
  MortalityRecord: [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
  FeedConsumption: [...new Set(['STORE_MANAGER', 'STORE_CLERK',   ...MANAGEMENT_OVERRIDE])],
  StoreReceipt:    [...new Set(['STORE_MANAGER',                  ...MANAGEMENT_OVERRIDE])],
  DailyReport:     [...new Set(['PEN_MANAGER',                    ...MANAGEMENT_OVERRIDE])],
};
const RECORD_TYPE_OWNER = {
  EggProduction:   'Pen Manager',
  MortalityRecord: 'Pen Manager',
  FeedConsumption: 'Store Manager / Store Clerk',
  StoreReceipt:    'Store Manager',
  DailyReport:     'Pen Manager',
};
function isPrimaryVerifier(role, referenceType) {
  if (MANAGEMENT_OVERRIDE.includes(role)) return true;
  const allowed = RECORD_TYPE_VERIFIERS[referenceType];
  return !allowed || allowed.includes(role);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS = ['pending', 'verified', 'discrepancies'];

const TYPE_META = {
  DAILY_PRODUCTION: { icon: '📋', label: 'Daily Production', color: '#6c63ff' },
  FEED_RECEIPT:     { icon: '🌾', label: 'Feed',             color: '#f59e0b' },
  MORTALITY_REPORT: { icon: '💀', label: 'Mortality',        color: '#ef4444' },
  INVENTORY_COUNT:  { icon: '📦', label: 'Inventory',        color: '#3b82f6' },
  FINANCIAL_RECORD: { icon: '💰', label: 'Financial',        color: '#10b981' },
};

const STATUS_META = {
  PENDING:           { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: 'Pending' },
  VERIFIED:          { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', label: 'Verified' },
  DISCREPANCY_FOUND: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'Discrepancy' },
  ESCALATED:         { bg: '#fdf4ff', color: '#9333ea', border: '#e9d5ff', label: 'Escalated' },
  RESOLVED:          { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', label: 'Resolved' },
};

const SEVERITY_META = {
  HIGH:   { bg: '#fef2f2', color: '#dc2626' },
  MEDIUM: { bg: '#fffbeb', color: '#d97706' },
  LOW:    { bg: '#f0fdf4', color: '#16a34a' },
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmt     = (n, d = 1) => Number(n ?? 0).toLocaleString('en-NG', { maximumFractionDigits: d });
const fmtCur  = (n) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n ?? 0));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const timeAgo = (d) => {
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, accent = 'var(--purple)', urgent }) {
  return (
    <div style={{
      background: urgent ? '#fef2f2' : '#fff',
      borderRadius: 12, padding: '18px 20px',
      border: `1px solid ${urgent ? '#fecaca' : 'var(--border-card)'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      display: 'flex', alignItems: 'flex-start', gap: 14,
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10, flexShrink: 0,
        background: `${accent}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: urgent ? '#dc2626' : 'var(--text-primary)', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function TypeBadge({ type }) {
  const m = TYPE_META[type] || { icon: '📄', label: type, color: '#64748b' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: `${m.color}14`, color: m.color,
    }}>{m.icon} {m.label}</span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_META[status] || STATUS_META.PENDING;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{s.label}</span>
  );
}

function EmptyState({ icon, title, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 24px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-secondary)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13 }}>{sub}</div>
    </div>
  );
}

function LoadingRows({ cols = 5, rows = 4 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i}>
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} style={{ padding: '14px 16px' }}>
          <div style={{ height: 14, background: '#f1f5f9', borderRadius: 6, width: j === 0 ? '80%' : '55%', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </td>
      ))}
    </tr>
  ));
}

// ─── Verify / Reject Confirmation Modal ──────────────────────────────────────
function ActionModal({ item, action, onClose, onConfirm }) {
  const [notes,     setNotes]     = useState('');
  const [amount,    setAmount]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState(null);

  const isVerify     = action === 'verify';
  const isDiscrepancy = action === 'discrepancy';
  const isReject     = action === 'reject';
  const isEscalate   = action === 'escalate';
  const isResolve    = action === 'resolve';

  const title = isVerify ? '✅ Confirm Verification'
              : isDiscrepancy ? '⚠️ Flag Discrepancy'
              : isReject ? '↩️ Reject & Return'
              : isEscalate ? '🔺 Escalate to Manager'
              : '✓ Mark as Resolved';

  const confirmLabel = isVerify ? 'Verify Record'
                     : isDiscrepancy ? 'Flag Discrepancy'
                     : isReject ? 'Reject & Notify Worker'
                     : isEscalate ? 'Escalate'
                     : 'Mark Resolved';

  const confirmColor = isVerify || isResolve ? '#16a34a'
                     : isDiscrepancy || isEscalate ? '#d97706'
                     : '#dc2626';

  const handleConfirm = async () => {
    if ((isDiscrepancy || isReject || isEscalate || isResolve) && !notes.trim()) {
      return setError('Please provide notes.');
    }
    setSaving(true); setError(null);
    try {
      await onConfirm({ notes, amount: amount ? parseFloat(amount) : null });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: '0 12px 48px rgba(0,0,0,0.2)', animation: 'fadeInUp 0.2s ease' }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b', fontFamily: "'Poppins',sans-serif" }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px' }}>
          {/* Record summary */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Record</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{item.summary}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.context}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Submitted by {item.submittedBy} · {fmtDate(item.date)}</div>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#dc2626', marginBottom: 14 }}>
              {error}
            </div>
          )}

          {/* Discrepancy amount */}
          {isDiscrepancy && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>Discrepancy Amount (optional)</label>
              <input type="number" min="0" step="0.01" placeholder="e.g. 50 eggs, 2kg feed…"
                value={amount} onChange={e => setAmount(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}

          {/* Notes */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>
              {isVerify ? 'Verification Notes (optional)' : 'Notes *'}
            </label>
            <textarea rows={3} placeholder={
              isVerify      ? 'Any observations during verification…'
              : isDiscrepancy ? 'Describe what was found vs. what was logged…'
              : isReject    ? 'Reason for rejection — worker will be notified…'
              : isEscalate  ? 'Why is this being escalated?'
              : 'How was this resolved?'
            }
              value={notes} onChange={e => setNotes(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>Cancel</button>
          <button onClick={handleConfirm} disabled={saving} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? '#94a3b8' : confirmColor, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pending Item Card ────────────────────────────────────────────────────────
function PendingCard({ item, userRole, canReject, onAction }) {
  const canVerify  = item.canVerify !== undefined ? item.canVerify : isPrimaryVerifier(userRole, item.referenceType);
  const isOverride = MANAGEMENT_OVERRIDE.includes(userRole) && RECORD_TYPE_OWNER[item.referenceType] &&
                     !['PEN_MANAGER','STORE_MANAGER','STORE_CLERK'].includes(userRole);
  const tm  = TYPE_META[item.type] || TYPE_META.DAILY_PRODUCTION;
  const sev = item.severity ? SEVERITY_META[item.severity] : null;
  const isHighRisk = item.severity === 'HIGH';

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: `1px solid ${isHighRisk ? tm.color + '55' : 'var(--border-card)'}`,
      boxShadow: isHighRisk
        ? `0 0 0 3px ${tm.color}18, 0 2px 8px rgba(0,0,0,0.06)`
        : '0 1px 4px rgba(0,0,0,0.04)',
      overflow: 'hidden',
      animation: 'fadeIn 0.2s ease',
    }}>
      {/* ── Coloured header bar ── */}
      <div style={{
        background: `linear-gradient(135deg, ${tm.color}, ${tm.color}cc)`,
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{tm.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {tm.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {item.resubmitted && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.25)', color: '#fff' }}>
              🔄 RESUBMITTED
            </span>
          )}
          {sev && (
            <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99, background: 'rgba(0,0,0,0.18)', color: '#fff' }}>
              {item.severity} RISK
            </span>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: '14px 16px' }}>
        {isOverride && (
          <div style={{ display:'flex', alignItems:'center', gap:8, background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'7px 11px', marginBottom:12, fontSize:11 }}>
            <span>⚠️</span>
            <span style={{ color:'#92400e', fontWeight:600 }}>Primary verifier: <strong>{RECORD_TYPE_OWNER[item.referenceType]}</strong>. You are verifying as a management override.</span>
          </div>
        )}
        {/* Summary + context */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', lineHeight: 1.4 }}>{item.summary}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{item.context}</div>
        </div>

        {/* Meta chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 500 }}>
            👤 {item.submittedBy}
          </span>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 500 }}>
            📅 {fmtDate(item.date)}
          </span>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 500 }}>
            🕐 {timeAgo(item.date)}
          </span>
          {item.costAtTime && (
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>
              💰 {fmtCur(item.costAtTime)}
            </span>
          )}
          {item.layingRate && (
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#fefce8', color: '#a16207', fontWeight: 600 }}>
              🥚 {Number(item.layingRate).toFixed(1)}% lay rate
            </span>
          )}
        </div>

        {/* Action buttons */}
        {canVerify && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onAction(item, 'verify')} style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              border: '1.5px solid #16a34a',
              background: '#f0fdf4', color: '#16a34a', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>✅ Verify</button>
            <button onClick={() => onAction(item, 'discrepancy')} style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              border: '1.5px solid #d97706',
              background: '#fffbeb', color: '#d97706', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>⚠️ Discrepancy</button>
            {canReject && (
              <button onClick={() => onAction(item, 'reject')} style={{
                flex: 1, padding: '8px 0', borderRadius: 8,
                border: '1.5px solid #dc2626',
                background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>↩️ Reject</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function VerificationPage() {
  const { user, apiFetch } = useAuth();

  const [activeTab,     setActiveTab]     = useState('pending');
  const [pendingQueue,  setPendingQueue]  = useState([]);
  const [verifications, setVerifications] = useState([]);
  const [summary,       setSummary]       = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [tabLoading,    setTabLoading]    = useState(false);
  const [typeFilter,    setTypeFilter]    = useState('ALL');
  const [actionModal,   setActionModal]   = useState(null); // { item, action }
  const [toast,         setToast]         = useState(null);


  const canVerify  = VERIFIER_ROLES.includes(user?.role);
  const canReject  = REJECT_ROLES.includes(user?.role);
  const canManage  = MANAGER_ROLES.includes(user?.role);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };


  // ── Fetch pending queue ───────────────────────────────────────────────────
  const fetchPending = useCallback(async () => {
    try {
      const qs  = typeFilter !== 'ALL' ? `?pendingOnly=true&type=${typeFilter}` : '?pendingOnly=true';
      const res = await apiFetch(`/api/verification${qs}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error);
      setPendingQueue(d.pendingQueue || []);
      setSummary(d.summary);
    } catch (e) { showToast(e.message, 'error'); }
  }, [typeFilter]);

  // ── Fetch verification history ────────────────────────────────────────────
  const fetchVerifications = useCallback(async (status) => {
    try {
      const qs  = status ? `?status=${status}` : '';
      const res = await apiFetch(`/api/verification${qs}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error);
      setVerifications(d.verifications || []);
      if (!summary) setSummary(d.summary);
    } catch (e) { showToast(e.message, 'error'); }
  }, [summary]);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchPending();
      setLoading(false);
    })();
  }, [fetchPending]);

  // Tab switch
  useEffect(() => {
    if (activeTab === 'pending') return;
    setTabLoading(true);
    const statusMap = { verified: 'VERIFIED', discrepancies: 'DISCREPANCY_FOUND,ESCALATED' };
    fetchVerifications(statusMap[activeTab]).finally(() => setTabLoading(false));
  }, [activeTab, fetchVerifications]);

  // Re-fetch when type filter changes
  useEffect(() => {
    if (activeTab === 'pending') fetchPending();
  }, [typeFilter, activeTab, fetchPending]);

  // ── Filtered pending queue ────────────────────────────────────────────────
  const filteredPending = typeFilter === 'ALL'
    ? pendingQueue
    : pendingQueue.filter(i => i.type === typeFilter);

  // ── Action handler ────────────────────────────────────────────────────────
  const handleAction = async (item, action, { notes, amount } = {}) => {

    if (action === 'verify' || action === 'discrepancy') {
      // POST new verification
      const res = await apiFetch('/api/verification', {
        method:  'POST',
        body: JSON.stringify({
          verificationType:  item.type,
          referenceId:       item.referenceId,
          referenceType:     item.referenceType,
          verificationDate:  new Date().toISOString().slice(0, 10),
          status:            action === 'verify' ? 'VERIFIED' : 'DISCREPANCY_FOUND',
          discrepancyAmount: amount || null,
          discrepancyNotes:  notes || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      showToast(action === 'verify' ? 'Record verified successfully' : 'Discrepancy flagged — managers notified');

    } else if (action === 'reject') {
      // Always use the verification id embedded in the pending item (avoids stale state)
      if (item.verificationId) {
        // Existing verification record — PATCH directly
        const res = await apiFetch(`/api/verification/${item.verificationId}`, {
          method:  'PATCH',
          body: JSON.stringify({ reject: true, rejectReason: notes }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
      } else {
        // No verification record yet — create one then immediately reject it
        const res = await apiFetch('/api/verification', {
          method:  'POST',
          body: JSON.stringify({
            verificationType:  item.type,
            referenceId:       item.referenceId,
            referenceType:     item.referenceType,
            verificationDate:  new Date().toISOString().slice(0, 10),
            status:            'DISCREPANCY_FOUND',
            discrepancyNotes:  notes,
          }),
        });
        const created = await res.json();
        if (!res.ok) throw new Error(created.error);

        const res2 = await apiFetch(`/api/verification/${created.verification.id}`, {
          method:  'PATCH',
          body: JSON.stringify({ reject: true, rejectReason: notes }),
        });
        const d2 = await res2.json();
        if (!res2.ok) throw new Error(d2.error);
      }
      showToast('Record rejected — worker notified to resubmit');
    }

    setActionModal(null);
    // Refresh pending queue
    await fetchPending();
  };

  // ── Escalate / Resolve existing verification ──────────────────────────────
  const handleVerificationAction = async (v, action, { notes } = {}) => {
    const res = await apiFetch(`/api/verification/${v.id}`, {
      method:  'PATCH',
      body: JSON.stringify({
        status:   action === 'escalate' ? 'ESCALATED' : 'RESOLVED',
        discrepancyNotes: notes,
        resolution: action === 'resolve' ? notes : undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);

    showToast(action === 'escalate' ? 'Escalated to farm manager' : 'Discrepancy resolved');
    setActionModal(null);
    fetchVerifications('DISCREPANCY_FOUND,ESCALATED');
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <style>{`
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInUp{ from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        .vr-table tr:hover td { background: var(--bg-hover) !important; }
        .tab-btn:hover { background: var(--bg-hover) !important; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.type === 'success' ? '#166534' : '#991b1b',
          color: '#fff', padding: '12px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          animation: 'fadeIn 0.25s ease',
        }}>{toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}</div>
      )}

      {/* Page header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 26 }}>✅</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif", margin: 0 }}>
              Verification & Reconciliation
            </h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Review and approve worker submissions across all modules
          </p>
        </div>
        {summary?.totalPending > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
            <span style={{ fontSize: 16 }}>⏳</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#d97706' }}>{summary.totalPending} item{summary.totalPending !== 1 ? 's' : ''} awaiting verification</span>
          </div>
        )}
      </div>

      {/* Stat cards */}
      {!loading && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14, marginBottom: 24 }}>
          <StatCard icon="⏳" label="Pending Review"     value={summary.totalPending}                      sub="Across all modules" accent="#d97706" urgent={summary.totalPending > 10} />
          <StatCard icon="⚠️" label="Discrepancies"      value={summary.discrepancies}                     sub="Needs attention"    accent="#dc2626" urgent={summary.discrepancies > 0} />
          <StatCard icon="🔺" label="Escalated"          value={summary.escalated}                         sub="Awaiting manager"   accent="#9333ea" urgent={summary.escalated > 0} />
          <StatCard icon="🥚" label="Production Pending" value={summary.byType?.DAILY_PRODUCTION || 0}     sub="Daily reports"      accent="#6c63ff" />
          <StatCard icon="💀" label="Mortality Pending"  value={summary.byType?.MORTALITY_REPORT || 0}     sub="Needs review"       accent="#ef4444" urgent={(summary.byType?.MORTALITY_REPORT || 0) > 0} />
          <StatCard icon="🌾" label="Feed Pending"       value={summary.byType?.FEED_RECEIPT || 0}         sub="Consumption & receipts" accent="#f59e0b" />
        </div>
      )}

      {/* Main card */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-card)', padding: '0 6px', gap: 2 }}>
          {TABS.map(tab => {
            const labels = {
              pending:       `⏳ Pending${summary?.totalPending ? ` (${summary.totalPending})` : ''}`,
              verified:      '✅ Verified',
              discrepancies: `⚠️ Discrepancies${summary?.discrepancies ? ` (${summary.discrepancies})` : ''}`,
            };
            const active = activeTab === tab;
            return (
              <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)} style={{
                padding: '13px 16px', fontSize: 13, fontWeight: active ? 700 : 600,
                color: active ? 'var(--purple)' : 'var(--text-secondary)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderBottom: active ? '2px solid var(--purple)' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}>{labels[tab]}</button>
            );
          })}
        </div>

        {/* ── PENDING TAB ── */}
        {activeTab === 'pending' && (
          <div>
            {/* Type filter */}
            <div style={{ display: 'flex', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border-card)', flexWrap: 'wrap' }}>
              {['ALL', ...Object.keys(TYPE_META)].map(t => {
                const m   = TYPE_META[t];
                const cnt = t === 'ALL' ? summary?.totalPending : summary?.byType?.[t] || 0;
                return (
                  <button key={t} onClick={() => setTypeFilter(t)} style={{
                    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    border: `1px solid ${typeFilter === t ? 'var(--purple)' : 'var(--border)'}`,
                    background: typeFilter === t ? 'var(--purple-light)' : '#fff',
                    color: typeFilter === t ? 'var(--purple)' : 'var(--text-secondary)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                  }}>
                    {m ? m.icon : '📄'} {m ? m.label : 'All'}
                    {cnt > 0 && <span style={{ background: typeFilter === t ? 'var(--purple)' : '#e2e8f0', color: typeFilter === t ? '#fff' : '#64748b', borderRadius: 99, padding: '1px 6px', fontSize: 10 }}>{cnt}</span>}
                  </button>
                );
              })}
            </div>

            {/* Cards grid */}
            <div style={{ padding: 16 }}>
              {loading ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ background: '#f8fafc', borderRadius: 12, height: 140, animation: 'pulse 1.5s ease-in-out infinite' }} />
                  ))}
                </div>
              ) : filteredPending.length === 0 ? (
                <EmptyState icon="✅" title="All caught up!" sub={typeFilter === 'ALL' ? 'No records awaiting verification' : `No pending ${TYPE_META[typeFilter]?.label || typeFilter} records`} />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  {filteredPending.map(item => (
                    <PendingCard
                      key={item.id}
                      item={item}
                      userRole={user?.role}
                      canReject={canReject}
                      onAction={(item, action) => setActionModal({ item, action })}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── VERIFIED TAB ── */}
        {activeTab === 'verified' && (
          <div style={{ overflowX: 'auto' }}>
            <table className="vr-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-base)' }}>
                  {['Date', 'Type', 'Reference', 'Status', 'Verified By', 'Notes'].map(h => (
                    <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-card)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabLoading ? <LoadingRows cols={6} /> :
                 verifications.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState icon="📋" title="No verified records yet" sub="Verified records will appear here" /></td></tr>
                ) : verifications.map(v => (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--border-card)' }}>
                    <td style={{ padding: '13px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(v.verificationDate)}</td>
                    <td style={{ padding: '13px 16px' }}><TypeBadge type={v.verificationType} /></td>
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.referenceType} · {v.referenceId.slice(0, 8)}…</td>
                    <td style={{ padding: '13px 16px' }}><StatusBadge status={v.status} /></td>
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-secondary)' }}>
                      {v.verifiedBy ? `${v.verifiedBy.firstName} ${v.verifiedBy.lastName}` : '—'}
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.discrepancyNotes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── DISCREPANCIES TAB ── */}
        {activeTab === 'discrepancies' && (
          <div style={{ overflowX: 'auto' }}>
            <table className="vr-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-base)' }}>
                  {['Date', 'Type', 'Notes', 'Amount', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-card)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabLoading ? <LoadingRows cols={6} /> :
                 verifications.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState icon="🎉" title="No discrepancies" sub="All records are clean" /></td></tr>
                ) : verifications.map(v => (
                  <tr key={v.id} style={{ borderBottom: '1px solid var(--border-card)' }}>
                    <td style={{ padding: '13px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(v.verificationDate)}</td>
                    <td style={{ padding: '13px 16px' }}><TypeBadge type={v.verificationType} /></td>
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.discrepancyNotes || '—'}
                    </td>
                    <td style={{ padding: '13px 16px', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
                      {v.discrepancyAmount ? fmtCur(v.discrepancyAmount) : '—'}
                    </td>
                    <td style={{ padding: '13px 16px' }}><StatusBadge status={v.status} /></td>
                    <td style={{ padding: '13px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {v.status === 'DISCREPANCY_FOUND' && canVerify && (
                          <button onClick={() => setActionModal({ item: { ...v, summary: v.discrepancyNotes, context: v.referenceType, submittedBy: v.verifiedBy?.firstName, date: v.verificationDate }, action: 'escalate', verificationId: v.id })}
                            style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, background: '#fdf4ff', color: '#9333ea', border: '1px solid #e9d5ff', cursor: 'pointer' }}>
                            🔺 Escalate
                          </button>
                        )}
                        {(v.status === 'DISCREPANCY_FOUND' || v.status === 'ESCALATED') && canManage && (
                          <button onClick={() => setActionModal({ item: { ...v, summary: v.discrepancyNotes, context: v.referenceType, submittedBy: v.verifiedBy?.firstName, date: v.verificationDate }, action: 'resolve', verificationId: v.id })}
                            style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', cursor: 'pointer' }}>
                            ✓ Resolve
                          </button>
                        )}
                        {v.status === 'RESOLVED' && (
                          <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓ Resolved</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {actionModal && (
        <ActionModal
          item={actionModal.item}
          action={actionModal.action}
          onClose={() => setActionModal(null)}
          onConfirm={async ({ notes, amount }) => {
            if (actionModal.verificationId) {
              await handleVerificationAction(
                { id: actionModal.verificationId },
                actionModal.action,
                { notes }
              );
            } else {
              await handleAction(actionModal.item, actionModal.action, { notes, amount });
            }
          }}
        />
      )}
    </AppShell>
  );
}
