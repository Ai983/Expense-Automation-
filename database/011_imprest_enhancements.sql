-- ============================================================
-- 011: Imprest Category & Schema Enhancements (v3 - correct order)
-- ============================================================

-- Step 1: DROP the old constraint FIRST (before any data changes)
ALTER TABLE imprest_requests DROP CONSTRAINT IF EXISTS imprest_requests_category_check;

-- Also drop inline unnamed check constraints
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_name = 'imprest_requests'
      AND constraint_type = 'CHECK'
  LOOP
    EXECUTE 'ALTER TABLE imprest_requests DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
  END LOOP;
END $$;

-- Step 2: NOW safely update existing data
UPDATE imprest_requests SET category = 'Site Room Rent' WHERE category = 'Site Room';
UPDATE imprest_requests SET category = 'Other' WHERE category = 'Material Expense';

-- Step 3: Add the new constraint with all allowed values
ALTER TABLE imprest_requests ADD CONSTRAINT imprest_requests_category_check
  CHECK (category IN (
    'Food Expense',
    'Site Room Rent',
    'Travelling',
    'Conveyance',
    'Labour Expense',
    'Porter',
    'Hotel Expense',
    'Other'
  ));

-- Step 4: Add new columns
ALTER TABLE imprest_requests
  ADD COLUMN IF NOT EXISTS date_from          DATE,
  ADD COLUMN IF NOT EXISTS date_to            DATE,
  ADD COLUMN IF NOT EXISTS travel_subtype     TEXT,
  ADD COLUMN IF NOT EXISTS travel_date        DATE,
  ADD COLUMN IF NOT EXISTS conveyance_mode    TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type       TEXT,
  ADD COLUMN IF NOT EXISTS labour_subcategory TEXT;

-- Step 5: Add food rates for new sites
INSERT INTO food_rates (site, rate) VALUES
  ('Bansal Tower', 300),
  ('KOKO Town, Chandigarh', 300),
  ('Head Office', 300),
  ('Bangalore Office', 600)
ON CONFLICT (site) DO NOTHING;
