// web-dashboard/src/pages/ProcurementQueuePage.jsx
// Stage-1 Procurement Finance: review pending POs, track forwarded POs, see paid POs
import { useState, useEffect, useMemo } from 'react';
import api from '../services/api';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin h-4 w-4 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
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

// Status badge for forwarded/paid tabs
function StatusBadge({ status }) {
  const map = {
    pending_procurement: ['bg-amber-100 text-amber-700', 'Pending Review'],
    pending_payment: ['bg-blue-100 text-blue-700', 'In Finance Queue'],
    partially_paid: ['bg-indigo-100 text-indigo-700', 'Partially Paid'],
    paid: ['bg-green-100 text-green-700', 'Paid'],
    payment_rejected: ['bg-red-100 text-red-700', 'Rejected'],
  };
  const [cls, label] = map[status] || ['bg-gray-100 text-gray-700', status];
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

// Payment progress bar — shows paid / approved amount
function PaymentProgress({ paid, approved, total }) {
  const approvedAmt = Number(approved || total || 0);
  const paidAmt = Number(paid || 0);
  const pct = approvedAmt > 0 ? Math.min(100, Math.round((paidAmt / approvedAmt) * 100)) : 0;
  const isFull = pct >= 100;
  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-600">
          Payment Progress
        </span>
        <span className={`text-xs font-bold ${isFull ? 'text-green-700' : 'text-blue-700'}`}>
          {fmt(paidAmt)} <span className="text-gray-400 font-normal">of {fmt(approvedAmt)}</span>
          <span className="ml-2 text-gray-500">({pct}%)</span>
        </span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            isFull ? 'bg-green-500' : 'bg-gradient-to-r from-blue-400 to-indigo-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Procurement → Finance → Paid stepper for forwarded/paid POs
function PoPipeline({ status }) {
  const stages = [
    { label: 'Procurement', sub: 'You ✓', state: 'done' },
    {
      label: 'Finance',
      sub: 'Portal',
      state: status === 'pending_payment' ? 'active' :
             (status === 'partially_paid' || status === 'paid') ? 'done' : 'upcoming',
    },
    {
      label: 'Paid',
      sub: '',
      state: status === 'paid' ? 'done' :
             status === 'partially_paid' ? 'active' : 'upcoming',
    },
  ];
  return (
    <div className="flex items-center gap-1">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              title={`${s.label}${s.sub ? ' (' + s.sub + ')' : ''}`}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                s.state === 'done'
                  ? 'bg-green-500 text-white ring-2 ring-green-200'
                  : s.state === 'active'
                  ? 'bg-blue-500 text-white ring-2 ring-blue-200 animate-pulse'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {s.state === 'done' ? '✓' : i + 1}
            </div>
            <span className="text-[10px] text-gray-500 mt-0.5">{s.label}</span>
          </div>
          {i < stages.length - 1 && (
            <div className={`w-6 h-0.5 mx-0.5 mb-4 ${s.state === 'done' ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

const TABS = [
  { id: 'pending', label: 'Pending Review', statuses: ['pending_procurement'] },
  { id: 'forwarded', label: 'Forwarded to Finance', statuses: ['pending_payment', 'partially_paid'] },
  { id: 'paid', label: 'Paid', statuses: ['paid'] },
];

export default function ProcurementQueuePage() {
  const [allPOs, setAllPOs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pending');
  const [actionModal, setActionModal] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      // /all returns every PO; we'll filter client-side by tab
      const { data } = await api.get('/api/po-payments/all');
      setAllPOs(Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []));
    } catch {
      // Fallback: try the per-stage queues if /all is not authorized
      try {
        const [procurement, finance] = await Promise.all([
          api.get('/api/po-payments/procurement-queue').catch(() => ({ data: [] })),
          api.get('/api/po-payments/finance-queue').catch(() => ({ data: [] })),
        ]);
        const procData = Array.isArray(procurement.data?.data) ? procurement.data.data : (procurement.data || []);
        const finData = Array.isArray(finance.data?.data) ? finance.data.data : (finance.data || []);
        setAllPOs([...procData, ...finData]);
      } catch {
        setAllPOs([]);
      }
    } finally {
      setLoading(false);
    }
  }

  const filteredPOs = useMemo(() => {
    const tab = TABS.find(t => t.id === activeTab);
    return allPOs.filter(po => tab.statuses.includes(po.status));
  }, [allPOs, activeTab]);

  const counts = useMemo(() => {
    const result = {};
    TABS.forEach(t => {
      result[t.id] = allPOs.filter(po => t.statuses.includes(po.status)).length;
    });
    return result;
  }, [allPOs]);

  async function handleApprove(po, approvedAmount, notes, correctedTerms) {
    await api.post(`/api/po-payments/${po.id}/procurement-approve`, {
      approved_amount: approvedAmount,
      notes,
      ...correctedTerms,
    });
    await loadAll();
    setActionModal(null);
  }

  async function handleReject(po, reason) {
    await api.post(`/api/po-payments/${po.id}/procurement-reject`, { reason });
    await loadAll();
    setActionModal(null);
  }

  // Stats for current tab
  const stats = useMemo(() => {
    const totalValue = filteredPOs.reduce((s, p) => s + Number(p.total_amount || 0), 0);
    const paidValue = filteredPOs.reduce((s, p) => s + Number(p.paid_amount || 0), 0);
    return { count: filteredPOs.length, totalValue, paidValue };
  }, [filteredPOs]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Procurement Payments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review Director-approved POs and track them through Finance to payment
          </p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-60 flex items-center gap-2"
        >
          {loading && <Spinner />}
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-amber-700 bg-amber-50/40'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center gap-2">
                {tab.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600'
                }`}>
                  {loading ? '—' : counts[tab.id]}
                </span>
              </span>
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
              )}
            </button>
          ))}
        </div>

        {/* Stats row inside tab */}
        <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50/30">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              {activeTab === 'pending' ? 'Pending Review' : activeTab === 'forwarded' ? 'In Finance Queue' : 'Paid POs'}
            </p>
            <p className="text-xl font-semibold mt-0.5">{loading ? '—' : stats.count}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Value</p>
            <p className="text-xl font-semibold mt-0.5">{loading ? '—' : fmt(stats.totalValue)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              {activeTab === 'paid' ? 'Amount Paid' : activeTab === 'forwarded' ? 'Paid So Far' : 'AI Terms Extracted'}
            </p>
            <p className="text-xl font-semibold mt-0.5">
              {loading ? '—' : (
                activeTab === 'pending'
                  ? <>
                      {filteredPOs.filter(p => p.payment_terms_source === 'ai_extracted').length}
                      <span className="text-sm font-normal text-gray-400 ml-1">/ {stats.count}</span>
                    </>
                  : fmt(stats.paidValue)
              )}
            </p>
          </div>
        </div>
      </div>

      {/* PO Cards */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="animate-pulse space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-gray-200 rounded w-1/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                    <div className="h-3 bg-gray-100 rounded w-1/4" />
                  </div>
                  <div className="h-8 bg-gray-200 rounded w-24" />
                </div>
                <div className="h-2 bg-gray-100 rounded-full w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredPOs.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-4xl mb-2">
            {activeTab === 'pending' ? '📋' : activeTab === 'forwarded' ? '⏳' : '✅'}
          </div>
          <p className="text-lg">
            {activeTab === 'pending' && 'No POs pending procurement review'}
            {activeTab === 'forwarded' && 'No POs currently in the finance queue'}
            {activeTab === 'paid' && 'No paid POs yet'}
          </p>
          <p className="text-sm mt-1">
            {activeTab === 'pending' && 'Approved POs from CPS will appear here automatically'}
            {activeTab === 'forwarded' && 'POs you forward will appear here until paid'}
            {activeTab === 'paid' && 'Completed payments will appear here'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPOs.map(po => (
            <POCard
              key={po.id}
              po={po}
              tab={activeTab}
              onApprove={() => setActionModal({ type: 'approve', po })}
              onReject={() => setActionModal({ type: 'reject', po })}
            />
          ))}
        </div>
      )}

      {actionModal?.type === 'approve' && (
        <ApproveModal
          po={actionModal.po}
          onConfirm={handleApprove}
          onClose={() => setActionModal(null)}
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

function POCard({ po, tab, onApprove, onReject }) {
  const isDueSoon = po.payment_due_date &&
    new Date(po.payment_due_date) < new Date(Date.now() + 7 * 86400000);
  const isPending = tab === 'pending';
  const showProgress = tab === 'forwarded' || tab === 'paid';

  return (
    <div className={`bg-white rounded-xl border p-5 hover:shadow-md transition-all duration-200
      ${isDueSoon && isPending ? 'border-amber-200' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm font-medium text-gray-900">{po.cps_po_ref}</span>
            <span className="text-sm text-gray-500">·</span>
            <span className="text-sm font-medium text-gray-700">{po.project_name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{po.site}</span>
            {!isPending && <StatusBadge status={po.status} />}
            {isDueSoon && isPending && (
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

          {/* Pending tab: terms info */}
          {isPending && (
            <div className="mt-3 flex items-start gap-2 flex-wrap">
              {po.payment_terms_type ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 font-medium">Terms:</span>
                    <span className="text-sm text-gray-600">{po.payment_terms_type}</span>
                  </div>
                  <TermsBadge source={po.payment_terms_source} confidence={po.payment_terms_confidence} />
                </>
              ) : (
                <span className="text-sm text-amber-600">
                  ⚠ No payment terms — you can add them when approving
                </span>
              )}
            </div>
          )}

          {/* Forwarded/Paid tabs: pipeline + meta */}
          {!isPending && (
            <div className="mt-3 flex items-center gap-6 flex-wrap">
              <PoPipeline status={po.status} />
              {po.procurement_approved_at && (
                <div className="text-xs text-gray-500">
                  Forwarded: <span className="font-medium text-gray-700">{fmtDate(po.procurement_approved_at)}</span>
                </div>
              )}
              {po.paid_at && (
                <div className="text-xs text-gray-500">
                  Paid: <span className="font-medium text-gray-700">{fmtDate(po.paid_at)}</span>
                </div>
              )}
            </div>
          )}

          {po.payment_terms_notes && isPending && (
            <p className="mt-1 text-xs text-gray-500 italic">"{po.payment_terms_notes}"</p>
          )}
        </div>

        <div className="ml-6 flex flex-col items-end gap-3 shrink-0">
          <div className="text-right">
            <p className="text-xl font-semibold text-gray-900">{fmt(po.total_amount)}</p>
            <p className="text-xs text-gray-400">PO total</p>
            {!isPending && po.procurement_approved_amount && Number(po.procurement_approved_amount) !== Number(po.total_amount) && (
              <p className="text-xs text-blue-600 mt-1">Approved: {fmt(po.procurement_approved_amount)}</p>
            )}
          </div>
          {isPending && (
            <div className="flex gap-2">
              <button
                onClick={onReject}
                className="px-3 py-1.5 text-sm border border-red-200 rounded-lg hover:bg-red-50 active:scale-95 transition-all text-red-600"
              >
                Reject
              </button>
              <button
                onClick={onApprove}
                className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 active:scale-95 transition-all text-white rounded-lg font-medium"
              >
                Approve →
              </button>
            </div>
          )}
        </div>
      </div>

      {showProgress && (
        <PaymentProgress
          paid={po.paid_amount}
          approved={po.procurement_approved_amount}
          total={po.total_amount}
        />
      )}
    </div>
  );
}

function ApproveModal({ po, onConfirm, onClose }) {
  const [amount, setAmount] = useState(po.total_amount);
  const [notes, setNotes] = useState('');
  const [termsType, setTermsType] = useState(po.payment_terms_type || '');
  const [termsDue, setTermsDue] = useState(po.payment_due_date || '');
  const [termsNotes, setTermsNotes] = useState(po.payment_terms_notes || '');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const close = () => { setVisible(false); setTimeout(onClose, 200); };

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
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 p-4 transition-opacity duration-200 ${
        visible ? 'bg-black/40 opacity-100' : 'bg-black/0 opacity-0 pointer-events-none'
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className={`bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
      }`}>
        <h2 className="text-lg font-semibold mb-1">Approve PO for Payment</h2>
        <p className="text-sm text-gray-500 mb-5">{po.cps_po_ref} — {po.supplier_name}</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Approved Amount <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
              <input
                type="number" step="0.01" max={po.total_amount} value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
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
              type="text" value={termsType} onChange={e => setTermsType(e.target.value)}
              placeholder="e.g. 30 days net, 50% advance..."
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Due Date</label>
            <input type="date" value={termsDue} onChange={e => setTermsDue(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes for Finance</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Any special instructions for Finance team..."
              className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-400" />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={close} disabled={loading} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={loading || !amount}
            className="flex-1 py-2 bg-green-600 hover:bg-green-700 active:scale-95 transition-all text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Spinner className="text-white" />}
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
  const [visible, setVisible] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const close = () => { setVisible(false); setTimeout(onClose, 200); };

  async function submit() {
    if (!reason.trim()) return;
    setLoading(true);
    try { await onConfirm(po, reason); } finally { setLoading(false); }
  }

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 p-4 transition-opacity duration-200 ${
        visible ? 'bg-black/40 opacity-100' : 'bg-black/0 opacity-0 pointer-events-none'
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className={`bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
      }`}>
        <h2 className="text-lg font-semibold mb-1">Reject PO</h2>
        <p className="text-sm text-gray-500 mb-5">{po.cps_po_ref} — {po.supplier_name}</p>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reason for rejection <span className="text-red-500">*</span>
        </label>
        <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="State the reason clearly..."
          className="w-full px-3 py-2 border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400" />
        <div className="flex gap-3 mt-4">
          <button onClick={close} disabled={loading} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={loading || !reason.trim()}
            className="flex-1 py-2 bg-red-600 hover:bg-red-700 active:scale-95 transition-all text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Spinner className="text-white" />}
            {loading ? 'Rejecting...' : 'Reject PO'}
          </button>
        </div>
      </div>
    </div>
  );
}
