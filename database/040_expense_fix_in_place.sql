-- 040_expense_fix_in_place.sql
-- Fix-in-place: when the AI finds a defect the employee can correct themselves,
-- the expense goes to THEIR stage instead of finance's, and they replace the
-- receipt on the SAME row.
--
-- This exists because there is no edit path today: an employee told to fix
-- something must file a whole new expense, leaving the bad row in the queue.
-- That already happened — Saksham Verma filed 3,000 twice within the hour and
-- Dilkhush Thakur 5,000 twice — and each pair produced a false duplicate flag,
-- double-counted the imprest balance, and left finance two rows to clear.
--
-- Ownership is exclusive: an expense is either the employee's or finance's,
-- never both. One fix attempt only; a second failure goes to finance.
--
-- Safe to re-run.

ALTER TABLE finance.expenses
  -- Set while the expense sits in the employee's stage. NULL means finance's.
  ADD COLUMN IF NOT EXISTS awaiting_fix_until timestamptz,
  ADD COLUMN IF NOT EXISTS fix_requested_at timestamptz,
  -- What the employee was asked to correct (the AI's plain-English hint).
  ADD COLUMN IF NOT EXISTS fix_request_reason text,
  -- Hard ceiling of one fix, enforced in code; kept here for the audit trail.
  ADD COLUMN IF NOT EXISTS fix_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fixed_at timestamptz,
  -- One WhatsApp per expense, ever. Set on send so it can never repeat.
  ADD COLUMN IF NOT EXISTS fix_notified_at timestamptz;

COMMENT ON COLUMN finance.expenses.awaiting_fix_until IS
  'Deadline for the employee to correct this expense. NON-NULL means the expense belongs to the EMPLOYEE and must be hidden from the finance review queue. Never extends past the imprest expense deadline.';
COMMENT ON COLUMN finance.expenses.fix_attempt_count IS
  'Fix attempts used. Capped at 1: a second failure moves the expense to finance rather than back to the employee.';
COMMENT ON COLUMN finance.expenses.fix_notified_at IS
  'When the single WhatsApp fix request was sent. Presence of a value prevents any repeat message.';

-- Drives both the finance-queue exclusion and the timeout sweep.
CREATE INDEX IF NOT EXISTS idx_expenses_awaiting_fix
  ON finance.expenses (awaiting_fix_until)
  WHERE awaiting_fix_until IS NOT NULL;
