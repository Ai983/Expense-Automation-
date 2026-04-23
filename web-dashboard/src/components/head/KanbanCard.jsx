import AgingPill from './AgingPill';

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
    if (item.current_stage === 's2_pending') {
      return item.approval_route === 'avisha_director_finance'
        ? 'Bhaskar Sir (WhatsApp)'
        : "Ritu Ma'am (Stage 2)";
    }
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
    if (s === 's3_pending') return item.s2_approved_at || item.submitted_at;
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
  const name = item.employee_name || item.supplier_name || '—';
  const site = item.site || item.project_name || '—';
  const amount = stream === 'po' ? item.total_amount : (item.amount_requested || item.amount);

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
      <p className="text-gray-400 text-xs mt-1 truncate">
        Awaiting: {stuckOnLabel(item, stream)}
      </p>
    </div>
  );
}
