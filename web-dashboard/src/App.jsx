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
import ResetPassword from './pages/ResetPassword';
import FeedbackPage from './pages/FeedbackPage';
import ProcurementQueuePage from './pages/ProcurementQueuePage';
import AdjustmentSettlementsPage from './pages/AdjustmentSettlementsPage';
import HeadDashboardPage from './pages/HeadDashboardPage';
import HeadKanbanPage from './pages/HeadKanbanPage';
import HeadProjectSpendPage from './pages/HeadProjectSpendPage';
import HeadExpenseListPage from './pages/HeadExpenseListPage';
import HeadImprestListPage from './pages/HeadImprestListPage';
import HeadPOListPage from './pages/HeadPOListPage';

function getDefaultRoute(role) {
  if (role === 'head') return '/head';
  if (role === 'approver_s1') return '/s1-queue';
  if (role === 'approver_s2') return '/s2-queue';
  if (role === 'procurement_finance') return '/procurement-queue';
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
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/queue" element={<ProtectedLayout><ExpenseQueuePage /></ProtectedLayout>} />
      <Route path="/imprest-queue" element={<ProtectedLayout><ImprestQueuePage /></ProtectedLayout>} />
      <Route path="/dashboard" element={<ProtectedLayout><DashboardPage /></ProtectedLayout>} />
      <Route path="/imprest-analytics" element={<ProtectedLayout><ImprestAnalyticsPage /></ProtectedLayout>} />
      <Route path="/reports" element={<ProtectedLayout><EmployeeReportPage /></ProtectedLayout>} />
      <Route path="/adjustments" element={<ProtectedLayout><AdjustmentSettlementsPage /></ProtectedLayout>} />
      <Route path="/s1-queue" element={<ProtectedLayout><S1QueuePage /></ProtectedLayout>} />
      <Route path="/s2-queue" element={<ProtectedLayout><S2QueuePage /></ProtectedLayout>} />
      <Route path="/feedback" element={<ProtectedLayout><FeedbackPage /></ProtectedLayout>} />
      <Route path="/procurement-queue" element={<ProtectedLayout><ProcurementQueuePage /></ProtectedLayout>} />
      <Route path="/head" element={<ProtectedLayout><HeadDashboardPage /></ProtectedLayout>} />
      <Route path="/head/kanban" element={<ProtectedLayout><HeadKanbanPage /></ProtectedLayout>} />
      <Route path="/head/projects" element={<ProtectedLayout><HeadProjectSpendPage /></ProtectedLayout>} />
      <Route path="/head/expenses" element={<ProtectedLayout><HeadExpenseListPage /></ProtectedLayout>} />
      <Route path="/head/imprest" element={<ProtectedLayout><HeadImprestListPage /></ProtectedLayout>} />
      <Route path="/head/po" element={<ProtectedLayout><HeadPOListPage /></ProtectedLayout>} />
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
