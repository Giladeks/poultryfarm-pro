'use client';
// app/feed-requisitions/page.js
// Feed Requisition Workflow page
// Role-aware — single page, different default tabs per role:
//   PEN_MANAGER      → My Requisitions (drafts needing action, history)
//   INTERNAL_CONTROL → Pending Approvals
//   STORE_MANAGER    → Ready to Issue
//   FARM_MANAGER+    → All requisitions + oversight
import { useState, useEffect, useCallback, createPortal } from 'react';
import { useAuth } from '@/components/layout/AuthProvider';
import AppShell   from '@/components/layout/AppShell';

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_META = {
  DRAFT:          { label:'Draft',            color:'#64748b', bg:'#f8fafc', border:'#e2e8f0', icon:'📋' },
  SUBMITTED:      { label:'Submitted',        color:'#d97706', bg:'#fffbeb', border:'#fde68a', icon:'📤' },
  APPROVED:       { label:'Approved',         color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', icon:'✅' },
  REJECTED:       { label:'Rejected',         color:'#dc2626', bg:'#fef2f2', border:'#fecaca', icon:'↩️' },
  ISSUED:         { label:'Issued',           color:'#6c63ff', bg:'#f5f3ff', border:'#ddd6fe', icon:'📦' },
  ISSUED_PARTIAL: { label:'Partially Issued', color:'#d97706', bg:'#fffbeb', border:'#fde68a', icon:'⚠️' },
  ACKNOWLEDGED:   { label:'Acknowledged',     color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', icon:'✓'  },
  DISCREPANCY:    { label:'Discrepancy',      color:'#dc2626', bg:'#fef2f2', border:'#fecaca', icon:'⚑'  },
  CLOSED:         { label:'Closed',           color:'#94a3b8', bg:'#f8fafc', border:'#e2e8f0', icon:'🔒' },
};

const DEV_COLOR = { ok:'#16a34a', warn:'#d97706', high:'#dc2626' };
const devSev = pct => { const a = Math.abs(pct||0); return a<=10?'ok':a<=20?'warn':'high'; };

const fmt    = n  => parseFloat(n||0).toLocaleString('en-NG', { minimumFractionDigits:1, maximumFractionDigits:1 });
const fmtDate= d  => new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' });

// Show quantity as "630 kg — 25 bags + 5 kg" using bag weight (default 25 kg)
function fmtBags(kg, bagWt = 25) {
  const q   = parseFloat(kg || 0);
  const bw  = parseFloat(bagWt || 25);
  if (q <= 0) return '0 kg';
  const bags      = Math.floor(q / bw);
  const remainder = parseFloat((q % bw).toFixed(2));
  const kgStr     = `${fmt(q)} kg`;
  if (bags === 0)         return `${kgStr} (< 1 bag)`;
  if (remainder < 0.1)   return `${kgStr} — ${bags} bag${bags !== 1 ? 's' : ''}`;
  return `${kgStr} — ${bags} bag${bags !== 1 ? 's' : ''} + ${remainder} kg`;
}
const timeAgo= d  => {
  const m = Math.floor((Date.now()-new Date(d))/60000);
  if (m<60)   return `${m}m ago`;
  if (m<1440) return `${Math.floor(m/60)}h ago`;
  return `${Math.floor(m/1440)}d ago`;
};

// ── Loading skeleton ──────────────────────────────────────────────────────────
function Skel({ h=60, w='100%' }) {
  return <div style={{height:h,width:w,background:'#f1f5f9',borderRadius:8,animation:'pulse 1.5s ease-in-out infinite'}}/>;
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.DRAFT;
  return (
    <span style={{fontSize:10,fontWeight:700,padding:'3px 9px',borderRadius:99,
      background:m.bg, color:m.color, border:`1px solid ${m.border}`, whiteSpace:'nowrap'}}>
      {m.icon} {m.label}
    </span>
  );
}

// ── Deviation chip ─────────────────────────────────────────────────────────────
function DevChip({ pct }) {
  if (pct == null) return null;
  const sev   = devSev(pct);
  const color = DEV_COLOR[sev];
  return (
    <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:99,
      background:color+'18', color, border:`1px solid ${color}40`}}>
      {pct > 0 ? '+' : ''}{Number(pct).toFixed(1)}%
    </span>
  );
}

