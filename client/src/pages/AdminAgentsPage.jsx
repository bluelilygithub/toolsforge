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

// ─── Section: Intelligence Profile ────────────────────────────────────────────

const EMPTY_PROFILE = {
  targetROAS:            '',
  targetCPA:             '',
  businessContext:       '',
  analyticalGuardrails:  '',
  agentSpecific: {
    conversionRateBaseline:   '',
    averageOrderValue:        '',
    typicalConversionLagDays: '',
  },
};

/** Convert the raw JSONB profile from the server into editable form-state. */
function profileToForm(profile) {
  if (!profile || typeof profile !== 'object') return EMPTY_PROFILE;
  const ext = profile.agentSpecific ?? {};
  return {
    targetROAS:           profile.targetROAS           ?? '',
    targetCPA:            profile.targetCPA            ?? '',
    businessContext:      profile.businessContext      ?? '',
    // analyticalGuardrails is stored as string[] but edited as newline-separated text
    analyticalGuardrails: Array.isArray(profile.analyticalGuardrails)
      ? profile.analyticalGuardrails.join('\n')
      : (profile.analyticalGuardrails ?? ''),
    agentSpecific: {
      conversionRateBaseline:   ext.conversionRateBaseline   ?? '',
      averageOrderValue:        ext.averageOrderValue        ?? '',
      typicalConversionLagDays: ext.typicalConversionLagDays ?? '',
    },
  };
}

/** Convert form-state back to the JSONB shape expected by the server. */
function formToProfile(form) {
  const guardrails = form.analyticalGuardrails
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const ext = {};
  if (form.agentSpecific.conversionRateBaseline !== '')
    ext.conversionRateBaseline = Number(form.agentSpecific.conversionRateBaseline);
  if (form.agentSpecific.averageOrderValue !== '')
    ext.averageOrderValue = Number(form.agentSpecific.averageOrderValue);
  if (form.agentSpecific.typicalConversionLagDays !== '')
    ext.typicalConversionLagDays = Number(form.agentSpecific.typicalConversionLagDays);

  return {
    ...(form.targetROAS    !== '' && { targetROAS:  Number(form.targetROAS) }),
    ...(form.targetCPA     !== '' && { targetCPA:   Number(form.targetCPA) }),
    ...(form.businessContext.trim() && { businessContext: form.businessContext.trim() }),
    ...(guardrails.length > 0 && { analyticalGuardrails: guardrails }),
    ...(Object.keys(ext).length > 0 && { agentSpecific: ext }),
  };
}

function Textarea({ value, onChange, rows = 3, placeholder }) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      rows={rows}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-xl border text-sm outline-none resize-y"
      style={{
        background:  'var(--color-surface)',
        borderColor: 'var(--color-border)',
        color:       'var(--color-text)',
      }}
    />
  );
}

