-- HagerStone Expense Tracker - Fix Auth Users
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Creates Supabase auth users for admin, finance, and manager with default password: HagerStone@2024
-- Then links them to the employees table via auth_id

-- ── Step 1: Create auth users (upsert by email) ────────────────────────────────

-- Finance Admin
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change,
  is_super_admin
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(), 'authenticated', 'authenticated',
  'finance@hagerstone.com',
  crypt('HagerStone@2024', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}', '{}',
  NOW(), NOW(), '', '', '', '', false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'finance@hagerstone.com'
);

-- Update password if finance auth user already exists
UPDATE auth.users
SET encrypted_password = crypt('HagerStone@2024', gen_salt('bf')),
    updated_at = NOW()
WHERE email = 'finance@hagerstone.com';

-- System Admin
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change,
  is_super_admin
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(), 'authenticated', 'authenticated',
  'admin@hagerstone.com',
  crypt('HagerStone@2024', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}', '{}',
  NOW(), NOW(), '', '', '', '', false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'admin@hagerstone.com'
);

-- Site Manager
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token,
  email_change_token_new, email_change,
  is_super_admin
)
SELECT
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(), 'authenticated', 'authenticated',
  'manager@hagerstone.com',
  crypt('HagerStone@2024', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}', '{}',
  NOW(), NOW(), '', '', '', '', false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'manager@hagerstone.com'
);

-- ── Step 2: Link auth_id in employees table ────────────────────────────────────
-- Updates employees.auth_id to match the auth.users id for each email

UPDATE employees e
SET auth_id = u.id
FROM auth.users u
WHERE u.email = e.email
  AND (e.auth_id IS NULL OR e.auth_id != u.id);

-- ── Step 3: Also add to auth.identities (required by Supabase for email login) ─

INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  u.id,
  json_build_object('sub', u.id::text, 'email', u.email),
  'email',
  u.id::text,
  NOW(), NOW(), NOW()
FROM auth.users u
WHERE u.email IN ('finance@hagerstone.com', 'admin@hagerstone.com', 'manager@hagerstone.com')
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
  );

-- ── Verify result ──────────────────────────────────────────────────────────────
SELECT e.email, e.name, e.role, e.auth_id, u.id AS auth_user_id,
       CASE WHEN e.auth_id = u.id THEN 'LINKED ✓' ELSE 'MISMATCH ✗' END AS status
FROM employees e
JOIN auth.users u ON u.email = e.email
WHERE e.email IN ('finance@hagerstone.com', 'admin@hagerstone.com', 'manager@hagerstone.com');
