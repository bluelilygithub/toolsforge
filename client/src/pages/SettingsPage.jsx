import { useState } from 'react';
import useSettingsStore from '../store/settingsStore';
import useAuthStore from '../store/authStore';
import { themes, fontOptions } from '../themes';
import { useToast } from '../components/Toast';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';

const TABS = ['Profile', 'Appearance'];

function SettingsPage() {
  const [tab, setTab] = useState('Profile');
  const { font, theme, setFont, setTheme } = useSettingsStore();
  const { user, setAuth, token } = useAuthStore();
  const showToast = useToast();
  const getIcon = useIcon();

  // Profile
  const [name, setName]   = useState(user?.name || '');
  const [saving, setSaving] = useState(false);

  // Password
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw]  = useState({ current: false, next: false, confirm: false });
  const [pwStatus, setPwStatus] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/api/auth/profile', { name });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Save failed', 'error'); return; }
      setAuth(token, { ...user, name });
      showToast('Profile saved');
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      setPwStatus({ ok: false, msg: 'New passwords do not match' });
      return;
    }
    if (pwForm.next.length < 6) {
      setPwStatus({ ok: false, msg: 'Password must be at least 6 characters' });
      return;
    }
    setPwLoading(true);
    setPwStatus(null);
    try {
      const res = await api.post('/api/auth/change-password', {
        currentPassword: pwForm.current,
        newPassword: pwForm.next,
      });
      const data = await res.json();
      if (!res.ok) { setPwStatus({ ok: false, msg: data.error || 'Failed' }); return; }
      setPwStatus({ ok: true, msg: 'Password changed successfully' });
      setPwForm({ current: '', next: '', confirm: '' });
    } catch {
      setPwStatus({ ok: false, msg: 'Network error' });
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-6" style={{ color: 'var(--color-text)' }}>
        Settings
      </h1>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium transition-colors relative"
            style={{ color: tab === t ? 'var(--color-primary)' : 'var(--color-muted)' }}
          >
            {t}
            {tab === t && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: 'var(--color-primary)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {tab === 'Profile' && (
        <div className="space-y-6">
          {/* Account info */}
          <Section title="Account">
            <div
              className="rounded-xl border px-4 py-3 text-sm"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <p style={{ color: 'var(--color-muted)' }} className="text-xs uppercase tracking-wider font-semibold mb-1">Email</p>
              <p style={{ color: 'var(--color-text)' }}>{user?.email}</p>
            </div>
          </Section>

          {/* Display name */}
          <Section title="Display Name">
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{
                  background: 'var(--color-bg)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
              <SaveButton loading={saving} label="Save Name" />
            </form>
          </Section>

          {/* Change password */}
          <Section title="Change Password">
            <form onSubmit={handleChangePassword} className="space-y-3">
              {['current', 'next', 'confirm'].map((field) => (
                <div key={field}>
                  <label
                    className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {field === 'current' ? 'Current Password'
                      : field === 'next' ? 'New Password'
                      : 'Confirm New Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPw[field] ? 'text' : 'password'}
                      value={pwForm[field]}
                      onChange={e => setPwForm(p => ({ ...p, [field]: e.target.value }))}
                      required
                      placeholder="••••••••"
                      className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                      style={{
                        background: 'var(--color-bg)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => ({ ...p, [field]: !p[field] }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {getIcon(showPw[field] ? 'eye-off' : 'eye', { size: 14 })}
                    </button>
                  </div>
                </div>
              ))}
              {pwStatus && (
                <p className="text-xs" style={{ color: pwStatus.ok ? '#16a34a' : '#ef4444' }}>
                  {pwStatus.msg}
                </p>
              )}
              <SaveButton loading={pwLoading} label="Change Password" />
            </form>
          </Section>
        </div>
      )}

      {/* Appearance tab */}
      {tab === 'Appearance' && (
        <div className="space-y-6">
          <Section title="Theme">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(themes).map(([key, t]) => (
                <button
                  key={key}
                  onClick={() => setTheme(key)}
                  className="rounded-xl border p-3 text-left transition-all"
                  style={{
                    background: t.bg,
                    borderColor: theme === key ? t.primary : t.border,
                    boxShadow: theme === key ? `0 0 0 2px ${t.primary}` : 'none',
                  }}
                >
                  <div className="flex gap-1 mb-2">
                    {[t.primary, t.surface, t.border].map((c, i) => (
                      <span key={i} className="w-3 h-3 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                  <p className="text-xs font-medium" style={{ color: t.text }}>{t.label}</p>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Font">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {fontOptions.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFont(f.value)}
                  className="rounded-xl border px-4 py-2.5 text-left text-sm transition-all"
                  style={{
                    fontFamily: f.style,
                    background: font === f.value ? `rgba(var(--color-primary-rgb), 0.08)` : 'var(--color-bg)',
                    borderColor: font === f.value ? 'var(--color-primary)' : 'var(--color-border)',
                    color: font === f.value ? 'var(--color-primary)' : 'var(--color-text)',
                    fontWeight: font === f.value ? 600 : 400,
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3
        className="text-xs font-semibold uppercase tracking-wider mb-3"
        style={{ color: 'var(--color-muted)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function SaveButton({ loading, label }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
      style={{ background: 'var(--color-primary)' }}
    >
      {loading ? 'Saving…' : label}
    </button>
  );
}

export default SettingsPage;
