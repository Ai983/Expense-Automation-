-- Add avisha_dhruv_finance as a valid approval_route value
-- This route applies to all non-HO/Bangalore sites with amount < ₹10,000
-- Flow: S1 (Avisha) → Dhruv Sir WhatsApp → Finance

ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_approval_route_check;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_approval_route_check
  CHECK (approval_route IN (
    'avisha_ritu_finance',
    'avisha_director_finance',
    'avisha_dhruv_finance'
  ));
