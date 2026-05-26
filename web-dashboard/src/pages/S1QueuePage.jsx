import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';

const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi',
  'DEE Development Engineer - Canteen', 'DEE Development Engineer - Admin',
  'Vaneet Infra', 'Dee Foundation Omaxe, Faridabad', 'Auma India Bengaluru',
  'Minebea Mitsumi', 'Hero Homes Ludhiana', 'Hero Homes Greater Noida',
  'Bansal Tower', 'KOKO Town, Chandigarh', 'Vinfast Jaipur', 'Head Office', 'Bangalore Office', 'Others',
];

function fmt(n) { return `₹${Number(n).toLocaleString('en-IN')}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null; }

// Visual pipeline component — shows the approval stages this request will pass through
function PipelineStepper({ route }) {
  const isDirector = route === 'avisha_director_finance';
  const stages = isDirector
    ? [
        { label: 'You', sub: 'S1', done: true },
        { label: 'Director', sub: 'WhatsApp', done: false },
        { label: 'Finance', sub: 'Portal', done: false },
        { label: 'Paid', sub: '', done: false },
      ]
    : [
        { label: 'You', sub: 'S1', done: true },
        { label: "Ritu Ma'am", sub: 'S2', done: false },
        { label: 'Finance', sub: 'Portal', done: false },
        { label: 'Paid', sub: '', done: false },
      ];

  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              title={`${s.label}${s.sub ? ' (' + s.sub + ')' : ''}`}
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${
                s.done
                  ? 'bg-green-500 text-white ring-2 ring-green-200'
                  : i === 1
                  ? (isDirector ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300' : 'bg-blue-100 text-blue-700 ring-1 ring-blue-300')
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {s.done ? '✓' : i + 1}
            </div>
            <span className="text-[9px] text-gray-500 mt-0.5 leading-none">{s.label}</span>
          </div>
          {i < stages.length - 1 && (
            <div className={`w-3 h-0.5 mx-0.5 mb-3 ${s.done ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// Skeleton row used while loading
function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {Array(9).fill(0).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-3 bg-gray-200 rounded w-full max-w-[80px]" />
        </td>
      ))}
    </tr>
  );
}

