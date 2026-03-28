import { useState } from 'react';
import api from '../utils/apiClient';

// ─── Shared UI primitives (same pattern as other admin pages) ─────────────────

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

// ─── Result row ───────────────────────────────────────────────────────────────

function ResultRow({ name, ok, detail }) {
  return (
    <div
      className="flex items-start gap-3 py-3 border-b last:border-0"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <span
        className="mt-0.5 shrink-0 text-base leading-none"
        style={{ color: ok ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)' }}
      >
        {ok ? '✓' : '✗'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{name}</p>
        <p className="text-xs mt-0.5 break-words" style={{ color: 'var(--color-muted)' }}>{detail}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDiagnosticsPage() {
  const [loading,  setLoading]  = useState(false);
  const [results,  setResults]  = useState(null);
  const [error,    setError]    = useState(null);

  async function runDiagnostics() {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res  = await api.post('/api/admin/diagnostics');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data.results);
    } catch (err) {
      setError(err.message ?? 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }

  const passed = results?.filter(r => r.ok).length ?? 0;
  const total  = results?.length ?? 0;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
          Diagnostics
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          Tests every credential and service connection used by the platform.
        </p>
      </div>

      <Card title="Service Checks" description="Database, Anthropic API, Google OAuth, Google Ads, Google Analytics">
        {results && (
          <div className="mb-4">
            <p
              className="text-sm font-medium mb-3"
              style={{ color: passed === total ? 'var(--color-success, #22c55e)' : 'var(--color-danger, #ef4444)' }}
            >
              {passed}/{total} checks passed
            </p>
            {results.map(r => (
              <ResultRow key={r.name} {...r} />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm mb-4" style={{ color: 'var(--color-danger, #ef4444)' }}>
            {error}
          </p>
        )}

        <button
          onClick={runDiagnostics}
          disabled={loading}
          className="px-4 py-2 rounded-xl text-sm font-medium transition-opacity"
          style={{
            background: 'var(--color-primary)',
            color:      '#fff',
            opacity:    loading ? 0.6 : 1,
            cursor:     loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Running…' : results ? 'Run Again' : 'Run Diagnostics'}
        </button>
      </Card>
    </div>
  );
}
