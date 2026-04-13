'use client';
// app/production/broilers/page.js — Phase 8E · Broiler Production Analytics
//
// Dedicated analytics page for PRODUCTION-stage broiler flocks.
// Roles: FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
//
// TABS
//   Overview     — 6 KPI cards + weight trend chart vs Ross 308 / Cobb 500
//   Harvest      — harvest scheduler: all batches sorted by days to harvest
//   Batches      — per-batch breakdown table with harvest alerts
//   Feed & FCR   — daily feed g/bird trend + FCR per batch
//   Mortality    — daily mortality trend + cumulative by batch
//   History      — last 5 completed batches profitability comparison

import { useState, useEffect, useCallback } from 'react';
import AppShell   from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

const ALLOWED_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const TABS = ['Overview', 'Harvest', 'Batches', 'Feed & FCR', 'Mortality', 'History'];

const fmt     = (n, dp = 0) => n != null ? Number(n).toLocaleString('en-NG', { maximumFractionDigits: dp }) : '—';
const fmtWt   = g => g != null ? `${(g / 1000).toFixed(2)} kg` : '—';
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const pct     = n => n != null ? `${Number(n).toFixed(1)}%` : '—';

const STATUS_COLOR = { good: '#16a34a', warn: '#d97706', critical: '#dc2626', neutral: '#6c63ff' };
const STATUS_BG    = { good: '#f0fdf4', warn: '#fffbeb', critical: '#fef2f2', neutral: '#f5f3ff' };

