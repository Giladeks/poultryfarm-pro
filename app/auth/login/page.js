// app/auth/login/page.js — Redesigned login matching light/purple SaaS style
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/layout/AuthProvider';

const DEMO_ACCOUNTS = [
  { label: 'Farm Owner', email: 'owner@greenacres.ng', password: 'owner123', color: '#6c63ff' },
  { label: 'Farm Manager', email: 'manager@greenacres.ng', password: 'manager123', color: '#48c774' },
  { label: 'Pen Manager', email: 'penmanager1@greenacres.ng', password: 'pm123', color: '#ffb347' },
  { label: 'Pen Worker', email: 'worker1@greenacres.ng', password: 'worker123', color: '#ff6b6b' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        body{font-family:'Nunito',sans-serif;background:#f0f2f5;min-height:100vh;}
        .page{min-height:100vh;background:#f0f2f5;display:flex;flex-direction:column;}
        .topnav{background:#fff;padding:0 40px;height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e8eaf0;}
        .logo{display:flex;align-items:center;gap:10px;font-family:'Poppins',sans-serif;font-weight:700;font-size:18px;color:#1a1a2e;text-decoration:none;}
        .logo-icon{width:34px;height:34px;background:linear-gradient(135deg,#6c63ff,#48c774);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;}
        .nav-right{font-size:14px;color:#6b7280;}
        .nav-right a{color:#6c63ff;font-weight:700;text-decoration:none;margin-left:5px;}
        .main{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 20px;}
        .container{width:100%;max-width:940px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;}
        .left{padding:10px 20px;position:relative;}
        .left .icon{font-size:54px;display:block;margin-bottom:10px;}
        .accent{width:56px;height:4px;background:linear-gradient(90deg,#ff6b9d,#ff8e53);border-radius:2px;margin-bottom:22px;}
        .left h1{font-family:'Poppins',sans-serif;font-size:36px;font-weight:700;color:#1a1a2e;line-height:1.2;margin-bottom:14px;}
        .left p{font-size:14px;color:#9ca3af;line-height:1.7;max-width:310px;}
        .blob{position:absolute;bottom:-30px;left:-40px;width:260px;height:180px;background:radial-gradient(ellipse,#e8e6ff 0%,transparent 70%);border-radius:50%;z-index:0;pointer-events:none;}
        .deco{position:absolute;font-size:26px;animation:float 4s ease-in-out infinite;opacity:0.75;}
        .d1{bottom:30px;left:10px;animation-delay:0s;}
        .d2{top:10px;right:30px;font-size:20px;animation-delay:1.5s;}
        .d3{bottom:70px;right:10px;font-size:17px;animation-delay:0.8s;}
        @keyframes float{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
        .card{background:#fff;border:1.5px solid #d4d8ff;border-radius:16px;padding:36px 32px;box-shadow:0 4px 24px rgba(108,99,255,0.09);}
        .card h2{font-family:'Poppins',sans-serif;font-size:23px;font-weight:700;color:#1a1a2e;text-align:center;margin-bottom:26px;}
        .field{margin-bottom:16px;}
        .field label{display:block;font-size:13px;font-weight:700;color:#374151;margin-bottom:5px;}
        .fw{position:relative;}
        .field input{width:100%;background:#f3f4f6;border:1.5px solid #e5e7eb;border-radius:8px;padding:11px 14px;font-size:14px;font-family:'Nunito',sans-serif;color:#1a1a2e;transition:border-color 0.2s,box-shadow 0.2s;outline:none;}
        .field input:focus{border-color:#6c63ff;box-shadow:0 0 0 3px rgba(108,99,255,0.12);background:#fff;}
        .field input::placeholder{color:#9ca3af;}
        .eye{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:15px;color:#9ca3af;padding:2px;}
        .row{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
        .rem{display:flex;align-items:center;gap:7px;font-size:13px;color:#6b7280;cursor:pointer;}
        .rem input{width:15px;height:15px;accent-color:#6c63ff;cursor:pointer;}
        .fgt{font-size:13px;color:#6c63ff;font-weight:700;text-decoration:none;cursor:pointer;background:none;border:none;font-family:inherit;}
        .err{background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:13px;color:#dc2626;margin-bottom:14px;text-align:center;}
        .btn{width:100%;background:#6c63ff;color:#fff;border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:700;font-family:'Nunito',sans-serif;cursor:pointer;transition:background 0.2s,box-shadow 0.2s,transform 0.1s;box-shadow:0 4px 14px rgba(108,99,255,0.35);letter-spacing:0.3px;}
        .btn:hover{background:#5a52e8;box-shadow:0 6px 20px rgba(108,99,255,0.45);}
        .btn:active{transform:scale(0.98);}
        .btn:disabled{opacity:0.65;cursor:not-allowed;}
        .div{display:flex;align-items:center;gap:12px;margin:20px 0 16px;}
        .divl{flex:1;height:1px;background:#e5e7eb;}
        .div span{font-size:12px;color:#9ca3af;white-space:nowrap;}
        .dgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .dbtn{background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:8px;padding:10px 12px;cursor:pointer;text-align:left;font-family:'Nunito',sans-serif;transition:all 0.15s;}
        .dbtn:hover{border-color:#6c63ff;background:#f5f4ff;transform:translateY(-1px);box-shadow:0 2px 8px rgba(108,99,255,0.12);}
        .dbtn:disabled{opacity:0.6;cursor:not-allowed;transform:none;}
        .drole{font-size:12px;font-weight:700;margin-bottom:2px;}
        .demail{font-size:10px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .foot{text-align:center;font-size:11px;color:#d1d5db;margin-top:20px;}
        @media(max-width:680px){.container{grid-template-columns:1fr;}.left{display:none;}.topnav{padding:0 20px;}}
      `}</style>

      <div className="page">
        <nav className="topnav">
          <a className="logo" href="#">
            <div className="logo-icon">🐔</div>
            PoultryFarm Pro
          </a>
          <div className="nav-right">
            Don't have an account? <a href="#">Sign up</a>
          </div>
        </nav>

        <div className="main">
          <div className="container">
            {/* Left */}
            <div className="left">
              <div className="blob" />
              <span className="icon">🐔</span>
              <div className="accent" />
              <h1>Great to have<br />you back!</h1>
              <p>Manage your poultry farm from anywhere — track flocks, monitor health, record production and grow your profitability with real-time data.</p>
              <span className="deco d1">🌾</span>
              <span className="deco d2">💡</span>
              <span className="deco d3">🥚</span>
            </div>

            {/* Right — form card */}
            <div className="card">
              <h2>Sign in</h2>

              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label>Email</label>
                  <input type="email" placeholder="example.email@gmail.com"
                    value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    autoComplete="email" required />
                </div>

                <div className="field">
                  <label>Password</label>
                  <div className="fw">
                    <input type={showPassword ? 'text' : 'password'}
                      placeholder="Enter at least 8+ characters"
                      value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                      autoComplete="current-password" required style={{ paddingRight: 40 }} />
                    <button type="button" className="eye" onClick={() => setShowPassword(p => !p)} tabIndex={-1}>
                      {showPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                <div className="row">
                  <label className="rem">
                    <input type="checkbox" /> Remember me
                  </label>
                  <button type="button" className="fgt">Forgot password?</button>
                </div>

                {error && <div className="err">{error}</div>}

                <button type="submit" className="btn" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <div className="div">
                <div className="divl" />
                <span>Or use a demo account</span>
                <div className="divl" />
              </div>

              <div className="dgrid">
                {DEMO_ACCOUNTS.map(acc => (
                  <button key={acc.email} className="dbtn" onClick={() => quickLogin(acc)} disabled={loading}>
                    <div className="drole" style={{ color: acc.color }}>{acc.label}</div>
                    <div className="demail">{acc.email}</div>
                  </button>
                ))}
              </div>

              <div className="foot">PoultryFarm Pro v1.0 · © 2026</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
