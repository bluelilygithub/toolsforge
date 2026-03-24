import { useState, useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import Sidebar from './Sidebar';

function Layout() {
  const isMobileNow = () => typeof window !== 'undefined' && window.innerWidth < 640;
  const [sidebarOpen, setSidebarOpen] = useState(!isMobileNow());
  const [isMobile, setIsMobile] = useState(isMobileNow());

  const { token, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const getIcon = useIcon();

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      if (!mobile) setSidebarOpen(true);
    };
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    clearAuth();
    navigate('/login', { replace: true });
  };

  const sidebarStyle = isMobile
    ? {
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 40,
        width: '240px',
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-240px)',
        transition: 'transform 0.2s ease',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }
    : {
        width: sidebarOpen ? '240px' : '0px',
        transition: 'width 0.2s',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        flexShrink: 0,
        overflow: 'hidden',
      };

  return (
    <div
      className="flex overflow-hidden"
      style={{ height: '100dvh', background: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-30"
          style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside style={sidebarStyle}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex-shrink-0 h-11 flex items-center gap-2 px-3 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity flex-shrink-0"
            style={{ color: 'var(--color-muted)' }}
            title="Toggle sidebar"
          >
            {getIcon('chevron-right', {
              size: 16,
              style: { transform: sidebarOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' },
            })}
          </button>

          {/* App name shown in header only when sidebar is closed */}
          {!sidebarOpen && (
            <Link
              to="/"
              className="text-sm font-semibold tracking-tight flex-shrink-0"
              style={{ color: 'var(--color-text)' }}
            >
              ToolsForge
            </Link>
          )}

          <div className="flex-1" />

          <Link
            to="/settings"
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: location.pathname === '/settings' ? 'var(--color-primary)' : 'var(--color-muted)' }}
            title="Settings"
          >
            {getIcon('settings', { size: 16 })}
          </Link>

          <button
            onClick={handleLogout}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            title="Sign out"
          >
            {getIcon('log-out', { size: 16 })}
          </button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Layout;
