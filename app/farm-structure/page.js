'use client';
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

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
    <div style={{ height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
      <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:occColor(pct), borderRadius:2, transition:'width 0.5s ease' }} />
    </div>
  );
}

// ── KPI chip used in section cards ────────────────────────────────────────────
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

// ── Section-level metrics — LAYER ─────────────────────────────────────────────
function LayerMetrics({ mx, compact=false }) {
  if (!mx) return null;
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      <Chip icon="💀" value={mx.todayMortality}          sub="Dead today"    warn={mx.todayMortality > 5} small={compact} />
      <Chip icon="📉" value={`${mx.mortalityRate}%`}     sub="7d mort. rate" warn={mx.mortalityRate > 1}  small={compact} />
      <Chip icon="🥚" value={mx.todayEggs?.toLocaleString()} sub="Eggs today" color="#f59e0b"               small={compact} />
      <Chip icon="⭐" value={`${mx.todayGradeAPct}%`}    sub="Grade A"       color="#16a34a"               small={compact} />
      <Chip icon="📊" value={`${mx.todayLayingRate}%`}   sub="Laying rate"   color="#16a34a"               small={compact} />
      <Chip icon="🌾" value={`${mx.avgDailyFeedKg}kg`}   sub="Feed/day"                                    small={compact} />
    </div>
  );
}

// ── Section-level metrics — BROILER ───────────────────────────────────────────
function BroilerMetrics({ mx, compact=false }) {
  if (!mx) return null;
  const fcrColor = mx.estimatedFCR
    ? mx.estimatedFCR > 2.5 ? '#ef4444' : mx.estimatedFCR > 2.0 ? '#f59e0b' : '#22c55e'
    : 'var(--text-muted)';
  return (
    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
      <Chip icon="💀" value={mx.todayMortality}                  sub="Dead today"   warn={mx.todayMortality > 5} small={compact} />
      <Chip icon="📉" value={`${mx.mortalityRate}%`}             sub="7d mort. rate" warn={mx.mortalityRate > 1}  small={compact} />
      <Chip icon="⚖"  value={mx.latestWeightG ? `${mx.latestWeightG}g` : '—'} sub="Avg weight"  color="#3b82f6"  small={compact} />
      <Chip icon="🔄" value={mx.estimatedFCR ?? '—'}             sub="Est. FCR"      color={fcrColor}             small={compact} />
      <Chip icon="📅" value={mx.daysToHarvest != null ? `${mx.daysToHarvest}d` : '—'} sub="To harvest" color="#8b5cf6" small={compact} />
      <Chip icon="🌾" value={`${mx.avgDailyFeedKg}kg`}           sub="Feed/day"                                   small={compact} />
    </div>
  );
}

