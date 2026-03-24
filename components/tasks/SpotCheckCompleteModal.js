'use client';
// components/tasks/SpotCheckCompleteModal.js
// Structured completion modal for spot-check tasks.
// Replaces the generic "Done" button with a purpose-built form that captures
// real measurement data and writes it to the production record tables.
//
// WEIGHT_RECORDING: enters weight measurements → writes to WeightRecord +
//   compares against last logged weight → flags significant deviation to IC.
//
// INSPECTION: structured checklist (6 items) → any flagged item auto-notifies IC.
//
// Props:
//   task      — Task object with taskType, penSectionId, description, title
//   apiFetch  — from useAuth()
//   onClose   — close handler
//   onSave    — called after successful completion

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ── Inspection checklist items ────────────────────────────────────────────────
const CHECKLIST = [
  { key: 'feed',     label: 'Feed access',         sub: 'All feeders accessible, no blockages, adequate feed visible' },
  { key: 'water',    label: 'Water supply',         sub: 'Drinkers functioning, no leaks, water appears clean' },
  { key: 'birds',    label: 'Bird behaviour',       sub: 'Active, no lethargy, no signs of respiratory distress or huddling' },
  { key: 'litter',   label: 'Litter condition',     sub: 'Dry and friable, no wet patches or caking under drinkers' },
  { key: 'disease',  label: 'Disease / injury signs',sub: 'No visible lesions, swollen joints, eye discharge, or unusual mortality' },
  { key: 'security', label: 'Biosecurity',           sub: 'Doors secured, no pests, disinfectant footbath present if required' },
];

