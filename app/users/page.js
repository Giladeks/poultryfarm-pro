'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';
import Modal from '@/components/ui/Modal';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'CHAIRPERSON',       label: 'Chairperson',       group: 'Leadership',  color: '#6c63ff' },
  { value: 'FARM_ADMIN',        label: 'Farm Admin',        group: 'Leadership',  color: '#6c63ff' },
  { value: 'FARM_MANAGER',      label: 'Farm Manager',      group: 'Management',  color: '#3b82f6' },
  { value: 'STORE_MANAGER',     label: 'Store Manager',     group: 'Management',  color: '#3b82f6' },
  { value: 'FEED_MILL_MANAGER', label: 'Feed Mill Manager', group: 'Management',  color: '#3b82f6' },
  { value: 'PEN_MANAGER',       label: 'Pen Manager',       group: 'Supervisors', color: '#f59e0b' },
  { value: 'STORE_CLERK',       label: 'Store Clerk',       group: 'Staff',       color: '#22c55e' },
  { value: 'QC_TECHNICIAN',     label: 'QC Technician',     group: 'Staff',       color: '#22c55e' },
  { value: 'PRODUCTION_STAFF',  label: 'Production Staff',  group: 'Staff',       color: '#22c55e' },
  { value: 'PEN_WORKER',        label: 'Pen Worker',        group: 'Field',       color: '#9ca3af' },
  { value: 'INTERNAL_CONTROL',  label: 'Internal Control',  group: 'Finance',     color: '#0891b2' },
  { value: 'ACCOUNTANT',        label: 'Accountant',        group: 'Finance',     color: '#059669' },
];

const CREATABLE_ROLES = ROLES
  .filter(r => !['CHAIRPERSON', 'FARM_ADMIN', 'SUPER_ADMIN'].includes(r.value))
  .sort((a, b) => a.label.localeCompare(b.label));

const ROLE_MAP = Object.fromEntries(ROLES.map(r => [r.value, r]));

const PERMISSIONS = {
  CHAIRPERSON:       { label: 'Full access — approves high-value transactions, final escalation point' },
  FARM_ADMIN:        { label: 'Manages users, farms, system configuration' },
  FARM_MANAGER:      { label: 'Oversees all farm operations, approves reports' },
  STORE_MANAGER:     { label: 'Manages inventory, GRNs, stock reconciliation' },
  FEED_MILL_MANAGER: { label: 'Manages feed mill production, QC sign-off' },
  PEN_MANAGER:       { label: 'Manages workers, approves daily pen reports' },
  STORE_CLERK:       { label: 'Records receipts and issuances, stock counts' },
  QC_TECHNICIAN:     { label: 'Performs quality tests, certifies batches' },
  PRODUCTION_STAFF:  { label: 'Operates feed mill equipment, logs production' },
  PEN_WORKER:        { label: 'Records mortality, feed, eggs, weight daily' },
  INTERNAL_CONTROL:  { label: 'Audit and compliance — read-only access to all modules' },
  ACCOUNTANT:        { label: 'Finance access — invoices, payments, P&L, reconciliation' },
};

function roleColor(role) { return ROLE_MAP[role]?.color || '#9ca3af'; }
function roleLabel(role) { return ROLE_MAP[role]?.label || role; }

// ── Small shared components ───────────────────────────────────────────────────

