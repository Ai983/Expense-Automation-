-- Link settlement expenses back to the original adjusted expense so the
-- remaining gap can be recalculated as settlements are approved.
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS settlement_for_expense_id UUID REFERENCES expenses(id);

CREATE INDEX IF NOT EXISTS idx_expenses_settlement_for
  ON expenses(settlement_for_expense_id)
  WHERE settlement_for_expense_id IS NOT NULL;
