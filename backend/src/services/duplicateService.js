import { supabaseAdmin } from '../config/supabase.js';

/**
 * Runs 5 duplicate detection rules against existing expenses.
 *
 * When `imprestId` is provided (the new submission is imprest-linked), legacy
 * expenses that have NO imprest_id and are NOT yet approved are excluded from
 * all duplicate checks.  This prevents old free-form submissions (created
 * before the imprest-first rule was enforced) from permanently blocking
 * legitimate re-submissions that now follow the correct flow.
 *
 * An old expense that IS already 'approved' is still treated as a real
 * duplicate — the money was already disbursed.
 *
 * Returns:
 * {
 *   isBlocked: boolean,
 *   blockReason: string | null,
 *   warnings: string[],
 *   isDuplicate: boolean,
 * }
 */
export async function checkDuplicates({ employeeId, amount, site, submittedAt, transactionId, imprestId }) {
  const warnings = [];
  let isBlocked = false;
  let blockReason = null;

  const submitDate = new Date(submittedAt);
  const hasImprest = !!imprestId;

  // Helper: given a list of existing expense rows (which must include imprest_id
  // and status), filter out legacy imprest-free non-approved rows when the
  // current submission is properly linked to an imprest.
  function filterLegacy(rows) {
    if (!hasImprest) return rows;
    return (rows || []).filter((r) => r.imprest_id !== null || r.status === 'approved');
  }

  // ── RULE 1: Duplicate transaction ID within 7 days → BLOCK ───────────────────
  if (transactionId) {
    const { data: txnMatches } = await supabaseAdmin
      .from('expenses')
      .select('id, ref_id, status, employee_id, imprest_id')
      .contains('screenshot_metadata', { transactionId })
      .gte('submitted_at', daysAgo(submitDate, 7).toISOString())
      .neq('status', 'rejected')
      .limit(5);

    const effectiveTxn = filterLegacy(txnMatches);

    if (effectiveTxn.length > 0) {
      isBlocked = true;
      blockReason = `Duplicate transaction ID "${transactionId}" already recorded as ${effectiveTxn[0].ref_id}`;
    }
  }

  // ── RULE 2: Same amount + site + same day (same employee) → WARN ─────────────
  if (!isBlocked) {
    const { data: sameDayMatches } = await supabaseAdmin
      .from('expenses')
      .select('id, ref_id, imprest_id')
      .eq('employee_id', employeeId)
      .eq('amount', amount)
      .eq('site', site)
      .gte('submitted_at', startOfDay(submitDate).toISOString())
      .lte('submitted_at', endOfDay(submitDate).toISOString())
      .neq('status', 'rejected')
      .neq('status', 'blocked')
      .limit(3);

    const effectiveSameDay = filterLegacy(sameDayMatches);

    if (effectiveSameDay.length > 0) {
      warnings.push(
        `Same amount ₹${amount} from ${site} already submitted today (${effectiveSameDay[0].ref_id})`
      );
    }

    // ── RULE 3: Same amount + site + last 3 days (same employee) → WARN ─────────
    if (effectiveSameDay.length === 0) {
      const { data: threeDayMatches } = await supabaseAdmin
        .from('expenses')
        .select('id, ref_id, imprest_id')
        .eq('employee_id', employeeId)
        .eq('amount', amount)
        .eq('site', site)
        .gte('submitted_at', daysAgo(submitDate, 3).toISOString())
        .neq('status', 'rejected')
        .neq('status', 'blocked')
        .limit(3);

      const effectiveThreeDay = filterLegacy(threeDayMatches);

      if (effectiveThreeDay.length > 0) {
        warnings.push(
          `Similar expense: ₹${amount} from ${site} submitted in last 3 days (${effectiveThreeDay[0].ref_id})`
        );
      }
    }
  }

  // ── RULE 5: Suspicious pattern — 3+ failed/blocked in last 24 hrs → BLOCK ────
  // When the new submission is imprest-linked, only count prior failures that
  // were also imprest-linked — old free-form blocks should not penalise the
  // employee now that they are following the correct flow.
  const { data: recentFailures } = await supabaseAdmin
    .from('expenses')
    .select('id, imprest_id')
    .eq('employee_id', employeeId)
    .in('status', ['rejected', 'blocked'])
    .gte('submitted_at', daysAgo(submitDate, 1).toISOString())
    .limit(10);

  const effectiveFailures = hasImprest
    ? (recentFailures || []).filter((f) => f.imprest_id !== null)
    : recentFailures || [];

  if (effectiveFailures.length >= 3) {
    isBlocked = true;
    blockReason =
      blockReason ||
      `Suspicious pattern: ${effectiveFailures.length} rejected/blocked submissions in last 24 hours`;
    warnings.push(
      `Account flagged: ${effectiveFailures.length} rejected/blocked submissions in last 24 hours`
    );
  }

  return {
    isBlocked,
    blockReason,
    warnings,
    isDuplicate: isBlocked || warnings.length > 0,
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysAgo(fromDate, days) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() - days);
  return d;
}
