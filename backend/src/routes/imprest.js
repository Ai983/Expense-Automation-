import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { logAudit } from '../services/auditService.js';
import { estimateTravelCost } from '../services/travelService.js';
import { generateImprestRefId } from '../utils/refIdGenerator.js';
import { ok, fail } from '../utils/responseHelper.js';
import { FINANCE_ROLES } from '../config/constants.js';
import { broadcastNewImprest } from '../index.js';
import { sendImprestApprovalReminder } from '../services/whatsappService.js';

const router = Router();

// ── GET /api/imprest/food-rates ───────────────────────────────────────────────
router.get('/food-rates', authMiddleware, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('food_rates').select('*');
    if (error) throw error;
    return ok(res, data);
  } catch (err) { next(err); }
});

// ── POST /api/imprest/estimate-travel ─────────────────────────────────────────
router.post('/estimate-travel', authMiddleware, roleGuard(['employee']), async (req, res, next) => {
  try {
    const { from, to, peopleCount } = req.body;
    if (!from || !to) return fail(res, 'from and to locations are required');
    const estimate = await estimateTravelCost(from, to, parseInt(peopleCount) || 1);
    return ok(res, estimate);
  } catch (err) { next(err); }
});

// ── POST /api/imprest/submit ──────────────────────────────────────────────────
router.post('/submit', authMiddleware, roleGuard(['employee']), async (req, res, next) => {
  try {
    // Check if employee is blocked from raising imprests
    const { data: empCheck } = await supabaseAdmin
      .from('employees').select('imprest_blocked').eq('id', req.user.id).single();
    if (empCheck?.imprest_blocked) {
      return fail(res, 'You are blocked from raising new imprest requests. Please contact your finance team.', 403);
    }

    const {
      site, category, peopleCount, amountRequested, purpose,
      requestedTo,
      perPersonRate,
      travelFrom, travelTo, aiEstimatedAmount, aiEstimatedDistanceKm, userEditedAmount,
    } = req.body;

    if (!site || !category || !peopleCount || !amountRequested) {
      return fail(res, 'site, category, peopleCount, and amountRequested are required');
    }

    const refId = await generateImprestRefId();
    const submittedAt = new Date().toISOString();

    const amountDeviation = (userEditedAmount && aiEstimatedAmount)
      ? parseFloat(amountRequested) - parseFloat(aiEstimatedAmount)
      : null;

    const { data: imprest, error } = await supabaseAdmin
      .from('imprest_requests')
      .insert({
        ref_id: refId,
        employee_id: req.user.id,
        site,
        category,
        people_count: parseInt(peopleCount),
        amount_requested: parseFloat(amountRequested),
        purpose: purpose || null,
        requested_to: requestedTo || null,
        per_person_rate: perPersonRate ? parseFloat(perPersonRate) : null,
        rate_source: category === 'Food Expense' ? 'system_fixed'
                   : category === 'Travelling' ? 'ai_estimated'
                   : 'user_entered',
        travel_from: travelFrom || null,
        travel_to: travelTo || null,
        ai_estimated_amount: aiEstimatedAmount ? parseFloat(aiEstimatedAmount) : null,
        ai_estimated_distance_km: aiEstimatedDistanceKm ? parseFloat(aiEstimatedDistanceKm) : null,
        user_edited_amount: !!userEditedAmount,
        amount_deviation: amountDeviation,
        submitted_at: submittedAt,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;

    await logAudit({
      userId: req.user.id,
      action: 'submit_imprest',
      entityType: 'expense',
      entityId: imprest.id,
      newValue: { refId, amount: amountRequested, site, category, status: 'pending' },
      ipAddress: req.ip,
    });

    try {
      broadcastNewImprest({
        id: imprest.id, refId,
        employeeName: req.user.name,
        site, category,
        amount: parseFloat(amountRequested),
        status: 'pending',
        userEditedAmount: !!userEditedAmount,
        amountDeviation,
        submittedAt,
      });
    } catch (e) { console.warn('WebSocket broadcast failed:', e.message); }

    return ok(res, {
      refId, status: 'pending',
      message: 'Imprest request submitted. Awaiting approval.',
    }, 201);
  } catch (err) { next(err); }
});

// ── GET /api/imprest/my-reminders/:employeeId ─────────────────────────────────
// Employee sees their own pending expense reminders
router.get('/my-reminders/:employeeId', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role === 'employee' && req.user.id !== req.params.employeeId) {
      return fail(res, 'Access denied', 403);
    }
    const { data, error } = await supabaseAdmin
      .from('imprest_expense_reminders')
      .select(`
        *,
        imprest:imprest_id (ref_id, amount_requested, approved_amount, site, category, approved_at)
      `)
      .eq('employee_id', req.params.employeeId)
      .eq('status', 'pending')
      .order('deadline', { ascending: true });
    if (error) throw error;
    return ok(res, { reminders: data || [] });
  } catch (err) { next(err); }
});

