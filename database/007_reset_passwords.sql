-- Reset passwords for all staff accounts using Supabase's auth admin
-- Run in: Supabase Dashboard → SQL Editor → New Query

-- Reset passwords for staff + test employee account
UPDATE auth.users
SET
  encrypted_password = extensions.crypt('HagerStone@2024', extensions.gen_salt('bf')),
  updated_at = NOW(),
  email_confirmed_at = NOW(),
  confirmation_token = '',
  recovery_token = '',
  banned_until = NULL
WHERE email IN (
  'finance@hagerstone.com',
  'admin@hagerstone.com',
  'manager@hagerstone.com',
  'shubhdwivedi2003@gmail.com'
);

-- Verify all users have auth_id linked in employees table
UPDATE employees e
SET auth_id = u.id
FROM auth.users u
WHERE u.email = e.email
  AND (e.auth_id IS NULL OR e.auth_id != u.id);

-- Confirm result
SELECT
  e.email,
  e.name,
  e.role,
  u.email_confirmed_at,
  u.last_sign_in_at,
  CASE WHEN e.auth_id = u.id THEN 'LINKED ✓' ELSE 'MISMATCH ✗' END AS link_status
FROM employees e
JOIN auth.users u ON u.email = e.email
ORDER BY e.role;
