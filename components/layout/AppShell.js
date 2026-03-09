'use client';
// components/layout/AppShell.js
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthProvider';
import { ROLE_LABELS } from '@/lib/constants/roles';

// ── Role constants ─────────────────────────────────────────────────────────────
const ADMIN_ONLY = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// ── Nav definition ─────────────────────────────────────────────────────────────
// Administration items are grouped separately and shown only to ADMIN_ONLY roles.
const NAV_MAIN = [
  { href: '/dashboard',     icon: '📊', label: 'Dashboard',     roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','STORE_MANAGER','FEED_MILL_MANAGER','SUPER_ADMIN','PEN_WORKER','PRODUCTION_STAFF','STORE_CLERK','QC_TECHNICIAN'] },
  { href: '/farm-structure', icon: '🏡', label: 'Farm Structure', roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'] },
  { href: '/farm',          icon: '🐦', label: 'Flocks',         roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'] },
  { href: '/health',        icon: '💉', label: 'Health',         roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'] },
  { href: '/feed',          icon: '🌾', label: 'Feed',           roles: ['STORE_MANAGER','STORE_CLERK','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','PEN_MANAGER'] },
  { href: '/verification',  icon: '✅', label: 'Verification',   roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','STORE_MANAGER','SUPER_ADMIN'] },
  { href: '/worker',        icon: '📋', label: 'My Tasks',       roles: ['PEN_WORKER','PEN_MANAGER','PRODUCTION_STAFF','STORE_CLERK','QC_TECHNICIAN'] },
  { href: '/owner',         icon: '📈', label: 'Analytics',      roles: ['CHAIRPERSON'] },
  { href: '/billing',       icon: '💳', label: 'Billing',        roles: ['CHAIRPERSON','FARM_ADMIN','SUPER_ADMIN'] },
];

// Administration group — only ADMIN_ONLY roles see this group at all
const NAV_ADMIN = [
  { href: '/users',    icon: '👥', label: 'User Admin' },
  { href: '/settings', icon: '⚙️', label: 'Settings'   },
];

// ── Notification type → icon / colour ─────────────────────────────────────────
const NOTIF_META = {
  LOW_STOCK:       { icon: '📦', color: '#f59e0b' },
  REPORT_REJECTED: { icon: '↩️',  color: '#ef4444' },
  ALERT:           { icon: '⚠️',  color: '#ef4444' },
  TASK_OVERDUE:    { icon: '⏰', color: '#ef4444' },
  VACCINATION_DUE: { icon: '💉', color: '#3b82f6' },
  PO_APPROVED:     { icon: '✅', color: '#22c55e' },
  PO_REJECTED:     { icon: '❌', color: '#ef4444' },
  MORTALITY_SPIKE: { icon: '💀', color: '#ef4444' },
  DEFAULT:         { icon: '🔔', color: '#6c63ff' },
};
function notifMeta(type) { return NOTIF_META[type] || NOTIF_META.DEFAULT; }

function timeAgo(d) {
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

// ── Notification dropdown ──────────────────────────────────────────────────────
function NotifDropdown({ notifications, unreadCount, onMarkRead, onMarkAll, onClose, anchorRef }) {
  const dropRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          anchorRef.current && !anchorRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: pos.top, right: pos.right,
      width: 340, background: '#fff', borderRadius: 14,
      border: '1px solid var(--border-card)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 1000,
      overflow: 'hidden', animation: 'fadeInUp 0.18s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Notifications</span>
          {unreadCount > 0 && (
            <span style={{ background: 'var(--purple)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{unreadCount}</span>
          )}
        </div>
        {unreadCount > 0 && (
          <button onClick={onMarkAll} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: 'var(--purple)', fontFamily: 'inherit', padding: '2px 6px' }}>
            Mark all read
          </button>
        )}
      </div>

      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
            <div style={{ fontWeight: 600 }}>You're all caught up!</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>No new notifications</div>
          </div>
        ) : notifications.map(n => {
          const meta = notifMeta(n.type);
          return (
            <div key={n.id} onClick={() => !n.isRead && onMarkRead(n.id)} style={{
              display: 'flex', gap: 12, padding: '12px 16px',
              background: n.isRead ? '#fff' : 'var(--purple-light)',
              borderBottom: '1px solid var(--border)',
              cursor: n.isRead ? 'default' : 'pointer', transition: 'background 0.15s',
            }}
              onMouseEnter={e => { if (!n.isRead) e.currentTarget.style.background = '#e8e6ff'; }}
              onMouseLeave={e => { if (!n.isRead) e.currentTarget.style.background = 'var(--purple-light)'; }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `${meta.color}15`, border: `1px solid ${meta.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, marginTop: 2 }}>
                {meta.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: n.isRead ? 600 : 700, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 2 }}>{n.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{n.message}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</div>
              </div>
              {!n.isRead && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--purple)', flexShrink: 0, marginTop: 6 }} />}
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
        <Link href="/notifications" onClick={onClose} style={{ fontSize: 12, fontWeight: 600, color: 'var(--purple)', textDecoration: 'none' }}>
          View all notifications →
        </Link>
      </div>
    </div>,
    document.body,
  );
}

// ── Single nav link ────────────────────────────────────────────────────────────
function NavLink({ href, icon, label, collapsed, pathname }) {
  const active = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: collapsed ? '10px 0' : '10px 12px',
      borderRadius: 9, marginBottom: 3,
      justifyContent: collapsed ? 'center' : 'flex-start',
      background: active ? 'var(--purple-light)' : 'transparent',
      color: active ? 'var(--purple)' : 'var(--text-secondary)',
      fontWeight: active ? 700 : 600,
      fontSize: 13, textDecoration: 'none', transition: 'all 0.15s',
      borderLeft: active ? '3px solid var(--purple)' : '3px solid transparent',
    }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}}
    >
      <span style={{ fontSize: 17, flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

// ── AppShell ──────────────────────────────────────────────────────────────────
export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router   = useRouter();

  const [collapsed,     setCollapsed]     = useState(false);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [notifLoading,  setNotifLoading]  = useState(false);
  // Administration group expanded/collapsed in sidebar
  const [adminExpanded, setAdminExpanded] = useState(
    // Auto-expand if currently on an admin page
    false
  );
  const bellRef = useRef(null);

  const isAdmin   = ADMIN_ONLY.includes(user?.role);
  const sideW     = collapsed ? 64 : 220;
  const initials  = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : '?';
  const roleLabel = ROLE_LABELS[user?.role] || user?.role || '';

  // Auto-expand admin group when on admin pages
  useEffect(() => {
    if (pathname.startsWith('/users') || pathname.startsWith('/settings')) {
      setAdminExpanded(true);
    }
  }, [pathname]);

  const visibleMain = NAV_MAIN.filter(n => !user || n.roles.includes(user.role));

  // ── Fetch unread count ──────────────────────────────────────────────────────
  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('pfp_token');
      const res   = await fetch('/api/notifications?limit=1&unreadOnly=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch { /* silent */ }
  }, [user]);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60_000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // ── Open notifications dropdown ─────────────────────────────────────────────
  const openNotifications = async () => {
    if (notifOpen) { setNotifOpen(false); return; }
    setNotifOpen(true);
    setNotifLoading(true);
    try {
      const token = localStorage.getItem('pfp_token');
      const res   = await fetch('/api/notifications?limit=20', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch { /* silent */ }
    finally { setNotifLoading(false); }
  };

  const markRead = async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      const token = localStorage.getItem('pfp_token');
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      const token = localStorage.getItem('pfp_token');
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ markAllRead: true }),
      });
    } catch { /* silent */ }
  };

  // Avatar: use profilePicUrl from user object if available, else initials
  const avatarContent = user?.profilePicUrl
    ? <img src={user.profilePicUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
    : <span>{initials}</span>;

  const avatarStyle = (size) => ({
    width: size, height: size,
    background: user?.profilePicUrl ? 'transparent' : 'linear-gradient(135deg,#6c63ff,#a78bfa)',
    borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontSize: size * 0.35, fontWeight: 700, flexShrink: 0,
    overflow: 'hidden',
  });

  const isAdminPage = pathname.startsWith('/users') || pathname.startsWith('/settings');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)', fontFamily: "'Nunito', sans-serif" }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside style={{
        width: sideW, flexShrink: 0, background: '#fff',
        borderRight: '1px solid var(--border-card)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.2s ease',
        position: 'sticky', top: 0, height: '100vh',
        boxShadow: '2px 0 8px rgba(0,0,0,0.04)', overflow: 'hidden',
      }}>

        {/* Logo */}
        <div style={{
          padding: collapsed ? '18px 0' : '18px 20px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--border-card)',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}>
          <div style={{
            width: 34, height: 34,
            background: 'linear-gradient(135deg,#6c63ff,#48c774)',
            borderRadius: 9, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 18, flexShrink: 0,
          }}>🐔</div>
          {!collapsed && (
            <div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.2 }}>PoultryFarm</div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--purple)', lineHeight: 1.2 }}>Pro</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          {/* Main nav items */}
          {visibleMain.map(item => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} collapsed={collapsed} pathname={pathname} />
          ))}

          {/* Administration group — only for ADMIN_ONLY roles */}
          {isAdmin && (
            <div style={{ marginTop: 8 }}>
              {/* Group header */}
              {!collapsed ? (
                <button
                  onClick={() => setAdminExpanded(p => !p)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '7px 12px', borderRadius: 8,
                    background: isAdminPage ? 'var(--purple-light)' : 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    marginBottom: 2,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: isAdminPage ? 'var(--purple)' : 'var(--text-muted)' }}>
                      Administration
                    </span>
                  </div>
                  <span style={{
                    fontSize: 11, color: isAdminPage ? 'var(--purple)' : 'var(--text-muted)',
                    transform: adminExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.2s',
                    lineHeight: 1,
                  }}>▾</span>
                </button>
              ) : (
                // Collapsed: show a divider line
                <div style={{ height: 1, background: 'var(--border-card)', margin: '8px 0' }} />
              )}

              {/* Admin nav links — shown when expanded OR when sidebar is collapsed (icons only) */}
              {(adminExpanded || collapsed) && NAV_ADMIN.map(item => (
                <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} collapsed={collapsed} pathname={pathname} />
              ))}
            </div>
          )}
        </nav>

        {/* Bottom: collapse + user card */}
        <div style={{ borderTop: '1px solid var(--border-card)', padding: '12px 8px' }}>
          <button
            onClick={() => setCollapsed(p => !p)}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10, padding: '8px 12px', borderRadius: 8,
              color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit', marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 16 }}>{collapsed ? '→' : '←'}</span>
            {!collapsed && <span>Collapse</span>}
          </button>

          {/* User card — clicking navigates to /profile */}
          <Link href="/profile" style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: collapsed ? '8px 0' : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            textDecoration: 'none', borderRadius: 9,
            transition: 'background 0.15s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={avatarStyle(32)}>{avatarContent}</div>
            {!collapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user?.firstName} {user?.lastName}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{roleLabel}</div>
              </div>
            )}
            {!collapsed && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>✏️</span>}
          </Link>

          {!collapsed && (
            <button
              onClick={() => logout()}
              style={{
                width: '100%', background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 8, padding: '7px 12px', color: 'var(--text-muted)',
                fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-bg)'; e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red-border)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              🚪 Sign out
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
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
            {/* Bell */}
            <button ref={bellRef} onClick={openNotifications} style={{
              position: 'relative',
              background: notifOpen ? 'var(--purple-light)' : 'var(--bg-elevated)',
              border: `1px solid ${notifOpen ? '#d4d8ff' : 'var(--border)'}`,
              borderRadius: 9, width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 16, transition: 'all 0.15s',
            }}>
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  minWidth: 16, height: 16, background: 'var(--red)',
                  borderRadius: '50%', fontSize: 9, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, border: '2px solid #fff', padding: '0 3px',
                }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </button>

            {notifOpen && (
              <NotifDropdown
                notifications={notifLoading ? [] : notifications}
                unreadCount={unreadCount}
                onMarkRead={markRead}
                onMarkAll={markAllRead}
                onClose={() => setNotifOpen(false)}
                anchorRef={bellRef}
              />
            )}

            {/* Avatar chip — links to /profile */}
            <Link href="/profile" style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 12px',
              background: 'var(--purple-light)', border: '1px solid #d4d8ff',
              borderRadius: 9, cursor: 'pointer', textDecoration: 'none',
              transition: 'background 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#e4e2ff'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--purple-light)'}
            >
              <div style={avatarStyle(26)}>{avatarContent}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>
                {user?.firstName}
              </div>
            </Link>
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
