import { supabaseAdmin } from '../config/supabase.js';

/**
 * Runs 5 duplicate detection rules against existing expenses.
 *
 * Returns:
 * {
 *   isBlocked: boolean,
 *   blockReason: string | null,
 *   warnings: string[],
 *   isDuplicate: boolean,
 * }
 */
export async function checkDuplicates({ employeeId, amount, site, submittedAt, transactionId }) {
  const warnings = [];
  let isBlocked = false;
  let blockReason = null;

  const submitDate = new Date(submittedAt);

  // ── RULE 1 & 4: Duplicate transaction ID within 7 days → BLOCK ──────────────
  if (transactionId) {
    const { data: txnMatches } = await supabaseAdmin
      .from('expenses')
      .select('id, ref_id, status, employee_id')
      .contains('screenshot_metadata', { transactionId })
      .gte('submitted_at', daysAgo(submitDate, 7).toISOString())
      .neq('status', 'rejected')
      .limit(5);

    if (txnMatches?.length > 0) {
      isBlocked = true;
      blockReason = `Duplicate transaction ID "${transactionId}" already recorded as ${txnMatches[0].ref_id}`;
    }
  }

  // ── RULE 2: Same amount + site + same day (same employee) → WARN ─────────────
  if (!isBlocked) {
    const { data: sameDayMatches } = await supabaseAdmin
      .from('expenses')
      .select('id, ref_id')
      .eq('employee_id', employeeId)
      .eq('amount', amount)
      .eq('site', site)
      .gte('submitted_at', startOfDay(submitDate).toISOString())
      .lte('submitted_at', endOfDay(submitDate).toISOString())
      .neq('status', 'rejected')
      .neq('status', 'blocked')
      .limit(3);

    if (sameDayMatches?.length > 0) {
      warnings.push(
        `Same amount ₹${amount} from ${site} already submitted today (${sameDayMatches[0].ref_id})`
      );
    }

    // ── RULE 3: Same amount + site + last 3 days (same employee) → WARN ─────────
    // Only add this warning if no same-day warning already raised (avoids duplicate messages)
    if (sameDayMatches?.length === 0) {
      const { data: threeDayMatches } = await supabaseAdmin
        .from('expenses')
        .select('id, ref_id')
        .eq('employee_id', employeeId)
        .eq('amount', amount)
        .eq('site', site)
        .gte('submitted_at', daysAgo(submitDate, 3).toISOString())
        .neq('status', 'rejected')
        .neq('status', 'blocked')
        .limit(3);

      if (threeDayMatches?.length > 0) {
        warnings.push(
          `Similar expense: ₹${amount} from ${site} submitted in last 3 days (${threeDayMatches[0].ref_id})`
        );
      }
    }
  }

  // ── RULE 5: Suspicious pattern — 3+ failed/blocked in last 24 hrs → BLOCK ────
  const { data: recentFailures } = await supabaseAdmin
    .from('expenses')
    .select('id')
    .eq('employee_id', employeeId)
    .in('status', ['rejected', 'blocked'])
    .gte('submitted_at', daysAgo(submitDate, 1).toISOString())
    .limit(10);

  if (recentFailures?.length >= 3) {
    isBlocked = true;
    blockReason =
      blockReason ||
      `Suspicious pattern: ${recentFailures.length} rejected/blocked submissions in last 24 hours`;
    warnings.push(
      `Account flagged: ${recentFailures.length} rejected/blocked submissions in last 24 hours`
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
