'use client';
// app/pen-manager/daily-summaries/page.js
// Daily Summaries review page for Pen Managers (and Farm Managers+).
//
// Shows all sections the PM manages for a given date with their daily summary.
// Statuses:
//   (no record)  — Workers haven't submitted yet — shown as "Awaiting"
//   PENDING      — Worker logged data but hasn't submitted end-of-day summary
//   SUBMITTED    — Worker submitted; awaiting PM review
//   FLAGGED      — PM flagged for attention / re-review
//   REVIEWED     — PM has reviewed and acknowledged

import { useState, useEffect, useCallback } from 'react';
import AppShell   from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (n, d = 0) => Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: d });
const fmtKg   = n => `${fmt(n, 1)} kg`;
const fmtDate = d => new Date(d).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const STATUS_META = {
  PENDING:   { label: 'In Progress',    color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: '⏳' },
  SUBMITTED: { label: 'Awaiting Review',color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: '📬' },
  FLAGGED:   { label: 'Flagged',        color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: '🚩' },
  REVIEWED:  { label: 'Reviewed',       color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: '✅' },
  AWAITING:  { label: 'Not Submitted',  color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0', icon: '⬜' },
};

const CHECKLIST_LABELS = {
  waterNipplesChecked: 'Water nipples',
  manureBeltsRun:      'Manure belts',
  aislesSwept:         'Aisles swept',
  cageDoorsInspected:  'Cage doors',
};

// ── DateNav ───────────────────────────────────────────────────────────────────
function DateNav({ dateStr, onChange }) {
  const d    = new Date(dateStr + 'T00:00:00Z');
  const prev = () => { const p = new Date(d); p.setUTCDate(p.getUTCDate() - 1); onChange(p.toISOString().slice(0, 10)); };
  const next = () => { const n = new Date(d); n.setUTCDate(n.getUTCDate() + 1); onChange(n.toISOString().slice(0, 10)); };
  const isToday = dateStr === new Date().toLocaleDateString('sv'); // sv locale gives YYYY-MM-DD

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button onClick={prev} style={{ border: '1px solid var(--border-card)', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>← Prev</button>
      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-main)' }}>{fmtDate(d)}</span>
      <button onClick={next} disabled={isToday} style={{ border: '1px solid var(--border-card)', background: isToday ? '#f1f5f9' : '#fff', borderRadius: 8, padding: '6px 12px', cursor: isToday ? 'default' : 'pointer', fontSize: 13, opacity: isToday ? 0.5 : 1 }}>Next →</button>
      {!isToday && (
        <button onClick={() => onChange(new Date().toLocaleDateString('sv'))} style={{ border: '1px solid var(--purple)', background: 'var(--purple)', color: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Today
        </button>
      )}
    </div>
  );
}

// ── ReviewModal ───────────────────────────────────────────────────────────────
function ReviewModal({ entry, apiFetch, onClose, onDone }) {
  const { summary, section } = entry;
  const [notes,    setNotes]    = useState(summary?.reviewNotes || '');
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const isLayer = section.pen.operationType === 'LAYER';

  const submit = async (newStatus) => {
    if (!summary?.id) return;
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/daily-summary/${summary.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewNotes: notes.trim() || null, status: newStatus }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return; }
      onDone();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  const checklist = Object.entries(CHECKLIST_LABELS).map(([k, label]) => ({
    label, checked: summary?.[k] || false,
  }));
  const checkCount = checklist.filter(c => c.checked).length;

  const hasPendingVerif = (summary?.pendingEggVerifications || 0) +
    (summary?.pendingFeedVerifications || 0) + (summary?.pendingMortalityVerifications || 0) > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-main)' }}>
                {section.pen.name} · {section.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                Daily Summary Review
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>✕</button>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>

          {/* Production totals */}
          <div style={{ display: 'grid', gridTemplateColumns: isLayer ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 10, marginBottom: 20 }}>
            {isLayer && (
              <Tile icon="🥚" label="Eggs" value={fmt(summary?.totalEggsCollected)} />
            )}
            <Tile icon="🍽️" label="Feed" value={fmtKg(summary?.totalFeedKg)} />
            <Tile icon="💀" label="Deaths" value={fmt(summary?.totalMortality)} />
          </div>

          {/* Checklist */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Checklist ({checkCount}/4)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {checklist.map(({ label, checked }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: checked ? '#16a34a' : '#94a3b8' }}>
                  <span style={{ fontSize: 15 }}>{checked ? '✅' : '⬜'}</span> {label}
                </div>
              ))}
            </div>
          </div>

          {/* Closing observation */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Worker Observation
            </div>
            <div style={{ fontSize: 13, color: summary?.closingObservation ? 'var(--text-main)' : 'var(--text-muted)', background: '#f8fafc', borderRadius: 8, padding: '10px 12px', fontStyle: summary?.closingObservation ? 'normal' : 'italic' }}>
              {summary?.closingObservation || 'No observation recorded'}
            </div>
          </div>

          {/* Pending verifications warning */}
          {hasPendingVerif && (
            <div style={{ marginBottom: 16, padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
              ⚠️ Pending verifications: {summary.pendingEggVerifications > 0 && `${summary.pendingEggVerifications} egg`} {summary.pendingFeedVerifications > 0 && `${summary.pendingFeedVerifications} feed`} {summary.pendingMortalityVerifications > 0 && `${summary.pendingMortalityVerifications} mortality`} — records not yet verified by store/IC.
            </div>
          )}

          {/* PM review notes */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
              Review Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add any notes for this section's daily summary..."
              rows={3}
              style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border-card)', padding: '10px 12px', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
            />
          </div>

          {error && <div style={{ marginBottom: 12, color: '#dc2626', fontSize: 13 }}>{error}</div>}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => submit('REVIEWED')}
              disabled={saving}
              style={{ flex: 1, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : '✅ Mark Reviewed'}
            </button>
            <button
              onClick={() => submit('FLAGGED')}
              disabled={saving}
              style={{ flex: 1, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              🚩 Flag
            </button>
            <button onClick={onClose} style={{ padding: '11px 16px', background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ icon, label, value }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', textAlign: 'center', border: '1px solid var(--border-card)' }}>
      <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-main)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ── SummaryRow ─────────────────────────────────────────────────────────────────
function SummaryRow({ entry, onReview }) {
  const { section, summary } = entry;
  const isLayer  = section.pen.operationType === 'LAYER';
  const statusKey = summary ? summary.status : 'AWAITING';
  const meta      = STATUS_META[statusKey] || STATUS_META.AWAITING;

  const checklist = summary
    ? Object.keys(CHECKLIST_LABELS).filter(k => summary[k]).length
    : 0;

  const canReview = summary && ['SUBMITTED', 'FLAGGED'].includes(summary.status);

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: `1px solid ${meta.border}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>

      {/* Status pill */}
      <div style={{ minWidth: 130 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: meta.bg, border: `1px solid ${meta.border}` }}>
          <span style={{ fontSize: 12 }}>{meta.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
        </div>
      </div>

      {/* Section name */}
      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-main)' }}>{section.pen.name} · {section.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
          {isLayer ? 'Layer' : 'Broiler'}
          {summary?.submittedAt && ` · Submitted ${new Date(summary.submittedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`}
        </div>
      </div>

      {/* Production quick stats */}
      {summary ? (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {isLayer && (
            <Stat label="Eggs" value={fmt(summary.totalEggsCollected)} color="#d97706" />
          )}
          <Stat label="Feed" value={fmtKg(summary.totalFeedKg)} color="#6c63ff" />
          <Stat label="Deaths" value={fmt(summary.totalMortality)} color={summary.totalMortality > 0 ? '#dc2626' : '#64748b'} />
          <Stat label="Checklist" value={`${checklist}/4`} color={checklist === 4 ? '#16a34a' : '#d97706'} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No data logged yet</div>
      )}

      {/* Observation snippet */}
      {summary?.closingObservation && (
        <div style={{ width: '100%', fontSize: 12, color: 'var(--text-muted)', background: '#f8fafc', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}>
          💬 {summary.closingObservation.length > 100 ? summary.closingObservation.slice(0, 100) + '…' : summary.closingObservation}
        </div>
      )}

      {/* Review button */}
      {canReview ? (
        <button
          onClick={() => onReview(entry)}
          style={{ padding: '8px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Review →
        </button>
      ) : summary?.status === 'REVIEWED' ? (
        <button
          onClick={() => onReview(entry)}
          style={{ padding: '8px 16px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          View ✅
        </button>
      ) : null}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 44 }}>
      <div style={{ fontWeight: 800, fontSize: 15, color }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DailySummariesPage() {
  const { apiFetch, role } = useAuth();

  const todayStr = () => {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
      .toISOString().slice(0, 10);
  };

  const [dateStr,     setDateStr]     = useState(todayStr);
  const [sections,    setSections]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [reviewEntry, setReviewEntry] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiFetch(`/api/daily-summary?pmView=true&date=${dateStr}`);
      if (!res.ok) { setError('Failed to load summaries'); return; }
      const d = await res.json();
      setSections(d.sections || []);
    } catch { setError('Network error'); }
    finally  { setLoading(false); }
  }, [apiFetch, dateStr]);

  useEffect(() => { load(); }, [load]);

  const handleDone = () => { setReviewEntry(null); load(); };

  // Counts for header badges
  const submitted = sections.filter(e => e.summary?.status === 'SUBMITTED').length;
  const flagged   = sections.filter(e => e.summary?.status === 'FLAGGED').length;
  const reviewed  = sections.filter(e => e.summary?.status === 'REVIEWED').length;
  const pending   = sections.filter(e => !e.summary || e.summary.status === 'PENDING').length;

  return (
    <AppShell>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px', minHeight: '100vh', background: 'var(--bg-page, #f8fafc)' }}>

        {/* Page header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>Daily Summaries</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Review and acknowledge end-of-day section reports from your workers.
          </p>
        </div>

        {/* Date nav */}
        <div style={{ marginBottom: 20 }}>
          <DateNav dateStr={dateStr} onChange={setDateStr} />
        </div>

        {/* Summary badges */}
        {!loading && sections.length > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            {[
              { label: 'Need Review', count: submitted, color: '#2563eb', bg: '#eff6ff' },
              { label: 'Flagged',     count: flagged,   color: '#dc2626', bg: '#fef2f2' },
              { label: 'Reviewed',    count: reviewed,  color: '#16a34a', bg: '#f0fdf4' },
              { label: 'In Progress / No Submission', count: pending, color: '#94a3b8', bg: '#f8fafc' },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{ padding: '6px 14px', borderRadius: 20, background: bg, border: `1px solid ${color}22`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 800, fontSize: 16, color }}>{count}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 80, borderRadius: 12, background: '#f1f5f9', animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ padding: 20, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#dc2626', fontSize: 14 }}>
            {error}
          </div>
        ) : sections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>No sections found</div>
            <div style={{ fontSize: 13 }}>No sections are assigned to you.</div>
          </div>
        ) : (
          <>
            {/* Needs review first */}
            {submitted + flagged > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Needs Review ({submitted + flagged})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sections
                    .filter(e => ['SUBMITTED', 'FLAGGED'].includes(e.summary?.status))
                    .map(entry => (
                      <SummaryRow key={entry.section.id} entry={entry} onReview={setReviewEntry} />
                    ))}
                </div>
              </div>
            )}

            {/* Already reviewed */}
            {reviewed > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Reviewed ({reviewed})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sections
                    .filter(e => e.summary?.status === 'REVIEWED')
                    .map(entry => (
                      <SummaryRow key={entry.section.id} entry={entry} onReview={setReviewEntry} />
                    ))}
                </div>
              </div>
            )}

            {/* Still in progress / not submitted */}
            {pending > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  In Progress / Not Yet Submitted ({pending})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sections
                    .filter(e => !e.summary || e.summary.status === 'PENDING')
                    .map(entry => (
                      <SummaryRow key={entry.section.id} entry={entry} onReview={() => {}} />
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Review modal */}
      {reviewEntry && (
        <ReviewModal
          entry={reviewEntry}
          apiFetch={apiFetch}
          onClose={() => setReviewEntry(null)}
          onDone={handleDone}
        />
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>
    </AppShell>
  );
}
