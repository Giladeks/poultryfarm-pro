// components/layout/AppShell.js — Light theme sidebar + topbar
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

const NAV = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard', roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','STORE_MANAGER','FEED_MILL_MANAGER','SUPER_ADMIN','PEN_WORKER','PRODUCTION_STAFF','STORE_CLERK','QC_TECHNICIAN'] },
  { href: '/farm-structure', icon: '🏡', label: 'Farm Structure', roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','PEN_MANAGER'] },
  { href: '/farm',           icon: '🐦', label: 'Flocks',        roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'] },
  { href: '/health',    icon: '💉', label: 'Health',     roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'] },
  { href: '/feed',      icon: '🌾', label: 'Feed',       roles: 
['STORE_MANAGER', 'STORE_CLERK', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'] },
  { href: '/verification', icon: '✅', label: 'Verification', roles: 
['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','STORE_MANAGER','SUPER_ADMIN'] },
  { href: '/users',     icon: '👥', label: 'User Admin',  roles: ['FARM_ADMIN','FARM_MANAGER','CHAIRPERSON','SUPER_ADMIN'] },
  { href: '/worker',    icon: '✅', label: 'My Tasks',   roles: ['PEN_WORKER','PEN_MANAGER','PRODUCTION_STAFF','STORE_CLERK','QC_TECHNICIAN'] },
  { href: '/owner',     icon: '📈', label: 'Analytics',  roles: ['CHAIRPERSON','FARM_ADMIN','FARM_MANAGER','SUPER_ADMIN'] },
  { href: '/billing',   icon: '💳', label: 'Billing',    roles: ['CHAIRPERSON','FARM_ADMIN','SUPER_ADMIN'] },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const visibleNav = NAV.filter(n => !user || n.roles.includes(user.role));
  const sideW = collapsed ? 64 : 220;

  const handleLogout = async () => {
    await logout();
    router.push('/auth/login');
  };

  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : '?';
  const roleLabel = {
    CHAIRPERSON: 'Chairperson', FARM_ADMIN: 'Farm Admin', FARM_MANAGER: 'Farm Manager',
    STORE_MANAGER: 'Store Manager', FEED_MILL_MANAGER: 'Feed Mill Mgr', PEN_MANAGER: 'Pen Manager',
    STORE_CLERK: 'Store Clerk', QC_TECHNICIAN: 'QC Tech', PRODUCTION_STAFF: 'Prod. Staff',
    PEN_WORKER: 'Pen Worker', SUPER_ADMIN: 'Super Admin',
  }[user?.role] || user?.role;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)', fontFamily: "'Nunito', sans-serif" }}>

      {/* Sidebar */}
      <aside style={{
        width: sideW, flexShrink: 0, background: '#fff',
        borderRight: '1px solid var(--border-card)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.2s ease',
        position: 'sticky', top: 0, height: '100vh',
        boxShadow: '2px 0 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
      }}>
        {/* Logo */}
        <div style={{ padding: collapsed ? '18px 0' : '18px 20px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border-card)', justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <div style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#6c63ff,#48c774)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
            🐔
          </div>
          {!collapsed && (
            <div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.2 }}>PoultryFarm</div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--purple)', lineHeight: 1.2 }}>Pro</div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          {visibleNav.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: collapsed ? '10px 0' : '10px 12px',
                  borderRadius: 9, marginBottom: 3,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: active ? 'var(--purple-light)' : 'transparent',
                  color: active ? 'var(--purple)' : 'var(--text-secondary)',
                  fontWeight: active ? 700 : 600,
                  fontSize: 13,
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                  borderLeft: active ? '3px solid var(--purple)' : '3px solid transparent',
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}}
              >
                <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User profile + collapse */}
        <div style={{ borderTop: '1px solid var(--border-card)', padding: '12px 8px' }}>
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(p => !p)}
            style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit', marginBottom: 6 }}
          >
            <span style={{ fontSize: 16 }}>{collapsed ? '→' : '←'}</span>
            {!collapsed && <span>Collapse</span>}
          </button>

          {/* User */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '8px 0' : '8px 12px', justifyContent: collapsed ? 'center' : 'flex-start' }}>
            <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg,#6c63ff,#a78bfa)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {initials}
            </div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.firstName} {user?.lastName}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{roleLabel}</div>
              </div>
            )}
          </div>

          {!collapsed && (
            <button onClick={handleLogout}
              style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-bg)'; e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red-border)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              🚪 Sign out
            </button>
          )}
        </div>
      </aside>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Topbar */}
        <header style={{
          height: 60, background: '#fff', borderBottom: '1px solid var(--border-card)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', position: 'sticky', top: 0, zIndex: 100,
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          <div>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {user?.farmName || 'Green Acres Poultry Farm'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Alert bell */}
            <button
              onClick={() => setAlertsOpen(p => !p)}
              style={{ position: 'relative', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 9, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16 }}
            >
              🔔
              <span style={{ position: 'absolute', top: -3, right: -3, width: 16, height: 16, background: 'var(--red)', borderRadius: '50%', fontSize: 9, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, border: '2px solid #fff' }}>3</span>
            </button>

            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', background: 'var(--purple-light)', border: '1px solid #d4d8ff', borderRadius: 9, cursor: 'pointer' }}>
              <div style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#6c63ff,#a78bfa)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                {initials}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>
                {user?.firstName}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
