import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import api from '../utils/apiClient';

function DashboardPage() {
  const { user } = useAuthStore();
  const [tools, setTools] = useState([]);
  const [org, setOrg] = useState(null);

  useEffect(() => {
    api.get('/api/tools')
      .then(r => r.json())
      .then(data => setTools(Array.isArray(data) ? data : []))
      .catch(() => {});

    api.get('/api/org')
      .then(r => r.json())
      .then(data => setOrg(data))
      .catch(() => {});
  }, []);

  const isOrgAdmin = user?.roles?.some(r => r.name === 'org_admin');

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
          {org ? org.name : 'Dashboard'}
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Signed in as <span style={{ color: 'var(--color-text)' }}>{user?.email}</span>
          {isOrgAdmin && (
            <span
              className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: `rgba(var(--color-primary-rgb), 0.12)`, color: 'var(--color-primary)' }}
            >
              Admin
            </span>
          )}
        </p>
      </div>

      {/* Tools section */}
      <div>
        <h2
          className="text-xs font-semibold uppercase tracking-wider mb-4"
          style={{ color: 'var(--color-muted)' }}
        >
          Installed Tools
        </h2>

        {tools.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-10 text-center"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div
              className="text-3xl mb-3"
              style={{ color: 'var(--color-border)' }}
            >
              ⚒
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              No tools installed yet
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Tools will appear here as they are added to the platform.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolCard({ tool }) {
  const card = (
    <div
      className="rounded-2xl border p-5 flex flex-col gap-3 transition-opacity"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        opacity: tool.enabled ? 1 : 0.6,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            {tool.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            v{tool.version}
          </p>
        </div>
        <span
          className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{
            background: tool.enabled
              ? 'rgba(34,197,94,0.12)'
              : `rgba(var(--color-primary-rgb), 0.08)`,
            color: tool.enabled ? '#16a34a' : 'var(--color-muted)',
          }}
        >
          {tool.enabled ? 'Active' : 'Inactive'}
        </span>
      </div>

      {!tool.enabled && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          This tool is not yet enabled.
        </p>
      )}
    </div>
  );

  return tool.enabled
    ? <Link to={`/tools/${tool.slug}`} className="block hover:opacity-80 transition-opacity">{card}</Link>
    : card;
}

export default DashboardPage;
