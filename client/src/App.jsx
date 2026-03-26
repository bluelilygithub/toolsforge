import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ThemeProvider from './providers/ThemeProvider';
import { IconProvider } from './providers/IconProvider';
import { ToastProvider } from './components/Toast';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';
import AppShell from './components/AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminLogsPage from './pages/AdminLogsPage';
import AdminEmailTemplatesPage from './pages/AdminEmailTemplatesPage';
import AdminAIModelsPage from './pages/AdminAIModelsPage';
import AdminSecurityPage from './pages/AdminSecurityPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DateTimePage from './pages/DateTimePage';
import ChatPage from './pages/ChatPage';
import AdminAppSettingsPage from './pages/AdminAppSettingsPage';

function App() {
  return (
    <ThemeProvider>
      <IconProvider>
        <ToastProvider>
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/invite/:token" element={<AcceptInvitePage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset/:token" element={<ResetPasswordPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/admin/users" element={<AdminUsersPage />} />
                  <Route path="/admin/logs" element={<AdminLogsPage />} />
                  <Route path="/admin/email-templates" element={<AdminEmailTemplatesPage />} />
                  <Route path="/admin/ai-models" element={<AdminAIModelsPage />} />
                  <Route path="/admin/security" element={<AdminSecurityPage />} />
                  <Route path="/admin/app-settings" element={<AdminAppSettingsPage />} />
                  <Route path="/tools/datetime" element={<DateTimePage />} />
                  <Route path="/tools/chat" element={<ChatPage />} />
                  <Route path="/tools/advisor" element={
                    <div className="p-8 text-slate-500">Model Advisor — coming soon</div>
                  } />
                  <Route path="/tools/projects" element={
                    <div className="p-8 text-slate-500">Projects — coming soon</div>
                  } />
                  <Route element={<RequireRole allowedRoles={['org_admin']} />}>
                    <Route path="/tools/ads" element={
                      <div className="p-8 text-slate-500">Google Ads — coming soon</div>
                    } />
                    <Route path="/tools/video" element={
                      <div className="p-8 text-slate-500">Video Studio — coming soon</div>
                    } />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </IconProvider>
    </ThemeProvider>
  );
}

export default App;
