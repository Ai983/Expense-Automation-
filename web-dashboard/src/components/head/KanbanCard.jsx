import { useState } from 'react';
import api from '../../services/api';
import AgingPill from './AgingPill';

function ResendIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

const STUCK_ON = {
  s1_pending:       'Avisha (Stage 1)',
  s3_pending:       'Finance team',
  s3_approved:      'Finance — payment pending',
  pending:          'Finance review',
  manual_review:    'Finance review (manual)',
  verified:         'Finance final approval',
  pending_procurement: 'Procurement Finance',
  pending_payment:  'Finance — PO payment',
};

function stuckOnLabel(item, stream) {
  if (stream === 'imprest') {
    if (item.current_stage === 's2_pending') return "Ritu Ma'am (Stage 2)";
    if (item.current_stage === 'director_pending') return 'Bhaskar Sir (Director WhatsApp)';
    if (item.current_stage === 'founder_review_pending') return 'Dhruv Sir (Founder WhatsApp)';
    return STUCK_ON[item.current_stage] || item.current_stage;
  }
  if (stream === 'expense') return STUCK_ON[item.status] || item.status;
  if (stream === 'po') return STUCK_ON[item.status] || item.status;
  return '—';
}

function stageTimestamp(item, stream) {
  if (stream === 'imprest') {
    const s = item.current_stage;
    if (s === 's1_pending') return item.submitted_at;
    if (s === 's2_pending') return item.s1_approved_at || item.submitted_at;
    if (s === 'director_pending') return item.s1_approved_at || item.submitted_at;
    if (s === 's3_pending') return item.s2_approved_at || item.director_approved_at || item.submitted_at;
    if (s === 'founder_review_pending') return item.approved_at || item.submitted_at;
    if (s === 's3_approved') return item.approved_at || item.submitted_at;
    return item.submitted_at;
  }
  if (stream === 'po') {
    if (item.status === 'pending_payment') return item.procurement_approved_at || item.created_at;
    return item.created_at;
  }
  return item.submitted_at;
}

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function KanbanCard({ item, stream, onClick }) {
  const stageAt = stageTimestamp(item, stream);
  const ref = item.ref_id || item.cps_po_ref || item.id?.slice(0, 8);
  const name = item.employee_name || item.supplier_name || item.employee?.name || '—';
  const site = item.site || item.project_name || '—';
  const amount = stream === 'po' ? item.total_amount : (item.amount_requested || item.amount);
  const isDirectorPending = stream === 'imprest' && item.current_stage === 'director_pending';

  const [resending, setResending] = useState(false);
  const [resendDone, setResendDone] = useState(false);

  const handleResend = async (e) => {
    e.stopPropagation();
    if (resending) return;
    setResending(true);
    try {
      await api.post(`/api/imprest/${item.id}/resend-director`);
      setResendDone(true);
      setTimeout(() => setResendDone(false), 3000);
    } catch {
      // silently fail — toast not available here
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      onClick={() => onClick && onClick(item)}
      className="bg-white border border-gray-200 rounded-lg p-3 mb-2 cursor-pointer hover:shadow-md hover:border-brand-400 transition-all text-sm"
    >
      <div className="flex justify-between items-start mb-1">
        <span className="font-bold text-brand-600 text-xs">{ref}</span>
        <AgingPill submittedAt={item.submitted_at} stageAt={stageAt} />
      </div>
      <p className="font-medium text-gray-800 truncate">{name} · {site}</p>
      <p className="text-gray-500 text-xs truncate">{item.category || '—'}</p>
      <p className="font-bold text-gray-900 mt-1">{fmt(amount)}</p>
      {stream === 'imprest' && item.director_note && (
        <p className="text-[11px] text-orange-600 mt-1 italic truncate" title={item.director_note}>Director: "{item.director_note}"</p>
      )}
      <p className="text-gray-400 text-xs mt-1 truncate">
        Awaiting: {stuckOnLabel(item, stream)}
      </p>
      {isDirectorPending && (
        <button
          onClick={handleResend}
          disabled={resending}
          title="Resend WhatsApp approval request to Director (Bhaskar Sir)"
          className={`mt-2 w-full inline-flex items-center justify-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md transition-all active:scale-95 disabled:opacity-60 ${
            resendDone
              ? 'bg-green-100 text-green-700 border border-green-300'
              : 'bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-200'
          }`}
        >
          {resending ? (
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <ResendIcon />
          )}
          {resendDone ? 'Sent ✓' : resending ? 'Sending…' : 'Resend to Director'}
        </button>
      )}
    </div>
  );
}
