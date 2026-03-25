import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import api from '../utils/apiClient';

const TZ_LIST = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [
  'UTC','America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'America/Toronto','America/Vancouver','America/Sao_Paulo','Europe/London',
  'Europe/Paris','Europe/Berlin','Europe/Moscow','Asia/Dubai','Asia/Kolkata',
  'Asia/Singapore','Asia/Tokyo','Asia/Shanghai','Australia/Sydney','Australia/Melbourne',
  'Pacific/Auckland','Pacific/Honolulu',
];

const DEFAULT_FILE_TYPES = '.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,image/*';

export default function AdminAppSettingsPage() {
  const showToast = useToast();

  const [fileTypes, setFileTypes]   = useState(DEFAULT_FILE_TYPES);
  const [timezone, setTimezone]     = useState('UTC');
  const [saved, setSaved]           = useState({ fileTypes: DEFAULT_FILE_TYPES, timezone: 'UTC' });
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    api.get('/api/admin/app-settings')
      .then(r => r.json())
      .then(data => {
        const ft = data.chat_allowed_file_types ?? DEFAULT_FILE_TYPES;
        const tz = data.default_timezone ?? 'UTC';
        setFileTypes(ft);
        setTimezone(tz);
        setSaved({ fileTypes: ft, timezone: tz });
      })
      .catch(() => showToast('Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = fileTypes !== saved.fileTypes || timezone !== saved.timezone;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await api.put('/api/admin/app-settings', {
        chat_allowed_file_types: fileTypes,
        default_timezone: timezone,
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Save failed', 'error'); return; }
      setSaved({ fileTypes, timezone });
      showToast('Settings saved');
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setFileTypes(DEFAULT_FILE_TYPES);
    setTimezone('UTC');
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="flex gap-1.5">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: 'var(--color-primary)', animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>App Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Organisation-wide defaults for chat behaviour
        </p>
      </div>

      <div className="space-y-4">

        {/* File types */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div
            className="px-5 py-3 border-b flex items-center gap-2"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              Allowed File Types
            </p>
          </div>
          <div className="px-5 py-4" style={{ background: 'var(--color-bg)' }}>
            <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
              Comma-separated list of file extensions and MIME types accepted in chat file uploads.
              Use <code style={{ color: 'var(--color-text)' }}>image/*</code> to allow all image formats.
            </p>
            <input
              type="text"
              value={fileTypes}
              onChange={e => setFileTypes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm font-mono outline-none"
              style={{
                background: 'var(--color-surface)',
                borderColor: fileTypes !== saved.fileTypes ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
              placeholder={DEFAULT_FILE_TYPES}
            />
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
              e.g. <code>.pdf,.docx,.xlsx</code> or <code>image/*</code> or <code>.pdf,image/*,.txt</code>
            </p>
          </div>
        </div>

        {/* Default timezone */}
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div
            className="px-5 py-3 border-b flex items-center gap-2"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              Default Timezone
            </p>
          </div>
          <div className="px-5 py-4" style={{ background: 'var(--color-bg)' }}>
            <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
              The organisation's default timezone used for date stamps and context injection.
              Individual users can override this in their profile settings.
            </p>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
              style={{
                background: 'var(--color-surface)',
                borderColor: timezone !== saved.timezone ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {TZ_LIST.map(tz => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)', opacity: 0.7 }}>
              Current time in this zone: {new Date().toLocaleString('en', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleReset}
            className="text-sm px-4 py-2 rounded-xl border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Reset to defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="text-sm px-5 py-2 rounded-xl font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--color-primary)' }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

      </div>
    </div>
  );
}
