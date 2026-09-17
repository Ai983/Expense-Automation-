-- 041_imprest_amount_trail.sql
-- Keep a trace of every amount change on an imprest, with the reason, so each
-- next stage (Finance, Founder) and the employee can see why the figure moved.
--
-- Before this, an S2 (Ritu) or Director cut overwrote amount_requested: the
-- employee's original figure and the reason for the cut were lost (36 requests,
-- ₹42,685 cut). amount_requested keeps its meaning — the amount currently
-- forwarded — and the original is now kept alongside it.
--
-- Additive; the backfill only fills the new column. Safe to re-run.

ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS original_amount_requested numeric,
  ADD COLUMN IF NOT EXISTS s2_adjusted_amount numeric,
  ADD COLUMN IF NOT EXISTS s2_adjust_reason text,
  ADD COLUMN IF NOT EXISTS s3_adjust_reason text;

COMMENT ON COLUMN finance.imprest_requests.original_amount_requested IS
  'Amount the employee originally asked for. Never changed after submit. NULL only on rows with no submit record.';
COMMENT ON COLUMN finance.imprest_requests.s2_adjusted_amount IS
  'Amount S2 (Ritu) reduced the request to. NULL = forwarded as requested. amount_requested also carries this figure.';
COMMENT ON COLUMN finance.imprest_requests.s2_adjust_reason IS
  'Why S2 reduced the amount. Required whenever s2_adjusted_amount is set.';
COMMENT ON COLUMN finance.imprest_requests.s3_adjust_reason IS
  'Why Finance approved a different amount (higher or lower) than was forwarded to it.';

-- Backfill the employee's original figure from the submit audit entry, matched
-- on the row id (ref_id has duplicates and must not be used for this).
UPDATE finance.imprest_requests r
SET original_amount_requested = o.original_amount
FROM (
  SELECT DISTINCT ON (entity_id) entity_id, (new_value->>'amount')::numeric AS original_amount
  FROM finance.audit_trail
  WHERE action = 'submit_imprest' AND new_value ? 'amount'
  ORDER BY entity_id, timestamp ASC
) o
WHERE r.id = o.entity_id
  AND r.original_amount_requested IS NULL;
