'use client';
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import PortalModal from '@/components/ui/Modal';

const OP_COLOR = { LAYER:'#f59e0b', BROILER:'#3b82f6', BREEDER:'#8b5cf6', TURKEY:'#22c55e' };
const OP_ICON  = { LAYER:'🥚', BROILER:'🍗', BREEDER:'🔄', TURKEY:'🦃' };
const OP_LABEL = { LAYER:'Layer', BROILER:'Broiler', BREEDER:'Breeder', TURKEY:'Turkey' };
const MANAGER_ROLES = ['FARM_ADMIN','FARM_MANAGER','CHAIRPERSON','SUPER_ADMIN'];

function occColor(pct) {
  if (pct >= 90) return '#ef4444';
  if (pct >= 70) return '#f59e0b';
  return '#22c55e';
}

function OccBar({ pct }) {
  return (
    <div style={{ height:6, background:'var(--border)', borderRadius:3, overflow:'hidden' }}>
      <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:occColor(pct), borderRadius:3, transition:'width 0.5s ease' }} />
    </div>
  );
}

function Chip({ icon, value, sub, color='var(--text-primary)', warn=false, small=false }) {
  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center',
      padding: small ? '5px 8px' : '6px 10px',
      background: warn ? '#fff5f5' : 'var(--bg-elevated)',
      borderRadius:8, border:`1px solid ${warn ? 'var(--red-border)' : 'var(--border)'}`,
      minWidth: small ? 50 : 58, flex:'1 1 0',
    }}>
      <span style={{ fontSize: small ? 13 : 15 }}>{icon}</span>
      <span style={{ fontFamily:"'Poppins',sans-serif", fontSize: small ? 12 : 13, fontWeight:700, color: warn ? 'var(--red)' : color, lineHeight:1.2 }}>{value ?? '—'}</span>
      {sub && <span style={{ fontSize:9, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.03em', marginTop:1, textAlign:'center' }}>{sub}</span>}
    </div>
  );
}

function LayerMetrics({ mx, compact=false }) {
  if (!mx) return null;
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      <Chip icon="💀" value={mx.todayMortality}             sub="Dead today"    warn={mx.todayMortality > 5}  small={compact} />
      <Chip icon="📉" value={`${mx.mortalityRate}%`}        sub="7d mort. rate" warn={mx.mortalityRate > 1}   small={compact} />
      <Chip icon="🥚" value={mx.todayEggs?.toLocaleString()} sub="Eggs today"   color="#f59e0b"                small={compact} />
      <Chip icon="⭐" value={`${mx.todayGradeAPct}%`}       sub="Grade A"       color="#16a34a"                small={compact} />
      <Chip icon="📊" value={`${mx.todayLayingRate}%`}      sub="Laying rate"   color="#16a34a"                small={compact} />
      <Chip icon="🌾" value={`${mx.avgDailyFeedKg}kg`}      sub="Feed/day"                                     small={compact} />
    </div>
  );
}

function BroilerMetrics({ mx, compact=false }) {
  if (!mx) return null;
  const fcrColor = mx.estimatedFCR
    ? mx.estimatedFCR > 2.5 ? '#ef4444' : mx.estimatedFCR > 2.0 ? '#f59e0b' : '#22c55e'
    : 'var(--text-muted)';
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      <Chip icon="💀" value={mx.todayMortality}                   sub="Dead today"    warn={mx.todayMortality > 5}  small={compact} />
      <Chip icon="📉" value={`${mx.mortalityRate}%`}              sub="7d mort. rate" warn={mx.mortalityRate > 1}   small={compact} />
      <Chip icon="⚖"  value={mx.latestWeightG ? `${mx.latestWeightG}g` : '—'} sub="Avg weight" color="#3b82f6"    small={compact} />
      <Chip icon="🔄" value={mx.estimatedFCR ?? '—'}              sub="Est. FCR"      color={fcrColor}              small={compact} />
      <Chip icon="📅" value={mx.daysToHarvest != null ? `${mx.daysToHarvest}d` : '—'} sub="To harvest" color="#8b5cf6" small={compact} />
      <Chip icon="🌾" value={`${mx.avgDailyFeedKg}kg`}            sub="Feed/day"                                    small={compact} />
    </div>
  );
}