// ── Action modal ──────────────────────────────────────────────────────────────
function ActionModal({ req, action, onClose, onDone, apiFetch }) {
  const bagWt      = parseFloat(req.feedInventory?.bagWeightKg || 25);
  const breakdown  = req.sectionBreakdown || [];
  const hasBreakdown = breakdown.length > 0;

  const [qty,        setQty]        = useState('');
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState('');
  // Per-section qty inputs for issue/acknowledge: { [penSectionId]: string }
  const [sectionQtys, setSectionQtys] = useState({});

  const META = {
    submit:      { title:'📤 Submit Requisition',  btnLabel:'Submit to IC',          btnColor:'#d97706', needsQty:true,  qtyLabel:'Confirm quantity (kg) *', placeholder:'Enter quantity to request…' },
    approve:     { title:'✅ Approve Requisition', btnLabel:'Approve',               btnColor:'#16a34a', needsQty:true,  qtyLabel:'Approved quantity (kg) *', placeholder:'Any notes for the store…' },
    reject:      { title:'↩️ Reject Requisition',  btnLabel:'Reject & Return to PM', btnColor:'#dc2626', needsQty:false, notesLabel:'Rejection reason *', placeholder:'Explain why this is being returned…' },
    issue:       { title:'📦 Issue Feed',          btnLabel:'Issue Feed',            btnColor:'#6c63ff', needsQty:true,  qtyLabel:'Total issued (kg) *',     placeholder:'Any issuance notes…' },
    acknowledge: { title:'✓ Acknowledge Receipt',  btnLabel:'Confirm Receipt',       btnColor:'#16a34a', needsQty:true,  qtyLabel:'Total received (kg) *',   placeholder:'Any notes on the received feed…' },
    close:       { title:'🔒 Close Requisition',   btnLabel:'Close',                 btnColor:'#64748b', needsQty:false, notesLabel:'Close notes *', placeholder:'Summarise the outcome…' },
  };
  const m = META[action];

  // Pre-fill totals and per-section qtys
  useEffect(() => {
    if (action === 'submit')      setQty(String(req.requestedQtyKg || req.calculatedQtyKg || ''));
    if (action === 'approve')     setQty(String(req.requestedQtyKg || ''));
    if (action === 'issue')       setQty(String(req.approvedQtyKy || req.approvedQtyKg || ''));
    if (action === 'acknowledge') setQty(String(req.issuedQtyKg    || ''));

    if (action === 'issue' && hasBreakdown) {
      const init = {};
      breakdown.forEach(s => { init[s.penSectionId] = String(s.calculatedQtyKg || ''); });
      setSectionQtys(init);
    }
    if (action === 'acknowledge' && hasBreakdown) {
      const init = {};
      breakdown.forEach(s => { init[s.penSectionId] = String(s.issuedQtyKg || ''); });
      setSectionQtys(init);
    }
  }, [action, req]);

  // Auto-sum section qtys into the total field
  const sumSections = () =>
    Object.values(sectionQtys).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  const handleSectionQty = (sectionId, val) => {
    const updated = { ...sectionQtys, [sectionId]: val };
    setSectionQtys(updated);
    const total = Object.values(updated).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    setQty(String(parseFloat(total.toFixed(2)) || ''));
  };

  const submit = async () => {
    if (m.needsQty && (!qty || Number(qty) <= 0)) { setErr('Enter a valid quantity'); return; }
    if (!m.needsQty && !notes.trim()) { setErr(`${m.notesLabel?.replace(' *','')} is required`); return; }
    setSaving(true); setErr('');
    try {
      const body = { action };
      if (action === 'submit')      { body.requestedQtyKg     = Number(qty); body.pmNotes = notes || null; }
      if (action === 'approve')     { body.approvedQtyKg      = Number(qty); body.icNotes = notes || null; }
      if (action === 'reject')      { body.rejectionReason    = notes; }
      if (action === 'issue') {
        body.issuedQtyKg     = Number(qty);
        body.issuanceNotes   = notes || null;
        if (hasBreakdown && Object.keys(sectionQtys).length > 0) {
          body.sectionIssuance = Object.entries(sectionQtys)
            .map(([penSectionId, v]) => ({ penSectionId, issuedQtyKg: parseFloat(v) || 0 }));
        }
      }
      if (action === 'acknowledge') {
        body.acknowledgedQtyKg      = Number(qty);
        body.acknowledgementNotes   = notes || null;
        if (hasBreakdown && Object.keys(sectionQtys).length > 0) {
          body.sectionAcknowledgement = Object.entries(sectionQtys)
            .map(([penSectionId, v]) => ({ penSectionId, acknowledgedQtyKg: parseFloat(v) || 0 }));
        }
      }
      if (action === 'close')       { body.closeNotes = notes; }

      const res = await apiFetch(`/api/feed/requisitions/${req.id}`, {
        method: 'PATCH', body: JSON.stringify(body),
      });
      let d = {};
      try { d = await res.json(); } catch {}
      if (!res.ok) { setErr(d.error || `Failed (${res.status})`); return; }
      onDone(d.requisition);
    } catch { setErr('Network error — please try again'); }
    finally  { setSaving(false); }
  };

  return createPortal(
    <div style={{position:'fixed',inset:0,zIndex:1200,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:460,boxShadow:'0 12px 48px rgba(0,0,0,0.2)'}}>
        {/* Header */}
        <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border-card)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontFamily:"'Poppins',sans-serif",fontWeight:800,fontSize:14}}>{m.title}</span>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--text-muted)'}}>×</button>
        </div>

        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
          {/* Requisition context */}
          <div style={{padding:'10px 14px',background:'var(--bg-elevated)',borderRadius:9,fontSize:12}}>
            <div style={{fontWeight:700,color:'var(--text-primary)',marginBottom:2}}>{req.requisitionNumber}</div>
            <div style={{color:'var(--text-muted)'}}>
              {req.pen?.name || req.penSection?.pen?.name}
              {' · '}{req.feedInventory?.feedType}
              {hasBreakdown && <span style={{marginLeft:6,padding:'1px 6px',background:'#ede9fe',color:'#6c63ff',borderRadius:10,fontSize:10,fontWeight:700}}>{breakdown.length} sections</span>}
            </div>
            <div style={{color:'var(--text-muted)',marginTop:2}}>Feed for: {fmtDate(req.feedForDate)}</div>
          </div>

          {/* Calculation basis — shown on submit */}
          {action === 'submit' && req.calculatedQtyKg && (
            <div style={{padding:'9px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,fontSize:11}}>
              <span style={{fontWeight:700,color:'#16a34a'}}>System recommendation: </span>
              <span style={{color:'var(--text-secondary)',fontWeight:600}}>{fmtBags(req.calculatedQtyKg, bagWt)}</span>
              <span style={{color:'var(--text-muted)',marginLeft:6}}>
                ({req.calculationDays}d avg · {fmt(req.avgConsumptionPerBirdG)} g/bird · +5% buffer)
              </span>
            </div>
          )}
          {action === 'submit' && hasBreakdown && (
            <div style={{borderRadius:8,overflow:'hidden',border:'1px solid var(--border-card)'}}>
              <div style={{padding:'6px 10px',background:'#f8fafc',borderBottom:'1px solid var(--border-card)',fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Per-Section Breakdown</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                <thead><tr style={{background:'#f1f5f9'}}>
                  <th style={{padding:'5px 8px',textAlign:'left',color:'var(--text-muted)'}}>Section</th>
                  <th style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)'}}>Birds</th>
                  <th style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)'}}>Calc Qty</th>
                </tr></thead>
                <tbody>{breakdown.map((s,i)=>(
                  <tr key={s.penSectionId||i} style={{borderTop:'1px solid var(--border-card)'}}>
                    <td style={{padding:'5px 8px',fontWeight:600}}>{s.sectionName}</td>
                    <td style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)'}}>{(s.birdCount||0).toLocaleString()}</td>
                    <td style={{padding:'5px 8px',textAlign:'right',fontWeight:700,color:'var(--purple)'}}>{fmtBags(s.calculatedQtyKg,bagWt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {/* Deviation warning on approve */}
          {action === 'approve' && req.deviationPct != null && Math.abs(req.deviationPct) > 10 && (
            <div style={{padding:'9px 12px',background:devSev(req.deviationPct)==='high'?'#fef2f2':'#fffbeb',
              border:`1px solid ${devSev(req.deviationPct)==='high'?'#fecaca':'#fde68a'}`,borderRadius:8,fontSize:11}}>
              <span style={{fontWeight:700,color:DEV_COLOR[devSev(req.deviationPct)]}}>
                ⚠️ PM requested {req.deviationPct > 0 ? '+' : ''}{Number(req.deviationPct).toFixed(1)}% {req.deviationPct > 0 ? 'above' : 'below'} calculated need.
              </span>
              <span style={{color:'var(--text-secondary)',marginLeft:4}}>
                Calculated: {fmt(req.calculatedQtyKg)} kg. Requested: {fmt(req.requestedQtyKg)} kg.
              </span>
            </div>
          )}

          {/* Current stock warning on issue */}
          {action === 'issue' && req.feedInventory && (
            <div style={{padding:'9px 12px',background:'var(--bg-elevated)',borderRadius:8,fontSize:11}}>
              <span style={{fontWeight:700,color:'var(--text-secondary)'}}>Current stock: </span>
              <span style={{
                fontWeight:700,
                color: Number(req.feedInventory.currentStockKg) < Number(req.approvedQtyKg) ? '#dc2626' : '#16a34a',
              }}>
                {fmt(req.feedInventory.currentStockKg)} kg
              </span>
              {Number(req.feedInventory.currentStockKg) < Number(req.approvedQtyKg) && (
                <span style={{color:'#dc2626',marginLeft:4}}>— partial issuance will be flagged to IC</span>
              )}
            </div>
          )}

          {err && <div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:12,color:'#dc2626'}}>⚠ {err}</div>}

          {/* Per-section qty inputs for issue and acknowledge */}
          {(action === 'issue' || action === 'acknowledge') && hasBreakdown && (
            <div style={{borderRadius:8,overflow:'hidden',border:'1px solid var(--border-card)'}}>
              <div style={{padding:'6px 10px',background:'#f8fafc',borderBottom:'1px solid var(--border-card)',fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}}>
                {action === 'issue' ? 'Quantity to Issue per Section' : 'Quantity Received per Section'}
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{background:'#f1f5f9'}}>
                  <th style={{padding:'5px 8px',textAlign:'left',color:'var(--text-muted)'}}>Section</th>
                  <th style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)',minWidth:60}}>{action==='issue'?'Approved':'Issued'}</th>
                  <th style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)',minWidth:100}}>{action==='issue'?'Issue (kg)':'Received (kg)'}</th>
                </tr></thead>
                <tbody>{breakdown.map((s,i)=>(
                  <tr key={s.penSectionId||i} style={{borderTop:'1px solid var(--border-card)'}}>
                    <td style={{padding:'5px 8px',fontWeight:600}}>{s.sectionName}<br/><span style={{fontWeight:400,color:'var(--text-muted)',fontSize:10}}>{s.batchCode} · {(s.birdCount||0).toLocaleString()} birds</span></td>
                    <td style={{padding:'5px 8px',textAlign:'right',color:'var(--purple)',fontWeight:700,fontSize:11}}>
                      {action==='issue' ? fmtBags(s.calculatedQtyKg,bagWt) : fmtBags(s.issuedQtyKg,bagWt)}
                    </td>
                    <td style={{padding:'5px 8px'}}>
                      <input type="number" min="0" step="0.1"
                        value={sectionQtys[s.penSectionId] || ''}
                        onChange={e => handleSectionQty(s.penSectionId, e.target.value)}
                        style={{width:'100%',padding:'5px 7px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12,textAlign:'right',boxSizing:'border-box'}}
                        placeholder="0.0" />
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {/* Qty field — total */}
          {m.needsQty && (
            <div>
              <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-secondary)',marginBottom:5}}>
                {m.qtyLabel}
                {hasBreakdown && (action==='issue'||action==='acknowledge') && (
                  <span style={{fontWeight:400,color:'var(--text-muted)',marginLeft:6}}>(auto-summed from sections above)</span>
                )}
              </label>
              <input type="number" min="0" step="0.1"
                value={qty} onChange={e=>{setQty(e.target.value);setErr('');}}
                style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}
                placeholder="e.g. 125.5" />
              {qty && Number(qty) > 0 && (
                <div style={{fontSize:11,color:'var(--purple)',marginTop:4,fontWeight:600}}>= {fmtBags(qty, bagWt)}</div>
              )}
            </div>
          )}

          {/* Notes field */}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:'var(--text-secondary)',marginBottom:5}}>
              {m.notesLabel || 'Notes'} {m.needsQty ? <span style={{fontWeight:400,color:'var(--text-muted)'}}>(optional)</span> : ''}
            </label>
            <textarea rows={3} autoFocus={!m.needsQty}
              value={notes} onChange={e=>{setNotes(e.target.value);setErr('');}}
              placeholder={m.placeholder}
              style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:12,fontFamily:'inherit',resize:'vertical',outline:'none',boxSizing:'border-box'}}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{padding:'12px 20px',borderTop:'1px solid var(--border-card)',display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{padding:'8px 16px',borderRadius:8,border:'1px solid var(--border-card)',background:'#fff',color:'var(--text-secondary)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            style={{padding:'8px 18px',borderRadius:8,border:'none',background:saving?'#94a3b8':m.btnColor,color:'#fff',fontSize:12,fontWeight:700,cursor:saving?'not-allowed':'pointer'}}>
            {saving ? 'Saving…' : m.btnLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Requisition card ──────────────────────────────────────────────────────────
function ReqCard({ req, userRole, onAction }) {
  const sm = STATUS_META[req.status] || STATUS_META.DRAFT;
  const [expanded, setExpanded] = useState(false);

  const canSubmit      = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(userRole)
                       && ['DRAFT','REJECTED'].includes(req.status);
  const canApprove     = ['INTERNAL_CONTROL','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(userRole)
                       && req.status === 'SUBMITTED';
  const canReject      = canApprove;
  const canIssue       = ['STORE_MANAGER','STORE_CLERK','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(userRole)
                       && req.status === 'APPROVED';
  const canAcknowledge = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(userRole)
                       && ['ISSUED','ISSUED_PARTIAL'].includes(req.status);
  const canClose       = ['INTERNAL_CONTROL','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(userRole)
                       && ['ACKNOWLEDGED','DISCREPANCY','ISSUED','ISSUED_PARTIAL','REJECTED'].includes(req.status);

  return (
    <div style={{background:'#fff',borderRadius:12,border:`1px solid ${sm.border}`,borderLeft:`4px solid ${sm.color}`,overflow:'hidden'}}>
      {/* Summary row */}
      <div style={{padding:'14px 16px',display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}
        onClick={()=>setExpanded(e=>!e)}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
            <span style={{fontFamily:"'Poppins',sans-serif",fontSize:13,fontWeight:700,color:'var(--text-primary)'}}>{req.requisitionNumber}</span>
            <StatusBadge status={req.status} />
            {req.deviationPct != null && Math.abs(req.deviationPct) > 5 && <DevChip pct={req.deviationPct} />}
          </div>
          <div style={{fontSize:12,color:'var(--text-secondary)'}}>
            {req.pen?.name || req.penSection?.pen?.name}
            {' · '}{req.feedInventory?.feedType}
            {' · '}Feed for {fmtDate(req.feedForDate)}
            {req.sectionBreakdown?.length > 0 && <span style={{marginLeft:6,padding:'1px 6px',background:'#ede9fe',color:'#6c63ff',borderRadius:10,fontSize:10,fontWeight:700}}>{req.sectionBreakdown.length} sections</span>}
          </div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginTop:2}}>
            Calc: <strong>
              {req.totalBagsRequired != null
                ? `${req.totalBagsRequired} bag${req.totalBagsRequired !== 1 ? 's' : ''}${
                    req.totalRemainderKg && Number(req.totalRemainderKg) > 0
                      ? ` + ${Number(req.totalRemainderKg).toFixed(1)} kg`
                      : ''
                  } (${fmt(req.calculatedQtyKg)} kg)`
                : fmtBags(req.calculatedQtyKg, req.feedInventory?.bagWeightKg)
              }
            </strong>
            {req.requestedQtyKg && <> · Req: <strong>{fmtBags(req.requestedQtyKg, req.feedInventory?.bagWeightKg)}</strong></>}
            {req.approvedQtyKg  && <> · Approved: <strong>{fmtBags(req.approvedQtyKg, req.feedInventory?.bagWeightKg)}</strong></>}
            {req.issuedQtyKg    && <> · Issued: <strong>{fmtBags(req.issuedQtyKg, req.feedInventory?.bagWeightKg)}</strong></>}
            {req.acknowledgedQtyKg && <> · Ack: <strong>{fmtBags(req.acknowledgedQtyKg, req.feedInventory?.bagWeightKg)}</strong></>}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{display:'flex',flexDirection:'column',gap:5,flexShrink:0,alignSelf:'center'}}>
          {canSubmit      && <button onClick={e=>{e.stopPropagation();onAction(req,'submit');}}      style={btnStyle('#d97706')}>📤 Submit</button>}
          {canApprove     && <button onClick={e=>{e.stopPropagation();onAction(req,'approve');}}     style={btnStyle('#16a34a')}>✅ Approve</button>}
          {canReject      && <button onClick={e=>{e.stopPropagation();onAction(req,'reject');}}      style={btnStyle('#dc2626')}>↩️ Reject</button>}
          {canIssue       && <button onClick={e=>{e.stopPropagation();onAction(req,'issue');}}       style={btnStyle('#6c63ff')}>📦 Issue</button>}
          {canAcknowledge && <button onClick={e=>{e.stopPropagation();onAction(req,'acknowledge');}} style={btnStyle('#16a34a')}>✓ Acknowledge</button>}
          {canClose       && <button onClick={e=>{e.stopPropagation();onAction(req,'close');}}       style={btnStyle('#64748b')}>🔒 Close</button>}
        </div>

        {/* Expand chevron */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
          style={{flexShrink:0,transform:expanded?'rotate(180deg)':'none',transition:'transform 0.2s'}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{padding:'0 16px 16px',display:'flex',flexDirection:'column',gap:10}}>
          <div style={{height:1,background:'var(--border-card)',marginBottom:4}}/>

          {/* Calculation basis */}
          <div style={{background:'var(--bg-elevated)',borderRadius:8,padding:'10px 14px',fontSize:12}}>
            <div style={{fontWeight:700,color:'var(--text-secondary)',marginBottom:6,fontSize:11,textTransform:'uppercase',letterSpacing:'0.05em'}}>📊 Calculation Basis</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8}}>
              {[
                ['Total Qty',      fmtBags(req.calculatedQtyKg, req.feedInventory?.bagWeightKg)],
                ['Total Birds',    req.currentBirdCount?.toLocaleString('en-NG') ?? '—'],
                ['Avg g/Bird/Day', req.avgConsumptionPerBirdG ? `${fmt(req.avgConsumptionPerBirdG)} g` : '—'],
                ['History Days',   req.calculationDays ?? '—'],
              ].map(([l,v])=>(
                <div key={l}>
                  <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:2}}>{l}</div>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--text-primary)'}}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Section breakdown */}
          {req.sectionBreakdown?.length > 0 && (
            <div style={{borderRadius:8,overflow:'hidden',border:'1px solid var(--border-card)'}}>
              <div style={{padding:'8px 12px',background:'#f8fafc',borderBottom:'1px solid var(--border-card)',fontSize:11,fontWeight:700,color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.05em'}}>
                📦 Section Breakdown
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                <thead>
                  <tr style={{background:'#f1f5f9'}}>
                    <th style={{padding:'6px 10px',textAlign:'left',color:'var(--text-muted)',fontWeight:600}}>Section</th>
                    <th style={{padding:'6px 10px',textAlign:'left',color:'var(--text-muted)',fontWeight:600}}>Flock</th>
                    <th style={{padding:'6px 10px',textAlign:'right',color:'var(--text-muted)',fontWeight:600}}>Birds</th>
                    <th style={{padding:'6px 10px',textAlign:'right',color:'var(--text-muted)',fontWeight:600}}>Bags</th>
                    <th style={{padding:'6px 10px',textAlign:'right',color:'var(--text-muted)',fontWeight:600}}>Qty (kg)</th>
                    {req.issuedQtyKg       && <th style={{padding:'6px 10px',textAlign:'right',color:'var(--text-muted)',fontWeight:600}}>Issued</th>}
                    {req.acknowledgedQtyKg && <th style={{padding:'6px 10px',textAlign:'right',color:'var(--text-muted)',fontWeight:600}}>Received</th>}
                  </tr>
                </thead>
                <tbody>
                  {req.sectionBreakdown.map((s, i) => (
                    <tr key={s.penSectionId || i} style={{borderTop:'1px solid var(--border-card)',background: i%2===0?'#fff':'#fafafa'}}>
                      <td style={{padding:'7px 10px',fontWeight:600,color:'var(--text-primary)'}}>
                        {s.sectionName}
                        {s.formulaUsed && s.formulaUsed !== 'BAG_COUNT' && (
                          <span style={{
                            marginLeft:5, padding:'1px 5px', borderRadius:8,
                            fontSize:9, fontWeight:700,
                            background: s.formulaUsed === 'DEFAULT' ? '#fef2f2' : '#fffbeb',
                            color:      s.formulaUsed === 'DEFAULT' ? '#dc2626' : '#d97706',
                          }}>
                            {s.formulaUsed === 'DEFAULT' ? 'est.' : '7d avg'}
                          </span>
                        )}
                      </td>
                      <td style={{padding:'7px 10px',color:'var(--text-muted)'}}>{s.batchCode}</td>
                      <td style={{padding:'7px 10px',textAlign:'right',color:'var(--text-secondary)'}}>{(s.birdCount||0).toLocaleString()}</td>
                      <td style={{padding:'7px 10px',textAlign:'right',fontWeight:700,color:'var(--purple)'}}>
                        {s.bagsRequired != null
                          ? `${s.bagsRequired} bag${s.bagsRequired !== 1 ? 's' : ''}${
                              s.remainderKg && Number(s.remainderKg) > 0
                                ? ` +${Number(s.remainderKg).toFixed(1)}kg`
                                : ''
                            }`
                          : `${Math.floor((s.calculatedQtyKg||0) / (Number(req.feedInventory?.bagWeightKg)||25))} bags`
                        }
                      </td>
                      <td style={{padding:'7px 10px',textAlign:'right',color:'var(--text-secondary)',fontSize:11}}>
                        {fmt(s.calculatedQtyKg)} kg
                      </td>
                      {req.issuedQtyKg && <td style={{padding:'7px 10px',textAlign:'right',color:'#6c63ff',fontWeight:600}}>{s.issuedQtyKg != null ? fmtBags(s.issuedQtyKg, req.feedInventory?.bagWeightKg) : '—'}</td>}
                      {req.acknowledgedQtyKg && <td style={{padding:'7px 10px',textAlign:'right',color:'#16a34a',fontWeight:600}}>{s.acknowledgedQtyKg != null ? fmtBags(s.acknowledgedQtyKg, req.feedInventory?.bagWeightKg) : '—'}</td>}
                    </tr>
                  ))}
                  <tr style={{borderTop:'2px solid var(--border-card)',background:'#f8fafc',fontWeight:800}}>
                    <td style={{padding:'7px 10px',color:'var(--text-primary)'}}>TOTAL</td>
                    <td/>
                    <td style={{padding:'7px 10px',textAlign:'right',color:'var(--text-secondary)'}}>{(req.currentBirdCount||0).toLocaleString()}</td>
                    <td style={{padding:'7px 10px',textAlign:'right',color:'var(--purple)'}}>{fmtBags(req.calculatedQtyKg, req.feedInventory?.bagWeightKg)}</td>
                    {req.issuedQtyKg    && <td style={{padding:'7px 10px',textAlign:'right',color:'#6c63ff'}}>{fmtBags(req.issuedQtyKg, req.feedInventory?.bagWeightKg)}</td>}
                    {req.acknowledgedQtyKg && <td style={{padding:'7px 10px',textAlign:'right',color:'#16a34a'}}>{fmtBags(req.acknowledgedQtyKg, req.feedInventory?.bagWeightKg)}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Timeline */}
          <div style={{display:'flex',flexDirection:'column',gap:4}}>
            {[
              req.submittedAt  && { label:'Submitted by',   who:`${req.submittedBy?.firstName} ${req.submittedBy?.lastName}`,  at:req.submittedAt,  extra:req.pmNotes },
              req.approvedAt   && { label:'Approved by',    who:`${req.approvedBy?.firstName} ${req.approvedBy?.lastName}`,    at:req.approvedAt,   extra:req.icNotes,       qty:`${fmt(req.approvedQtyKg)} kg` },
              req.rejectedAt   && { label:'Rejected by',    who:`${req.rejectedBy?.firstName} ${req.rejectedBy?.lastName}`,    at:req.rejectedAt,   extra:req.rejectionReason, style:'red' },
              req.issuedAt     && { label:'Issued by',      who:`${req.issuedBy?.firstName} ${req.issuedBy?.lastName}`,        at:req.issuedAt,     extra:req.issuanceNotes, qty:`${fmt(req.issuedQtyKg)} kg` },
              req.acknowledgedAt&&{ label:'Acknowledged by',who:`${req.acknowledgedBy?.firstName} ${req.acknowledgedBy?.lastName}`,at:req.acknowledgedAt,extra:req.acknowledgementNotes,qty:`${fmt(req.acknowledgedQtyKg)} kg`,discrepancy:req.discrepancyQtyKg },
            ].filter(Boolean).map((step,i) => (
              <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,fontSize:11}}>
                <div style={{width:7,height:7,borderRadius:'50%',background:step.style==='red'?'#dc2626':'#16a34a',flexShrink:0,marginTop:4}}/>
                <div>
                  <span style={{fontWeight:600,color:'var(--text-primary)'}}>{step.label}: </span>
                  <span style={{color:'var(--text-secondary)'}}>{step.who}</span>
                  {step.qty && <span style={{color:'var(--purple)',fontWeight:700,marginLeft:4}}>({step.qty})</span>}
                  <span style={{color:'var(--text-muted)',marginLeft:4}}>{timeAgo(step.at)}</span>
                  {step.discrepancy != null && Math.abs(step.discrepancy) > 0.5 && (
                    <span style={{color:'#dc2626',fontWeight:700,marginLeft:4}}>⚑ {fmt(Math.abs(step.discrepancy))} kg discrepancy</span>
                  )}
                  {step.extra && <div style={{color:'var(--text-muted)',marginTop:2,fontStyle:'italic'}}>{step.extra}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(color) {
  return {
    padding:'5px 11px',borderRadius:7,border:`1px solid ${color}40`,
    background:`${color}12`,color,fontSize:10,fontWeight:700,
    cursor:'pointer',whiteSpace:'nowrap',
  };
}

// ── Empty state ───────────────────────────────────────────────────────────────
function Empty({ icon, title, sub }) {
  return (
    <div style={{textAlign:'center',padding:'56px 24px',color:'var(--text-muted)'}}>
      <div style={{fontSize:40,marginBottom:10}}>{icon}</div>
      <div style={{fontSize:14,fontWeight:700,color:'var(--text-secondary)',marginBottom:4}}>{title}</div>
      <div style={{fontSize:12}}>{sub}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FeedRequisitionsPage() {
  const { user, apiFetch } = useAuth();
  const role = user?.role;

  const defaultTab = () => {
    if (['STORE_MANAGER','STORE_CLERK'].includes(role)) return 'issue';
    if (role === 'INTERNAL_CONTROL')                    return 'approve';
    return 'active';
  };

  const [activeTab,  setActiveTab]  = useState(defaultTab);
  const [reqs,       setReqs]       = useState([]);
  const [summary,    setSummary]    = useState({});
  const [loading,    setLoading]    = useState(true);
  const [actionModal,setActionModal]= useState(null); // { req, action }
  const [toast,      setToast]      = useState(null);

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // Tab-specific filter
      if (activeTab === 'approve') params.set('status', 'SUBMITTED');
      if (activeTab === 'issue')   params.set('status', 'APPROVED');
      if (activeTab === 'history') params.set('limit', '100');

      const res = await apiFetch(`/api/feed/requisitions?${params.toString()}`);
      if (!res.ok) return;
      const d = await res.json();
      setReqs(d.requisitions || []);
      setSummary(d.summary || {});
    } catch { /* silent */ }
    finally  { setLoading(false); }
  }, [apiFetch, activeTab]);

  useEffect(() => { load(); }, [load]);

  const handleAction = (req, action) => setActionModal({ req, action });

  const handleDone = (updatedReq) => {
    setActionModal(null);
    setReqs(prev => prev.map(r => r.id === updatedReq?.id ? updatedReq : r));
    showToast('Requisition updated successfully ✓');
    // Reload to get fresh summary counts
    load();
  };

  // ── Tab config ──────────────────────────────────────────────────────────────
  const TABS = [
    { key:'active',  label:'My Requisitions',    roles:['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
      badge: (summary.DRAFT||0)+(summary.REJECTED||0) || null },
    { key:'approve', label:'Pending Approval',   roles:['INTERNAL_CONTROL','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
      badge: summary.SUBMITTED || null },
    { key:'issue',   label:'Ready to Issue',     roles:['STORE_MANAGER','STORE_CLERK','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
      badge: (summary.APPROVED||0)+(summary.ISSUED_PARTIAL||0) || null },
    { key:'history', label:'History',            roles:['PEN_MANAGER','STORE_MANAGER','STORE_CLERK','INTERNAL_CONTROL','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
      badge: null },
  ].filter(t => t.roles.includes(role));

  // ── Filter reqs per tab ─────────────────────────────────────────────────────
  const displayed = (() => {
    if (activeTab === 'active')  return reqs.filter(r => !['CLOSED','ACKNOWLEDGED'].includes(r.status));
    if (activeTab === 'approve') return reqs.filter(r => r.status === 'SUBMITTED');
    if (activeTab === 'issue')   return reqs.filter(r => ['APPROVED','ISSUED_PARTIAL'].includes(r.status));
    return reqs; // history — show all
  })();

  const needsAction = displayed.filter(r =>
    ['DRAFT','SUBMITTED','APPROVED','ISSUED','ISSUED_PARTIAL','REJECTED'].includes(r.status)
  ).length;

  return (
    <AppShell>
    <div style={{maxWidth:900,margin:'0 auto',padding:'24px 16px',minHeight:'100vh',background:'var(--bg-page, #f8fafc)'}}>
      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed',top:24,right:24,zIndex:2000,
          padding:'11px 18px',borderRadius:10,fontSize:13,fontWeight:600,
          background:toast.type==='error'?'#fef2f2':'#f0fdf4',
          border:`1px solid ${toast.type==='error'?'#fecaca':'#bbf7d0'}`,
          color:toast.type==='error'?'#dc2626':'#16a34a',
          boxShadow:'0 4px 20px rgba(0,0,0,0.12)',animation:'fadeInUp 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:6}}>
          <span style={{fontSize:28}}>🌾</span>
          <h1 style={{fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:800,margin:0,color:'var(--text-primary)'}}>
            Feed Requisitions
          </h1>
        </div>
        <p style={{fontSize:13,color:'var(--text-muted)',margin:0}}>
          Manage feed requests from pen sections through IC approval to store issuance.
        </p>
      </div>

      {/* KPI strip */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))',gap:10,marginBottom:20}}>
        {[
          { label:'Draft',      value:summary.DRAFT||0,         color:'#64748b' },
          { label:'Submitted',  value:summary.SUBMITTED||0,     color:'#d97706', urgent:(summary.SUBMITTED||0)>0 },
          { label:'Approved',   value:summary.APPROVED||0,      color:'#16a34a' },
          { label:'Issued',     value:(summary.ISSUED||0)+(summary.ISSUED_PARTIAL||0), color:'#6c63ff' },
          { label:'Discrepancy',value:summary.DISCREPANCY||0,   color:'#dc2626', urgent:(summary.DISCREPANCY||0)>0 },
          { label:'Closed',     value:summary.CLOSED||0,        color:'#94a3b8' },
        ].map(k=>(
          <div key={k.label} style={{background:k.urgent?'#fef2f2':'#fff',borderRadius:11,padding:'14px 16px',
            border:`1px solid ${k.urgent?'#fecaca':'var(--border-card)'}`,
            boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
            <div style={{fontSize:20,fontWeight:800,color:k.urgent?'#dc2626':'var(--text-primary)',lineHeight:1.1}}>{k.value}</div>
            <div style={{fontSize:11,fontWeight:600,color:k.color,marginTop:2}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',gap:4,background:'var(--bg-elevated)',borderRadius:11,padding:4,border:'1px solid var(--border)',marginBottom:20,width:'fit-content',flexWrap:'wrap'}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:8,border:'none',
              fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer',transition:'all 0.15s',
              background:activeTab===t.key?'#fff':'transparent',
              color:activeTab===t.key?'var(--purple)':'var(--text-muted)',
              boxShadow:activeTab===t.key?'0 1px 4px rgba(0,0,0,0.08)':'none'}}>
            {t.label}
            {t.badge > 0 && (
              <span style={{background:activeTab===t.key?'var(--purple)':'#94a3b8',color:'#fff',borderRadius:99,fontSize:9,fontWeight:800,padding:'1px 6px'}}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {[1,2,3].map(i=><Skel key={i} h={88}/>)}
        </div>
      ) : displayed.length === 0 ? (
        <div style={{background:'#fff',borderRadius:14,border:'1px solid var(--border-card)'}}>
          {activeTab === 'active'  && <Empty icon="📋" title="No active requisitions" sub="Requisitions are auto-generated when workers log feed. Check back after the next feed session." />}
          {activeTab === 'approve' && <Empty icon="✅" title="No pending approvals" sub="All submitted requisitions have been reviewed." />}
          {activeTab === 'issue'   && <Empty icon="📦" title="Nothing ready to issue" sub="Approved requisitions will appear here for the store to fulfil." />}
          {activeTab === 'history' && <Empty icon="📚" title="No requisition history" sub="Completed requisitions will appear here." />}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {needsAction > 0 && activeTab !== 'history' && (
            <div style={{padding:'10px 14px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,fontSize:12,color:'#92400e',fontWeight:600}}>
              ⚠️ {needsAction} requisition{needsAction!==1?'s':''} need{needsAction===1?'s':''} action
            </div>
          )}
          {displayed.map(req => (
            <ReqCard key={req.id} req={req} userRole={role} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Action modal */}
      {actionModal && (
        <ActionModal
          req={actionModal.req}
          action={actionModal.action}
          apiFetch={apiFetch}
          onClose={() => setActionModal(null)}
          onDone={handleDone}
        />
      )}
    </div>
    </AppShell>
  );
}
