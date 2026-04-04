import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { logAudit } from '../services/auditService.js';
import { upload } from '../middleware/upload.js';
import {
  estimateTravelCost,
  estimatePublicTransportCost,
  estimateContractualCabCost,
  estimateOwnVehicleCost,
} from '../services/travelService.js';
import { extractRideFare } from '../services/visionService.js';
import { generateImprestRefId } from '../utils/refIdGenerator.js';
import { ok, fail } from '../utils/responseHelper.js';
import { FINANCE_ROLES } from '../config/constants.js';
import { broadcastNewImprest } from '../index.js';
import { sendImprestApprovalReminder } from '../services/whatsappService.js';
import { triggerSubmissionConfirmation, triggerFounderApproval } from '../services/n8nService.js';

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
    const { from, to, peopleCount, mode, travelDate, vehicleType } = req.body;
    if (!from || !to) return fail(res, 'from and to locations are required');

    let estimate;
    if (mode === 'Own Vehicle') {
      estimate = await estimateOwnVehicleCost({ from, to, vehicleType: vehicleType || 'Bike' });
    } else if (['Flight', 'Train', 'Bus'].includes(mode)) {
      estimate = await estimatePublicTransportCost({
        from, to, mode, travelDate,
        peopleCount: parseInt(peopleCount) || 1,
      });
    } else if (mode === 'Contractual Cab') {
      estimate = await estimateContractualCabCost({ from, to, peopleCount: parseInt(peopleCount) || 1 });
    } else {
      estimate = await estimateTravelCost(from, to, parseInt(peopleCount) || 1);
    }

    return ok(res, estimate);
  } catch (err) { next(err); }
});

// ── POST /api/imprest/scan-conveyance ─────────────────────────────────────────
// Accepts an Ola/Uber/Rapido screenshot and returns the extracted fare amount
router.post('/scan-conveyance', authMiddleware, roleGuard(['employee']), upload.single('screenshot'), async (req, res, next) => {
  try {
    if (!req.file) return fail(res, 'No image provided');
    const result = await extractRideFare(req.file.buffer, req.file.mimetype);
    if (!result.amount) return fail(res, 'Could not extract amount from screenshot. Please enter manually.');
    return ok(res, result);
  } catch (err) { next(err); }
});

