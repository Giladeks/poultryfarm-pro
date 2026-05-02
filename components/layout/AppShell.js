'use client';
// components/layout/AppShell.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthProvider';
import { ROLE_LABELS } from '@/lib/constants/roles';
import ConnectivityBanner    from '@/components/ui/ConnectivityBanner';
import { usePWA }            from '@/hooks/usePWA';
import {
  // Nav items
  LayoutDashboard, Building2, Egg, ClipboardList, ClipboardCheck, Bird,
  TrendingUp, Scale, Factory, Syringe, Wheat, Cog,
  CheckSquare, DollarSign, Search, Drumstick, ChevronDown,
  // Group header icons
  Sun, BeefIcon,
  // Notification icons
  Package, CornerDownLeft, AlertTriangle, Clock, Bell,
  CheckCircle, XCircle, Skull, ShieldAlert,
  // Profile popover icons
  User, Settings, BookOpen, LifeBuoy, Sparkles,
  Users, CreditCard, LogOut, ChevronRight,
  // Sidebar UI
  PanelLeftClose, PanelLeftOpen, MapPin,
} from 'lucide-react';

// Map icon name strings (from NAV_ITEMS) to Lucide components
const ICON_MAP = {
  LayoutDashboard, Building2, Egg, ClipboardList, ClipboardCheck, Bird,
  TrendingUp, Scale, Factory, Syringe, Wheat, Cog,
  CheckSquare, DollarSign, Search, Drumstick, Package,
  Users,
  // Package already covers Store Inventory icon
};
// Group header icons (not from string map — referenced directly)
const LayersIcon    = Sun;       // Layer group
const DrumstickIcon = Drumstick; // Broiler group
// Render a Lucide icon by name string with consistent sizing
function NavIcon({ name, size = 16, color }) {
  const Comp = ICON_MAP[name];
  if (!Comp) return null;
  return <Comp size={size} strokeWidth={1.8} color={color || 'currentColor'} style={{ flexShrink: 0 }} />;
}

// ── Role buckets ───────────────────────────────────────────────────────────────
const FARM_ADMIN_ROLES  = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const MANAGER_UP_ROLES  = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const PEN_SCOPED_ROLES  = ['PEN_WORKER', 'PEN_MANAGER'];

// ── Nav catalogue ──────────────────────────────────────────────────────────────
// section:
//   'top'     — always above section headers, no colour accent
//   'layer'   — shown under 🥚 Layer Production header in BOTH mode
//   'broiler' — shown under 🍗 Broiler Production header in BOTH mode
//   'shared'  — shown under Shared header (or plain, in single-op mode)
//
// opModes: optional — only visible when tenant is in one of these modes
// requiresFeedMill / requiresProcessing: add-on module gates
//
// PEN_SCOPED_ROLES get further filtered by their live userOpType ('LAYER' | 'BROILER').

