'use client';
// app/audit/page.js — Audit Log + IC Investigation Flow
import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell   from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ── Role helpers ──────────────────────────────────────────────────────────────
const IC_ROLES      = ['INTERNAL_CONTROL', 'SUPER_ADMIN'];
const RESOLVE_ROLES = ['CHAIRPERSON', 'FARM_ADMIN', 'SUPER_ADMIN'];

// ── Meta ──────────────────────────────────────────────────────────────────────
const ACTION_META = {
  LOGIN:       { label: 'Login',       color: '#3b82f6', bg: '#eff6ff', icon: '🔑' },
  CREATE:      { label: 'Create',      color: '#16a34a', bg: '#f0fdf4', icon: '➕' },
  UPDATE:      { label: 'Update',      color: '#f59e0b', bg: '#fffbeb', icon: '✏️' },
  DELETE:      { label: 'Delete',      color: '#ef4444', bg: '#fef2f2', icon: '🗑️' },
  APPROVE:     { label: 'Approve',     color: '#8b5cf6', bg: '#f5f3ff', icon: '✅' },
  REJECT:      { label: 'Reject',      color: '#ef4444', bg: '#fef2f2', icon: '↩️' },
  ROLE_CHANGE: { label: 'Role Change', color: '#ec4899', bg: '#fdf2f8', icon: '👤' },
};

const ENTITY_META = {
  User:            { icon: '👥', color: '#6c63ff' },
  Farm:            { icon: '🏡', color: '#16a34a' },
  Flock:           { icon: '🐦', color: '#3b82f6' },
  FeedConsumption: { icon: '🌾', color: '#f59e0b' },
  FeedInventory:   { icon: '📦', color: '#f97316' },
  FeedMillBatch:   { icon: '⚙️',  color: '#8b5cf6' },
  StoreReceipt:    { icon: '🧾', color: '#14b8a6' },
  PurchaseOrder:   { icon: '🛒', color: '#ec4899' },
  DailyReport:     { icon: '📋', color: '#64748b' },
  Verification:    { icon: '✅', color: '#22c55e' },
  Investigation:   { icon: '🚩', color: '#ef4444' },
};

const INV_STATUS_META = {
  OPEN:         { label: 'Open',         color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '🔓' },
  UNDER_REVIEW: { label: 'Under Review', color: '#6c63ff', bg: '#f5f3ff', border: '#ddd6fe', icon: '🔍' },
  ESCALATED:    { label: 'Escalated',    color: '#9333ea', bg: '#fdf4ff', border: '#e9d5ff', icon: '🔺' },
  CLOSED:       { label: 'Closed',       color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: '✓'  },
};

const ENTITY_TYPES = Object.keys(ENTITY_META);
const ACTIONS      = Object.keys(ACTION_META);

const fmtDate = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = d => new Date(d).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
const fmtTs   = d => `${fmtDate(d)} ${fmtTime(d)}`;
function timeAgo(d) {
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ActionBadge({ action }) {
  const m = ACTION_META[action] || { label: action, color: '#64748b', bg: '#f8fafc', icon: '•' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, border: `1px solid ${m.color}25`, whiteSpace: 'nowrap' }}>
      {m.icon} {m.label}
    </span>
  );
}

