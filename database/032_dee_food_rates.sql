-- Set food rate to ₹300/person/day for DEE Development Engineer sites
INSERT INTO finance.food_rates (site, rate) VALUES
  ('DEE Development Engineer - Admin', 300),
  ('DEE Development Engineer - Canteen', 300)
ON CONFLICT (site) DO UPDATE SET rate = EXCLUDED.rate;
