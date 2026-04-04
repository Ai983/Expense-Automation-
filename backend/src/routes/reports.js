import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { ok, fail } from '../utils/responseHelper.js';

const router = Router();
const N8N_SECRET = process.env.N8N_INTERNAL_SECRET || '';

// ── GET /api/reports/weekly ──────────────────────────────────────────────────
// Called by n8n WF3 every Saturday. Secured by x-n8n-secret header.
router.get('/weekly', async (req, res, next) => {
  try {
    const secret = req.headers['x-n8n-secret'];
    if (!N8N_SECRET || secret !== N8N_SECRET) {
      return fail(res, 'Unauthorized', 401);
    }

    // Calculate week range (last 7 days)
    const now = new Date();
    const weekEnd = now.toISOString().split('T')[0];
    const weekStartDate = new Date(now);
    weekStartDate.setDate(weekStartDate.getDate() - 7);
    const weekStart = weekStartDate.toISOString().split('T')[0];

    // ── Imprest stats ─────────────────────────────────────────────────────
    const { data: imprests } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, status, amount_requested, approved_amount, site')
      .gte('submitted_at', weekStart)
      .lte('submitted_at', weekEnd + 'T23:59:59Z');

    const imprestRows = imprests || [];
    const imprestStats = {
      totalRequests: imprestRows.length,
      totalAmountRequested: imprestRows.reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0),
      totalAmountApproved: imprestRows
        .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
        .reduce((s, r) => s + parseFloat(r.approved_amount || 0), 0),
      approved: imprestRows.filter((r) => r.status === 'approved' || r.status === 'partially_approved').length,
      rejected: imprestRows.filter((r) => r.status === 'rejected').length,
      pending: imprestRows.filter((r) => r.status === 'pending').length,
      bySite: [],
    };

    // Group by site
    const siteMap = {};
    for (const r of imprestRows) {
      if (!siteMap[r.site]) siteMap[r.site] = { site: r.site, count: 0, amount: 0 };
      siteMap[r.site].count++;
      siteMap[r.site].amount += parseFloat(r.amount_requested || 0);
    }
    imprestStats.bySite = Object.values(siteMap)
      .map((s) => ({ ...s, amount: Math.round(s.amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount);

    // ── Expense stats ────────────────────────────────────────────────────
    const { data: expenses } = await supabaseAdmin
      .from('expenses')
      .select('id, status, amount')
      .gte('submitted_at', weekStart)
      .lte('submitted_at', weekEnd + 'T23:59:59Z');

    const expenseRows = expenses || [];
    const expenseStats = {
      totalSubmitted: expenseRows.length,
      totalAmount: Math.round(expenseRows.reduce((s, e) => s + parseFloat(e.amount || 0), 0) * 100) / 100,
      approved: expenseRows.filter((e) => e.status === 'approved').length,
      rejected: expenseRows.filter((e) => e.status === 'rejected').length,
      pending: expenseRows.filter((e) => ['pending', 'verified', 'manual_review'].includes(e.status)).length,
    };

    return ok(res, {
      weekStart,
      weekEnd,
      imprest: {
        ...imprestStats,
        totalAmountRequested: Math.round(imprestStats.totalAmountRequested * 100) / 100,
        totalAmountApproved: Math.round(imprestStats.totalAmountApproved * 100) / 100,
      },
      expenses: expenseStats,
    });
  } catch (err) { next(err); }
});

export default router;
