-- 037_founder_adjusted_amount.sql
-- Founder can reduce the payout amount at the approval gate.
-- When set, this is the EXACT amount Finance pays out (old-balance deduction
-- is ignored for adjusted requests). NULL = founder approved as-is.

ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS founder_adjusted_amount numeric;

COMMENT ON COLUMN finance.imprest_requests.founder_adjusted_amount IS
  'Exact payout amount set by the founder at the approval gate. NULL = not adjusted.';
