-- Set food rate to ₹300/person/day for Vinfast Jikarpur so the site can take food imprest.
-- NOTE: Hub's finance.food_rates has no UNIQUE constraint on `site` (only PK on id),
-- so ON CONFLICT (site) is not usable here — use a NOT EXISTS guard for idempotency.
INSERT INTO finance.food_rates (site, rate)
SELECT 'Vinfast Jikarpur', 300
WHERE NOT EXISTS (SELECT 1 FROM finance.food_rates WHERE site = 'Vinfast Jikarpur');
