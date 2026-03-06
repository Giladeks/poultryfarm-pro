'use client';
import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const TYPE_COLOR = { LAYER:'#f59e0b', BROILER:'#3b82f6', BREEDER:'#8b5cf6', TURKEY:'#22c55e' };
const STATUS_CLASS = { ACTIVE:'status-green', HARVESTED:'status-grey', CULLED:'status-red', SOLD:'status-blue' };

export default function FarmPage() {
  const { apiFetch, user } = useAuth();
  const [flocks, setFlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status:'ACTIVE', birdType:'' });
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadFlocks(); }, [filter]);

  const loadFlocks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status:filter.status||'ALL', ...(filter.birdType&&{birdType:filter.birdType}) });
      const res = await apiFetch(`/api/flocks?${params}`);
      if (res.ok) { const d = await res.json(); setFlocks(d.flocks||[]); }
    } finally { setLoading(false); }
  };

  const canCreate = ['FARM_MANAGER','FARM_OWNER','SUPER_ADMIN'].includes(user?.role);
  const totalBirds = flocks.reduce((s,f) => s+f.currentCount, 0);

  return (
    <AppShell>
      <div className="animate-in">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:'var(--text-primary)', margin:0 }}>Flock Management</h1>
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>{flocks.length} active {flocks.length===1?'batch':'batches'} · {totalBirds.toLocaleString()} live birds</p>
          </div>
          {canCreate && <button onClick={() => setShowCreate(true)} className="btn btn-primary">+ New Flock Batch</button>}
        </div>

        {/* Summary */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
          {[
            { label:'Total Live Birds', value:totalBirds.toLocaleString(), color:'var(--purple)', icon:'🐦' },
            { label:'Active Batches', value:flocks.filter(f=>f.status==='ACTIVE').length, color:'var(--blue)', icon:'📋' },
            { label:'Weekly Mortality', value:flocks.reduce((s,f)=>s+(f.weeklyMortality||0),0), color:'var(--amber)', icon:'📉' },
            { label:'Layer Batches', value:flocks.filter(f=>f.birdType==='LAYER').length, color:'var(--amber)', icon:'🥚' },
          ].map(k => (
            <div key={k.label} className="card" style={{ padding:'18px 20px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', color:'var(--text-muted)' }}>{k.label}</span>
                <span style={{ fontSize:20 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:26, fontWeight:700, color:k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          {['ACTIVE','HARVESTED','ALL'].map(s => (
            <button key={s} onClick={() => setFilter(p=>({...p,status:s}))} className="btn"
              style={{ background:filter.status===s?'var(--purple-light)':'#fff', color:filter.status===s?'var(--purple)':'var(--text-muted)', border:`1px solid ${filter.status===s?'#d4d8ff':'var(--border)'}`, fontWeight:filter.status===s?700:600 }}>
              {s.charAt(0)+s.slice(1).toLowerCase()}
            </button>
          ))}
          <div style={{ width:1, background:'var(--border)' }} />
          {['','LAYER','BROILER'].map(bt => (
            <button key={bt} onClick={() => setFilter(p=>({...p,birdType:bt}))} className="btn"
              style={{ background:filter.birdType===bt?'var(--blue-bg)':'#fff', color:filter.birdType===bt?'var(--blue)':'var(--text-muted)', border:`1px solid ${filter.birdType===bt?'var(--blue-border)':'var(--border)'}`, fontWeight:filter.birdType===bt?700:600 }}>
              {bt||'All Types'}
            </button>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[1,2,3,4,5,6].map(i => <SkeletonCard key={i}/>)}
          </div>
        ) : flocks.length === 0 ? (
          <div style={{ textAlign:'center', padding:'60px 20px' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🐦</div>
            <div style={{ fontSize:15, color:'var(--text-secondary)', fontWeight:600 }}>No flocks found</div>
            {canCreate && <button onClick={() => setShowCreate(true)} className="btn btn-primary" style={{ marginTop:16 }}>+ Add First Flock</button>}
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {flocks.map(f => <FlockCard key={f.id} flock={f} onClick={setSelected}/>)}
          </div>
        )}
      </div>

      {selected && <FlockModal flock={selected} onClose={() => setSelected(null)}/>}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadFlocks(); }} apiFetch={apiFetch}/>}
    </AppShell>
  );
}

function FlockCard({ flock, onClick }) {
  const tc = TYPE_COLOR[flock.birdType]||'#9ca3af';
  const survivalPct = flock.initialCount > 0 ? (flock.currentCount/flock.initialCount)*100 : 100;
  return (
    <div className="card" onClick={() => onClick(flock)} style={{ cursor:'pointer', padding:18, transition:'all 0.2s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='var(--shadow-md)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border-card)'; e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='var(--shadow-sm)'; }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:700, color:'var(--text-primary)', fontSize:15 }}>{flock.batchCode}</div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{flock.breed}</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
          <span style={{ background:`${tc}15`, color:tc, border:`1px solid ${tc}30`, borderRadius:10, padding:'2px 9px', fontSize:10, fontWeight:700 }}>{flock.birdType}</span>
          <span className={`status-badge ${STATUS_CLASS[flock.status]||'status-grey'}`}>{flock.status}</span>
        </div>
      </div>
      <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:30, fontWeight:700, color:'var(--purple)', lineHeight:1 }}>{flock.currentCount.toLocaleString()}</div>
      <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2, marginBottom:10 }}>birds · started {flock.initialCount.toLocaleString()}</div>
      <div className="progress-bar" style={{ marginBottom:12 }}>
        <div className="progress-fill" style={{ width:`${survivalPct}%`, background:'linear-gradient(90deg,var(--purple),var(--green))' }}/>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:4, paddingTop:10, borderTop:'1px solid var(--border)' }}>
        {[
          { label:'Age', value:`${flock.ageInDays||0}d` },
          { label:'7d Deaths', value:flock.weeklyMortality||0, alert:(flock.weeklyMortality||0)>15 },
          flock.birdType==='LAYER'
            ? { label:'Lay Rate', value:flock.avgLayingRate?`${Number(flock.avgLayingRate).toFixed(0)}%`:'—', color:'var(--amber)' }
            : { label:'Harvest', value:flock.expectedHarvestDate?new Date(flock.expectedHarvestDate).toLocaleDateString('en-NG',{day:'numeric',month:'short'}):'—', color:'var(--blue)' }
        ].map((s,i) => (
          <div key={i} style={{ textAlign:'center' }}>
            <div style={{ fontSize:14, fontWeight:700, color:s.alert?'var(--red)':s.color||'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize:9, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginTop:1 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop:10, fontSize:11, color:'var(--text-muted)' }}>📍 {flock.penSection?.pen?.name} — {flock.penSection?.name}</div>
    </div>
  );
}

function FlockModal({ flock, onClose }) {
  const daysToHarvest = flock.expectedHarvestDate ? Math.max(0,Math.floor((new Date(flock.expectedHarvestDate)-new Date())/86400000)) : null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width:520, maxWidth:'95vw' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <h2 style={{ fontFamily:"'Poppins',sans-serif", fontSize:20, fontWeight:700, color:'var(--text-primary)', margin:'0 0 4px' }}>{flock.batchCode}</h2>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>{flock.breed} · {flock.birdType}</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--text-muted)' }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
          {[
            { label:'Current Birds', value:flock.currentCount.toLocaleString(), color:'var(--purple)' },
            { label:'Survival Rate', value:`${((flock.currentCount/flock.initialCount)*100).toFixed(1)}%`, color:'var(--green)' },
            { label:flock.birdType==='LAYER'?'Laying Rate':'Days to Harvest', value:flock.birdType==='LAYER'?(flock.avgLayingRate?`${Number(flock.avgLayingRate).toFixed(0)}%`:'—'):(daysToHarvest!==null?`${daysToHarvest}d`:'—'), color:'var(--amber)' },
          ].map(s => (
            <div key={s.label} style={{ background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, padding:'12px', textAlign:'center' }}>
              <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3, textTransform:'uppercase', letterSpacing:'0.06em' }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:13 }}>
          {[
            ['Pen Location',`${flock.penSection?.pen?.name} — ${flock.penSection?.name}`],
            ['Date Placed',new Date(flock.dateOfPlacement).toLocaleDateString('en-NG',{dateStyle:'medium'})],
            ['Source',flock.source?.replace('_',' ')],
            ['Purchase Cost',flock.purchaseCost?`$${Number(flock.purchaseCost).toFixed(2)}`:'—'],
          ].map(([l,v]) => (
            <div key={l} style={{ background:'var(--bg-elevated)', borderRadius:8, padding:'10px 12px' }}>
              <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{l}</div>
              <div style={{ color:'var(--text-secondary)', fontWeight:600 }}>{v||'—'}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, marginTop:20 }}>
          <button className="btn btn-outline" style={{ flex:1 }}>📋 Records</button>
          <button className="btn btn-outline" style={{ flex:1 }}>💉 Vaccine</button>
          <button onClick={onClose} className="btn btn-primary" style={{ flex:1 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreated, apiFetch }) {
  const [form, setForm] = useState({ batchCode:'', birdType:'LAYER', breed:'', penSectionId:'', dateOfPlacement:new Date().toISOString().split('T')[0], initialCount:'', source:'PURCHASED', purchaseCost:'', targetWeightG:'', expectedHarvestDate:'' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const up = (k,v) => setForm(p=>({...p,[k]:v}));

  const handleCreate = async () => {
    if (!form.batchCode||!form.breed||!form.initialCount) { setError('Please fill in all required fields.'); return; }
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/flocks', { method:'POST', body: JSON.stringify({...form, initialCount:parseInt(form.initialCount), purchaseCost:form.purchaseCost?parseFloat(form.purchaseCost):undefined }) });
      const d = await res.json();
      if (res.ok) onCreated();
      else setError(d.error||'Failed to create flock');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width:500, maxWidth:'95vw' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ fontFamily:"'Poppins',sans-serif", fontSize:18, fontWeight:700, color:'var(--text-primary)' }}>New Flock Batch</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--text-muted)' }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div style={{ gridColumn:'1 / -1' }}><label className="label">Batch Code *</label><input value={form.batchCode} onChange={e=>up('batchCode',e.target.value)} className="input" placeholder="e.g. LAY-2026-005"/></div>
          <div><label className="label">Bird Type *</label><select value={form.birdType} onChange={e=>up('birdType',e.target.value)} className="input">{['LAYER','BROILER','BREEDER','TURKEY'].map(t=><option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className="label">Breed *</label><input value={form.breed} onChange={e=>up('breed',e.target.value)} className="input" placeholder="e.g. Isa Brown"/></div>
          <div><label className="label">Date of Placement *</label><input type="date" value={form.dateOfPlacement} onChange={e=>up('dateOfPlacement',e.target.value)} className="input"/></div>
          <div><label className="label">Initial Count *</label><input type="number" value={form.initialCount} onChange={e=>up('initialCount',e.target.value)} className="input" placeholder="e.g. 2500"/></div>
          <div><label className="label">Source</label><select value={form.source} onChange={e=>up('source',e.target.value)} className="input">{['PURCHASED','OWN_HATCHERY','TRANSFERRED'].map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></div>
          <div><label className="label">Purchase Cost ($)</label><input type="number" value={form.purchaseCost} onChange={e=>up('purchaseCost',e.target.value)} className="input" placeholder="e.g. 3000"/></div>
        </div>
        {error && <div className="alert alert-red" style={{ marginTop:14 }}><span>⚠</span><span>{error}</span></div>}
        <div style={{ display:'flex', gap:8, marginTop:20 }}>
          <button onClick={onClose} className="btn btn-ghost" style={{ flex:1 }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn btn-primary" style={{ flex:2 }}>{saving?'Creating…':'+ Create Flock Batch'}</button>
        </div>
      </div>
    </div>
  );
}
function SkeletonCard() {
  return <div className="card" style={{ opacity:0.4, padding:18 }}><div style={{ height:14, background:'var(--bg-elevated)', borderRadius:4, width:'50%', marginBottom:10 }}/><div style={{ height:30, background:'var(--bg-elevated)', borderRadius:4, width:'45%', marginBottom:10 }}/><div style={{ height:6, background:'var(--bg-elevated)', borderRadius:3 }}/></div>;
}
