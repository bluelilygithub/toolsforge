import { Navigate, Outlet } from 'react-router-dom';
import useAuthStore from '../stores/authStore';

export default function RequireRole({ allowedRoles }) {
  const user = useAuthStore((s) => s.user);

  const hasRole = allowedRoles.some(r =>
    user?.roles?.some(ur => ur.name === r)
  );

  if (hasRole) return <Outlet />;

  return <Navigate to="/" replace />;
}