// ── Section Card ──────────────────────────────────────────────────────────────
function SectionCard({ section, penType, canManage, onEdit }) {
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
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontWeight:800, fontSize:13 }}>{section.name}</span>
        <span className={`status-badge ${flock?'status-green':'status-grey'}`} style={{ fontSize:9 }}>
          {flock ? '● Active' : '○ Empty'}
        </span>
      </div>

      {/* Occupancy */}
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

      {/* Flock info */}
      {flock && (
        <div style={{ marginTop:8, fontSize:11, color:'var(--text-secondary)' }}>
          <span style={{ fontWeight:700 }}>{flock.batchCode}</span>
          <span style={{ color:'var(--text-muted)' }}> · {flock.breed} · {section.ageInDays}d old</span>
        </div>
      )}

      {/* Role-specific metrics */}
      {flock && mx && (
        <div style={{ marginTop:10 }}>
          {mx.type === 'LAYER'   && <LayerMetrics   mx={mx} compact />}
          {mx.type === 'BROILER' && <BroilerMetrics mx={mx} compact />}
        </div>
      )}

      {/* Workers */}
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

      {section.managers.length > 0 && (
        <div style={{ marginTop:4, display:'flex', gap:4, flexWrap:'wrap' }}>
          {section.managers.map(m => (
            <span key={m.id} style={{ fontSize:10, background:'var(--purple-light)', border:'1px solid #d4d8ff', borderRadius:4, padding:'2px 7px', color:'var(--purple)', fontWeight:700 }}>
              👤 {m.firstName} {m.lastName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pen header summary metrics ────────────────────────────────────────────────
function PenSummaryMetrics({ pen }) {
  const mx = pen.metrics;
  if (!mx) return null;
  const isLayer = pen.operationType === 'LAYER';

  if (isLayer) return (
    <div style={{ display:'flex', gap:16, fontSize:12 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700, color:mx.todayMortality>10?'var(--red)':'var(--text-primary)' }}>{mx.todayMortality}</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Dead today</div>
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700, color:'#f59e0b' }}>{mx.todayEggs?.toLocaleString()}</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Eggs today</div>
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700, color:'#16a34a' }}>{mx.avgLayingRate}%</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Laying rate</div>
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700 }}>{mx.weekFeedKg}kg</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Feed 7d</div>
      </div>
    </div>
  );

  const fcrColor = mx.avgFCR ? (mx.avgFCR > 2.5 ? '#ef4444' : mx.avgFCR > 2.0 ? '#f59e0b' : '#22c55e') : 'var(--text-muted)';
  return (
    <div style={{ display:'flex', gap:16, fontSize:12 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700, color:mx.todayMortality>10?'var(--red)':'var(--text-primary)' }}>{mx.todayMortality}</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Dead today</div>
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700, color:'#3b82f6' }}>{mx.avgWeightG ? `${mx.avgWeightG}g` : '—'}</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Avg weight</div>
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700, color:fcrColor }}>{mx.avgFCR ?? '—'}</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Est. FCR</div>
      </div>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontWeight:700 }}>{mx.weekFeedKg}kg</div>
        <div style={{ color:'var(--text-muted)', fontSize:9 }}>Feed 7d</div>
      </div>
    </div>
  );
}

