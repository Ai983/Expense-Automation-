-- Fix: ensure HSE-20260504-0010 has the correct original submitted amount
-- Finance reduced ₹1469 → ₹334, so original_amount must be 1469 (not 334)
UPDATE expenses
SET original_amount = 1469
WHERE ref_id = 'HSE-20260504-0010';

-- Verify
SELECT ref_id, amount, original_amount, status
FROM expenses
WHERE ref_id = 'HSE-20260504-0010';
