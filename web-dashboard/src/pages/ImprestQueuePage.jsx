import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../services/api';

const IMPREST_CATEGORIES = [
  'Food Expense', 'Site Room Rent', 'Travelling', 'Conveyance',
  'Labour Expense', 'Porter', 'Hotel Expense', 'Site Expense',
  'Material Expense', 'Office Expense', 'Other',
];

const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi',
  'DEE Development Engineer - Canteen', 'DEE Development Engineer - Admin',
  'Vaneet Infra', 'Dee Foundation Omaxe, Faridabad', 'Auma India Bengaluru',
  'Minebea Mitsumi', 'Hero Homes Ludhiana', 'Hero Homes Greater Noida',
  'Bansal Tower', 'KOKO Town, Chandigarh', 'Vinfast Jaipur', 'Head Office', 'Bangalore Office', 'Others',
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially_approved', label: 'Partially Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
  approved: 'bg-green-100 text-green-800 border border-green-200',
  partially_approved: 'bg-blue-100 text-blue-800 border border-blue-200',
  rejected: 'bg-red-100 text-red-800 border border-red-200',
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

function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function deviationClass(deviation, requested) {
  if (!deviation || !requested) return 'text-gray-500';
  const pct = Math.abs(deviation / requested) * 100;
  if (pct > 30) return 'text-red-600 font-bold';
  if (pct > 10) return 'text-yellow-600 font-semibold';
  return 'text-green-600';
}

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
    r.ref_id, r.employee?.name || '', r.site, r.category,
    (r.purpose || '').replace(/"/g, '""'), r.people_count,
    r.amount_requested, r.approved_amount ?? '', r.old_balance ?? '',
    r.status, r.founder_review_status || '',
    new Date(r.submitted_at).toLocaleDateString('en-IN'),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `imprest_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Approval Timeline ──────────────────────────────────────────────────────
function ApprovalTimeline({ req }) {
  const isDirector = req.approval_route === 'avisha_director_finance';
  const steps = [
    {
      label: 'S1 — Review',
      sub: 'Avisha',
      done: !!req.s1_approved_at,
      rejected: false,
      date: req.s1_approved_at,
      note: req.s1_notes,
    },
    {
      label: isDirector ? 'Director / Founder' : 'S2 — Ritu',
      sub: 'Approval',
      done: !!(req.s2_approved_at || req.founder_review_status === 'approved'),
      rejected: req.current_stage === 'director_rejected' || req.founder_review_status === 'rejected',
      date: req.s2_approved_at || req.founder_review_at,
      note: req.s2_notes || req.founder_review_comment,
      extra: req.director_approved_amount ? `Ceiling: ${fmt(req.director_approved_amount)}` : null,
    },
    {
      label: 'Finance',
      sub: 'Stage 3',
      done: req.current_stage === 's3_approved' || !!req.paid,
      rejected: req.current_stage === 's3_rejected',
      date: req.approved_at,
      note: req.rejection_reason && req.current_stage === 's3_rejected' ? req.rejection_reason : null,
    },
    {
      label: 'Payment',
      sub: req.paid ? fmt(req.paid_amount) : 'Not yet paid',
      done: !!req.paid,
      rejected: false,
      date: req.paid_at,
      note: null,
    },
  ];

  return (
    <div>
      {steps.map((step, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border-2 ${
              step.rejected ? 'bg-red-500 border-red-500 text-white' :
              step.done ? 'bg-green-500 border-green-500 text-white' :
              'bg-white border-gray-300 text-gray-400'
            }`}>
              {step.rejected ? '✗' : step.done ? '✓' : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-0.5 my-1 ${step.done ? 'bg-green-300' : 'bg-gray-200'}`} style={{ minHeight: 20 }} />
            )}
          </div>
          <div className="pb-4 flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-sm font-semibold text-gray-900">{step.label}</span>
                {step.sub && <span className="text-xs text-gray-500 ml-1.5">{step.sub}</span>}
              </div>
              {step.date ? (
                <span className="text-xs text-gray-400 shrink-0">{fmtDate(step.date)}</span>
              ) : step.rejected ? (
                <span className="text-xs text-red-600 font-semibold">Rejected</span>
              ) : !step.done ? (
                <span className="text-xs text-yellow-600 font-medium">Pending</span>
              ) : null}
            </div>
            {step.note && <p className="text-xs italic text-gray-600 mt-0.5 break-words">"{step.note}"</p>}
            {step.extra && <p className="text-xs text-purple-600 font-semibold mt-0.5">{step.extra}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ImprestQueuePage() {
  const [requests, setRequests] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 50;

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSite, setFilterSite] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterEmployeeName, setFilterEmployeeName] = useState('');

  const [detailReq, setDetailReq] = useState(null);
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [approveAmount, setApproveAmount] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [payReq, setPayReq] = useState(null);
  const [payReceipt, setPayReceipt] = useState(null);

  const detailScrollRef = useRef(null);

  // Scroll detail modal to top every time a new one opens
  useEffect(() => {
    if (detailReq && detailScrollRef.current) {
      detailScrollRef.current.scrollTop = 0;
    }
  }, [detailReq]);

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
    setSelected(req); setRejectReason(''); setActionError(''); setModalMode('reject');
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
  const clearFilters = () => {
    setFilterStatus('all'); setFilterCategory('all'); setFilterSite('all');
    setFilterDateFrom(''); setFilterDateTo(''); setFilterEmployeeName(''); setPage(1);
  };
  const hasFilters = filterStatus !== 'all' || filterSite !== 'all' || filterCategory !== 'all' || filterDateFrom || filterDateTo || filterEmployeeName;

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Imprest Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Review and approve advance requests from site engineers
            {total > 0 && <span className="ml-2 text-amber-600 font-semibold">{total} requests</span>}
          </p>
        </div>
        <button onClick={() => downloadImprestCSV(requests)} className="btn-secondary text-sm whitespace-nowrap">
          ↓ Download CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-5">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text" placeholder="Search employee…"
            value={filterEmployeeName}
            onChange={(e) => { setFilterEmployeeName(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400 w-44"
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
          {hasFilters && (
            <button onClick={clearFilters}
              className="text-sm text-red-500 hover:text-red-700 font-medium px-2 transition-colors">
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="px-4 py-4 flex gap-4 items-center">
                <div className="skeleton h-3.5 w-28 rounded" />
                <div className="skeleton h-3.5 w-36 rounded" />
                <div className="skeleton h-3.5 w-24 rounded" />
                <div className="skeleton h-3.5 w-44 rounded" />
                <div className="ml-auto skeleton h-3.5 w-16 rounded" />
                <div className="skeleton h-7 w-16 rounded-lg" />
              </div>
            ))}
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
            <span className="text-3xl">📭</span>
            <span className="text-sm">No requests found</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Ref ID', 'Employee', 'Category & Details', 'Purpose', 'People', 'Requested', 'Approved', 'Old Balance', 'Status', 'Founder Review', 'Submitted', 'Actions'].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide ${i >= 4 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((req) => {
                  const detail = categoryDetail(req);
                  return (
                    <tr key={req.id} className="hover:bg-amber-50/30 transition-colors group">
                      <td className="px-4 py-3">
                        <button onClick={() => setDetailReq(req)}
                          className="font-mono text-xs text-amber-600 font-semibold hover:underline text-left group-hover:text-amber-700">
                          {req.ref_id}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{req.employee?.name || '—'}</div>
                        <div className="text-xs text-gray-500">{req.site}</div>
                        {req.employee?.phone && <div className="text-xs text-gray-400">{req.employee.phone}</div>}
                        {req.employee_total_balance > 0 && (
                          <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-red-50 border border-red-200">
                            <span className="text-xs font-semibold text-red-600">⚠ {fmt(req.employee_total_balance)}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">{req.category}</span>
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
                          <div className="text-xs text-gray-400 mt-0.5">Spent: {fmt(req.total_expenses_submitted)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[req.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[req.status] || req.status}
                        </span>
                        {req.rejection_reason && (
                          <div className="text-xs text-red-500 mt-1 max-w-[120px] line-clamp-1" title={req.rejection_reason}>
                            {req.rejection_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {req.requires_founder_approval ? (
                          <div>
                            <div className="text-xs text-gray-500">{req.approval_route === 'avisha_director_finance' ? 'Bhaskar Sir' : "Ritu Ma'am"}</div>
                            {req.founder_review_status === 'approved' && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-green-100 text-green-700 border border-green-200">Approved</span>}
                            {req.founder_review_status === 'rejected' && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700 border border-red-200">Rejected</span>}
                            {req.founder_review_status === 'pending' && <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">Awaiting</span>}
                          </div>
                        ) : <span className="text-xs text-gray-300">N/A</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDate(req.submitted_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <button onClick={() => setDetailReq(req)}
                            className="text-xs bg-gray-100 text-gray-700 px-3 py-1 rounded-lg hover:bg-gray-200 transition-colors font-medium">
                            Details
                          </button>
                          {req.current_stage === 'director_rejected' && (
                            <span className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded text-center">Dir. Rejected</span>
                          )}
                          {req.current_stage === 's3_pending' && (
                            <>
                              <button onClick={() => openApprove(req)} className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 transition-colors font-medium">Approve</button>
                              <button onClick={() => openReject(req)} className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 transition-colors font-medium">Reject</button>
                            </>
                          )}
                          {req.current_stage === 's3_approved' && !req.paid && (
                            <button onClick={() => { setPayReq(req); setPayReceipt(null); setActionError(''); }}
                              className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 transition-colors font-medium">Pay</button>
                          )}
                          {req.paid && (
                            <span className="text-xs text-green-600 font-semibold">✓ Paid {fmtDate(req.paid_at)}</span>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50/50">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="flex items-center gap-1 text-sm text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg hover:bg-white hover:shadow-sm disabled:hover:bg-transparent disabled:hover:shadow-none transition-all border border-transparent hover:border-gray-200 disabled:border-transparent">
              ← Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('…');
                  acc.push(p); return acc;
                }, [])
                .map((p, i) => p === '…' ? (
                  <span key={`ellipsis-${i}`} className="text-gray-400 px-1 text-sm">…</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${p === page ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200'}`}>
                    {p}
                  </button>
                ))}
            </div>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
              className="flex items-center gap-1 text-sm text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg hover:bg-white hover:shadow-sm disabled:hover:bg-transparent disabled:hover:shadow-none transition-all border border-transparent hover:border-gray-200 disabled:border-transparent">
              Next →
            </button>
          </div>
        )}
      </div>

      {/* ── Full Details Modal ─────────────────────────────────────────────── */}
      <Modal open={!!detailReq}>
        {detailReq && (
          <div ref={detailScrollRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto modal-content">

            {/* Sticky header */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 rounded-t-2xl px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-sm text-amber-600 font-bold bg-amber-50 px-2 py-1 rounded-lg">{detailReq.ref_id}</span>
                <h2 className="text-base font-bold text-gray-900">{detailReq.category}</h2>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[detailReq.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABELS[detailReq.status] || detailReq.status}
                </span>
              </div>
              <button onClick={() => setDetailReq(null)}
                className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0">
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">

              {/* Top two-column grid: Employee + Request Details side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-blue-400 inline-block" />Employee</p>
                  <CompactRow label="Name" value={detailReq.employee?.name || '—'} bold />
                  <CompactRow label="Email" value={detailReq.employee?.email || '—'} />
                  <CompactRow label="Phone" value={detailReq.employee?.phone || '—'} />
                  <CompactRow label="Site" value={detailReq.site} />
                  {detailReq.employee_total_balance > 0 && (
                    <div className="mt-1 px-2 py-1 bg-red-50 border border-red-200 rounded-lg">
                      <span className="text-xs font-bold text-red-600">⚠ Prev Balance: {fmt(detailReq.employee_total_balance)}</span>
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-amber-400 inline-block" />Request Details</p>
                  <CompactRow label="Amount" value={fmt(detailReq.amount_requested)} bold className="text-gray-900 text-base" />
                  <CompactRow label="People" value={detailReq.people_count} />
                  {detailReq.per_person_rate && <CompactRow label="Rate/Person/Day" value={`₹${detailReq.per_person_rate}`} />}
                  {(detailReq.date_from || detailReq.date_to) && (
                    <CompactRow label="Duration"
                      value={`${fmtDate(detailReq.date_from)} – ${fmtDate(detailReq.date_to)}${detailReq.date_from && detailReq.date_to ? ` (${Math.max(1, Math.round((new Date(detailReq.date_to) - new Date(detailReq.date_from)) / 86400000) + 1)}d)` : ''}`} />
                  )}
                  {detailReq.purpose && <CompactRow label="Purpose" value={detailReq.purpose} />}
                  <CompactRow label="Submitted" value={`${fmtDate(detailReq.submitted_at)} ${fmtTime(detailReq.submitted_at)}`} />
                </div>
              </div>

              {/* Category-specific details — compact single row if small */}
              {detailReq.category === 'Travelling' && (
                <div className="bg-indigo-50 rounded-xl p-3 text-sm">
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-indigo-400 inline-block" />Travel Details</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {detailReq.travel_subtype && <CompactRow label="Mode" value={detailReq.travel_subtype} />}
                    {detailReq.travel_from && <CompactRow label="From" value={detailReq.travel_from} />}
                    {detailReq.travel_to && <CompactRow label="To" value={detailReq.travel_to} />}
                    {detailReq.travel_date && <CompactRow label="Date" value={fmtDate(detailReq.travel_date)} />}
                    {detailReq.ai_estimated_amount && <CompactRow label="AI Estimate" value={fmt(detailReq.ai_estimated_amount)} />}
                    {detailReq.ai_estimated_distance_km && <CompactRow label="Distance" value={`${detailReq.ai_estimated_distance_km} km`} />}
                    {detailReq.amount_deviation != null && (
                      <CompactRow label="Deviation"
                        value={`${fmt(detailReq.amount_deviation)} (${Math.round(Math.abs(detailReq.amount_deviation / detailReq.amount_requested) * 100)}%)`}
                        className={deviationClass(detailReq.amount_deviation, detailReq.amount_requested)} />
                    )}
                  </div>
                </div>
              )}

              {detailReq.category === 'Conveyance' && (
                <div className="bg-teal-50 rounded-xl p-3 text-sm">
                  <p className="text-[10px] font-bold text-teal-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-teal-400 inline-block" />Conveyance Details</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {detailReq.conveyance_mode && <CompactRow label="Mode" value={detailReq.conveyance_mode} />}
                    {detailReq.vehicle_type && <CompactRow label="Vehicle" value={detailReq.vehicle_type} />}
                    {detailReq.travel_from && <CompactRow label="From" value={detailReq.travel_from} />}
                    {detailReq.travel_to && <CompactRow label="To" value={detailReq.travel_to} />}
                    {detailReq.ai_estimated_distance_km && <CompactRow label="Distance" value={`${detailReq.ai_estimated_distance_km} km`} />}
                  </div>
                </div>
              )}

              {detailReq.category === 'Labour Expense' && detailReq.labour_subcategory && (
                <div className="bg-orange-50 rounded-xl p-3 text-sm">
                  <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-1 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-orange-400 inline-block" />Labour Details</p>
                  <CompactRow label="Sub-Category" value={detailReq.labour_subcategory} />
                </div>
              )}

              {/* Approval Journey */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-green-400 inline-block" />Approval Journey</p>
                <ApprovalTimeline req={detailReq} />
                {detailReq.payment_receipt_url && (
                  <div className="mt-2 pt-2 border-t border-gray-200">
                    <a href={detailReq.payment_receipt_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline">📎 View Payment Receipt</a>
                  </div>
                )}
              </div>

              {/* Balance Adjustment + Approval Info — side by side if both exist */}
              {(detailReq.old_balance_deducted > 0 || detailReq.approved_amount != null || detailReq.rejection_reason) && (
                <div className="grid grid-cols-2 gap-4">
                  {detailReq.old_balance_deducted > 0 && (
                    <div className="bg-orange-50 rounded-xl p-3 text-sm">
                      <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-orange-400 inline-block" />Balance Adjustment</p>
                      <CompactRow label="Approved" value={fmt(detailReq.approved_amount || detailReq.amount_requested)} />
                      <CompactRow label="Deducted" value={`−${fmt(detailReq.old_balance_deducted)}`} className="text-orange-600" />
                      <CompactRow label="Net Pay" value={fmt(detailReq.net_approved_amount || 0)} bold className="text-green-700" />
                    </div>
                  )}
                  {(detailReq.approved_amount != null || detailReq.rejection_reason) && (
                    <div className="bg-green-50 rounded-xl p-3 text-sm">
                      <p className="text-[10px] font-bold text-green-500 uppercase tracking-wider mb-2 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-green-400 inline-block" />Approval Info</p>
                      {detailReq.approved_amount != null && (
                        <CompactRow label="Approved Amount" value={fmt(detailReq.approved_amount)} bold
                          className={Number(detailReq.approved_amount) < Number(detailReq.amount_requested) ? 'text-blue-600' : 'text-green-600'} />
                      )}
                      {detailReq.approver?.name && <CompactRow label="By" value={detailReq.approver.name} />}
                      {detailReq.approved_at && <CompactRow label="On" value={fmtDate(detailReq.approved_at)} />}
                      {detailReq.rejection_reason && <CompactRow label="Reason" value={detailReq.rejection_reason} className="text-red-600" />}
                    </div>
                  )}
                </div>
              )}

              {detailReq.old_balance != null && (
                <div className="bg-red-50 rounded-xl p-3 text-sm">
                  <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5"><span className="w-1 h-3 rounded-full bg-red-400 inline-block" />Balance Tracking</p>
                  <div className="grid grid-cols-2 gap-x-4">
                    <CompactRow label="Expenses Submitted" value={fmt(detailReq.total_expenses_submitted || 0)} />
                    <CompactRow label="Old Balance"
                      value={detailReq.old_balance > 0 ? fmt(detailReq.old_balance) : 'Fully Settled'}
                      bold className={detailReq.old_balance > 0 ? 'text-red-600' : 'text-green-600'} />
                  </div>
                </div>
              )}
            </div>

            {/* Sticky footer */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 rounded-b-2xl px-5 py-3 flex justify-end gap-3">
              {detailReq.current_stage === 's3_pending' && (
                <>
                  <button onClick={() => { setDetailReq(null); openApprove(detailReq); }}
                    className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 active:scale-95 transition-all">
                    ✓ Approve
                  </button>
                  <button onClick={() => { setDetailReq(null); openReject(detailReq); }}
                    className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 active:scale-95 transition-all">
                    ✗ Reject
                  </button>
                </>
              )}
              {detailReq.current_stage === 's3_approved' && !detailReq.paid && (
                <button onClick={() => { setDetailReq(null); setPayReq(detailReq); setPayReceipt(null); setActionError(''); }}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:scale-95 transition-all">
                  💸 Pay Now
                </button>
              )}
              <button onClick={() => setDetailReq(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 active:scale-95 transition-all">
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Approve / Reject Modal ─────────────────────────────────────────── */}
      <Modal open={!!(selected && modalMode)}>
        {selected && modalMode && (
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg modal-content">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {modalMode === 'approve' ? '✓ Approve Request' : '✗ Reject Request'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">{selected.ref_id} — {selected.employee?.name}</p>
            </div>

            <div className="p-5 space-y-4">
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
                  <input type="number" value={approveAmount}
                    onChange={(e) => setApproveAmount(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder="Enter approved amount" />
                  {parseFloat(approveAmount) < parseFloat(selected.amount_requested) && approveAmount && (
                    <p className="text-xs text-blue-600 mt-1">This will be recorded as a partial approval.</p>
                  )}
                  {selected?.director_approved_amount && (
                    <p className="text-xs text-orange-600 mt-1">Director approved {fmt(selected.director_approved_amount)} — you cannot exceed this amount.</p>
                  )}
                  {selected?.old_balance_deducted > 0 && (
                    <p className="text-xs text-amber-600 mt-1">Old balance deduction: {fmt(selected.old_balance_deducted)} will be subtracted.</p>
                  )}
                </div>
              )}

              {modalMode === 'reject' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Rejection Reason <span className="text-red-500">*</span></label>
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    rows={3} placeholder="Explain why this request is being rejected…" />
                </div>
              )}

              {actionError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>}
            </div>

            <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 active:scale-95 transition-all">Cancel</button>
              {modalMode === 'approve' ? (
                <button onClick={handleApprove} disabled={actionLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 active:scale-95 transition-all">
                  {actionLoading ? 'Approving…' : 'Approve'}
                </button>
              ) : (
                <button onClick={handleReject} disabled={actionLoading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 active:scale-95 transition-all">
                  {actionLoading ? 'Rejecting…' : 'Reject'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Pay Modal ─────────────────────────────────────────────────────── */}
      <Modal open={!!payReq}>
        {payReq && (
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md modal-content">
            <div className="p-5 border-b">
              <h2 className="text-lg font-bold text-gray-900">💸 Mark as Paid</h2>
              <p className="text-sm text-gray-500 mt-0.5">{payReq.ref_id} — {payReq.employee?.name}</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold text-green-700 text-base">{fmt(payReq.net_approved_amount || payReq.approved_amount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{payReq.category}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{payReq.site}</span></div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Receipt <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="file" accept="image/*,application/pdf"
                  onChange={(e) => setPayReceipt(e.target.files[0] || null)}
                  className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                <p className="text-xs text-gray-400 mt-1">Upload a payment slip or receipt as proof.</p>
              </div>
              {actionError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>}
            </div>
            <div className="p-5 border-t flex justify-end gap-3">
              <button onClick={() => { setPayReq(null); setPayReceipt(null); setActionError(''); }}
                className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 active:scale-95 transition-all">Cancel</button>
              <button onClick={handlePay} disabled={actionLoading}
                className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 active:scale-95 transition-all">
                {actionLoading ? 'Processing…' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Portal wrapper — renders outside the scrolled page tree so fixed positioning
// is always relative to the viewport, never to a scrolled ancestor.
function Modal({ open, children }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.5)' }}
      className="modal-overlay">
      {children}
    </div>,
    document.body
  );
}

function Section({ title, children, accent }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-1 h-4 rounded-full ${accent || 'bg-amber-400'}`} />
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</span>
      </div>
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

function CompactRow({ label, value, bold, className }) {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-gray-400 shrink-0">{label}</span>
      <span className={`font-medium text-gray-800 text-right break-words max-w-[60%] ${bold ? 'font-bold' : ''} ${className || ''}`}>
        {value ?? '—'}
      </span>
    </div>
  );
}
