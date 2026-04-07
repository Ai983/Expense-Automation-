import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok } from '../utils/responseHelper.js';
import { FINANCE_ROLES, ALL_DASHBOARD_ROLES } from '../config/constants.js';

const router = Router();

// All dashboard routes require auth first
router.use(authMiddleware);

// GET /api/dashboard/metrics — key headline numbers (finance only)
router.get('/metrics', roleGuard(FINANCE_ROLES), async (req, res, next) => {
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
router.get('/by-site', roleGuard(FINANCE_ROLES), async (req, res, next) => {
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
router.get('/by-category', roleGuard(FINANCE_ROLES), async (req, res, next) => {
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
router.get('/by-status', roleGuard(FINANCE_ROLES), async (req, res, next) => {
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
router.get('/recent-activity', roleGuard(FINANCE_ROLES), async (req, res, next) => {
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

// GET /api/dashboard/by-employee — per-employee expense breakdown
router.get('/by-employee', roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { site, from, to } = req.query;

    let query = supabaseAdmin
      .from('expenses')
      .select('id, amount, status, site, category, submitted_at, employee:employee_id (id, name, email, site, role)');

    if (site) query = query.eq('site', site);
    if (from) query = query.gte('submitted_at', from);
    if (to) query = query.lte('submitted_at', to + 'T23:59:59');

    const { data, error } = await query;
    if (error) throw error;

    const empMap = {};
    for (const exp of data) {
      const emp = exp.employee;
      if (!emp) continue;
      if (!empMap[emp.id]) {
        empMap[emp.id] = {
          id: emp.id,
          name: emp.name,
          email: emp.email,
          site: emp.site,
          role: emp.role,
          total: 0,
          totalAmount: 0,
          verified: 0,
          approved: 0,
          pending: 0,
          manual_review: 0,
          rejected: 0,
          blocked: 0,
          lastSubmitted: null,
        };
      }
      const e = empMap[emp.id];
      e.total++;
      e.totalAmount += parseFloat(exp.amount);
      e[exp.status] = (e[exp.status] || 0) + 1;
      if (!e.lastSubmitted || exp.submitted_at > e.lastSubmitted) {
        e.lastSubmitted = exp.submitted_at;
      }
    }

    const result = Object.values(empMap)
      .map((e) => ({
        ...e,
        totalAmount: Math.round(e.totalAmount * 100) / 100,
        autoVerifyRate: e.total > 0 ? Math.round(((e.verified + e.approved) / e.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// IMPREST ANALYTICS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/dashboard/imprest/metrics — headline numbers for imprest
router.get('/imprest/metrics', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    const [totalRes, pendingRes, approvedRes, rejectedRes, partialRes, totalAmountRes] = await Promise.all([
      supabaseAdmin.from('imprest_requests').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('imprest_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('imprest_requests').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
      supabaseAdmin.from('imprest_requests').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      supabaseAdmin.from('imprest_requests').select('id', { count: 'exact', head: true }).eq('status', 'partially_approved'),
      supabaseAdmin.from('imprest_requests').select('amount_requested, approved_amount, status'),
    ]);

    const total = totalRes.count || 0;
    const pending = pendingRes.count || 0;
    const approved = approvedRes.count || 0;
    const rejected = rejectedRes.count || 0;
    const partiallyApproved = partialRes.count || 0;

    const rows = totalAmountRes.data || [];
    const totalRequested = rows.reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0);
    const totalApproved = rows
      .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
      .reduce((s, r) => s + parseFloat(r.approved_amount || 0), 0);

    return ok(res, {
      totalImprests: total,
      pending,
      approved,
      partiallyApproved,
      rejected,
      totalRequested: Math.round(totalRequested * 100) / 100,
      totalApproved: Math.round(totalApproved * 100) / 100,
      approvalRate: total > 0 ? Math.round(((approved + partiallyApproved) / total) * 100) : 0,
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/imprest/by-site — imprest counts and amounts by site
router.get('/imprest/by-site', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('imprest_requests').select('site, amount_requested, approved_amount, status');
    if (error) throw error;

    const siteMap = {};
    for (const r of data) {
      if (!siteMap[r.site]) siteMap[r.site] = { site: r.site, count: 0, totalRequested: 0, totalApproved: 0 };
      siteMap[r.site].count++;
      siteMap[r.site].totalRequested += parseFloat(r.amount_requested || 0);
      if (r.status === 'approved' || r.status === 'partially_approved') {
        siteMap[r.site].totalApproved += parseFloat(r.approved_amount || 0);
      }
    }

    return ok(res, Object.values(siteMap).map((s) => ({
      ...s,
      totalRequested: Math.round(s.totalRequested * 100) / 100,
      totalApproved: Math.round(s.totalApproved * 100) / 100,
    })));
  } catch (err) { next(err); }
});

// GET /api/dashboard/imprest/by-category — imprest counts and amounts by category
router.get('/imprest/by-category', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('imprest_requests').select('category, amount_requested, status');
    if (error) throw error;

    const catMap = {};
    for (const r of data) {
      if (!catMap[r.category]) catMap[r.category] = { category: r.category, count: 0, totalRequested: 0 };
      catMap[r.category].count++;
      catMap[r.category].totalRequested += parseFloat(r.amount_requested || 0);
    }

    return ok(res, Object.values(catMap).map((c) => ({
      ...c,
      totalRequested: Math.round(c.totalRequested * 100) / 100,
    })));
  } catch (err) { next(err); }
});

// GET /api/dashboard/imprest/by-status — imprest counts by status
router.get('/imprest/by-status', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('imprest_requests').select('status, amount_requested');
    if (error) throw error;

    const statusMap = {};
    for (const r of data) {
      if (!statusMap[r.status]) statusMap[r.status] = { status: r.status, count: 0, totalAmount: 0 };
      statusMap[r.status].count++;
      statusMap[r.status].totalAmount += parseFloat(r.amount_requested || 0);
    }

    return ok(res, Object.values(statusMap));
  } catch (err) { next(err); }
});

// GET /api/dashboard/imprest/balance — old balance for all approved imprests
router.get('/imprest/balance', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    // Get all approved/partially_approved imprests
    const { data: imprests, error: impErr } = await supabaseAdmin
      .from('imprest_requests')
      .select(`
        id, ref_id, employee_id, site, category, amount_requested, approved_amount, status, submitted_at,
        employee:employee_id (id, name, email, site)
      `)
      .in('status', ['approved', 'partially_approved'])
      .order('submitted_at', { ascending: false });
    if (impErr) throw impErr;

    // Get all expenses linked to imprests
    const { data: linkedExpenses, error: expErr } = await supabaseAdmin
      .from('expenses')
      .select('imprest_id, amount, status')
      .not('imprest_id', 'is', null)
      .not('status', 'in', '("rejected","blocked")');
    if (expErr) throw expErr;

    // Build expense totals by imprest_id
    const expenseByImprest = {};
    for (const exp of (linkedExpenses || [])) {
      if (!expenseByImprest[exp.imprest_id]) expenseByImprest[exp.imprest_id] = 0;
      expenseByImprest[exp.imprest_id] += parseFloat(exp.amount);
    }

    const result = imprests.map((imp) => {
      const approvedAmt = parseFloat(imp.approved_amount || imp.amount_requested);
      const expenseTotal = expenseByImprest[imp.id] || 0;
      return {
        ...imp,
        total_expenses_submitted: Math.round(expenseTotal * 100) / 100,
        old_balance: Math.round(Math.max(0, approvedAmt - expenseTotal) * 100) / 100,
      };
    });

    return ok(res, result);
  } catch (err) { next(err); }
});

// GET /api/dashboard/imprest/employee-balance — per-employee total outstanding balance
router.get('/imprest/employee-balance', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    // Get all approved imprests
    const { data: imprests, error: impErr } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, employee_id, approved_amount, amount_requested')
      .in('status', ['approved', 'partially_approved']);
    if (impErr) throw impErr;

    // Get all expenses linked to imprests
    const { data: linkedExpenses, error: expErr } = await supabaseAdmin
      .from('expenses')
      .select('imprest_id, amount, status')
      .not('imprest_id', 'is', null)
      .not('status', 'in', '("rejected","blocked")');
    if (expErr) throw expErr;

    const expenseByImprest = {};
    for (const exp of (linkedExpenses || [])) {
      if (!expenseByImprest[exp.imprest_id]) expenseByImprest[exp.imprest_id] = 0;
      expenseByImprest[exp.imprest_id] += parseFloat(exp.amount);
    }

    // Calculate per-employee balance
    const empBalance = {};
    for (const imp of imprests) {
      const approved = parseFloat(imp.approved_amount || imp.amount_requested);
      const expenseTotal = expenseByImprest[imp.id] || 0;
      const balance = Math.max(0, approved - expenseTotal);
      if (!empBalance[imp.employee_id]) empBalance[imp.employee_id] = { total_old_balance: 0, imprests_with_balance: 0 };
      empBalance[imp.employee_id].total_old_balance += balance;
      if (balance > 0) empBalance[imp.employee_id].imprests_with_balance++;
    }

    // Get employee details
    const empIds = Object.keys(empBalance).filter((id) => empBalance[id].total_old_balance > 0);
    if (empIds.length === 0) return ok(res, []);

    const { data: employees, error: empErr } = await supabaseAdmin
      .from('employees').select('id, name, email, site')
      .in('id', empIds);
    if (empErr) throw empErr;

    const result = employees.map((emp) => ({
      ...emp,
      total_old_balance: Math.round(empBalance[emp.id].total_old_balance * 100) / 100,
      imprests_with_balance: empBalance[emp.id].imprests_with_balance,
    })).sort((a, b) => b.total_old_balance - a.total_old_balance);

    return ok(res, result);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// DRILL-DOWN ENDPOINTS — clickable chart details
// ════════════════════════════════════════════════════════════════════════════

// GET /api/dashboard/by-site/:site/details — employee breakdown for expense site
router.get('/by-site/:site/details', roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('expenses')
      .select('amount, status, employee:employee_id (name, email, site)')
      .eq('site', req.params.site);
    if (error) throw error;

    const empMap = {};
    for (const e of (data || [])) {
      const name = e.employee?.name || 'Unknown';
      if (!empMap[name]) empMap[name] = { name, email: e.employee?.email, site: e.employee?.site, total: 0, count: 0, approved: 0 };
      empMap[name].total += parseFloat(e.amount);
      empMap[name].count++;
      if (e.status === 'approved') empMap[name].approved += parseFloat(e.amount);
    }
    return ok(res, Object.values(empMap).sort((a, b) => b.total - a.total));
  } catch (err) { next(err); }
});

// GET /api/dashboard/by-category/:category/details
router.get('/by-category/:category/details', roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('expenses')
      .select('amount, status, employee:employee_id (name, email, site)')
      .eq('category', req.params.category);
    if (error) throw error;

    const empMap = {};
    for (const e of (data || [])) {
      const name = e.employee?.name || 'Unknown';
      if (!empMap[name]) empMap[name] = { name, email: e.employee?.email, site: e.employee?.site, total: 0, count: 0 };
      empMap[name].total += parseFloat(e.amount);
      empMap[name].count++;
    }
    return ok(res, Object.values(empMap).sort((a, b) => b.total - a.total));
  } catch (err) { next(err); }
});

// GET /api/dashboard/imprest/by-site/:site/details
router.get('/imprest/by-site/:site/details', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('imprest_requests')
      .select('amount_requested, approved_amount, status, category, employee:employee_id (name, email)')
      .eq('site', req.params.site);
    if (error) throw error;

    const empMap = {};
    for (const r of (data || [])) {
      const name = r.employee?.name || 'Unknown';
      if (!empMap[name]) empMap[name] = { name, email: r.employee?.email, totalRequested: 0, totalApproved: 0, count: 0, categories: {} };
      empMap[name].totalRequested += parseFloat(r.amount_requested);
      empMap[name].totalApproved += parseFloat(r.approved_amount || 0);
      empMap[name].count++;
      empMap[name].categories[r.category] = (empMap[name].categories[r.category] || 0) + 1;
    }
    const result = Object.values(empMap).map((e) => ({
      ...e,
      totalRequested: Math.round(e.totalRequested),
      totalApproved: Math.round(e.totalApproved),
      topCategory: Object.entries(e.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    }));
    return ok(res, result.sort((a, b) => b.totalRequested - a.totalRequested));
  } catch (err) { next(err); }
});

// GET /api/dashboard/imprest/by-category/:category/details
router.get('/imprest/by-category/:category/details', roleGuard(ALL_DASHBOARD_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('imprest_requests')
      .select('amount_requested, approved_amount, status, site, employee:employee_id (name, email)')
      .eq('category', req.params.category);
    if (error) throw error;

    const empMap = {};
    for (const r of (data || [])) {
      const name = r.employee?.name || 'Unknown';
      if (!empMap[name]) empMap[name] = { name, email: r.employee?.email, site: r.site, totalRequested: 0, count: 0 };
      empMap[name].totalRequested += parseFloat(r.amount_requested);
      empMap[name].count++;
    }
    return ok(res, Object.values(empMap).sort((a, b) => b.totalRequested - a.totalRequested));
  } catch (err) { next(err); }
});

export default router;
