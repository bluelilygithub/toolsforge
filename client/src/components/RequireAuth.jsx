import { Navigate, Outlet } from 'react-router-dom';
import useAuthStore from '../stores/authStore';

export default function RequireAuth() {
  const token = useAuthStore(state => state.token);
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}
