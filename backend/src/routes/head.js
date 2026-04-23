import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok } from '../utils/responseHelper.js';
import { HEAD_ROLES } from '../config/constants.js';

const router = Router();

router.use(authMiddleware);
router.use(roleGuard(HEAD_ROLES));

// ── GET /api/head/kanban ───────────────────────────────────────────────────────
// Returns all three streams (imprests, expenses, POs) for the Kanban board.
router.get('/kanban', async (req, res, next) => {
  try {
    const [imprestsRes, expensesRes, posRes] = await Promise.all([
      supabaseAdmin
        .from('imprest_requests')
        .select(`
          id, ref_id, site, category, amount_requested, status,
          current_stage, approval_route, submitted_at,
          s1_approved_at, s2_approved_at, approved_at,
          founder_review_status, founder_review_at, paid, paid_amount,
          employee:employee_id (name)
        `)
        .not('current_stage', 'in', '("paid")')
        .order('submitted_at', { ascending: false })
        .limit(500),

      supabaseAdmin
        .from('expenses')
        .select(`
          id, ref_id, site, category, amount, status, submitted_at,
          confidence,
          employee:employee_id (name)
        `)
        .not('status', 'in', '("approved","rejected","blocked")')
        .order('submitted_at', { ascending: false })
        .limit(500),

      supabaseAdmin
        .from('po_payments')
        .select(`
          id, cps_po_ref, project_name, site, supplier_name,
          total_amount, status, created_at,
          procurement_approved_at, payment_due_date
        `)
        .not('status', 'in', '("paid","payment_rejected","procurement_rejected")')
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    const imprests = (imprestsRes.data || []).map((r) => ({
      ...r,
      employee_name: r.employee?.name || '—',
      employee: undefined,
    }));
    const expenses = (expensesRes.data || []).map((r) => ({
      ...r,
      employee_name: r.employee?.name || '—',
      employee: undefined,
    }));

    return ok(res, {
      imprests,
      expenses,
      pos: posRes.data || [],
    });
  } catch (err) { next(err); }
});

// ── GET /api/head/overview ────────────────────────────────────────────────────
// KPI strip data + bottleneck snapshot + recent activity for the Overview page.
router.get('/overview', async (req, res, next) => {
  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      imprestInMotionRes,
      expenseInMotionRes,
      poInMotionRes,
      blockedEmployeesRes,
      directorPendingRes,
      imprestPaidWeekRes,
      poPaidWeekRes,
      avgApproveRes,
      recentActivityRes,
      bottleneckImprestRes,
      bottleneckExpenseRes,
    ] = await Promise.all([
      supabaseAdmin
        .from('imprest_requests')
        .select('amount_requested')
        .not('status', 'in', '("rejected")')
        .not('current_stage', 'in', '("paid","s1_rejected","s2_rejected","s3_rejected","director_rejected")'),

      supabaseAdmin
        .from('expenses')
        .select('amount')
        .in('status', ['pending', 'manual_review']),

      supabaseAdmin
        .from('po_payments')
        .select('total_amount')
        .in('status', ['pending_procurement', 'pending_payment']),

      supabaseAdmin
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('imprest_blocked', true),

      supabaseAdmin
        .from('imprest_requests')
        .select('id', { count: 'exact', head: true })
        .eq('current_stage', 's2_pending')
        .eq('founder_review_status', 'pending'),

      supabaseAdmin
        .from('imprest_requests')
        .select('paid_amount')
        .eq('paid', true)
        .gte('paid_at', weekAgo),

      supabaseAdmin
        .from('po_payments')
        .select('total_amount')
        .eq('status', 'paid')
        .gte('paid_at', weekAgo),

      supabaseAdmin
        .from('imprest_requests')
        .select('submitted_at, approved_at')
        .in('status', ['approved', 'partially_approved'])
        .not('approved_at', 'is', null)
        .gte('approved_at', thirtyDaysAgo),

      supabaseAdmin
        .from('audit_trail')
        .select(`id, action, entity_type, entity_id, timestamp, user:user_id (name, role)`)
        .in('action', ['approve', 'reject', 'pay_imprest', 'PO_PAYMENT_PAID', 'submit_imprest', 'submit_expense', 'PO_PAYMENT_PROCUREMENT_APPROVED'])
        .order('timestamp', { ascending: false })
        .limit(10),

      // Bottleneck imprests (older than 48h in current stage)
      supabaseAdmin
        .from('imprest_requests')
        .select('id, ref_id, site, category, amount_requested, current_stage, approval_route, submitted_at, s1_approved_at, employee:employee_id(name)')
        .not('current_stage', 'in', '("paid","s1_rejected","s2_rejected","s3_rejected","director_rejected")')
        .lte('submitted_at', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString())
        .order('submitted_at', { ascending: true })
        .limit(5),

      supabaseAdmin
        .from('expenses')
        .select('id, ref_id, site, category, amount, status, submitted_at, employee:employee_id(name)')
        .in('status', ['pending', 'manual_review'])
        .lte('submitted_at', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString())
        .order('submitted_at', { ascending: true })
        .limit(5),
    ]);

    const moneyInMotion =
      (imprestInMotionRes.data || []).reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0) +
      (expenseInMotionRes.data || []).reduce((s, r) => s + parseFloat(r.amount || 0), 0) +
      (poInMotionRes.data || []).reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);

    const paidThisWeek =
      (imprestPaidWeekRes.data || []).reduce((s, r) => s + parseFloat(r.paid_amount || 0), 0) +
      (poPaidWeekRes.data || []).reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);

    let avgApproveHours = null;
    const approvedItems = avgApproveRes.data || [];
    if (approvedItems.length > 0) {
      const totalMs = approvedItems.reduce((s, r) => {
        const diff = new Date(r.approved_at) - new Date(r.submitted_at);
        return s + (diff > 0 ? diff : 0);
      }, 0);
      avgApproveHours = Math.round(totalMs / approvedItems.length / 3600000);
    }

    const bottleneckImprests = (bottleneckImprestRes.data || []).map((r) => ({
      ...r, employee_name: r.employee?.name || '—', employee: undefined,
    }));
    const bottleneckExpenses = (bottleneckExpenseRes.data || []).map((r) => ({
      ...r, employee_name: r.employee?.name || '—', employee: undefined,
    }));

    return ok(res, {
      kpi: {
        moneyInMotion: Math.round(moneyInMotion * 100) / 100,
        blockedEmployees: blockedEmployeesRes.count || 0,
        pendingDirectorApprovals: directorPendingRes.count || 0,
        paidThisWeek: Math.round(paidThisWeek * 100) / 100,
        avgApproveHours,
        bottleneckCount: bottleneckImprests.length + bottleneckExpenses.length,
      },
      bottlenecks: { imprests: bottleneckImprests, expenses: bottleneckExpenses },
      recentActivity: recentActivityRes.data || [],
    });
  } catch (err) { next(err); }
});

export default router;
