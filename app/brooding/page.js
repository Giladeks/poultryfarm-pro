'use client';
// app/brooding/page.js — Phase 8C v2 Brooding Module
// Tabs: Active Batches | New Day-Old Intake | Log Delivery | Temperature
//
// "New Day-Old Intake" — creates a Flock (stage=BROODING) + chick_arrival manifest in one form.
// "Log Delivery"       — logs an additional delivery truck against an existing flock.
import { useState, useEffect, useCallback } from 'react';
import { useRouter }   from 'next/navigation';
import AppShell        from '@/components/layout/AppShell';
import { useAuth }     from '@/components/layout/AuthProvider';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const ACTION_ROLES = ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];
const ALL_ROLES    = [...ACTION_ROLES, 'PEN_WORKER'];
const TABS         = ['Active Batches','New Intake','Log Delivery','Temperature'];
const ZONE_COLORS  = ['#6c63ff','#f59e0b','#22c55e','#ef4444','#0ea5e9'];

function getTempBand(daysOld) {
  if (daysOld <= 7)  return { low:28, high:35, label:'Wk 1 (28–35°C)' };
  if (daysOld <= 14) return { low:26, high:32, label:'Wk 2 (26–32°C)' };
  if (daysOld <= 21) return { low:24, high:30, label:'Wk 3+ (24–30°C)' };
  return { low:22, high:28, label:'Wk 5+ (22–28°C)' };
}

const fmt = n => n != null ? Number(n).toLocaleString() : '—';
function tempColor(t) { return (t<26||t>38)?'#ef4444':(t<28||t>35)?'#f59e0b':'#22c55e'; }

function Toast({ msg, type }) {
  if (!msg) return null;
  const bg = type==='error'?'#991b1b':type==='warn'?'#92400e':'#166534';
  return (
    <div style={{ position:'fixed',bottom:24,right:24,background:bg,color:'#fff',
      borderRadius:10,padding:'12px 20px',zIndex:9999,fontSize:14,fontWeight:600,
      boxShadow:'0 4px 20px rgba(0,0,0,.2)',maxWidth:400 }}>{msg}</div>
  );
}

function KpiCard({ label, value, color='#6c63ff' }) {
  return (
    <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,
      padding:'14px 18px',flex:1,minWidth:120 }}>
      <div style={{ fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',
        letterSpacing:'.06em',marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:20,fontWeight:800,color }}>{value}</div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.45)',display:'flex',
      alignItems:'center',justifyContent:'center',zIndex:500,padding:16 }}>
      <div style={{ background:'#fff',borderRadius:14,width:'100%',maxWidth:520,
        maxHeight:'90vh',overflowY:'auto',boxShadow:'0 8px 40px rgba(0,0,0,.18)' }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',
          padding:'16px 20px',borderBottom:'1px solid #f1f5f9' }}>
          <span style={{ fontWeight:700,fontSize:15 }}>{title}</span>
          <button onClick={onClose} style={{ background:'none',border:'none',fontSize:18,
            cursor:'pointer',color:'#94a3b8' }}>x</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

const inputSt = { width:'100%',padding:'9px 12px',border:'1.5px solid #e2e8f0',
  borderRadius:8,fontSize:14,color:'#1e293b',background:'#fff',outline:'none' };

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block',fontSize:12,fontWeight:700,color:'#64748b',
        textTransform:'uppercase',letterSpacing:'.05em',marginBottom:5 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:11,color:'#94a3b8',marginTop:4 }}>{hint}</div>}
    </div>
  );
}

