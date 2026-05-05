import { useEffect, useState } from 'react';
import { getFinanceAdjustments } from '../services/expenseService';
import { showToast } from '../components/layout/Toast';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function AdjustmentSettlementsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await getFinanceAdjustments();
      setData(res);
    } catch {
      showToast('Failed to load adjustment settlements', 'error');
    } finally {
      setLoading(false);
    }
  }

  function toggle(empId) {
    setExpanded((prev) => ({ ...prev, [empId]: !prev[empId] }));
  }

  const employees = (data?.employees || []).filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.site.toLowerCase().includes(q);
  });

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance Adjustment Settlements</h1>
          <p className="text-sm text-gray-500 mt-1">
            Employees whose expense amounts were reduced by finance and still have an outstanding balance to settle.
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 font-medium transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* ── Summary cards ── */}
      {data && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Employees with Pending</p>
            <p className="text-3xl font-bold text-orange-500">{data.employees.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Total Adjustments</p>
            <p className="text-3xl font-bold text-gray-800">
              {data.employees.reduce((s, e) => s + e.adjustments.length, 0)}
            </p>
          </div>
          <div className="bg-orange-50 rounded-xl border border-orange-200 p-5">
            <p className="text-xs font-semibold text-orange-400 uppercase tracking-wide mb-1">Total Unsettled</p>
            <p className="text-3xl font-bold text-orange-600">{fmt(data.totalUnsettled)}</p>
          </div>
        </div>
      )}

      {/* ── Search ── */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by name, email or site..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-80 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* ── Body ── */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400">Loading...</div>
      ) : employees.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-lg font-semibold text-gray-700">All clear!</p>
          <p className="text-sm text-gray-400 mt-1">No employees have pending settlement amounts.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {employees.map((emp) => (
            <div key={emp.employeeId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">

              {/* ── Employee row ── */}
              <button
                className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition-colors"
                onClick={() => toggle(emp.employeeId)}
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm shrink-0">
                  {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>

                {/* Name + site */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">{emp.name}</p>
                  <p className="text-xs text-gray-400">{emp.email} · {emp.site}</p>
                </div>

                {/* Count */}
                <div className="text-center px-4">
                  <p className="text-lg font-bold text-gray-700">{emp.adjustments.length}</p>
                  <p className="text-xs text-gray-400">expense{emp.adjustments.length !== 1 ? 's' : ''}</p>
                </div>

                {/* Total gap */}
                <div className="text-center px-4">
                  <p className="text-sm font-semibold text-gray-500">{fmt(emp.totalGap)}</p>
                  <p className="text-xs text-gray-400">total gap</p>
                </div>

                {/* Remaining — highlighted */}
                <div className="text-right px-4">
                  <span className="inline-block bg-orange-100 text-orange-700 text-sm font-bold px-3 py-1 rounded-full">
                    {fmt(emp.totalRemaining)} pending
                  </span>
                </div>

                {/* Chevron */}
                <span className="text-gray-400 text-sm ml-2">{expanded[emp.employeeId] ? '▲' : '▼'}</span>
              </button>

              {/* ── Expanded: per-expense detail ── */}
              {expanded[emp.employeeId] && (
                <div className="border-t border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                        <th className="px-6 py-2 text-left">Ref ID</th>
                        <th className="px-4 py-2 text-left">Category · Site</th>
                        <th className="px-4 py-2 text-right">Claimed</th>
                        <th className="px-4 py-2 text-right">Approved</th>
                        <th className="px-4 py-2 text-right">Gap</th>
                        <th className="px-4 py-2 text-right">Settled</th>
                        <th className="px-4 py-2 text-right font-bold text-orange-600">Remaining</th>
                        <th className="px-4 py-2 text-left">Approved On</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {emp.adjustments.map((adj) => {
                        const fullyUnsettled = adj.settledSoFar === 0;
                        return (
                          <tr key={adj.id} className={fullyUnsettled ? 'bg-red-50' : 'bg-yellow-50'}>
                            <td className="px-6 py-3 font-mono text-xs text-gray-700">{adj.ref_id}</td>
                            <td className="px-4 py-3 text-gray-600">{adj.category} · {adj.site}</td>
                            <td className="px-4 py-3 text-right text-gray-500">{fmt(adj.originalAmount)}</td>
                            <td className="px-4 py-3 text-right text-green-700 font-semibold">{fmt(adj.approvedAmount)}</td>
                            <td className="px-4 py-3 text-right text-red-600 font-semibold">{fmt(adj.gap)}</td>
                            <td className="px-4 py-3 text-right text-blue-600">{adj.settledSoFar > 0 ? fmt(adj.settledSoFar) : <span className="text-gray-300">—</span>}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`font-bold ${adj.remaining === adj.gap ? 'text-red-600' : 'text-orange-500'}`}>
                                {fmt(adj.remaining)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-400">{fmtDate(adj.approvedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 font-semibold text-sm">
                        <td colSpan={4} className="px-6 py-3 text-gray-500">Total for {emp.name}</td>
                        <td className="px-4 py-3 text-right text-red-600">{fmt(emp.totalGap)}</td>
                        <td className="px-4 py-3 text-right text-blue-600">
                          {fmt(emp.adjustments.reduce((s, a) => s + a.settledSoFar, 0))}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-600 font-bold">{fmt(emp.totalRemaining)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

            </div>
          ))}
        </div>
      )}
    </div>
  );
}
