'use client';
// components/layout/AuthProvider.js
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';

const AuthContext = createContext(null);

const PUBLIC_PATHS = ['/auth/login', '/auth/register', '/'];

// ── Session-expired toast (rendered via portal so it's always on top) ─────────
function SessionToast({ onDone }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onDone(); }, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div style={{
      position:   'fixed',
      bottom:     24,
      left:       '50%',
      transform:  `translateX(-50%) translateY(${visible ? 0 : 20}px)`,
      opacity:    visible ? 1 : 0,
      transition: 'all 0.3s ease',
      zIndex:     9999,
      background: '#1a1a2e',
      color:      '#fff',
      borderRadius: 10,
      padding:    '12px 20px',
      fontSize:   13,
      fontFamily: "'Nunito', sans-serif",
      fontWeight: 600,
      boxShadow:  '0 8px 32px rgba(0,0,0,0.25)',
      display:    'flex',
      alignItems: 'center',
      gap:        10,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 16 }}>🔒</span>
      <span>Your session has expired. Signing you back in…</span>
    </div>,
    document.body,
  );
}

// ── AuthProvider ──────────────────────────────────────────────────────────────
export function AuthProvider({ children }) {
  const [user,            setUser]            = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [sessionExpired,  setSessionExpired]  = useState(false);
  const router   = useRouter();
  const pathname = usePathname();

  // Restore user from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('pfp_user');
    const token  = localStorage.getItem('pfp_token');
    if (stored && token) {
      try { setUser(JSON.parse(stored)); } catch { /* corrupted — ignore */ }
    }
    setLoading(false);
  }, []);

  // Redirect unauthenticated users away from protected routes
  useEffect(() => {
    if (!loading && !user && !PUBLIC_PATHS.includes(pathname)) {
      router.push('/auth/login');
    }
  }, [user, loading, pathname, router]);

  const login = async (email, password) => {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    localStorage.setItem('pfp_token', data.token);
    localStorage.setItem('pfp_user',  JSON.stringify(data.user));
    setUser(data.user);
    setSessionExpired(false);
    return data.user;
  };

  const logout = useCallback(async (expired = false) => {
    // Fire-and-forget — we don't need to await the server response
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('pfp_token');
    localStorage.removeItem('pfp_user');
    setUser(null);

    if (expired) {
      // Show toast first, then redirect after it fades
      setSessionExpired(true);
      setTimeout(() => router.push('/auth/login'), 3600);
    } else {
      router.push('/auth/login');
    }
  }, [router]);

  // Authenticated fetch wrapper — handles 401 with a user-friendly toast
  const apiFetch = useCallback(async (url, options = {}) => {
    const token = localStorage.getItem('pfp_token');
    const res   = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    });

    if (res.status === 401) {
      logout(true); // triggers the session-expired toast
      throw new Error('Session expired');
    }

    return res;
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, apiFetch }}>
      {children}

      {/* Session-expired toast — only shown after a 401 */}
      {sessionExpired && (
        <SessionToast onDone={() => setSessionExpired(false)} />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
