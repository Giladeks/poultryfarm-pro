'use client';
// components/weight/BucketWeightModal.js
// Bucket-entry weight modal — worker taps each bird's weight one at a time.
// Replaces the manual avg/min/max entry across worker, rearing and broiler-performance pages.
//
// Props:
//   section      — section object (from /api/dashboard or farm-structure)
//   task         — optional task object (for WEIGHT_RECORDING tasks)
//   apiFetch     — from useAuth()
//   onClose      — close handler
//   onSave       — called with the saved weight record on success
//   opType       — 'LAYER' | 'BROILER' (default: section.pen?.operationType)
//   targetSample — number of birds to weigh (default 50)
//
// Layer weight benchmarks (ISA Brown production):
//   < 1700g  → underweight (flag red)
//   1700-1800g → low warning (flag amber)
//   1800-2000g → healthy range (green)
//   2000-2200g → high warning (flag amber)
//   > 2200g  → obese (flag red)
//
// Broiler weight: compared against Ross 308 standard by age (existing logic)
//
// Uniformity = % of birds within ±10% of the mean

import { useState, useRef, useEffect } from 'react';

const LAYER_WEIGHT_MIN_WARN = 1800;  // below this = low warning
const LAYER_WEIGHT_MIN_CRIT = 1700;  // below this = underweight critical
const LAYER_WEIGHT_MAX_WARN = 2000;  // above this = high warning
const LAYER_WEIGHT_MAX_CRIT = 2200;  // above this = obese critical

const TARGET_SAMPLE = 50;

function computeStats(weights) {
  if (!weights.length) return { avg: null, min: null, max: null, uniformity: null };
  const avg  = parseFloat((weights.reduce((s, w) => s + w, 0) / weights.length).toFixed(1));
  const min  = Math.min(...weights);
  const max  = Math.max(...weights);
  const band = avg * 0.1; // ±10%
  const inBand = weights.filter(w => w >= avg - band && w <= avg + band).length;
  const uniformity = parseFloat(((inBand / weights.length) * 100).toFixed(1));
  return { avg, min, max, uniformity };
}

