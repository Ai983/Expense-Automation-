-- ============================================================
-- Migration 015: Multi-Stage Imprest Approval
-- ============================================================

-- Current stage tracker
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT 's1_pending'
    CHECK (current_stage IN (
      's1_pending',
      's1_approved',
      's2_pending',
      's2_approved',
      's2_rejected',
      's3_pending',
      's3_approved',
      's3_rejected',
      'director_rejected',
      'paid'
    ));

-- Approval routing
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS approval_route TEXT NOT NULL DEFAULT 'avisha_ritu_finance'
    CHECK (approval_route IN (
      'avisha_ritu_finance',
      'avisha_director_finance'
    ));

-- S1: Avisha approval tracking
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS s1_approved_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS s1_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS s1_notes TEXT;

-- S2: Ritu approval tracking
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS s2_approved_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS s2_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS s2_notes TEXT;

-- Director's approved amount ceiling
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS director_approved_amount NUMERIC(12,2);

-- Pay tracking
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2);

-- Balance deduction tracking
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS old_balance_deducted NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_approved_amount NUMERIC(12,2);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_imprest_current_stage ON imprest_requests(current_stage);
CREATE INDEX IF NOT EXISTS idx_imprest_approval_route ON imprest_requests(approval_route);
CREATE INDEX IF NOT EXISTS idx_imprest_paid ON imprest_requests(paid) WHERE paid = true;

-- Backfill existing data
UPDATE imprest_requests SET current_stage = 's3_approved'
  WHERE status IN ('approved', 'partially_approved') AND current_stage = 's1_pending';
UPDATE imprest_requests SET current_stage = 's3_rejected'
  WHERE status = 'rejected' AND current_stage = 's1_pending';
UPDATE imprest_requests SET current_stage = 'paid', paid = true, paid_at = approved_at, paid_amount = approved_amount
  WHERE status IN ('approved', 'partially_approved') AND current_stage = 's3_approved';

-- Add new roles
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('employee', 'finance', 'manager', 'admin', 'approver_s1', 'approver_s2'));
