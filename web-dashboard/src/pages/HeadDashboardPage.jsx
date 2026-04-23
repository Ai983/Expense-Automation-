import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getOverview } from '../services/headService';
import AgingPill from '../components/head/AgingPill';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

function KpiCard({ label, value, sub, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function HeadDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">Loading overview…</div>
    );
  }

  const kpi = data?.kpi || {};
  const bottlenecks = data?.bottlenecks || {};
  const activity = data?.recentActivity || [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Head Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Read-only view across all money in motion</p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard
          label="Money in Motion"
          value={fmt(kpi.moneyInMotion)}
          sub="Pending imprests + expenses + POs"
          color="text-brand-600"
        />
        <KpiCard
          label="Paid This Week"
          value={fmt(kpi.paidThisWeek)}
          sub="Imprest + PO disbursements"
          color="text-green-600"
        />
        <KpiCard
          label="Bottlenecks (>48h)"
          value={kpi.bottleneckCount ?? '—'}
          sub="Cards stuck in red"
          color={kpi.bottleneckCount > 0 ? 'text-red-600' : 'text-green-600'}
        />
        <KpiCard
          label="Blocked Employees"
          value={kpi.blockedEmployees ?? '—'}
          sub="Imprest-blocked accounts"
          color={kpi.blockedEmployees > 0 ? 'text-orange-600' : 'text-gray-900'}
        />
        <KpiCard
          label="Director Pending (WA)"
          value={kpi.pendingDirectorApprovals ?? '—'}
          sub="Awaiting Bhaskar Sir"
          color={kpi.pendingDirectorApprovals > 0 ? 'text-yellow-600' : 'text-gray-900'}
        />
        <KpiCard
          label="Avg Approval Time"
          value={kpi.avgApproveHours != null ? `${kpi.avgApproveHours}h` : '—'}
          sub="Last 30 days, imprests"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bottleneck snapshot */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Bottlenecks</h2>
            <Link to="/head/kanban" className="text-xs text-brand-500 hover:underline">
              Open Kanban →
            </Link>
          </div>
          {(bottlenecks.imprests?.length === 0 && bottlenecks.expenses?.length === 0) ? (
            <p className="text-gray-400 text-sm py-4 text-center">No bottlenecks</p>
          ) : (
            <div className="space-y-2">
              {[...(bottlenecks.imprests || []), ...(bottlenecks.expenses || [])].map((item) => (
                <div key={item.id} className="flex items-center justify-between border-b border-gray-50 pb-2">
                  <div>
                    <p className="font-medium text-sm text-gray-800">{item.ref_id}</p>
                    <p className="text-xs text-gray-500">{item.employee_name} · {item.site}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-sm">{fmt(item.amount_requested || item.amount)}</p>
                    <AgingPill submittedAt={item.submitted_at} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">Recent Activity</h2>
          {activity.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No activity yet</p>
          ) : (
            <div className="space-y-2">
              {activity.map((a) => (
                <div key={a.id} className="flex items-start gap-3 border-b border-gray-50 pb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">
                      <span className="font-medium">{a.user?.name || 'System'}</span>{' '}
                      <span className="text-gray-500">{a.action.replace(/_/g, ' ')}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(a.timestamp).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { to: '/head/kanban', icon: '📌', label: 'Workflow Board' },
          { to: '/head/expenses', icon: '📋', label: 'All Expenses' },
          { to: '/head/imprest', icon: '💰', label: 'All Imprests' },
          { to: '/head/po', icon: '📦', label: 'All PO Payments' },
        ].map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-brand-400 transition-all flex items-center gap-3"
          >
            <span className="text-2xl">{l.icon}</span>
            <span className="font-medium text-gray-700 text-sm">{l.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
