/**
 * The amount story of one imprest: what the employee asked for, every change
 * along the approval chain (which stage, to what, and why), and what was
 * finally approved and paid.
 *
 * Built once on the server and attached to API rows as `amount_trail`, so the
 * Finance queue, the Pipeline Board, the Founder's queue and the employee's app
 * all tell the same story instead of each re-deriving it from raw columns.
 *
 * Each step: { stage, amount, from, reason, note, at }
 *   reason — entered specifically to explain the amount change; safe to show the
 *            employee (S2 cut, Finance change, Finance paying a different amount)
 *   note   — the approver's general note for that stage; internal
 */

const num = (v) => (v == null || v === '' ? null : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;
const same = (a, b) => Math.round(a * 100) === Math.round(b * 100);

export function buildAmountTrail(imp) {
  if (!imp) return null;

  const requested = num(imp.original_amount_requested) ?? num(imp.amount_requested);
  const steps = [];
  let current = requested;
  const push = (step) => {
    steps.push({ reason: null, note: null, at: null, ...step, from: current });
    current = step.amount;
  };

  // S2 (Ritu) reduced the request before forwarding.
  const s2 = num(imp.s2_adjusted_amount);
  if (s2 != null) {
    push({ stage: 's2', amount: s2, reason: imp.s2_adjust_reason || null, note: imp.s2_note || imp.s2_notes || null, at: imp.s2_approved_at });
  }

  // Director reduced it (dashboard route only — the WhatsApp YES/NO cannot).
  const dir = num(imp.director_approved_amount);
  if (dir != null && current != null && dir < current && !same(dir, current)) {
    push({ stage: 'director', amount: dir, note: imp.director_note || null, at: imp.director_approved_at });
  }

  // What Finance actually received differs from the recorded steps: a cut made
  // before the trail existed (pre-041 rows), with no reason on file.
  const forwarded = num(imp.amount_requested);
  if (forwarded != null && current != null && !same(forwarded, current)) {
    push({ stage: 'unrecorded', amount: forwarded });
  }

  // Finance approved a different amount — higher or lower.
  const approved = num(imp.approved_amount);
  if (approved != null && current != null && !same(approved, current)) {
    push({ stage: 'finance', amount: approved, reason: imp.s3_adjust_reason || null, note: imp.s3_note || null, at: imp.approved_at });
  }

  // Founder reduced the payout at the gate.
  const founder = num(imp.founder_adjusted_amount);
  if (founder != null) {
    push({ stage: 'founder', amount: founder, note: imp.founder_gate_comment || null, at: imp.founder_gate_reviewed_at });
  }

  const finalApproved = founder ?? approved;
  const paid = imp.paid ? num(imp.paid_amount) : null;

  // Finance paid a different amount than approved.
  const financePaid = num(imp.finance_adjusted_amount);
  if (paid != null && financePaid != null) {
    push({ stage: 'payment', amount: paid, reason: imp.payment_remark || null, at: imp.paid_at });
  }

  // Paid less with no deliberate cut: the difference went against cash the
  // employee still held from an earlier advance.
  const oldBalanceAdjusted = paid != null && founder == null && financePaid == null
    && finalApproved != null && paid < finalApproved && !same(paid, finalApproved)
    ? round2(finalApproved - paid)
    : 0;

  return {
    requested,
    final_approved: finalApproved,
    paid,
    old_balance_adjusted: oldBalanceAdjusted,
    // The advance is settled against the cash actually handed over.
    amount_to_file: paid,
    steps,
  };
}

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** One-line human text for a step, for WhatsApp notes. */
export function describeAmountChange(label, from, to, reason) {
  return `${label} changed the amount ${inr(from)} → ${inr(to)}${reason ? `: ${reason}` : ''}`;
}
