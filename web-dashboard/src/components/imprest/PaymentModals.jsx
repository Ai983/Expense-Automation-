import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';

// Finance's two actions on a founder-approved imprest, shared by the Imprest
// Queue and the Pipeline Board so the payout rules live in one place.

function fmt(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

// What Pay records unless finance changes it — mirrors the backend /pay route:
// the founder's figure if they set one, else net after old-balance deduction
// (a net of 0 falls back to the approved amount).
export function defaultPayout(req) {
  return Number(req.founder_adjusted_amount ?? (req.net_approved_amount || req.approved_amount));
}

// The most finance may pay: what the founder signed off.
export function payoutCap(req) {
  return Number(req.founder_adjusted_amount ?? req.approved_amount ?? req.amount_requested);
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

export function PayImprestModal({ req, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setAmount(req ? String(defaultPayout(req)) : '');
    setRemark(''); setReceipt(null); setError('');
  }, [req?.id]);

  if (!req) return null;

  const payout = defaultPayout(req);
  const cap = payoutCap(req);
  const amountNum = Number(amount);
  const changed = amount !== '' && Math.round(amountNum * 100) !== Math.round(payout * 100);

  const handlePay = async () => {
    if (amount === '' || !(amountNum > 0)) { setError('Enter the amount you are paying.'); return; }
    if (Math.round(amountNum * 100) > Math.round(cap * 100)) {
      setError(`Cannot pay more than the Founder approved (${fmt(cap)}).`); return;
    }
    if (changed && !remark.trim()) { setError('Add a reason for paying a different amount.'); return; }
    setLoading(true); setError('');
    try {
      const formData = new FormData();
      if (receipt) formData.append('receipt', receipt);
      if (remark.trim()) formData.append('paymentRemark', remark.trim());
      if (changed) formData.append('adjustedAmount', String(amountNum));
      await api.post(`/api/imprest/${req.id}/pay`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onDone?.();
    } catch (e) { setError(e.response?.data?.error || 'Pay failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md modal-content">
        <div className="p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">💸 Mark as Paid</h2>
          <p className="text-sm text-gray-500 mt-0.5">{req.ref_id} — {req.employee?.name}</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Approved Payout</span><span className="font-bold text-green-700 text-base">{fmt(payout)}</span></div>
            {req.founder_adjusted_amount != null && (
              <div className="flex justify-between text-xs"><span className="text-blue-600">✏️ Set by founder</span><span className="text-gray-400 line-through">{fmt(req.approved_amount)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{req.category}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{req.site}</span></div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Amount to Pay (₹)</label>
            <input type="number" min="1" step="0.01" max={cap}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {changed ? (
              <p className="text-xs text-blue-600 mt-1 font-medium">
                Paying {fmt(amountNum || 0)} instead of {fmt(payout)}. A reason is required, and the Founder is informed on WhatsApp.
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">Change this only if you are paying a different amount. Maximum {fmt(cap)} — what the Founder approved.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {changed
                ? <>Reason for the Changed Amount <span className="text-red-500">*</span></>
                : <>Finance Remark <span className="text-gray-400 font-normal">(optional)</span></>}
            </label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder={changed ? 'e.g. ₹5,000 already paid in cash on 10 Sep, paying the balance…' : 'e.g. Paid via NEFT, transferred to account ending 4521…'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">This remark will be sent to the employee over WhatsApp.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Receipt <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="file" accept="image/*,application/pdf"
              onChange={(e) => setReceipt(e.target.files[0] || null)}
              className="w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
            <p className="text-xs text-gray-400 mt-1">Upload a payment slip or receipt as proof.</p>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="p-5 border-t flex justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 active:scale-95 transition-all">Cancel</button>
          <button onClick={handlePay} disabled={loading}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 active:scale-95 transition-all">
            {loading ? 'Processing…' : changed ? `Confirm Payment of ${fmt(amountNum || 0)}` : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function DeclinePaymentModal({ req, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setReason(''); setError(''); }, [req?.id]);

  if (!req) return null;

  const handleDecline = async () => {
    if (!reason.trim()) { setError('A reason is required to decline payment.'); return; }
    setLoading(true); setError('');
    try {
      await api.post(`/api/imprest/${req.id}/decline-payment`, { reason: reason.trim() });
      onDone?.();
    } catch (e) { setError(e.response?.data?.error || 'Decline failed'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md modal-content">
        <div className="p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">✗ Decline Payment</h2>
          <p className="text-sm text-gray-500 mt-0.5">{req.ref_id} — {req.employee?.name}</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Approved Payout</span><span className="font-bold text-gray-900">{fmt(defaultPayout(req))}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{req.category}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{req.site}</span></div>
            {req.founder_gate_comment && (
              <div className="flex justify-between gap-4"><span className="text-gray-500 shrink-0">Founder Note</span><span className="italic text-right">"{req.founder_gate_comment}"</span></div>
            )}
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
            The request is closed as rejected and will not be paid. The employee and the Founder are informed on WhatsApp.
            This cannot be undone — if the money is still needed, the employee raises a new request.
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              rows={3} placeholder="e.g. Already paid outside the system on 12 Sep…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none" />
            <p className="text-xs text-gray-400 mt-1">Sent to the employee and the Founder.</p>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="p-5 border-t flex justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 active:scale-95 transition-all">Cancel</button>
          <button onClick={handleDecline} disabled={loading}
            className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 active:scale-95 transition-all">
            {loading ? 'Declining…' : 'Decline Payment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
