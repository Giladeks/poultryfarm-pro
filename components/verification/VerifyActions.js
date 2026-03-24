'use client';
// components/verification/VerifyActions.js
// Drop-in action buttons for PM dashboard verification panels.
// Matches the permission model on the verification page exactly:
//
//   PEN_MANAGER / STORE_MANAGER / STORE_CLERK
//     → Verify + Reject only. No Flag button.
//
//   INTERNAL_CONTROL / ACCOUNTANT
//     → Flag for Investigation only. No Verify or Reject.
//
//   FARM_MANAGER / FARM_ADMIN / CHAIRPERSON / SUPER_ADMIN
//     → Verify + Reject + Flag (management can do all)
//
// Verify routing:
//   EggProduction   → opens GradingModal  (Grade B entry)
//   MortalityRecord → opens MortalityVerifyModal  (disposal method)
//   All other types → direct PATCH / POST
//
// Props:
//   item     — pending item from /api/verification GET
//   userRole — from useAuth().user.role
//   apiFetch — from useAuth()
//   onDone   — called on success
//   onError  — called with error string

import { useState } from 'react';
import GradingModal from '@/components/eggs/GradingModal';
import MortalityVerifyModal from '@/components/verification/MortalityVerifyModal';
import OverrideModal from '@/components/verification/OverrideModal';

// ── Role groups (mirror verification page constants) ──────────────────────────
const VERIFY_ROLES = [
  'PEN_MANAGER', 'STORE_MANAGER', 'STORE_CLERK',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];
const REJECT_ROLES = [
  'PEN_MANAGER', 'STORE_MANAGER',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];
const FLAG_ROLES = [
  'INTERNAL_CONTROL', 'ACCOUNTANT',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];
// Roles that can ONLY flag — no verify/reject
const AUDIT_ONLY_ROLES = ['INTERNAL_CONTROL', 'ACCOUNTANT'];

