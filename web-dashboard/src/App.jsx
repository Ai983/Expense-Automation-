import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/layout/Sidebar';
import Toast from './components/layout/Toast';
import Login from './pages/Login';
import ExpenseQueuePage from './pages/ExpenseQueuePage';
import ImprestQueuePage from './pages/ImprestQueuePage';
import DashboardPage from './pages/DashboardPage';
import EmployeeReportPage from './pages/EmployeeReportPage';
import ImprestAnalyticsPage from './pages/ImprestAnalyticsPage';
import S1QueuePage from './pages/S1QueuePage';
import S2QueuePage from './pages/S2QueuePage';

function getDefaultRoute(role) {
  if (role === 'approver_s1') return '/s1-queue';
  if (role === 'approver_s2') return '/s2-queue';
  return '/queue';
}

function ProtectedLayout({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="ml-64 flex-1 overflow-y-auto p-8 bg-gray-50">{children}</main>
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;

  const defaultRoute = user ? getDefaultRoute(user.role) : '/login';

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={defaultRoute} replace /> : <Login />} />
      <Route path="/queue" element={<ProtectedLayout><ExpenseQueuePage /></ProtectedLayout>} />
      <Route path="/imprest-queue" element={<ProtectedLayout><ImprestQueuePage /></ProtectedLayout>} />
      <Route path="/dashboard" element={<ProtectedLayout><DashboardPage /></ProtectedLayout>} />
      <Route path="/imprest-analytics" element={<ProtectedLayout><ImprestAnalyticsPage /></ProtectedLayout>} />
      <Route path="/reports" element={<ProtectedLayout><EmployeeReportPage /></ProtectedLayout>} />
      <Route path="/s1-queue" element={<ProtectedLayout><S1QueuePage /></ProtectedLayout>} />
      <Route path="/s2-queue" element={<ProtectedLayout><S2QueuePage /></ProtectedLayout>} />
      <Route path="/" element={<Navigate to={user ? defaultRoute : '/login'} replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
        <Toast />
      </AuthProvider>
    </BrowserRouter>
  );
}
