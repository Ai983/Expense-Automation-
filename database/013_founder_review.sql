-- Migration 013: Add founder/director review workflow support

-- Track who the imprest is requested to (text-based, not FK)
ALTER TABLE imprest_requests ADD COLUMN IF NOT EXISTS requested_to_name TEXT;

-- Founder/Director review status and comments
ALTER TABLE imprest_requests ADD COLUMN IF NOT EXISTS founder_review_status TEXT
  CHECK (founder_review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE imprest_requests ADD COLUMN IF NOT EXISTS founder_review_comment TEXT;
ALTER TABLE imprest_requests ADD COLUMN IF NOT EXISTS founder_review_at TIMESTAMPTZ;
ALTER TABLE imprest_requests ADD COLUMN IF NOT EXISTS founder_review_phone TEXT;

-- Whether this imprest requires founder approval (amount >= 5000)
ALTER TABLE imprest_requests ADD COLUMN IF NOT EXISTS requires_founder_approval BOOLEAN DEFAULT false;

-- Index for filtering by founder review status
CREATE INDEX IF NOT EXISTS idx_imprest_founder_review ON imprest_requests(founder_review_status)
  WHERE founder_review_status IS NOT NULL;
