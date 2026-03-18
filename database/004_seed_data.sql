-- HagerStone Expense Tracker - Optional Seed Data
-- Run ONLY in development/testing environments.
-- Creates test finance admin user profile (auth user must be created separately via Supabase Auth).

-- Insert a finance admin employee profile for testing.
-- After running this, create the matching Supabase Auth user with:
--   Email: finance@hagerstone.com  Password: Test@12345
-- Then update auth_id with the UUID from auth.users table:
--   UPDATE employees SET auth_id = '<auth.users.id>' WHERE email = 'finance@hagerstone.com';

INSERT INTO employees (id, email, name, phone, site, role, status)
VALUES
  (uuid_generate_v4(), 'finance@hagerstone.com',  'Finance Admin',   '+91-9000000001', 'Mumbai',    'finance',  'active'),
  (uuid_generate_v4(), 'admin@hagerstone.com',    'System Admin',    '+91-9000000002', 'Mumbai',    'admin',    'active'),
  (uuid_generate_v4(), 'manager@hagerstone.com',  'Site Manager',    '+91-9000000003', 'Delhi',     'manager',  'active')
ON CONFLICT (email) DO NOTHING;
