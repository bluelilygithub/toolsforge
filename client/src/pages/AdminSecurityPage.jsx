import { useEffect, useState } from 'react';
import { useIcon } from '../providers/IconProvider';
import { useToast } from '../components/Toast';
import api from '../utils/apiClient';

const FIELDS = [
  {
    key: 'security_login_max_attempts',
    label: 'Max failed login attempts',
    description: 'Number of consecutive incorrect passwords before an account is locked.',
    unit: 'attempts',
    min: 1,
    max: 20,
    default: 5,
  },
  {
    key: 'security_lockout_minutes',
    label: 'Account lockout duration',
    description: 'How long a locked account stays locked before the counter automatically resets.',
    unit: 'minutes',
    min: 1,
    max: 1440,
    default: 15,
  },
  {
    key: 'security_login_rate_limit',
    label: 'Login rate limit (per IP)',
    description: 'Maximum login attempts allowed per IP address within a 15-minute window. Blocks distributed brute-force attacks before credentials are even checked.',
    unit: 'attempts / 15 min',
    min: 1,
    max: 20,
    default: 5,
  },
];

export default function AdminSecurityPage() {
  const getIcon  = useIcon();
  const showToast = useToast();

  const [values, setValues]   = useState({});
  const [saved, setSaved]     = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    api.get('/api/admin/security-settings')
      .then(r => r.json())
      .then(data => {
        setValues(data);
        setSaved(data);
      })
      .catch(() => showToast('Failed to load security settings', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = FIELDS.some(f => Number(values[f.key]) !== Number(saved[f.key]));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {};
      for (const f of FIELDS) payload[f.key] = Number(values[f.key]);
      const res = await api.put('/api/admin/security-settings', payload);
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to save', 'error'); return; }
      setSaved({ ...values });
      showToast('Security settings saved');
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const defaults = {};
    for (const f of FIELDS) defaults[f.key] = f.default;
    setValues(defaults);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Security</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Authentication thresholds and rate limits
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="flex gap-1.5">
            {[0, 150, 300].map(d => (
              <span key={d} className="w-2 h-2 rounded-full animate-bounce"
                style={{ background: 'var(--color-primary)', animationDelay: `${d}ms` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">

          {/* Login lockout section */}
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div
              className="px-5 py-3 border-b flex items-center gap-2"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <span style={{ color: 'var(--color-primary)' }}>{getIcon('shield', { size: 15 })}</span>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Login Security
              </p>
            </div>

            <div style={{ background: 'var(--color-bg)' }}>
              {FIELDS.map((field, i) => (
                <div
                  key={field.key}
                  className="flex items-start justify-between gap-6 px-5 py-4"
                  style={{
                    borderBottom: i < FIELDS.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {field.label}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {field.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={values[field.key] ?? field.default}
                      onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                      className="w-20 px-3 py-1.5 rounded-xl border text-sm text-center outline-none"
                      style={{
                        background: 'var(--color-surface)',
                        borderColor: Number(values[field.key]) !== Number(saved[field.key])
                          ? 'var(--color-primary)'
                          : 'var(--color-border)',
                        color: 'var(--color-text)',
                      }}
                    />
                    <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {field.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* How these interact */}
          <div
            className="rounded-2xl border px-5 py-4 text-xs space-y-1.5"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}
          >
            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>How these settings work together</p>
            <p>
              The <strong style={{ color: 'var(--color-text)' }}>rate limit</strong> is the first line of defence — it stops
              a single IP from making more than the allowed number of login attempts in a 15-minute window, regardless of which
              account they target.
            </p>
            <p>
              The <strong style={{ color: 'var(--color-text)' }}>account lockout</strong> is the second — it stops an attacker
              rotating IPs who slowly probes a specific account. After the defined number of consecutive failures the account
              locks, regardless of which IP the attempts came from.
            </p>
            <p>
              Locked accounts automatically unlock after the lockout duration. The counter resets to zero on any successful login.
            </p>
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
      )}
    </div>
  );
}