function FlockCard({ flock, canAct, onEndBrooding, onLogTemp }) {
  const isLayer     = flock.operationType === 'LAYER';
  const borderColor = isLayer ? '#f59e0b' : '#3b82f6';
  const maxWeeks    = isLayer ? 6 : 2;
  const weeksLeft   = Math.max(0, maxWeeks - (flock.weeksOld || 0));
  const isOverdue   = (flock.weeksOld || 0) > maxWeeks;

  // ── Survival / mortality / cost strip (from chick_arrivals deliveries) ──────
  const deliveries      = flock.deliveries || [];
  const totalChicksIn   = deliveries.reduce((a, d) => a + (d.chicksReceived || 0), 0);
  const totalDOA        = deliveries.reduce((a, d) => a + (d.doaCount      || 0), 0);
  const totalChickCost  = deliveries.reduce((a, d) =>
    a + (d.chicksReceived || 0) * (d.chickCostPerBird ? Number(d.chickCostPerBird) : 0), 0);
  const survivalRate    = totalChicksIn > 0
    ? parseFloat(((flock.currentCount / totalChicksIn) * 100).toFixed(1)) : null;
  const earlyMortPct    = totalChicksIn > 0
    ? parseFloat((((totalDOA + (totalChicksIn - flock.currentCount)) / totalChicksIn) * 100).toFixed(1)) : null;
  const costPerSurvivor = totalChickCost > 0 && flock.currentCount > 0
    ? parseFloat((totalChickCost / flock.currentCount).toFixed(2)) : null;
  const hasCostData     = deliveries.some(d => d.chickCostPerBird && Number(d.chickCostPerBird) > 0);
  const currency        = deliveries[0]?.currency || 'NGN';

  return (
    <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,padding:18,
      borderLeft:`4px solid ${isOverdue ? '#ef4444' : borderColor}` }}>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10 }}>
        <div>
          <div style={{ fontWeight:800,fontSize:15,color:'#1e293b' }}>{flock.batchCode}</div>
          <div style={{ fontSize:12,color:'#64748b',marginTop:2 }}>
            {flock.penSection?.pen?.name} · {flock.penSection?.name}
            <span style={{ marginLeft:6,fontSize:10,fontWeight:700,
              background: flock.penSection?.pen?.penPurpose==='BROODING'?'#fffbeb':'#f1f5f9',
              color: flock.penSection?.pen?.penPurpose==='BROODING'?'#92400e':'#64748b',
              borderRadius:10,padding:'1px 6px' }}>
              {flock.penSection?.pen?.penPurpose || 'PRODUCTION'}
            </span>
          </div>
        </div>
        <span style={{ background:isOverdue?'#fef2f2':isLayer?'#fffbeb':'#eff6ff',
          border:`1px solid ${isOverdue?'#fecaca':isLayer?'#fde68a':'#bfdbfe'}`,
          color:isOverdue?'#dc2626':isLayer?'#92400e':'#1e40af',
          fontSize:11,fontWeight:700,borderRadius:20,padding:'2px 10px' }}>
          {isOverdue ? `Overdue Wk ${flock.weeksOld}` : `Wk ${flock.weeksOld||0} · ${weeksLeft}wk left`}
        </span>
      </div>

      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:13,marginBottom:12 }}>
        <div><span style={{ color:'#94a3b8',fontSize:11 }}>Birds</span><br/>
          <strong>{fmt(flock.currentCount)}</strong></div>
        <div><span style={{ color:'#94a3b8',fontSize:11 }}>Placed</span><br/>
          <strong>{flock.dateOfPlacement
            ? new Date(flock.dateOfPlacement).toLocaleDateString('en-NG',{day:'2-digit',month:'short'})
            : '—'}</strong></div>
        <div><span style={{ color:'#94a3b8',fontSize:11 }}>Breed</span><br/>
          <strong>{flock.breed||'—'}</strong></div>
        <div><span style={{ color:'#94a3b8',fontSize:11 }}>Deliveries</span><br/>
          <strong>{flock.deliveries?.length||0}</strong></div>
      </div>

      {flock.latestTemp && (
        <div style={{ background:'#f8fafc',borderRadius:8,padding:'7px 12px',
          marginBottom:12,fontSize:13,display:'flex',alignItems:'center',gap:8 }}>
          <span>Temp:</span>
          <strong style={{ color:tempColor(Number(flock.latestTemp.tempCelsius)) }}>
            {Number(flock.latestTemp.tempCelsius).toFixed(1)}°C
          </strong>
          {flock.latestTemp.humidity && ` · ${Number(flock.latestTemp.humidity).toFixed(0)}% RH`}
          <span style={{ color:'#94a3b8',fontSize:11 }}>{flock.latestTemp.zone}</span>
        </div>
      )}

      {!isLayer && (flock.daysOld||0) >= 14 && (
        <div style={{ background:'#fffbeb',borderRadius:8,padding:'7px 12px',
          marginBottom:12,fontSize:12,color:'#92400e',fontWeight:700 }}>
          Day {flock.daysOld}: Consider transitioning to Grower mash and removing tarpaulins.
        </div>
      )}

      {/* ── Survival / mortality / cost strip ── */}
      {totalChicksIn > 0 && (
        <div style={{ display:'grid',
          gridTemplateColumns: hasCostData ? 'repeat(3,1fr)' : 'repeat(2,1fr)',
          gap:6, marginBottom:10,
          background:'#f8fafc', borderRadius:8, padding:'8px 10px',
          border:'1px solid #e2e8f0' }}>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:9,color:'#94a3b8',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'0.05em' }}>Survival</div>
            <div style={{ fontSize:15,fontWeight:800,
              color:survivalRate==null?'#94a3b8':survivalRate>=95?'#16a34a':survivalRate>=90?'#d97706':'#dc2626' }}>
              {survivalRate!=null?`${survivalRate}%`:'—'}
            </div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:9,color:'#94a3b8',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'0.05em' }}>Mortality</div>
            <div style={{ fontSize:15,fontWeight:800,
              color:earlyMortPct==null?'#94a3b8':earlyMortPct<=2?'#16a34a':earlyMortPct<=5?'#d97706':'#dc2626' }}>
              {earlyMortPct!=null?`${earlyMortPct}%`:'—'}
            </div>
          </div>
          {hasCostData && (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:9,color:'#94a3b8',fontWeight:700,
                textTransform:'uppercase',letterSpacing:'0.05em' }}>Cost/Bird</div>
              <div style={{ fontSize:13,fontWeight:800,color:'#6c63ff' }}>
                {costPerSurvivor!=null?`${currency} ${fmt(Math.round(costPerSurvivor))}`:'—'}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display:'flex',gap:8 }}>
        <button onClick={onLogTemp}
          style={{ flex:1,padding:'7px',borderRadius:8,border:'1.5px solid #e2e8f0',
            background:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',color:'#475569' }}>
          Log Temp
        </button>
        {canAct && (
          <button onClick={onEndBrooding}
            style={{ flex:1,padding:'7px',borderRadius:8,border:'none',
              background:isLayer?'#fef9c3':'#dbeafe',
              color:isLayer?'#713f12':'#1e40af',fontSize:12,fontWeight:700,cursor:'pointer' }}>
            End Brooding
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function BroodingPage() {
  const router             = useRouter();
  const { user, apiFetch } = useAuth();

  // All hooks before any early returns
  const [activeTab,      setActiveTab]      = useState(0);
  const [flocks,         setFlocks]         = useState([]);
  const [allSections,    setAllSections]    = useState([]);   // for section pickers
  const [loading,        setLoading]        = useState(true);
  const [toast,          setToast]          = useState({ msg:'', type:'success' });

  // ── Tab 1: New Day-Old Intake (Flock + delivery in one form) ──────────────
  const [intakeForm, setIntakeForm] = useState({
    // Flock fields
    batchCode:'', operationType:'LAYER', breed:'', penSectionId:'',
    dateOfPlacement: new Date().toISOString().slice(0,10),
    initialCount:'', source:'PURCHASED', purchaseCost:'',
    // Delivery fields
    supplier:'', chickCostPerBird:'', doaCount:'0', currency:'NGN',
    notes:'',
  });
  const [intakeSubmitting, setIntakeSubmitting] = useState(false);

  // ── Tab 2: Log Delivery (additional truck against existing flock) ─────────
  const [delForm,       setDelForm]       = useState({
    flockId:'', batchCode:'', arrivalDate:'',
    chicksReceived:'', doaCount:'0', supplier:'', chickCostPerBird:'', currency:'NGN', notes:'',
  });
  const [delSubmitting, setDelSubmitting] = useState(false);

  // ── Tab 3: Temperature ────────────────────────────────────────────────────
  const [selectedFlockId,  setSelectedFlockId]  = useState('');
  const [tempDaily,        setTempDaily]         = useState([]);
  const [tempLoading,      setTempLoading]       = useState(false);
  const [tempForm,         setTempForm]          = useState({ zone:'Zone A', tempCelsius:'', humidity:'', notes:'' });
  const [tempSubmitting,   setTempSubmitting]    = useState(false);

  // ── End-brooding modal ────────────────────────────────────────────────────
  const [endModal,      setEndModal]      = useState(null);
  const [endForm,       setEndForm]       = useState({ endDate:'', notes:'' });
  const [endSubmitting, setEndSubmitting] = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadFlocks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res  = await apiFetch('/api/brooding');
      const data = await res.json();
      setFlocks(data.flocks || []);
    } catch { /**/ }
    setLoading(false);
  }, [user, apiFetch]);

  const loadSections = useCallback(async () => {
    if (!user) return;
    try {
      const res  = await apiFetch('/api/farm-structure');
      const data = await res.json();
      const secs = [];
      (data.farms || []).forEach(farm =>
        (farm.pens || []).forEach(pen =>
          (pen.sections || []).forEach(s =>
            secs.push({
              ...s,
              penName:    pen.name,
              penPurpose: pen.penPurpose,
              opType:     pen.operationType,
            })
          )
        )
      );
      setAllSections(secs);
    } catch { /**/ }
  }, [user, apiFetch]);

  const loadTempData = useCallback(async (flockId) => {
    if (!flockId) return;
    setTempLoading(true);
    try {
      const res  = await apiFetch(`/api/brooding/temperature?flockId=${flockId}`);
      const data = await res.json();
      setTempDaily(data.dailyAggregates || []);
    } catch { /**/ }
    setTempLoading(false);
  }, [apiFetch]);

  useEffect(() => { if (user) { loadFlocks(); loadSections(); } }, [user, loadFlocks, loadSections]);
  useEffect(() => { if (selectedFlockId) loadTempData(selectedFlockId); }, [selectedFlockId, loadTempData]);

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (!user) return null;
  if (!ALL_ROLES.includes(user.role)) { router.push('/dashboard'); return null; }

  const canAct = ACTION_ROLES.includes(user.role);

  function showToast(msg, type='success') {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg:'', type:'success' }), 4500);
  }

  // Filter sections for the intake form based on selected operationType
  const broodingSections = allSections.filter(s =>
    // Prefer BROODING purpose pens, but allow all if none exist yet
    s.opType === intakeForm.operationType
  );
  const broodingPurposeSections = broodingSections.filter(s => s.penPurpose === 'BROODING');
  const sectionsForIntake = broodingPurposeSections.length > 0 ? broodingPurposeSections : broodingSections;

  // ── Submit: New Day-Old Intake (Flock + delivery) ─────────────────────────
  async function handleIntakeSubmit(e) {
    e.preventDefault();
    const f = intakeForm;
    if (!f.batchCode || !f.breed || !f.penSectionId || !f.initialCount)
      return showToast('Fill all required fields', 'error');

    setIntakeSubmitting(true);
    try {
      // Step 1: Create the Flock with stage=BROODING
      // Net live birds = gross intake minus DOA on arrival
      const grossIntake = parseInt(f.initialCount, 10);
      const doaCount    = parseInt(f.doaCount || '0', 10);
      const netLiveBirds = Math.max(1, grossIntake - doaCount);

      const flockRes = await apiFetch('/api/flocks', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          batchCode:       f.batchCode,
          operationType:   f.operationType,
          breed:           f.breed,
          penSectionId:    f.penSectionId,
          dateOfPlacement: f.dateOfPlacement,
          initialCount:    netLiveBirds,   // net live birds — DOA already excluded
          stage:           'BROODING',
          source:          f.source,
          purchaseCost:    f.purchaseCost ? parseFloat(f.purchaseCost) : undefined,
        }),
      });
      const flockData = await flockRes.json();
      if (!flockRes.ok) return showToast(flockData.error || 'Failed to create flock', 'error');

      const newFlock = flockData.flock;

      // Step 2: Create the chick delivery manifest (chick_arrival)
      // chicksReceived = gross intake; DOA recorded separately
      const deliveryRes = await apiFetch('/api/brooding/arrivals', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          flockId:          newFlock.id,
          penSectionId:     f.penSectionId,
          batchCode:        f.batchCode,
          arrivalDate:      f.dateOfPlacement,
          chicksReceived:   grossIntake,   // gross — survival strip uses this as denominator
          doaCount:         doaCount,
          supplier:         f.supplier         || null,
          chickCostPerBird: f.chickCostPerBird ? parseFloat(f.chickCostPerBird) : null,
          currency:         f.currency,
          notes:            f.notes            || null,
        }),
      });
      const deliveryData = await deliveryRes.json();

      const tasksMsg = deliveryData.tasksGenerated
        ? ` ${deliveryData.tasksGenerated} tasks auto-generated.`
        : '';
      showToast(`Intake logged: ${newFlock.batchCode}.${tasksMsg}`);

      // Reset form
      setIntakeForm({
        batchCode:'', operationType:'LAYER', breed:'', penSectionId:'',
        dateOfPlacement: new Date().toISOString().slice(0,10),
        initialCount:'', source:'PURCHASED', purchaseCost:'',
        supplier:'', chickCostPerBird:'', doaCount:'0', currency:'NGN', notes:'',
      });
      loadFlocks();
      setActiveTab(0);
    } catch { showToast('Network error', 'error'); }
    setIntakeSubmitting(false);
  }

  // ── Submit: Additional delivery against existing flock ───────────────────
  async function handleDeliverySubmit(e) {
    e.preventDefault();
    if (!delForm.flockId || !delForm.batchCode || !delForm.arrivalDate || !delForm.chicksReceived)
      return showToast('Fill all required fields', 'error');

    setDelSubmitting(true);
    try {
      const flock = flocks.find(f => f.id === delForm.flockId);
      const res   = await apiFetch('/api/brooding/arrivals', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          flockId:          delForm.flockId,
          penSectionId:     flock?.penSectionId || '',
          batchCode:        delForm.batchCode,
          arrivalDate:      delForm.arrivalDate,
          chicksReceived:   parseInt(delForm.chicksReceived, 10),
          doaCount:         parseInt(delForm.doaCount || '0', 10),
          supplier:         delForm.supplier         || null,
          chickCostPerBird: delForm.chickCostPerBird ? parseFloat(delForm.chickCostPerBird) : null,
          currency:         delForm.currency,
          notes:            delForm.notes            || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Failed', 'error');
      showToast(`Delivery logged. ${data.tasksGenerated} tasks generated.`);
      setDelForm({ flockId:'', batchCode:'', arrivalDate:'',
        chicksReceived:'', doaCount:'0', supplier:'', chickCostPerBird:'', currency:'NGN', notes:'' });
      loadFlocks();
      setActiveTab(0);
    } catch { showToast('Network error', 'error'); }
    setDelSubmitting(false);
  }

  // ── Submit: Temperature reading ───────────────────────────────────────────
  async function handleTempSubmit(e) {
    e.preventDefault();
    if (!selectedFlockId || !tempForm.tempCelsius)
      return showToast('Select a flock and enter temperature', 'error');
    const flock = flocks.find(f => f.id === selectedFlockId);
    setTempSubmitting(true);
    try {
      const res  = await apiFetch('/api/brooding/temperature', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          flockId:      selectedFlockId,
          penSectionId: flock?.penSectionId || '',
          zone:         tempForm.zone,
          tempCelsius:  parseFloat(tempForm.tempCelsius),
          humidity:     tempForm.humidity ? parseFloat(tempForm.humidity) : null,
          notes:        tempForm.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Failed', 'error');
      if (data.alert?.triggered) showToast('Temperature out of range — managers alerted!', 'warn');
      else showToast('Temperature logged');
      setTempForm({ zone:'Zone A', tempCelsius:'', humidity:'', notes:'' });
      loadTempData(selectedFlockId);
      loadFlocks();
    } catch { showToast('Network error', 'error'); }
    setTempSubmitting(false);
  }

  // ── Submit: End brooding ──────────────────────────────────────────────────
  async function handleEndBrooding(e) {
    e.preventDefault();
    if (!endModal || !endForm.endDate) return showToast('Enter end date', 'error');
    setEndSubmitting(true);
    try {
      const res  = await apiFetch(`/api/brooding/${endModal.id}/end-brooding`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ endDate: endForm.endDate, notes: endForm.notes || null }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.error || 'Failed', 'error');
      const nextLabel = endModal.operationType==='LAYER' ? 'Rearing' : 'Production';
      showToast(`Brooding ended. ${data.notified} worker(s) notified. Stage: ${nextLabel}.`);
      setEndModal(null);
      setEndForm({ endDate:'', notes:'' });
      loadFlocks();
    } catch { showToast('Network error', 'error'); }
    setEndSubmitting(false);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const layerFlocks   = flocks.filter(f => f.operationType === 'LAYER');
  const broilerFlocks = flocks.filter(f => f.operationType === 'BROILER');
  const selectedFlock = flocks.find(f => f.id === selectedFlockId);
  const tempBand      = selectedFlock ? getTempBand(selectedFlock.daysOld || 0) : { low:28, high:35 };
  const zones         = [...new Set(tempDaily.map(d => d.zone))];
  const chartData     = (() => {
    const byDay = {};
    for (const row of tempDaily) {
      if (!byDay[row.day]) byDay[row.day] = { day: row.day };
      byDay[row.day][row.zone] = row.avgTemp;
    }
    return Object.values(byDay).sort((a,b) => a.day.localeCompare(b.day));
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="page-content animate-in">

        {/* Header */}
        <div style={{ display:'flex',alignItems:'flex-start',justifyContent:'space-between',
          flexWrap:'wrap',gap:12,marginBottom:20 }}>
          <div>
            <h1 style={{ fontSize:22,fontWeight:800,color:'#1e293b',margin:0 }}>Brooding</h1>
            <div style={{ fontSize:13,color:'#64748b',marginTop:3 }}>
              Day-old intake · Temperature monitoring · Stage transitions
            </div>
          </div>
          <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
            <KpiCard label="Layer Batches"   value={layerFlocks.length}   color="#f59e0b" />
            <KpiCard label="Broiler Batches" value={broilerFlocks.length} color="#3b82f6" />
            <KpiCard label="Total Birds"
              value={fmt(flocks.reduce((s,f) => s + (f.currentCount||0), 0))}
              color="#6c63ff" />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex',gap:4,borderBottom:'2px solid #f1f5f9',marginBottom:20,flexWrap:'wrap' }}>
          {TABS.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)}
              style={{ padding:'9px 18px',border:'none',background:'none',cursor:'pointer',
                fontSize:13,fontWeight:activeTab===i?700:500,
                color:activeTab===i?'#6c63ff':'#64748b',
                borderBottom:activeTab===i?'2px solid #6c63ff':'2px solid transparent',
                marginBottom:-2,transition:'all .15s' }}>
              {tab}
              {tab==='Active Batches' && flocks.length > 0 && (
                <span style={{ marginLeft:6,background:'#6c63ff',color:'#fff',
                  borderRadius:20,padding:'1px 7px',fontSize:10,fontWeight:800 }}>
                  {flocks.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ══ TAB 0 — Active Batches ══ */}
        {activeTab === 0 && (
          <div>
            {loading ? (
              <div style={{ textAlign:'center',padding:60,color:'#94a3b8' }}>Loading batches…</div>
            ) : flocks.length === 0 ? (
              <div style={{ textAlign:'center',padding:60 }}>
                <div style={{ fontSize:48,marginBottom:12 }}>🐣</div>
                <div style={{ fontWeight:700,fontSize:16,marginBottom:8 }}>No brooding batches yet</div>
                <div style={{ color:'#64748b',fontSize:13,marginBottom:20 }}>
                  Log a new day-old intake to get started.
                </div>
                {canAct && (
                  <button onClick={() => setActiveTab(1)}
                    style={{ padding:'10px 24px',borderRadius:9,border:'none',
                      background:'#6c63ff',color:'#fff',fontWeight:700,fontSize:14,cursor:'pointer' }}>
                    + New Day-Old Intake
                  </button>
                )}
              </div>
            ) : (
              <div>
                {layerFlocks.length > 0 && (
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:13,fontWeight:700,color:'#f59e0b',marginBottom:10 }}>
                      Layer Brooding — 6-week programme
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(290px,1fr))',gap:14 }}>
                      {layerFlocks.map(flock => (
                        <FlockCard key={flock.id} flock={flock} canAct={canAct}
                          onEndBrooding={() => { setEndModal(flock); setEndForm({ endDate: new Date().toISOString().slice(0,10), notes:'' }); }}
                          onLogTemp={() => { setSelectedFlockId(flock.id); setActiveTab(3); }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {broilerFlocks.length > 0 && (
                  <div>
                    <div style={{ fontSize:13,fontWeight:700,color:'#3b82f6',marginBottom:10 }}>
                      Broiler Brooding — 2-week programme
                    </div>
                    <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(290px,1fr))',gap:14 }}>
                      {broilerFlocks.map(flock => (
                        <FlockCard key={flock.id} flock={flock} canAct={canAct}
                          onEndBrooding={() => { setEndModal(flock); setEndForm({ endDate: new Date().toISOString().slice(0,10), notes:'' }); }}
                          onLogTemp={() => { setSelectedFlockId(flock.id); setActiveTab(3); }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ TAB 1 — New Day-Old Intake ══ */}
        {activeTab === 1 && (
          <div style={{ maxWidth:560 }}>
            {!canAct ? (
              <div style={{ background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,
                padding:'14px 18px',color:'#92400e',fontSize:13 }}>
                Read-only access. Contact a Pen Manager to log intakes.
              </div>
            ) : (
              <form onSubmit={handleIntakeSubmit}>
                <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,padding:24 }}>
                  <h2 style={{ fontSize:15,fontWeight:700,marginBottom:4 }}>New Day-Old Intake</h2>
                  <p style={{ fontSize:12,color:'#64748b',marginBottom:18 }}>
                    Creates a new flock in BROODING stage and logs the first delivery manifest together.
                    Brooding tasks are auto-generated for the assigned pen section worker.
                  </p>

                  {/* Section A: Flock identity */}
                  <div style={{ fontSize:11,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',
                    letterSpacing:'.07em',marginBottom:12,paddingBottom:6,
                    borderBottom:'1px solid #f1f5f9' }}>
                    Flock Details
                  </div>

                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                    <Field label="Batch Code *">
                      <input type="text" value={intakeForm.batchCode} required
                        placeholder="e.g. ISA-2026-001"
                        onChange={e => setIntakeForm(f=>({...f, batchCode:e.target.value}))}
                        style={inputSt} />
                    </Field>
                    <Field label="Operation Type *">
                      <select value={intakeForm.operationType}
                        onChange={e => setIntakeForm(f=>({...f, operationType:e.target.value, penSectionId:''}))}
                        style={inputSt}>
                        <option value="LAYER">Layer</option>
                        <option value="BROILER">Broiler</option>
                      </select>
                    </Field>
                  </div>

                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                    <Field label="Breed *">
                      <input type="text" value={intakeForm.breed} required
                        placeholder="e.g. ISA Brown, Ross 308"
                        onChange={e => setIntakeForm(f=>({...f, breed:e.target.value}))}
                        style={inputSt} />
                    </Field>
                    <Field label="Placement Date *">
                      <input type="date" value={intakeForm.dateOfPlacement} required
                        onChange={e => setIntakeForm(f=>({...f, dateOfPlacement:e.target.value}))}
                        style={inputSt} />
                    </Field>
                  </div>

                  <Field label="Pen Section *"
                    hint={sectionsForIntake.length === 0
                      ? `No ${intakeForm.operationType === 'LAYER' ? 'layer' : 'broiler'} sections found. Create a pen in Farm Structure first.`
                      : broodingPurposeSections.length === 0
                        ? 'Tip: mark a pen as "Brooding" purpose in Farm Structure for better filtering.'
                        : undefined}>
                    <select value={intakeForm.penSectionId} required
                      onChange={e => setIntakeForm(f=>({...f, penSectionId:e.target.value}))}
                      style={inputSt}>
                      <option value="">— Select section —</option>
                      {sectionsForIntake.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.penName} · {s.name}
                          {s.penPurpose === 'BROODING' ? ' 🐣' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                    <Field label="Initial Bird Count *">
                      <input type="number" min="1" value={intakeForm.initialCount} required
                        placeholder="e.g. 5000"
                        onChange={e => setIntakeForm(f=>({...f, initialCount:e.target.value}))}
                        style={inputSt} />
                    </Field>
                    <Field label="Source">
                      <select value={intakeForm.source}
                        onChange={e => setIntakeForm(f=>({...f, source:e.target.value}))}
                        style={inputSt}>
                        <option value="PURCHASED">Purchased</option>
                        <option value="OWN_HATCHERY">Own Hatchery</option>
                        <option value="TRANSFERRED">Transferred</option>
                      </select>
                    </Field>
                  </div>

                  <Field label="Flock Purchase Cost (total, optional)">
                    <input type="number" min="0" step="0.01" value={intakeForm.purchaseCost}
                      placeholder="Total cost for this flock"
                      onChange={e => setIntakeForm(f=>({...f, purchaseCost:e.target.value}))}
                      style={inputSt} />
                  </Field>

                  {/* Section B: Delivery details */}
                  <div style={{ fontSize:11,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',
                    letterSpacing:'.07em',margin:'20px 0 12px',paddingBottom:6,
                    borderBottom:'1px solid #f1f5f9' }}>
                    Delivery Details
                  </div>

                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                    <Field label="Supplier / Hatchery">
                      <input type="text" value={intakeForm.supplier}
                        placeholder="Hatchery name"
                        onChange={e => setIntakeForm(f=>({...f, supplier:e.target.value}))}
                        style={inputSt} />
                    </Field>
                    <Field label="Dead on Arrival (DOA)">
                      <input type="number" min="0" value={intakeForm.doaCount}
                        onChange={e => setIntakeForm(f=>({...f, doaCount:e.target.value}))}
                        style={inputSt} />
                    </Field>
                  </div>

                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                    <Field label="Cost per Chick">
                      <input type="number" min="0" step="0.01" value={intakeForm.chickCostPerBird}
                        placeholder="e.g. 450"
                        onChange={e => setIntakeForm(f=>({...f, chickCostPerBird:e.target.value}))}
                        style={inputSt} />
                    </Field>
                    <Field label="Currency">
                      <select value={intakeForm.currency}
                        onChange={e => setIntakeForm(f=>({...f, currency:e.target.value}))}
                        style={inputSt}>
                        {['NGN','USD','GHS','KES','ZAR'].map(c=><option key={c}>{c}</option>)}
                      </select>
                    </Field>
                  </div>

                  <Field label="Notes">
                    <textarea value={intakeForm.notes} rows={2}
                      placeholder="Transport conditions, health observations on arrival…"
                      onChange={e => setIntakeForm(f=>({...f, notes:e.target.value}))}
                      style={{ ...inputSt, resize:'vertical' }} />
                  </Field>

                  <div style={{ background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,
                    padding:'10px 14px',marginBottom:14,fontSize:12,color:'#1e40af' }}>
                    Brooding tasks will be auto-generated for the assigned pen section worker on submission.
                  </div>

                  <button type="submit" disabled={intakeSubmitting}
                    style={{ width:'100%',padding:'11px',borderRadius:9,border:'none',
                      background:intakeSubmitting?'#e2e8f0':'#6c63ff',color:'#fff',
                      fontWeight:700,fontSize:14,cursor:intakeSubmitting?'default':'pointer' }}>
                    {intakeSubmitting ? 'Creating…' : '🐣 Log Day-Old Intake'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ══ TAB 2 — Log Delivery (additional truck) ══ */}
        {activeTab === 2 && (
          <div style={{ maxWidth:520 }}>
            {!canAct ? (
              <div style={{ background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,
                padding:'14px 18px',color:'#92400e',fontSize:13 }}>
                Read-only access.
              </div>
            ) : flocks.length === 0 ? (
              <div style={{ background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10,
                padding:'20px',color:'#64748b',fontSize:13 }}>
                No BROODING-stage flocks found. Create a new intake first (New Intake tab).
              </div>
            ) : (
              <form onSubmit={handleDeliverySubmit}>
                <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,padding:24 }}>
                  <h2 style={{ fontSize:15,fontWeight:700,marginBottom:4 }}>Log Additional Delivery</h2>
                  <p style={{ fontSize:12,color:'#64748b',marginBottom:16 }}>
                    Use this for additional trucks arriving for an existing flock (e.g. second delivery on same day).
                  </p>

                  <Field label="Flock *">
                    <select value={delForm.flockId} required
                      onChange={e => setDelForm(f=>({...f, flockId:e.target.value}))}
                      style={inputSt}>
                      <option value="">Select flock</option>
                      {flocks.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.batchCode} · {f.penSection?.pen?.name} · {f.penSection?.name}
                          ({f.operationType==='LAYER'?'Layer':'Broiler'})
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                    <Field label="Delivery Code *">
                      <input type="text" value={delForm.batchCode} required
                        placeholder="e.g. DEL-2026-002"
                        onChange={e => setDelForm(f=>({...f, batchCode:e.target.value}))}
                        style={inputSt} />
                    </Field>
                    <Field label="Arrival Date *">
                      <input type="date" value={delForm.arrivalDate} required
                        onChange={e => setDelForm(f=>({...f, arrivalDate:e.target.value}))}
                        style={inputSt} />
                    </Field>
                  </div>

                  <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12 }}>
                    <Field label="Chicks Received *">
                      <input type="number" min="1" value={delForm.chicksReceived} required
                        onChange={e => setDelForm(f=>({...f, chicksReceived:e.target.value}))}
                        style={inputSt} />
                    </Field>
                    <Field label="Dead on Arrival">
                      <input type="number" min="0" value={delForm.doaCount}
                        onChange={e => setDelForm(f=>({...f, doaCount:e.target.value}))}
                        style={inputSt} />
                    </Field>
                  </div>

                  <Field label="Supplier">
                    <input type="text" value={delForm.supplier}
                      onChange={e => setDelForm(f=>({...f, supplier:e.target.value}))}
                      style={inputSt} />
                  </Field>

                  <button type="submit" disabled={delSubmitting}
                    style={{ width:'100%',padding:'11px',borderRadius:9,border:'none',
                      background:delSubmitting?'#e2e8f0':'#6c63ff',color:'#fff',
                      fontWeight:700,fontSize:14,cursor:delSubmitting?'default':'pointer' }}>
                    {delSubmitting ? 'Logging…' : 'Log Delivery'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ══ TAB 3 — Temperature ══ */}
        {activeTab === 3 && (
          <div>
            <div style={{ display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:16 }}>
              <select value={selectedFlockId}
                onChange={e => setSelectedFlockId(e.target.value)}
                style={{ ...inputSt, maxWidth:300 }}>
                <option value="">Select flock</option>
                {flocks.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.batchCode} ({f.operationType==='LAYER'?'Layer':'Broiler'}, Day {f.daysOld||0})
                  </option>
                ))}
              </select>
              {selectedFlock && (
                <span style={{ fontSize:12,color:'#64748b' }}>
                  Target: <strong>{tempBand.label}</strong>
                </span>
              )}
            </div>

            {selectedFlockId ? (
              tempLoading ? (
                <div style={{ textAlign:'center',padding:40,color:'#94a3b8' }}>Loading…</div>
              ) : chartData.length === 0 ? (
                <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,
                  padding:40,textAlign:'center',color:'#94a3b8' }}>
                  No temperature readings yet for this batch.
                </div>
              ) : (
                <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,
                  padding:20,marginBottom:16 }}>
                  <div style={{ fontWeight:700,fontSize:14,marginBottom:14 }}>
                    Brooder Temperature — {selectedFlock?.batchCode}
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData} margin={{ top:5,right:20,bottom:5,left:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="day" tick={{ fontSize:11 }} />
                      <YAxis domain={[16,44]} tick={{ fontSize:11 }} />
                      <Tooltip formatter={(v,name) => [`${v}°C`, name]} />
                      <Legend />
                      <ReferenceLine y={tempBand.high} stroke="#f59e0b" strokeDasharray="4 4" />
                      <ReferenceLine y={tempBand.low}  stroke="#3b82f6" strokeDasharray="4 4" />
                      <ReferenceLine y={38} stroke="#ef4444" strokeDasharray="2 2" />
                      <ReferenceLine y={26} stroke="#ef4444" strokeDasharray="2 2" />
                      {zones.map((zone, i) => (
                        <Line key={zone} type="monotone" dataKey={zone}
                          stroke={ZONE_COLORS[i % ZONE_COLORS.length]}
                          strokeWidth={2} dot={{ r:3 }} activeDot={{ r:5 }} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )
            ) : (
              <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,
                padding:40,textAlign:'center',color:'#94a3b8' }}>
                Select a flock to view temperature history.
              </div>
            )}

            {canAct && selectedFlockId && (
              <div style={{ background:'#fff',border:'1px solid #e8edf5',borderRadius:12,padding:20 }}>
                <h3 style={{ fontSize:14,fontWeight:700,marginBottom:14 }}>Log Temperature Reading</h3>
                <form onSubmit={handleTempSubmit}>
                  <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12 }}>
                    <Field label="Zone">
                      <select value={tempForm.zone}
                        onChange={e => setTempForm(f=>({...f,zone:e.target.value}))} style={inputSt}>
                        {['Zone A','Zone B','Zone C','Zone D'].map(z=><option key={z}>{z}</option>)}
                      </select>
                    </Field>
                    <Field label="Temperature °C *">
                      <input type="number" step="0.1" required value={tempForm.tempCelsius}
                        placeholder="e.g. 30.5"
                        onChange={e => setTempForm(f=>({...f,tempCelsius:e.target.value}))} style={inputSt} />
                    </Field>
                    <Field label="Humidity %">
                      <input type="number" step="1" min="0" max="100" value={tempForm.humidity}
                        onChange={e => setTempForm(f=>({...f,humidity:e.target.value}))} style={inputSt} />
                    </Field>
                  </div>
                  <button type="submit" disabled={tempSubmitting}
                    style={{ padding:'9px 22px',borderRadius:8,border:'none',
                      background:tempSubmitting?'#e2e8f0':'#6c63ff',color:'#fff',
                      fontWeight:700,fontSize:13,cursor:tempSubmitting?'default':'pointer' }}>
                    {tempSubmitting ? 'Saving…' : 'Log Reading'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ End Brooding Modal ══ */}
      {endModal && (
        <Modal title={`End Brooding — ${endModal.batchCode}`} onClose={() => setEndModal(null)}>
          <div style={{ background:'#f8fafc',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13 }}>
            {endModal.operationType==='LAYER' ? 'Layer' : 'Broiler'} ·{' '}
            {fmt(endModal.currentCount)} birds · Day {endModal.daysOld||0} of brooding
            <br/>
            <span style={{ color:'#64748b',fontSize:12 }}>
              {endModal.operationType==='LAYER'
                ? 'Birds remain in this pen. Stage advances to Rearing. Target pen move to cages: Week 13.'
                : 'Stage advances to Production. Grow-out tracking begins.'}
            </span>
          </div>
          <form onSubmit={handleEndBrooding}>
            <Field label="Brooding End Date *">
              <input type="date" value={endForm.endDate} required
                onChange={e => setEndForm(f=>({...f,endDate:e.target.value}))} style={inputSt} />
            </Field>
            <Field label="Notes">
              <textarea value={endForm.notes} rows={3}
                placeholder="Final observations, bird condition notes…"
                onChange={e => setEndForm(f=>({...f,notes:e.target.value}))}
                style={{ ...inputSt, resize:'vertical' }} />
            </Field>
            <div style={{ background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,
              padding:'10px 14px',marginBottom:14,fontSize:12,color:'#1e40af' }}>
              All workers on this section will be notified. Task templates update from tomorrow.
            </div>
            <div style={{ display:'flex',gap:10 }}>
              <button type="button" onClick={() => setEndModal(null)}
                style={{ flex:1,padding:'9px',borderRadius:8,border:'1.5px solid #e2e8f0',
                  background:'#fff',fontWeight:600,fontSize:13,cursor:'pointer',color:'#475569' }}>
                Cancel
              </button>
              <button type="submit" disabled={endSubmitting}
                style={{ flex:2,padding:'9px',borderRadius:8,border:'none',
                  background:endSubmitting?'#e2e8f0':'#6c63ff',color:'#fff',
                  fontWeight:700,fontSize:13,cursor:endSubmitting?'default':'pointer' }}>
                {endSubmitting ? 'Advancing…'
                  : endModal.operationType==='LAYER' ? 'End Brooding, Start Rearing'
                  : 'End Brooding, Start Production'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <Toast msg={toast.msg} type={toast.type} />
    </AppShell>
  );
}
