'use client';
// app/rearing/page.js — Phase 8C Rearing Module with Transfer Verification
// Sending PM: initiates transfer (PENDING) → flock stays put
// Receiving PM: confirms receipt (COMPLETED) or disputes → flock moves on confirm
import { useState, useEffect, useCallback } from 'react';
import { useRouter }   from 'next/navigation';
import AppShell        from '@/components/layout/AppShell';
import { useAuth }     from '@/components/layout/AuthProvider';

const ACTION_ROLES = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const ALL_ROLES    = [...ACTION_ROLES, 'PEN_WORKER'];

const fmt    = n => n != null ? Number(n).toLocaleString('en-NG') : '—';
const fmtPct = n => n != null ? `${Number(n).toFixed(1)}%` : '—';
const fmtW   = n => n != null ? `${Number(n).toFixed(0)}g` : '—';
const fmtFCR = n => n != null ? Number(n).toFixed(3) : '—';
const fmtDate = s => s ? new Date(s).toLocaleDateString('en-NG',{day:'2-digit',month:'short',year:'numeric'}) : '—';

function polColor(w) {
  if (w <= 0) return '#ef4444';
  if (w <= 2) return '#f59e0b';
  return '#22c55e';
}

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type==='error'?'#991b1b':type==='warn'?'#92400e':'#166534';
  return (
    <div style={{ position:'fixed',bottom:24,right:24,background:bg,color:'#fff',
      borderRadius:10,padding:'12px 20px',zIndex:9999,fontSize:14,fontWeight:600,
      boxShadow:'0 4px 20px rgba(0,0,0,.2)',maxWidth:420 }}>{msg}</div>
  );
}

function KpiCard({ label, value, sub, color='#6c63ff' }) {
  return (
    <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,
      padding:'14px 18px',flex:1,minWidth:120 }}>
      <div style={{ fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
        letterSpacing:'.06em',marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:20,fontWeight:800,color }}>{value}</div>
      {sub && <div style={{ fontSize:12,color:'#64748b',marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:500,padding:16 }}
      onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:'#fff',borderRadius:14,width:'100%',maxWidth:540,
        maxHeight:'90vh',overflowY:'auto',boxShadow:'0 8px 40px rgba(0,0,0,.18)' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',
          padding:'16px 20px',borderBottom:'1px solid #f1f5f9' }}>
          <span style={{ fontWeight:700,fontSize:15 }}>{title}</span>
          <button onClick={onClose} style={{ background:'none',border:'none',fontSize:20,
            cursor:'pointer',color:'#94a3b8',lineHeight:1 }}>✕</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

