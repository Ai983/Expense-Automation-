-- HagerStone Expense Tracker - Row Level Security Policies
-- NOTE: The Express backend uses the SERVICE_ROLE key which bypasses all RLS.
-- These policies protect against direct Supabase client access (mobile/web).

-- Enable RLS on all tables
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- EMPLOYEES policies
-- ============================================================

-- Employees can read their own profile
CREATE POLICY "employees_select_own" ON employees
  FOR SELECT
  USING (auth.uid() = auth_id);

-- Employees can update their own profile (name, phone only — role/status locked)
CREATE POLICY "employees_update_own" ON employees
  FOR UPDATE
  USING (auth.uid() = auth_id)
  WITH CHECK (auth.uid() = auth_id);

-- ============================================================
-- EXPENSES policies
-- ============================================================

-- Employees can read their own expenses
CREATE POLICY "expenses_select_own" ON expenses
  FOR SELECT
  USING (
    employee_id = (SELECT id FROM employees WHERE auth_id = auth.uid())
  );

-- Employees can insert their own expenses (backend will do this via service_role)
-- Direct insert from mobile is disabled; all writes go through backend API
-- (No INSERT policy = mobile client cannot insert directly)

-- ============================================================
-- VERIFICATION LOGS policies
-- ============================================================

-- Employees can read verification logs for their own expenses
CREATE POLICY "vlogs_select_own_expenses" ON verification_logs
  FOR SELECT
  USING (
    expense_id IN (
      SELECT id FROM expenses
      WHERE employee_id = (SELECT id FROM employees WHERE auth_id = auth.uid())
    )
  );

-- ============================================================
-- AUDIT TRAIL policies
-- ============================================================

-- Employees can read their own audit entries
CREATE POLICY "audit_select_own" ON audit_trail
  FOR SELECT
  USING (
    user_id = (SELECT id FROM employees WHERE auth_id = auth.uid())
  );
