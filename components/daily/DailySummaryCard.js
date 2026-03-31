'use client';
// components/daily/DailySummaryCard.js
// Shows today's DailySummary for a pen section:
//   - Checklist items the worker can tick off (PATCH /api/daily-summary/[id])
//   - Aggregated production totals (eggs, feed, mortality, water)
//   - Closing observation textarea
//   - Status pill (PENDING / SUBMITTED / REVIEWED)
//
// The DailySummary record is auto-created by the server at the start of each day
// (or on first load if missing). The worker updates checklist items + observation.
//
// Props:
//   penSectionId — string
//   apiFetch     — from useAuth()

import { useState, useEffect, useCallback } from 'react';

const fmt    = (n, d = 0) => Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: d });
const fmtKg  = n => `${fmt(n, 1)} kg`;
const fmtL   = n => `${fmt(n, 1)} L`;

const STATUS_STYLES = {
  PENDING:   { label: 'In Progress',  bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  SUBMITTED: { label: 'Submitted',    bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  REVIEWED:  { label: 'PM Reviewed',  bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  FLAGGED:   { label: 'Flagged',      bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
};

const CHECKLIST_LABELS = {
  waterNipplesChecked: 'Water nipples checked',
  manureBeltsRun:      'Manure belts run',
  aislesSwept:         'Aisles swept',
  cageDoorsInspected:  'Cage doors inspected',
};

export default function DailySummaryCard({ penSectionId, isLayer = true, stage = 'PRODUCTION', apiFetch, refreshKey = 0 }) {
  // Eggs are only tracked in PRODUCTION stage — hide for BROODING / REARING
  const showEggs = isLayer && (stage === 'PRODUCTION' || !stage);
  const [summary,    setSummary]    = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [obs,        setObs]        = useState('');
  const [obsDirty,   setObsDirty]   = useState(false);
  const [error,      setError]      = useState('');

  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Fetch today's summary ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/daily-summary?penSectionId=${penSectionId}&date=${todayStr}`);
      if (!res.ok) { setError('Could not load daily summary'); return; }
      const d = await res.json();
      setSummary(d.summary);
      setObs(d.summary?.closingObservation || '');
      setObsDirty(false);
    } catch { setError('Network error loading daily summary'); }
    finally  { setLoading(false); }
  }, [penSectionId, todayStr]);

  // refreshKey changes whenever the parent saves a production record, triggering a re-fetch
  useEffect(() => { load(); }, [load, refreshKey]);

  // ── PATCH a checklist item ─────────────────────────────────────────────────
  async function toggleCheck(field, newValue) {
    if (!summary?.id || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/daily-summary/${summary.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: newValue }),
      });
      if (res.ok) {
        const d = await res.json();
        setSummary(d.summary);
      }
    } catch { /* non-fatal */ }
    finally { setSaving(false); }
  }

  // ── Save closing observation ───────────────────────────────────────────────
  async function saveObservation() {
    if (!summary?.id || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/daily-summary/${summary.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ closingObservation: obs.trim() || null }),
      });
      if (res.ok) {
        const d = await res.json();
        setSummary(d.summary);
        setObsDirty(false);
      }
    } catch { /* non-fatal */ }
    finally { setSaving(false); }
  }

  // ── Submit summary (PM action) ────────────────────────────────────────────
  async function submitSummary() {
    if (!summary?.id || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/daily-summary', {
        method: 'POST',
        body: JSON.stringify({ penSectionId }),
      });
      if (res.ok) {
        const d = await res.json();
        setSummary(d.summary);
      }
    } catch { /* non-fatal */ }
    finally { setSubmitting(false); }
  }

  if (loading) {
    return (
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--border-card)', padding: '14px 16px', marginTop: 10 }}>
        <div style={{ height: 14, width: '60%', background: 'var(--bg-elevated)', borderRadius: 6, animation: 'pulse 1.5s infinite' }} />
      </div>
    );
  }

  if (error || !summary) {
    return null;
  }

  const st       = STATUS_STYLES[summary.status] || STATUS_STYLES.PENDING;
  const isLocked = summary.status === 'REVIEWED' || summary.status === 'SUBMITTED';
  const canSubmit= summary.status === 'PENDING';

  const checklist  = Object.entries(CHECKLIST_LABELS);
  const doneCount  = checklist.filter(([k]) => summary[k] === true).length;
  const allChecked = doneCount === checklist.length;

  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      border: '1px solid var(--border-card)',
      marginTop: 10, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
          📋 Daily Summary — {new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
        </span>
        <span style={{
          padding: '2px 10px', borderRadius: 99, fontSize: 10, fontWeight: 700,
          background: st.bg, color: st.color, border: `1px solid ${st.border}`,
        }}>
          {st.label}
        </span>
      </div>

      <div style={{ padding: '12px 14px' }}>

        {/* Production totals */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'Eggs',   value: fmt(summary.totalEggsCollected), icon: '🥚', show: showEggs },
            { label: 'Feed',   value: fmtKg(summary.totalFeedKg),      icon: '🍽️', show: true },
            { label: 'Deaths', value: fmt(summary.totalMortality),     icon: '💀', show: true },
            { label: 'Water',  value: fmtL(summary.waterConsumptionL), icon: '💧', show: Number(summary.waterConsumptionL) > 0 },
          ].filter(i => i.show).map(item => (
            <div key={item.label} style={{
              flex: 1, minWidth: 72,
              background: 'var(--bg-elevated)', borderRadius: 8,
              padding: '7px 10px', textAlign: 'center',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: 14, marginBottom: 2 }}>{item.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif" }}>{item.value}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
            </div>
          ))}
        </div>

        {/* Checklist */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Checklist ({doneCount}/{checklist.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {checklist.map(([field, label]) => {
              const checked = summary[field] === true;
              return (
                <label key={field} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: isLocked ? 'default' : 'pointer',
                  padding: '6px 10px', borderRadius: 7,
                  background: checked ? 'var(--green-bg)' : 'var(--bg-elevated)',
                  border: `1px solid ${checked ? 'var(--green-border)' : 'var(--border)'}`,
                  opacity: saving ? 0.6 : 1, transition: 'all 0.15s',
                }}>
                  <input
                    type="checkbox"
                    checked={!!checked}
                    disabled={isLocked || saving}
                    onChange={e => toggleCheck(field, e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: 'var(--green)', cursor: isLocked ? 'default' : 'pointer' }}
                  />
                  <span style={{ fontSize: 13, color: checked ? '#166534' : 'var(--text-secondary)', fontWeight: checked ? 700 : 400 }}>
                    {label}
                  </span>
                  {checked && <span style={{ marginLeft: 'auto', fontSize: 14 }}>✅</span>}
                </label>
              );
            })}
          </div>
        </div>

        {/* Closing observation */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Closing Observation
          </div>
          {isLocked ? (
            <div style={{ fontSize: 13, color: summary.closingObservation ? 'var(--text-secondary)' : 'var(--text-muted)', fontStyle: summary.closingObservation ? 'normal' : 'italic', padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 7, border: '1px solid var(--border)', minHeight: 36 }}>
              {summary.closingObservation || 'No observation recorded'}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <textarea
                className="input"
                rows={2}
                value={obs}
                onChange={e => { setObs(e.target.value); setObsDirty(true); }}
                placeholder="Note anything unusual before end of day…"
                style={{ resize: 'vertical', paddingRight: 70 }}
              />
              {obsDirty && (
                <button
                  onClick={saveObservation}
                  disabled={saving}
                  style={{
                    position: 'absolute', right: 8, bottom: 8,
                    padding: '4px 10px', borderRadius: 6, border: 'none',
                    background: 'var(--purple)', color: '#fff',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? '…' : 'Save'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pending verification flags */}
        {(summary.pendingFeedVerifications > 0 || summary.pendingMortalityVerifications > 0 || (showEggs && summary.pendingEggVerifications > 0)) && (
          <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
            ⏳ Awaiting PM verification:
            {showEggs && summary.pendingEggVerifications > 0 && ` ${summary.pendingEggVerifications} egg`}
            {summary.pendingFeedVerifications > 0 && ` · ${summary.pendingFeedVerifications} feed`}
            {summary.pendingMortalityVerifications > 0 && ` · ${summary.pendingMortalityVerifications} mortality`}
          </div>
        )}

        {/* PM review notes */}
        {summary.reviewNotes && (
          <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--green-bg)', border: '1px solid var(--green-border)', borderRadius: 8, fontSize: 12, color: '#166534' }}>
            ✅ PM Note: {summary.reviewNotes}
          </div>
        )}

        {/* Submit day button — shown when PENDING and checklist is complete */}
        {canSubmit && allChecked && obs.trim() && (
          <button
            onClick={submitSummary}
            disabled={submitting}
            style={{
              width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
              background: submitting ? '#94a3b8' : '#16a34a',
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}>
            {submitting ? 'Submitting…' : '✓ Submit Day Summary'}
          </button>
        )}
        {canSubmit && (!allChecked || !obs.trim()) && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 4 }}>
            {!allChecked ? `Complete checklist (${doneCount}/${checklist.length})` : 'Add a closing observation'} to submit
          </div>
        )}

      </div>
    </div>
  );
}
