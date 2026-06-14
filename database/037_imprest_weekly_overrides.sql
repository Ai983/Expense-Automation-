-- Migration 037: Weekly emergency-limit override per site
--
-- The imprest submit handler blocks a site from raising more than one
-- imprest > ₹10,000 per calendar week (Head Office exempt). This table lets
-- Finance/admin grant a one-week exception for a specific site from the web
-- dashboard. An override is scoped to a single calendar week (week_start =
-- that week's Monday) and is irrelevant once the week rolls over, so it
-- "auto-expires" with no cleanup required.

CREATE TABLE IF NOT EXISTS finance.imprest_weekly_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site        TEXT NOT NULL,
  week_start  DATE NOT NULL,                 -- Monday 00:00 of the granted week
  expires_at  TIMESTAMPTZ NOT NULL,          -- next Monday (informational / cleanup)
  reason      TEXT,
  created_by  UUID REFERENCES finance.employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- only one active override per site per week
  CONSTRAINT imprest_weekly_overrides_site_week_unique UNIQUE (site, week_start)
);

CREATE INDEX IF NOT EXISTS idx_imprest_weekly_overrides_site_week
  ON finance.imprest_weekly_overrides (site, week_start);
