'use client';
// app/notifications/page.js
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ── Notification type config ───────────────────────────────────────────────────
const TYPE_CONFIG = {
  MORTALITY_SPIKE:      { icon: '📉', color: 'var(--red)',    bg: '#fef2f2', border: '#fecaca', label: 'Mortality Alert' },
  LOW_FEED_STOCK:       { icon: '🌾', color: 'var(--amber)',  bg: '#fffbeb', border: '#fde68a', label: 'Feed Alert' },
  VACCINATION_DUE:      { icon: '💉', color: '#8b5cf6',       bg: '#f5f3ff', border: '#ddd6fe', label: 'Health Reminder' },
  HARVEST_READY:        { icon: '🐔', color: 'var(--green)',  bg: '#f0fdf4', border: '#bbf7d0', label: 'Harvest Ready' },
  TASK_OVERDUE:         { icon: '⏰', color: 'var(--amber)',  bg: '#fffbeb', border: '#fde68a', label: 'Overdue Task' },
  TASK_ASSIGNED:        { icon: '📋', color: 'var(--blue)',   bg: '#eff6ff', border: '#bfdbfe', label: 'New Task' },
  VERIFICATION_PENDING: { icon: '🔍', color: 'var(--purple)', bg: 'var(--purple-light)', border: '#d4d8ff', label: 'Needs Review' },
  REPORT_SUBMITTED:     { icon: '📊', color: 'var(--green)',  bg: '#f0fdf4', border: '#bbf7d0', label: 'Report In' },
  FCR_ALERT:            { icon: '📈', color: 'var(--amber)',  bg: '#fffbeb', border: '#fde68a', label: 'FCR Alert' },
  SYSTEM:               { icon: '⚙️', color: 'var(--text-muted)', bg: 'var(--bg-elevated)', border: 'var(--border)', label: 'System' },
};

function getConfig(type) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.SYSTEM;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7)  return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

// ── Notification card ──────────────────────────────────────────────────────────
function NotifCard({ notif, onMarkRead }) {
  const cfg = getConfig(notif.type);
  return (
    <div onClick={() => !notif.isRead && onMarkRead(notif.id)}
      style={{
        display: 'flex', gap: 14, padding: '14px 16px',
        background: notif.isRead ? '#fff' : cfg.bg,
        border: `1px solid ${notif.isRead ? 'var(--border)' : cfg.border}`,
        borderRadius: 10, cursor: notif.isRead ? 'default' : 'pointer',
        transition: 'all 0.15s', position: 'relative',
      }}
      onMouseEnter={e => { if (!notif.isRead) e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.07)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>

      {/* Unread dot */}
      {!notif.isRead && (
        <div style={{ position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: '50%', background: cfg.color }} />
      )}

      {/* Icon */}
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, background: cfg.bg, border: `1px solid ${cfg.border}`,
      }}>
        {cfg.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(notif.createdAt)}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{notif.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{notif.message}</div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const { apiFetch } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(true);
  const [filter,        setFilter]        = useState('all'); // all | unread
  const [typeFilter,    setTypeFilter]    = useState('');
  const [marking,       setMarking]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/notifications?limit=50${filter === 'unread' ? '&unreadOnly=true' : ''}`);
      if (res.ok) {
        const d = await res.json();
        setNotifications(d.notifications || []);
        setUnreadCount(d.unreadCount || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch, filter]);

  useEffect(() => { load(); }, [load]);

  const markOne = async (id) => {
    // Optimistic update
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount(c => Math.max(0, c - 1));
    await apiFetch('/api/notifications', { method: 'PATCH', body: JSON.stringify({ id }) });
  };

  const markAll = async () => {
    setMarking(true);
    try {
      const res = await apiFetch('/api/notifications', { method: 'PATCH', body: JSON.stringify({ markAllRead: true }) });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
        setUnreadCount(0);
      }
    } finally { setMarking(false); }
  };

  // Available types from current notifications
  const availableTypes = [...new Set(notifications.map(n => n.type))];

  const displayed = notifications.filter(n => !typeFilter || n.type === typeFilter);
  const groups    = groupByDate(displayed);

  return (
    <AppShell>
      <div className="animate-in" style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              🔔 Notifications
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button onClick={markAll} disabled={marking} className="btn btn-outline" style={{ fontSize: 12 }}>
              {marking ? 'Marking…' : '✓ Mark all read'}
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          {['all', 'unread'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className="btn"
              style={{ fontSize: 11, padding: '5px 14px', textTransform: 'capitalize',
                background: filter === f ? 'var(--purple)' : '#fff',
                color:      filter === f ? '#fff' : 'var(--text-muted)',
                border:     `1px solid ${filter === f ? 'var(--purple)' : 'var(--border)'}`,
              }}>
              {f === 'unread' && unreadCount > 0 ? `Unread (${unreadCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}

          {availableTypes.length > 1 && (
            <select className="input" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              style={{ maxWidth: 200, padding: '5px 10px', fontSize: 12 }}>
              <option value="">All types</option>
              {availableTypes.map(t => (
                <option key={t} value={t}>{getConfig(t).label}</option>
              ))}
            </select>
          )}

          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
            {displayed.length} notification{displayed.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 88, background: 'var(--bg-elevated)', borderRadius: 10, animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔔</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--text-secondary)' }}>
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </div>
            <div style={{ fontSize: 12 }}>
              {filter === 'unread' ? 'You\'re all caught up.' : 'Alerts and system events will appear here.'}
            </div>
            {filter === 'unread' && (
              <button onClick={() => setFilter('all')} className="btn btn-outline" style={{ marginTop: 16, fontSize: 12 }}>
                View all notifications
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {groups.map(({ label, items }) => (
              <div key={label}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, paddingLeft: 4 }}>
                  {label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map(n => (
                    <NotifCard key={n.id} notif={n} onMarkRead={markOne} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Group notifications by date label ──────────────────────────────────────────
function groupByDate(notifications) {
  const groups = [];
  const seen   = new Map();

  for (const n of notifications) {
    const label = getDateLabel(n.createdAt);
    if (!seen.has(label)) {
      seen.set(label, []);
      groups.push({ label, items: seen.get(label) });
    }
    seen.get(label).push(n);
  }

  return groups;
}

function getDateLabel(dateStr) {
  const d     = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d >= today)     return 'Today';
  if (d >= yesterday) return 'Yesterday';

  const daysAgo = Math.floor((today - d) / 86400000);
  if (daysAgo < 7) return `${daysAgo} days ago`;

  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}
