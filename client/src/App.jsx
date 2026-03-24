import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ThemeProvider from './providers/ThemeProvider';
import { IconProvider } from './providers/IconProvider';
import { ToastProvider } from './components/Toast';
import AuthGuard from './components/AuthGuard';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminLogsPage from './pages/AdminLogsPage';
import AdminEmailTemplatesPage from './pages/AdminEmailTemplatesPage';
import AdminAIModelsPage from './pages/AdminAIModelsPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DateTimePage from './pages/DateTimePage';
import ChatPage from './pages/ChatPage';

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
              <Route element={<AuthGuard><Layout /></AuthGuard>}>
                <Route index element={<DashboardPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/logs" element={<AdminLogsPage />} />
                <Route path="/admin/email-templates" element={<AdminEmailTemplatesPage />} />
                <Route path="/admin/ai-models" element={<AdminAIModelsPage />} />
                <Route path="/tools/datetime" element={<DateTimePage />} />
                <Route path="/tools/chat" element={<ChatPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </IconProvider>
    </ThemeProvider>
  );
}

export default App;
