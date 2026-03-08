'use client';
// app/audit/page.js — Audit Log Viewer
import { useState, useEffect, useCallback, useRef } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ── Meta ──────────────────────────────────────────────────────────────────────
const ACTION_META = {
  LOGIN:       { label: 'Login',       color: '#3b82f6', bg: '#eff6ff', icon: '🔑' },
  CREATE:      { label: 'Create',      color: '#16a34a', bg: '#f0fdf4', icon: '➕' },
  UPDATE:      { label: 'Update',      color: '#f59e0b', bg: '#fffbeb', icon: '✏️' },
  DELETE:      { label: 'Delete',      color: '#ef4444', bg: '#fef2f2', icon: '🗑️' },
  APPROVE:     { label: 'Approve',     color: '#8b5cf6', bg: '#f5f3ff', icon: '✅' },
  REJECT:      { label: 'Reject',      color: '#ef4444', bg: '#fef2f2', icon: '↩️' },
  ROLE_CHANGE: { label: 'Role Change', color: '#ec4899', bg: '#fdf2f8', icon: '👤' },
};

const ENTITY_META = {
  User:            { icon: '👥', color: '#6c63ff' },
  Farm:            { icon: '🏡', color: '#16a34a' },
  Flock:           { icon: '🐦', color: '#3b82f6' },
  FeedConsumption: { icon: '🌾', color: '#f59e0b' },
  FeedInventory:   { icon: '📦', color: '#f97316' },
  FeedMillBatch:   { icon: '⚙️',  color: '#8b5cf6' },
  StoreReceipt:    { icon: '🧾', color: '#14b8a6' },
  PurchaseOrder:   { icon: '🛒', color: '#ec4899' },
  DailyReport:     { icon: '📋', color: '#64748b' },
  Verification:    { icon: '✅', color: '#22c55e' },
};

const ENTITY_TYPES = Object.keys(ENTITY_META);
const ACTIONS      = Object.keys(ACTION_META);

const fmtDate = d => new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = d => new Date(d).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
const fmtTs   = d => `${fmtDate(d)} ${fmtTime(d)}`;

function timeAgo(d) {
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function ActionBadge({ action }) {
  const m = ACTION_META[action] || { label: action, color: '#64748b', bg: '#f8fafc', icon: '•' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: m.bg, color: m.color, border: `1px solid ${m.color}25`,
      whiteSpace: 'nowrap',
    }}>
      {m.icon} {m.label}
    </span>
  );
}

function EntityBadge({ type }) {
  const m = ENTITY_META[type] || { icon: '📄', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: `${m.color}12`, color: m.color, border: `1px solid ${m.color}25`,
      whiteSpace: 'nowrap',
    }}>
      {m.icon} {type}
    </span>
  );
}

function RoleBadge({ role }) {
  const colors = {
    SUPER_ADMIN:   ['#ef4444','#fef2f2'],
    FARM_ADMIN:    ['#8b5cf6','#f5f3ff'],
    CHAIRPERSON:   ['#f59e0b','#fffbeb'],
    FARM_MANAGER:  ['#3b82f6','#eff6ff'],
    PEN_MANAGER:   ['#14b8a6','#f0fdfa'],
    PEN_WORKER:    ['#64748b','#f8fafc'],
    STORE_MANAGER: ['#ec4899','#fdf2f8'],
    STORE_CLERK:   ['#84cc16','#f7fee7'],
  };
  const [color, bg] = colors[role] || ['#64748b','#f8fafc'];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: bg, color }}>
      {role?.replace(/_/g,' ')}
    </span>
  );
}

function Skel({ h = 40, w = '100%' }) {
  return <div style={{ height: h, width: w, background: 'var(--bg-elevated)', borderRadius: 6, animation: 'pulse 1.5s infinite' }} />;
}

