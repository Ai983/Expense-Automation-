-- Add site_budget_note to store cumulative weekly spend context
-- when a request pushes a site over the ₹10,000 weekly limit.
-- Nullable — only set when the limit is breached.
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS site_budget_note TEXT;
