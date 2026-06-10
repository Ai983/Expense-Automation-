-- Migration 036: Restore s1_rejected stage + close orphaned S1-rejected imprests
--
-- Problem this fixes:
--   1. Migration 035 redefined the current_stage CHECK constraint but DROPPED
--      's1_rejected'. The S1-reject handler (routes/imprest.js) sets
--      current_stage='s1_rejected', so every S1 rejection has been silently
--      failing the constraint and the row stayed at 's1_pending'.
--   2. Older rejections (pre-fix) set status='rejected' but never moved
--      current_stage off 's1_pending'.
--   Net effect: ~187 already-rejected imprests pile up in Avisha's S1 queue
--   (current_stage='s1_pending') while only genuinely-pending items
--   (status='pending') should remain there.

-- 1) Re-add the missing terminal/intermediate S1 stages to the constraint.
ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_current_stage_check;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_current_stage_check
  CHECK (current_stage IN (
    's1_pending', 's1_approved', 's1_rejected',
    's2_pending', 's2_approved', 's2_rejected',
    'director_pending', 'director_approved', 'director_rejected',
    's3_pending', 's3_approved', 's3_rejected',
    'founder_review_pending', 'founder_approved', 'founder_rejected',
    'withdrawn',
    'paid'
  ));

-- 2) Close the orphaned rejections: any item sitting at s1_pending that was
--    already rejected belongs in the terminal s1_rejected stage so it leaves
--    Avisha's queue. Genuinely-open items (status='pending') are untouched.
UPDATE finance.imprest_requests
   SET current_stage = 's1_rejected'
 WHERE current_stage = 's1_pending'
   AND status = 'rejected';
