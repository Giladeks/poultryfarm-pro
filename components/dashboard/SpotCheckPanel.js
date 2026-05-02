'use client';
// components/dashboard/SpotCheckPanel.js
import { useState, useEffect, useCallback } from 'react';
import SpotCheckCompleteModal from '@/components/tasks/SpotCheckCompleteModal';

const STATUS_META = {
  PENDING:           { color:'#d97706', bg:'#fffbeb', label:'Pending'    },
  IN_PROGRESS:       { color:'#6c63ff', bg:'#f5f3ff', label:'In Progress'},
  COMPLETED:         { color:'#16a34a', bg:'#f0fdf4', label:'Done'       },
  OVERDUE:           { color:'#dc2626', bg:'#fef2f2', label:'Overdue'    },
  AWAITING_APPROVAL: { color:'#9333ea', bg:'#fdf4ff', label:'Awaiting'   },
  CANCELLED:         { color:'#94a3b8', bg:'#f8fafc', label:'Cancelled'  },
};

const timeAgo = d => {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};

const fmtTime = d => new Date(d).toLocaleTimeString('en-NG', { hour:'2-digit', minute:'2-digit' });

export default function SpotCheckPanel({ apiFetch, user }) {
  const [history,      setHistory]      = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [managers,     setManagers]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [result,       setResult]       = useState(null); // last generation result
  const [err,          setErr]          = useState('');
  const [expanded,     setExpanded]     = useState(true);
  const [completingTask, setCompletingTask] = useState(null); // task open in completion modal

  // Form state
  const [checkType,     setCheckType]     = useState('WEIGHT_RECORDING');
  const [sectionCount,  setSectionCount]  = useState(3);
  const [dueHours,      setDueHours]      = useState(4);
  const [operationType, setOperationType] = useState('');
  const [assigneeId,    setAssigneeId]    = useState(user?.id || '');

  // Load history and managers
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [histRes, userRes] = await Promise.all([
        apiFetch('/api/tasks/spot-check'),
        apiFetch('/api/users?roles=FARM_MANAGER,FARM_ADMIN,CHAIRPERSON,INTERNAL_CONTROL,SUPER_ADMIN'),
      ]);
      if (histRes.ok) {
        const d = await histRes.json();
        setHistory(d.tasks   || []);
        setSummary(d.summary || null);
      }
      if (userRes.ok) {
        const d = await userRes.json();
        setManagers(d.users || []);
      }
    } catch { /* silent */ }
    finally  { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // Set default assignee to current user
  useEffect(() => {
    if (user?.id) setAssigneeId(user.id);
  }, [user]);

  const generate = async () => {
    setGenerating(true); setErr(''); setResult(null);
    try {
      const body = {
        checkType,
        sectionCount: Number(sectionCount),
        dueHours:     Number(dueHours),
        assigneeId:   assigneeId || undefined,
        operationType: operationType || null,
      };
      const res = await apiFetch('/api/tasks/spot-check', {
        method: 'POST',
        body:   JSON.stringify(body),
      });
      let d = {};
      try { d = await res.json(); } catch {}
      if (!res.ok) { setErr(d.error || `Failed (${res.status})`); return; }
      setResult(d);
      setShowForm(false);
      // Reload history to include new tasks
      load();
    } catch { setErr('Network error — please try again'); }
    finally  { setGenerating(false); }
  };

  const pendingCount  = summary?.pending  || 0;
  const overdueCount  = summary?.overdue  || 0;
  const completedCount= summary?.completed|| 0;

  return (
    <div style={{ background:'#fff', borderRadius:14, border:'1px solid var(--border-card)', overflow:'hidden', marginBottom:20 }}>

      {/* ── Header ── */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width:'100%', display:'flex', alignItems:'center', gap:10,
          padding:'13px 18px',
          background: overdueCount > 0 ? '#fef2f2' : pendingCount > 0 ? '#fffbeb' : 'var(--bg-elevated)',
          border:'none',
          borderBottom: expanded ? '1px solid var(--border-card)' : 'none',
          cursor:'pointer', textAlign:'left',
        }}
      >
        <span style={{ fontSize:18 }}>🎲</span>
        <span style={{ flex:1, fontFamily:"'Poppins',sans-serif", fontSize:13, fontWeight:700, color:'var(--text-primary)' }}>
          Spot-Check Tasks
        </span>
        {overdueCount > 0 && (
          <span style={{ padding:'2px 9px', borderRadius:99, fontSize:10, fontWeight:800, background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca' }}>
            {overdueCount} overdue
          </span>
        )}
        {pendingCount > 0 && (
          <span style={{ padding:'2px 9px', borderRadius:99, fontSize:10, fontWeight:800, background:'#fffbeb', color:'#d97706', border:'1px solid #fde68a' }}>
            {pendingCount} pending
          </span>
        )}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink:0, transform:expanded?'rotate(180deg)':'none', transition:'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {expanded && (
        <div>
          {/* ── Generation result toast ── */}
          {result && (
            <div style={{ margin:'12px 16px 0', padding:'10px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:9, fontSize:12 }}>
              <div style={{ fontWeight:700, color:'#16a34a', marginBottom:2 }}>
                ✓ {result.tasks?.length} spot-check task{result.tasks?.length !== 1 ? 's' : ''} generated
              </div>
              <div style={{ color:'var(--text-secondary)' }}>{result.reason}</div>
              {result.tasks?.length > 0 && (
                <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:3 }}>
                  {result.tasks.map(t => (
                    <div key={t.id} style={{ fontSize:11, color:'var(--text-muted)' }}>
                      · {t.penSection?.pen?.name} › {t.penSection?.name} — due {fmtTime(t.dueDate)}
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setResult(null)}
                style={{ marginTop:8, fontSize:10, fontWeight:600, color:'var(--purple)', background:'none', border:'none', cursor:'pointer', padding:0 }}>
                Dismiss
              </button>
            </div>
          )}

          {/* ── Generate form ── */}
          {showForm ? (
            <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ padding:'10px 14px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:9, fontSize:12, color:'#92400e' }}>
                ⚠️ Spot checks are unannounced — workers and PMs will not be notified until the task appears on the assignee's dashboard.
              </div>

              {err && (
                <div style={{ padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:12, color:'#dc2626' }}>⚠ {err}</div>
              )}

              <div className="modal-input-grid-2" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {/* Check type */}
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>Check Type</label>
                  <select className="input" value={checkType} onChange={e => setCheckType(e.target.value)}>
                    <option value="WEIGHT_RECORDING">⚖️ Weight Recording</option>
                    <option value="INSPECTION">🔍 Section Inspection</option>
                  </select>
                </div>

                {/* Operation type */}
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                    Operation Type <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(optional)</span>
                  </label>
                  <select className="input" value={operationType} onChange={e => setOperationType(e.target.value)}>
                    <option value="">Both Layer & Broiler</option>
                    <option value="LAYER">🥚 Layer only</option>
                    <option value="BROILER">🍗 Broiler only</option>
                  </select>
                </div>

                {/* Section count */}
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                    Sections to check (1–10)
                  </label>
                  <input type="number" className="input" min={1} max={10} value={sectionCount}
                    onChange={e => setSectionCount(e.target.value)} />
                </div>

                {/* Due hours */}
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                    Due in (hours)
                  </label>
                  <select className="input" value={dueHours} onChange={e => setDueHours(e.target.value)}>
                    <option value={1}>1 hour</option>
                    <option value={2}>2 hours</option>
                    <option value={4}>4 hours</option>
                    <option value={8}>8 hours</option>
                    <option value={24}>Tomorrow</option>
                  </select>
                </div>
              </div>

              {/* Assignee */}
              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:5 }}>
                  Assign to
                </label>
                <select className="input" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                  <option value={user?.id}>Myself ({user?.firstName} {user?.lastName})</option>
                  {managers
                    .filter(m => m.id !== user?.id)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.firstName} {m.lastName} ({m.role?.replace(/_/g,' ')})
                      </option>
                    ))}
                </select>
              </div>

              {/* Randomisation notice */}
              <div style={{ padding:'9px 12px', background:'var(--bg-elevated)', borderRadius:8, fontSize:11, color:'var(--text-secondary)' }}>
                🎲 <strong>How sections are selected:</strong> The system prioritises sections not checked recently,
                sections with elevated mortality, and sections with no recent weight data — then adds randomness
                to ensure all sections get checked over time.
              </div>

              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button onClick={() => { setShowForm(false); setErr(''); }}
                  style={{ padding:'8px 16px', borderRadius:8, border:'1px solid var(--border-card)', background:'#fff', color:'var(--text-secondary)', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  Cancel
                </button>
                <button onClick={generate} disabled={generating}
                  style={{ padding:'8px 18px', borderRadius:8, border:'none', background:generating?'#94a3b8':'var(--purple)', color:'#fff', fontSize:12, fontWeight:700, cursor:generating?'not-allowed':'pointer' }}>
                  {generating ? 'Generating…' : '🎲 Generate Spot Checks'}
                </button>
              </div>
            </div>
          ) : (
            /* ── Generate button + history ── */
            <div>
              <div style={{ padding:'12px 18px', borderBottom:'1px solid var(--border-card)' }}>
                <button onClick={() => { setShowForm(true); setResult(null); setErr(''); }}
                  style={{
                    display:'flex', alignItems:'center', gap:8,
                    padding:'8px 16px', borderRadius:9,
                    border:'1.5px solid var(--purple)', background:'var(--purple-light)',
                    color:'var(--purple)', fontSize:12, fontWeight:700, cursor:'pointer',
                  }}>
                  <span style={{ fontSize:16 }}>🎲</span>
                  Generate Unannounced Spot Checks
                </button>
              </div>

              {/* KPI strip */}
              {summary && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:0, borderBottom:'1px solid var(--border-card)' }}>
                  {[
                    { label:'Total (30d)',  value:summary.total,     color:'var(--text-primary)' },
                    { label:'Pending',      value:pendingCount,       color:'#d97706' },
                    { label:'Completed',    value:completedCount,     color:'#16a34a' },
                    { label:'Overdue',      value:overdueCount,       color:overdueCount>0?'#dc2626':'var(--text-muted)' },
                  ].map(k => (
                    <div key={k.label} style={{ padding:'10px 14px', textAlign:'center', borderRight:'1px solid var(--border-card)' }}>
                      <div style={{ fontSize:18, fontWeight:800, color:k.color }}>{k.value}</div>
                      <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:600 }}>{k.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* History list */}
              {loading ? (
                <div style={{ padding:'20px 18px', display:'flex', flexDirection:'column', gap:8 }}>
                  {[1,2,3].map(i => <div key={i} style={{ height:52, background:'#f8fafc', borderRadius:8, animation:'pulse 1.5s infinite' }} />)}
                </div>
              ) : history.length === 0 ? (
                <div style={{ padding:'32px', textAlign:'center', color:'var(--text-muted)', fontSize:12 }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>🎲</div>
                  No spot checks generated yet in the last 30 days.
                </div>
              ) : (
                <div style={{ maxHeight:340, overflowY:'auto' }}>
                  {history.map((task, i) => {
                    const sm = STATUS_META[task.status] || STATUS_META.PENDING;
                    return (
                      <div key={task.id} style={{
                        display:'flex', alignItems:'center', gap:12,
                        padding:'10px 18px',
                        borderBottom: i < history.length - 1 ? '1px solid var(--border-card)' : 'none',
                        background:'#fff',
                        flexWrap:'wrap',
                      }}>
                        {/* Type icon */}
                        <span style={{ fontSize:16, flexShrink:0 }}>
                          {task.taskType === 'WEIGHT_RECORDING' ? '⚖️' : '🔍'}
                        </span>

                        {/* Content */}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {task.penSection?.pen?.name} › {task.penSection?.name}
                          </div>
                          <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                            {task.assignedTo?.firstName} {task.assignedTo?.lastName}
                            {' · '}{timeAgo(task.createdAt)}
                            {task.completionNotes && <span style={{ color:'var(--purple)' }}> · Has notes</span>}
                          </div>
                        </div>

                        {/* Complete button for actionable statuses */}
                        {['PENDING', 'IN_PROGRESS', 'OVERDUE'].includes(task.status) && (
                          <button
                            onClick={() => setCompletingTask(task)}
                            style={{
                              minHeight:'36px', padding:'6px 14px',
                              borderRadius:7, border:'1px solid #bbf7d0',
                              background:'#f0fdf4', color:'#16a34a', fontSize:11,
                              fontWeight:700, cursor:'pointer', flexShrink:0, whiteSpace:'nowrap',
                            }}>
                            Complete
                          </button>
                        )}

                        {/* Status badge */}
                        <span style={{
                          fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:99,
                          background:sm.bg, color:sm.color, border:`1px solid ${sm.color}30`,
                          flexShrink:0,
                        }}>
                          {sm.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Completion modal ── */}
      {completingTask && (
        <SpotCheckCompleteModal
          task={completingTask}
          apiFetch={apiFetch}
          onClose={() => setCompletingTask(null)}
          onSave={({ deviationFlag, failCount }) => {
            setCompletingTask(null);
            load(); // refresh history + summary counts
          }}
        />
      )}
    </div>
  );
}
