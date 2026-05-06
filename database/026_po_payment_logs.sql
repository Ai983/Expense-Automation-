-- Add payment_logs JSONB to store per-payment history entries
ALTER TABLE po_payments
  ADD COLUMN IF NOT EXISTS payment_logs JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Restore HI-PO-2026-0055-R1:
--   • Clear finance_adjusted_amount so total_amount (15300) is used as authoritative
--   • Keep paid_amount = 7650 (the payment already made)
--   • Reset status to partially_paid so it reappears in the payment queue
--   • Seed payment_logs with the payment that was already recorded
UPDATE po_payments
SET
  status                  = 'partially_paid',
  finance_adjusted_amount = NULL,
  paid_at                 = NULL,
  payment_logs            = jsonb_build_array(
    jsonb_build_object(
      'amount',   7650,
      'paid_at',  paid_at,
      'notes',    finance_notes,
      'receipt',  payment_receipt_path
    )
  )
WHERE cps_po_ref = 'HI-PO-2026-0055-R1';
