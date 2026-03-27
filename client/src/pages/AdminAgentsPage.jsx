import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import api from '../utils/apiClient';

const SLUG = 'google-ads-monitor';

const KNOWN_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5  — fast, lowest cost' },
  { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — balanced (recommended)' },
  { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6   — maximum capability, highest cost' },
];

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Card({ title, description, children }) {
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
      <div
        className="px-5 py-3 border-b"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
          {title}
        </p>
        {description && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)', opacity: 0.75 }}>
            {description}
          </p>
        )}
      </div>
      <div className="px-5 py-4" style={{ background: 'var(--color-bg)' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
        {label}
      </label>
      {hint && <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>{hint}</p>}
      {children}
    </div>
  );
}

function Input({ type = 'text', value, onChange, min, max, ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
      style={{
        background:   'var(--color-surface)',
        borderColor:  'var(--color-border)',
        color:        'var(--color-text)',
      }}
      {...rest}
    />
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div className="relative">
        <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
        <div
          className="w-10 h-6 rounded-full transition-colors"
          style={{ background: checked ? 'var(--color-primary)' : 'var(--color-border)' }}
        />
        <div
          className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ left: checked ? '1.25rem' : '0.25rem' }}
        />
      </div>
      <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
    </label>
  );
}

// ─── Section: Admin settings ──────────────────────────────────────────────────

function AdminSettingsSection({ slug }) {
  const showToast = useToast();

  const [cfg,     setCfg]     = useState(null);
  const [saved,   setSaved]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadErr(null);
    api.get(`/api/agent-configs/${slug}/admin`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { setCfg(data); setSaved(data); })
      .catch(err => setLoadErr(err.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, [slug]);

  const isDirty = cfg && JSON.stringify(cfg) !== JSON.stringify(saved);

  async function handleSave() {
    setSaving(true);
    try {
      const res  = await api.put(`/api/agent-configs/${slug}/admin`, cfg);
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Save failed', 'error'); return; }
      setSaved(data);
      showToast('Admin settings saved');
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  if (loadErr) return (
    <p className="text-sm py-4" style={{ color: '#dc2626' }}>
      Could not load settings — {loadErr}. Restart the server if this is the first run.
    </p>
  );

  const set = key => val => setCfg(prev => ({ ...prev, [key]: val }));

  return (
    <div className="space-y-4">

      <Card title="Kill Switch" description="Immediately stops all runs — manual and scheduled.">
        <Toggle
          checked={cfg.enabled}
          onChange={e => set('enabled')(e.target.checked)}
          label={cfg.enabled ? 'Agent enabled' : 'Agent disabled'}
        />
        {!cfg.enabled && (
          <p className="text-xs mt-2" style={{ color: '#dc2626' }}>
            All run requests will be rejected until re-enabled.
          </p>
        )}
      </Card>

      <Card title="Model" description="Claude model used for analysis. Affects cost and output quality.">
        <Field label="Model">
          <select
            value={cfg.model}
            onChange={e => set('model')(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {KNOWN_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title="Cost Guardrails" description="Hard limits applied to every run, manual or scheduled.">
        <Field label="Max output tokens" hint="Caps the length of Claude's response. Lower = cheaper, may truncate analysis.">
          <Input
            type="number" min={1024} max={65536}
            value={cfg.max_tokens}
            onChange={e => set('max_tokens')(Number(e.target.value))}
          />
        </Field>
        <Field label="Max iterations" hint="Maximum ReAct loop iterations before the agent is force-stopped. Lower = safer spend.">
          <Input
            type="number" min={1} max={20}
            value={cfg.max_iterations}
            onChange={e => set('max_iterations')(Number(e.target.value))}
          />
        </Field>
      </Card>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="px-5 py-2 rounded-xl text-sm font-medium transition-opacity"
          style={{
            background: 'var(--color-primary)', color: '#fff',
            opacity: !isDirty || saving ? 0.5 : 1,
            cursor:  !isDirty || saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save Admin Settings'}
        </button>
        {isDirty && (
          <button
            onClick={() => setCfg(saved)}
            className="text-sm"
            style={{ color: 'var(--color-muted)' }}
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminAgentsPage() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Agents — Admin Settings
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Model selection, cost guardrails, and kill switches. Analytical settings live in each agent's own settings panel.
        </p>
      </div>

      <div className="mb-4">
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
          Google Ads Monitor
        </h2>
        <AdminSettingsSection slug={SLUG} />
      </div>
    </div>
  );
}
