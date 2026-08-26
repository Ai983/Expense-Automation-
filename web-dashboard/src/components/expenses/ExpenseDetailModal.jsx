import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getExpenseDetails, approveExpense, rejectExpense } from '../../services/expenseService';
import { showToast } from '../layout/Toast';
import StatusBadge from './StatusBadge';

export default function ExpenseDetailModal({ expenseId, onClose, onAction }) {
  const [expense, setExpense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);
  const [adjustedAmount, setAdjustedAmount] = useState('');

  useEffect(() => {
    getExpenseDetails(expenseId)
      .then(setExpense)
      .catch(() => showToast('Failed to load expense details', 'error'))
      .finally(() => setLoading(false));
  }, [expenseId]);

  async function handleApprove(source, amountOverride) {
    setActing(true);
    try {
      // amountOverride is passed explicitly by the AI one-click path: a
      // setState above would not have applied by the time we read state here.
      const adj = amountOverride != null
        ? amountOverride
        : adjustedAmount.trim() ? parseFloat(adjustedAmount) : null;
      await approveExpense(expenseId, adj, source);
      showToast('Expense approved', 'success');
      onAction?.('approved');
      onClose();
    } catch (err) {
      showToast(err.response?.data?.error || 'Approval failed', 'error');
    } finally {
      setActing(false);
    }
  }

  /**
   * One-click handling of the AI's recommendation.
   * An approve recommendation is applied directly (with the AI's suggested
   * amount when it proposed one). A reject recommendation deliberately does
   * NOT reject — it opens the reject form with the AI's reason pre-filled so a
   * human still makes and confirms that call.
   */
  function acceptAiRecommendation() {
    const ai = expense?.ai_audit || {};
    if (expense?.ai_verdict === 'approve') {
      const suggested = ai.suggested_adjusted_amount;
      if (suggested != null) setAdjustedAmount(String(suggested));
      handleApprove('ai_recommendation', suggested != null ? Number(suggested) : null);
      return;
    }
    setRejectReason(ai.rejection_reason_draft || ai.reasoning || '');
    setRejecting(true);
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

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const meta = expense?.screenshot_metadata || {};
  const canAct = expense && ['pending', 'verified', 'manual_review', 'blocked'].includes(expense.status);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'rgba(0,0,0,0.6)' }}
      className="modal-overlay" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto modal-content"
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

            {/* AI Auditor — the review that replaced the manual expense check */}
            {expense.ai_verdict && <AiAuditPanel expense={expense} />}

            {/* OCR / AI Verification Data */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">OCR Extraction</h3>
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

            {/* Attachments — one or more screenshots/PDFs */}
            {(expense.allScreenshotUrls?.length > 0 || expense.screenshotSignedUrl) && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  {meta.screenshotCount > 1
                    ? `Payment Proofs (${meta.screenshotCount} attachments)`
                    : meta.attachmentType === 'pdf' ? 'PDF Attachment' : 'Payment Screenshot'}
                </h3>
                {meta.totalExtractedAmount > 0 && meta.screenshotCount > 1 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3 text-xs text-blue-800">
                    Total extracted from {meta.screenshotCount} screenshots: <strong>₹{Number(meta.totalExtractedAmount).toLocaleString('en-IN')}</strong>
                    {meta.allOcrResults?.map((ocr, i) => (
                      <span key={i} className="ml-2 text-blue-600">
                        #{i + 1}: ₹{Number(ocr.extractedAmount || 0).toLocaleString('en-IN')}
                      </span>
                    ))}
                  </div>
                )}
                <div className={`${(expense.allScreenshotUrls?.length || 0) > 1 ? 'grid grid-cols-2 gap-3' : ''}`}>
                  {(expense.allScreenshotUrls || [expense.screenshotSignedUrl]).map((url, i) => (
                    <div key={i} className="relative">
                      {!url ? (
                        <div className="flex items-center justify-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-4 py-6 text-gray-400 text-xs">
                          <span>🖼️</span>
                          <span>Screenshot {(expense.allScreenshotUrls?.length || 0) > 1 ? `#${i + 1} ` : ''}not available — may be stored in legacy system</span>
                        </div>
                      ) : meta.attachmentType === 'pdf' ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 hover:bg-blue-100 transition text-blue-700 font-medium text-sm">
                          <span className="text-2xl">📄</span>
                          <span>Open PDF {(expense.allScreenshotUrls?.length || 0) > 1 ? `#${i + 1}` : ''}</span>
                        </a>
                      ) : (
                        <a href={url} target="_blank" rel="noopener noreferrer" title="Click to open full size">
                          <img src={url} alt={`Screenshot ${i + 1}`}
                            className="rounded-lg border max-h-60 w-full object-contain cursor-pointer hover:opacity-90 transition"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                          <div style={{ display: 'none' }}
                            className="flex items-center justify-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-4 py-6 text-gray-400 text-xs">
                            <span>🖼️</span><span>Screenshot {i + 1} could not load</span>
                          </div>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                {(expense.allScreenshotUrls || []).some(Boolean) && (
                  <p className="text-xs text-gray-400 mt-1">Click image to open full size</p>
                )}
              </div>
            )}

            {/* Blocked info — accounts can still approve/reject */}
            {expense.status === 'blocked' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-red-800">Blocked by AI Verification</p>
                <p className="text-sm text-red-700 mt-1">
                  This expense was auto-blocked due to low verification confidence or duplicate detection.
                  Review the verification checks above and approve or reject as appropriate.
                </p>
                {meta.duplicateWarnings?.length > 0 && (
                  <p className="text-xs text-red-600 mt-2">
                    Duplicate warnings: {meta.duplicateWarnings.join('; ')}
                  </p>
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
                {/* Accept the AI's recommendation in one click. For a reject
                    recommendation this only opens the reject form pre-filled —
                    a human still confirms. */}
                {['approve', 'reject', 'needs_human'].includes(expense.ai_verdict) && !rejecting && (
                  <button
                    className="w-full px-4 py-2.5 rounded-lg font-semibold text-sm bg-indigo-600 hover:bg-indigo-700 text-white transition disabled:opacity-50"
                    disabled={acting}
                    onClick={acceptAiRecommendation}
                  >
                    {expense.ai_verdict === 'approve'
                      ? `🤖 Accept AI recommendation — Approve${
                          expense.ai_audit?.suggested_adjusted_amount != null
                            ? ` ₹${Number(expense.ai_audit.suggested_adjusted_amount).toLocaleString('en-IN')}`
                            : ''
                        }`
                      : '🤖 Use AI reasoning to reject (you confirm)'}
                  </button>
                )}

                {/* Amount Adjustment */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <label className="block text-sm font-semibold text-amber-800 mb-2">
                    Adjust Amount (if different from claimed)
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">Claimed: ₹{Number(expense.amount).toLocaleString('en-IN')}</span>
                    {meta.extractedAmount && Number(meta.extractedAmount) !== Number(expense.amount) && (
                      <span className="text-sm text-red-600 font-medium">OCR: ₹{Number(meta.extractedAmount).toLocaleString('en-IN')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-gray-500 font-medium">₹</span>
                    <input
                      type="number"
                      className="input flex-1"
                      placeholder={`${expense.amount} (leave blank to keep original)`}
                      value={adjustedAmount}
                      onChange={(e) => setAdjustedAmount(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                    {meta.extractedAmount && (
                      <button
                        type="button"
                        className="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded transition"
                        onClick={() => setAdjustedAmount(String(meta.extractedAmount))}
                      >
                        Use OCR amount
                      </button>
                    )}
                  </div>
                  {adjustedAmount.trim() && (
                    <p className="text-xs text-amber-700 mt-1">
                      Will approve with ₹{Number(adjustedAmount).toLocaleString('en-IN')} instead of ₹{Number(expense.amount).toLocaleString('en-IN')}
                    </p>
                  )}
                </div>

                {!rejecting ? (
                  <div className="flex gap-3">
                    <button className="btn-primary flex-1" disabled={acting} onClick={() => handleApprove()}>
                      {acting ? 'Processing...' : adjustedAmount.trim() ? `✓ Approve ₹${Number(adjustedAmount).toLocaleString('en-IN')}` : '✓ Approve'}
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
    </div>,
    document.body
  );
}

export const AI_VERDICT_STYLES = {
  approve: { label: 'Approve', chip: 'bg-green-100 text-green-800', box: 'bg-green-50 border-green-200', icon: '✓' },
  needs_human: { label: 'Needs Human Review', chip: 'bg-amber-100 text-amber-800', box: 'bg-amber-50 border-amber-200', icon: '⚠' },
  reject: { label: 'Reject Recommended', chip: 'bg-red-100 text-red-800', box: 'bg-red-50 border-red-200', icon: '✗' },
  error: { label: 'Audit Failed', chip: 'bg-gray-200 text-gray-700', box: 'bg-gray-50 border-gray-200', icon: '—' },
};

function AiAuditPanel({ expense }) {
  const ai = expense.ai_audit || {};
  const style = AI_VERDICT_STYLES[expense.ai_verdict] || AI_VERDICT_STYLES.error;
  const signals = Array.isArray(ai.fraud_signals) ? ai.fraud_signals : [];

  return (
    <div className={`border rounded-lg p-4 ${style.box}`}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-gray-800">🤖 AI Auditor</h3>
        <div className="flex items-center gap-2">
          {expense.ai_auto_approved && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
              Auto-approved
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${style.chip}`}>
            {style.icon} {style.label}
          </span>
          {expense.ai_confidence != null && (
            <span className="text-xs text-gray-600">{expense.ai_confidence}% confident</span>
          )}
        </div>
      </div>

      {expense.ai_verdict === 'error' ? (
        <p className="text-sm text-gray-600">
          The AI could not audit this expense{ai.error ? ` (${ai.error})` : ''}. Review it manually — it will be retried automatically.
        </p>
      ) : (
        <>
          {ai.reasoning && <p className="text-sm text-gray-800 leading-relaxed">{ai.reasoning}</p>}

          {signals.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-red-800 mb-1">Concerns raised</p>
              <div className="flex flex-wrap gap-1.5">
                {signals.map((s, i) => (
                  <span key={i} className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-800 border border-red-200">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
            {[
              ['Category', ai.category_match],
              ['Purpose', ai.purpose_match],
              ['Attachment', ai.attachment_quality?.replace(/_/g, ' ')],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} className="bg-white/70 rounded px-2 py-1 border border-gray-200">
                <span className="text-gray-500">{label}: </span>
                <span className="font-medium text-gray-800">{value}</span>
              </div>
            ))}
          </div>

          {ai.suggested_adjusted_amount != null && (
            <p className="text-sm text-amber-900 mt-3 bg-amber-100 border border-amber-200 rounded px-3 py-2">
              Receipt only supports <strong>₹{Number(ai.suggested_adjusted_amount).toLocaleString('en-IN')}</strong> of
              the ₹{Number(expense.amount).toLocaleString('en-IN')} claimed.
            </p>
          )}

          {ai.reconciliation_note && (
            <p className="text-xs text-gray-700 mt-2 italic">{ai.reconciliation_note}</p>
          )}

          {ai.rejection_reason_draft && (
            <p className="text-xs text-gray-600 mt-2">
              Suggested reason: <strong>{ai.rejection_reason_draft}</strong>
            </p>
          )}
        </>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        {expense.ai_model}
        {expense.ai_audited_at ? ` · ${new Date(expense.ai_audited_at).toLocaleString()}` : ''}
        {' · the AI never rejects on its own — a person confirms every rejection'}
      </p>
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
