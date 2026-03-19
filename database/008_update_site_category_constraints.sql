-- Update site and category CHECK constraints to match new lists
-- Run in: Supabase Dashboard → SQL Editor → New Query

-- ── employees table: drop old site constraint, add new one ────────────────────
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_site_check;

ALTER TABLE employees
  ADD CONSTRAINT employees_site_check
  CHECK (site IN (
    'Head Office',
    'Andritz',
    'Theon Lifescience',
    'Consern Pharma',
    'Bhuj',
    'Kotputli Project',
    'Bansal Tower Gurugram',
    'VinFast',
    'Minebea Mitsumi',
    'Chattargarh',
    'Valorium',
    'Jasrasar',
    'Hanumangarh',
    'Himalaya',
    'Microsave',
    'Bangalore Branch Office',
    'Vinfast-Ghaziabad',
    'AU Space Office Ludhiana',
    'Vinfast - Patparganj',
    'Auma India Bengaluru',
    'Vaneet Infra',
    'MAX Hospital, Saket Delhi',
    'Dee Foundation Omaxe, Faridabad',
    'Hero Homes Ludhiana',
    'Delhi NCR',
    -- keep old values so existing records don't break
    'Mumbai', 'Delhi', 'Bangalore', 'Pune', 'Hyderabad'
  ));

-- ── expenses table: drop old site constraint, add new one ────────────────────
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_site_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_site_check
  CHECK (site IN (
    'Head Office',
    'Andritz',
    'Theon Lifescience',
    'Consern Pharma',
    'Bhuj',
    'Kotputli Project',
    'Bansal Tower Gurugram',
    'VinFast',
    'Minebea Mitsumi',
    'Chattargarh',
    'Valorium',
    'Jasrasar',
    'Hanumangarh',
    'Himalaya',
    'Microsave',
    'Bangalore Branch Office',
    'Vinfast-Ghaziabad',
    'AU Space Office Ludhiana',
    'Vinfast - Patparganj',
    'Auma India Bengaluru',
    'Vaneet Infra',
    'MAX Hospital, Saket Delhi',
    'Dee Foundation Omaxe, Faridabad',
    'Hero Homes Ludhiana',
    'Delhi NCR',
    'Mumbai', 'Delhi', 'Bangalore', 'Pune', 'Hyderabad'
  ));

-- ── expenses table: drop old category constraint, add new one ────────────────
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_category_check
  CHECK (category IN (
    'Food Expense',
    'Site Room',
    'Travelling',
    'Software',
    'Labour Expense',
    'Material Expense',
    'Site Expense',
    'Office Expense',
    'Employee Welfare',
    'DA- Expense',
    'BT- Expense',
    'Porter Expenses',
    -- keep old values so existing records don't break
    'Vendor', 'Labour', 'Material', 'Transport', 'Other'
  ));

-- ── Confirm ───────────────────────────────────────────────────────────────────
SELECT
  table_name,
  constraint_name,
  check_clause
FROM information_schema.check_constraints
JOIN information_schema.constraint_table_usage USING (constraint_name)
WHERE table_name IN ('employees', 'expenses')
ORDER BY table_name, constraint_name;
