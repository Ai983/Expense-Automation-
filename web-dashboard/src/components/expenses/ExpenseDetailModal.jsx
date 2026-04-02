import { useState, useEffect } from 'react';
import { getExpenseDetails, approveExpense, rejectExpense } from '../../services/expenseService';
import { showToast } from '../layout/Toast';
import StatusBadge from './StatusBadge';

export default function ExpenseDetailModal({ expenseId, onClose, onAction }) {
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    getExpenseDetails(expenseId)
      .then(setExpense)
      .catch(() => showToast('Failed to load expense details', 'error'))
      .finally(() => setLoading(false));
  }, [expenseId]);

  async function handleApprove() {
    setActing(true);
    try {
      await approveExpense(expenseId);
      showToast('Expense approved', 'success');
      onAction?.('approved');
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Approval failed', 'error');
    } finally {
      setActing(false);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return showToast('Enter rejection reason', 'warning');
    setActing(true);
    try {
      await rejectExpense(expenseId, rejectReason);
      showToast('Expense rejected', 'info');
      onAction?.('rejected');
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Rejection failed', 'error');
    } finally {
      setActing(false);
    }
  }

  const meta = expense?.screenshot_metadata || {};
  const canAct = expense && ['pending', 'verified', 'manual_review'].includes(expense.status);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {loading ? '...' : expense?.ref_id}
            </h2>
            {!loading && <StatusBadge status={expense?.status} />}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading...</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Employee', expense.employee?.name],
                ['Site', expense.site],
                ['Amount', `₹${Number(expense.amount).toLocaleString('en-IN')}`],
                ['Category', expense.category],
                ['Submitted', new Date(expense.submitted_at).toLocaleString()],
                ['Description', expense.description || '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-gray-500 text-xs">{label}</p>
                  <p className="font-medium text-gray-900 mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            {/* Duplicate warnings */}
            {expense.duplicate_flag && meta.duplicateWarnings?.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-orange-800 mb-1">⚠ Duplicate Warning</p>
                {meta.duplicateWarnings.map((w, i) => (
                  <p key={i} className="text-xs text-orange-700">{w}</p>
                ))}
              </div>
            )}

            {/* OCR / AI Verification Data */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">AI Verification</h3>
              {meta.attachmentType === 'pdf' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-3 text-xs text-blue-800">
                  📄 <strong>PDF attachment</strong> — Standard payment receipt checks (transaction ID, payment status) do not apply to document uploads. Finance review required.
                </div>
              )}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                <Row label="Confidence" value={`${meta.confidence || 0}%`} highlight={meta.attachmentType === 'pdf' ? null : meta.confidence >= 94 ? 'green' : meta.confidence >= 70 ? 'orange' : 'red'} />
                <Row label="Transaction ID" value={meta.transactionId || '—'} />
                <Row label="Extracted Amount" value={meta.extractedAmount ? `₹${meta.extractedAmount}` : '—'} />
                <Row label="Receipt Date" value={meta.date || '—'} />
                <Row label="Payment Status" value={meta.paymentStatus || '—'} highlight={meta.paymentStatus === 'SUCCESS' ? 'green' : meta.paymentStatus === 'FAILED' ? 'red' : null} />
              </div>
            </div>

            {/* Verification Checks */}
            {expense.verification_logs?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Verification Checks</h3>
                <div className="space-y-1.5">
                  {expense.verification_logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 text-xs">
                      <span className={`mt-0.5 w-4 text-center ${log.result === 'pass' ? 'text-green-600' : log.result === 'fail' ? 'text-red-600' : log.result === 'block' ? 'text-red-800' : 'text-orange-500'}`}>
                        {log.result === 'pass' ? '✓' : log.result === 'fail' || log.result === 'block' ? '✗' : '⚠'}
                      </span>
                      <div>
                        <span className="font-medium text-gray-700">{log.step.replace(/_/g, ' ')}</span>
                        {log.details?.detail && <span className="text-gray-500"> — {log.details.detail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attachment — screenshot or PDF */}
            {expense.screenshotSignedUrl && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {meta.attachmentType === 'pdf' ? 'PDF Attachment' : 'Payment Screenshot'}
                </h3>
                {meta.attachmentType === 'pdf' ? (
                  <a
                    href={expense.screenshotSignedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 hover:bg-blue-100 transition text-blue-700 font-medium text-sm"
                  >
                    <span className="text-2xl">📄</span>
                    <span>Open PDF Document</span>
                  </a>
                ) : (
                  <>
                    <a href={expense.screenshotSignedUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={expense.screenshotSignedUrl}
                        alt="Payment screenshot"
                        className="rounded-lg border max-h-80 object-contain cursor-pointer hover:opacity-90 transition"
                      />
                    </a>
                    <p className="text-xs text-gray-400 mt-1">Click to open full size</p>
                  </>
                )}
              </div>
            )}

            {/* Rejection reason */}
            {expense.status === 'rejected' && expense.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-red-800">Rejection Reason</p>
                <p className="text-sm text-red-700 mt-1">{expense.rejection_reason}</p>
              </div>
            )}

            {/* Actions */}
            {canAct && (
              <div className="border-t pt-5 space-y-3">
                {!rejecting ? (
                  <div className="flex gap-3">
                    <button className="btn-primary flex-1" disabled={acting} onClick={handleApprove}>
                      {acting ? 'Processing...' : '✓ Approve'}
                    </button>
                    <button className="btn-danger flex-1" disabled={acting} onClick={() => setRejecting(true)}>
                      ✗ Reject
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <textarea
                      className="input h-20 resize-none"
                      placeholder="Enter rejection reason..."
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="flex gap-3">
                      <button className="btn-danger flex-1" disabled={acting} onClick={handleReject}>
                        Confirm Reject
                      </button>
                      <button className="btn-secondary flex-1" onClick={() => setRejecting(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, highlight }) {
  const colour = highlight === 'green' ? 'text-green-700 font-semibold'
    : highlight === 'red' ? 'text-red-700 font-semibold'
    : highlight === 'orange' ? 'text-orange-700 font-semibold'
    : 'text-gray-800';
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={colour}>{value}</span>
    </div>
  );
}
