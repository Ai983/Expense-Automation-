import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const IMPREST_CATEGORIES = [
  'Food Expense', 'Site Room Rent', 'Travelling', 'Conveyance',
  'Labour Expense', 'Porter', 'Hotel Expense', 'Site Expense', 'Other',
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

function fmt(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function deviationClass(deviation, requested) {
  if (!deviation || !requested) return 'text-gray-500';
  const pct = Math.abs(deviation / requested) * 100;
  if (pct > 30) return 'text-red-600 font-bold';
  if (pct > 10) return 'text-yellow-600 font-semibold';
  return 'text-green-600';
}

// Returns a one-line summary of category-specific details
function categoryDetail(req) {
  const parts = [];
  if (req.category === 'Travelling' && req.travel_subtype) parts.push(req.travel_subtype);
  if (req.category === 'Travelling' && req.travel_from && req.travel_to) parts.push(`${req.travel_from} → ${req.travel_to}`);
  if (req.category === 'Travelling' && req.travel_date) parts.push(`on ${fmtDate(req.travel_date)}`);
  if (req.category === 'Conveyance' && req.conveyance_mode) parts.push(req.conveyance_mode);
  if (req.category === 'Conveyance' && req.vehicle_type) parts.push(req.vehicle_type);
  if (req.category === 'Labour Expense' && req.labour_subcategory) parts.push(req.labour_subcategory);
  if (req.date_from && req.date_to) parts.push(`${fmtDate(req.date_from)} – ${fmtDate(req.date_to)}`);
  if (req.per_person_rate) parts.push(`₹${req.per_person_rate}/person/day`);
  return parts.join(' · ');
}

function downloadImprestCSV(requests) {
  const headers = ['Ref ID', 'Employee', 'Site', 'Category', 'Purpose', 'People', 'Amount Requested', 'Approved Amount', 'Old Balance', 'Status', 'Founder Review', 'Submitted'];
  const rows = requests.map((r) => [
    r.ref_id,
    r.employee?.name || '',
    r.site,
    r.category,
    (r.purpose || '').replace(/"/g, '""'),
    r.people_count,
    r.amount_requested,
    r.approved_amount ?? '',
    r.old_balance ?? '',
    r.status,
    r.founder_review_status || '',
    new Date(r.submitted_at).toLocaleDateString('en-IN'),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `imprest_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImprestQueuePage() {
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

  // Modals
  const [detailReq, setDetailReq] = useState(null);           // full details modal
  const [selected, setSelected] = useState(null);             // approve/reject modal
  const [modalMode, setModalMode] = useState(null);
  const [approveAmount, setApproveAmount] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [payReq, setPayReq] = useState(null);                 // pay modal
  const [payReceipt, setPayReceipt] = useState(null);

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
    setSelected(req); setApproveAmount(String(req.amount_requested));
    setRejectReason(''); setActionError(''); setModalMode('approve');
  };
  const openReject = (req) => {
    setSelected(req); setRejectReason('');
    setActionError(''); setModalMode('reject');
  };
  const closeModal = () => {
    setSelected(null); setModalMode(null);
    setApproveAmount(''); setRejectReason(''); setActionError('');
  };

  const handleApprove = async () => {
    if (!approveAmount || parseFloat(approveAmount) <= 0) { setActionError('Enter a valid approved amount.'); return; }
    setActionLoading(true); setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/approve`, { approvedAmount: parseFloat(approveAmount) });
      closeModal(); fetchQueue();
    } catch (e) { setActionError(e.response?.data?.error || 'Approval failed.'); }
    finally { setActionLoading(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setActionError('Rejection reason is required.'); return; }
    setActionLoading(true); setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/reject`, { reason: rejectReason.trim() });
      closeModal(); fetchQueue();
    } catch (e) { setActionError(e.response?.data?.error || 'Rejection failed.'); }
    finally { setActionLoading(false); }
  };

  const handlePay = async () => {
    if (!payReq) return;
    setActionLoading(true); setActionError('');
    try {
      const formData = new FormData();
      if (payReceipt) formData.append('receipt', payReceipt);
      await api.post(`/api/imprest/${payReq.id}/pay`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPayReq(null); setPayReceipt(null); fetchQueue();
    } catch (e) { setActionError(e.response?.data?.error || 'Pay failed'); }
    finally { setActionLoading(false); }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Imprest Queue</h1>
        <p className="text-sm text-gray-500 mt-1">Review and approve advance requests from site engineers</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
        <input
          type="text" placeholder="Search employee name..."
          value={filterEmployeeName}
          onChange={(e) => { setFilterEmployeeName(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400 w-48"
        />
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterSite} onChange={(e) => { setFilterSite(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="all">All Sites</option>
          {IMPREST_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterCategory} onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400">
          <option value="all">All Categories</option>
          {IMPREST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" value={filterDateFrom}
          onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <input type="date" value={filterDateTo}
          onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={() => { setFilterStatus('all'); setFilterCategory('all'); setFilterSite('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterEmployeeName(''); setPage(1); }}
          className="text-sm text-gray-500 hover:text-gray-700 px-2"
        >Clear</button>
        <span className="ml-auto text-sm text-gray-500 self-center">{total} request{total !== 1 ? 's' : ''}</span>
        <button
          onClick={() => downloadImprestCSV(requests)}
          className="btn-secondary text-sm whitespace-nowrap"
          title="Download filtered data as CSV"
        >
          Download CSV
        </button>
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category & Details</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Purpose</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">People</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Approved</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Old Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Founder Review</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((req) => {
                  const detail = categoryDetail(req);
                  return (
                    <tr key={req.id} className="hover:bg-amber-50/40 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDetailReq(req)}
                          className="font-mono text-xs text-amber-600 font-semibold hover:underline text-left"
                        >
                          {req.ref_id}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{req.employee?.name || '—'}</div>
                        <div className="text-xs text-gray-500">{req.site}</div>
                        {req.employee?.phone && <div className="text-xs text-gray-400">{req.employee.phone}</div>}
                        {req.employee_total_balance > 0 && (
                          <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-red-50 border border-red-200">
                            <span className="text-xs font-semibold text-red-600">Prev Balance: {fmt(req.employee_total_balance)}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{req.category}</div>
                        {detail && <div className="text-xs text-gray-500 mt-0.5 max-w-xs">{detail}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[160px]">
                        <div className="line-clamp-2">{req.purpose || <span className="text-gray-300">—</span>}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{req.people_count}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {fmt(req.amount_requested)}
                        {req.user_edited_amount && req.ai_estimated_amount && (
                          <div className={`text-xs mt-0.5 ${deviationClass(req.amount_deviation, req.amount_requested)}`}>
                            AI: {fmt(req.ai_estimated_amount)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {req.approved_amount != null ? (
                          <span className={`font-semibold ${Number(req.approved_amount) < Number(req.amount_requested) ? 'text-blue-600' : 'text-green-600'}`}>
                            {fmt(req.approved_amount)}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {req.old_balance != null ? (
                          req.old_balance > 0 ? (
                            <span className="font-bold text-red-600">{fmt(req.old_balance)}</span>
                          ) : (
                            <span className="text-green-600 text-xs font-semibold">Settled</span>
                          )
                        ) : <span className="text-gray-300 text-xs">—</span>}
                        {req.total_expenses_submitted > 0 && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            Spent: {fmt(req.total_expenses_submitted)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[req.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[req.status] || req.status}
                        </span>
                        {req.rejection_reason && (
                          <div className="text-xs text-red-500 mt-1 max-w-[120px] line-clamp-1" title={req.rejection_reason}>
                            {req.rejection_reason}
                          </div>
                        )}
                      </td>
                      {/* Founder Review */}
                      <td className="px-4 py-3">
                        {req.requires_founder_approval ? (
                          <div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-500">{req.requested_to_user?.name || (req.approval_route === 'avisha_director_finance' ? 'Bhaskar Sir' : 'Ritu Ma\'am')}</span>
                            </div>
                            {req.founder_review_status === 'approved' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700 mt-1">
                                Approved
                              </span>
                            )}
                            {req.founder_review_status === 'rejected' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700 mt-1">
                                Rejected
                              </span>
                            )}
                            {req.founder_review_status === 'pending' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-800 mt-1">
                                Awaiting
                              </span>
                            )}
                            {req.founder_review_comment && (
                              <div className="text-xs text-gray-500 mt-1 max-w-[140px] line-clamp-2" title={req.founder_review_comment}>
                                "{req.founder_review_comment}"
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {fmtDate(req.submitted_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => setDetailReq(req)}
                            className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded-lg hover:bg-gray-200 transition-colors text-left"
                          >
                            Details
                          </button>
                          {req.current_stage === 'director_rejected' && (
                            <div className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded">
                              Rejected by Director
                            </div>
                          )}
                          {req.current_stage === 's3_pending' && (
                            <>
                              <button onClick={() => openApprove(req)}
                                className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 transition-colors">
                                Approve
                              </button>
                              <button onClick={() => openReject(req)}
                                className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 transition-colors">
                                Reject
                              </button>
                            </>
                          )}
                          {req.current_stage === 's3_approved' && !req.paid && (
                            <button onClick={() => { setPayReq(req); setPayReceipt(null); setActionError(''); }}
                              className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 transition-colors">
                              Pay
                            </button>
                          )}
                          {req.paid && (
                            <span className="text-xs text-green-600 font-semibold">
                              Paid {fmtDate(req.paid_at)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="text-sm text-gray-600 disabled:text-gray-300 hover:text-gray-900">← Previous</button>
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="text-sm text-gray-600 disabled:text-gray-300 hover:text-gray-900">Next →</button>
          </div>
        )}
      </div>

      {/* ── Full Details Modal ─────────────────────────────────────────────── */}
      {detailReq && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 flex items-start justify-between">
              <div>
                <div className="font-mono text-sm text-amber-600 font-semibold">{detailReq.ref_id}</div>
                <h2 className="text-lg font-bold text-gray-900 mt-1">{detailReq.category}</h2>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mt-1 ${STATUS_STYLES[detailReq.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[detailReq.status] || detailReq.status}
                </span>
              </div>
              <button onClick={() => setDetailReq(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold ml-4">✕</button>
            </div>

            <div className="p-6 space-y-5">

              {/* Employee Info */}
              <Section title="Employee">
                <Row label="Name" value={detailReq.employee?.name || '—'} />
                <Row label="Email" value={detailReq.employee?.email || '—'} />
                <Row label="Phone" value={detailReq.employee?.phone || '—'} />
                <Row label="Site" value={detailReq.site} />
              </Section>

              {/* Request Info */}
              <Section title="Request Details">
                <Row label="Category" value={detailReq.category} />
                {detailReq.requested_to_name && <Row label="Requested To" value={detailReq.requested_to_name} />}
                <Row label="People Count" value={detailReq.people_count} />
                <Row label="Amount Requested" value={fmt(detailReq.amount_requested)} bold />
                {detailReq.per_person_rate && (
                  <Row label="Rate / Person / Day" value={`₹${detailReq.per_person_rate}`} />
                )}
                {detailReq.purpose && <Row label="Purpose / Notes" value={detailReq.purpose} />}
                <Row label="Submitted On" value={fmtDate(detailReq.submitted_at)} />
              </Section>

              {/* Date Range (Food / Site Room / Hotel) */}
              {(detailReq.date_from || detailReq.date_to) && (
                <Section title="Duration">
                  <Row label="From Date" value={fmtDate(detailReq.date_from)} />
                  <Row label="To Date" value={fmtDate(detailReq.date_to)} />
                  {detailReq.date_from && detailReq.date_to && (
                    <Row label="Total Days" value={
                      Math.max(1, Math.round((new Date(detailReq.date_to) - new Date(detailReq.date_from)) / 86400000) + 1) + ' days'
                    } />
                  )}
                </Section>
              )}

              {/* Travel Details */}
              {detailReq.category === 'Travelling' && (
                <Section title="Travel Details">
                  {detailReq.travel_subtype && <Row label="Mode" value={detailReq.travel_subtype} />}
                  {detailReq.travel_from && <Row label="From" value={detailReq.travel_from} />}
                  {detailReq.travel_to && <Row label="To" value={detailReq.travel_to} />}
                  {detailReq.travel_date && <Row label="Travel Date" value={fmtDate(detailReq.travel_date)} />}
                  {detailReq.ai_estimated_amount && (
                    <Row label="AI Estimate" value={fmt(detailReq.ai_estimated_amount)} />
                  )}
                  {detailReq.ai_estimated_distance_km && (
                    <Row label="Distance" value={`${detailReq.ai_estimated_distance_km} km`} />
                  )}
                  {detailReq.amount_deviation != null && (
                    <Row
                      label="Deviation from AI"
                      value={`${fmt(detailReq.amount_deviation)} (${Math.round(Math.abs(detailReq.amount_deviation / detailReq.amount_requested) * 100)}%)`}
                      className={deviationClass(detailReq.amount_deviation, detailReq.amount_requested)}
                    />
                  )}
                  {detailReq.user_edited_amount && (
                    <Row label="Amount Edited by User" value="Yes" className="text-orange-600" />
                  )}
                </Section>
              )}

              {/* Conveyance Details */}
              {detailReq.category === 'Conveyance' && (
                <Section title="Conveyance Details">
                  {detailReq.conveyance_mode && <Row label="Mode" value={detailReq.conveyance_mode} />}
                  {detailReq.vehicle_type && <Row label="Vehicle Type" value={detailReq.vehicle_type} />}
                  {detailReq.travel_from && <Row label="From" value={detailReq.travel_from} />}
                  {detailReq.travel_to && <Row label="To" value={detailReq.travel_to} />}
                  {detailReq.ai_estimated_distance_km && (
                    <Row label="Distance" value={`${detailReq.ai_estimated_distance_km} km`} />
                  )}
                </Section>
              )}

              {/* Labour Details */}
              {detailReq.category === 'Labour Expense' && detailReq.labour_subcategory && (
                <Section title="Labour Details">
                  <Row label="Sub-Category" value={detailReq.labour_subcategory} />
                </Section>
              )}

              {/* Approval Journey */}
              <Section title="Approval Journey">
                <Row label="Stage 1 (Review)" value={
                  detailReq.s1_approved_at ? `Approved on ${fmtDate(detailReq.s1_approved_at)}` : 'Pending'
                } className={detailReq.s1_approved_at ? 'text-green-600' : 'text-yellow-600'} />
                {detailReq.s1_notes && <Row label="S1 Notes" value={detailReq.s1_notes} />}

                <Row label="Stage 2 (Approval)" value={
                  detailReq.approval_route === 'avisha_director_finance'
                    ? (detailReq.founder_review_status === 'approved' ? `Director Approved ${fmtDate(detailReq.founder_review_at) || ''}`
                      : detailReq.founder_review_status === 'rejected' ? 'Director Rejected'
                      : detailReq.current_stage === 's2_pending' ? 'Awaiting Director (WhatsApp)' : 'Pending')
                    : (detailReq.s2_approved_at ? `Approved on ${fmtDate(detailReq.s2_approved_at)}` : 'Pending')
                } className={
                  (detailReq.founder_review_status === 'rejected' || detailReq.current_stage === 'director_rejected') ? 'text-red-600'
                  : (detailReq.s2_approved_at || detailReq.founder_review_status === 'approved') ? 'text-green-600' : 'text-yellow-600'
                } />
                {detailReq.founder_review_comment && <Row label="Director Comment" value={detailReq.founder_review_comment} />}
                {detailReq.s2_notes && <Row label="S2 Notes" value={detailReq.s2_notes} />}
                {detailReq.director_approved_amount && (
                  <Row label="Director Ceiling" value={fmt(detailReq.director_approved_amount)} className="text-purple-600" bold />
                )}

                <Row label="Stage 3 (Finance)" value={
                  detailReq.current_stage === 's3_approved' || detailReq.paid ? `Approved ${fmtDate(detailReq.approved_at) || ''}` : 'Pending'
                } className={(detailReq.current_stage === 's3_approved' || detailReq.paid) ? 'text-green-600' : 'text-yellow-600'} />

                <Row label="Payment" value={
                  detailReq.paid ? `Paid ${fmt(detailReq.paid_amount)} on ${fmtDate(detailReq.paid_at)}` : 'Not yet paid'
                } className={detailReq.paid ? 'text-green-600' : 'text-gray-400'} bold />

                {detailReq.payment_receipt_url && (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500 shrink-0">Payment Receipt</span>
                    <a href={detailReq.payment_receipt_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline">View Receipt</a>
                  </div>
                )}
              </Section>

              {/* Balance Deduction */}
              {detailReq.old_balance_deducted > 0 && (
                <Section title="Balance Adjustment">
                  <Row label="Approved Amount" value={fmt(detailReq.approved_amount || detailReq.amount_requested)} />
                  <Row label="Old Balance Deducted" value={`-${fmt(detailReq.old_balance_deducted)}`} className="text-orange-600" />
                  <Row label="Net Amount to Pay" value={fmt(detailReq.net_approved_amount || 0)} bold className="text-green-700" />
                </Section>
              )}

              {/* Approval Info */}
              {(detailReq.approved_amount != null || detailReq.rejection_reason) && (
                <Section title="Approval Info">
                  {detailReq.approved_amount != null && (
                    <Row
                      label="Approved Amount"
                      value={fmt(detailReq.approved_amount)}
                      bold
                      className={Number(detailReq.approved_amount) < Number(detailReq.amount_requested) ? 'text-blue-600' : 'text-green-600'}
                    />
                  )}
                  {detailReq.approver?.name && <Row label="Approved By" value={detailReq.approver.name} />}
                  {detailReq.approved_at && <Row label="Approved On" value={fmtDate(detailReq.approved_at)} />}
                  {detailReq.rejection_reason && <Row label="Rejection Reason" value={detailReq.rejection_reason} className="text-red-600" />}
                </Section>
              )}

              {/* Old Balance */}
              {detailReq.old_balance != null && (
                <Section title="Balance Tracking">
                  <Row label="Expenses Submitted" value={fmt(detailReq.total_expenses_submitted || 0)} />
                  <Row
                    label="Old Balance"
                    value={detailReq.old_balance > 0 ? fmt(detailReq.old_balance) : 'Fully Settled'}
                    bold
                    className={detailReq.old_balance > 0 ? 'text-red-600' : 'text-green-600'}
                  />
                </Section>
              )}
            </div>

            {/* Footer actions */}
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              {detailReq.status === 'pending' && (
                <>
                  <button
                    onClick={() => { setDetailReq(null); openApprove(detailReq); }}
                    className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700"
                  >Approve</button>
                  <button
                    onClick={() => { setDetailReq(null); openReject(detailReq); }}
                    className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700"
                  >Reject</button>
                </>
              )}
              <button onClick={() => setDetailReq(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:text-gray-900">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Approve / Reject Modal ─────────────────────────────────────────── */}
      {selected && modalMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {modalMode === 'approve' ? 'Approve Request' : 'Reject Request'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{selected.ref_id} — {selected.employee?.name}</p>
            </div>

            <div className="p-6 space-y-4">
              {/* Summary */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <Row label="Employee" value={selected.employee?.name || '—'} />
                <Row label="Site" value={selected.site} />
                <Row label="Category" value={selected.category} />
                {selected.travel_subtype && <Row label="Mode" value={selected.travel_subtype} />}
                {selected.conveyance_mode && <Row label="Conveyance" value={selected.conveyance_mode} />}
                {selected.labour_subcategory && <Row label="Labour Type" value={selected.labour_subcategory} />}
                {selected.travel_from && <Row label="Route" value={`${selected.travel_from} → ${selected.travel_to}`} />}
                {selected.date_from && <Row label="Duration" value={`${fmtDate(selected.date_from)} – ${fmtDate(selected.date_to)}`} />}
                <Row label="People" value={selected.people_count} />
                <Row label="Amount Requested" value={fmt(selected.amount_requested)} bold />
                {selected.ai_estimated_amount && <Row label="AI Estimate" value={fmt(selected.ai_estimated_amount)} />}
                {selected.purpose && <Row label="Purpose" value={selected.purpose} />}
                {selected.employee_total_balance > 0 && (
                  <Row label="Employee Prev Balance" value={fmt(selected.employee_total_balance)} className="text-red-600" bold />
                )}
              </div>

              {modalMode === 'approve' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Approved Amount (₹)</label>
                  <input
                    type="number" value={approveAmount}
                    onChange={(e) => setApproveAmount(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Enter approved amount"
                  />
                  {parseFloat(approveAmount) < parseFloat(selected.amount_requested) && approveAmount && (
                    <p className="text-xs text-blue-600 mt-1">This will be recorded as a partial approval.</p>
                  )}
                  {selected?.director_approved_amount && (
                    <p className="text-xs text-orange-600 mt-1">
                      Director approved {fmt(selected.director_approved_amount)} — you cannot exceed this amount.
                    </p>
                  )}
                  {selected?.old_balance_deducted > 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      Old balance deduction: {fmt(selected.old_balance_deducted)} will be subtracted from the approved amount.
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
                    value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    rows={3} placeholder="Explain why this request is being rejected..."
                  />
                </div>
              )}

              {actionError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={closeModal}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg">
                Cancel
              </button>
              {modalMode === 'approve' ? (
                <button onClick={handleApprove} disabled={actionLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60">
                  {actionLoading ? 'Approving…' : 'Approve'}
                </button>
              ) : (
                <button onClick={handleReject} disabled={actionLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60">
                  {actionLoading ? 'Rejecting…' : 'Reject'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {payReq && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">Mark as Paid</h2>
              <p className="text-sm text-gray-500 mt-1">{payReq.ref_id} — {payReq.employee?.name}</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold">{fmt(payReq.net_approved_amount || payReq.approved_amount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{payReq.category}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{payReq.site}</span></div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Receipt (optional)</label>
                <input type="file" accept="image/*,application/pdf"
                  onChange={(e) => setPayReceipt(e.target.files[0] || null)}
                  className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                <p className="text-xs text-gray-400 mt-1">Upload a payment slip or receipt as proof. This will only be visible to finance team.</p>
              </div>
              {actionError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>}
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={() => { setPayReq(null); setPayReceipt(null); setActionError(''); }}
                className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Cancel</button>
              <button onClick={handlePay} disabled={actionLoading}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {actionLoading ? 'Processing…' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</div>
      <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value, bold, className }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`font-medium text-gray-900 text-right ${bold ? 'font-bold' : ''} ${className || ''}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}