// ── Changes diff viewer ───────────────────────────────────────────────────────
function ChangeDiff({ changes }) {
  if (!changes || Object.keys(changes).length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;

  const hasBefore = changes.before !== undefined;
  const hasAfter  = changes.after  !== undefined;

  if (hasBefore || hasAfter) {
    // Structured before/after diff
    const keys = [...new Set([...Object.keys(changes.before || {}), ...Object.keys(changes.after || {})])];
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {keys.map(k => {
          const before = changes.before?.[k];
          const after  = changes.after?.[k];
          const same   = JSON.stringify(before) === JSON.stringify(after);
          if (same) return null;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', minWidth: 80 }}>{k}</span>
              {before !== undefined && (
                <span style={{ fontSize: 10, padding: '1px 6px', background: '#fef2f2', color: '#ef4444', borderRadius: 4, textDecoration: 'line-through' }}>
                  {String(before)}
                </span>
              )}
              {before !== undefined && after !== undefined && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>→</span>}
              {after !== undefined && (
                <span style={{ fontSize: 10, padding: '1px 6px', background: '#f0fdf4', color: '#16a34a', borderRadius: 4 }}>
                  {String(after)}
                </span>
              )}
            </div>
          );
        }).filter(Boolean)}
      </div>
    );
  }

  // Flat key-value changes (no before/after)
  const entries = Object.entries(changes).slice(0, 6);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {entries.map(([k, v]) => (
        <span key={k} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
          <span style={{ fontWeight: 600 }}>{String(v).slice(0, 40)}</span>
        </span>
      ))}
      {Object.keys(changes).length > 6 && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{Object.keys(changes).length - 6} more</span>
      )}
    </div>
  );
}

