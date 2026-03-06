'use client';
/**
 * components/ui/DayToggle.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable day-range selector pill used in charts across the app.
 * Replaces the inline DayToggle copies in dashboard/page.js and feed/page.js.
 *
 * Usage:
 *   import DayToggle from '@/components/ui/DayToggle';
 *
 *   <DayToggle value={days} onChange={setDays} />
 *   <DayToggle value={days} onChange={setDays} options={[7, 30, 90]} />
 */

/**
 * @param {object}   props
 * @param {number}   props.value         — currently selected day count
 * @param {function} props.onChange      — called with the new day count
 * @param {number[]} [props.options]     — available options, default [7, 14, 30]
 */
export default function DayToggle({ value, onChange, options = [7, 14, 30] }) {
  return (
    <div style={{
      display: 'flex',
      gap: 3,
      background: 'var(--bg-elevated)',
      borderRadius: 8,
      padding: 3,
      border: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      {options.map(d => (
        <button
          key={d}
          onClick={() => onChange(d)}
          style={{
            padding: '4px 12px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "'Nunito', sans-serif",
            background:  value === d ? 'var(--purple)' : 'transparent',
            color:       value === d ? '#fff'          : 'var(--text-muted)',
            transition:  'all 0.15s',
            whiteSpace:  'nowrap',
          }}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
