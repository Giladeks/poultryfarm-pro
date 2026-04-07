'use client';
// app/egg-store/page.js — Egg Store Receipt Acknowledgement
//
// Dedicated page for Store Manager / Store Clerk to acknowledge receipt of
// PM-graded eggs from the pen, and for IC / FM to resolve disputes.
//
// Card structure mirrors feed-requisitions:
//   Pen+Session group card (header shows aggregated totals)
//   └── Section row (one per eggProduction record) with individual action buttons
//
// Tabs (role-aware):
//   STORE_MANAGER / STORE_CLERK  → Awaiting Receipt | Disputed | Acknowledged | All
//   INTERNAL_CONTROL / FM+       → same tabs + Disputes tab is their action queue
//
// Actions per section row:
//   PENDING   → [✓ Acknowledge]  [⚑ Dispute]        (Store)
//   DISPUTED  → [↩ Withdraw]                          (Store — own dispute only)
//   DISPUTED  → [✓ Force Accept] [🔄 Request Recount] (IC / FM)

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import AppShell   from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const STORE_ROLES = ['STORE_MANAGER', 'STORE_CLERK'];
const IC_ROLES    = ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const ALL_ROLES   = [...STORE_ROLES, ...IC_ROLES];

const STATUS_META = {
  PENDING:           { label: 'Awaiting Receipt', color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '⏳' },
  ACKNOWLEDGED:      { label: 'Acknowledged',     color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: '✓'  },
  DISPUTED:          { label: 'Disputed',          color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '⚑'  },
  FORCE_ACCEPTED:    { label: 'Force Accepted',    color: '#6c63ff', bg: '#f5f3ff', border: '#ddd6fe', icon: '✓'  },
  RECOUNT_REQUESTED: { label: 'Recount Requested', color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', icon: '🔄' },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt     = n  => Number(n || 0).toLocaleString('en-NG');
const fmtDate = d  => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) : '';

function crateDisplay(count, label) {
  if (!count && count !== 0) return null;
  const crates = Math.floor(count / 30);
  const loose  = count % 30;
  if (crates === 0 && loose === 0) return `0 ${label}`;
  if (loose === 0)  return `${fmt(crates)} crate${crates !== 1 ? 's' : ''} ${label}`;
  if (crates === 0) return `${loose} loose ${label}`;
  return `${fmt(crates)} crates + ${loose} loose ${label}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type === 'error' ? '#991b1b' : type === 'warn' ? '#92400e' : '#166534';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: bg, color: '#fff', padding: '12px 20px', borderRadius: 10,
      fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      animation: 'fadeIn 0.2s ease', maxWidth: 360,
    }}>
      {type === 'error' ? '✕ ' : type === 'warn' ? '⚠️ ' : '✓ '}{msg}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION MODAL — dispute notes / resolution notes
// ─────────────────────────────────────────────────────────────────────────────
function ActionModal({ record, action, apiFetch, onClose, onDone }) {
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const META = {
    dispute:         { title: '⚑ Raise Dispute',       btnLabel: 'Raise Dispute',      btnColor: '#dc2626', label: 'Describe the discrepancy *', placeholder: 'e.g. Only 14 Grade A crates received, PM graded 16…' },
    force_accept:    { title: '✓ Force Accept',         btnLabel: 'Force Accept',        btnColor: '#6c63ff', label: 'Resolution notes *',         placeholder: 'e.g. Physical recount confirmed PM\'s figures are correct…' },
    request_recount: { title: '🔄 Request Recount',     btnLabel: 'Request Recount',     btnColor: '#f59e0b', label: 'Recount instructions *',      placeholder: 'e.g. PM to recount Grade A crates in Section B…' },
  };

  const m = META[action];
  if (!m) return null;

  const submit = async () => {
    if (!notes.trim()) { setErr(`${m.label.replace(' *', '')} is required`); return; }
    setSaving(true); setErr('');
    try {
      const res = await apiFetch(`/api/egg-store/${record.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ action, [`${action === 'dispute' ? 'dispute' : 'resolution'}Notes`]: notes.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Action failed'); return; }
      onDone();
    } catch { setErr('Network error — please try again'); }
    finally  { setSaving(false); }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: '0 12px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-card,#e8edf5)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Poppins',sans-serif" }}>{m.title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}>×</button>
        </div>

        {/* Record context */}
        <div style={{ padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid var(--border-card,#e8edf5)', fontSize: 12 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary,#0f172a)' }}>
            {record.penName} · {record.sectionName}
          </div>
          <div style={{ color: '#64748b', marginTop: 2 }}>
            {record.batchCode} · {record.sessionLabel} · {fmtDate(record.collectionDate)}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 16, fontSize: 11, color: '#64748b' }}>
            <span>Grade A: <strong>{crateDisplay(record.gradedGradeACount, '')}</strong></span>
            <span>Grade B: <strong>{crateDisplay(record.gradedGradeBCount, '')}</strong></span>
            <span>Cracked: <strong>{fmt(record.gradedCrackedCount)}</strong></span>
          </div>
        </div>

        {/* Notes input */}
        <div style={{ padding: '16px 20px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
            {m.label}
          </label>
          <textarea
            rows={3}
            value={notes}
            onChange={e => { setNotes(e.target.value); setErr(''); }}
            placeholder={m.placeholder}
            style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: `1px solid ${err ? '#fecaca' : '#e2e8f0'}`, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            autoFocus
          />
          {err && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>⚠ {err}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-card,#e8edf5)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#475569' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: saving ? '#94a3b8' : m.btnColor, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : m.btnLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION ROW — one per eggProduction record inside a pen+session group card
// ─────────────────────────────────────────────────────────────────────────────
function SectionRow({ record, userRole, userId, onAction, onSimpleAction }) {
  const sm = STATUS_META[record.status] || STATUS_META.PENDING;

  const isStore   = STORE_ROLES.includes(userRole);
  const isIC      = IC_ROLES.includes(userRole);

  const canAcknowledge = isStore && record.status === 'PENDING';
  const canDispute     = isStore && record.status === 'PENDING';
  const canWithdraw    = isStore && record.status === 'DISPUTED' && record.disputedBy?.id === userId;
  const canForceAccept = isIC    && record.status === 'DISPUTED';
  const canRecount     = isIC    && record.status === 'DISPUTED';

  const btnSt = (color) => ({
    padding: '5px 11px', borderRadius: 7,
    border: `1px solid ${color}40`,
    background: `${color}12`, color,
    fontSize: 10, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 16px',
      borderBottom: '1px solid #f0f4f8',
      background: record.status === 'DISPUTED' ? '#fff7ed' : '#fff',
    }}>
      {/* Status pill */}
      <div style={{
        flexShrink: 0, marginTop: 2,
        padding: '2px 8px', borderRadius: 20,
        background: sm.bg, border: `1px solid ${sm.border}`,
        fontSize: 10, fontWeight: 700, color: sm.color,
        whiteSpace: 'nowrap',
      }}>
        {sm.icon} {sm.label}
      </div>

      {/* Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Section + worker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary,#0f172a)' }}>
            {record.sectionName}
          </span>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            · {record.batchCode}
          </span>
          {record.deliveredBy && (
            <span style={{ fontSize: 11, color: '#6c63ff', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
              🧑‍🌾 {record.deliveredBy.firstName} {record.deliveredBy.lastName}
            </span>
          )}
        </div>

        {/* Grade breakdown */}
        <div style={{ display: 'flex', gap: 16, marginTop: 5, fontSize: 12, flexWrap: 'wrap' }}>
          <span style={{ color: '#16a34a' }}>
            <strong>A:</strong> {record.gradedGradeACrates} crate{record.gradedGradeACrates !== 1 ? 's' : ''}
            {record.gradedGradeALoose > 0 && ` + ${record.gradedGradeALoose} loose`}
            {' '}({fmt(record.gradedGradeACount)} eggs)
          </span>
          <span style={{ color: '#d97706' }}>
            <strong>B:</strong> {record.gradedGradeBCrates} crate{record.gradedGradeBCrates !== 1 ? 's' : ''}
            {record.gradedGradeBLoose > 0 && ` + ${record.gradedGradeBLoose} loose`}
            {' '}({fmt(record.gradedGradeBCount)} eggs)
          </span>
          <span style={{ color: '#ef4444' }}>
            <strong>Cracked:</strong> {fmt(record.gradedCrackedCount)}
          </span>
          <span style={{ color: '#475569', fontWeight: 600 }}>
            Total: {fmt(record.gradedTotalEggs)}
          </span>
        </div>

        {/* Dispute / resolution info */}
        {record.status === 'DISPUTED' && record.disputeNotes && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#c2410c', background: '#fff7ed', borderRadius: 6, padding: '4px 8px', border: '1px solid #fed7aa' }}>
            ⚑ {record.disputeNotes}
            {record.disputedBy && ` — flagged by ${record.disputedBy.firstName} ${record.disputedBy.lastName}`}
          </div>
        )}
        {(record.status === 'FORCE_ACCEPTED' || record.status === 'RECOUNT_REQUESTED') && record.resolutionNotes && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#475569', background: '#f8fafc', borderRadius: 6, padding: '4px 8px', border: '1px solid #e2e8f0' }}>
            {record.status === 'FORCE_ACCEPTED' ? '✓' : '🔄'} {record.resolutionNotes}
            {record.resolvedBy && ` — ${record.resolvedBy.firstName} ${record.resolvedBy.lastName}`}
          </div>
        )}
        {record.status === 'ACKNOWLEDGED' && record.acknowledgedAt && (
          <div style={{ marginTop: 4, fontSize: 11, color: '#16a34a' }}>
            ✓ Received {fmtDate(record.acknowledgedAt)} {fmtTime(record.acknowledgedAt)}
            {record.acknowledgedBy && ` · ${record.acknowledgedBy.firstName} ${record.acknowledgedBy.lastName}`}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, alignSelf: 'center' }}>
        {canAcknowledge && (
          <button onClick={() => onSimpleAction(record, 'acknowledge')} style={btnSt('#16a34a')}>✓ Acknowledge</button>
        )}
        {canDispute && (
          <button onClick={() => onAction(record, 'dispute')} style={btnSt('#dc2626')}>⚑ Dispute</button>
        )}
        {canWithdraw && (
          <button onClick={() => onSimpleAction(record, 'withdraw')} style={btnSt('#d97706')}>↩ Withdraw</button>
        )}
        {canForceAccept && (
          <button onClick={() => onAction(record, 'force_accept')} style={btnSt('#6c63ff')}>✓ Force Accept</button>
        )}
        {canRecount && (
          <button onClick={() => onAction(record, 'request_recount')} style={btnSt('#f59e0b')}>🔄 Request Recount</button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PEN SESSION GROUP CARD
// ─────────────────────────────────────────────────────────────────────────────
function PenSessionCard({ group, userRole, userId, onAction, onSimpleAction }) {
  const [expanded, setExpanded] = useState(group.groupStatus === 'PENDING' || group.groupStatus === 'DISPUTED');

  const headerColor =
    group.groupStatus === 'DISPUTED'    ? '#dc2626' :
    group.groupStatus === 'PENDING'     ? '#d97706' :
    group.groupStatus === 'ACKNOWLEDGED'? '#16a34a' : '#6c63ff';

  const headerBorder =
    group.groupStatus === 'DISPUTED'    ? '#fecaca' :
    group.groupStatus === 'PENDING'     ? '#fde68a' :
    group.groupStatus === 'ACKNOWLEDGED'? '#bbf7d0' : '#ddd6fe';

  const pendingCount   = group.records.filter(r => r.status === 'PENDING').length;
  const disputedCount  = group.records.filter(r => r.status === 'DISPUTED').length;

  return (
    <div style={{
      background: '#fff', borderRadius: 12,
      borderTop:    `1px solid ${headerBorder}`,
      borderRight:  `1px solid ${headerBorder}`,
      borderBottom: `1px solid ${headerBorder}`,
      borderLeft:   `4px solid ${headerColor}`,
      overflow: 'hidden',
    }}>
      {/* Group header — click to expand/collapse */}
      <div
        onClick={() => setExpanded(p => !p)}
        style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, userSelect: 'none' }}
      >
        {/* Pen + session info */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Poppins',sans-serif", fontSize: 14, fontWeight: 700, color: 'var(--text-primary,#0f172a)' }}>
              {group.penName}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: group.collectionSession === 1 ? '#f0fdf4' : '#eff6ff',
              color:      group.collectionSession === 1 ? '#166534'  : '#1d4ed8',
              border:     `1px solid ${group.collectionSession === 1 ? '#bbf7d0' : '#bfdbfe'}`,
            }}>
              {group.sessionLabel} Session
            </span>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {fmtDate(group.collectionDate)}
            </span>
            {pendingCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 99, padding: '1px 7px' }}>
                {pendingCount} awaiting
              </span>
            )}
            {disputedCount > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 99, padding: '1px 7px' }}>
                {disputedCount} disputed
              </span>
            )}
          </div>

          {/* Aggregated totals row */}
          <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
            <span>{group.records.length} section{group.records.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span><strong style={{ color: '#0f172a' }}>{fmt(group.totalEggs)}</strong> total eggs</span>
            <span>·</span>
            <span style={{ color: '#16a34a' }}>A: {fmt(group.gradeACrates)} crates{group.gradeALoose > 0 ? ` + ${group.gradeALoose} loose` : ''}</span>
            <span>·</span>
            <span style={{ color: '#d97706' }}>B: {fmt(group.gradeBCrates)} crates{group.gradeBLoose > 0 ? ` + ${group.gradeBLoose} loose` : ''}</span>
            <span>·</span>
            <span style={{ color: '#ef4444' }}>Cracked: {fmt(group.crackedCount)}</span>
          </div>
        </div>

        {/* Chevron */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Section rows */}
      {expanded && (
        <div style={{ borderTop: '1px solid #f0f4f8' }}>
          {group.records.map(record => (
            <SectionRow
              key={record.id}
              record={record}
              userRole={userRole}
              userId={userId}
              onAction={onAction}
              onSimpleAction={onSimpleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON
// ─────────────────────────────────────────────────────────────────────────────
function Skel({ h = 80 }) {
  return (
    <div style={{
      height: h, borderRadius: 12,
      background: 'linear-gradient(90deg,#f0f4f8 25%,#e2e8f0 50%,#f0f4f8 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

function Empty({ icon, title, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: '#64748b' }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12 }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function EggStorePage() {
  const { user, apiFetch, loading: authLoading } = useAuth();
  const role   = user?.role;
  const userId = user?.id || user?.sub;

  const isStore = STORE_ROLES.includes(role);
  const isIC    = IC_ROLES.includes(role);

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab,    setActiveTab]    = useState('pending');
  const [days,         setDays]         = useState(7);
  const [groups,       setGroups]       = useState([]);
  const [summary,      setSummary]      = useState({});
  const [loading,      setLoading]      = useState(true);
  const [actionModal,  setActionModal]  = useState(null); // { record, action }
  const [toast,        setToast]        = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Tab config ──────────────────────────────────────────────────────────────
  const TABS = [
    {
      key: 'pending', label: 'Awaiting Receipt',
      roles: ALL_ROLES,
      badge: summary.pending || null,
    },
    {
      key: 'disputed', label: 'Disputed',
      roles: ALL_ROLES,
      badge: summary.disputed || null,
    },
    {
      key: 'acknowledged', label: 'Acknowledged',
      roles: ALL_ROLES,
      badge: null,
    },
    {
      key: 'all', label: 'All',
      roles: ALL_ROLES,
      badge: null,
    },
  ].filter(t => t.roles.includes(role));

  // ── Data loader ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!role || !ALL_ROLES.includes(role)) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (activeTab === 'pending')     params.set('status', 'PENDING');
      if (activeTab === 'disputed')    params.set('status', 'DISPUTED');
      if (activeTab === 'acknowledged')params.set('status', 'ACKNOWLEDGED');
      // 'all' — no status filter

      const res = await apiFetch(`/api/egg-store?${params.toString()}`);
      if (!res?.ok) return;
      const d = await res.json();
      setGroups(d.groups || []);
      setSummary(d.summary || {});
    } catch { /* silent */ }
    finally  { setLoading(false); }
  }, [apiFetch, activeTab, days, role]);

  useEffect(() => { if (!authLoading) load(); }, [load, authLoading]);

  // ── Simple action (no modal needed — acknowledge / withdraw) ───────────────
  const handleSimpleAction = async (record, action) => {
    try {
      const res = await apiFetch(`/api/egg-store/${record.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!res.ok) { showToast(d.error || 'Action failed', 'error'); return; }
      showToast(
        action === 'acknowledge' ? `✓ Receipt confirmed — ${record.sectionName}` :
        action === 'withdraw'    ? `↩ Dispute withdrawn — ${record.sectionName}` :
        'Done'
      );
      load();
    } catch { showToast('Network error', 'error'); }
  };

  // ── Modal action (dispute / force_accept / request_recount) ───────────────
  const handleAction    = (record, action) => setActionModal({ record, action });
  const handleModalDone = () => {
    setActionModal(null);
    showToast('Action completed ✓');
    load();
  };

  // ── Auth guard ─────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <AppShell>
        <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading…</div>
      </AppShell>
    );
  }

  if (!ALL_ROLES.includes(role)) {
    return (
      <AppShell>
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
          <div style={{ fontWeight: 700 }}>Access Restricted</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Egg Store is available to Store Managers, Store Clerks, and Internal Control.</div>
        </div>
      </AppShell>
    );
  }

  // ── KPI summary cards ──────────────────────────────────────────────────────
  const kpis = [
    { label: 'Awaiting Receipt', value: summary.pending        || 0, color: '#d97706', icon: '⏳' },
    { label: 'Disputed',         value: summary.disputed       || 0, color: '#dc2626', icon: '⚑',  urgent: (summary.disputed || 0) > 0 },
    { label: 'Acknowledged',     value: summary.acknowledged   || 0, color: '#16a34a', icon: '✓'  },
    { label: 'Total Today',      value: summary.total          || 0, color: '#6c63ff', icon: '🥚' },
  ];

  return (
    <AppShell>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        {/* ── Page header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>
              🥚 Egg Store
            </h1>
            <p style={{ color: '#64748b', fontSize: 12, marginTop: 3, margin: 0 }}>
              {isStore ? 'Acknowledge receipt of PM-graded eggs from the pen' : 'Review and resolve egg receipt discrepancies'}
            </p>
          </div>

          {/* Date range picker */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[
              { label: 'Today', val: 1 },
              { label: '3d',    val: 3 },
              { label: '7d',    val: 7 },
              { label: '14d',   val: 14 },
            ].map(({ label, val }) => (
              <button key={val} onClick={() => setDays(val)} style={{
                fontSize: 11, padding: '5px 10px', borderRadius: 20, cursor: 'pointer',
                background: days === val ? 'var(--purple-light,#eeecff)' : '#fff',
                color:      days === val ? 'var(--purple,#6c63ff)'        : '#64748b',
                border:     `1px solid ${days === val ? '#d4d8ff' : '#e2e8f0'}`,
                fontWeight: days === val ? 700 : 500,
                fontFamily: 'inherit',
              }}>
                {label}
              </button>
            ))}
            <button onClick={load} title="Refresh" style={{ fontSize: 13, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontFamily: 'inherit' }}>↺</button>
          </div>
        </div>

        {/* ── KPI cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {kpis.map(k => (
            <div key={k.label} style={{
              background: k.urgent ? '#fef2f2' : '#fff',
              borderTop:    `1px solid ${k.urgent ? '#fecaca' : '#e2e8f0'}`,
              borderRight:  `1px solid ${k.urgent ? '#fecaca' : '#e2e8f0'}`,
              borderBottom: `1px solid ${k.urgent ? '#fecaca' : '#e2e8f0'}`,
              borderLeft:   `4px solid ${k.color}`,
              borderRadius: 12, padding: '14px 16px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                {k.icon} {k.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: k.urgent ? '#dc2626' : k.color, lineHeight: 1 }}>
                {k.value}
              </div>
            </div>
          ))}
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', gap: 4, background: '#f8fafc', borderRadius: 11, padding: 4, border: '1px solid #e2e8f0', marginBottom: 20, width: 'fit-content', flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: 'none',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.15s',
              background: activeTab === t.key ? '#fff' : 'transparent',
              color:      activeTab === t.key ? 'var(--purple,#6c63ff)' : '#64748b',
              boxShadow:  activeTab === t.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            }}>
              {t.label}
              {t.badge > 0 && (
                <span style={{ background: activeTab === t.key ? 'var(--purple,#6c63ff)' : '#94a3b8', color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 800, padding: '1px 6px' }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => <Skel key={i} h={100} />)}
          </div>
        ) : groups.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf5' }}>
            {activeTab === 'pending'     && <Empty icon="✅" title="All caught up" sub="No egg batches awaiting receipt confirmation." />}
            {activeTab === 'disputed'    && <Empty icon="🎉" title="No disputes" sub="All receipts have been cleanly acknowledged." />}
            {activeTab === 'acknowledged'&& <Empty icon="📦" title="No acknowledged receipts" sub="Confirmed receipts will appear here." />}
            {activeTab === 'all'         && <Empty icon="🥚" title="No records" sub="Egg store receipts will appear here once PM grading begins." />}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(summary.disputed || 0) > 0 && activeTab !== 'disputed' && isIC && (
              <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#991b1b', fontWeight: 600 }}>
                ⚑ {summary.disputed} disputed receipt{summary.disputed !== 1 ? 's' : ''} require{summary.disputed === 1 ? 's' : ''} your review
              </div>
            )}
            {groups.map((group, i) => (
              <PenSessionCard
                key={`${group.penId}|${group.collectionDate}|${group.collectionSession}`}
                group={group}
                userRole={role}
                userId={userId}
                onAction={handleAction}
                onSimpleAction={handleSimpleAction}
              />
            ))}
          </div>
        )}

      </div>

      {/* ── Action modal ── */}
      {actionModal && (
        <ActionModal
          record={actionModal.record}
          action={actionModal.action}
          apiFetch={apiFetch}
          onClose={() => setActionModal(null)}
          onDone={handleModalDone}
        />
      )}

      {/* ── Toast ── */}
      <Toast msg={toast?.msg} type={toast?.type} />

      {/* Shimmer animation */}
      <style>{`
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes fadeIn  { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      `}</style>
    </AppShell>
  );
}