// ── Row detail expand ─────────────────────────────────────────────────────────
function AuditRow({ log, isExpanded, onToggle }) {
  const am = ACTION_META[log.action]  || { color: '#64748b', bg: '#f8fafc' };
  const em = ENTITY_META[log.entityType] || { color: '#64748b' };

  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer', background: isExpanded ? `${am.bg}` : undefined, transition: 'background 0.1s' }}
        onMouseEnter={e  => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
        onMouseLeave={e  => { if (!isExpanded) e.currentTarget.style.background = ''; }}
      >
        <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtDate(log.createdAt)}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{fmtTime(log.createdAt)}</div>
        </td>
        <td style={{ padding: '11px 16px' }}>
          {log.user ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{log.user.firstName} {log.user.lastName}</div>
              <div style={{ marginTop: 2 }}><RoleBadge role={log.user.role} /></div>
            </div>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>System</span>
          )}
        </td>
        <td style={{ padding: '11px 16px' }}><ActionBadge action={log.action} /></td>
        <td style={{ padding: '11px 16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <EntityBadge type={log.entityType} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{log.entityId}</span>
          </div>
        </td>
        <td style={{ padding: '11px 16px', maxWidth: 280 }}>
          <ChangeDiff changes={log.changes} />
        </td>
        <td style={{ padding: '11px 16px', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(log.createdAt)}</span>
        </td>
        <td style={{ padding: '11px 16px' }}>
          <span style={{ fontSize: 14, color: 'var(--text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0, background: `${am.bg}` }}>
            <div style={{ padding: '14px 20px', borderTop: `2px solid ${am.color}20`, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Timestamp</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtTs(log.createdAt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>User ID</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.userId}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Entity ID</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.entityId}</div>
              </div>
              {log.changes && Object.keys(log.changes).length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Full Change Data</div>
                  <pre style={{ fontSize: 11, background: '#fff', border: '1px solid var(--border)', borderRadius: 7, padding: '10px 14px', overflowX: 'auto', margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {JSON.stringify(log.changes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Filter sidebar pill ───────────────────────────────────────────────────────
function FilterPill({ label, active, color, count, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%', padding: '7px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', textAlign: 'left',
      background: active ? `${color}15` : 'transparent',
      color: active ? color : 'var(--text-secondary)',
      fontWeight: active ? 700 : 500, fontSize: 12, transition: 'background 0.1s',
    }}>
      <span>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: active ? color : 'var(--bg-elevated)', color: active ? '#fff' : 'var(--text-muted)' }}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

// ── CSV export helper ─────────────────────────────────────────────────────────
function exportCSV(logs) {
  const headers = ['Timestamp', 'User', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Changes'];
  const rows = logs.map(l => [
    fmtTs(l.createdAt),
    l.user ? `${l.user.firstName} ${l.user.lastName}` : 'System',
    l.user?.role || '',
    l.action,
    l.entityType,
    l.entityId,
    l.changes ? JSON.stringify(l.changes).replace(/"/g, '""') : '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AuditPage() {
  const { apiFetch } = useAuth();

  const [logs,       setLogs]       = useState([]);
  const [pagination, setPagination] = useState(null);
  const [meta,       setMeta]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  // Filters
  const [entityType, setEntityType] = useState('');
  const [action,     setAction]     = useState('');
  const [from,       setFrom]       = useState('');
  const [to,         setTo]         = useState('');
  const [search,     setSearch]     = useState('');
  const [page,       setPage]       = useState(1);

  const searchTimeout = useRef(null);

  const load = useCallback(async (overrides = {}) => {
    setLoading(true);
    const params = new URLSearchParams({
      page:  String(overrides.page       ?? page),
      limit: '50',
      ...(overrides.entityType ?? entityType ? { entityType: overrides.entityType ?? entityType } : {}),
      ...(overrides.action     ?? action     ? { action:     overrides.action     ?? action }     : {}),
      ...(overrides.from       ?? from       ? { from:       overrides.from       ?? from }       : {}),
      ...(overrides.to         ?? to         ? { to:         overrides.to         ?? to }         : {}),
      ...(overrides.search     ?? search     ? { search:     overrides.search     ?? search }     : {}),
    });
    try {
      const res = await apiFetch(`/api/audit?${params}`);
      if (res.ok) {
        const d = await res.json();
        setLogs(d.logs || []);
        setPagination(d.pagination);
        setMeta(d.meta);
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch, page, entityType, action, from, to, search]);

  useEffect(() => { load(); }, [load]);

  function applyFilter(key, val) {
    const newPage = 1;
    setPage(newPage);
    if (key === 'entityType') { setEntityType(val); load({ entityType: val, page: newPage }); }
    if (key === 'action')     { setAction(val);     load({ action: val,     page: newPage }); }
  }

  function handleSearchChange(val) {
    setSearch(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => { setPage(1); load({ search: val, page: 1 }); }, 400);
  }

  function handleDateFilter() {
    setPage(1);
    load({ from, to, page: 1 });
  }

  function clearFilters() {
    setEntityType(''); setAction(''); setFrom(''); setTo(''); setSearch(''); setPage(1);
    load({ entityType: '', action: '', from: '', to: '', search: '', page: 1 });
  }

  const hasFilters = entityType || action || from || to || search;

  // ── Export all (re-fetch with no limit) ──────────────────────────────────
  async function handleExport() {
    const params = new URLSearchParams({
      page: '1', limit: '100',
      ...(entityType ? { entityType } : {}),
      ...(action     ? { action }     : {}),
      ...(from       ? { from }       : {}),
      ...(to         ? { to }         : {}),
      ...(search     ? { search }     : {}),
    });
    const res = await apiFetch(`/api/audit?${params}`);
    if (res.ok) {
      const d = await res.json();
      exportCSV(d.logs);
    }
  }

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>🔍 Audit Log</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
              Complete record of all system actions — who changed what, when
            </p>
          </div>
          <button
            onClick={handleExport}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
            ⬇ Export CSV
          </button>
        </div>

        {/* ── Summary KPI strip ── */}
        {meta && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            {[
              { icon: '📋', label: 'Total Events',  value: pagination?.total?.toLocaleString() || '—', color: 'var(--purple)' },
              { icon: '➕', label: 'Creates',        value: (meta.actionCounts.find(a => a.action === 'CREATE')?.count || 0).toLocaleString(), color: '#16a34a' },
              { icon: '✏️', label: 'Updates',        value: (meta.actionCounts.find(a => a.action === 'UPDATE')?.count || 0).toLocaleString(), color: '#f59e0b' },
              { icon: '🗑️', label: 'Deletes',        value: (meta.actionCounts.find(a => a.action === 'DELETE')?.count || 0).toLocaleString(), color: '#ef4444' },
            ].map(k => (
              <div key={k.label} className="card" style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{k.label}</span>
                  <span style={{ fontSize: 18 }}>{k.icon}</span>
                </div>
                <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>

          {/* ── Left filter sidebar ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Search */}
            <div className="card" style={{ padding: 14 }}>
              <input
                type="text"
                className="input"
                placeholder="🔍 Search entity or ID…"
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                style={{ fontSize: 12 }}
              />
            </div>

            {/* Date range */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Date Range</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input type="date" className="input" value={from} onChange={e => setFrom(e.target.value)} style={{ fontSize: 11 }} />
                <input type="date" className="input" value={to}   onChange={e => setTo(e.target.value)}   style={{ fontSize: 11 }} />
                <button
                  onClick={handleDateFilter}
                  style={{ display: 'inline-flex', justifyContent: 'center', padding: '6px', borderRadius: 7, border: '1px solid var(--purple)', background: 'var(--purple-light)', color: 'var(--purple)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Apply
                </button>
              </div>
            </div>

            {/* Action filter */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Action</div>
              <FilterPill label="All Actions" active={!action} color="var(--purple)" onClick={() => applyFilter('action', '')} />
              {(meta?.actionCounts || ACTIONS.map(a => ({ action: a, count: 0 }))).map(({ action: a, count }) => {
                const m = ACTION_META[a] || {};
                return (
                  <FilterPill
                    key={a} label={`${m.icon || ''} ${m.label || a}`}
                    active={action === a} color={m.color || '#64748b'}
                    count={count}
                    onClick={() => applyFilter('action', action === a ? '' : a)}
                  />
                );
              })}
            </div>

            {/* Entity type filter */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Entity Type</div>
              <FilterPill label="All Types" active={!entityType} color="var(--purple)" onClick={() => applyFilter('entityType', '')} />
              {(meta?.entityCounts || ENTITY_TYPES.map(e => ({ entityType: e, count: 0 }))).map(({ entityType: et, count }) => {
                const m = ENTITY_META[et] || {};
                return (
                  <FilterPill
                    key={et} label={`${m.icon || ''} ${et}`}
                    active={entityType === et} color={m.color || '#64748b'}
                    count={count}
                    onClick={() => applyFilter('entityType', entityType === et ? '' : et)}
                  />
                );
              })}
            </div>

            {/* Clear filters */}
            {hasFilters && (
              <button
                onClick={clearFilters}
                style={{ display: 'inline-flex', justifyContent: 'center', padding: '8px', borderRadius: 8, border: '1px solid var(--red-border)', background: '#fff', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                ✕ Clear Filters
              </button>
            )}
          </div>

          {/* ── Main table ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Active filters strip */}
            {hasFilters && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Filters:</span>
                {entityType && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#eff6ff', color: '#3b82f6' }}>{entityType}</span>}
                {action     && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#f0fdf4', color: '#16a34a' }}>{action}</span>}
                {from       && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#fffbeb', color: '#f59e0b' }}>From {from}</span>}
                {to         && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#fffbeb', color: '#f59e0b' }}>To {to}</span>}
                {search     && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: '#f5f3ff', color: '#8b5cf6' }}>"{search}"</span>}
                {pagination  && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{pagination.total.toLocaleString()} result{pagination.total !== 1 ? 's' : ''}</span>}
              </div>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {loading ? (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Array(8).fill(0).map((_, i) => <Skel key={i} h={48} />)}
                </div>
              ) : logs.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>No audit events match your filters</div>
                  {hasFilters && (
                    <button onClick={clearFilters} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <colgroup>
                    <col style={{ width: 120 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 160 }} />
                    <col />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 32 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Changes</th>
                      <th>Age</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <AuditRow
                        key={log.id}
                        log={log}
                        isExpanded={expandedId === log.id}
                        onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Pagination ── */}
            {pagination && pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 4px' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    disabled={!pagination.hasPrev}
                    onClick={() => { const p = page - 1; setPage(p); load({ page: p }); }}
                    style={{ display: 'inline-flex', padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: pagination.hasPrev ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600, opacity: pagination.hasPrev ? 1 : 0.4, fontFamily: 'inherit' }}>
                    ← Prev
                  </button>
                  {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                    const p = Math.max(1, Math.min(pagination.totalPages - 4, page - 2)) + i;
                    return (
                      <button key={p} onClick={() => { setPage(p); load({ page: p }); }}
                        style={{ display: 'inline-flex', padding: '6px 12px', borderRadius: 7, border: `1px solid ${p === page ? 'var(--purple)' : 'var(--border)'}`, background: p === page ? 'var(--purple-light)' : '#fff', color: p === page ? 'var(--purple)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontWeight: p === page ? 700 : 500, fontFamily: 'inherit' }}>
                        {p}
                      </button>
                    );
                  })}
                  <button
                    disabled={!pagination.hasNext}
                    onClick={() => { const p = page + 1; setPage(p); load({ page: p }); }}
                    style={{ display: 'inline-flex', padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: pagination.hasNext ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 600, opacity: pagination.hasNext ? 1 : 0.4, fontFamily: 'inherit' }}>
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
