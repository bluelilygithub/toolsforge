import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import { TOOLS } from '../config/tools';

export default function GlobalSearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState('');

  const { token } = useAuthStore();
  const navigate = useNavigate();
  const containerRef = useRef(null);

  useEffect(() => {
    function handleMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  async function runSearch() {
    if (query.trim().length < 2) return;
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(false);
    setResults(null);
    setSearched(q);
    setOpen(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: q, limit: 10 }),
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setResults(data.results ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') runSearch();
  }

  function handleResultClick(result) {
    const tool = TOOLS.find((t) => t.id === result.tool_scope);
    navigate(tool ? tool.path : '/');
    setOpen(false);
  }

  const showDropdown = open && !loading && (error || results !== null);

  return (
    <div ref={containerRef} className="relative w-72">
      <div className="flex items-center border border-slate-200 rounded bg-white overflow-hidden">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          maxLength={500}
          placeholder="Search your workspace..."
          className="flex-1 text-sm px-3 py-1.5 outline-none bg-transparent text-slate-800 placeholder-slate-400 disabled:opacity-50"
        />
        <button
          onClick={runSearch}
          disabled={loading}
          className="shrink-0 flex items-center justify-center w-8 h-8 text-slate-400 hover:text-slate-700 transition-colors disabled:cursor-not-allowed"
          aria-label="Search"
        >
          {loading ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.9 14.32a8 8 0 111.414-1.414l4.387 4.387-1.414 1.414-4.387-4.387zM8 14A6 6 0 108 2a6 6 0 000 12z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>

      {showDropdown && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded shadow-lg z-50">
          {error ? (
            <p className="text-sm text-red-500 px-3 py-2">Search unavailable</p>
          ) : results && results.length === 0 ? (
            <p className="text-sm text-slate-400 px-3 py-2">No results for {searched}</p>
          ) : (
            <ul>
              {results.map((result, i) => (
                <li key={i}>
                  <button
                    onClick={() => handleResultClick(result)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                  >
                    <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {result.tool_scope}
                    </span>
                    <span className="flex-1 text-sm text-slate-700 truncate">
                      {result.content_preview?.slice(0, 80)}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {Math.round(result.similarity_score * 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
