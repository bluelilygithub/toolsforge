import { Link, useLocation } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';

function NavItem({ to, icon, label, active }) {
  const getIcon = useIcon();
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all"
      style={{
        background: active ? `rgba(var(--color-primary-rgb), 0.1)` : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text)',
        fontWeight: active ? 600 : 400,
      }}
    >
      <span style={{ color: active ? 'var(--color-primary)' : 'var(--color-muted)' }}>
        {getIcon(icon, { size: 15 })}
      </span>
      {label}
    </Link>
  );
}

function SectionLabel({ label }) {
  return (
    <p
      className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
      style={{ color: 'var(--color-muted)' }}
    >
      {label}
    </p>
  );
}

function Sidebar({ onClose }) {
  const location = useLocation();
  const { user } = useAuthStore();
  const isActive = (path) => location.pathname === path;
  const isOrgAdmin = user?.roles?.some(r => r.name === 'org_admin');

  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div
        className="flex items-center gap-2.5 px-4 h-11 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: 'var(--color-primary)', color: '#fff' }}
        >
          ⚒
        </div>
        <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--color-text)' }}>
          ToolsForge
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <NavItem to="/" icon="home" label="Dashboard" active={isActive('/')} />

        {/* Tools will be listed here dynamically as they are installed */}

        {isOrgAdmin && (
          <>
            <SectionLabel label="Admin" />
            <NavItem to="/admin/users" icon="users" label="Users" active={isActive('/admin/users')} />
            <NavItem to="/admin/logs" icon="scroll-text" label="Logs" active={isActive('/admin/logs')} />
          </>
        )}
      </nav>

      {/* Bottom */}
      <div
        className="flex-shrink-0 border-t px-2 py-2"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <NavItem to="/settings" icon="settings" label="Settings" active={isActive('/settings')} />
      </div>
    </div>
  );
}

export default Sidebar;
