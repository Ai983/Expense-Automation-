-- Migration 035: Add founder gate columns, director approval, and S2 routing
-- Implements three approval flows:
-- 1. HO/Bangalore: S2 (Ritu) → Finance → Founder
-- 2. Other sites < ₹10K: S1 (Avisha) → Finance → Founder
-- 3. Other sites ≥ ₹10K: S1 (Avisha) → Director → Finance → Founder

-- Update approval_route CHECK to include S2 and founder routes
ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_approval_route_check;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_approval_route_check
  CHECK (approval_route IN (
    'avisha_ritu_finance',                     -- Legacy (deprecated)
    'avisha_director_finance',                 -- Legacy (deprecated)
    'avisha_dhruv_finance',                    -- Legacy (deprecated)
    's2_finance_founder',                      -- HO/Bangalore: S2 → Finance → Founder
    'avisha_finance_founder',                  -- Other sites < ₹10K: S1 → Finance → Founder
    'avisha_director_finance_founder'          -- Other sites ≥ ₹10K: S1 → Director → Finance → Founder
  ));

-- Update current_stage CHECK to include director and founder stages
ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_current_stage_check;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_current_stage_check
  CHECK (current_stage IN (
    's1_pending', 's1_approved',
    's2_pending', 's2_approved', 's2_rejected',
    'director_pending', 'director_approved', 'director_rejected',
    's3_pending', 's3_approved', 's3_rejected',
    'founder_review_pending', 'founder_approved', 'founder_rejected',
    'withdrawn',
    'paid'
  ));

-- Add director approval tracking columns
ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS director_approved_by UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS director_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS director_note TEXT,
  ADD COLUMN IF NOT EXISTS director_approved_amount NUMERIC(12,2);

-- Add founder gate tracking columns
ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS founder_gate_status TEXT
    CHECK (founder_gate_status IN ('approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS founder_gate_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS founder_gate_comment TEXT,
  ADD COLUMN IF NOT EXISTS founder_rejection_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS founder_gate_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finance_review_note TEXT;
