-- Preserve the employee's originally submitted amount so it is never lost
-- when finance approves with a reduced amount.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2);

-- Backfill: for non-approved/non-rejected expenses the current amount IS the
-- original (finance hasn't touched it yet), so we can safely mirror it.
UPDATE expenses
SET original_amount = amount
WHERE original_amount IS NULL
  AND status NOT IN ('approved', 'rejected');

-- For already-approved expenses, original_amount stays NULL unless we know
-- the real submitted amount. The specific fix below handles known cases.

-- ── Known adjustment: HSE-20260504-0010 (Divyansh, ₹1469 → ₹334) ────────────
UPDATE expenses
SET original_amount = 1469
WHERE ref_id = 'HSE-20260504-0010'
  AND original_amount IS NULL;
