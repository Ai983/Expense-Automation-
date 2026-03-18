-- Fix "404 Employee profile not found" on login
-- Use when a user exists in Supabase Auth but has no row in employees (e.g. created via dashboard or old flow).
-- Run in Supabase: SQL Editor → New query → paste → Run.

-- Option A: Sync one user by email (creates employee row from auth.users)
-- Replace the email below with the user's email.
INSERT INTO public.employees (auth_id, email, name, site, role, status)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1), 'User'),
  'Pune',
  'employee',
  'active'
FROM auth.users u
WHERE u.email = 'shubhdwivedi2003@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.auth_id = u.id);

-- If you need to fix multiple users, run Option B in a separate query:

-- Option B: Sync all auth users that don't have an employee row yet
-- INSERT INTO public.employees (auth_id, email, name, site, role, status)
-- SELECT
--   u.id,
--   u.email,
--   COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1), 'User'),
--   'Pune',
--   'employee',
--   'active'
-- FROM auth.users u
-- WHERE NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.auth_id = u.id);
