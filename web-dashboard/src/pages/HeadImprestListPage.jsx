import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import AgingPill from '../components/head/AgingPill';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const STAGE_LABELS = {
  s1_pending: 'S1 Pending',
  s1_approved: 'S1 Approved',
  s1_rejected: 'S1 Rejected',
  s2_pending: 'S2 Pending',
  s2_approved: 'S2 Approved',
  s2_rejected: 'S2 Rejected',
  s3_pending: 'Finance Pending',
  s3_approved: 'Finance Approved',
  s3_rejected: 'Finance Rejected',
  director_rejected: 'Director Rejected',
  paid: 'Paid',
};

const STAGE_STYLES = {
  s1_pending: 'bg-yellow-100 text-yellow-800',
  s2_pending: 'bg-orange-100 text-orange-800',
  s3_pending: 'bg-blue-100 text-blue-800',
  s3_approved: 'bg-teal-100 text-teal-800',
  paid: 'bg-green-100 text-green-800',
  s1_rejected: 'bg-red-100 text-red-800',
  s2_rejected: 'bg-red-100 text-red-800',
  s3_rejected: 'bg-red-100 text-red-800',
  director_rejected: 'bg-red-100 text-red-800',
};

const ACTIVE_STAGES = ['s1_pending', 's2_pending', 's3_pending', 's3_approved'];

export default function HeadImprestListPage() {
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [stageFilter, setStageFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (stageFilter) params.set('stage', stageFilter);
      if (siteFilter) params.set('site', siteFilter);
      const res = await api.get(`/api/imprest/finance/queue?${params}`);
      const d = res.data?.data;
      setRequests(d?.requests || []);
      setTotal(d?.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, stageFilter, siteFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">All Imprests <span className="text-sm font-normal text-gray-400">(read-only)</span></h1>

      <div className="flex flex-wrap gap-3">
        <select value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="">All Stages</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input value={siteFilter} onChange={(e) => { setSiteFilter(e.target.value); setPage(1); }}
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
                {['Ref ID','Employee','Site','Category','Requested','Approved','Stage','Submitted','Age'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-brand-600">{r.ref_id}</td>
                  <td className="px-4 py-3 text-gray-800">{r.employee?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.site}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.category}</td>
                  <td className="px-4 py-3 font-semibold">{fmt(r.amount_requested)}</td>
                  <td className="px-4 py-3 text-green-700">{r.approved_amount ? fmt(r.approved_amount) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STAGE_STYLES[r.current_stage] || 'bg-gray-100 text-gray-600'}`}>
                      {STAGE_LABELS[r.current_stage] || r.current_stage}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(r.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    {ACTIVE_STAGES.includes(r.current_stage) && (
                      <AgingPill submittedAt={r.submitted_at} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {requests.length === 0 && (
            <p className="text-center py-8 text-gray-400">No imprests found</p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40">← Prev</button>
        <span className="px-4 py-2 text-sm text-gray-500">Page {page}</span>
        <button disabled={requests.length < 50} onClick={() => setPage((p) => p + 1)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40">Next →</button>
      </div>
    </div>
  );
}
