-- Migration 012: Add imprest_id to expenses for linking expenses to imprest requests
-- and support old balance tracking / partial expense filling

-- Link expenses to the imprest they were raised against
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS imprest_id UUID REFERENCES imprest_requests(id);

-- Index for fast lookup of expenses linked to an imprest
CREATE INDEX IF NOT EXISTS idx_expenses_imprest_id ON expenses(imprest_id) WHERE imprest_id IS NOT NULL;

-- Allow multiple expenses per reminder (partial filling)
-- Change imprest_expense_reminders to track fulfilled amount
ALTER TABLE imprest_expense_reminders ADD COLUMN IF NOT EXISTS fulfilled_amount NUMERIC DEFAULT 0;

-- View to compute old balance per imprest (approved_amount - sum of linked expenses)
CREATE OR REPLACE VIEW imprest_balance_view AS
SELECT
  ir.id AS imprest_id,
  ir.ref_id,
  ir.employee_id,
  ir.site,
  ir.category,
  ir.amount_requested,
  ir.approved_amount,
  ir.status,
  COALESCE(SUM(e.amount), 0) AS total_expenses_submitted,
  COALESCE(ir.approved_amount, ir.amount_requested) - COALESCE(SUM(e.amount), 0) AS old_balance
FROM imprest_requests ir
LEFT JOIN expenses e ON e.imprest_id = ir.id AND e.status NOT IN ('rejected', 'blocked')
WHERE ir.status IN ('approved', 'partially_approved')
GROUP BY ir.id, ir.ref_id, ir.employee_id, ir.site, ir.category,
         ir.amount_requested, ir.approved_amount, ir.status;

-- View to compute per-employee total outstanding balance across all imprests
CREATE OR REPLACE VIEW employee_imprest_balance_view AS
SELECT
  employee_id,
  SUM(old_balance) AS total_old_balance,
  COUNT(*) FILTER (WHERE old_balance > 0) AS imprests_with_balance
FROM imprest_balance_view
GROUP BY employee_id;
