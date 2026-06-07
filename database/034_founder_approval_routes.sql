-- Update approval routes to include founder approval gates
-- Replaces Ritu (S2) with Dhruv Sir (founder) as mandatory final approver
-- New routes: avisha_finance_founder (< ₹10K) and avisha_director_finance_founder (>= ₹10K)

ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_approval_route_check;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_approval_route_check
  CHECK (approval_route IN (
    'avisha_ritu_finance',                     -- Legacy route (deprecated, kept for existing imprests)
    'avisha_director_finance',                 -- Legacy route (deprecated, kept for existing imprests)
    'avisha_dhruv_finance',                    -- Legacy route (deprecated, kept for existing imprests)
    'avisha_finance_founder',                  -- New: < ₹10K → Avisha (S1) → Finance → Dhruv (Founder)
    'avisha_director_finance_founder'          -- New: >= ₹10K → Bhaskar (Director) → Finance → Dhruv (Founder)
  ));
