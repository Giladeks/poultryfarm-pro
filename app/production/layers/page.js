'use client';
// app/production/layers/page.js — Phase 8D · Layer Production Analytics
//
// Dedicated analytics page for PRODUCTION-stage layer flocks.
// Roles: FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
//        (Farm Manager excluded — operational focus; financial analytics is Farm Admin and above)
// Nav:   AppShell already wired — /production/layers · TrendingUp · "Layer Analytics"
//
// TABS
//   Overview       — 6 KPI cards + summary charts (laying rate trend + feed/day)
//   Production     — Laying persistence curve vs flock age in weeks;
//                    peak week detection; post-peak decline rate
//   Feed & Cost    — Feed cost/crate eggs; daily feed g/bird; cost vs revenue overlay
//   Mortality      — Cumulative mortality vs age; weekly death rate trend
//   Flocks         — Per-flock breakdown table with cull-recommendation flags
//
// API
//   GET /api/production/layers          — tenant-wide aggregates + per-flock rows
//   Uses existing /api/dashboard        — section-level KPIs (todayEggs, todayFeedKg, …)
//   Uses existing /api/settings         — feedBagWeightKg, eggSalePricePerCrate (new)
//   Uses existing /api/dashboard/charts — per-section feed-by-date (same pattern as /performance)
//
// DATA RULES (inherited from project)
//   • Laying rate always = totalEggs / currentBirds × 100  (NEVER avg of per-record rates)
//   • Date boundaries: Date.UTC(y, m, d)  (server runs WAT UTC+1)
//   • snake_case tables: $queryRawUnsafe only
//   • feedBagWeightKg from tenant settings (default 25)

import { useState, useEffect, useCallback } from 'react';
import AppShell   from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const TABS = ['Overview', 'Production', 'Feed & Cost', 'Mortality', 'Flocks'];
const YESTERDAY_DAYS = -1; // sentinel used by /performance — not needed here; keep for parity

// Laying-rate target bands (ISA Brown / commercial layer standard)
const LAY_TARGET   = 82;   // % — below this triggers yellow
const LAY_CRITICAL = 70;   // % — below this triggers red
// Hen-housed production target (cumulative)
const HH_TARGET    = 78;   // %
// Feed benchmark for laying hens
const FEED_GPB_TARGET = 120; // g/bird/day
// Cull signal: weeks feed cost > revenue before recommendation fires
const CULL_WEEKS_THRESHOLD = 2;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt  = (n, dp = 0) => n != null ? Number(n).toLocaleString('en-NG', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '—';
const pct  = (n) => n != null ? `${Number(n).toFixed(1)}%` : '—';
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
};

