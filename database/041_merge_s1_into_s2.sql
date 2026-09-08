-- 041_merge_s1_into_s2.sql
-- Avisha resigned from the S1 approver post, so her stage is folded into S2.
-- Ritu (S2) is now the single first-level reviewer: on the kanban she works
-- one column instead of two. Every new request starts at s2_pending; site
-- requests over the director threshold now travel S2 -> Director -> Finance
-- -> Founder under the new `s2_director_finance_founder` route.
--
-- Legacy `avisha_*` route/stage values are kept in the CHECK constraints so
-- historical rows stay valid; only the in-flight s1_pending queue is drained.
--
-- Safe to re-run.

-- 1. Allow the new route value (keep every legacy value for historical rows).
ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_approval_route_check;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_approval_route_check
  CHECK (approval_route IN (
    'avisha_ritu_finance',                     -- Legacy (deprecated)
    'avisha_director_finance',                 -- Legacy (deprecated)
    'avisha_dhruv_finance',                    -- Legacy (deprecated)
    'avisha_finance_founder',                  -- Legacy: S1 (Avisha) < ₹10K
    'avisha_director_finance_founder',         -- Legacy: S1 (Avisha) ≥ ₹10K → Director
    's2_finance_founder',                      -- S2 (Ritu) → Finance → Founder
    's2_director_finance_founder'              -- S2 (Ritu) → Director → Finance → Founder
  ));

-- 2. Drain the in-flight S1 queue into S2 with the equivalent S2 route.
--    Only pending items sit at s1_pending; rejected ones live at s1_rejected
--    and are left untouched.
UPDATE finance.imprest_requests
   SET current_stage = 's2_pending',
       approval_route = CASE
         WHEN approval_route = 'avisha_director_finance_founder' THEN 's2_director_finance_founder'
         ELSE 's2_finance_founder'
       END
 WHERE current_stage = 's1_pending';
