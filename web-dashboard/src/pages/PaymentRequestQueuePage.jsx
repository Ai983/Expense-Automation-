// web-dashboard/src/pages/PaymentRequestQueuePage.jsx
// Payment Requests — the compliance-cleared queue from CPS.
//
// This is what replaces working off the WhatsApp sheet. Everything here is read
// live from CPS through /api/prq-payments; nothing about a payment request is
// stored on the finance side. Bank details in particular are NEVER copied —
// they are read from the CPS vendor master on every load, with the verification
// status that CPS attached to them.
import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// No default. A hold with no category is indistinguishable from a system
// failure when the monthly numbers are read.
const HOLD_CATEGORIES = [
  { value: 'compliance',    label: 'Compliance',    hint: 'Document missing or wrong' },
  { value: 'discretionary', label: 'Discretionary', hint: 'As per sir’s instruction' },
  { value: 'commercial',    label: 'Commercial',    hint: 'Amount dispute, vendor issue' },
  { value: 'funds',         label: 'Funds',         hint: 'Cash-flow timing' },
];

function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StatusBadge({ status }) {
  const map = {
    compliance_cleared: 'bg-green-100 text-green-700 border-green-200',
    finance_queued:     'bg-blue-100 text-blue-700 border-blue-200',
    finance_hold:       'bg-amber-100 text-amber-800 border-amber-200',
    paid:               'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${map[status] || 'bg-slate-100 text-slate-600'}`}>
      {String(status || '').replace(/_/g, ' ')}
    </span>
  );
}

/**
 * The Phase 3 bank verification, carried through the handoff. A number a site
 * user typed over the vendor master must never be silently trusted here.
 */
