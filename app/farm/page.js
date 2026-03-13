'use client';
// app/farm/page.js
// Reads ?op=layer | ?op=broiler from the URL to show only the relevant flock type.
// In single-operation mode (/farm with no param) all flocks are shown as before.
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import Modal from '@/components/ui/Modal';

const TYPE_COLOR   = { LAYER: '#f59e0b', BROILER: '#3b82f6', BREEDER: '#8b5cf6', TURKEY: '#22c55e' };
const STATUS_CLASS = { ACTIVE: 'status-green', HARVESTED: 'status-grey', CULLED: 'status-red', SOLD: 'status-blue' };
const CAN_CREATE_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// ── op param → bird type filter mapping ──────────────────────────────────────
const OP_BIRD_TYPE = { layer: 'LAYER', broiler: 'BROILER' };

// ── Page meta driven by ?op param ────────────────────────────────────────────
const OP_META = {
  layer:   { title: 'Layer Flocks',   subtitle: 'Egg-producing flocks',  icon: '🥚', color: '#f59e0b', emptyIcon: '🥚' },
  broiler: { title: 'Broiler Flocks', subtitle: 'Meat-production flocks', icon: '🍗', color: '#3b82f6', emptyIcon: '🍗' },
  all:     { title: 'Flock Management', subtitle: null,                   icon: '🐦', color: 'var(--purple)', emptyIcon: '🐦' },
};

// ── KPI definitions per op ────────────────────────────────────────────────────
function buildKpis(flocks, op) {
  const total   = flocks.reduce((s, f) => s + f.currentCount, 0);
  const active  = flocks.filter(f => f.status === 'ACTIVE').length;
  const deaths  = flocks.reduce((s, f) => s + (f.weeklyMortality || 0), 0);

  if (op === 'layer') {
    const avgLay = flocks.filter(f => f.avgLayingRate).reduce((s, f, _, a) => s + Number(f.avgLayingRate) / a.length, 0);
    return [
      { label: 'Live Birds',     value: total.toLocaleString(),    icon: '🐦', color: '#f59e0b' },
      { label: 'Active Batches', value: active,                    icon: '📋', color: 'var(--purple)' },
      { label: 'Weekly Deaths',  value: deaths,                    icon: '📉', color: 'var(--red)' },
      { label: 'Avg Lay Rate',   value: flocks.length ? `${avgLay.toFixed(0)}%` : '—', icon: '🥚', color: '#f59e0b' },
    ];
  }
  if (op === 'broiler') {
    const due = flocks.filter(f => f.expectedHarvestDate && new Date(f.expectedHarvestDate) <= new Date(Date.now() + 7 * 86400000)).length;
    return [
      { label: 'Live Birds',       value: total.toLocaleString(), icon: '🐦', color: '#3b82f6' },
      { label: 'Active Batches',   value: active,                 icon: '📋', color: 'var(--purple)' },
      { label: 'Weekly Deaths',    value: deaths,                 icon: '📉', color: 'var(--red)' },
      { label: 'Harvest This Week', value: due,                   icon: '🏭', color: '#3b82f6' },
    ];
  }
  // all
  return [
    { label: 'Total Live Birds',  value: total.toLocaleString(),                              icon: '🐦', color: 'var(--purple)' },
    { label: 'Active Batches',    value: active,                                              icon: '📋', color: 'var(--blue)'   },
    { label: 'Weekly Mortality',  value: deaths,                                              icon: '📉', color: 'var(--amber)'  },
    { label: 'Layer Batches',     value: flocks.filter(f => f.birdType === 'LAYER').length,   icon: '🥚', color: 'var(--amber)'  },
  ];
}

