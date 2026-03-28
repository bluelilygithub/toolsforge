import { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import useToolStore from '../stores/toolStore';
import { getPermittedTools } from '../config/tools';
import { useIcon } from '../providers/IconProvider';
import TopNav from './TopNav';

const ADMIN_LINKS = [
  { path: '/admin/users',           label: 'Users',            icon: 'users' },
  { path: '/admin/ai-models',       label: 'AI Models',        icon: 'cpu' },
  { path: '/admin/agents',          label: 'Agents',           icon: 'bot' },
  { path: '/admin/email-templates', label: 'Email Templates',  icon: 'mail' },
  { path: '/admin/security',        label: 'Security',         icon: 'shield' },
  { path: '/admin/app-settings',    label: 'App Settings',     icon: 'globe' },
  { path: '/admin/logs',            label: 'Logs',             icon: 'scroll-text' },
  { path: '/admin/diagnostics',    label: 'Diagnostics',      icon: 'activity' },
];

function NavItem({ to, end, iconName, label, collapsed, onClick }) {
  const getIcon = useIcon();
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className="flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg transition-all text-sm"
      style={({ isActive }) => ({
        background:  isActive ? 'rgba(var(--color-primary-rgb), 0.1)' : 'transparent',
        color:       isActive ? 'var(--color-primary)' : 'var(--color-text)',
        fontWeight:  isActive ? 600 : 400,
      })}
    >
      <span className="shrink-0" style={{ color: 'inherit' }}>
        {getIcon(iconName, { size: 15 })}
      </span>
      {!collapsed && (
        <span className="whitespace-nowrap overflow-hidden">{label}</span>
      )}
    </NavLink>
  );
}

function SidebarLinks({ tools, collapsed, onToggle, onLinkClick, isAdmin }) {
  const getIcon = useIcon();

  return (
    <div className="flex flex-col h-full">
      <nav className="flex-1 py-3 overflow-y-auto">
        <NavItem to="/" end iconName="home" label="Dashboard" collapsed={collapsed} onClick={onLinkClick} />

        {!collapsed && (
          <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-muted)' }}>
            Tools
          </p>
        )}
        {tools.map((tool) => (
          <NavItem
            key={tool.id}
            to={tool.path}
            iconName={tool.lucideIcon}
            label={tool.name}
            collapsed={collapsed}
            onClick={onLinkClick}
          />
        ))}

        {isAdmin && (
          <>
            {!collapsed && (
              <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-muted)' }}>
                Admin
              </p>
            )}
            {ADMIN_LINKS.map((link) => (
              <NavItem
                key={link.path}
                to={link.path}
                iconName={link.icon}
                label={link.label}
                collapsed={collapsed}
                onClick={onLinkClick}
              />
            ))}
          </>
        )}
      </nav>

      <div className="p-2 space-y-1" style={{ borderTop: '1px solid var(--color-border)' }}>
        <NavItem to="/settings" iconName="settings" label="Settings" collapsed={collapsed} onClick={onLinkClick} />
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center py-2 rounded-lg transition-all text-sm"
          style={{ color: 'var(--color-muted)' }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {getIcon(collapsed ? 'chevron-right' : 'chevron-left', { size: 15 })}
        </button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const { user } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useToolStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  const primaryRole = user?.roles?.find(r => r.scope_type === 'global')?.name ?? null;
  const tools = getPermittedTools(primaryRole);
  const isAdmin = primaryRole === 'org_admin';
  const sidebarWidth = sidebarCollapsed ? 56 : 220;

  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 768) setMobileOpen(false);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg)' }}>
      <TopNav onMenuToggle={() => setMobileOpen((o) => !o)} />

      {/* Fixed desktop sidebar */}
      <aside
        className="hidden md:flex flex-col fixed left-0 top-14 bottom-0 z-40 overflow-hidden"
        style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', width: sidebarWidth, transition: 'width 200ms ease' }}
      >
        <SidebarLinks
          tools={tools}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          isAdmin={isAdmin}
        />
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className="fixed left-0 top-14 bottom-0 z-50 flex flex-col md:hidden overflow-hidden"
        style={{
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          width: 220,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 200ms ease',
        }}
      >
        <SidebarLinks
          tools={tools}
          collapsed={false}
          onToggle={toggleSidebar}
          onLinkClick={() => setMobileOpen(false)}
          isAdmin={isAdmin}
        />
      </aside>

      {/* Layout: spacer mirrors fixed sidebar, main takes remaining width */}
      <div className="flex pt-14 min-h-screen">
        {/* In-flow spacer — desktop only, mirrors fixed sidebar width */}
        <div
          className="hidden md:block shrink-0"
          style={{ width: sidebarWidth, transition: 'width 200ms ease' }}
        />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