export default function VerifyActions({ item, userRole, apiFetch, onDone, onError }) {
  const [busy,           setBusy]           = useState(null);
  const [showFlag,       setShowFlag]       = useState(false);
  const [flagNote,       setFlagNote]       = useState('');
  const [flagErr,        setFlagErr]        = useState('');
  const [showGrading,    setShowGrading]    = useState(false);
  const [showMortVerify, setShowMortVerify] = useState(false);
  const [showOverride,   setShowOverride]   = useState(false);

  const canVerify  = VERIFY_ROLES.includes(userRole);
  const canReject  = REJECT_ROLES.includes(userRole);
  const canFlag    = FLAG_ROLES.includes(userRole);
  const auditOnly  = AUDIT_ONLY_ROLES.includes(userRole);

  // ── Core submit (direct verify for non-egg/mort, and for flag) ───────────
  async function submit(status, discrepancyNotes = null) {
    setBusy(status === 'VERIFIED' ? 'verify' : 'flag');
    try {
      const today = new Date().toISOString().slice(0, 10);
      let res;

      if (item.verificationId) {
        res = await apiFetch(`/api/verification/${item.verificationId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            ...(discrepancyNotes && { discrepancyNotes }),
          }),
        });
      } else {
        res = await apiFetch('/api/verification', {
          method: 'POST',
          body: JSON.stringify({
            referenceId:      item.referenceId,
            referenceType:    item.referenceType,
            verificationType: item.type === 'DAILY_PRODUCTION'  ? 'DAILY_PRODUCTION'
              : item.type === 'FEED_RECEIPT'      ? 'FEED_RECEIPT'
              : item.type === 'MORTALITY_REPORT'  ? 'MORTALITY_REPORT'
              : 'DAILY_PRODUCTION',
            verificationDate: today,
            status,
            storeId:          item.storeId || null,
            ...(discrepancyNotes && { discrepancyNotes }),
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) { onError?.(data.error || 'Action failed'); return; }
      onDone?.(data);
    } catch (err) {
      onError?.(err.message || 'Network error');
    } finally {
      setBusy(null);
      setShowFlag(false);
      setFlagNote('');
    }
  }

  // ── Verify click — routes to specialist modal for egg / mortality ─────────
  function handleVerifyClick() {
    if (item.referenceType === 'EggProduction') { setShowGrading(true); return; }
    if (item.referenceType === 'MortalityRecord') { setShowMortVerify(true); return; }
    submit('VERIFIED');
  }

  // ── Flag submission ───────────────────────────────────────────────────────
  async function submitFlag() {
    if (!flagNote.trim()) { setFlagErr('Describe why this record looks suspicious'); return; }
    await submit('DISCREPANCY_FOUND', flagNote.trim());
  }

  // ── Specialist modals ─────────────────────────────────────────────────────
  if (showGrading) {
    return (
      <GradingModal
        record={item}
        apiFetch={apiFetch}
        onClose={() => setShowGrading(false)}
        onSave={result => { setShowGrading(false); onDone?.(result); }}
      />
    );
  }

  if (showMortVerify) {
    return (
      <MortalityVerifyModal
        item={item}
        apiFetch={apiFetch}
        onClose={() => setShowMortVerify(false)}
        onSave={result => { setShowMortVerify(false); onDone?.(result); }}
      />
    );
  }

  if (showOverride) {
    return (
      <OverrideModal
        item={item}
        apiFetch={apiFetch}
        onClose={() => setShowOverride(false)}
        onSave={result => { setShowOverride(false); onDone?.(result); }}
      />
    );
  }

  // ── Flag note textarea ────────────────────────────────────────────────────
  if (showFlag) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9333ea', marginBottom: 2 }}>
          🚩 Flag for Investigation
        </div>
        <textarea
          autoFocus
          rows={2}
          value={flagNote}
          onChange={e => { setFlagNote(e.target.value); setFlagErr(''); }}
          placeholder="Describe why this record looks suspicious and what should be investigated…"
          style={{
            width: '100%', borderRadius: 7,
            border: `1.5px solid ${flagErr ? '#ef4444' : '#e9d5ff'}`,
            padding: '7px 10px', fontSize: 12, fontFamily: 'inherit',
            resize: 'vertical', outline: 'none', background: '#fdf4ff',
          }}
        />
        {flagErr && <div style={{ fontSize: 11, color: '#dc2626' }}>{flagErr}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={submitFlag}
            disabled={!!busy}
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 7, border: 'none',
              background: '#9333ea', color: '#fff', fontSize: 11, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
            }}>
            {busy === 'flag' ? 'Flagging…' : '🚩 Confirm Flag'}
          </button>
          <button
            onClick={() => setShowFlag(false)}
            disabled={!!busy}
            style={{
              padding: '7px 12px', borderRadius: 7,
              border: '1px solid #e5e7eb', background: '#fff',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#64748b',
            }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Default button row ────────────────────────────────────────────────────
  // Audit-only: just a Flag button
  if (auditOnly) {
    return (
      <button
        onClick={() => { setShowFlag(true); setFlagNote(''); setFlagErr(''); }}
        disabled={!!busy}
        style={{
          width: '100%', padding: '7px 12px', borderRadius: 7, border: 'none',
          background: '#9333ea', color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1,
        }}>
        🚩 Flag for Investigation
      </button>
    );
  }

  // Verifier roles: Verify + Reject + optional Flag (management only)
  if (canVerify) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleVerifyClick}
            disabled={!!busy}
            style={{
              flex: 1, padding: '7px 12px', borderRadius: 7, border: 'none',
              background: busy === 'verify' ? '#86efac' : '#22c55e',
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.7 : 1, transition: 'opacity 0.15s',
            }}>
            {busy === 'verify' ? '⏳…' : '✅ Verify'}
          </button>
          {canReject && (
            <button
              onClick={() => onError?.('reject-modal')} // caller handles reject modal
              disabled={!!busy}
              style={{
                flex: 1, padding: '7px 12px', borderRadius: 7, border: 'none',
                background: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}>
              ↩️ Reject
            </button>
          )}
        </div>
        {/* Flag — management only, visually secondary */}
        {canFlag && (
          <button
            onClick={() => { setShowFlag(true); setFlagNote(''); setFlagErr(''); }}
            disabled={!!busy}
            style={{
              width: '100%', padding: '6px 12px', borderRadius: 7,
              border: '1px solid #e9d5ff', background: '#fdf4ff',
              color: '#9333ea', fontSize: 11, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}>
            🚩 Flag for Investigation
          </button>
        )}
        {/* Override — egg/mortality only, PM+ roles */}
        {['EggProduction', 'MortalityRecord'].includes(item.referenceType) && canReject && (
          <button
            onClick={() => setShowOverride(true)}
            disabled={!!busy}
            style={{
              width: '100%', padding: '6px 12px', borderRadius: 7,
              border: '1px solid #fde68a', background: '#fffbeb',
              color: '#92400e', fontSize: 11, fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}>
            ✏️ PM Override
          </button>
        )}
      </div>
    );
  }

  // No applicable role
  return (
    <div style={{ fontSize: 11, color: '#94a3b8', padding: '6px 0', fontWeight: 600 }}>
      🔒 No action available
    </div>
  );
}
