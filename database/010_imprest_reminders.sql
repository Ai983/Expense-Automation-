-- ============================================================
-- IMPREST EXPENSE REMINDERS
-- When an imprest is approved, a 3-day reminder is created.
-- If the employee doesn't submit an expense within 3 days,
-- they are blocked from raising new imprests until admin unblocks.
-- ============================================================

-- Add blocking columns to employees table
ALTER TABLE employees ADD COLUMN IF NOT EXISTS imprest_blocked         BOOLEAN    NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS imprest_blocked_reason  TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS imprest_blocked_at      TIMESTAMPTZ;

-- Reminder tracking table
CREATE TABLE IF NOT EXISTS imprest_expense_reminders (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  imprest_id      UUID        NOT NULL REFERENCES imprest_requests(id) ON DELETE CASCADE,
  employee_id     UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  imprest_ref_id  TEXT        NOT NULL,
  deadline        TIMESTAMPTZ NOT NULL,          -- approved_at + 3 days
  status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'fulfilled', 'expired')),
  expense_id      UUID        REFERENCES expenses(id),  -- set when fulfilled
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER imprest_reminders_updated_at
  BEFORE UPDATE ON imprest_expense_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_reminders_employee ON imprest_expense_reminders(employee_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status   ON imprest_expense_reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_deadline ON imprest_expense_reminders(deadline);
CREATE INDEX IF NOT EXISTS idx_reminders_imprest  ON imprest_expense_reminders(imprest_id);

-- RLS
ALTER TABLE imprest_expense_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reminders_finance_select" ON imprest_expense_reminders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_id = auth.uid()
        AND role IN ('finance', 'admin', 'manager')
    )
  );

CREATE POLICY "reminders_finance_update" ON imprest_expense_reminders
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE auth_id = auth.uid()
        AND role IN ('finance', 'admin', 'manager')
    )
  );

CREATE POLICY "reminders_service_insert" ON imprest_expense_reminders
  FOR INSERT
  WITH CHECK (true);  -- backend service role handles inserts
