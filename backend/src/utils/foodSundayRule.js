// Food imprest Sunday rule (migration 045).
//
// Sunday is the weekly off, so food is not paid for a Sunday unless the employee
// ticks it as a day they will work. Same rule for every site. The paid days are
// calendar days minus the unticked Sundays; where the site has a fixed food rate
// the amount may not exceed rate × people × paid days.
//
// Ticked Sundays are checked against HR punch-ins afterwards by
// finance.food_sunday_check() (GET /api/imprest/sunday-check). Nothing is
// deducted automatically — Finance decides.
import { supabaseAdmin } from '../config/supabase.js';
import { siteVariants } from '../config/sites.js';

const utc = (ymd) => new Date(`${ymd}T00:00:00Z`);
const ymdOf = (d) => d.toISOString().slice(0, 10);

/** Every Sunday between two YYYY-MM-DD dates, inclusive. */
export function sundaysBetween(from, to) {
  const out = [];
  for (let d = utc(from); d <= utc(to); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0) out.push(ymdOf(d));
  }
  return out;
}

/** Calendar days between two YYYY-MM-DD dates, inclusive. */
export function calendarDays(from, to) {
  return Math.round((utc(to) - utc(from)) / 86400000) + 1;
}

/**
 * Works out which Sundays are paid and how many days are paid in total.
 * `ticked` is what the app sent; anything that isn't a Sunday in range is dropped.
 */
export function foodPaidDays(from, to, ticked) {
  const sundays = sundaysBetween(from, to);
  const tickedSet = new Set(Array.isArray(ticked) ? ticked : []);
  const worked = sundays.filter((s) => tickedSet.has(s));
  return {
    sundays,
    worked,
    paidDays: calendarDays(from, to) - sundays.length + worked.length,
  };
}

/** The site's fixed per-person daily food rate, or null when none is configured. */
export async function foodRateFor(site) {
  const { data, error } = await supabaseAdmin
    .from('food_rates').select('site, rate').in('site', await siteVariants(site));
  if (error) throw error;
  const rate = data?.length ? parseFloat(data[0].rate) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
