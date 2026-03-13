'use client';
// app/settings/page.js — Slack-style horizontal-tab layout
// Tabs: Settings (overview) | Notifications | Email Alerts | Farm Profile | Security | Access Logs
//
// Phase 8A: Operation Mode selector lives inside the Farm Profile tab,
// as the top "Farm Operations" section — above Farm Details.
// No separate Operations tab.

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const ADMIN_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];
// Operation mode changes are restricted to Farm Admin and above (not Farm Manager)
const OP_MODE_ROLES = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

// ── Tab definitions ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'overview',      label: 'Settings'     },
  { key: 'notifications', label: 'Notifications' },
  { key: 'email',         label: 'Email Alerts'  },
  { key: 'farm',          label: 'Farm Profile'  },
  { key: 'security',      label: 'Security'      },
  { key: 'access',        label: 'Access Logs'   },
];

// ── Operation mode options ────────────────────────────────────────────────────
const MODE_OPTIONS = [
  {
    value: 'LAYER_ONLY',
    icon: '🥚',
    title: 'Layer Only',
    description: 'Egg production only. Broiler screens and harvest features are hidden.',
  },
  {
    value: 'BROILER_ONLY',
    icon: '🍗',
    title: 'Broiler Only',
    description: 'Meat production only. Egg collection and layer analytics are hidden.',
  },
  {
    value: 'BOTH',
    icon: '🐔',
    title: 'Layer + Broiler',
    description: 'Full dual-operation mode. All screens visible, grouped by operation.',
  },
];

// ── Shared primitives ─────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: type === 'error' ? '#991b1b' : '#166534',
      color: '#fff', padding: '12px 20px', borderRadius: 10,
      fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      animation: 'fadeIn 0.2s ease',
    }}>
      {type === 'error' ? '✕ ' : '✓ '}{msg}
    </div>
  );
}

function Toggle({ checked, onChange, label, sub, disabled }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, padding: '12px 0', borderBottom: '1px solid var(--border-card)',
      opacity: disabled ? 0.6 : 1,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div
        onClick={disabled ? undefined : onChange}
        style={{
          width: 44, height: 24, borderRadius: 99, flexShrink: 0,
          background: checked ? 'var(--purple)' : '#d1d5db',
          position: 'relative', cursor: disabled ? 'default' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: checked ? 22 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)', transition: 'left 0.2s',
        }} />
      </div>
    </div>
  );
}

function SettingRow({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 32,
      padding: '16px 0', borderBottom: '1px solid var(--border-card)',
    }}>
      <div style={{ flex: '0 0 220px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function SectionBlock({ title, description, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{title}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{description}</div>}
      </div>
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid var(--border-card)', padding: '0 20px' }}>
        {children}
      </div>
    </div>
  );
}

function PlaceholderBadge({ text }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, background: '#f1f5f9', color: '#94a3b8',
      border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 7px',
      textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: 8,
    }}>
      {text}
    </span>
  );
}

function PhoneTag({ phone, label, onRemove }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'var(--bg-elevated)', border: '1px solid var(--border-card)',
      borderRadius: 6, padding: '4px 10px', fontSize: 12,
    }}>
      <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)' }}>{phone}</span>
      {onRemove && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>×</button>
      )}
    </div>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────
