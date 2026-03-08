'use client';
import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import Modal from '@/components/ui/Modal';

const COMMON_VACCINES = [
  { name:'Newcastle Disease', interval:28 }, { name:'Infectious Bronchitis', interval:21 },
  { name:"Marek's Disease", interval:0 }, { name:'Gumboro (IBD)', interval:14 },
  { name:'Fowl Pox', interval:56 }, { name:'Avian Influenza', interval:90 },
];

export default function HealthPage() {
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [completeModal, setCompleteModal] = useState(null);
  const [form, setForm] = useState({ vaccineName:'', flockId:'', scheduledDate:'', notes:'' });
  const [completeForm, setCompleteForm] = useState({ batchNumber:'', notes:'' });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('upcoming');
  const [opTab, setOpTab]         = useState('ALL'); // 'ALL' | 'LAYER' | 'BROILER'

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const res = await apiFetch('/api/health');
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  };

  const handleSchedule = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/health?action=schedule', { method:'POST', body: JSON.stringify(form) });
      if (res.ok) { setScheduleModal(false); loadData(); }
    } finally { setSaving(false); }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/health?action=complete', { method:'POST', body: JSON.stringify({ vaccinationId: completeModal.id, ...completeForm }) });
      if (res.ok) { setCompleteModal(null); loadData(); }
    } finally { setSaving(false); }
  };

  const { vaccinations=[], summary={}, flocks=[] } = data || {};
  const opFiltered = opTab === 'ALL'
    ? vaccinations
    : vaccinations.filter(v => (v.flock?.operationType || v.flock?.birdType) === opTab);

  const hasLayers   = vaccinations.some(v => (v.flock?.operationType || v.flock?.birdType) === 'LAYER');
  const hasBroilers = vaccinations.some(v => (v.flock?.operationType || v.flock?.birdType) === 'BROILER');
  const hasBoth     = hasLayers && hasBroilers;

  const tabs = {
    upcoming: opFiltered.filter(v => v.status === 'SCHEDULED'),
    overdue:  opFiltered.filter(v => v.status === 'OVERDUE'),
    done:     opFiltered.filter(v => v.status === 'COMPLETED'),
  };
  const shown = tabs[activeTab] || [];
  const STATUS_CLASS = { SCHEDULED:'status-blue', COMPLETED:'status-green', OVERDUE:'status-red', MISSED:'status-grey' };

  return (
    <AppShell>
      <div className="animate-in">

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:'var(--text-primary)', margin:0 }}>Health Management</h1>
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>Vaccinations, medications and health records</p>
          </div>
          <div style={{ flexShrink:0 }}>
            <button onClick={() => setScheduleModal(true)} className="btn btn-primary">+ Schedule Vaccination</button>
          </div>
        </div>

        {/* KPI row */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {[
            { label:'Due This Week',        value: loading?'—':summary.dueSoon||0,          color:'var(--blue)',   icon:'📅' },
            { label:'Overdue',              value: loading?'—':summary.overdue||0,           color: (summary.overdue||0)>0?'var(--red)':'var(--green)', icon:'⚠' },
            { label:'Completed This Month', value: loading?'—':summary.completedMonth||0,    color:'var(--green)',  icon:'✅' },
            { label:'Total Tracked',        value: loading?'—':vaccinations.length,          color:'var(--purple)', icon:'💉' },
          ].map(k => (
            <div key={k.label} className="card" style={{ padding:'18px 20px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)' }}>{k.label}</span>
                <span style={{ fontSize:20 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:28, fontWeight:700, color:k.color, lineHeight:1 }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Op type pill switcher */}
        {hasBoth && (
          <div style={{ display:'flex', gap:6, marginBottom:16, background:'var(--bg-elevated)', borderRadius:12, padding:4, border:'1px solid var(--border)', width:'fit-content' }}>
            {[
              { key:'ALL',     icon:'💉', label:'All',     color:'var(--purple)' },
              { key:'LAYER',   icon:'🥚', label:'Layers',   color:'#f59e0b' },
              { key:'BROILER', icon:'🍗', label:'Broilers', color:'#3b82f6' },
            ].map(t => {
              const isActive = opTab === t.key;
              return (
                <button key={t.key} onClick={() => setOpTab(t.key)}
                  style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 16px', borderRadius:9, border:'none',
                    background: isActive ? '#fff' : 'transparent',
                    boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    cursor:'pointer', fontFamily:'inherit', fontWeight: isActive ? 700 : 500,
                    fontSize:13, color: isActive ? t.color : 'var(--text-muted)', transition:'all 0.15s' }}>
                  <span style={{ fontSize:15 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Tabs — underline style (standardised) */}
        <div style={{ display:'flex', gap:0, borderBottom:'2px solid var(--border)', marginBottom:20 }}>
          {[['upcoming','📅 Upcoming'],['overdue','⚠ Overdue'],['done','✅ Completed']].map(([key,label]) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{
              background:   'transparent',
              border:       'none',
              borderBottom: activeTab===key ? '3px solid var(--purple)' : '3px solid transparent',
              marginBottom: -2,
              padding:      '10px 18px',
              fontSize:     13,
              fontWeight:   activeTab===key ? 700 : 600,
              color:        activeTab===key ? 'var(--purple)' : 'var(--text-muted)',
              cursor:       'pointer',
              fontFamily:   'inherit',
              transition:   'all 0.15s',
              display:      'flex',
              alignItems:   'center',
              gap:          6,
            }}>
              {label}
              <span style={{
                background:  activeTab===key ? 'var(--purple-light)' : 'var(--bg-elevated)',
                color:       activeTab===key ? 'var(--purple)' : 'var(--text-muted)',
                border:      `1px solid ${activeTab===key ? '#d4d8ff' : 'var(--border)'}`,
                borderRadius: 10,
                padding:     '1px 7px',
                fontSize:    10,
                fontWeight:  700,
              }}>
                {tabs[key]?.length || 0}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'3fr 1fr', gap:16 }}>

          {/* Vaccination list */}
          <div className="card">
            {shown.length === 0 ? (
              <div style={{ textAlign:'center', padding:'40px 0' }}>
                <div style={{ fontSize:40, marginBottom:10 }}>💉</div>
                <div style={{ color:'var(--text-muted)', fontSize:13 }}>No {activeTab} vaccinations</div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {shown.map(v => (
                  <div key={v.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', background:'var(--bg-elevated)', borderRadius:10, border:'1px solid var(--border)', transition:'all 0.2s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.background='var(--purple-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
                    <div style={{ width:40, height:40, borderRadius:10, background:'var(--blue-bg)', border:'1px solid var(--blue-border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>💉</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)' }}>{v.vaccineName}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>
                        {v.flock?.batchCode} · {v.flock?.birdType} · {v.flock?.penSection?.pen?.name}
                      </div>
                    </div>
                    <div style={{ textAlign:'center', flexShrink:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>{new Date(v.scheduledDate).toLocaleDateString('en-NG',{day:'numeric',month:'short'})}</div>
                      <div style={{ fontSize:10, color:'var(--text-muted)' }}>Scheduled</div>
                    </div>
                    <span className={`status-badge ${STATUS_CLASS[v.status]||'status-grey'}`}>{v.status}</span>
                    {v.status !== 'COMPLETED' && (
                      <div style={{ flexShrink:0 }}>
                        <button onClick={() => setCompleteModal(v)} className="btn btn-primary" style={{ fontSize:11, padding:'5px 12px' }}>Mark Done</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="card">
              <div className="section-header">Quick Schedule</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {COMMON_VACCINES.map(v => (
                  <button key={v.name} onClick={() => { setForm(p=>({...p, vaccineName:v.name})); setScheduleModal(true); }}
                    style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:8, padding:'9px 12px', cursor:'pointer', textAlign:'left', fontFamily:'inherit', fontSize:12, color:'var(--text-secondary)', fontWeight:600, transition:'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.color='var(--purple)'; e.currentTarget.style.background='var(--purple-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-secondary)'; e.currentTarget.style.background='var(--bg-elevated)'; }}>
                    💉 {v.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="section-header">Status Summary</div>
              {[['SCHEDULED','status-blue',summary.scheduled||0],['COMPLETED','status-green',summary.completedTotal||0],['OVERDUE','status-red',summary.overdue||0]].map(([s,cls,count]) => (
                <div key={s} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <span className={`status-badge ${cls}`}>{s}</span>
                  <span style={{ fontFamily:"'Poppins',sans-serif", fontSize:18, fontWeight:700, color:'var(--text-primary)' }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Schedule Vaccination Modal (portal) ── */}
      {scheduleModal && (
        <Modal
          title="💉 Schedule Vaccination"
          width={460}
          onClose={() => setScheduleModal(false)}
          footer={
            <>
              <button onClick={() => setScheduleModal(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleSchedule} disabled={saving || !form.vaccineName || !form.scheduledDate} className="btn btn-primary">
                {saving ? 'Saving…' : 'Schedule Vaccination'}
              </button>
            </>
          }
        >
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <label className="label">Vaccine Name</label>
              <input value={form.vaccineName} onChange={e=>setForm(p=>({...p,vaccineName:e.target.value}))} className="input" placeholder="e.g. Newcastle Disease" />
            </div>
            <div>
              <label className="label">Flock</label>
              <select value={form.flockId} onChange={e=>setForm(p=>({...p,flockId:e.target.value}))} className="input">
                <option value="">Select flock…</option>
                {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} — {f.birdType}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Scheduled Date</label>
              <input type="date" value={form.scheduledDate} onChange={e=>setForm(p=>({...p,scheduledDate:e.target.value}))} className="input" />
            </div>
            <div>
              <label className="label">Notes</label>
              <input value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} className="input" placeholder="Optional notes…" />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Mark as Completed Modal (portal) ── */}
      {completeModal && (
        <Modal
          title="✅ Mark as Completed"
          width={420}
          onClose={() => setCompleteModal(null)}
          footer={
            <>
              <button onClick={() => setCompleteModal(null)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleComplete} disabled={saving} className="btn btn-primary">
                {saving ? 'Saving…' : '✓ Confirm Done'}
              </button>
            </>
          }
        >
          <div className="alert alert-blue" style={{ marginBottom:16 }}>
            <span>💉</span>
            <span><strong>{completeModal.vaccineName}</strong> — {completeModal.flock?.batchCode}</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <label className="label">Batch / Lot Number</label>
              <input value={completeForm.batchNumber} onChange={e=>setCompleteForm(p=>({...p,batchNumber:e.target.value}))} className="input" placeholder="e.g. ND-2026-001" />
            </div>
            <div>
              <label className="label">Notes</label>
              <input value={completeForm.notes} onChange={e=>setCompleteForm(p=>({...p,notes:e.target.value}))} className="input" placeholder="Any observations…" />
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}