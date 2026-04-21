import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok, fail } from '../utils/responseHelper.js';

const router = Router();

// POST /api/feedback — Employee submits feedback
router.post('/', authMiddleware, roleGuard(['employee']), async (req, res, next) => {
  try {
    const { rating, comment } = req.body;

    if (!rating && !comment?.trim()) {
      return fail(res, 'Please provide a rating or comment');
    }
    if (rating !== undefined && rating !== null && (rating < 1 || rating > 5 || !Number.isInteger(rating))) {
      return fail(res, 'Rating must be an integer between 1 and 5');
    }

    const row = { employee_id: req.user.id };
    if (rating) row.rating = rating;
    if (comment?.trim()) row.comment = comment.trim();

    const { data, error } = await supabaseAdmin
      .from('feedback')
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return ok(res, data, 201);
  } catch (err) {
    next(err);
  }
});

// GET /api/feedback — Approvers/finance view all feedback
router.get('/', authMiddleware, roleGuard(['approver_s2', 'finance', 'manager', 'admin']), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabaseAdmin
      .from('feedback')
      .select('id, rating, comment, created_at, employee:employees(name, email, site)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return ok(res, { feedback: data, total: count, page, limit });
  } catch (err) {
    next(err);
  }
});

export default router;