function OverviewTab({ settings, setActiveTab }) {
  const sms   = settings?.sms   || {};
  const email = settings?.email || {};
  const farm  = settings?.farmProfile || {};
  const mode  = settings?.operationMode || 'LAYER_ONLY';

  const MODE_LABELS = { LAYER_ONLY: 'Layer Only', BROILER_ONLY: 'Broiler Only', BOTH: 'Layer + Broiler' };

  const items = [
    {
      icon: '🏡', label: 'Farm Profile',
      status: farm.name ? `${farm.name}${mode ? ' · ' + MODE_LABELS[mode] : ''}` : 'Not configured',
      color: farm.name ? '#6c63ff' : '#9ca3af', tab: 'farm',
    },
    {
      icon: '📱', label: 'SMS Alerts',
      status: sms.enabled ? 'Enabled' : 'Disabled',
      color: sms.enabled ? '#16a34a' : '#9ca3af', tab: 'notifications',
    },
    {
      icon: '📧', label: 'Email Alerts',
      status: email.enabled ? 'Enabled' : 'Disabled',
      color: email.enabled ? '#16a34a' : '#9ca3af', tab: 'email',
    },
    { icon: '🔒', label: 'Security', status: 'Defaults active', color: '#9ca3af', tab: 'security' },
  ];

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        Configure your farm profile, operation mode, notifications, security and permissions.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {items.map(item => (
          <button key={item.tab} onClick={() => setActiveTab(item.tab)} style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px',
            background: '#fff', borderRadius: 12, border: '1px solid var(--border-card)',
            cursor: 'pointer', textAlign: 'left', transition: 'box-shadow 0.15s',
            fontFamily: 'inherit',
          }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: `${item.color}15`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 22,
            }}>{item.icon}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{item.label}</div>
              <div style={{ fontSize: 12, color: item.color, fontWeight: 600, marginTop: 2 }}>{item.status}</div>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 16, color: 'var(--text-muted)' }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tab: Farm Profile (includes Operation Mode at top) ────────────────────────
