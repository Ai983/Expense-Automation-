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
import { SITES, CATEGORIES, FINANCE_ROLES, FINANCE_HEAD_ROLES } from '../config/constants.js';
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
      const { site, amount, category, description, imprestId } = req.body;
      // Support both multi-file (screenshots) and legacy single-file (screenshot)
      const files = [
        ...(req.files?.screenshots || []),
        ...(req.files?.screenshot || []),
      ];

      // Validation
      if (!site || !amount || !category) {
        return fail(res, 'site, amount, and category are required');
      }
      if (!SITES.includes(site)) {
        return fail(res, `Invalid site. Must be one of: ${SITES.join(', ')}`);
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
        .select('id, ref_id, employee_id, amount_requested, approved_amount, current_stage')
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
        .not('status', 'in', '("rejected","blocked")');

      const alreadySpent = (priorExpenses || []).reduce((sum, e) => sum + parseFloat(e.amount), 0);
      const approvedAmt = parseFloat(linkedImprest.approved_amount || linkedImprest.amount_requested);
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
        const tolerance = parseFloat(process.env.AMOUNT_TOLERANCE_INR || '10');
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
        const autoApprove = parseFloat(process.env.CONFIDENCE_AUTO_APPROVE || '94');
        const manualReview = parseFloat(process.env.CONFIDENCE_MANUAL_REVIEW || '70');
        if (newConfidence >= autoApprove) autoAction = 'auto_verified';
        else if (newConfidence >= manualReview) autoAction = 'manual_review';
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

      return ok(res, {
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

// ── GET /api/expenses/finance/queue ──────────────────────────────────────────
// Finance team views the expense queue with filters
router.get(
  '/finance/queue',
  authMiddleware,
  roleGuard(FINANCE_HEAD_ROLES),
  async (req, res, next) => {
    try {
      const { status, site, dateFrom, dateTo, employeeId, page = 1, limit = 50 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let query = supabaseAdmin
        .from('expenses')
        .select(`
          id, ref_id, site, amount, category, description, status,
          duplicate_flag, duplicate_ref, submitted_at, verified_at, imprest_id,
          approved_at, rejection_reason, screenshot_metadata, overspend_amount,
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

      const { data: expenses, error, count } = await query;
      if (error) throw error;

      return ok(res, { expenses, total: count, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
      next(err);
    }
  }
);

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
      .select('id, ref_id, site, amount, category, description, status, submitted_at, verified_at, approved_at, rejection_reason, duplicate_flag, screenshot_metadata', { count: 'exact' })
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

    // Generate signed URL for primary screenshot
    const screenshotSignedUrl = await getSignedUrl(expense.screenshot_url);

    // Generate signed URLs for all screenshots if multiple were uploaded
    let allScreenshotUrls = [];
    const meta = expense.screenshot_metadata || {};
    if (meta.screenshots?.length > 1) {
      allScreenshotUrls = await Promise.all(
        meta.screenshots.map((path) => getSignedUrl(path))
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
      const { adjustedAmount } = req.body || {};
      const { data: expense, error: fetchErr } = await supabaseAdmin
        .from('expenses')
        .select('id, ref_id, status, amount, employee_id')
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
      }

      const { error: updateErr } = await supabaseAdmin
        .from('expenses')
        .update(updateFields)
        .eq('id', req.params.expenseId);

      if (updateErr) throw updateErr;

      await logAudit({
        userId: req.user.id,
        action: 'approve',
        entityType: 'expense',
        entityId: expense.id,
        oldValue: { status: expense.status, amount: expense.amount },
        newValue: { status: 'approved', amount: finalAmount || expense.amount },
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
        .select('id, ref_id, status, amount, imprest_id')
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
