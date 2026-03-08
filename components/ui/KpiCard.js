// components/ui/KpiCard.js
// Shared KPI metric card used across dashboard, health, feed, and other pages.
// Drops in as a replacement for the inline KpiCard defined in each page.
//
// Props:
//   icon    — emoji or element shown in the icon box
//   value   — formatted string or number to display large
//   label   — short uppercase label shown below the value
//   sub     — optional smaller text below the label
//   color   — accent color (border-left, icon bg, value color). Default: var(--purple)
//   warn    — if true, overrides color to var(--red) / #ef4444

export default function KpiCard({ icon, value, label, sub, color = 'var(--purple)', warn = false }) {
  const accent = warn ? '#ef4444' : color;
  return (
    <div
      className="card"
      style={{
        padding: '18px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `${accent}18`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: "'Poppins',sans-serif",
            fontSize: 24,
            fontWeight: 700,
            color: accent,
            lineHeight: 1,
          }}
        >
          {value ?? '—'}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '.05em',
            marginTop: 4,
          }}
        >
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}