const RATING = {
  ok:   { label: 'OK',    color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  warn: { label: 'Concern', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  fail: { label: 'Fail',  color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
};

export default function SpotCheckCompleteModal({ task, apiFetch, onClose, onSave }) {
  const isWeight    = task.taskType === 'WEIGHT_RECORDING';
  const isInspection= task.taskType === 'INSPECTION';

  // ── Weight form state ─────────────────────────────────────────────────────
  const [sampleCount,   setSampleCount]   = useState('30');
  const [avgWeightG,    setAvgWeightG]    = useState('');
  const [minWeightG,    setMinWeightG]    = useState('');
  const [maxWeightG,    setMaxWeightG]    = useState('');
  const [uniformityPct, setUniformityPct] = useState('');
  const [weightNotes,   setWeightNotes]   = useState('');

  // ── Inspection form state ─────────────────────────────────────────────────
  const [ratings,    setRatings]    = useState({}); // { feed: 'ok' | 'warn' | 'fail' }
  const [itemNotes,  setItemNotes]  = useState({}); // { feed: 'string' }
  const [overallNote,setOverallNote]= useState('');

  // ── Shared state ──────────────────────────────────────────────────────────
  const [flock,   setFlock]   = useState(null); // active flock in the section
  const [lastWt,  setLastWt]  = useState(null); // last WeightRecord for comparison
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(true);

  // ── Load section context ───────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Fetch active flock for this section
        const flockRes = await apiFetch(
          `/api/farm?penSectionId=${task.penSectionId}&status=ACTIVE`
        );
        if (flockRes.ok) {
          const d = await flockRes.json();
          const active = (d.flocks || d.sections || []).find?.(f => f.status === 'ACTIVE')
            || d.flock
            || null;
          setFlock(active);
        }

        // Fetch last weight record for comparison (weight tasks only)
        if (isWeight) {
          const wtRes = await apiFetch(
            `/api/weight-records?days=30${task.penSectionId ? `&penSectionId=${task.penSectionId}` : ''}`
          );
          if (wtRes.ok) {
            const d = await wtRes.json();
            const samples = (d.samples || []).sort(
              (a, b) => new Date(b.sampleDate) - new Date(a.sampleDate)
            );
            setLastWt(samples[0] || null);
          }
        }
      } catch { /* silent */ }
      finally  { setLoading(false); }
    })();
  }, [apiFetch, task.penSectionId, isWeight]);

  // ── Deviation from last weight ─────────────────────────────────────────────
  const avgNum    = parseFloat(avgWeightG) || 0;
  const lastAvg   = lastWt ? Number(lastWt.meanWeightG) : null;
  const deviation = (lastAvg && avgNum)
    ? parseFloat((((avgNum - lastAvg) / lastAvg) * 100).toFixed(1))
    : null;
  const deviationFlag = deviation !== null && Math.abs(deviation) > 15;

  // ── Inspection: any fails or warnings ────────────────────────────────────
  const failCount = CHECKLIST.filter(c => ratings[c.key] === 'fail').length;
  const warnCount = CHECKLIST.filter(c => ratings[c.key] === 'warn').length;
  const allRated  = CHECKLIST.every(c => ratings[c.key]);

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate() {
    if (isWeight) {
      if (!avgWeightG || avgNum <= 0) return 'Enter average weight';
      if (!sampleCount || Number(sampleCount) < 1) return 'Sample count must be at least 1';
      if (minWeightG && maxWeightG && Number(minWeightG) > Number(maxWeightG))
        return 'Min weight cannot exceed max weight';
    }
    if (isInspection) {
      if (!allRated) return 'Rate all checklist items before completing';
      if (failCount > 0 && !overallNote.trim())
        return 'Add overall notes when any item fails';
    }
    return null;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    const validErr = validate();
    if (validErr) { setErr(validErr); return; }
    setSaving(true); setErr('');

    try {
      let completionNotes = '';
      let weightRecordId  = null;

      if (isWeight) {
        // 1. Write WeightRecord
        const today = new Date().toISOString().split('T')[0];
        const wtRes = await apiFetch('/api/weight-records', {
          method: 'POST',
          body:   JSON.stringify({
            flockId:       flock?.id || task.flockId,
            penSectionId:  task.penSectionId,
            sampleDate:    today,
            sampleCount:   Number(sampleCount),
            meanWeightG:   avgNum,
            minWeightG:    minWeightG ? Number(minWeightG) : null,
            maxWeightG:    maxWeightG ? Number(maxWeightG) : null,
            uniformityPct: uniformityPct ? Number(uniformityPct) : null,
            notes:         weightNotes || null,
          }),
        });
        let wtD = {};
        try { wtD = await wtRes.json(); } catch {}
        if (!wtRes.ok) { setErr(wtD.error || 'Failed to save weight record'); return; }
        weightRecordId = wtD.id;

        completionNotes = [
          `Sample: ${sampleCount} birds`,
          `Avg: ${avgNum}g`,
          minWeightG ? `Min: ${minWeightG}g` : null,
          maxWeightG ? `Max: ${maxWeightG}g` : null,
          uniformityPct ? `Uniformity: ${uniformityPct}%` : null,
          lastAvg && deviation !== null
            ? `vs last weigh-in (${lastAvg}g): ${deviation > 0 ? '+' : ''}${deviation}%${deviationFlag ? ' ⚠️ FLAGGED' : ''}`
            : null,
          weightNotes || null,
        ].filter(Boolean).join(' · ');
      }

      if (isInspection) {
        const itemSummary = CHECKLIST.map(c =>
          `${c.label}: ${RATING[ratings[c.key]]?.label || '—'}${itemNotes[c.key] ? ` (${itemNotes[c.key]})` : ''}`
        ).join('\n');

        completionNotes = [
          `Checklist: ${CHECKLIST.length - failCount - warnCount} OK, ${warnCount} concern${warnCount !== 1 ? 's' : ''}, ${failCount} fail${failCount !== 1 ? 's' : ''}`,
          itemSummary,
          overallNote || null,
        ].filter(Boolean).join('\n');
      }

      // 2. Mark task complete
      const taskRes = await apiFetch('/api/tasks?action=complete', {
        method: 'POST',
        body:   JSON.stringify({
          taskId:          task.id,
          completionNotes,
          ...(weightRecordId && { weightRecordId }),
        }),
      });
      let taskD = {};
      try { taskD = await taskRes.json(); } catch {}
      if (!taskRes.ok) { setErr(taskD.error || 'Failed to complete task'); return; }

      onSave({ task: taskD.task, deviationFlag, failCount });

    } catch { setErr('Network error — please try again'); }
    finally  { setSaving(false); }
  };

  const title = isWeight ? '⚖️ Record Spot-Check Weight' : '🔍 Complete Section Inspection';

  return createPortal(
    <div
      style={{ position:'fixed', inset:0, zIndex:1200, background:'rgba(0,0,0,0.45)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:500,
        maxHeight:'90vh', display:'flex', flexDirection:'column',
        boxShadow:'0 12px 48px rgba(0,0,0,0.2)', animation:'fadeInUp 0.2s ease' }}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border-card)',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontFamily:"'Poppins',sans-serif", fontWeight:800, fontSize:14 }}>{title}</span>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--text-muted)' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding:'16px 20px', overflowY:'auto', flexGrow:1, display:'flex', flexDirection:'column', gap:14 }}>

          {/* Task context */}
          <div style={{ padding:'10px 14px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:9, fontSize:12 }}>
            <div style={{ fontWeight:700, color:'#92400e', marginBottom:2 }}>🎲 Spot Check — Unannounced</div>
            <div style={{ color:'var(--text-secondary)' }}>{task.penSection?.pen?.name} › {task.penSection?.name}</div>
            {flock && <div style={{ color:'var(--text-muted)', marginTop:2 }}>Flock: {flock.batchCode} · {flock.currentCount?.toLocaleString('en-NG')} birds</div>}
          </div>

          {err && (
            <div style={{ padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca',
              borderRadius:8, fontSize:12, color:'#dc2626' }}>⚠ {err}</div>
          )}

          {loading ? (
            <div style={{ padding:'24px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
              Loading section data…
            </div>
          ) : isWeight ? (
            /* ── Weight recording form ── */
            <>
              {/* Last weight comparison */}
              {lastWt && (
                <div style={{ padding:'9px 12px', background:'var(--bg-elevated)', borderRadius:8, fontSize:11, color:'var(--text-secondary)' }}>
                  Last recorded: <strong>{Number(lastWt.meanWeightG).toFixed(0)} g avg</strong>
                  {' '}({Math.floor((Date.now() - new Date(lastWt.sampleDate)) / 86400000)} days ago, {lastWt.sampleCount} birds sampled)
                </div>
              )}

              {/* Weight inputs */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div style={{ gridColumn:'1/-1' }}>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                    Sample size (birds weighed) *
                  </label>
                  <input type="number" className="input" min="1" value={sampleCount}
                    onChange={e => { setSampleCount(e.target.value); setErr(''); }}
                    placeholder="e.g. 30" autoFocus />
                  <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3 }}>Minimum 30 birds recommended for accuracy</div>
                </div>

                <div style={{ gridColumn:'1/-1' }}>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                    Average weight (grams) *
                  </label>
                  <input type="number" className="input" min="1" step="1" value={avgWeightG}
                    onChange={e => { setAvgWeightG(e.target.value); setErr(''); }}
                    placeholder="e.g. 1850" />
                  {/* Live deviation preview */}
                  {avgNum > 0 && lastAvg && deviation !== null && (
                    <div style={{ marginTop:5, fontSize:11, fontWeight:600,
                      color: deviationFlag ? '#dc2626' : '#16a34a' }}>
                      {deviation > 0 ? '▲' : '▼'} {Math.abs(deviation)}% vs last weigh-in
                      {deviationFlag && ' — will be flagged to IC'}
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>Min weight (g)</label>
                  <input type="number" className="input" min="1" step="1" value={minWeightG}
                    onChange={e => setMinWeightG(e.target.value)} placeholder="Optional" />
                </div>
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>Max weight (g)</label>
                  <input type="number" className="input" min="1" step="1" value={maxWeightG}
                    onChange={e => setMaxWeightG(e.target.value)} placeholder="Optional" />
                </div>

                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>Uniformity (%)</label>
                  <input type="number" className="input" min="0" max="100" step="0.1" value={uniformityPct}
                    onChange={e => setUniformityPct(e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                  Notes <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(optional)</span>
                </label>
                <textarea className="input" rows={2} value={weightNotes}
                  onChange={e => setWeightNotes(e.target.value)}
                  placeholder="Observations during weighing…" style={{ resize:'vertical' }} />
              </div>
            </>

          ) : isInspection ? (
            /* ── Inspection checklist ── */
            <>
              <div style={{ fontSize:12, color:'var(--text-secondary)' }}>
                Rate each item. Any <strong style={{ color:'#dc2626' }}>Fail</strong> will automatically notify IC.
              </div>

              {CHECKLIST.map(item => (
                <div key={item.key} style={{ border:'1px solid var(--border-card)', borderRadius:9, overflow:'hidden' }}>
                  <div style={{ padding:'10px 14px', background:'var(--bg-elevated)' }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)', marginBottom:1 }}>{item.label}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)' }}>{item.sub}</div>
                  </div>
                  {/* Rating buttons */}
                  <div style={{ padding:'8px 14px', display:'flex', gap:8, background:'#fff' }}>
                    {Object.entries(RATING).map(([key, meta]) => (
                      <button key={key}
                        onClick={() => { setRatings(p => ({ ...p, [item.key]: key })); setErr(''); }}
                        style={{
                          flex:1, padding:'6px 0', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
                          border:`1.5px solid ${ratings[item.key] === key ? meta.color : '#e2e8f0'}`,
                          background: ratings[item.key] === key ? meta.bg : '#fff',
                          color:      ratings[item.key] === key ? meta.color : 'var(--text-muted)',
                        }}>
                        {meta.label}
                      </button>
                    ))}
                  </div>
                  {/* Per-item note — shown when concern or fail */}
                  {(ratings[item.key] === 'warn' || ratings[item.key] === 'fail') && (
                    <div style={{ padding:'0 14px 10px', background:'#fff' }}>
                      <input type="text" className="input" style={{ fontSize:11 }}
                        value={itemNotes[item.key] || ''}
                        onChange={e => setItemNotes(p => ({ ...p, [item.key]: e.target.value }))}
                        placeholder="Describe the issue…" autoFocus />
                    </div>
                  )}
                </div>
              ))}

              {/* Summary + overall note */}
              {allRated && (failCount > 0 || warnCount > 0) && (
                <div style={{ padding:'10px 14px', background: failCount > 0 ? '#fef2f2' : '#fffbeb',
                  border:`1px solid ${failCount > 0 ? '#fecaca' : '#fde68a'}`, borderRadius:9 }}>
                  <div style={{ fontSize:12, fontWeight:700, color: failCount > 0 ? '#dc2626' : '#d97706', marginBottom:6 }}>
                    {failCount > 0 ? `⚠️ ${failCount} item${failCount !== 1 ? 's' : ''} failed — IC will be notified` : `⚠️ ${warnCount} concern${warnCount !== 1 ? 's' : ''} noted`}
                  </div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                    Overall notes {failCount > 0 ? '*' : '(optional)'}
                  </label>
                  <textarea className="input" rows={2} value={overallNote}
                    onChange={e => { setOverallNote(e.target.value); setErr(''); }}
                    placeholder="Summarise what you found and any immediate actions taken…"
                    style={{ resize:'vertical' }} />
                </div>
              )}

              {allRated && failCount === 0 && warnCount === 0 && (
                <div style={{ padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:9, fontSize:12, color:'#16a34a', fontWeight:600 }}>
                  ✅ All items rated OK — section is in good condition.
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid var(--border-card)',
          display:'flex', gap:10, justifyContent:'flex-end', flexShrink:0 }}>
          <button onClick={onClose}
            style={{ padding:'8px 16px', borderRadius:8, border:'1px solid var(--border-card)',
              background:'#fff', color:'var(--text-secondary)', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving || loading}
            style={{ padding:'8px 18px', borderRadius:8, border:'none',
              background: saving || loading ? '#94a3b8' : '#16a34a',
              color:'#fff', fontSize:12, fontWeight:700,
              cursor: saving || loading ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : isWeight ? 'Save Weight & Complete' : 'Submit Inspection'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
