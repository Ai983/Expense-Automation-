/**
 * How much an employee may file expenses for against one imprest.
 *
 * The rule: whatever cash was actually released to them, `paid_amount`. Not
 * what they asked for, and not what was approved on paper.
 *
 * The two diverge often — 150 of 850 paid imprests, a gap of 4.3 lakh:
 *
 *  - Founder adjustment (20): the founder chose to release less. IMP-20260810-0005
 *    was approved for 9,000 and paid 900, yet the old rule let the employee
 *    claim the full 9,000. That was a real hole.
 *
 *  - Old-balance deduction (145): the employee was still holding unspent cash
 *    from an earlier advance, so finance paid only the difference. That older
 *    cash belongs to the imprest that actually disbursed it and must be
 *    accounted for there — counting it again here would double-count it.
 *
 * paid_amount is also the only trustworthy field. The payment path computes
 * `net_approved_amount || approved_amount`, so when a deduction reduces the net
 * to exactly zero, JavaScript treats 0 as falsy and the FULL amount is paid
 * instead. Whatever the intent, paid_amount records what truly left the
 * account, which is what the employee must account for.
 *
 * Single source of truth. The submit gate, the AI auditor, reminder settlement
 * and the employee's remaining-balance display all call this — three
 * hand-written copies of a balance rule is exactly how this repo has drifted
 * before.
 */
export function imprestSpendLimit(imprest) {
  if (!imprest) return 0;

  const paid = imprest.paid_amount != null ? parseFloat(imprest.paid_amount) : null;

  // Not yet disbursed (submission is refused in this state anyway) — fall back
  // to the approved figure rather than reporting a zero limit.
  if (paid == null || Number.isNaN(paid)) {
    return parseFloat(imprest.approved_amount ?? imprest.amount_requested ?? 0) || 0;
  }

  return paid;
}

/** Columns imprestSpendLimit needs — keep every select in step with this. */
export const IMPREST_SPEND_LIMIT_COLUMNS =
  'amount_requested, approved_amount, paid_amount, old_balance_deducted, founder_adjusted_amount';
