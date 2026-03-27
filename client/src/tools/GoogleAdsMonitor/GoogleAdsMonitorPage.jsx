import { useState, useEffect, useCallback, useRef } from 'react';
import useAuthStore from '../../stores/authStore';
import api from '../../utils/apiClient';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import CampaignPerformanceTable from './CampaignPerformanceTable';
import SearchTermsTable from './SearchTermsTable';
import PerformanceChart from './PerformanceChart';
import AISuggestionsPanel from './AISuggestionsPanel';

const API_BASE   = '/api/agents/google-ads-monitor';
const CONFIG_BASE = '/api/agent-configs/google-ads-monitor';

const PROGRESS_KEYFRAME = `
  @keyframes tf-ads-slide {
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(500%); }
  }
`;

// ─── Date range config ────────────────────────────────────────────────────────

const PRESETS = [
  { key: 'day',   label: 'Day',   days: 1 },
  { key: 'week',  label: 'Week',  days: 7 },
  { key: 'month', label: 'Month', days: 30 },
  { key: 'qtr',   label: 'Qtr',   days: 90 },
  { key: 'year',  label: 'Year',  days: 365 },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function RunningIndicator({ message }) {
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;

  return (
    <>
      <style>{PROGRESS_KEYFRAME}</style>
      <div className="mb-6">
        <div
          className="relative overflow-hidden rounded-full"
          style={{ height: 4, background: 'var(--color-border)' }}
        >
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '20%',
            borderRadius: 9999, background: 'var(--color-primary)',
            animation: 'tf-ads-slide 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
          }} />
        </div>
        <div className="flex justify-between mt-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{message}</span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>{elapsed}</span>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div
      className="rounded-xl p-6 mb-6"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <h2
        className="text-base font-semibold mb-4"
        style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

// ─── Agent Settings panel ─────────────────────────────────────────────────────

function AgentSettingsPanel({ token, onLookbackChange }) {
  const [cfg,          setCfg]          = useState(null);
  const [saved,        setSaved]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');
  const [open,         setOpen]         = useState(false);

  useEffect(() => {
    if (!open || cfg) return;
    fetch(CONFIG_BASE, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { setCfg(data); setSaved(data); })
      .catch(() => setSaveMsg('Failed to load settings'))
      .finally(() => setLoading(false));
  }, [open, cfg, token]);

  const isDirty = cfg && JSON.stringify(cfg) !== JSON.stringify(saved);

  async function handleSave() {
    setSaving(true);
    setSaveMsg('');
    try {
      const res  = await api.put(CONFIG_BASE, cfg);
      const data = await res.json();
      if (!res.ok) { setSaveMsg(data.error || 'Save failed'); return; }
      setSaved(data);
      setSaveMsg('Saved');
      // Notify parent of new lookback default so preset pills update.
      if (data.lookback_days) onLookbackChange(data.lookback_days);
      setTimeout(() => setSaveMsg(''), 2500);
    } catch {
      setSaveMsg('Network error');
    } finally {
      setSaving(false);
    }
  }

  const set = key => val => setCfg(prev => ({ ...prev, [key]: val }));

  const inputStyle = {
    background:  'var(--color-surface)',
    border:      '1px solid var(--color-border)',
    color:       'var(--color-text)',
    borderRadius: 8,
    padding:     '6px 10px',
    fontSize:    13,
    width:       '100%',
    outline:     'none',
  };

  return (
    <div
      className="rounded-xl mt-4"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium"
        style={{ color: 'var(--color-text)', background: 'transparent' }}
      >
        <span>Agent Settings</span>
        <span style={{ color: 'var(--color-muted)', fontSize: 11 }}>
          {open ? '▲ Hide' : '▼ Show'}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5" style={{ borderTop: '1px solid var(--color-border)' }}>
          {loading ? (
            <p className="text-sm py-4" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          ) : cfg ? (
            <div className="space-y-5 pt-4">

              {/* Schedule */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                  SCHEDULE
                </label>
                <p className="text-xs mb-2" style={{ color: 'var(--color-muted)', opacity: 0.75 }}>
                  5-field cron expression (UTC). Controls automated runs. Changes apply immediately.
                </p>
                <input
                  type="text"
                  value={cfg.schedule}
                  onChange={e => set('schedule')(e.target.value)}
                  style={{ ...inputStyle, fontFamily: 'monospace' }}
                  placeholder="0 6,18 * * *"
                />
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)', opacity: 0.6 }}>
                  e.g. <code>0 6,18 * * *</code> = 6 am & 6 pm UTC daily
                </p>
              </div>

              {/* Default lookback */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                  DEFAULT LOOKBACK WINDOW
                </label>
                <p className="text-xs mb-2" style={{ color: 'var(--color-muted)', opacity: 0.75 }}>
                  Days of data to analyse when no date range is selected before Run Now.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} max={365}
                    value={cfg.lookback_days}
                    onChange={e => set('lookback_days')(Number(e.target.value))}
                    style={{ ...inputStyle, width: 80 }}
                  />
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>days</span>
                </div>
              </div>

              {/* Thresholds */}
              <div>
                <label className="block text-xs font-semibold mb-3" style={{ color: 'var(--color-muted)' }}>
                  INTENT BUCKET THRESHOLDS
                </label>
                <div className="grid grid-cols-1 gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <div>
                    <p className="text-xs mb-1 font-medium" style={{ color: 'var(--color-text)' }}>Low CTR threshold</p>
                    <p className="text-xs mb-2" style={{ color: 'var(--color-muted)', opacity: 0.75 }}>Below this % = poor ad match</p>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min={0.1} max={20} step={0.1}
                        value={((cfg.ctr_low_threshold ?? 0.03) * 100).toFixed(1)}
                        onChange={e => set('ctr_low_threshold')(Number(e.target.value) / 100)}
                        style={{ ...inputStyle, width: 70 }}
                      />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>%</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs mb-1 font-medium" style={{ color: 'var(--color-text)' }}>Wasted spend min clicks</p>
                    <p className="text-xs mb-2" style={{ color: 'var(--color-muted)', opacity: 0.75 }}>Zero-conversion flag threshold</p>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min={1} max={100}
                        value={cfg.wasted_clicks_threshold}
                        onChange={e => set('wasted_clicks_threshold')(Number(e.target.value))}
                        style={{ ...inputStyle, width: 70 }}
                      />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>clicks</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs mb-1 font-medium" style={{ color: 'var(--color-text)' }}>Ad copy min impressions</p>
                    <p className="text-xs mb-2" style={{ color: 'var(--color-muted)', opacity: 0.75 }}>Low CTR opportunity threshold</p>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min={10} max={10000}
                        value={cfg.impressions_ctr_threshold}
                        onChange={e => set('impressions_ctr_threshold')(Number(e.target.value))}
                        style={{ ...inputStyle, width: 80 }}
                      />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>impr.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Max suggestions */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-muted)' }}>
                  MAX RECOMMENDATIONS
                </label>
                <p className="text-xs mb-2" style={{ color: 'var(--color-muted)', opacity: 0.75 }}>
                  Maximum number of actionable recommendations Claude produces per run.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} max={20}
                    value={cfg.max_suggestions}
                    onChange={e => set('max_suggestions')(Number(e.target.value))}
                    style={{ ...inputStyle, width: 80 }}
                  />
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>suggestions</span>
                </div>
              </div>

              {/* Save row */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium transition-opacity"
                  style={{
                    background: 'var(--color-primary)', color: '#fff',
                    opacity: !isDirty || saving ? 0.5 : 1,
                    cursor:  !isDirty || saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
                {isDirty && (
                  <button onClick={() => setCfg(saved)} className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Discard
                  </button>
                )}
                {saveMsg && (
                  <span className="text-xs" style={{ color: saveMsg === 'Saved' ? '#16a34a' : '#dc2626' }}>
                    {saveMsg}
                  </span>
                )}
              </div>

            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    complete: { background: 'rgba(34,197,94,0.15)',  color: '#16a34a' },
    error:    { background: 'rgba(239,68,68,0.1)',   color: '#dc2626' },
    running:  { background: 'rgba(99,102,241,0.15)', color: '#6366f1' },
  };
  const s = styles[status] ?? styles.running;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full capitalize"
      style={s}
    >
      {status}
    </span>
  );
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(ms) {
  if (!ms) return '—';
  return ms < 60000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${(ms / 60000).toFixed(1)}m`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function GoogleAdsMonitorPage() {
  const { token } = useAuthStore();

  const [allRuns,     setAllRuns]     = useState([]);
  const [viewedRun,   setViewedRun]   = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [running,     setRunning]     = useState(false);
  const [progress,    setProgress]    = useState('');
  const [error,       setError]       = useState(null);
  const [preset,      setPreset]      = useState('month');
  const [customDays,  setCustomDays]  = useState(30);
  const [showHistory, setShowHistory] = useState(false);
  const abortRef = useRef(null);

  const activeDays = preset === 'custom'
    ? Math.max(1, Math.min(365, customDays || 30))
    : (PRESETS.find(p => p.key === preset)?.days ?? 30);

  // fetchHistory — resetToLatest forces viewedRun to the most recent complete run
  const fetchHistory = useCallback(async (resetToLatest = false) => {
    try {
      const res = await fetch(`${API_BASE}/history`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const runs = await res.json();
      setAllRuns(runs);
      const latest = runs.find(r => r.status === 'complete') ?? null;
      if (resetToLatest) {
        setViewedRun(latest);
      } else {
        setViewedRun(prev => prev ?? latest);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleRun = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setProgress('Starting agent…');
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ days: activeDays }),
        signal:  controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = '';
      let   streamDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') { streamDone = true; break; }
          try {
            const event = JSON.parse(raw);
            if (event.type === 'progress') setProgress(event.text);
            if (event.type === 'error')    setError(event.error);
          } catch { /* ignore malformed */ }
        }
        if (streamDone) break;
      }

      await fetchHistory(true);

    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message ?? 'Run failed');
    } finally {
      setRunning(false);
      setProgress('');
    }
  }, [token, activeDays, fetchHistory]);

  const toolData    = viewedRun?.data        ?? {};
  const campaigns   = toolData.get_campaign_performance;
  const daily       = toolData.get_daily_performance;
  const searchTerms = toolData.get_search_terms;
  const suggestions = viewedRun?.suggestions ?? null;

  return (
    <div className="p-8 max-w-5xl" style={{ fontFamily: 'var(--font-body)' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-6 mb-6">

        {/* Left: title + date range selector */}
        <div>
          <h1
            className="text-2xl font-bold mb-3"
            style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}
          >
            Google Ads Monitor
          </h1>

          {/* Date range pills */}
          <div className="flex items-center gap-1 flex-wrap">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPreset(key)}
                disabled={running}
                className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  background: preset === key ? 'var(--color-primary)' : 'var(--color-surface)',
                  color:      preset === key ? '#fff'                  : 'var(--color-muted)',
                  border:     '1px solid var(--color-border)',
                  opacity:    running ? 0.5 : 1,
                }}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => setPreset('custom')}
              disabled={running}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: preset === 'custom' ? 'var(--color-primary)' : 'var(--color-surface)',
                color:      preset === 'custom' ? '#fff'                  : 'var(--color-muted)',
                border:     '1px solid var(--color-border)',
                opacity:    running ? 0.5 : 1,
              }}
            >
              Custom
            </button>
            {preset === 'custom' && (
              <span className="flex items-center gap-1.5 ml-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Last</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={customDays}
                  onChange={e => setCustomDays(Number(e.target.value))}
                  disabled={running}
                  className="w-14 px-2 py-1 rounded text-xs text-center"
                  style={{
                    background: 'var(--color-bg)',
                    border:     '1px solid var(--color-border)',
                    color:      'var(--color-text)',
                  }}
                />
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>days</span>
              </span>
            )}
          </div>
        </div>

        {/* Right: Run Now button + timing note */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={handleRun}
            disabled={running}
            className="rounded-lg px-5 py-2 text-sm font-medium transition-opacity"
            style={{
              background: 'var(--color-primary)',
              color:      '#fff',
              opacity:    running ? 0.6 : 1,
              cursor:     running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? 'Running…' : 'Run Now'}
          </button>
          <span className="text-xs text-right" style={{ color: 'var(--color-muted)' }}>
            Live data fetch takes ~70 seconds
          </span>
        </div>
      </div>

      {/* ── Running indicator ──────────────────────────────────────────────── */}
      {running && (
        <RunningIndicator
          message={progress || 'Fetching live data from Google Ads & Analytics…'}
        />
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 mb-4 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          {error}
        </div>
      )}

      {/* ── Loading / empty states ─────────────────────────────────────────── */}
      {loading && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      )}

      {!loading && !viewedRun && !running && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          No runs yet. Click Run Now to analyse campaign performance.
        </p>
      )}

      {/* ── Viewed run data ────────────────────────────────────────────────── */}
      {viewedRun && (
        <>
          <p className="text-xs mb-6" style={{ color: 'var(--color-muted)' }}>
            {fmtDate(viewedRun.run_at)}
            {viewedRun.duration_ms && ` · ${fmtDuration(viewedRun.duration_ms)}`}
            {viewedRun.token_count && ` · ${viewedRun.token_count.toLocaleString()} tokens`}
          </p>

          {campaigns?.length > 0 && (
            <Section title="Campaign Performance">
              <CampaignPerformanceTable campaigns={campaigns} />
            </Section>
          )}

          {daily?.length > 0 && (
            <Section title="Daily Spend & Conversions">
              <PerformanceChart daily={daily} />
            </Section>
          )}

          {searchTerms?.length > 0 && (
            <Section title="Search Terms">
              <SearchTermsTable terms={searchTerms} />
            </Section>
          )}

          {suggestions?.length > 0 && (
            <Section title="AI Recommendations">
              <AISuggestionsPanel suggestions={suggestions} />
            </Section>
          )}

          {viewedRun.summary && (
            <Section title="Analysis">
              <MarkdownRenderer content={viewedRun.summary} />
            </Section>
          )}
        </>
      )}

      {/* ── Agent settings ────────────────────────────────────────────────────── */}
      <AgentSettingsPanel
        token={token}
        onLookbackChange={days => {
          const match = PRESETS.find(p => p.days === days);
          if (match) { setPreset(match.key); }
          else        { setPreset('custom'); setCustomDays(days); }
        }}
      />

      {/* ── Run history ────────────────────────────────────────────────────── */}
      {allRuns.length > 0 && (
        <div
          className="rounded-xl mt-4"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            onClick={() => setShowHistory(h => !h)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium"
            style={{ color: 'var(--color-text)', background: 'transparent' }}
          >
            <span>Run History ({allRuns.length})</span>
            <span style={{ color: 'var(--color-muted)', fontSize: 11 }}>
              {showHistory ? '▲ Hide' : '▼ Show'}
            </span>
          </button>

          {showHistory && (
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                    {['Date', 'Status', 'Duration', 'Tokens', ''].map(h => (
                      <th
                        key={h}
                        className="text-left py-2 px-4 font-semibold"
                        style={{ color: 'var(--color-muted)', whiteSpace: 'nowrap', background: 'var(--color-surface)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allRuns.map(run => {
                    const isViewed = viewedRun?.id === run.id;
                    return (
                      <tr
                        key={run.id}
                        onClick={() => setViewedRun(run)}
                        style={{
                          borderBottom: '1px solid var(--color-border)',
                          cursor: 'pointer',
                          background: isViewed ? 'rgba(var(--color-primary-rgb), 0.06)' : 'transparent',
                        }}
                      >
                        <td className="py-2.5 px-4" style={{ color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                          {fmtDate(run.run_at)}
                        </td>
                        <td className="py-2.5 px-4">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="py-2.5 px-4 tabular-nums" style={{ color: 'var(--color-muted)' }}>
                          {fmtDuration(run.duration_ms)}
                        </td>
                        <td className="py-2.5 px-4 tabular-nums" style={{ color: 'var(--color-muted)' }}>
                          {run.token_count ? run.token_count.toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {isViewed ? (
                            <span className="text-xs" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Viewing</span>
                          ) : run.status === 'complete' ? (
                            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>View →</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
