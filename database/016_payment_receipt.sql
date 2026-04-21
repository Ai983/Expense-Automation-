-- Add payment receipt storage path to imprest_requests
ALTER TABLE imprest_requests ADD COLUMN IF NOT EXISTS payment_receipt_path TEXT;