// ── POST /api/imprest/reminders/:reminderId/fulfill ───────────────────────────
// Mark a reminder as fulfilled after expense is submitted
router.post('/reminders/:reminderId/fulfill', authMiddleware, async (req, res, next) => {
  try {
    const { data: reminder, error: fetchErr } = await supabaseAdmin
      .from('imprest_expense_reminders')
      .select('id, employee_id, status')
      .eq('id', req.params.reminderId)
      .single();
    if (fetchErr || !reminder) return fail(res, 'Reminder not found', 404);
    if (req.user.role === 'employee' && req.user.id !== reminder.employee_id) {
      return fail(res, 'Access denied', 403);
    }
    await supabaseAdmin
      .from('imprest_expense_reminders')
      .update({ status: 'fulfilled' })
      .eq('id', req.params.reminderId);
    return ok(res, { message: 'Reminder marked as fulfilled' });
  } catch (err) { next(err); }
});

// ── GET /api/imprest/my-requests/:employeeId ──────────────────────────────────
router.get('/my-requests/:employeeId', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role === 'employee' && req.user.id !== req.params.employeeId) {
      return fail(res, 'Access denied', 403);
    }
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { data, error, count } = await supabaseAdmin
      .from('imprest_requests')
      .select('*', { count: 'exact' })
      .eq('employee_id', req.params.employeeId)
      .order('submitted_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);
    if (error) throw error;
    return ok(res, { requests: data, total: count, page: parseInt(page) });
  } catch (err) { next(err); }
});

