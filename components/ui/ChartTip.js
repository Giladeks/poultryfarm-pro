'use client';
/**
 * components/ui/ChartTip.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared custom Recharts tooltip used across dashboard, feed, and analytics
 * charts. Replaces the inline ChartTip copy in dashboard/page.js.
 *
 * Usage:
 *   import ChartTip from '@/components/ui/ChartTip';
 *
 *   <Tooltip content={<ChartTip />} />
 *   <Tooltip content={<ChartTip unit=" kg" />} />
 *   <Tooltip content={<ChartTip unit="%" formatter={v => v.toFixed(1)} />} />
 */

/**
 * @param {object}    props
 * @param {boolean}   [props.active]     — injected by Recharts
 * @param {Array}     [props.payload]    — injected by Recharts
 * @param {string}    [props.label]      — injected by Recharts (x-axis value)
 * @param {string}    [props.unit]       — appended to every value, e.g. " kg" or "%"
 * @param {function}  [props.formatter]  — optional custom value formatter: (value, name) => string
 */
export default function ChartTip({ active, payload, label, unit = '', formatter }) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--border-card)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 11,
      boxShadow: 'var(--shadow-md)',
      fontFamily: "'Nunito', sans-serif",
      minWidth: 120,
    }}>
      {/* X-axis label */}
      {label && (
        <div style={{
          fontWeight: 700,
          marginBottom: 6,
          color: 'var(--text-primary)',
          fontSize: 12,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 5,
        }}>
          {label}
        </div>
      )}

      {/* Series rows */}
      {payload.map((entry, i) => {
        const displayValue = formatter
          ? formatter(entry.value, entry.name)
          : `${entry.value != null ? entry.value : '—'}${unit}`;

        return (
          <div
            key={`${entry.name}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--text-secondary)',
              marginTop: i > 0 ? 4 : 0,
            }}
          >
            {/* Colour dot */}
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: entry.color,
              display: 'inline-block',
              flexShrink: 0,
            }} />
            <span style={{ flex: 1 }}>{entry.name}:</span>
            <span style={{
              fontWeight: 700,
              color: entry.color,
              fontFamily: "'Poppins', sans-serif",
              fontSize: 12,
            }}>
              {displayValue}
            </span>
          </div>
        );
      })}
    </div>
  );
}
