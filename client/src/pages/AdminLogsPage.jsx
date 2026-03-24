import { useEffect, useState, useCallback, useRef } from 'react';
import { useIcon } from '../providers/IconProvider';
import { useToast } from '../components/Toast';
import api from '../utils/apiClient';

const LEVELS = ['all', 'error', 'warn'];

const LEVEL_STYLE = {
  error: { bg: 'rgba(239,68,68,0.10)',  color: '#ef4444' },
  warn:  { bg: 'rgba(245,158,11,0.10)', color: '#d97706' },
};

function AdminLogsPage() {
  const [logs, setLogs]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [level, setLevel]       = useState('all');
  const [search, setSearch]     = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset]     = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const intervalRef = useRef(null);
  const showToast = useToast();
  const getIcon = useIcon();
  const LIMIT = 50;

  const fetchLogs = useCallback(() => {
    const params = new URLSearchParams({ limit: LIMIT, offset });
    if (level !== 'all') params.set('level', level);
    if (search) params.set('search', search);

    api.get(`/api/admin/logs?${params}`)
      .then(r => r.json())
      .then(data => {
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      })
      .catch(() => showToast('Failed to load logs', 'error'))
      .finally(() => setLoading(false));
  }, [level, search, offset]);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 15000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, fetchLogs]);

  const handleSearch = (e) => {
    e.preventDefault();
    setOffset(0);
    setSearch(searchInput);
  };

  const handleLevelChange = (l) => {
    setLevel(l);
    setOffset(0);
  };

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Logs</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Warnings and errors recorded by the server
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
            style={{
              borderColor: autoRefresh ? 'var(--color-primary)' : 'var(--color-border)',
              color: autoRefresh ? 'var(--color-primary)' : 'var(--color-muted)',
              background: autoRefresh ? `rgba(var(--color-primary-rgb), 0.08)` : 'transparent',
            }}
          >
            {getIcon('refresh-cw', { size: 12 })}
            {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh'}
          </button>
          <button
            onClick={() => { setLoading(true); fetchLogs(); }}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            title="Refresh"
          >
            {getIcon('refresh-cw', { size: 15 })}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Level tabs */}
        <div
          className="flex rounded-xl border overflow-hidden text-xs"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {LEVELS.map(l => (
            <button
              key={l}
              onClick={() => handleLevelChange(l)}
              className="px-3 py-1.5 font-medium capitalize transition-colors"
              style={{
                background: level === l ? 'var(--color-primary)' : 'var(--color-surface)',
                color: level === l ? '#fff' : 'var(--color-muted)',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 min-w-48">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search messages…"
            className="flex-1 px-3 py-1.5 rounded-xl border text-sm outline-none"
            style={{
              background: 'var(--color-bg)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); setOffset(0); }}
              className="text-xs hover:opacity-70"
              style={{ color: 'var(--color-muted)' }}
            >
              Clear
            </button>
          )}
        </form>

        <p className="text-xs ml-auto" style={{ color: 'var(--color-muted)' }}>
          {total} {total === 1 ? 'entry' : 'entries'}
        </p>
      </div>

      {/* Log table */}
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="flex gap-1.5">
              {[0, 150, 300].map(delay => (
                <span
                  key={delay}
                  className="w-2 h-2 rounded-full animate-bounce"
                  style={{ background: 'var(--color-primary)', animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No log entries found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                {['Time', 'Level', 'Message', ''].map(col => (
                  <th
                    key={col}
                    className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => {
                const style = LEVEL_STYLE[log.level] || { bg: 'var(--color-surface)', color: 'var(--color-muted)' };
                const isExpanded = expanded === log.id;
                const hasMeta = log.meta && Object.keys(log.meta).length > 0;
                return (
                  <>
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        background: 'var(--color-bg)',
                      }}
                    >
                      <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase"
                          style={{ background: style.bg, color: style.color }}
                        >
                          {log.level}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>
                        {log.message}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {hasMeta && (
                          <button
                            onClick={() => setExpanded(isExpanded ? null : log.id)}
                            className="text-xs hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            {getIcon(isExpanded ? 'chevron-up' : 'chevron-down', { size: 14 })}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && hasMeta && (
                      <tr
                        key={`${log.id}-meta`}
                        style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                      >
                        <td colSpan={4} className="px-4 py-3">
                          <pre
                            className="text-xs rounded-xl p-3 overflow-x-auto"
                            style={{
                              background: 'var(--color-bg)',
                              color: 'var(--color-text)',
                              border: '1px solid var(--color-border)',
                            }}
                          >
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
            disabled={offset === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70 disabled:opacity-30"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            {getIcon('chevron-left', { size: 12 })}
            Previous
          </button>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Page {currentPage} of {totalPages}
          </p>
          <button
            onClick={() => setOffset(o => o + LIMIT)}
            disabled={offset + LIMIT >= total}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70 disabled:opacity-30"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Next
            {getIcon('chevron-right', { size: 12 })}
          </button>
        </div>
      )}
    </div>
  );
}

export default AdminLogsPage;
