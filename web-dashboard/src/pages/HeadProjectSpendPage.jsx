import { useState, useEffect } from 'react';
import api from '../services/api';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function HeadProjectSpendPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('total_spend');

  useEffect(() => {
    api.get('/api/po-payments/project-spend')
      .then((res) => setProjects(res.data?.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...projects].sort((a, b) => {
    if (sort === 'total_spend') return (b.total_spend || b.totalPaid || 0) - (a.total_spend || a.totalPaid || 0);
    if (sort === 'pending')     return (b.pendingPayment || 0) - (a.pendingPayment || 0);
    return 0;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Project Spend</h1>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="total_spend">Sort: Total Spend</option>
          <option value="pending">Sort: Pending Payment</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Project','Sites','PO Paid','PO Pending','Count','Total Spend'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((p, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">{p.project_name || p.projectName || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {(p.sites || []).join(', ') || p.site || '—'}
                  </td>
                  <td className="px-4 py-3 text-green-700 font-medium">{fmt(p.totalPaid || p.total_paid || 0)}</td>
                  <td className="px-4 py-3 text-yellow-700 font-medium">{fmt(p.pendingPayment || p.pending_payment || 0)}</td>
                  <td className="px-4 py-3 text-gray-600">{p.poCount || p.count || 0}</td>
                  <td className="px-4 py-3 font-bold text-gray-900">{fmt((p.totalPaid || p.total_paid || 0) + (p.pendingPayment || p.pending_payment || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && <p className="text-center py-8 text-gray-400">No project data yet</p>}
        </div>
      )}
    </div>
  );
}
