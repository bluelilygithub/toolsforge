import { useEffect, useState } from 'react';
import { useIcon } from '../providers/IconProvider';
import { useToast } from '../components/Toast';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';

const ORG_ROLES = ['org_member', 'org_admin'];

const TOOL_ROLES = [
  { label: 'Date & Time — Basic',    value: 'datetime_viewer',   scopeId: 'datetime' },
  { label: 'Date & Time — Extended', value: 'datetime_extended', scopeId: 'datetime' },
];

function AdminUsersPage() {
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [manageUser, setManageUser] = useState(null);
  const [resendUser, setResendUser] = useState(null);
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
                  {['Email', 'Status', 'Roles', 'Joined', ''].map(col => (
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
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {!u.is_active && (
                          <button
                            onClick={() => setResendUser(u)}
                            className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            Resend Invite
                          </button>
                        )}
                        <button
                          onClick={() => setManageUser(u)}
                          className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          Manage Roles
                        </button>
                      </div>
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

      {manageUser && (
        <RoleModal
          user={manageUser}
          onClose={() => setManageUser(null)}
        />
      )}

      {resendUser && (
        <ResendModal
          user={resendUser}
          onClose={() => setResendUser(null)}
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
                {ORG_ROLES.map(r => (
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
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}
              >
                {getIcon('mail', { size: 15 })}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Invitation sent
                </p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  Activation email delivered to <strong>{result.email}</strong>.
                  Link expires {new Date(result.expiresAt).toLocaleString()}.
                </p>
              </div>
            </div>

            <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <summary className="cursor-pointer hover:opacity-70 select-none">
                Copy link manually (if email doesn't arrive)
              </summary>
              <div className="mt-2 space-y-2">
                <div
                  className="rounded-xl border p-3 font-mono break-all"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {result.activationUrl}
                </div>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {getIcon('copy', { size: 12 })}
                  Copy link
                </button>
              </div>
            </details>

            <button
              onClick={onInvited}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RoleModal({ user, onClose }) {
  const [roles, setRoles]         = useState([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [grantRole, setGrantRole] = useState('');
  const [working, setWorking]     = useState(false);
  const showToast = useToast();
  const getIcon = useIcon();
  const currentUser = useAuthStore(s => s.user);

  const fetchRoles = () => {
    setLoadingRoles(true);
    api.get(`/api/admin/users/${user.id}/roles`)
      .then(r => r.json())
      .then(data => setRoles(Array.isArray(data) ? data : []))
      .catch(() => showToast('Failed to load roles', 'error'))
      .finally(() => setLoadingRoles(false));
  };

  useEffect(() => { fetchRoles(); }, []);

  const toolRoles   = roles.filter(r => r.scope_type === 'tool');
  const globalRoles = roles.filter(r => r.scope_type === 'global');
  const isAdmin     = globalRoles.some(r => r.name === 'org_admin');
  const isSelf      = currentUser?.id === user.id;

  const handleGrant = async () => {
    const target = TOOL_ROLES.find(r => r.value === grantRole);
    if (!target) return;
    setWorking(true);
    try {
      const res = await api.post(`/api/admin/users/${user.id}/grant-role`, {
        roleName: target.value,
        scopeType: 'tool',
        scopeId: target.scopeId,
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to grant role', 'error'); return; }
      showToast('Role granted');
      fetchRoles();
    } catch {
      showToast('Network error', 'error');
    } finally {
      setWorking(false);
    }
  };

  const handleRevoke = async (role) => {
    setWorking(true);
    try {
      const res = await api.post(`/api/admin/users/${user.id}/revoke-role`, {
        roleName: role.name,
        scopeType: role.scope_type,
        scopeId: role.scope_id,
      });
      if (!res.ok) { showToast('Failed to revoke role', 'error'); return; }
      showToast('Role revoked');
      fetchRoles();
    } catch {
      showToast('Network error', 'error');
    } finally {
      setWorking(false);
    }
  };

  const handleToggleAdmin = async () => {
    if (isSelf) {
      showToast('You cannot change your own admin role', 'error');
      return;
    }
    setWorking(true);
    try {
      const endpoint = isAdmin ? 'revoke-role' : 'grant-role';
      const res = await api.post(`/api/admin/users/${user.id}/${endpoint}`, {
        roleName: 'org_admin',
        scopeType: 'global',
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || 'Failed to update role', 'error'); return; }
      showToast(isAdmin ? 'Admin role removed' : 'Admin role granted');
      fetchRoles();
    } catch {
      showToast('Network error', 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-5"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Manage Roles
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-muted)' }}
          >
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        {/* Organisation role */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Organisation Role
          </p>
          {loadingRoles ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          ) : (
            <div
              className="flex items-center justify-between px-3 py-2.5 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                  {isAdmin ? 'org_admin' : 'org_member'}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {isAdmin ? 'Full admin access' : 'Standard member'}
                </p>
              </div>
              <button
                onClick={handleToggleAdmin}
                disabled={working || isSelf}
                title={isSelf ? 'You cannot change your own admin role' : undefined}
                className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity disabled:opacity-30"
                style={{ color: isAdmin ? '#ef4444' : 'var(--color-primary)' }}
              >
                {isAdmin ? 'Remove admin' : 'Make admin'}
              </button>
            </div>
          )}
        </div>

        {/* Current tool roles */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
            Tool Access
          </p>
          {loadingRoles ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
          ) : toolRoles.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No tool access granted.</p>
          ) : (
            <div className="space-y-2">
              {toolRoles.map(role => (
                <div
                  key={`${role.name}-${role.scope_id}`}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl border"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <div>
                    <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{role.name}</p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {role.scope_type} · {role.scope_id}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRevoke(role)}
                    disabled={working}
                    className="text-xs px-2 py-1 rounded-lg hover:opacity-70 transition-opacity disabled:opacity-30"
                    style={{ color: '#ef4444' }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Grant new role */}
        <div className="pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3 mt-4" style={{ color: 'var(--color-muted)' }}>
            Grant Access
          </p>
          <div className="flex gap-2">
            <select
              value={grantRole}
              onChange={e => setGrantRole(e.target.value)}
              className="flex-1 px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: grantRole ? 'var(--color-text)' : 'var(--color-muted)' }}
            >
              <option value="" disabled>Select a role…</option>
              {TOOL_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button
              onClick={handleGrant}
              disabled={working || !grantRole}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              Grant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResendModal({ user, onClose }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');
  const showToast = useToast();
  const getIcon = useIcon();

  const handleResend = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/api/admin/users/${user.id}/resend-invite`, {});
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to resend invitation'); return; }
      setResult(data);
      showToast('New invitation link generated');
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
            Resend Invitation
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
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Generate a new 48-hour activation link for{' '}
              <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{user.email}</span>.
              Any previously sent link will be invalidated.
            </p>

            {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}

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
                onClick={handleResend}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {loading ? 'Generating…' : 'Generate New Link'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}
              >
                {getIcon('mail', { size: 15 })}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Invitation resent
                </p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  New activation email delivered to <strong>{result.email}</strong>.
                  Link expires {new Date(result.expiresAt).toLocaleString()}.
                </p>
              </div>
            </div>

            <details className="text-xs" style={{ color: 'var(--color-muted)' }}>
              <summary className="cursor-pointer hover:opacity-70 select-none">
                Copy link manually (if email doesn't arrive)
              </summary>
              <div className="mt-2 space-y-2">
                <div
                  className="rounded-xl border p-3 font-mono break-all"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {result.activationUrl}
                </div>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {getIcon('copy', { size: 12 })}
                  Copy link
                </button>
              </div>
            </details>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-primary)' }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminUsersPage;
