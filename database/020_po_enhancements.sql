-- 020_po_enhancements.sql
-- Feature 1: Finance-adjusted amount + partial payment status
-- Feature 2: Vendor comparison sheet (po_vendor_quotes table)
-- Feature 3: Expense overspend tracking

-- ── Feature 1: Finance can adjust approved amount + partial payments ────────

ALTER TABLE po_payments
  ADD COLUMN IF NOT EXISTS finance_adjusted_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS finance_adjusted_by UUID,
  ADD COLUMN IF NOT EXISTS finance_adjusted_at TIMESTAMPTZ;

-- Add 'partially_paid' to the allowed status values.
-- Supabase/PostgreSQL stores this as a CHECK constraint.
-- Safely drop the old constraint (name may vary) and recreate it.
DO $$
BEGIN
  -- Drop existing check constraint on status if any exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'po_payments'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%status%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE po_payments DROP CONSTRAINT ' || constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'po_payments'
        AND constraint_type = 'CHECK'
        AND constraint_name LIKE '%status%'
      LIMIT 1
    );
  END IF;
END $$;

ALTER TABLE po_payments
  ADD CONSTRAINT po_payments_status_check
  CHECK (status IN (
    'pending_procurement',
    'pending_payment',
    'partially_paid',
    'paid',
    'procurement_rejected',
    'payment_rejected'
  ));

-- ── Feature 2: Vendor quotes for PO comparison sheet ──────────────────────

CREATE TABLE IF NOT EXISTS po_vendor_quotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_payment_id   UUID NOT NULL REFERENCES po_payments(id) ON DELETE CASCADE,
  vendor_name     TEXT NOT NULL,
  item_description TEXT,
  unit_price      NUMERIC,
  quantity        NUMERIC,
  total_price     NUMERIC NOT NULL,
  gst_percent     NUMERIC,
  delivery_days   INTEGER,
  payment_terms   TEXT,
  is_selected     BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_vendor_quotes_po_id ON po_vendor_quotes(po_payment_id);

-- ── Feature 3: Expense overspend tracking ─────────────────────────────────

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS overspend_amount NUMERIC DEFAULT 0;
