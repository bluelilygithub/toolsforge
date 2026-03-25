import { useState, useEffect } from 'react';

const TZ_LIST = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [
  'UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'America/Toronto','Europe/London','Europe/Paris','Europe/Berlin',
  'Asia/Dubai','Asia/Kolkata','Asia/Singapore','Asia/Tokyo',
  'Australia/Sydney','Australia/Melbourne','Pacific/Auckland',
];
import useSettingsStore from '../store/settingsStore';
import useAuthStore from '../store/authStore';
import { themes, googleFonts, FONT_CATEGORIES } from '../themes';
import { useToast } from '../components/Toast';
import { useIcon } from '../providers/IconProvider';
import api from '../utils/apiClient';

const TABS = ['Profile', 'Appearance'];

function SettingsPage() {
  const [tab, setTab] = useState('Profile');
  const { bodyFont, headingFont, theme, setBodyFont, setHeadingFont, setTheme } = useSettingsStore();
  const { user, setAuth, token } = useAuthStore();
  const showToast = useToast();
  const getIcon = useIcon();

  // Profile
  const [profile, setProfile] = useState({
    firstName: user?.first_name || '',
    lastName:  user?.last_name  || '',
    phone:     user?.phone      || '',
  });
  const [saving, setSaving] = useState(false);

  // Timezone
  const [timezone, setTimezone]         = useState('');
  const [tzSaving, setTzSaving]         = useState(false);
  const [tzSaved, setTzSaved]           = useState('');

  useEffect(() => {
    api.get('/api/user-settings')
      .then(r => r.json())
      .then(data => {
        if (data.timezone) { setTimezone(data.timezone); setTzSaved(data.timezone); }
        else {
          // Fall back to org default
          api.get('/api/admin/app-settings').then(r => r.json())
            .then(d => { const tz = d.default_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone; setTimezone(tz); setTzSaved(tz); })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  async function handleSaveTimezone() {
    setTzSaving(true);
    try {
      await api.post('/api/user-settings', { key: 'timezone', value: timezone });
      setTzSaved(timezone);
      showToast('Timezone saved');
    } catch {
      showToast('Failed to save timezone', 'error');
    } finally {
      setTzSaving(false);
    }
  }

  // Password
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw]  = useState({ current: false, next: false, confirm: false });
  const [pwStatus, setPwStatus] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put('/api/auth/profile', {
        firstName: profile.firstName,
        lastName:  profile.lastName,
        phone:     profile.phone,
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Save failed', 'error'); return; }
      setAuth(token, {
        ...user,
        first_name: profile.firstName,
        last_name:  profile.lastName,
        phone:      profile.phone,
      });
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

          {/* Profile fields */}
          <Section title="Profile">
            <form onSubmit={handleSaveProfile} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'firstName', label: 'First Name', placeholder: 'Jane' },
                  { key: 'lastName',  label: 'Last Name',  placeholder: 'Smith' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label
                      className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {label}
                    </label>
                    <input
                      type="text"
                      value={profile[key]}
                      onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                      style={{
                        background: 'var(--color-bg)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                  </div>
                ))}
              </div>
              <div>
                <label
                  className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Phone
                </label>
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+61 400 000 000"
                  className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                  style={{
                    background: 'var(--color-bg)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>
              <SaveButton loading={saving} label="Save Profile" />
            </form>
          </Section>

          {/* Timezone */}
          <Section title="Timezone">
            <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
              Overrides the organisation default. Used for date stamps and date context injected into AI responses.
            </p>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none mb-3"
              style={{
                background: 'var(--color-surface)',
                borderColor: timezone !== tzSaved ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {TZ_LIST.map(tz => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
            {timezone && (
              <p className="text-xs mb-3" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
                Current time: {new Date().toLocaleString('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
            <button
              onClick={handleSaveTimezone}
              disabled={tzSaving || timezone === tzSaved}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {tzSaving ? 'Saving…' : 'Save Timezone'}
            </button>
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

          <Section title="Fonts">
            <FontSection
              bodyFont={bodyFont}
              headingFont={headingFont}
              setBodyFont={setBodyFont}
              setHeadingFont={setHeadingFont}
            />
          </Section>
        </div>
      )}
    </div>
  );
}

function FontSection({ bodyFont, headingFont, setBodyFont, setHeadingFont }) {
  const [fontTab, setFontTab] = useState('body');
  return (
    <div>
      {/* Tab strip */}
      <div
        className="flex gap-1 p-1 rounded-xl mb-4"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        {[
          { key: 'body',    label: 'Body Font',    value: bodyFont },
          { key: 'heading', label: 'Heading Font', value: headingFont },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setFontTab(t.key)}
            className="flex-1 flex flex-col items-center py-2 px-3 rounded-lg transition-all"
            style={{
              background:  fontTab === t.key ? 'var(--color-surface)' : 'transparent',
              boxShadow:   fontTab === t.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              border:      fontTab === t.key ? '1px solid var(--color-border)' : '1px solid transparent',
            }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: fontTab === t.key ? 'var(--color-primary)' : 'var(--color-muted)' }}
            >
              {t.label}
            </span>
            <span
              className="text-sm font-medium mt-0.5 truncate max-w-full"
              style={{
                fontFamily: googleFonts.find(f => f.value === t.value)?.stack,
                color: 'var(--color-text)',
              }}
            >
              {t.value}
            </span>
          </button>
        ))}
      </div>

      {fontTab === 'body' ? (
        <FontPicker
          value={bodyFont}
          onChange={setBodyFont}
          sample="The quick brown fox jumps over the lazy dog"
          sampleSize={13}
        />
      ) : (
        <FontPicker
          value={headingFont}
          onChange={setHeadingFont}
          sample="The Quick Brown Fox"
          sampleSize={16}
        />
      )}
    </div>
  );
}

function FontPicker({ value, onChange, sample, sampleSize }) {
  return (
    <div className="space-y-3">
      {FONT_CATEGORIES.map(cat => {
        const fonts = googleFonts.filter(f => f.category === cat.key);
        return (
          <div key={cat.key}>
            <p
              className="text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--color-muted)' }}
            >
              {cat.label}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {fonts.map(f => {
                const active = value === f.value;
                return (
                  <button
                    key={f.value}
                    onClick={() => onChange(f.value)}
                    className="rounded-xl border px-4 py-2.5 text-left transition-all"
                    style={{
                      background:   active ? `rgba(var(--color-primary-rgb), 0.08)` : 'var(--color-bg)',
                      borderColor:  active ? 'var(--color-primary)' : 'var(--color-border)',
                    }}
                  >
                    <p
                      style={{
                        fontFamily: f.stack,
                        fontSize:   sampleSize,
                        color:      active ? 'var(--color-primary)' : 'var(--color-text)',
                        fontWeight: 600,
                        marginBottom: 2,
                        lineHeight: 1.3,
                      }}
                    >
                      {f.label}
                    </p>
                    <p
                      style={{
                        fontFamily: f.stack,
                        fontSize:   11,
                        color:      'var(--color-muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      {sample}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
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
