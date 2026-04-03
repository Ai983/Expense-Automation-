import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getByEmployee } from '../services/dashboardService';
import { showToast } from '../components/layout/Toast';

const SITES = [
  'Head Office', 'Andritz', 'Theon Lifescience', 'Consern Pharma', 'Bhuj',
  'Kotputli Project', 'Bansal Tower Gurugram', 'VinFast', 'Minebea Mitsumi',
  'Chattargarh', 'Valorium', 'Jasrasar', 'Hanumangarh', 'Himalaya', 'Microsave',
  'Bangalore Branch Office', 'Vinfast-Ghaziabad', 'AU Space Office Ludhiana',
  'Vinfast - Patparganj', 'Auma India Bengaluru', 'Vaneet Infra',
  'MAX Hospital, Saket Delhi', 'Dee Foundation Omaxe, Faridabad',
  'Hero Homes Ludhiana', 'Delhi NCR',
];

const STATUS_COLORS = {
  approved:      '#10b981',
  verified:      '#3b82f6',
  pending:       '#f59e0b',
  manual_review: '#f97316',
  rejected:      '#ef4444',
  blocked:       '#6b7280',
};

const STATUS_LABELS = {
  approved:      'Approved',
  verified:      'Auto-Verified',
  pending:       'Pending',
  manual_review: 'In Review',
  rejected:      'Rejected',
  blocked:       'Blocked',
};

const formatINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function EmployeeReportPage() {
  const [data, setData]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [fromDate, setFromDate]   = useState('');
  const [toDate, setToDate]       = useState('');
  const [sortBy, setSortBy]       = useState('total');
  const [sortDir, setSortDir]     = useState('desc');

  useEffect(() => { load({}); }, []);

  async function load(filters) {
    setLoading(true);
    try {
      setData(await getByEmployee(filters));
    } catch {
      showToast('Failed to load employee report', 'error');
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() { load({ site: siteFilter, from: fromDate, to: toDate }); }
  function resetFilters() {
    setSearch(''); setSiteFilter(''); setFromDate(''); setToDate('');
    load({});
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('desc'); }
  }

  const filtered = useMemo(() => {
    let d = [...data];
    if (search) {
      const q = search.toLowerCase();
      d = d.filter((e) => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q));
    }
    d.sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return d;
  }, [data, search, sortBy, sortDir]);

  const totalEmployees = filtered.length;
  const totalExpenses  = filtered.reduce((s, e) => s + e.total, 0);
  const totalAmount    = filtered.reduce((s, e) => s + e.totalAmount, 0);

  // Top 12 for stacked bar
  const stackedData = filtered.slice(0, 12).map((e) => ({
    name: e.name.split(' ')[0],
    approved:      e.approved,
    verified:      e.verified,
    pending:       e.pending,
    manual_review: e.manual_review,
    rejected:      e.rejected,
    blocked:       e.blocked,
  }));

  // Top 10 by amount
  const amountData = [...filtered]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10)
    .map((e) => ({ name: e.name.split(' ')[0], amount: e.totalAmount }));

  if (loading) {
    return <div className="text-center py-20 text-gray-400">Loading employee report...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Employee Report</h1>
        <p className="text-sm text-gray-500 mt-1">Per-employee expense analytics and status breakdown</p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Search Employee</label>
            <input
              className="input w-full text-sm"
              placeholder="Name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="min-w-[160px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Site</label>
            <select className="input w-full text-sm" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All Sites</option>
              {SITES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
            <input type="date" className="input text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
            <input type="date" className="input text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <button onClick={applyFilters} className="btn-primary text-sm px-5 py-2">Apply</button>
          <button onClick={resetFilters} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-4 py-2">Reset</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Employees" value={totalEmployees} sub="with submissions" colour="blue" />
        <SummaryCard label="Total Submissions" value={totalExpenses.toLocaleString()} sub="all statuses" colour="orange" />
        <SummaryCard label="Total Amount" value={formatINR(totalAmount)} sub="approved + verified" colour="green" />
      </div>

      {/* Charts */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Stacked status breakdown */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Submission Status per Employee</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stackedData} margin={{ top: 4, right: 8, bottom: 48, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {Object.entries(STATUS_COLORS).map(([key, color]) => (
                  <Bar key={key} dataKey={key} name={STATUS_LABELS[key]} stackId="a" fill={color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Amount per employee */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Top Employees by Amount (₹)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={amountData} margin={{ top: 4, right: 8, bottom: 48, left: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [formatINR(v), 'Total Amount']} />
                <Bar dataKey="amount" fill="#e8a24a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Detailed table */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Detailed Breakdown</h3>
          <span className="text-xs text-gray-400">{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12">No data for the selected filters</p>
        ) : (
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b-2 border-gray-100">
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Site</th>
                <SortTh col="total"        label="Total"     sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <SortTh col="totalAmount"  label="Amount"    sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <th className="py-2 px-2 text-xs font-semibold text-green-600 text-center uppercase tracking-wide">Approved</th>
                <th className="py-2 px-2 text-xs font-semibold text-blue-600 text-center uppercase tracking-wide">Verified</th>
                <th className="py-2 px-2 text-xs font-semibold text-amber-500 text-center uppercase tracking-wide">Pending</th>
                <th className="py-2 px-2 text-xs font-semibold text-orange-500 text-center uppercase tracking-wide">Review</th>
                <th className="py-2 px-2 text-xs font-semibold text-red-500 text-center uppercase tracking-wide">Rejected</th>
                <th className="py-2 px-2 text-xs font-semibold text-gray-400 text-center uppercase tracking-wide">Blocked</th>
                <SortTh col="autoVerifyRate" label="Pass Rate" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} />
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Sub.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id} className="border-b border-gray-50 hover:bg-orange-50/30 transition-colors">
                  <td className="py-3 px-3">
                    <p className="font-semibold text-gray-900">{emp.name}</p>
                    <p className="text-xs text-gray-400">{emp.email}</p>
                  </td>
                  <td className="py-3 px-3 text-xs text-gray-500">{emp.site}</td>
                  <td className="py-3 px-3 text-center">
                    <span className="font-bold text-gray-900 text-base">{emp.total}</span>
                  </td>
                  <td className="py-3 px-3 text-center font-semibold text-gray-800 whitespace-nowrap">
                    {formatINR(emp.totalAmount)}
                  </td>
                  <td className="py-2 px-2 text-center"><Pill value={emp.approved}      bg="bg-green-100"  text="text-green-700" /></td>
                  <td className="py-2 px-2 text-center"><Pill value={emp.verified}      bg="bg-blue-100"   text="text-blue-700" /></td>
                  <td className="py-2 px-2 text-center"><Pill value={emp.pending}       bg="bg-amber-100"  text="text-amber-700" /></td>
                  <td className="py-2 px-2 text-center"><Pill value={emp.manual_review} bg="bg-orange-100" text="text-orange-700" /></td>
                  <td className="py-2 px-2 text-center"><Pill value={emp.rejected}      bg="bg-red-100"    text="text-red-700" /></td>
                  <td className="py-2 px-2 text-center"><Pill value={emp.blocked}       bg="bg-gray-100"   text="text-gray-500" /></td>
                  <td className="py-3 px-3 text-center">
                    <span className={`text-xs font-bold ${emp.autoVerifyRate >= 70 ? 'text-green-600' : emp.autoVerifyRate >= 40 ? 'text-amber-500' : 'text-red-500'}`}>
                      {emp.autoVerifyRate}%
                    </span>
                    <div className="w-full bg-gray-100 rounded-full h-1 mt-1">
                      <div
                        className={`h-1 rounded-full ${emp.autoVerifyRate >= 70 ? 'bg-green-500' : emp.autoVerifyRate >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${emp.autoVerifyRate}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-3 px-3 text-xs text-gray-400 whitespace-nowrap">
                    {emp.lastSubmitted ? new Date(emp.lastSubmitted).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, colour }) {
  const bar = { blue: 'bg-blue-600', green: 'bg-green-600', orange: 'bg-orange-500' };
  return (
    <div className="card">
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-600 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      <div className={`h-1 rounded-full mt-3 w-12 ${bar[colour]}`} />
    </div>
  );
}

function SortTh({ col, label, sortBy, sortDir, onSort }) {
  const active = sortBy === col;
  return (
    <th
      className="py-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center cursor-pointer select-none hover:text-gray-800"
      onClick={() => onSort(col)}
    >
      {label} {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </th>
  );
}

function Pill({ value, bg, text }) {
  if (!value) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${bg} ${text}`}>
      {value}
    </span>
  );
}
