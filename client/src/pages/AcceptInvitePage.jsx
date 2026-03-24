import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import { useIcon } from '../providers/IconProvider';

function AcceptInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const getIcon = useIcon();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [status, setStatus]     = useState('loading'); // loading | ready | error | success
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  // Validate the token on mount
  useEffect(() => {
    fetch(`/api/invitations/${token}`)
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        setEmail(data.email);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Activation failed'); return; }

      setAuth(data.token, data.user);
      navigate('/', { replace: true });
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl font-bold"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}
          >
            ⚒
          </div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>ToolsForge</h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Accept your invitation</p>
        </div>

        {status === 'loading' && (
          <div className="flex justify-center py-8">
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
        )}

        {status === 'error' && (
          <div
            className="rounded-2xl border p-6 text-center space-y-3"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Invalid or expired invitation
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              This link may have already been used or has expired. Contact your administrator for a new invitation.
            </p>
          </div>
        )}

        {status === 'ready' && (
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border p-6 space-y-4"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            {/* Email (read-only) */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Email
              </label>
              <div
                className="px-3 py-2.5 rounded-xl border text-sm"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {email}
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Set Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {getIcon(showPw ? 'eye-off' : 'eye', { size: 14 })}
                </button>
              </div>
            </div>

            {/* Confirm */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Confirm Password
              </label>
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {loading ? 'Activating…' : 'Activate Account'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default AcceptInvitePage;
