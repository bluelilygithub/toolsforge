import { Navigate, Outlet } from 'react-router-dom';
import useAuthStore from '../stores/authStore';

export default function RequireRole({ allowedRoles }) {
  const user = useAuthStore((s) => s.user);

  if (allowedRoles.includes(user?.role)) {
    return <Outlet />;
  }

  return <Navigate to="/" replace />;
}
