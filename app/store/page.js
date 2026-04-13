'use client';
// app/store/page.js — Store Inventory · Live Bird Receipts
//
// Mirrors the egg-store acknowledge/dispute flow for FlockLifecycleEvents.
//
// Store Manager / Store Clerk (APPROVED events with TRANSFERRED_TO_STORE):
//   [✓ Acknowledge Receipt]  — enter actual count, auto-detects discrepancy
//   [⚑ Dispute]              — raise dispute with notes before counting
//
// Store Manager (own STORE_DISPUTED events):
//   [↩ Withdraw Dispute]     — pull back dispute, return to APPROVED
//
// IC / FM (STORE_DISPUTED events):
//   [✓ Force Accept]         — accept FM-approved count, add to inventory
//   [✏ Override Count]       — specify correct count, add to inventory

import { useState, useEffect, useCallback } from 'react';
import AppShell   from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const STORE_ROLES = ['STORE_MANAGER', 'STORE_CLERK'];
const IC_ROLES    = ['INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const ALL_ROLES   = [...STORE_ROLES, ...IC_ROLES];

const STATUS_META = {
  APPROVED:           { label:'Awaiting Acknowledgement', color:'#d97706', bg:'#fffbeb', border:'#fde68a', icon:'⏳' },
  STORE_ACKNOWLEDGED: { label:'Acknowledged',             color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', icon:'✓'  },
  STORE_DISPUTED:     { label:'Disputed',                 color:'#dc2626', bg:'#fef2f2', border:'#fecaca', icon:'⚑'  },
};

const fmt     = n => Number(n || 0).toLocaleString('en-NG');
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '—';
const fmtTime = d => d ? new Date(d).toLocaleTimeString('en-NG', { hour:'2-digit', minute:'2-digit' }) : '';

const inputSt = {
  width:'100%', padding:'9px 12px', borderRadius:8, fontSize:13,
  border:'1.5px solid var(--border)', fontFamily:'inherit',
  outline:'none', boxSizing:'border-box',
};

// ─────────────────────────────────────────────────────────────────────────────
// ACKNOWLEDGE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AcknowledgeModal({ event, apiFetch, onClose, onSuccess }) {
  const [actualCount, setActualCount] = useState(String(event.birdCount));
  const [notes,       setNotes]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const expected       = event.birdCount;
  const actual         = parseInt(actualCount) || 0;
  const hasDiscrepancy = actualCount !== '' && actual !== expected;
  const discrepancyPct = expected > 0 ? Math.abs(((actual - expected) / expected) * 100).toFixed(1) : '0.0';

  async function submit() {
    if (!actualCount || parseInt(actualCount) < 0) return setError('Enter the actual bird count received.');
    setSaving(true); setError('');
    try {
      const res = await apiFetch(`/api/flock-events/${event.id}/acknowledge`, {
        method:'POST', body:JSON.stringify({ actualCount:parseInt(actualCount), notes:notes.trim()||null }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Acknowledgement failed.');
      onSuccess(d.message);
    } catch { setError('Network error — please try again.'); }
    finally   { setSaving(false); }
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:600,padding:16 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'#fff',borderRadius:14,width:'100%',maxWidth:480,
        boxShadow:'0 8px 40px rgba(0,0,0,.2)',overflow:'hidden' }}>
        <div style={{ padding:'18px 20px 14px',borderBottom:'1px solid var(--border)',background:'#f8fafc' }}>
          <div style={{ fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:15 }}>✓ Acknowledge Bird Receipt</div>
          <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:3 }}>
            {event.flock?.batchCode} · {event.eventType==='CULL'?'Partial Cull':'Depletion'} · {event.store?.name}
          </div>
        </div>
        <div style={{ padding:20 }}>
          <div style={{ background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:10,
            padding:14,marginBottom:20,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,textAlign:'center' }}>
            {[
              { label:'Expected', value:fmt(expected), color:'var(--purple)' },
              { label:'Entered',  value:actualCount?fmt(actual):'—', color:hasDiscrepancy?'var(--red)':'var(--green)' },
              { label:'Diff',     value:hasDiscrepancy?`${discrepancyPct}%`:'—', color:hasDiscrepancy?'var(--red)':'var(--text-muted)' },
            ].map(s=>(
              <div key={s.label}>
                <div style={{ fontFamily:"'Poppins',sans-serif",fontSize:20,fontWeight:700,color:s.color }}>{s.value}</div>
                <div style={{ fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {hasDiscrepancy&&(
            <div style={{ padding:'10px 14px',background:'#fff7ed',border:'1px solid #fed7aa',
              borderRadius:8,fontSize:12,color:'#9a3412',marginBottom:16 }}>
              ⚠ Count mismatch ({discrepancyPct}%). This will be flagged and FM will be notified.
            </div>
          )}
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',
              letterSpacing:'0.06em',display:'block',marginBottom:6 }}>Actual birds received *</label>
            <input type="number" min="0" value={actualCount}
              onChange={e=>{setActualCount(e.target.value);setError('');}}
              style={inputSt} placeholder={`Expected: ${fmt(expected)}`} />
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',
              letterSpacing:'0.06em',display:'block',marginBottom:6 }}>Notes {hasDiscrepancy?'(explain discrepancy)':'(optional)'}</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2}
              style={{ ...inputSt,resize:'vertical' }}
              placeholder={hasDiscrepancy?'Describe what you found…':'Optional notes'} />
          </div>
          {error&&<div style={{ padding:'8px 12px',background:'var(--red-bg)',border:'1px solid var(--red-border)',
            borderRadius:8,fontSize:12,color:'var(--red)',marginBottom:12 }}>⚠ {error}</div>}
          <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
            <button onClick={onClose} disabled={saving} className="btn btn-ghost" style={{ fontSize:13 }}>Cancel</button>
            <button onClick={submit} disabled={saving} className="btn btn-primary"
              style={{ background:hasDiscrepancy?'#d97706':'#16a34a',borderColor:hasDiscrepancy?'#d97706':'#16a34a',fontSize:13 }}>
              {saving?'Saving…':hasDiscrepancy?'Acknowledge (with discrepancy)':'Confirm Receipt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION MODAL — dispute / withdraw / force_accept / override
// ─────────────────────────────────────────────────────────────────────────────
function ActionModal({ event, action, apiFetch, onClose, onSuccess }) {
  const [notes,         setNotes]         = useState('');
  const [overrideCount, setOverrideCount] = useState('');
  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');

  const META = {
    dispute:      { title:'⚑ Raise Dispute',   btnLabel:'Raise Dispute',  btnColor:'#dc2626', notesLabel:'Describe the discrepancy *', placeholder:'e.g. Only 80 birds arrived — gate count confirms 80, FM approved 100.' },
    withdraw:     { title:'↩ Withdraw Dispute', btnLabel:'Withdraw',       btnColor:'#6b7280', notesLabel:null },
    force_accept: { title:'✓ Force Accept',     btnLabel:'Force Accept',   btnColor:'#6c63ff', notesLabel:'Resolution notes *', placeholder:'e.g. Physical recount confirmed the FM-approved count of 100 birds.' },
    override:     { title:'✏ Override Count',   btnLabel:'Apply Override', btnColor:'#f59e0b', notesLabel:'Resolution notes *', placeholder:'e.g. Verified on site — actual count is 92 birds.' },
  };

  const m = META[action];
  if (!m) return null;

  async function submit() {
    if (action !== 'withdraw' && m.notesLabel && !notes.trim())
      return setError(`${m.notesLabel.replace(' *','')} is required.`);
    if (action === 'override' && (!overrideCount || parseInt(overrideCount) < 0))
      return setError('Enter the correct bird count.');
    setSaving(true); setError('');
    try {
      const body = { action, notes:notes.trim()||null };
      if (action === 'override') body.overrideCount = parseInt(overrideCount);
      const res = await apiFetch(`/api/flock-events/${event.id}/dispute`, {
        method:'POST', body:JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Action failed.');
      onSuccess(d.message);
    } catch { setError('Network error.'); }
    finally   { setSaving(false); }
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:600,padding:16 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:'#fff',borderRadius:14,width:'100%',maxWidth:460,
        boxShadow:'0 8px 40px rgba(0,0,0,.2)',overflow:'hidden' }}>
        <div style={{ padding:'18px 20px 14px',borderBottom:'1px solid var(--border)',background:'#f8fafc' }}>
          <div style={{ fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:15 }}>{m.title}</div>
          <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:3 }}>
            {event.flock?.batchCode} · {fmt(event.birdCount)} birds expected
          </div>
        </div>
        <div style={{ padding:20 }}>
          {action==='withdraw'?(
            <div style={{ padding:'12px 14px',background:'#fffbeb',border:'1px solid #fde68a',
              borderRadius:8,fontSize:13,color:'#92400e',marginBottom:16 }}>
              This returns the receipt to <strong>Awaiting Acknowledgement</strong>. You can then acknowledge or raise a new dispute.
            </div>
          ):(
            <>
              {action==='override'&&(
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',
                    letterSpacing:'0.06em',display:'block',marginBottom:6 }}>Correct bird count *</label>
                  <input type="number" min="0" value={overrideCount}
                    onChange={e=>{setOverrideCount(e.target.value);setError('');}}
                    style={inputSt} placeholder={`FM approved: ${fmt(event.birdCount)}`} />
                </div>
              )}
              {m.notesLabel&&(
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',
                    letterSpacing:'0.06em',display:'block',marginBottom:6 }}>{m.notesLabel}</label>
                  <textarea value={notes} onChange={e=>{setNotes(e.target.value);setError('');}}
                    rows={3} style={{ ...inputSt,resize:'vertical' }} placeholder={m.placeholder} />
                </div>
              )}
            </>
          )}
          {error&&<div style={{ padding:'8px 12px',background:'var(--red-bg)',border:'1px solid var(--red-border)',
            borderRadius:8,fontSize:12,color:'var(--red)',marginBottom:12 }}>⚠ {error}</div>}
          <div style={{ display:'flex',gap:10,justifyContent:'flex-end' }}>
            <button onClick={onClose} disabled={saving} className="btn btn-ghost" style={{ fontSize:13 }}>Cancel</button>
            <button onClick={submit} disabled={saving} className="btn btn-primary"
              style={{ background:m.btnColor,borderColor:m.btnColor,fontSize:13 }}>
              {saving?'Processing…':m.btnLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT CARD
// ─────────────────────────────────────────────────────────────────────────────
function EventCard({ event, userRole, userId, onAcknowledge, onAction }) {
  const meta       = STATUS_META[event.status] || STATUS_META.APPROVED;
  const isStore    = STORE_ROLES.includes(userRole);
  const isIC       = IC_ROLES.includes(userRole);
  const isPending  = event.status === 'APPROVED';
  const isDisputed = event.status === 'STORE_DISPUTED';
  const isAcked    = event.status === 'STORE_ACKNOWLEDGED';
  const ownDispute = event.storeAcknowledgedById === userId;
  const reviewedAt = event.reviewedAt || event.reviewed_at;

  return (
    <div style={{ background:isPending?'#fffbeb':isDisputed?'#fef2f2':'#fff',
      border:`1.5px solid ${isPending?'#fde68a':isDisputed?'#fecaca':'var(--border)'}`,
      borderRadius:12,padding:18,marginBottom:12 }}>

      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14 }}>
        <div>
          <div style={{ fontFamily:"'Poppins',sans-serif",fontWeight:700,fontSize:14 }}>
            {event.eventType==='CULL'?'✂️ Partial Cull':'🏁 Depletion'} — {event.flock?.batchCode}
          </div>
          <div style={{ fontSize:11,color:'var(--text-muted)',marginTop:3 }}>
            {event.penSection?.pen?.name} › {event.penSection?.name}
            {reviewedAt&&` · FM approved ${fmtDate(reviewedAt)}`}
          </div>
        </div>
        <span style={{ fontSize:11,fontWeight:700,padding:'4px 10px',borderRadius:20,
          background:meta.bg,color:meta.color,border:`1px solid ${meta.border}`,whiteSpace:'nowrap',flexShrink:0 }}>
          {meta.icon} {meta.label}
        </span>
      </div>

      <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:14 }}>
        {[
          { label:'Birds Expected',  value:fmt(event.birdCount),   color:'var(--purple)' },
          { label:'Disposition',     value:(event.disposition||'').replace(/_/g,' '), color:'var(--text-primary)' },
          { label:'Est. Value/Bird', value:event.estimatedValuePerBird?`₦${Number(event.estimatedValuePerBird).toLocaleString('en-NG')}`:'—', color:'var(--text-secondary)' },
          { label:'Store',           value:event.store?.name||'—', color:'var(--text-secondary)' },
        ].map(s=>(
          <div key={s.label} style={{ background:'var(--bg-elevated)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px' }}>
            <div style={{ fontSize:13,fontWeight:700,color:s.color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{s.value}</div>
            <div style={{ fontSize:10,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {isAcked&&(
        <div style={{ padding:'10px 14px',background:'#f0fdf4',border:'1px solid #bbf7d0',
          borderRadius:8,fontSize:12,color:'#166534',marginBottom:14 }}>
          ✓ {fmt(event.storeActualCount??event.store_actual_count??event.birdCount)} birds confirmed received
          {event.storeAcknowledgedAt&&` · ${fmtDate(event.storeAcknowledgedAt)} ${fmtTime(event.storeAcknowledgedAt)}`}
        </div>
      )}

      {isDisputed&&(
        <div style={{ padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',
          borderRadius:8,fontSize:12,color:'#991b1b',marginBottom:14 }}>
          <strong>⚑ Dispute:</strong> {event.storeDiscrepancyNotes||event.store_discrepancy_notes||'Count discrepancy raised.'}
        </div>
      )}

      <div style={{ display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap' }}>
        {isPending&&isStore&&(
          <>
            <button onClick={()=>onAcknowledge(event)}
              style={{ padding:'8px 16px',borderRadius:8,border:'none',
                background:'#16a34a',color:'#fff',fontWeight:700,fontSize:12,cursor:'pointer' }}>
              ✓ Acknowledge Receipt
            </button>
            <button onClick={()=>onAction(event,'dispute')}
              style={{ padding:'8px 16px',borderRadius:8,border:'1.5px solid #fecaca',
                background:'#fef2f2',color:'#dc2626',fontWeight:700,fontSize:12,cursor:'pointer' }}>
              ⚑ Dispute
            </button>
          </>
        )}
        {isDisputed&&isStore&&ownDispute&&(
          <button onClick={()=>onAction(event,'withdraw')}
            style={{ padding:'8px 16px',borderRadius:8,border:'1.5px solid var(--border)',
              background:'#fff',color:'var(--text-secondary)',fontWeight:700,fontSize:12,cursor:'pointer' }}>
            ↩ Withdraw Dispute
          </button>
        )}
        {isDisputed&&isIC&&(
          <>
            <button onClick={()=>onAction(event,'force_accept')}
              style={{ padding:'8px 16px',borderRadius:8,border:'none',
                background:'var(--purple)',color:'#fff',fontWeight:700,fontSize:12,cursor:'pointer' }}>
              ✓ Force Accept
            </button>
            <button onClick={()=>onAction(event,'override')}
              style={{ padding:'8px 16px',borderRadius:8,border:'1.5px solid #fed7aa',
                background:'#fff7ed',color:'#9a3412',fontWeight:700,fontSize:12,cursor:'pointer' }}>
              ✏ Override Count
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function StoreInventoryPage() {
  const { user, apiFetch } = useAuth();
  const role   = user?.role;
  const userId = user?.id;   // stored user object uses 'id', JWT payload uses 'sub'

  const [events,      setEvents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState('pending');
  const [ackModal,    setAckModal]    = useState(null);
  const [actionModal, setActionModal] = useState(null);
  const [toast,       setToast]       = useState(null);

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/flock-events');
      if (res.ok) {
        const d = await res.json();
        setEvents((d.events||[]).filter(e=>e.disposition==='TRANSFERRED_TO_STORE'));
      }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(()=>{ load(); },[load]);

  if (!ALL_ROLES.includes(role)) {
    return (
      <AppShell>
        <div style={{ padding:48,textAlign:'center',color:'var(--text-muted)' }}>
          <div style={{ fontSize:36,marginBottom:12 }}>🔒</div>
          <div style={{ fontWeight:700,fontSize:15 }}>Access Restricted</div>
          <div style={{ fontSize:13,marginTop:4 }}>Store Inventory is available to Store Managers, IC and Farm Managers.</div>
        </div>
      </AppShell>
    );
  }

  const pending      = events.filter(e=>e.status==='APPROVED');
  const disputed     = events.filter(e=>e.status==='STORE_DISPUTED');
  const acknowledged = events.filter(e=>e.status==='STORE_ACKNOWLEDGED');

  const TAB_DEFS = [
    { key:'pending',      label:'Awaiting Receipt', count:pending.length,      urgent:pending.length>0 },
    { key:'disputed',     label:'Disputed',          count:disputed.length,     urgent:disputed.length>0 },
    { key:'acknowledged', label:'Acknowledged',      count:acknowledged.length                          },
    { key:'all',          label:'All',               count:events.length                                },
  ];

  const displayed = tab==='pending'?pending:tab==='disputed'?disputed:tab==='acknowledged'?acknowledged:events;

  const kpis = [
    { label:'Awaiting Acknowledgement', value:pending.length,     color:'#d97706', icon:'⏳', urgent:pending.length>0 },
    { label:'Disputed',                 value:disputed.length,    color:'#dc2626', icon:'⚑',  urgent:disputed.length>0 },
    { label:'Acknowledged',             value:acknowledged.length,color:'#16a34a', icon:'✓'  },
    { label:'Total Birds Received',
      value:fmt(acknowledged.reduce((s,e)=>s+(e.storeActualCount??e.store_actual_count??e.birdCount??0),0)),
      color:'var(--purple)', icon:'🐔' },
  ];

  function handleSuccess(msg) { setAckModal(null); setActionModal(null); showToast(msg); load(); }

  return (
    <AppShell>
      <div style={{ maxWidth:920,margin:'0 auto' }}>
        {toast&&(
          <div style={{ position:'fixed',top:20,right:24,zIndex:9999,padding:'12px 20px',
            borderRadius:10,fontSize:13,fontWeight:600,
            background:toast.type==='error'?'var(--red-bg)':'var(--green-bg)',
            color:toast.type==='error'?'var(--red)':'#16a34a',
            border:`1px solid ${toast.type==='error'?'var(--red-border)':'var(--green-border)'}`,
            boxShadow:'var(--shadow-md)',animation:'fadeInUp 0.2s ease' }}>
            {toast.type==='error'?'⚠ ':'✓ '}{toast.msg}
          </div>
        )}
        <style>{`@keyframes fadeInUp{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>

        <div style={{ marginBottom:24 }}>
          <h1 style={{ fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:700,margin:0 }}>🏪 Store Inventory</h1>
          <p style={{ color:'var(--text-muted)',fontSize:12,marginTop:3 }}>Live bird receipts from approved cull and depletion events</p>
        </div>

        <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24 }}>
          {kpis.map(k=>(
            <div key={k.label} style={{ background:k.urgent?'#fffbeb':'#fff',
              border:`1px solid ${k.urgent?'#fde68a':'var(--border)'}`,borderRadius:10,padding:'14px 16px' }}>
              <div style={{ display:'flex',justifyContent:'space-between',marginBottom:8 }}>
                <span style={{ fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'var(--text-muted)' }}>{k.label}</span>
                <span style={{ fontSize:18 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily:"'Poppins',sans-serif",fontSize:24,fontWeight:700,color:k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'flex',borderBottom:'2px solid var(--border)',marginBottom:20,gap:0 }}>
          {TAB_DEFS.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} style={{
              padding:'10px 18px',border:'none',background:'none',cursor:'pointer',
              fontSize:13,fontWeight:tab===t.key?700:600,fontFamily:'inherit',
              color:tab===t.key?'var(--purple)':'var(--text-muted)',
              borderBottom:`3px solid ${tab===t.key?'var(--purple)':'transparent'}`,
              marginBottom:-2,display:'flex',alignItems:'center',gap:6 }}>
              {t.label}
              {t.count>0&&(
                <span style={{ fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:10,
                  background:t.urgent?'#fef2f2':tab===t.key?'var(--purple-light)':'var(--bg-elevated)',
                  color:t.urgent?'#dc2626':tab===t.key?'var(--purple)':'var(--text-muted)',
                  border:`1px solid ${t.urgent?'#fecaca':tab===t.key?'#d4d8ff':'var(--border)'}` }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading?(
          <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
            {[1,2,3].map(i=><div key={i} style={{ height:160,background:'var(--bg-elevated)',borderRadius:12,animation:'pulse 1.5s ease-in-out infinite' }}/>)}
          </div>
        ):displayed.length===0?(
          <div style={{ textAlign:'center',padding:'60px 20px',color:'var(--text-muted)' }}>
            <div style={{ fontSize:40,marginBottom:12 }}>{tab==='pending'?'⏳':tab==='disputed'?'⚑':'✓'}</div>
            <div style={{ fontSize:14,fontWeight:700,color:'var(--text-secondary)',marginBottom:6 }}>
              {tab==='pending'?'No pending receipts':tab==='disputed'?'No disputed receipts':'No records found'}
            </div>
            <div style={{ fontSize:12 }}>
              {tab==='pending'?'Approved cull and depletion events will appear here when birds are transferred to store.':'All clear.'}
            </div>
          </div>
        ):(
          <div>
            {displayed.map(event=>(
              <EventCard key={event.id} event={event} userRole={role} userId={userId}
                onAcknowledge={e=>setAckModal(e)}
                onAction={(e,action)=>setActionModal({event:e,action})} />
            ))}
          </div>
        )}
      </div>

      {ackModal&&<AcknowledgeModal event={ackModal} apiFetch={apiFetch} onClose={()=>setAckModal(null)} onSuccess={handleSuccess}/>}
      {actionModal&&<ActionModal event={actionModal.event} action={actionModal.action} apiFetch={apiFetch} onClose={()=>setActionModal(null)} onSuccess={handleSuccess}/>}
    </AppShell>
  );
}