// ── Pen Card ──────────────────────────────────────────────────────────────────
function PenCard({ pen, canManage, onEditPen, onEditSection, onAddSection }) {
  const [expanded, setExpanded] = useState(true);
  const color = OP_COLOR[pen.operationType] || '#9ca3af';

  return (
    <div className="card" style={{ padding:0, overflow:'hidden', marginBottom:14 }}>
      <div onClick={()=>setExpanded(e=>!e)} style={{ padding:'12px 16px', cursor:'pointer', background:`${color}06`, borderBottom:expanded?`1px solid ${color}20`:'none', display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:34, height:34, borderRadius:8, background:`${color}15`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
          {OP_ICON[pen.operationType]}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
            <span style={{ fontWeight:700, fontSize:13 }}>{pen.name}</span>
            <span style={{ fontSize:9, fontWeight:700, background:`${color}15`, color, border:`1px solid ${color}30`, borderRadius:4, padding:'2px 6px', textTransform:'uppercase' }}>
              {OP_LABEL[pen.operationType]}
            </span>
            {pen.penManagers.map(m => (
              <span key={m.id} style={{ fontSize:9, background:'var(--purple-light)', color:'var(--purple)', border:'1px solid #d4d8ff', borderRadius:4, padding:'2px 6px', fontWeight:700 }}>
                👤 {m.firstName} {m.lastName}
              </span>
            ))}
            {pen.location && <span style={{ fontSize:10, color:'var(--text-muted)' }}>📍 {pen.location}</span>}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>{pen.currentBirds.toLocaleString()} / {pen.totalCapacity.toLocaleString()} birds</span>
            <div style={{ flex:1, maxWidth:100 }}><OccBar pct={pen.occupancyPct} /></div>
            <span style={{ fontSize:11, fontWeight:700, color:occColor(pen.occupancyPct) }}>{pen.occupancyPct}%</span>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <PenSummaryMetrics pen={pen} />
          {canManage && (
            <button className="btn btn-ghost" style={{ padding:'4px 8px', fontSize:11 }}
              onClick={e=>{e.stopPropagation();onEditPen(pen);}}>✏️</button>
          )}
          <span style={{ color:'var(--text-faint)', fontSize:14, transform:expanded?'rotate(90deg)':'rotate(0deg)', transition:'transform 0.2s' }}>›</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(210px, 1fr))', gap:10 }}>
            {pen.sections.map(sec => (
              <SectionCard key={sec.id} section={sec} penType={pen.operationType} canManage={canManage}
                onEdit={()=>onEditSection(sec,pen)} />
            ))}
            {canManage && (
              <div onClick={()=>onAddSection(pen)} style={{ border:'2px dashed var(--border)', borderRadius:10, padding:14, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--text-faint)', minHeight:120, fontSize:12, fontWeight:600, gap:6, transition:'all 0.15s' }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--purple)';e.currentTarget.style.color='var(--purple)';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text-faint)';}}>
                <span style={{ fontSize:22 }}>+</span>Add Section
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manager-only global KPI bar ───────────────────────────────────────────────
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

  const occ = t.capacity > 0 ? parseFloat(((t.birds/t.capacity)*100).toFixed(1)) : 0;

  const kpis = [
    { icon:'🐦', val:t.birds.toLocaleString(),        lbl:'Total Birds',   color:'var(--purple)' },
    { icon:'📦', val:t.capacity.toLocaleString(),      lbl:'Total Capacity',color:'var(--blue)' },
    { icon:'📊', val:`${occ}%`,                        lbl:'Occupancy',     color:occColor(occ) },
    { icon:'🥚', val:t.layerBirds.toLocaleString(),    lbl:'Layer Birds',   color:'#f59e0b' },
    { icon:'🍗', val:t.broilerBirds.toLocaleString(),  lbl:'Broiler Birds', color:'#3b82f6' },
    { icon:'🧺', val:t.todayEggs.toLocaleString(),     lbl:'Eggs Today',    color:'#16a34a' },
    { icon:'💀', val:t.todayDead,                      lbl:'Dead Today',    color:t.todayDead>20?'var(--red)':'var(--text-primary)' },
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

// ── Worker KPI bar — shows only their pen type ────────────────────────────────
function WorkerKPIBar({ farms, allowedOpTypes }) {
  const isLayerOnly   = allowedOpTypes?.includes('LAYER')   && !allowedOpTypes?.includes('BROILER');
  const isBroilerOnly = allowedOpTypes?.includes('BROILER') && !allowedOpTypes?.includes('LAYER');

  const allSections = farms.flatMap(f => f.pens.flatMap(p => p.sections));
  const allPens     = farms.flatMap(f => f.pens);

  if (isLayerOnly) {
    const totalBirds   = allSections.reduce((s,sec) => s + sec.currentBirds, 0);
    const todayEggs    = allSections.reduce((s,sec) => s + (sec.metrics?.todayEggs || 0), 0);
    const todayDead    = allSections.reduce((s,sec) => s + (sec.metrics?.todayMortality || 0), 0);
    const rates        = allSections.filter(sec => sec.metrics?.todayLayingRate > 0);
    const avgRate      = rates.length > 0 ? parseFloat((rates.reduce((s,sec) => s+(sec.metrics?.todayLayingRate||0), 0)/rates.length).toFixed(1)) : 0;
    const gradeAs      = allSections.filter(sec => sec.metrics?.todayGradeAPct > 0);
    const avgGradeA    = gradeAs.length > 0 ? parseFloat((gradeAs.reduce((s,sec) => s+(sec.metrics?.todayGradeAPct||0),0)/gradeAs.length).toFixed(1)) : 0;

    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:22 }}>
        {[
          { icon:'🥚', val:todayEggs.toLocaleString(),  lbl:'Eggs Today',    color:'#f59e0b' },
          { icon:'📊', val:`${avgRate}%`,               lbl:'Avg Laying Rate',color:'#16a34a' },
          { icon:'⭐', val:`${avgGradeA}%`,             lbl:'Avg Grade A',   color:'#16a34a' },
          { icon:'🐦', val:totalBirds.toLocaleString(), lbl:'Live Birds',    color:'var(--purple)' },
          { icon:'💀', val:todayDead,                   lbl:'Dead Today',    color:todayDead>10?'var(--red)':'var(--text-primary)' },
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
    const totalBirds = allSections.reduce((s,sec) => s + sec.currentBirds, 0);
    const todayDead  = allSections.reduce((s,sec) => s + (sec.metrics?.todayMortality || 0), 0);
    const weights    = allSections.filter(sec => sec.metrics?.latestWeightG);
    const avgWeight  = weights.length > 0 ? parseFloat((weights.reduce((s,sec) => s+(sec.metrics?.latestWeightG||0),0)/weights.length).toFixed(0)) : null;
    const fcrs       = allSections.filter(sec => sec.metrics?.estimatedFCR);
    const avgFCR     = fcrs.length > 0 ? parseFloat((fcrs.reduce((s,sec) => s+(sec.metrics?.estimatedFCR||0),0)/fcrs.length).toFixed(2)) : null;
    const harvests   = allSections.filter(sec => sec.metrics?.daysToHarvest != null);
    const minHarvest = harvests.length > 0 ? Math.min(...harvests.map(sec => sec.metrics.daysToHarvest)) : null;
    const fcrColor   = avgFCR ? (avgFCR>2.5?'#ef4444':avgFCR>2.0?'#f59e0b':'#22c55e') : 'var(--text-muted)';

    return (
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:22 }}>
        {[
          { icon:'🐦', val:totalBirds.toLocaleString(),        lbl:'Live Birds',    color:'var(--purple)' },
          { icon:'⚖',  val:avgWeight ? `${avgWeight}g` : '—', lbl:'Avg Weight',    color:'#3b82f6' },
          { icon:'🔄', val:avgFCR ?? '—',                      lbl:'Est. Avg FCR',  color:fcrColor },
          { icon:'📅', val:minHarvest != null ? `${minHarvest}d` : '—', lbl:'Nearest Harvest', color:'#8b5cf6' },
          { icon:'💀', val:todayDead,                           lbl:'Dead Today',    color:todayDead>10?'var(--red)':'var(--text-primary)' },
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

  // Mixed (pen managers with both types) — show both side by side
  return null;
}

// ── Modals ────────────────────────────────────────────────────────────────────
function Modal({ title, subtitle, onClose, onSave, saveLabel, saving, error, children }) {
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{ width:'100%', maxWidth:480 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <h2 style={{ fontFamily:"'Poppins',sans-serif", fontSize:16, fontWeight:700, margin:0 }}>{title}</h2>
            {subtitle && <p style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding:'6px 10px', flexShrink:0, lineHeight:1 }}>✕</button>
        </div>
        {error && <div className="alert alert-red" style={{ marginBottom:14 }}>⚠ {error}</div>}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>{children}</div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:22, paddingTop:18, borderTop:'1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>{saving?'Saving…':saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
const F  = ({label,children}) => <div><label className="label">{label}</label>{children}</div>;
const G2 = ({children}) => <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>{children}</div>;

function FarmModal({ mode, farm, managers, onClose, onSave }) {
  const [f,setF]=useState({name:farm?.name||'',location:farm?.location||'',address:farm?.address||'',phone:farm?.phone||'',email:farm?.email||'',managerId:farm?.managerId||''});
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  async function save(){
    if(!f.name.trim())return setError('Farm name required');
    setSaving(true);setError('');
    try{
      const body=mode==='edit'?{id:farm.id,...f}:f;
      const res=await fetch('/api/farm-structure?type=farm',{method:mode==='edit'?'PATCH':'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
      const d=await res.json();if(!res.ok)return setError(d.error||'Failed');
      onSave();
    }finally{setSaving(false);}
  }
  return(
    <Modal title={mode==='create'?'🏡 Add Farm':'✏️ Edit Farm'} subtitle={mode==='edit'?`Editing ${farm.name}`:undefined} onClose={onClose} onSave={save} saveLabel={mode==='create'?'Create Farm':'Save'} saving={saving} error={error}>
      <F label="Farm Name *"><input className="input" value={f.name} onChange={e=>up('name',e.target.value)} placeholder="Green Acres Main Farm"/></F>
      <G2><F label="Location"><input className="input" value={f.location} onChange={e=>up('location',e.target.value)} placeholder="Ogun State"/></F>
          <F label="Phone"><input className="input" value={f.phone} onChange={e=>up('phone',e.target.value)} placeholder="+234 801 000 0000"/></F></G2>
      <F label="Full Address"><input className="input" value={f.address} onChange={e=>up('address',e.target.value)} placeholder="12 Farm Road, Ogun State"/></F>
      <F label="Farm Email"><input className="input" type="email" value={f.email} onChange={e=>up('email',e.target.value)} placeholder="farm@greenacres.ng"/></F>
      <F label="Farm Manager">
        <select className="input" value={f.managerId} onChange={e=>up('managerId',e.target.value)}>
          <option value="">— No manager assigned —</option>
          {managers.map(m=><option key={m.id} value={m.id}>{m.firstName} {m.lastName} ({m.role.replace('_',' ')})</option>)}
        </select>
      </F>
    </Modal>
  );
}

function PenModal({ mode, pen, farmId, farmName, onClose, onSave }) {
  const [f,setF]=useState({name:pen?.name||'',operationType:pen?.operationType||'LAYER',capacity:pen?.totalCapacity||pen?.capacity||'',location:pen?.location||'',buildYear:pen?.buildYear||''});
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  async function save(){
    if(!f.name.trim()||!f.capacity)return setError('Name and capacity required');
    setSaving(true);setError('');
    try{
      const body=mode==='edit'?{id:pen.id,name:f.name,capacity:f.capacity,location:f.location,buildYear:f.buildYear}:{farmId,...f};
      const res=await fetch('/api/farm-structure?type=pen',{method:mode==='edit'?'PATCH':'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
      const d=await res.json();if(!res.ok)return setError(d.error||'Failed');
      onSave();
    }finally{setSaving(false);}
  }
  return(
    <Modal title={mode==='create'?'🏗 Add Pen':'✏️ Edit Pen'} subtitle={`${mode==='create'?'Adding to':'In'} ${farmName}`} onClose={onClose} onSave={save} saveLabel={mode==='create'?'Create Pen':'Save'} saving={saving} error={error}>
      <F label="Pen Name *"><input className="input" value={f.name} onChange={e=>up('name',e.target.value)} placeholder="Pen A — Layers"/></F>
      <G2>
        <F label="Operation Type *">
          <select className="input" value={f.operationType} onChange={e=>up('operationType',e.target.value)} disabled={mode==='edit'}>
            <option value="LAYER">🥚 Layer</option><option value="BROILER">🍗 Broiler</option>
            <option value="BREEDER">🔄 Breeder</option><option value="TURKEY">🦃 Turkey</option>
          </select>
          {mode==='edit'&&<div style={{fontSize:10,color:'var(--text-muted)',marginTop:3}}>Cannot change with active flocks</div>}
        </F>
        <F label="Capacity *"><input className="input" type="number" value={f.capacity} onChange={e=>up('capacity',e.target.value)} placeholder="10000" min="1"/></F>
      </G2>
      <G2>
        <F label="Location"><input className="input" value={f.location} onChange={e=>up('location',e.target.value)} placeholder="Block A"/></F>
        <F label="Year Built"><input className="input" type="number" value={f.buildYear} onChange={e=>up('buildYear',e.target.value)} placeholder="2023"/></F>
      </G2>
    </Modal>
  );
}

function SectionModal({ mode, section, pen, onClose, onSave }) {
  const [f,setF]=useState({name:section?.name||'',capacity:section?.capacity||''});
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  async function save(){
    if(!f.name.trim()||!f.capacity)return setError('Name and capacity required');
    setSaving(true);setError('');
    try{
      const body=mode==='edit'?{id:section.id,name:f.name,capacity:f.capacity}:{penId:pen.id,name:f.name,capacity:f.capacity};
      const res=await fetch('/api/farm-structure?type=section',{method:mode==='edit'?'PATCH':'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
      const d=await res.json();if(!res.ok)return setError(d.error||'Failed');
      onSave();
    }finally{setSaving(false);}
  }
  const color=OP_COLOR[pen.operationType];
  return(
    <Modal title={mode==='create'?'➕ Add Section':'✏️ Edit Section'} subtitle={`${pen.name} — ${OP_LABEL[pen.operationType]}`} onClose={onClose} onSave={save} saveLabel={mode==='create'?'Add Section':'Save'} saving={saving} error={error}>
      {mode==='edit'&&section?.activeFlock&&<div className="alert alert-amber">⚠ Active flock: {section.activeFlock.batchCode} · {section.currentBirds?.toLocaleString()} birds</div>}
      <F label="Section Name *"><input className="input" value={f.name} onChange={e=>up('name',e.target.value)} placeholder="Section A"/></F>
      <F label="Capacity (birds) *">
        <input className="input" type="number" value={f.capacity} onChange={e=>up('capacity',e.target.value)} placeholder="2500" min="1"/>
        {mode==='edit'&&f.capacity&&parseInt(f.capacity)<(section?.currentBirds||0)&&<div style={{fontSize:11,color:'var(--red)',marginTop:4}}>⚠ Below current bird count ({section.currentBirds?.toLocaleString()})</div>}
      </F>
      <div style={{padding:12,background:`${color}08`,borderRadius:8,border:`1px solid ${color}20`,fontSize:12,color:'var(--text-secondary)'}}>
        <strong>Pen type:</strong> {OP_ICON[pen.operationType]} {OP_LABEL[pen.operationType]} — sections inherit this type
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FarmStructurePage() {
  const { user } = useAuth();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState(null);
  const [modal,   setModal]   = useState(null);

  const isManager  = MANAGER_ROLES.includes(user?.role);
  const canManage  = isManager;

  const showToast = (msg,type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/farm-structure', { credentials:'include' });
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const farms          = data?.farms          || [];
  const managers       = data?.managers       || [];
  const allowedOpTypes = data?.allowedOpTypes || null;

  const totalPens     = farms.reduce((s,f)=>s+f.penCount,0);
  const totalSections = farms.reduce((s,f)=>s+f.pens.reduce((ps,p)=>ps+p.sectionCount,0),0);

  function handleSave(msg) { setModal(null); load(); showToast(msg); }

  // Determine page subtitle based on role
  const subtitle = isManager
    ? `${farms.length} farm${farms.length!==1?'s':''} · ${totalPens} pens · ${totalSections} sections — full view`
    : allowedOpTypes
      ? `Your ${allowedOpTypes.map(t=>OP_LABEL[t]).join(' & ')} sections`
      : 'Your assigned sections';

  return (
    <AppShell>
      <div className="animate-in">
        {toast && (
          <div style={{ position:'fixed', top:20, right:24, zIndex:999, padding:'12px 20px', borderRadius:10, fontSize:13, fontWeight:600, background:toast.type==='error'?'var(--red-bg)':'var(--green-bg)', color:toast.type==='error'?'var(--red)':'#16a34a', border:`1px solid ${toast.type==='error'?'var(--red-border)':'var(--green-border)'}`, boxShadow:'var(--shadow-md)', animation:'fadeInUp 0.2s ease' }}>
            {toast.type==='error'?'⚠ ':'✓ '}{toast.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22 }}>
          <div>
            <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, margin:0 }}>
              {isManager ? '🏡 Farm Structure' : `${allowedOpTypes?.map(t=>OP_ICON[t]).join('') || '🏡'} My Sections`}
            </h1>
            <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>{subtitle}</p>
          </div>
          {canManage && <button className="btn btn-primary" onClick={()=>setModal({type:'farm',mode:'create'})}>+ Add Farm</button>}
        </div>

        {/* KPI bar — role-aware */}
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
            {/* Farm header — managers see full stats, workers see simplified */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, paddingBottom:12, borderBottom:'2px solid var(--border)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                <div style={{ width:40, height:40, borderRadius:10, background:'var(--purple-light)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>🏡</div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <h2 style={{ fontFamily:"'Poppins',sans-serif", fontSize:15, fontWeight:700, margin:0 }}>{farm.name}</h2>
                    {isManager && farm.managerId && (() => {
                      const mgr = managers.find(m=>m.id===farm.managerId);
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
                      { val:farm.totalBirds.toLocaleString(),           lbl:'Live Birds',   color:'var(--purple)' },
                      { val:`${farm.occupancyPct}%`,                    lbl:'Occupied',     color:occColor(farm.occupancyPct) },
                      { val:farm.metrics.todayMortality,                lbl:'Dead Today',   color:farm.metrics.todayMortality>20?'var(--red)':'var(--text-primary)' },
                      { val:farm.metrics.todayEggs?.toLocaleString(),   lbl:'Eggs Today',   color:'#f59e0b' },
                      { val:`${farm.metrics.weekFeedKg}kg`,             lbl:'Feed 7d',      color:'var(--blue)' },
                    ].map(s=>(
                      <div key={s.lbl} style={{ textAlign:'center' }}>
                        <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:14, fontWeight:700, color:s.color }}>{s.val}</div>
                        <div style={{ color:'var(--text-muted)', fontSize:10 }}>{s.lbl}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="btn btn-ghost" style={{ fontSize:11 }} onClick={()=>setModal({type:'farm',mode:'edit',target:farm})}>✏️ Edit</button>
                    <button className="btn btn-outline" style={{ fontSize:11 }} onClick={()=>setModal({type:'pen',mode:'create',context:{farmId:farm.id,farmName:farm.name}})}>+ Add Pen</button>
                  </div>
                </div>
              )}
            </div>

            {farm.pens.map(pen => (
              <PenCard key={pen.id} pen={pen} canManage={canManage}
                onEditPen={p=>setModal({type:'pen',mode:'edit',target:p,context:{farmName:farm.name}})}
                onEditSection={(sec,p)=>setModal({type:'section',mode:'edit',target:sec,context:{pen:p}})}
                onAddSection={p=>setModal({type:'section',mode:'create',context:{pen:p}})}
              />
            ))}
          </div>
        ))}
      </div>

      {modal?.type==='farm'    && <FarmModal    mode={modal.mode} farm={modal.target} managers={managers} onClose={()=>setModal(null)} onSave={()=>handleSave(modal.mode==='create'?'Farm created':'Farm updated')} />}
      {modal?.type==='pen'     && <PenModal     mode={modal.mode} pen={modal.target} farmId={modal.context?.farmId} farmName={modal.context?.farmName} onClose={()=>setModal(null)} onSave={()=>handleSave(modal.mode==='create'?'Pen created':'Pen updated')} />}
      {modal?.type==='section' && <SectionModal mode={modal.mode} section={modal.target} pen={modal.context?.pen} onClose={()=>setModal(null)} onSave={()=>handleSave(modal.mode==='create'?'Section added':'Section updated')} />}
    </AppShell>
  );
}
