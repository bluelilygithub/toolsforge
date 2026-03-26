import { useNavigate } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import useToolStore from '../stores/toolStore';
import GlobalSearchBar from './GlobalSearchBar';

export default function TopNav({ onMenuToggle }) {
  const { user, clearAuth } = useAuthStore();
  const { resetTool } = useToolStore();
  const navigate = useNavigate();

  function handleLogout() {
    clearAuth();
    resetTool();
    try {
      const raw = localStorage.getItem('toolStore');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.state && typeof parsed.state === 'object') {
          // reset persist store state if accessible
        }
      }
      // attempt usePersistStore reset if it ever exists globally
      if (typeof window.__persistStoreReset === 'function') {
        window.__persistStoreReset();
      }
    } catch (_) {
      // do not block logout
    }
    navigate('/login');
  }

  const isAdmin = user?.role === 'org_admin';

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 bg-white border-b border-slate-200 flex items-center px-4 gap-4">
      {/* Mobile hamburger */}
      <button
        className="md:hidden p-1 text-slate-700 hover:text-slate-900 shrink-0"
        onClick={onMenuToggle}
        aria-label="Toggle menu"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="2" y1="5" x2="20" y2="5" />
          <line x1="2" y1="11" x2="20" y2="11" />
          <line x1="2" y1="17" x2="20" y2="17" />
        </svg>
      </button>

      {/* Left */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-bold text-slate-900 text-base leading-none">ToolsForge</span>
        <span className="w-px h-4 bg-slate-300" />
        <span className="text-sm text-slate-500">{user?.org_name}</span>
      </div>

      {/* Centre */}
      <div className="flex-1 flex justify-center">
        <GlobalSearchBar />
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-sm text-slate-600 truncate max-w-[180px]">{user?.email}</span>

        {isAdmin ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
            Admin
          </span>
        ) : (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            Member
          </span>
        )}

        <button
          onClick={handleLogout}
          className="text-sm text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-3 py-1 rounded transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
