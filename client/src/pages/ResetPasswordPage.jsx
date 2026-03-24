import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';

function ResetPasswordPage() {
  const { token } = useParams();
  const navigate  = useNavigate();
  const getIcon   = useIcon();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [done, setDone]         = useState(false);
  const [error, setError]       = useState('');

  // Validate the token on mount
  useEffect(() => {
    fetch(`/api/auth/reset-password/${token}`)
      .then(res => {
        if (!res.ok) throw new Error('invalid');
        return res.json();
      })
      .then(data => {
        setEmail(data.email);
        setTokenValid(true);
      })
      .catch(() => setTokenValid(false))
      .finally(() => setValidating(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reset failed'); return; }
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 3000);
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
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            ⚒
          </div>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>
            ToolsForge
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Set a new password
          </p>
        </div>

        <div
          className="rounded-2xl border p-6 space-y-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {validating ? (
            <div className="flex justify-center py-6">
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
          ) : !tokenValid ? (
            <div className="space-y-4 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}
              >
                {getIcon('alert-circle', { size: 20 })}
              </div>
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                  Link invalid or expired
                </p>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  This password reset link is no longer valid. Please request a new one.
                </p>
              </div>
              <Link
                to="/forgot-password"
                className="block text-sm font-medium"
                style={{ color: 'var(--color-primary)' }}
              >
                Request new link
              </Link>
            </div>
          ) : done ? (
            <div className="space-y-4 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a' }}
              >
                {getIcon('check-circle', { size: 20 })}
              </div>
              <div>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                  Password updated
                </p>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  Your password has been reset. Redirecting to sign in…
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {email && (
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  Resetting password for <strong style={{ color: 'var(--color-text)' }}>{email}</strong>
                </p>
              )}

              <div>
                <label
                  className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--color-muted)' }}
                >
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoFocus
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                    style={{
                      background: 'var(--color-bg)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)',
                    }}
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

              <div>
                <label
                  className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
                  style={{ color: 'var(--color-muted)' }}
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full px-3 py-2.5 pr-10 rounded-xl border text-sm outline-none"
                    style={{
                      background: 'var(--color-bg)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    {getIcon(showConfirm ? 'eye-off' : 'eye', { size: 14 })}
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}
              >
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default ResetPasswordPage;
