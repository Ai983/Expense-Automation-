-- ============================================================
-- Migration 017: Fix current_stage CHECK constraint
-- Adds 's1_rejected' which was missing from migration 015
-- ============================================================

-- Drop the old constraint (auto-generated name varies, so drop all CHECK constraints on current_stage)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid
      AND att.attnum = ANY(con.conkey)
    JOIN pg_class cls ON cls.oid = con.conrelid
    WHERE cls.relname = 'imprest_requests'
      AND con.contype = 'c'
      AND att.attname = 'current_stage'
  LOOP
    EXECUTE 'ALTER TABLE imprest_requests DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END $$;

-- Re-add with 's1_rejected' included
ALTER TABLE imprest_requests
  ADD CONSTRAINT imprest_requests_current_stage_check
  CHECK (current_stage IN (
    's1_pending',
    's1_approved',
    's1_rejected',
    's2_pending',
    's2_approved',
    's2_rejected',
    's3_pending',
    's3_approved',
    's3_rejected',
    'director_rejected',
    'paid'
  ));
