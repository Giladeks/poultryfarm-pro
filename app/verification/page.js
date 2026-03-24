'use client';
// app/verification/page.js
// Permission model (revised):
//   PEN_MANAGER / STORE_MANAGER / STORE_CLERK  → Verify + Reject only
//   INTERNAL_CONTROL / ACCOUNTANT              → Flag + Escalate only (read the record, trigger investigation)
//   FARM_MANAGER / FARM_ADMIN / CHAIRPERSON /
//   SUPER_ADMIN                                → Verify + Reject + Flag + Resolve escalations
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import GradingModal from '@/components/eggs/GradingModal';
import MortalityVerifyModal from '@/components/verification/MortalityVerifyModal';
import OverrideModal from '@/components/verification/OverrideModal';

// ─── Role helpers ─────────────────────────────────────────────────────────────
// Who can access this page at all
const PAGE_ROLES = [
  'PEN_MANAGER','STORE_MANAGER','STORE_CLERK',
  'INTERNAL_CONTROL','ACCOUNTANT',
  'FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN',
];
// Who can Verify / Reject (operational check)
const VERIFIER_ROLES = [
  'PEN_MANAGER','STORE_MANAGER','STORE_CLERK',
  'FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN',
];
// Who can Reject specifically
const REJECT_ROLES = [
  'PEN_MANAGER','STORE_MANAGER',
  'FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN',
];
// Who can Flag as suspicious (integrity / audit function — NOT operational verifiers)
const FLAG_ROLES = [
  'INTERNAL_CONTROL','ACCOUNTANT',
  'FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN',
];
// Who can Escalate and Resolve investigations
const MANAGER_ROLES = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const MANAGEMENT_OVERRIDE = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

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
const TABS = ['pending', 'verified', 'flagged'];

const TYPE_META = {
  DAILY_PRODUCTION: { icon: '📋', label: 'Daily Production', color: '#6c63ff' },
  FEED_RECEIPT:     { icon: '🌾', label: 'Feed',             color: '#f59e0b' },
  MORTALITY_REPORT: { icon: '💀', label: 'Mortality',        color: '#ef4444' },
  INVENTORY_COUNT:  { icon: '📦', label: 'Inventory',        color: '#3b82f6' },
  FINANCIAL_RECORD: { icon: '💰', label: 'Financial',        color: '#10b981' },
};

const SWIM_LANES = [
  { type: 'MORTALITY_REPORT', icon: '💀', label: 'Mortality',        color: '#ef4444', bgColor: '#fef2f2', borderColor: '#fecaca', badgeBg: '#dc2626' },
  { type: 'DAILY_PRODUCTION', icon: '📋', label: 'Daily Production', color: '#6c63ff', bgColor: '#f5f3ff', borderColor: '#ddd6fe', badgeBg: '#6c63ff' },
  { type: 'FEED_RECEIPT',     icon: '🌾', label: 'Feed',             color: '#f59e0b', bgColor: '#fffbeb', borderColor: '#fde68a', badgeBg: '#d97706' },
  { type: 'INVENTORY_COUNT',  icon: '📦', label: 'Inventory',        color: '#3b82f6', bgColor: '#eff6ff', borderColor: '#bfdbfe', badgeBg: '#2563eb' },
  { type: 'FINANCIAL_RECORD', icon: '💰', label: 'Financial',        color: '#10b981', bgColor: '#f0fdf4', borderColor: '#bbf7d0', badgeBg: '#059669' },
];

