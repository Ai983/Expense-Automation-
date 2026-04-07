import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';

const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi', 'Bhuj', 'Vaneet Infra',
  'Dee Foundation Omaxe, Faridabad', 'Auma India Bengaluru',
  'Minebea Mitsumi', 'Hero Homes Ludhiana', 'Bansal Tower',
  'KOKO Town, Chandigarh', 'Head Office', 'Bangalore Office', 'Others',
];

function fmt(n) { return `₹${Number(n).toLocaleString('en-IN')}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null; }

export default function S2QueuePage() {
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterSite, setFilterSite] = useState('all');
  const [filterName, setFilterName] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [notes, setNotes] = useState('');
  const [approveAmount, setApproveAmount] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const limit = 50;

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (filterSite !== 'all') params.site = filterSite;
      if (filterName.trim()) params.employeeName = filterName.trim();
      const { data } = await api.get('/api/imprest/s2/queue', { params });
      setRequests(data.data.requests || []);
      setTotal(data.data.total || 0);
    } catch { showToast('Failed to load queue', 'error'); }
    finally { setLoading(false); }
  }, [page, filterSite, filterName]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const openForward = (req) => {
    setSelected(req); setApproveAmount(String(req.amount_requested));
    setNotes(''); setActionError(''); setModalMode('forward');
  };
  const openReject = (req) => { setSelected(req); setRejectReason(''); setActionError(''); setModalMode('reject'); };
  const closeModal = () => { setSelected(null); setModalMode(null); };

  const handleForward = async () => {
    setActing(true); setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/s2-approve`, {
        notes: notes.trim() || undefined,
        approvedAmount: parseFloat(approveAmount) || undefined,
      });
      showToast('Forwarded to Finance team', 'success');
      closeModal(); fetchQueue();
    } catch (e) { setActionError(e.response?.data?.error || 'Failed'); }
    finally { setActing(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setActionError('Reason is required'); return; }
    setActing(true); setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/s2-reject`, { reason: rejectReason.trim() });
      showToast('Request rejected', 'info');
      closeModal(); fetchQueue();
    } catch (e) { setActionError(e.response?.data?.error || 'Failed'); }
    finally { setActing(false); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Imprest Approval (Stage 2)</h1>
        <p className="text-sm text-gray-500 mt-1">Review requests forwarded from Stage 1 and forward to Finance</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
        <input type="text" placeholder="Search employee..." value={filterName}
          onChange={(e) => { setFilterName(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <select value={filterSite} onChange={(e) => { setFilterSite(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="all">All Sites</option>
          {IMPREST_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500 self-center">{total} request{total !== 1 ? 's' : ''}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400">No requests pending approval</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Ref ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Purpose</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">S1 Reviewer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Prev Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-amber-600 font-semibold">{req.ref_id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{req.employee?.name || '--'}</div>
                      <div className="text-xs text-gray-500">{req.site}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{req.category}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[140px] line-clamp-2">{req.purpose || '--'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(req.amount_requested)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {req.s1_approved_at ? fmtDate(req.s1_approved_at) : '--'}
                      {req.s1_notes && <div className="text-gray-400 mt-0.5">"{req.s1_notes}"</div>}
                    </td>
                    <td className="px-4 py-3">
                      {req.employee_total_balance > 0
                        ? <span className="text-xs font-bold text-red-600">{fmt(req.employee_total_balance)}</span>
                        : <span className="text-xs text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(req.submitted_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <button onClick={() => openForward(req)}
                          className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700">Forward to Finance</button>
                        <button onClick={() => openReject(req)}
                          className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700">Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t flex justify-between text-sm text-gray-500">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:text-gray-300">Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="disabled:text-gray-300">Next</button>
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && modalMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">
                {modalMode === 'forward' ? 'Forward to Finance' : 'Reject Request'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{selected.ref_id} -- {selected.employee?.name}</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Amount Requested</span><span className="font-bold">{fmt(selected.amount_requested)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{selected.category}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{selected.site}</span></div>
                {selected.purpose && <div className="flex justify-between"><span className="text-gray-500">Purpose</span><span className="text-right max-w-[200px]">{selected.purpose}</span></div>}
              </div>

              {modalMode === 'forward' && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Approved Amount (₹) — you can reduce</label>
                    <input type="number" value={approveAmount} onChange={(e) => setApproveAmount(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    {parseFloat(approveAmount) < parseFloat(selected.amount_requested) && approveAmount && (
                      <p className="text-xs text-blue-600 mt-1">Amount reduced from {fmt(selected.amount_requested)} to {fmt(approveAmount)}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Notes (optional)</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-none" rows={2} />
                  </div>
                </>
              )}

              {modalMode === 'reject' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Rejection Reason *</label>
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none" rows={3} placeholder="Reason..." />
                </div>
              )}

              {actionError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>}
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Cancel</button>
              {modalMode === 'forward' ? (
                <button onClick={handleForward} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60">
                  {acting ? 'Forwarding...' : 'Forward to Finance'}
                </button>
              ) : (
                <button onClick={handleReject} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60">
                  {acting ? 'Rejecting...' : 'Reject'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
