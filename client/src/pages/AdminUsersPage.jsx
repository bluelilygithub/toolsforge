import { useEffect, useState } from 'react';
import { useIcon } from '../providers/IconProvider';
import { useToast } from '../components/Toast';
import api from '../utils/apiClient';

const ROLES = ['org_member', 'org_admin'];

function AdminUsersPage() {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const getIcon = useIcon();
  const showToast = useToast();

  const fetchUsers = () => {
    setLoading(true);
    api.get('/api/admin/users')
      .then(r => r.json())
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(() => showToast('Failed to load users', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Users</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Manage organisation members and roles
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchUsers}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:opacity-60 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
            title="Refresh"
          >
            {getIcon('refresh-cw', { size: 15 })}
          </button>
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            {getIcon('plus', { size: 14 })}
            Invite User
          </button>
        </div>
      </div>

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
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {users.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No users found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Email', 'Status', 'Roles', 'Joined'].map(col => (
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
                {users.map((u, i) => (
                  <tr
                    key={u.id}
                    style={{
                      borderBottom: i < users.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: 'var(--color-bg)',
                    }}
                  >
                    <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>
                      {u.email}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          background: u.is_active ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                          color: u.is_active ? '#16a34a' : '#d97706',
                        }}
                      >
                        {u.is_active ? 'Active' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles?.length > 0 ? u.roles.map(r => (
                          <span
                            key={r.name}
                            className="px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              background: r.name === 'org_admin'
                                ? `rgba(var(--color-primary-rgb), 0.12)`
                                : 'var(--color-surface)',
                              color: r.name === 'org_admin' ? 'var(--color-primary)' : 'var(--color-muted)',
                              border: '1px solid var(--color-border)',
                            }}
                          >
                            {r.name}
                          </span>
                        )) : (
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted)' }}>
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvited={() => { fetchUsers(); setShowInvite(false); }}
        />
      )}
    </div>
  );
}

function InviteModal({ onClose, onInvited }) {
  const [email, setEmail]     = useState('');
  const [role, setRole]       = useState('org_member');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const showToast = useToast();
  const getIcon = useIcon();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/api/admin/invite', { email, roleName: role });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Invite failed'); return; }
      setResult(data);
      showToast(`Invitation created for ${email}`);
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(result.activationUrl);
    showToast('Link copied to clipboard');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Invite User
          </h2>
          <button
            onClick={onClose}
            className="opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        {!result ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="colleague@example.com"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Role
              </label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {loading ? 'Creating…' : 'Create Invitation'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Invitation created for <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{result.email}</span>.
              Share this activation link with them:
            </p>

            <div
              className="rounded-xl border p-3 text-xs font-mono break-all"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {result.activationUrl}
            </div>

            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Expires: {new Date(result.expiresAt).toLocaleString()}
            </p>

            <div className="flex gap-2">
              <button
                onClick={copyLink}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-primary)' }}
              >
                {getIcon('copy', { size: 14 })}
                Copy Link
              </button>
              <button
                onClick={onInvited}
                className="flex-1 py-2.5 rounded-xl text-sm border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminUsersPage;
