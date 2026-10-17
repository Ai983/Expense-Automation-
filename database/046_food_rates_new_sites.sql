-- Migration 046: food rates for sites added to the Hub after the 17 Jun 2026 unification.
-- A site added in the Hub gets no food_rates row, so the app showed "No food rate configured"
-- and employees typed the food amount by hand (no rate cap, incl. the Sunday rule's cap).
-- ₹300/person/day, the standard rate. food_rates has no UNIQUE on site — NOT EXISTS guard (see 033, 042).
INSERT INTO finance.food_rates (site, rate)
SELECT s.site, 300
FROM (VALUES
  ('Daxin - Signature Global'),
  ('VST Ashok Leyland Jaipur'),
  ('Studio Ardete'),
  ('Canteen - Bhuj'),
  ('Metalman'),
  ('Western Green'),
  ('Hager Stone International Private Limited'),
  ('isgec'),
  ('Vinfast Tonk Road Jaipur'),
  ('Vinfast Jotwara Workshop Jaipur'),
  ('Vinfast Vaishali Jaipur'),
  ('Theon Pharmaceuticals Pvt Ltd'),
  ('Consern Pharma Limited')
) AS s(site)
WHERE NOT EXISTS (SELECT 1 FROM finance.food_rates r WHERE r.site = s.site);
