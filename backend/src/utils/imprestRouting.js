import { RITU_ALWAYS_SITES, DIRECTOR_APPROVAL_THRESHOLD } from '../config/constants.js';

/**
 * Single source of truth for the three-tier imprest approval routing.
 *
 *  - Head Office / Bangalore Office (any amount):  S2 (Ritu) → Finance → Founder
 *  - Other sites, amount ≤ ₹9,999:                 S1 (Avisha) → Finance → Founder
 *  - Other sites, amount > ₹9,999:                 S1 (Avisha) → Director → Finance → Founder
 *
 * Used by the submit handler (new requests) and the reconcile script
 * (existing data) so both always agree on route + starting stage.
 *
 * @param {string} site   Exact site name (matched against RITU_ALWAYS_SITES).
 * @param {number} amount Requested amount in INR.
 * @returns {{ approvalRoute: string, startingStage: string }}
 */
export function resolveImprestRouting(site, amount) {
  const isHOorBangalore = RITU_ALWAYS_SITES.includes(site);

  if (isHOorBangalore) {
    return { approvalRoute: 's2_finance_founder', startingStage: 's2_pending' };
  }
  if (amount > DIRECTOR_APPROVAL_THRESHOLD) {
    return { approvalRoute: 'avisha_director_finance_founder', startingStage: 's1_pending' };
  }
  return { approvalRoute: 'avisha_finance_founder', startingStage: 's1_pending' };
}
