-- Migration 043: point director_approved_by at finance.employees
-- 035 added the column with an unqualified `REFERENCES employees(id)`, which
-- resolved to public.employees. Approvers live in finance.employees, so any
-- dashboard Director approval (S2 acting for the Director) failed with
-- imprest_requests_director_approved_by_fkey.
--
-- NOT VALID: older rows may hold ids that only exist in public.employees; the
-- constraint is enforced for every new write without rechecking those.

ALTER TABLE finance.imprest_requests
  DROP CONSTRAINT IF EXISTS imprest_requests_director_approved_by_fkey;

ALTER TABLE finance.imprest_requests
  ADD CONSTRAINT imprest_requests_director_approved_by_fkey
  FOREIGN KEY (director_approved_by) REFERENCES finance.employees(id) NOT VALID;
