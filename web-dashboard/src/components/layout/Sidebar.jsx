import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

function getNavItems(role) {
  switch (role) {
    case 'head':
      return [
        { to: '/head', label: 'Overview', icon: '🏠' },
        { to: '/head/kanban', label: 'Workflow Board', icon: '📌' },
        { to: '/head/projects', label: 'Project Spend', icon: '🏗️' },
        { to: '/head/expenses', label: 'All Expenses', icon: '📋' },
        { to: '/head/imprest', label: 'All Imprest', icon: '💰' },
        { to: '/head/po', label: 'All POs', icon: '📦' },
      ];
    case 'approver_s1':
      return [
        { to: '/s1-queue', label: 'Imprest Review', icon: '📋' },
        { to: '/imprest-analytics', label: 'Imprest Analytics', icon: '📈' },
        { to: '/procurement-queue', label: 'Procurement Payments', icon: '📦' },
      ];
    case 'approver_s2':
      return [
        { to: '/s2-queue', label: 'Imprest Review', icon: '📋' },
        { to: '/imprest-analytics', label: 'Imprest Analytics', icon: '📈' },
        { to: '/feedback', label: 'Feedback', icon: '💬' },
      ];
    case 'procurement_finance':
      return [
        { to: '/procurement-queue', label: 'Procurement Payments', icon: '📦' },
      ];
    default: // finance, manager, admin
      return [
        { to: '/queue', label: 'Expense Queue', icon: '📋' },
        { to: '/imprest-queue', label: 'Imprest Queue', icon: '💰' },
        { to: '/dashboard', label: 'Expense Analytics', icon: '📊' },
        { to: '/imprest-analytics', label: 'Imprest Analytics', icon: '📈' },
        { to: '/reports', label: 'Employee Report', icon: '👥' },
      ];
  }
}

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navItems = getNavItems(user?.role);

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col h-screen fixed left-0 top-0">
      <div className="px-6 py-5 border-b border-gray-700">
        <h1 className="text-lg font-bold text-brand-500">HagerStone</h1>
        <p className="text-xs text-gray-400 mt-0.5">Expense Management</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-gray-700">
        <div className="mb-3">
          <p className="text-sm font-medium text-white truncate">{user?.name}</p>
          <p className="text-xs text-gray-400 capitalize">{user?.role} · {user?.site}</p>
        </div>
        <button
          onClick={logout}
          className="w-full text-left text-xs text-gray-400 hover:text-white transition-colors"
        >
          Sign out →
        </button>
      </div>
    </aside>
  );
}
