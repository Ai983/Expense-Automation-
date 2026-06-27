-- 038_s1_adjusted_amount.sql
-- S1 (Avisha) can adjust the approved amount at the S1 gate for site imprest requests.
-- NULL = approved as-is. When set, downstream stages (Director, Finance) see this
-- as the effective amount to work with.

ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS s1_adjusted_amount numeric;

COMMENT ON COLUMN finance.imprest_requests.s1_adjusted_amount IS
  'Amount adjusted by S1 (Avisha) at the approval gate. NULL = not adjusted, use amount_requested.';
