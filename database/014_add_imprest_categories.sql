-- Migration 014: Add Site Expense and Material Expense to imprest categories

-- Drop the existing constraint
ALTER TABLE imprest_requests DROP CONSTRAINT IF EXISTS imprest_requests_category_check;

-- Re-create with the two new categories included
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
    'Material Expense',
    'Other'
  ));