// ── Inner page (needs useSearchParams, wrapped in Suspense below) ─────────────
function FarmPageInner() {
  const { apiFetch, user } = useAuth();
  const searchParams       = useSearchParams();

  const op       = searchParams.get('op') || 'all';           // 'layer' | 'broiler' | 'all'
  const meta     = OP_META[op] || OP_META.all;
  const birdType = OP_BIRD_TYPE[op] || null;                  // null = no type filter

  const [flocks,     setFlocks]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState({ status: 'ACTIVE' });
  const [selected,   setSelected]   = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  // Re-fetch when the op param or status filter changes
  useEffect(() => { loadFlocks(); }, [op, filter.status]);

  const loadFlocks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: filter.status || 'ALL' });
      if (birdType) params.set('birdType', birdType);
      const res = await apiFetch(`/api/flocks?${params}`);
      if (res.ok) { const d = await res.json(); setFlocks(d.flocks || []); }
    } finally { setLoading(false); }
  };

  const canCreate  = CAN_CREATE_ROLES.includes(user?.role);
  const kpis       = buildKpis(flocks, op);
  const totalBirds = flocks.reduce((s, f) => s + f.currentCount, 0);

  return (
    <AppShell>
      <div className="animate-in">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 24 }}>{meta.icon}</span>
              <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                {meta.title}
              </h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 0 }}>
              {meta.subtitle
                ? `${meta.subtitle} · ${flocks.length} ${flocks.length === 1 ? 'batch' : 'batches'} · ${totalBirds.toLocaleString()} live birds`
                : `${flocks.length} active ${flocks.length === 1 ? 'batch' : 'batches'} · ${totalBirds.toLocaleString()} live birds`
              }
            </p>
          </div>
          {canCreate && (
            <button onClick={() => setShowCreate(true)} className="btn btn-primary">
              + New {op !== 'all' ? meta.title.replace(' Flocks', '') + ' ' : ''}Flock Batch
            </button>
          )}
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
          {kpis.map(k => (
            <div key={k.label} className="card" style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{k.label}</span>
                <span style={{ fontSize: 20 }}>{k.icon}</span>
              </div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 26, fontWeight: 700, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Status filter — birdType filter removed (already locked by op param) */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {['ACTIVE', 'HARVESTED', 'ALL'].map(s => (
            <button key={s} onClick={() => setFilter(p => ({ ...p, status: s }))} className="btn"
              style={{
                display: 'inline-flex', width: 'auto', padding: '6px 14px', fontSize: 12,
                background: filter.status === s ? 'var(--purple-light)' : '#fff',
                color: filter.status === s ? 'var(--purple)' : 'var(--text-muted)',
                border: `1px solid ${filter.status === s ? '#d4d8ff' : 'var(--border)'}`,
                fontWeight: filter.status === s ? 700 : 600, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Flock grid */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {[1, 2, 3, 4, 5, 6].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : flocks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{meta.emptyIcon}</div>
            <div style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 600 }}>
              No {op !== 'all' ? meta.title.toLowerCase() : 'flocks'} found
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {filter.status !== 'ALL' ? `Try switching to "All" to see inactive batches` : ''}
            </div>
            {canCreate && (
              <button onClick={() => setShowCreate(true)} className="btn btn-primary" style={{ marginTop: 16 }}>
                + Add First {op !== 'all' ? meta.title.replace(' Flocks', '') + ' ' : ''}Flock Batch
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {flocks.map(f => <FlockCard key={f.id} flock={f} onClick={setSelected} />)}
          </div>
        )}
      </div>

      {selected    && <FlockModal  flock={selected} onClose={() => setSelected(null)} />}
      {showCreate  && (
        <CreateFlockModal
          apiFetch={apiFetch}
          defaultBirdType={birdType}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadFlocks(); }}
        />
      )}
    </AppShell>
  );
}

// ── Wrap in Suspense — required by Next.js for useSearchParams ────────────────
export default function FarmPage() {
  return (
    <Suspense fallback={<AppShell><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div></AppShell>}>
      <FarmPageInner />
    </Suspense>
  );
}

// ── Flock card ─────────────────────────────────────────────────────────────────
function FlockCard({ flock, onClick }) {
  const tc          = TYPE_COLOR[flock.birdType] || '#9ca3af';
  const survivalPct = flock.initialCount > 0 ? (flock.currentCount / flock.initialCount) * 100 : 100;
  return (
    <div className="card" onClick={() => onClick(flock)}
      style={{ cursor: 'pointer', padding: 18, transition: 'all 0.2s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--purple)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-card)'; e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{flock.batchCode}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{flock.breed}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{ background: `${tc}15`, color: tc, border: `1px solid ${tc}30`, borderRadius: 10, padding: '2px 9px', fontSize: 10, fontWeight: 700 }}>{flock.birdType}</span>
          <span className={`status-badge ${STATUS_CLASS[flock.status] || 'status-grey'}`}>{flock.status}</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        {flock.currentCount.toLocaleString()} / {flock.initialCount.toLocaleString()} birds · {survivalPct.toFixed(1)}% survival
      </div>
      <div className="progress-bar" style={{ marginBottom: 12 }}>
        <div className="progress-fill" style={{ width: `${survivalPct}%`, background: survivalPct >= 90 ? 'var(--green)' : survivalPct >= 80 ? 'var(--amber)' : 'var(--red)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        {[
          { label: 'Age', value: `${flock.ageInDays || 0}d` },
          { label: '7d Deaths', value: flock.weeklyMortality || 0, alert: (flock.weeklyMortality || 0) > 15 },
          flock.birdType === 'LAYER'
            ? { label: 'Lay Rate', value: flock.avgLayingRate ? `${Number(flock.avgLayingRate).toFixed(0)}%` : '—', color: '#f59e0b' }
            : { label: 'Harvest',  value: flock.expectedHarvestDate ? new Date(flock.expectedHarvestDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '—', color: '#3b82f6' },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: s.alert ? 'var(--red)' : s.color || 'var(--text-primary)' }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        📍 {flock.penSection?.pen?.name} — {flock.penSection?.name}
      </div>
    </div>
  );
}

// ── Flock detail modal ─────────────────────────────────────────────────────────
function FlockModal({ flock, onClose }) {
  const daysToHarvest = flock.expectedHarvestDate
    ? Math.max(0, Math.floor((new Date(flock.expectedHarvestDate) - new Date()) / 86400000))
    : null;

  return (
    <Modal
      width={520}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" style={{ flex: 1 }}>📋 Records</button>
          <button className="btn btn-outline" style={{ flex: 1 }}>💉 Vaccine</button>
          <button onClick={onClose} className="btn btn-primary" style={{ flex: 1 }}>Close</button>
        </>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>{flock.batchCode}</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{flock.breed} · {flock.birdType}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px' }}>✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Current Birds',  value: flock.currentCount.toLocaleString(),                                                                                      color: 'var(--purple)' },
          { label: 'Survival Rate',  value: `${((flock.currentCount / flock.initialCount) * 100).toFixed(1)}%`,                                                      color: 'var(--green)'  },
          { label: flock.birdType === 'LAYER' ? 'Laying Rate' : 'Days to Harvest',
            value: flock.birdType === 'LAYER'
              ? (flock.avgLayingRate ? `${Number(flock.avgLayingRate).toFixed(0)}%` : '—')
              : (daysToHarvest !== null ? `${daysToHarvest}d` : '—'),
            color: 'var(--amber)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 9, padding: 12, textAlign: 'center' }}>
            <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
        {[
          ['Pen Location',  `${flock.penSection?.pen?.name} — ${flock.penSection?.name}`],
          ['Date Placed',   new Date(flock.dateOfPlacement).toLocaleDateString('en-NG', { dateStyle: 'medium' })],
          ['Source',        flock.source?.replace('_', ' ')],
          ['Purchase Cost', flock.purchaseCost ? `₦${Number(flock.purchaseCost).toLocaleString('en-NG')}` : '—'],
        ].map(([l, v]) => (
          <div key={l} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{l}</div>
            <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{v || '—'}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ── Create flock modal ─────────────────────────────────────────────────────────
// defaultBirdType: pre-selects the bird type based on which nav item was clicked
function CreateFlockModal({ apiFetch, defaultBirdType, onClose, onCreated }) {
  const [form, setForm] = useState({
    batchCode: '', birdType: defaultBirdType || 'LAYER', breed: '', penSectionId: '',
    dateOfPlacement: new Date().toISOString().split('T')[0],
    initialCount: '', source: 'PURCHASED', purchaseCost: '',
    targetWeightG: '', expectedHarvestDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCreate = async () => {
    if (!form.batchCode || !form.breed || !form.initialCount) {
      setError('Please fill in all required fields.');
      return;
    }
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/flocks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          initialCount: parseInt(form.initialCount),
          purchaseCost: form.purchaseCost ? parseFloat(form.purchaseCost) : undefined,
        }),
      });
      const d = await res.json();
      if (res.ok) onCreated();
      else setError(d.error || 'Failed to create flock');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      title={`🐦 New ${defaultBirdType ? defaultBirdType.charAt(0) + defaultBirdType.slice(1).toLowerCase() + ' ' : ''}Flock Batch`}
      width={500}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={handleCreate} disabled={saving} className="btn btn-primary" style={{ flex: 2 }}>
            {saving ? 'Creating…' : '+ Create Flock Batch'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="label">Batch Code *</label>
          <input value={form.batchCode} onChange={e => up('batchCode', e.target.value)} className="input" placeholder="e.g. LAY-2026-005" />
        </div>
        <div>
          <label className="label">Bird Type *</label>
          <select value={form.birdType} onChange={e => up('birdType', e.target.value)} className="input">
            {['LAYER', 'BROILER', 'BREEDER', 'TURKEY'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Breed *</label>
          <input value={form.breed} onChange={e => up('breed', e.target.value)} className="input" placeholder="e.g. Isa Brown" />
        </div>
        <div>
          <label className="label">Date of Placement *</label>
          <input type="date" value={form.dateOfPlacement} onChange={e => up('dateOfPlacement', e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Initial Count *</label>
          <input type="number" value={form.initialCount} onChange={e => up('initialCount', e.target.value)} className="input" placeholder="e.g. 2500" />
        </div>
        <div>
          <label className="label">Source</label>
          <select value={form.source} onChange={e => up('source', e.target.value)} className="input">
            {['PURCHASED', 'OWN_HATCHERY', 'TRANSFERRED'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Purchase Cost (₦)</label>
          <input type="number" value={form.purchaseCost} onChange={e => up('purchaseCost', e.target.value)} className="input" placeholder="e.g. 3000" />
        </div>
      </div>
      {error && (
        <div className="alert alert-red" style={{ marginTop: 14 }}>
          <span>⚠</span><span>{error}</span>
        </div>
      )}
    </Modal>
  );
}

function SkeletonCard() {
  return (
    <div className="card" style={{ opacity: 0.4, padding: 18 }}>
      <div style={{ height: 14, background: 'var(--bg-elevated)', borderRadius: 4, width: '50%', marginBottom: 10 }} />
      <div style={{ height: 30, background: 'var(--bg-elevated)', borderRadius: 4, width: '45%', marginBottom: 10 }} />
      <div style={{ height: 6,  background: 'var(--bg-elevated)', borderRadius: 3 }} />
    </div>
  );
}
