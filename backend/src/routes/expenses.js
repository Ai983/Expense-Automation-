import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { upload } from '../middleware/upload.js';
import { uploadScreenshot, getSignedUrl } from '../services/storageService.js';
import { verifyExpense } from '../services/verificationService.js';
import { checkDuplicates } from '../services/duplicateService.js';
import { logAudit } from '../services/auditService.js';
import { generateRefId } from '../utils/refIdGenerator.js';
import { ok, fail } from '../utils/responseHelper.js';
import { resolveMimeType } from '../utils/fileType.js';
import {
  CATEGORIES,
  FINANCE_ROLES,
  FINANCE_HEAD_ROLES,
  CONFIDENCE_AUTO_APPROVE,
  CONFIDENCE_MANUAL_REVIEW,
  AMOUNT_TOLERANCE_INR,
  AI_AUDIT_MODE,
  MAX_FIX_ATTEMPTS,
} from '../config/constants.js';
import { runAuditAndPersist, sweepPendingAudits } from '../services/aiAuditService.js';
import { notifyExpenseRejected } from '../services/whatsappService.js';
import { imprestSpendLimit, IMPREST_SPEND_LIMIT_COLUMNS } from '../utils/imprestSpendLimit.js';
import { isValidSite } from '../config/sites.js';
import { broadcastNewExpense } from '../index.js';

const router = Router();

