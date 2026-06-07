import { useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getByEmployee, getProjectSites } from '../services/dashboardService';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS_BADGE = {
  approved:      'bg-green-100 text-green-700',
  auto_verified: 'bg-blue-100 text-blue-700',
  verified:      'bg-blue-100 text-blue-700',
  pending:       'bg-amber-100 text-amber-700',
  manual_review: 'bg-orange-100 text-orange-700',
  rejected:      'bg-red-100 text-red-700',
  blocked:       'bg-gray-100 text-gray-600',
  partially_approved: 'bg-teal-100 text-teal-700',
  paid:          'bg-green-200 text-green-800',
};
const STATUS_LABEL = {
  approved: 'Approved', auto_verified: 'Auto-Verified', verified: 'Verified',
  pending: 'Pending', manual_review: 'In Review', rejected: 'Rejected',
  blocked: 'Blocked', partially_approved: 'Part. Approved', paid: 'Paid',
};

const IMPREST_STAGE_BADGE = {
  s1_pending: 'bg-blue-50 text-blue-600', s2_pending: 'bg-purple-50 text-purple-600',
  director_pending: 'bg-indigo-50 text-indigo-600', s3_pending: 'bg-amber-50 text-amber-700',
  founder_review_pending: 'bg-pink-50 text-pink-600', founder_approved: 'bg-green-50 text-green-600',
  paid: 'bg-green-200 text-green-800', rejected: 'bg-red-50 text-red-600',
  s1_rejected: 'bg-red-50 text-red-600', s2_rejected: 'bg-red-50 text-red-600',
  s3_rejected: 'bg-red-50 text-red-600', director_rejected: 'bg-red-50 text-red-600',
};
const IMPREST_STAGE_LABEL = {
  s1_pending: 'S1 — Avisha', s2_pending: 'S2 — Ritu', director_pending: 'Director',
  s3_pending: 'Finance', founder_review_pending: 'Founder', founder_approved: 'Founder ✓',
  paid: 'Paid', rejected: 'Rejected', s1_rejected: 'S1 Rejected', s2_rejected: 'S2 Rejected',
  s3_rejected: 'Finance Rejected', director_rejected: 'Dir. Rejected',
};