function statusColor(val, target, critical) {
  if (val == null) return 'var(--text-muted)';
  if (val >= target)   return 'var(--green,#22c55e)';
  if (val >= critical) return 'var(--amber,#f59e0b)';
  return 'var(--red,#ef4444)';
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Skeleton({ h = 80, radius = 10 }) {
  return (
    <div style={{
      height: h, borderRadius: radius,
      background: 'linear-gradient(90deg,#f0f4f8 25%,#e2e8f0 50%,#f0f4f8 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  );
}

// KPI card — matches the style used across the existing dashboard/performance pages
function KpiCard({ icon, label, value, sub, delta, status, loading }) {
  const borderColor =
    status === 'good' ? '#bbf7d0' :
    status === 'warn' ? '#fde68a' :
    status === 'bad'  ? '#fecaca' : '#e2e8f0';
  const valueColor =
    status === 'good' ? 'var(--green,#22c55e)' :
    status === 'warn' ? 'var(--amber,#f59e0b)' :
    status === 'bad'  ? 'var(--red,#ef4444)'   : 'var(--text-primary,#0f172a)';

  if (loading) return <Skeleton h={110} />;

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted,#64748b)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
        <span>{icon}</span> {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: valueColor, lineHeight: 1.1 }}>
        {value ?? '—'}
      </div>
      {sub   && <div style={{ fontSize: 11, color: 'var(--text-muted,#64748b)' }}>{sub}</div>}
      {delta && <div style={{ fontSize: 11, color: 'var(--text-muted,#64748b)', fontStyle: 'italic' }}>{delta}</div>}
    </div>
  );
}

// Cull recommendation alert banner
function CullAlert({ flocks }) {
  const flagged = (flocks || []).filter(f => f.cullRecommended);
  if (!flagged.length) return null;
  return (
    <div style={{
      background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10,
      padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
      marginBottom: 20,
    }}>
      <span style={{ fontSize: 18 }}>⚠️</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#c2410c' }}>
          Cull Recommendation — {flagged.length} flock{flagged.length > 1 ? 's' : ''}
        </div>
        <div style={{ fontSize: 11, color: '#9a3412', marginTop: 2 }}>
          {flagged.map(f => f.batchCode).join(', ')} — feed cost/crate has exceeded revenue/crate for {CULL_WEEKS_THRESHOLD}+ consecutive weeks
        </div>
      </div>
    </div>
  );
}

// Empty state for charts
function ChartEmpty({ message = 'No data available for this period' }) {
  return (
    <div style={{
      height: 220, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted,#64748b)', fontSize: 13, gap: 8,
      border: '1px dashed #e2e8f0', borderRadius: 10,
    }}>
      <span style={{ fontSize: 28 }}>📊</span>
      <span>{message}</span>
    </div>
  );
}

// Section heading
function SectionHead({ title, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted,#64748b)', textTransform: 'uppercase', letterSpacing: '.07em' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted,#64748b)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: OVERVIEW
// KPI cards + quick laying-rate trend chart + feed/day chart
// ─────────────────────────────────────────────────────────────────────────────
function TabOverview({ kpis, chartData, flocks, loading }) {
  return (
    <div>
      <CullAlert flocks={flocks} />

      {/* ── 6 KPI cards ── */}
      <SectionHead title="Production KPIs" sub="All production-stage layer sections · today's data" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 28 }}>
        {loading
          ? Array(6).fill(0).map((_, i) => <Skeleton key={i} h={110} />)
          : kpis.map(k => <KpiCard key={k.label} {...k} loading={false} />)
        }
      </div>

      {/* ── Laying rate trend (7-day rolling) ── */}
      <SectionHead title="Laying Rate — Last 30 Days" sub="Total eggs ÷ current birds × 100 per day" />
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 12px', marginBottom: 20 }}>
        {loading ? <Skeleton h={220} /> : chartData?.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d ? d.slice(5) : ''} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n]} labelFormatter={d => fmtDate(d)} />
              <ReferenceLine y={LAY_TARGET}   stroke="#22c55e" strokeDasharray="4 3" label={{ value: `Target ${LAY_TARGET}%`, fontSize: 9, fill: '#22c55e', position: 'right' }} />
              <ReferenceLine y={LAY_CRITICAL} stroke="#ef4444" strokeDasharray="4 3" label={{ value: `Critical ${LAY_CRITICAL}%`, fontSize: 9, fill: '#ef4444', position: 'right' }} />
              <Line type="monotone" dataKey="layingRate" stroke="#6c63ff" strokeWidth={2} dot={false} name="Laying Rate" />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmpty />}
      </div>

      {/* ── Feed per bird per day ── */}
      <SectionHead title="Feed Consumption — Last 30 Days" sub="Daily grams per bird across all production sections" />
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 12px' }}>
        {loading ? <Skeleton h={180} /> : chartData?.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="feedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d ? d.slice(5) : ''} />
              <YAxis tick={{ fontSize: 10 }} unit="g" />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(1)} g/bird`, 'Feed']} labelFormatter={d => fmtDate(d)} />
              <ReferenceLine y={FEED_GPB_TARGET} stroke="#f59e0b" strokeDasharray="4 3" label={{ value: `Target ${FEED_GPB_TARGET}g`, fontSize: 9, fill: '#f59e0b', position: 'right' }} />
              <Area type="monotone" dataKey="feedGpb" stroke="#f59e0b" fill="url(#feedGrad)" strokeWidth={2} dot={false} name="g/bird" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <ChartEmpty />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: PRODUCTION CURVE
// Laying persistence vs flock age in weeks; peak week; post-peak decline
// ─────────────────────────────────────────────────────────────────────────────
// ISA Brown commercial laying rate standard by week of lay
// Source: ISA Brown Management Guide (laying period starts at week 18 of age)
// Week key = weeks since first lay (week 0 = point of lay)
const ISA_BROWN_LAYING_STANDARD = {
   0: 50,  1: 68,  2: 80,  3: 88,  4: 92,  5: 94,  6: 95,  7: 95,
   8: 94,  9: 94, 10: 93, 11: 92, 12: 91, 13: 90, 14: 89, 15: 88,
  16: 87, 17: 86, 18: 85, 19: 84, 20: 83, 21: 82, 22: 81, 23: 80,
  24: 79, 25: 78, 26: 77, 27: 76, 28: 75, 29: 74, 30: 73, 31: 72,
  32: 71, 33: 70, 34: 69, 35: 68, 36: 67, 37: 66, 38: 65, 39: 64,
  40: 63, 41: 62, 42: 61, 43: 60, 44: 59, 45: 58, 46: 57, 47: 56,
  48: 55, 49: 54, 50: 53, 51: 52, 52: 51,
};

// Palette for per-flock overlay lines (up to 8 flocks)
const FLOCK_COLORS = [
  '#6c63ff', '#f59e0b', '#22c55e', '#ef4444',
  '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6',
];

// Merge curveData (aggregate) with ISA Brown standard into a unified week-indexed dataset
function buildCurveChartData(curveData, flockCurves) {
  // Collect all unique week numbers across aggregate + all flock curves
  const allWeeks = new Set(curveData.map(d => d.week));
  flockCurves.forEach(fc => fc.points.forEach(p => allWeeks.add(p.week)));

  // Add ISA Brown standard weeks
  Object.keys(ISA_BROWN_LAYING_STANDARD).forEach(w => allWeeks.add(Number(w)));

  // Build lookup maps
  const aggregateByWeek = Object.fromEntries(curveData.map(d => [d.week, d.layingRate]));
  const flockByWeek = {};
  flockCurves.forEach(fc => {
    flockByWeek[fc.flockId] = Object.fromEntries(fc.points.map(p => [p.week, p.layingRate]));
  });

  return [...allWeeks]
    .sort((a, b) => a - b)
    .map(week => {
      const point = { week, weekLabel: `Wk ${week}`, aggregate: aggregateByWeek[week] ?? null };
      // ISA Brown standard — only show for weeks we have data near
      const minDataWeek = Math.min(...[...allWeeks].filter(w => aggregateByWeek[w] != null));
      const maxDataWeek = Math.max(...[...allWeeks].filter(w => aggregateByWeek[w] != null));
      if (week >= minDataWeek && week <= maxDataWeek + 4) {
        point.isaBrown = ISA_BROWN_LAYING_STANDARD[week] ?? null;
      }
      // Per-flock rates
      flockCurves.forEach(fc => {
        point[fc.flockId] = flockByWeek[fc.flockId]?.[week] ?? null;
      });
      return point;
    });
}

function TabProductionCurve({ curveData, flockCurves = [], peakWeek, postPeakDeclineRate, loading, days, setDays }) {
  const chartData = buildCurveChartData(curveData, flockCurves);
  const showPerFlock = flockCurves.length > 1; // only overlay if multiple flocks

  return (
    <div>
      <SectionHead
        title="Laying Persistence Curve"
        sub="Laying rate % by flock age in weeks vs ISA Brown commercial standard"
      />

      {/* Peak week + post-peak cards */}
      {!loading && peakWeek && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 16px', flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '.05em' }}>Peak Production Week</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#16a34a', marginTop: 4 }}>Week {peakWeek.week}</div>
            <div style={{ fontSize: 11, color: '#166534' }}>{pct(peakWeek.rate)} laying rate</div>
          </div>
          {postPeakDeclineRate != null && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 16px', flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9a3412', textTransform: 'uppercase', letterSpacing: '.05em' }}>Post-Peak Decline</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#ea580c', marginTop: 4 }}>
                {pct(postPeakDeclineRate)}<span style={{ fontSize: 12, fontWeight: 500 }}>/week</span>
              </div>
              <div style={{ fontSize: 11, color: '#9a3412' }}>avg weekly drop since peak</div>
            </div>
          )}
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '10px 16px', flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#5b21b6', textTransform: 'uppercase', letterSpacing: '.05em' }}>ISA Brown Standard at Peak</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#7c3aed', marginTop: 4 }}>
              {ISA_BROWN_LAYING_STANDARD[peakWeek.week] != null ? `${ISA_BROWN_LAYING_STANDARD[peakWeek.week]}%` : '—'}
            </div>
            <div style={{ fontSize: 11, color: '#5b21b6' }}>
              {peakWeek.rate != null && ISA_BROWN_LAYING_STANDARD[peakWeek.week] != null
                ? peakWeek.rate >= ISA_BROWN_LAYING_STANDARD[peakWeek.week]
                  ? `+${(peakWeek.rate - ISA_BROWN_LAYING_STANDARD[peakWeek.week]).toFixed(1)}% above standard`
                  : `${(peakWeek.rate - ISA_BROWN_LAYING_STANDARD[peakWeek.week]).toFixed(1)}% below standard`
                : 'No comparison available'}
            </div>
          </div>
        </div>
      )}

      {/* Main chart */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 12px', marginBottom: 16 }}>
        {loading ? <Skeleton h={280} /> : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 20, bottom: 16, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
              <XAxis
                dataKey="weekLabel"
                tick={{ fontSize: 10 }}
                label={{ value: 'Flock Age (weeks)', position: 'insideBottom', offset: -8, fontSize: 10, fill: '#94a3b8' }}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
              <Tooltip
                formatter={(v, name) => {
                  if (v == null) return [null, name];
                  return [`${Number(v).toFixed(1)}%`, name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />

              {/* Target / critical reference lines */}
              <ReferenceLine y={LAY_TARGET}   stroke="#22c55e" strokeDasharray="4 3" label={{ value: `Target ${LAY_TARGET}%`, fontSize: 9, fill: '#22c55e', position: 'insideTopRight' }} />
              <ReferenceLine y={LAY_CRITICAL} stroke="#ef4444" strokeDasharray="4 3" label={{ value: `Critical ${LAY_CRITICAL}%`, fontSize: 9, fill: '#ef4444', position: 'insideTopRight' }} />

              {/* ISA Brown standard curve — dashed grey */}
              <Line
                type="monotone"
                dataKey="isaBrown"
                name="ISA Brown Standard"
                stroke="#9ca3af"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                connectNulls
              />

              {/* Aggregate line — shown when single flock or as summary */}
              <Line
                type="monotone"
                dataKey="aggregate"
                name={showPerFlock ? 'Farm Average' : 'Laying Rate'}
                stroke="#6c63ff"
                strokeWidth={showPerFlock ? 1.5 : 2.5}
                strokeDasharray={showPerFlock ? '4 2' : undefined}
                dot={showPerFlock ? false : { r: 3 }}
                connectNulls
              />

              {/* Per-flock overlay lines — only when multiple flocks */}
              {showPerFlock && flockCurves.map((fc, i) => (
                <Line
                  key={fc.flockId}
                  type="monotone"
                  dataKey={fc.flockId}
                  name={fc.batchCode}
                  stroke={FLOCK_COLORS[i % FLOCK_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmpty message="Not enough age-tagged data yet — needs at least 2 weeks of production records" />}
      </div>

      {/* Legend explanation */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted,#64748b)', padding: '8px 4px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 20, height: 2, background: '#9ca3af', display: 'inline-block', borderTop: '2px dashed #9ca3af' }} />
          ISA Brown commercial standard
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 20, height: 2, background: '#22c55e', display: 'inline-block', borderTop: '2px dashed #22c55e' }} />
          Target ({LAY_TARGET}%)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 20, height: 2, background: '#ef4444', display: 'inline-block', borderTop: '2px dashed #ef4444' }} />
          Critical ({LAY_CRITICAL}%)
        </span>
        {showPerFlock && (
          <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
            Dashed line = farm average across all flocks
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: FEED & COST
// Feed cost per crate; feed cost vs revenue overlay; cull signal
// Formula: feedCostPerCrate = (feedKg × costPerKg) / (totalEggs / 30)
// ─────────────────────────────────────────────────────────────────────────────
function TabFeedCost({ costData, summary, loading }) {
  return (
    <div>
      <SectionHead title="Feed Cost vs Egg Revenue" sub="Weekly: feed cost/crate (feedKg × costPerKg) ÷ (totalEggs ÷ 30) vs sale revenue/crate — triggers cull recommendation if cost > revenue for 2+ weeks" />

      {/* Weekly cost vs revenue chart */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 12px', marginBottom: 20 }}>
        {loading ? <Skeleton h={240} /> : costData?.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={costData} margin={{ top: 4, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₦${fmt(v)}`} />
              <Tooltip formatter={(v, n) => [`₦${fmt(v, 2)}`, n]} />
              <Line type="monotone" dataKey="feedCostPerCrate"    stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="Feed Cost/Crate" />
              <Line type="monotone" dataKey="revenuePerCrate"     stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Revenue/Crate" />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmpty message="Egg sale price not configured — add eggSalePricePerCrate in Settings" />}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {loading ? Array(3).fill(0).map((_,i) => <Skeleton key={i} h={88} />) : [
          { label: 'Avg Feed Cost / Crate', value: summary?.avgFeedCostPerCrate != null ? `₦${fmt(summary.avgFeedCostPerCrate, 2)}` : '—', icon: '🌾', note: 'Last 30 days · (feedKg × cost/kg) ÷ crates' },
          { label: 'Avg Revenue / Crate',   value: summary?.avgRevenuePerCrate  != null ? `₦${fmt(summary.avgRevenuePerCrate, 2)}`  : '—', icon: '🥚', note: 'At configured sale price' },
          { label: 'Feed Cost % of Revenue',value: summary?.feedCostPct         != null ? `${fmt(summary.feedCostPct, 1)}%`          : '—', icon: '📊', note: 'Target < 55%' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted,#64748b)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
              {c.icon} {c.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary,#0f172a)' }}>{c.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginTop: 4 }}>{c.note}</div>
          </div>
        ))}
      </div>

      {/* TODO (next task): eggSalePricePerCrate setting wiring + cost data computation in API */}
      <div style={{ fontSize: 11, color: 'var(--text-muted,#64748b)', padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginTop: 16 }}>
        ℹ️ Cost data requires <code>eggSalePricePerCrate</code> in tenant Settings. API computation built in next step.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: MORTALITY