// ── POST /api/expenses/submit ─────────────────────────────────────────────────
// Employee submits an expense with one or more payment screenshots
router.post(
  '/submit',
  authMiddleware,
  roleGuard(['employee']),
  upload.fields([{ name: 'screenshots', maxCount: 5 }, { name: 'screenshot', maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const { site, amount, category, description, imprestId, settlementForExpenseId } = req.body;
      // Support both multi-file (screenshots) and legacy single-file (screenshot)
      const files = [
        ...(req.files?.screenshots || []),
        ...(req.files?.screenshot || []),
      ];

      // Clients can mislabel a file's type (the mobile PDF picker used to tag
      // every pick as application/pdf). Correct it from the bytes once, here,
      // so storage, OCR routing and attachmentType all agree downstream.
      for (const file of files) {
        file.mimetype = resolveMimeType(file.buffer, file.mimetype);
      }

      // Validation
      if (!site || !amount || !category) {
        return fail(res, 'site, amount, and category are required');
      }
      if (!imprestId && !(await isValidSite(site))) {
        return fail(res, 'Invalid site. Please pick a project from the list.');
      }
      if (!CATEGORIES.includes(category)) {
        return fail(res, `Invalid category. Must be one of: ${CATEGORIES.join(', ')}`);
      }
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return fail(res, 'Amount must be a positive number');
      }
      if (files.length === 0) {
        return fail(res, 'At least one payment screenshot is required');
      }

      // Expenses must be linked to a paid Imprest Request
      if (!imprestId) {
        return fail(res, 'An approved Imprest Request is required before submitting an expense. Please raise an Imprest Request and get it paid first.');
      }

      const { data: linkedImprest, error: imprestFetchErr } = await supabaseAdmin
        .from('imprest_requests')
        .select(`id, ref_id, employee_id, current_stage, paid_at, ${IMPREST_SPEND_LIMIT_COLUMNS}`)
        .eq('id', imprestId)
        .single();

      if (imprestFetchErr || !linkedImprest) {
        return fail(res, 'Invalid Imprest Request. Please select a valid imprest from your pending list.');
      }
      if (linkedImprest.employee_id !== req.user.id) {
        return fail(res, 'You can only submit expenses against your own Imprest Requests.');
      }
      if (linkedImprest.current_stage !== 'paid') {
        return fail(res, `Imprest ${linkedImprest.ref_id} has not been disbursed yet. You can only submit expenses against a paid imprest.`);
      }

      // Check remaining balance on this imprest
      const { data: priorExpenses } = await supabaseAdmin
        .from('expenses')
        .select('amount')
        .eq('imprest_id', imprestId)
        .not('status', 'in', '(rejected,blocked)');

      const alreadySpent = (priorExpenses || []).reduce((sum, e) => sum + parseFloat(e.amount), 0);
      // The cash actually handed over — not the approved figure. A founder cut
      // means they may only account for what was released.
      const approvedAmt = imprestSpendLimit(linkedImprest);
      const remainingBalance = Math.max(0, approvedAmt - alreadySpent);

      // Track overspend but allow the submission — finance reconciles the balance
      const overspendAmount = Math.max(0, parsedAmount - remainingBalance);

      const submittedAt = new Date().toISOString();

      // 1. Generate reference ID
      const refId = await generateRefId();

      // 2. Upload all screenshots to Supabase Storage
      const screenshotPaths = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const suffix = files.length > 1 ? `-${i + 1}` : '';
        const path = await uploadScreenshot(
          file.buffer,
          file.mimetype,
          req.user.id,
          `${refId}${suffix}`
        );
        screenshotPaths.push(path);
      }

      // 3. Run AI verification on the primary (first) screenshot
      const primaryFile = files[0];
      let verification = null;
      let ocrData = null;
      let verificationChecks = [];
      let autoAction = 'manual_review';
      let totalExtractedAmount = 0;
      const allOcrResults = [];

      const isPdf = primaryFile.mimetype === 'application/pdf';

      // Run OCR on each screenshot to extract amounts
      for (const file of files) {
        try {
          const v = await verifyExpense(file.buffer, {
            amount: parsedAmount,
            submittedAt,
            mimeType: file.mimetype,
            // Anchors the date check to the imprest period instead of the
            // submission date, so batching receipts within the 7-day deadline
            // is not treated as a failure.
            imprestPaidAt: linkedImprest?.paid_at || null,
          });
          allOcrResults.push({
            extractedAmount: v.ocrData?.amount || null,
            transactionId: v.ocrData?.transactionId || null,
            confidence: v.overallConfidence || 0,
          });
          totalExtractedAmount += parseFloat(v.ocrData?.amount || 0);

          // Use first file's full verification as primary
          if (!verification) {
            verification = v;
            ocrData = v.ocrData;
            verificationChecks = v.checks;
            const filePdf = file.mimetype === 'application/pdf';
            autoAction = filePdf && v.autoAction === 'blocked' ? 'manual_review' : v.autoAction;
          }
        } catch (visionErr) {
          console.warn('Vision API failed for a screenshot:', visionErr.message);
          allOcrResults.push({ extractedAmount: null, transactionId: null, confidence: 0 });
          if (!verification) {
            verificationChecks = [{ step: 'ocr', result: 'warn', score: 0, detail: 'Vision API unavailable' }];
          }
        }
      }

      // For multiple screenshots, re-verify using TOTAL extracted amount
      if (files.length > 1 && totalExtractedAmount > 0 && verification) {
        const totalDiff = Math.abs(totalExtractedAmount - parsedAmount);
        const tolerance = AMOUNT_TOLERANCE_INR;
        // Override the amount check with total from all screenshots
        const amountIdx = verificationChecks.findIndex((c) => c.step === 'amount_check');
        if (amountIdx >= 0) {
          if (totalDiff <= tolerance) {
            verificationChecks[amountIdx] = { step: 'amount_check', result: 'pass', score: 1, detail: `Match: Total OCR ₹${totalExtractedAmount} from ${files.length} screenshots vs submitted ₹${parsedAmount} (diff ₹${totalDiff.toFixed(2)})` };
          } else if (totalDiff <= tolerance * 3) {
            verificationChecks[amountIdx] = { step: 'amount_check', result: 'warn', score: 0.5, detail: `Close: Total OCR ₹${totalExtractedAmount} from ${files.length} screenshots vs submitted ₹${parsedAmount} (diff ₹${totalDiff.toFixed(2)})` };
          } else {
            verificationChecks[amountIdx] = { step: 'amount_check', result: 'fail', score: 0, detail: `Mismatch: Total OCR ₹${totalExtractedAmount} from ${files.length} screenshots vs submitted ₹${parsedAmount} (diff ₹${totalDiff.toFixed(2)})` };
          }
        }
        // Recalculate confidence with updated amount check
        const scores = { amount_check: 40, date_check: 20, status_check: 30, txn_id_check: 10 };
        const weightedScore = verificationChecks.reduce((sum, c) => sum + (c.score || 0) * (scores[c.step] || 0), 0);
        const ocrConf = verification.ocrData?.ocrConfidence || 50;
        const newConfidence = Math.round(weightedScore * 0.7 + ocrConf * 0.3);
        verification.overallConfidence = newConfidence;
        if (newConfidence >= CONFIDENCE_AUTO_APPROVE) autoAction = 'auto_verified';
        else if (newConfidence >= CONFIDENCE_MANUAL_REVIEW) autoAction = 'manual_review';
        else autoAction = 'blocked';
      }

      // 4. Run duplicate detection
      const duplicateResult = await checkDuplicates({
        employeeId: req.user.id,
        amount: parsedAmount,
        site,
        submittedAt,
        transactionId: ocrData?.transactionId || null,
        imprestId: imprestId || null,
      });

      // 5. Determine final status
      let finalStatus;
      if (duplicateResult.isBlocked) {
        finalStatus = 'blocked';
      } else if (autoAction === 'auto_verified' && duplicateResult.warnings.length === 0) {
        finalStatus = 'verified';
      } else if (autoAction === 'manual_review' || duplicateResult.warnings.length > 0) {
        finalStatus = 'manual_review';
      } else {
        finalStatus = 'blocked';
      }

      // 6. Build screenshot_metadata JSONB
      const screenshotMetadata = {
        attachmentType: isPdf ? 'pdf' : 'image',
        screenshotCount: files.length,
        screenshots: screenshotPaths,
        allOcrResults,
        totalExtractedAmount: totalExtractedAmount > 0 ? Math.round(totalExtractedAmount * 100) / 100 : null,
        transactionId: ocrData?.transactionId || null,
        extractedAmount: ocrData?.amount || null,
        date: ocrData?.date || null,
        paymentStatus: ocrData?.paymentStatus || null,
        confidence: verification?.overallConfidence || 0,
        rawText: ocrData?.rawText ? ocrData.rawText.slice(0, 1000) : null,
        duplicateWarnings: duplicateResult.warnings,
        verificationChecks,
      };

      // 7. Insert expense
      const { data: expense, error: insertError } = await supabaseAdmin
        .from('expenses')
        .insert({
          ref_id: refId,
          employee_id: req.user.id,
          site,
          amount: parsedAmount,
          original_amount: parsedAmount,
          category,
          description: description || null,
          screenshot_url: screenshotPaths[0],
          screenshot_metadata: screenshotMetadata,
          status: finalStatus,
          duplicate_flag: duplicateResult.isDuplicate,
          duplicate_ref: duplicateResult.blockReason ? 'BLOCKED' : null,
          submitted_at: submittedAt,
          verified_at: finalStatus === 'verified' ? submittedAt : null,
          imprest_id: imprestId,
          overspend_amount: overspendAmount,
          settlement_for_expense_id: settlementForExpenseId || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // 8. Insert verification logs
      const logRows = verificationChecks.map((check) => ({
        expense_id: expense.id,
        step: check.step,
        result: check.result === 'pass' ? 'pass' : check.result === 'fail' ? 'fail' : 'warn',
        confidence: verification?.overallConfidence || null,
        details: { score: check.score, detail: check.detail },
      }));

      if (logRows.length > 0) {
        await supabaseAdmin.from('verification_logs').insert(logRows);
      }

      // Duplicate check log entry
      await supabaseAdmin.from('verification_logs').insert({
        expense_id: expense.id,
        step: 'duplicate_check',
        result: duplicateResult.isBlocked ? 'block' : duplicateResult.warnings.length > 0 ? 'warn' : 'pass',
        confidence: null,
        details: {
          isBlocked: duplicateResult.isBlocked,
          blockReason: duplicateResult.blockReason,
          warnings: duplicateResult.warnings,
        },
      });

      // 9. Audit trail
      await logAudit({
        userId: req.user.id,
        action: 'submit_expense',
        entityType: 'expense',
        entityId: expense.id,
        newValue: { refId, amount: parsedAmount, site, category, status: finalStatus },
        ipAddress: req.ip,
      });

      // 10. Broadcast to finance dashboard via WebSocket
      try {
        broadcastNewExpense({
          id: expense.id,
          refId,
          employeeName: req.user.name,
          site,
          amount: parsedAmount,
          category,
          status: finalStatus,
          confidence: verification?.overallConfidence || 0,
          submittedAt,
        });
      } catch (wsErr) {
        console.warn('WebSocket broadcast failed (non-fatal):', wsErr.message);
      }

      // 11. AI audit — replaces the manual expense check.
      // Deliberately NOT awaited: the employee gets their confirmation now, and
      // the verdict lands for finance a few seconds later over WebSocket. A
      // failure here can never affect the submission (see runAuditAndPersist,
      // which never throws), and the sweeper retries anything missed.
      if (AI_AUDIT_MODE !== 'off') {
        runAuditAndPersist(expense.id, { files }).catch((auditErr) =>
          console.warn('AI audit dispatch failed (non-fatal):', auditErr.message)
        );
      }

      return ok(res, {
        // Needed by the app to poll for the AI's employee-facing fix hint.
        expenseId: expense.id,
        refId,
        status: finalStatus,
        confidence: verification?.overallConfidence || 0,
        transactionId: ocrData?.transactionId || null,
        duplicateWarnings: duplicateResult.warnings,
        blockReason: duplicateResult.blockReason,
        message: getStatusMessage(finalStatus),
      }, 201);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/expenses/finance/adjustments ────────────────────────────────────
// Finance view: all employees with finance-adjusted expenses that are not yet
// fully settled, grouped by employee with per-expense detail.
router.get(
  '/finance/adjustments',
  authMiddleware,
  roleGuard(FINANCE_HEAD_ROLES),
  async (req, res, next) => {
    try {
      // 1. All approved expenses where finance reduced the amount (no FK join)
      const { data: adjusted, error: adjErr } = await supabaseAdmin
        .from('expenses')
        .select('id, ref_id, site, amount, original_amount, category, approved_at, imprest_id, employee_id')
        .eq('status', 'approved')
        .not('original_amount', 'is', null)
        .order('approved_at', { ascending: false });

      if (adjErr) throw adjErr;

      console.log('[finance/adjustments] total approved with original_amount:', (adjusted || []).length);
      const reduced = (adjusted || []).filter(
        (e) => parseFloat(e.original_amount) > parseFloat(e.amount) + 0.01
      );
      console.log('[finance/adjustments] reduced by finance:', reduced.length, reduced.map(e => ({ ref: e.ref_id, orig: e.original_amount, amt: e.amount })));

      if (reduced.length === 0) return ok(res, { employees: [], totalUnsettled: 0 });

      // 2. Fetch employee details separately (avoids FK join nulls)
      const uniqueEmpIds = [...new Set(reduced.map((e) => e.employee_id).filter(Boolean))];
      const empById = {};
      if (uniqueEmpIds.length > 0) {
        const { data: empRows } = await supabaseAdmin
          .from('employees')
          .select('id, name, email, site')
          .in('id', uniqueEmpIds);
        for (const emp of empRows || []) empById[emp.id] = emp;
      }

      // 3. All settlement expenses linked to these adjusted expenses
      const adjustedIds = reduced.map((e) => e.id);
      let settlements = [];
      try {
        const { data: rows, error: settleErr } = await supabaseAdmin
          .from('expenses')
          .select('settlement_for_expense_id, amount, status')
          .in('settlement_for_expense_id', adjustedIds)
          .not('status', 'in', '(rejected,blocked)');
        if (!settleErr) settlements = rows || [];
      } catch {
        // settlement_for_expense_id column may not exist yet — treat as no settlements
      }

      console.log('[finance/adjustments] settlements found:', settlements.length, settlements.map(s => ({ id: s.settlement_for_expense_id?.slice(0,8), amt: s.amount, status: s.status })));

      // 4. Build settlement map: adjustedExpenseId → total settled
      const settledMap = {};
      for (const s of settlements || []) {
        const key = s.settlement_for_expense_id;
        settledMap[key] = (settledMap[key] || 0) + parseFloat(s.amount);
      }

      // 5. Compute remaining per expense, keep only unsettled ones
      const unsettled = reduced
        .map((e) => {
          const gap = parseFloat(e.original_amount) - parseFloat(e.amount);
          const settledSoFar = Math.round((settledMap[e.id] || 0) * 100) / 100;
          const remaining = Math.max(0, Math.round((gap - settledSoFar) * 100) / 100);
          return { ...e, gap: Math.round(gap * 100) / 100, settledSoFar, remaining };
        })
        .filter((e) => e.remaining > 0.01);

      console.log('[finance/adjustments] unsettled after step5:', unsettled.map(e => ({ ref: e.ref_id, empId: e.employee_id, gap: e.gap, remaining: e.remaining })));
      console.log('[finance/adjustments] empById keys:', Object.keys(empById));

      // 6. Group by employee — use 'unknown' bucket if employee_id is null
      const empMap = {};
      for (const e of unsettled) {
        const empId = e.employee_id || `unknown_${e.id}`;
        const emp = empById[e.employee_id] || { id: e.employee_id, name: e.employee_id ? 'Unknown Employee' : '(no employee linked)', email: '', site: e.site || '' };
        console.log('[finance/adjustments] step6 empId:', empId, 'emp:', emp.name);
        if (!empMap[empId]) {
          empMap[empId] = {
            employeeId: empId,
            name: emp.name,
            email: emp.email,
            site: emp.site,
            totalRemaining: 0,
            totalGap: 0,
            adjustments: [],
          };
        }
        empMap[empId].totalRemaining = Math.round((empMap[empId].totalRemaining + e.remaining) * 100) / 100;
        empMap[empId].totalGap = Math.round((empMap[empId].totalGap + e.gap) * 100) / 100;
        empMap[empId].adjustments.push({
          id: e.id,
          ref_id: e.ref_id,
          site: e.site,
          category: e.category,
          originalAmount: parseFloat(e.original_amount),
          approvedAmount: parseFloat(e.amount),
          gap: e.gap,
          settledSoFar: e.settledSoFar,
          remaining: e.remaining,
          approvedAt: e.approved_at,
          imprestId: e.imprest_id,
        });
      }

      const employees = Object.values(empMap).sort((a, b) => b.totalRemaining - a.totalRemaining);
      return ok(res, { employees, totalUnsettled: employees.reduce((s, e) => s + e.totalRemaining, 0) });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/expenses/finance/queue ──────────────────────────────────────────
// Finance team views the expense queue with filters
router.get(
  '/finance/queue',
  authMiddleware,
  roleGuard(FINANCE_HEAD_ROLES),
  async (req, res, next) => {
    try {
      const { status, site, dateFrom, dateTo, employeeId, aiVerdict, stage, page = 1, limit = 50 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabaseAdmin
        .from('expenses')
        .select(`
          id, ref_id, site, amount, category, description, status,
          duplicate_flag, duplicate_ref, submitted_at, verified_at, imprest_id,
          approved_at, rejection_reason, screenshot_metadata, overspend_amount,
          ai_verdict, ai_confidence, ai_audit, ai_audited_at, ai_model, ai_auto_approved,
          awaiting_fix_until, fix_requested_at, fix_request_reason, fix_attempt_count,
          employee:employee_id (id, name, email, phone, site),
          approver:approved_by (id, name)
        `, { count: 'exact' })
        .order('submitted_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (status && status !== 'all') query = query.eq('status', status);
      if (site && site !== 'all') query = query.eq('site', site);
      if (employeeId && employeeId !== 'all') query = query.eq('employee_id', employeeId);
      if (dateFrom) query = query.gte('submitted_at', dateFrom);
      if (dateTo) query = query.lte('submitted_at', dateTo + 'T23:59:59Z');

      // Ownership: an expense is either the employee's or finance's, never both.
      // Rows waiting on an employee correction are excluded from the review
      // queue by default — they are not finance's problem yet — but remain
      // reachable via stage=awaiting_fix so nothing is ever invisible.
      if (stage === 'awaiting_fix') {
        query = query.not('awaiting_fix_until', 'is', null).gt('awaiting_fix_until', new Date().toISOString());
      } else if (stage !== 'all') {
        query = query.or(`awaiting_fix_until.is.null,awaiting_fix_until.lte.${new Date().toISOString()}`);
      }

      // AI auditor filters. 'needs_attention' is the queue a human works:
      // everything the AI would not clear on its own.
      if (aiVerdict && aiVerdict !== 'all') {
        // Defined by whether a person still has to act, NOT by what the AI said.
        // Building it out of verdicts kept leaking: 'error' was missing, then
        // approve-verdicts a rail had held back, then rows the AI leaves as
        // 'verified' because downgrading them would corrupt the imprest balance.
        // Every one of those needs a human but fell outside a verdict list.
        //
        // An expense is either resolved (approved/rejected), with the employee
        // (awaiting fix), or it is finance's. There is no fourth place.
        // (Rows with the employee are already excluded above.)
        if (aiVerdict === 'needs_attention') {
          query = query
            .in('status', ['pending', 'verified', 'manual_review'])
            .not('ai_auto_approved', 'is', true);
        }
        // Approved without a human ever seeing it. Distinct from an 'approve'
        // verdict, which includes ones a rail held back for a person to confirm.
        else if (aiVerdict === 'auto_approved') query = query.eq('ai_auto_approved', true);
        else if (aiVerdict === 'unaudited') query = query.is('ai_verdict', null);
        else query = query.eq('ai_verdict', aiVerdict);
      }

      const { data: expenses, error, count } = await query;
      if (error) throw error;

      return ok(res, { expenses, total: count, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/expenses/my-adjustments/:employeeId ─────────────────────────────
// Returns approved expenses where finance reduced the amount — employee must settle the gap
router.get('/my-adjustments/:employeeId', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role === 'employee' && req.user.id !== req.params.employeeId) {
      return fail(res, 'Access denied', 403);
    }

    const { data: rows, error } = await supabaseAdmin
      .from('expenses')
      .select('id, ref_id, site, amount, original_amount, category, imprest_id, approved_at')
      .eq('employee_id', req.params.employeeId)
      .eq('status', 'approved')
      .not('original_amount', 'is', null)
      .order('approved_at', { ascending: false });

    if (error) throw error;

    // Keep only rows where finance actually reduced the amount
    const reduced = (rows || []).filter(
      (e) => parseFloat(e.original_amount) > parseFloat(e.amount) + 0.01
    );

    // For each, subtract already-approved settlement expenses
    const adjustments = await Promise.all(
      reduced.map(async (adj) => {
        let settledSoFar = 0;
        try {
          const { data: settlements } = await supabaseAdmin
            .from('expenses')
            .select('amount')
            .eq('settlement_for_expense_id', adj.id)
            .not('status', 'in', '(rejected,blocked)');
          settledSoFar = (settlements || []).reduce((sum, s) => sum + parseFloat(s.amount), 0);
        } catch { /* settlement_for_expense_id column may not exist yet */ }

        const gapAmount = parseFloat(adj.original_amount) - parseFloat(adj.amount);
        const remaining = Math.max(0, Math.round((gapAmount - settledSoFar) * 100) / 100);
        return { ...adj, remaining, settledSoFar: Math.round(settledSoFar * 100) / 100 };
      })
    );

    // Only surface adjustments that still have an unsettled balance
    return ok(res, { adjustments: adjustments.filter((a) => a.remaining > 0.01) });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/expenses/my-expenses/:employeeId ─────────────────────────────────
router.get('/my-expenses/:employeeId', authMiddleware, async (req, res, next) => {
  try {
    // Employees can only view their own expenses
    if (req.user.role === 'employee' && req.user.id !== req.params.employeeId) {
      return fail(res, 'Access denied', 403);
    }

    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { data: expenses, error, count } = await supabaseAdmin
      .from('expenses')
      .select('id, ref_id, site, amount, original_amount, category, description, status, submitted_at, verified_at, approved_at, rejection_reason, duplicate_flag, screenshot_metadata, awaiting_fix_until, fix_request_reason, fix_attempt_count', { count: 'exact' })
      .eq('employee_id', req.params.employeeId)
      .order('submitted_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) throw error;

    return ok(res, { expenses, total: count, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/expenses/:expenseId/details ──────────────────────────────────────
router.get('/:expenseId/details', authMiddleware, async (req, res, next) => {
  try {
    const { data: expense, error } = await supabaseAdmin
      .from('expenses')
      .select(`
        *,
        employee:employee_id (id, name, email, phone, site),
        verifier:verified_by (id, name),
        approver:approved_by (id, name),
        verification_logs (*)
      `)
      .eq('id', req.params.expenseId)
      .single();

    if (error || !expense) return fail(res, 'Expense not found', 404);

    // Employees can only see their own
    if (req.user.role === 'employee' && expense.employee_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    // Generate signed URL for primary screenshot — pass submitted_at so legacy
    // storage is used for pre-migration expenses (before STORAGE_CUTOVER_DATE).
    const screenshotSignedUrl = await getSignedUrl(expense.screenshot_url, expense.submitted_at);

    // Generate signed URLs for all screenshots if multiple were uploaded
    let allScreenshotUrls = [];
    const meta = expense.screenshot_metadata || {};
    if (meta.screenshots?.length > 1) {
      allScreenshotUrls = await Promise.all(
        meta.screenshots.map((path) => getSignedUrl(path, expense.submitted_at))
      );
    } else if (screenshotSignedUrl) {
      allScreenshotUrls = [screenshotSignedUrl];
    }

    return ok(res, { ...expense, screenshotSignedUrl, allScreenshotUrls });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/expenses/:expenseId/approve ─────────────────────────────────────
router.post(
  '/:expenseId/approve',
  authMiddleware,
  roleGuard(FINANCE_ROLES),
  async (req, res, next) => {
    try {
      const { adjustedAmount, source } = req.body || {};
      const { data: expense, error: fetchErr } = await supabaseAdmin
        .from('expenses')
        .select('id, ref_id, status, amount, original_amount, employee_id')
        .eq('id', req.params.expenseId)
        .single();

      if (fetchErr || !expense) return fail(res, 'Expense not found', 404);

      if (!['pending', 'verified', 'manual_review', 'blocked'].includes(expense.status)) {
        return fail(res, `Cannot approve expense with status: ${expense.status}`);
      }

      const updateFields = {
        status: 'approved',
        approved_by: req.user.id,
        approved_at: new Date().toISOString(),
      };

      // Finance can adjust the amount (e.g. OCR shows ₹290 but employee claimed ₹300)
      const finalAmount = adjustedAmount != null ? parseFloat(adjustedAmount) : null;
      if (finalAmount != null) {
        if (isNaN(finalAmount) || finalAmount <= 0) return fail(res, 'Invalid adjusted amount');
        updateFields.amount = finalAmount;
        // Preserve original_amount if not already set (first-time approval with adjustment)
        if (!expense.original_amount) {
          updateFields.original_amount = expense.amount;
        }
      }

      const { error: updateErr } = await supabaseAdmin
        .from('expenses')
        .update(updateFields)
        .eq('id', req.params.expenseId);

      if (updateErr) throw updateErr;

      // If finance reduced the amount, write a verification log so the employee
      // can see exactly what was approved and what remains to be settled.
      const claimedAmt = expense.original_amount || expense.amount;
      const approvedAmt = finalAmount || expense.amount;
      const isPartial = finalAmount != null && Math.abs(approvedAmt - claimedAmt) > 0.01;

      if (isPartial) {
        const remaining = Math.round((claimedAmt - approvedAmt) * 100) / 100;
        await supabaseAdmin.from('verification_logs').insert({
          expense_id: expense.id,
          step: 'finance_adjustment',
          result: 'warn',
          confidence: null,
          details: {
            claimedAmount: claimedAmt,
            approvedAmount: approvedAmt,
            reducedBy: remaining,
            note: `Finance approved ₹${approvedAmt.toLocaleString('en-IN')} against claimed ₹${claimedAmt.toLocaleString('en-IN')}. ₹${remaining.toLocaleString('en-IN')} was not reimbursed — please settle this amount separately.`,
          },
        });
      }

      await logAudit({
        userId: req.user.id,
        action: 'approve',
        entityType: 'expense',
        entityId: expense.id,
        oldValue: { status: expense.status, amount: expense.amount },
        newValue: {
          status: 'approved',
          amount: approvedAmt,
          // Records whether the reviewer accepted the AI recommendation or
          // decided independently — needed to measure AI/human agreement.
          ...(source === 'ai_recommendation' ? { source: 'ai_recommendation' } : {}),
        },
        ipAddress: req.ip,
      });

      return ok(res, { refId: expense.ref_id, status: 'approved', message: 'Expense approved', adjustedAmount: finalAmount });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/expenses/:expenseId/reject ──────────────────────────────────────
router.post(
  '/:expenseId/reject',
  authMiddleware,
  roleGuard(FINANCE_ROLES),
  async (req, res, next) => {
    try {
      const { reason } = req.body;
      if (!reason?.trim()) {
        return fail(res, 'Rejection reason is required');
      }

      const { data: expense, error: fetchErr } = await supabaseAdmin
        .from('expenses')
        .select('id, ref_id, status, amount, imprest_id, employee_id, category, employee:employee_id (name, phone)')
        .eq('id', req.params.expenseId)
        .single();

      if (fetchErr || !expense) return fail(res, 'Expense not found', 404);

      if (expense.status === 'approved') {
        return fail(res, 'Cannot reject an already approved expense');
      }

      const { error: updateErr } = await supabaseAdmin
        .from('expenses')
        .update({
          status: 'rejected',
          rejection_reason: reason.trim(),
          approved_by: req.user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', req.params.expenseId);

      if (updateErr) throw updateErr;

      // If expense was linked to an imprest, reverse the fulfilled amount on the reminder
      if (expense.imprest_id) {
        try {
          const { data: reminder } = await supabaseAdmin
            .from('imprest_expense_reminders')
            .select('id, fulfilled_amount')
            .eq('imprest_id', expense.imprest_id)
            .single();

          if (reminder) {
            const newFulfilled = Math.max(0, parseFloat(reminder.fulfilled_amount || 0) - parseFloat(expense.amount));
            await supabaseAdmin
              .from('imprest_expense_reminders')
              .update({
                fulfilled_amount: newFulfilled,
                status: 'pending', // re-open the reminder since amount is no longer covered
              })
              .eq('id', reminder.id);
            console.log(`Reversed ₹${expense.amount} on imprest reminder for ${expense.imprest_id}, new fulfilled: ₹${newFulfilled}`);
          }
        } catch (e) {
          console.warn('Failed to reverse imprest fulfilled amount:', e.message);
        }
      }

      // Tell the employee now, not whenever they next open the app. 80% of
      // rejected employees resubmit and 74% of those get approved — the loop
      // works, it was just slow (median 38 hours to even notice).
      notifyExpenseRejected({
        name: expense.employee?.name,
        phone: expense.employee?.phone,
        refId: expense.ref_id,
        amount: expense.amount,
        category: expense.category,
        reason: reason.trim(),
      }).catch((waErr) => console.warn('Rejection WhatsApp failed (non-fatal):', waErr.message));

      await logAudit({
        userId: req.user.id,
        action: 'reject',
        entityType: 'expense',
        entityId: expense.id,
        oldValue: { status: expense.status },
        newValue: { status: 'rejected', reason },
        ipAddress: req.ip,
      });

      return ok(res, { refId: expense.ref_id, status: 'rejected', message: 'Expense rejected' });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/expenses/bulk-approve ──────────────────────────────────────────
router.post(
  '/bulk-approve',
  authMiddleware,
  roleGuard(FINANCE_ROLES),
  async (req, res, next) => {
    try {
      const { expenseIds } = req.body;

      if (!Array.isArray(expenseIds) || expenseIds.length === 0) {
        return fail(res, 'expenseIds must be a non-empty array');
      }
      if (expenseIds.length > 100) {
        return fail(res, 'Maximum 100 expenses can be bulk-approved at once');
      }

      const { data: updatedExpenses, error } = await supabaseAdmin
        .from('expenses')
        .update({
          status: 'approved',
          approved_by: req.user.id,
          approved_at: new Date().toISOString(),
        })
        .in('id', expenseIds)
        .in('status', ['pending', 'verified', 'manual_review', 'blocked'])
        .select('id, ref_id');

      if (error) throw error;

      // Log bulk action
      await logAudit({
        userId: req.user.id,
        action: 'bulk_approve',
        entityType: 'expense',
        newValue: { count: updatedExpenses.length, expenseIds },
        ipAddress: req.ip,
      });

      return ok(res, {
        approved: updatedExpenses.length,
        refIds: updatedExpenses.map((e) => e.ref_id),
        message: `${updatedExpenses.length} expenses approved`,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/expenses/:expenseId/fix ────────────────────────────────────────
// The employee replaces the receipt on an expense the AI handed back to them.
//
// This updates the SAME row. Without it the only way to correct a mistake is to
// file a second expense, which leaves the bad one in the queue, trips a false
// duplicate flag on the corrected one, and double-counts the imprest balance —
// all of which has already happened in production.
//
// One attempt only. The re-audit decides where it goes next: approved, or to
// finance flagged as already attempted.
router.post(
  '/:expenseId/fix',
  authMiddleware,
  upload.fields([{ name: 'screenshots', maxCount: 5 }, { name: 'screenshot', maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const files = [...(req.files?.screenshots || []), ...(req.files?.screenshot || [])];
      if (files.length === 0) return fail(res, 'At least one payment screenshot is required');
      for (const file of files) file.mimetype = resolveMimeType(file.buffer, file.mimetype);

      const { data: expense, error: fetchErr } = await supabaseAdmin
        .from('expenses')
        .select('id, ref_id, employee_id, status, amount, awaiting_fix_until, fix_attempt_count, screenshot_metadata')
        .eq('id', req.params.expenseId)
        .single();

      if (fetchErr || !expense) return fail(res, 'Expense not found', 404);
      if (expense.employee_id !== req.user.id) return fail(res, 'You can only correct your own expenses', 403);
      if (!expense.awaiting_fix_until) {
        return fail(res, 'This expense is not waiting for a correction. It is already with the finance team.');
      }
      if (!['pending', 'verified', 'manual_review'].includes(expense.status)) {
        return fail(res, `This expense can no longer be changed (status: ${expense.status})`);
      }
      if ((expense.fix_attempt_count || 0) >= MAX_FIX_ATTEMPTS) {
        return fail(res, 'You have already corrected this expense once. It is now with the finance team.');
      }

      // Upload the replacements alongside the originals — the old files are kept
      // so finance can still see what was first submitted.
      const newPaths = [];
      for (let i = 0; i < files.length; i++) {
        const suffix = `-fix${(expense.fix_attempt_count || 0) + 1}${files.length > 1 ? `-${i + 1}` : ''}`;
        newPaths.push(await uploadScreenshot(files[i].buffer, files[i].mimetype, req.user.id, `${expense.ref_id}${suffix}`));
      }

      const prevMeta = expense.screenshot_metadata || {};
      const attemptNo = (expense.fix_attempt_count || 0) + 1;

      const { error: updateErr } = await supabaseAdmin
        .from('expenses')
        .update({
          screenshot_url: newPaths[0],
          screenshot_metadata: {
            ...prevMeta,
            attachmentType: files[0].mimetype === 'application/pdf' ? 'pdf' : 'image',
            screenshotCount: newPaths.length,
            screenshots: newPaths,
            supersededScreenshots: prevMeta.screenshots || [],
            fixAttempt: attemptNo,
          },
          fix_attempt_count: attemptNo,
          fixed_at: new Date().toISOString(),
          // Back out of the employee's stage — the re-audit decides what happens.
          awaiting_fix_until: null,
          // Clear the verdict so this is judged on the new evidence, not the old.
          ai_verdict: null,
          ai_confidence: null,
          ai_audit: null,
        })
        .eq('id', expense.id);

      if (updateErr) throw updateErr;

      await logAudit({
        userId: req.user.id,
        action: 'fix_expense',
        entityType: 'expense',
        entityId: expense.id,
        newValue: { attempt: attemptNo, screenshots: newPaths.length },
        ipAddress: req.ip,
      });

      // Re-audit against the new receipt straight away.
      if (AI_AUDIT_MODE !== 'off') {
        runAuditAndPersist(expense.id, { files }).catch((err) =>
          console.warn('Re-audit after fix failed (non-fatal):', err.message)
        );
      }

      return ok(res, {
        expenseId: expense.id,
        refId: expense.ref_id,
        message: 'Thank you — your corrected receipt is being checked.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/expenses/:expenseId/audit-status ────────────────────────────────
// Lightweight poll for the mobile app right after submission. The AI audit
// finishes a few seconds later; if it finds something the EMPLOYEE can fix
// (blurry screenshot, a bill instead of a payment confirmation), they are told
// immediately — while they still have the receipt in hand — instead of finding
// out days later. Historically employees took a median of 38 hours to discover
// a rejection, and 29 of them took over a week.
router.get('/:expenseId/audit-status', authMiddleware, async (req, res, next) => {
  try {
    const { data: expense, error } = await supabaseAdmin
      .from('expenses')
      .select('id, ref_id, employee_id, status, ai_verdict, ai_audit, ai_audited_at')
      .eq('id', req.params.expenseId)
      .single();

    if (error || !expense) return fail(res, 'Expense not found', 404);
    if (req.user.role === 'employee' && expense.employee_id !== req.user.id) {
      return fail(res, 'Access denied', 403);
    }

    return ok(res, {
      refId: expense.ref_id,
      status: expense.status,
      audited: expense.ai_verdict != null,
      // Deliberately NOT exposing the verdict or reasoning to employees — that
      // is finance's decision to make and communicate. Only the actionable hint.
      fixHint: expense.ai_audit?.employee_fix_hint || null,
      auditedAt: expense.ai_audited_at,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/expenses/internal/ai-audit-sweep ───────────────────────────────
// Manual/backlog trigger for the AI auditor. Shared-secret guarded (same
// pattern as the n8n founder-review callback) so it can be fired from a script
// or a scheduled job without a user session.
router.post('/internal/ai-audit-sweep', async (req, res, next) => {
  try {
    const secret = req.get('x-n8n-secret');
    if (!process.env.N8N_INTERNAL_SECRET || secret !== process.env.N8N_INTERNAL_SECRET) {
      return fail(res, 'Unauthorized', 401);
    }

    const limit = Math.min(parseInt(req.body?.limit || '5'), 50);
    const result = await sweepPendingAudits({ limit });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatusMessage(status) {
  const messages = {
    verified: 'Expense auto-verified successfully. Awaiting final approval.',
    manual_review: 'Expense submitted for manual review by finance team.',
    blocked: 'Expense blocked due to duplicate detection or low verification confidence.',
    pending: 'Expense submitted and pending review.',
  };
  return messages[status] || 'Expense submitted.';
}

export default router;