// ── POST /api/imprest/submit ──────────────────────────────────────────────────
router.post('/submit', authMiddleware, roleGuard(['employee']), async (req, res, next) => {
  try {
    // Check if employee is blocked
    const { data: empCheck } = await supabaseAdmin
      .from('employees').select('imprest_blocked').eq('id', req.user.id).single();
    if (empCheck?.imprest_blocked) {
      return fail(res, 'You are blocked from raising new imprest requests. Please contact your finance team.', 403);
    }

    const {
      site, category, peopleCount, amountRequested, purpose,
      // Date range (food, site room rent, hotel)
      dateFrom, dateTo,
      // Food
      perPersonRate,
      // Travel
      travelSubtype, travelFrom, travelTo, travelDate,
      aiEstimatedAmount, aiEstimatedDistanceKm, userEditedAmount,
      // Conveyance
      conveyanceMode, vehicleType,
      // Labour
      labourSubcategory,
      // Requested to (Dhruv Sir / Bhaskar Sir)
      requestedToName,
    } = req.body;

    if (!site || !category || !peopleCount || !amountRequested) {
      return fail(res, 'site, category, peopleCount, and amountRequested are required');
    }

    const refId = await generateImprestRefId();
    const submittedAt = new Date().toISOString();

    const amountDeviation = (userEditedAmount && aiEstimatedAmount)
      ? parseFloat(amountRequested) - parseFloat(aiEstimatedAmount)
      : null;

    // Determine rate source
    let rateSource = 'user_entered';
    if (category === 'Food Expense' && perPersonRate) rateSource = 'system_fixed';
    if (category === 'Travelling' && aiEstimatedAmount) rateSource = 'ai_estimated';
    if (conveyanceMode === 'Own Vehicle' || travelSubtype === 'Contractual Cab') rateSource = 'system_calculated';

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
        per_person_rate: perPersonRate ? parseFloat(perPersonRate) : null,
        rate_source: rateSource,
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

    const needsFounderApproval = parseFloat(amountRequested) >= 5000 && !!requestedToName;

    // If insert succeeded, try to patch with new columns (added in migration 011)
    // Silently ignore if columns don't exist yet
    if (!error && imprest?.id) {
      const extraFields = {};
      if (dateFrom) extraFields.date_from = dateFrom;
      if (dateTo) extraFields.date_to = dateTo;
      if (travelSubtype) extraFields.travel_subtype = travelSubtype;
      if (travelDate) extraFields.travel_date = travelDate;
      if (conveyanceMode) extraFields.conveyance_mode = conveyanceMode;
      if (vehicleType) extraFields.vehicle_type = vehicleType;
      if (labourSubcategory) extraFields.labour_subcategory = labourSubcategory;
      // Founder approval fields (migration 013)
      if (requestedToName) extraFields.requested_to_name = requestedToName;
      if (needsFounderApproval) {
        extraFields.requires_founder_approval = true;
        extraFields.founder_review_status = 'pending';
      }
      if (Object.keys(extraFields).length > 0) {
        await supabaseAdmin.from('imprest_requests').update(extraFields).eq('id', imprest.id);
        // ignore update error — columns may not exist yet until migration runs
      }
    }

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

    // ── n8n triggers (non-blocking) ──────────────────────────────────────
    // WF1: Send submission confirmation WhatsApp to employee
    try {
      const { data: emp } = await supabaseAdmin
        .from('employees').select('name, phone, site').eq('id', req.user.id).single();
      if (emp?.phone) {
        triggerSubmissionConfirmation({
          employeeName: emp.name,
          phone: emp.phone,
          refId,
          amount: parseFloat(amountRequested),
          category,
          site,
          purpose: purpose || '',
        }).catch((e) => console.warn('WF1 trigger failed:', e.message));
      }
    } catch (e) { console.warn('WF1 employee lookup failed:', e.message); }

    // WF2: Founder/Director approval for amount >= 5000
    if (needsFounderApproval) {
      try {
        // Calculate employee's old balance for the approval message
        let oldBalance = 0;
        const { data: empImprests } = await supabaseAdmin
          .from('imprest_requests')
          .select('id, approved_amount, amount_requested')
          .eq('employee_id', req.user.id)
          .in('status', ['approved', 'partially_approved']);
        if (empImprests?.length) {
          const impIds = empImprests.map((i) => i.id);
          const { data: linkedExp } = await supabaseAdmin
            .from('expenses')
            .select('imprest_id, amount, status')
            .in('imprest_id', impIds)
            .not('status', 'in', '("rejected","blocked")');
          const expByImp = {};
          for (const ex of (linkedExp || [])) {
            expByImp[ex.imprest_id] = (expByImp[ex.imprest_id] || 0) + parseFloat(ex.amount);
          }
          for (const imp2 of empImprests) {
            const approved = parseFloat(imp2.approved_amount || imp2.amount_requested);
            oldBalance += Math.max(0, approved - (expByImp[imp2.id] || 0));
          }
        }

        triggerFounderApproval({
          imprestId: imprest.id,
          refId,
          requestedTo: requestedToName,
          employeeName: req.user.name,
          employeeSite: site,
          amount: parseFloat(amountRequested),
          category,
          purpose: purpose || '',
          oldBalance: Math.round(oldBalance * 100) / 100,
          submittedAt,
        }).catch((e) => console.warn('WF2 trigger failed:', e.message));
      } catch (e) { console.warn('WF2 balance calc failed:', e.message); }
    }

    return ok(res, {
      refId, status: 'pending',
      message: needsFounderApproval
        ? 'Imprest request submitted. Approval request sent to ' + requestedToName + '.'
        : 'Imprest request submitted. Awaiting approval.',
    }, 201);
  } catch (err) { next(err); }
});

