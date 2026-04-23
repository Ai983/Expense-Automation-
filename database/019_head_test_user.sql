-- ============================================================
-- Migration 019: Create test Head user
-- Email:    head@hagerstone.com
-- Password: HagerStone@2024
-- Role:     head  (read-only unified dashboard)
-- ============================================================

-- ── Step 1: Run 018 first (adds 'head' to role constraint) ────────────────────
-- If you haven't run 018_head_role.sql yet, run it before this file.

-- ── Step 2: Create Supabase Auth user ────────────────────────────────────────
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
  'head@hagerstone.com',
  crypt('HagerStone@2024', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Head (Test)"}',
  NOW(), NOW(), '', '', '', '', false
WHERE NOT EXISTS (
  SELECT 1 FROM auth.users WHERE email = 'head@hagerstone.com'
);

-- Reset password if user already exists
UPDATE auth.users
SET encrypted_password = crypt('HagerStone@2024', gen_salt('bf')),
    updated_at = NOW()
WHERE email = 'head@hagerstone.com';

-- ── Step 3: Create identity (required for email login) ────────────────────────
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
WHERE u.email = 'head@hagerstone.com'
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  );

-- ── Step 4: Create employee row ───────────────────────────────────────────────
INSERT INTO employees (auth_id, email, name, site, role, status)
SELECT
  u.id,
  'head@hagerstone.com',
  'Head (Test)',
  'Head Office',
  'head',
  'active'
FROM auth.users u
WHERE u.email = 'head@hagerstone.com'
  AND NOT EXISTS (
    SELECT 1 FROM employees WHERE email = 'head@hagerstone.com'
  );

-- Link auth_id if employee row already exists
UPDATE employees e
SET auth_id = u.id, role = 'head'
FROM auth.users u
WHERE u.email = 'head@hagerstone.com'
  AND e.email = 'head@hagerstone.com';

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  e.email, e.name, e.role, e.site, e.status,
  CASE WHEN e.auth_id = u.id THEN 'LINKED ✓' ELSE 'MISMATCH ✗' END AS auth_status
FROM employees e
JOIN auth.users u ON u.email = e.email
WHERE e.email = 'head@hagerstone.com';
