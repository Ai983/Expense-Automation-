-- HagerStone Expense Tracker - Performance Indexes
-- Run after 001_schema.sql

-- Expenses: most common query patterns
CREATE INDEX IF NOT EXISTS idx_expenses_employee_id    ON expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status         ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_site           ON expenses(site);
CREATE INDEX IF NOT EXISTS idx_expenses_submitted_at   ON expenses(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_ref_id         ON expenses(ref_id);

-- Composite index for duplicate detection queries (Rules 2 & 3)
CREATE INDEX IF NOT EXISTS idx_expenses_dup_check
  ON expenses(amount, site, employee_id, submitted_at DESC);

-- JSONB index for transaction ID lookups in screenshot_metadata (Rule 1 & 4)
CREATE INDEX IF NOT EXISTS idx_expenses_txn_id
  ON expenses USING GIN (screenshot_metadata jsonb_path_ops);

-- Verification logs
CREATE INDEX IF NOT EXISTS idx_vlogs_expense_id        ON verification_logs(expense_id);
CREATE INDEX IF NOT EXISTS idx_vlogs_created_at        ON verification_logs(created_at DESC);

-- Audit trail
CREATE INDEX IF NOT EXISTS idx_audit_entity            ON audit_trail(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user              ON audit_trail(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp         ON audit_trail(timestamp DESC);

-- Employees
CREATE INDEX IF NOT EXISTS idx_employees_auth_id       ON employees(auth_id);
CREATE INDEX IF NOT EXISTS idx_employees_email         ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_role          ON employees(role);