// ── GET /api/imprest/my-reminders/:employeeId ─────────────────────────────────
router.get('/my-reminders/:employeeId', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role === 'employee' && req.user.id !== req.params.employeeId) {
      return fail(res, 'Access denied', 403);
    }
    const { data, error } = await supabaseAdmin
      .from('imprest_expense_reminders')
      .select(`
        *,
        imprest:imprest_id (id, ref_id, amount_requested, approved_amount, site, category, approved_at)
      `)
      .eq('employee_id', req.params.employeeId)
      .eq('status', 'pending')
      .order('deadline', { ascending: true });
    if (error) throw error;
    return ok(res, { reminders: data || [] });
  } catch (err) { next(err); }
});

// ── POST /api/imprest/reminders/:reminderId/fulfill ───────────────────────────
router.post('/reminders/:reminderId/fulfill', authMiddleware, async (req, res, next) => {
  try {
    const { expenseAmount } = req.body;
    const { data: reminder, error: fetchErr } = await supabaseAdmin
      .from('imprest_expense_reminders')
      .select('id, employee_id, status, imprest_id, fulfilled_amount')
      .eq('id', req.params.reminderId)
      .single();
    if (fetchErr || !reminder) return fail(res, 'Reminder not found', 404);
    if (req.user.role === 'employee' && req.user.id !== reminder.employee_id) {
      return fail(res, 'Access denied', 403);
    }

    // Get approved amount from imprest to check if fully fulfilled
    const { data: imprest } = await supabaseAdmin
      .from('imprest_requests')
      .select('approved_amount, amount_requested')
      .eq('id', reminder.imprest_id)
      .single();

    const approvedAmount = parseFloat(imprest?.approved_amount || imprest?.amount_requested || 0);
    const previousFulfilled = parseFloat(reminder.fulfilled_amount || 0);
    const newExpenseAmount = parseFloat(expenseAmount || 0);
    const totalFulfilled = previousFulfilled + newExpenseAmount;

    // If total expenses cover the approved amount, mark as fulfilled; otherwise keep pending
    const isFullyFulfilled = totalFulfilled >= approvedAmount;

    await supabaseAdmin
      .from('imprest_expense_reminders')
      .update({
        status: isFullyFulfilled ? 'fulfilled' : 'pending',
        fulfilled_amount: totalFulfilled,
      })
      .eq('id', req.params.reminderId);

    const remainingBalance = Math.max(0, approvedAmount - totalFulfilled);

    return ok(res, {
      message: isFullyFulfilled ? 'Reminder marked as fulfilled' : 'Partial expense recorded',
      fulfilled: isFullyFulfilled,
      totalFulfilled,
      remainingBalance,
    });
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

    // Enrich approved/partially_approved requests with old_balance
    const approvedIds = (data || [])
      .filter((r) => r.status === 'approved' || r.status === 'partially_approved')
      .map((r) => r.id);

    let expenseByImprest = {};
    if (approvedIds.length > 0) {
      const { data: linkedExpenses } = await supabaseAdmin
        .from('expenses')
        .select('imprest_id, amount, status')
        .in('imprest_id', approvedIds)
        .not('status', 'in', '("rejected","blocked")');

      for (const exp of (linkedExpenses || [])) {
        if (!expenseByImprest[exp.imprest_id]) expenseByImprest[exp.imprest_id] = 0;
        expenseByImprest[exp.imprest_id] += parseFloat(exp.amount);
      }
    }

    // Calculate per-employee total outstanding balance across ALL their imprests
    const uniqueEmpIds = [...new Set((data || []).map((r) => r.employee_id))];
    let employeeBalanceMap = {};
    if (uniqueEmpIds.length > 0) {
      // Get all approved imprests for these employees
      const { data: allEmpImprests } = await supabaseAdmin
        .from('imprest_requests')
        .select('id, employee_id, approved_amount, amount_requested')
        .in('employee_id', uniqueEmpIds)
        .in('status', ['approved', 'partially_approved']);

      const allApprovedIds = (allEmpImprests || []).map((r) => r.id);
      let allExpByImprest = {};
      if (allApprovedIds.length > 0) {
        const { data: allLinkedExp } = await supabaseAdmin
          .from('expenses')
          .select('imprest_id, amount, status')
          .in('imprest_id', allApprovedIds)
          .not('status', 'in', '("rejected","blocked")');
        for (const exp of (allLinkedExp || [])) {
          if (!allExpByImprest[exp.imprest_id]) allExpByImprest[exp.imprest_id] = 0;
          allExpByImprest[exp.imprest_id] += parseFloat(exp.amount);
        }
      }

      for (const imp of (allEmpImprests || [])) {
        const approved = parseFloat(imp.approved_amount || imp.amount_requested);
        const expTotal = allExpByImprest[imp.id] || 0;
        const bal = Math.max(0, approved - expTotal);
        if (!employeeBalanceMap[imp.employee_id]) employeeBalanceMap[imp.employee_id] = 0;
        employeeBalanceMap[imp.employee_id] += bal;
      }
    }

    const enriched = (data || []).map((r) => {
      const empBalance = Math.round((employeeBalanceMap[r.employee_id] || 0) * 100) / 100;
      if (r.status === 'approved' || r.status === 'partially_approved') {
        const approved = parseFloat(r.approved_amount || r.amount_requested);
        const expenseTotal = expenseByImprest[r.id] || 0;
        return {
          ...r,
          total_expenses_submitted: Math.round(expenseTotal * 100) / 100,
          old_balance: Math.round(Math.max(0, approved - expenseTotal) * 100) / 100,
          employee_total_balance: empBalance,
        };
      }
      return { ...r, employee_total_balance: empBalance };
    });

    return ok(res, { requests: enriched, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
});

// ── GET /api/imprest/finance/reminders ───────────────────────────────────────
router.get('/finance/reminders', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const now = new Date().toISOString();

    const { data: expired } = await supabaseAdmin
      .from('imprest_expense_reminders')
      .select('id, employee_id')
      .eq('status', 'pending')
      .lt('deadline', now);

    if (expired?.length) {
      await supabaseAdmin
        .from('imprest_expense_reminders')
        .update({ status: 'expired' })
        .in('id', expired.map((r) => r.id));

      const uniqueEmpIds = [...new Set(expired.map((r) => r.employee_id))];
      for (const empId of uniqueEmpIds) {
        await supabaseAdmin.from('employees').update({
          imprest_blocked: true,
          imprest_blocked_at: now,
          imprest_blocked_reason: 'Expense not submitted within 3 days of imprest approval',
        }).eq('id', empId);
      }
    }

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

// ── POST /api/imprest/:id/founder-review ─────────────────────────────────────
// Called by n8n WF2 when founder/director replies YES/NO on WhatsApp
const N8N_SECRET = process.env.N8N_INTERNAL_SECRET || '';

router.post('/:id/founder-review', async (req, res, next) => {
  try {
    // Authenticate via shared secret (n8n sends x-n8n-secret header)
    const secret = req.headers['x-n8n-secret'];
    if (!N8N_SECRET || secret !== N8N_SECRET) {
      return fail(res, 'Unauthorized', 401);
    }

    const { decision, comment, reviewerPhone } = req.body;
    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return fail(res, 'decision must be "approved" or "rejected"');
    }

    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, ref_id, status, requires_founder_approval')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !imp) return fail(res, 'Imprest not found', 404);

    // Update founder review fields (silently ignore if columns don't exist yet)
    await supabaseAdmin.from('imprest_requests').update({
      founder_review_status: decision,
      founder_review_comment: comment || null,
      founder_review_at: new Date().toISOString(),
      founder_review_phone: reviewerPhone || null,
    }).eq('id', req.params.id);

    // Broadcast update to finance dashboard
    try {
      broadcastNewImprest({
        id: imp.id,
        refId: imp.ref_id,
        type: 'founder_review',
        founderDecision: decision,
        founderComment: comment || '',
      });
    } catch (e) { console.warn('WebSocket broadcast failed:', e.message); }

    return ok(res, {
      refId: imp.ref_id,
      founderDecision: decision,
      message: `Founder review recorded: ${decision}`,
    });
  } catch (err) { next(err); }
});

export default router;