const inputSt = { width:'100%',padding:'9px 12px',border:'1.5px solid #e2e8f0',
  borderRadius:8,fontSize:14,color:'#1e293b',background:'#fff',outline:'none',boxSizing:'border-box' };

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block',fontSize:12,fontWeight:700,color:'#64748b',
        textTransform:'uppercase',letterSpacing:'.05em',marginBottom:5 }}>
        {label}{required && <span style={{ color:'#ef4444',marginLeft:2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Log Weight Modal ─────────────────────────────────────────────────────────
function LogWeightModal({ flock, apiFetch, onClose, onSave }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    sampleDate:   today,
    sampleCount:  '30',
    meanWeightG:  '',
    minWeightG:   '',
    maxWeightG:   '',
    uniformityPct:'',
    notes:        '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function save() {
    if (!form.meanWeightG || Number(form.meanWeightG) <= 0)
      return setError('Average weight is required');
    if (!form.sampleCount || Number(form.sampleCount) < 1)
      return setError('Sample count must be at least 1');
    setSaving(true); setError('');
    try {
      const payload = {
        flockId:       flock.id,
        penSectionId:  flock.penSectionId,
        sampleDate:    form.sampleDate,
        sampleCount:   parseInt(form.sampleCount, 10),
        meanWeightG:   parseFloat(form.meanWeightG),
        minWeightG:    form.minWeightG    ? parseFloat(form.minWeightG)    : null,
        maxWeightG:    form.maxWeightG    ? parseFloat(form.maxWeightG)    : null,
        uniformityPct: form.uniformityPct ? parseFloat(form.uniformityPct) : null,
        notes:         form.notes || null,
      };
      // Write to both tables — weight_records (dashboard/charts) and weight_samples (rearing page)
      const [res] = await Promise.all([
        apiFetch('/api/weight-records', { method: 'POST', body: JSON.stringify(payload) }),
        apiFetch('/api/weight-samples', { method: 'POST', body: JSON.stringify(payload) }).catch(() => null),
      ]);
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to save weight record');
      onSave();
    } catch { setError('Network error'); }
    setSaving(false);
  }

  return (
    <Modal title={`⚖️ Log Weekly Weigh-In — ${flock.batchCode}`} onClose={onClose}>
      <div style={{ background:'#f8fafc',borderRadius:8,padding:'10px 14px',
        marginBottom:16,fontSize:13,color:'#64748b' }}>
        Week {flock.ageInWeeks} · {fmt(flock.currentCount)} birds ·
        Weigh a random sample of at least 30 birds
      </div>
      {error && (
        <div style={{ background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,
          padding:'10px 14px',fontSize:13,color:'#dc2626',marginBottom:14 }}>⚠ {error}</div>
      )}
      <Field label="Weigh-In Date" required>
        <input type="date" value={form.sampleDate} style={inputSt}
          onChange={e => set('sampleDate', e.target.value)} />
      </Field>
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
        <Field label="Sample Size (birds)" required>
          <input type="number" min="1" value={form.sampleCount} style={inputSt}
            onChange={e => set('sampleCount', e.target.value)} />
        </Field>
        <Field label="Avg Weight (g)" required>
          <input type="number" min="1" value={form.meanWeightG} style={inputSt}
            placeholder="e.g. 850" onChange={e => set('meanWeightG', e.target.value)} />
        </Field>
      </div>
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12 }}>
        <Field label="Min Weight (g)">
          <input type="number" min="1" value={form.minWeightG} style={inputSt}
            placeholder="Optional" onChange={e => set('minWeightG', e.target.value)} />
        </Field>
        <Field label="Max Weight (g)">
          <input type="number" min="1" value={form.maxWeightG} style={inputSt}
            placeholder="Optional" onChange={e => set('maxWeightG', e.target.value)} />
        </Field>
        <Field label="Uniformity (%)">
          <input type="number" min="0" max="100" step="0.1" value={form.uniformityPct}
            style={inputSt} placeholder="e.g. 82"
            onChange={e => set('uniformityPct', e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea value={form.notes} rows={2} style={{...inputSt,resize:'vertical'}}
          placeholder="Any observations about flock body condition…"
          onChange={e => set('notes', e.target.value)} />
      </Field>
      <div style={{ display:'flex',gap:10 }}>
        <button onClick={onClose}
          style={{ flex:1,padding:'9px',borderRadius:8,border:'1.5px solid #e2e8f0',
            background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569' }}>
          Cancel
        </button>
        <button onClick={save} disabled={saving}
          style={{ flex:2,padding:'9px',borderRadius:8,border:'none',
            background:saving?'#e2e8f0':'#6c63ff',color:'#fff',
            fontWeight:700,fontSize:13,cursor:saving?'default':'pointer' }}>
          {saving ? 'Saving…' : 'Save Weight Record'}
        </button>
      </div>
    </Modal>
  );
}

// ── Transfer status pill ──────────────────────────────────────────────────────
function StatusPill({ status }) {
  const cfg = {
    PENDING:            { label:'Awaiting Confirmation', bg:'#fffbeb', color:'#92400e', border:'#fde68a' },
    COMPLETED:          { label:'Confirmed',             bg:'#f0fdf4', color:'#166534', border:'#bbf7d0' },
    DISPUTED:           { label:'Disputed',              bg:'#fef2f2', color:'#991b1b', border:'#fecaca' },
    DISCREPANCY_REVIEW: { label:'Discrepancy — FM Review', bg:'#fff7ed', color:'#9a3412', border:'#fed7aa' },
    CANCELLED:          { label:'Cancelled',             bg:'#f1f5f9', color:'#475569', border:'#e2e8f0' },
  }[status] || { label: status, bg:'#f1f5f9', color:'#475569', border:'#e2e8f0' };
  return (
    <span style={{ background:cfg.bg,color:cfg.color,border:`1px solid ${cfg.border}`,
      fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap' }}>
      {cfg.label}
    </span>
  );
}

// ── Pending transfer banner ───────────────────────────────────────────────────
function TransferBanner({ transfers, canAct, onConfirm, onDispute, onReview, isFarmManager }) {
  const incoming   = transfers.filter(t => t.direction==='INCOMING' && t.status==='PENDING');
  const outgoing   = transfers.filter(t => t.direction==='OUTGOING' && t.status==='PENDING');
  const disputed   = transfers.filter(t => t.status==='DISPUTED');
  const inReview   = transfers.filter(t => t.status==='DISCREPANCY_REVIEW');
  const outReview  = transfers.filter(t => t.status==='DISCREPANCY_REVIEW' && t.direction==='OUTGOING');

  if (!incoming.length && !outgoing.length && !disputed.length && !inReview.length) return null;

  return (
    <div style={{ marginBottom:24, display:'flex', flexDirection:'column', gap:10 }}>

      {/* Incoming — requires action from this PM */}
      {incoming.map(t => (
        <div key={t.id} style={{ background:'#fffbeb',border:'1.5px solid #f59e0b',
          borderRadius:12,padding:'14px 18px',display:'flex',alignItems:'center',
          justifyContent:'space-between',gap:12,flexWrap:'wrap' }}>
          <div>
            <div style={{ fontWeight:700,fontSize:14,color:'#92400e' }}>
              📦 Incoming Transfer — {t.flocks?.batchCode}
            </div>
            <div style={{ fontSize:12,color:'#78350f',marginTop:2 }}>
              {fmt(t.birdsSent || t.survivingCount)} birds from{' '}
              <strong>{t.fromPenSection?.pen?.name} · {t.fromPenSection?.name}</strong>
              {' '}→{' '}
              <strong>{t.toPenSection?.pen?.name} · {t.toPenSection?.name}</strong>
              {' · '}Dispatched {fmtDate(t.transferDate)}
            </div>
            <div style={{ fontSize:11,color:'#92400e',marginTop:3 }}>
              Sent by {t.recordedBy?.firstName} {t.recordedBy?.lastName} · Awaiting your confirmation
            </div>
          </div>
          {canAct && (
            <div style={{ display:'flex',gap:8,flexShrink:0 }}>
              <button onClick={() => onDispute(t)}
                style={{ padding:'7px 14px',borderRadius:8,border:'1.5px solid #fecaca',
                  background:'#fef2f2',color:'#991b1b',fontWeight:700,fontSize:12,cursor:'pointer' }}>
                Dispute
              </button>
              <button onClick={() => onConfirm(t)}
                style={{ padding:'7px 18px',borderRadius:8,border:'none',
                  background:'#22c55e',color:'#fff',fontWeight:700,fontSize:12,cursor:'pointer' }}>
                Confirm Receipt
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Outgoing — sent, waiting for other PM */}
      {outgoing.map(t => (
        <div key={t.id} style={{ background:'#eff6ff',border:'1px solid #bfdbfe',
          borderRadius:12,padding:'14px 18px' }}>
          <div style={{ fontWeight:700,fontSize:14,color:'#1e40af' }}>
            🚚 Outgoing Transfer — {t.flocks?.batchCode}
            <StatusPill status="PENDING" />
          </div>
          <div style={{ fontSize:12,color:'#1e40af',marginTop:4 }}>
            {fmt(t.birdsSent || t.survivingCount)} birds →{' '}
            <strong>{t.toPenSection?.pen?.name} · {t.toPenSection?.name}</strong>
            {' · '}Dispatched {fmtDate(t.transferDate)}
          </div>
          <div style={{ fontSize:11,color:'#3b82f6',marginTop:2 }}>
            Awaiting confirmation from receiving PM. Birds remain here until confirmed.
          </div>
        </div>
      ))}

      {/* Discrepancy Review — FM action required */}
      {inReview.map(t => (
        <div key={t.id} style={{ background:'#fff7ed',border:'1.5px solid #fed7aa',
          borderRadius:12,padding:'14px 18px' }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10 }}>
            <div>
              <div style={{ fontWeight:700,fontSize:14,color:'#9a3412',marginBottom:3 }}>
                🔍 Discrepancy Under Review — {t.flocks?.batchCode}
              </div>
              <div style={{ fontSize:12,color:'#c2410c',marginTop:2 }}>
                Sent: <strong>{fmt(t.birds_sent||t.survivingCount)}</strong> · 
                Received: <strong>{fmt(t.birds_received)}</strong> · 
                Discrepancy: <strong>{t.discrepancy_pct}%</strong>
                {t.review_deadline && (
                  <span style={{ marginLeft:8,background:'#fef2f2',border:'1px solid #fecaca',
                    borderRadius:6,padding:'1px 6px',fontSize:10,color:'#dc2626',fontWeight:700 }}>
                    ⏰ FM review deadline: {new Date(t.review_deadline).toLocaleString()}
                  </span>
                )}
              </div>
              <div style={{ fontSize:11,color:'#9a3412',marginTop:3 }}>
                {t.direction==='OUTGOING'
                  ? 'Your transfer is on hold pending Farm Manager review. Birds remain here.'
                  : 'Transfer on hold. Farm Manager must approve before birds move.'}
              </div>
            </div>
            {isFarmManager && (
              <button onClick={() => onReview(t)}
                style={{ padding:'7px 16px',borderRadius:8,border:'none',
                  background:'#ea580c',color:'#fff',fontWeight:700,fontSize:12,
                  cursor:'pointer',whiteSpace:'nowrap' }}>
                Review Discrepancy
              </button>
            )}
          </div>
          {t.receiving_notes && (
            <div style={{ fontSize:11,color:'#9a3412',marginTop:8,
              background:'#ffedd5',borderRadius:6,padding:'6px 10px' }}>
              Receiving notes: {t.receiving_notes}
            </div>
          )}
        </div>
      ))}

      {/* Disputed */}
      {disputed.map(t => {
        const isFM       = isFarmManager;
        const isSendingPM = t.direction === 'OUTGOING' && !isFarmManager;
        return (
          <div key={t.id} style={{ background:'#fef2f2',border:'1.5px solid #fecaca',
            borderRadius:12,padding:'14px 18px' }}>
            <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',
              flexWrap:'wrap',gap:10 }}>
              <div>
                <div style={{ fontWeight:700,fontSize:14,color:'#991b1b',marginBottom:3 }}>
                  🚫 Disputed Transfer — {t.flocks?.batchCode}
                </div>
                <div style={{ fontSize:12,color:'#991b1b',marginTop:2 }}>
                  {fmt(t.birds_sent||t.survivingCount)} birds · {t.fromPenSection?.pen?.name} → {t.toPenSection?.pen?.name}
                </div>
                <div style={{ fontSize:11,color:'#b91c1c',marginTop:3,
                  background:'#fee2e2',borderRadius:6,padding:'4px 8px',display:'inline-block' }}>
                  Reason: {t.dispute_reason || t.disputeReason}
                </div>
                {t.dispute_deadline && (
                  <div style={{ fontSize:11,color:'#dc2626',marginTop:4,fontWeight:600 }}>
                    ⏰ FM must act by: {new Date(t.dispute_deadline).toLocaleString()}
                  </div>
                )}
              </div>
              <div style={{ display:'flex',gap:8,flexShrink:0,flexWrap:'wrap' }}>
                {isSendingPM && (
                  <button onClick={() => onDispute({ transfer:t, defaultAction:'WITHDRAW' })}
                    style={{ padding:'7px 14px',borderRadius:8,border:'1.5px solid #fecaca',
                      background:'#fef2f2',color:'#991b1b',fontWeight:700,fontSize:12,cursor:'pointer' }}>
                    Withdraw Transfer
                  </button>
                )}
                {isFM && (
                  <>
                    <button onClick={() => onDispute({ transfer:t, defaultAction:'CANCEL' })}
                      style={{ padding:'7px 14px',borderRadius:8,border:'1.5px solid #fecaca',
                        background:'#fef2f2',color:'#991b1b',fontWeight:700,fontSize:12,cursor:'pointer' }}>
                      Cancel Transfer
                    </button>
                    <button onClick={() => onDispute({ transfer:t, defaultAction:'FORCE_COMPLETE' })}
                      style={{ padding:'7px 14px',borderRadius:8,border:'none',
                        background:'#dc2626',color:'#fff',fontWeight:700,fontSize:12,cursor:'pointer' }}>
                      Force Complete
                    </button>
                  </>
                )}
                {!isFM && !isSendingPM && (
                  <div style={{ fontSize:11,color:'#b91c1c',fontStyle:'italic' }}>
                    Awaiting Farm Manager resolution
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Flock card ────────────────────────────────────────────────────────────────
function FlockCard({ flock, canAct, onTransfer, onAdvance, onLogWeight }) {
  const { weeksToPointOfLay, ageInWeeks, latestWeight, rearingFCR,
    mortalitySinceRearing, hasBeenTransferred, hasPendingTransfer } = flock;

  const needsTransfer = ageInWeeks >= 12 && !hasBeenTransferred && !hasPendingTransfer;
  const readyForProd  = ageInWeeks >= 17;
  const polCol        = polColor(weeksToPointOfLay);

  return (
    <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,padding:20,
      borderLeft:`4px solid ${readyForProd?'#22c55e':hasPendingTransfer?'#f59e0b':needsTransfer?'#f59e0b':'#6c63ff'}` }}>

      {/* Header */}
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14 }}>
        <div>
          <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:2 }}>
            <div style={{ fontWeight:800,fontSize:16,color:'#1e293b' }}>{flock.batchCode}</div>
            <span style={{ background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0',
              fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap' }}>
              🌱 Rearing
            </span>
          </div>
          <div style={{ fontSize:12,color:'#64748b',marginTop:3 }}>
            {flock.penSection?.pen?.name} · {flock.penSection?.name}
            {hasBeenTransferred && (
              <span style={{ marginLeft:6,background:'#dbeafe',color:'#1e40af',
                fontSize:10,fontWeight:700,borderRadius:10,padding:'1px 7px' }}>Transferred</span>
            )}
            {hasPendingTransfer && (
              <span style={{ marginLeft:6,background:'#fffbeb',color:'#92400e',
                fontSize:10,fontWeight:700,borderRadius:10,padding:'1px 7px' }}>Transfer Pending</span>
            )}
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:13,fontWeight:800,color:polCol }}>
            {weeksToPointOfLay <= 0 ? 'POL Overdue' : `${weeksToPointOfLay} wk to POL`}
          </div>
          <div style={{ fontSize:11,color:'#94a3b8' }}>Week {ageInWeeks} of rearing</div>
        </div>
      </div>

      {/* KPI grid */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:14 }}>
        <div style={{ background:'#f8fafc',borderRadius:8,padding:'10px 12px' }}>
          <div style={{ fontSize:10,color:'#94a3b8',fontWeight:700,marginBottom:3 }}>BIRDS</div>
          <div style={{ fontSize:15,fontWeight:800,color:'#1e293b' }}>{fmt(flock.currentCount)}</div>
        </div>
        <div style={{ background:'#f8fafc',borderRadius:8,padding:'10px 12px' }}>
          <div style={{ fontSize:10,color:'#94a3b8',fontWeight:700,marginBottom:3 }}>AVG WEIGHT</div>
          <div style={{ fontSize:15,fontWeight:800,color:'#6c63ff' }}>
            {latestWeight ? fmtW(latestWeight.avgWeightG) : '—'}
          </div>
          {latestWeight?.uniformityPct && (
            <div style={{ fontSize:10,color:'#64748b' }}>{fmtPct(latestWeight.uniformityPct)} uniform</div>
          )}
        </div>
        <div style={{ background:'#f8fafc',borderRadius:8,padding:'10px 12px' }}>
          <div style={{ fontSize:10,color:'#94a3b8',fontWeight:700,marginBottom:3 }}>REARING FCR</div>
          <div style={{ fontSize:15,fontWeight:800,
            color:rearingFCR!=null?(rearingFCR<=3.5?'#22c55e':rearingFCR<=4.5?'#f59e0b':'#ef4444'):'#94a3b8' }}>
            {fmtFCR(rearingFCR)}
          </div>
        </div>
        <div style={{ background:'#f8fafc',borderRadius:8,padding:'10px 12px' }}>
          <div style={{ fontSize:10,color:'#94a3b8',fontWeight:700,marginBottom:3 }}>MORTALITY</div>
          <div style={{ fontSize:15,fontWeight:800,
            color:mortalitySinceRearing>50?'#ef4444':mortalitySinceRearing>20?'#f59e0b':'#1e293b' }}>
            {fmt(mortalitySinceRearing)}
          </div>
          <div style={{ fontSize:10,color:'#64748b' }}>since rearing</div>
        </div>
        <div style={{ background:'#f8fafc',borderRadius:8,padding:'10px 12px',gridColumn:'span 2' }}>
          <div style={{ fontSize:10,color:'#94a3b8',fontWeight:700,marginBottom:3 }}>FEED (REARING)</div>
          <div style={{ fontSize:13,fontWeight:700,color:'#1e293b' }}>
            {flock.totalFeedKgRearing?.toLocaleString() || '—'} kg
          </div>
          {flock.rearingStartDate && (
            <div style={{ fontSize:10,color:'#64748b' }}>Since {fmtDate(flock.rearingStartDate)}</div>
          )}
        </div>
      </div>

      {/* Alert banners */}
      {hasPendingTransfer && (
        <div style={{ background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,
          padding:'8px 12px',marginBottom:12,fontSize:12,color:'#92400e',fontWeight:600 }}>
          Transfer initiated — awaiting confirmation from receiving pen manager.
        </div>
      )}
      {needsTransfer && (
        <div style={{ background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,
          padding:'8px 12px',marginBottom:12,fontSize:12,color:'#92400e',fontWeight:600 }}>
          Week {ageInWeeks}: Birds ready for production cages (target: Week 13).
        </div>
      )}
      {readyForProd && (
        <div style={{ background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,
          padding:'8px 12px',marginBottom:12,fontSize:12,color:'#166534',fontWeight:600 }}>
          Week {ageInWeeks}: Approaching Point-of-Lay. Confirm first consistent egg laying.
        </div>
      )}

      {/* Actions */}
      {canAct && (
        <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
          <button onClick={() => onLogWeight(flock)}
            style={{ flex:1,padding:'8px 12px',borderRadius:8,border:'none',
              background:'#6c63ff',color:'#fff',
              fontWeight:700,fontSize:12,cursor:'pointer',minWidth:120 }}>
            ⚖️ Log Weight
          </button>
          {!hasBeenTransferred && !hasPendingTransfer && (
            <button onClick={() => onTransfer(flock)}
              style={{ flex:1,padding:'8px 12px',borderRadius:8,border:'none',
                background:needsTransfer?'#f59e0b':'#e2e8f0',
                color:needsTransfer?'#fff':'#475569',
                fontWeight:700,fontSize:12,cursor:'pointer',minWidth:140 }}>
              Initiate Transfer
            </button>
          )}
          {hasPendingTransfer && (
            <div style={{ flex:1,padding:'8px 12px',borderRadius:8,
              background:'#fef9c3',color:'#713f12',fontWeight:700,fontSize:12,
              textAlign:'center',border:'1px solid #fde68a' }}>
              ⏳ Awaiting Receipt Confirmation
            </div>
          )}
          <button onClick={() => onAdvance(flock)}
            style={{ flex:1,padding:'8px 12px',borderRadius:8,border:'none',
              background:readyForProd?'#22c55e':'#e2e8f0',
              color:readyForProd?'#fff':'#94a3b8',
              fontWeight:700,fontSize:12,
              cursor:readyForProd?'pointer':'not-allowed',minWidth:140 }}
            disabled={!readyForProd}>
            Advance to Production
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Dispute Resolve Modal Component ──────────────────────────────────────────
function DisputeResolveModal({ resolveDispute, apiFetch, user, onClose, onSave }) {
  const t       = resolveDispute.transfer;
  const isFM    = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(user?.role);
  const birdsSent = t.birds_sent || t.survivingCount;

  const [resolveForm, setResolveForm] = useState({
    action:        resolveDispute.defaultAction || 'CANCEL',
    overrideCount: String(birdsSent||''),
    resolveNotes:  '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]               = useState('');

  const actionLabels = {
    CANCEL:         { label:'Cancel Transfer' },
    FORCE_COMPLETE: { label:'Force Complete' },
    WITHDRAW:       { label:'Withdraw Transfer' },
  };

  async function submitResolve() {
    setSubmitting(true); setErr('');
    try {
      const res = await apiFetch(
        `/api/rearing/transfers/${t.id}/dispute`,
        { method:'POST', body: JSON.stringify({
          action:        resolveForm.action,
          resolveNotes:  resolveForm.resolveNotes || null,
          overrideCount: resolveForm.action==='FORCE_COMPLETE'
            ? parseInt(resolveForm.overrideCount,10) : undefined,
        }) }
      );
      const d = await res.json();
      if (!res.ok) { setErr(d.error||'Failed'); setSubmitting(false); return; }
      onSave(d.message || 'Dispute resolved.');
    } catch { setErr('Network error'); }
    setSubmitting(false);
  }

  const cfg = actionLabels[resolveForm.action] || actionLabels.CANCEL;

  return (
    <Modal title={`🚫 Resolve Dispute — ${t.flocks?.batchCode}`} onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'12px 14px',fontSize:13}}>
          <div style={{fontWeight:700,color:'#991b1b',marginBottom:6}}>Dispute Summary</div>
          <div style={{fontSize:12,color:'#991b1b',marginBottom:4}}>
            <strong>{fmt(birdsSent)}</strong> birds · {t.fromPenSection?.pen?.name} → {t.toPenSection?.pen?.name}
          </div>
          <div style={{background:'#fee2e2',borderRadius:6,padding:'6px 10px',fontSize:12,color:'#b91c1c'}}>
            Reason: {t.dispute_reason || t.disputeReason}
          </div>
        </div>
        {err && <div className="alert alert-red">⚠ {err}</div>}
        <div>
          <label className="label">Resolution Action *</label>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {isFM && (<>
              <label style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 12px',borderRadius:8,cursor:'pointer',
                border:`1.5px solid ${resolveForm.action==='CANCEL'?'#fecaca':'var(--border)'}`,
                background:resolveForm.action==='CANCEL'?'#fef2f2':'var(--bg-elevated)'}}>
                <input type="radio" name="dr-action" value="CANCEL" checked={resolveForm.action==='CANCEL'}
                  onChange={()=>setResolveForm(f=>({...f,action:'CANCEL'}))} style={{marginTop:2}}/>
                <div>
                  <div style={{fontWeight:700,fontSize:13,color:'#991b1b'}}>Cancel Transfer</div>
                  <div style={{fontSize:11,color:'var(--text-muted)'}}>Transfer is voided. Flock stays at source. Can be re-initiated later.</div>
                </div>
              </label>
              <label style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 12px',borderRadius:8,cursor:'pointer',
                border:`1.5px solid ${resolveForm.action==='FORCE_COMPLETE'?'#fecaca':'var(--border)'}`,
                background:resolveForm.action==='FORCE_COMPLETE'?'#fff1f2':'var(--bg-elevated)'}}>
                <input type="radio" name="dr-action" value="FORCE_COMPLETE" checked={resolveForm.action==='FORCE_COMPLETE'}
                  onChange={()=>setResolveForm(f=>({...f,action:'FORCE_COMPLETE'}))} style={{marginTop:2}}/>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:13,color:'#dc2626'}}>Force Complete</div>
                  <div style={{fontSize:11,color:'var(--text-muted)'}}>Override the dispute and move the flock to destination.</div>
                  {resolveForm.action==='FORCE_COMPLETE' && (
                    <div style={{marginTop:8}}>
                      <label className="label">Official Bird Count</label>
                      <input type="number" className="input" min="0" value={resolveForm.overrideCount}
                        onChange={e=>setResolveForm(f=>({...f,overrideCount:e.target.value}))}/>
                    </div>
                  )}
                </div>
              </label>
            </>)}
            <label style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 12px',borderRadius:8,cursor:'pointer',
              border:`1.5px solid ${resolveForm.action==='WITHDRAW'?'#fde68a':'var(--border)'}`,
              background:resolveForm.action==='WITHDRAW'?'#fffbeb':'var(--bg-elevated)'}}>
              <input type="radio" name="dr-action" value="WITHDRAW" checked={resolveForm.action==='WITHDRAW'}
                onChange={()=>setResolveForm(f=>({...f,action:'WITHDRAW'}))} style={{marginTop:2}}/>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:'#92400e'}}>
                  {isFM ? 'Withdraw (on behalf of sending PM)' : 'Withdraw Transfer'}
                </div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>Pull back the transfer. Flock stays at source. You can re-initiate after resolving.</div>
              </div>
            </label>
          </div>
        </div>
        <div>
          <label className="label">Notes {resolveForm.action==='FORCE_COMPLETE'?'(required — document reason)':''}</label>
          <textarea className="input" rows={3} value={resolveForm.resolveNotes}
            placeholder={resolveForm.action==='CANCEL' ? 'Reason for cancellation…'
              : resolveForm.action==='FORCE_COMPLETE' ? 'Why are you overriding the dispute? Document your investigation…'
              : 'Why are you withdrawing? What needs to be resolved before re-initiating?'}
            onChange={e=>setResolveForm(f=>({...f,resolveNotes:e.target.value}))}/>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={onClose}
            style={{flex:1,padding:'9px',borderRadius:8,border:'1.5px solid var(--border)',background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer'}}>
            Back
          </button>
          <button onClick={submitResolve} disabled={submitting}
            style={{flex:2,padding:'9px',borderRadius:8,border:'none',
              background:submitting?'#e2e8f0':resolveForm.action==='FORCE_COMPLETE'?'#dc2626':resolveForm.action==='CANCEL'?'#dc2626':'#d97706',
              color:submitting?'#94a3b8':'#fff',fontWeight:700,fontSize:13,cursor:submitting?'default':'pointer'}}>
            {submitting ? 'Processing…' : cfg.label}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── FM Discrepancy Review Modal Component ─────────────────────────────────────
function ReviewDiscrepancyModal({ transfer, apiFetch, onClose, onSave }) {
  const [reviewForm, setReviewForm] = useState({ action:'APPROVE', overrideCount:'', reviewNotes:'' });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]               = useState('');

  const birdsSent     = transfer.birds_sent || transfer.survivingCount;
  const birdsReceived = transfer.birds_received;
  const discPct       = transfer.discrepancy_pct;

  async function submitReview() {
    if (reviewForm.action==='OVERRIDE' && !reviewForm.overrideCount)
      return setErr('Enter the override count');
    setSubmitting(true); setErr('');
    try {
      const res = await apiFetch(
        `/api/rearing/transfers/${transfer.id}/review`,
        { method:'POST', body: JSON.stringify({
          action:        reviewForm.action,
          reviewNotes:   reviewForm.reviewNotes || null,
          overrideCount: reviewForm.action==='OVERRIDE' ? parseInt(reviewForm.overrideCount,10) : undefined,
        }) }
      );
      const d = await res.json();
      if (!res.ok) { setErr(d.error||'Failed'); setSubmitting(false); return; }
      onSave(d.message || 'Discrepancy reviewed. Transfer completed.');
    } catch { setErr('Network error'); }
    setSubmitting(false);
  }

  return (
    <Modal title={`🔍 Review Discrepancy — ${transfer.flocks?.batchCode}`} onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:8,padding:'12px 14px',fontSize:13}}>
          <div style={{fontWeight:700,color:'#9a3412',marginBottom:4}}>Discrepancy Summary</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,fontSize:12}}>
            <div><div style={{color:'#9a3412',fontWeight:600}}>Birds Sent</div>
              <div style={{fontSize:16,fontWeight:800}}>{fmt(birdsSent)}</div></div>
            <div><div style={{color:'#9a3412',fontWeight:600}}>Birds Received</div>
              <div style={{fontSize:16,fontWeight:800,color:'#dc2626'}}>{fmt(birdsReceived)}</div></div>
            <div><div style={{color:'#9a3412',fontWeight:600}}>Discrepancy</div>
              <div style={{fontSize:16,fontWeight:800,color:'#dc2626'}}>{discPct}%</div></div>
          </div>
          {transfer.receiving_notes && (
            <div style={{marginTop:8,fontSize:11,color:'#78350f'}}>Receiving notes: {transfer.receiving_notes}</div>
          )}
        </div>
        {err && <div className="alert alert-red">⚠ {err}</div>}
        <div>
          <label className="label">Action *</label>
          <select className="input" value={reviewForm.action}
            onChange={e=>setReviewForm(f=>({...f,action:e.target.value}))}>
            <option value="APPROVE">Approve — Accept {fmt(birdsReceived)} birds as official count</option>
            <option value="OVERRIDE">Override — Set a different official count</option>
          </select>
        </div>
        {reviewForm.action==='OVERRIDE' && (
          <div>
            <label className="label">Official Bird Count *</label>
            <input type="number" className="input" min="0" max={birdsSent}
              value={reviewForm.overrideCount}
              placeholder={`Between ${fmt(birdsReceived)} and ${fmt(birdsSent)}`}
              onChange={e=>setReviewForm(f=>({...f,overrideCount:e.target.value}))}/>
          </div>
        )}
        <div>
          <label className="label">Review Notes</label>
          <textarea className="input" rows={3} value={reviewForm.reviewNotes}
            placeholder="Document your findings, investigation outcome, or reason for override…"
            onChange={e=>setReviewForm(f=>({...f,reviewNotes:e.target.value}))}/>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={onClose}
            style={{flex:1,padding:'9px',borderRadius:8,border:'1.5px solid var(--border)',background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer'}}>
            Cancel
          </button>
          <button onClick={submitReview} disabled={submitting}
            style={{flex:2,padding:'9px',borderRadius:8,border:'none',
              background:submitting?'#e2e8f0':'#ea580c',color:'#fff',fontWeight:700,fontSize:13,cursor:submitting?'default':'pointer'}}>
            {submitting?'Submitting…':reviewForm.action==='APPROVE'?'Approve & Complete Transfer':'Override & Complete Transfer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}


export default function RearingPage() {
  const router             = useRouter();
  const { user, apiFetch } = useAuth();

  const [flocks,      setFlocks]      = useState([]);
  const [transfers,   setTransfers]   = useState([]);
  const [sections,    setSections]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState({ msg:'', type:'success' });

  // Initiate transfer modal
  const [transferFlock, setTransferFlock] = useState(null);

  // Load ALL sections (not role-scoped) when opening transfer modal
  async function openTransferModal(flock) {
    setTransferFlock(flock);
    try {
      // Use a direct pen-sections fetch — bypass role-scoped farm-structure
      const res = await apiFetch('/api/farm-structure?allSections=true');
      if (res.ok) {
        const d = await res.json();
        const secs = [];
        (d.farms || []).forEach(farm =>
          farm.pens.forEach(pen =>
            (pen.sections || []).forEach(s =>
              secs.push({
                ...s,
                penName:      pen.name,
                penPurpose:   pen.penPurpose,
                operationType: pen.operationType,
                // Compute currentBirds from active flocks (farm-structure returns raw sections)
                currentBirds: (s.flocks || []).reduce((sum, f) => sum + (f.currentCount || 0), 0),
              })
            )
          )
        );
        setSections(secs);
      }
    } catch { /**/ }
  }
  const [transForm,     setTransForm]     = useState({
    toPenSectionId:'', transferDate:'', birdsSent:'',
    avgWeightAtTransferG:'', culledAtTransfer:'0', notes:'',
  });
  const [transSubmitting, setTransSubmitting] = useState(false);

  // Confirm receipt modal
  const [confirmTransfer,  setConfirmTransfer]  = useState(null);
  const [confirmForm,      setConfirmForm]      = useState({ birdsReceived:'', transitMortality:'0', receivingNotes:'' });
  const [confirmSubmitting,setConfirmSubmitting] = useState(false);

  // Dispute modal
  const [disputeTransfer,  setDisputeTransfer]  = useState(null);
  const [disputeReason,    setDisputeReason]    = useState('');
  const [disputeSubmitting,setDisputeSubmitting] = useState(false);

  // Log weight modal
  const [weightFlock,    setWeightFlock]    = useState(null);
  // FM discrepancy review modal
  const [reviewTransfer,   setReviewTransfer]   = useState(null);
  // FM/PM dispute resolve modal
  const [resolveDispute,   setResolveDispute]   = useState(null);

  // Advance to production modal
  const [advanceFlock,   setAdvanceFlock]   = useState(null);
  const [advanceForm,    setAdvanceForm]    = useState({
    pointOfLayDate: '',
    notes: '',
  });
  const [advSubmitting,  setAdvSubmitting]  = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [flockRes, transferRes, dashRes, fsRes] = await Promise.all([
        apiFetch('/api/rearing'),
        apiFetch('/api/rearing/transfers?status=ALL&days=14'),
        apiFetch('/api/dashboard'),
        apiFetch('/api/farm-structure'),
      ]);
      const flockData    = await flockRes.json();
      const transferData = transferRes.ok ? await transferRes.json() : { transfers:[] };
      const dashData     = dashRes.ok ? await dashRes.json() : {};

      // Tag flocks that have a pending transfer
      const pendingFlockIds = new Set(
        (transferData.transfers||[])
          .filter(t => t.status==='PENDING')
          .map(t => t.flockId)
      );
      const enrichedFlocks = (flockData.flocks||[]).map(f => ({
        ...f,
        hasPendingTransfer: pendingFlockIds.has(f.id),
        // Override hasBeenTransferred: only block re-transfer if there's an active pending transfer
        // Once server patch is applied, this will also check t.status === 'COMPLETED'
        // For now: if flock has transfers but none are pending → allow re-initiation
        hasBeenTransferred: pendingFlockIds.has(f.id)
          ? true  // pending transfer exists — block
          : (f.transfers||[]).some(t => t.status === 'COMPLETED'),  // only completed blocks permanently
      }));

      setFlocks(enrichedFlocks);
      setTransfers(transferData.transfers || []);

      // Build section list for destination picker from farm-structure
      // (dashboard only returns pens for farm-wide roles; farm-structure works for all)
      const fsData  = fsRes?.ok ? await fsRes.json() : {};
      const allSecs = [];
      (fsData.farms || []).forEach(farm =>
        farm.pens.forEach(pen =>
          (pen.sections || []).forEach(s =>
            allSecs.push({
              ...s,
              penName:       pen.name,
              penPurpose:    pen.penPurpose,
              operationType: pen.operationType,
              currentBirds:  (s.flocks || []).reduce((sum, f) => sum + (f.currentCount || 0), 0),
            })
          )
        )
      );
      setSections(allSecs);
    } catch { /**/ }
    setLoading(false);
  }, [user, apiFetch]);

  useEffect(() => { if (user) load(); }, [user, load]);

  if (!user) return null;
  if (!ALL_ROLES.includes(user.role)) { router.push('/dashboard'); return null; }

  const canAct = ACTION_ROLES.includes(user.role);

  function showToast(msg, type='success') {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg:'', type:'success' }), 5000);
  }

  // ── Initiate transfer ───────────────────────────────────────────────────────
  async function handleTransferSubmit(e) {
    e.preventDefault();
    if (!transForm.toPenSectionId||!transForm.transferDate||!transForm.birdsSent)
      return showToast('Fill all required fields', 'error');

    setTransSubmitting(true);
    try {
      const res = await apiFetch(`/api/rearing/${transferFlock.id}/transfer`, {
        method:'POST',
        body: JSON.stringify({
          toPenSectionId:      transForm.toPenSectionId,
          transferDate:        transForm.transferDate,
          birdsSent:           parseInt(transForm.birdsSent, 10),
          avgWeightAtTransferG: transForm.avgWeightAtTransferG ? parseFloat(transForm.avgWeightAtTransferG) : null,
          culledAtTransfer:    parseInt(transForm.culledAtTransfer||'0', 10),
          notes:               transForm.notes||null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return showToast(d.error||'Failed', 'error');
      showToast(`Transfer initiated. Receiving PM notified to confirm receipt.`);
      setTransferFlock(null);
      load();
    } catch { showToast('Network error','error'); }
    setTransSubmitting(false);
  }

  // ── Confirm receipt ─────────────────────────────────────────────────────────
  async function handleConfirmSubmit(e) {
    e.preventDefault();
    if (!confirmForm.birdsReceived) return showToast('Enter birds received count','error');

    setConfirmSubmitting(true);
    try {
      const res = await apiFetch(`/api/rearing/transfers/${confirmTransfer.id}/receive`, {
        method:'POST',
        body: JSON.stringify({
          action:           'confirm',
          birdsReceived:    parseInt(confirmForm.birdsReceived, 10),
          transitMortality: parseInt(confirmForm.transitMortality||'0', 10),
          receivingNotes:   confirmForm.receivingNotes||null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return showToast(d.error||'Failed','error');

      const msg = d.hasDiscrepancy
        ? `✅ Confirmed with ${d.discrepancyPct}% count discrepancy — sending PM notified.`
        : `✅ ${fmt(parseInt(confirmForm.birdsReceived))} birds confirmed. Flock moved to new section.`;
      showToast(msg, d.hasDiscrepancy ? 'warn' : 'success');
      setConfirmTransfer(null);
      load();
    } catch { showToast('Network error','error'); }
    setConfirmSubmitting(false);
  }

  // ── Dispute ─────────────────────────────────────────────────────────────────
  async function handleDisputeSubmit(e) {
    e.preventDefault();
    if (!disputeReason.trim()||disputeReason.length < 10)
      return showToast('Please provide a detailed dispute reason (min 10 characters)','error');

    setDisputeSubmitting(true);
    try {
      const res = await apiFetch(`/api/rearing/transfers/${disputeTransfer.id}/receive`, {
        method:'POST',
        body: JSON.stringify({ action:'dispute', disputeReason }),
      });
      const d = await res.json();
      if (!res.ok) return showToast(d.error||'Failed','error');
      showToast('Transfer disputed. Farm Manager and sending PM have been notified.','warn');
      setDisputeTransfer(null);
      setDisputeReason('');
      load();
    } catch { showToast('Network error','error'); }
    setDisputeSubmitting(false);
  }

  // ── Advance to production ───────────────────────────────────────────────────
  async function handleAdvanceSubmit(e) {
    e?.preventDefault();
    if (!advanceForm.pointOfLayDate) return showToast('Enter Point-of-Lay date','error');
    setAdvSubmitting(true);
    try {
      const res = await apiFetch(`/api/rearing/${advanceFlock.id}/advance`, {
        method: 'POST',
        body: JSON.stringify({
          pointOfLayDate: advanceForm.pointOfLayDate,
          notes:          advanceForm.notes || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) return showToast(d.error || 'Failed', 'error');
      showToast(`Flock advanced to Production. ${d.tasksCreated} task(s) added. ${d.notified} worker(s) notified to log first egg collection.`);
      setAdvanceFlock(null);
      load();
    } catch { showToast('Network error', 'error'); }
    setAdvSubmitting(false);
  }

  const productionSections = sections.filter(s => s.penPurpose==='PRODUCTION' || !s.penPurpose);

  return (
    <AppShell>
      <div className="page-content animate-in">

        {/* Header */}
        <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',
          flexWrap:'wrap',gap:12,marginBottom:20 }}>
          <div>
            <h1 style={{ fontSize:22,fontWeight:800,color:'#1e293b',margin:0 }}>🌱 Rearing</h1>
            <div style={{ fontSize:13,color:'#64748b',marginTop:3 }}>
              Layer pullet growing stage · Weeks 7–18 · Weight tracking · Point-of-Lay transitions
            </div>
          </div>
          <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
            <KpiCard label="Active Flocks"
              value={flocks.length} color="#6c63ff" />
            <KpiCard label="Total Pullets"
              value={fmt(flocks.reduce((s,f)=>s+(f.currentCount||0),0))} color="#f59e0b" />
            <KpiCard label="Pending Transfers"
              value={transfers.filter(t=>t.status==='PENDING').length}
              color={transfers.filter(t=>t.status==='PENDING').length>0?'#f59e0b':'#22c55e'}
              sub={transfers.filter(t=>t.direction==='INCOMING'&&t.status==='PENDING').length>0
                ?`${transfers.filter(t=>t.direction==='INCOMING'&&t.status==='PENDING').length} need your action`
                :undefined} />
            <KpiCard label="Ready for POL"
              value={flocks.filter(f=>(f.ageInWeeks||0)>=17).length} color="#22c55e" />
          </div>
        </div>

        {/* Transfer banners — always visible at top */}
        <TransferBanner
          transfers={transfers}
          canAct={canAct}
          isFarmManager={['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(user?.role)}
          onConfirm={t => {
            setConfirmTransfer(t);
            setConfirmForm({
              birdsReceived: String(t.birds_sent||t.survivingCount||''),
              transitMortality:'0', receivingNotes:'',
            });
          }}
          onDispute={payload => {
            // payload is either a transfer object (from Dispute button)
            // or { transfer, defaultAction } (from disputed section action buttons)
            if (payload?.transfer) {
              setResolveDispute(payload); // open DisputeResolveModal with defaultAction
            } else {
              setDisputeTransfer(payload); setDisputeReason(''); // open dispute reason modal
            }
          }}
          onReview={t => setReviewTransfer(t)}
        />

        {/* Flock grid */}
        {loading ? (
          <div style={{ textAlign:'center',padding:60,color:'#94a3b8' }}>Loading rearing flocks…</div>
        ) : flocks.length===0 ? (
          <div style={{ textAlign:'center',padding:60 }}>
            <div style={{ fontSize:48,marginBottom:12 }}>🌱</div>
            <div style={{ fontWeight:700,fontSize:16,color:'#1e293b',marginBottom:6 }}>
              No rearing flocks
            </div>
            <div style={{ color:'#64748b',fontSize:13,maxWidth:400,margin:'0 auto' }}>
              Layer flocks appear here after brooding ends. Use the Brooding page
              to advance a flock from BROODING to REARING stage.
            </div>
          </div>
        ) : (
          <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))',gap:16 }}>
            {flocks.map(flock => (
              <FlockCard key={flock.id} flock={flock} canAct={canAct}
                onLogWeight={f => setWeightFlock(f)}
                onTransfer={f => {
                  setTransForm({
                    toPenSectionId:'',
                    transferDate: new Date().toISOString().slice(0,10),
                    birdsSent: String(f.currentCount||''),
                    avgWeightAtTransferG: f.latestWeight?.avgWeightG
                      ? String(Math.round(Number(f.latestWeight.avgWeightG))) : '',
                    culledAtTransfer:'0', notes:'',
                  });
                  openTransferModal(f);
                }}
                onAdvance={f => {
                  setAdvanceFlock(f);
                  setAdvanceForm({
                    pointOfLayDate: new Date().toISOString().slice(0,10),
                    notes: '',
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ══ Initiate Transfer Modal ═══════════════════════════════════════════ */}
      {transferFlock && (
        <Modal title={`Initiate Transfer — ${transferFlock.batchCode}`}
          onClose={()=>setTransferFlock(null)}>
          <div style={{ background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,
            padding:'10px 14px',marginBottom:16,fontSize:13,color:'#1e40af' }}>
            <strong>Two-step process:</strong> You record the dispatch here. The receiving PM
            confirms bird count on arrival. The flock only moves when they confirm.
          </div>
          <form onSubmit={handleTransferSubmit}>
            <Field label="Destination Section (Production Pen)" required>
              <select value={transForm.toPenSectionId} required style={inputSt}
                onChange={e=>setTransForm(f=>({...f,toPenSectionId:e.target.value}))}>
                <option value="">Select section</option>
                {(() => {
                  const flockOpType  = transferFlock.operationType || transferFlock.penSection?.pen?.operationType;
                  const birdsToSend  = parseInt(transForm.birdsSent || transferFlock.currentCount || 0, 10);

                  const eligible = sections.filter(s => {
                    if (s.id === transferFlock.penSectionId) return false; // not current section
                    if (s.operationType !== flockOpType)     return false; // same bird type only
                    if (s.penPurpose === 'BROODING')         return false; // no brooding pens
                    // Capacity check: section must have enough free space for incoming birds
                    const freeSpace = (s.capacity || 0) - (s.currentBirds || 0);
                    if (birdsToSend > 0 && freeSpace < birdsToSend) return false;
                    return true;
                  });

                  if (eligible.length === 0) {
                    return <option value="" disabled>No eligible sections — check capacity</option>;
                  }

                  // Group by pen name
                  const byPen = eligible.reduce((acc, s) => {
                    const k = s.penName || 'Unknown';
                    if (!acc[k]) acc[k] = [];
                    acc[k].push(s);
                    return acc;
                  }, {});

                  return Object.entries(byPen).map(([penName, secs]) => (
                    <optgroup key={penName} label={penName}>
                      {secs.map(s => {
                        const freeSpace = (s.capacity || 0) - (s.currentBirds || 0);
                        const occupancy = s.capacity > 0
                          ? Math.round(((s.currentBirds||0)/s.capacity)*100) : 0;
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name} — {fmt(s.currentBirds||0)}/{fmt(s.capacity||0)} birds · {freeSpace.toLocaleString()} free ({occupancy}% full)
                          </option>
                        );
                      })}
                    </optgroup>
                  ));
                })()}
              </select>
            </Field>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
              <Field label="Dispatch Date" required>
                <input type="date" value={transForm.transferDate} required style={inputSt}
                  onChange={e=>setTransForm(f=>({...f,transferDate:e.target.value}))}/>
              </Field>
              <Field label="Birds Being Sent" required>
                <input type="number" min="1" value={transForm.birdsSent} required style={inputSt}
                  placeholder={String(transferFlock.currentCount)}
                  onChange={e=>setTransForm(f=>({...f,birdsSent:e.target.value}))}/>
              </Field>
            </div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
              <Field label="Avg Weight (g)">
                <input type="number" min="0" value={transForm.avgWeightAtTransferG}
                  placeholder="e.g. 1100" style={inputSt}
                  onChange={e=>setTransForm(f=>({...f,avgWeightAtTransferG:e.target.value}))}/>
              </Field>
              <Field label="Culled at Dispatch">
                <input type="number" min="0" value={transForm.culledAtTransfer} style={inputSt}
                  onChange={e=>setTransForm(f=>({...f,culledAtTransfer:e.target.value}))}/>
              </Field>
            </div>
            <Field label="Notes">
              <textarea value={transForm.notes} rows={2} style={{...inputSt,resize:'vertical'}}
                placeholder="Bird condition, loading observations…"
                onChange={e=>setTransForm(f=>({...f,notes:e.target.value}))}/>
            </Field>
            <div style={{ display:'flex',gap:10 }}>
              <button type="button" onClick={()=>setTransferFlock(null)}
                style={{ flex:1,padding:'9px',borderRadius:8,border:'1.5px solid #e2e8f0',
                  background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569' }}>
                Cancel
              </button>
              <button type="submit" disabled={transSubmitting}
                style={{ flex:2,padding:'9px',borderRadius:8,border:'none',
                  background:transSubmitting?'#e2e8f0':'#f59e0b',color:'#fff',
                  fontWeight:700,fontSize:13,cursor:transSubmitting?'default':'pointer' }}>
                {transSubmitting?'Initiating…':'Send Transfer Notice'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ══ Confirm Receipt Modal ════════════════════════════════════════════ */}
      {confirmTransfer && (
        <Modal title={`Confirm Receipt — ${confirmTransfer.flocks?.batchCode}`}
          onClose={()=>setConfirmTransfer(null)}>
          <div style={{ background:'#f8fafc',borderRadius:8,padding:'12px 16px',marginBottom:16,fontSize:13 }}>
            <div style={{ fontWeight:700,marginBottom:4 }}>Transfer Summary</div>
            <div style={{ color:'#64748b',lineHeight:1.6 }}>
              <div>From: <strong>{confirmTransfer.fromPenSection?.pen?.name} · {confirmTransfer.fromPenSection?.name}</strong></div>
              <div>Birds dispatched: <strong>{fmt(confirmTransfer.birdsSent||confirmTransfer.survivingCount)}</strong></div>
              <div>Dispatch date: <strong>{fmtDate(confirmTransfer.transferDate)}</strong></div>
              <div>Sent by: <strong>{confirmTransfer.recordedBy?.firstName} {confirmTransfer.recordedBy?.lastName}</strong></div>
            </div>
          </div>
          <form onSubmit={handleConfirmSubmit}>
            <Field label="Birds Actually Received" required>
              <input type="number" min="0" value={confirmForm.birdsReceived} required style={inputSt}
                onChange={e=>setConfirmForm(f=>({...f,birdsReceived:e.target.value}))}/>
              {confirmForm.birdsReceived &&
               Math.abs(parseInt(confirmForm.birdsReceived)-(confirmTransfer.birdsSent||confirmTransfer.survivingCount))>0 && (
                <div style={{ fontSize:11,color:'#d97706',marginTop:4,fontWeight:600 }}>
                  ⚠ Count differs from dispatch ({fmt(confirmTransfer.birdsSent||confirmTransfer.survivingCount)} sent).
                  Discrepancy will be flagged.
                </div>
              )}
            </Field>
            <Field label="Transit Mortality (deaths during move)">
              <input type="number" min="0" value={confirmForm.transitMortality} style={inputSt}
                onChange={e=>setConfirmForm(f=>({...f,transitMortality:e.target.value}))}/>
            </Field>
            <Field label="Receiving Notes">
              <textarea value={confirmForm.receivingNotes} rows={2}
                style={{...inputSt,resize:'vertical'}}
                placeholder="Bird condition on arrival, any observations…"
                onChange={e=>setConfirmForm(f=>({...f,receivingNotes:e.target.value}))}/>
            </Field>
            <div style={{ background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,
              padding:'10px 14px',marginBottom:14,fontSize:12,color:'#166534' }}>
              Confirming receipt will move the flock to this section and auto-assign workers.
            </div>
            <div style={{ display:'flex',gap:10 }}>
              <button type="button" onClick={()=>setConfirmTransfer(null)}
                style={{ flex:1,padding:'9px',borderRadius:8,border:'1.5px solid #e2e8f0',
                  background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569' }}>
                Cancel
              </button>
              <button type="submit" disabled={confirmSubmitting}
                style={{ flex:2,padding:'9px',borderRadius:8,border:'none',
                  background:confirmSubmitting?'#e2e8f0':'#22c55e',color:'#fff',
                  fontWeight:700,fontSize:13,cursor:confirmSubmitting?'default':'pointer' }}>
                {confirmSubmitting?'Confirming…':'Confirm Receipt'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ══ Dispute Modal ═══════════════════════════════════════════════════ */}
      {disputeTransfer && (
        <Modal title={`Dispute Transfer — ${disputeTransfer.flocks?.batchCode}`}
          onClose={()=>setDisputeTransfer(null)}>
          <div style={{ background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,
            padding:'10px 14px',marginBottom:16,fontSize:13,color:'#991b1b' }}>
            Raising a dispute will notify the sending PM and Farm Manager. The flock will
            not move until the dispute is resolved. Only dispute if there is a genuine
            issue — wrong birds, wrong count, or other serious discrepancy.
          </div>
          <form onSubmit={handleDisputeSubmit}>
            <Field label="Reason for Dispute" required>
              <textarea value={disputeReason} rows={4} required
                style={{...inputSt,resize:'vertical'}}
                placeholder="Describe the issue — e.g. wrong flock arrived, significant count difference, bird health concerns…"
                onChange={e=>setDisputeReason(e.target.value)}/>
              <div style={{ fontSize:11,color:'#94a3b8',marginTop:3 }}>
                Minimum 10 characters ({disputeReason.length}/1000)
              </div>
            </Field>
            <div style={{ display:'flex',gap:10 }}>
              <button type="button" onClick={()=>setDisputeTransfer(null)}
                style={{ flex:1,padding:'9px',borderRadius:8,border:'1.5px solid #e2e8f0',
                  background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569' }}>
                Cancel
              </button>
              <button type="submit" disabled={disputeSubmitting}
                style={{ flex:2,padding:'9px',borderRadius:8,border:'none',
                  background:disputeSubmitting?'#e2e8f0':'#ef4444',color:'#fff',
                  fontWeight:700,fontSize:13,cursor:disputeSubmitting?'default':'pointer' }}>
                {disputeSubmitting?'Raising Dispute…':'Raise Dispute'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ══ Dispute Resolve Modal ══════════════════════════════════════════ */}
      {resolveDispute && (
        <DisputeResolveModal
          resolveDispute={resolveDispute}
          apiFetch={apiFetch}
          user={user}
          onClose={() => setResolveDispute(null)}
          onSave={(msg) => { setResolveDispute(null); load(); showToast(msg); }}
        />
      )}

            {/* ══ FM Discrepancy Review Modal ════════════════════════════════════ */}
      {reviewTransfer && (
        <ReviewDiscrepancyModal
          transfer={reviewTransfer}
          apiFetch={apiFetch}
          onClose={() => setReviewTransfer(null)}
          onSave={(msg) => { setReviewTransfer(null); load(); showToast(msg); }}
        />
      )}


      {/* ══ Log Weight Modal      {/* ══ Log Weight Modal ═══════════════════════════════════════════════ */}
      {weightFlock && (
        <LogWeightModal
          flock={weightFlock}
          apiFetch={apiFetch}
          onClose={() => setWeightFlock(null)}
          onSave={() => { setWeightFlock(null); load(); showToast('Weight record saved.'); }}
        />
      )}

      {/* ══ Advance to Production Modal ══════════════════════════════════════ */}
      {advanceFlock && (
        <Modal title={`🥚 Advance to Production — ${advanceFlock.batchCode}`}
          onClose={()=>setAdvanceFlock(null)}>

          <div style={{ background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,
            padding:'10px 14px',marginBottom:16,fontSize:13,color:'#166534' }}>
            Stage changes from <strong>Rearing → Production</strong>. After advancing,
            today&#39;s egg collection tasks will appear in the worker&#39;s task list immediately.
            The worker logs the first egg collection through the normal task flow —
            subject to the standard verification process.
          </div>

          <form onSubmit={handleAdvanceSubmit}>
            <Field label="Point-of-Lay Date" required>
              <input type="date" value={advanceForm.pointOfLayDate} required style={inputSt}
                max={new Date().toISOString().slice(0,10)}
                onChange={e=>setAdvanceForm(f=>({...f,pointOfLayDate:e.target.value}))}/>
            </Field>

            <Field label="Notes (optional)">
              <textarea value={advanceForm.notes} rows={2}
                style={{...inputSt,resize:'vertical'}}
                placeholder="Observations on flock condition at point of lay…"
                onChange={e=>setAdvanceForm(f=>({...f,notes:e.target.value}))}/>
            </Field>

            <div style={{ background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,
              padding:'10px 14px',marginBottom:14,fontSize:12,color:'#713f12' }}>
              <strong>This action is permanent.</strong> The flock moves to Production stage,
              rearing tasks for today are cancelled, and production tasks (including egg collection)
              are created immediately for the assigned worker. All supervisors will be notified.
            </div>

            <div style={{ display:'flex',gap:10 }}>
              <button type="button" onClick={()=>setAdvanceFlock(null)}
                style={{ flex:1,padding:'9px',borderRadius:8,border:'1.5px solid #e2e8f0',
                  background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569' }}>
                Cancel
              </button>
              <button type="submit" disabled={advSubmitting}
                style={{ flex:2,padding:'9px',borderRadius:8,border:'none',
                  background:advSubmitting?'#e2e8f0':'#22c55e',color:'#fff',
                  fontWeight:700,fontSize:13,cursor:advSubmitting?'default':'pointer' }}>
                {advSubmitting?'Advancing…':'Confirm Point-of-Lay → Production'}
              </button>
            </div>
          </form>
        </Modal>
      )}

            <Toast msg={toast.msg} type={toast.type} />
    </AppShell>
  );
}
