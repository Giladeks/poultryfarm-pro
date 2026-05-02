'use client';
export const dynamic = 'force-dynamic';
// app/feed-changes/page.js
// Phase 8H — Feed Change Request Workflow
// PM creates → FM approves → SM executes (return old + issue new) → PM acknowledges
// Nav: Operations group, visible to PM, FM, SM, IC

import { useState, useEffect, useCallback } from 'react';
import { useAuth }   from '@/components/layout/AuthProvider';
import AppShell      from '@/components/layout/AppShell';

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_META = {
  DRAFT:       { label:'Draft',        color:'#64748b', bg:'#f8fafc', border:'#e2e8f0', icon:'📋' },
  SUBMITTED:   { label:'Pending FM',   color:'#d97706', bg:'#fffbeb', border:'#fde68a', icon:'⏳' },
  APPROVED:    { label:'FM Approved',  color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', icon:'✅' },
  REJECTED:    { label:'Rejected',     color:'#dc2626', bg:'#fef2f2', border:'#fecaca', icon:'↩️' },
  IN_PROGRESS: { label:'Awaiting Ack', color:'#6c63ff', bg:'#f5f3ff', border:'#ddd6fe', icon:'📦' },
  COMPLETED:   { label:'Completed',    color:'#16a34a', bg:'#f0fdf4', border:'#bbf7d0', icon:'✓'  },
  CANCELLED:   { label:'Cancelled',    color:'#94a3b8', bg:'#f8fafc', border:'#e2e8f0', icon:'✕'  },
};

const REASON_OPTIONS = [
  { value:'AGE_TRANSITION',     label:'Age Transition',      hint:'Bird reached target age for next feed phase' },
  { value:'WEIGHT_MILESTONE',   label:'Weight Milestone',    hint:'Bird reached target weight' },
  { value:'VET_RECOMMENDATION', label:'Vet Recommendation',  hint:'Veterinarian prescribed feed change' },
  { value:'FEED_SHORTAGE',      label:'Feed Shortage',       hint:'Current feed type out of stock' },
  { value:'QUALITY_ISSUE',      label:'Quality Issue',       hint:'Current feed has quality problem' },
  { value:'OTHER',              label:'Other',               hint:'Enter details in notes' },
];

const PM_ROLES = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const FM_ROLES = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const SM_ROLES = ['STORE_MANAGER'];

const fmt     = n => Number(n||0).toLocaleString('en-NG', { maximumFractionDigits:1 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' }) : '—';
const timeAgo = d => {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400)return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};

// ── Modal shell ───────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, footer }) {
  return (
    <div style={{ position:'fixed',inset:0,zIndex:1100,background:'rgba(0,0,0,0.45)',display:'flex',alignItems:'center',justifyContent:'center',padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'#fff',borderRadius:14,width:'100%',maxWidth:540,maxHeight:'90vh',overflowY:'auto',
        boxShadow:'0 20px 60px rgba(0,0,0,0.25)',animation:'fadeInUp 0.2s ease' }}>
        <div style={{ padding:'18px 22px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:'#fff',zIndex:1 }}>
          <div style={{ fontWeight:800,fontSize:15,color:'#1e293b',fontFamily:"'Poppins',sans-serif" }}>{title}</div>
          <button onClick={onClose} style={{ background:'none',border:'none',fontSize:22,cursor:'pointer',color:'#94a3b8',minWidth:44,minHeight:44,display:'flex',alignItems:'center',justifyContent:'center' }}>×</button>
        </div>
        <div style={{ padding:'20px 22px' }}>{children}</div>
        {footer && <div style={{ padding:'14px 22px',borderTop:'1px solid #f1f5f9',display:'flex',gap:10,justifyContent:'flex-end',position:'sticky',bottom:0,background:'#fff' }}>{footer}</div>}
      </div>
    </div>
  );
}

function Field({ label, required, children, hint }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block',fontSize:11,fontWeight:700,color:'#475569',marginBottom:5,textTransform:'uppercase',letterSpacing:'.04em' }}>
        {label}{required && <span style={{ color:'#dc2626',marginLeft:3 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize:10,color:'#94a3b8',marginTop:3 }}>{hint}</div>}
    </div>
  );
}

const inp = { width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box' };

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.DRAFT;
  return (
    <span style={{ display:'inline-flex',alignItems:'center',gap:5,padding:'3px 9px',borderRadius:99,
      fontSize:11,fontWeight:700,background:m.bg,color:m.color,border:`1px solid ${m.border}` }}>
      {m.icon} {m.label}
    </span>
  );
}

// ── Feed Change Card ──────────────────────────────────────────────────────────
function ChangeCard({ ch, userRole, onAction }) {
  const [expanded, setExpanded] = useState(false);
  const m = STATUS_META[ch.status] || STATUS_META.DRAFT;

  const canSubmit    = ch.status === 'DRAFT'        && PM_ROLES.includes(userRole);
  const canApprove   = ch.status === 'SUBMITTED'    && FM_ROLES.includes(userRole);
  const canReject    = ch.status === 'SUBMITTED'    && FM_ROLES.includes(userRole);
  const canExecute   = ch.status === 'APPROVED'     && SM_ROLES.includes(userRole);
  const canAcknowledge= ch.status === 'IN_PROGRESS' && PM_ROLES.includes(userRole);
  const canCancel    = ['DRAFT','SUBMITTED','REJECTED'].includes(ch.status) && PM_ROLES.includes(userRole);

  return (
    <div style={{ background:'#fff',borderRadius:12,border:`1px solid ${m.border}`,
      boxShadow:'0 1px 4px rgba(0,0,0,0.05)',overflow:'hidden',marginBottom:12 }}>
      {/* Colour bar */}
      <div style={{ height:3,background:`linear-gradient(90deg,${m.color},${m.color}66)` }} />

      <div style={{ padding:'14px 16px' }}>
        {/* Header row */}
        <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:10 }}>
          <div>
            <div style={{ fontSize:13,fontWeight:800,color:'#1e293b',marginBottom:2 }}>
              {ch.fromFeedInventory?.feedType} → {ch.toFeedInventory?.feedType}
            </div>
            <div style={{ fontSize:11,color:'#64748b' }}>
              {ch.penSection?.pen?.name} › {ch.penSection?.name}
              {ch.flock && <> · <span style={{ fontWeight:600 }}>{ch.flock.batchCode}</span></>}
            </div>
          </div>
          <StatusBadge status={ch.status} />
        </div>

        {/* Key info chips */}
        <div style={{ display:'flex',flexWrap:'wrap',gap:6,marginBottom:12 }}>
          <span style={{ fontSize:11,padding:'3px 8px',borderRadius:6,background:'#f1f5f9',color:'#475569' }}>
            📅 {fmtDate(ch.effectiveDate)}
          </span>
          <span style={{ fontSize:11,padding:'3px 8px',borderRadius:6,background:'#f1f5f9',color:'#475569' }}>
            ↩ Return: {ch.returnBags} bag{ch.returnBags!==1?'s':''} ({fmt(ch.returnQtyKg)} kg est.)
          </span>
          <span style={{ fontSize:11,padding:'3px 8px',borderRadius:6,background:'#f5f3ff',color:'#6c63ff' }}>
            📦 Request: {ch.requestedBags} bag{ch.requestedBags!==1?'s':''} ({fmt(ch.requestedQtyKg)} kg)
          </span>
          <span style={{ fontSize:11,padding:'3px 8px',borderRadius:6,background:'#f1f5f9',color:'#475569' }}>
            {ch.reasonLabel || ch.reason?.replace(/_/g,' ')}
          </span>
          <span style={{ fontSize:11,padding:'3px 8px',borderRadius:6,background:'#f1f5f9',color:'#64748b' }}>
            👤 {ch.requestedBy?.firstName} · {timeAgo(ch.createdAt)}
          </span>
        </div>

        {/* Progress trail */}
        {expanded && (
          <div style={{ marginBottom:12,padding:'10px 12px',background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0' }}>
            <div style={{ fontSize:11,fontWeight:700,color:'#64748b',marginBottom:8,textTransform:'uppercase',letterSpacing:'.04em' }}>Timeline</div>
            {[
              { label:'Created by',    who:ch.requestedBy,   at:ch.createdAt,     note:ch.notes },
              { label:'Approved by',   who:ch.approvedBy,    at:ch.approvedAt,    note:ch.fmNotes },
              { label:'Rejected by',   who:ch.rejectedBy,    at:ch.rejectedAt,    note:ch.fmNotes },
              { label:'Executed by',   who:ch.executedBy,    at:ch.executedAt,    note:ch.smNotes,
                extra:`Returned ${fmt(ch.returnedActualKg)} kg · Issued ${fmt(ch.issuedQtyKg)} kg` },
              { label:'Acknowledged by',who:ch.acknowledgedBy,at:ch.acknowledgedAt,note:ch.pmAckNotes,
                extra:`Confirmed ${fmt(ch.acknowledgedQtyKg)} kg` },
            ].filter(r => r.who).map((r,i) => (
              <div key={i} style={{ display:'flex',gap:10,marginBottom:6,fontSize:11 }}>
                <div style={{ width:8,height:8,borderRadius:'50%',background:m.color,marginTop:3,flexShrink:0 }} />
                <div>
                  <strong>{r.label}:</strong> {r.who?.firstName} {r.who?.lastName} · {timeAgo(r.at)}
                  {r.extra && <span style={{ color:'#6c63ff',marginLeft:6 }}>{r.extra}</span>}
                  {r.note && <div style={{ color:'#64748b',fontStyle:'italic',marginTop:2 }}>"{r.note}"</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
          <button onClick={() => setExpanded(e=>!e)}
            style={{ padding:'5px 10px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:expanded?'var(--purple-light)':'#f8fafc',color:expanded?'var(--purple)':'#64748b',
              border:`1px solid ${expanded?'#d4d8ff':'#e2e8f0'}` }}>
            {expanded ? '▲ Hide' : '▼ Details'}
          </button>

          {canSubmit    && <button onClick={() => onAction(ch,'submit')}
            style={{ padding:'5px 12px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:'#fffbeb',color:'#d97706',border:'1px solid #fde68a' }}>📤 Submit to FM</button>}
          {canApprove   && <button onClick={() => onAction(ch,'approve')}
            style={{ padding:'5px 12px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0' }}>✅ Approve</button>}
          {canReject    && <button onClick={() => onAction(ch,'reject')}
            style={{ padding:'5px 12px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca' }}>↩️ Reject</button>}
          {canExecute   && <button onClick={() => onAction(ch,'execute')}
            style={{ padding:'5px 12px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:'#f5f3ff',color:'#6c63ff',border:'1px solid #ddd6fe' }}>📦 Execute</button>}
          {canAcknowledge && <button onClick={() => onAction(ch,'acknowledge')}
            style={{ padding:'5px 12px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0' }}>✓ Acknowledge Receipt</button>}
          {canCancel    && <button onClick={() => onAction(ch,'cancel')}
            style={{ padding:'5px 12px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:'#f8fafc',color:'#94a3b8',border:'1px solid #e2e8f0' }}>✕ Cancel</button>}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FeedChangesPage() {
  const { user, apiFetch } = useAuth();
  const role = user?.role;

  const [changes,  setChanges]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);
  const [activeTab,setActiveTab]= useState('active');
  const [modal,    setModal]    = useState(null); // { type, change }

  // Form states
  const [sections,     setSections]     = useState([]);
  const [feedInventory,setFeedInventory]= useState([]);
  const [createForm,   setCreateForm]   = useState({
    penSectionId:'', flockId:'', fromFeedInventoryId:'', fromStoreId:'',
    toFeedInventoryId:'', toStoreId:'', returnBags:'', returnQtyKg:'',
    requestedBags:'', requestedQtyKg:'', effectiveDate: new Date().toISOString().slice(0,10),
    reason:'AGE_TRANSITION', notes:'',
  });
  const [actionForm,  setActionForm]  = useState({ notes:'', returnedActualKg:'', issuedQtyKg:'', issuedBags:'', acknowledgedQtyKg:'' });
  const [saving,      setSaving]      = useState(false);
  const [formError,   setFormError]   = useState('');

  const showToast = (msg, type='success') => { setToast({ msg, type }); setTimeout(()=>setToast(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const statusFilter = activeTab === 'active'
        ? 'DRAFT,SUBMITTED,APPROVED,IN_PROGRESS'
        : 'COMPLETED,CANCELLED,REJECTED';
      const res = await apiFetch(`/api/feed/changes?status=${statusFilter}`);
      const d   = await res.json();
      setChanges(d.changes || []);
    } catch { showToast('Failed to load feed changes','error'); }
    setLoading(false);
  }, [apiFetch, activeTab]);

  useEffect(() => { load(); }, [load]);

  // Load sections + inventory when create modal opens
  useEffect(() => {
    if (modal?.type !== 'create') return;
    (async () => {
      const [secRes, invRes] = await Promise.all([
        apiFetch('/api/farm-structure'),
        apiFetch('/api/feed-inventory'),
      ]);
      if (secRes.ok) {
        const d = await secRes.json();
        const allSections = (d.farms||[]).flatMap(f => f.pens.flatMap(p =>
          p.sections.filter(s => s.activeFlock).map(s => ({
            id: s.id, name: s.name, penName: p.name,
            flock: s.activeFlock,
          }))
        ));
        setSections(allSections);
      }
      if (invRes.ok) {
        const d = await invRes.json();
        setFeedInventory(d.inventory || d.feedInventory || []);
      }
    })();
  }, [modal?.type]);

  // Auto-fill bagWeightKg when feed changes
  const bagWtFrom = feedInventory.find(f=>f.id===createForm.fromFeedInventoryId)?.bagWeightKg || 25;
  const bagWtTo   = feedInventory.find(f=>f.id===createForm.toFeedInventoryId)?.bagWeightKg || 25;
  const returnKg  = (parseInt(createForm.returnBags)||0) * bagWtFrom;
  const requestKg = (parseInt(createForm.requestedBags)||0) * bagWtTo;

  const setCreate = (k,v) => { setCreateForm(p=>({...p,[k]:v})); setFormError(''); };
  const setAction = (k,v) => { setActionForm(p=>({...p,[k]:v})); setFormError(''); };

  // Selected section's flock
  const selSection = sections.find(s=>s.id===createForm.penSectionId);

  async function handleCreate(e) {
    e?.preventDefault();
    if (!createForm.penSectionId || !createForm.fromFeedInventoryId || !createForm.toFeedInventoryId)
      return setFormError('Section, from-feed, and to-feed are required');
    if (createForm.fromFeedInventoryId === createForm.toFeedInventoryId)
      return setFormError('From and To feed must be different');
    if (!createForm.returnBags && !createForm.returnQtyKg)
      return setFormError('Enter the amount of feed being returned');
    if (!createForm.requestedBags)
      return setFormError('Enter the number of bags requested of the new feed');

    setSaving(true); setFormError('');
    try {
      const fromInv = feedInventory.find(f=>f.id===createForm.fromFeedInventoryId);
      const toInv   = feedInventory.find(f=>f.id===createForm.toFeedInventoryId);
      const res = await apiFetch('/api/feed/changes', {
        method: 'POST',
        body: JSON.stringify({
          penSectionId:        createForm.penSectionId,
          flockId:             selSection?.flock?.id || createForm.flockId,
          fromFeedInventoryId: createForm.fromFeedInventoryId,
          fromStoreId:         fromInv?.storeId || createForm.fromStoreId,
          toFeedInventoryId:   createForm.toFeedInventoryId,
          toStoreId:           toInv?.storeId   || createForm.toStoreId,
          returnBags:          parseInt(createForm.returnBags)||0,
          returnQtyKg:         returnKg,
          requestedBags:       parseInt(createForm.requestedBags)||0,
          requestedQtyKg:      requestKg,
          effectiveDate:       createForm.effectiveDate,
          reason:              createForm.reason,
          notes:               createForm.notes || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setFormError(d.error || 'Failed'); setSaving(false); return; }
      showToast('Feed change request created');
      setModal(null);
      load();
    } catch { setFormError('Network error'); }
    setSaving(false);
  }

  async function handleAction(change, action) {
    if (action === 'cancel') {
      if (!confirm('Cancel this feed change request?')) return;
      const res = await apiFetch(`/api/feed/changes/${change.id}`, {
        method:'PATCH', body: JSON.stringify({ action:'cancel' }),
      });
      if (res.ok) { showToast('Request cancelled'); load(); }
      else { const d=await res.json(); showToast(d.error||'Failed','error'); }
      return;
    }
    // All other actions open a modal
    setActionForm({ notes:'', returnedActualKg: String(change.returnQtyKg||''), issuedQtyKg: String(change.requestedQtyKg||''), issuedBags: String(change.requestedBags||''), acknowledgedQtyKg: String(change.issuedQtyKg||change.requestedQtyKg||'') });
    setModal({ type: action, change });
  }

  async function submitAction() {
    const { type, change } = modal;
    setSaving(true); setFormError('');
    try {
      let body = { action: type };
      if (type === 'submit')      { /* no extra fields */ }
      if (type === 'approve')     body.fmNotes = actionForm.notes;
      if (type === 'reject')      { if (!actionForm.notes.trim()) { setFormError('Rejection reason is required'); setSaving(false); return; } body.fmNotes = actionForm.notes; }
      if (type === 'execute')     {
        if (!actionForm.returnedActualKg || !actionForm.issuedQtyKg || !actionForm.issuedBags)
          { setFormError('All execution fields are required'); setSaving(false); return; }
        body.returnedActualKg = parseFloat(actionForm.returnedActualKg);
        body.issuedQtyKg      = parseFloat(actionForm.issuedQtyKg);
        body.issuedBags       = parseInt(actionForm.issuedBags);
        body.smNotes          = actionForm.notes || null;
      }
      if (type === 'acknowledge') {
        if (!actionForm.acknowledgedQtyKg)
          { setFormError('Confirm received quantity'); setSaving(false); return; }
        body.acknowledgedQtyKg = parseFloat(actionForm.acknowledgedQtyKg);
        body.pmAckNotes        = actionForm.notes || null;
      }

      const res = await apiFetch(`/api/feed/changes/${change.id}`, { method:'PATCH', body: JSON.stringify(body) });
      const d   = await res.json();
      if (!res.ok) { setFormError(d.error||'Failed'); setSaving(false); return; }

      const msgs = { submit:'Submitted for FM approval', approve:'Request approved', reject:'Request rejected', execute:'Feed exchange executed — PM notified to acknowledge', acknowledge:'Receipt acknowledged — feed change complete' };
      showToast(msgs[type] || 'Done');
      setModal(null);
      load();
    } catch { setFormError('Network error'); }
    setSaving(false);
  }

  const canCreate = PM_ROLES.includes(role);
  const activeCnt = changes.filter(c=>['DRAFT','SUBMITTED','APPROVED','IN_PROGRESS'].includes(c.status)).length;
  const myAction  = changes.filter(c=>{
    if (role === 'PEN_MANAGER'   && (c.status==='DRAFT'||c.status==='IN_PROGRESS')) return true;
    if (FM_ROLES.includes(role)  && c.status==='SUBMITTED') return true;
    if (SM_ROLES.includes(role)  && c.status==='APPROVED')  return true;
    return false;
  }).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <style>{`@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div className="page-content animate-in">

        {/* Header */}
        <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12,marginBottom:24 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif",fontSize:22,fontWeight:800,color:'#1e293b',margin:0 }}>
              🔄 Feed Changes
            </h1>
            <p style={{ color:'#64748b',fontSize:12,marginTop:3 }}>
              Manage feed type transitions — return old feed and issue new feed type
            </p>
          </div>
          <div style={{ display:'flex',gap:10,alignItems:'center' }}>
            {myAction > 0 && (
              <span style={{ padding:'5px 12px',borderRadius:99,background:'#fffbeb',color:'#d97706',
                fontSize:12,fontWeight:700,border:'1px solid #fde68a',animation:'pulse 2s infinite' }}>
                ⏳ {myAction} need{myAction===1?'s':''} your action
              </span>
            )}
            {canCreate && (
              <button onClick={() => setModal({ type:'create' })}
                style={{ padding:'9px 16px',borderRadius:9,background:'var(--purple,#6c63ff)',color:'#fff',
                  border:'none',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit' }}>
                + New Feed Change
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex',gap:4,marginBottom:20,background:'#f8fafc',borderRadius:10,padding:4,width:'fit-content',maxWidth:'100%',overflowX:'auto',WebkitOverflowScrolling:'touch' }}>
          {[
            { key:'active',   label:`Active${activeCnt>0?` (${activeCnt})`:''}` },
            { key:'history',  label:'History' },
          ].map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className="tab-btn"
              style={{ padding:'10px 18px',minHeight:38,borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'none',
                background:activeTab===t.key?'#fff':'transparent',
                color:activeTab===t.key?'var(--purple,#6c63ff)':'#64748b',
                boxShadow:activeTab===t.key?'0 1px 4px rgba(0,0,0,0.08)':'none',
                fontFamily:'inherit' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ textAlign:'center',padding:'40px 0',color:'#94a3b8',fontSize:14 }}>Loading…</div>
        ) : changes.length === 0 ? (
          <div style={{ textAlign:'center',padding:'48px 0',background:'#f8fafc',borderRadius:12,border:'1px dashed #e2e8f0' }}>
            <div style={{ fontSize:36,marginBottom:12 }}>🔄</div>
            <div style={{ fontWeight:700,color:'#475569',marginBottom:6 }}>
              {activeTab==='active' ? 'No active feed change requests' : 'No completed changes yet'}
            </div>
            <div style={{ fontSize:12,color:'#94a3b8' }}>
              {canCreate ? 'Create a new request when a flock needs a different feed type.' : 'Feed change requests will appear here when created by Pen Managers.'}
            </div>
          </div>
        ) : (
          <div>
            {changes.map(ch => (
              <ChangeCard key={ch.id} ch={ch} userRole={role} onAction={handleAction} />
            ))}
          </div>
        )}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position:'fixed',bottom:24,right:24,zIndex:2000,padding:'12px 18px',borderRadius:10,
          background:toast.type==='error'?'#dc2626':'#16a34a',color:'#fff',fontSize:13,fontWeight:700,
          boxShadow:'0 4px 20px rgba(0,0,0,0.2)',animation:'fadeInUp 0.2s ease' }}>
          {toast.type==='error'?'⚠ ':'✓ '}{toast.msg}
        </div>
      )}

      {/* ── Create Modal ── */}
      {modal?.type === 'create' && (
        <Modal title="🔄 New Feed Change Request" onClose={() => setModal(null)}
          footer={<>
            <button onClick={() => setModal(null)} style={{ padding:'9px 16px',borderRadius:8,border:'1.5px solid #e2e8f0',background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569',fontFamily:'inherit' }}>Cancel</button>
            <button onClick={handleCreate} disabled={saving}
              style={{ padding:'9px 18px',borderRadius:8,border:'none',background:saving?'#e2e8f0':'var(--purple,#6c63ff)',color:'#fff',fontWeight:700,fontSize:13,cursor:saving?'not-allowed':'pointer',fontFamily:'inherit' }}>
              {saving ? 'Creating…' : 'Create Request'}
            </button>
          </>}>

          {formError && <div style={{ marginBottom:14,padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:12,color:'#dc2626' }}>⚠ {formError}</div>}

          <div style={{ background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#166534' }}>
            The PM creates this request. The FM must approve before the Store Manager can process the feed exchange.
          </div>

          <Field label="Section" required>
            <select value={createForm.penSectionId} style={inp}
              onChange={e => { setCreate('penSectionId',e.target.value); setCreate('flockId',''); }}>
              <option value="">Select section…</option>
              {sections.map(s => (
                <option key={s.id} value={s.id}>{s.penName} › {s.name} — {s.flock?.batchCode}</option>
              ))}
            </select>
          </Field>

          {selSection && (
            <div style={{ marginBottom:14,padding:'8px 12px',background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0',fontSize:11,color:'#475569' }}>
              🐔 {selSection.flock?.batchCode} · Stage: <strong>{selSection.flock?.stage}</strong>
            </div>
          )}

          <div className='modal-input-grid-2' style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
            <Field label="Current Feed (returning)" required>
              <select value={createForm.fromFeedInventoryId} style={inp}
                onChange={e => setCreate('fromFeedInventoryId',e.target.value)}>
                <option value="">Select current feed…</option>
                {feedInventory.map(f => (
                  <option key={f.id} value={f.id}>{f.feedType} ({fmt(f.currentStockKg)} kg in stock)</option>
                ))}
              </select>
            </Field>
            <Field label="New Feed (requesting)" required>
              <select value={createForm.toFeedInventoryId} style={inp}
                onChange={e => setCreate('toFeedInventoryId',e.target.value)}>
                <option value="">Select new feed…</option>
                {feedInventory.filter(f=>f.id!==createForm.fromFeedInventoryId).map(f => (
                  <option key={f.id} value={f.id}>{f.feedType} ({fmt(f.currentStockKg)} kg in stock)</option>
                ))}
              </select>
            </Field>
          </div>

          <div className='modal-input-grid-2' style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
            <Field label="Bags to Return" required hint={returnKg > 0 ? `= ${returnKg} kg at ${bagWtFrom} kg/bag` : ''}>
              <input type="number" inputMode="numeric" min="0" step="1" style={inp} value={createForm.returnBags}
                onChange={e => setCreate('returnBags',e.target.value)} placeholder="0" />
            </Field>
            <Field label="New Feed Bags Needed" required hint={requestKg > 0 ? `= ${requestKg} kg at ${bagWtTo} kg/bag` : ''}>
              <input type="number" inputMode="numeric" min="1" step="1" style={inp} value={createForm.requestedBags}
                onChange={e => setCreate('requestedBags',e.target.value)} placeholder="0" />
            </Field>
          </div>

          <div className='modal-input-grid-2' style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
            <Field label="Effective Date" required>
              <input type="date" style={inp} value={createForm.effectiveDate}
                min={new Date().toISOString().slice(0,10)}
                onChange={e => setCreate('effectiveDate',e.target.value)} />
            </Field>
            <Field label="Reason" required>
              <select value={createForm.reason} style={inp}
                onChange={e => setCreate('reason',e.target.value)}>
                {REASON_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={createForm.notes} rows={2} style={{ ...inp,resize:'vertical' }}
              placeholder="Any additional context for the FM…"
              onChange={e => setCreate('notes',e.target.value)} />
          </Field>
        </Modal>
      )}

      {/* ── Action Modals (submit / approve / reject / execute / acknowledge) ── */}
      {modal && modal.type !== 'create' && (
        <Modal
          title={{
            submit:     '📤 Submit Feed Change Request',
            approve:    '✅ Approve Feed Change',
            reject:     '↩️ Reject Feed Change',
            execute:    '📦 Execute Feed Exchange',
            acknowledge:'✓ Acknowledge New Feed Receipt',
          }[modal.type]}
          onClose={() => setModal(null)}
          footer={<>
            <button onClick={() => setModal(null)} style={{ padding:'9px 16px',borderRadius:8,border:'1.5px solid #e2e8f0',background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569',fontFamily:'inherit' }}>Cancel</button>
            <button onClick={submitAction} disabled={saving}
              style={{ padding:'9px 18px',borderRadius:8,border:'none',fontWeight:700,fontSize:13,cursor:saving?'not-allowed':'pointer',fontFamily:'inherit',
                background:saving?'#e2e8f0': modal.type==='reject'?'#dc2626':'var(--purple,#6c63ff)', color:'#fff' }}>
              {saving ? 'Saving…' : { submit:'Submit to FM', approve:'Approve', reject:'Reject', execute:'Confirm Exchange', acknowledge:'Confirm Receipt' }[modal.type]}
            </button>
          </>}>

          {formError && <div style={{ marginBottom:14,padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,fontSize:12,color:'#dc2626' }}>⚠ {formError}</div>}

          {/* Summary of the change */}
          <div style={{ marginBottom:16,padding:'12px 14px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:9,fontSize:12 }}>
            <div style={{ fontWeight:700,marginBottom:4,color:'#1e293b' }}>
              {modal.change.fromFeedInventory?.feedType} → {modal.change.toFeedInventory?.feedType}
            </div>
            <div style={{ color:'#64748b' }}>
              {modal.change.penSection?.pen?.name} › {modal.change.penSection?.name} · {modal.change.flock?.batchCode}
            </div>
            <div style={{ color:'#64748b',marginTop:4 }}>
              Return: <strong>{modal.change.returnBags} bags ({fmt(modal.change.returnQtyKg)} kg)</strong>
              &nbsp;→&nbsp;
              Request: <strong>{modal.change.requestedBags} bags ({fmt(modal.change.requestedQtyKg)} kg)</strong>
            </div>
          </div>

          {modal.type === 'submit' && (
            <div style={{ padding:'10px 14px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,fontSize:12,color:'#92400e' }}>
              This will send the request to the Farm Manager for approval. You cannot edit it after submission.
            </div>
          )}

          {(modal.type === 'approve' || modal.type === 'reject') && (
            <Field label={modal.type==='approve' ? 'Approval notes (optional)' : 'Rejection reason *'}>
              <textarea value={actionForm.notes} rows={3} style={{ ...inp,resize:'vertical' }}
                placeholder={modal.type==='approve' ? 'Any instructions for the Store Manager…' : 'Explain why this is being rejected…'}
                onChange={e => setAction('notes',e.target.value)} />
            </Field>
          )}

          {modal.type === 'execute' && (<>
            <div style={{ padding:'10px 14px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,fontSize:12,color:'#166534',marginBottom:14 }}>
              Enter the actual quantities. Returning old feed credits the store inventory. Issuing new feed debits it.
            </div>
            <div className='modal-input-grid-2' style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
              <Field label="Old Feed Returned (kg) *" hint="Actual kg received back from section">
                <input type="number" min="0" step="0.1" style={inp} value={actionForm.returnedActualKg}
                  onChange={e => setAction('returnedActualKg',e.target.value)} placeholder="0" />
              </Field>
              <Field label="New Feed Issued (bags) *">
                <input type="number" min="1" step="1" style={inp} value={actionForm.issuedBags}
                  onChange={e => {
                    setAction('issuedBags',e.target.value);
                    const bw = modal.change.toFeedInventory?.bagWeightKg || 25;
                    setAction('issuedQtyKg', String(parseFloat(e.target.value||0)*bw));
                  }} placeholder="0" />
              </Field>
            </div>
            <Field label="New Feed Issued (kg) *" hint="Auto-filled from bags × bag weight">
              <input type="number" min="0" step="0.1" style={inp} value={actionForm.issuedQtyKg}
                onChange={e => setAction('issuedQtyKg',e.target.value)} />
            </Field>
            <Field label="Store Manager Notes">
              <textarea value={actionForm.notes} rows={2} style={{ ...inp,resize:'vertical' }}
                placeholder="Any notes about the exchange…"
                onChange={e => setAction('notes',e.target.value)} />
            </Field>
          </>)}

          {modal.type === 'acknowledge' && (<>
            <Field label="Bags received (kg) *" hint="Confirm the physical quantity received in your section">
              <input type="number" min="0" step="0.1" style={inp} value={actionForm.acknowledgedQtyKg}
                onChange={e => setAction('acknowledgedQtyKg',e.target.value)} />
            </Field>
            <Field label="Notes">
              <textarea value={actionForm.notes} rows={2} style={{ ...inp,resize:'vertical' }}
                placeholder="Any discrepancies or observations…"
                onChange={e => setAction('notes',e.target.value)} />
            </Field>
            <div style={{ padding:'10px 14px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,fontSize:12,color:'#92400e' }}>
              After acknowledging, the feed change is marked complete. The carry-over calculation for the new feed type starts from this issuance.
            </div>
          </>)}
        </Modal>
      )}
    </AppShell>
  );
}
