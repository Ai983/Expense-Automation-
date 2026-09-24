// Mark as Paid — Ritu (S2, the Director's EA) records an imprest that was
// already paid outside the system but is stuck at some approval stage. It skips
// the remaining stages and closes it as paid, starting the employee's 7-day
// expense deadline exactly like a normal Finance payment.
import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';

function fmt(n) { return `₹${Number(n).toLocaleString('en-IN')}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'; }

const STAGE_LABEL = {
  s1_pending: 'S1 (old)', s2_pending: 'S2 — Ritu', director_pending: 'Director',
  s3_pending: 'Finance', s3_approved: 'Stuck (old Finance)', founder_review_pending: 'Founder',
  founder_approved: 'Awaiting payment',
};
const STAGE_TINT = {
  s2_pending: 'bg-amber-100 text-amber-700', director_pending: 'bg-indigo-100 text-indigo-700',
  s3_pending: 'bg-blue-100 text-blue-700', founder_review_pending: 'bg-purple-100 text-purple-700',
  founder_approved: 'bg-green-100 text-green-700', s3_approved: 'bg-red-100 text-red-700',
};

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Best current figure: founder's, else finance-approved, else what is forwarded.
function currentFigure(r) {
  return parseFloat(r.founder_adjusted_amount ?? r.approved_amount ?? r.amount_requested);
}

export default function MarkPaidPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterName, setFilterName] = useState('');
  const [filterStage, setFilterStage] = useState('all');
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 500 };
      if (filterName.trim()) params.employeeName = filterName.trim();
      const { data } = await api.get('/api/imprest/s2/unpaid', { params });
      setRequests(data.data.requests || []);
    } catch { showToast('Failed to load imprests', 'error'); }
    finally { setLoading(false); }
  }, [filterName]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const open = (r) => { setSelected(r); setAmount(String(currentFigure(r))); setRemark(''); setActionError(''); };
  const close = () => { if (!acting) setSelected(null); };

  const asked = selected ? parseFloat(selected.original_amount_requested ?? selected.amount_requested) : 0;
  const amt = parseFloat(amount);
  const changed = selected && Number.isFinite(amt) && Math.round(amt * 100) !== Math.round(currentFigure(selected) * 100);

  const handleMarkPaid = async () => {
    if (!Number.isFinite(amt) || amt <= 0) { setActionError('Enter the amount actually paid.'); return; }
    if (amt > asked) { setActionError(`Cannot be more than the employee requested (${fmt(asked)}).`); return; }
    if (!remark.trim()) { setActionError('A remark is required — how and when was it paid?'); return; }
    setActing(true); setActionError('');
    try {
      await api.post(`/api/imprest/${selected.id}/s2-mark-paid`, { paidAmount: amt, remark: remark.trim() });
      showToast(`✓ ${selected.ref_id} marked paid — ${fmt(amt)}`, 'success');
      setSelected(null);
      fetchQueue();
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to mark paid');
      if (e.response?.status === 409) fetchQueue();
    } finally { setActing(false); }
  };

  const shown = filterStage === 'all' ? requests : requests.filter((r) => r.current_stage === filterStage);
  const stages = [...new Set(requests.map((r) => r.current_stage))];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mark as Paid</h1>
        <p className="text-sm text-gray-500 mt-1">
          For imprests that were already paid but are stuck at an approval stage. This skips the remaining stages, records the amount actually paid and starts the employee's 7-day expense deadline.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-wrap gap-3 items-center">
        <input type="text" placeholder="Search employee..." value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-400" />
        <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
          <option value="all">All stages</option>
          {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s] || s}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500">{shown.length} unpaid</span>
        <button onClick={fetchQueue} className="text-sm text-green-700 hover:text-green-900">↻ Refresh</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Ref ID', 'Employee', 'Purpose', 'Amount', 'Stuck at', 'Submitted', ''].map((h) => (
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
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
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No unpaid imprests</td></tr>
              ) : shown.map((r) => {
                const orig = r.original_amount_requested != null && parseFloat(r.original_amount_requested) !== currentFigure(r)
                  ? r.original_amount_requested : null;
                return (
                  <tr key={r.id} className="hover:bg-green-50/40">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 font-semibold whitespace-nowrap">{r.ref_id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.employee?.name || '--'}</div>
                      <div className="text-xs text-gray-500">{r.site} · {r.category}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 max-w-[220px]"><span className="line-clamp-2" title={r.purpose}>{r.purpose || '--'}</span></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {orig && <div className="text-xs text-gray-400 line-through">{fmt(orig)}</div>}
                      <div className="font-semibold text-gray-900">{fmt(currentFigure(r))}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STAGE_TINT[r.current_stage] || 'bg-gray-100 text-gray-600'}`}>
                        {STAGE_LABEL[r.current_stage] || r.current_stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDate(r.submitted_at || r.created_at)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => open(r)}
                        className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 active:scale-95 transition-all whitespace-nowrap">
                        Mark Paid
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h2 className="text-lg font-bold text-gray-900">Mark as Fully Paid</h2>
              <p className="text-sm text-gray-500 mt-1">{selected.ref_id} — {selected.employee?.name} · {selected.site}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Stuck at</span><span className="font-medium">{STAGE_LABEL[selected.current_stage] || selected.current_stage}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Employee requested</span><span>{fmt(asked)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Current approved figure</span><span className="font-bold">{fmt(currentFigure(selected))}</span></div>
                {selected.purpose && <div className="flex justify-between gap-4"><span className="text-gray-500">Purpose</span><span className="text-right">{selected.purpose}</span></div>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Amount actually paid <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₹</span>
                  <input type="number" min="1" max={asked} step="1" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
                {changed && amt <= asked && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">Final amount {fmt(currentFigure(selected))} → {fmt(amt)}. The employee can claim expenses up to this amount.</p>
                )}
                {Number.isFinite(amt) && amt > asked && (
                  <p className="text-xs text-red-600 mt-1">Cannot be more than the employee requested ({fmt(asked)}).</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Remark <span className="text-red-500">*</span></label>
                <textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3}
                  placeholder="How and when was it paid? e.g. Paid in cash on 20 Sep / UTR 1234…"
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400" />
                <p className="text-xs text-gray-400 mt-1">⚡ Closes the request as paid and skips the remaining approvals. The employee gets a WhatsApp and 7 days to file expenses.</p>
              </div>

              {actionError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>}
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={close} disabled={acting} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button onClick={handleMarkPaid} disabled={acting}
                className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-2 min-w-[150px] justify-center">
                {acting && <Spinner />}
                {acting ? 'Saving…' : 'Mark Fully Paid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
