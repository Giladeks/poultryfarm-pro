'use client';
import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const STEPS = ['Feed', 'Mortality', 'Eggs', 'Observations'];
const STEP_ICONS = ['🌾','📉','🥚','📝'];

export default function WorkerPage() {
  const { apiFetch, user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState({});
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ feedKg:'', mortalityCount:'', mortalityCause:'UNKNOWN', eggsTotal:'', eggsGradeA:'', eggsGradeB:'', eggsCracked:'', observations:'' });
  const [selectedSection, setSelectedSection] = useState(null);
  const [successStep, setSuccessStep] = useState(null);

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    try {
      const res = await apiFetch('/api/tasks');
      if (res.ok) { const d = await res.json(); setTasks(d.tasks||[]); }
    } finally { setLoading(false); }
  };

  const handleComplete = async (taskId) => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/tasks?action=complete', { method:'POST', body: JSON.stringify({ taskId, completionNotes:'Completed via mobile check-in' }) });
      if (res.ok) loadTasks();
    } finally { setSaving(false); }
  };

  const submitStep = async () => {
    setSaving(true);
    try {
      await new Promise(r => setTimeout(r, 600));
      setSuccessStep(step);
      setSubmitted(p => ({ ...p, [step]: true }));
      setTimeout(() => { setSuccessStep(null); if (step < STEPS.length-1) setStep(s=>s+1); }, 900);
    } finally { setSaving(false); }
  };

  const completedCount = tasks.filter(t=>t.status==='COMPLETED').length;
  const totalCount = tasks.length;
  const pct = totalCount > 0 ? Math.round((completedCount/totalCount)*100) : 0;

  return (
    <AppShell>
      <div className="animate-in">
        {/* Header */}
        <div style={{ marginBottom:24 }}>
          <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:'var(--text-primary)', margin:0 }}>
            Good morning, {user?.firstName || 'Worker'} 👋
          </h1>
          <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>Daily check-in · {new Date().toLocaleDateString('en-NG',{weekday:'long',day:'numeric',month:'long'})}</p>
        </div>

        {/* Progress bar */}
        <div className="card" style={{ marginBottom:20, padding:'18px 20px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>Today's Progress</span>
            <span style={{ fontFamily:"'Poppins',sans-serif", fontSize:20, fontWeight:700, color:'var(--purple)' }}>{pct}%</span>
          </div>
          <div className="progress-bar" style={{ height:10 }}>
            <div className="progress-fill" style={{ width:`${pct}%`, background:'linear-gradient(90deg,#6c63ff,#48c774)', transition:'width 0.6s ease' }} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', marginTop:8, fontSize:11, color:'var(--text-muted)' }}>
            <span>{completedCount} completed</span>
            <span>{totalCount - completedCount} remaining</span>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:16 }}>
          {/* Check-in stepper */}
          <div className="card">
            <div className="section-header">Daily Check-in</div>

            {/* Step indicators */}
            <div style={{ display:'flex', gap:0, marginBottom:24 }}>
              {STEPS.map((s,i) => (
                <div key={s} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', position:'relative' }}>
                  {i > 0 && <div style={{ position:'absolute', left:0, top:18, width:'50%', height:2, background: i<=step ? 'var(--purple)' : 'var(--border)' }} />}
                  {i < STEPS.length-1 && <div style={{ position:'absolute', right:0, top:18, width:'50%', height:2, background: i<step ? 'var(--purple)' : 'var(--border)' }} />}
                  <div style={{ width:36, height:36, borderRadius:'50%', background: submitted[i] ? 'var(--green)' : i===step ? 'var(--purple)' : 'var(--bg-elevated)', border: `2px solid ${submitted[i] ? 'var(--green)' : i===step ? 'var(--purple)' : 'var(--border)'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, transition:'all 0.3s', zIndex:1, position:'relative' }}>
                    {submitted[i] ? '✓' : STEP_ICONS[i]}
                  </div>
                  <div style={{ fontSize:10, marginTop:6, color: i===step ? 'var(--purple)' : 'var(--text-muted)', fontWeight: i===step ? 700 : 400 }}>{s}</div>
                </div>
              ))}
            </div>

            {/* Step content */}
            <div style={{ transition:'all 0.3s' }}>
              {step === 0 && (
                <StepCard title="Feed Record" icon="🌾" color="var(--green)">
                  <label className="label">Feed given today (kg)</label>
                  <input type="number" value={form.feedKg} onChange={e=>setForm(p=>({...p,feedKg:e.target.value}))} className="input" placeholder="e.g. 250" />
                </StepCard>
              )}
              {step === 1 && (
                <StepCard title="Mortality Count" icon="📉" color="var(--red)">
                  <label className="label">Deaths recorded today</label>
                  <input type="number" value={form.mortalityCount} onChange={e=>setForm(p=>({...p,mortalityCount:e.target.value}))} className="input" style={{ marginBottom:12 }} placeholder="0" />
                  <label className="label">Primary cause</label>
                  <select value={form.mortalityCause} onChange={e=>setForm(p=>({...p,mortalityCause:e.target.value}))} className="input">
                    {['UNKNOWN','DISEASE','INJURY','HEAT_STRESS','FEED_ISSUE','PREDATOR','CULLED'].map(c => <option key={c} value={c}>{c.replace('_',' ')}</option>)}
                  </select>
                </StepCard>
              )}
              {step === 2 && (
                <StepCard title="Egg Collection" icon="🥚" color="var(--amber)">
                  <label className="label">Total eggs collected</label>
                  <input type="number" value={form.eggsTotal} onChange={e=>setForm(p=>({...p,eggsTotal:e.target.value}))} className="input" style={{ marginBottom:12 }} placeholder="e.g. 1800" />
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                    {[['eggsGradeA','Grade A','var(--green)'],['eggsGradeB','Grade B','var(--amber)'],['eggsCracked','Cracked','var(--red)']].map(([k,label,c]) => (
                      <div key={k}><label className="label" style={{ color:c }}>{label}</label><input type="number" value={form[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} className="input" placeholder="0" /></div>
                    ))}
                  </div>
                </StepCard>
              )}
              {step === 3 && (
                <StepCard title="Observations" icon="📝" color="var(--blue)">
                  <label className="label">Notes & observations</label>
                  <textarea value={form.observations} onChange={e=>setForm(p=>({...p,observations:e.target.value}))} className="input" rows={4} placeholder="Any health concerns, equipment issues, or general observations…" style={{ resize:'vertical' }} />
                </StepCard>
              )}
            </div>

            {/* Step navigation */}
            <div style={{ display:'flex', gap:8, marginTop:20 }}>
              {step > 0 && <button onClick={() => setStep(s=>s-1)} className="btn btn-ghost" style={{ flex:1 }}>← Back</button>}
              <button onClick={submitted[step] ? () => setStep(s=>Math.min(s+1,STEPS.length-1)) : submitStep}
                disabled={saving}
                className="btn btn-primary" style={{ flex:3 }}>
                {saving ? 'Saving…' : submitted[step] ? 'Next →' : step === STEPS.length-1 ? '✓ Submit Check-in' : `Submit ${STEPS[step]} →`}
              </button>
            </div>

            {successStep !== null && (
              <div className="alert alert-green" style={{ marginTop:12, justifyContent:'center' }}>
                <span>✅</span><span><strong>{STEPS[successStep]}</strong> recorded successfully!</span>
              </div>
            )}
          </div>

          {/* Task list */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="card">
              <div className="section-header">My Tasks ({totalCount})</div>
              {loading ? <div style={{ height:120, background:'var(--bg-elevated)', borderRadius:8 }} /> : tasks.length === 0 ? (
                <div style={{ textAlign:'center', padding:'24px 0', color:'var(--text-muted)', fontSize:13 }}>✅ No tasks assigned today</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {tasks.map(t => (
                    <div key={t.id} style={{ padding:'12px', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, transition:'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor='var(--purple)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>{t.title}</div>
                        <span className={`status-badge ${t.status==='COMPLETED'?'status-green':t.status==='OVERDUE'?'status-red':t.status==='IN_PROGRESS'?'status-blue':'status-grey'}`}>{t.status}</span>
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:t.status!=='COMPLETED'?8:0 }}>{t.penSection?.pen?.name} · {t.penSection?.name}</div>
                      {t.status !== 'COMPLETED' && (
                        <button onClick={() => handleComplete(t.id)} disabled={saving} className="btn btn-primary" style={{ width:'100%', fontSize:12, padding:'6px' }}>
                          ✓ Mark Done
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="card">
              <div className="section-header">Quick Actions</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[['🌾 Record Feed','var(--green)',0],['📉 Log Mortality','var(--red)',1],['🥚 Collect Eggs','var(--amber)',2]].map(([label,color,s]) => (
                  <button key={label} onClick={() => setStep(s)} className="btn btn-ghost" style={{ justifyContent:'flex-start', padding:'10px 14px', borderLeft:`3px solid ${color}` }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StepCard({ title, icon, color, children }) {
  return (
    <div style={{ animation:'fadeInUp 0.25s ease forwards' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, padding:'10px 14px', background:`${color}10`, borderRadius:9, border:`1px solid ${color}30` }}>
        <span style={{ fontSize:22 }}>{icon}</span>
        <span style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
