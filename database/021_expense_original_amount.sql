-- Preserve the employee's originally submitted amount so it is never lost
-- when finance approves with a reduced amount.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS original_amount NUMERIC(12,2);

-- Backfill existing rows: for any row where original_amount is not set,
-- default to the current amount (best we can do without history).
UPDATE expenses SET original_amount = amount WHERE original_amount IS NULL;
