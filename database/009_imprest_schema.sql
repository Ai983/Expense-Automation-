-- ============================================================
-- IMPREST REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS imprest_requests (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref_id                TEXT UNIQUE NOT NULL,             -- IMP-YYYYMMDD-XXXX
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  site                  TEXT NOT NULL,
  category              TEXT NOT NULL CHECK (category IN (
                          'Food Expense',
                          'Site Room',
                          'Travelling',
                          'Labour Expense',
                          'Material Expense',
                          'Other'
                        )),
  people_count          INTEGER NOT NULL DEFAULT 1 CHECK (people_count > 0),
  amount_requested      NUMERIC(12,2) NOT NULL CHECK (amount_requested > 0),
  purpose               TEXT,

  -- Food: rate is system-locked; stored for audit
  per_person_rate       NUMERIC(10,2),                    -- null for non-food categories
  rate_source           TEXT,                             -- 'system_fixed' | 'user_entered' | 'ai_estimated'

  -- Travelling fields
  travel_from           TEXT,
  travel_to             TEXT,
  ai_estimated_amount   NUMERIC(12,2),                    -- AI predicted cost
  ai_estimated_distance_km NUMERIC(10,2),                 -- Distance in km
  user_edited_amount    BOOLEAN NOT NULL DEFAULT false,   -- Did user change AI amount?
  amount_deviation      NUMERIC(12,2),                    -- Difference: requested - ai_estimated

  -- Approval
  requested_to          UUID REFERENCES employees(id),    -- Manager/finance user
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',
                            'approved',
                            'rejected',
                            'partially_approved'
                          )),
  approved_amount       NUMERIC(12,2),                    -- Finance can approve partial amount
  rejection_reason      TEXT,
  approved_by           UUID REFERENCES employees(id),
  approved_at           TIMESTAMPTZ,

  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update trigger
CREATE TRIGGER imprest_updated_at
  BEFORE UPDATE ON imprest_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FOOD RATES CONFIG TABLE
-- Stores per-person daily food rate per site
-- Finance/admin can update these from dashboard
-- ============================================================
CREATE TABLE IF NOT EXISTS food_rates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site        TEXT NOT NULL UNIQUE,
  rate        NUMERIC(10,2) NOT NULL CHECK (rate > 0),
  updated_by  UUID REFERENCES employees(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: initial food rates
INSERT INTO food_rates (site, rate) VALUES
  ('MAX Hospital, Saket Delhi', 300),
  ('Bhuj', 300),
  ('Vaneet Infra', 300),
  ('Dee Foundation Omaxe, Faridabad', 300),
  ('Auma India Bengaluru', 600),
  ('Minebea Mitsumi', 600),
  ('Hero Homes Ludhiana', 200)
ON CONFLICT (site) DO NOTHING;

-- ============================================================
-- RLS POLICIES
-- ============================================================
ALTER TABLE imprest_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_rates ENABLE ROW LEVEL SECURITY;

-- Employees see only their own imprest requests
CREATE POLICY "imprest_select_own" ON imprest_requests
  FOR SELECT
  USING (
    employee_id = (SELECT id FROM employees WHERE auth_id = auth.uid())
  );

-- All authenticated users can read food rates (needed for mobile form)
CREATE POLICY "food_rates_select_all" ON food_rates
  FOR SELECT
  USING (true);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_imprest_employee   ON imprest_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_imprest_status     ON imprest_requests(status);
CREATE INDEX IF NOT EXISTS idx_imprest_site       ON imprest_requests(site);
CREATE INDEX IF NOT EXISTS idx_imprest_submitted  ON imprest_requests(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_imprest_requested_to ON imprest_requests(requested_to);

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE imprest_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE food_rates;
