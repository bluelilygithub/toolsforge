import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';

function AuthGuard({ children }) {
  const { token, setAuth, clearAuth } = useAuthStore();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
      setChecking(false);
      return;
    }
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Unauthorized');
      })
      .then(data => {
        // Keep user data fresh (roles may have changed)
        setAuth(token, data.user);
        setChecking(false);
      })
      .catch(() => {
        clearAuth();
        navigate('/login', { replace: true });
        setChecking(false);
      });
  }, []);

  if (checking) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: '100dvh', background: 'var(--color-bg)' }}
      >
        <div className="flex gap-1.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-2 h-2 rounded-full animate-bounce"
              style={{ background: 'var(--color-primary)', animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return children;
}

export default AuthGuard;
