// Sunday Check — every paid food Sunday that has passed, next to the employee's
// HR punch-in for that day (finance.food_sunday_check, migration 045). Since the
// Sunday rule, a Sunday is paid only when the employee ticked it as a working
// day; older requests paid every Sunday. Read-only: Finance decides what to do.
import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';

function fmt(n) { return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '--'; }
function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''; }

const STATUS = {
  not_worked: { label: 'Not worked', tint: 'bg-red-100 text-red-700' },
  worked:     { label: 'Worked',     tint: 'bg-green-100 text-green-700' },
  no_record:  { label: 'No record',  tint: 'bg-gray-100 text-gray-600' },
};

export default function SundayCheckPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(120);
  const [status, setStatus] = useState('not_worked');
  const [ruleOnly, setRuleOnly] = useState(false);
  const [name, setName] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/imprest/sunday-check', { params: { days } });
      setRows(data.data.rows || []);
    } catch { showToast('Failed to load Sunday check', 'error'); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const scoped = useMemo(() => rows.filter((r) =>
    (!ruleOnly || r.under_rule)
    && (!name.trim() || r.employee_name?.toLowerCase().includes(name.trim().toLowerCase()))
  ), [rows, ruleOnly, name]);

  const totals = useMemo(() => {
    const t = { not_worked: [0, 0], worked: [0, 0], no_record: [0, 0] };
    for (const r of scoped) { t[r.punch_status][0] += 1; t[r.punch_status][1] += Number(r.day_amount); }
    return t;
  }, [scoped]);

  const shown = status === 'all' ? scoped : scoped.filter((r) => r.punch_status === status);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Sunday Check</h1>
        <p className="text-sm text-gray-500 mt-1">
          Food paid for a Sunday, checked against the employee's punch-in that day. Sunday is the weekly off: food is
          paid for it only if the employee ticked it as a working day (requests raised before this rule paid every Sunday).
          Nothing is deducted automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {Object.entries(STATUS).map(([key, s]) => (
          <button key={key} onClick={() => setStatus(key)}
            className={`text-left bg-white rounded-xl border p-4 transition-colors ${status === key ? 'border-gray-900' : 'border-gray-200 hover:border-gray-400'}`}>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.tint}`}>{s.label}</span>
            <div className="mt-2 text-2xl font-bold text-gray-900">{fmt(totals[key][1])}</div>
            <div className="text-xs text-gray-500">{totals[key][0]} Sunday{totals[key][0] === 1 ? '' : 's'}</div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3 items-center">
        <input type="text" placeholder="Search employee..." value={name} onChange={(e) => setName(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="not_worked">Not worked</option>
          <option value="worked">Worked</option>
          <option value="no_record">No record</option>
          <option value="all">All</option>
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value={60}>Last 60 days</option>
          <option value={120}>Last 120 days</option>
          <option value={365}>Last 365 days</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={ruleOnly} onChange={(e) => setRuleOnly(e.target.checked)} />
          Ticked Sundays only (new rule)
        </label>
        <span className="ml-auto text-sm text-gray-500">{shown.length} rows</span>
        <button onClick={fetchRows} className="text-sm text-amber-700 hover:text-amber-900">↻ Refresh</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Sunday', 'Employee', 'Ref ID', 'People', 'Paid for the day', 'Punch-in', ''].map((h) => (
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase ${h === 'Paid for the day' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array(4).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(7).fill(0).map((__, j) => <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-200 rounded w-full max-w-[80px]" /></td>)}
                  </tr>
                ))
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Nothing to show</td></tr>
              ) : shown.map((r) => (
                <tr key={`${r.imprest_id}-${r.sunday}`} className="hover:bg-amber-50/40">
                  <td className="px-4 py-3 whitespace-nowrap text-gray-900">{fmtDate(r.sunday)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.employee_name}</div>
                    <div className="text-xs text-gray-500">{r.site}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{r.ref_id}</td>
                  <td className="px-4 py-3 text-gray-700">{r.people_count}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmt(r.day_amount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                    <span className={`font-semibold px-2 py-0.5 rounded-full ${STATUS[r.punch_status].tint}`}>{STATUS[r.punch_status].label}</span>
                    {r.punched_at && <span className="ml-2">{fmtTime(r.punched_at)}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{r.under_rule ? 'Ticked' : 'Before rule'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-3">
        Punch-ins come from HR attendance, matched by employee name. For requests covering several people, the amount is
        the whole group's food for that day and only the requester's punch-in is checked.
      </p>
    </div>
  );
}
