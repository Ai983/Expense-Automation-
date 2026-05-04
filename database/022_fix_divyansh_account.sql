-- Fix: Create / repair Divyansh's account (divyansh@hagerstone.com)
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- Temporary password set to: HagerStone@2024
-- Divyansh must change it after first login via Forgot Password.

-- ── Step 1: Create auth.users record if missing ───────────────────────────────
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
  'divyansh@hagerstone.com',
  crypt('HagerStone@2024', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}', '{}',
  NOW(), NOW(), '', '', '', '', false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'divyansh@hagerstone.com'
);

-- ── Step 2: Reset password + confirm email (handles existing auth user too) ───
UPDATE auth.users
SET encrypted_password  = crypt('HagerStone@2024', gen_salt('bf')),
    email_confirmed_at  = COALESCE(email_confirmed_at, NOW()),
    confirmation_token  = '',
    recovery_token      = '',
    banned_until        = NULL,
    updated_at          = NOW()
WHERE email = 'divyansh@hagerstone.com';

-- ── Step 3: Create employees row if missing ───────────────────────────────────
INSERT INTO employees (auth_id, email, name, site, role, status)
SELECT
  u.id,
  'divyansh@hagerstone.com',
  'Divyansh',
  'Head Office',
  'employee',
  'active'
FROM auth.users u
WHERE u.email = 'divyansh@hagerstone.com'
  AND NOT EXISTS (
    SELECT 1 FROM employees WHERE email = 'divyansh@hagerstone.com'
  );

-- ── Step 4: Link auth_id on existing employees row (if row already existed) ───
UPDATE employees e
SET auth_id = u.id,
    status  = 'active'
FROM auth.users u
WHERE u.email = 'divyansh@hagerstone.com'
  AND e.email = 'divyansh@hagerstone.com'
  AND (e.auth_id IS NULL OR e.auth_id != u.id);

-- ── Step 5: Add auth.identities record (required for email login) ─────────────
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
WHERE u.email = 'divyansh@hagerstone.com'
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  );

-- ── Verify ─────────────────────────────────────────────────────────────────────
SELECT
  e.email,
  e.name,
  e.role,
  e.site,
  e.status,
  CASE WHEN e.auth_id = u.id THEN 'LINKED ✓' ELSE 'MISMATCH ✗' END AS link_status,
  CASE WHEN i.id IS NOT NULL  THEN 'EXISTS ✓'  ELSE 'MISSING ✗'  END AS identity_status
FROM employees e
JOIN auth.users u     ON u.email = e.email
LEFT JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'email'
WHERE e.email = 'divyansh@hagerstone.com';
