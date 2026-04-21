import { useEffect, useState } from 'react';
import {
  getImprestMetrics,
  getImprestBySite,
  getImprestByCategory,
  getImprestByStatus,
  getEmployeeImprestBalance,
  getImprestSiteDetails,
  getImprestCategoryDetails,
} from '../services/dashboardService';
import { showToast } from '../components/layout/Toast';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

const PIE_COLOURS = ['#e8a24a', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899'];

const STATUS_COLOUR_MAP = {
  pending: '#f59e0b',
  approved: '#10b981',
  partially_approved: '#3b82f6',
  rejected: '#ef4444',
};

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function ImprestAnalyticsPage() {
  const [metrics, setMetrics] = useState(null);
  const [siteData, setSiteData] = useState([]);
  const [catData, setCatData] = useState([]);
  const [statusData, setStatusData] = useState([]);
  const [balanceData, setBalanceData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Drill-down state
  const [drillDown, setDrillDown] = useState(null); // { type, title, data }
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      getImprestMetrics(),
      getImprestBySite(),
      getImprestByCategory(),
      getImprestByStatus(),
      getEmployeeImprestBalance(),
    ])
      .then(([m, s, c, st, b]) => {
        setMetrics(m);
        setSiteData(s);
        setCatData(c);
        setStatusData(st);
        setBalanceData(b);
      })
      .catch(() => showToast('Failed to load imprest analytics', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleSiteClick = async (data) => {
    if (!data?.site) return;
    setDrillLoading(true);
    try {
      const details = await getImprestSiteDetails(data.site);
      setDrillDown({ type: 'site', title: `Imprest Breakdown — ${data.site}`, data: details });
    } catch { showToast('Failed to load details', 'error'); }
    finally { setDrillLoading(false); }
  };

  const handleCategoryClick = async (data) => {
    const cat = data?.category || data?.name;
    if (!cat) return;
    setDrillLoading(true);
    try {
      const details = await getImprestCategoryDetails(cat);
      setDrillDown({ type: 'category', title: `Imprest Breakdown — ${cat}`, data: details });
    } catch { showToast('Failed to load details', 'error'); }
    finally { setDrillLoading(false); }
  };

  if (loading) {
    return <div className="text-center py-20 text-gray-400">Loading imprest analytics...</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Imprest Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">HagerStone imprest overview and balance tracking. Click any bar or pie slice for employee-level details.</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Imprests" value={metrics?.totalImprests?.toLocaleString() || '0'} colour="amber" />
        <MetricCard
          label="Approval Rate"
          value={`${metrics?.approvalRate || 0}%`}
          sub={`${(metrics?.approved || 0) + (metrics?.partiallyApproved || 0)} approved`}
          colour="green"
        />
        <MetricCard label="Pending" value={metrics?.pending?.toLocaleString() || '0'} colour="orange" />
        <MetricCard label="Total Approved" value={formatINR(metrics?.totalApproved)} colour="blue" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Requested" value={formatINR(metrics?.totalRequested)} colour="purple" />
        <MetricCard label="Approved" value={metrics?.approved?.toLocaleString() || '0'} colour="green" />
        <MetricCard label="Partially Approved" value={metrics?.partiallyApproved?.toLocaleString() || '0'} colour="blue" />
        <MetricCard label="Rejected" value={metrics?.rejected?.toLocaleString() || '0'} colour="red" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Site Chart */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Imprests by Site</h3>
          <p className="text-xs text-gray-400 mb-3">Click a bar to see employee breakdown</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={siteData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <XAxis dataKey="site" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [formatINR(value), 'Total Requested']} />
              <Bar dataKey="totalRequested" fill="#e8a24a" radius={[4, 4, 0, 0]}
                cursor="pointer" onClick={handleSiteClick} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Category Chart */}
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Imprests by Category</h3>
          <p className="text-xs text-gray-400 mb-3">Click a slice to see employee breakdown</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={catData}
                dataKey="count"
                nameKey="category"
                cx="50%"
                cy="50%"
                outerRadius={75}
                cursor="pointer"
                onClick={handleCategoryClick}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {catData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Drill-down Table */}
      {drillLoading && (
        <div className="card mb-6 text-center py-8 text-gray-400">Loading employee breakdown...</div>
      )}
      {drillDown && !drillLoading && (
        <div className="card mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-semibold text-gray-700">{drillDown.title}</h3>
            <button onClick={() => setDrillDown(null)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded border">Close</button>
          </div>
          {drillDown.data.length === 0 ? (
            <p className="text-sm text-gray-400">No data found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Employee</th>
                    {drillDown.type === 'category' && <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Site</th>}
                    {drillDown.type === 'site' && <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Top Category</th>}
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Requests</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Total Requested</th>
                    {drillDown.type === 'site' && <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Total Approved</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {drillDown.data.map((emp, i) => (
                    <tr key={i} className="hover:bg-amber-50/40 transition-colors">
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{emp.name}</div>
                        <div className="text-xs text-gray-500">{emp.email}</div>
                      </td>
                      {drillDown.type === 'category' && <td className="px-4 py-2 text-gray-600">{emp.site}</td>}
                      {drillDown.type === 'site' && <td className="px-4 py-2 text-gray-600">{emp.topCategory}</td>}
                      <td className="px-4 py-2 text-right text-gray-700">{emp.count}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">{formatINR(emp.totalRequested)}</td>
                      {drillDown.type === 'site' && (
                        <td className="px-4 py-2 text-right font-semibold text-green-600">{formatINR(emp.totalApproved)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Status Chart */}
      <div className="card mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Imprests by Status</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={statusData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 80 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey="status" type="category" tick={{ fontSize: 11 }} width={100} />
            <Tooltip />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {statusData.map((entry, i) => (
                <Cell key={i} fill={STATUS_COLOUR_MAP[entry.status] || '#6366f1'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Employee Outstanding Balance Table */}
      {balanceData.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Employee Outstanding Balances</h3>
          <p className="text-xs text-gray-500 mb-3">
            Employees with unspent imprest amounts (approved amount minus submitted expenses)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Employee</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Site</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Outstanding Balance</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Imprests with Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {balanceData.map((emp) => (
                  <tr key={emp.id} className="hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{emp.name}</div>
                      <div className="text-xs text-gray-500">{emp.email}</div>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{emp.site}</td>
                    <td className="px-4 py-2 text-right font-bold text-red-600">{formatINR(emp.total_old_balance)}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{emp.imprests_with_balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, sub, colour }) {
  const bg = {
    blue: 'bg-blue-600', green: 'bg-green-600', orange: 'bg-orange-500',
    purple: 'bg-purple-600', amber: 'bg-amber-500', red: 'bg-red-500',
  };
  return (
    <div className="card">
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-600 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      <div className={`h-1 rounded-full mt-3 w-12 ${bg[colour] || 'bg-gray-400'}`} />
    </div>
  );
}
