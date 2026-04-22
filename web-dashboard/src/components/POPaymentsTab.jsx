// web-dashboard/src/components/POPaymentsTab.jsx
// SPEC-02 Part D2 — Finance Dashboard: PO Payments tab (Stage 2)
import { useState, useEffect } from 'react';
import api from '../services/api';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function POPaymentsTab() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [payModal, setPayModal] = useState(null);

  useEffect(() => { loadQueue(); }, []);

  async function loadQueue() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/po-payments/finance-queue');
      setQueue(data?.data || []);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }

  async function handlePay(po, paidAmount, notes, receiptFile) {
    const form = new FormData();
    form.append('paid_amount', paidAmount);
    if (notes) form.append('notes', notes);
    if (receiptFile) form.append('receipt', receiptFile);

    await api.post(`/api/po-payments/${po.id}/pay`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    await loadQueue();
    setPayModal(null);
  }

  const pending = queue.filter(p => p.status === 'pending_payment');
  const paid = queue.filter(p => p.status === 'paid');
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Awaiting Payment</p>
          <p className="text-2xl font-semibold mt-1">{pending.length}</p>
          <p className="text-sm text-gray-500">
            {fmt(pending.reduce((s, p) => s + Number(p.procurement_approved_amount || p.total_amount || 0), 0))}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Paid This Month</p>
          <p className="text-2xl font-semibold mt-1">
            {paid.filter(p => new Date(p.paid_at) > thirtyDaysAgo).length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Paid (all time)</p>
          <p className="text-2xl font-semibold mt-1">
            {fmt(paid.reduce((s, p) => s + Number(p.paid_amount || 0), 0))}
          </p>
        </div>
      </div>

      {/* Pending section */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Pending Payment ({pending.length})</h3>
          <div className="space-y-3">
            {pending.map(po => (
              <div key={po.id} className="bg-white rounded-xl border border-amber-100 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium">{po.cps_po_ref}</span>
                      <span className="text-sm text-gray-600">·</span>
                      <span className="text-sm font-medium">{po.project_name}</span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">{po.site}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{po.supplier_name}</p>
                    {po.payment_terms_type && (
                      <p className="text-sm text-gray-500 mt-1">
                        Terms: <span className="font-medium">{po.payment_terms_type}</span>
                        {po.payment_due_date && ` · Due ${fmtDate(po.payment_due_date)}`}
                      </p>
                    )}
                    {po.procurement_notes && (
                      <p className="text-xs text-blue-600 mt-1 italic">
                        Procurement note: "{po.procurement_notes}"
                      </p>
                    )}
                  </div>
                  <div className="ml-4 flex flex-col items-end gap-2">
                    <div className="text-right">
                      <p className="text-lg font-semibold">
                        {fmt(po.procurement_approved_amount || po.total_amount)}
                      </p>
                      {po.procurement_approved_amount &&
                        Number(po.procurement_approved_amount) !== Number(po.total_amount) && (
                          <p className="text-xs text-gray-400">PO total: {fmt(po.total_amount)}</p>
                        )}
                    </div>
                    <button
                      onClick={() => setPayModal({ po })}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium"
                    >
                      Mark as Paid
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length === 0 && (
        <div className="text-center py-10 text-gray-400 bg-white rounded-xl border">
          <p>No POs awaiting payment</p>
          <p className="text-sm mt-1">Procurement-approved POs will appear here</p>
        </div>
      )}

      {/* Paid history */}
      {paid.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Paid ({paid.length})</h3>
          <div className="space-y-2">
            {paid.slice(0, 20).map(po => (
              <div key={po.id} className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  <span className="font-mono text-sm text-gray-600">{po.cps_po_ref}</span>
                  <span className="text-sm text-gray-600">{po.project_name}</span>
                  <span className="text-xs text-gray-400">{po.supplier_name}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{fmt(po.paid_amount)}</p>
                  <p className="text-xs text-gray-400">{fmtDate(po.paid_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {payModal && (
        <PayModal
          po={payModal.po}
          onConfirm={handlePay}
          onClose={() => setPayModal(null)}
          fmt={fmt}
        />
      )}
    </div>
  );
}

function PayModal({ po, onConfirm, onClose, fmt }) {
  const [amount, setAmount] = useState(po.procurement_approved_amount || po.total_amount);
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await onConfirm(po, amount, notes, file);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Record Payment</h2>
        <p className="text-sm text-gray-500 mb-5">{po.cps_po_ref} — {po.supplier_name}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount Paid <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                max={po.procurement_approved_amount || po.total_amount}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Approved: {fmt(po.procurement_approved_amount || po.total_amount)}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Receipt</label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={e => setFile(e.target.files[0])}
              className="w-full text-sm border rounded-lg p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="UTR number, bank, or any payment notes..."
              className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !amount}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