export default function EmployeeReportPage() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortBy, setSortBy] = useState('total');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState('imprests');
  const [projects, setProjects] = useState([]);

  useEffect(() => { load({}); }, []);
  useEffect(() => { getProjectSites().then(setProjects).catch(() => {}); }, []);

  async function load(filters) {
    setLoading(true);
    try { setData(await getByEmployee(filters)); }
    catch { showToast('Failed to load employee report', 'error'); }
    finally { setLoading(false); }
  }

  async function toggleExpand(empId) {
    if (expandedId === empId) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(empId);
    setDetail(null);
    setDetailLoading(true);
    try {
      // Scope the drill-down to the selected project so balances stay project-specific
      const q = siteFilter ? `?site=${encodeURIComponent(siteFilter)}` : '';
      const { data: res } = await api.get(`/api/dashboard/employee/${empId}/detail${q}`);
      setDetail(res.data);
    } catch { showToast('Failed to load employee detail', 'error'); }
    finally { setDetailLoading(false); }
  }

  // Changing the project reloads the whole dashboard immediately for that project
  function selectProject(value) {
    setSiteFilter(value);
    setExpandedId(null); setDetail(null);
    load({ site: value, from: fromDate, to: toDate });
  }

  function applyFilters() { load({ site: siteFilter, from: fromDate, to: toDate }); }
  function resetFilters() { setSearch(''); setSiteFilter(''); setFromDate(''); setToDate(''); load({}); }

  const filtered = useMemo(() => {
    let d = [...data];
    if (search) {
      const q = search.toLowerCase();
      d = d.filter((e) => e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q));
    }
    d.sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return d;
  }, [data, search, sortBy, sortDir]);

  const totalAmount = filtered.reduce((s, e) => s + (e.totalAmount || 0), 0);
  const totalAdvanced = filtered.reduce((s, e) => s + (e.totalAdvanced || 0), 0);
  const totalBalance = filtered.reduce((s, e) => s + (e.balanceDue || 0), 0);
  const totalExpenses = filtered.reduce((s, e) => s + (e.total || 0), 0);
  const totalApproved = filtered.reduce((s, e) => s + (e.approved || 0) + (e.verified || 0), 0);
  const passRate = totalExpenses > 0 ? Math.round((totalApproved / totalExpenses) * 100) : 0;

  const pieData = [
    { name: 'Approved', value: filtered.reduce((s, e) => s + (e.approved || 0), 0), color: '#10b981' },
    { name: 'Verified', value: filtered.reduce((s, e) => s + (e.verified || 0), 0), color: '#3b82f6' },
    { name: 'Pending', value: filtered.reduce((s, e) => s + (e.pending || 0) + (e.manual_review || 0), 0), color: '#f59e0b' },
    { name: 'Rejected', value: filtered.reduce((s, e) => s + (e.rejected || 0), 0), color: '#ef4444' },
    { name: 'Blocked', value: filtered.reduce((s, e) => s + (e.blocked || 0), 0), color: '#6b7280' },
  ].filter((d) => d.value > 0);

  const topByAmount = [...filtered].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10)
    .map((e) => ({ name: e.name.split(' ')[0], amount: e.totalAmount }));

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading employee report...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Employee Report</h1>
        <p className="text-sm text-gray-500 mt-1">Complete workforce analytics — expenses, imprests, and balance tracking</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Search Employee</label>
            <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Name or email..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-500 mb-1">🏗️ Project / Site</label>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              value={siteFilter} onChange={(e) => selectProject(e.target.value)}>
              <option value="">All Projects</option>
              {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
            <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
            <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <button onClick={applyFilters} className="bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-5 py-2 rounded-lg">Apply</button>
          <button onClick={resetFilters} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-4 py-2">Reset</button>
        </div>
        {siteFilter && (
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold px-3 py-1 rounded-full">
              🏗️ Viewing project: {siteFilter}
              <button onClick={() => selectProject('')} className="ml-1 text-amber-500 hover:text-amber-700" title="Clear project filter">✕</button>
            </span>
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Employees" value={filtered.length} colour="blue" />
        <KpiCard label="Total Expenses" value={totalExpenses.toLocaleString()} colour="amber" />
        <KpiCard label="Amount Claimed" value={fmt(totalAmount)} colour="green" />
        <KpiCard label="Total Advanced" value={fmt(totalAdvanced)} sub="(imprests paid)" colour="purple" />
        <KpiCard label="Balance Due" value={fmt(totalBalance)} sub={`${passRate}% pass rate`} colour={totalBalance > 100000 ? 'red' : 'teal'} />
      </div>

      {/* Charts */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Expense Status Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={75} innerRadius={35}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Top 10 by Amount Claimed</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topByAmount} margin={{ top: 4, right: 8, bottom: 40, left: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [fmt(v), 'Claimed']} />
                <Bar dataKey="amount" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Employee List */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Employee Breakdown</h3>
          <span className="text-xs text-gray-400">{filtered.length} employee{filtered.length !== 1 ? 's' : ''} · click any row to expand</span>
        </div>

        {/* Sort Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <div className="col-span-3">Employee</div>
          <div className="col-span-1 text-center cursor-pointer hover:text-gray-800" onClick={() => { setSortBy('total'); setSortDir(sortBy === 'total' && sortDir === 'desc' ? 'asc' : 'desc'); }}>
            Expenses {sortBy === 'total' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </div>
          <div className="col-span-2 text-right cursor-pointer hover:text-gray-800" onClick={() => { setSortBy('totalAmount'); setSortDir(sortBy === 'totalAmount' && sortDir === 'desc' ? 'asc' : 'desc'); }}>
            Amount {sortBy === 'totalAmount' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </div>
          <div className="col-span-1 text-center">Approved</div>
          <div className="col-span-1 text-center">Rejected</div>
          <div className="col-span-1 text-center">Imprests</div>
          <div className="col-span-2 text-right cursor-pointer hover:text-gray-800" onClick={() => { setSortBy('balanceDue'); setSortDir(sortBy === 'balanceDue' && sortDir === 'desc' ? 'asc' : 'desc'); }}>
            Balance Due {sortBy === 'balanceDue' ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
          </div>
          <div className="col-span-1 text-center">Pass %</div>
        </div>

        {filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-12 text-sm">No employees found</p>
        ) : (
          <div>
            {filtered.map((emp) => {
              const isExpanded = expandedId === emp.id;
              const isHighRisk = (emp.rejected || 0) + (emp.blocked || 0) >= 3;
              const hasBalance = (emp.balanceDue || 0) > 0;

              return (
                <div key={emp.id} className={`border-b border-gray-50 ${isExpanded ? 'bg-amber-50/30' : ''}`}>
                  {/* Row */}
                  <div
                    className={`grid grid-cols-12 gap-2 px-4 py-3 items-center cursor-pointer transition-colors
                      ${isExpanded ? 'bg-amber-50/50' : isHighRisk ? 'bg-red-50/30 hover:bg-red-50/50' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleExpand(emp.id)}
                  >
                    {/* Employee */}
                    <div className="col-span-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${isHighRisk ? 'bg-red-400' : 'bg-amber-400'}`}>
                          {emp.name?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">{emp.name}</p>
                          <p className="text-xs text-gray-400 truncate">{emp.email}</p>
                          <div className="flex gap-1 mt-0.5 flex-wrap">
                            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{emp.site}</span>
                            {isHighRisk && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-semibold">HIGH RISK</span>}
                            {hasBalance && <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-semibold">BALANCE DUE</span>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expenses count */}
                    <div className="col-span-1 text-center">
                      <span className="text-lg font-bold text-gray-900">{emp.total}</span>
                    </div>

                    {/* Amount */}
                    <div className="col-span-2 text-right">
                      <span className="font-semibold text-gray-800 text-sm">{fmt(emp.totalAmount)}</span>
                    </div>

                    {/* Approved */}
                    <div className="col-span-1 text-center">
                      <span className="text-xs font-semibold text-green-700">{(emp.approved || 0) + (emp.verified || 0)}</span>
                    </div>

                    {/* Rejected */}
                    <div className="col-span-1 text-center">
                      <span className={`text-xs font-semibold ${(emp.rejected || 0) > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                        {emp.rejected || 0}
                      </span>
                    </div>

                    {/* Imprests */}
                    <div className="col-span-1 text-center">
                      <div className="text-xs">
                        <span className="font-semibold text-gray-700">{emp.imprestTotal || 0}</span>
                        {(emp.imprestApproved || 0) > 0 && <span className="text-green-600 ml-1">✓{emp.imprestApproved}</span>}
                      </div>
                    </div>

                    {/* Balance Due */}
                    <div className="col-span-2 text-right">
                      {hasBalance ? (
                        <span className="text-sm font-bold text-orange-600">{fmt(emp.balanceDue)}</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </div>

                    {/* Pass Rate */}
                    <div className="col-span-1 text-center">
                      <span className={`text-xs font-bold ${emp.autoVerifyRate >= 70 ? 'text-green-600' : emp.autoVerifyRate >= 40 ? 'text-amber-500' : 'text-red-500'}`}>
                        {emp.autoVerifyRate}%
                      </span>
                      <div className="w-full bg-gray-100 rounded-full h-1 mt-1">
                        <div className={`h-1 rounded-full ${emp.autoVerifyRate >= 70 ? 'bg-green-500' : emp.autoVerifyRate >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${emp.autoVerifyRate}%` }} />
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 bg-white border-t border-amber-100">
                      {detailLoading ? (
                        <div className="py-8 text-center text-gray-400 text-sm">Loading details...</div>
                      ) : detail ? (
                        <EmployeeDetail detail={detail} tab={detailTab} setTab={setDetailTab} />
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmployeeDetail({ detail, tab, setTab }) {
  const { imprests, expenses, summary } = detail;

  // Map imprest id -> ref_id so each expense can show which imprest it settles against
  const imprestRefById = {};
  imprests.forEach((i) => { imprestRefById[i.id] = i.ref_id; });

  // Count approved/verified expenses + settled total linked to each imprest
  const linkedByImprest = {};
  expenses.forEach((e) => {
    if (!e.imprest_id) return;
    if (!linkedByImprest[e.imprest_id]) linkedByImprest[e.imprest_id] = { count: 0, settled: 0 };
    linkedByImprest[e.imprest_id].count++;
    if (['approved', 'verified', 'auto_verified'].includes(e.status)) {
      linkedByImprest[e.imprest_id].settled += parseFloat(e.amount || 0);
    }
  });

  // Flag tallies — surfaces audit-worthy expenses
  const flags = {
    duplicate: expenses.filter((e) => e.duplicate_flag).length,
    noImprest: expenses.filter((e) => !e.imprest_id).length,
    overspend: expenses.filter((e) => (e.overspend_amount || 0) > 0).length,
  };
  const totalFlagged = flags.duplicate + flags.noImprest + flags.overspend;

  return (
    <div className="mt-3">
      {/* Flagged expenses alert */}
      {totalFlagged > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-red-500 text-lg">⚠</span>
          <div className="flex gap-4 text-xs flex-wrap">
            <span className="font-semibold text-red-700">{totalFlagged} flagged expense{totalFlagged !== 1 ? 's' : ''}:</span>
            {flags.duplicate > 0 && <span className="text-orange-600">⚠ {flags.duplicate} duplicate</span>}
            {flags.noImprest > 0 && <span className="text-red-600">🚩 {flags.noImprest} without imprest</span>}
            {flags.overspend > 0 && <span className="text-purple-600">💸 {flags.overspend} overspend</span>}
          </div>
        </div>
      )}

      {/* Balance Summary Banner */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-center">
          <p className="text-xs text-green-600 font-semibold uppercase">Total Advanced</p>
          <p className="text-xl font-bold text-green-700 mt-0.5">{fmt(summary.totalAdvanced)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-center">
          <p className="text-xs text-blue-600 font-semibold uppercase">Expenses Settled</p>
          <p className="text-xl font-bold text-blue-700 mt-0.5">{fmt(summary.totalSettled)}</p>
        </div>
        <div className={`border rounded-lg px-4 py-3 text-center ${summary.balanceDue > 0 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
          <p className={`text-xs font-semibold uppercase ${summary.balanceDue > 0 ? 'text-orange-600' : 'text-gray-500'}`}>Balance Due</p>
          <p className={`text-xl font-bold mt-0.5 ${summary.balanceDue > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{fmt(summary.balanceDue)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-gray-200">
        {[
          ['imprests', `Imprests (${imprests.length})`, false],
          ['expenses', `Expenses (${expenses.length})`, false],
          ['flagged', `⚠ Flagged (${totalFlagged})`, true],
        ].map(([key, label, isFlag]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? (isFlag ? 'border-red-500 text-red-600' : 'border-amber-500 text-amber-600')
                : (isFlag && totalFlagged > 0 ? 'border-transparent text-red-400 hover:text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700')
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'imprests' && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {imprests.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-6">No imprest requests found</p>
          ) : imprests.map((imp) => (
            <div key={imp.id} className="flex items-start justify-between bg-gray-50 rounded-lg px-3 py-2.5 hover:bg-gray-100 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-amber-600">{imp.ref_id}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${IMPREST_STAGE_BADGE[imp.current_stage] || 'bg-gray-100 text-gray-600'}`}>
                    {IMPREST_STAGE_LABEL[imp.current_stage] || imp.current_stage}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[imp.status] || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABEL[imp.status] || imp.status}
                  </span>
                  {imp.paid && <span className="text-[10px] bg-green-200 text-green-800 px-1.5 py-0.5 rounded font-semibold">💰 Paid</span>}
                </div>
                <p className="text-xs text-gray-600 mt-1">{imp.category} · {imp.site}</p>
                {imp.purpose && <p className="text-xs text-gray-400 truncate">{imp.purpose}</p>}
                {/* Linked expenses settled against this imprest */}
                {linkedByImprest[imp.id] ? (
                  <p className="text-xs text-blue-600 mt-0.5">🔗 {linkedByImprest[imp.id].count} expense{linkedByImprest[imp.id].count !== 1 ? 's' : ''} · {fmt(linkedByImprest[imp.id].settled)} settled</p>
                ) : (imp.paid && (
                  <p className="text-xs text-orange-500 mt-0.5">⚠ No expenses submitted against this advance</p>
                ))}
                {imp.rejection_reason && <p className="text-xs text-red-500 mt-0.5">✗ {imp.rejection_reason}</p>}
              </div>
              <div className="text-right ml-3 flex-shrink-0">
                <p className="text-sm font-bold text-gray-900">{fmt(imp.amount_requested)}</p>
                {imp.approved_amount && imp.approved_amount !== imp.amount_requested && (
                  <p className="text-xs text-green-600">✓ {fmt(imp.approved_amount)}</p>
                )}
                {imp.remainingBalance > 0 && (
                  <p className="text-xs text-orange-500 font-semibold">Bal: {fmt(imp.remainingBalance)}</p>
                )}
                <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(imp.submitted_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'expenses' && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {expenses.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-6">No expenses found</p>
          ) : expenses.map((exp) => (
            <div key={exp.id} className="flex items-start justify-between bg-gray-50 rounded-lg px-3 py-2.5 hover:bg-gray-100 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-amber-600">{exp.ref_id}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[exp.status] || 'bg-gray-100 text-gray-500'}`}>
                    {STATUS_LABEL[exp.status] || exp.status}
                  </span>
                  {/* Flags */}
                  {exp.duplicate_flag && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-semibold" title={exp.duplicate_ref ? `Duplicate of ${exp.duplicate_ref}` : 'Possible duplicate'}>⚠ Duplicate</span>}
                  {(exp.overspend_amount || 0) > 0 && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold" title={`₹${Number(exp.overspend_amount).toLocaleString('en-IN')} over imprest balance`}>💸 Overspend {fmt(exp.overspend_amount)}</span>}
                  {exp.settlement_for_expense_id && <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-semibold">↻ Settlement</span>}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {exp.category} · {exp.site}
                  {/* Linked imprest */}
                  {exp.imprest_id
                    ? <span className="ml-2 text-[11px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-mono">🔗 {imprestRefById[exp.imprest_id] || 'imprest'}</span>
                    : <span className="ml-2 text-[11px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-semibold">🚩 No imprest linked</span>}
                </p>
                {exp.description && <p className="text-xs text-gray-400 truncate">{exp.description}</p>}
                {exp.rejection_reason && <p className="text-xs text-red-500 mt-0.5 truncate">✗ {exp.rejection_reason}</p>}
                {/* Screenshot attachments — from screenshot_url (primary) and screenshot_metadata (multiple) */}
                {(() => {
                  const urls = [];
                  if (exp.screenshot_url) urls.push(exp.screenshot_url);
                  if (exp.screenshot_metadata) {
                    const meta = Array.isArray(exp.screenshot_metadata) ? exp.screenshot_metadata : Object.values(exp.screenshot_metadata);
                    meta.forEach((m) => { if (m?.url && !urls.includes(m.url)) urls.push(m.url); });
                  }
                  return urls.length > 0 ? (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {urls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer"
                          className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-colors">
                          📎 Receipt {i + 1}
                        </a>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
              <div className="text-right ml-3 flex-shrink-0">
                <p className="text-sm font-bold text-gray-900">{fmt(exp.amount)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(exp.submitted_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'flagged' && (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {(() => {
            const flagged = expenses.filter((e) => e.duplicate_flag || !e.imprest_id || (e.overspend_amount || 0) > 0);
            if (flagged.length === 0) {
              return <p className="text-center text-green-500 text-sm py-6">✓ No flagged expenses — everything is clean</p>;
            }
            return flagged.map((exp) => {
              // Build the list of reasons this expense is flagged
              const reasons = [];
              if (exp.duplicate_flag) reasons.push({ icon: '⚠', color: 'text-orange-700 bg-orange-50 border-orange-200', label: 'Duplicate', detail: exp.duplicate_ref ? `Matches a previous expense (${exp.duplicate_ref}) — same transaction may be claimed twice.` : 'Flagged by duplicate detection — same transaction ID / amount within the dedup window.' });
              if (!exp.imprest_id) reasons.push({ icon: '🚩', color: 'text-red-700 bg-red-50 border-red-200', label: 'No Imprest Linked', detail: 'Submitted without an approved imprest advance. Cannot be reconciled against any disbursed cash — verify manually.' });
              if ((exp.overspend_amount || 0) > 0) reasons.push({ icon: '💸', color: 'text-purple-700 bg-purple-50 border-purple-200', label: `Overspend ${fmt(exp.overspend_amount)}`, detail: `Claimed ₹${Number(exp.amount).toLocaleString('en-IN')}${exp.original_amount ? ` (original ₹${Number(exp.original_amount).toLocaleString('en-IN')})` : ''}, which is ${fmt(exp.overspend_amount)} above the remaining imprest balance${exp.imprest_id ? ` for ${imprestRefById[exp.imprest_id] || 'the linked imprest'}` : ''}.` });

              return (
                <div key={exp.id} className="bg-white border border-red-100 rounded-lg px-3 py-2.5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-amber-600">{exp.ref_id}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${STATUS_BADGE[exp.status] || 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABEL[exp.status] || exp.status}
                        </span>
                        {exp.imprest_id && <span className="text-[11px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-mono">🔗 {imprestRefById[exp.imprest_id] || 'imprest'}</span>}
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{exp.category} · {exp.site}{exp.description ? ` · ${exp.description}` : ''}</p>
                    </div>
                    <div className="text-right ml-3 flex-shrink-0">
                      <p className="text-sm font-bold text-gray-900">{fmt(exp.amount)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(exp.submitted_at)}</p>
                    </div>
                  </div>
                  {/* Reasons */}
                  <div className="mt-2 space-y-1.5">
                    {reasons.map((r, i) => (
                      <div key={i} className={`flex items-start gap-2 text-xs border rounded-md px-2 py-1.5 ${r.color}`}>
                        <span className="flex-shrink-0">{r.icon}</span>
                        <div>
                          <span className="font-semibold">{r.label}</span>
                          <span className="text-gray-600"> — {r.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, colour }) {
  const styles = {
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    amber:  'bg-amber-50 border-amber-200 text-amber-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    teal:   'bg-teal-50 border-teal-200 text-teal-700',
    red:    'bg-red-50 border-red-200 text-red-700',
  };
  const cls = styles[colour] || styles.blue;
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm font-medium text-gray-600 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