const STATUS_META = {
  PENDING:           { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: 'Pending'     },
  VERIFIED:          { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', label: 'Verified'    },
  DISCREPANCY_FOUND: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'Flagged'     },
  ESCALATED:         { bg: '#fdf4ff', color: '#9333ea', border: '#e9d5ff', label: 'Escalated'   },
  RESOLVED:          { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', label: 'Resolved'    },
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmtCur  = (n) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n ?? 0));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const timeAgo = (d) => {
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

// ─── Shared sub-components ────────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, accent = 'var(--purple)', urgent }) {
  return (
    <div style={{ background: urgent ? '#fef2f2' : '#fff', borderRadius: 12, padding: '18px 20px', border: `1px solid ${urgent ? '#fecaca' : 'var(--border-card)'}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, background: `${accent}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{icon}</div>
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: `${m.color}14`, color: m.color }}>
      {m.icon} {m.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_META[status] || STATUS_META.PENDING;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
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

// ─── Verify / Reject / Escalate / Resolve Modal ───────────────────────────────
function ActionModal({ item, action, onClose, onConfirm, managers }) {
  const [notes,   setNotes]   = useState('');
  const [amount,  setAmount]  = useState('');
  const [targetId,setTargetId]= useState(managers?.[0]?.id || '');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState(null);

  const isVerify      = action === 'verify';
  const isDiscrepancy = action === 'discrepancy';
  const isReject      = action === 'reject';
  const isEscalate    = action === 'escalate';
  const isResolve     = action === 'resolve';

  const title = isVerify ? '✅ Confirm Verification' : isDiscrepancy ? '🚩 Flag for Investigation' : isReject ? '↩️ Reject & Return' : isEscalate ? '🔺 Escalate to Manager' : '✓ Mark as Resolved';
  const confirmLabel = isVerify ? 'Verify Record' : isDiscrepancy ? 'Flag for Investigation' : isReject ? 'Reject & Notify Worker' : isEscalate ? 'Escalate' : 'Mark Resolved';
  const confirmColor = isVerify || isResolve ? '#16a34a' : isDiscrepancy || isEscalate ? '#d97706' : '#dc2626';

  const handleConfirm = async () => {
    if ((isDiscrepancy || isReject || isEscalate || isResolve) && !notes.trim()) return setError('Please provide notes.');
    setSaving(true); setError(null);
    try {
      await onConfirm({ notes, amount: amount ? parseFloat(amount) : null, escalatedToId: targetId || null });
    } catch (e) { setError(e.message); setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, boxShadow: '0 12px 48px rgba(0,0,0,0.2)', animation: 'fadeInUp 0.2s ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b', fontFamily: "'Poppins',sans-serif" }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
        </div>

        <div style={{ padding: '20px 22px' }}>
          {/* Record summary */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Record</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{item.summary}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.context}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Submitted by {item.submittedBy} · {fmtDate(item.date)}</div>
          </div>

          {/* For escalation: show discrepancy context + manager picker */}
          {isEscalate && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Discrepancy Details</div>
                <div style={{ fontSize: 12, color: '#7f1d1d' }}>{item.discrepancyNotes || 'No discrepancy notes recorded'}</div>
                {item.discrepancyAmount && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginTop: 4 }}>Amount: {fmtCur(item.discrepancyAmount)}</div>
                )}
              </div>
              {managers && managers.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>Escalate To</label>
                  <select
                    value={targetId} onChange={e => setTargetId(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                  >
                    <option value="">— Auto-assign to Farm Manager —</option>
                    {managers.map(m => (
                      <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.role.replace(/_/g,' ')})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* For resolve: show full resolution context */}
          {isResolve && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {item.status === 'ESCALATED' ? '🔺 Escalated Issue' : '⚠️ Discrepancy'}
                </div>
                <div style={{ fontSize: 12, color: '#7f1d1d' }}>{item.discrepancyNotes || 'No discrepancy notes'}</div>
                {item.discrepancyAmount && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginTop: 4 }}>Discrepancy Amount: {fmtCur(item.discrepancyAmount)}</div>
                )}
              </div>
            </div>
          )}

          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#dc2626', marginBottom: 14 }}>{error}</div>}

          {isDiscrepancy && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>Discrepancy Amount (optional)</label>
              <input type="number" min="0" step="0.01" placeholder="e.g. 50 eggs, 2kg feed…" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
          )}

          <div style={{ marginBottom: 6 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 5 }}>
              {isVerify ? 'Verification Notes (optional)' : isResolve ? 'Resolution Notes *' : isDiscrepancy ? 'Investigation Notes *' : 'Notes *'}
            </label>
            <textarea rows={3} placeholder={
              isVerify      ? 'Any observations during verification…'
              : isDiscrepancy ? 'Describe why this record looks suspicious and what should be investigated…'
              : isReject    ? 'Reason for rejection — worker will be notified…'
              : isEscalate  ? 'Describe the issue and why it needs escalation…'
              : 'How was this investigation resolved? What action was taken?'
            }
              value={notes} onChange={e => setNotes(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
        </div>

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

// ─── Pending Item Card ─────────────────────────────────────────────────────────
// Button visibility by role:
//   PEN_MANAGER / STORE_MANAGER / STORE_CLERK → Verify + Reject
//   INTERNAL_CONTROL / ACCOUNTANT             → Flag only
//   FARM_MANAGER / FARM_ADMIN / CHAIRPERSON / SUPER_ADMIN → Verify + Reject + Flag
function PendingCard({ item, userRole, onAction, laneColor }) {
  const canVerifyThis = item.canVerify !== undefined
    ? item.canVerify
    : isPrimaryVerifier(userRole, item.referenceType);

  const canRejectThis = REJECT_ROLES.includes(userRole) && canVerifyThis;
  const canFlagThis   = FLAG_ROLES.includes(userRole);
  // Pure IC/Audit roles can ONLY flag — they cannot verify or reject
  const icOnly        = ['INTERNAL_CONTROL', 'ACCOUNTANT'].includes(userRole);

  const isOverride = MANAGEMENT_OVERRIDE.includes(userRole)
    && RECORD_TYPE_OWNER[item.referenceType]
    && !['PEN_MANAGER','STORE_MANAGER','STORE_CLERK'].includes(userRole);
  const isHighRisk = item.severity === 'HIGH';

  return (
    <div style={{ background: '#fff', borderRadius: 11, border: `1px solid ${isHighRisk ? laneColor + '55' : 'var(--border-card)'}`, boxShadow: isHighRisk ? `0 0 0 3px ${laneColor}18, 0 2px 8px rgba(0,0,0,0.06)` : '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden', animation: 'fadeIn 0.2s ease', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${laneColor}, ${laneColor}88)` }} />
      <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Management override notice */}
        {isOverride && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 11px', marginBottom: 12, fontSize: 11 }}>
            <span>⚠️</span>
            <span style={{ color: '#92400e', fontWeight: 600 }}>Primary verifier: <strong>{RECORD_TYPE_OWNER[item.referenceType]}</strong>. You are verifying as a management override.</span>
          </div>
        )}

        {/* Conflict-of-interest warning */}
        {item.coiBlocked && !isOverride && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '8px 11px', marginBottom: 12, fontSize: 11 }}>
            <span style={{ flexShrink: 0, marginTop: 1 }}>🔒</span>
            <span style={{ color: '#7c3aed', fontWeight: 600, lineHeight: 1.4 }}>{item.coiReason}</span>
          </div>
        )}

        {/* IC read-only notice */}
        {icOnly && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: '7px 11px', marginBottom: 12, fontSize: 11 }}>
            <span>🔍</span>
            <span style={{ color: '#7c3aed', fontWeight: 600 }}>Audit view — you can flag suspicious records for investigation</span>
          </div>
        )}

        {item.resubmitted && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 10, padding: '3px 9px', borderRadius: 99, background: '#ede9fe', color: '#7c3aed', fontSize: 11, fontWeight: 700, alignSelf: 'flex-start' }}>
            🔄 RESUBMITTED
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e293b', lineHeight: 1.4 }}>{item.summary}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{item.context}</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 500 }}>👤 {item.submittedBy}</span>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 500 }}>📅 {fmtDate(item.date)}</span>
          <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 500 }}>🕐 {timeAgo(item.date)}</span>
          {item.costAtTime && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>💰 {fmtCur(item.costAtTime)}</span>}
          {item.layingRate && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#fefce8', color: '#a16207', fontWeight: 600 }}>🥚 {Number(item.layingRate).toFixed(1)}% lay rate</span>}
          {isHighRisk      && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}>⚠ HIGH RISK</span>}
        </div>

        <div style={{ flex: 1 }} />

        {/* ── Action buttons — role-gated ─────────────────────────────────── */}
        {icOnly ? (
          // Internal Control / Accountant: Flag only
          <button
            onClick={() => onAction(item, 'flag')}
            style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: '1.5px solid #9333ea', background: '#fdf4ff', color: '#9333ea', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            🚩 Flag for Investigation
          </button>

        ) : canVerifyThis ? (
          // PM / Store / Management: Verify + Reject + (Flag for management)
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 7 }}>
              <button
                onClick={() => onAction(item, 'verify')}
                disabled={item.coiBlocked && !isOverride}
                title={item.coiBlocked && !isOverride ? item.coiReason : undefined}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: (item.coiBlocked && !isOverride) ? 'not-allowed' : 'pointer',
                  border: `1.5px solid ${(item.coiBlocked && !isOverride) ? '#e9d5ff' : '#16a34a'}`,
                  background: (item.coiBlocked && !isOverride) ? '#fdf4ff' : '#f0fdf4',
                  color: (item.coiBlocked && !isOverride) ? '#a78bfa' : '#16a34a',
                  opacity: (item.coiBlocked && !isOverride) ? 0.7 : 1,
                }}>
                {(item.coiBlocked && !isOverride) ? '🔒 COI' : '✅ Verify'}
              </button>
              {canRejectThis && (
                <button
                  onClick={() => onAction(item, 'reject')}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid #dc2626', background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  ↩️ Reject
                </button>
              )}
            </div>
            {/* Flag available to management only — separate row */}
            {canFlagThis && !icOnly && (
              <button
                onClick={() => onAction(item, 'flag')}
                style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #e9d5ff', background: '#fdf4ff', color: '#9333ea', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                🚩 Flag for Investigation
              </button>
            )}
            {/* PM Override — egg/mortality only, COI-aware, PM+ roles */}
            {['EggProduction', 'MortalityRecord'].includes(item.referenceType) &&
             REJECT_ROLES.includes(userRole) &&
             !(item.coiBlocked && !isOverride) && (
              <button
                onClick={() => onAction(item, 'override')}
                style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                ✏️ PM Override
              </button>
            )}
          </div>

        ) : (
          // No permission
          <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 11, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>
            🔒 Requires {RECORD_TYPE_OWNER[item.referenceType] || 'authorised role'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Swim Lane ─────────────────────────────────────────────────────────────────
function SwimLane({ lane, items, userRole, onAction, collapsed, onToggle }) {
  const count    = items.length;
  const hasItems = count > 0;

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${hasItems ? lane.borderColor : 'var(--border-card)'}`, overflow: 'hidden', marginBottom: 16, opacity: hasItems ? 1 : 0.55 }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', background: hasItems ? lane.bgColor : '#f8fafc', border: 'none', cursor: 'pointer', borderBottom: collapsed || !hasItems ? 'none' : `1px solid ${lane.borderColor}`, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>{lane.icon}</span>
          <span style={{ fontFamily: "'Poppins',sans-serif", fontSize: 14, fontWeight: 800, color: hasItems ? lane.color : 'var(--text-muted)' }}>{lane.label}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 24, height: 24, padding: '0 8px', borderRadius: 99, fontSize: 12, fontWeight: 800, background: hasItems ? lane.badgeBg : '#e2e8f0', color: hasItems ? '#fff' : '#94a3b8' }}>{count}</span>
          {hasItems && lane.type === 'MORTALITY_REPORT' && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#dc262620', color: '#dc2626' }}>Highest priority</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!hasItems && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Nothing pending</span>}
          {hasItems && collapsed && <span style={{ fontSize: 11, color: lane.color, fontWeight: 600 }}>Click to expand</span>}
          <span style={{ fontSize: 16, color: hasItems ? lane.color : 'var(--text-muted)', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', lineHeight: 1 }}>▾</span>
        </div>
      </button>
      {!collapsed && hasItems && (
        <div style={{ padding: 16, background: '#fff', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }} className="lane-grid">
          {items.map(item => (
            <PendingCard key={item.id} item={item} userRole={userRole} onAction={onAction} laneColor={lane.color} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Discrepancy Detail Panel ──────────────────────────────────────────────────
// Expanded row that shows full source record context
function DiscrepancyRow({ v, canVerify, canManage, onAction, apiFetch }) {
  const [expanded, setExpanded] = useState(false);
  const [source,   setSource]   = useState(null);
  const [loading,  setLoading]  = useState(false);

  const load = async () => {
    if (source) { setExpanded(e => !e); return; }
    setExpanded(true);
    setLoading(true);
    try {
      const res  = await apiFetch(`/api/verification/${v.id}`);
      const data = await res.json();
      setSource(data.sourceRecord);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const statusColor = {
    DISCREPANCY_FOUND: '#dc2626',
    ESCALATED:         '#9333ea',
    RESOLVED:          '#16a34a',
  }[v.status] || '#d97706';

  const statusBg = {
    DISCREPANCY_FOUND: '#fef2f2',
    ESCALATED:         '#fdf4ff',
    RESOLVED:          '#f0fdf4',
  }[v.status] || '#fffbeb';

  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--border-card)', background: expanded ? '#fafafa' : '#fff' }}>
        <td style={{ padding: '14px 16px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(v.verificationDate)}</td>
        <td style={{ padding: '14px 16px' }}><TypeBadge type={v.verificationType} /></td>
        <td style={{ padding: '14px 16px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.discrepancyNotes || '—'}
        </td>
        <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
          {v.discrepancyAmount ? fmtCur(v.discrepancyAmount) : '—'}
        </td>
        <td style={{ padding: '14px 16px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: statusBg, color: statusColor }}>
            {STATUS_META[v.status]?.label || v.status}
          </span>
          {v.status === 'ESCALATED' && v.escalatedAt && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Escalated {timeAgo(v.escalatedAt)}</div>
          )}
          {v.status === 'RESOLVED' && v.resolvedAt && (
            <div style={{ fontSize: 10, color: '#16a34a', marginTop: 3 }}>Resolved {timeAgo(v.resolvedAt)}</div>
          )}
        </td>
        <td style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Context expand toggle */}
            <button onClick={load} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, background: expanded ? 'var(--purple-light)' : 'var(--bg-elevated)', color: expanded ? 'var(--purple)' : 'var(--text-secondary)', border: `1px solid ${expanded ? '#d4d8ff' : 'var(--border-card)'}`, cursor: 'pointer' }}>
              {expanded ? '▲ Hide' : '▼ Details'}
            </button>
            {v.status === 'DISCREPANCY_FOUND' && canVerify && (
              <button onClick={() => onAction(v, 'escalate')} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, background: '#fdf4ff', color: '#9333ea', border: '1px solid #e9d5ff', cursor: 'pointer' }}>
                🔺 Escalate
              </button>
            )}
            {(v.status === 'DISCREPANCY_FOUND' || v.status === 'ESCALATED') && canManage && (
              <button onClick={() => onAction(v, 'resolve')} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', cursor: 'pointer' }}>
                ✓ Resolve
              </button>
            )}
            {v.status === 'RESOLVED' && (
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓ Resolved</span>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded source record context */}
      {expanded && (
        <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border-card)' }}>
          <td colSpan={6} style={{ padding: '0' }}>
            <div style={{ padding: '16px 20px' }}>
              {loading ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Loading source record…</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Left: discrepancy info */}
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #fecaca', padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>⚠️ Discrepancy Report</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Flagged by</span>
                        <span style={{ fontWeight: 600 }}>{v.verifiedBy ? `${v.verifiedBy.firstName} ${v.verifiedBy.lastName}` : '—'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Date flagged</span>
                        <span style={{ fontWeight: 600 }}>{fmtDate(v.verificationDate)}</span>
                      </div>
                      {v.discrepancyAmount && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Amount</span>
                          <span style={{ fontWeight: 700, color: '#dc2626' }}>{fmtCur(v.discrepancyAmount)}</span>
                        </div>
                      )}
                      <div style={{ marginTop: 6, padding: '8px 10px', background: '#fef2f2', borderRadius: 7, color: '#7f1d1d', fontSize: 12, lineHeight: 1.5 }}>
                        {v.discrepancyNotes || 'No notes recorded'}
                      </div>
                      {v.status === 'ESCALATED' && v.escalatedAt && (
                        <div style={{ marginTop: 4, padding: '8px 10px', background: '#fdf4ff', borderRadius: 7, fontSize: 12 }}>
                          <div style={{ color: '#9333ea', fontWeight: 700, marginBottom: 2 }}>🔺 Escalated {timeAgo(v.escalatedAt)}</div>
                          {v.escalatedTo && (
                            <div style={{ color: '#7c3aed', marginTop: 2 }}>
                              Assigned to: <strong>{v.escalatedTo.firstName} {v.escalatedTo.lastName}</strong> ({v.escalatedTo.role?.replace(/_/g,' ')})
                            </div>
                          )}
                        </div>
                      )}
                      {v.status === 'RESOLVED' && v.resolution && (
                        <div style={{ marginTop: 4, padding: '8px 10px', background: '#f0fdf4', borderRadius: 7, fontSize: 12 }}>
                          <div style={{ color: '#16a34a', fontWeight: 700, marginBottom: 2 }}>✓ Resolution</div>
                          <div style={{ color: '#14532d' }}>{v.resolution}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: source record context */}
                  <div style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--border-card)', padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>📄 Source Record</div>
                    {source ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                        {Object.entries(source).filter(([k]) => !['id','tenantId','farmId'].includes(k)).slice(0, 8).map(([key, val]) => {
                          if (val === null || val === undefined) return null;
                          if (typeof val === 'object') return null;
                          const label = key.replace(/([A-Z])/g, ' $1').trim();
                          const displayVal = typeof val === 'number' ? val.toLocaleString('en-NG') :
                                             typeof val === 'boolean' ? (val ? 'Yes' : 'No') :
                                             key.toLowerCase().includes('date') ? fmtDate(val) : String(val);
                          return (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{label}</span>
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{displayVal}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Source record not available</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function VerificationPage() {
  const { user, apiFetch } = useAuth();

  const [activeTab,    setActiveTab]    = useState('pending');
  const [pendingQueue, setPendingQueue] = useState([]);
  const [verifications,setVerifications]= useState([]);
  const [summary,      setSummary]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [tabLoading,   setTabLoading]   = useState(false);
  const [actionModal,          setActionModal]          = useState(null);
  const [gradingModal,         setGradingModal]         = useState(null); // EggProduction item
  const [mortalityVerifyModal, setMortalityVerifyModal] = useState(null); // MortalityRecord item
  const [overrideModal,        setOverrideModal]        = useState(null); // egg or mortality item
  const [toast,                setToast]                = useState(null);
  const [collapsed,      setCollapsed]      = useState(() => Object.fromEntries(SWIM_LANES.map(l => [l.type, true])));
  const [managers,       setManagers]       = useState([]);
  const [discrepFilter,  setDiscrepFilter]  = useState('all'); // 'all' | 'escalated' | 'open' | 'resolved'

  const canVerify = VERIFIER_ROLES.includes(user?.role);
  const canFlag   = FLAG_ROLES.includes(user?.role);
  const canManage = MANAGER_ROLES.includes(user?.role);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Fetch managers list (for escalation target picker) ──────────────────────
  useEffect(() => {
    if (!canVerify && !canFlag) return;  // IC can flag and needs managers for escalation
    apiFetch('/api/users?roles=FARM_MANAGER,FARM_ADMIN,CHAIRPERSON').then(async res => {
      if (res.ok) {
        const d = await res.json();
        setManagers((d.users || []).filter(u => MANAGER_ROLES.includes(u.role)));
      }
    }).catch(() => {});
  }, [canVerify, canFlag, apiFetch]);

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiFetch('/api/verification?pendingOnly=true');
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error);
      setPendingQueue(d.pendingQueue || []);
      setSummary(d.summary);
    } catch (e) { showToast(e.message, 'error'); }
  }, [apiFetch]);

  const fetchVerifications = useCallback(async (status) => {
    try {
      // Support comma-separated statuses → ?status=X&status=Y
      let qs = '';
      if (status) {
        const parts = status.split(',').map(s => s.trim());
        qs = '?' + parts.map(s => `status=${encodeURIComponent(s)}`).join('&');
      }
      const res = await apiFetch(`/api/verification${qs}`);
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error);
      setVerifications(d.verifications || []);
      setSummary(d.summary);
    } catch (e) { showToast(e.message, 'error'); }
  }, [apiFetch]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchPending();
      setLoading(false);
    })();
  }, [fetchPending]);

  useEffect(() => {
    if (activeTab === 'pending') return;
    setTabLoading(true);
    const statusMap = { verified: 'VERIFIED', flagged: 'DISCREPANCY_FOUND,ESCALATED,RESOLVED' };
    fetchVerifications(statusMap[activeTab]).finally(() => setTabLoading(false));
  }, [activeTab, fetchVerifications]);

  // Group pending queue by type
  const itemsByLane = {};
  for (const lane of SWIM_LANES) {
    itemsByLane[lane.type] = pendingQueue.filter(i => i.type === lane.type);
  }

  const toggleLane = (type) => setCollapsed(prev => ({ ...prev, [type]: !prev[type] }));

  const collapseAllDone = () => {
    const next = { ...collapsed };
    for (const lane of SWIM_LANES) { if (itemsByLane[lane.type].length === 0) next[lane.type] = true; }
    setCollapsed(next);
  };

  // ── Action handlers ─────────────────────────────────────────────────────────
  const handleAction = async (item, action, { notes, amount, escalatedToId } = {}) => {
    if (action === 'verify' || action === 'discrepancy') {
      let res;
      if (item.verificationId) {
        // PATCH the existing pending verification record (Bug #1 fix)
        res = await apiFetch(`/api/verification/${item.verificationId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status:            action === 'verify' ? 'VERIFIED' : 'DISCREPANCY_FOUND',
            discrepancyAmount: amount || null,
            discrepancyNotes:  notes || null,
          }),
        });
      } else {
        // POST — first-time verification for this record
        res = await apiFetch('/api/verification', {
          method: 'POST',
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
      }
      const d = await res.json();
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : 'Action failed');
      showToast(action === 'verify' ? 'Record verified successfully' : 'Record flagged for investigation — managers notified');
    } else if (action === 'reject') {
      if (item.verificationId) {
        const res = await apiFetch(`/api/verification/${item.verificationId}`, { method: 'PATCH', body: JSON.stringify({ reject: true, rejectReason: notes }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
      } else {
        const res = await apiFetch('/api/verification', {
          method: 'POST',
          body: JSON.stringify({ verificationType: item.type, referenceId: item.referenceId, referenceType: item.referenceType, verificationDate: new Date().toISOString().slice(0, 10), status: 'DISCREPANCY_FOUND', discrepancyNotes: notes }),
        });
        const created = await res.json();
        if (!res.ok) throw new Error(created.error);
        const res2 = await apiFetch(`/api/verification/${created.verification.id}`, { method: 'PATCH', body: JSON.stringify({ reject: true, rejectReason: notes }) });
        const d2 = await res2.json();
        if (!res2.ok) throw new Error(d2.error);
      }
      showToast('Record rejected — worker notified to resubmit');
    }
    setActionModal(null);
    await fetchPending();
  };

  const handleVerificationAction = async (v, action, { notes, escalatedToId } = {}) => {
    const newStatus = action === 'escalate' ? 'ESCALATED' : 'RESOLVED';
    const res = await apiFetch(`/api/verification/${v.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status:           newStatus,
        discrepancyNotes: action === 'escalate' ? notes : undefined,
        resolution:       action === 'resolve'  ? notes : undefined,
        escalatedToId:    action === 'escalate' ? (escalatedToId || null) : undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Failed to update');

    // Optimistically update the row immediately — no reload needed
    setVerifications(prev => prev.map(item =>
      item.id === v.id
        ? {
            ...item,
            status:           newStatus,
            resolution:       action === 'resolve'  ? notes : item.resolution,
            discrepancyNotes: action === 'escalate' ? notes : item.discrepancyNotes,
            escalatedAt:      action === 'escalate' ? new Date().toISOString() : item.escalatedAt,
            resolvedAt:       action === 'resolve'  ? new Date().toISOString() : item.resolvedAt,
          }
        : item
    ));

    // Update summary badge counts
    setSummary(prev => prev ? {
      ...prev,
      discrepancies: action === 'resolve' ? Math.max(0, (prev.discrepancies || 1) - 1) : prev.discrepancies,
      escalated: action === 'escalate'
        ? (prev.escalated || 0) + 1
        : action === 'resolve' ? Math.max(0, (prev.escalated || 0) - 1) : prev.escalated,
    } : prev);

    showToast(action === 'escalate' ? 'Escalated to farm manager' : 'Discrepancy resolved');
    setActionModal(null);

    // Background refresh to sync with server
    fetchVerifications('DISCREPANCY_FOUND,ESCALATED,RESOLVED');
  };

  // ── Action interceptor ───────────────────────────────────────────────────────
  // 'verify'  on eggs     → GradingModal
  // 'verify'  on mort     → MortalityVerifyModal
  // 'verify'  on others   → ActionModal (standard)
  // 'reject'              → ActionModal (reject variant)
  // 'flag'                → ActionModal (flag/discrepancy variant — IC/Audit/Management only)
  // 'escalate' / 'resolve'→ ActionModal (from discrepancy tab)
  const interceptAction = (item, action) => {
    if (action === 'verify') {
      if (item.referenceType === 'EggProduction') {
        setGradingModal(item);
        return;
      }
      if (item.referenceType === 'MortalityRecord') {
        setMortalityVerifyModal(item);
        return;
      }
    }
    if (action === 'override') {
      setOverrideModal(item);
      return;
    }
    // 'flag' is treated as 'discrepancy' in the backend — renamed here for clarity
    setActionModal({
      item,
      action: action === 'flag' ? 'discrepancy' : action,
      verificationId: item.verificationId || null,
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <style>{`
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes fadeIn   { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        .vr-table tr:hover td { background: var(--bg-hover) !important; }
        .tab-btn:hover { background: var(--bg-hover) !important; }
        @media (max-width: 900px) { .lane-grid { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 600px) { .lane-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: toast.type === 'success' ? '#166534' : '#991b1b', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', animation: 'fadeIn 0.25s ease' }}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
        </div>
      )}

      {/* Page header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 26 }}>✅</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif", margin: 0 }}>Verification & Reconciliation</h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Review and approve worker submissions across all modules</p>
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
          <StatCard icon="⏳" label="Pending Review"     value={summary.totalPending}                  sub="Across all modules"      accent="#d97706" urgent={summary.totalPending > 10} />
          <StatCard icon="🚩" label="Flagged Records"    value={summary.discrepancies}                 sub="Under investigation"     accent="#dc2626" urgent={summary.discrepancies > 0} />
          <StatCard icon="🔺" label="Escalated"          value={summary.escalated}                     sub="Awaiting manager"        accent="#9333ea" urgent={summary.escalated > 0} />
          <StatCard icon="🥚" label="Production Pending" value={summary.byType?.DAILY_PRODUCTION || 0} sub="Daily reports"           accent="#6c63ff" />
          <StatCard icon="💀" label="Mortality Pending"  value={summary.byType?.MORTALITY_REPORT || 0} sub="Needs review"            accent="#ef4444" urgent={(summary.byType?.MORTALITY_REPORT || 0) > 0} />
          <StatCard icon="🌾" label="Feed Pending"       value={summary.byType?.FEED_RECEIPT || 0}     sub="Consumption & receipts"  accent="#f59e0b" />
        </div>
      )}

      {/* Main card */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', overflow: 'hidden' }}>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-card)', padding: '0 6px', gap: 2 }}>
          {TABS.map(tab => {
            const labels = {
              pending:  `⏳ Pending${summary?.totalPending ? ` (${summary.totalPending})` : ''}`,
              verified: '✅ Verified',
              flagged:  `🚩 Flagged${summary?.discrepancies ? ` (${summary.discrepancies})` : ''}`,
            };
            const active = activeTab === tab;
            return (
              <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)} style={{ padding: '13px 16px', fontSize: 13, fontWeight: active ? 700 : 600, color: active ? 'var(--purple)' : 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: active ? '2px solid var(--purple)' : '2px solid transparent', whiteSpace: 'nowrap' }}>
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* ── PENDING TAB ── */}
        {activeTab === 'pending' && (
          <div style={{ padding: 16 }}>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {SWIM_LANES.map(lane => (
                  <div key={lane.type} style={{ borderRadius: 12, border: '1px solid var(--border-card)', overflow: 'hidden', animation: 'pulse 1.5s ease-in-out infinite' }}>
                    <div style={{ height: 52, background: '#f8fafc' }} />
                  </div>
                ))}
              </div>
            ) : pendingQueue.length === 0 ? (
              <EmptyState icon="✅" title="All caught up!" sub="No records awaiting verification" />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, gap: 8 }}>
                  <button onClick={() => setCollapsed(Object.fromEntries(SWIM_LANES.filter(l => itemsByLane[l.type].length > 0).map(l => [l.type, false])))}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--purple)', background: 'none', border: '1px solid var(--border-card)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>
                    Expand all
                  </button>
                  <button onClick={() => setCollapsed(Object.fromEntries(SWIM_LANES.map(l => [l.type, true])))}
                    style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border-card)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}>
                    Collapse all
                  </button>
                </div>
                {SWIM_LANES.map(lane => (
                  <SwimLane key={lane.type} lane={lane} items={itemsByLane[lane.type]} userRole={user?.role} onAction={interceptAction} collapsed={!!collapsed[lane.type]} onToggle={() => toggleLane(lane.type)} />
                ))}
              </>
            )}
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
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.referenceType} · {v.referenceId?.slice(0, 8)}…</td>
                    <td style={{ padding: '13px 16px' }}><StatusBadge status={v.status} /></td>
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-secondary)' }}>{v.verifiedBy ? `${v.verifiedBy.firstName} ${v.verifiedBy.lastName}` : '—'}</td>
                    <td style={{ padding: '13px 16px', fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.discrepancyNotes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── FLAGGED TAB ── Owned by Internal Control / Audit — Escalate & Resolve ── */}
        {activeTab === 'flagged' && (
          <div>
            {/* Sub-filter tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-card)', padding: '0 4px', overflowX: 'auto' }}>
              {[
                { key: 'all',       label: 'All',               color: '#64748b' },
                { key: 'escalated', label: '🔺 Escalated to Me', color: '#9333ea' },
                { key: 'open',      label: '🚩 Open Flags',      color: '#dc2626' },
                { key: 'resolved',  label: '✓ Resolved',         color: '#16a34a' },
              ].map(f => {
                const active = discrepFilter === f.key;
                const count = f.key === 'all'       ? verifications.length
                            : f.key === 'escalated' ? verifications.filter(v => v.status === 'ESCALATED' && (v.escalatedToId === user?.id || !v.escalatedToId)).length
                            : f.key === 'open'      ? verifications.filter(v => v.status === 'DISCREPANCY_FOUND').length
                            : verifications.filter(v => v.status === 'RESOLVED').length;
                return (
                  <button key={f.key} onClick={() => setDiscrepFilter(f.key)} style={{
                    padding: '11px 16px', fontSize: 13, fontWeight: active ? 700 : 600,
                    color: active ? f.color : 'var(--text-secondary)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    borderBottom: active ? `2px solid ${f.color}` : '2px solid transparent',
                    whiteSpace: 'nowrap', fontFamily: 'inherit',
                    marginBottom: -1,
                  }}>
                    {f.label}{count > 0 ? ` (${count})` : ''}
                  </button>
                );
              })}
              <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', padding: '0 12px', whiteSpace: 'nowrap' }}>
                Click ▼ Details to see full context
              </div>
            </div>

            {/* Escalated-to-me banner */}
            {canManage && !tabLoading && verifications.some(v => v.status === 'ESCALATED') && discrepFilter !== 'resolved' && (
              <div style={{ margin: '12px 16px 0', padding: '12px 16px', background: '#fdf4ff', border: '1px solid #e9d5ff', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 22 }}>🔺</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>
                    {verifications.filter(v => v.status === 'ESCALATED').length} escalated flag{verifications.filter(v => v.status === 'ESCALATED').length === 1 ? '' : 's'} require your attention
                  </div>
                  <div style={{ fontSize: 11, color: '#9333ea', marginTop: 2 }}>
                    Review each one, expand the details, and click ✓ Resolve once addressed
                  </div>
                </div>
                <button onClick={() => setDiscrepFilter('escalated')} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #c4b5fd', background: '#ede9fe', color: '#7c3aed', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  View Escalated
                </button>
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table className="vr-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-base)' }}>
                    {['Date', 'Type', 'Discrepancy Notes', 'Amount', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border-card)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabLoading ? <LoadingRows cols={6} /> : (() => {
                    const filtered = verifications.filter(v => {
                      if (discrepFilter === 'escalated') return v.status === 'ESCALATED';
                      if (discrepFilter === 'open')      return v.status === 'DISCREPANCY_FOUND';
                      if (discrepFilter === 'resolved')  return v.status === 'RESOLVED';
                      return true;
                    });
                    if (filtered.length === 0) return (
                      <tr><td colSpan={6}><EmptyState icon="🎉" title={discrepFilter === 'escalated' ? 'No escalated items' : discrepFilter === 'open' ? 'No open flags' : 'No resolved flags'} sub={discrepFilter === 'all' ? 'No records have been flagged' : 'Nothing in this filter'} /></td></tr>
                    );
                    return filtered.map(v => (
                    <DiscrepancyRow
                      key={v.id}
                      v={v}
                      canVerify={canVerify}
                      canManage={canManage}
                      apiFetch={apiFetch}
                      onAction={(record, action) => setActionModal({
                        item: {
                          ...record,
                          summary:  record.discrepancyNotes || 'Discrepancy',
                          context:  record.referenceType,
                          submittedBy: record.verifiedBy?.firstName,
                          date:     record.verificationDate,
                          discrepancyNotes:   record.discrepancyNotes,
                          discrepancyAmount:  record.discrepancyAmount,
                          status:   record.status,
                        },
                        action,
                        verificationId: record.id,
                      })}
                    />
                  ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Grading Modal — opens when PM clicks Verify on an EggProduction item */}
      {gradingModal && (
        <GradingModal
          record={gradingModal}
          apiFetch={apiFetch}
          onClose={() => setGradingModal(null)}
          onSave={() => {
            setGradingModal(null);
            showToast('Egg record graded and approved ✓');
            fetchPending();
          }}
        />
      )}

      {/* Mortality Verify Modal — opens when PM clicks Verify on a MortalityRecord item */}
      {mortalityVerifyModal && (
        <MortalityVerifyModal
          item={mortalityVerifyModal}
          apiFetch={apiFetch}
          onClose={() => setMortalityVerifyModal(null)}
          onSave={() => {
            setMortalityVerifyModal(null);
            showToast('Mortality record verified ✓');
            fetchPending();
          }}
        />
      )}

      {/* Override Modal — PM corrects worker values with mandatory reason */}
      {overrideModal && (
        <OverrideModal
          item={overrideModal}
          apiFetch={apiFetch}
          onClose={() => setOverrideModal(null)}
          onSave={() => {
            setOverrideModal(null);
            showToast('Override applied and audit trail recorded ✓');
            fetchPending();
          }}
        />
      )}

      {/* Action Modal — Flag, Reject, Escalate, Resolve */}
      {actionModal && (
        <ActionModal
          item={actionModal.item}
          action={actionModal.action}
          managers={managers}
          onClose={() => setActionModal(null)}
          onConfirm={async ({ notes, amount, escalatedToId }) => {
            if (actionModal.verificationId) {
              await handleVerificationAction(
                { id: actionModal.verificationId },
                actionModal.action,
                { notes, escalatedToId }
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
