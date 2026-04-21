-- ============================================================
-- 012: Add 'Site Expense' to imprest_requests category constraint
-- ============================================================

-- Step 1: Drop existing constraint
ALTER TABLE imprest_requests DROP CONSTRAINT IF EXISTS imprest_requests_category_check;

-- Step 2: Add updated constraint including Site Expense
ALTER TABLE imprest_requests ADD CONSTRAINT imprest_requests_category_check
  CHECK (category IN (
    'Food Expense',
    'Site Room Rent',
    'Travelling',
    'Conveyance',
    'Labour Expense',
    'Porter',
    'Hotel Expense',
    'Site Expense',
    'Other'
  ));