function FarmProfileTab({ settings, tenantDefaults, canEdit, save, saving }) {
  const profile = settings?.farmProfile || {};
  const td      = tenantDefaults        || {};

  // Helper: prefer explicitly saved farmProfile value, fall back to tenant record
  const prefill = (profileVal, tenantVal) => profileVal || tenantVal || '';

  // Profile form state — pre-populated from tenant record when farmProfile not yet saved
  const [form, setForm] = useState({
    name:               prefill(profile.name,               td.farmName),
    location:           prefill(profile.location,           td.address),
    contactEmail:       prefill(profile.contactEmail,       td.email),
    contactPhone:       prefill(profile.contactPhone,       td.phone),
    registrationNumber: profile.registrationNumber || '',
    description:        profile.description        || '',
  });
  const [profileChanged, setProfileChanged] = useState(false);
  const upForm = (k, v) => { setForm(p => ({ ...p, [k]: v })); setProfileChanged(true); };

  // Keep form in sync when settings/tenantDefaults first load
  useEffect(() => {
    setForm({
      name:               prefill(profile.name,               td.farmName),
      location:           prefill(profile.location,           td.address),
      contactEmail:       prefill(profile.contactEmail,       td.email),
      contactPhone:       prefill(profile.contactPhone,       td.phone),
      registrationNumber: profile.registrationNumber || '',
      description:        profile.description        || '',
    });
    setProfileChanged(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.farmProfile, tenantDefaults]);

  // Operation mode state
  const currentMode      = settings?.operationMode    || 'LAYER_ONLY';
  const hasFeedMill      = !!settings?.hasFeedMillModule;
  const hasProcessing    = !!settings?.hasProcessingModule;

  const [pendingMode,    setPendingMode]    = useState(currentMode);
  const [pendingFeed,    setPendingFeed]    = useState(hasFeedMill);
  const [pendingProcess, setPendingProcess] = useState(hasProcessing);
  const [confirming,     setConfirming]     = useState(false);

  // Sync op-mode local state when settings load
  useEffect(() => {
    setPendingMode(settings?.operationMode    || 'LAYER_ONLY');
    setPendingFeed(!!settings?.hasFeedMillModule);
    setPendingProcess(!!settings?.hasProcessingModule);
    setConfirming(false);
  }, [settings?.operationMode, settings?.hasFeedMillModule, settings?.hasProcessingModule]);

  const opDirty = pendingMode !== currentMode || pendingFeed !== hasFeedMill || pendingProcess !== hasProcessing;

  const handleSaveMode = async () => {
    if (pendingMode !== currentMode && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    await save({
      operationMode:       pendingMode,
      hasFeedMillModule:   pendingFeed,
      hasProcessingModule: pendingProcess,
    });
  };

  return (
    <div>
      {!canEdit && (
        <div style={{
          marginBottom: 20, padding: '10px 16px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border-card)',
          borderRadius: 8, fontSize: 12, color: 'var(--text-muted)',
        }}>
          ℹ Viewing in read-only mode. Contact your Farm Admin to make changes.
        </div>
      )}

      {/* ── Farm Operations ─────────────────────────────────────────────────── */}
      <SectionBlock
        title="🏭 Farm Operations"
        description="Defines which production modules are active. Changes take effect immediately for all users. Restricted to Farm Admin and above."
      >
        {/* Mode radio selector */}
        <div style={{ paddingTop: 4, paddingBottom: 4 }}>
          {MODE_OPTIONS.map((opt, idx) => {
            const selected    = pendingMode === opt.value;
            const isOpAdmin   = canEdit; // further gate enforced below via disabled
            return (
              <div
                key={opt.value}
                onClick={() => { if (canEdit) { setPendingMode(opt.value); setConfirming(false); } }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  padding: '14px 0',
                  borderBottom: idx < MODE_OPTIONS.length - 1 ? '1px solid var(--border-card)' : 'none',
                  cursor: canEdit ? 'pointer' : 'default',
                  opacity: canEdit ? 1 : 0.65,
                }}
              >
                {/* Radio dot */}
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  border: `2px solid ${selected ? 'var(--purple)' : '#d1d5db'}`,
                  background: selected ? 'var(--purple)' : '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}>
                  {selected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                </div>
                {/* Content */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 9, flexShrink: 0,
                    background: selected ? 'var(--purple-light)' : 'var(--bg-elevated)',
                    border: `1px solid ${selected ? '#d4d8ff' : 'var(--border-card)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, transition: 'all 0.15s',
                  }}>{opt.icon}</div>
                  <div>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: selected ? 'var(--purple)' : 'var(--text-primary)',
                      marginBottom: 2, transition: 'color 0.15s',
                    }}>{opt.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{opt.description}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add-on module cards — two-column grid */}
        {(() => {
          const processDisabled = !canEdit || pendingMode === 'LAYER_ONLY';

          const modules = [
            {
              icon: '🌾',
              title: 'Feed Mill Module',
              description: 'Raw material management, production runs, QC testing and feed release workflows.',
              checked: pendingFeed,
              disabled: !canEdit,
              onToggle: () => { if (canEdit) setPendingFeed(p => !p); },
            },
            {
              icon: '🏭',
              title: 'Processing Plant Module',
              description: pendingMode === 'LAYER_ONLY'
                ? 'Requires Broiler Only or Layer + Broiler mode.'
                : 'Harvest intake, dressing, cold storage and dispatch for broiler operations.',
              checked: pendingProcess,
              disabled: processDisabled,
              onToggle: () => { if (!processDisabled) setPendingProcess(p => !p); },
            },
          ];

          return (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12, padding: '16px 0 4px',
              borderTop: '1px solid var(--border-card)',
            }}>
              {/* Active module cards */}
              {modules.map(mod => (
                <div
                  key={mod.title}
                  onClick={mod.onToggle}
                  style={{
                    background: mod.checked && !mod.disabled ? 'var(--purple-light)' : 'var(--bg-elevated)',
                    border: `1px solid ${mod.checked && !mod.disabled ? '#d4d8ff' : 'var(--border-card)'}`,
                    borderRadius: 10, padding: '14px 16px',
                    cursor: mod.disabled ? 'default' : 'pointer',
                    opacity: mod.disabled ? 0.55 : 1,
                    transition: 'all 0.15s',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}
                  onMouseEnter={e => { if (!mod.disabled) e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.07)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
                >
                  {/* Top row: icon + title */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{mod.icon}</span>
                    <span style={{
                      fontSize: 13, fontWeight: 700,
                      color: mod.checked && !mod.disabled ? 'var(--purple)' : 'var(--text-primary)',
                      flex: 1,
                    }}>{mod.title}</span>
                  </div>

                  {/* Description */}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>
                    {mod.description}
                  </div>

                  {/* Bottom row: toggle flush right */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div
                      style={{
                        width: 40, height: 22, borderRadius: 99,
                        background: mod.checked && !mod.disabled ? 'var(--purple)' : '#d1d5db',
                        position: 'relative', flexShrink: 0,
                        transition: 'background 0.2s',
                        cursor: mod.disabled ? 'default' : 'pointer',
                      }}
                      onClick={e => { e.stopPropagation(); mod.onToggle(); }}
                    >
                      <div style={{
                        position: 'absolute', top: 2,
                        left: mod.checked && !mod.disabled ? 20 : 2,
                        width: 18, height: 18, borderRadius: '50%',
                        background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                        transition: 'left 0.2s',
                      }} />
                    </div>
                  </div>
                </div>
              ))}

              {/* Reserved placeholder slots — invisible until a future module fills them */}
              {[1, 2].map(n => (
                <div key={`placeholder-${n}`} style={{ borderRadius: 10, minHeight: 110 }} />
              ))}
            </div>
          );
        })()}

        {/* Confirmation warning */}
        {confirming && pendingMode !== currentMode && (
          <div style={{
            margin: '12px 0 4px', padding: '12px 16px',
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 9, fontSize: 12, color: '#78350f', lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>⚠ Confirm operation mode change</div>
            Switching from <strong>{MODE_OPTIONS.find(o => o.value === currentMode)?.title}</strong> to <strong>{MODE_OPTIONS.find(o => o.value === pendingMode)?.title}</strong>.
            Nav items and dashboards update immediately for all users. Existing records are not affected.
          </div>
        )}

        {/* Save row */}
        {canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0 6px' }}>
            <button
              onClick={handleSaveMode}
              disabled={saving || !opDirty}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: saving || !opDirty ? '#94a3b8' : confirming ? '#b45309' : 'var(--purple)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: saving || !opDirty ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {saving ? 'Saving…' : confirming ? 'Confirm Change' : 'Save Operations'}
            </button>
            {confirming && (
              <button
                onClick={() => setConfirming(false)}
                style={{
                  padding: '8px 16px', borderRadius: 8,
                  border: '1px solid var(--border)', background: '#fff',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
            {!opDirty && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No changes</span>}
          </div>
        )}
      </SectionBlock>

      {/* ── Farm Details ─────────────────────────────────────────────────────── */}
      <SectionBlock title="🏡 Farm Details" description="Used in reports, PDF exports and other shared documents.">
        {[
          { key: 'name',               label: 'Farm Name',           hint: 'Used in reports and PDF exports',   placeholder: 'e.g. GreenAcres Farms'   },
          { key: 'location',           label: 'Location',            hint: 'Town, state or full address',       placeholder: 'e.g. Ibadan, Oyo State'  },
          { key: 'contactEmail',       label: 'Contact Email',       hint: 'Primary contact for the farm',      placeholder: 'info@yourfarm.ng'        },
          { key: 'contactPhone',       label: 'Contact Phone',       hint: '',                                  placeholder: '+234 801 234 5678'        },
          { key: 'registrationNumber', label: 'Registration Number', hint: 'CAC or regulatory licence number',  placeholder: 'CAC/IT/000000'            },
        ].map(({ key, label, hint, placeholder }) => (
          <SettingRow key={key} label={label} hint={hint}>
            <input
              className="input" value={form[key]}
              onChange={e => upForm(key, e.target.value)}
              placeholder={placeholder}
              disabled={!canEdit}
              style={{ maxWidth: 360 }}
            />
          </SettingRow>
        ))}

        <SettingRow label="Description" hint="Brief description for reports">
          <textarea
            className="input" rows={3} value={form.description}
            onChange={e => upForm('description', e.target.value)}
            placeholder="A brief description of your farm operations…"
            disabled={!canEdit}
            style={{ resize: 'vertical', maxWidth: 420 }}
          />
        </SettingRow>

        {canEdit && (
          <div style={{ padding: '14px 0 6px' }}>
            <button
              onClick={() => { save({ farmProfile: form }); setProfileChanged(false); }}
              disabled={saving || !profileChanged}
              style={{
                padding: '8px 20px', borderRadius: 8, border: 'none',
                background: saving || !profileChanged ? '#94a3b8' : 'var(--purple)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: saving || !profileChanged ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save Farm Details'}
            </button>
          </div>
        )}
      </SectionBlock>
    </div>
  );
}

// ── Tab: Notifications (SMS) ──────────────────────────────────────────────────
function NotificationsTab({ sms, canEdit, set, save, saving }) {
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
    <div>
      <SectionBlock title="📱 SMS Alerts" description="Send SMS notifications to farm staff when critical events occur. Requires TERMII_API_KEY in your server environment.">
        <Toggle
          checked={!!sms.enabled}
          onChange={() => canEdit && set('sms.enabled', !sms.enabled)}
          label="Enable SMS Alerts"
          sub={sms.enabled ? 'Active — messages will be sent when alerts trigger' : 'Disabled — no SMS messages will be sent'}
          disabled={!canEdit}
        />
        <Toggle
          checked={!!sms.mortalityAlert?.enabled}
          onChange={() => canEdit && set('sms.mortalityAlert.enabled', !sms.mortalityAlert?.enabled)}
          label="🐔 High Mortality Alert"
          sub="Notifies Farm Manager + Pen Manager when death count exceeds threshold"
          disabled={!canEdit || !sms.enabled}
        />
        {sms.mortalityAlert?.enabled && sms.enabled && (
          <div style={{ paddingBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Alert threshold (birds/day)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="number" min="1" max="500" className="input"
                style={{ width: 90, padding: '6px 10px' }}
                defaultValue={sms.mortalityAlert?.threshold ?? 10}
                disabled={!canEdit}
                onBlur={e => canEdit && set('sms.mortalityAlert.threshold', Number(e.target.value) || 10)}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>deaths/day triggers the alert</span>
            </div>
          </div>
        )}
        <Toggle
          checked={!!sms.lowFeedAlert?.enabled}
          onChange={() => canEdit && set('sms.lowFeedAlert.enabled', !sms.lowFeedAlert?.enabled)}
          label="🌾 Low Feed Stock Alert"
          sub="Notifies Store Manager + Farm Manager when stock drops below reorder level"
          disabled={!canEdit || !sms.enabled}
        />
        <Toggle
          checked={!!sms.rejectionAlert?.enabled}
          onChange={() => canEdit && set('sms.rejectionAlert.enabled', !sms.rejectionAlert?.enabled)}
          label="↩️ Record Rejection Alert"
          sub="Notifies the worker via SMS when their submission is rejected"
          disabled={!canEdit || !sms.enabled}
        />
      </SectionBlock>

      <SectionBlock title="📞 Additional Alert Numbers" description="Broadcast SMS alerts to extra phone numbers beyond those on staff accounts.">
        <div style={{ padding: '12px 0' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(sms.alertPhones || []).length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No extra numbers added yet.</div>
            )}
            {(sms.alertPhones || []).map((p, i) => (
              <PhoneTag key={i} phone={p.phone} label={p.label} onRemove={canEdit ? () => removePhone(i) : null} />
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
                  value={newPhone.phone}
                  onChange={e => setNewPhone(p => ({ ...p, phone: e.target.value }))}
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
        </div>
      </SectionBlock>

      <SectionBlock title="🔑 Termii API Configuration" description="Configure Termii API key in your server environment to enable SMS delivery.">
        <div style={{ padding: '12px 0', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#d1d5db', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Status unknown (server-side env var)</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
            Add <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>TERMII_API_KEY=your_key</code> to your{' '}
            <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>.env.local</code> file and restart.{' '}
            <a href="https://app.termii.com" target="_blank" rel="noreferrer" style={{ color: 'var(--purple)' }}>Get key →</a>
          </div>
        </div>
      </SectionBlock>
    </div>
  );
}

// ── Tab: Email Alerts ─────────────────────────────────────────────────────────
function EmailAlertsTab({ email, canEdit, set, save, saving }) {
  return (
    <div>
      <SectionBlock title="📧 Email Alerts" description="Send email notifications to farm staff when critical events occur. Uses SMTP credentials configured in your server environment.">
        <Toggle
          checked={!!email.enabled}
          onChange={() => canEdit && set('email.enabled', !email.enabled)}
          label="Enable Email Alerts"
          sub={email.enabled ? 'Active — emails will be sent when alerts trigger' : 'Disabled — no alert emails will be sent'}
          disabled={!canEdit}
        />
        <Toggle
          checked={!!email.mortalitySpike?.enabled}
          onChange={() => canEdit && set('email.mortalitySpike.enabled', !email.mortalitySpike?.enabled)}
          label="💀 Mortality Spike Alert"
          sub="Sent to Farm Manager and above when a mortality spike is detected"
          disabled={!canEdit || !email.enabled}
        />
        <Toggle
          checked={!!email.lowFeedAlert?.enabled}
          onChange={() => canEdit && set('email.lowFeedAlert.enabled', !email.lowFeedAlert?.enabled)}
          label="🌾 Low Feed Stock Alert"
          sub="Sent to Store Manager and Farm Manager when feed stock crosses below reorder level"
          disabled={!canEdit || !email.enabled}
        />
        {email.lowFeedAlert?.enabled && email.enabled && (
          <div style={{ paddingBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Alert when days remaining drops below</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="number" min="1" max="90" className="input"
                style={{ width: 90, padding: '6px 10px' }}
                defaultValue={email.lowFeedAlert?.daysRemainingThreshold ?? 14}
                disabled={!canEdit}
                onBlur={e => canEdit && set('email.lowFeedAlert.daysRemainingThreshold', Number(e.target.value) || 14)}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days of feed remaining</span>
            </div>
          </div>
        )}
        <Toggle
          checked={!!email.overdueVaccination?.enabled}
          onChange={() => canEdit && set('email.overdueVaccination.enabled', !email.overdueVaccination?.enabled)}
          label="💉 Overdue Vaccination Alert"
          sub="Sent to Farm Manager and Pen Manager when a scheduled vaccination is overdue"
          disabled={!canEdit || !email.enabled}
        />
        <Toggle
          checked={!!email.verificationRejected?.enabled}
          onChange={() => canEdit && set('email.verificationRejected.enabled', !email.verificationRejected?.enabled)}
          label="↩️ Verification Rejection Alert"
          sub="Sent to the submitting worker when their record is rejected for resubmission"
          disabled={!canEdit || !email.enabled}
        />
      </SectionBlock>

      <SectionBlock title="📬 SMTP Configuration" description="Set these environment variables to configure your SMTP server.">
        <div style={{ padding: '12px 0' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)' }}>
                  {['Variable', 'Example', 'Description'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em', borderBottom: '1px solid var(--border-card)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['SMTP_HOST',  'smtp.gmail.com',                          'SMTP server hostname'],
                  ['SMTP_PORT',  '587',                                     'Port (587 for TLS, 465 for SSL)'],
                  ['SMTP_USER',  'you@yourdomain.com',                      'SMTP login username'],
                  ['SMTP_PASS',  'app-password',                            'SMTP password or app password'],
                  ['EMAIL_FROM', '"PoultryFarm Pro" <noreply@yourfarm.com>', 'Sender name and address'],
                ].map(([variable, example, desc]) => (
                  <tr key={variable} style={{ borderBottom: '1px solid var(--border-card)' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <code style={{ fontFamily: 'monospace', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{variable}</code>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 11 }}>{example}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12, color: '#1e40af' }}>
            💡 <strong>Gmail users:</strong> Use an App Password (not your regular password). Enable 2FA, then go to Google Account → Security → App Passwords.
          </div>
        </div>
      </SectionBlock>
    </div>
  );
}

// ── Tab: Security ─────────────────────────────────────────────────────────────
function SecurityTab() {
  const rows = [
    { label: 'Minimum Password Length',    hint: 'Minimum characters required for all passwords',  badge: 'Coming Soon', type: 'select', options: ['8 characters', '12 characters'] },
    { label: 'Require Special Characters', hint: 'Symbols, numbers and mixed case required',        badge: 'Coming Soon', type: 'toggle' },
    { label: 'Password Expiry',            hint: 'Force password reset after N days (0 = never)',   badge: 'Coming Soon', type: 'number', placeholder: '90' },
    { label: 'Session Timeout',            hint: 'Auto-logout after period of inactivity',          badge: 'Coming Soon', type: 'select', options: ['8 hours', '24 hours', '7 days'] },
    { label: 'Two-Factor Authentication',  hint: 'Require 2FA for admin roles',                     badge: 'Coming Soon', type: 'toggle' },
    { label: 'Audit Log Retention',        hint: 'How long to keep action logs',                    badge: 'Coming Soon', type: 'select', options: ['90 days', '180 days', '1 year'] },
  ];

  const Row = ({ row }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid var(--border-card)' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          {row.label}<PlaceholderBadge text={row.badge} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{row.hint}</div>
      </div>
      {row.type === 'toggle' && (
        <div style={{ width: 44, height: 24, borderRadius: 99, background: '#d1d5db', position: 'relative', cursor: 'not-allowed', opacity: 0.5 }}>
          <div style={{ position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
        </div>
      )}
      {row.type === 'select' && (
        <select className="input" disabled style={{ maxWidth: 160, opacity: 0.5 }}>
          {row.options.map(o => <option key={o}>{o}</option>)}
        </select>
      )}
      {row.type === 'number' && (
        <input className="input" type="number" placeholder={row.placeholder} disabled style={{ maxWidth: 100, opacity: 0.5 }} />
      )}
    </div>
  );

  return (
    <div>
      <SectionBlock title="🔒 Password Policy" description="Enforce password strength and rotation rules for all staff accounts.">
        {rows.slice(0, 3).map(r => <Row key={r.label} row={r} />)}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', borderRadius: 8, padding: '10px 14px', marginTop: 8, background: 'var(--bg-elevated)' }}>
          💡 Password policies will be enforced on next login or password reset.
        </div>
      </SectionBlock>
      <SectionBlock title="🛡️ Session & Access" description="Control how long sessions last and restrict access settings.">
        {rows.slice(3).map(r => <Row key={r.label} row={r} />)}
        <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#78350f', marginTop: 8 }}>
          ⚠ These features are in development. Audit logs are currently stored indefinitely.
        </div>
      </SectionBlock>
    </div>
  );
}

// ── Tab: Access Logs ──────────────────────────────────────────────────────────
function AccessLogsTab({ apiFetch }) {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res  = await apiFetch('/api/audit?limit=50');
        const data = await res.json();
        setLogs(data.logs || []);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [apiFetch]);

  const fmtDate = (d) => new Date(d).toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const actionColor = (a) => {
    if (a === 'CREATE')          return '#16a34a';
    if (a === 'UPDATE' || a === 'ROLE_CHANGE') return '#d97706';
    if (a === 'DELETE')          return '#dc2626';
    if (a === 'PASSWORD_CHANGE') return '#9333ea';
    return '#6c63ff';
  };

  return (
    <div>
      <SectionBlock title="📋 Recent Audit Log" description="System-wide actions performed by all users in the past 50 events.">
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading logs…</div>
          ) : logs.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No audit logs found.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)' }}>
                  {['Time', 'Action', 'Entity', 'User', 'Details'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-card)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={log.id || i} style={{ borderBottom: '1px solid var(--border-card)' }}>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(log.createdAt)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: `${actionColor(log.action)}15`, color: actionColor(log.action) }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{log.entityType}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                      {log.user ? `${log.user.firstName} ${log.user.lastName}` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.changes ? JSON.stringify(log.changes).slice(0, 80) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SectionBlock>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user, apiFetch } = useAuth();

  const [settings,       setSettings]       = useState(null);
  const [tenantDefaults, setTenantDefaults] = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [saving,         setSaving]         = useState(false);
  const [toast,          setToast]          = useState(null);
  const [activeTab,      setActiveTab]      = useState('overview');

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
        setTenantDefaults(d.tenantDefaults || null);
      }
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const save = async (patch) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) });
      const d   = await res.json();
      if (!res.ok) { showToast(d.error || 'Failed to save', 'error'); return; }
      setSettings(d.settings);
      showToast('Settings saved');
    } finally { setSaving(false); }
  };

  // Dot-path setter for toggle-style saves (sms.enabled, email.lowFeedAlert.enabled, etc.)
  const set = (path, value) => {
    const keys  = path.split('.');
    const patch = {};
    let cur = patch;
    for (let i = 0; i < keys.length - 1; i++) { cur[keys[i]] = {}; cur = cur[keys[i]]; }
    cur[keys[keys.length - 1]] = value;
    save(patch);
  };

  const sms   = settings?.sms   || {};
  const email = settings?.email || {};

  return (
    <AppShell>
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }`}</style>
      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div style={{ animation: 'fadeIn 0.2s ease' }}>
        {/* Page header */}
        <div style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 24 }}>⚙️</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif", margin: 0 }}>
              Settings
            </h1>
          </div>
          {!canEdit && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              ℹ Viewing in read-only mode. Contact your Farm Admin to make changes.
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 28, marginTop: 16,
          overflowX: 'auto', background: '#fff',
          borderRadius: '10px 10px 0 0', padding: '0 4px',
          border: '1px solid var(--border-card)',
        }}>
          {TABS.map(tab => {
            const active = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                padding: '14px 18px', fontSize: 13, fontWeight: active ? 700 : 600,
                color: active ? 'var(--purple)' : 'var(--text-secondary)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                borderBottom: active ? '2px solid var(--purple)' : '2px solid transparent',
                whiteSpace: 'nowrap', fontFamily: 'inherit', transition: 'all 0.15s',
                marginBottom: -1,
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ height: 100, background: 'var(--bg-elevated)', borderRadius: 12, animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
          </div>
        ) : (
          <>
            {activeTab === 'overview'      && <OverviewTab      settings={settings} setActiveTab={setActiveTab} />}
            {activeTab === 'notifications' && <NotificationsTab sms={sms}           canEdit={canEdit} set={set} save={save} saving={saving} />}
            {activeTab === 'email'         && <EmailAlertsTab   email={email}        canEdit={canEdit} set={set} save={save} saving={saving} />}
            {activeTab === 'farm'          && <FarmProfileTab   settings={settings} tenantDefaults={tenantDefaults} canEdit={canEdit} save={save} saving={saving} />}
            {activeTab === 'security'      && <SecurityTab />}
            {activeTab === 'access'        && <AccessLogsTab    apiFetch={apiFetch} />}
          </>
        )}
      </div>
    </AppShell>
  );
}
