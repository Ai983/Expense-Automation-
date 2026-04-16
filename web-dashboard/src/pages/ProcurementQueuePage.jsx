// web-dashboard/src/pages/ProcurementQueuePage.jsx
// SPEC-02 Part C — Stage 1: Procurement Finance review queue
import { useState, useEffect } from 'react';
import api from '../services/api';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function TermsBadge({ source, confidence }) {
  if (source === 'ai_extracted' && confidence >= 70) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 border border-green-200">
        ✦ AI extracted · {confidence}%
      </span>
    );
  }
  if (source === 'ai_override') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 border border-blue-200">
        ✦ AI + manual
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700 border border-amber-200">
      ⚠ Manually entered
    </span>
  );
}

export default function ProcurementQueuePage() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionModal, setActionModal] = useState(null); // { type: 'approve'|'reject', po }

  useEffect(() => { loadQueue(); }, []);

  async function loadQueue() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/po-payments/procurement-queue');
      setQueue(data || []);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(po, approvedAmount, notes, correctedTerms) {
    await api.post(`/api/po-payments/${po.id}/procurement-approve`, {
      approved_amount: approvedAmount,
      notes,
      ...correctedTerms,
    });
    await loadQueue();
    setActionModal(null);
  }

  async function handleReject(po, reason) {
    await api.post(`/api/po-payments/${po.id}/procurement-reject`, { reason });
    await loadQueue();
    setActionModal(null);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Procurement Payments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review Director-approved POs and forward to Finance for payment
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">{queue.length} pending</span>
          <button
            onClick={loadQueue}
            className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Pending Review</p>
          <p className="text-2xl font-semibold mt-1">{queue.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Value</p>
          <p className="text-2xl font-semibold mt-1">
            {fmt(queue.reduce((s, p) => s + Number(p.total_amount || 0), 0))}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">AI Terms Extracted</p>
          <p className="text-2xl font-semibold mt-1">
            {queue.filter(p => p.payment_terms_source === 'ai_extracted').length}
            <span className="text-sm font-normal text-gray-400 ml-1">/ {queue.length}</span>
          </p>
        </div>
      </div>

      {/* PO Cards */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : queue.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">No POs pending procurement review</p>
          <p className="text-sm mt-1">Approved POs from CPS will appear here automatically</p>
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map(po => (
            <POCard
              key={po.id}
              po={po}
              onApprove={() => setActionModal({ type: 'approve', po })}
              onReject={() => setActionModal({ type: 'reject', po })}
              TermsBadge={TermsBadge}
              fmtDate={fmtDate}
              fmt={fmt}
            />
          ))}
        </div>
      )}

      {actionModal?.type === 'approve' && (
        <ApproveModal
          po={actionModal.po}
          onConfirm={handleApprove}
          onClose={() => setActionModal(null)}
          fmt={fmt}
        />
      )}

      {actionModal?.type === 'reject' && (
        <RejectModal
          po={actionModal.po}
          onConfirm={handleReject}
          onClose={() => setActionModal(null)}
        />
      )}
    </div>
  );
}

function POCard({ po, onApprove, onReject, TermsBadge, fmtDate, fmt }) {
  const isDueSoon = po.payment_due_date &&
    new Date(po.payment_due_date) < new Date(Date.now() + 7 * 86400000);

  return (
    <div className={`bg-white rounded-xl border p-5 hover:shadow-sm transition-shadow
      ${isDueSoon ? 'border-amber-200' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm font-medium text-gray-900">{po.cps_po_ref}</span>
            <span className="text-sm text-gray-500">·</span>
            <span className="text-sm font-medium text-gray-700">{po.project_name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              {po.site}
            </span>
            {isDueSoon && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                Due {fmtDate(po.payment_due_date)}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-4 flex-wrap">
            <span className="text-gray-600 text-sm">{po.supplier_name}</span>
            {po.supplier_gstin && (
              <span className="text-xs text-gray-400 font-mono">GST: {po.supplier_gstin}</span>
            )}
          </div>

          <div className="mt-3 flex items-start gap-2 flex-wrap">
            {po.payment_terms_type ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 font-medium">Terms:</span>
                  <span className="text-sm text-gray-600">{po.payment_terms_type}</span>
                </div>
                <TermsBadge
                  source={po.payment_terms_source}
                  confidence={po.payment_terms_confidence}
                />
              </>
            ) : (
              <span className="text-sm text-amber-600">
                ⚠ No payment terms — you can add them when approving
              </span>
            )}
          </div>

          {po.payment_terms_notes && (
            <p className="mt-1 text-xs text-gray-500 italic">"{po.payment_terms_notes}"</p>
          )}
        </div>

        <div className="ml-6 flex flex-col items-end gap-3 shrink-0">
          <div className="text-right">
            <p className="text-xl font-semibold text-gray-900">{fmt(po.total_amount)}</p>
            <p className="text-xs text-gray-400">PO total</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onReject}
              className="px-3 py-1.5 text-sm border border-red-200 rounded-lg hover:bg-red-50 text-red-600"
            >
              Reject
            </button>
            <button
              onClick={onApprove}
              className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
            >
              Approve →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApproveModal({ po, onConfirm, onClose, fmt }) {
  const [amount, setAmount] = useState(po.total_amount);
  const [notes, setNotes] = useState('');
  const [termsType, setTermsType] = useState(po.payment_terms_type || '');
  const [termsDue, setTermsDue] = useState(po.payment_due_date || '');
  const [termsNotes, setTermsNotes] = useState(po.payment_terms_notes || '');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await onConfirm(po, amount, notes, {
        payment_terms_type: termsType || undefined,
        payment_due_date: termsDue || undefined,
        payment_terms_notes: termsNotes || undefined,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Approve PO for Payment</h2>
        <p className="text-sm text-gray-500 mb-5">
          {po.cps_po_ref} — {po.supplier_name}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Approved Amount <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                max={po.total_amount}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">PO total: {fmt(po.total_amount)}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Terms
              {!po.payment_terms_type && (
                <span className="ml-2 text-xs text-amber-600">not set — add here</span>
              )}
            </label>
            <input
              type="text"
              value={termsType}
              onChange={e => setTermsType(e.target.value)}
              placeholder="e.g. 30 days net, 50% advance..."
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Due Date</label>
            <input
              type="date"
              value={termsDue}
              onChange={e => setTermsDue(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes for Finance</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any special instructions for Finance team..."
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
            className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Approving...' : 'Approve & Forward to Finance'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ po, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setLoading(true);
    try {
      await onConfirm(po, reason);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Reject PO</h2>
        <p className="text-sm text-gray-500 mb-5">{po.cps_po_ref} — {po.supplier_name}</p>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reason for rejection <span className="text-red-500">*</span>
        </label>
        <textarea
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="State the reason clearly..."
          className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !reason.trim()}
            className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Rejecting...' : 'Reject PO'}
          </button>
        </div>
      </div>
    </div>
  );
}
