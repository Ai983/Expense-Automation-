/**
 * How much an employee may file expenses for against one imprest.
 *
 * The rule: the sanctioned amount — except where the founder deliberately
 * released less, in which case it is the cash actually paid.
 *
 * Why not simply `paid_amount`: paid and approved diverge on 150 of 850 paid
 * imprests, and for two opposite reasons that must not be treated alike.
 *
 *  - Founder adjustment (21): the founder chose to release less. IMP-20260810-0005
 *    was approved 9,000 and paid 900. The employee never received the rest and
 *    cannot account for it, so the limit must be the cash. Capping here is right.
 *
 *  - Old-balance deduction (591): the employee was still holding unspent cash
 *    from an earlier advance, so finance handed over only the difference. They
 *    HAVE that money and legitimately spend it on this purpose. Capping at the
 *    cash paid blocked people mid-trip for spending exactly what was approved.
 *
 * An earlier version capped everything at paid_amount, which closed the founder
 * hole but broke the far more common old-balance case.
 *
 * `old_balance_deducted` is deliberately not used: it is a snapshot of what the
 * employee owed at the time, not what came off this payout — it appears on
 * advances that were paid in full, and the same balance can appear against
 * several advances at once. Adding it would let someone claim beyond anything
 * they received.
 *
 * Being permissive here is safe. Under-accounting is caught by the employee's
 * running balance (`employee_total_balance`), which follows them to the next
 * advance and is deducted at payout. This function governs one imprest; that
 * balance governs the person. Squeezing this limit adds review work without
 * adding protection.
 *
 * Known, untouched: the payment path computes `net_approved_amount ||
 * approved_amount`, so a deduction reducing the net to exactly 0 is falsy and
 * the FULL amount is paid. Changing payouts is a finance decision.
 *
 * Single source of truth. The submit gate, the AI auditor, reminder settlement
 * and the employee's remaining-balance display all call this — three
 * hand-written copies of a balance rule is exactly how this repo has drifted
 * before.
 */
export function imprestSpendLimit(imprest) {
  if (!imprest) return 0;

  const approved = parseFloat(imprest.approved_amount ?? imprest.amount_requested ?? 0) || 0;
  const paid = imprest.paid_amount != null ? parseFloat(imprest.paid_amount) : null;

  // Not yet disbursed (submission is refused in this state anyway) — fall back
  // to the approved figure rather than reporting a zero limit.
  if (paid == null || Number.isNaN(paid)) return approved;

  // The founder chose to release less than was sanctioned. That money never
  // reached the employee, so they cannot account for it: the limit is the cash.
  if (imprest.founder_adjusted_amount != null) return paid;

  // Otherwise the sanctioned figure. Where paid < approved without a founder
  // cut, the difference is an old balance the employee was already holding —
  // cash they have and can legitimately spend on this purpose. Capping at
  // paid_amount blocked people mid-trip for spending exactly what was approved
  // (approved 3,700, paid 925 because 2,775 was already in their pocket, then
  // every receipt past 925 flagged).
  //
  // Deliberately NOT `paid + old_balance_deducted`: that column is a snapshot
  // of what the employee owed at the time, not what came off this payout. It
  // is sometimes recorded while the full amount was still paid, and adding it
  // would let someone claim well beyond what they ever received.
  //
  // Nothing is lost by being permissive here. Under-accounting is caught by
  // the employee's running balance (`employee_total_balance`), which follows
  // them to the next advance and is deducted at payout. This limit governs one
  // imprest; that balance governs the person.
  return Math.max(paid, approved);
}

/**
 * How much must be accounted for before an imprest counts as settled.
 *
 * Deliberately NOT the same as the claim limit. The two answer different
 * questions, and using one figure for both is what made this hard to reason
 * about:
 *
 *   imprestSpendLimit()      — how much may they file?      (permissive)
 *   imprestSettlementTarget() — when is the advance closed?  (the cash paid)
 *
 * Settling against the cash handed over is what the system has always done.
 * Raising this bar to the approved amount would retroactively re-open 36
 * already-settled advances (16,166 unaccounted) and block around thirty people
 * who have done nothing new — punishing them for a rule change.
 *
 * Nothing leaks by keeping it here: cash the employee still holds stays on
 * their running balance and is deducted from their next payout. Settlement
 * closes one advance; the balance follows the person.
 */
export function imprestSettlementTarget(imprest) {
  if (!imprest) return 0;
  const paid = imprest.paid_amount != null ? parseFloat(imprest.paid_amount) : null;
  if (paid == null || Number.isNaN(paid)) {
    return parseFloat(imprest.approved_amount ?? imprest.amount_requested ?? 0) || 0;
  }
  return paid;
}

/** Columns these helpers need — keep every select in step with this. */
export const IMPREST_SPEND_LIMIT_COLUMNS =
  'amount_requested, approved_amount, paid_amount, old_balance_deducted, founder_adjusted_amount';
