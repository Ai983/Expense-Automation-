// Renders the server-built `amount_trail` of an imprest: what the employee asked
// for, every change along the approval chain with who and why, and the final
// approved and paid figures.

const STAGE_LABEL = {
  s2: 'S2 — Ritu',
  director: 'Director',
  unrecorded: 'Before Finance review',
  finance: 'Finance',
  founder: 'Founder — Dhruv',
  payment: 'Finance at payment',
};

function fmt(n) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null;
}

export function amountWasChanged(req) {
  return (req.amount_trail?.steps?.length || 0) > 0;
}

export default function AmountTrail({ req, compact = false }) {
  const trail = req?.amount_trail;
  if (!trail) return null;
  const { steps = [], requested, final_approved, paid, old_balance_adjusted } = trail;

  return (
    <div className={compact ? 'text-xs space-y-1.5' : 'text-sm space-y-2'}>
      <div className="flex justify-between gap-3">
        <span className="text-gray-500">Employee requested</span>
        <span className="font-semibold text-gray-900">{fmt(requested)}</span>
      </div>

      {steps.map((s, i) => {
        const up = s.amount > s.from;
        return (
          <div key={i} className={`rounded-lg px-2.5 py-1.5 border ${up ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className="flex justify-between gap-3">
              <span className="font-semibold text-gray-800">
                {up ? '▲' : '▼'} {STAGE_LABEL[s.stage] || s.stage}
                {fmtDate(s.at) && <span className="font-normal text-gray-400"> · {fmtDate(s.at)}</span>}
              </span>
              <span className="whitespace-nowrap">
                <span className="text-gray-400 line-through mr-1.5">{fmt(s.from)}</span>
                <span className={`font-bold ${up ? 'text-amber-700' : 'text-blue-700'}`}>{fmt(s.amount)}</span>
              </span>
            </div>
            {s.reason ? (
              <p className="text-gray-700 mt-0.5"><span className="font-medium">Reason:</span> {s.reason}</p>
            ) : s.note ? (
              <p className="text-gray-600 italic mt-0.5">"{s.note}"</p>
            ) : (
              <p className="text-gray-400 italic mt-0.5">No reason recorded</p>
            )}
          </div>
        );
      })}

      {final_approved != null && (
        <div className="flex justify-between gap-3 pt-1 border-t border-gray-200">
          <span className="text-gray-500">Final approved</span>
          <span className="font-bold text-green-700">{fmt(final_approved)}</span>
        </div>
      )}
      {paid != null && (
        <div className="flex justify-between gap-3">
          <span className="text-gray-500">Paid — employee files expenses for</span>
          <span className="font-bold text-green-700">{fmt(paid)}</span>
        </div>
      )}
      {old_balance_adjusted > 0 && (
        <p className="text-orange-600">{fmt(old_balance_adjusted)} adjusted against the employee's earlier unspent balance.</p>
      )}
    </div>
  );
}
