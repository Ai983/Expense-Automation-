import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import AgingPill from '../components/head/AgingPill';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-800',
  manual_review: 'bg-orange-100 text-orange-800',
  verified: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  blocked: 'bg-gray-100 text-gray-600',
};

export default function HeadExpenseListPage() {
  const [expenses, setExpenses] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [site, setSite] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (status) params.set('status', status);
      if (site) params.set('site', site);
      const res = await api.get(`/api/expenses/finance/queue?${params}`);
      const d = res.data?.data;
      setExpenses(d?.expenses || []);
      setTotal(d?.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, status, site]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">All Expenses <span className="text-sm font-normal text-gray-400">(read-only)</span></h1>

      <div className="flex flex-wrap gap-3">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="">All Statuses</option>
          {['pending','manual_review','verified','approved','rejected','blocked'].map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <input value={site} onChange={(e) => { setSite(e.target.value); setPage(1); }}
          placeholder="Filter by site…"
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 w-48" />
      </div>

      <p className="text-sm text-gray-500">{total} total records</p>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Ref ID','Employee','Site','Category','Amount','Status','Submitted','Age'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expenses.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-brand-600">{e.ref_id}</td>
                  <td className="px-4 py-3 text-gray-800">{e.employee?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{e.site}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{e.category}</td>
                  <td className="px-4 py-3 font-semibold">{fmt(e.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[e.status] || 'bg-gray-100 text-gray-600'}`}>
                      {e.status?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(e.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    {['pending','manual_review','verified'].includes(e.status) && (
                      <AgingPill submittedAt={e.submitted_at} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {expenses.length === 0 && (
            <p className="text-center py-8 text-gray-400">No expenses found</p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40">← Prev</button>
        <span className="px-4 py-2 text-sm text-gray-500">Page {page}</span>
        <button disabled={expenses.length < 50} onClick={() => setPage((p) => p + 1)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40">Next →</button>
      </div>
    </div>
  );
}
