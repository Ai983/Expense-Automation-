import { RITU_ALWAYS_SITES, DIRECTOR_APPROVAL_THRESHOLD } from '../config/constants.js';

/**
 * Single source of truth for the two-tier imprest approval routing.
 *
 * Ritu (S2) is now the first human reviewer for every request — Avisha's old
 * S1 stage was merged into S2 when she left the post, so nothing starts at
 * s1_pending anymore.
 *
 *  - Head Office / Bangalore, any amount:  S2 (Ritu) → Finance → Founder
 *  - Other sites, amount ≤ ₹9,999:         S2 (Ritu) → Finance → Founder
 *  - Other sites, amount > ₹9,999:         S2 (Ritu) → Director → Finance → Founder
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

  // Site requests over the director threshold still need Bhaskar's WhatsApp
  // approval — but only after Ritu's S2 review. HO/Bangalore always skip Director.
  if (!isHOorBangalore && amount > DIRECTOR_APPROVAL_THRESHOLD) {
    return { approvalRoute: 's2_director_finance_founder', startingStage: 's2_pending' };
  }
  return { approvalRoute: 's2_finance_founder', startingStage: 's2_pending' };
}

// Routes whose ≥₹10K requests must pass the Director (Bhaskar) WhatsApp gate
// after S2. Includes the legacy `avisha_*` name for rows created before the merge.
export const DIRECTOR_ROUTES = ['s2_director_finance_founder', 'avisha_director_finance_founder'];

/** True when a request's route requires Director approval. */
export function isDirectorRoute(route) {
  return DIRECTOR_ROUTES.includes(route);
}
