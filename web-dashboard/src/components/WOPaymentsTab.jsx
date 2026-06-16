// web-dashboard/src/components/WOPaymentsTab.jsx
// Finance Dashboard: Work Order Payments tab.
// Work orders that CPS has handed off ("Send to Finance") with bank details.
// Finance pays them (full or partial); payments are recorded back into CPS.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../services/api';

function Modal({ open, children }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.5)' }} className="modal-overlay">
      {children}
    </div>,
    document.body
  );
}

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function WOPaymentsTab() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { loadQueue(); }, []);

  async function loadQueue() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/wo-payments/finance-queue');
      setQueue(data?.data || []);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }

  async function handlePay(wo, paidAmount, notes, receiptFile) {
    const form = new FormData();
    form.append('paid_amount', paidAmount);
    if (notes) form.append('notes', notes);
    if (receiptFile) form.append('receipt', receiptFile);
    await api.post(`/api/wo-payments/${wo.id}/pay`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    await loadQueue();
    setPayModal(null);
  }

  const remainingOf = (wo) => Math.max(0, Number(wo.grand_total || 0) - Number(wo.paid_amount || 0));
  const isPaid = (wo) => wo.payment_status === 'paid';

  const q = searchTerm.trim().toLowerCase();
  const matches = (wo) => !q || [wo.wo_number, wo.supplier_name_text, wo.project_site, wo.category].some(t => String(t || '').toLowerCase().includes(q));

  const pending = queue.filter(wo => !isPaid(wo));
  const paid = queue.filter(isPaid);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const visiblePending = pending.filter(matches);
  const visiblePaid = paid.filter(matches);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="bg-white rounded-xl border p-3 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
          <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
        </svg>
        <input
          type="text"
          placeholder="Search by WO number, supplier, project, or category…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full text-sm border-0 outline-none focus:ring-0 placeholder:text-gray-400"
        />
        {searchTerm && (
          <button type="button" onClick={() => setSearchTerm('')} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-0.5 rounded shrink-0">Clear</button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Awaiting / Partial</p>
          <p className="text-2xl font-semibold mt-1">{pending.length}</p>
          <p className="text-sm text-gray-500">{fmt(pending.reduce((s, wo) => s + remainingOf(wo), 0))} remaining</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Paid This Month</p>
          <p className="text-2xl font-semibold mt-1">{paid.filter(wo => new Date(wo.paid_at) > thirtyDaysAgo).length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Paid (all time)</p>
          <p className="text-2xl font-semibold mt-1">{fmt(paid.reduce((s, wo) => s + Number(wo.paid_amount || 0), 0))}</p>
        </div>
      </div>

      {/* Pending / Partial */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          🔧 Work Orders to Pay ({visiblePending.length}{q && visiblePending.length !== pending.length ? ` of ${pending.length}` : ''}) <span className="font-normal text-gray-400">— sent by procurement</span>
        </h3>
        {pending.length === 0 && (
          <div className="text-center py-10 text-gray-400 bg-white rounded-xl border">
            <p>No work orders awaiting payment</p>
            <p className="text-sm mt-1">WOs sent to finance from CPS will appear here</p>
          </div>
        )}
        {q && pending.length > 0 && visiblePending.length === 0 && (
          <p className="text-sm text-gray-500 italic">No work orders match "{searchTerm}".</p>
        )}
        <div className="space-y-3">
          {visiblePending.map(wo => {
            const paidAmt = Number(wo.paid_amount || 0);
            const remaining = remainingOf(wo);
            const history = Array.isArray(wo.payment_logs) ? wo.payment_logs : [];
            const isOpen = expandedId === wo.id;
            return (
              <div key={wo.id} className="bg-white rounded-xl border border-amber-100 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">{wo.wo_number}</span>
                      {wo.category && <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">{wo.category}</span>}
                      {wo.payment_status === 'partially_paid' && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">Partially Paid</span>}
                    </div>
                    <p className="text-sm font-medium text-gray-800 mt-1">{wo.project_site || '—'}</p>
                    <p className="text-sm text-gray-500">{wo.supplier_name_text}{wo.supplier_gstin ? ` · GSTIN ${wo.supplier_gstin}` : ''}</p>
                    {(wo.bank_name || wo.bank_account_number) && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {wo.bank_name} {wo.bank_account_number ? `••${String(wo.bank_account_number).slice(-4)}` : ''} {wo.bank_ifsc ? `· ${wo.bank_ifsc}` : ''} {wo.bank_account_holder_name ? `(${wo.bank_account_holder_name})` : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-400">WO Total</p>
                    <p className="text-lg font-semibold">{fmt(wo.grand_total)}</p>
                    {paidAmt > 0 && <p className="text-xs text-gray-500">Paid {fmt(paidAmt)} · Bal {fmt(remaining)}</p>}
                    <div className="flex gap-2 mt-2 justify-end items-center">
                      {wo.wo_pdf_url && <a href={wo.wo_pdf_url} target="_blank" rel="noreferrer" className="text-xs text-gray-500 underline">WO PDF</a>}
                      <button onClick={() => setPayModal({ wo, remaining })}
                        className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        {paidAmt > 0 ? 'Pay More' : 'Mark as Paid'}
                      </button>
                    </div>
                  </div>
                </div>

                {history.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <button onClick={() => setExpandedId(isOpen ? null : wo.id)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                      {isOpen ? '▲ Hide payment history' : `▼ View payment history (${history.length})`}
                    </button>
                    {isOpen && <PaymentHistory history={history} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Paid history */}
      {paid.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Paid ({visiblePaid.length}{q && visiblePaid.length !== paid.length ? ` of ${paid.length}` : ''})</h3>
          <div className="space-y-2">
            {visiblePaid.slice(0, 30).map(wo => {
              const history = Array.isArray(wo.payment_logs) ? wo.payment_logs : [];
              const isOpen = expandedId === wo.id;
              return (
                <div key={wo.id} className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between py-3 px-4">
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                      <div>
                        <p className="font-mono text-sm text-gray-600">{wo.wo_number}</p>
                        <p className="text-sm text-gray-600">{wo.project_site}</p>
                        <p className="text-xs text-gray-400">{wo.supplier_name_text}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">WO Total: {fmt(wo.grand_total)}</p>
                      <p className="text-sm font-semibold text-green-700">Paid: {fmt(wo.paid_amount)}</p>
                      <p className="text-xs text-gray-400">{fmtDate(wo.paid_at)}</p>
                      {history.length > 0 && (
                        <button onClick={() => setExpandedId(isOpen ? null : wo.id)} className="text-xs text-blue-600 hover:underline mt-0.5">
                          {isOpen ? 'Hide history' : `History (${history.length})`}
                        </button>
                      )}
                    </div>
                  </div>
                  {isOpen && history.length > 0 && <div className="border-t px-4 py-2"><PaymentHistory history={history} /></div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {payModal && (
        <PayModal
          wo={payModal.wo}
          remaining={payModal.remaining}
          onConfirm={handlePay}
          onClose={() => setPayModal(null)}
        />
      )}
    </div>
  );
}

function PaymentHistory({ history }) {
  return (
    <div className="mt-2 space-y-2">
      {history.map((log, idx) => (
        <div key={idx} className="flex items-center justify-between bg-white border border-green-100 rounded-lg px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
            <div>
              <p className="text-xs text-gray-600">{log.paid_at ? fmtDate(log.paid_at) : '—'}</p>
              {log.notes && <p className="text-xs text-gray-400 italic">"{log.notes}"</p>}
              {log.paid_by_name && <p className="text-xs text-gray-400">by {log.paid_by_name}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-green-700">{fmt(log.amount)}</p>
            {log.receipt_path && (
              <a href={log.receipt_path} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Receipt</a>
            )}
          </div>
        </div>
      ))}
      <div className="flex justify-between text-xs text-gray-500 px-3 pt-1 border-t">
        <span>Total Paid</span>
        <span className="font-semibold text-green-700">{fmt(history.reduce((s, l) => s + (Number(l.amount) || 0), 0))}</span>
      </div>
    </div>
  );
}

function PayModal({ wo, remaining, onConfirm, onClose }) {
  const [amount, setAmount] = useState(remaining > 0 ? remaining.toFixed(2) : '');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true);
    setError('');
    try {
      await onConfirm(wo, amount, notes, file);
    } catch (e) {
      setError(e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Payment failed');
    } finally {
      setLoading(false);
    }
  }

  const enteredAmt = parseFloat(amount || 0);
  const isFullSettlement = enteredAmt >= remaining - 0.01;
  const alreadyPaid = Number(wo.paid_amount || 0);

  return (
    <Modal open>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Record WO Payment</h2>
        <p className="text-sm text-gray-500 mb-4">{wo.wo_number} — {wo.supplier_name_text}</p>

        <div className="bg-gray-50 rounded-lg p-3 mb-5 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">WO Total</span><span className="font-medium">{fmt(wo.grand_total)}</span></div>
          {alreadyPaid > 0 && (
            <div className="flex justify-between"><span className="text-gray-500">Already Paid</span><span className="text-green-600 font-medium">{fmt(alreadyPaid)}</span></div>
          )}
          <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold text-gray-700">Balance Due</span><span className="font-bold text-amber-700">{fmt(remaining)}</span></div>
        </div>

        {(wo.bank_name || wo.bank_account_number) && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-5 text-sm">
            <p className="text-xs text-blue-500 uppercase tracking-wide mb-1">Pay to</p>
            <p className="text-gray-700 font-medium">{wo.bank_account_holder_name || '—'}</p>
            <p className="text-gray-600">{wo.bank_name} · {wo.bank_ifsc}</p>
            <p className="text-gray-600 font-mono">{wo.bank_account_number}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount Paying Now <span className="text-red-500">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
              <input type="number" step="0.01" max={remaining} value={amount} onChange={e => setAmount(e.target.value)} className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm" />
            </div>
            <p className="text-xs mt-1">
              {isFullSettlement
                ? <span className="text-green-600 font-medium">Full settlement — WO will be marked Paid</span>
                : <span className="text-blue-600">Partial — WO stays open with {fmt(remaining - enteredAmt)} balance</span>}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Receipt</label>
            <input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files[0])} className="w-full text-sm border rounded-lg p-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="UTR number, bank, or any payment notes..." className="w-full px-3 py-2 border rounded-lg text-sm resize-none" />
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={loading || !amount || parseFloat(amount) <= 0}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? 'Saving...' : isFullSettlement ? 'Confirm Full Payment' : 'Record Partial Payment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