// Inline spinner for action buttons
function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin h-3.5 w-3.5 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function S1QueuePage() {
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterSite, setFilterSite] = useState('all');
  const [filterName, setFilterName] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [notes, setNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [rowActioning, setRowActioning] = useState({}); // { reqId: 'forward'|'reject' }
  const [exitingRows, setExitingRows] = useState(new Set());
  const limit = 50;

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (filterSite !== 'all') params.site = filterSite;
      if (filterName.trim()) params.employeeName = filterName.trim();
      const { data } = await api.get('/api/imprest/s1/queue', { params });
      setRequests(data.data.requests || []);
      setTotal(data.data.total || 0);
    } catch { showToast('Failed to load queue', 'error'); }
    finally { setLoading(false); }
  }, [page, filterSite, filterName]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Trigger modal slide-in after mount
  useEffect(() => {
    if (selected && modalMode) {
      requestAnimationFrame(() => setModalVisible(true));
    } else {
      setModalVisible(false);
    }
  }, [selected, modalMode]);

  const openForward = (req) => { setSelected(req); setNotes(''); setActionError(''); setModalMode('forward'); };
  const openReject = (req) => { setSelected(req); setRejectReason(''); setActionError(''); setModalMode('reject'); };
  const closeModal = () => {
    setModalVisible(false);
    setTimeout(() => { setSelected(null); setModalMode(null); }, 200);
  };

  const handleForward = async () => {
    setActing(true); setActionError('');
    const requestId = selected.id;
    const destination = selected.approval_route === 'avisha_director_finance'
      ? 'Director (WhatsApp)' : "Ritu Ma'am";
    try {
      await api.post(`/api/imprest/${requestId}/s1-approve`, { notes: notes.trim() || undefined });
      showToast(`✓ Forwarded to ${destination}`, 'success');
      closeModal();
      // Animate the row out then refetch
      setExitingRows((prev) => new Set(prev).add(requestId));
      setTimeout(() => fetchQueue(), 350);
    } catch (e) { setActionError(e.response?.data?.error || 'Failed'); }
    finally { setActing(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setActionError('Reason is required'); return; }
    setActing(true); setActionError('');
    const requestId = selected.id;
    try {
      await api.post(`/api/imprest/${requestId}/s1-reject`, { reason: rejectReason.trim() });
      showToast('Request rejected', 'info');
      closeModal();
      setExitingRows((prev) => new Set(prev).add(requestId));
      setTimeout(() => fetchQueue(), 350);
    } catch (e) { setActionError(e.response?.data?.error || 'Failed'); }
    finally { setActing(false); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Imprest Review (Stage 1)</h1>
        <p className="text-sm text-gray-500 mt-1">Review and forward imprest requests through the approval pipeline</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
        <input type="text" placeholder="Search employee..." value={filterName}
          onChange={(e) => { setFilterName(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-shadow" />
        <select value={filterSite} onChange={(e) => { setFilterSite(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 transition-shadow">
          <option value="all">All Sites</option>
          {IMPREST_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500 self-center">{total} request{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Ref ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Purpose</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Approval Pipeline</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Prev Balance</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Submitted</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array(4).fill(0).map((_, i) => <SkeletonRow key={i} />)
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    <div className="text-3xl mb-2">📭</div>
                    No requests pending review
                  </td>
                </tr>
              ) : (
                requests.map((req) => {
                  const exiting = exitingRows.has(req.id);
                  const busy = rowActioning[req.id];
                  return (
                    <tr
                      key={req.id}
                      className={`hover:bg-amber-50/40 transition-all duration-300 ${
                        exiting ? 'opacity-0 -translate-x-4' : 'opacity-100'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-amber-600 font-semibold">{req.ref_id}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{req.employee?.name || '--'}</div>
                        <div className="text-xs text-gray-500">{req.site}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{req.category}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[140px] line-clamp-2">{req.purpose || '--'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(req.amount_requested)}</td>
                      <td className="px-4 py-3">
                        <PipelineStepper route={req.approval_route} />
                      </td>
                      <td className="px-4 py-3">
                        {req.employee_total_balance > 0
                          ? <span className="text-xs font-bold text-red-600">{fmt(req.employee_total_balance)}</span>
                          : <span className="text-xs text-gray-300">--</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(req.submitted_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => openForward(req)}
                            disabled={!!busy}
                            className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                          >
                            {busy === 'forward' ? <Spinner /> : null}
                            Forward
                          </button>
                          <button
                            onClick={() => openReject(req)}
                            disabled={!!busy}
                            className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                          >
                            {busy === 'reject' ? <Spinner /> : null}
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && !loading && (
          <div className="px-4 py-3 border-t flex justify-between text-sm text-gray-500">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:text-gray-300 hover:text-amber-600 transition-colors">Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="disabled:text-gray-300 hover:text-amber-600 transition-colors">Next</button>
          </div>
        )}
      </div>

      {/* Modal with slide-up + fade animation */}
      {selected && modalMode && (
        <div
          className={`fixed inset-0 flex items-center justify-center z-50 p-4 transition-opacity duration-200 ${
            modalVisible ? 'bg-black/50 opacity-100' : 'bg-black/0 opacity-0 pointer-events-none'
          }`}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div
            className={`bg-white rounded-2xl shadow-2xl w-full max-w-lg transition-all duration-200 ${
              modalVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
            }`}
          >
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">
                {modalMode === 'forward' ? 'Forward Request' : 'Reject Request'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{selected.ref_id} — {selected.employee?.name}</p>
            </div>

            {modalMode === 'forward' && (
              <div className="px-6 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Approval Pipeline</p>
                <div className="bg-gradient-to-r from-amber-50 to-white rounded-lg p-3 border border-amber-100">
                  <PipelineStepper route={selected.approval_route} />
                </div>
              </div>
            )}

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold">{fmt(selected.amount_requested)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{selected.category}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{selected.site}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Next stage</span>
                  <span className="font-medium">{selected.approval_route === 'avisha_director_finance' ? 'Director (WhatsApp)' : "Ritu Ma'am"}</span>
                </div>
                {selected.purpose && <div className="flex justify-between"><span className="text-gray-500">Purpose</span><span className="text-right max-w-[200px]">{selected.purpose}</span></div>}
                {selected.employee_total_balance > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">Prev Balance</span><span className="font-bold text-red-600">{fmt(selected.employee_total_balance)}</span></div>
                )}
              </div>

              {modalMode === 'forward' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Notes (optional)</label>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400" rows={2} placeholder="Any notes for the next reviewer..." />
                  <p className="text-xs text-gray-400 mt-1">
                    {selected.approval_route === 'avisha_director_finance'
                      ? '⚡ A WhatsApp approval request will be sent to Bhaskar Sir'
                      : "⚡ This will appear in Ritu Ma'am's review queue"}
                  </p>
                </div>
              )}

              {modalMode === 'reject' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Rejection Reason *</label>
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400" rows={3} placeholder="Reason for rejection..." />
                </div>
              )}

              {actionError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 animate-[fadeIn_0.2s_ease-in]">
                  {actionError}
                </p>
              )}
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={closeModal} disabled={acting} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">Cancel</button>
              {modalMode === 'forward' ? (
                <button onClick={handleForward} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 active:scale-95 transition-all disabled:opacity-60 flex items-center gap-2 min-w-[120px] justify-center">
                  {acting && <Spinner className="text-white" />}
                  {acting ? 'Forwarding...' : 'Forward →'}
                </button>
              ) : (
                <button onClick={handleReject} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 active:scale-95 transition-all disabled:opacity-60 flex items-center gap-2 min-w-[120px] justify-center">
                  {acting && <Spinner className="text-white" />}
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