function SectionCard({ section, penType, canManage, onEdit, onAssign }) {
  const occ   = section.occupancyPct || 0;
  const color = OP_COLOR[penType];
  const flock = section.activeFlock;
  const mx    = section.metrics;

  return (
    <div
      onClick={canManage ? onEdit : undefined}
      style={{ background:'#fff', border:'1.5px solid var(--border)', borderRadius:10, padding:14, cursor:canManage?'pointer':'default', transition:'all 0.15s' }}
      onMouseEnter={e => { if(canManage){ e.currentTarget.style.boxShadow='var(--shadow-md)'; e.currentTarget.style.borderColor=color; }}}
      onMouseLeave={e => { e.currentTarget.style.boxShadow='none'; e.currentTarget.style.borderColor='var(--border)'; }}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontWeight:800, fontSize:13 }}>{section.name}</span>
        <span className={`status-badge ${flock?'status-green':'status-grey'}`} style={{ fontSize:9 }}>
          {flock ? '● Active' : '○ Empty'}
        </span>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:4 }}>
        <div>
          <span style={{ fontFamily:"'Poppins',sans-serif", fontSize:17, fontWeight:700, color:flock?occColor(occ):'var(--text-faint)' }}>
            {(section.currentBirds||0).toLocaleString()}
          </span>
          <span style={{ fontSize:10, color:'var(--text-muted)', marginLeft:3 }}>/ {section.capacity.toLocaleString()}</span>
        </div>
        <span style={{ fontSize:11, fontWeight:700, color:occColor(occ) }}>{occ}%</span>
      </div>
      <OccBar pct={occ} />
      {flock && (
        <div style={{ marginTop:8, fontSize:11, color:'var(--text-secondary)' }}>
          <span style={{ fontWeight:700 }}>{flock.batchCode}</span>
          <span style={{ color:'var(--text-muted)' }}> · {flock.breed} · {section.ageInDays}d old</span>
        </div>
      )}
      {flock && mx && (
        <div style={{ marginTop:10 }}>
          {mx.type === 'LAYER'   && <LayerMetrics   mx={mx} compact />}
          {mx.type === 'BROILER' && <BroilerMetrics mx={mx} compact />}
        </div>
      )}
      {section.workers.length > 0 && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
          <div style={{ fontSize:9, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:4 }}>Assigned Workers</div>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {section.workers.map(w => (
              <span key={w.id} style={{ fontSize:10, background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 7px', color:'var(--text-secondary)', fontWeight:600 }}>
                {w.firstName} {w.lastName[0]}.
              </span>
            ))}
          </div>
        </div>
      )}
      {section.managers?.length > 0 && (
        <div style={{ marginTop:6 }}>
          <div style={{ fontSize:9, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', marginBottom:4 }}>Managers</div>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {section.managers.map(m => (
              <span key={m.id} style={{ fontSize:10, background:'var(--purple-light)', border:'1px solid #d4d8ff', borderRadius:4, padding:'2px 7px', color:'var(--purple)', fontWeight:600 }}>
                {m.firstName} {m.lastName[0]}.
              </span>
            ))}
          </div>
        </div>
      )}
      {canManage && onAssign && (
        <div style={{ marginTop:10 }}>
          <button
            onClick={e => { e.stopPropagation(); onAssign(section); }}
            className="btn btn-ghost"
            style={{ width:'100%', fontSize:11, padding:'6px', justifyContent:'center' }}>
            👷 Assign Workers
          </button>
        </div>
      )}
    </div>
  );
}

function PenSummaryMetrics({ pen }) {
  const totBirds = pen.sections.reduce((s, sec) => s + (sec.currentBirds || 0), 0);
  const totCap   = pen.sections.reduce((s, sec) => s + (sec.capacity || 0), 0);
  const occ      = totCap > 0 ? parseFloat(((totBirds / totCap) * 100).toFixed(1)) : 0;
  const color    = OP_COLOR[pen.operationType];
  return (
    <div style={{ display:'flex', alignItems:'center', gap:14 }}>
      <span style={{ fontFamily:"'Poppins',sans-serif", fontSize:15, fontWeight:700, color }}>
        {totBirds.toLocaleString()}
      </span>
      <span style={{ fontSize:11, color:'var(--text-muted)' }}>/ {totCap.toLocaleString()} · {occ}% full</span>
    </div>
  );
}

