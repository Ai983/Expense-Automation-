// Food imprest date lock (migration 044).
//
// One person eats once a day, so an employee may not raise two Food Expense
// imprests whose dates overlap — e.g. 1–15 Oct and then 10–20 Oct. Keyed to the
// EMPLOYEE, not the site: several staff at one site each claim their own food
// for the same fortnight, and that is normal.
//
// Exception: a request marked for_others (contractor / labour food) is never
// blocked and never blocks the employee's own food — it only warns S2.
// S2 is also warned (never blocked) about other employees' food at the same
// site over the same dates, which catches one person filing for another.
//
// Rent and Hotel are deliberately not covered: one engineer often pays for
// several rooms at once, so those need a per-room lock, not a per-person one.
import { supabaseAdmin } from '../config/supabase.js';
import { siteVariants } from '../config/sites.js';

export const FOOD_CATEGORY = 'Food Expense';

// Requests in these stages no longer hold their dates.
const RELEASED_STAGES = '("s1_rejected","s2_rejected","s3_rejected","director_rejected","founder_rejected","withdrawn")';

const SELECT = 'id, ref_id, employee_id, site, date_from, date_to, people_count, for_others, current_stage, employee:employee_id (name)';

// Live Food imprests whose [date_from, date_to] overlaps [from, to], both inclusive.
function liveFoodOverlapping(from, to) {
  return supabaseAdmin
    .from('imprest_requests')
    .select(SELECT)
    .eq('category', FOOD_CATEGORY)
    .neq('status', 'rejected')
    .not('current_stage', 'in', RELEASED_STAGES)
    .lte('date_from', to)
    .gte('date_to', from);
}

const nextDay = (ymd) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const toOverlap = (r, sameEmployee) => ({
  ref_id: r.ref_id,
  employee_name: r.employee?.name || null,
  site: r.site,
  date_from: r.date_from,
  date_to: r.date_to,
  people_count: r.people_count,
  for_others: !!r.for_others,
  same_employee: sameEmployee,
});

/** Validates a food request's date range; returns an error message or null. */
export function foodDateError(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return 'Food requests need a From and To date.';
  if (!isYmd(dateFrom) || !isYmd(dateTo)) return 'Dates must be in YYYY-MM-DD format.';
  if (dateTo < dateFrom) return 'The To date must be on or after the From date.';
  return null;
}

/**
 * Checks a new Food imprest against existing ones.
 * Returns { conflicts, overlaps }:
 *   conflicts — the employee's own-food requests the new one collides with
 *               (non-empty ⇒ refuse the submit). Always empty when forOthers.
 *   overlaps  — what S2 should be warned about (stored as food_overlaps).
 */
export async function checkFoodDates({ employeeId, site, dateFrom, dateTo, forOthers }) {
  const sites = await siteVariants(site);
  const [mineRes, siteRes] = await Promise.all([
    liveFoodOverlapping(dateFrom, dateTo).eq('employee_id', employeeId),
    liveFoodOverlapping(dateFrom, dateTo).in('site', sites).neq('employee_id', employeeId),
  ]);
  if (mineRes.error) throw mineRes.error;
  if (siteRes.error) throw siteRes.error;

  const mine = mineRes.data || [];
  const conflicts = forOthers ? [] : mine.filter((r) => !r.for_others);
  const conflictIds = new Set(conflicts.map((r) => r.id));

  const overlaps = [
    ...mine.filter((r) => !conflictIds.has(r.id)).map((r) => toOverlap(r, true)),
    ...(siteRes.data || []).map((r) => toOverlap(r, false)),
  ];
  return { conflicts, overlaps };
}

/** The message shown to the employee when their dates are already taken. */
export function foodConflictMessage(conflicts) {
  const list = conflicts
    .map((r) => `${r.ref_id} (${r.date_from} to ${r.date_to})`)
    .join(', ');
  const lastTo = conflicts.reduce((m, r) => (r.date_to > m ? r.date_to : m), conflicts[0].date_to);
  return `You already have food money for these dates: ${list}. Your next food request can start from ${nextDay(lastTo)}. `
    + `If this request is for other people (contractors / labour), tick "For other people" and enter their names. / `
    + `In dates ka khana pehle hi le liya gaya hai. Agla request ${nextDay(lastTo)} se shuru karein.`;
}

/**
 * The employee's own-food date ranges still holding their dates, for the app's
 * date step. Limited to recent/future ranges so the list stays short.
 */
export async function takenFoodRanges(employeeId, sinceYmd) {
  const { data, error } = await supabaseAdmin
    .from('imprest_requests')
    .select('ref_id, date_from, date_to, current_stage')
    .eq('employee_id', employeeId)
    .eq('category', FOOD_CATEGORY)
    .eq('for_others', false)
    .neq('status', 'rejected')
    .not('current_stage', 'in', RELEASED_STAGES)
    .gte('date_to', sinceYmd)
    .order('date_from', { ascending: true });
  if (error) throw error;
  return data || [];
}
