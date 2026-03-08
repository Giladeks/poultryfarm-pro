'use client';
// app/settings/page.js — Tenant settings: SMS alerts configuration
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const ADMIN_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: type === 'error' ? '#991b1b' : '#166534',
      color: '#fff', padding: '12px 20px', borderRadius: 10,
      fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    }}>{type === 'error' ? '✕ ' : '✓ '}{msg}</div>
  );
}

function SectionCard({ title, description, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)', padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid var(--border-card)' }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif" }}>{title}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{description}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, sub }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor: 'pointer', padding: '8px 0' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div onClick={onChange} style={{
        width: 44, height: 24, borderRadius: 99, flexShrink: 0,
        background: checked ? 'var(--purple)' : '#d1d5db',
        position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 22 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'left 0.2s',
        }} />
      </div>
    </label>
  );
}

function PhoneTag({ phone, label, onRemove }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)' }}>{phone}</span>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>×</button>
    </div>
  );
}

export default function SettingsPage() {
  const { user, apiFetch } = useAuth();
  const [settings,  setSettings]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState(null);
  const [newPhone,  setNewPhone]  = useState({ label: '', phone: '' });
  const [needsMigration, setNeedsMigration] = useState(false);

  const canEdit = ADMIN_ROLES.includes(user?.role);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/settings');
      const d   = await res.json();
      if (res.ok) {
        setSettings(d.settings);
        if (d._needsMigration) setNeedsMigration(true);
      }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PATCH',
        body:   JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) return showToast(d.error || 'Failed to save', 'error');
      setSettings(d.settings);
      showToast('Settings saved');
    } finally { setSaving(false); }
  };

  const set = (path, value) => {
    const keys = path.split('.');
    const patch = {};
    let cur = patch;
    for (let i = 0; i < keys.length - 1; i++) {
      cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    save(patch);
  };

  const addPhone = () => {
    if (!newPhone.phone.trim()) return;
    const updated = [...(settings?.sms?.alertPhones || []), { label: newPhone.label || 'Alert', phone: newPhone.phone.trim() }];
    setNewPhone({ label: '', phone: '' });
    save({ sms: { alertPhones: updated } });
  };

  const removePhone = (idx) => {
    const updated = (settings?.sms?.alertPhones || []).filter((_, i) => i !== idx);
    save({ sms: { alertPhones: updated } });
  };

  const sms = settings?.sms || {};

  return (
    <AppShell>
      <style>{`@keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }`}</style>
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div style={{ maxWidth: 680, margin: '0 auto', animation: 'fadeIn 0.2s ease' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>
            ⚙️ Farm Settings
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
            Configure SMS alerts and notification preferences for your farm.
          </p>
        </div>

        {needsMigration && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
            <strong style={{ color: '#92400e' }}>⚠ Database migration needed</strong>
            <div style={{ color: '#78350f', marginTop: 4 }}>
              Run this once in your terminal, then restart the server:
              <pre style={{ marginTop: 6, background: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 11, overflowX: 'auto' }}>
{`npx prisma db execute --stdin \\
  <<< "ALTER TABLE \\"Tenant\\" ADD COLUMN IF NOT EXISTS \\"settings\\" JSONB DEFAULT '{}';"\nnpx prisma generate`}
              </pre>
            </div>
          </div>
        )}

        {!canEdit && (
          <div style={{ background: '#f8f9fa', border: '1px solid var(--border-card)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            ℹ You are viewing settings in read-only mode. Contact your Farm Admin to make changes.
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 80, background: 'var(--bg-elevated)', borderRadius: 12 }} />)}
          </div>
        ) : (
          <>
            {/* ── SMS Master Toggle ── */}
            <SectionCard
              title="📱 SMS Alerts"
              description="Send SMS notifications to farm staff when critical events occur. Requires TERMII_API_KEY in your server environment.">

              <Toggle
                checked={!!sms.enabled}
                onChange={() => canEdit && set('sms.enabled', !sms.enabled)}
                label="Enable SMS Alerts"
                sub={sms.enabled ? 'SMS alerts are active' : 'SMS alerts are disabled — no messages will be sent'}
              />

              {sms.enabled && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-card)', display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* Individual alert toggles */}
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
                    Alert Types
                  </div>

                  <Toggle
                    checked={!!sms.mortalityAlert?.enabled}
                    onChange={() => canEdit && set('sms.mortalityAlert.enabled', !sms.mortalityAlert?.enabled)}
                    label="🐔 High Mortality Alert"
                    sub="Notifies Farm Manager + Pen Manager when death count exceeds threshold"
                  />

                  {sms.mortalityAlert?.enabled && (
                    <div style={{ paddingLeft: 16, paddingBottom: 4 }}>
                      <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                        Alert threshold (birds/day)
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="number" min="1" max="500"
                          className="input"
                          style={{ width: 90, padding: '6px 10px' }}
                          defaultValue={sms.mortalityAlert?.threshold ?? 10}
                          disabled={!canEdit}
                          onBlur={e => canEdit && set('sms.mortalityAlert.threshold', Number(e.target.value) || 10)}
                        />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>deaths triggers the alert</span>
                      </div>
                    </div>
                  )}

                  <Toggle
                    checked={!!sms.lowFeedAlert?.enabled}
                    onChange={() => canEdit && set('sms.lowFeedAlert.enabled', !sms.lowFeedAlert?.enabled)}
                    label="🌾 Low Feed Stock Alert"
                    sub="Notifies Store Manager + Farm Manager when stock drops below reorder level"
                  />

                  <Toggle
                    checked={!!sms.rejectionAlert?.enabled}
                    onChange={() => canEdit && set('sms.rejectionAlert.enabled', !sms.rejectionAlert?.enabled)}
                    label="↩️ Record Rejection Alert"
                    sub="Notifies the worker via SMS when their submission is rejected"
                  />
                </div>
              )}
            </SectionCard>

            {/* ── Extra Alert Phone Numbers ── */}
            {sms.enabled && (
              <SectionCard
                title="📞 Additional Alert Numbers"
                description="Broadcast SMS alerts to extra phone numbers (e.g. farm owner's personal phone) in addition to staff with numbers on their accounts.">

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {(sms.alertPhones || []).length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No extra numbers added yet.</div>
                  )}
                  {(sms.alertPhones || []).map((p, i) => (
                    <PhoneTag key={i} phone={p.phone} label={p.label}
                      onRemove={() => canEdit && removePhone(i)} />
                  ))}
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <div style={{ flex: '0 0 140px' }}>
                      <label className="label">Label</label>
                      <input className="input" placeholder="e.g. Owner" style={{ padding: '7px 10px' }}
                        value={newPhone.label} onChange={e => setNewPhone(p => ({ ...p, label: e.target.value }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="label">Phone Number</label>
                      <input className="input" placeholder="+234 801 234 5678" style={{ padding: '7px 10px' }}
                        value={newPhone.phone} onChange={e => setNewPhone(p => ({ ...p, phone: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && addPhone()} />
                    </div>
                    <button onClick={addPhone} disabled={saving || !newPhone.phone.trim()}
                      style={{ padding: '7px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                      Add
                    </button>
                  </div>
                )}

                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                  💡 Staff phone numbers are pulled from their user profiles. Edit them in User Admin.
                </div>
              </SectionCard>
            )}

            {/* ── API Key Status ── */}
            <SectionCard
              title="🔑 Termii API Key"
              description="Configure your Termii API key in the server environment to enable SMS delivery.">
              <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: process.env.TERMII_API_KEY ? '#16a34a' : '#d1d5db',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontWeight: 600 }}>
                    {process.env.TERMII_API_KEY ? 'API key configured' : 'Not configured'}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
                  Add <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>TERMII_API_KEY=your_key</code> to your <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>.env.local</code> file and restart the server.
                  <br/>
                  Get your key at <a href="https://app.termii.com" target="_blank" rel="noreferrer" style={{ color: 'var(--purple)' }}>app.termii.com</a>
                </div>
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </AppShell>
  );
}
