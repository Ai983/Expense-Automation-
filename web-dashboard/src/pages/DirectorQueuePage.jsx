// Director Approvals — Ritu (S2) is the Director's EA. Items at director_pending
// normally wait for Bhaskar Sir's WhatsApp YES/NO; from here she can approve,
// reduce or reject on his behalf, or resend the WhatsApp. A later WhatsApp
// reply is ignored once she has acted (the backend checks the stage).
import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';
import AmountTrail, { amountWasChanged } from '../components/imprest/AmountTrail';

function fmt(n) { return `₹${Number(n).toLocaleString('en-IN')}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'; }

// When the item reached the Director: S2 forward, else legacy S1 forward, else submission.
function forwardedAt(r) { return r.s2_approved_at || r.s1_approved_at || r.submitted_at || r.created_at; }
function daysWaiting(r) {
  const t = forwardedAt(r);
  return t ? Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000)) : 0;
}

function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin h-3.5 w-3.5 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function DirectorQueuePage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterName, setFilterName] = useState('');
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState(null); // 'approve' | 'reject'
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [resendingId, setResendingId] = useState(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (filterName.trim()) params.employeeName = filterName.trim();
      const { data } = await api.get('/api/imprest/director/queue', { params });
      // Longest-waiting first — those are the ones to chase.
      const rows = (data.data.requests || []).sort((a, b) => new Date(forwardedAt(a)) - new Date(forwardedAt(b)));
      setRequests(rows);
    } catch { showToast('Failed to load Director queue', 'error'); }
    finally { setLoading(false); }
  }, [filterName]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const openApprove = (r) => { setSelected(r); setMode('approve'); setAmount(String(r.amount_requested)); setNotes(''); setActionError(''); };
  const openReject = (r) => { setSelected(r); setMode('reject'); setReason(''); setActionError(''); };
  const close = () => { if (!acting) { setSelected(null); setMode(null); } };

  const current = selected ? parseFloat(selected.amount_requested) : 0;
  const amt = parseFloat(amount);
  const reduces = selected && amount !== '' && Number.isFinite(amt) && amt < current;

  const handleApprove = async () => {
    if (!Number.isFinite(amt) || amt <= 0) { setActionError('Enter a valid amount.'); return; }
    if (amt > current) { setActionError(`The Director can only reduce the amount — max ${fmt(current)}.`); return; }
    if (!notes.trim()) { setActionError(reduces ? 'A reason is required when you reduce the amount.' : 'A note is required.'); return; }
    setActing(true); setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/director-approve`, { notes: notes.trim(), approvedAmount: amt });
      showToast(`✓ ${selected.ref_id} approved on behalf of Director — sent to Finance`, 'success');
      setSelected(null); setMode(null);
      fetchQueue();
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to approve');
      if (e.response?.status === 409) fetchQueue();
    } finally { setActing(false); }
  };

  const handleReject = async () => {
    if (!reason.trim()) { setActionError('Rejection reason is required.'); return; }
    setActing(true); setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/director-reject`, { reason: reason.trim() });
      showToast(`${selected.ref_id} rejected on behalf of Director`, 'info');
      setSelected(null); setMode(null);
      fetchQueue();
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to reject');
      if (e.response?.status === 409) fetchQueue();
    } finally { setActing(false); }
  };

  const handleResend = async (r) => {
    setResendingId(r.id);
    try {
      await api.post(`/api/imprest/${r.id}/resend-director`);
      showToast(`✓ WhatsApp re-sent to Director for ${r.ref_id}`, 'success');
    } catch (e) { showToast(e.response?.data?.error || 'Failed to resend', 'error'); }
    finally { setResendingId(null); }
  };

  const totalAmt = requests.reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0);
  const oldest = requests.length ? Math.max(...requests.map(daysWaiting)) : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Director Approvals</h1>
        <p className="text-sm text-gray-500 mt-1">
          Requests waiting for Bhaskar Sir (Director). Approve, reduce or reject on his behalf. If he replies on WhatsApp after you act, his reply is ignored.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold">Waiting</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{loading ? '…' : requests.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold">Total amount</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{loading ? '…' : fmt(totalAmt)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold">Oldest waiting</p>
          <p className={`text-2xl font-bold mt-1 ${oldest > 3 ? 'text-red-600' : 'text-gray-900'}`}>
            {loading ? '…' : `${oldest} day${oldest !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3">
        <input type="text" placeholder="Search employee..." value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        <button onClick={fetchQueue} className="ml-auto text-sm text-indigo-600 hover:text-indigo-800">↻ Refresh</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-indigo-50 border-b border-indigo-100">
              <tr>
                {['Ref ID', 'Employee', 'Purpose', 'Amount', 'S2 Note', 'Prev Balance', 'Waiting', 'Actions'].map((h) => (
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-indigo-700 uppercase ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array(8).fill(0).map((__, j) => <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-200 rounded w-full max-w-[80px]" /></td>)}
                  </tr>
                ))
              ) : requests.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                  <div className="text-3xl mb-2">✅</div>Nothing waiting for the Director
                </td></tr>
              ) : requests.map((r) => {
                const days = daysWaiting(r);
                const original = r.original_amount_requested != null && parseFloat(r.original_amount_requested) !== parseFloat(r.amount_requested)
                  ? r.original_amount_requested : null;
                return (
                  <tr key={r.id} className="hover:bg-indigo-50/40 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-indigo-600 font-semibold whitespace-nowrap">{r.ref_id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.employee?.name || '--'}</div>
                      <div className="text-xs text-gray-500">{r.site} · {r.category}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px]"><span className="line-clamp-2" title={r.purpose}>{r.purpose || '--'}</span></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {original && <div className="text-xs text-gray-400 line-through">{fmt(original)}</div>}
                      <div className="font-semibold text-gray-900">{fmt(r.amount_requested)}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[180px]">
                      <span className="line-clamp-2" title={r.s2_note || r.s1_note || ''}>{r.s2_note || r.s1_note || '--'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {r.employee_total_balance > 0
                        ? <span className="text-xs font-bold text-red-600">{fmt(r.employee_total_balance)}</span>
                        : <span className="text-xs text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${days > 3 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        {days}d
                      </span>
                      <div className="text-[11px] text-gray-400 mt-1">{fmtDate(forwardedAt(r))}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 min-w-[120px]">
                        <button onClick={() => openApprove(r)}
                          className="text-xs bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 active:scale-95 transition-all">
                          Approve
                        </button>
                        <button onClick={() => openReject(r)}
                          className="text-xs bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700 active:scale-95 transition-all">
                          Reject
                        </button>
                        <button onClick={() => handleResend(r)} disabled={resendingId === r.id}
                          title="Resend the WhatsApp approval request to Bhaskar Sir"
                          className="text-xs border border-indigo-300 text-indigo-700 px-3 py-1 rounded-lg hover:bg-indigo-50 disabled:opacity-60 flex items-center justify-center gap-1">
                          {resendingId === r.id && <Spinner />}
                          {resendingId === r.id ? 'Sending…' : 'Resend WhatsApp'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && mode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">
                {mode === 'approve' ? 'Approve on behalf of Director' : 'Reject on behalf of Director'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{selected.ref_id} — {selected.employee?.name} · {selected.site}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{selected.category}</span></div>
                {selected.purpose && <div className="flex justify-between gap-4"><span className="text-gray-500">Purpose</span><span className="text-right">{selected.purpose}</span></div>}
                {(selected.s2_note || selected.s1_note) && (
                  <div className="flex justify-between gap-4"><span className="text-gray-500">S2 note</span><span className="text-right italic">"{selected.s2_note || selected.s1_note}"</span></div>
                )}
                {selected.employee_total_balance > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">Prev balance</span><span className="font-bold text-red-600">{fmt(selected.employee_total_balance)}</span></div>
                )}
                <div className="pt-2 border-t border-gray-200">
                  {amountWasChanged(selected)
                    ? <AmountTrail req={selected} compact />
                    : <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold">{fmt(selected.amount_requested)}</span></div>}
                </div>
              </div>

              {mode === 'approve' ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Approved amount <span className="text-xs font-normal text-gray-400">(can only be reduced)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₹</span>
                      <input type="number" min="1" max={current} step="1" value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                    </div>
                    {reduces && (
                      <p className="text-xs text-amber-600 mt-1 font-medium">Amount will change from {fmt(current)} → {fmt(amt)}</p>
                    )}
                    {Number.isFinite(amt) && amt > current && (
                      <p className="text-xs text-red-600 mt-1">Cannot be more than {fmt(current)}.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      {reduces ? 'Reason for reducing' : 'Note'} <span className="text-red-500">*</span>
                    </label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                      placeholder={reduces ? 'Why is the amount being reduced? Finance and the employee will see this.' : 'e.g. Approved by Director on call'}
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400" />
                    <p className="text-xs text-gray-400 mt-1">⚡ Moves to the Finance queue, recorded as approved by you on behalf of the Director.</p>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Rejection reason <span className="text-red-500">*</span></label>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                    placeholder="Reason for rejection..."
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400" />
                  <p className="text-xs text-red-500 mt-1">This closes the request. The employee has to raise a new one.</p>
                </div>
              )}

              {actionError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>}
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={close} disabled={acting} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              {mode === 'approve' ? (
                <button onClick={handleApprove} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-2 min-w-[140px] justify-center">
                  {acting && <Spinner className="text-white" />}
                  {acting ? 'Approving…' : 'Approve → Finance'}
                </button>
              ) : (
                <button onClick={handleReject} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center gap-2 min-w-[120px] justify-center">
                  {acting && <Spinner className="text-white" />}
                  {acting ? 'Rejecting…' : 'Reject'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
