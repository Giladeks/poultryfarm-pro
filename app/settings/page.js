'use client';
// app/settings/page.js — grouped sections: Notifications | Farm Profile | Security
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const ADMIN_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

const SECTIONS = [
  { key: 'notifications', icon: '🔔', label: 'Notifications' },
  { key: 'farm',          icon: '🏡', label: 'Farm Profile'  },
  { key: 'security',      icon: '🔒', label: 'Security'      },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: type === 'error' ? '#991b1b' : '#166534', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', animation: 'fadeIn 0.2s ease' }}>
      {type === 'error' ? '✕ ' : '✓ '}{msg}
    </div>
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

function Toggle({ checked, onChange, label, sub, disabled }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, cursor: disabled ? 'default' : 'pointer', padding: '8px 0', opacity: disabled ? 0.6 : 1 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div onClick={disabled ? undefined : onChange} style={{ width: 44, height: 24, borderRadius: 99, flexShrink: 0, background: checked ? 'var(--purple)' : '#d1d5db', position: 'relative', cursor: disabled ? 'default' : 'pointer', transition: 'background 0.2s' }}>
        <div style={{ position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
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

function FieldRow({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--border-card)' }}>
      <div style={{ flex: '0 0 200px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function PlaceholderBadge({ text }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, background: '#f1f5f9', color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: 8 }}>
      {text}
    </span>
  );
}

// ─── Notifications section ────────────────────────────────────────────────────
function NotificationsSection({ sms, canEdit, set, save, saving }) {
  const [newPhone, setNewPhone] = useState({ label: '', phone: '' });

  const addPhone = () => {
    if (!newPhone.phone.trim()) return;
    const updated = [...(sms.alertPhones || []), { label: newPhone.label || 'Alert', phone: newPhone.phone.trim() }];
    setNewPhone({ label: '', phone: '' });
    save({ sms: { alertPhones: updated } });
  };
  const removePhone = (idx) => {
    const updated = (sms.alertPhones || []).filter((_, i) => i !== idx);
    save({ sms: { alertPhones: updated } });
  };

  return (
    <>
      <SectionCard title="📱 SMS Alerts" description="Send SMS notifications to farm staff when critical events occur. Requires TERMII_API_KEY in your server environment.">
        <Toggle
          checked={!!sms.enabled}
          onChange={() => canEdit && set('sms.enabled', !sms.enabled)}
          label="Enable SMS Alerts"
          sub={sms.enabled ? 'SMS alerts are active' : 'SMS alerts are disabled — no messages will be sent'}
          disabled={!canEdit}
        />

        {sms.enabled && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-card)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Alert Types</div>

            <Toggle checked={!!sms.mortalityAlert?.enabled} onChange={() => canEdit && set('sms.mortalityAlert.enabled', !sms.mortalityAlert?.enabled)} label="🐔 High Mortality Alert" sub="Notifies Farm Manager + Pen Manager when death count exceeds threshold" disabled={!canEdit} />

            {sms.mortalityAlert?.enabled && (
              <div style={{ paddingLeft: 16, paddingBottom: 4 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Alert threshold (birds/day)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="number" min="1" max="500" className="input" style={{ width: 90, padding: '6px 10px' }} defaultValue={sms.mortalityAlert?.threshold ?? 10} disabled={!canEdit} onBlur={e => canEdit && set('sms.mortalityAlert.threshold', Number(e.target.value) || 10)} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>deaths triggers the alert</span>
                </div>
              </div>
            )}

            <Toggle checked={!!sms.lowFeedAlert?.enabled} onChange={() => canEdit && set('sms.lowFeedAlert.enabled', !sms.lowFeedAlert?.enabled)} label="🌾 Low Feed Stock Alert" sub="Notifies Store Manager + Farm Manager when stock drops below reorder level" disabled={!canEdit} />
            <Toggle checked={!!sms.rejectionAlert?.enabled} onChange={() => canEdit && set('sms.rejectionAlert.enabled', !sms.rejectionAlert?.enabled)} label="↩️ Record Rejection Alert" sub="Notifies the worker via SMS when their submission is rejected" disabled={!canEdit} />
          </div>
        )}
      </SectionCard>

      {sms.enabled && (
        <SectionCard title="📞 Additional Alert Numbers" description="Broadcast SMS alerts to extra phone numbers (e.g. farm owner's personal phone) in addition to staff with numbers on their accounts.">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(sms.alertPhones || []).length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No extra numbers added yet.</div>}
            {(sms.alertPhones || []).map((p, i) => <PhoneTag key={i} phone={p.phone} label={p.label} onRemove={() => canEdit && removePhone(i)} />)}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: '0 0 140px' }}>
                <label className="label">Label</label>
                <input className="input" placeholder="e.g. Owner" style={{ padding: '7px 10px' }} value={newPhone.label} onChange={e => setNewPhone(p => ({ ...p, label: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label">Phone Number</label>
                <input className="input" placeholder="+234 801 234 5678" style={{ padding: '7px 10px' }} value={newPhone.phone} onChange={e => setNewPhone(p => ({ ...p, phone: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addPhone()} />
              </div>
              <button onClick={addPhone} disabled={saving || !newPhone.phone.trim()} style={{ padding: '7px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Add</button>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>💡 Staff phone numbers are pulled from their user profiles. Edit them in User Admin.</div>
        </SectionCard>
      )}

      <SectionCard title="🔑 Termii API Key" description="Configure your Termii API key in the server environment to enable SMS delivery.">
        <div style={{ fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#d1d5db', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Status unknown (server-side env var)</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
            Add <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>TERMII_API_KEY=your_key</code> to your <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>.env.local</code> file and restart the server.
            <br />
            Get your key at <a href="https://app.termii.com" target="_blank" rel="noreferrer" style={{ color: 'var(--purple)' }}>app.termii.com</a>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

// ─── Farm Profile section ─────────────────────────────────────────────────────
function FarmProfileSection({ settings, canEdit, save, saving }) {
  const profile = settings?.farmProfile || {};
  const [form,    setForm]    = useState({ name: profile.name || '', location: profile.location || '', contactEmail: profile.contactEmail || '', contactPhone: profile.contactPhone || '', registrationNumber: profile.registrationNumber || '', description: profile.description || '' });
  const [changed, setChanged] = useState(false);

  const up = (k, v) => { setForm(p => ({ ...p, [k]: v })); setChanged(true); };
  const handleSave = () => { save({ farmProfile: form }); setChanged(false); };

  return (
    <SectionCard title="🏡 Farm Profile" description="Basic information about your farm shown in reports and shared documents.">
      {!canEdit && <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 12px' }}>ℹ Read-only — contact your Farm Admin to make changes.</div>}

      <FieldRow label="Farm Name" hint="Used in reports and PDF exports">
        <input className="input" value={form.name} onChange={e => up('name', e.target.value)} placeholder="e.g. GreenAcres Farms" disabled={!canEdit} />
      </FieldRow>
      <FieldRow label="Location" hint="Town, state or full address">
        <input className="input" value={form.location} onChange={e => up('location', e.target.value)} placeholder="e.g. Ibadan, Oyo State" disabled={!canEdit} />
      </FieldRow>
      <FieldRow label="Contact Email" hint="Primary contact for the farm">
        <input type="email" className="input" value={form.contactEmail} onChange={e => up('contactEmail', e.target.value)} placeholder="info@yourfarm.ng" disabled={!canEdit} />
      </FieldRow>
      <FieldRow label="Contact Phone">
        <input className="input" value={form.contactPhone} onChange={e => up('contactPhone', e.target.value)} placeholder="+234 801 234 5678" disabled={!canEdit} />
      </FieldRow>
      <FieldRow label="Registration Number" hint="CAC or regulatory licence number">
        <input className="input" value={form.registrationNumber} onChange={e => up('registrationNumber', e.target.value)} placeholder="CAC/IT/000000" disabled={!canEdit} />
      </FieldRow>
      <FieldRow label="Description" hint="Brief description for reports">
        <textarea className="input" rows={3} value={form.description} onChange={e => up('description', e.target.value)} placeholder="A brief description of your farm operations…" disabled={!canEdit} style={{ resize: 'vertical' }} />
      </FieldRow>

      {canEdit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSave} disabled={saving || !changed} className="btn btn-primary">{saving ? 'Saving…' : 'Save Farm Profile'}</button>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Security section ─────────────────────────────────────────────────────────
function SecuritySection({ canEdit }) {
  return (
    <>
      <SectionCard title="🔐 Password Policy" description="Enforce password strength and rotation rules for all staff accounts.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <FieldRow label={<>Min Password Length <PlaceholderBadge text="Coming Soon" /></>} hint="Minimum characters required for all passwords">
            <select className="input" disabled style={{ maxWidth: 120 }}>
              <option>8 characters</option>
              <option>12 characters</option>
            </select>
          </FieldRow>
          <FieldRow label={<>Require Special Characters <PlaceholderBadge text="Coming Soon" /></>} hint="Symbols, numbers and mixed case">
            <Toggle checked={false} onChange={() => {}} label="" disabled />
          </FieldRow>
          <FieldRow label={<>Password Expiry <PlaceholderBadge text="Coming Soon" /></>} hint="Force password reset after N days (0 = never)">
            <input className="input" type="number" placeholder="90" disabled style={{ maxWidth: 100 }} />
          </FieldRow>
        </div>
        <div style={{ marginTop: 4, padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          💡 Password policies will be enforced on next login or password change. Current sessions are not affected.
        </div>
      </SectionCard>

      <SectionCard title="🛡️ Session & Access" description="Control how long sessions last and restrict access by IP or device.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <FieldRow label={<>Session Timeout <PlaceholderBadge text="Coming Soon" /></>} hint="Auto-logout after period of inactivity">
            <select className="input" disabled style={{ maxWidth: 160 }}>
              <option>8 hours</option>
              <option>24 hours</option>
              <option>7 days</option>
            </select>
          </FieldRow>
          <FieldRow label={<>Two-Factor Authentication <PlaceholderBadge text="Coming Soon" /></>} hint="Require 2FA for admin roles">
            <Toggle checked={false} onChange={() => {}} label="" disabled />
          </FieldRow>
          <FieldRow label={<>Audit Log Retention <PlaceholderBadge text="Coming Soon" /></>} hint="How long to keep action logs">
            <select className="input" disabled style={{ maxWidth: 160 }}>
              <option>90 days</option>
              <option>180 days</option>
              <option>1 year</option>
            </select>
          </FieldRow>
        </div>
        <div style={{ marginTop: 4, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#78350f' }}>
          ⚠ These features are in development. Your current audit logs are stored indefinitely.
        </div>
      </SectionCard>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user, apiFetch } = useAuth();
  const [settings,       setSettings]       = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [toast,          setToast]          = useState(null);
  const [activeSection,  setActiveSection]  = useState('notifications');
  const [needsMigration, setNeedsMigration] = useState(false);

  const canEdit = ADMIN_ROLES.includes(user?.role);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/settings');
      const d   = await res.json();
      if (res.ok) { setSettings(d.settings); if (d._needsMigration) setNeedsMigration(true); }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
      const d   = await res.json();
      if (!res.ok) return showToast(d.error || 'Failed to save', 'error');
      setSettings(d.settings);
      showToast('Settings saved');
    } finally { setSaving(false); }
  };

  const set = (path, value) => {
    const keys = path.split('.');
    const patch = {};
    let cur = patch;
    for (let i = 0; i < keys.length - 1; i++) { cur[keys[i]] = {}; cur = cur[keys[i]]; }
    cur[keys[keys.length - 1]] = value;
    save(patch);
  };

  const sms = settings?.sms || {};

  return (
    <AppShell>
      <style>{`@keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }`}</style>
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div style={{ maxWidth: 780, margin: '0 auto', animation: 'fadeIn 0.2s ease' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>⚙️ Farm Settings</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Manage notifications, farm profile and security settings.</p>
        </div>

        {needsMigration && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 12 }}>
            <strong style={{ color: '#92400e' }}>⚠ Database migration needed</strong>
            <div style={{ color: '#78350f', marginTop: 4 }}>
              Run this once in your terminal, then restart the server:
              <pre style={{ marginTop: 6, background: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 11, overflowX: 'auto' }}>{`npx prisma db execute --stdin \\\n  <<< "ALTER TABLE \\"Tenant\\" ADD COLUMN IF NOT EXISTS \\"settings\\" JSONB DEFAULT '{}';"
npx prisma generate`}</pre>
            </div>
          </div>
        )}

        {!canEdit && (
          <div style={{ background: '#f8f9fa', border: '1px solid var(--border-card)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
            ℹ Viewing in read-only mode. Contact your Farm Admin to make changes.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20, alignItems: 'start' }}>
          {/* Section nav */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)', overflow: 'hidden', position: 'sticky', top: 20 }}>
            {SECTIONS.map(s => {
              const active = activeSection === s.key;
              return (
                <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', background: active ? 'var(--purple-light)' : 'transparent',
                  border: 'none', borderLeft: `3px solid ${active ? 'var(--purple)' : 'transparent'}`,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? 'var(--purple)' : 'var(--text-secondary)', transition: 'all 0.15s', textAlign: 'left',
                }}>
                  <span style={{ fontSize: 16 }}>{s.icon}</span>{s.label}
                </button>
              );
            })}
          </div>

          {/* Section content */}
          <div>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1,2,3].map(i => <div key={i} style={{ height: 100, background: 'var(--bg-elevated)', borderRadius: 12 }} />)}
              </div>
            ) : (
              <>
                {activeSection === 'notifications' && <NotificationsSection sms={sms} canEdit={canEdit} set={set} save={save} saving={saving} />}
                {activeSection === 'farm'          && <FarmProfileSection settings={settings} canEdit={canEdit} save={save} saving={saving} />}
                {activeSection === 'security'      && <SecuritySection canEdit={canEdit} />}
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
