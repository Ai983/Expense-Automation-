import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { ok, fail } from '../utils/responseHelper.js';
import { sendWhatsApp } from '../services/whatsappService.js';

const router = Router();
const N8N_SECRET = process.env.N8N_INTERNAL_SECRET || '';
const FOUNDER_PHONE = process.env.FOUNDER_PHONE || '';

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

// ── GET /api/reports/monthly ─────────────────────────────────────────────────
router.get('/monthly', async (req, res, next) => {
  try {
    const secret = req.headers['x-n8n-secret'];
    if (!N8N_SECRET || secret !== N8N_SECRET) return fail(res, 'Unauthorized', 401);

    const now = new Date();
    const monthEnd = now.toISOString().split('T')[0];
    const monthStartDate = new Date(now);
    monthStartDate.setDate(monthStartDate.getDate() - 30);
    const monthStart = monthStartDate.toISOString().split('T')[0];

    const { data: imprests } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, status, amount_requested, approved_amount, site')
      .gte('submitted_at', monthStart).lte('submitted_at', monthEnd + 'T23:59:59Z');

    const imprestRows = imprests || [];
    const siteMap = {};
    for (const r of imprestRows) {
      if (!siteMap[r.site]) siteMap[r.site] = { site: r.site, count: 0, amount: 0 };
      siteMap[r.site].count++;
      siteMap[r.site].amount += parseFloat(r.amount_requested || 0);
    }

    const { data: expenses } = await supabaseAdmin
      .from('expenses').select('id, status, amount')
      .gte('submitted_at', monthStart).lte('submitted_at', monthEnd + 'T23:59:59Z');

    const expenseRows = expenses || [];

    return ok(res, {
      monthStart, monthEnd,
      imprest: {
        totalRequests: imprestRows.length,
        totalAmountRequested: Math.round(imprestRows.reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0)),
        totalAmountApproved: Math.round(imprestRows.filter((r) => ['approved', 'partially_approved'].includes(r.status))
          .reduce((s, r) => s + parseFloat(r.approved_amount || 0), 0)),
        approved: imprestRows.filter((r) => ['approved', 'partially_approved'].includes(r.status)).length,
        rejected: imprestRows.filter((r) => r.status === 'rejected').length,
        pending: imprestRows.filter((r) => r.status === 'pending').length,
        bySite: Object.values(siteMap).map((s) => ({ ...s, amount: Math.round(s.amount) })).sort((a, b) => b.amount - a.amount),
      },
      expenses: {
        totalSubmitted: expenseRows.length,
        totalAmount: Math.round(expenseRows.reduce((s, e) => s + parseFloat(e.amount || 0), 0)),
        approved: expenseRows.filter((e) => e.status === 'approved').length,
        rejected: expenseRows.filter((e) => e.status === 'rejected').length,
        pending: expenseRows.filter((e) => ['pending', 'verified', 'manual_review'].includes(e.status)).length,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/reports/send ──────────────────────────────────────────────────
// Triggered by n8n cron. Fetches report data and sends via WhatsApp to Dhruv Sir.
router.post('/send', async (req, res, next) => {
  try {
    const secret = req.headers['x-n8n-secret'];
    if (!N8N_SECRET || secret !== N8N_SECRET) return fail(res, 'Unauthorized', 401);

    const { period } = req.body;
    if (!period || !['weekly', 'monthly'].includes(period)) {
      return fail(res, 'period must be "weekly" or "monthly"');
    }

    if (!FOUNDER_PHONE) return fail(res, 'FOUNDER_PHONE not configured');

    // Internally fetch the report
    const days = period === 'weekly' ? 7 : 30;
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    const start = startDate.toISOString().split('T')[0];

    const { data: imprests } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, status, amount_requested, approved_amount, site')
      .gte('submitted_at', start).lte('submitted_at', endDate + 'T23:59:59Z');

    const { data: expenses } = await supabaseAdmin
      .from('expenses').select('id, status, amount')
      .gte('submitted_at', start).lte('submitted_at', endDate + 'T23:59:59Z');

    const imprestRows = imprests || [];
    const expenseRows = expenses || [];

    const totalRequested = Math.round(imprestRows.reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0));
    const totalApproved = Math.round(imprestRows.filter((r) => ['approved', 'partially_approved'].includes(r.status))
      .reduce((s, r) => s + parseFloat(r.approved_amount || 0), 0));
    const impPending = imprestRows.filter((r) => r.status === 'pending').length;
    const impApproved = imprestRows.filter((r) => ['approved', 'partially_approved'].includes(r.status)).length;
    const impRejected = imprestRows.filter((r) => r.status === 'rejected').length;

    const expTotal = Math.round(expenseRows.reduce((s, e) => s + parseFloat(e.amount || 0), 0));
    const expApproved = expenseRows.filter((e) => e.status === 'approved').length;
    const expPending = expenseRows.filter((e) => ['pending', 'verified', 'manual_review'].includes(e.status)).length;

    // Top 3 sites by amount
    const siteMap = {};
    for (const r of imprestRows) {
      if (!siteMap[r.site]) siteMap[r.site] = { site: r.site, amount: 0 };
      siteMap[r.site].amount += parseFloat(r.amount_requested || 0);
    }
    const topSites = Object.values(siteMap).sort((a, b) => b.amount - a.amount).slice(0, 3);

    const fmt = (n) => `Rs.${Number(n).toLocaleString('en-IN')}`;
    const label = period === 'weekly' ? 'WEEKLY' : 'MONTHLY';

    const message = `*HAGERSTONE ${label} REPORT*\n${start} to ${endDate}\n\n` +
      `*IMPREST ADVANCES*\n` +
      `Total Requests: ${imprestRows.length}\n` +
      `Amount Requested: ${fmt(totalRequested)}\n` +
      `Amount Approved: ${fmt(totalApproved)}\n` +
      `Approved: ${impApproved} | Rejected: ${impRejected} | Pending: ${impPending}\n\n` +
      `*Top Sites by Amount:*\n` +
      topSites.map((s) => `  ${s.site}: ${fmt(Math.round(s.amount))}`).join('\n') + '\n\n' +
      `*EXPENSES*\n` +
      `Total Submitted: ${expenseRows.length}\n` +
      `Total Amount: ${fmt(expTotal)}\n` +
      `Approved: ${expApproved} | Pending: ${expPending}\n\n` +
      `— HagerStone Finance System`;

    await sendWhatsApp(FOUNDER_PHONE, message);

    return ok(res, { sent: true, to: FOUNDER_PHONE, period });
  } catch (err) { next(err); }
});

export default router;
