-- STEP 1: Diagnose — see what employee_id is currently set on the adjusted expense
SELECT
  e.id,
  e.ref_id,
  e.employee_id,
  e.amount,
  e.original_amount,
  e.status,
  emp.name AS employee_name,
  emp.email AS employee_email
FROM expenses e
LEFT JOIN employees emp ON emp.id = e.employee_id
WHERE e.ref_id = 'HSE-20260504-0010';

-- STEP 2: Find Divyansh's employee record
SELECT id, name, email, auth_id, site, status
FROM employees
WHERE email ILIKE '%divyansh%'
   OR name  ILIKE '%divyansh%';

-- STEP 3: Fix — link the expense to Divyansh's employee record
-- (Run this only after confirming his employee id from STEP 2)
UPDATE expenses
SET employee_id = (
  SELECT id FROM employees
  WHERE email = 'divyansh@hagerstone.com'
  ORDER BY created_at ASC   -- use the oldest row if duplicates exist
  LIMIT 1
)
WHERE ref_id = 'HSE-20260504-0010';

-- STEP 4: Also make sure original_amount is correct
UPDATE expenses
SET original_amount = 1469
WHERE ref_id = 'HSE-20260504-0010';

-- STEP 5: Verify the final state
SELECT
  e.ref_id,
  e.amount,
  e.original_amount,
  e.status,
  e.employee_id,
  emp.name,
  emp.email
FROM expenses e
LEFT JOIN employees emp ON emp.id = e.employee_id
WHERE e.ref_id = 'HSE-20260504-0010';
