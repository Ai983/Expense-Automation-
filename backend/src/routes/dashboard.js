import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok } from '../utils/responseHelper.js';
import { FINANCE_ROLES } from '../config/constants.js';

const router = Router();

// All dashboard routes require finance/manager/admin role
router.use(authMiddleware, roleGuard(FINANCE_ROLES));

// GET /api/dashboard/metrics — key headline numbers
router.get('/metrics', async (req, res, next) => {
  try {
    const [totalRes, pendingRes, autoVerifiedRes, totalAmountRes] = await Promise.all([
      supabaseAdmin.from('expenses').select('id', { count: 'exact', head: true }),
      supabaseAdmin
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'verified', 'manual_review']),
      supabaseAdmin
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'verified'),
      supabaseAdmin.from('expenses').select('amount').neq('status', 'rejected').neq('status', 'blocked'),
    ]);

    const total = totalRes.count || 0;
    const pending = pendingRes.count || 0;
    const autoVerified = autoVerifiedRes.count || 0;
    const totalAmount = (totalAmountRes.data || []).reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const autoVerifyRate = total > 0 ? Math.round((autoVerified / total) * 100) : 0;

    return ok(res, {
      totalExpenses: total,
      pendingApproval: pending,
      autoVerified,
      autoVerifyRate,
      totalAmountProcessed: Math.round(totalAmount * 100) / 100,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/by-site — expense counts and amounts grouped by site
router.get('/by-site', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('expenses')
      .select('site, amount, status');

    if (error) throw error;

    const siteMap = {};
    for (const exp of data) {
      if (!siteMap[exp.site]) siteMap[exp.site] = { site: exp.site, count: 0, totalAmount: 0 };
      siteMap[exp.site].count++;
      siteMap[exp.site].totalAmount += parseFloat(exp.amount);
    }

    const result = Object.values(siteMap).map((s) => ({
      ...s,
      totalAmount: Math.round(s.totalAmount * 100) / 100,
    }));

    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/by-category
router.get('/by-category', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('expenses')
      .select('category, amount')
      .neq('status', 'rejected')
      .neq('status', 'blocked');

    if (error) throw error;

    const catMap = {};
    for (const exp of data) {
      if (!catMap[exp.category]) catMap[exp.category] = { category: exp.category, count: 0, totalAmount: 0 };
      catMap[exp.category].count++;
      catMap[exp.category].totalAmount += parseFloat(exp.amount);
    }

    const result = Object.values(catMap).map((c) => ({
      ...c,
      totalAmount: Math.round(c.totalAmount * 100) / 100,
    }));

    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/by-status
router.get('/by-status', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('expenses')
      .select('status, amount');

    if (error) throw error;

    const statusMap = {};
    for (const exp of data) {
      if (!statusMap[exp.status]) statusMap[exp.status] = { status: exp.status, count: 0, totalAmount: 0 };
      statusMap[exp.status].count++;
      statusMap[exp.status].totalAmount += parseFloat(exp.amount);
    }

    return ok(res, Object.values(statusMap));
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/recent-activity — last 20 actions from audit trail
router.get('/recent-activity', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('audit_trail')
      .select(`
        id, action, entity_type, entity_id, timestamp,
        user:user_id (name, email, role)
      `)
      .order('timestamp', { ascending: false })
      .limit(20);

    if (error) throw error;
    return ok(res, data);
  } catch (err) {
    next(err);
  }
});

export default router;
