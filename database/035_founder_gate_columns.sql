-- Migration 035: Add founder gate columns and update current_stage CHECK constraint
-- Adds tracking columns for founder approval gate and updates valid stage values

-- Update current_stage CHECK to include new founder stages
ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_current_stage_check;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_current_stage_check
  CHECK (current_stage IN (
    's1_pending', 's1_approved',
    's2_pending', 's2_approved', 's2_rejected',
    's3_pending', 's3_approved', 's3_rejected',
    'director_rejected',
    'founder_review_pending', 'founder_approved', 'founder_rejected',
    'withdrawn',
    'paid'
  ));

-- Add founder gate tracking columns
ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS founder_gate_status TEXT
    CHECK (founder_gate_status IN ('approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS founder_gate_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS founder_gate_comment TEXT,
  ADD COLUMN IF NOT EXISTS founder_rejection_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS founder_gate_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_review_note TEXT;