function IntelligenceProfileSection({ slug }) {
  const showToast = useToast();

  const [form,    setForm]    = useState(EMPTY_PROFILE);
  const [saved,   setSaved]   = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadErr(null);
    api.get(`/api/agent-configs/${slug}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        const f = profileToForm(data.intelligence_profile);
        setForm(f);
        setSaved(f);
      })
      .catch(err => setLoadErr(err.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, [slug]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function handleSave() {
    setSaving(true);
    try {
      const res  = await api.put(`/api/agent-configs/${slug}`, {
        intelligence_profile: formToProfile(form),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Save failed', 'error'); return; }
      // The server returns the full merged config; extract the profile from it.
      const f = profileToForm(data.intelligence_profile);
      setForm(f);
      setSaved(f);
      showToast('Intelligence profile saved');
    } catch {
      showToast('Network error', 'error');
    } finally {
      setSaving(false);
    }
  }

  const setField = key => val =>
    setForm(prev => ({ ...prev, [key]: val }));

  const setExt = key => val =>
    setForm(prev => ({
      ...prev,
      agentSpecific: { ...prev.agentSpecific, [key]: val },
    }));

  if (loading) return <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  if (loadErr) return (
    <p className="text-sm py-4" style={{ color: '#dc2626' }}>
      Could not load profile — {loadErr}. Restart the server if this is the first run.
    </p>
  );

  return (
    <div className="space-y-4">

      <Card
        title="Account Targets"
        description="Declared performance targets. The agent verifies every recommendation against these before finalising its output."
      >
        <Field label="Target ROAS" hint="Return on ad spend the account is aiming for (e.g. 7 = 7x). Leave blank if not set.">
          <Input
            type="number" min={0} step={0.1}
            value={form.targetROAS}
            onChange={e => setField('targetROAS')(e.target.value)}
            placeholder="e.g. 7"
          />
        </Field>
        <Field label="Target CPA (AUD)" hint="Target cost per acquisition in AUD. Leave blank if not set.">
          <Input
            type="number" min={0} step={1}
            value={form.targetCPA}
            onChange={e => setField('targetCPA')(e.target.value)}
            placeholder="e.g. 45"
          />
        </Field>
      </Card>

      <Card
        title="Business Context"
        description="Free text describing the business model and what success looks like. Injected verbatim into the agent's system prompt."
      >
        <Textarea
          value={form.businessContext}
          onChange={e => setField('businessContext')(e.target.value)}
          rows={4}
          placeholder="e.g. E-commerce store selling premium pet food. Success = repeat purchase rate, not just first conversion. High-AOV orders come from search terms including breed-specific keywords."
        />
      </Card>

      <Card
        title="Analytical Guardrails"
        description="One instruction per line. These constrain how the agent reasons — it must not contradict them. Applied to every run."
      >
        <Textarea
          value={form.analyticalGuardrails}
          onChange={e => setField('analyticalGuardrails')(e.target.value)}
          rows={4}
          placeholder={
            'e.g.\nDo not flag brand campaigns as wasted spend — they serve retention, not acquisition.\n' +
            'A 7x ROAS is strong — do not recommend pausing campaigns achieving this or better.'
          }
        />
        <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
          Each line becomes one guardrail bullet in the agent prompt.
        </p>
      </Card>

      <Card
        title="Account Baselines — Google Ads"
        description="Measured account-level metrics. The agent uses these to contextualise per-campaign data."
      >
        <Field label="Conversion Rate Baseline (%)" hint="Account-level CVR. Campaigns significantly below this warrant attention.">
          <Input
            type="number" min={0} max={100} step={0.1}
            value={form.agentSpecific.conversionRateBaseline}
            onChange={e => setExt('conversionRateBaseline')(e.target.value)}
            placeholder="e.g. 10"
          />
        </Field>
        <Field label="Average Order Value (AUD)" hint="Typical transaction value. Used to frame cost-per-conversion commentary.">
          <Input
            type="number" min={0} step={1}
            value={form.agentSpecific.averageOrderValue}
            onChange={e => setExt('averageOrderValue')(e.target.value)}
            placeholder="e.g. 450"
          />
        </Field>
        <Field label="Typical Conversion Lag (days)" hint="Days between ad click and conversion. Affects how recent data is interpreted.">
          <Input
            type="number" min={0} max={90} step={1}
            value={form.agentSpecific.typicalConversionLagDays}
            onChange={e => setExt('typicalConversionLagDays')(e.target.value)}
            placeholder="e.g. 3"
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
          {saving ? 'Saving…' : 'Save Intelligence Profile'}
        </button>
        {isDirty && (
          <button
            onClick={() => setForm(saved)}
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

      <div className="mb-8">
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
          Google Ads Monitor — Admin
        </h2>
        <AdminSettingsSection slug={SLUG} />
      </div>

      <div className="mb-4">
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
          Google Ads Monitor — Account Intelligence Profile
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
          Declared targets, business context, and account baselines. Injected into the agent's system prompt before every run so analysis is grounded in known account performance.
        </p>
        <IntelligenceProfileSection slug={SLUG} />
      </div>
    </div>
  );
}