function BankBlock({ prq }) {
  const warn = prq.confirm_before_transfer;
  return (
    <div className={`rounded-md border p-3 text-sm ${warn ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium">Bank details</span>
        <span className={`text-xs px-2 py-0.5 rounded border ${
          warn ? 'bg-red-100 text-red-800 border-red-200' : 'bg-green-100 text-green-700 border-green-200'}`}>
          {warn ? 'CONFIRM BEFORE TRANSFER' : 'Matches vendor master'}
        </span>
      </div>
      <div className="font-mono text-sm">{prq.bank_account_number || '—'}</div>
      <div className="font-mono text-xs text-slate-500">
        {prq.bank_ifsc || '—'}
        {prq.bank_ifsc_format_valid === false && (
          <span className="ml-1 text-red-700">(invalid IFSC format)</span>
        )}
      </div>
      <div className="text-xs text-slate-600 mt-1">{prq.bank_holder_name || prq.beneficiary_name || '—'}</div>

      {warn && (
        <div className="mt-2 text-xs text-red-900 space-y-1">
          <div>
            Source: <span className="font-medium">{prq.bank_source || 'unknown'}</span>
            {' · '}CPS check: <span className="font-medium">{prq.bank_verification_status}</span>
          </div>
          {prq.bank_master_account_number
            && prq.bank_master_account_number !== prq.bank_account_number && (
            <div>
              Vendor master holds{' '}
              <span className="font-mono">{prq.bank_master_account_number}</span> — these differ.
            </div>
          )}
          {prq.bank_override_reason && <div>Override reason: {prq.bank_override_reason}</div>}
        </div>
      )}
    </div>
  );
}

export default function PaymentRequestQueuePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('open');
  const [selected, setSelected] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [holdCategory, setHoldCategory] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [receipt, setReceipt] = useState(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.get('/api/prq-payments/queue');
      setRows(res.data?.data ?? res.data ?? []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (prq) => {
    setSelected(prq);
    setHoldCategory(''); setHoldReason(''); setRejectReason('');
    setPayAmount(String(prq.net_amount ?? '')); setPayRef(''); setReceipt(null);
    setDocsLoading(true);
    try {
      const res = await api.get(`/api/prq-payments/${prq.prq_id}/documents`);
      setDocs(res.data?.data ?? res.data ?? []);
    } catch { setDocs([]); } finally { setDocsLoading(false); }
  };

  const doHold = async () => {
    if (!holdCategory) { alert('Pick a hold category — it is required.'); return; }
    if (!holdReason.trim()) { alert('A written reason is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/api/prq-payments/${selected.prq_id}/hold`,
        { hold_category: holdCategory, hold_reason: holdReason.trim() });
      setSelected(null); await load();
    } catch (e) { alert(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  const doRelease = async () => {
    setBusy(true);
    try {
      await api.post(`/api/prq-payments/${selected.prq_id}/release`, {});
      setSelected(null); await load();
    } catch (e) { alert(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  const doReject = async () => {
    if (!rejectReason.trim()) { alert('A written reason is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/api/prq-payments/${selected.prq_id}/reject`,
        { reject_reason: rejectReason.trim() });
      setSelected(null); await load();
    } catch (e) { alert(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  const doPay = async () => {
    if (!payAmount || Number(payAmount) <= 0) { alert('Enter the amount paid.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('paid_amount', payAmount);
      fd.append('payment_status', 'paid');
      if (payRef) fd.append('reference', payRef);
      if (receipt) fd.append('receipt', receipt);
      await api.post(`/api/prq-payments/${selected.prq_id}/pay`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      setSelected(null); await load();
    } catch (e) { alert(e.response?.data?.error || e.message); } finally { setBusy(false); }
  };

  const visible = useMemo(() => {
    if (filter === 'open') return rows.filter((r) => r.status !== 'paid');
    if (filter === 'hold') return rows.filter((r) => r.status === 'finance_hold');
    if (filter === 'confirm') return rows.filter((r) => r.confirm_before_transfer);
    return rows;
  }, [rows, filter]);

  const stats = useMemo(() => ({
    open: rows.filter((r) => r.status !== 'paid').length,
    held: rows.filter((r) => r.status === 'finance_hold').length,
    confirm: rows.filter((r) => r.confirm_before_transfer).length,
    value: rows.filter((r) => r.status !== 'paid').reduce((s, r) => s + Number(r.net_amount || 0), 0),
  }), [rows]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Payment Requests</h1>
        <p className="text-sm text-slate-500 mt-1">
          Compliance-cleared requests from CPS. Bank details are read live from the CPS vendor
          master — nothing is copied here.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 text-sm bg-white rounded-lg border p-4">
        <span><b>{stats.open}</b> awaiting payment</span>
        <span className="text-amber-700"><b>{stats.held}</b> on hold</span>
        <span className="text-red-700"><b>{stats.confirm}</b> need bank confirmation</span>
        <span className="ml-auto font-medium">{fmt(stats.value)} outstanding</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {[['open', 'Open'], ['hold', 'On hold'], ['confirm', 'Confirm bank'], ['all', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded text-sm border ${
              filter === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200'}`}>
            {l}
          </button>
        ))}
        <button onClick={load} className="px-3 py-1.5 rounded text-sm border bg-white border-slate-200 ml-auto">
          Refresh
        </button>
      </div>

      {err && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm"><Spinner /> Loading…</div>
      ) : !visible.length ? (
        <div className="rounded-lg border bg-white p-8 text-center text-slate-500 text-sm">
          Nothing in the queue. Requests appear here once CPS marks them compliance-cleared.
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">Request</th>
                <th className="text-left p-3">Party</th>
                <th className="text-right p-3">Net</th>
                <th className="text-left p-3">Expected</th>
                <th className="text-left p-3">Docs</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.prq_id} onClick={() => openDetail(r)}
                  className="border-t hover:bg-slate-50 cursor-pointer">
                  <td className="p-3">
                    <div className="font-medium">{r.prq_number}</div>
                    <div className="text-xs text-slate-500">{r.project_name || '—'}</div>
                    {r.confirm_before_transfer && (
                      <span className="inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-800 border border-red-200">
                        confirm bank
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div>{r.party_or_work || r.supplier_name || '—'}</div>
                    <div className="text-xs text-slate-500">{r.invoice_number || 'no invoice no.'}</div>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">{fmt(r.net_amount)}</td>
                  <td className="p-3 whitespace-nowrap">{fmtDate(r.expected_payment_date)}</td>
                  <td className="p-3 whitespace-nowrap">
                    {r.documents_verified}/{r.documents_required}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={r.status} />
                    {r.hold_category && (
                      <div className="text-[11px] text-amber-800 mt-0.5">{r.hold_category}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">{selected.prq_number}</h2>
                <p className="text-sm text-slate-500">
                  {selected.party_or_work} · {fmt(selected.net_amount)}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 text-xl leading-none">×</button>
            </div>

            <BankBlock prq={selected} />

            <div className="text-sm grid grid-cols-2 gap-2">
              <div><span className="text-slate-500">Invoice</span><div>{selected.invoice_number || '—'}</div></div>
              <div><span className="text-slate-500">Invoice date</span><div>{fmtDate(selected.invoice_date)}</div></div>
              <div><span className="text-slate-500">Vendor</span><div>{selected.supplier_name || '—'}</div></div>
              <div><span className="text-slate-500">GSTIN</span><div>{selected.supplier_gstin || '—'}</div></div>
              <div><span className="text-slate-500">Raised by</span><div>{selected.raised_by_name || '—'}</div></div>
              <div><span className="text-slate-500">Expected</span><div>{fmtDate(selected.expected_payment_date)}</div></div>
            </div>

            {selected.po_pi_not_applicable && (
              <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                <b>PO/PI not applicable.</b> {selected.po_pi_exception_reason}
              </div>
            )}

            {selected.gst_not_applicable && (
              <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                <b>GST not applicable</b> (marked by Procurement): {selected.gst_exception_reason}
                <span className="block text-slate-500 mt-0.5">
                  The GST certificate is intentionally absent. If this reason doesn't hold up, reject it.
                </span>
              </div>
            )}

            {/* Documents — viewable without leaving this dashboard */}
            <div>
              <h3 className="font-medium text-sm mb-1">Documents</h3>
              {docsLoading ? (
                <div className="flex items-center gap-2 text-slate-500 text-sm"><Spinner /> Loading…</div>
              ) : !docs.length ? (
                <p className="text-sm text-slate-500">No documents attached.</p>
              ) : (
                <ul className="divide-y border rounded">
                  {docs.map((d) => (
                    <li key={d.document_id} className="p-2 flex items-center justify-between text-sm">
                      <span>
                        {String(d.document_type).replace(/_/g, ' ')}
                        <span className={`ml-2 text-[11px] ${
                          d.verify_status === 'verified' ? 'text-green-700' : 'text-slate-500'}`}>
                          {d.verify_status}
                        </span>
                      </span>
                      {d.signed_url
                        ? <a href={d.signed_url} target="_blank" rel="noreferrer"
                            className="text-blue-600 hover:underline">View</a>
                        : <span className="text-slate-400 text-xs">missing</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selected.status === 'finance_hold' ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 space-y-2">
                <div className="text-sm">
                  <b>On hold ({selected.hold_category})</b>
                  <div className="text-xs mt-0.5">{selected.hold_reason}</div>
                </div>
                <button onClick={doRelease} disabled={busy}
                  className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm disabled:opacity-50">
                  Release hold
                </button>
              </div>
            ) : (
              <>
                {/* Pay */}
                <div className="rounded border p-3 space-y-2">
                  <h3 className="font-medium text-sm">Record payment</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="Amount paid" className="border rounded px-2 py-1.5 text-sm" />
                    <input value={payRef} onChange={(e) => setPayRef(e.target.value)}
                      placeholder="UTR / reference" className="border rounded px-2 py-1.5 text-sm" />
                  </div>
                  <input type="file" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                    className="text-xs" />
                  <button onClick={doPay} disabled={busy}
                    className="px-3 py-1.5 rounded bg-green-600 text-white text-sm disabled:opacity-50">
                    {busy ? 'Saving…' : 'Mark paid'}
                  </button>
                </div>

                {/* Hold — category mandatory, no default */}
                <div className="rounded border p-3 space-y-2">
                  <h3 className="font-medium text-sm">Put on hold</h3>
                  <p className="text-xs text-slate-500">
                    A category is required. Without it, a discretionary hold is counted as a
                    system failure forever.
                  </p>
                  <select value={holdCategory} onChange={(e) => setHoldCategory(e.target.value)}
                    className="border rounded px-2 py-1.5 text-sm w-full">
                    <option value="">Choose a category…</option>
                    {HOLD_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label} — {c.hint}</option>
                    ))}
                  </select>
                  <textarea value={holdReason} onChange={(e) => setHoldReason(e.target.value)}
                    rows={2} placeholder="Why is this on hold?"
                    className="border rounded px-2 py-1.5 text-sm w-full" />
                  <button onClick={doHold} disabled={busy || !holdCategory || !holdReason.trim()}
                    className="px-3 py-1.5 rounded bg-amber-600 text-white text-sm disabled:opacity-50">
                    Hold
                  </button>
                </div>
              </>
            )}

            {/* Reject — send back to Procurement. Shows on active AND held rows. */}
            <div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
              <h3 className="font-medium text-sm">Send back to Procurement</h3>
              <p className="text-xs text-slate-500">
                Use this when the request itself is wrong — a missing document, or a non-GST
                reason that doesn't hold up. It returns to Procurement to fix and re-submit.
              </p>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                rows={2} placeholder="Why is this being sent back?"
                className="border rounded px-2 py-1.5 text-sm w-full" />
              <button onClick={doReject} disabled={busy || !rejectReason.trim()}
                className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50">
                Reject &amp; send back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
