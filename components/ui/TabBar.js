// components/ui/TabBar.js
// Shared underline-style tab bar used across health, feed, verification, and other pages.
// Replaces ad-hoc inline tab button rows throughout the app.
//
// Props:
//   tabs      — array of { key: string, label: string, count?: number }
//   active    — key of the currently active tab
//   onChange  — (key: string) => void

export default function TabBar({ tabs, active, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '2px solid var(--border)',
        marginBottom: 20,
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: active === t.key ? '3px solid var(--purple)' : '3px solid transparent',
            marginBottom: -2,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: active === t.key ? 700 : 600,
            color: active === t.key ? 'var(--purple)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {t.label}
          {t.count !== undefined && (
            <span
              style={{
                background: active === t.key ? 'var(--purple-light)' : 'var(--bg-elevated)',
                color: active === t.key ? 'var(--purple)' : 'var(--text-muted)',
                border: `1px solid ${active === t.key ? '#d4d8ff' : 'var(--border)'}`,
                borderRadius: 10,
                padding: '1px 7px',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
