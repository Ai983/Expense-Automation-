import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok, fail } from '../utils/responseHelper.js';
import { FINANCE_ROLES } from '../config/constants.js';

const router = Router();

// ── GET /api/employees ────────────────────────────────────────────────────────
// Finance / admin fetches the list of employees (for filter dropdowns)
router.get(
  '/',
  authMiddleware,
  roleGuard(FINANCE_ROLES),
  async (req, res, next) => {
    try {
      const { data: employees, error } = await supabaseAdmin
        .from('employees')
        .select('id, name, email, site, role')
        .eq('status', 'active')
        .eq('role', 'employee')
        .order('name', { ascending: true });

      if (error) throw error;

      return ok(res, { employees });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
