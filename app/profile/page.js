'use client';
export const dynamic = 'force-dynamic';
// app/profile/page.js — User profile: edit name, phone, avatar (S3)
// Email is read-only for self; only FARM_ADMIN / CHAIRPERSON / SUPER_ADMIN can change it.
import { useState, useRef, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

const ADMIN_ROLES = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const ADMIN_ONLY  = ADMIN_ROLES;

// ── Sub-components ─────────────────────────────────────────────────────────────
function Toast({ msg, type, onDone }) {
  if (!msg) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: type === 'error' ? '#991b1b' : '#166534',
      color: '#fff', padding: '12px 20px', borderRadius: 10,
      fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      animation: 'fadeInUp 0.2s ease', cursor: 'pointer',
    }} onClick={onDone}>
      {type === 'error' ? '✕ ' : '✓ '}{msg}
    </div>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, padding: '18px 0', borderBottom: '1px solid var(--border-card)', alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SectionHeader({ title, description }) {
  return (
    <div style={{ marginBottom: 0, paddingBottom: 14, borderBottom: '2px solid var(--border-card)' }}>
      <div style={{ fontFamily: "'Poppins',sans-serif", fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{title}</div>
      {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{description}</div>}
    </div>
  );
}

// ── Avatar upload area ─────────────────────────────────────────────────────────
function AvatarUploader({ currentUrl, initials, onUploaded, apiFetch }) {
  const inputRef    = useRef(null);
  const [preview,   setPreview]   = useState(currentUrl || null);
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState(null);
  const [dragOver,  setDragOver]  = useState(false);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Please select an image file (JPEG, PNG, WebP)');
    if (file.size > 5 * 1024 * 1024) return setError('Image must be under 5 MB');

    setError(null);
    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setUploading(true);

    try {
      // 1. Get pre-signed S3 upload URL
      const res = await apiFetch('/api/profile/avatar', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, fileType: file.type }),
      });
      const { uploadUrl, publicUrl } = await res.json();
      if (!res.ok) throw new Error('Failed to get upload URL');

      // 2. Upload directly to S3 (no auth header — pre-signed URL handles it)
      const s3res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!s3res.ok) throw new Error('Upload to S3 failed');

      // 3. Save the URL back to user profile
      const saveRes = await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profilePicUrl: publicUrl }),
      });
      if (!saveRes.ok) throw new Error('Failed to save profile picture URL');

      onUploaded(publicUrl);
    } catch (e) {
      setError(e.message);
      setPreview(currentUrl || null);
    } finally {
      setUploading(false);
    }
  }, [apiFetch, currentUrl, onUploaded]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const removeAvatar = async () => {
    setPreview(null);
    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ profilePicUrl: null }),
      });
      onUploaded(null);
    } catch { /* silent */ }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
      {/* Avatar preview */}
      <div style={{
        width: 88, height: 88, borderRadius: '50%', flexShrink: 0,
        overflow: 'hidden', position: 'relative',
        background: preview ? 'transparent' : 'linear-gradient(135deg,#6c63ff,#a78bfa)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '3px solid var(--border-card)',
        boxShadow: '0 2px 12px rgba(108,99,255,0.15)',
      }}>
        {preview
          ? <img src={preview} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ color: '#fff', fontSize: 30, fontWeight: 800 }}>{initials}</span>
        }
        {uploading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>
            <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
      </div>

      {/* Drop zone / controls */}
      <div style={{ flex: 1 }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--purple)' : 'var(--border)'}`,
            borderRadius: 10, padding: '16px 20px', cursor: uploading ? 'wait' : 'pointer',
            background: dragOver ? 'var(--purple-light)' : 'var(--bg-elevated)',
            transition: 'all 0.2s', textAlign: 'center', marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 4 }}>{uploading ? '⏳' : '📷'}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            {uploading ? 'Uploading…' : 'Click or drag to upload'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>JPEG, PNG or WebP · max 5 MB</div>
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => !uploading && inputRef.current?.click()}
            disabled={uploading}
            style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            📁 Choose file
          </button>
          {preview && (
            <button
              onClick={removeAvatar}
              disabled={uploading}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--red-border)', background: 'var(--red-bg)', color: 'var(--red)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              🗑 Remove
            </button>
          )}
        </div>
        {error && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>⚠ {error}</div>}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Password change section ────────────────────────────────────────────────────
