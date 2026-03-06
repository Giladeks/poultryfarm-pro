// components/ui/DashboardWidgets.js — Light theme widgets
'use client';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid #e8eaf0',
  borderRadius: 8,
  boxShadow: '0 4px 16px rgba(0,0,0,0.07)',
  fontFamily: "'Nunito', sans-serif",
  fontSize: 12,
  color: '#1a1a2e',
};

// ── KPI Card ──────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, sub, icon, color = '#6c63ff', trend, loading }) {
  const trendUp = trend > 0;
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
          {label}
        </span>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
          {icon}
        </div>
      </div>
      {loading ? (
        <div style={{ height: 32, background: '#f3f4f6', borderRadius: 6, marginBottom: 8, animation: 'pulse 1.5s infinite' }} />
      ) : (
        <div className="kpi-value" style={{ color, marginBottom: 4 }}>{value}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {trend !== undefined && (
          <span style={{ fontSize: 11, fontWeight: 700, color: trendUp ? 'var(--green)' : 'var(--red)' }}>
            {trendUp ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
        {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// ── Production Chart (eggs + mortality) ──────────────────────────────────────
export function ProductionChart({ data = [] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="eggsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6c63ff" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#6c63ff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="mortGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} />
        <YAxis yAxisId="eggs" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} />
        <YAxis yAxisId="mort" orientation="right" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: "'Nunito',sans-serif" }} />
        <Area yAxisId="eggs" type="monotone" dataKey="eggs" name="Eggs" stroke="#6c63ff" fill="url(#eggsGrad)" strokeWidth={2} dot={false} />
        <Line yAxisId="mort" type="monotone" dataKey="mortality" name="Deaths" stroke="#ef4444" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── FCR Chart ─────────────────────────────────────────────────────────────────
export function FCRChart({ data = [] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="batch" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} domain={[0, 3]} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="fcr" name="FCR" fill="#6c63ff" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Profitability Chart ───────────────────────────────────────────────────────
export function ProfitabilityChart({ data = [] }) {
  const chartData = data.map(p => ({
    name: p.penName?.replace('Pen ', 'P') || p.penId,
    revenue: p.revenue || 0,
    cost: p.totalCost || 0,
    profit: (p.revenue || 0) - (p.totalCost || 0),
  }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={v => `$${Number(v).toLocaleString()}`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="revenue" name="Revenue" fill="#6c63ff" radius={[3, 3, 0, 0]} />
        <Bar dataKey="cost" name="Cost" fill="#fbbf24" radius={[3, 3, 0, 0]} />
        <Bar dataKey="profit" name="Profit" fill="#22c55e" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Task List ─────────────────────────────────────────────────────────────────
const TASK_ICONS = {
  FEEDING: '🌾', EGG_COLLECTION: '🥚', VACCINATION: '💉',
  CLEANING: '🧹', MEDICATION: '💊', INSPECTION: '🔍', MORTALITY_CHECK: '📋',
};

export function TaskList({ tasks = [], onComplete }) {
  if (!tasks.length) return (
    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
      ✅ No tasks pending
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tasks.slice(0, 6).map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 9, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>{TASK_ICONS[t.taskType] || '📋'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
              {t.assignedUser ? `${t.assignedUser.firstName} ${t.assignedUser.lastName}` : 'Unassigned'} · {t.penSection?.pen?.name}
            </div>
          </div>
          <span className={`status-badge ${t.status === 'COMPLETED' ? 'status-green' : t.status === 'OVERDUE' ? 'status-red' : t.status === 'IN_PROGRESS' ? 'status-blue' : 'status-grey'}`}>
            {t.status}
          </span>
          {onComplete && t.status !== 'COMPLETED' && (
            <button onClick={() => onComplete(t.id)}
              style={{ background: 'var(--purple-light)', border: '1px solid #d4d8ff', color: 'var(--purple)', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, flexShrink: 0 }}>
              Done
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Alert Feed ────────────────────────────────────────────────────────────────
const ALERT_STYLES = {
  red:    'alert-red',
  amber:  'alert-amber',
  blue:   'alert-blue',
  green:  'alert-green',
  purple: 'alert-purple',
};
const ALERT_ICONS = { feed: '🌾', health: '💉', tasks: '📋', mortality: '📉', system: '⚙' };

export function AlertFeed({ alerts = [] }) {
  if (!alerts.length) return (
    <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>
      ✅ No active alerts
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {alerts.slice(0, 5).map((a, i) => (
        <div key={a.id || i} className={`alert ${ALERT_STYLES[a.severity] || 'alert-blue'}`}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{ALERT_ICONS[a.category] || '⚠'}</span>
          <span style={{ fontSize: 12, lineHeight: 1.5 }}>{a.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── Pen Status Card ───────────────────────────────────────────────────────────
export function PenStatusCard({ pen, onClick }) {
  const occupancy = pen.capacity > 0 ? Math.round((pen.totalBirds / pen.capacity) * 100) : 0;
  const mortalityOk = (pen.weeklyMortality || 0) < 20;
  return (
    <div className="card" onClick={() => onClick?.(pen)}
      style={{ cursor: onClick ? 'pointer' : 'default', padding: 16 }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = 'var(--purple)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-card)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{pen.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{pen.birdType}</div>
        </div>
        <span className={`status-badge ${pen.status === 'ACTIVE' ? 'status-green' : 'status-grey'}`}>
          {pen.status}
        </span>
      </div>
      <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 24, fontWeight: 700, color: 'var(--purple)', marginBottom: 2 }}>
        {(pen.totalBirds || 0).toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>live birds</div>
      <div className="progress-bar" style={{ marginBottom: 8 }}>
        <div className="progress-fill" style={{ width: `${occupancy}%`, background: occupancy > 90 ? 'var(--red)' : occupancy > 70 ? 'var(--amber)' : 'var(--purple)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>{occupancy}% capacity</span>
        <span style={{ color: mortalityOk ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
          {pen.weeklyMortality || 0} deaths/wk
        </span>
      </div>
    </div>
  );
}
