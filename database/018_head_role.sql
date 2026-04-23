-- ============================================================
-- Migration 018: Add 'head' role
-- ============================================================

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN (
    'employee',
    'finance',
    'manager',
    'admin',
    'approver_s1',
    'approver_s2',
    'procurement_finance',
    'head'
  ));
