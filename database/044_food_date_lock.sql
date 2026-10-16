-- Migration 044: Food imprest date lock
-- An employee may not raise two Food Expense imprests whose dates overlap
-- (e.g. 1–15 Oct twice). Enforced in POST /api/imprest/submit; these columns
-- carry the one exception and the warning shown to S2.
--
--   for_others        — the request is for other people's food (contractors /
--                       labour), not the employee's own. It skips the hard block
--                       and is never counted as the employee's own food.
--   for_others_names  — who it is for; required when for_others = true.
--   food_overlaps     — snapshot taken at submit of overlapping Food imprests
--                       (same employee as for-others, or other employees at the
--                       same site). Array of { ref_id, employee_name, date_from,
--                       date_to, people_count, same_employee }. Shown to S2 only.
--
-- Additive only: existing rows get for_others = false, NULL names/overlaps.

ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS for_others        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS for_others_names  TEXT,
  ADD COLUMN IF NOT EXISTS food_overlaps     JSONB;

-- Overlap lookups filter by employee + category over the date range.
CREATE INDEX IF NOT EXISTS idx_imprest_requests_food_dates
  ON finance.imprest_requests (employee_id, category, date_from, date_to);