function EntityBadge({ type }) {
  const m = ENTITY_META[type] || { icon: '📄', color: '#64748b' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${m.color}12`, color: m.color, border: `1px solid ${m.color}25`, whiteSpace: 'nowrap' }}>
      {m.icon} {type}
    </span>
  );
}

function InvStatusBadge({ status }) {
  const m = INV_STATUS_META[status] || INV_STATUS_META.OPEN;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
      {m.icon} {m.label}
    </span>
  );
}

function RoleBadge({ role }) {
  const colors = {
    SUPER_ADMIN:      ['#ef4444','#fef2f2'],
    FARM_ADMIN:       ['#8b5cf6','#f5f3ff'],
    CHAIRPERSON:      ['#f59e0b','#fffbeb'],
    FARM_MANAGER:     ['#3b82f6','#eff6ff'],
    INTERNAL_CONTROL: ['#ef4444','#fef2f2'],
    ACCOUNTANT:       ['#14b8a6','#f0fdfa'],
    PEN_MANAGER:      ['#14b8a6','#f0fdfa'],
    PEN_WORKER:       ['#64748b','#f8fafc'],
    STORE_MANAGER:    ['#ec4899','#fdf2f8'],
    STORE_CLERK:      ['#84cc16','#f7fee7'],
  };
  const [color, bg] = colors[role] || ['#64748b','#f8fafc'];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: bg, color }}>
      {role?.replace(/_/g,' ')}
    </span>
  );
}

function Skel({ h = 40, w = '100%' }) {
  return <div style={{ height: h, width: w, background: 'var(--bg-elevated)', borderRadius: 6, animation: 'pulse 1.5s infinite' }} />;
}

// ── Flag Modal — IC Officer creates an investigation ─────────────────────────
function FlagModal({ log, onClose, onConfirm }) {
  const [reason,  setReason]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  const handleSubmit = async () => {
    if (!reason.trim()) return setError('Please describe the reason for flagging this record.');
    setSaving(true); setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 16px 56px rgba(0,0,0,0.22)', animation: 'fadeInUp 0.2s ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b', fontFamily: "'Poppins',sans-serif" }}>🚩 Flag for Investigation</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <div style={{ padding: '20px 22px' }}>
          {/* Record context */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 16, borderLeft: '3px solid #ef4444' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Record being flagged</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <EntityBadge type={log.entityType} />
              <ActionBadge action={log.action} />
            </div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>ID: {log.entityId}</div>
            {log.user && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                By {log.user.firstName} {log.user.lastName} · {fmtTs(log.createdAt)}
              </div>
            )}
          </div>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#dc2626', marginBottom: 14 }}>{error}</div>
          )}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              Reason for investigation *
            </label>
            <textarea
              rows={4}
              placeholder="Describe the anomaly or concern that warrants investigation…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? '#94a3b8' : '#ef4444', color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Flagging…' : '🚩 Flag Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Investigation Action Modal — review / escalate / close ───────────────────
function InvActionModal({ inv, action, onClose, onConfirm, chairs }) {
  const [findings,    setFindings]    = useState('');
  const [escalateTo,  setEscalateTo]  = useState(chairs?.[0]?.id || '');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState(null);

  const isEscalate = action === 'escalate';
  const isClose    = action === 'close';
  const isReview   = action === 'review';

  const title       = isEscalate ? '🔺 Escalate to Chairperson' : isClose ? '✓ Close Investigation' : '🔍 Mark Under Review';
  const confirmText = isEscalate ? 'Escalate' : isClose ? 'Close Investigation' : 'Mark Under Review';
  const confirmColor = isClose ? '#16a34a' : isEscalate ? '#9333ea' : '#6c63ff';

  const handleSubmit = async () => {
    if ((isEscalate || isClose) && !findings.trim()) return setError('Please provide findings or notes.');
    setSaving(true); setError(null);
    try {
      await onConfirm({ findings: findings.trim(), escalatedToId: isEscalate ? (escalateTo || null) : undefined });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 16px 56px rgba(0,0,0,0.22)', animation: 'fadeInUp 0.2s ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b', fontFamily: "'Poppins',sans-serif" }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>
        <div style={{ padding: '20px 22px' }}>
          {/* Investigation context */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Investigation</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>{inv.referenceType}</div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>{inv.flagReason}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              Flagged by {inv.flaggedBy?.firstName} {inv.flaggedBy?.lastName} · {timeAgo(inv.createdAt)}
            </div>
          </div>
          {isEscalate && chairs?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Escalate To</label>
              <select value={escalateTo} onChange={e => setEscalateTo(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}>
                <option value="">— Auto-assign to Chairperson —</option>
                {chairs.map(c => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName} ({c.role.replace(/_/g,' ')})</option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#dc2626', marginBottom: 14 }}>{error}</div>
          )}
          {!isReview && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                {isClose ? 'Resolution findings *' : 'Escalation notes *'}
              </label>
              <textarea rows={4}
                placeholder={isClose ? 'What was found? What action was taken?' : 'Describe findings and why Chairperson attention is needed…'}
                value={findings} onChange={e => setFindings(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
          )}
          {isReview && (
            <div style={{ padding: '12px 14px', background: '#f5f3ff', borderRadius: 10, fontSize: 13, color: '#6c63ff', fontWeight: 600 }}>
              This will mark the investigation as Under Review, signalling that you are actively examining it.
            </div>
          )}
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? '#94a3b8' : confirmColor, color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Changes diff viewer ───────────────────────────────────────────────────────
function ChangeDiff({ changes }) {
  if (!changes || Object.keys(changes).length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
  const hasBefore = changes.before !== undefined;
  const hasAfter  = changes.after  !== undefined;
  if (hasBefore || hasAfter) {
    const keys = [...new Set([...Object.keys(changes.before || {}), ...Object.keys(changes.after || {})])];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {keys.map(k => {
          const before = changes.before?.[k];
          const after  = changes.after?.[k];
          if (JSON.stringify(before) === JSON.stringify(after)) return null;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', minWidth: 80 }}>{k}</span>
              {before !== undefined && <span style={{ fontSize: 10, padding: '1px 6px', background: '#fef2f2', color: '#ef4444', borderRadius: 4, textDecoration: 'line-through' }}>{String(before)}</span>}
              {before !== undefined && after !== undefined && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>→</span>}
              {after  !== undefined && <span style={{ fontSize: 10, padding: '1px 6px', background: '#f0fdf4', color: '#16a34a', borderRadius: 4 }}>{String(after)}</span>}
            </div>
          );
        }).filter(Boolean)}
      </div>
    );
  }
  const entries = Object.entries(changes).slice(0, 6);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {entries.map(([k, v]) => (
        <span key={k} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
          <span style={{ fontWeight: 600 }}>{String(v).slice(0, 40)}</span>
        </span>
      ))}
      {Object.keys(changes).length > 6 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{Object.keys(changes).length - 6} more</span>}
    </div>
  );
}

// ── Audit row with optional flag button ───────────────────────────────────────
function AuditRow({ log, isExpanded, onToggle, canFlag, onFlag, flagged }) {
  const am = ACTION_META[log.action]     || { color: '#64748b', bg: '#f8fafc' };

  return (
    <>
      <tr
        style={{ cursor: 'pointer', background: isExpanded ? `${am.bg}` : undefined, transition: 'background 0.1s' }}
        onMouseEnter={e  => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
        onMouseLeave={e  => { if (!isExpanded) e.currentTarget.style.background = ''; }}
      >
        <td onClick={onToggle} style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtDate(log.createdAt)}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{fmtTime(log.createdAt)}</div>
        </td>
        <td onClick={onToggle} style={{ padding: '11px 16px' }}>
          {log.user ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{log.user.firstName} {log.user.lastName}</div>
              <div style={{ marginTop: 2 }}><RoleBadge role={log.user.role} /></div>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>System</span>
          )}
        </td>
        <td onClick={onToggle} style={{ padding: '11px 16px' }}><ActionBadge action={log.action} /></td>
        <td onClick={onToggle} style={{ padding: '11px 16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <EntityBadge type={log.entityType} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{log.entityId}</span>
          </div>
        </td>
        <td onClick={onToggle} style={{ padding: '11px 16px', maxWidth: 240 }}>
          <ChangeDiff changes={log.changes} />
        </td>
        <td onClick={onToggle} style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(log.createdAt)}</span>
        </td>
        <td style={{ padding: '11px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {canFlag && (
              flagged
                ? <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', padding: '3px 8px', background: '#fef2f2', borderRadius: 6, whiteSpace: 'nowrap' }}>🚩 Flagged</span>
                : <button
                    onClick={e => { e.stopPropagation(); onFlag(log); }}
                    title="Flag this record for investigation"
                    style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    🚩 Flag
                  </button>
            )}
            <span onClick={onToggle} style={{ fontSize: 14, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s', cursor: 'pointer' }}>›</span>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0, background: `${am.bg}` }}>
            <div style={{ padding: '14px 20px', borderTop: `2px solid ${am.color}20`, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Timestamp</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtTs(log.createdAt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>User ID</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.userId}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Entity ID</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.entityId}</div>
              </div>
              {log.changes && Object.keys(log.changes).length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Full Change Data</div>
                  <pre style={{ fontSize: 11, background: '#fff', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 14px', overflowX: 'auto', margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {JSON.stringify(log.changes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Investigation row ─────────────────────────────────────────────────────────
function InvestigationRow({ inv, canIC, canResolve, onAction, isExpanded, onToggle }) {
  const sm = INV_STATUS_META[inv.status] || INV_STATUS_META.OPEN;
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer', background: isExpanded ? sm.bg : undefined, transition: 'background 0.1s' }}
        onMouseEnter={e  => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
        onMouseLeave={e  => { if (!isExpanded) e.currentTarget.style.background = ''; }}
      >
        <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtDate(inv.createdAt)}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(inv.createdAt)}</div>
        </td>
        <td style={{ padding: '12px 16px' }}>
          <EntityBadge type={inv.referenceType} />
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-muted)', marginTop: 3 }}>{inv.referenceId?.slice(0,12)}…</div>
        </td>
        <td style={{ padding: '12px 16px', maxWidth: 260 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {inv.flagReason}
          </div>
        </td>
        <td style={{ padding: '12px 16px' }}><InvStatusBadge status={inv.status} /></td>
        <td style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600 }}>{inv.flaggedBy?.firstName} {inv.flaggedBy?.lastName}</div>
          <div style={{ marginTop: 2 }}><RoleBadge role={inv.flaggedBy?.role} /></div>
        </td>
        <td style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {inv.status === 'OPEN' && canIC && (
              <button onClick={e => { e.stopPropagation(); onAction(inv, 'review'); }}
                style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6c63ff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                🔍 Review
              </button>
            )}
            {['OPEN','UNDER_REVIEW'].includes(inv.status) && canIC && (
              <button onClick={e => { e.stopPropagation(); onAction(inv, 'escalate'); }}
                style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #e9d5ff', background: '#fdf4ff', color: '#9333ea', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                🔺 Escalate
              </button>
            )}
            {['OPEN','UNDER_REVIEW','ESCALATED'].includes(inv.status) && canResolve && (
              <button onClick={e => { e.stopPropagation(); onAction(inv, 'close'); }}
                style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                ✓ Close
              </button>
            )}
            {inv.status === 'CLOSED' && (
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓ Closed</span>
            )}
          </div>
        </td>
        <td style={{ padding: '12px 14px' }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0, background: sm.bg }}>
            <div style={{ padding: '16px 20px', borderTop: `2px solid ${sm.border}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: '#fff', borderRadius: 10, border: `1px solid ${sm.border}`, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: sm.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Flag Details</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Reference type</span>
                    <span style={{ fontWeight: 600 }}>{inv.referenceType}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Reference ID</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{inv.referenceId}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Flagged</span>
                    <span style={{ fontWeight: 600 }}>{fmtTs(inv.createdAt)}</span>
                  </div>
                  <div style={{ marginTop: 6, padding: '8px 10px', background: '#fef2f2', borderRadius: 7, color: '#7f1d1d', fontSize: 12, lineHeight: 1.5 }}>
                    {inv.flagReason}
                  </div>
                </div>
              </div>
              <div style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--border-card)', padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Resolution Trail</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  {inv.status === 'ESCALATED' && inv.escalatedTo && (
                    <div style={{ padding: '8px 10px', background: '#fdf4ff', borderRadius: 7 }}>
                      <div style={{ fontWeight: 700, color: '#9333ea', marginBottom: 2 }}>🔺 Escalated {inv.escalatedAt ? timeAgo(inv.escalatedAt) : ''}</div>
                      <div style={{ color: '#7c3aed' }}>To: <strong>{inv.escalatedTo.firstName} {inv.escalatedTo.lastName}</strong></div>
                    </div>
                  )}
                  {inv.findings && (
                    <div style={{ padding: '8px 10px', background: '#f0fdf4', borderRadius: 7 }}>
                      <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: 2 }}>📝 Findings</div>
                      <div style={{ color: '#14532d', lineHeight: 1.5 }}>{inv.findings}</div>
                    </div>
                  )}
                  {inv.resolvedBy && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Closed by</span>
                      <span style={{ fontWeight: 600 }}>{inv.resolvedBy.firstName} {inv.resolvedBy.lastName}</span>
                    </div>
                  )}
                  {!inv.findings && !inv.escalatedTo && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>No resolution recorded yet.</div>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Filter sidebar pill ───────────────────────────────────────────────────────
function FilterPill({ label, active, color, count, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', textAlign: 'left', background: active ? `${color}15` : 'transparent', color: active ? color : 'var(--text-secondary)', fontWeight: active ? 700 : 500, fontSize: 12, transition: 'background 0.1s' }}>
      <span>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: active ? color : 'var(--bg-elevated)', color: active ? '#fff' : 'var(--text-muted)' }}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(logs) {
  const headers = ['Timestamp', 'User', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Changes'];
  const rows = logs.map(l => [
    fmtTs(l.createdAt),
    l.user ? `${l.user.firstName} ${l.user.lastName}` : 'System',
    l.user?.role || '',
    l.action,
    l.entityType,
    l.entityId,
    l.changes ? JSON.stringify(l.changes).replace(/"/g, '""') : '',
  ]);
  const csv  = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportInvCSV(invs) {
  const headers = ['Date', 'Reference Type', 'Reference ID', 'Flag Reason', 'Status', 'Flagged By', 'Findings'];
  const rows = invs.map(i => [
    fmtTs(i.createdAt),
    i.referenceType,
    i.referenceId,
    i.flagReason,
    i.status,
    i.flaggedBy ? `${i.flaggedBy.firstName} ${i.flaggedBy.lastName}` : '',
    i.findings || '',
  ]);
  const csv  = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `investigations-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditPage() {
  const { user, apiFetch } = useAuth();

  const canIC      = IC_ROLES.includes(user?.role);
  const canResolve = RESOLVE_ROLES.includes(user?.role);

  // ── Audit log state ──────────────────────────────────────────────────────
  const [logs,       setLogs]       = useState([]);
  const [pagination, setPagination] = useState(null);
  const [meta,       setMeta]       = useState(null);
  const [logLoading, setLogLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [entityType, setEntityType] = useState('');
  const [action,     setAction]     = useState('');
  const [from,       setFrom]       = useState('');
  const [to,         setTo]         = useState('');
  const [search,     setSearch]     = useState('');
  const [page,       setPage]       = useState(1);
  const searchTimeout = useRef(null);

  // ── Investigation state ──────────────────────────────────────────────────
  const [activeTab,     setActiveTab]     = useState('audit');
  const [investigations,setInvestigations]= useState([]);
  const [invSummary,    setInvSummary]    = useState(null);
  const [invLoading,    setInvLoading]    = useState(false);
  const [invFilter,     setInvFilter]     = useState('all');
  const [expandedInv,   setExpandedInv]   = useState(null);
  const [invPage,       setInvPage]       = useState(1);
  const [invPagination, setInvPagination] = useState(null);

  // ── Modals ────────────────────────────────────────────────────────────────
  const [flagModal,      setFlagModal]      = useState(null);  // log being flagged
  const [invActionModal, setInvActionModal] = useState(null);  // { inv, action }
  const [flaggedIds,     setFlaggedIds]     = useState(new Set()); // entityIds already flagged
  const [chairs,         setChairs]         = useState([]);
  const [toast,          setToast]          = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  // ── Fetch chairpersons for escalation picker ─────────────────────────────
  useEffect(() => {
    if (!canIC) return;
    apiFetch('/api/users?roles=CHAIRPERSON,FARM_ADMIN').then(async res => {
      if (res.ok) { const d = await res.json(); setChairs(d.users || []); }
    }).catch(() => {});
  }, [canIC, apiFetch]);

  // ── Load audit logs ──────────────────────────────────────────────────────
  const loadLogs = useCallback(async (overrides = {}) => {
    setLogLoading(true);
    const params = new URLSearchParams({
      page:  String(overrides.page ?? page),
      limit: '50',
      ...(overrides.entityType ?? entityType ? { entityType: overrides.entityType ?? entityType } : {}),
      ...(overrides.action     ?? action     ? { action:     overrides.action     ?? action }     : {}),
      ...(overrides.from       ?? from       ? { from:       overrides.from       ?? from }       : {}),
      ...(overrides.to         ?? to         ? { to:         overrides.to         ?? to }         : {}),
      ...(overrides.search     ?? search     ? { search:     overrides.search     ?? search }     : {}),
    });
    try {
      const res = await apiFetch(`/api/audit?${params}`);
      if (res.ok) {
        const d = await res.json();
        setLogs(d.logs || []);
        setPagination(d.pagination);
        setMeta(d.meta);
      }
    } finally {
      setLogLoading(false);
    }
  }, [apiFetch, page, entityType, action, from, to, search]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  // ── Load investigations ──────────────────────────────────────────────────
  const loadInvestigations = useCallback(async (statusOverride, pageOverride) => {
    setInvLoading(true);
    const status = statusOverride !== undefined ? statusOverride : (invFilter === 'all' ? '' : invFilter);
    const p      = pageOverride ?? invPage;
    const params = new URLSearchParams({ page: String(p), limit: '30', ...(status ? { status } : {}) });
    try {
      const res = await apiFetch(`/api/investigations?${params}`);
      if (res.ok) {
        const d = await res.json();
        setInvestigations(d.investigations || []);
        setInvSummary(d.summary);
        setInvPagination(d.pagination);
      }
    } catch { /* silent */ }
    finally { setInvLoading(false); }
  }, [apiFetch, invFilter, invPage]);

  useEffect(() => {
    if (activeTab === 'investigations') loadInvestigations();
  }, [activeTab, loadInvestigations]);

  // ── Audit filter helpers ─────────────────────────────────────────────────
  function applyFilter(key, val) {
    const p = 1; setPage(p);
    if (key === 'entityType') { setEntityType(val); loadLogs({ entityType: val, page: p }); }
    if (key === 'action')     { setAction(val);     loadLogs({ action: val,     page: p }); }
  }

  function handleSearchChange(val) {
    setSearch(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setPage(1); loadLogs({ search: val, page: 1 }); }, 400);
  }

  function handleDateFilter() { setPage(1); loadLogs({ from, to, page: 1 }); }

  function clearFilters() {
    setEntityType(''); setAction(''); setFrom(''); setTo(''); setSearch(''); setPage(1);
    loadLogs({ entityType: '', action: '', from: '', to: '', search: '', page: 1 });
  }

  const hasFilters = entityType || action || from || to || search;

  async function handleExport() {
    const params = new URLSearchParams({ page: '1', limit: '100', ...(entityType ? { entityType } : {}), ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(search ? { search } : {}) });
    const res = await apiFetch(`/api/audit?${params}`);
    if (res.ok) { const d = await res.json(); exportCSV(d.logs); }
  }

  // ── Flag a record ────────────────────────────────────────────────────────
  async function handleFlag(log, reason) {
    const res = await apiFetch('/api/investigations', {
      method: 'POST',
      body: JSON.stringify({ referenceType: log.entityType, referenceId: log.entityId, flagReason: reason }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Failed to flag record');
    setFlaggedIds(prev => new Set([...prev, log.entityId]));
    setFlagModal(null);
    showToast('Record flagged for investigation');
  }

  // ── Investigation actions ────────────────────────────────────────────────
  async function handleInvAction(inv, action, { findings, escalatedToId } = {}) {
    const res = await apiFetch(`/api/investigations/${inv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, findings, escalatedToId }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Action failed');

    // Optimistic update
    setInvestigations(prev => prev.map(i => i.id === inv.id ? { ...i, ...d.investigation } : i));
    setInvActionModal(null);
    showToast(action === 'close' ? 'Investigation closed' : action === 'escalate' ? 'Escalated to Chairperson' : 'Marked under review');
  }

  const openTotal = invSummary ? (invSummary.OPEN || 0) + (invSummary.UNDER_REVIEW || 0) + (invSummary.ESCALATED || 0) : 0;

  return (
    <AppShell>
      <style>{`
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
      `}</style>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: toast.type === 'success' ? '#166534' : '#991b1b', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', animation: 'fadeIn 0.25s ease' }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 800, margin: 0 }}>🔍 Audit &amp; Investigations</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
            Complete system activity log — flag anomalies and manage investigations
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {activeTab === 'audit' && (
            <button onClick={handleExport}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
              ⬇ Export CSV
            </button>
          )}
          {activeTab === 'investigations' && investigations.length > 0 && (
            <button onClick={() => exportInvCSV(investigations)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
              ⬇ Export Investigations
            </button>
          )}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-card)', marginBottom: 20, gap: 2 }}>
        {[
          { key: 'audit',          label: '📋 Audit Log' },
          { key: 'investigations', label: `🚩 Investigations${openTotal > 0 ? ` (${openTotal})` : ''}` },
        ].map(t => {
          const active = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{ padding: '11px 18px', fontSize: 13, fontWeight: active ? 700 : 600, color: active ? 'var(--purple)' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: active ? '2px solid var(--purple)' : '2px solid transparent', whiteSpace: 'nowrap', fontFamily: 'inherit', marginBottom: -1 }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ════════════════ AUDIT LOG TAB ════════════════ */}
      {activeTab === 'audit' && (
        <>
          {/* KPI strip */}
          {meta && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { icon: '📋', label: 'Total Events', value: pagination?.total?.toLocaleString() || '—', color: 'var(--purple)' },
                { icon: '➕', label: 'Creates',       value: (meta.actionCounts.find(a => a.action === 'CREATE')?.count || 0).toLocaleString(), color: '#16a34a' },
                { icon: '✏️', label: 'Updates',       value: (meta.actionCounts.find(a => a.action === 'UPDATE')?.count || 0).toLocaleString(), color: '#f59e0b' },
                { icon: '🗑️', label: 'Deletes',       value: (meta.actionCounts.find(a => a.action === 'DELETE')?.count || 0).toLocaleString(), color: '#ef4444' },
              ].map(k => (
                <div key={k.label} className="card" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{k.label}</span>
                    <span style={{ fontSize: 18 }}>{k.icon}</span>
                  </div>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
            {/* Left sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card" style={{ padding: 14 }}>
                <input type="text" className="input" placeholder="🔍 Search entity or ID…" value={search} onChange={e => handleSearchChange(e.target.value)} style={{ fontSize: 12 }} />
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Date Range</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} style={{ fontSize: 11 }} />
                  <input type="date" className="input" value={to}   onChange={e => setTo(e.target.value)}   style={{ fontSize: 11 }} />
                  <button onClick={handleDateFilter} style={{ display: 'inline-flex', justifyContent: 'center', padding: '6px', borderRadius: 7, border: '1px solid var(--purple)', background: 'var(--purple-light)', color: 'var(--purple)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Apply</button>
                </div>
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Action</div>
                <FilterPill label="All Actions" active={!action} color="var(--purple)" onClick={() => applyFilter('action', '')} />
                {(meta?.actionCounts || ACTIONS.map(a => ({ action: a, count: 0 }))).map(({ action: a, count }) => {
                  const m = ACTION_META[a] || {};
                  return <FilterPill key={a} label={`${m.icon || ''} ${m.label || a}`} active={action === a} color={m.color || '#64748b'} count={count} onClick={() => applyFilter('action', action === a ? '' : a)} />;
                })}
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Entity Type</div>
                <FilterPill label="All Types" active={!entityType} color="var(--purple)" onClick={() => applyFilter('entityType', '')} />
                {(meta?.entityCounts || ENTITY_TYPES.map(e => ({ entityType: e, count: 0 }))).map(({ entityType: et, count }) => {
                  const m = ENTITY_META[et] || {};
                  return <FilterPill key={et} label={`${m.icon || ''} ${et}`} active={entityType === et} color={m.color || '#64748b'} count={count} onClick={() => applyFilter('entityType', entityType === et ? '' : et)} />;
                })}
              </div>
              {hasFilters && (
                <button onClick={clearFilters} style={{ display: 'inline-flex', justifyContent: 'center', padding: '8px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ✕ Clear Filters
                </button>
              )}
            </div>

            {/* Main table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {hasFilters && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Filters:</span>
                  {entityType && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#eff6ff', color: '#3b82f6' }}>{entityType}</span>}
                  {action     && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#f0fdf4', color: '#16a34a' }}>{action}</span>}
                  {from       && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#fffbeb', color: '#f59e0b' }}>From {from}</span>}
                  {to         && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#fffbeb', color: '#f59e0b' }}>To {to}</span>}
                  {search     && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#f5f3ff', color: '#8b5cf6' }}>"{search}"</span>}
                  {pagination  && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{pagination.total.toLocaleString()} result{pagination.total !== 1 ? 's' : ''}</span>}
                </div>
              )}

              {canIC && (
                <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#7f1d1d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🚩</span>
                  <span>As IC Officer, you can flag any record for investigation using the <strong>Flag</strong> button on each row.</span>
                </div>
              )}

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {logLoading ? (
                  <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Array(8).fill(0).map((_, i) => <Skel key={i} h={48} />)}
                  </div>
                ) : logs.length === 0 ? (
                  <div style={{ padding: 60, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                    <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>No audit events match your filters</div>
                    {hasFilters && <button onClick={clearFilters} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Clear filters</button>}
                  </div>
                ) : (
                  <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <colgroup>
                      <col style={{ width: 110 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 100 }} />
                      <col style={{ width: 150 }} />
                      <col />
                      <col style={{ width: 70 }} />
                      <col style={{ width: canIC ? 110 : 32 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Changes</th><th>Age</th>
                        <th>{canIC ? 'Flag' : ''}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log => (
                        <AuditRow
                          key={log.id}
                          log={log}
                          isExpanded={expandedId === log.id}
                          onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                          canFlag={canIC}
                          flagged={flaggedIds.has(log.entityId)}
                          onFlag={l => setFlagModal(l)}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={!pagination.hasPrev} onClick={() => { const p = page - 1; setPage(p); loadLogs({ page: p }); }}
                      style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: pagination.hasPrev ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600, opacity: pagination.hasPrev ? 1 : 0.4, fontFamily: 'inherit' }}>← Prev</button>
                    {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                      const p = Math.max(1, Math.min(pagination.totalPages - 4, page - 2)) + i;
                      return <button key={p} onClick={() => { setPage(p); loadLogs({ page: p }); }}
                        style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${p === page ? 'var(--purple)' : 'var(--border)'}`, background: p === page ? 'var(--purple-light)' : '#fff', color: p === page ? 'var(--purple)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: p === page ? 700 : 500, fontFamily: 'inherit' }}>{p}</button>;
                    })}
                    <button disabled={!pagination.hasNext} onClick={() => { const p = page + 1; setPage(p); loadLogs({ page: p }); }}
                      style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: pagination.hasNext ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600, opacity: pagination.hasNext ? 1 : 0.4, fontFamily: 'inherit' }}>Next →</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ════════════════ INVESTIGATIONS TAB ════════════════ */}
      {activeTab === 'investigations' && (
        <div>
          {/* Summary KPIs */}
          {invSummary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { key: 'OPEN',         icon: '🔓', label: 'Open',         color: '#d97706' },
                { key: 'UNDER_REVIEW', icon: '🔍', label: 'Under Review', color: '#6c63ff' },
                { key: 'ESCALATED',    icon: '🔺', label: 'Escalated',    color: '#9333ea' },
                { key: 'CLOSED',       icon: '✓',  label: 'Closed',       color: '#16a34a' },
              ].map(k => (
                <div key={k.key} className="card" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{k.label}</span>
                    <span style={{ fontSize: 18 }}>{k.icon}</span>
                  </div>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 26, fontWeight: 800, color: (invSummary[k.key] || 0) > 0 ? k.color : 'var(--text-muted)', lineHeight: 1 }}>
                    {invSummary[k.key] || 0}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Escalated banner */}
          {invSummary?.ESCALATED > 0 && (canResolve) && (
            <div style={{ margin: '0 0 16px', padding: '12px 16px', background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 22 }}>🔺</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>
                  {invSummary.ESCALATED} escalated investigation{invSummary.ESCALATED > 1 ? 's' : ''} require your attention
                </div>
                <div style={{ fontSize: 11, color: '#9333ea', marginTop: 2 }}>Review and close them once resolved</div>
              </div>
              <button onClick={() => { setInvFilter('ESCALATED'); loadInvestigations('ESCALATED', 1); }}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #c4b5fd', background: '#ede9fe', color: '#7c3aed', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                View Escalated
              </button>
            </div>
          )}

          {/* Sub-filter tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-card)', marginBottom: 16 }}>
            {[
              { key: 'all',          label: 'All' },
              { key: 'OPEN',         label: '🔓 Open' },
              { key: 'UNDER_REVIEW', label: '🔍 Under Review' },
              { key: 'ESCALATED',    label: '🔺 Escalated' },
              { key: 'CLOSED',       label: '✓ Closed' },
            ].map(f => {
              const active = invFilter === f.key;
              const count  = f.key === 'all' ? (invPagination?.total || 0) : (invSummary?.[f.key] || 0);
              return (
                <button key={f.key} onClick={() => { setInvFilter(f.key); setInvPage(1); loadInvestigations(f.key === 'all' ? '' : f.key, 1); }}
                  style={{ padding: '10px 16px', fontSize: 12, fontWeight: active ? 700 : 600, color: active ? 'var(--purple)' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: active ? '2px solid var(--purple)' : '2px solid transparent', whiteSpace: 'nowrap', fontFamily: 'inherit', marginBottom: -1 }}>
                  {f.label}{count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {invLoading ? (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {Array(6).fill(0).map((_, i) => <Skel key={i} h={52} />)}
              </div>
            ) : investigations.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  {invFilter === 'all' ? 'No investigations yet' : `No ${invFilter.toLowerCase().replace('_',' ')} investigations`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {invFilter === 'all' ? 'Flag records from the Audit Log tab to start an investigation.' : 'Nothing in this filter.'}
                </div>
              </div>
            ) : (
              <table className="table" style={{ width: '100%', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 110 }} />
                  <col style={{ width: 140 }} />
                  <col />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 32 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th><th>Reference</th><th>Flag Reason</th><th>Status</th><th>Flagged By</th><th>Actions</th><th />
                  </tr>
                </thead>
                <tbody>
                  {investigations.map(inv => (
                    <InvestigationRow
                      key={inv.id}
                      inv={inv}
                      canIC={canIC}
                      canResolve={canResolve}
                      isExpanded={expandedInv === inv.id}
                      onToggle={() => setExpandedInv(expandedInv === inv.id ? null : inv.id)}
                      onAction={(i, a) => setInvActionModal({ inv: i, action: a })}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Investigations pagination */}
          {invPagination && invPagination.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 4px' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Showing {((invPagination.page - 1) * invPagination.limit) + 1}–{Math.min(invPagination.page * invPagination.limit, invPagination.total)} of {invPagination.total}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={!invPagination.hasPrev} onClick={() => { const p = invPage - 1; setInvPage(p); loadInvestigations(undefined, p); }}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: invPagination.hasPrev ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600, opacity: invPagination.hasPrev ? 1 : 0.4, fontFamily: 'inherit' }}>← Prev</button>
                <button disabled={!invPagination.hasNext} onClick={() => { const p = invPage + 1; setInvPage(p); loadInvestigations(undefined, p); }}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: invPagination.hasNext ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600, opacity: invPagination.hasNext ? 1 : 0.4, fontFamily: 'inherit' }}>Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Flag modal */}
      {flagModal && (
        <FlagModal
          log={flagModal}
          onClose={() => setFlagModal(null)}
          onConfirm={(reason) => handleFlag(flagModal, reason)}
        />
      )}

      {/* Investigation action modal */}
      {invActionModal && (
        <InvActionModal
          inv={invActionModal.inv}
          action={invActionModal.action}
          chairs={chairs}
          onClose={() => setInvActionModal(null)}
          onConfirm={({ findings, escalatedToId }) => handleInvAction(invActionModal.inv, invActionModal.action, { findings, escalatedToId })}
        />
      )}
    </AppShell>
  );
}
