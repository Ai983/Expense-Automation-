import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// On Hub all Finance tables live in 'finance' schema; on old project they were in 'public'.
const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA ?? 'public';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

// Admin client - bypasses RLS. Used for all backend database operations.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: SUPABASE_SCHEMA },
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Anon client - used only for verifying Supabase Auth tokens
export const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: SUPABASE_SCHEMA },
});

// CPS Procurement System client - used to confirm payment back to CPS
const CPS_SUPABASE_URL = process.env.CPS_SUPABASE_URL;
const CPS_SUPABASE_SERVICE_KEY = process.env.CPS_SUPABASE_SERVICE_KEY;
const CPS_SUPABASE_SCHEMA = process.env.CPS_SUPABASE_SCHEMA ?? 'public';
export const cpsSupabase = CPS_SUPABASE_URL && CPS_SUPABASE_SERVICE_KEY
  ? createClient(CPS_SUPABASE_URL, CPS_SUPABASE_SERVICE_KEY, {
      db: { schema: CPS_SUPABASE_SCHEMA },
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
