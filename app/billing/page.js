'use client';
import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const PLAN_COLORS = { Starter:'#22c55e', Professional:'#6c63ff', Enterprise:'#8b5cf6', 'Founding Farm':'#f59e0b' };

export default function BillingPage() {
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(null);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cycle, setCycle] = useState('MONTHLY');

  useEffect(() => { loadBilling(); }, []);

  const loadBilling = async () => {
    try {
      const res = await apiFetch('/api/billing');
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  };

  const handleUpgrade = async (planId) => {
    setUpgrading(planId);
    try {
      const res = await apiFetch('/api/billing?action=create_checkout', { method:'POST', body: JSON.stringify({ planId, billingCycle:cycle }) });
      const d = await res.json();
      if (d.checkoutUrl) window.location.href = d.checkoutUrl;
    } finally { setUpgrading(null); }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await apiFetch('/api/billing?action=cancel', { method:'POST' });
      if (res.ok) { setShowCancel(false); loadBilling(); }
    } finally { setCancelling(false); }
  };

  const { subscription, plans=[] } = data || {};
  const currentPlan = subscription?.plan;
  const isFoundingFarm = currentPlan?.name === 'Founding Farm';
  const daysLeft = subscription?.currentPeriodEnd ? Math.max(0,Math.floor((new Date(subscription.currentPeriodEnd)-new Date())/86400000)) : null;

  const FEATURES = { flock_mgmt:'Flock Management', health:'Health Tracking', feed:'Feed Management', production:'Production Tracking', mobile_app:'Mobile App', csv_export:'CSV Export', basic_analytics:'Basic Analytics', advanced_analytics:'Advanced Analytics', predictive_ai:'Predictive AI', staff_tasks:'Staff Tasks', pdf_reports:'PDF Reports', compliance:'Compliance Reports' };

  return (
    <AppShell>
      <div className="animate-in">
        <div style={{ marginBottom:24 }}>
          <h1 style={{ fontFamily:"'Poppins',sans-serif", fontSize:22, fontWeight:700, color:'var(--text-primary)', margin:0 }}>Subscription & Billing</h1>
          <p style={{ color:'var(--text-muted)', fontSize:12, marginTop:3 }}>Manage your plan, payments and usage</p>
        </div>

        {/* Current plan card */}
        <div className="card" style={{ marginBottom:24, border:`1.5px solid ${PLAN_COLORS[currentPlan?.name]||'var(--border-card)'}30`, background:`linear-gradient(135deg, ${PLAN_COLORS[currentPlan?.name]||'#6c63ff'}05, #fff)` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
            <div>
              <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Current Plan</div>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <h2 style={{ fontFamily:"'Poppins',sans-serif", fontSize:26, fontWeight:700, color:'var(--text-primary)', margin:0 }}>
                  {loading ? '—' : currentPlan?.name || 'No Plan'}
                </h2>
                {subscription && <span className={`status-badge ${subscription.status==='ACTIVE'?'status-green':subscription.status==='TRIALING'?'status-blue':subscription.status==='PAST_DUE'?'status-red':'status-grey'}`}>{subscription.status}</span>}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              {isFoundingFarm ? (
                <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:28, fontWeight:700, color:'var(--amber)' }}>Free</div>
              ) : (
                <div>
                  <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:28, fontWeight:700, color:'var(--purple)' }}>
                    ${subscription?.billingCycle==='ANNUAL' ? Number(currentPlan?.annualPrice||0).toFixed(0) : Number(currentPlan?.monthlyPrice||0).toFixed(0)}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)' }}>/{subscription?.billingCycle==='ANNUAL'?'year':'month'}</div>
                </div>
              )}
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom: subscription?.status==='PAST_DUE' ? 16 : 0 }}>
            {[
              { label:'Bird Capacity', value: currentPlan?.maxBirds ? currentPlan.maxBirds.toLocaleString() : '—' },
              { label:'Max Users', value: currentPlan?.maxUsers===9999?'Unlimited':currentPlan?.maxUsers||'—' },
              { label:'Period Ends', value: subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}) : '—' },
              { label:'Days Remaining', value: daysLeft!==null ? `${daysLeft}d` : '—' },
            ].map(d => (
              <div key={d.label} style={{ background:'var(--bg-elevated)', borderRadius:9, padding:'10px 12px', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>{d.label}</div>
                <div style={{ fontSize:14, color:'var(--text-primary)', fontWeight:700 }}>{d.value}</div>
              </div>
            ))}
          </div>
          {subscription?.status==='PAST_DUE' && (
            <div className="alert alert-red"><span>⚠</span><span><strong>Payment overdue</strong> — update your payment method to avoid service interruption.</span></div>
          )}
          {!isFoundingFarm && subscription?.status==='ACTIVE' && (
            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <button onClick={() => setShowCancel(true)} className="btn btn-ghost" style={{ fontSize:12 }}>Cancel Subscription</button>
              <button className="btn btn-outline" style={{ fontSize:12 }}>Update Payment</button>
              <button className="btn btn-outline" style={{ fontSize:12 }}>Download Invoice</button>
            </div>
          )}
        </div>

        {/* Billing cycle toggle */}
        {!isFoundingFarm && (
          <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20 }}>
            <div style={{ display:'flex', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:9, padding:3 }}>
              {['MONTHLY','ANNUAL'].map(c => (
                <button key={c} onClick={() => setCycle(c)}
                  style={{ background:cycle===c?'#fff':'transparent', color:cycle===c?'var(--purple)':'var(--text-muted)', border:cycle===c?'1px solid var(--border)':'1px solid transparent', borderRadius:6, padding:'7px 18px', cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight:700, boxShadow:cycle===c?'var(--shadow-sm)':'none', transition:'all 0.15s' }}>
                  {c==='ANNUAL'?'Annual (Save 20%)':'Monthly'}
                </button>
              ))}
            </div>
            {cycle==='ANNUAL' && <span style={{ fontSize:12, color:'var(--green)', fontWeight:700 }}>✓ Save up to $470/year on Professional</span>}
          </div>
        )}

        {/* Plan cards */}
        <div className="card" style={{ marginBottom:24 }}>
          <div className="section-header">Available Plans</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {(loading ? [] : plans.filter(p=>p.name!=='Founding Farm')).map(plan => {
              const isCurrent = currentPlan?.id === plan.id;
              const pc = PLAN_COLORS[plan.name]||'#6c63ff';
              const price = cycle==='ANNUAL' ? plan.annualPrice : plan.monthlyPrice;
              const savings = Math.round(Number(plan.monthlyPrice)*12 - Number(plan.annualPrice));
              return (
                <div key={plan.id} style={{ background:'var(--bg-elevated)', border:`1.5px solid ${isCurrent ? pc+'60' : 'var(--border)'}`, borderRadius:12, padding:20, position:'relative', transition:'all 0.2s' }}
                  onMouseEnter={e => { if (!isCurrent) { e.currentTarget.style.borderColor=pc+'80'; e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='var(--shadow-md)'; }}}
                  onMouseLeave={e => { e.currentTarget.style.borderColor=isCurrent?pc+'60':'var(--border)'; e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}>
                  {isCurrent && (
                    <div style={{ position:'absolute', top:-10, left:'50%', transform:'translateX(-50%)', background:pc, color:'#fff', borderRadius:10, padding:'2px 12px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', whiteSpace:'nowrap' }}>Current Plan</div>
                  )}
                  <div style={{ fontSize:15, color:pc, fontWeight:700, marginBottom:6 }}>{plan.name}</div>
                  <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:28, fontWeight:700, color:'var(--text-primary)', lineHeight:1 }}>${Number(price).toFixed(0)}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:14 }}>/{cycle==='ANNUAL'?'year':'month'}{cycle==='ANNUAL'&&savings>0&&<span style={{ color:'var(--green)', marginLeft:6 }}>save ${savings}</span>}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:14 }}>Up to <strong style={{ color:'var(--text-primary)' }}>{plan.maxBirds.toLocaleString()}</strong> birds</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:16 }}>
                    {(plan.features||[]).slice(0,6).map(f => (
                      <div key={f} style={{ display:'flex', alignItems:'center', gap:7, fontSize:12 }}>
                        <span style={{ color:pc, fontWeight:700, flexShrink:0 }}>✓</span>
                        <span style={{ color:'var(--text-secondary)' }}>{FEATURES[f]||f}</span>
                      </div>
                    ))}
                  </div>
                  {isCurrent ? (
                    <div style={{ background:`${pc}15`, border:`1px solid ${pc}30`, borderRadius:7, padding:'8px', textAlign:'center', fontSize:12, color:pc, fontWeight:700 }}>✓ Active Plan</div>
                  ) : (
                    <button onClick={() => handleUpgrade(plan.id)} disabled={upgrading===plan.id}
                      style={{ width:'100%', background:pc, color:'#fff', border:'none', borderRadius:8, padding:'10px', fontSize:13, cursor:'pointer', fontFamily:'inherit', fontWeight:700, boxShadow:`0 4px 12px ${pc}30`, transition:'all 0.15s', opacity:upgrading===plan.id?0.7:1 }}>
                      {upgrading===plan.id?'Redirecting…':`Upgrade to ${plan.name} →`}
                    </button>
                  )}
                </div>
              );
            })}
            {/* Enterprise */}
            <div style={{ background:'var(--bg-elevated)', border:'1.5px solid #ede9fe', borderRadius:12, padding:20, transition:'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#8b5cf6'; e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='var(--shadow-md)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='#ede9fe'; e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}>
              <div style={{ fontSize:15, color:'#8b5cf6', fontWeight:700, marginBottom:6 }}>Enterprise</div>
              <div style={{ fontFamily:"'Poppins',sans-serif", fontSize:28, fontWeight:700, color:'var(--text-primary)', lineHeight:1 }}>Custom</div>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:14 }}>50,000+ birds · SLA guaranteed</div>
              {['Unlimited birds & users','Predictive AI analytics','Full white-labeling','Dedicated support','Custom SLA'].map(f => (
                <div key={f} style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, marginBottom:6 }}>
                  <span style={{ color:'#8b5cf6', fontWeight:700 }}>✓</span>
                  <span style={{ color:'var(--text-secondary)' }}>{f}</span>
                </div>
              ))}
              <button style={{ width:'100%', background:'#8b5cf6', color:'#fff', border:'none', borderRadius:8, padding:'10px', fontSize:13, cursor:'pointer', fontFamily:'inherit', fontWeight:700, marginTop:16 }}>Contact Sales →</button>
            </div>
          </div>
        </div>
      </div>

      {/* Cancel confirm modal */}
      {showCancel && (
        <div className="modal-overlay" onClick={() => setShowCancel(false)}>
          <div className="modal" style={{ width:420, maxWidth:'95vw', textAlign:'center' }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:40, marginBottom:12 }}>⚠️</div>
            <h2 style={{ fontFamily:"'Poppins',sans-serif", fontSize:20, fontWeight:700, color:'var(--text-primary)', marginBottom:10 }}>Cancel Subscription?</h2>
            <p style={{ color:'var(--text-secondary)', fontSize:13, lineHeight:1.6, marginBottom:20 }}>
              Your subscription will remain active until the end of the current billing period. All data will be retained for 30 days after expiry.
            </p>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-primary" onClick={() => setShowCancel(false)} style={{ flex:2 }}>Keep My Subscription</button>
              <button onClick={handleCancel} disabled={cancelling} className="btn btn-danger" style={{ flex:1 }}>{cancelling?'Cancelling…':'Cancel'}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
