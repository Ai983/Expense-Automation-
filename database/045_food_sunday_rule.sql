-- Migration 045: Food imprest Sunday rule
-- Sunday is the weekly off (hr.attendance_settings.weekend_dows = {0}). Food
-- used to be paid for every calendar day, Sundays included — ~14% of all food
-- money. Now, for every site alike, Sundays are not paid unless the employee
-- ticks each Sunday they will work. Enforced in POST /api/imprest/submit.
--
--   food_sundays_worked — Sundays the employee ticked as working days.
--                         NULL = request raised before this rule (all its
--                         Sundays were paid); '{}' = no Sunday paid.
--   food_billable_days  — days paid: calendar days − unticked Sundays.
--
-- food_sunday_check() lists, for paid food imprests, every paid Sunday that has
-- passed with the employee's HR punch-in (hr.attendance_day, matched by name —
-- the two systems share no employee id). Finance reviews it; nothing is
-- deducted automatically.

ALTER TABLE finance.imprest_requests
  ADD COLUMN IF NOT EXISTS food_sundays_worked DATE[],
  ADD COLUMN IF NOT EXISTS food_billable_days  INTEGER;

CREATE OR REPLACE FUNCTION finance.food_sunday_check(p_since DATE DEFAULT current_date - 120)
RETURNS TABLE (
  imprest_id     UUID,
  ref_id         TEXT,
  employee_id    UUID,
  employee_name  TEXT,
  site           TEXT,
  people_count   INTEGER,
  sunday         DATE,
  day_amount     NUMERIC,
  under_rule     BOOLEAN,
  punch_status   TEXT,
  punched_at     TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = finance, hr, public
AS $$
  WITH f AS (
    SELECT i.id, i.ref_id::text AS ref_id, i.employee_id, e.name::text AS name,
      lower(trim(e.name)) AS k, i.site::text AS site, i.people_count::int AS people_count,
      i.food_sundays_worked IS NOT NULL AS under_rule,
      coalesce(i.paid_amount, i.approved_amount, i.amount_requested)
        / greatest(1, coalesce(i.food_billable_days, i.date_to - i.date_from + 1)) AS day_amount,
      d::date AS sun
    FROM finance.imprest_requests i
    JOIN finance.employees e ON e.id = i.employee_id
    CROSS JOIN LATERAL generate_series(i.date_from, i.date_to, interval '1 day') d
    WHERE i.category = 'Food Expense' AND i.paid
      AND i.date_to >= p_since
      AND extract(dow FROM d) = 0 AND d::date < current_date
      -- under the rule only ticked Sundays were paid; before it, all were
      AND (i.food_sundays_worked IS NULL OR d::date = ANY (i.food_sundays_worked))
  ), a AS (
    SELECT lower(trim(full_name)) AS k, work_date, min(in_at) AS in_at
    FROM hr.attendance_day
    WHERE work_date IN (SELECT DISTINCT sun FROM f)
    GROUP BY 1, 2
  )
  SELECT f.id, f.ref_id, f.employee_id, f.name, f.site, f.people_count, f.sun,
    round(f.day_amount, 2), f.under_rule,
    CASE WHEN a.in_at IS NOT NULL THEN 'worked'
         WHEN a.work_date IS NOT NULL THEN 'not_worked'
         ELSE 'no_record' END,
    a.in_at
  FROM f LEFT JOIN a ON a.k = f.k AND a.work_date = f.sun
  ORDER BY f.sun DESC, f.name;
$$;

-- SECURITY DEFINER reads hr.*: only the backend (service role) may call it.
REVOKE ALL ON FUNCTION finance.food_sunday_check(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.food_sunday_check(DATE) TO service_role;
