'use client';
// components/dashboard/StatAlertsPanel.js
// Renders alerts from /api/dashboard/alerts in a collapsible panel.
// Shows all alert types including statistical outliers.
// Used by ManagerDashboard, PenManagerDashboard, and IcDashboard.
//
// Props:
//   apiFetch  — from useAuth()
//   title     — panel title (default 'Farm Alerts')
//   maxAlerts — max alerts to show before "Show more" (default 8)
//   filterTypes — optional string[] to show only certain types (e.g. IC audit types)
//   compact   — boolean: smaller cards, less padding

import { useState, useEffect, useCallback } from 'react';

const TYPE_META = {
  // Operational
  MORTALITY_SPIKE:    { icon: '📉', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Mortality Alert',    actionLabel: 'View Mortality' },
  PENDING_VERIFICATION:{ icon: '⏳', color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'Pending Review',    actionLabel: 'Go to Verification' },
  LOW_STOCK:          { icon: '🌾', color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'Feed Stock',         actionLabel: 'View Feed' },
  HARVEST_DUE:        { icon: '🐔', color: '#6c63ff', bg: '#f5f3ff', border: '#ddd6fe', label: 'Harvest Due',        actionLabel: 'View Broiler' },
  WATER_ANOMALY:      { icon: '💧', color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', label: 'Water Alert',        actionLabel: 'View Performance' },
  // Statistical
  LAYING_RATE_DROP:   { icon: '🥚', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Laying Rate Drop',   actionLabel: 'View Performance' },
  FCR_ANOMALY:        { icon: '📈', color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'FCR Anomaly',        actionLabel: 'View Performance' },
  ZERO_MORT_STREAK:   { icon: '🔍', color: '#9333ea', bg: '#fdf4ff', border: '#e9d5ff', label: 'Audit Flag',         actionLabel: 'View Mortality' },
  FEED_EGG_RATIO:     { icon: '⚖️', color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'Feed-Egg Ratio',     actionLabel: 'View Performance' },
  BATCH_SUBMISSION:   { icon: '🕐', color: '#9333ea', bg: '#fdf4ff', border: '#e9d5ff', label: 'Audit Flag',         actionLabel: 'View Audit' },
};

const SEVERITY_META = {
  CRITICAL: { dot: '#dc2626', label: 'Critical', badgeBg: '#fef2f2', badgeColor: '#dc2626', badgeBorder: '#fecaca' },
  WARNING:  { dot: '#d97706', label: 'Warning',  badgeBg: '#fffbeb', badgeColor: '#d97706', badgeBorder: '#fde68a' },
  INFO:     { dot: '#6366f1', label: 'Info',     badgeBg: '#eef2ff', badgeColor: '#6366f1', badgeBorder: '#c7d2fe' },
};

function getMeta(type) {
  return TYPE_META[type] || {
    icon: '⚠️', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', label: type, actionLabel: 'View',
  };
}

export default function StatAlertsPanel({
  apiFetch,
  title = 'Farm Alerts',
  maxAlerts = 8,
  filterTypes = null,
  compact = false,
}) {
  const [alerts,    setAlerts]    = useState([]);
  const [counts,    setCounts]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [expanded,  setExpanded]  = useState(true);
  const [showAll,   setShowAll]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(''); // always clear stale error before each attempt
    try {
      const res = await apiFetch('/api/dashboard/alerts');
      // 404 means route not deployed yet — fail silently
      if (res.status === 404) { setAlerts([]); setCounts(null); return; }

      // Try to parse JSON regardless of status — the body may contain useful data
      let d = {};
      try { d = await res.json(); } catch { /* empty body */ }

      if (!res.ok) {
        // Server returned an error — show subtle message but keep any stale counts
        setError('Alerts temporarily unavailable');
        return;
      }

      // Success — clear any previous error and populate data
      setError('');
      let list = d.alerts || [];
      if (filterTypes?.length) {
        list = list.filter(a => filterTypes.includes(a.type));
      }
      setAlerts(list);
      setCounts(d.counts);
    } catch {
      // Network error — fail silently so the dashboard still loads
      setError('');
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const displayed = showAll ? alerts : alerts.slice(0, maxAlerts);
  const critCount = counts?.critical || 0;
  const warnCount = counts?.warning  || 0;
  const totalCount = filterTypes ? alerts.length : (counts?.total || 0);

  const headerColor = critCount > 0 ? '#dc2626' : warnCount > 0 ? '#d97706' : '#16a34a';
  const headerBg    = critCount > 0 ? '#fef2f2' : warnCount > 0 ? '#fffbeb' : '#f0fdf4';
  const headerBorder= critCount > 0 ? '#fecaca' : warnCount > 0 ? '#fde68a' : '#bbf7d0';

  if (loading) {
    return (
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: compact ? '10px 14px' : '14px 18px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-card)' }}>
          <div style={{ height: 14, width: '40%', background: '#f1f5f9', borderRadius: 6, animation: 'pulse 1.5s infinite' }} />
        </div>
        <div style={{ padding: compact ? '10px 12px' : '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: compact ? 52 : 68, background: '#f8fafc', borderRadius: 9, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', overflow: 'hidden', marginBottom: 20 }}>

      {/* ── Panel header ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: compact ? '10px 14px' : '13px 18px',
          background: totalCount > 0 ? headerBg : 'var(--bg-elevated)',
          border: 'none', borderBottom: expanded ? `1px solid ${totalCount > 0 ? headerBorder : 'var(--border-card)'}` : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: compact ? 14 : 16 }}>
          {totalCount === 0 ? '✅' : critCount > 0 ? '🚨' : '⚠️'}
        </span>
        <span style={{ flex: 1, fontFamily: "'Poppins',sans-serif", fontSize: compact ? 12 : 13, fontWeight: 700, color: totalCount > 0 ? headerColor : 'var(--text-primary)' }}>
          {title}
          {!loading && totalCount > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>
              — {totalCount} alert{totalCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>

        {/* Severity badges */}
        {critCount > 0 && (
          <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 10, fontWeight: 800, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
            {critCount} critical
          </span>
        )}
        {warnCount > 0 && (
          <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 10, fontWeight: 800, background: '#fffbeb', color: '#d97706', border: '1px solid #fde68a' }}>
            {warnCount} warning{warnCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Chevron */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* ── Alert list ── */}
      {expanded && (
        <div>
          {/* Show error only when we have no data to display alongside it */}
          {error && alerts.length === 0 ? (
            <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {error} — <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--purple)', fontSize: 12, fontWeight: 600, padding: 0 }}>retry</button>
            </div>
          ) : alerts.length === 0 ? (
            <div style={{ padding: compact ? '16px 14px' : '24px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🎉</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>No alerts — all metrics within normal range</div>
            </div>
          ) : (
            <div style={{ padding: compact ? '8px 10px' : '10px 12px', display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8 }}>
              {displayed.map(alert => {
                const m   = getMeta(alert.type);
                const sev = SEVERITY_META[alert.severity] || SEVERITY_META.INFO;
                return (
                  <div key={alert.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: compact ? '9px 11px' : '12px 14px',
                    background: m.bg, border: `1px solid ${m.border}`,
                    borderLeft: `3px solid ${sev.dot}`,
                    borderRadius: 9,
                  }}>
                    {/* Icon */}
                    <div style={{ fontSize: compact ? 16 : 18, flexShrink: 0, marginTop: 1 }}>{m.icon}</div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: m.color }}>
                          {m.label}
                        </span>
                        <span style={{ padding: '1px 7px', borderRadius: 99, fontSize: 9, fontWeight: 700, background: sev.badgeBg, color: sev.badgeColor, border: `1px solid ${sev.badgeBorder}` }}>
                          {sev.label}
                        </span>
                        {alert.context && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {alert.context}</span>
                        )}
                      </div>
                      <div style={{ fontSize: compact ? 12 : 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: compact ? 2 : 3, lineHeight: 1.3 }}>
                        {alert.title}
                      </div>
                      {!compact && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {alert.message}
                        </div>
                      )}
                    </div>

                    {/* Action link */}
                    {alert.actionUrl && (
                      <a
                        href={alert.actionUrl}
                        style={{
                          flexShrink: 0, fontSize: 10, fontWeight: 700, color: m.color,
                          textDecoration: 'none', padding: '4px 8px', borderRadius: 6,
                          border: `1px solid ${m.border}`, background: '#fff',
                          whiteSpace: 'nowrap', alignSelf: 'flex-start',
                        }}
                      >
                        {m.actionLabel} →
                      </a>
                    )}
                  </div>
                );
              })}

              {/* Show more / less */}
              {alerts.length > maxAlerts && (
                <button
                  onClick={() => setShowAll(s => !s)}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--purple)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textAlign: 'left' }}
                >
                  {showAll ? '▲ Show fewer' : `▼ Show ${alerts.length - maxAlerts} more alert${alerts.length - maxAlerts !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          )}

          {/* Refresh footer */}
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Auto-refreshes every 60s</span>
            <button
              onClick={load}
              style={{ fontSize: 10, fontWeight: 600, color: 'var(--purple)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