function layerWeightStatus(avg) {
  if (!avg) return null;
  if (avg < LAYER_WEIGHT_MIN_CRIT) return { label: 'Underweight', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
  if (avg < LAYER_WEIGHT_MIN_WARN) return { label: 'Low', color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
  if (avg > LAYER_WEIGHT_MAX_CRIT) return { label: 'Obese', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
  if (avg > LAYER_WEIGHT_MAX_WARN) return { label: 'High', color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
  return { label: 'Healthy', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' };
}

export default function BucketWeightModal({ section, task, apiFetch, onClose, onSave, opType, targetSample = TARGET_SAMPLE }) {
  const flock      = section?.flock ?? section?.activeFlock ?? null;
  const resolvedOp = opType || section?.pen?.operationType || section?.penOperationType || 'LAYER';
  const isLayer    = resolvedOp === 'LAYER';

  const [weights,    setWeights]    = useState([]);      // array of numbers
  const [input,      setInput]      = useState('');
  const [date,       setDate]       = useState(() => new Date().toISOString().split('T')[0]);
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const inputRef = useRef(null);

  // Auto-focus the weight input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const stats    = computeStats(weights);
  const count    = weights.length;
  const progress = Math.min(100, (count / targetSample) * 100);
  const complete = count >= targetSample;
  const statusL  = isLayer ? layerWeightStatus(stats.avg) : null;

  const addWeight = () => {
    const val = parseFloat(input);
    if (!val || val <= 0 || val > 9999) { setError('Enter a valid weight (1–9999 g)'); return; }
    setWeights(prev => [...prev, val]);
    setInput('');
    setError('');
    inputRef.current?.focus();
  };

  const removeLastWeight = () => {
    setWeights(prev => prev.slice(0, -1));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addWeight(); }
  };

  const save = async () => {
    if (count < 1) { setError('Enter at least one weight before saving'); return; }
    if (count < targetSample) {
      const confirmed = window.confirm(
        `Only ${count} of ${targetSample} birds weighed. Save with incomplete sample?`
      );
      if (!confirmed) return;
    }
    setSaving(true); setError('');
    try {
      const payload = {
        flockId:           flock?.id,
        penSectionId:      section?.id,
        sampleDate:        date,
        sampleCount:       count,
        meanWeightG:       stats.avg,
        minWeightG:        stats.min,
        maxWeightG:        stats.max,
        uniformityPct:     stats.uniformity,
        individualWeights: weights,
        notes:             notes.trim() || null,
      };

      // Write to both weight-records (dashboard) and weight-samples (performance pages)
      const [recRes, sampRes] = await Promise.all([
        apiFetch('/api/weight-records',  { method: 'POST', body: JSON.stringify(payload) }),
        apiFetch('/api/weight-samples',  { method: 'POST', body: JSON.stringify(payload) }).catch(() => null),
      ]);

      let d = {};
      try { d = await recRes.json(); } catch {}
      if (!recRes.ok) { setError(d.error || 'Failed to save weight record'); return; }
      onSave(d);
    } catch { setError('Network error — please try again'); }
    finally  { setSaving(false); }
  };

  return (
    <div className="dash-modal-overlay" style={{
      position:'fixed', inset:0, zIndex:1200,
      background:'rgba(0,0,0,0.45)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dash-modal-inner" style={{
        background:'#fff', borderRadius:14, width:'100%', maxWidth:460,
        boxShadow:'0 12px 48px rgba(0,0,0,0.2)', maxHeight:'92vh', overflowY:'auto',
      }}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontWeight:800, fontSize:15, color:'#1e293b', fontFamily:"'Poppins',sans-serif" }}>
              ⚖️ Weigh-In — {flock?.batchCode || section?.name}
            </div>
            <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
              {section?.name} · {isLayer ? 'Layer production' : 'Broiler'} · Target: {targetSample} birds
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#94a3b8', minHeight:44, minWidth:44, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>

        <div style={{ padding:'18px 20px', display:'flex', flexDirection:'column', gap:14 }}>

          {/* Date */}
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#475569', marginBottom:5 }}>Weigh-In Date</label>
            <input type='date' value={date} max={new Date().toISOString().split('T')[0]}
              onChange={e => setDate(e.target.value)}
              style={{ padding:'9px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:13, width:'100%', fontFamily:'inherit', outline:'none', boxSizing:'border-box' }} />
          </div>

          {/* Progress bar */}
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <span style={{ fontSize:12, fontWeight:700, color: complete ? '#16a34a' : '#475569' }}>
                {complete ? `✓ ${count} birds weighed` : `${count} / ${targetSample} birds`}
              </span>
              {count > 0 && (
                <button onClick={removeLastWeight}
                  style={{ fontSize:11, color:'#dc2626', background:'none', border:'none', cursor:'pointer', fontWeight:600 }}>
                  ← Remove last
                </button>
              )}
            </div>
            <div style={{ height:8, background:'#f1f5f9', borderRadius:99, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${progress}%`, background: complete ? '#16a34a' : '#6c63ff', borderRadius:99, transition:'width 0.2s' }} />
            </div>
          </div>

          {/* Weight entry */}
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#475569', marginBottom:5 }}>
              Bird Weight (g) *
            </label>
            <div style={{ display:'flex', gap:8 }}>
              <input
                ref={inputRef}
                type='number' inputMode='decimal' min='1' max='9999' step='1'
                value={input}
                onChange={e => { setInput(e.target.value); setError(''); }}
                onKeyDown={handleKeyDown}
                placeholder='e.g. 1850'
                disabled={saving}
                style={{ flex:1, padding:'11px 14px', borderRadius:8, border:`1.5px solid ${error ? '#fecaca' : '#e2e8f0'}`, fontSize:15, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
              />
              <button onClick={addWeight} disabled={!input || saving}
                className="weight-add-btn"
                style={{ padding:'11px 20px', borderRadius:8, border:'none', background: input ? '#6c63ff' : '#e2e8f0', color: input ? '#fff' : '#94a3b8', fontSize:14, fontWeight:700, cursor: input ? 'pointer' : 'not-allowed', whiteSpace:'nowrap', fontFamily:'inherit' }}>
                + Add
              </button>
            </div>
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:3 }}>Press Enter or tap Add after each bird</div>
          </div>

          {/* Live stats — shown as soon as any weights entered */}
          {count > 0 && (
            <div style={{ background:'#f8fafc', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#475569', marginBottom:8, textTransform:'uppercase', letterSpacing:'.05em' }}>
                Live Statistics
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                {[
                  { label:'Average',     value: stats.avg  ? `${stats.avg} g`  : '—' },
                  { label:'Uniformity',  value: stats.uniformity != null ? `${stats.uniformity}%` : '—' },
                  { label:'Min',         value: stats.min  ? `${stats.min} g`  : '—' },
                  { label:'Max',         value: stats.max  ? `${stats.max} g`  : '—' },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>{s.label}</div>
                    <div style={{ fontSize:15, fontWeight:800, color:'#1e293b' }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Layer weight status badge */}
              {isLayer && statusL && stats.avg && (
                <div style={{ marginTop:10, padding:'7px 11px', borderRadius:8, background:statusL.bg, border:`1px solid ${statusL.border}`, display:'flex', alignItems:'center', gap:7 }}>
                  <span style={{ fontSize:14 }}>
                    {statusL.label === 'Healthy' ? '✅' : statusL.label === 'Underweight' || statusL.label === 'Obese' ? '🚨' : '⚠️'}
                  </span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:statusL.color }}>{statusL.label}</div>
                    <div style={{ fontSize:10, color:statusL.color, opacity:0.8 }}>
                      {statusL.label === 'Underweight' && `Below 1,700g — may impact flock health`}
                      {statusL.label === 'Low'         && `Below 1,800g — monitor feed intake`}
                      {statusL.label === 'High'        && `Above 2,000g — monitor for obesity`}
                      {statusL.label === 'Obese'       && `Above 2,200g — likely reducing lay rate`}
                      {statusL.label === 'Healthy'     && `${LAYER_WEIGHT_MIN_WARN}–${LAYER_WEIGHT_MAX_WARN}g target range`}
                    </div>
                  </div>
                </div>
              )}

              {/* Uniformity guide */}
              {stats.uniformity != null && (
                <div style={{ marginTop:8, fontSize:11, color: stats.uniformity >= 80 ? '#16a34a' : stats.uniformity >= 70 ? '#d97706' : '#dc2626', fontWeight:600 }}>
                  {stats.uniformity >= 80 ? '✓ Good uniformity (≥80%)' : stats.uniformity >= 70 ? '⚠ Moderate uniformity (70–79%)' : '⚠ Poor uniformity (<70%) — investigate feed distribution'}
                </div>
              )}

              {/* Last 5 entries */}
              {count > 1 && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:10, color:'#94a3b8', marginBottom:4 }}>Last entries:</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                    {[...weights].slice(-8).reverse().map((w, i) => (
                      <span key={i} style={{ fontSize:11, padding:'2px 7px', borderRadius:5, background:'#fff', border:'1px solid #e2e8f0', color:'#475569' }}>{w}g</span>
                    ))}
                    {count > 8 && <span style={{ fontSize:11, color:'#94a3b8' }}>+{count - 8} more</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'#475569', marginBottom:5 }}>Notes (optional)</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder='Any observations about flock condition, outliers, etc.'
              style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, fontFamily:'inherit', outline:'none', resize:'vertical', boxSizing:'border-box' }} />
          </div>

          {error && (
            <div style={{ padding:'9px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:12, color:'#dc2626' }}>⚠ {error}</div>
          )}

          {/* Footer */}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:4 }}>
            <button onClick={onClose} disabled={saving}
              style={{ padding:'10px 20px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', color:'#64748b', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving || count < 1}
              style={{ padding:'10px 20px', borderRadius:8, border:'none', background: count < 1 || saving ? '#94a3b8' : '#6c63ff', color:'#fff', fontSize:13, fontWeight:700, cursor: count < 1 || saving ? 'not-allowed' : 'pointer', fontFamily:'inherit' }}>
              {saving ? 'Saving…' : `Save ${count} Bird${count !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