// ─────────────────────────────────────────────────────────────────────────────
// KPI CARD
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ kpi }) {
  const color = STATUS_COLOR[kpi.status] || STATUS_COLOR.neutral;
  const bg    = STATUS_BG[kpi.status]    || STATUS_BG.neutral;
  return (
    <div style={{ background: '#fff', border: `1px solid ${kpi.status === 'critical' ? '#fecaca' : kpi.status === 'warn' ? '#fde68a' : 'var(--border)'}`, borderRadius: 12, padding: '16px 18px', background: kpi.status === 'critical' ? '#fef2f2' : kpi.status === 'warn' ? '#fffbeb' : '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{kpi.label}</span>
        <span style={{ fontSize: 20 }}>{kpi.icon}</span>
      </div>
      <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 26, fontWeight: 700, color, marginBottom: 4 }}>{kpi.value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{kpi.sub}</div>
      {kpi.delta && <div style={{ fontSize: 11, fontWeight: 600, color, marginTop: 6 }}>{kpi.delta}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HARVEST SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────
function HarvestScheduler({ harvests }) {
  if (harvests.length === 0) return (
    <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-secondary)', marginBottom: 6 }}>No active batches</div>
      <div style={{ fontSize: 12 }}>Harvest dates will appear here when broiler flocks are placed.</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {harvests.map(h => {
        const urgent  = (h.daysToHarvest ?? 999) <= 3;
        const soon    = (h.daysToHarvest ?? 999) <= 7;
        const overdue = (h.daysToHarvest ?? 0) <= 0 && h.daysToHarvest != null;

        const bg     = overdue ? '#fef2f2' : urgent ? '#fff7ed' : soon ? '#fffbeb' : '#fff';
        const border = overdue ? '#fecaca' : urgent ? '#fed7aa' : soon ? '#fde68a' : 'var(--border)';
        const badge  = overdue ? { label: 'OVERDUE', color: '#dc2626', bg: '#fef2f2' }
          : urgent ? { label: 'URGENT', color: '#ea580c', bg: '#fff7ed' }
          : soon   ? { label: 'DUE SOON', color: '#d97706', bg: '#fffbeb' }
          : { label: 'UPCOMING', color: '#6c63ff', bg: '#f5f3ff' };

        const wtPct = (h.latestWeightG && h.targetWeightG)
          ? ((h.latestWeightG / h.targetWeightG) * 100).toFixed(0) : null;

        return (
          <div key={h.flockId} style={{ background: bg, border: `1.5px solid ${border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14 }}>
                  🍗 {h.batchCode}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {h.penName} › {h.sectionName} · {fmt(h.currentBirds)} birds
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: badge.bg, color: badge.color, border: `1px solid ${badge.color}30` }}>
                  {badge.label}
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: badge.color, fontFamily: "'Poppins',sans-serif" }}>
                  {overdue ? 'Harvest now' : h.daysToHarvest != null ? `${h.daysToHarvest}d` : '—'}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                { label: 'Expected Harvest', value: fmtDate(h.expectedHarvest) },
                { label: 'Projected Harvest', value: fmtDate(h.projectedHarvest) },
                { label: 'Current Weight',   value: fmtWt(h.latestWeightG) },
                { label: 'Target Weight',    value: fmtWt(h.targetWeightG) },
              ].map(s => (
                <div key={s.label} style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {h.harvestAlert && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#991b1b', fontWeight: 600 }}>
                ⚠ Weight is {h.belowTargetPct.toFixed(1)}% below target with {h.daysToHarvest} day{h.daysToHarvest !== 1 ? 's' : ''} to harvest — investigate feed intake and health.
              </div>
            )}

            {wtPct && !h.harvestAlert && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span>Weight progress</span><span>{wtPct}% of target</span>
                </div>
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, wtPct)}%`, background: Number(wtPct) >= 95 ? '#16a34a' : Number(wtPct) >= 80 ? '#d97706' : '#dc2626', borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH TABLE
// ─────────────────────────────────────────────────────────────────────────────
function BatchTable({ flocks }) {
  if (!flocks.length) return (
    <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: 13 }}>No active batches found.</div>
  );
  const th = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '10px 14px', fontSize: 12, borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--bg-elevated)' }}>
            {['Batch', 'Pen · Section', 'Birds', 'Age', 'Weight', 'vs Ross 308', 'FCR', 'ADG (7d)', 'Mort (7d)', 'Harvest In', 'Alert'].map(h => (
              <th key={h} style={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {flocks.map(f => {
            const wtColor = !f.latestWeightG ? '#64748b'
              : f.latestWeightG >= f.ross308G * 0.95 ? '#16a34a'
              : f.latestWeightG >= f.ross308G * 0.85 ? '#d97706' : '#dc2626';
            const fcrColor = !f.fcr ? '#64748b' : f.fcr <= f.targetFCR ? '#16a34a' : f.fcr <= f.targetFCR + 0.2 ? '#d97706' : '#dc2626';
            return (
              <tr key={f.flockId} style={{ background: f.harvestAlert ? '#fef2f2' : 'transparent' }}>
                <td style={td}><span style={{ fontWeight: 700 }}>{f.batchCode}</span><br/><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.breed}</span></td>
                <td style={td}>{f.penName} › {f.sectionName}</td>
                <td style={td}>{fmt(f.currentBirds)}</td>
                <td style={td}>{f.ageInDays}d <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>(Wk {(f.ageInDays / 7).toFixed(1)})</span></td>
                <td style={{ ...td, color: wtColor, fontWeight: 600 }}>{fmtWt(f.latestWeightG)}</td>
                <td style={{ ...td, color: wtColor }}>{f.ross308G ? `${pct(((f.latestWeightG || 0) / f.ross308G) * 100)}` : '—'}</td>
                <td style={{ ...td, color: fcrColor, fontWeight: 600 }}>{f.fcr ?? '—'}</td>
                <td style={td}>{f.adg7d ? `${f.adg7d}g/d` : '—'}</td>
                <td style={{ ...td, color: f.mortRate7d > 0.2 ? '#dc2626' : f.mortRate7d > 0.1 ? '#d97706' : '#16a34a' }}>{pct(f.mortRate7d)}</td>
                <td style={{ ...td, fontWeight: 600 }}>{f.daysToHarvest != null ? `${f.daysToHarvest}d` : '—'}</td>
                <td style={td}>{f.harvestAlert ? <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠ {f.belowTargetPct.toFixed(1)}% below</span> : <span style={{ color: '#16a34a' }}>✓</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH HISTORY TABLE
// ─────────────────────────────────────────────────────────────────────────────
function BatchHistory({ batches }) {
  if (!batches.length) return (
    <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: 13 }}>No completed batches found. History will appear here after the first batch is depleted.</div>
  );
  const th = { padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '10px 14px', fontSize: 12, borderBottom: '1px solid var(--border)' };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Profitability comparison across the last {batches.length} completed batch{batches.length !== 1 ? 'es' : ''}.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              {['Batch', 'Breed', 'Placed', 'Cycle', 'Birds In/Out', 'Mort %', 'Final Wt', 'FCR', 'Feed (kg)', 'Revenue/Bird', 'Status'].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batches.map(b => {
              const fcrColor = !b.fcr ? '#64748b' : b.fcr <= 1.9 ? '#16a34a' : b.fcr <= 2.1 ? '#d97706' : '#dc2626';
              return (
                <tr key={b.flockId}>
                  <td style={{ ...td, fontWeight: 700 }}>{b.batchCode}</td>
                  <td style={td}>{b.breed}</td>
                  <td style={td}>{fmtDate(b.placementDate)}</td>
                  <td style={td}>{b.cycleLength}d</td>
                  <td style={td}>{fmt(b.initialCount)} → {fmt(b.finalCount)}</td>
                  <td style={{ ...td, color: b.mortPct > 5 ? '#dc2626' : b.mortPct > 3 ? '#d97706' : '#16a34a' }}>{pct(b.mortPct)}</td>
                  <td style={td}>{fmtWt(b.finalWeightG)}</td>
                  <td style={{ ...td, color: fcrColor, fontWeight: 600 }}>{b.fcr ?? '—'}</td>
                  <td style={td}>{fmt(b.totalFeedKg, 1)}</td>
                  <td style={{ ...td, color: b.revenuePerBird ? '#16a34a' : '#64748b', fontWeight: 600 }}>
                    {b.revenuePerBird ? `₦${fmt(b.revenuePerBird, 0)}` : '—'}
                  </td>
                  <td style={td}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                      {b.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART TOOLTIP
// ─────────────────────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ color: p.color, display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>{p.name}:</span>
          <span>{typeof p.value === 'number' ? p.value.toLocaleString('en-NG') : p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function BroilerProductionPage() {
  const { apiFetch, user, loading: authLoading } = useAuth();
  const [tab,         setTab]         = useState('Overview');
  const [days,        setDays]        = useState(30);
  const [dataLoading, setDataLoading] = useState(true);
  const [error,       setError]       = useState(null);
  const [data,        setData]        = useState(null);

  const allowed = !authLoading && ALLOWED_ROLES.includes(user?.role);

  const load = useCallback(async () => {
    if (!allowed) return;
    setDataLoading(true); setError(null);
    try {
      const res = await apiFetch(`/api/production/broilers?days=${days}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'API error');
      }
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally { setDataLoading(false); }
  }, [allowed, apiFetch, days]);

  useEffect(() => { load(); }, [load]);

  if (authLoading) return <AppShell><div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div></AppShell>;

  if (!allowed) return (
    <AppShell>
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Access Restricted</div>
        <div style={{ fontSize: 13, marginTop: 4 }}>Broiler Production Analytics is available to Farm Manager and above.</div>
      </div>
    </AppShell>
  );

  const kpis         = data?.kpis         || [];
  const flocks       = data?.flocks        || [];
  const weightSeries = data?.weightSeries  || [];
  const feedSeries   = data?.feedSeries    || [];
  const mortSeries   = data?.mortSeries    || [];
  const harvests     = data?.harvests      || [];
  const batchHistory = data?.batchHistory  || [];

  return (
    <AppShell>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>
              🍗 Broiler Production Analytics
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
              Active broiler batches · weight vs breed standards · harvest scheduling · batch profitability
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {[7, 14, 30, 60].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                background: days === d ? 'var(--purple-light,#eeecff)' : '#fff',
                color:      days === d ? 'var(--purple,#6c63ff)'        : 'var(--text-muted)',
                border:     `1px solid ${days === d ? '#d4d8ff' : 'var(--border)'}`,
                fontWeight: days === d ? 700 : 500,
              }}>{d}d</button>
            ))}
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t ? 700 : 500, fontFamily: 'inherit',
              color: tab === t ? 'var(--purple)' : 'var(--text-muted)',
              borderBottom: `3px solid ${tab === t ? 'var(--purple)' : 'transparent'}`,
              marginBottom: -2, whiteSpace: 'nowrap',
            }}>{t}</button>
          ))}
        </div>

        {/* ── Loading / Error ── */}
        {dataLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{ height: 110, background: 'var(--bg-elevated)', borderRadius: 12, animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
            <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
          </div>
        ) : error ? (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: '#dc2626', background: '#fef2f2', borderRadius: 12 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>⚠</div>
            <div style={{ fontWeight: 700 }}>{error}</div>
            <button onClick={load} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 8, background: 'var(--purple)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Retry
            </button>
          </div>
        ) : (

          /* ── Tab Content ── */
          <>
            {/* ── OVERVIEW ── */}
            {tab === 'Overview' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 28 }}>
                  {kpis.map((k, i) => <KpiCard key={i} kpi={k} />)}
                </div>

                {/* Weight vs breed standard chart */}
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>⚖️ Weight vs Breed Standard (by age week)</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Average live weight across all active batches vs Ross 308 and Cobb 500 curves</div>
                  {weightSeries.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={weightSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={g => `${(g/1000).toFixed(1)}kg`} tick={{ fontSize: 10 }} />
                        <Tooltip content={<ChartTip unit="g" />} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="avgG"    name="Actual Weight (g)"  stroke="#6c63ff" strokeWidth={2.5} dot={{ r: 4, fill: '#6c63ff' }} connectNulls />
                        <Line type="monotone" dataKey="ross308G" name="Ross 308 Standard" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                        <Line type="monotone" dataKey="cobb500G" name="Cobb 500 Standard" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No weight records in the last {days} days. Log weekly weigh-ins from the Rearing page.
                    </div>
                  )}
                </div>

                {/* Harvest alerts summary */}
                {harvests.filter(h => h.harvestAlert).length > 0 && (
                  <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 12, padding: '14px 18px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#991b1b', marginBottom: 10 }}>⚠ Weight Alerts — {harvests.filter(h => h.harvestAlert).length} batch{harvests.filter(h => h.harvestAlert).length !== 1 ? 'es' : ''} need attention</div>
                    {harvests.filter(h => h.harvestAlert).map(h => (
                      <div key={h.flockId} style={{ fontSize: 12, color: '#7f1d1d', padding: '4px 0', borderTop: '1px solid #fecaca' }}>
                        <strong>{h.batchCode}</strong> — {h.belowTargetPct.toFixed(1)}% below target with {h.daysToHarvest}d to harvest · {h.penName} › {h.sectionName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── HARVEST ── */}
            {tab === 'Harvest' && (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                  All active batches sorted by days to harvest. Projected harvest date is estimated from current growth rate vs breed standard.
                </div>
                <HarvestScheduler harvests={harvests} />
              </div>
            )}

            {/* ── BATCHES ── */}
            {tab === 'Batches' && (
              <div>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 16 }}>
                    Active Batches · Performance Summary
                  </div>
                  <BatchTable flocks={flocks} />
                </div>
              </div>
            )}

            {/* ── FEED & FCR ── */}
            {tab === 'Feed & FCR' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Daily Feed Intake (g/bird)</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Feed consumption per bird per day across all active sections</div>
                  {feedSeries.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={feedSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={Math.floor(feedSeries.length / 8)} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip content={<ChartTip unit="g/bird" />} />
                        <ReferenceLine y={120} stroke="#d97706" strokeDasharray="4 3" label={{ value: 'Target 120g', fill: '#d97706', fontSize: 10 }} />
                        <Bar dataKey="feedGpb" name="Feed g/bird" fill="#6c63ff" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No feed records in the last {days} days.</div>
                  )}
                </div>

                {/* FCR per batch */}
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Feed Conversion Ratio by Batch</div>
                  {flocks.filter(f => f.fcr).length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={flocks.filter(f => f.fcr)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" domain={[1.4, 'auto']} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="batchCode" tick={{ fontSize: 11 }} width={100} />
                        <Tooltip content={<ChartTip />} />
                        <ReferenceLine x={1.9} stroke="#d97706" strokeDasharray="4 3" />
                        <Bar dataKey="fcr" name="FCR" fill="#6c63ff" radius={[0, 4, 4, 0]}
                          cell={flocks.filter(f => f.fcr).map((f, i) => (
                            <rect key={i} fill={f.fcr <= f.targetFCR ? '#16a34a' : f.fcr <= f.targetFCR + 0.2 ? '#d97706' : '#dc2626'} />
                          ))} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>FCR requires at least 2 weight records per batch.</div>
                  )}
                </div>
              </div>
            )}

            {/* ── MORTALITY ── */}
            {tab === 'Mortality' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Daily Mortality</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>Total deaths per day across all active broiler sections</div>
                  {mortSeries.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={mortSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={Math.floor(mortSeries.length / 8)} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip content={<ChartTip unit=" birds" />} />
                        <Bar dataKey="deaths" name="Deaths" fill="#ef4444" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No mortality records in the last {days} days.</div>
                  )}
                </div>

                {/* Mortality rate per batch */}
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                  <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 16 }}>7-Day Mortality Rate by Batch</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {flocks.map(f => (
                      <div key={f.flockId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: '0 0 160px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.batchCode}</div>
                        <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, f.mortRate7d * 100)}%`, background: f.mortRate7d > 0.2 ? '#dc2626' : f.mortRate7d > 0.1 ? '#d97706' : '#16a34a', borderRadius: 4 }} />
                        </div>
                        <div style={{ flex: '0 0 60px', fontSize: 12, fontWeight: 700, textAlign: 'right', color: f.mortRate7d > 0.2 ? '#dc2626' : f.mortRate7d > 0.1 ? '#d97706' : '#16a34a' }}>{pct(f.mortRate7d)}</div>
                      </div>
                    ))}
                    {!flocks.length && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>No active batches.</div>}
                  </div>
                </div>
              </div>
            )}

            {/* ── HISTORY ── */}
            {tab === 'History' && (
              <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>📋 Batch Profitability History</div>
                <BatchHistory batches={batchHistory} />
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