function PenCard({ pen, canManage, onEditPen, onEditSection, onAddSection, onAssignWorkers, onAssignPenManager }) {
  const [expanded, setExpanded] = useState(false);
  const color = OP_COLOR[pen.operationType];
  return (
    <div style={{ background:'#fff', border:'1.5px solid var(--border)', borderRadius:12, marginBottom:16, overflow:'hidden' }}>
      <div
        onClick={() => setExpanded(p => !p)}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', cursor:'pointer', background:`${color}06`, borderBottom: expanded ? '1px solid var(--border)' : 'none' }}
      >
        {/* Left: icon + name + subtitle */}
        <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
          <div style={{ width:36, height:36, borderRadius:9, background:`${color}15`, border:`1px solid ${color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0 }}>
            {OP_ICON[pen.operationType]}
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:14, whiteSpace:'nowrap' }}>{pen.name}</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>
              {pen.sectionCount} section{pen.sectionCount !== 1 ? 's' : ''} · {pen.operationType}
            </div>
          </div>
        </div>
        {/* Right: summary metrics + edit button + chevron */}
        {(() => {
          const totBirds = pen.sections.reduce((s, sec) => s + (sec.currentBirds || 0), 0);
          const totCap   = pen.sections.reduce((s, sec) => s + (sec.capacity || 0), 0);
          const occ      = totCap > 0 ? parseFloat(((totBirds / totCap) * 100).toFixed(1)) : 0;
          return (
            <div style={{ display:'flex', alignItems:'center', gap:16, flexShrink:0 }}>
              {[
                { val: totBirds.toLocaleString(), lbl: 'Live Birds',  color: OP_COLOR[pen.operationType] },
                { val: `${occ}%`,                  lbl: 'Occupied',   color: occColor(occ) },
                { val: totCap.toLocaleString(),    lbl: 'Capacity',   color: 'var(--text-primary)' },
              ].map(s => (
                <div key={s.lbl} style={{ textAlign:'center' }}>
                  <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:14, fontWeight:700, color:s.color, lineHeight:1, whiteSpace:'nowrap' }}>{s.val}</div>
                  <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2, whiteSpace:'nowrap' }}>{s.lbl}</div>
                </div>
              ))}
              {canManage && (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <button className="btn btn-ghost" style={{ padding:'4px 8px', fontSize:11 }}
                    onClick={e => { e.stopPropagation(); onEditPen(pen); }}>✏️</button>
                  <button className="btn btn-ghost" style={{ padding:'4px 10px', fontSize:11, display:'inline-flex', alignItems:'center', gap:5 }}
                    onClick={e => { e.stopPropagation(); onAssignPenManager(pen); }}>
                    👷 Pen Manager
                  </button>
                </div>
              )}
              <span style={{ color:'var(--text-faint)', fontSize:14, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition:'transform 0.2s' }}>›</span>
            </div>
          );
        })()}
      </div>
      {expanded && (
        <div style={{ padding:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(210px, 1fr))', gap:10 }}>
            {pen.sections.map(sec => (
              <SectionCard key={sec.id} section={sec} penType={pen.operationType} canManage={canManage}
                onEdit={() => onEditSection(sec, pen)}
                onAssign={onAssignWorkers ? () => onAssignWorkers(sec) : undefined} />
            ))}
            {canManage && (
              <div onClick={() => onAddSection(pen)}
                style={{ border:'2px dashed var(--border)', borderRadius:10, padding:14, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--text-faint)', minHeight:120, fontSize:12, fontWeight:600, gap:6, transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; e.currentTarget.style.color='var(--purple)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text-faint)'; }}>
                <span style={{ fontSize:22 }}>+</span>Add Section
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ManagerKPIBar({ farms }) {
  const t = farms.reduce((acc, farm) => ({
    birds:        acc.birds        + farm.totalBirds,
    capacity:     acc.capacity     + farm.totalCapacity,
    layerBirds:   acc.layerBirds   + farm.layerBirds,
    broilerBirds: acc.broilerBirds + farm.broilerBirds,
    todayDead:    acc.todayDead    + farm.metrics.todayMortality,
    todayEggs:    acc.todayEggs    + farm.metrics.todayEggs,
    weekFeed:     acc.weekFeed     + farm.metrics.weekFeedKg,
  }), { birds:0, capacity:0, layerBirds:0, broilerBirds:0, todayDead:0, todayEggs:0, weekFeed:0 });
  const occ = t.capacity > 0 ? parseFloat(((t.birds / t.capacity) * 100).toFixed(1)) : 0;
  const kpis = [
    { icon:'🐦', val:t.birds.toLocaleString(),       lbl:'Total Birds',    color:'var(--purple)' },
    { icon:'📦', val:t.capacity.toLocaleString(),     lbl:'Total Capacity', color:'var(--blue)'   },
    { icon:'📊', val:`${occ}%`,                       lbl:'Occupancy',      color:occColor(occ)   },
    { icon:'🥚', val:t.layerBirds.toLocaleString(),   lbl:'Layer Birds',    color:'#f59e0b'       },
    { icon:'🍗', val:t.broilerBirds.toLocaleString(), lbl:'Broiler Birds',  color:'#3b82f6'       },
    { icon:'🧺', val:t.todayEggs.toLocaleString(),    lbl:'Eggs Today',     color:'#16a34a'       },
    { icon:'💀', val:t.todayDead,                     lbl:'Dead Today',     color:t.todayDead>20?'var(--red)':'var(--text-primary)' },
  ];
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:10, marginBottom:22 }}>
      {kpis.map(k => (
        <div key={k.lbl} className="card" style={{ padding:'12px 14px', textAlign:'center' }}>
          <div style={{ fontSize:18, marginBottom:4 }}>{k.icon}</div>
          <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:17, fontWeight:700, color:k.color }}>{k.val}</div>
          <div style={{ fontSize:9, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', marginTop:2 }}>{k.lbl}</div>
        </div>
      ))}
    </div>
  );
}

function WorkerKPIBar({ farms, allowedOpTypes }) {
  const isLayerOnly   = allowedOpTypes?.includes('LAYER')   && !allowedOpTypes?.includes('BROILER');
  const isBroilerOnly = allowedOpTypes?.includes('BROILER') && !allowedOpTypes?.includes('LAYER');
  const allSections   = farms.flatMap(f => f.pens.flatMap(p => p.sections));

  if (isLayerOnly) {
    const totalBirds = allSections.reduce((s, sec) => s + sec.currentBirds, 0);
    const todayEggs  = allSections.reduce((s, sec) => s + (sec.metrics?.todayEggs || 0), 0);
    const todayDead  = allSections.reduce((s, sec) => s + (sec.metrics?.todayMortality || 0), 0);
    const rates      = allSections.filter(sec => sec.metrics?.todayLayingRate > 0);
    const avgRate    = rates.length > 0 ? parseFloat((rates.reduce((s, sec) => s + (sec.metrics?.todayLayingRate || 0), 0) / rates.length).toFixed(1)) : 0;
    const gradeAs    = allSections.filter(sec => sec.metrics?.todayGradeAPct > 0);
    const avgGradeA  = gradeAs.length > 0 ? parseFloat((gradeAs.reduce((s, sec) => s + (sec.metrics?.todayGradeAPct || 0), 0) / gradeAs.length).toFixed(1)) : 0;
    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:22 }}>
        {[
          { icon:'🥚', val:todayEggs.toLocaleString(),  lbl:'Eggs Today',     color:'#f59e0b' },
          { icon:'📊', val:`${avgRate}%`,               lbl:'Avg Laying Rate', color:'#16a34a' },
          { icon:'⭐', val:`${avgGradeA}%`,             lbl:'Avg Grade A',    color:'#16a34a' },
          { icon:'🐦', val:totalBirds.toLocaleString(), lbl:'Live Birds',     color:'var(--purple)' },
          { icon:'💀', val:todayDead,                   lbl:'Dead Today',     color:todayDead>10?'var(--red)':'var(--text-primary)' },
        ].map(k => (
          <div key={k.lbl} className="card" style={{ padding:'14px 16px', textAlign:'center' }}>
            <div style={{ fontSize:20, marginBottom:6 }}>{k.icon}</div>
            <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:20, fontWeight:700, color:k.color }}>{k.val}</div>
            <div style={{ fontSize:9, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', marginTop:2 }}>{k.lbl}</div>
          </div>
        ))}
      </div>
    );
  }

  if (isBroilerOnly) {
    const totalBirds = allSections.reduce((s, sec) => s + sec.currentBirds, 0);
    const todayDead  = allSections.reduce((s, sec) => s + (sec.metrics?.todayMortality || 0), 0);
    const weights    = allSections.filter(sec => sec.metrics?.latestWeightG);
    const avgWeight  = weights.length > 0 ? parseFloat((weights.reduce((s, sec) => s + (sec.metrics?.latestWeightG || 0), 0) / weights.length).toFixed(0)) : null;
    const fcrs       = allSections.filter(sec => sec.metrics?.estimatedFCR);
    const avgFCR     = fcrs.length > 0 ? parseFloat((fcrs.reduce((s, sec) => s + (sec.metrics?.estimatedFCR || 0), 0) / fcrs.length).toFixed(2)) : null;
    const harvests   = allSections.filter(sec => sec.metrics?.daysToHarvest != null);
    const minHarvest = harvests.length > 0 ? Math.min(...harvests.map(sec => sec.metrics.daysToHarvest)) : null;
    const fcrColor   = avgFCR ? (avgFCR > 2.5 ? '#ef4444' : avgFCR > 2.0 ? '#f59e0b' : '#22c55e') : 'var(--text-muted)';
    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:22 }}>
        {[
          { icon:'🐦', val:totalBirds.toLocaleString(),        lbl:'Live Birds',       color:'var(--purple)' },
          { icon:'⚖',  val:avgWeight ? `${avgWeight}g` : '—', lbl:'Avg Weight',       color:'#3b82f6' },
          { icon:'🔄', val:avgFCR ?? '—',                      lbl:'Est. Avg FCR',     color:fcrColor },
          { icon:'📅', val:minHarvest != null ? `${minHarvest}d` : '—', lbl:'Nearest Harvest', color:'#8b5cf6' },
          { icon:'💀', val:todayDead,                           lbl:'Dead Today',       color:todayDead>10?'var(--red)':'var(--text-primary)' },
        ].map(k => (
          <div key={k.lbl} className="card" style={{ padding:'14px 16px', textAlign:'center' }}>
            <div style={{ fontSize:20, marginBottom:6 }}>{k.icon}</div>
            <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:20, fontWeight:700, color:k.color }}>{k.val}</div>
            <div style={{ fontSize:9, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', marginTop:2 }}>{k.lbl}</div>
          </div>
        ))}
      </div>
    );
  }

  return null; // Mixed pen managers
}

// ── Shared form helpers ───────────────────────────────────────────────────────
const F  = ({ label, children }) => <div><label className="label">{label}</label>{children}</div>;
const G2 = ({ children })        => <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>{children}</div>;

// ── Farm modal ────────────────────────────────────────────────────────────────
function FarmModal({ mode, farm, managers, onClose, onSave }) {
  const [f, setF]       = useState({ name:farm?.name||'', location:farm?.location||'', address:farm?.address||'', phone:farm?.phone||'', email:farm?.email||'', managerId:farm?.managerId||'' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const up = (k, v) => setF(p => ({ ...p, [k]:v }));

  async function save() {
    if (!f.name.trim()) return setError('Farm name required');
    setSaving(true); setError('');
    try {
      const body = mode === 'edit' ? { id:farm.id, ...f } : f;
      const res  = await fetch('/api/farm-structure?type=farm', { method: mode==='edit' ? 'PATCH':'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(body) });
      const d    = await res.json();
      if (!res.ok) return setError(d.error || 'Failed');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <PortalModal
      title={mode === 'create' ? '🏡 Add Farm' : '✏️ Edit Farm'}
      subtitle={mode === 'edit' ? `Editing ${farm.name}` : undefined}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : mode==='create' ? 'Create Farm' : 'Save'}</button>
        </>
      }
    >
      {error && <div className="alert alert-red" style={{ marginBottom:14 }}>⚠ {error}</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <F label="Farm Name *"><input className="input" value={f.name} onChange={e=>up('name',e.target.value)} placeholder="Green Acres Main Farm"/></F>
        <G2>
          <F label="Location"><input className="input" value={f.location} onChange={e=>up('location',e.target.value)} placeholder="Ogun State"/></F>
          <F label="Phone"><input className="input" value={f.phone} onChange={e=>up('phone',e.target.value)} placeholder="+234 801 000 0000"/></F>
        </G2>
        <F label="Full Address"><input className="input" value={f.address} onChange={e=>up('address',e.target.value)} placeholder="12 Farm Road, Ogun State"/></F>
        <F label="Farm Email"><input className="input" type="email" value={f.email} onChange={e=>up('email',e.target.value)} placeholder="farm@greenacres.ng"/></F>
        <F label="Farm Manager">
          <select className="input" value={f.managerId} onChange={e=>up('managerId',e.target.value)}>
            <option value="">— No manager assigned —</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.role.replace('_',' ')})</option>)}
          </select>
        </F>
      </div>
    </PortalModal>
  );
}

// ── Pen modal ─────────────────────────────────────────────────────────────────
function PenModal({ mode, pen, farmId, farmName, onClose, onSave }) {
  const [f, setF]       = useState({ name:pen?.name||'', operationType:pen?.operationType||'LAYER', capacity:pen?.totalCapacity||pen?.capacity||'', location:pen?.location||'', buildYear:pen?.buildYear||'' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const up = (k, v) => setF(p => ({ ...p, [k]:v }));

  async function save() {
    if (!f.name.trim() || !f.capacity) return setError('Name and capacity required');
    setSaving(true); setError('');
    try {
      const body = mode === 'edit' ? { id:pen.id, name:f.name, capacity:f.capacity, location:f.location, buildYear:f.buildYear } : { farmId, ...f };
      const res  = await fetch('/api/farm-structure?type=pen', { method: mode==='edit' ? 'PATCH':'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(body) });
      const d    = await res.json();
      if (!res.ok) return setError(d.error || 'Failed');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <PortalModal
      title={mode === 'create' ? '🏗 Add Pen' : '✏️ Edit Pen'}
      subtitle={`${mode === 'create' ? 'Adding to' : 'In'} ${farmName}`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : mode==='create' ? 'Create Pen' : 'Save'}</button>
        </>
      }
    >
      {error && <div className="alert alert-red" style={{ marginBottom:14 }}>⚠ {error}</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <F label="Pen Name *"><input className="input" value={f.name} onChange={e=>up('name',e.target.value)} placeholder="Pen A — Layers"/></F>
        <G2>
          <F label="Operation Type *">
            <select className="input" value={f.operationType} onChange={e=>up('operationType',e.target.value)} disabled={mode==='edit'}>
              <option value="LAYER">🥚 Layer</option>
              <option value="BROILER">🍗 Broiler</option>
              <option value="BREEDER">🔄 Breeder</option>
              <option value="TURKEY">🦃 Turkey</option>
            </select>
            {mode === 'edit' && <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:3 }}>Cannot change with active flocks</div>}
          </F>
          <F label="Capacity *"><input className="input" type="number" value={f.capacity} onChange={e=>up('capacity',e.target.value)} placeholder="10000" min="1"/></F>
        </G2>
        <G2>
          <F label="Location"><input className="input" value={f.location} onChange={e=>up('location',e.target.value)} placeholder="Block A"/></F>
          <F label="Year Built"><input className="input" type="number" value={f.buildYear} onChange={e=>up('buildYear',e.target.value)} placeholder="2023"/></F>
        </G2>
      </div>
    </PortalModal>
  );
}

// ── Section modal ─────────────────────────────────────────────────────────────
function SectionModal({ mode, section, pen, onClose, onSave }) {
  const [f, setF]       = useState({ name:section?.name||'', capacity:section?.capacity||'' });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const up    = (k, v) => setF(p => ({ ...p, [k]:v }));
  const color = OP_COLOR[pen.operationType];

  async function save() {
    if (!f.name.trim() || !f.capacity) return setError('Name and capacity required');
    setSaving(true); setError('');
    try {
      const body = mode === 'edit' ? { id:section.id, name:f.name, capacity:f.capacity } : { penId:pen.id, name:f.name, capacity:f.capacity };
      const res  = await fetch('/api/farm-structure?type=section', { method: mode==='edit' ? 'PATCH':'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify(body) });
      const d    = await res.json();
      if (!res.ok) return setError(d.error || 'Failed');
      onSave();
    } finally { setSaving(false); }
  }

  return (
    <PortalModal
      title={mode === 'create' ? '➕ Add Section' : '✏️ Edit Section'}
      subtitle={`${pen.name} — ${OP_LABEL[pen.operationType]}`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : mode==='create' ? 'Add Section' : 'Save'}</button>
        </>
      }
    >
      {error && <div className="alert alert-red" style={{ marginBottom:14 }}>⚠ {error}</div>}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {mode === 'edit' && section?.activeFlock && (
          <div className="alert alert-amber">⚠ Active flock: {section.activeFlock.batchCode} · {section.currentBirds?.toLocaleString()} birds</div>
        )}
        <F label="Section Name *"><input className="input" value={f.name} onChange={e=>up('name',e.target.value)} placeholder="Section A"/></F>
        <F label="Capacity (birds) *">
          <input className="input" type="number" value={f.capacity} onChange={e=>up('capacity',e.target.value)} placeholder="2500" min="1"/>
          {mode === 'edit' && f.capacity && parseInt(f.capacity) < (section?.currentBirds || 0) && (
            <div style={{ fontSize:11, color:'var(--red)', marginTop:4 }}>⚠ Below current bird count ({section.currentBirds?.toLocaleString()})</div>
          )}
        </F>
        <div style={{ padding:12, background:`${color}08`, borderRadius:8, border:`1px solid ${color}20`, fontSize:12, color:'var(--text-secondary)' }}>
          <strong>Pen type:</strong> {OP_ICON[pen.operationType]} {OP_LABEL[pen.operationType]} — sections inherit this type
        </div>
      </div>
    </PortalModal>
  );
}


// ── Assign Workers Modal ──────────────────────────────────────────────────────
function AssignWorkersModal({ section, onClose, onSave, apiFetch }) {
  const [allUsers,  setAllUsers]  = useState([]);
  const [selected,  setSelected]  = useState(new Set());
  const [saving,    setSaving]    = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/users?status=active');
        if (!res.ok) return;
        const d = await res.json();
        const workers = (d.users || []).filter(u =>
          ['PEN_WORKER','PEN_MANAGER'].includes(u.role)
        );
        setAllUsers(workers);
        // Pre-tick currently assigned
        const current = new Set([
          ...(section.workers  || []).map(w => w.id),
          ...(section.managers || []).map(m => m.id),
        ]);
        setSelected(current);
      } finally { setLoading(false); }
    })();
  }, []);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  async function save() {
    setSaving(true); setError('');
    try {
      // For each affected user rebuild their full section list
      const affected = allUsers.filter(u =>
        selected.has(u.id) || (section.workers || []).some(w => w.id === u.id) || (section.managers || []).some(m => m.id === u.id)
      );
      await Promise.all(affected.map(async (u) => {
        const current = (u.penAssignments || []).map(a => a.penSection?.id).filter(Boolean);
        let next;
        if (selected.has(u.id)) {
          next = [...new Set([...current, section.id])];
        } else {
          next = current.filter(id => id !== section.id);
        }
        await apiFetch('/api/users', {
          method: 'PATCH',
          body: JSON.stringify({ userId: u.id, penSectionIds: next }),
        });
      }));
      onSave();
    } catch(e) {
      setError('Failed to save assignments');
    } finally { setSaving(false); }
  }

  const grouped = { PEN_MANAGER: [], PEN_WORKER: [] };
  allUsers.forEach(u => { if (grouped[u.role]) grouped[u.role].push(u); });

  return (
    <PortalModal
      title="👷 Assign Workers"
      subtitle={`${section.name} — select workers to assign`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Assignments'}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-red" style={{ marginBottom:12 }}>⚠ {error}</div>}
      {loading ? (
        <div style={{ height:120, background:'var(--bg-elevated)', borderRadius:8, animation:'pulse 1.5s infinite' }} />
      ) : allUsers.length === 0 ? (
        <div style={{ textAlign:'center', padding:'20px', color:'var(--text-muted)', fontSize:13 }}>
          No pen workers or managers found. Add staff in User Admin first.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {[['PEN_MANAGER','Pen Managers','var(--purple)'],['PEN_WORKER','Pen Workers','var(--blue)']].map(([role, label, color]) =>
            grouped[role].length > 0 && (
              <div key={role}>
                <div style={{ fontSize:10, fontWeight:700, color, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{label}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {grouped[role].map(u => (
                    <label key={u.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', background: selected.has(u.id) ? 'var(--purple-light)' : 'var(--bg-elevated)', border:`1px solid ${selected.has(u.id) ? '#d4d8ff' : 'var(--border)'}`, borderRadius:8, cursor:'pointer', transition:'all 0.15s' }}>
                      <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} style={{ width:15, height:15, accentColor:'var(--purple)', flexShrink:0 }} />
                      <div style={{ width:30, height:30, borderRadius:'50%', background:`${color}15`, border:`1.5px solid ${color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color, flexShrink:0 }}>
                        {u.firstName[0]}{u.lastName[0]}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{u.firstName} {u.lastName}</div>
                        <div style={{ fontSize:11, color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{u.email}</div>
                      </div>
                      <div style={{ fontSize:10, color:'var(--text-muted)', textAlign:'right', flexShrink:0 }}>
                        {(u.penAssignments?.length || 0)} section{(u.penAssignments?.length || 0) !== 1 ? 's' : ''}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </PortalModal>
  );
}

// ── Assign Pen Manager Modal ──────────────────────────────────────────────────
// Assigns a single PEN_MANAGER to ALL sections of a pen at once.
// Workers already in those sections remain untouched — they automatically
// report to the pen manager because they share the same sections.
function AssignPenManagerModal({ pen, apiFetch, onClose, onSave }) {
  const [penManagers, setPenManagers] = useState([]);
  const [selectedId,  setSelectedId]  = useState('');
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  // Current managers already assigned to any section of this pen
  const currentManagerIds = [...new Set(
    pen.sections.flatMap(s => (s.managers || []).map(m => m.id))
  )];

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/users?role=PEN_MANAGER&status=active');
        if (res.ok) {
          const d = await res.json();
          setPenManagers(d.users || []);
          // Pre-select if only one manager is currently assigned to this pen
          if (currentManagerIds.length === 1) setSelectedId(currentManagerIds[0]);
        }
      } finally { setLoading(false); }
    })();
  }, []);

  async function handleSave() {
    if (!selectedId && !window.confirm('Remove all pen managers from this pen?')) return;
    setSaving(true); setError('');
    try {
      const sectionIds = pen.sections.map(s => s.id);

      // For the newly selected manager: add all this pen's sections to their assignments
      // For previously assigned managers who are NOT the new one: remove this pen's sections
      const affected = penManagers.filter(pm =>
        selectedId === pm.id || currentManagerIds.includes(pm.id)
      );

      await Promise.all(affected.map(async (pm) => {
        // Get full current assignments for this user
        const res = await apiFetch(`/api/users?role=PEN_MANAGER&status=active`);
        const d   = await res.json();
        const full = (d.users || []).find(u => u.id === pm.id);
        const existingSections = (full?.penAssignments || []).map(a => a.penSection?.id).filter(Boolean);

        let newSections;
        if (pm.id === selectedId) {
          // Add all pen sections (keep any other sections they already have)
          newSections = [...new Set([...existingSections, ...sectionIds])];
        } else {
          // Remove this pen's sections (they're being unassigned from this pen)
          newSections = existingSections.filter(id => !sectionIds.includes(id));
        }

        await apiFetch('/api/users', {
          method: 'PATCH',
          body: JSON.stringify({ userId: pm.id, penSectionIds: newSections }),
        });
      }));

      onSave();
    } catch {
      setError('Failed to save pen manager assignment');
    } finally { setSaving(false); }
  }

  const color = { LAYER:'#f59e0b', BROILER:'#3b82f6', BREEDER:'#8b5cf6', TURKEY:'#22c55e' }[pen.operationType] || 'var(--purple)';

  return (
    <PortalModal
      title="👷 Assign Pen Manager"
      subtitle={`${pen.name} — ${pen.sections.length} section${pen.sections.length !== 1 ? 's' : ''}`}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save Assignment'}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-red" style={{ marginBottom:12 }}>⚠ {error}</div>}

      <div style={{ padding:'10px 14px', background:`${color}08`, border:`1px solid ${color}20`, borderRadius:8, marginBottom:16, fontSize:12, color:'var(--text-secondary)' }}>
        <strong>How this works:</strong> The selected pen manager will be assigned to <strong>all {pen.sections.length} sections</strong> of this pen. Workers in those sections will automatically report to them. Removing a pen manager unassigns them from all sections of this pen.
      </div>

      {loading ? (
        <div style={{ height:80, background:'var(--bg-elevated)', borderRadius:8 }} />
      ) : penManagers.length === 0 ? (
        <div style={{ textAlign:'center', padding:'20px', color:'var(--text-muted)', fontSize:13 }}>
          No pen managers found. Add pen managers in User Admin first.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {/* "None" option */}
          <label style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background: selectedId === '' ? '#fff5f5' : 'var(--bg-elevated)', border:`1px solid ${selectedId === '' ? '#fca5a5' : 'var(--border)'}`, borderRadius:8, cursor:'pointer', transition:'all 0.15s' }}>
            <input type="radio" name="penManager" value="" checked={selectedId === ''} onChange={() => setSelectedId('')} style={{ accentColor:'var(--purple)', flexShrink:0 }} />
            <span style={{ fontSize:13, fontWeight:600, color:'var(--text-muted)' }}>— No manager assigned —</span>
          </label>

          {penManagers.map(pm => {
            const isCurrent = currentManagerIds.includes(pm.id);
            const sectionCount = (pm.penAssignments || []).length;
            return (
              <label key={pm.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background: selectedId === pm.id ? 'var(--purple-light)' : 'var(--bg-elevated)', border:`1px solid ${selectedId === pm.id ? '#d4d8ff' : 'var(--border)'}`, borderRadius:8, cursor:'pointer', transition:'all 0.15s' }}>
                <input type="radio" name="penManager" value={pm.id} checked={selectedId === pm.id} onChange={() => setSelectedId(pm.id)} style={{ accentColor:'var(--purple)', flexShrink:0 }} />
                <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--purple-light)', border:'1.5px solid #d4d8ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'var(--purple)', flexShrink:0 }}>
                  {pm.firstName[0]}{pm.lastName[0]}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700 }}>{pm.firstName} {pm.lastName}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>{pm.email}</div>
                </div>
                <div style={{ fontSize:10, textAlign:'right', flexShrink:0 }}>
                  {isCurrent && <div style={{ color:'var(--purple)', fontWeight:700, marginBottom:2 }}>● Current</div>}
                  <div style={{ color:'var(--text-muted)' }}>{sectionCount} section{sectionCount !== 1 ? 's' : ''}</div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </PortalModal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FarmStructurePage() {
  const { user, apiFetch } = useAuth();
  const [farms,    setFarms]    = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);
  const [toast,    setToast]    = useState(null);

  const isManager  = MANAGER_ROLES.includes(user?.role);
  const canManage  = isManager;

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fsRes, mgRes] = await Promise.all([
        apiFetch('/api/farm-structure'),
        isManager ? apiFetch('/api/users?role=FARM_MANAGER&status=active') : Promise.resolve(null),
      ]);
      if (fsRes.ok) { const d = await fsRes.json(); setFarms(d.farms || []); }
      if (mgRes?.ok) { const d = await mgRes.json(); setManagers(d.users || []); }
    } finally { setLoading(false); }
  }, [apiFetch, isManager]);

  useEffect(() => { load(); }, [load]);

  const allowedOpTypes = !isManager
    ? [...new Set(farms.flatMap(f => f.pens.flatMap(p => p.sections.filter(s => s.workers?.some(w => w.id === user?.sub)).map(() => p.operationType))))]
    : null;

  const totalPens     = farms.reduce((s, f) => s + f.penCount, 0);
  const totalSections = farms.reduce((s, f) => s + f.pens.reduce((ps, p) => ps + p.sectionCount, 0), 0);

  function handleSave(msg) { setModal(null); load(); showToast(msg); }

  const subtitle = isManager
    ? `${farms.length} farm${farms.length !== 1 ? 's' : ''} · ${totalPens} pens · ${totalSections} sections — full view`
    : allowedOpTypes
      ? `Your ${allowedOpTypes.map(t => OP_LABEL[t]).join(' & ')} sections`
      : 'Your assigned sections';

  return (
    <AppShell>
      <div className="animate-in">

        {/* Toast */}
        {toast && (
          <div style={{ position:'fixed', top:20, right:24, zIndex:999, padding:'12px 20px', borderRadius:10, fontSize:13, fontWeight:600, background:toast.type==='error'?'var(--red-bg)':'var(--green-bg)', color:toast.type==='error'?'var(--red)':'#16a34a', border:`1px solid ${toast.type==='error'?'var(--red-border)':'var(--green-border)'}`, boxShadow:'var(--shadow-md)', animation:'fadeInUp 0.2s ease' }}>
            {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, margin:0 }}>
              {isManager ? '🏡 Farm Structure' : `${allowedOpTypes?.map(t => OP_ICON[t]).join('') || '🏡'} My Sections`}
            </h1>
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>{subtitle}</p>
          </div>
          {canManage && (
            <div style={{ flexShrink:0 }}>
              <button className="btn btn-primary" onClick={() => setModal({ type:'farm', mode:'create' })}>+ Add Farm</button>
            </div>
          )}
        </div>

        {/* KPI bar */}
        {!loading && farms.length > 0 && (
          isManager
            ? <ManagerKPIBar farms={farms} />
            : <WorkerKPIBar  farms={farms} allowedOpTypes={allowedOpTypes} />
        )}

        {/* Farms */}
        {loading ? (
          <div className="card" style={{ textAlign:'center', padding:60, color:'var(--text-muted)' }}>Loading…</div>
        ) : farms.length === 0 ? (
          <div className="card" style={{ textAlign:'center', padding:60 }}>
            <div style={{ fontSize:48, marginBottom:12 }}>🏡</div>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:8 }}>No sections assigned</div>
            <div style={{ color:'var(--text-muted)', fontSize:13 }}>Contact your manager to get assigned to a section.</div>
          </div>
        ) : farms.map(farm => (
          <div key={farm.id} style={{ marginBottom:32 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, paddingBottom:12, borderBottom:'2px solid var(--border)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                <div style={{ width:40, height:40, borderRadius:10, background:'var(--purple-light)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>🏡</div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <h2 style={{ fontFamily:"'Poppins',sans-serif", fontSize:15, fontWeight:700, margin:0 }}>{farm.name}</h2>
                    {isManager && farm.managerId && (() => {
                      const mgr = managers.find(m => m.id === farm.managerId);
                      return mgr ? <span style={{ fontSize:10, background:'var(--purple-light)', color:'var(--purple)', border:'1px solid #d4d8ff', borderRadius:20, padding:'2px 10px', fontWeight:700 }}>👤 {mgr.firstName} {mgr.lastName}</span> : null;
                    })()}
                  </div>
                  {farm.location && <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>📍 {farm.location}</div>}
                </div>
              </div>
              {isManager && (
                <div style={{ display:'flex', alignItems:'center', gap:20 }}>
                  <div style={{ display:'flex', gap:16, fontSize:12 }}>
                    {[
                      { val:farm.totalBirds.toLocaleString(),         lbl:'Live Birds',  color:'var(--purple)' },
                      { val:`${farm.occupancyPct}%`,                   lbl:'Occupied',    color:occColor(farm.occupancyPct) },
                      { val:farm.metrics.todayMortality,              lbl:'Dead Today',  color:farm.metrics.todayMortality>20?'var(--red)':'var(--text-primary)' },
                      { val:farm.metrics.todayEggs?.toLocaleString(), lbl:'Eggs Today',  color:'#f59e0b' },
                      { val:`${farm.metrics.weekFeedKg}kg`,           lbl:'Feed 7d',     color:'var(--blue)' },
                    ].map(s => (
                      <div key={s.lbl} style={{ textAlign:'center' }}>
                        <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:14, fontWeight:700, color:s.color }}>{s.val}</div>
                        <div style={{ color:'var(--text-muted)', fontSize:10 }}>{s.lbl}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="btn btn-ghost" style={{ fontSize:11 }} onClick={() => setModal({ type:'farm', mode:'edit', target:farm })}>✏️ Edit</button>
                    <button className="btn btn-outline" style={{ fontSize:11 }} onClick={() => setModal({ type:'pen', mode:'create', context:{ farmId:farm.id, farmName:farm.name } })}>+ Add Pen</button>
                  </div>
                </div>
              )}
            </div>

            {farm.pens.map(pen => (
              <PenCard key={pen.id} pen={pen} canManage={canManage}
                onEditPen={p    => setModal({ type:'pen',     mode:'edit',   target:p,   context:{ farmName:farm.name } })}
                onEditSection={(sec, p) => setModal({ type:'section', mode:'edit',   target:sec, context:{ pen:p } })}
                onAddSection={p => setModal({ type:'section', mode:'create',          context:{ pen:p } })}
                onAssignWorkers={sec => setModal({ type:'assign', target:sec })}
                onAssignPenManager={pen => setModal({ type:'assignPenManager', target:pen })}
              />
            ))}
          </div>
        ))}
      </div>

      {/* ── Portal modals ── */}
      {modal?.type === 'farm'    && <FarmModal    mode={modal.mode} farm={modal.target}    managers={managers} onClose={() => setModal(null)} onSave={() => handleSave(modal.mode==='create' ? 'Farm created' : 'Farm updated')} />}
      {modal?.type === 'pen'     && <PenModal     mode={modal.mode} pen={modal.target}     farmId={modal.context?.farmId} farmName={modal.context?.farmName} onClose={() => setModal(null)} onSave={() => handleSave(modal.mode==='create' ? 'Pen created' : 'Pen updated')} />}
      {modal?.type === 'section' && <SectionModal mode={modal.mode} section={modal.target} pen={modal.context?.pen} onClose={() => setModal(null)} onSave={() => handleSave(modal.mode==='create' ? 'Section added' : 'Section updated')} />}
      {modal?.type === 'assign'           && <AssignWorkersModal    section={modal.target} apiFetch={apiFetch} onClose={() => setModal(null)} onSave={() => handleSave('Worker assignments updated')} />}
      {modal?.type === 'assignPenManager' && <AssignPenManagerModal pen={modal.target}     apiFetch={apiFetch} onClose={() => setModal(null)} onSave={() => handleSave('Pen manager assigned')} />}
    </AppShell>
  );
}
