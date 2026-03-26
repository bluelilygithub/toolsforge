import { useNavigate } from 'react-router-dom';
import { TOOLS, getPermittedTools } from '../config/tools';
import useToolStore from '../stores/toolStore';
import useAuthStore from '../stores/authStore';
import { useIcon } from '../providers/IconProvider';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { lastVisitedTool, setLastVisitedTool } = useToolStore();
  const getIcon = useIcon();

  const permittedTools = getPermittedTools(user?.role);
  const lastTool = lastVisitedTool ? TOOLS.find(t => t.id === lastVisitedTool) : null;

  return (
    <div className="p-8" style={{ fontFamily: 'var(--font-body)' }}>
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}>
          {getGreeting()}, {user?.email}
        </h1>
        <p className="mt-1" style={{ color: 'var(--color-muted)' }}>{user?.org_name} workspace</p>
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {permittedTools.map(tool => (
          <div
            key={tool.id}
            className="rounded-xl shadow-sm p-6 flex flex-col items-center text-center"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div className="mb-3" style={{ color: 'var(--color-primary)' }}>
              {getIcon(tool.lucideIcon, { size: 32 })}
            </div>
            <div className="font-bold text-lg mb-1" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-heading)' }}>
              {tool.name}
            </div>
            <div className="text-sm mb-4 flex-1" style={{ color: 'var(--color-muted)' }}>
              {tool.description}
            </div>
            <button
              className="w-full rounded-lg py-2 text-sm transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-primary)', color: '#fff' }}
              onClick={() => {
                setLastVisitedTool(tool.id);
                navigate(tool.path);
              }}
            >
              Open →
            </button>
          </div>
        ))}
      </div>

      {/* Last used */}
      {lastTool && (
        <div className="mt-8">
          <span
            className="text-sm transition-opacity hover:opacity-70 cursor-pointer"
            style={{ color: 'var(--color-muted)' }}
            onClick={() => navigate(lastTool.path)}
          >
            Last used: {lastTool.name} →
          </span>
        </div>
      )}
    </div>
  );
}