function Avatar({ user, size = 36 }) {
  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  const color    = roleColor(user.role);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${color}18`, border: `2px solid ${color}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 800, color, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

function RoleBadge({ role }) {
  const color = roleColor(role);
  return (
    <span style={{
      background: `${color}12`, color, border: `1px solid ${color}30`,
      borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {roleLabel(role)}
    </span>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: `${color}15`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 20, flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div className="kpi-value" style={{ fontSize: 22 }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginTop: 1 }}>{label}</div>
      </div>
    </div>
  );
}

// ── Create / Edit User Modal (portal) ────────────────────────────────────────

function UserModal({ mode, editUser, farms, penSections, onClose, onSave, apiFetch }) {
  const blank = {
    firstName: '', lastName: '', email: '', phone: '',
    role: 'PEN_WORKER', farmId: '', password: '', penSectionIds: [],
  };

  const [form, setForm] = useState(mode === 'edit' ? {
    firstName:     editUser.firstName,
    lastName:      editUser.lastName,
    email:         editUser.email,
    phone:         editUser.phone || '',
    role:          editUser.role,
    farmId:        editUser.farmId || '',
    password:      '',
    penSectionIds: editUser.penAssignments?.map(a => a.penSection.id) || [],
  } : blank);

  const [saving,        setSaving]        = useState(false);
  const [error,         setError]         = useState('');
  const [showPwChange,  setShowPwChange]  = useState(false);
  const [newPassword,   setNewPassword]   = useState('');
  const [confirmPw,     setConfirmPw]     = useState('');

  const up = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleSection = (id) => {
    setForm(f => ({
      ...f,
      penSectionIds: f.penSectionIds.includes(id)
        ? f.penSectionIds.filter(s => s !== id)
        : [...f.penSectionIds, id],
    }));
  };

  const isPenWorker = form.role === 'PEN_WORKER' || form.role === 'PEN_MANAGER';

  const sectionsByPen = penSections.reduce((acc, s) => {
    const penName = `${s.pen.name} (${s.pen.operationType})`;
    if (!acc[penName]) acc[penName] = [];
    acc[penName].push(s);
    return acc;
  }, {});

  async function handleSubmit() {
    setError('');
    if (!form.firstName || !form.lastName || !form.email || !form.role)
      return setError('First name, last name, email and role are required.');
    if (mode === 'create' && form.password.length < 8)
      return setError('Password must be at least 8 characters.');
    if (mode === 'edit' && showPwChange) {
      if (newPassword.length < 8) return setError('New password must be at least 8 characters.');
      if (newPassword !== confirmPw) return setError('Passwords do not match.');
    }

    setSaving(true);
    try {
      const payload = mode === 'create'
        ? { ...form, farmId: form.farmId || null }
        : { userId: editUser.id, role: form.role, farmId: form.farmId || null, firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone || null,
            penSectionIds: form.penSectionIds,
            ...(form.isActive !== undefined && { isActive: form.isActive }),
            ...(showPwChange && newPassword && { newPassword }) };

      const res = await apiFetch('/api/users', {
        method: mode === 'create' ? 'POST' : 'PATCH',
        body:   JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || 'Failed to save');
      onSave();
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={mode === 'create' ? '➕ Add Staff Member' : '✏️ Edit Staff Member'}
      subtitle={mode === 'create' ? 'Create a new account for your team' : `Editing ${editUser?.firstName} ${editUser?.lastName}`}
      width={560}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : mode === 'create' ? 'Create Account' : 'Save Changes'}
          </button>
        </>
      }
    >
      {error && <div className="alert alert-red" style={{ marginBottom: 16 }}>⚠ {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Name */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">First Name *</label>
            <input className="input" value={form.firstName} onChange={e => up('firstName', e.target.value)} placeholder="Amina" />
          </div>
          <div>
            <label className="label">Last Name *</label>
            <input className="input" value={form.lastName} onChange={e => up('lastName', e.target.value)} placeholder="Bello" />
          </div>
        </div>

        {/* Email + Phone */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="label">Email Address *</label>
            <input className="input" type="email" value={form.email} onChange={e => up('email', e.target.value)} placeholder="amina@greenacres.ng" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={e => up('phone', e.target.value)} placeholder="+234 801 234 5678" />
          </div>
        </div>

        {/* Role */}
        <div>
          <label className="label">Role *</label>
          <select className="input" value={form.role} onChange={e => up('role', e.target.value)}>
            {CREATABLE_ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          {form.role && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', paddingLeft: 4 }}>
              ℹ {PERMISSIONS[form.role]?.label}
            </div>
          )}
        </div>

        {/* Farm assignment */}
        {farms.length > 0 && (
          <div>
            <label className="label">Farm Assignment</label>
            <select className="input" value={form.farmId} onChange={e => up('farmId', e.target.value)}>
              <option value="">— No specific farm (org-wide) —</option>
              {farms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        {/* Pen section assignments — only for field roles */}
        {isPenWorker && penSections.length > 0 && (
          <div>
            <label className="label">Pen Section Assignments</label>
            <div style={{
              border: '1.5px solid var(--border)', borderRadius: 8,
              maxHeight: 180, overflowY: 'auto', padding: 10,
            }}>
              {Object.entries(sectionsByPen).map(([penName, sections]) => (
                <div key={penName} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                    {penName}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {sections.map(s => {
                      const selected = form.penSectionIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleSection(s.id)}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                            cursor: 'pointer', border: '1.5px solid',
                            background:   selected ? 'var(--purple-light)' : '#fff',
                            color:        selected ? 'var(--purple)' : 'var(--text-secondary)',
                            borderColor:  selected ? 'var(--purple)' : 'var(--border)',
                            transition:   'all 0.15s',
                          }}
                        >
                          {selected ? '✓ ' : ''}{s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {form.penSectionIds.length} section{form.penSectionIds.length !== 1 ? 's' : ''} selected
            </div>
          </div>
        )}

        {/* Password — required on create, optional change on edit */}
        {mode === 'create' && (
          <div>
            <label className="label">Password *</label>
            <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={e => up('password', e.target.value)} placeholder="Min. 8 characters" />
          </div>
        )}
        {mode === 'edit' && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => { setShowPwChange(v => !v); setNewPassword(''); setConfirmPw(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: showPwChange ? 'var(--red)' : 'var(--purple)', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {showPwChange ? '✕ Cancel password change' : '🔑 Change password'}
            </button>
            {showPwChange && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <label className="label">New Password *</label>
                  <input className="input" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min. 8 characters" />
                </div>
                <div>
                  <label className="label">Confirm Password *</label>
                  <input className="input" type="password" autoComplete="new-password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Repeat new password" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Deactivate / Reactivate confirm modal (portal) ────────────────────────────

function ConfirmModal({ user: target, saving, onClose, onConfirm }) {
  const action = target.isActive ? 'Deactivate' : 'Reactivate';
  return (
    <Modal
      width={400}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button
            className={`btn ${target.isActive ? 'btn-danger' : 'btn-primary'}`}
            style={{ flex: 1 }}
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? '…' : action}
          </button>
        </>
      }
    >
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{target.isActive ? '🔒' : '🔓'}</div>
        <h3 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
          {action} {target.firstName}?
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {target.isActive
            ? `${target.firstName} ${target.lastName} will lose access immediately. Their records will be preserved.`
            : `${target.firstName} ${target.lastName} will regain full access to their account.`}
        </p>
      </div>
    </Modal>
  );
}

// ── User detail slide-out panel (unchanged — uses its own fixed-position rendering) ──

function UserPanel({ user: u, onEdit, onToggle, onClose }) {
  const daysSinceLogin = u.lastLoginAt
    ? Math.floor((Date.now() - new Date(u.lastLoginAt)) / 86400000)
    : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 150, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,46,0.3)', backdropFilter: 'blur(1px)' }} />
      <div style={{
        position: 'relative', width: 380, background: 'var(--bg-surface)',
        height: '100%', overflowY: 'auto', boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
        animation: 'slideIn 0.2s ease',
      }}>
        <style>{`@keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>

        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Staff Profile</span>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: '4px 8px' }}>✕</button>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <Avatar user={u} size={56} />
            <div>
              <div style={{ fontFamily: "'Poppins',sans-serif", fontSize: 17, fontWeight: 700 }}>
                {u.firstName} {u.lastName}
              </div>
              <RoleBadge role={u.role} />
              <div style={{ marginTop: 4 }}>
                <span className={`status-badge ${u.isActive ? 'status-green' : 'status-grey'}`}>
                  {u.isActive ? '● Active' : '● Inactive'}
                </span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16, padding: 16 }}>
            <div className="section-header">Contact</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ fontSize: 16 }}>✉</span>
                <span style={{ color: 'var(--text-secondary)' }}>{u.email}</span>
              </div>
              {u.phone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ fontSize: 16 }}>📞</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{u.phone}</span>
                </div>
              )}
              {u.farm && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                  <span style={{ fontSize: 16 }}>🏡</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{u.farm.name}</span>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16, padding: 16 }}>
            <div className="section-header">Activity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Last login</span>
                <span style={{ fontWeight: 600 }}>
                  {daysSinceLogin === null ? 'Never' :
                   daysSinceLogin === 0    ? 'Today' :
                   daysSinceLogin === 1    ? 'Yesterday' :
                   `${daysSinceLogin}d ago`}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Tasks assigned</span>
                <span style={{ fontWeight: 600 }}>{u._count?.tasksAssigned || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Joined</span>
                <span style={{ fontWeight: 600 }}>{new Date(u.createdAt).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' })}</span>
              </div>
            </div>
          </div>

          {u.penAssignments?.length > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: 16 }}>
              <div className="section-header">Pen Assignments ({u.penAssignments.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {u.penAssignments.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 13 }}>
                    <span>{a.penSection.pen.operationType === 'LAYER' ? '🥚' : '🍗'}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.penSection.pen.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.penSection.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {u.staffProfile && (
            <div className="card" style={{ marginBottom: 16, padding: 16 }}>
              <div className="section-header">Employment</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Employee ID</span>
                  <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{u.staffProfile.employeeId}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Contract</span>
                  <span style={{ fontWeight: 600 }}>{u.staffProfile.contractType}</span>
                </div>
                {u.staffProfile.department && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Department</span>
                    <span style={{ fontWeight: 600 }}>{u.staffProfile.department}</span>
                  </div>
                )}
                {u.staffProfile.dateOfJoining && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Date joined</span>
                    <span style={{ fontWeight: 600 }}>{new Date(u.staffProfile.dateOfJoining).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' })}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 24, padding: 16, background: 'var(--purple-light)', border: '1px solid #d4d8ff' }}>
            <div className="section-header" style={{ color: 'var(--purple)' }}>Role Permissions</div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {PERMISSIONS[u.role]?.label || 'Standard access'}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }} onClick={onEdit}>
              ✏️ Edit Profile & Assignments
            </button>
            <button
              className={`btn ${u.isActive ? 'btn-danger' : 'btn-ghost'}`}
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={onToggle}
            >
              {u.isActive ? '🔒 Deactivate Account' : '🔓 Reactivate Account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { user: currentUser, apiFetch } = useAuth();
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filterRole,   setFilterRole]   = useState('');
  const [filterStatus, setFilterStatus] = useState('active');
  const [selectedUser, setSelectedUser] = useState(null);
  const [modal,        setModal]        = useState(null); // 'create' | 'edit' | 'confirm'
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState(null);

  const canManage = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'].includes(currentUser?.role);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ...(filterRole   && { role: filterRole }),
        ...(filterStatus !== 'all' && { status: filterStatus }),
        ...(search       && { search }),
      });
      const res = await apiFetch(`/api/users?${params}`);
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, [filterRole, filterStatus, search]);

  useEffect(() => { load(); }, [load]);

  async function handleToggleActive() {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/users', {
        method: 'PATCH',
        body:   JSON.stringify({ userId: selectedUser.id, isActive: !selectedUser.isActive }),
      });
      if (res.ok) {
        showToast(`${selectedUser.firstName} ${selectedUser.isActive ? 'deactivated' : 'reactivated'} successfully`);
        setModal(null);
        setSelectedUser(null);
        load();
      } else {
        const d = await res.json();
        showToast(d.error || 'Failed to update', 'error');
      }
    } finally { setSaving(false); }
  }

  const users       = data?.users        || [];
  const summary     = data?.summary      || {};
  const farms       = data?.farms        || [];
  const penSections = data?.penSections  || [];

  const displayed = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.firstName.toLowerCase().includes(q) || u.lastName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const grouped = ROLES.reduce((acc, r) => {
    const group = displayed.filter(u => u.role === r.value);
    if (group.length > 0) acc.push({ roleInfo: r, users: group });
    return acc;
  }, []);

  return (
    <AppShell>
      <div className="animate-in">

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 20, right: 24, zIndex: 999,
            padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: toast.type === 'error' ? 'var(--red-bg)' : 'var(--green-bg)',
            color:      toast.type === 'error' ? 'var(--red)'    : '#16a34a',
            border:     `1px solid ${toast.type === 'error' ? 'var(--red-border)' : 'var(--green-border)'}`,
            boxShadow:  'var(--shadow-md)', animation: 'fadeInUp 0.2s ease',
          }}>
            {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.msg}
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: "'Poppins',sans-serif", fontSize: 22, fontWeight: 700, margin: 0 }}>
              👥 User Administration
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3 }}>
              Manage system access, roles, and pen assignments
            </p>
          </div>
          {canManage && (
            <div style={{ flexShrink: 0 }}>
              <button className="btn btn-primary" onClick={() => setModal('create')}>
                + Add Staff Member
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <StatCard label="Total Staff"  value={summary.total    || 0} icon="👥" color="#6c63ff" />
          <StatCard label="Active"       value={summary.active   || 0} icon="✅" color="#22c55e" />
          <StatCard label="Inactive"     value={summary.inactive || 0} icon="🔒" color="#9ca3af" />
          <StatCard label="Roles in Use" value={Object.keys(summary.byRole || {}).length} icon="🎭" color="#f59e0b" />
        </div>

        {/* Filters */}
        <div className="card" style={{ marginBottom: 20, padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ maxWidth: 260, padding: '7px 12px' }}
              placeholder="🔍  Search by name or email…"
              autoComplete="off"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="input" style={{ maxWidth: 200 }} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
              <option value="">All Roles</option>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 6 }}>
              {['active','inactive','all'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)} className="btn" style={{
                  fontSize: 11, padding: '5px 12px', textTransform: 'capitalize',
                  background: filterStatus === s ? 'var(--purple)' : '#fff',
                  color:      filterStatus === s ? '#fff' : 'var(--text-muted)',
                  border:    `1px solid ${filterStatus === s ? 'var(--purple)' : 'var(--border)'}`,
                }}>
                  {s}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {displayed.length} staff member{displayed.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Loading staff…</div>
        ) : displayed.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
            <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>No staff members found</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {grouped.map(({ roleInfo, users: roleUsers }) => (
              <div key={roleInfo.value} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '10px 16px', background: `${roleInfo.color}08`, borderBottom: `2px solid ${roleInfo.color}20`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: roleInfo.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: roleInfo.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{roleInfo.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>— {roleUsers.length} member{roleUsers.length !== 1 ? 's' : ''}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>{PERMISSIONS[roleInfo.value]?.label}</span>
                </div>
                <table className="table">
                  <tbody>
                    {roleUsers.map(u => {
                      const daysSince = u.lastLoginAt
                        ? Math.floor((Date.now() - new Date(u.lastLoginAt)) / 86400000)
                        : null;
                      return (
                        <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedUser(u)}>
                          <td style={{ width: 280 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <Avatar user={u} size={34} />
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                                  {u.firstName} {u.lastName}
                                  {u.id === currentUser?.id && (
                                    <span style={{ marginLeft: 6, fontSize: 9, background: 'var(--purple-light)', color: 'var(--purple)', border: '1px solid #d4d8ff', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>YOU</span>
                                  )}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{u.farm?.name || <span style={{ color: 'var(--text-faint)' }}>—</span>}</span></td>
                          <td>
                            {u.penAssignments?.length > 0 ? (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {u.penAssignments.slice(0, 2).map(a => (
                                  <span key={a.id} style={{ fontSize: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                    {a.penSection.pen.name} · {a.penSection.name}
                                  </span>
                                ))}
                                {u.penAssignments.length > 2 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{u.penAssignments.length - 2} more</span>}
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No assignment</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {daysSince === null ? 'Never logged in' :
                             daysSince === 0    ? '🟢 Today'        :
                             daysSince === 1    ? '🟡 Yesterday'    :
                             daysSince <= 7     ? `🟡 ${daysSince}d ago` :
                             `🔴 ${daysSince}d ago`}
                          </td>
                          <td><span className={`status-badge ${u.isActive ? 'status-green' : 'status-grey'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
                          <td style={{ width: 30, color: 'var(--text-faint)', fontSize: 16, textAlign: 'right' }}>›</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Portal modals ── */}
      {modal === 'create' && (
        <UserModal mode="create" farms={farms} penSections={penSections}
          apiFetch={apiFetch}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); setSearch(''); setFilterRole(''); load(); showToast('Staff member created successfully'); }}
        />
      )}
      {modal === 'edit' && selectedUser && (
        <UserModal mode="edit" editUser={selectedUser} farms={farms} penSections={penSections}
          apiFetch={apiFetch}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); setSelectedUser(null); load(); showToast('Profile updated successfully'); }}
        />
      )}
      {modal === 'confirm' && selectedUser && (
        <ConfirmModal user={selectedUser} saving={saving}
          onClose={() => setModal(null)}
          onConfirm={handleToggleActive}
        />
      )}

      {/* Side panel — no modal prop so only shows when no modal is open */}
      {selectedUser && !modal && (
        <UserPanel
          user={selectedUser}
          onEdit={() => setModal('edit')}
          onToggle={() => setModal('confirm')}
          onClose={() => setSelectedUser(null)}
        />
      )}
    </AppShell>
  );
}