// ── GET /api/imprest/finance/queue ────────────────────────────────────────────
router.get('/finance/queue', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { status, site, category, dateFrom, dateTo, employeeName, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Filter by employee name: find matching employee IDs first
    let employeeIds = null;
    if (employeeName && employeeName.trim()) {
      const { data: matchingEmps } = await supabaseAdmin
        .from('employees').select('id').ilike('name', `%${employeeName.trim()}%`);
      employeeIds = matchingEmps?.map((e) => e.id) || [];
      if (employeeIds.length === 0) {
        return ok(res, { requests: [], total: 0, page: parseInt(page), limit: parseInt(limit) });
      }
    }

    let query = supabaseAdmin
      .from('imprest_requests')
      .select(`
        *,
        employee:employee_id (id, name, email, phone, site),
        approver:approved_by (id, name),
        requested_to_user:requested_to (id, name)
      `, { count: 'exact' })
      .order('submitted_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (status && status !== 'all') query = query.eq('status', status);
    if (site && site !== 'all') query = query.eq('site', site);
    if (category && category !== 'all') query = query.eq('category', category);
    if (dateFrom) query = query.gte('submitted_at', dateFrom);
    if (dateTo) query = query.lte('submitted_at', dateTo + 'T23:59:59Z');
    if (employeeIds) query = query.in('employee_id', employeeIds);

    const { data, error, count } = await query;
    if (error) throw error;
    return ok(res, { requests: data, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/imprest/finance/reminders ───────────────────────────────────────
// Returns all active reminders; auto-expires overdue ones and blocks employees
router.get('/finance/reminders', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const now = new Date().toISOString();

    // Find overdue pending reminders
    const { data: expired } = await supabaseAdmin
      .from('imprest_expense_reminders')
      .select('id, employee_id')
      .eq('status', 'pending')
      .lt('deadline', now);

    if (expired?.length) {
      // Mark them expired
      await supabaseAdmin
        .from('imprest_expense_reminders')
        .update({ status: 'expired' })
        .in('id', expired.map((r) => r.id));

      // Block each affected employee
      const uniqueEmpIds = [...new Set(expired.map((r) => r.employee_id))];
      for (const empId of uniqueEmpIds) {
        await supabaseAdmin.from('employees').update({
          imprest_blocked: true,
          imprest_blocked_at: now,
          imprest_blocked_reason: 'Expense not submitted within 3 days of imprest approval',
        }).eq('id', empId);
      }
    }

    // Fetch all active reminders (pending + expired)
    const { data, error } = await supabaseAdmin
      .from('imprest_expense_reminders')
      .select(`
        *,
        employee:employee_id (id, name, email, site, imprest_blocked),
        imprest:imprest_id (ref_id, amount_requested, approved_amount, site, category, approved_at)
      `)
      .in('status', ['pending', 'expired'])
      .order('deadline', { ascending: true });

    if (error) throw error;
    return ok(res, { reminders: data || [] });
  } catch (err) { next(err); }
});

// ── POST /api/imprest/finance/unblock/:employeeId ────────────────────────────
router.post('/finance/unblock/:employeeId', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { error } = await supabaseAdmin
      .from('employees')
      .update({ imprest_blocked: false, imprest_blocked_reason: null, imprest_blocked_at: null })
      .eq('id', employeeId);
    if (error) throw error;

    await logAudit({
      userId: req.user.id,
      action: 'unblock_employee_imprest',
      entityType: 'employee',
      entityId: employeeId,
      newValue: { imprest_blocked: false },
      ipAddress: req.ip,
    });

    return ok(res, { message: 'Employee imprest access restored successfully' });
  } catch (err) { next(err); }
});

// ── POST /api/imprest/:id/approve ─────────────────────────────────────────────
router.post('/:id/approve', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { approvedAmount } = req.body;
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests').select('id, ref_id, status, amount_requested, employee_id, category')
      .eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest request not found', 404);
    if (imp.status !== 'pending') return fail(res, 'Only pending requests can be approved');

    const finalAmount = approvedAmount ? parseFloat(approvedAmount) : imp.amount_requested;
    const isPartial = finalAmount < imp.amount_requested;
    const approvedAt = new Date().toISOString();

    await supabaseAdmin.from('imprest_requests').update({
      status: isPartial ? 'partially_approved' : 'approved',
      approved_amount: finalAmount,
      approved_by: req.user.id,
      approved_at: approvedAt,
    }).eq('id', req.params.id);

    // Create 3-day expense reminder
    const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await supabaseAdmin.from('imprest_expense_reminders').insert({
        imprest_id: imp.id,
        employee_id: imp.employee_id,
        imprest_ref_id: imp.ref_id,
        deadline,
        status: 'pending',
      });
    } catch (e) { console.warn('Failed to create imprest reminder:', e.message); }

    // Send WhatsApp notification to employee
    try {
      const { data: emp } = await supabaseAdmin
        .from('employees').select('name, phone, site').eq('id', imp.employee_id).single();
      if (emp) {
        await sendImprestApprovalReminder({
          name: emp.name,
          phone: emp.phone,
          refId: imp.ref_id,
          approvedAmount: finalAmount,
          site: emp.site,
          category: imp.category || '',
          deadline,
        });
      }
    } catch (e) { console.warn('WhatsApp notification failed:', e.message); }

    await logAudit({
      userId: req.user.id, action: 'approve',
      entityType: 'expense', entityId: imp.id,
      oldValue: { status: 'pending' },
      newValue: { status: isPartial ? 'partially_approved' : 'approved', approvedAmount: finalAmount },
      ipAddress: req.ip,
    });

    return ok(res, {
      refId: imp.ref_id,
      status: isPartial ? 'partially_approved' : 'approved',
      approvedAmount: finalAmount,
    });
  } catch (err) { next(err); }
});

// ── POST /api/imprest/:id/reject ──────────────────────────────────────────────
router.post('/:id/reject', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return fail(res, 'Rejection reason is required');
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests').select('id, ref_id, status').eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest request not found', 404);

    await supabaseAdmin.from('imprest_requests').update({
      status: 'rejected', rejection_reason: reason.trim(),
      approved_by: req.user.id, approved_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    await logAudit({
      userId: req.user.id, action: 'reject',
      entityType: 'expense', entityId: imp.id,
      oldValue: { status: imp.status }, newValue: { status: 'rejected', reason },
      ipAddress: req.ip,
    });

    return ok(res, { refId: imp.ref_id, status: 'rejected' });
  } catch (err) { next(err); }
});

export default router;
