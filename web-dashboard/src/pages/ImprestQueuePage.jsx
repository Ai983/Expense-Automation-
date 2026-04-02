import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const IMPREST_CATEGORIES = [
  'Food Expense', 'Site Room Rent', 'Travelling', 'Conveyance',
  'Labour Expense', 'Porter', 'Hotel Expense', 'Other',
];

const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi', 'Bhuj', 'Vaneet Infra',
  'Dee Foundation Omaxe, Faridabad', 'Auma India Bengaluru',
  'Minebea Mitsumi', 'Hero Homes Ludhiana', 'Bansal Tower',
  'KOKO Town, Chandigarh', 'Head Office', 'Bangalore Office', 'Others',
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially_approved', label: 'Partially Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  partially_approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
};

const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  partially_approved: 'Partially Approved',
  rejected: 'Rejected',
};

function deviationClass(deviation, requested) {
  if (!deviation || !requested) return '';
  const pct = Math.abs(deviation / requested) * 100;
  if (pct > 30) return 'text-red-600 font-bold';
  if (pct > 10) return 'text-yellow-600 font-semibold';
  return 'text-green-600';
}

export default function ImprestQueuePage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 50;

  // Filters
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSite, setFilterSite] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterEmployeeName, setFilterEmployeeName] = useState('');

  // Modal state
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState(null); // 'approve' | 'reject'
  const [approveAmount, setApproveAmount] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterSite !== 'all') params.site = filterSite;
      if (filterCategory !== 'all') params.category = filterCategory;
      if (filterDateFrom) params.dateFrom = filterDateFrom;
      if (filterDateTo) params.dateTo = filterDateTo;
      if (filterEmployeeName.trim()) params.employeeName = filterEmployeeName.trim();

      const { data } = await api.get('/api/imprest/finance/queue', { params });
      setRequests(data.data.requests || []);
      setTotal(data.data.total || 0);
    } catch (e) {
      console.error('Failed to fetch imprest queue', e);
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterSite, filterCategory, filterDateFrom, filterDateTo, filterEmployeeName]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const openApprove = (req) => {
    setSelected(req);
    setApproveAmount(String(req.amount_requested));
    setRejectReason('');
    setActionError('');
    setModalMode('approve');
  };

  const openReject = (req) => {
    setSelected(req);
    setRejectReason('');
    setActionError('');
    setModalMode('reject');
  };

  const closeModal = () => {
    setSelected(null);
    setModalMode(null);
    setApproveAmount('');
    setRejectReason('');
    setActionError('');
  };

  const handleApprove = async () => {
    if (!approveAmount || parseFloat(approveAmount) <= 0) {
      setActionError('Enter a valid approved amount.');
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/approve`, {
        approvedAmount: parseFloat(approveAmount),
      });
      closeModal();
      fetchQueue();
    } catch (e) {
      setActionError(e.response?.data?.error || 'Approval failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      setActionError('Rejection reason is required.');
      return;
    }
    setActionLoading(true);
    setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/reject`, {
        reason: rejectReason.trim(),
      });
      closeModal();
      fetchQueue();
    } catch (e) {
      setActionError(e.response?.data?.error || 'Rejection failed.');
    } finally {
      setActionLoading(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Imprest Queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review and approve advance/imprest requests from site engineers
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search employee name..."
          value={filterEmployeeName}
          onChange={(e) => { setFilterEmployeeName(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
        />
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <select
          value={filterSite}
          onChange={(e) => { setFilterSite(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Sites</option>
          {IMPREST_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Categories</option>
          {IMPREST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <input
          type="date"
          value={filterDateFrom}
          onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <input
          type="date"
          value={filterDateTo}
          onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />

        <button
          onClick={() => { setFilterStatus('all'); setFilterCategory('all'); setFilterSite('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterEmployeeName(''); setPage(1); }}
          className="text-sm text-gray-500 hover:text-gray-700 px-2"
        >
          Clear
        </button>

        <span className="ml-auto text-sm text-gray-500 self-center">
          {total} request{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading...</div>
        ) : requests.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No requests found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ref ID</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">People</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Approved</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">AI / Deviation</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-brand-600 font-semibold">{req.ref_id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{req.employee?.name || '—'}</div>
                      <div className="text-xs text-gray-500">{req.site}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{req.category}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{req.people_count}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      ₹{Number(req.amount_requested).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {req.approved_amount != null ? (
                        <span className={`font-semibold ${Number(req.approved_amount) < Number(req.amount_requested) ? 'text-blue-600' : 'text-green-600'}`}>
                          ₹{Number(req.approved_amount).toLocaleString('en-IN')}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {req.category === 'Travelling' && req.ai_estimated_amount ? (
                        <div>
                          <div className="text-xs text-gray-500">AI: ₹{Number(req.ai_estimated_amount).toLocaleString('en-IN')}</div>
                          {req.amount_deviation !== null && (
                            <div className={`text-xs ${deviationClass(req.amount_deviation, req.amount_requested)}`}>
                              Δ ₹{Number(req.amount_deviation).toLocaleString('en-IN')}
                              {' '}({Math.round(Math.abs(req.amount_deviation / req.amount_requested) * 100)}%)
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[req.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABELS[req.status] || req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(req.submitted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      {req.status === 'pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => openApprove(req)}
                            className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => openReject(req)}
                            className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 transition-colors"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="text-sm text-gray-600 disabled:text-gray-300 hover:text-gray-900"
            >
              ← Previous
            </button>
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="text-sm text-gray-600 disabled:text-gray-300 hover:text-gray-900"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Modal */}
      {selected && modalMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {modalMode === 'approve' ? 'Approve Request' : 'Reject Request'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{selected.ref_id}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <DetailRow label="Employee" value={selected.employee?.name || '—'} />
                <DetailRow label="Site" value={selected.site} />
                <DetailRow label="Category" value={selected.category} />
                <DetailRow label="People" value={selected.people_count} />
                <DetailRow label="Amount Requested" value={`₹${Number(selected.amount_requested).toLocaleString('en-IN')}`} bold />
                {selected.category === 'Travelling' && selected.ai_estimated_amount && (
                  <>
                    <DetailRow label="AI Estimate" value={`₹${Number(selected.ai_estimated_amount).toLocaleString('en-IN')}`} />
                    <DetailRow
                      label="Route"
                      value={`${selected.travel_from || '?'} → ${selected.travel_to || '?'}`}
                    />
                    {selected.amount_deviation !== null && (
                      <DetailRow
                        label="Deviation"
                        value={`₹${Number(selected.amount_deviation).toLocaleString('en-IN')} (${Math.round(Math.abs(selected.amount_deviation / selected.amount_requested) * 100)}%)`}
                        className={deviationClass(selected.amount_deviation, selected.amount_requested)}
                      />
                    )}
                  </>
                )}
                {selected.purpose && <DetailRow label="Purpose" value={selected.purpose} />}
              </div>

              {modalMode === 'approve' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Approved Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={approveAmount}
                    onChange={(e) => setApproveAmount(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Enter approved amount"
                  />
                  {parseFloat(approveAmount) < parseFloat(selected.amount_requested) && approveAmount && (
                    <p className="text-xs text-blue-600 mt-1">
                      This will be recorded as a partial approval.
                    </p>
                  )}
                </div>
              )}

              {modalMode === 'reject' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Rejection Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    rows={3}
                    placeholder="Explain why this request is being rejected..."
                  />
                </div>
              )}

              {actionError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg"
              >
                Cancel
              </button>
              {modalMode === 'approve' ? (
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
                >
                  {actionLoading ? 'Approving…' : 'Approve'}
                </button>
              ) : (
                <button
                  onClick={handleReject}
                  disabled={actionLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60"
                >
                  {actionLoading ? 'Rejecting…' : 'Reject'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, bold, className }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium text-gray-900 text-right ${bold ? 'font-bold' : ''} ${className || ''}`}>
        {value}
      </span>
    </div>
  );
}
