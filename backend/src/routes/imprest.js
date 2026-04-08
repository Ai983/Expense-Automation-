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
import { FINANCE_ROLES, S1_ROLES, S2_ROLES, RITU_ALWAYS_SITES, DIRECTOR_APPROVAL_THRESHOLD } from '../config/constants.js';
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

// ── GET /api/imprest/places-autocomplete ─────────────────────────────────────
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
router.get('/places-autocomplete', authMiddleware, async (req, res, next) => {
  try {
    const { input } = req.query;
    if (!input || input.length < 2) return ok(res, []);
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:in&key=${GOOGLE_MAPS_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const suggestions = (data.predictions || []).map((p) => ({
      description: p.description,
      place_id: p.place_id,
    }));
    return ok(res, suggestions);
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
    const { from, to, rideType } = req.body;
    const result = await extractRideFare(req.file.buffer, req.file.mimetype, {
      expectedFrom: from || undefined,
      expectedTo: to || undefined,
      expectedRideType: rideType || undefined,
    });
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
      // Site/Material expense
      requirement,
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

    // Determine approval route automatically
    const amount = parseFloat(amountRequested);
    const isHOorBangalore = RITU_ALWAYS_SITES.includes(site);
    const approvalRoute = (!isHOorBangalore && amount > DIRECTOR_APPROVAL_THRESHOLD)
      ? 'avisha_director_finance'
      : 'avisha_ritu_finance';

    // Calculate old balance deduction if employee has expired reminders
    let oldBalanceDeduction = 0;
    try {
      const { data: expiredReminders } = await supabaseAdmin
        .from('imprest_expense_reminders')
        .select('id')
        .eq('employee_id', req.user.id)
        .eq('status', 'expired');

      if (expiredReminders?.length > 0) {
        const { data: balanceData } = await supabaseAdmin
          .from('imprest_requests')
          .select('id, approved_amount, amount_requested')
          .eq('employee_id', req.user.id)
          .in('status', ['approved', 'partially_approved']);

        if (balanceData?.length) {
          const bIds = balanceData.map((b) => b.id);
          const { data: bExp } = await supabaseAdmin
            .from('expenses').select('imprest_id, amount, status')
            .in('imprest_id', bIds).not('status', 'in', '("rejected","blocked")');
          const bExpMap = {};
          for (const e of (bExp || [])) { bExpMap[e.imprest_id] = (bExpMap[e.imprest_id] || 0) + parseFloat(e.amount); }
          for (const b of balanceData) {
            oldBalanceDeduction += Math.max(0, parseFloat(b.approved_amount || b.amount_requested) - (bExpMap[b.id] || 0));
          }
        }
      }
    } catch (e) { console.warn('Balance deduction calc failed:', e.message); }

    // If insert succeeded, patch with extra columns
    if (!error && imprest?.id) {
      const extraFields = {};
      if (dateFrom) extraFields.date_from = dateFrom;
      if (dateTo) extraFields.date_to = dateTo;
      if (category === 'Travelling' && travelSubtype) extraFields.travel_subtype = travelSubtype;
      if (category === 'Travelling' && travelDate) extraFields.travel_date = travelDate;
      if (category === 'Conveyance' && conveyanceMode) extraFields.conveyance_mode = conveyanceMode;
      if (category === 'Conveyance' && vehicleType) extraFields.vehicle_type = vehicleType;
      if (category === 'Labour Expense' && labourSubcategory) extraFields.labour_subcategory = labourSubcategory;
      // Multi-stage approval fields (migration 015)
      // HO/Bangalore skip S1, go directly to S2 (Ritu)
      extraFields.current_stage = isHOorBangalore ? 's2_pending' : 's1_pending';
      extraFields.approval_route = approvalRoute;
      extraFields.old_balance_deducted = Math.round(oldBalanceDeduction * 100) / 100;
      if (approvalRoute === 'avisha_director_finance') {
        extraFields.requires_founder_approval = true;
      }
      await supabaseAdmin.from('imprest_requests').update(extraFields).eq('id', imprest.id);
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

    const startStage = isHOorBangalore ? 's2_pending' : 's1_pending';
    return ok(res, {
      refId, status: 'pending',
      currentStage: startStage,
      approvalRoute,
      message: isHOorBangalore
        ? 'Imprest request submitted. Sent to Ritu Ma\'am for review.'
        : 'Imprest request submitted. Under review.',
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

    // Finance only sees S3+ stages
    query = query.in('current_stage', ['s3_pending', 's3_approved', 's3_rejected', 'director_rejected', 'paid']);
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

    // Generate signed URLs for payment receipts
    const { getSignedUrl } = await import('../services/storageService.js');
    for (const r of enriched) {
      if (r.payment_receipt_path) {
        r.payment_receipt_url = await getSignedUrl(r.payment_receipt_path);
      }
    }

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
// Finance S3 approval — final approval step
router.post('/:id/approve', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { approvedAmount } = req.body;
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, ref_id, status, amount_requested, employee_id, category, current_stage, approval_route, director_approved_amount, old_balance_deducted')
      .eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest request not found', 404);

    // Stage check
    if (imp.current_stage === 'director_rejected') {
      return fail(res, 'This request was rejected by the Director. No further action is possible.');
    }
    if (imp.current_stage !== 's3_pending') {
      return fail(res, 'Request is not at the finance approval stage');
    }

    const finalAmount = approvedAmount ? parseFloat(approvedAmount) : imp.amount_requested;

    // Director ceiling check
    if (imp.approval_route === 'avisha_director_finance' && imp.director_approved_amount) {
      if (finalAmount > parseFloat(imp.director_approved_amount)) {
        return fail(res, `Cannot approve more than director-approved amount of ₹${imp.director_approved_amount}`);
      }
    }

    const isPartial = finalAmount < imp.amount_requested;
    const approvedAt = new Date().toISOString();
    const netAmount = Math.max(0, finalAmount - parseFloat(imp.old_balance_deducted || 0));

    await supabaseAdmin.from('imprest_requests').update({
      status: isPartial ? 'partially_approved' : 'approved',
      approved_amount: finalAmount,
      net_approved_amount: Math.round(netAmount * 100) / 100,
      approved_by: req.user.id,
      approved_at: approvedAt,
      current_stage: 's3_approved',
    }).eq('id', req.params.id);

    // NOTE: Reminder is NOT created here anymore — it's created when Pay is clicked

    await logAudit({
      userId: req.user.id, action: 'approve',
      entityType: 'expense', entityId: imp.id,
      oldValue: { status: 'pending', current_stage: 's3_pending' },
      newValue: { status: isPartial ? 'partially_approved' : 'approved', approvedAmount: finalAmount, current_stage: 's3_approved' },
      ipAddress: req.ip,
    });

    return ok(res, {
      refId: imp.ref_id,
      status: isPartial ? 'partially_approved' : 'approved',
      approvedAmount: finalAmount,
      netApprovedAmount: Math.round(netAmount * 100) / 100,
    });
  } catch (err) { next(err); }
});

// ── POST /api/imprest/:id/reject ──────────────────────────────────────────────
// Finance S3 rejection
router.post('/:id/reject', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return fail(res, 'Rejection reason is required');
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests').select('id, ref_id, status, current_stage').eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest request not found', 404);

    if (imp.current_stage === 'director_rejected') {
      return fail(res, 'This request was already rejected by the Director.');
    }

    await supabaseAdmin.from('imprest_requests').update({
      status: 'rejected', rejection_reason: reason.trim(),
      approved_by: req.user.id, approved_at: new Date().toISOString(),
      current_stage: 's3_rejected',
    }).eq('id', req.params.id);

    await logAudit({
      userId: req.user.id, action: 'reject',
      entityType: 'expense', entityId: imp.id,
      oldValue: { status: imp.status }, newValue: { status: 'rejected', reason, current_stage: 's3_rejected' },
      ipAddress: req.ip,
    });

    return ok(res, { refId: imp.ref_id, status: 'rejected' });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// STAGE 1: Avisha Queue & Actions
// ════════════════════════════════════════════════════════════════════════════

// Helper: build enriched queue for any stage
async function buildStageQueue(req, stageFilter, routeFilter) {
  const { status, site, category, dateFrom, dateTo, employeeName, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let employeeIds = null;
  if (employeeName?.trim()) {
    const { data: matchingEmps } = await supabaseAdmin
      .from('employees').select('id').ilike('name', `%${employeeName.trim()}%`);
    employeeIds = matchingEmps?.map((e) => e.id) || [];
    if (employeeIds.length === 0) return { requests: [], total: 0, page: parseInt(page), limit: parseInt(limit) };
  }

  let query = supabaseAdmin
    .from('imprest_requests')
    .select(`*, employee:employee_id (id, name, email, phone, site), approver:approved_by (id, name)`, { count: 'exact' })
    .order('submitted_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (Array.isArray(stageFilter)) query = query.in('current_stage', stageFilter);
  else query = query.eq('current_stage', stageFilter);
  if (routeFilter) query = query.eq('approval_route', routeFilter);
  if (site && site !== 'all') query = query.eq('site', site);
  if (category && category !== 'all') query = query.eq('category', category);
  if (dateFrom) query = query.gte('submitted_at', dateFrom);
  if (dateTo) query = query.lte('submitted_at', dateTo + 'T23:59:59Z');
  if (employeeIds) query = query.in('employee_id', employeeIds);

  const { data, error, count } = await query;
  if (error) throw error;

  // Enrich with employee balance
  const empIds = [...new Set((data || []).map((r) => r.employee_id))];
  let empBalMap = {};
  if (empIds.length > 0) {
    const { data: empImps } = await supabaseAdmin
      .from('imprest_requests').select('id, employee_id, approved_amount, amount_requested')
      .in('employee_id', empIds).in('status', ['approved', 'partially_approved']);
    const aIds = (empImps || []).map((r) => r.id);
    let expMap = {};
    if (aIds.length > 0) {
      const { data: exps } = await supabaseAdmin.from('expenses').select('imprest_id, amount, status')
        .in('imprest_id', aIds).not('status', 'in', '("rejected","blocked")');
      for (const e of (exps || [])) { expMap[e.imprest_id] = (expMap[e.imprest_id] || 0) + parseFloat(e.amount); }
    }
    for (const imp of (empImps || [])) {
      const bal = Math.max(0, parseFloat(imp.approved_amount || imp.amount_requested) - (expMap[imp.id] || 0));
      empBalMap[imp.employee_id] = (empBalMap[imp.employee_id] || 0) + bal;
    }
  }

  const enriched = (data || []).map((r) => ({
    ...r,
    employee_total_balance: Math.round((empBalMap[r.employee_id] || 0) * 100) / 100,
  }));

  return { requests: enriched, total: count, page: parseInt(page), limit: parseInt(limit) };
}

// GET /api/imprest/s1/queue — Avisha's queue
router.get('/s1/queue', authMiddleware, roleGuard(S1_ROLES), async (req, res, next) => {
  try {
    const result = await buildStageQueue(req, 's1_pending', null);
    return ok(res, result);
  } catch (err) { next(err); }
});

// POST /api/imprest/:id/s1-approve — Avisha forwards
router.post('/:id/s1-approve', authMiddleware, roleGuard(S1_ROLES), async (req, res, next) => {
  try {
    const { notes } = req.body;
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, ref_id, current_stage, approval_route, amount_requested, employee_id, site, category, purpose, old_balance_deducted')
      .eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest not found', 404);
    if (imp.current_stage !== 's1_pending') return fail(res, 'Request is not at Stage 1');

    const now = new Date().toISOString();
    await supabaseAdmin.from('imprest_requests').update({
      current_stage: 's2_pending',
      s1_approved_by: req.user.id,
      s1_approved_at: now,
      s1_notes: notes || null,
    }).eq('id', req.params.id);

    // If director route, trigger WhatsApp to Bhaskar Sir
    if (imp.approval_route === 'avisha_director_finance') {
      try {
        const oldBal = parseFloat(imp.old_balance_deducted || 0);
        triggerFounderApproval({
          imprestId: imp.id,
          refId: imp.ref_id,
          requestedTo: 'Bhaskar Sir',
          employeeName: (await supabaseAdmin.from('employees').select('name').eq('id', imp.employee_id).single()).data?.name || '',
          employeeSite: imp.site,
          amount: parseFloat(imp.amount_requested),
          category: imp.category,
          purpose: imp.purpose || '',
          oldBalance: oldBal,
          submittedAt: now,
        }).catch((e) => console.warn('WF2 trigger failed:', e.message));
      } catch (e) { console.warn('Director WhatsApp trigger failed:', e.message); }
    }

    await logAudit({
      userId: req.user.id, action: 's1_approve',
      entityType: 'expense', entityId: imp.id,
      oldValue: { current_stage: 's1_pending' },
      newValue: { current_stage: 's2_pending', s1_notes: notes },
      ipAddress: req.ip,
    });

    return ok(res, {
      refId: imp.ref_id, currentStage: 's2_pending',
      message: imp.approval_route === 'avisha_director_finance'
        ? 'Forwarded — approval request sent to Director via WhatsApp'
        : 'Forwarded to Stage 2 reviewer',
    });
  } catch (err) { next(err); }
});

// POST /api/imprest/:id/s1-reject — Avisha rejects
router.post('/:id/s1-reject', authMiddleware, roleGuard(S1_ROLES), async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return fail(res, 'Rejection reason is required');
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests').select('id, ref_id, current_stage').eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest not found', 404);
    if (imp.current_stage !== 's1_pending') return fail(res, 'Request is not at Stage 1');

    await supabaseAdmin.from('imprest_requests').update({
      status: 'rejected', rejection_reason: reason.trim(),
      current_stage: 's1_pending', // stays at s1 but rejected
      s1_approved_by: req.user.id, s1_approved_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    await logAudit({
      userId: req.user.id, action: 's1_reject', entityType: 'expense', entityId: imp.id,
      newValue: { status: 'rejected', reason }, ipAddress: req.ip,
    });

    return ok(res, { refId: imp.ref_id, status: 'rejected' });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// STAGE 2: Ritu Queue & Actions
// ════════════════════════════════════════════════════════════════════════════

// GET /api/imprest/s2/queue — Ritu's queue (only avisha_ritu_finance route)
router.get('/s2/queue', authMiddleware, roleGuard(S2_ROLES), async (req, res, next) => {
  try {
    const result = await buildStageQueue(req, 's2_pending', 'avisha_ritu_finance');
    return ok(res, result);
  } catch (err) { next(err); }
});

// POST /api/imprest/:id/s2-approve — Ritu forwards to finance
router.post('/:id/s2-approve', authMiddleware, roleGuard(S2_ROLES), async (req, res, next) => {
  try {
    const { notes, approvedAmount } = req.body;
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, ref_id, current_stage, approval_route, amount_requested')
      .eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest not found', 404);
    if (imp.current_stage !== 's2_pending') return fail(res, 'Request is not at Stage 2');
    if (imp.approval_route !== 'avisha_ritu_finance') return fail(res, 'This request is not routed through Stage 2 reviewer');

    const updateFields = {
      current_stage: 's3_pending',
      s2_approved_by: req.user.id,
      s2_approved_at: new Date().toISOString(),
      s2_notes: notes || null,
    };
    // Ritu can reduce the amount
    if (approvedAmount && parseFloat(approvedAmount) < parseFloat(imp.amount_requested)) {
      updateFields.amount_requested = parseFloat(approvedAmount);
    }

    await supabaseAdmin.from('imprest_requests').update(updateFields).eq('id', req.params.id);

    await logAudit({
      userId: req.user.id, action: 's2_approve', entityType: 'expense', entityId: imp.id,
      oldValue: { current_stage: 's2_pending' },
      newValue: { current_stage: 's3_pending', s2_notes: notes },
      ipAddress: req.ip,
    });

    return ok(res, { refId: imp.ref_id, currentStage: 's3_pending', message: 'Forwarded to Finance team' });
  } catch (err) { next(err); }
});

// POST /api/imprest/:id/s2-reject — Ritu rejects
router.post('/:id/s2-reject', authMiddleware, roleGuard(S2_ROLES), async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return fail(res, 'Rejection reason is required');
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests').select('id, ref_id, current_stage, approval_route').eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest not found', 404);
    if (imp.current_stage !== 's2_pending') return fail(res, 'Request is not at Stage 2');

    await supabaseAdmin.from('imprest_requests').update({
      status: 'rejected', rejection_reason: reason.trim(),
      current_stage: 's2_rejected',
      s2_approved_by: req.user.id, s2_approved_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    await logAudit({
      userId: req.user.id, action: 's2_reject', entityType: 'expense', entityId: imp.id,
      newValue: { status: 'rejected', reason, current_stage: 's2_rejected' }, ipAddress: req.ip,
    });

    return ok(res, { refId: imp.ref_id, status: 'rejected' });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════════════════
// PAY: Finance marks imprest as paid — starts 3-day reminder
// ════════════════════════════════════════════════════════════════════════════

router.post('/:id/pay', authMiddleware, roleGuard(FINANCE_ROLES), upload.single('receipt'), async (req, res, next) => {
  try {
    const { data: imp, error: fetchErr } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, ref_id, current_stage, status, approved_amount, net_approved_amount, employee_id, category, old_balance_deducted')
      .eq('id', req.params.id).single();
    if (fetchErr || !imp) return fail(res, 'Imprest not found', 404);
    if (imp.current_stage !== 's3_approved') return fail(res, 'Can only pay approved requests');

    const paidAmount = parseFloat(imp.net_approved_amount || imp.approved_amount);

    const updateFields = {
      paid: true,
      paid_at: new Date().toISOString(),
      paid_by: req.user.id,
      paid_amount: Math.round(paidAmount * 100) / 100,
      current_stage: 'paid',
    };

    // Upload payment receipt if provided
    if (req.file) {
      const { uploadPaymentReceipt } = await import('../services/storageService.js');
      const receiptPath = await uploadPaymentReceipt(req.file.buffer, req.file.mimetype, imp.ref_id);
      updateFields.payment_receipt_path = receiptPath;
    }

    await supabaseAdmin.from('imprest_requests').update(updateFields).eq('id', req.params.id);

    // NOW start the 3-day expense reminder
    const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await supabaseAdmin.from('imprest_expense_reminders').insert({
        imprest_id: imp.id,
        employee_id: imp.employee_id,
        imprest_ref_id: imp.ref_id,
        deadline,
        status: 'pending',
      });
    } catch (e) { console.warn('Failed to create reminder:', e.message); }

    // Send WhatsApp notification
    try {
      const { data: emp } = await supabaseAdmin
        .from('employees').select('name, phone, site').eq('id', imp.employee_id).single();
      if (emp?.phone) {
        await sendImprestApprovalReminder({
          name: emp.name, phone: emp.phone, refId: imp.ref_id,
          approvedAmount: paidAmount, site: emp.site,
          category: imp.category || '', deadline,
        });
      }
    } catch (e) { console.warn('WhatsApp pay notification failed:', e.message); }

    await logAudit({
      userId: req.user.id, action: 'pay_imprest', entityType: 'expense', entityId: imp.id,
      newValue: { paid: true, paidAmount, current_stage: 'paid' }, ipAddress: req.ip,
    });

    return ok(res, { refId: imp.ref_id, status: 'paid', paidAmount: Math.round(paidAmount * 100) / 100 });
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
      .select('id, ref_id, status, current_stage, requires_founder_approval, amount_requested')
      .eq('id', req.params.id)
      .single();

    if (fetchErr || !imp) return fail(res, 'Imprest not found', 404);

    // Update founder review fields and advance the stage
    const now = new Date().toISOString();
    const updateFields = {
      founder_review_status: decision,
      founder_review_comment: comment || null,
      founder_review_at: now,
      founder_review_phone: reviewerPhone || null,
    };

    if (decision === 'approved') {
      // Director approved → skip S2, go straight to finance (s3_pending)
      updateFields.current_stage = 's3_pending';
      updateFields.director_approved_amount = imp.amount_requested;
    } else {
      // Director rejected → terminal state
      updateFields.current_stage = 'director_rejected';
      updateFields.status = 'rejected';
    }

    await supabaseAdmin.from('imprest_requests').update(updateFields).eq('id', req.params.id);

    await logAudit({
      userId: null, action: decision === 'approved' ? 'founder_approve' : 'founder_reject',
      entityType: 'expense', entityId: imp.id,
      oldValue: { current_stage: 's2_pending' },
      newValue: { current_stage: updateFields.current_stage, founder_comment: comment },
      ipAddress: req.ip,
    });

    // Broadcast update to finance dashboard
    try {
      broadcastNewImprest({
        id: imp.id,
        refId: imp.ref_id,
        type: 'founder_review',
        founderDecision: decision,
        founderComment: comment || '',
        currentStage: updateFields.current_stage,
      });
    } catch (e) { console.warn('WebSocket broadcast failed:', e.message); }

    return ok(res, {
      refId: imp.ref_id,
      founderDecision: decision,
      currentStage: updateFields.current_stage,
      message: decision === 'approved'
        ? 'Director approved — forwarded to Finance team'
        : 'Director rejected — request closed',
    });
  } catch (err) { next(err); }
});

export default router;
