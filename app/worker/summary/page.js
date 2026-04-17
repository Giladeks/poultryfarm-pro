'use client';
// app/worker/summary/page.js — Worker Daily Summary
// Dedicated page showing the DailySummaryCard for each of the worker's sections.
// Replaces the inline DailySummaryCard that was embedded in the worker task dashboard.
//
// Accessed via:
//   - "📋 View Day Summary" link at the bottom of each section card on /worker
//   - Completing a REPORT_SUBMISSION task on /worker
//
// The DailySummaryCard handles its own data fetching, checklist, observation entry,
// and submit action. Auto-submission at cutoff time is server-side and unaffected.

import { useState, useEffect, useCallback } from 'react';
import { useRouter }    from 'next/navigation';
import AppShell         from '@/components/layout/AppShell';
import { useAuth }      from '@/components/layout/AuthProvider';
import DailySummaryCard from '@/components/daily/DailySummaryCard';

export const dynamic = 'force-dynamic';

const fmt = n => Number(n || 0).toLocaleString('en-NG');

export default function WorkerSummaryPage() {
  const { apiFetch, user } = useAuth();
  const router = useRouter();

  // Only pen workers see this page — others go to their dashboard
  useEffect(() => {
    if (user && user.role !== 'PEN_WORKER') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const [sections, setSections] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saveCount,setSaveCount]= useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/dashboard');
      if (res.ok) {
        const d = await res.json();
        const loaded = (d.sections || []).map(s => ({
          ...s,
          flock: s.flock ?? s.activeFlock ?? null,
        }));
        setSections(loaded);
      }
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const today = new Date().toLocaleDateString('en-NG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  if (!user) return null;

  return (
    <AppShell>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '20px 16px', minHeight: '100vh', background: 'var(--bg-page, #f8fafc)' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 20 }}>
          {/* Back button */}
          <button
            onClick={() => router.push('/worker')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginBottom: 14, padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--border-card)', background: '#fff',
              color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            ← Back to Tasks
          </button>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{
                fontFamily: "'Poppins',sans-serif", fontSize: 20, fontWeight: 800,
                margin: 0, marginBottom: 4, color: 'var(--text-primary)',
              }}>
                📋 Daily Summary
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                {today}
              </p>
            </div>

            {/* Refresh button */}
            <button
              onClick={() => setSaveCount(c => c + 1)}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: '1px solid var(--border-card)', background: '#fff',
                color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* ── Explainer banner ── */}
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          background: '#f0f9ff', border: '1px solid #bfdbfe',
          fontSize: 12, color: '#1e40af', marginBottom: 20,
        }}>
          <strong>How this works:</strong> As you complete tasks, records are automatically added to your day's summary.
          Complete the checklist below and add a closing observation to submit your summary to the Pen Manager.
          If you don't submit before <strong>18:30</strong>, it will be auto-submitted.
        </div>

        {/* ── Loading skeleton ── */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[1, 2].map(i => (
              <div key={i} style={{ height: 200, background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)', animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        )}

        {/* ── No sections ── */}
        {!loading && sections.length === 0 && (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)',
          }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>No sections assigned</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Contact your Pen Manager to get assigned to a section.</div>
          </div>
        )}

        {/* ── Section summary cards ── */}
        {!loading && sections.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sections.map(sec => {
              const flock   = sec.flock || null;
              const isLayer = sec.penOperationType === 'LAYER';
              const stage   = sec.metrics?.stage || flock?.stage || 'PRODUCTION';
              const hasFlock= !!flock;
              const opColor = isLayer ? '#d97706' : '#3b82f6';

              return (
                <div key={sec.id} style={{
                  background: '#fff', borderRadius: 14,
                  border: '1.5px solid var(--border-card)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  overflow: 'hidden',
                }}>
                  {/* Section header */}
                  <div style={{
                    padding: '12px 16px',
                    background: 'var(--bg-base)',
                    borderBottom: '1px solid var(--border-card)',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: `${opColor}18`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18, flexShrink: 0,
                    }}>
                      {isLayer ? '🥚' : '🍗'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif" }}>
                        {sec.penName} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>›</span> {sec.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        {hasFlock
                          ? `${flock.batchCode} · ${fmt(flock.currentCount)} birds · ${stage}`
                          : 'No active flock'
                        }
                      </div>
                    </div>
                  </div>

                  {/* DailySummaryCard */}
                  {hasFlock ? (
                    <div style={{ padding: '0 0 0 0' }}>
                      <DailySummaryCard
                        penSectionId={sec.id}
                        isLayer={isLayer}
                        stage={stage}
                        brooderTemp={sec.metrics?.latestBrooderTemp ?? null}
                        apiFetch={apiFetch}
                        refreshKey={saveCount}
                      />
                    </div>
                  ) : (
                    <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No active flock — summary unavailable
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer spacer for mobile nav ── */}
        <div style={{ height: 32 }} />
      </div>
    </AppShell>
  );
}