const NAV_ITEMS = [
  // ── Top ──
  {
    href: '/dashboard', icon: 'LayoutDashboard', label: 'Dashboard', section: 'top',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','STORE_MANAGER',
            'FEED_MILL_MANAGER','SUPER_ADMIN','PEN_WORKER','PRODUCTION_STAFF',
            'STORE_CLERK','QC_TECHNICIAN','INTERNAL_CONTROL','ACCOUNTANT'],
  },
  {
    href: '/farm-structure', icon: 'Building2', label: 'Farm Structure', section: 'top',
    roles: MANAGER_UP_ROLES,
  },
  {
    href: '/brooding', icon: 'Egg', label: 'Brooding', section: 'top',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN','PEN_WORKER'],
  },
  {
    href: '/rearing', icon: 'Scale', label: 'Rearing', section: 'top',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN','PEN_WORKER'],
    opModes: ['LAYER_ONLY', 'BOTH'],
  },
  {
    href: '/worker', icon: 'ClipboardList', label: 'My Tasks', section: 'top',
    roles: ['PEN_WORKER','PRODUCTION_STAFF','STORE_CLERK','QC_TECHNICIAN'],
  },

  // ── Layer section ──
  {
    href: '/pen-manager/daily-summaries', icon: 'ClipboardCheck', label: 'Daily Summaries', section: 'top',
    roles: ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
  },
  {
    href: '/farm?op=layer', icon: 'Bird', label: 'Layer Flocks', section: 'layer', group: 'production',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'],
    opModes: ['LAYER_ONLY', 'BOTH'],
  },
  {
    href: '/performance', icon: 'Egg', label: 'Performance', section: 'layer', group: 'production',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','PRODUCTION_STAFF','SUPER_ADMIN','PEN_WORKER'],
    opModes: ['LAYER_ONLY', 'BOTH'],
  },
  {
    href: '/production/layers', icon: 'TrendingUp', label: 'Layer Analytics', section: 'layer', group: 'production',
    roles: ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'], // FARM_MANAGER excluded — financial analytics is Farm Admin and above
    opModes: ['LAYER_ONLY', 'BOTH'],
  },

  // ── Broiler section ──
  {
    href: '/farm?op=broiler', icon: 'Drumstick', label: 'Broiler Flocks', section: 'broiler', group: 'production',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'],
    opModes: ['BROILER_ONLY', 'BOTH'],
  },
  {
    // Operational performance page — broiler PM, workers, FM and above
    href: '/broiler-performance', icon: 'Scale', label: 'Performance', section: 'broiler', group: 'production',
    roles: ['PEN_MANAGER','PEN_WORKER','PRODUCTION_STAFF','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
    opModes: ['BROILER_ONLY', 'BOTH'],
  },
  {
    // Financial analytics — Farm Admin and above only (matches layer analytics gating)
    href: '/production/broilers', icon: 'TrendingUp', label: 'Analytics', section: 'broiler', group: 'production',
    roles: ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'],
    opModes: ['BROILER_ONLY', 'BOTH'],
  },
  {
    href: '/processing', icon: 'Factory', label: 'Processing', section: 'broiler', group: 'processing',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PRODUCTION_STAFF','SUPER_ADMIN','QC_TECHNICIAN'],
    opModes: ['BROILER_ONLY', 'BOTH'],
    requiresProcessing: true,
  },

  // ── Shared section ──
  {
    href: '/health', icon: 'Syringe', label: 'Health', section: 'shared', group: 'operations',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN'],
  },
  {
    href: '/feed', icon: 'Wheat', label: 'Feed', section: 'shared', group: 'operations',
    roles: ['STORE_MANAGER','STORE_CLERK','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','PEN_MANAGER'],
  },
  {
    href: '/feed-requisitions', icon: 'ClipboardList', label: 'Feed Requisitions', section: 'shared', group: 'operations',
    roles: ['PEN_MANAGER','STORE_MANAGER','INTERNAL_CONTROL','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
  },
  {
    href: '/feed-changes', icon: 'ClipboardCheck', label: 'Feed Switch', section: 'shared', group: 'operations',
    roles: ['PEN_MANAGER','STORE_MANAGER','INTERNAL_CONTROL','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
  },
  {
    href: '/egg-store', icon: 'Package', label: 'Egg Store', section: 'shared', group: 'operations',
    roles: ['STORE_MANAGER','STORE_CLERK','INTERNAL_CONTROL','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'],
    opModes: ['LAYER_ONLY', 'BOTH'],
  },
  {
    href: '/feed-mill', icon: 'Cog', label: 'Feed Mill', section: 'shared', group: 'processing',
    roles: ['FEED_MILL_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','QC_TECHNICIAN'],
    requiresFeedMill: true,
  },
  {
    href: '/verification', icon: 'CheckSquare', label: 'Verification', section: 'shared', group: 'intelligence',
    roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','STORE_MANAGER','SUPER_ADMIN'],
  },
  {
    href: '/finance', icon: 'DollarSign', label: 'Finance', section: 'shared', group: 'business',
    roles: ['FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'],
  },
  {
    href: '/audit', icon: 'Search', label: 'Audit', section: 'shared', group: 'intelligence',
    roles: ['FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','INTERNAL_CONTROL'],
  },
  {
    href: '/owner', icon: 'TrendingUp', label: 'Analytics', section: 'shared', group: 'intelligence',
    roles: ['CHAIRPERSON'],
  },
  // ── Phase 8-Supplement-Arch: new Operations items ──
  {
    href: '/store', icon: 'Package', label: 'Store Inventory', section: 'shared', group: 'operations',
    roles: ['STORE_MANAGER','STORE_CLERK','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','INTERNAL_CONTROL'],
  },
  {
    href: '/users', icon: 'ClipboardList', label: 'Staff', section: 'shared', group: 'business',
    roles: ['FARM_ADMIN','FARM_MANAGER','CHAIRPERSON','SUPER_ADMIN'],
  },
];

// Plain "Flocks" item used in single-operation modes (not BOTH)
const FLOCKS_SINGLE = {
  href: '/farm', icon: 'Bird', label: 'Flocks', section: 'layer',
  roles: ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','PEN_MANAGER','SUPER_ADMIN','PEN_WORKER'],
};

// ── Section visual metadata ───────────────────────────────────────────────────
const SECTION_META = {
  layer:   { label: 'Layer Production',   color: '#f59e0b', Icon: LayersIcon   },
  broiler: { label: 'Broiler Production', color: '#3b82f6', Icon: DrumstickIcon },
  shared:  { label: 'Shared',             color: '#6c63ff', Icon: null          },
};

// ── Module group metadata (for the Operations / Intelligence / Business / Processing groups) ──
// These sit below the production collapsible groups in the sidebar.
// Each entry: label shown as section divider, color for active accent, emoji icon.
const MODULE_GROUPS = {
  operations:   { label: 'Operations',   emoji: '🏪', color: '#6c63ff' },
  intelligence: { label: 'Intelligence', emoji: '📊', color: '#0ea5e9' },
  business:     { label: 'Business',     emoji: '💼', color: '#10b981' },
  processing:   { label: 'Processing',   emoji: '🏭', color: '#8b5cf6' },
};

// Ordered list of groups to render — controls display sequence
const MODULE_GROUP_ORDER = ['operations', 'intelligence', 'business', 'processing'];

// ── Notification helpers ──────────────────────────────────────────────────────
const NOTIF_META = {
  LOW_STOCK:       { Icon: Package,         color: '#f59e0b' },
  REPORT_REJECTED: { Icon: CornerDownLeft,  color: '#ef4444' },
  ALERT:           { Icon: AlertTriangle,   color: '#ef4444' },
  TASK_OVERDUE:    { Icon: Clock,           color: '#ef4444' },
  VACCINATION_DUE: { Icon: Syringe,         color: '#3b82f6' },
  PO_APPROVED:     { Icon: CheckCircle,     color: '#22c55e' },
  PO_REJECTED:     { Icon: XCircle,         color: '#ef4444' },
  MORTALITY_SPIKE: { Icon: ShieldAlert,     color: '#ef4444' },
  DEFAULT:         { Icon: Bell,            color: '#6c63ff' },
};
function notifMeta(type) { return NOTIF_META[type] || NOTIF_META.DEFAULT; }

function timeAgo(d) {
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

// ── Notification dropdown ─────────────────────────────────────────────────────
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
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}><Bell size={32} strokeWidth={1.2} color="#d1d5db" /></div>
            <div style={{ fontWeight: 600 }}>You're all caught up!</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>No new notifications</div>
          </div>
        ) : notifications.map(n => {
          const meta = notifMeta(n.type);
          return (
            <div key={n.id} onClick={() => { if (!n.isRead) onMarkRead(n.id); const url = n.data?.actionUrl; if (url) { onClose(); window.location.href = url; } }} style={{
              display: 'flex', gap: 12, padding: '12px 16px',
              background: n.isRead ? '#fff' : 'var(--purple-light)',
              borderBottom: '1px solid var(--border)',
              cursor: (!n.isRead || n.data?.actionUrl) ? 'pointer' : 'default', transition: 'background 0.15s',
            }}
              onMouseEnter={e => { if (!n.isRead) e.currentTarget.style.background = '#e8e6ff'; }}
              onMouseLeave={e => { if (!n.isRead) e.currentTarget.style.background = 'var(--purple-light)'; }}
            >
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `${meta.color}15`, border: `1px solid ${meta.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                {meta.Icon && <meta.Icon size={16} strokeWidth={1.8} color={meta.color} />}
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

// ── Profile popover ───────────────────────────────────────────────────────────
function ProfilePopover({ user, logout, onClose, anchorRef }) {
  const popRef   = useRef(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  const isAdmin  = FARM_ADMIN_ROLES.includes(user?.role);
  const initials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : '?';

  useEffect(() => {
    if (anchorRef.current) {
      const r   = anchorRef.current.getBoundingClientRect();
      const POP_WIDTH = 264;
      setPos({
        bottom: window.innerHeight - r.top + 6,
        left: Math.max(8, Math.min(r.left, window.innerWidth - POP_WIDTH - 8)),
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target) &&
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

  const MenuItem = ({ href, Icon: ItemIcon, label, danger, onClick, badge }) => {
    const iconColor = danger ? '#dc2626' : '#94a3b8';
    const inner = (
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
          fontFamily: "'Poppins', sans-serif",
          fontSize: 13, fontWeight: 500,
          color: danger ? '#dc2626' : '#475569',
          transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = danger ? '#fef2f2' : '#f1f5f9';
          e.currentTarget.style.color = danger ? '#dc2626' : '#1e293b';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = danger ? '#dc2626' : '#475569';
        }}
        onClick={onClick}
      >
        {ItemIcon && (
          <span style={{ display: 'flex', alignItems: 'center', width: 18, flexShrink: 0, color: iconColor }}>
            <ItemIcon size={14} strokeWidth={1.8} />
          </span>
        )}
        <span style={{ flex: 1 }}>{label}</span>
        {badge && (
          <span style={{ fontSize: 9, fontWeight: 700, background: '#6c63ff', color: '#fff', borderRadius: 4, padding: '2px 7px', letterSpacing: '0.04em' }}>
            {badge}
          </span>
        )}
      </div>
    );

    if (href) {
      return (
        <Link href={href} onClick={onClose} style={{ textDecoration: 'none', display: 'block' }}>
          {inner}
        </Link>
      );
    }
    return inner;
  };

  const Divider = () => <div style={{ height: 1, background: 'var(--border-card)', margin: '4px 0' }} />;

  const GroupLabel = ({ label }) => (
    <div style={{ padding: '6px 12px 2px', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
      {label}
    </div>
  );

  return createPortal(
    <div ref={popRef} style={{
      position: 'fixed',
      bottom: pos.bottom,
      left: pos.left,
      width: 264,
      background: '#fff',
      borderRadius: 14,
      border: '1px solid var(--border-card)',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.10), 0 8px 32px rgba(0,0,0,0.08)',
      zIndex: 1001,
      overflow: 'hidden',
      animation: 'fadeInUp 0.16s ease',
    }}>

      {/* Identity header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: user?.profilePicUrl ? 'transparent' : 'linear-gradient(135deg,#6c63ff,#a78bfa)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {user?.profilePicUrl
            ? <img src={user.profilePicUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{initials}</span>
          }
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.firstName} {user?.lastName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {user?.email}
          </div>
        </div>
      </div>

      {/* Menu body */}
      <div style={{ padding: '6px' }}>
        <MenuItem href="/profile"  Icon={User}     label="Profile"  />
        <MenuItem href="/settings" Icon={Settings} label="Settings" />

        {/* User Admin + Billing — Farm Admin and above only, no label */}
        {isAdmin && (
          <>
            <Divider />
            <MenuItem href="/users"   Icon={Users}       label="User Admin" />
            <MenuItem href="/billing" Icon={CreditCard}  label="Billing"    />
          </>
        )}

        <Divider />
        <MenuItem href="/docs"      Icon={BookOpen} label="Documentation" />
        <MenuItem href="/support"   Icon={LifeBuoy} label="Support"       />
        <MenuItem href="/whats-new" Icon={Sparkles} label="What's New"    badge="New" />

        <Divider />
        <MenuItem Icon={LogOut} label="Sign out" danger onClick={() => { onClose(); logout(); }} />
      </div>
    </div>,
    document.body,
  );
}

// ── Farm Alerts dropdown ──────────────────────────────────────────────────────
// Roles that can see the farm alerts icon
const ALERT_ICON_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON',
  'SUPER_ADMIN', 'INTERNAL_CONTROL', 'STORE_MANAGER',
];

const ALERT_TYPE_META = {
  MORTALITY_SPIKE:     { icon: '📉', color: '#dc2626', label: 'Mortality'        },
  PENDING_VERIFICATION:{ icon: '⏳', color: '#d97706', label: 'Pending Review'   },
  LOW_STOCK:           { icon: '🌾', color: '#d97706', label: 'Feed Stock'        },
  HARVEST_DUE:         { icon: '🐔', color: '#6c63ff', label: 'Harvest Due'       },
  WATER_ANOMALY:       { icon: '💧', color: '#3b82f6', label: 'Water'             },
  LAYING_RATE_DROP:    { icon: '🥚', color: '#dc2626', label: 'Laying Rate'       },
  FCR_ANOMALY:         { icon: '📈', color: '#d97706', label: 'FCR'               },
  ZERO_MORT_STREAK:    { icon: '🔍', color: '#9333ea', label: 'Audit Flag'        },
  FEED_EGG_RATIO:      { icon: '⚖️', color: '#d97706', label: 'Feed-Egg Ratio'   },
  BATCH_SUBMISSION:    { icon: '🕐', color: '#9333ea', label: 'Audit Flag'        },
};
const ALERT_SEV_DOT = { CRITICAL: '#dc2626', WARNING: '#d97706', INFO: '#6366f1' };

function getAlertMeta(type) {
  return ALERT_TYPE_META[type] || { icon: '⚠️', color: '#64748b', label: 'Alert' };
}

function AlertsDropdown({ alerts, counts, loading, onClose, onRefresh, anchorRef }) {
  const dropRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
  }, [anchorRef]);

  // Close on outside click
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

  const critCount = counts?.critical || 0;
  const warnCount = counts?.warning  || 0;

  return createPortal(
    <div ref={dropRef} style={{
      position: 'fixed', top: pos.top, right: pos.right,
      width: 360, background: '#fff', borderRadius: 14,
      border: '1px solid var(--border-card)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 1000,
      overflow: 'hidden', animation: 'fadeInUp 0.18s ease',
    }}>
      {/* Header */}
      <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={15} strokeWidth={2} color={critCount > 0 ? '#dc2626' : '#d97706'} />
        <span style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>
          Farm Alerts
        </span>
        {critCount > 0 && (
          <span style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 99, padding: '2px 8px', fontSize: 10, fontWeight: 800 }}>
            {critCount} critical
          </span>
        )}
        {warnCount > 0 && (
          <span style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a', borderRadius: 99, padding: '2px 8px', fontSize: 10, fontWeight: 800 }}>
            {warnCount} warning{warnCount !== 1 ? 's' : ''}
          </span>
        )}
        <button onClick={onRefresh} title="Refresh alerts" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple)', fontSize: 13, padding: '2px 4px', borderRadius: 5, display: 'flex', alignItems: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>

      {/* Alert list */}
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 56, background: '#f8fafc', borderRadius: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>All clear — no active alerts</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Farm metrics within normal range</div>
          </div>
        ) : (
          <div>
            {alerts.map((alert, i) => {
              const m   = getAlertMeta(alert.type);
              const dot = ALERT_SEV_DOT[alert.severity] || '#64748b';
              return (
                <div
                  key={alert.id || i}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '11px 14px',
                    borderBottom: i < alerts.length - 1 ? '1px solid #f8fafc' : 'none',
                    borderLeft: `3px solid ${dot}`,
                    background: '#fff',
                    transition: 'background 0.1s',
                    cursor: alert.actionUrl ? 'pointer' : 'default',
                  }}
                  onMouseEnter={e => { if (alert.actionUrl) e.currentTarget.style.background = '#fafafa'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}
                  onClick={() => {
                    if (alert.actionUrl) {
                      onClose();
                      window.location.href = alert.actionUrl;
                    }
                  }}
                >
                  {/* Icon */}
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{m.icon}</span>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: m.color }}>
                        {m.label}
                      </span>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {alert.severity}
                      </span>
                      {alert.context && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 2 }}>
                          · {alert.context}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2 }}>
                      {alert.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {alert.message}
                    </div>
                  </div>

                  {/* Action chevron */}
                  {alert.actionUrl && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 4 }}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {alerts.length > 0 ? `${alerts.length} active alert${alerts.length !== 1 ? 's' : ''} · refreshes every 60s` : 'Refreshes every 60s'}
        </span>
        <button onClick={onClose} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

// ── Single nav link ───────────────────────────────────────────────────────────
function NavLink({ href, icon, label, collapsed, pathname, search, accentColor }) {
  const [hrefPath, hrefQuery] = href.split('?');
  const active  = hrefQuery
    ? pathname === hrefPath && search === `?${hrefQuery}`
    : pathname === hrefPath || pathname.startsWith(hrefPath + '/');
  const color   = accentColor || '#6c63ff';
  const bg      = active ? (accentColor ? `${accentColor}14` : '#eeecff') : 'transparent';
  const iconCol = active ? color : '#94a3b8';
  const txtCol  = active ? color : '#64748b';

  return (
    <Link href={href} style={{
      display: 'flex', alignItems: 'center',
      gap: collapsed ? 0 : 9,
      padding: collapsed ? '9px 0' : '7px 10px',
      borderRadius: 8, marginBottom: 1,
      justifyContent: collapsed ? 'center' : 'flex-start',
      background: bg,
      color: txtCol,
      fontFamily: "'Poppins', sans-serif",
      fontWeight: active ? 600 : 500,
      fontSize: 13,
      textDecoration: 'none',
      transition: 'background 0.14s, color 0.14s',
      border: 'none',
    }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = '#f1f5f9';
          e.currentTarget.style.color = '#1e293b';
          e.currentTarget.querySelector?.('.nav-icon')?.setAttribute('color', '#475569');
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = txtCol;
        }
      }}
    >
      <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', color: iconCol, transition: 'color 0.14s' }}>
        <NavIcon name={icon} size={15} color={iconCol} />
      </span>
      {!collapsed && <span style={{ lineHeight: 1.2 }}>{label}</span>}
    </Link>
  );
}

// ── Collapsible nav group ─────────────────────────────────────────────────────
// Used for Layer Production and Broiler Production sections.
// - In expanded sidebar: shows a clickable header row + animated child list
// - In collapsed sidebar: shows just the group icon; hover reveals a flyout panel
function CollapsibleGroup({ section, items, isOpen, onToggle, collapsed, pathname, search }) {
  const meta        = SECTION_META[section];
  const hasActive   = items.some(item => {
    const [hrefPath, hrefQuery] = item.href.split('?');
    return hrefQuery
      ? pathname === hrefPath && search === `?${hrefQuery}`
      : pathname === hrefPath || pathname.startsWith(hrefPath + '/');
  });
  const flyoutRef   = React.useRef(null);
  const anchorRef   = React.useRef(null);
  const [flyoutPos, setFlyoutPos] = React.useState({ top: 0 });
  const [flyoutOpen, setFlyoutOpen] = React.useState(false);

  if (!meta || items.length === 0) return null;

  // ── Collapsed sidebar: icon-only with hover flyout ─────────────────────────
  if (collapsed) {
    return (
      <div style={{ position: 'relative', marginBottom: 2 }}
        onMouseEnter={() => {
          if (anchorRef.current) {
            const r = anchorRef.current.getBoundingClientRect();
            setFlyoutPos({ top: r.top });
          }
          setFlyoutOpen(true);
        }}
        onMouseLeave={() => setFlyoutOpen(false)}
      >
        {/* Icon anchor */}
        <div ref={anchorRef} style={{
          width: 34, height: 34, borderRadius: 8, margin: '0 auto 2px',
          background: hasActive ? '#eeecff' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.15s',
          color: hasActive ? '#6c63ff' : '#94a3b8',
        }}>
          {meta.Icon && <meta.Icon size={16} strokeWidth={1.8} />}
        </div>

        {/* Flyout panel */}
        {flyoutOpen && typeof document !== 'undefined' && ReactDOM.createPortal(
          <div ref={flyoutRef} style={{
            position: 'fixed', top: flyoutPos.top, left: 72,
            background: '#fff', borderRadius: 10,
            border: '1px solid var(--border-card)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            padding: '8px 6px', zIndex: 500, minWidth: 180,
            animation: 'fadeInLeft 0.15s ease',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "'Poppins',sans-serif", color: meta.color, padding: '6px 10px 8px', letterSpacing: 0 }}>
              {meta.label}
            </div>
            {items.map(item => (
              <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                collapsed={false} pathname={pathname} search={search}
              />
            ))}
          </div>,
          document.body
        )}
      </div>
    );
  }

  // ── Expanded sidebar: clickable header + animated children ────────────────
  // Styled identically to NavLink — same colours, same padding, same font weight.
  // The only addition is the ChevronDown on the right.
  const GroupIcon = meta.Icon;
  const iconCol   = hasActive ? '#6c63ff' : '#94a3b8';
  const txtCol    = hasActive ? '#6c63ff' : '#64748b';
  const bgActive  = '#eeecff';
  return (
    <div style={{ marginBottom: 2 }}>
      {/* Group header button — mirrors NavLink styling exactly */}
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          background: hasActive && !isOpen ? bgActive : 'transparent',
          border: 'none', borderRadius: 8, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 9,
          padding: '7px 10px',
          fontFamily: "'Poppins', sans-serif",
          marginBottom: 1, transition: 'background 0.14s',
        }}
        onMouseEnter={e => { if (!hasActive || isOpen) e.currentTarget.style.background = '#f1f5f9'; }}
        onMouseLeave={e => { e.currentTarget.style.background = hasActive && !isOpen ? bgActive : 'transparent'; }}
      >
        {GroupIcon && (
          <span style={{ display: 'flex', alignItems: 'center', color: iconCol, flexShrink: 0, transition: 'color 0.14s' }}>
            <GroupIcon size={15} strokeWidth={1.8} />
          </span>
        )}
        <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: hasActive ? 600 : 500, color: txtCol, letterSpacing: 0 }}>
          {meta.label}
        </span>
        {/* Active dot when closed but has active child */}
        {hasActive && !isOpen && (
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#6c63ff', flexShrink: 0 }} />
        )}
        <span style={{
          display: 'flex', alignItems: 'center',
          color: '#94a3b8', flexShrink: 0,
          transform: isOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s ease',
        }}>
          <ChevronDown size={13} strokeWidth={2} />
        </span>
      </button>

      {/* Animated children */}
      <div style={{
        overflow: 'hidden',
        maxHeight: isOpen ? `${items.length * 36}px` : '0px',
        transition: 'max-height 0.25s ease',
        paddingLeft: 6,
      }}>
        {items.map(item => (
          <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
            collapsed={false} pathname={pathname} search={search}
          />
        ))}
      </div>
    </div>
  );
}

// ── Mobile detection hook ─────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

// ── Mobile bottom nav items — role-aware subset of NAV_ITEMS ─────────────────
// Only the most essential links for each role group — 4 items max fits 375px
function getMobileNavItems(user, flockStages) {
  if (!user) return [];
  const role = user.role;

  if (role === 'PEN_WORKER') {
    const items = [
      { href: '/dashboard',  icon: '🏠', label: 'Home'  },
      { href: '/worker',     icon: '✅', label: 'Tasks' },
      { href: '/performance',icon: '📊', label: 'Stats' },
    ];
    if (flockStages.includes('BROODING')) items.splice(2, 0, { href: '/brooding', icon: '🐣', label: 'Brooding' });
    return items.slice(0, 4);
  }
  if (role === 'PEN_MANAGER') return [
    { href: '/dashboard',              icon: '🏠', label: 'Home'    },
    { href: '/verification',           icon: '✅', label: 'Verify'  },
    { href: '/pen-manager/daily-summaries', icon: '📋', label: 'Summaries' },
    { href: '/performance',            icon: '📊', label: 'Stats'   },
  ];
  if (role === 'FARM_MANAGER') return [
    { href: '/dashboard',    icon: '🏠', label: 'Home'   },
    { href: '/farm-structure', icon: '🏗️', label: 'Farm' },
    { href: '/verification', icon: '✅', label: 'Verify' },
    { href: '/performance',  icon: '📊', label: 'Stats'  },
  ];
  if (['FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'].includes(role)) return [
    { href: '/dashboard',    icon: '🏠', label: 'Home'    },
    { href: '/farm-structure', icon: '🏗️', label: 'Farm'  },
    { href: '/verification', icon: '✅', label: 'Verify'  },
    { href: '/finance',      icon: '💰', label: 'Finance' },
  ];
  if (['STORE_MANAGER','STORE_CLERK'].includes(role)) return [
    { href: '/dashboard', icon: '🏠', label: 'Home'  },
    { href: '/store',     icon: '📦', label: 'Store' },
    { href: '/feed',      icon: '🌾', label: 'Feed'  },
  ];
  // Fallback
  return [{ href: '/dashboard', icon: '🏠', label: 'Home' }];
}

// ── AppShell ──────────────────────────────────────────────────────────────────
// Inner component that safely uses useSearchParams (must be wrapped in Suspense)
function AppShellInner({ children, search }) {
  return <AppShellContent search={search}>{children}</AppShellContent>;
}

function SearchParamsProvider({ children }) {
  const searchParams = useSearchParams();
  const search = searchParams.toString() ? `?${searchParams.toString()}` : '';
  return <AppShellContent search={search}>{children}</AppShellContent>;
}

export default function AppShell({ children }) {
  return (
    <Suspense fallback={<AppShellContent search="">{children}</AppShellContent>}>
      <SearchParamsProvider>{children}</SearchParamsProvider>
    </Suspense>
  );
}

function AppShellContent({ children, search }) {
  const { user, logout, apiFetch } = useAuth();

  // ── PWA: register service worker + push subscription ─────────────────
  usePWA(apiFetch);

  const pathname         = usePathname();
  const isMobile         = useIsMobile();

  const [collapsed,     setCollapsed]     = useState(false);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [profileOpen,   setProfileOpen]   = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [notifLoading,  setNotifLoading]  = useState(false);

  // ── Farm alerts ──────────────────────────────────────────────────────────────
  const [alertsOpen,    setAlertsOpen]    = useState(false);
  const [alertsList,    setAlertsList]    = useState([]);
  const [alertsCounts,  setAlertsCounts]  = useState(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const alertsBellRef = useRef(null);

  const canSeeAlerts = ALERT_ICON_ROLES.includes(user?.role);

  // Tenant operation mode
  const [opMode,        setOpMode]        = useState('LAYER_ONLY');
  const [hasFeedMill,   setHasFeedMill]   = useState(false);
  const [hasProcessing, setHasProcessing] = useState(false);

  // Per-user operation type: null = unrestricted; 'LAYER' | 'BROILER' = pen-scoped
  const [userOpType,  setUserOpType]  = useState(null);
  const [flockStages, setFlockStages] = useState([]);  // active flock stages in worker's sections

  const bellRef    = useRef(null);
  const profileRef = useRef(null);

  const isPenScoped = PEN_SCOPED_ROLES.includes(user?.role);
  const sideW       = collapsed ? 64 : 220;
  const initials    = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : '?';
  const roleLabel   = ROLE_LABELS[user?.role] || user?.role || '';

  // ── Load tenant settings (operation mode, add-on flags) ─────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('pfp_token');
        const res   = await fetch('/api/settings', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const data  = await res.json();
        if (cancelled) return;
        setOpMode(data.settings?.operationMode   || 'LAYER_ONLY');
        setHasFeedMill(!!data.settings?.hasFeedMillModule);
        setHasProcessing(!!data.settings?.hasProcessingModule);
      } catch { /* fall back to LAYER_ONLY defaults */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ── Load + poll user operation type (pen-scoped roles only) ─────────────────
  // Polled every 30 s so reassignments are reflected without a logout.
  const fetchUserOpType = useCallback(async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('pfp_token');
      const res   = await fetch('/api/me/operation', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data  = await res.json();
      setUserOpType(data.operationType ?? null);
      setFlockStages(data.flockStages  ?? []);
    } catch { /* silent */ }
  }, [user]);

  useEffect(() => {
    fetchUserOpType();
    if (!isPenScoped) return; // only poll for roles that can be reassigned
    const interval = setInterval(fetchUserOpType, 30_000);
    return () => clearInterval(interval);
  }, [fetchUserOpType, isPenScoped]);

  // ── Build visible nav items ──────────────────────────────────────────────────
  const visibleItems = (() => {
    if (!user) return [];

    const isBothMode = opMode === 'BOTH';

    // In single-op modes replace the split layer/broiler flocks entries with one plain Flocks item
    const catalogue = isBothMode
      ? NAV_ITEMS
      : [
          ...NAV_ITEMS.filter(i => i.href !== '/farm?op=layer' && i.href !== '/farm?op=broiler'),
          FLOCKS_SINGLE,
        ];

    return catalogue.filter(item => {
      if (!item.roles.includes(user.role))                          return false;
      if (item.opModes && !item.opModes.includes(opMode))           return false;
      if (item.requiresFeedMill   && !hasFeedMill)                  return false;
      if (item.requiresProcessing && !hasProcessing)                return false;
      // Pen-scoped users: hide the other operation's section items
      if (isPenScoped && userOpType) {
        if (item.section === 'layer'   && userOpType !== 'LAYER')   return false;
        if (item.section === 'broiler' && userOpType !== 'BROILER') return false;
      }
      // Brooding nav — only show when worker has an active BROODING-stage flock.
      // This works for both LAYER and BROILER workers:
      //   - Broiling BROILER worker with active BROODING flock → ✅
      //   - Broiler worker after "End Brooding" (flock now PRODUCTION) → ❌ auto-hides
      //   - Layer brooding worker → ✅
      //   - Layer production worker → ❌
      if (isPenScoped && item.href === '/brooding') {
        return flockStages.includes('BROODING');
      }
      // Rearing nav — only show for LAYER workers (broiling has no rearing stage)
      //   - Layer brooding worker → ✅ (they hand off to rearing)
      //   - Layer production worker → ✅ (they receive rearing flocks)
      //   - Any BROILER worker → ❌
      if (isPenScoped && item.href === '/rearing') {
        return userOpType === 'LAYER';
      }
      return true;
    });
  })();

  // Bucket by section
  const topItems     = visibleItems.filter(i => i.section === 'top');
  const layerItems   = visibleItems.filter(i => i.section === 'layer');
  const broilerItems = visibleItems.filter(i => i.section === 'broiler');
  const sharedItems  = visibleItems.filter(i => i.section === 'shared');

  // Collapsible groups only apply for manager-and-above in BOTH mode
  const showSections = MANAGER_UP_ROLES.includes(user?.role) && opMode === 'BOTH';

  // ── Collapsible group open/closed state ──────────────────────────────────────
  // Persisted in localStorage so it survives page navigation.
  // Auto-expands the group that contains the current route on mount.
  const [groupOpen, setGroupOpen] = useState(() => {
    if (typeof window === 'undefined') return { layer: true, broiler: false, operations: true, intelligence: false, business: false, processing: false };
    try {
      const saved = JSON.parse(localStorage.getItem('pfp_nav_groups') || '{}');
      return {
        layer:        saved.layer        ?? true,
        broiler:      saved.broiler      ?? false,
        operations:   saved.operations   ?? true,
        intelligence: saved.intelligence ?? false,
        business:     saved.business     ?? false,
        processing:   saved.processing   ?? false,
      };
    } catch { return { layer: true, broiler: false, operations: true, intelligence: false, business: false, processing: false }; }
  });

  // Auto-expand the group containing the active route
  useEffect(() => {
    const activeLayer   = layerItems.some(i => {
      const [p, q] = i.href.split('?');
      return q ? pathname === p && search === `?${q}` : pathname === p || pathname.startsWith(p + '/');
    });
    const activeBroiler = broilerItems.some(i => {
      const [p, q] = i.href.split('?');
      return q ? pathname === p && search === `?${q}` : pathname === p || pathname.startsWith(p + '/');
    });
    // Find active module group (operations / intelligence / business / processing)
    const activeModuleGroup = MODULE_GROUP_ORDER.find(grp =>
      visibleItems.filter(i => i.group === grp).some(item => {
        const [p, q] = item.href.split('?');
        return q ? pathname === p && search === `?${q}` : pathname === p || pathname.startsWith(p + '/');
      })
    );

    if (activeLayer || activeBroiler || activeModuleGroup) {
      setGroupOpen(prev => {
        // Accordion: only keep the newly active group open, close everything else
        const next = {
          layer:        activeLayer       ? true  : false,
          broiler:      activeBroiler     ? true  : false,
          operations:   activeModuleGroup === 'operations'   ? true : false,
          intelligence: activeModuleGroup === 'intelligence' ? true : false,
          business:     activeModuleGroup === 'business'     ? true : false,
          processing:   activeModuleGroup === 'processing'   ? true : false,
        };
        // If nothing matched (e.g. dashboard page not in any group), preserve existing state
        const anyActive = activeLayer || activeBroiler || activeModuleGroup;
        const finalNext = anyActive ? next : prev;
        try { localStorage.setItem('pfp_nav_groups', JSON.stringify(finalNext)); } catch {}
        return finalNext;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  const toggleGroup = (key) => {
    setGroupOpen(prev => {
      const isOpening = !prev[key];
      // Accordion behaviour: opening a group collapses all others
      const next = isOpening
        ? { layer: false, broiler: false, operations: false, intelligence: false, business: false, processing: false, [key]: true }
        : { ...prev, [key]: false };
      try { localStorage.setItem('pfp_nav_groups', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // ── Notifications ────────────────────────────────────────────────────────────
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

  // ── Farm alerts fetch + 60s poll ─────────────────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    if (!user || !ALERT_ICON_ROLES.includes(user.role)) return;
    try {
      const token = localStorage.getItem('pfp_token');
      const res   = await fetch('/api/dashboard/alerts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) return; // route not deployed yet — silent
      if (!res.ok) return;
      const data = await res.json();
      setAlertsList(data.alerts  || []);
      setAlertsCounts(data.counts || null);
    } catch { /* silent */ }
  }, [user]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const openAlerts = async () => {
    if (alertsOpen) { setAlertsOpen(false); return; }
    setNotifOpen(false); // close notifications if open
    setAlertsOpen(true);
    setAlertsLoading(true);
    try {
      const token = localStorage.getItem('pfp_token');
      const res   = await fetch('/api/dashboard/alerts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAlertsList(data.alerts  || []);
        setAlertsCounts(data.counts || null);
      }
    } catch { /* silent */ }
    finally { setAlertsLoading(false); }
  };

  const openNotifications = async () => {
    if (notifOpen) { setNotifOpen(false); return; }
    setAlertsOpen(false); // close alerts if open
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

  // ── Avatar helpers ───────────────────────────────────────────────────────────
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

  const mobileNavItems = getMobileNavItems(user, flockStages);

  return (
    <>
    <ConnectivityBanner />
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-base)', fontFamily: "'Nunito', sans-serif" }}>
      <style>{`
        @keyframes fadeInUp   { from { opacity:0; transform:translateY(6px)  } to { opacity:1; transform:none } }
        @keyframes fadeInLeft { from { opacity:0; transform:translateX(-6px) } to { opacity:1; transform:none } }
      `}</style>

      {/* ── Sidebar — hidden on mobile ───────────────────────────────────────── */}
      {!isMobile && (
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
          flexShrink: 0,
        }}>
          <div style={{
            width: 34, height: 34,
            background: 'linear-gradient(135deg,#6c63ff,#48c774)',
            borderRadius: 9, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 18, flexShrink: 0,
          }}><Bird size={18} strokeWidth={1.8} color="#fff" /></div>
          {!collapsed && (
            <div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.2 }}>PoultryFarm</div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, color: 'var(--purple)', lineHeight: 1.2 }}>Pro</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>

          {/* Top items — always visible, no grouping */}
          {topItems.map(item => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
              collapsed={collapsed} pathname={pathname} search={search} />
          ))}

          {/* Layer Production — collapsible group (BOTH mode + manager+) */}
          {layerItems.length > 0 && showSections ? (
            <CollapsibleGroup
              section="layer"
              items={layerItems}
              isOpen={groupOpen.layer}
              onToggle={() => toggleGroup('layer')}
              collapsed={collapsed}
              pathname={pathname}
              search={search}
            />
          ) : layerItems.length > 0 ? (
            /* Single-op or pen-scoped: flat list, no group header */
            layerItems.map(item => (
              <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                collapsed={collapsed} pathname={pathname} search={search} />
            ))
          ) : null}

          {/* Broiler Production — collapsible group (BOTH mode + manager+) */}
          {broilerItems.length > 0 && showSections ? (
            <CollapsibleGroup
              section="broiler"
              items={broilerItems}
              isOpen={groupOpen.broiler}
              onToggle={() => toggleGroup('broiler')}
              collapsed={collapsed}
              pathname={pathname}
              search={search}
            />
          ) : broilerItems.length > 0 ? (
            broilerItems.map(item => (
              <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                collapsed={collapsed} pathname={pathname} search={search} />
            ))
          ) : null}

          {/* Module groups — Operations, Intelligence, Business, Processing */}
          {/* Each group shows a slim divider label + its items, collapsible */}
          {MODULE_GROUP_ORDER.map(grp => {
            const grpItems = sharedItems.filter(i => i.group === grp);
            if (grpItems.length === 0) return null;
            const meta = MODULE_GROUPS[grp];
            const isOpen = groupOpen[grp];
            const hasActive = grpItems.some(item => {
              const [p, q] = item.href.split('?');
              return q ? pathname === p && search === `?${q}` : pathname === p || pathname.startsWith(p + '/');
            });

            // Collapsed sidebar: just render the items flat (the CollapsibleGroup flyout
            // handles the production sections; for these smaller groups we keep it simple)
            if (collapsed) {
              return (
                <div key={grp} style={{ marginTop: 4 }}>
                  {grpItems.map(item => (
                    <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                      collapsed={collapsed} pathname={pathname} search={search} />
                  ))}
                </div>
              );
            }

            // Expanded sidebar: group header styled to match CollapsibleGroup
            const bgActive  = hasActive && !isOpen ? '#eeecff' : 'transparent';
            const iconCol   = hasActive ? meta.color : '#94a3b8';
            const txtCol    = hasActive ? meta.color : '#64748b';
            return (
              <div key={grp} style={{ marginTop: 2 }}>
                {/* Group header — mirrors CollapsibleGroup button styling exactly */}
                <button
                  onClick={() => toggleGroup(grp)}
                  style={{
                    width: '100%', background: bgActive, border: 'none',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 10px', borderRadius: 8, marginBottom: 1,
                    fontFamily: "'Poppins', sans-serif", transition: 'background 0.14s',
                  }}
                  onMouseEnter={e => { if (!hasActive || isOpen) e.currentTarget.style.background = '#f1f5f9'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bgActive; }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    {meta.emoji}
                  </span>
                  <span style={{
                    flex: 1, textAlign: 'left',
                    fontSize: 13, fontWeight: hasActive ? 600 : 500,
                    color: txtCol, letterSpacing: 0,
                  }}>
                    {meta.label}
                  </span>
                  {hasActive && !isOpen && (
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                  )}
                  <span style={{
                    display: 'flex', alignItems: 'center', color: '#94a3b8', flexShrink: 0,
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s ease',
                  }}>
                    <ChevronDown size={13} strokeWidth={2} />
                  </span>
                </button>

                {/* Animated item list */}
                <div style={{
                  overflow: 'hidden',
                  maxHeight: isOpen ? `${grpItems.length * 36}px` : '0px',
                  transition: 'max-height 0.22s ease',
                }}>
                  {grpItems.map(item => (
                    <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
                      collapsed={false} pathname={pathname} search={search} accentColor={meta.color} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Any shared items without a group — render flat as before (safety net) */}
          {sharedItems.filter(i => !i.group).map(item => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label}
              collapsed={collapsed} pathname={pathname} search={search} />
          ))}
        </nav>

        {/* ── Bottom: collapse + profile ──────────────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border-card)', padding: '10px 8px', flexShrink: 0 }}>
          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(p => !p)}
            style={{
              width: '100%', background: 'transparent', border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10, padding: '7px 12px', borderRadius: 8,
              color: 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit', marginBottom: 4,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center' }}>
              {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.8} /> : <PanelLeftClose size={15} strokeWidth={1.8} />}
            </span>
            {!collapsed && <span style={{ fontFamily: "'Poppins',sans-serif", fontSize: 12, fontWeight: 500 }}>Collapse</span>}
          </button>

          {/* Profile card → opens popover */}
          <button
            ref={profileRef}
            onClick={() => setProfileOpen(p => !p)}
            style={{
              width: '100%', border: 'none', borderRadius: 9,
              background: profileOpen ? 'var(--purple-light)' : 'transparent',
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: 10, padding: collapsed ? '8px 0' : '8px 10px',
              transition: 'background 0.15s',
              outline: profileOpen ? '2px solid #d4d8ff' : 'none',
            }}
            onMouseEnter={e => { if (!profileOpen) e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={e => { if (!profileOpen) e.currentTarget.style.background = profileOpen ? 'var(--purple-light)' : 'transparent'; }}
          >
            <div style={avatarStyle(32)}>{avatarContent}</div>
            {!collapsed && (
              <>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user?.firstName} {user?.lastName}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{roleLabel}</div>
                </div>
                <span style={{ display: 'flex', alignItems: 'center', color: profileOpen ? '#6c63ff' : '#94a3b8', transition: 'color 0.15s, transform 0.2s', transform: profileOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
                  <ChevronDown size={13} strokeWidth={2.5} />
                </span>
              </>
            )}
          </button>
        </div>
      </aside>
      )} {/* end !isMobile sidebar */}

      {/* Profile popover — rendered via portal */}
      {profileOpen && (
        <ProfilePopover
          user={user}
          logout={logout}
          onClose={() => setProfileOpen(false)}
          anchorRef={profileRef}
        />
      )}

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Topbar */}
        <header style={{
          height: isMobile ? 56 : 60,
          background: '#fff', borderBottom: '1px solid var(--border-card)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: isMobile ? '0 14px' : '0 24px',
          position: 'sticky', top: 0, zIndex: 100,
          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          <div>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: isMobile ? 13 : 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {user?.farmName || 'PoultryFarm Pro'}
            </div>
            {!isMobile && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}
            {isMobile && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* ── Farm Alerts icon — manager+ roles only ── */}
            {canSeeAlerts && (() => {
              const critCount = alertsCounts?.critical || 0;
              const warnCount = alertsCounts?.warning  || 0;
              const totalBadge = critCount + warnCount;
              const badgeColor = critCount > 0 ? '#dc2626' : '#d97706';
              return (
                <>
                  <button
                    ref={alertsBellRef}
                    onClick={openAlerts}
                    title="Farm Alerts"
                    style={{
                      position: 'relative',
                      background: alertsOpen
                        ? (critCount > 0 ? '#fef2f2' : '#fffbeb')
                        : (totalBadge > 0 ? (critCount > 0 ? '#fef2f2' : '#fffbeb') : 'var(--bg-elevated)'),
                      border: `1px solid ${alertsOpen || totalBadge > 0
                        ? (critCount > 0 ? '#fecaca' : '#fde68a')
                        : 'var(--border)'}`,
                      borderRadius: 9, width: 36, height: 36,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                  >
                    <AlertTriangle
                      size={16} strokeWidth={1.8}
                      color={totalBadge > 0 ? badgeColor : '#64748b'}
                    />
                    {totalBadge > 0 && (
                      <span style={{
                        position: 'absolute', top: -4, right: -4,
                        minWidth: 16, height: 16,
                        background: badgeColor,
                        borderRadius: '50%', fontSize: 9, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, border: '2px solid #fff', padding: '0 3px',
                        animation: critCount > 0 ? 'pillPulse 1.8s ease-in-out infinite' : 'none',
                      }}>
                        {totalBadge > 99 ? '99+' : totalBadge}
                      </span>
                    )}
                  </button>

                  {alertsOpen && (
                    <AlertsDropdown
                      alerts={alertsList}
                      counts={alertsCounts}
                      loading={alertsLoading}
                      onClose={() => setAlertsOpen(false)}
                      onRefresh={async () => {
                        setAlertsLoading(true);
                        await fetchAlerts();
                        setAlertsLoading(false);
                      }}
                      anchorRef={alertsBellRef}
                    />
                  )}
                </>
              );
            })()}

            {/* Bell */}
            <button ref={bellRef} onClick={openNotifications} style={{
              position: 'relative',
              background: notifOpen ? 'var(--purple-light)' : 'var(--bg-elevated)',
              border: `1px solid ${notifOpen ? '#d4d8ff' : 'var(--border)'}`,
              borderRadius: 9, width: 36, height: 36,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: 16, transition: 'all 0.15s',
            }}>
              <Bell size={16} strokeWidth={1.8} color={notifOpen ? "#6c63ff" : "#64748b"} />
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

            {/* Avatar chip — also opens profile popover */}
            <button
              onClick={() => setProfileOpen(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 12px',
                background: profileOpen ? '#e4e2ff' : 'var(--purple-light)',
                border: '1px solid #d4d8ff', borderRadius: 9,
                cursor: 'pointer', transition: 'background 0.15s', fontFamily: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#e4e2ff'}
              onMouseLeave={e => { if (!profileOpen) e.currentTarget.style.background = 'var(--purple-light)'; }}
            >
              <div style={avatarStyle(26)}>{avatarContent}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>{user?.firstName}</div>
              <ChevronDown size={12} strokeWidth={2.5} color="#6c63ff" style={{ opacity: 0.7 }} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main style={{
          flex: 1,
          padding: isMobile ? '16px 14px' : '24px',
          paddingBottom: isMobile ? '80px' : '24px',
          overflowY: 'auto',
        }}>
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────────── */}
      {isMobile && (
        <nav style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          height: 60, background: '#fff',
          borderTop: '1px solid var(--border-card)',
          zIndex: 200, boxShadow: '0 -2px 12px rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'stretch',
        }}>
          {mobileNavItems.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href} style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 3, textDecoration: 'none',
                fontSize: 9, fontWeight: 700,
                color: active ? 'var(--purple)' : 'var(--text-muted)',
                fontFamily: "'Nunito', sans-serif",
                padding: '6px 0',
                borderTop: active ? '2px solid var(--purple)' : '2px solid transparent',
                transition: 'color 0.15s',
              }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
    </>
  );
}