function PasswordSection({ apiFetch, showToast }) {
  const [form,    setForm]    = useState({ current: '', next: '', confirm: '' });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const up = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setError('');
    if (!form.current) return setError('Current password is required');
    if (form.next.length < 8) return setError('New password must be at least 8 characters');
    if (form.next !== form.confirm) return setError('Passwords do not match');
    setSaving(true);
    try {
      const res = await apiFetch('/api/profile/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      const d = await res.json();
      if (!res.ok) return setError(d.error || 'Failed to change password');
      setForm({ current: '', next: '', confirm: '' });
      showToast('Password changed successfully');
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Current Password</label>
        <input type="password" className="input" value={form.current} onChange={e => up('current', e.target.value)} placeholder="Enter your current password" style={{ maxWidth: 360 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 360 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>New Password</label>
          <input type="password" className="input" value={form.next} onChange={e => up('next', e.target.value)} placeholder="Min. 8 characters" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Confirm</label>
          <input type="password" className="input" value={form.confirm} onChange={e => up('confirm', e.target.value)} placeholder="Repeat new password" />
        </div>
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>⚠ {error}</div>}
      <div>
        <button onClick={handleSubmit} disabled={saving} style={{
          padding: '9px 20px', borderRadius: 8, border: 'none',
          background: saving ? '#94a3b8' : 'var(--purple)',
          color: '#fff', fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
        }}>
          {saving ? 'Saving…' : '🔒 Change Password'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, apiFetch } = useAuth();

  const isAdmin   = ADMIN_ONLY.includes(user?.role);
  const initials  = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : '?';

  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName:  user?.lastName  || '',
    phone:     user?.phone     || '',
    email:     user?.email     || '',
  });
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(user?.profilePicUrl || null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const up = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) return showToast('First and last name are required', 'error');
    setSaving(true);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        phone:     form.phone.trim() || null,
        // Admins can also update email from this same form
        ...(isAdmin && { email: form.email.trim() }),
      };
      const res = await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to save');
      // Update localStorage user cache so the topbar reflects the new name
      try {
        const stored = JSON.parse(localStorage.getItem('pfp_user') || '{}');
        localStorage.setItem('pfp_user', JSON.stringify({ ...stored, ...d.user }));
      } catch { /* ignore */ }
      showToast('Profile updated successfully');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <style>{`@keyframes fadeInUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }`}</style>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}

      {/* Header */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 26 }}>👤</span>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: "'Poppins',sans-serif", margin: 0 }}>My Profile</h1>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Manage your personal information, profile picture and password
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>

        {/* ── Profile Picture ── */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', padding: '24px 28px' }}>
          <SectionHeader title="Profile Picture" description="Visible to other staff members in the system" />
          <div style={{ marginTop: 20 }}>
            <AvatarUploader
              currentUrl={avatarUrl}
              initials={initials}
              onUploaded={(url) => setAvatarUrl(url)}
              apiFetch={apiFetch}
            />
          </div>
        </div>

        {/* ── Personal Information ── */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', padding: '24px 28px' }}>
          <SectionHeader title="Personal Information" description="Your name and contact details" />

          <FieldRow label="Full Name" hint="Your first and last name as it appears across the system">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>First Name</label>
                <input className="input" value={form.firstName} onChange={e => up('firstName', e.target.value)} placeholder="Amina" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Last Name</label>
                <input className="input" value={form.lastName} onChange={e => up('lastName', e.target.value)} placeholder="Bello" />
              </div>
            </div>
          </FieldRow>

          <FieldRow
            label="Email Address"
            hint={isAdmin ? "As an admin you can update this email address" : "Email changes must be requested from a Farm Admin or above"}
          >
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={e => isAdmin && up('email', e.target.value)}
                readOnly={!isAdmin}
                style={{
                  background: isAdmin ? '#fff' : 'var(--bg-elevated)',
                  cursor: isAdmin ? 'text' : 'not-allowed',
                  color: isAdmin ? 'var(--text-primary)' : 'var(--text-muted)',
                  paddingRight: isAdmin ? 12 : 38,
                }}
              />
              {!isAdmin && (
                <span title="Contact Farm Admin to change email" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14 }}>🔒</span>
              )}
            </div>
            {!isAdmin && (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                ℹ Email address can only be changed by a Farm Admin or Chairperson.
              </div>
            )}
          </FieldRow>

          <FieldRow label="Phone Number" hint="Used for SMS alerts. Include country code (e.g. +234 801 234 5678)">
            <input
              className="input"
              type="tel"
              value={form.phone}
              onChange={e => up('phone', e.target.value)}
              placeholder="+234 801 234 5678"
              style={{ maxWidth: 280 }}
            />
          </FieldRow>

          {/* Role — read-only */}
          <FieldRow label="Role" hint="Roles are assigned by an administrator and cannot be self-edited">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                padding: '5px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                background: 'var(--purple-light)', color: 'var(--purple)', border: '1px solid #d4d8ff',
              }}>
                {user?.role?.replace(/_/g, ' ')}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Contact an admin to change your role</span>
            </div>
          </FieldRow>

          {/* Save button */}
          <div style={{ paddingTop: 8, display: 'flex', gap: 10 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '10px 24px', borderRadius: 9, border: 'none',
                background: saving ? '#94a3b8' : 'var(--purple)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                boxShadow: saving ? 'none' : '0 4px 14px rgba(108,99,255,0.25)',
              }}
            >
              {saving ? 'Saving…' : '💾 Save Changes'}
            </button>
          </div>
        </div>

        {/* ── Password ── */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', padding: '24px 28px' }}>
          <SectionHeader title="Change Password" description="Choose a strong password with at least 8 characters" />
          <div style={{ marginTop: 20 }}>
            <PasswordSection apiFetch={apiFetch} showToast={showToast} />
          </div>
        </div>

        {/* ── Account info (read-only) ── */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid var(--border-card)', padding: '24px 28px' }}>
          <SectionHeader title="Account Information" />
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'User ID',     value: user?.id?.slice(0, 16) + '…' },
              { label: 'Farm',        value: user?.farmName || '—' },
              { label: 'Tenant',      value: user?.tenantId?.slice(0, 16) + '…' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-card)' }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </AppShell>
  );
}
