import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { ok } from '../utils/responseHelper.js';
import { getProjectSites } from '../config/sites.js';

const router = Router();

// All project routes require auth (any authenticated employee — used by site pickers)
router.use(authMiddleware);

// GET /api/projects — canonical active site list from the unified master.
// Frontends use this instead of a hardcoded SITES array.
router.get('/', async (req, res, next) => {
  try {
    const sites = await getProjectSites();
    return ok(res, sites);
  } catch (err) { next(err); }
});

export default router;
