// app/auth/login/page.js
// UI polish: left panel replaced with solid purple brand panel (no blob/floating decorations).
// Dead nav links removed. Logic and demo accounts unchanged.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/layout/AuthProvider';

const DEMO_ACCOUNTS = [
  { label: 'Farm Owner',   email: 'owner@greenacres.ng',       password: 'owner123',   color: '#6c63ff' },
  { label: 'Farm Manager', email: 'manager@greenacres.ng',     password: 'manager123', color: '#22c55e' },
  { label: 'Pen Manager',  email: 'penmanager1@greenacres.ng', password: 'pm123',      color: '#f59e0b' },
  { label: 'Pen Worker',   email: 'worker1@greenacres.ng',     password: 'worker123',  color: '#ef4444' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [form, setForm]               = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  const go = (user) => {
    router.push(user.role === 'CHAIRPERSON' ? '/owner' : '/dashboard');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError(''); setLoading(true);
    try { go(await login(form.email, form.password)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const quickLogin = async (acc) => {
    setError(''); setLoading(true);
    try { go(await login(acc.email, acc.password)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Poppins:wght@600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:'Nunito',sans-serif;min-height:100vh;}

        /* ── Two-panel layout ── */
        .lp-wrap{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;}

        /* ── Left: solid brand panel ── */
        .lp-brand{
          background:linear-gradient(160deg,#5a52e8 0%,#6c63ff 55%,#7c73ff 100%);
          display:flex;flex-direction:column;justify-content:center;
          padding:64px 60px;position:relative;overflow:hidden;
        }
        /* subtle dot pattern overlay */
        .lp-brand::before{
          content:'';position:absolute;inset:0;opacity:1;
          background-image:radial-gradient(circle,rgba(255,255,255,0.07) 1px,transparent 1px);
          background-size:28px 28px;
        }
        .lp-brand-inner{position:relative;z-index:1;}
        .lp-logorow{display:flex;align-items:center;gap:12px;margin-bottom:52px;}
        .lp-logoicon{
          width:46px;height:46px;border-radius:13px;
          background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.28);
          display:flex;align-items:center;justify-content:center;font-size:26px;
        }
        .lp-logoname{font-family:'Poppins',sans-serif;font-size:17px;font-weight:700;color:#fff;line-height:1.15;}
        .lp-logosub{font-size:11px;color:rgba(255,255,255,0.6);font-weight:400;}
        .lp-headline{
          font-family:'Poppins',sans-serif;font-size:32px;font-weight:700;
          color:#fff;line-height:1.25;margin-bottom:18px;
        }
        .lp-tagline{font-size:14px;color:rgba(255,255,255,0.72);line-height:1.75;max-width:330px;margin-bottom:52px;}
        .lp-stats{display:flex;gap:36px;}
        .lp-stat-val{font-family:'Poppins',sans-serif;font-size:22px;font-weight:700;color:#fff;line-height:1;}
        .lp-stat-lbl{font-size:11px;color:rgba(255,255,255,0.55);margin-top:4px;}

        /* ── Right: form panel ── */
        .lp-form{
          background:#f0f2f5;display:flex;align-items:center;
          justify-content:center;padding:48px 52px;
        }
        .lp-form-inner{width:100%;max-width:390px;}
        .lp-title{font-family:'Poppins',sans-serif;font-size:23px;font-weight:700;color:#1a1a2e;margin-bottom:5px;}
        .lp-sub{font-size:13px;color:#9ca3af;margin-bottom:30px;}

        .field{margin-bottom:17px;}
        .field label{display:block;font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;}
        .fw{position:relative;}
        .field input{
          width:100%;background:#fff;border:1.5px solid #e5e7eb;border-radius:9px;
          padding:12px 14px;font-size:14px;font-family:'Nunito',sans-serif;color:#1a1a2e;
          transition:border-color 0.2s,box-shadow 0.2s;outline:none;
        }
        .field input:focus{border-color:#6c63ff;box-shadow:0 0 0 3px rgba(108,99,255,0.1);background:#fff;}
        .field input::placeholder{color:#9ca3af;}
        .eye{position:absolute;right:13px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:15px;color:#9ca3af;padding:2px;}

        .lp-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
        .lp-rem{display:flex;align-items:center;gap:7px;font-size:13px;color:#6b7280;cursor:pointer;}
        .lp-rem input{width:15px;height:15px;accent-color:#6c63ff;cursor:pointer;}
        .lp-fgt{font-size:13px;color:#6c63ff;font-weight:700;background:none;border:none;cursor:pointer;font-family:inherit;}

        .lp-err{background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:13px;color:#dc2626;margin-bottom:14px;text-align:center;}

        .lp-btn{
          width:100%;background:#6c63ff;color:#fff;border:none;border-radius:9px;
          padding:13px;font-size:15px;font-weight:700;font-family:'Nunito',sans-serif;
          cursor:pointer;transition:all 0.2s;box-shadow:0 4px 14px rgba(108,99,255,0.32);
        }
        .lp-btn:hover{background:#5a52e8;box-shadow:0 6px 20px rgba(108,99,255,0.42);}
        .lp-btn:active{transform:scale(0.99);}
        .lp-btn:disabled{opacity:0.65;cursor:not-allowed;}

        .lp-div{display:flex;align-items:center;gap:12px;margin:22px 0 17px;}
        .lp-divl{flex:1;height:1px;background:#e5e7eb;}
        .lp-div span{font-size:12px;color:#9ca3af;white-space:nowrap;}

        .lp-dgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .lp-dbtn{
          background:#fff;border:1.5px solid #e5e7eb;border-radius:9px;
          padding:10px 12px;cursor:pointer;text-align:left;font-family:'Nunito',sans-serif;
          transition:all 0.15s;
        }
        .lp-dbtn:hover{border-color:#6c63ff;background:#f5f4ff;transform:translateY(-1px);box-shadow:0 2px 8px rgba(108,99,255,0.1);}
        .lp-dbtn:disabled{opacity:0.6;cursor:not-allowed;transform:none;}
        .lp-drole{font-size:12px;font-weight:700;margin-bottom:2px;}
        .lp-demail{font-size:10px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

        .lp-foot{text-align:center;font-size:11px;color:#d1d5db;margin-top:22px;}

        @media(max-width:720px){
          .lp-wrap{grid-template-columns:1fr;}
          .lp-brand{display:none;}
          .lp-form{padding:36px 24px;}
        }
      `}</style>

      <div className="lp-wrap">

        {/* ── Left: brand panel ── */}
        <div className="lp-brand">
          <div className="lp-brand-inner">
            <div className="lp-logorow">
              <div className="lp-logoicon">🐔</div>
              <div>
                <div className="lp-logoname">PoultryFarm Pro</div>
                <div className="lp-logosub">Farm management, simplified</div>
              </div>
            </div>

            <h1 className="lp-headline">
              Everything your<br />farm needs,<br />in one place.
            </h1>
            <p className="lp-tagline">
              Track flocks, monitor health, record production and grow your
              profitability with real-time data — from any device.
            </p>

            <div className="lp-stats">
              {[
                { val: '500+',  lbl: 'Farms onboarded' },
                { val: '2M+',   lbl: 'Birds tracked'   },
                { val: '99.9%', lbl: 'Uptime'          },
              ].map(s => (
                <div key={s.lbl}>
                  <div className="lp-stat-val">{s.val}</div>
                  <div className="lp-stat-lbl">{s.lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: form ── */}
        <div className="lp-form">
          <div className="lp-form-inner">
            <div className="lp-title">Welcome back</div>
            <div className="lp-sub">Sign in to your farm dashboard</div>

            <form onSubmit={handleSubmit}>
              <div className="field">
                <label>Email</label>
                <input
                  type="email" placeholder="you@yourfarm.ng"
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  autoComplete="email" required
                />
              </div>

              <div className="field">
                <label>Password</label>
                <div className="fw">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    autoComplete="current-password" required
                    style={{ paddingRight: 42 }}
                  />
                  <button type="button" className="eye" onClick={() => setShowPassword(p => !p)} tabIndex={-1}>
                    {showPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              <div className="lp-row">
                <label className="lp-rem">
                  <input type="checkbox" /> Remember me
                </label>
                <button type="button" className="lp-fgt">Forgot password?</button>
              </div>

              {error && <div className="lp-err">{error}</div>}

              <button type="submit" className="lp-btn" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <div className="lp-div">
              <div className="lp-divl" />
              <span>Or use a demo account</span>
              <div className="lp-divl" />
            </div>

            <div className="lp-dgrid">
              {DEMO_ACCOUNTS.map(acc => (
                <button key={acc.email} className="lp-dbtn" onClick={() => quickLogin(acc)} disabled={loading}>
                  <div className="lp-drole" style={{ color: acc.color }}>{acc.label}</div>
                  <div className="lp-demail">{acc.email}</div>
                </button>
              ))}
            </div>

            <div className="lp-foot">PoultryFarm Pro v1.0 · © 2026</div>
          </div>
        </div>
      </div>
    </>
  );
}
