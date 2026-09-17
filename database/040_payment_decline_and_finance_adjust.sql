-- 040_payment_decline_and_finance_adjust.sql
-- Finance's payment step after the founder gate: pay a different amount, or
-- decline to pay at all.
--
-- Decline deliberately reuses the existing 's3_rejected' stage (status
-- 'rejected') instead of adding a new stage. Every stage exclusion list — the
-- weekly site limit, the Head board, the mobile app's labels, outstanding-balance
-- sums — already treats s3_rejected correctly, so no client needs an update.
-- payment_declined_at IS NOT NULL is what tells a post-founder decline apart
-- from an ordinary finance rejection before the founder gate.
--
-- Additive and safe to re-run.

ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS finance_adjusted_amount numeric,
  ADD COLUMN IF NOT EXISTS payment_declined_by uuid REFERENCES finance.employees(id),
  ADD COLUMN IF NOT EXISTS payment_declined_at timestamptz;

COMMENT ON COLUMN finance.imprest_requests.finance_adjusted_amount IS
  'Amount finance actually paid when it differs from the founder-approved payout (capped at founder_adjusted_amount, else approved_amount). NULL = paid as approved.';
COMMENT ON COLUMN finance.imprest_requests.payment_declined_by IS
  'Finance user who declined to pay a founder-approved imprest. Stage becomes s3_rejected; reason is in rejection_reason.';
COMMENT ON COLUMN finance.imprest_requests.payment_declined_at IS
  'When finance declined to pay a founder-approved imprest. NULL = not declined.';
