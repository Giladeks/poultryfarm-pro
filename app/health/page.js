'use client';
// app/health/page.js
// UI additions:
//   • Compact 7-day strip calendar above the table, coloured dots per vaccination status
//   • Clicking a day filters the list to that day's vaccinations
//   • Sticky red urgency banner when overdue vaccinations exist
//   • Overdue tab + row styling in red
import { useState, useEffect, useMemo } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import Modal from '@/components/ui/Modal';

const COMMON_VACCINES = [
  { name: 'Newcastle Disease',     interval: 28 },
  { name: 'Infectious Bronchitis', interval: 21 },
  { name: "Marek's Disease",       interval: 0  },
  { name: 'Gumboro (IBD)',         interval: 14 },
  { name: 'Fowl Pox',             interval: 56 },
  { name: 'Avian Influenza',       interval: 90 },
];

const STATUS_COLOR = {
  SCHEDULED: '#3b82f6',
  OVERDUE:   '#ef4444',
  COMPLETED: '#22c55e',
  MISSED:    '#9ca3af',
};
const STATUS_CLASS = {
  SCHEDULED: 'status-blue',
  COMPLETED: 'status-green',
  OVERDUE:   'status-red',
  MISSED:    'status-grey',
};

// ── 7-day strip calendar ──────────────────────────────────────────────────────
function WeekStrip({ vaccinations, selectedDay, onSelectDay }) {
  // Build a window: 3 days ago → 10 days ahead (14 days total)
  const days = useMemo(() => {
    const result = [];
    const today  = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = -3; i <= 10; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      result.push(d);
    }
    return result;
  }, []);

  // Group vaccinations by ISO date string
  const byDay = useMemo(() => {
    const map = {};
    vaccinations.forEach(v => {
      const key = new Date(v.scheduledDate).toISOString().split('T')[0];
      if (!map[key]) map[key] = [];
      map[key].push(v);
    });
    return map;
  }, [vaccinations]);

  const todayStr = new Date().toISOString().split('T')[0];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div style={{
      background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)',
      padding: '14px 16px', marginBottom: 20,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Vaccination Calendar
        </span>
        {selectedDay && (
          <button onClick={() => onSelectDay(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, color: 'var(--purple)', fontWeight: 700, fontFamily: 'inherit',
          }}>
            Clear filter ✕
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
        {days.map(d => {
          const key     = d.toISOString().split('T')[0];
          const isToday = key === todayStr;
          const isSelec = key === selectedDay;
          const vaxs    = byDay[key] || [];
          const isPast  = d < new Date(new Date().setHours(0,0,0,0));

          return (
            <button
              key={key}
              onClick={() => onSelectDay(isSelec ? null : key)}
              style={{
                flexShrink: 0, width: 52, minHeight: 72,
                background: isSelec ? 'var(--purple-light)' : isToday ? '#f0f0ff' : 'var(--bg-elevated)',
                border: `1.5px solid ${isSelec ? 'var(--purple)' : isToday ? '#c4bfff' : 'var(--border)'}`,
                borderRadius: 10, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                padding: '8px 4px 10px', gap: 4,
                transition: 'all 0.15s',
                opacity: isPast && vaxs.length === 0 ? 0.45 : 1,
              }}
            >
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: isSelec ? 'var(--purple)' : isToday ? 'var(--purple)' : 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                {DAY_NAMES[d.getDay()]}
              </span>
              <span style={{
                fontFamily: "'Poppins',sans-serif", fontSize: 16, fontWeight: 700, lineHeight: 1,
                color: isSelec ? 'var(--purple)' : isToday ? 'var(--purple)' : 'var(--text-primary)',
              }}>
                {d.getDate()}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {MONTH_SHORT[d.getMonth()]}
              </span>

              {/* Status dots */}
              {vaxs.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center', marginTop: 2 }}>
                  {vaxs.slice(0, 4).map((v, i) => (
                    <span key={i} title={`${v.vaccineName} — ${v.status}`} style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: STATUS_COLOR[v.status] || '#9ca3af',
                      display: 'inline-block',
                    }} />
                  ))}
                  {vaxs.length > 4 && (
                    <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700 }}>+{vaxs.length - 4}</span>
                  )}
                </div>
              ) : (
                <div style={{ height: 11 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        {Object.entries(STATUS_COLOR).map(([status, color]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HealthPage() {
  const { apiFetch } = useAuth();
  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [completeModal, setCompleteModal] = useState(null);
  const [form,          setForm]          = useState({ vaccineName: '', flockId: '', scheduledDate: '', notes: '' });
  const [completeForm,  setCompleteForm]  = useState({ batchNumber: '', notes: '' });
  const [saving,        setSaving]        = useState(false);
  const [activeTab,     setActiveTab]     = useState('upcoming');
  const [opTab,         setOpTab]         = useState('ALL');
  const [selectedDay,   setSelectedDay]   = useState(null); // ISO date string or null

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const res = await apiFetch('/api/health');
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  };

  const handleSchedule = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/health?action=schedule', { method: 'POST', body: JSON.stringify(form) });
      if (res.ok) { setScheduleModal(false); loadData(); }
    } finally { setSaving(false); }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/health?action=complete', {
        method: 'POST',
        body: JSON.stringify({ vaccinationId: completeModal.id, ...completeForm }),
      });
      if (res.ok) { setCompleteModal(null); loadData(); }
    } finally { setSaving(false); }
  };

  const { vaccinations = [], summary = {}, flocks = [] } = data || {};

  const opFiltered = opTab === 'ALL'
    ? vaccinations
    : vaccinations.filter(v => (v.flock?.operationType || v.flock?.birdType) === opTab);

  const hasLayers   = vaccinations.some(v => (v.flock?.operationType || v.flock?.birdType) === 'LAYER');
  const hasBroilers = vaccinations.some(v => (v.flock?.operationType || v.flock?.birdType) === 'BROILER');
  const hasBoth     = hasLayers && hasBroilers;

  const tabs = {
    upcoming: opFiltered.filter(v => v.status === 'SCHEDULED'),
    overdue:  opFiltered.filter(v => v.status === 'OVERDUE'),
    done:     opFiltered.filter(v => v.status === 'COMPLETED'),
  };

  // Apply day filter on top of tab filter
  const shown = useMemo(() => {
    let list = tabs[activeTab] || [];
    if (selectedDay) {
      list = list.filter(v => new Date(v.scheduledDate).toISOString().split('T')[0] === selectedDay);
    }
    return list;
  }, [tabs, activeTab, selectedDay]);

  const overdueCount = tabs.overdue.length;

  return (
    <AppShell>
      <div className="animate-in">

        {/* ── Overdue urgency banner ── */}
        {!loading && overdueCount > 0 && (
          <div style={{
            background: 'var(--red-bg)', border: '1px solid var(--red-border)',
            borderRadius: 10, padding: '11px 16px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, color: '#dc2626', fontSize: 13 }}>
                {overdueCount} vaccination{overdueCount > 1 ? 's' : ''} overdue
              </span>
              <span style={{ color: '#b91c1c', fontSize: 12, marginLeft: 8 }}>
                — immediate action required to protect flock health
              </span>
            </div>
            <button onClick={() => { setActiveTab('overdue'); setSelectedDay(null); }} style={{
              background: '#dc2626', color: '#fff', border: 'none',
              borderRadius: 7, padding: '6px 14px', fontSize: 12,
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            }}>
              View overdue →
            </button>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Health Management</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>Vaccinations, medications and health records</p>
          </div>
          <div style={{ flexShrink: 0 }}>
            <button onClick={() => setScheduleModal(true)} className="btn btn-primary">+ Schedule Vaccination</button>
          </div>
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Due This Week',        value: loading ? '—' : summary.dueSoon || 0,         color: 'var(--blue)',   icon: '📅' },
            { label: 'Overdue',              value: loading ? '—' : summary.overdue || 0,          color: (summary.overdue || 0) > 0 ? 'var(--red)' : 'var(--green)', icon: '⚠', warn: (summary.overdue || 0) > 0 },
            { label: 'Completed This Month', value: loading ? '—' : summary.completedMonth || 0,   color: 'var(--green)', icon: '✅' },
            { label: 'Total Tracked',        value: loading ? '—' : vaccinations.length,           color: 'var(--purple)', icon: '💉' },
          ].map(k => (
            <div key={k.label} className="card" style={{
              padding: '18px 20px',
              border: k.warn ? '1.5px solid var(--red-border)' : undefined,
              background: k.warn ? '#fff8f8' : undefined,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{k.label}</span>
                <span style={{ fontSize: 20 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 28, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* ── 7-day strip calendar ── */}
        {!loading && (
          <WeekStrip
            vaccinations={opFiltered}
            selectedDay={selectedDay}
            onSelectDay={(day) => {
              setSelectedDay(day);
              // Auto-switch to whichever tab has items on that day
              if (day) {
                const dayVaxs = opFiltered.filter(v => new Date(v.scheduledDate).toISOString().split('T')[0] === day);
                if (dayVaxs.some(v => v.status === 'OVERDUE'))        setActiveTab('overdue');
                else if (dayVaxs.some(v => v.status === 'SCHEDULED')) setActiveTab('upcoming');
                else if (dayVaxs.length > 0)                          setActiveTab('done');
              }
            }}
          />
        )}

        {/* Op-type pill switcher */}
        {hasBoth && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: 'var(--bg-elevated)', borderRadius: 12, padding: 4, border: '1px solid var(--border)', width: 'fit-content' }}>
            {[
              { key: 'ALL',     icon: '💉', label: 'All',      color: 'var(--purple)' },
              { key: 'LAYER',   icon: '🥚', label: 'Layers',   color: '#f59e0b' },
              { key: 'BROILER', icon: '🍗', label: 'Broilers', color: '#3b82f6' },
            ].map(t => {
              const isActive = opTab === t.key;
              return (
                <button key={t.key} onClick={() => setOpTab(t.key)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '8px 16px', borderRadius: 9, border: 'none',
                  background: isActive ? '#fff' : 'transparent',
                  boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                  fontWeight: isActive ? 700 : 500, fontSize: 13,
                  color: isActive ? t.color : 'var(--text-muted)', transition: 'all 0.15s',
                }}>
                  <span style={{ fontSize: 15 }}>{t.icon}</span>{t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
          {[
            { key: 'upcoming', label: '📅 Upcoming' },
            { key: 'overdue',  label: '⚠ Overdue'  },
            { key: 'done',     label: '✅ Completed' },
          ].map(({ key, label }) => {
            const isActive  = activeTab === key;
            const isOverdue = key === 'overdue';
            const hasItems  = tabs[key]?.length > 0;
            const tabColor  = isOverdue && hasItems ? '#dc2626' : 'var(--purple)';
            return (
              <button key={key} onClick={() => setActiveTab(key)} style={{
                background: 'transparent', border: 'none',
                borderBottom: isActive ? `3px solid ${tabColor}` : '3px solid transparent',
                marginBottom: -2, padding: '10px 18px', fontSize: 13,
                fontWeight: isActive ? 700 : 600,
                color: isActive ? tabColor : (isOverdue && hasItems ? '#ef4444' : 'var(--text-muted)'),
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                {label}
                <span style={{
                  background: isOverdue && hasItems ? '#fee2e2' : (isActive ? 'var(--purple-light)' : 'var(--bg-elevated)'),
                  color: isOverdue && hasItems ? '#dc2626' : (isActive ? 'var(--purple)' : 'var(--text-muted)'),
                  border: `1px solid ${isOverdue && hasItems ? '#fecaca' : (isActive ? '#d4d8ff' : 'var(--border)')}`,
                  borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700,
                }}>
                  {selectedDay
                    ? (tabs[key] || []).filter(v => new Date(v.scheduledDate).toISOString().split('T')[0] === selectedDay).length
                    : (tabs[key]?.length || 0)
                  }
                </span>
              </button>
            );
          })}
          {selectedDay && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700, background: 'var(--purple-light)', border: '1px solid #d4d8ff', borderRadius: 6, padding: '3px 10px' }}>
                📅 Filtered: {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 16 }}>

          {/* Vaccination list */}
          <div className="card">
            {shown.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>💉</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {selectedDay
                    ? `No ${activeTab} vaccinations on this day`
                    : `No ${activeTab} vaccinations`}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shown.map(v => {
                  const isOverdue = v.status === 'OVERDUE';
                  return (
                    <div key={v.id} style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 16px',
                      background: isOverdue ? '#fff8f8' : 'var(--bg-elevated)',
                      borderRadius: 10,
                      border: `1px solid ${isOverdue ? 'var(--red-border)' : 'var(--border)'}`,
                      transition: 'all 0.2s',
                    }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = isOverdue ? '#dc2626' : 'var(--purple)';
                        e.currentTarget.style.background  = isOverdue ? '#fee2e2' : 'var(--purple-light)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = isOverdue ? 'var(--red-border)' : 'var(--border)';
                        e.currentTarget.style.background  = isOverdue ? '#fff8f8' : 'var(--bg-elevated)';
                      }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: isOverdue ? 'var(--red-bg)' : 'var(--blue-bg)',
                        border: `1px solid ${isOverdue ? 'var(--red-border)' : 'var(--blue-border)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0,
                      }}>💉</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{v.vaccineName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {v.flock?.batchCode} · {v.flock?.birdType} · {v.flock?.penSection?.pen?.name}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: isOverdue ? 'var(--red)' : 'var(--text-primary)' }}>
                          {new Date(v.scheduledDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Scheduled</div>
                      </div>
                      <span className={`status-badge ${STATUS_CLASS[v.status] || 'status-grey'}`}>{v.status}</span>
                      {v.status !== 'COMPLETED' && (
                        <div style={{ flexShrink: 0 }}>
                          <button onClick={() => setCompleteModal(v)} className="btn btn-primary" style={{ fontSize: 11, padding: '5px 12px' }}>Mark Done</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card">
              <div className="section-header">Quick Schedule</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {COMMON_VACCINES.map(v => (
                  <button key={v.name}
                    onClick={() => { setForm(p => ({ ...p, vaccineName: v.name })); setScheduleModal(true); }}
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--purple)'; e.currentTarget.style.color = 'var(--purple)'; e.currentTarget.style.background = 'var(--purple-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}>
                    💉 {v.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="section-header">Status Summary</div>
              {[['SCHEDULED', 'status-blue', summary.scheduled || 0], ['COMPLETED', 'status-green', summary.completedTotal || 0], ['OVERDUE', 'status-red', summary.overdue || 0]].map(([s, cls, count]) => (
                <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className={`status-badge ${cls}`}>{s}</span>
                  <span style={{ fontFamily: "'Poppins',sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Schedule Vaccination Modal ── */}
      {scheduleModal && (
        <Modal title="💉 Schedule Vaccination" width={460} onClose={() => setScheduleModal(false)}
          footer={<>
            <button onClick={() => setScheduleModal(false)} className="btn btn-ghost">Cancel</button>
            <button onClick={handleSchedule} disabled={saving || !form.vaccineName || !form.scheduledDate} className="btn btn-primary">
              {saving ? 'Saving…' : 'Schedule Vaccination'}
            </button>
          </>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="label">Vaccine Name</label>
              <input value={form.vaccineName} onChange={e => setForm(p => ({ ...p, vaccineName: e.target.value }))} className="input" placeholder="e.g. Newcastle Disease" />
            </div>
            <div>
              <label className="label">Flock</label>
              <select value={form.flockId} onChange={e => setForm(p => ({ ...p, flockId: e.target.value }))} className="input">
                <option value="">Select flock…</option>
                {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} — {f.birdType}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Scheduled Date</label>
              <input type="date" value={form.scheduledDate} onChange={e => setForm(p => ({ ...p, scheduledDate: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Notes</label>
              <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="input" placeholder="Optional notes…" />
            </div>
          </div>
        </Modal>
      )}

      {/* ── Mark as Completed Modal ── */}
      {completeModal && (
        <Modal title="✅ Mark as Completed" width={420} onClose={() => setCompleteModal(null)}
          footer={<>
            <button onClick={() => setCompleteModal(null)} className="btn btn-ghost">Cancel</button>
            <button onClick={handleComplete} disabled={saving} className="btn btn-primary">{saving ? 'Saving…' : '✓ Confirm Done'}</button>
          </>}>
          <div className="alert alert-blue" style={{ marginBottom: 16 }}>
            <span>💉</span>
            <span><strong>{completeModal.vaccineName}</strong> — {completeModal.flock?.batchCode}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="label">Batch / Lot Number</label>
              <input value={completeForm.batchNumber} onChange={e => setCompleteForm(p => ({ ...p, batchNumber: e.target.value }))} className="input" placeholder="e.g. ND-2026-001" />
            </div>
            <div>
              <label className="label">Notes</label>
              <input value={completeForm.notes} onChange={e => setCompleteForm(p => ({ ...p, notes: e.target.value }))} className="input" placeholder="Any observations…" />
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
