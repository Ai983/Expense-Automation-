import { useEffect, useState } from 'react';
import { getMetrics, getBySite, getByCategory, getByStatus, getSiteDetails, getCategoryDetails } from '../services/dashboardService';
import { SiteChart, CategoryChart, StatusChart, DrillDownTable } from '../components/dashboard/Charts';
import { showToast } from '../components/layout/Toast';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState(null);
  const [siteData, setSiteData] = useState([]);
  const [catData, setCatData] = useState([]);
  const [statusData, setStatusData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drillDown, setDrillDown] = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    Promise.all([getMetrics(), getBySite(), getByCategory(), getByStatus()])
      .then(([m, s, c, st]) => {
        setMetrics(m);
        setSiteData(s);
        setCatData(c);
        setStatusData(st);
      })
      .catch(() => showToast('Failed to load dashboard data', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleSiteClick = async (site) => {
    setDrillLoading(true);
    try {
      const data = await getSiteDetails(site);
      setDrillDown({ title: `Expense Breakdown — ${site}`, data });
    } catch { showToast('Failed to load details', 'error'); }
    finally { setDrillLoading(false); }
  };

  const handleCategoryClick = async (category) => {
    setDrillLoading(true);
    try {
      const data = await getCategoryDetails(category);
      setDrillDown({ title: `Expense Breakdown — ${category}`, data });
    } catch { showToast('Failed to load details', 'error'); }
    finally { setDrillLoading(false); }
  };

  if (loading) {
    return <div className="text-center py-20 text-gray-400">Loading dashboard...</div>;
  }

  const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">HagerStone expense analytics overview</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total Expenses" value={metrics?.totalExpenses?.toLocaleString() || '0'} colour="blue" />
        <MetricCard label="Auto-Verify Rate" value={`${metrics?.autoVerifyRate || 0}%`}
          sub={`${metrics?.autoVerified || 0} auto-verified`} colour="green" />
        <MetricCard label="Pending Approval" value={metrics?.pendingApproval?.toLocaleString() || '0'} colour="orange" />
        <MetricCard label="Total Processed" value={formatINR(metrics?.totalAmountProcessed)} colour="purple" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <SiteChart data={siteData} onBarClick={handleSiteClick} />
        <CategoryChart data={catData} onSliceClick={handleCategoryClick} />
      </div>

      {/* Drill-down */}
      {drillLoading && <div className="card mb-6 text-center py-8 text-gray-400">Loading employee breakdown...</div>}
      {drillDown && !drillLoading && (
        <DrillDownTable title={drillDown.title} data={drillDown.data}
          onClose={() => setDrillDown(null)} />
      )}

      <StatusChart data={statusData} />
    </div>
  );
}

function MetricCard({ label, value, sub, colour }) {
  const bg = { blue: 'bg-blue-600', green: 'bg-green-600', orange: 'bg-orange-500', purple: 'bg-purple-600' };
  return (
    <div className="card">
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-600 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      <div className={`h-1 rounded-full mt-3 w-12 ${bg[colour]}`} />
    </div>
  );
}