// Cumulative mortality vs age; weekly death rate trend
// ─────────────────────────────────────────────────────────────────────────────
function TabMortality({ mortData, cumulData, summary, loading }) {
  return (
    <div>
      {/* Weekly mortality trend */}
      <SectionHead title="Weekly Mortality Count" sub="Deaths per week across all production sections" />
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 12px', marginBottom: 20 }}>
        {loading ? <Skeleton h={200} /> : mortData?.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={mortData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="mortGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="deaths" stroke="#ef4444" fill="url(#mortGrad)" strokeWidth={2} dot={{ r: 3 }} name="Deaths" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <ChartEmpty />}
      </div>

      {/* Cumulative mortality vs age */}
      <SectionHead title="Cumulative Mortality vs Flock Age" sub="Running total as % of initial placement count" />
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 12px', marginBottom: 20 }}>
        {loading ? <Skeleton h={200} /> : cumulData?.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={cumulData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cumulGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6c63ff" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6c63ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
              <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} label={{ value: 'Flock Age (weeks)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="%" domain={[0, 'auto']} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}%`, 'Cumul. Mort.']} />
              <Area type="monotone" dataKey="cumulMortPct" stroke="#6c63ff" fill="url(#cumulGrad)" strokeWidth={2} dot={false} name="Cumul. Mortality %" />
            </AreaChart>
          </ResponsiveContainer>
        ) : <ChartEmpty message="Not enough age data to build cumulative curve" />}
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {loading ? Array(3).fill(0).map((_,i) => <Skeleton key={i} h={88} />) : [
          { label: 'Cumulative Mortality',  value: summary?.cumulMortPct != null ? pct(summary.cumulMortPct) : '—', note: 'Since placement' },
          { label: 'Deaths This Week',      value: fmt(summary?.weekDeaths),  note: 'Across all sections' },
          { label: 'Weekly Mort. Rate',     value: summary?.weekMortRate != null ? pct(summary.weekMortRate) : '—', note: 'Target < 0.1%/week' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted,#64748b)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>📉 {c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary,#0f172a)' }}>{c.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted,#64748b)', marginTop: 4 }}>{c.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: FLOCKS
// Per-flock breakdown table; cull recommendation flags
// ─────────────────────────────────────────────────────────────────────────────
function TabFlocks({ flocks, loading }) {
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{Array(3).fill(0).map((_,i) => <Skeleton key={i} h={70} />)}</div>;
  if (!flocks?.length) return <ChartEmpty message="No active production-stage layer flocks found" />;

  return (
    <div>
      <SectionHead title={`${flocks.length} Active Production Flock${flocks.length > 1 ? 's' : ''}`} sub="Sorted by laying rate (lowest first)" />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              {['Batch', 'Section', 'Birds', 'Age', 'Lay Rate', 'HH Rate', 'Feed g/bird', 'Cumul Mort', 'Cull Signal'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted,#64748b)', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...flocks].sort((a, b) => (a.layingRate ?? 100) - (b.layingRate ?? 100)).map((f, i) => (
              <tr key={f.flockId} style={{ borderBottom: '1px solid #f0f4f8', background: f.cullRecommended ? '#fff7ed' : i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, color: 'var(--text-primary,#0f172a)' }}>{f.batchCode}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-muted,#64748b)' }}>{f.sectionName}</td>
                <td style={{ padding: '8px 10px' }}>{fmt(f.currentBirds)}</td>
                <td style={{ padding: '8px 10px' }}>{f.ageWeeks != null ? `${f.ageWeeks}w` : '—'}</td>
                <td style={{ padding: '8px 10px', fontWeight: 700, color: statusColor(f.layingRate, LAY_TARGET, LAY_CRITICAL) }}>{pct(f.layingRate)}</td>
                <td style={{ padding: '8px 10px', color: statusColor(f.henHousedRate, HH_TARGET, HH_TARGET - 10) }}>{pct(f.henHousedRate)}</td>
                <td style={{ padding: '8px 10px' }}>{f.feedGpb != null ? `${fmt(f.feedGpb, 0)}g` : '—'}</td>
                <td style={{ padding: '8px 10px', color: f.cumulMortPct > 5 ? 'var(--red,#ef4444)' : 'inherit' }}>{pct(f.cumulMortPct)}</td>
                <td style={{ padding: '8px 10px' }}>
                  {f.cullRecommended
                    ? <span style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>⚠️ CULL</span>
                    : <span style={{ color: 'var(--text-muted,#64748b)', fontSize: 11 }}>—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
export default function LayerProductionPage() {
  const { apiFetch, user, loading: authLoading } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [tab,        setTab]        = useState('Overview');
  const [days,       setDays]       = useState(30);
  const [dataLoading,setDataLoading]= useState(true);
  const [error,      setError]      = useState(null);

  // API data buckets
  const [overview,   setOverview]   = useState(null); // { kpis, chartData, summary }
  const [curveData,   setCurveData]  = useState([]);   // laying persistence by age-week
  const [flockCurves, setFlockCurves]= useState([]);   // per-flock overlay curves
  const [peakWeek,   setPeakWeek]   = useState(null);
  const [declineRate,setDeclineRate]= useState(null);
  const [costData,   setCostData]   = useState([]);   // weekly feed cost vs revenue
  const [costSummary,setCostSummary]= useState(null);
  const [mortData,   setMortData]   = useState([]);   // weekly deaths
  const [cumulData,  setCumulData]  = useState([]);   // cumulative mortality %
  const [mortSummary,setMortSummary]= useState(null);
  const [flocks,     setFlocks]     = useState([]);   // per-flock rows

  // Role gate — defer until auth has resolved
  const allowed = !authLoading && ALLOWED_ROLES.includes(user?.role);

  // ── Data loader ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!allowed) return;
    setDataLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/production/layers?days=${days}`);
      if (!res?.ok) {
        console.warn('Layer Analytics API not yet available — scaffold running in stub mode');
        setOverview({ kpis: [], chartData: [], summary: {} });
        setFlocks([]);
        return;
      }
      const d = await res.json();

      setOverview({ kpis: d.kpis || [], chartData: d.chartData || [], summary: d.summary || {} });
      setCurveData(d.curveData   || []);
      setFlockCurves(d.flockCurves || []);
      setPeakWeek(d.peakWeek    || null);
      setDeclineRate(d.postPeakDeclineRate ?? null);
      setCostData(d.costData      || []);
      setCostSummary(d.costSummary || null);
      setMortData(d.mortData      || []);
      setCumulData(d.cumulData    || []);
      setMortSummary(d.mortSummary || null);
      setFlocks(d.flocks || []);

    } catch (e) {
      console.error('Layer Analytics load error:', e);
      setError('Failed to load layer analytics data.');
    } finally {
      setDataLoading(false);
    }
  }, [apiFetch, days, allowed]);

  useEffect(() => { load(); }, [load]);

  // ── Auth resolving — show spinner until AuthProvider has loaded ───────────
  if (authLoading) {
    return (
      <AppShell>
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted,#64748b)' }}>
          <div style={{ fontSize: 13 }}>Loading…</div>
        </div>
      </AppShell>
    );
  }

  // ── Role gate render ───────────────────────────────────────────────────────
  if (!allowed) {
    return (
      <AppShell>
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted,#64748b)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
          <div style={{ fontWeight: 700 }}>Access Restricted</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Layer Analytics is available to Farm Admins and above.</div>
        </div>
      </AppShell>
    );
  }

  // ── KPI cards derived from overview data ──────────────────────────────────
  const kpis = overview?.kpis?.length > 0 ? overview.kpis : [
    // Stub cards shown while API is being built — labelled clearly
    { icon: '📊', label: 'Hen-Housed Rate',     value: '—', sub: 'Awaiting API',  status: 'neutral' },
    { icon: '🥚', label: 'Laying Rate Today',   value: '—', sub: 'Awaiting API',  status: 'neutral' },
    { icon: '🌾', label: 'Feed Cost / Crate',    value: '—', sub: 'Awaiting API',  status: 'neutral' },
    { icon: '📈', label: 'Peak Week',           value: '—', sub: 'Awaiting API',  status: 'neutral' },
    { icon: '📉', label: 'Cumulative Mortality',value: '—', sub: 'Awaiting API',  status: 'neutral' },
    { icon: '⭐', label: 'Grade A Rate (7d)',   value: '—', sub: 'Awaiting API',  status: 'neutral' },
  ];

  return (
    <AppShell>
      <div className="animate-in" style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* ── Page header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary,#0f172a)' }}>
              📊 Layer Production Analytics
            </h1>
            <p style={{ color: 'var(--text-muted,#64748b)', fontSize: 12, marginTop: 3, margin: 0 }}>
              Production-stage layer flocks · laying curves · cost efficiency · mortality analysis
            </p>
          </div>

          {/* Date range picker */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { label: '7d',  val: 7 },
              { label: '14d', val: 14 },
              { label: '30d', val: 30 },
              { label: '90d', val: 90 },
            ].map(({ label, val }) => (
              <button
                key={val}
                onClick={() => setDays(val)}
                style={{
                  fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                  background: days === val ? 'var(--purple-light,#eeecff)' : '#fff',
                  color:      days === val ? 'var(--purple,#6c63ff)'        : 'var(--text-muted,#64748b)',
                  border:     `1px solid ${days === val ? '#d4d8ff' : 'var(--border,#e2e8f0)'}`,
                  fontWeight: days === val ? 700 : 500,
                  transition: 'all .15s',
                }}
              >
                {label}
              </button>
            ))}
            <button
              onClick={load}
              title="Refresh"
              style={{ fontSize: 13, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', border: '1px solid var(--border,#e2e8f0)', background: '#fff', color: 'var(--text-muted,#64748b)' }}
            >
              ↺
            </button>
          </div>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 16px', marginBottom: 16, color: '#991b1b', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── Tab bar ── */}
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #e2e8f0', marginBottom: 24, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: 'none', border: 'none', outline: 'none',
                borderBottom: tab === t ? '2px solid var(--purple,#6c63ff)' : '2px solid transparent',
                color: tab === t ? 'var(--purple,#6c63ff)' : 'var(--text-muted,#64748b)',
                marginBottom: -2,
                transition: 'color .15s',
                whiteSpace: 'nowrap',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        {tab === 'Overview'    && <TabOverview      kpis={kpis} chartData={overview?.chartData || []} flocks={flocks} loading={dataLoading} />}
        {tab === 'Production'  && <TabProductionCurve curveData={curveData} flockCurves={flockCurves} peakWeek={peakWeek} postPeakDeclineRate={declineRate} loading={dataLoading} days={days} setDays={setDays} />}
        {tab === 'Feed & Cost' && <TabFeedCost       costData={costData} summary={costSummary} loading={dataLoading} />}
        {tab === 'Mortality'   && <TabMortality      mortData={mortData} cumulData={cumulData} summary={mortSummary} loading={dataLoading} />}
        {tab === 'Flocks'      && <TabFlocks         flocks={flocks} loading={dataLoading} />}

      </div>

      {/* Shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </AppShell>
  );
}
