const LABELS = {
  pending: 'Pending',
  verified: 'Auto-Verified',
  manual_review: 'Manual Review',
  approved: 'Approved',
  rejected: 'Rejected',
  blocked: 'Blocked',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`status-${status} text-xs font-semibold px-2.5 py-1 rounded-full inline-block`}>
      {LABELS[status] || status}
    </span>
  );
}
