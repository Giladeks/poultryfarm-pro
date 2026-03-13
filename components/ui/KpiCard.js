// components/ui/KpiCard.js
// Status-colour KPI card — green/amber/red derived from metric vs target.
//
// Props (new):
//   status  — 'good' | 'warn' | 'critical' | 'neutral'  (drives colour system)
//   value   — formatted string or number shown large
//   label   — short uppercase label
//   sub     — smaller target/context text below label
//   delta   — trend text e.g. "+5% above target"
//   trend   — 'up' | 'down' | 'stable'  (arrow direction)
//   context — tiny pill label e.g. "Your section"
//   Icon    — Lucide component (preferred over emoji icon)
//
// Legacy props (preserved for backward compatibility):
//   icon    — emoji or element (used if Icon not provided)
//   color   — overrides status accent if passed without status
//   warn    — if true, forces status = 'critical'

import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

const STATUS_STYLE = {
  good:     { border: '1px solid #bbf7d0', topBorder: '3px solid #16a34a', tintBg: '#f8fffe', valueCo: '#16a34a', iconBg: '#f0fdf4' },
  warn:     { border: '1px solid #fde68a', topBorder: '3px solid #f59e0b', tintBg: '#fffef8', valueCo: '#f59e0b', iconBg: '#fffbeb' },
  critical: { border: '1px solid #fecaca', topBorder: '3px solid #ef4444', tintBg: '#fffafa', valueCo: '#ef4444', iconBg: '#fef2f2', shadow: '0 0 0 3px rgba(239,68,68,0.08)' },
  neutral:  { border: '1px solid #e2e8f0', topBorder: '3px solid #6c63ff', tintBg: '#ffffff', valueCo: '#6c63ff', iconBg: '#eeecff' },
};

function TrendArrow({ dir }) {
  if (dir === 'up')   return <ArrowUpRight   size={11} color="#16a34a" strokeWidth={2.5} />;
  if (dir === 'down') return <ArrowDownRight size={11} color="#ef4444" strokeWidth={2.5} />;
  return                     <Minus          size={11} color="#94a3b8" strokeWidth={2.5} />;
}

export default function KpiCard({
  // New props
  status, delta, trend, context, Icon,
  // Shared
  label, value, sub,
  // Legacy / compat
  icon, color, warn = false,
  // Layout
  compact = false,
  // Interactivity
  onClick = null,
}) {
  // Resolve status
  let resolvedStatus = status;
  if (!resolvedStatus) {
    if (warn) resolvedStatus = 'critical';
    else if (color === '#16a34a' || color === 'var(--green)') resolvedStatus = 'good';
    else if (color === '#ef4444' || color === 'var(--red)')   resolvedStatus = 'critical';
    else if (color === '#f59e0b' || color === 'var(--amber)') resolvedStatus = 'warn';
    else resolvedStatus = 'neutral';
  }

  const ss      = STATUS_STYLE[resolvedStatus] || STATUS_STYLE.neutral;
  const accent  = color || ss.valueCo;           // legacy color override respected
  const valueCo = color ? accent : ss.valueCo;

  return (
    <div
      className="card"
      onClick={onClick || undefined}
      style={{
        padding: compact ? '11px 13px' : '16px 18px',
        cursor: onClick ? 'pointer' : 'default',
        background: ss.tintBg,
        border: ss.border,
        borderTop: ss.topBorder,
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        boxShadow: ss.shadow || 'none',
      }}
    >
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.07em',
          color: 'var(--text-muted)',
          fontFamily: "'Poppins', sans-serif",
        }}>
          {label}
        </span>

        {/* Icon: Lucide preferred, emoji fallback */}
        {Icon ? (
          <Icon size={14} color={valueCo} strokeWidth={1.8} />
        ) : icon ? (
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: ss.iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}>
            {icon}
          </div>
        ) : null}
      </div>

      {/* Value */}
      <div style={{
        fontFamily: "'Poppins', sans-serif",
        fontSize: compact ? 17 : 26,
        fontWeight: 700,
        color: valueCo,
        lineHeight: 1,
        marginTop: 2,
      }}>
        {value ?? '—'}
      </div>

      {/* Sub + trend delta */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        {sub && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{sub}</span>
        )}
        {(delta !== undefined || trend !== undefined) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
            {trend && <TrendArrow dir={trend} />}
            {delta && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: trend === 'up' ? '#16a34a' : trend === 'down' ? '#ef4444' : '#94a3b8',
              }}>
                {delta}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Context pill */}
      {context && (
        <span style={{
          fontSize: 10, color: '#94a3b8',
          background: 'rgba(0,0,0,0.04)',
          borderRadius: 4, padding: '1px 6px',
          alignSelf: 'flex-start', marginTop: 2,
          fontFamily: "'Poppins', sans-serif",
        }}>
          {context}
        </span>
      )}
    </div>
  );
}
