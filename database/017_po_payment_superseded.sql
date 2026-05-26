-- ============================================================
-- Migration 017: PO Payment superseded status + superseded_by column
-- Run on Finance Supabase project (vosbhngbnodisoiianhk)
-- ============================================================

-- Dynamically drop any existing CHECK constraint on po_payments.status
-- so we can re-add it with 'superseded' included
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'po_payments'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%status%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE po_payments DROP CONSTRAINT ' || quote_ident(v_constraint_name);
  END IF;
END $$;

-- Re-add constraint with 'superseded' included
ALTER TABLE po_payments ADD CONSTRAINT po_payments_status_check
  CHECK (status IN (
    'pending_procurement',
    'pending_payment',
    'paid',
    'payment_rejected',
    'procurement_rejected',
    'superseded'
  ));

-- Column to record which revision superseded this entry
ALTER TABLE po_payments ADD COLUMN IF NOT EXISTS superseded_by TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_po_payments_status ON po_payments(status);
CREATE INDEX IF NOT EXISTS idx_po_payments_superseded_by ON po_payments(superseded_by)
  WHERE superseded_by IS NOT NULL;
