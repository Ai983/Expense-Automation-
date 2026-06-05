// backend/src/routes/poPayments.js
// SPEC-02 — PO Payment processing: Procurement review (Stage 1) → Finance payment (Stage 2)
import express from 'express';
import multer from 'multer';
import { supabaseAdmin, cpsSupabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok, fail } from '../utils/responseHelper.js';
import { logAudit } from '../services/auditService.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Roles ──────────────────────────────────────────────────────────────────
const PROCUREMENT_ROLES = ['procurement_finance', 'admin'];
const FINANCE_ROLES = ['finance', 'manager', 'admin'];
const ALL_VIEWER_ROLES = ['procurement_finance', 'finance', 'manager', 'admin', 'head'];

// ── CPS payment sync helper ───────────────────────────────────────────────
// Calls cps_sync_payment_from_finance RPC — updates payment status, amount,
// balance, history and audit log in the CPS procurement database.
async function syncPaymentToCPS(cpsPoId, paidAmount, financeStatus, balanceDue, notes, paidAt) {
  if (!cpsSupabase || !cpsPoId) return;
  const statusMap = { paid: 'paid', partially_paid: 'partial' };
  const { error } = await cpsSupabase.rpc('cps_sync_payment_from_finance', {
    p_po_id: cpsPoId,
    p_paid_amount: paidAmount,
    p_payment_status: statusMap[financeStatus] ?? 'partial',
    p_balance_due: Math.max(0, balanceDue),
    p_reference: null,
    p_note: notes || null,
    p_paid_at: paidAt || new Date().toISOString(),
  });
  if (error) console.error('[CPS sync] cps_sync_payment_from_finance failed:', error.message);
}

// ── Receipt upload helper ──────────────────────────────────────────────────
async function uploadPaymentReceipt(file, storagePath) {
  const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
  const fullPath = `${storagePath}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from('po-receipts')
    .upload(fullPath, file.buffer, { contentType: file.mimetype, upsert: true });
  if (error) throw new Error(`Receipt upload failed: ${error.message}`);
  return fullPath;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/po-payments/ingest
// Called by n8n WF4 — NOT by end users. Auth: x-n8n-secret header
// Accepts optional vendor_quotes array for the comparison sheet.
// ─────────────────────────────────────────────────────────────────────────
router.post('/ingest', async (req, res, next) => {
  try {
    const secret = req.headers['x-n8n-secret'];
    if (!secret || secret !== process.env.N8N_INTERNAL_SECRET) {
      return fail(res, 'Unauthorized', 401);
    }

    const {
      cps_po_id, cps_po_ref, project_name, site, supplier_name, supplier_gstin,
      total_amount, line_items,
      payment_terms_type, payment_terms_raw, payment_terms_json,
      payment_terms_source, payment_terms_confidence, payment_due_date,
      payment_terms_notes,
      vendor_quotes,
    } = req.body;

    if (!cps_po_id || !cps_po_ref || !total_amount) {
      return fail(res, 'Missing required fields: cps_po_id, cps_po_ref, total_amount', 400);
    }

    // Idempotent: check if already ingested
    const { data: existing } = await supabaseAdmin
      .from('po_payments')
      .select('id, status')
      .eq('cps_po_ref', cps_po_ref)
      .maybeSingle();

    if (existing) {
      return ok(res, { id: existing.id, cps_po_ref, status: existing.status, ingested: false });
    }

    let parsedLineItems = line_items;
    if (typeof line_items === 'string') {
      try { parsedLineItems = JSON.parse(line_items); } catch { parsedLineItems = []; }
    }

    let parsedTermsJson = payment_terms_json;
    if (typeof payment_terms_json === 'string') {
      try { parsedTermsJson = JSON.parse(payment_terms_json); } catch { parsedTermsJson = null; }
    }

    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .insert({
        cps_po_id,
        cps_po_ref,
        project_name: project_name || site,
        site,
        supplier_name,
        supplier_gstin: supplier_gstin || null,
        total_amount: parseFloat(total_amount),
        line_items: parsedLineItems || [],
        payment_terms_type: payment_terms_type || null,
        payment_terms_raw: payment_terms_raw || null,
        payment_terms_json: parsedTermsJson || null,
        payment_terms_source: payment_terms_source || null,
        payment_terms_confidence: payment_terms_confidence ? parseInt(payment_terms_confidence) : null,
        payment_due_date: payment_due_date || null,
        payment_terms_notes: payment_terms_notes || null,
        status: 'pending_payment',
      })
      .select()
      .single();

    if (error) throw error;

    // Insert vendor comparison quotes if provided
    if (vendor_quotes && Array.isArray(vendor_quotes) && vendor_quotes.length > 0) {
      const quoteRows = vendor_quotes.map(q => ({
        po_payment_id: data.id,
        vendor_name: q.vendor_name,
        item_description: q.item_description || null,
        unit_price: q.unit_price ? parseFloat(q.unit_price) : null,
        quantity: q.quantity ? parseFloat(q.quantity) : null,
        total_price: parseFloat(q.total_price),
        gst_percent: q.gst_percent ? parseFloat(q.gst_percent) : null,
        delivery_days: q.delivery_days ? parseInt(q.delivery_days) : null,
        payment_terms: q.payment_terms || null,
        is_selected: !!q.is_selected,
      }));
      await supabaseAdmin.from('po_vendor_quotes').insert(quoteRows);
    }

    // Auto-supersede previous versions when a revision (e.g. -R1, -R2) is ingested
    const revisionMatch = cps_po_ref.match(/^(.+)-R\d+$/);
    if (revisionMatch) {
      const baseRef = revisionMatch[1];
      await supabaseAdmin
        .from('po_payments')
        .update({ status: 'superseded', superseded_by: cps_po_ref })
        .neq('id', data.id)
        .or(`cps_po_ref.eq.${baseRef},cps_po_ref.like.${baseRef}-R%`)
        .in('status', ['pending_procurement', 'pending_payment', 'partially_paid', 'payment_rejected', 'procurement_rejected']);
    }

    return ok(res, { ...data, ingested: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/po-payments/procurement-queue
// Stage 1 queue — Procurement Finance Dashboard
// ─────────────────────────────────────────────────────────────────────────
router.get('/procurement-queue', authMiddleware, roleGuard(PROCUREMENT_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .select(`
        id, cps_po_ref, project_name, site, supplier_name, supplier_gstin,
        total_amount, payment_terms_type, payment_terms_raw, payment_terms_json,
        payment_terms_source, payment_terms_confidence, payment_due_date,
        payment_terms_notes, status, procurement_notes, ingested_at, created_at
      `)
      .eq('status', 'pending_procurement')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/po-payments/finance-queue
// Stage 2 queue — Finance Team Dashboard
// Returns ALL PO fields so finance can cross-verify against the full PO.
// Includes pending_payment, partially_paid, and recently paid (last 60 days).
// ─────────────────────────────────────────────────────────────────────────
router.get('/finance-queue', authMiddleware, roleGuard([...FINANCE_ROLES, 'head']), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .select(`
        id, cps_po_ref, cps_po_id, project_name, site,
        supplier_name, supplier_gstin,
        total_amount, line_items,
        payment_terms_type, payment_terms_raw, payment_terms_json,
        payment_terms_source, payment_terms_confidence,
        payment_due_date, payment_terms_notes,
        status, superseded_by,
        procurement_approved_amount, procurement_notes, procurement_approved_at,
        finance_adjusted_amount, finance_adjusted_by, finance_adjusted_at,
        paid_amount, paid_by, paid_at, finance_notes,
        payment_receipt_path, payment_logs,
        created_at, ingested_at
      `)
      .in('status', ['pending_payment', 'partially_paid', 'paid', 'payment_rejected', 'superseded'])
      .order('created_at', { ascending: false });

    if (error) throw error;
    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/po-payments/all
// Full list for admin/overview
// ─────────────────────────────────────────────────────────────────────────
router.get('/all', authMiddleware, roleGuard(ALL_VIEWER_ROLES), async (req, res, next) => {
  try {
    const { site, status, project } = req.query;
    let query = supabaseAdmin
      .from('po_payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (site) query = query.eq('site', site);
    if (status) query = query.eq('status', status);
    if (project) query = query.ilike('project_name', `%${project}%`);

    const { data, error } = await query;
    if (error) throw error;
    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/po-payments/:id/procurement-approve
// Stage 1: Procurement Finance approves, forwards to Finance
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/procurement-approve', authMiddleware, roleGuard(PROCUREMENT_ROLES), async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      approved_amount,
      notes,
      payment_terms_type,
      payment_terms_notes,
      payment_due_date,
    } = req.body;

    if (!approved_amount) return fail(res, 'approved_amount is required', 400);

    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('po_payments')
      .select('id, status, total_amount, cps_po_ref')
      .eq('id', id)
      .single();

    if (fetchErr || !current) return fail(res, 'PO payment not found', 404);
    if (current.status !== 'pending_procurement') {
      return fail(res, `Cannot approve — current status is ${current.status}`, 400);
    }

    const parsedAmount = parseFloat(approved_amount);
    if (parsedAmount > current.total_amount) {
      return fail(res, 'Approved amount cannot exceed the PO total amount', 400);
    }

    const updatePayload = {
      status: 'pending_payment',
      procurement_approved_by: req.user.id,
      procurement_approved_at: new Date().toISOString(),
      procurement_approved_amount: parsedAmount,
      procurement_notes: notes || null,
    };

    if (payment_terms_type) updatePayload.payment_terms_type = payment_terms_type;
    if (payment_terms_notes) updatePayload.payment_terms_notes = payment_terms_notes;
    if (payment_due_date) updatePayload.payment_due_date = payment_due_date;

    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAudit({
      userId: req.user.id,
      action: 'PO_PAYMENT_PROCUREMENT_APPROVED',
      entityType: 'po_payment',
      entityId: id,
      newValue: { approved_amount: parsedAmount, notes, po_ref: current.cps_po_ref },
    });

    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/po-payments/:id/procurement-reject
// Stage 1: Procurement Finance rejects
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/procurement-reject', authMiddleware, roleGuard(PROCUREMENT_ROLES), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason?.trim()) return fail(res, 'Rejection reason is required', 400);

    const { data: current } = await supabaseAdmin
      .from('po_payments')
      .select('id, status, cps_po_ref')
      .eq('id', id)
      .single();

    if (!current || current.status !== 'pending_procurement') {
      return fail(res, 'Cannot reject — invalid state', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .update({
        status: 'procurement_rejected',
        rejected_by: req.user.id,
        rejected_at: new Date().toISOString(),
        rejection_reason: reason,
        rejection_stage: 'procurement',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAudit({
      userId: req.user.id,
      action: 'PO_PAYMENT_PROCUREMENT_REJECTED',
      entityType: 'po_payment',
      entityId: id,
      newValue: { reason, po_ref: current.cps_po_ref },
    });

    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/po-payments/:id/adjust-amount
// Finance team adjusts the effective payable amount (overrides procurement amount).
// This is the figure used for balance tracking and partial payment settlement.
// ─────────────────────────────────────────────────────────────────────────
router.patch('/:id/adjust-amount', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adjusted_amount, notes } = req.body;

    if (!adjusted_amount) return fail(res, 'adjusted_amount is required', 400);

    const { data: current } = await supabaseAdmin
      .from('po_payments')
      .select('id, cps_po_id, status, total_amount, cps_po_ref, paid_amount, payment_model')
      .eq('id', id)
      .single();

    if (!current) return fail(res, 'PO not found', 404);
    // SPEC-PAY-01: tranche payments are bound to an immutable CPS authorization —
    // finance cannot unilaterally adjust them. Any change must be re-authorized in CPS.
    if (current.payment_model === 'tranche') {
      return fail(res, 'This is an authorized installment — finance cannot adjust the amount. Request a re-authorization in CPS (a fresh Gate-2 release).', 409);
    }
    if (!['pending_payment', 'partially_paid'].includes(current.status)) {
      return fail(res, `Cannot adjust amount — current status is ${current.status}`, 400);
    }

    const parsedAdjusted = parseFloat(adjusted_amount);
    if (parsedAdjusted <= 0) return fail(res, 'Adjusted amount must be positive', 400);

    const alreadyPaid = parseFloat(current.paid_amount || 0);
    if (parsedAdjusted < alreadyPaid) {
      return fail(res, `Adjusted amount cannot be less than already-paid amount (₹${alreadyPaid.toLocaleString('en-IN')})`, 400);
    }

    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .update({
        finance_adjusted_amount: parsedAdjusted,
        finance_adjusted_by: req.user.id,
        finance_adjusted_at: new Date().toISOString(),
        finance_notes: notes || current.finance_notes || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAudit({
      userId: req.user.id,
      action: 'PO_PAYMENT_AMOUNT_ADJUSTED',
      entityType: 'po_payment',
      entityId: id,
      newValue: { adjusted_amount: parsedAdjusted, notes, po_ref: current.cps_po_ref },
    });

    // Sync updated balance to CPS — paid amount unchanged, balance reflects new cycle limit
    const paidSoFar = parseFloat(current.paid_amount || 0);
    const newBalance = Math.max(0, parsedAdjusted - paidSoFar);
    syncPaymentToCPS(
      current.cps_po_id,
      paidSoFar,
      paidSoFar > 0 ? 'partially_paid' : 'awaiting',
      newBalance,
      notes || null,
      new Date().toISOString(),
    ).catch(err => console.error('[CPS sync] adjust error:', err.message));

    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/po-payments/:id/pay
// Stage 2: Finance records a payment (full or partial).
// Accumulates paid_amount. When paid >= authoritative amount → status = 'paid'.
// Otherwise status = 'partially_paid' so the PO stays in the queue.
// Authoritative amount priority: finance_adjusted_amount → procurement_approved_amount → total_amount
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/pay', authMiddleware, roleGuard(FINANCE_ROLES), upload.single('receipt'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { paid_amount, notes } = req.body;

    if (!paid_amount) return fail(res, 'paid_amount is required', 400);

    const { data: current } = await supabaseAdmin
      .from('po_payments')
      .select('id, cps_po_id, status, procurement_approved_amount, finance_adjusted_amount, total_amount, paid_amount, cps_po_ref, payment_logs, finance_notes, payment_receipt_path')
      .eq('id', id)
      .single();

    if (!current || !['pending_payment', 'partially_paid'].includes(current.status)) {
      return fail(res, `Cannot pay — current status is ${current?.status}`, 400);
    }

    // finance_adjusted_amount = installment ceiling for THIS cycle only.
    // Real total is always total_amount (or procurement_approved_amount).
    const realTotal = parseFloat(
      current.procurement_approved_amount || current.total_amount
    );
    // Cap this cycle's payment at the adjusted amount if set, otherwise use the real total
    const cycleLimit = current.finance_adjusted_amount
      ? parseFloat(current.finance_adjusted_amount)
      : realTotal;

    const alreadyPaid = parseFloat(current.paid_amount || 0);
    const thisPayment = parseFloat(paid_amount);
    const remainingInCycle = cycleLimit - alreadyPaid;

    if (thisPayment <= 0) return fail(res, 'Payment amount must be positive', 400);
    if (thisPayment > remainingInCycle + 0.01) {
      return fail(res, `Payment of ₹${thisPayment.toLocaleString('en-IN')} exceeds current cycle balance of ₹${remainingInCycle.toLocaleString('en-IN')}`, 400);
    }

    const newTotalPaid = alreadyPaid + thisPayment;
    // Only mark as fully paid when the REAL total is settled
    const isFullySettled = newTotalPaid >= realTotal - 0.01;
    // If we've hit the cycle limit but not the real total, clear the adjustment
    // so the next payment is evaluated against the full remaining balance
    const cycleComplete = newTotalPaid >= cycleLimit - 0.01;
    const clearAdjustment = cycleComplete && !isFullySettled;

    let receiptPath = null;
    if (req.file) {
      receiptPath = await uploadPaymentReceipt(req.file, `po-receipts/${id}-${Date.now()}`);
    }

    const nowIso = new Date().toISOString();
    const existingLogs = Array.isArray(current.payment_logs) ? current.payment_logs : [];
    const newLogEntry = {
      amount: thisPayment,
      paid_at: nowIso,
      paid_by: req.user.id,
      paid_by_name: req.user.name || req.user.email || 'Finance',
      notes: notes || null,
      receipt_path: receiptPath || null,
    };

    const updatePayload = {
      status: isFullySettled ? 'paid' : 'partially_paid',
      paid_amount: newTotalPaid,
      paid_by: req.user.id,
      paid_at: isFullySettled ? nowIso : current.paid_at,
      payment_receipt_path: receiptPath || current.payment_receipt_path,
      finance_notes: notes || current.finance_notes || null,
      payment_logs: [...existingLogs, newLogEntry],
    };
    // Clear the finance adjustment once that installment is paid so the
    // remaining balance is visible against the real total next time
    if (clearAdjustment) updatePayload.finance_adjusted_amount = null;

    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAudit({
      userId: req.user.id,
      action: isFullySettled ? 'PO_PAYMENT_PAID' : 'PO_PAYMENT_PARTIAL',
      entityType: 'po_payment',
      entityId: id,
      newValue: {
        this_payment: thisPayment,
        total_paid: newTotalPaid,
        remaining: Math.max(0, realTotal - newTotalPaid),
        fully_settled: isFullySettled,
        cycle_limit_reached: cycleComplete,
        has_receipt: !!receiptPath,
        po_ref: current.cps_po_ref,
      },
    });

    // Fire-and-forget: always sync payment status to CPS (partial and full)
    syncPaymentToCPS(
      current.cps_po_id,
      newTotalPaid,
      isFullySettled ? 'paid' : 'partially_paid',
      Math.max(0, realTotal - newTotalPaid),
      notes || null,
      nowIso,
    ).catch(err => console.error('[CPS sync] error:', err.message));

    return ok(res, {
      ...data,
      this_payment: thisPayment,
      total_paid: newTotalPaid,
      real_total: realTotal,
      remaining_balance: Math.max(0, realTotal - newTotalPaid),
      fully_settled: isFullySettled,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// SPEC-PAY-01 Gate-2 — Authorized payables (CPS-owned, read via cpsSupabase).
// Lists approved 'release' authorizations that finance hasn't fully paid yet.
// GET /api/po-payments/authorized-payables
router.get('/authorized-payables', authMiddleware, roleGuard(ALL_VIEWER_ROLES), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);

    const { data: auths, error: aErr } = await cpsSupabase
      .from('cps_payment_authorizations')
      .select('id,auth_number,amount,tranche_id,po_id,auth_type,status,approved_at')
      .eq('auth_type', 'release').eq('status', 'approved')
      .order('approved_at', { ascending: true });
    if (aErr) throw aErr;
    if (!auths?.length) return ok(res, []);

    // finance payments already recorded against these authorizations
    const refs = auths.map(a => a.auth_number);
    const { data: payments } = await supabaseAdmin
      .from('po_payments')
      .select('cps_authorization_ref,status,paid_amount')
      .in('cps_authorization_ref', refs);
    const payByRef = {};
    (payments ?? []).forEach(p => { payByRef[p.cps_authorization_ref] = p; });

    // hydrate PO / tranche / supplier
    const poIds = [...new Set(auths.map(a => a.po_id).filter(Boolean))];
    const trancheIds = auths.map(a => a.tranche_id).filter(Boolean);
    const { data: pos } = await cpsSupabase.from('cps_purchase_orders')
      .select('id,po_number,supplier_id,grand_total,po_pdf_url,project_code,bank_account_holder_name,bank_name,bank_ifsc,bank_account_number')
      .in('id', poIds);
    const { data: tranches } = trancheIds.length
      ? await cpsSupabase.from('cps_po_payment_schedules')
          .select('id,milestone_name,trigger_type,trigger_offset_days').in('id', trancheIds)
      : { data: [] };
    const supIds = [...new Set((pos ?? []).map(p => p.supplier_id).filter(Boolean))];
    const { data: sups } = supIds.length
      ? await cpsSupabase.from('cps_suppliers').select('id,name').in('id', supIds)
      : { data: [] };
    const poById = {}; (pos ?? []).forEach(p => { poById[p.id] = p; });
    const trById = {}; (tranches ?? []).forEach(t => { trById[t.id] = t; });
    const supById = {}; (sups ?? []).forEach(s => { supById[s.id] = s; });

    const payables = auths
      .filter(a => (payByRef[a.auth_number]?.status ?? null) !== 'paid')
      .map(a => {
        const po = poById[a.po_id] || {};
        const tr = trById[a.tranche_id] || {};
        const sup = supById[po.supplier_id] || {};
        const pay = payByRef[a.auth_number];
        return {
          auth_number: a.auth_number,
          authorization_id: a.id,
          cps_tranche_id: a.tranche_id,
          po_id: a.po_id,
          po_number: po.po_number ?? null,
          project_name: po.project_code ?? null,
          supplier_name: sup.name ?? null,
          installment_name: tr.milestone_name ?? null,
          trigger_type: tr.trigger_type ?? null,
          trigger_offset_days: tr.trigger_offset_days ?? null,
          authorized_amount: Number(a.amount),
          already_paid: pay ? Number(pay.paid_amount || 0) : 0,
          po_grand_total: po.grand_total != null ? Number(po.grand_total) : null,
          po_pdf_url: po.po_pdf_url ?? null,
          bank_account_holder_name: po.bank_account_holder_name ?? null,
          bank_name: po.bank_name ?? null,
          bank_ifsc: po.bank_ifsc ?? null,
          bank_account_number: po.bank_account_number ?? null,
        };
      });
    return ok(res, payables);
  } catch (err) { next(err); }
});

// SPEC-PAY-01 Gate-2 — Pay a tranche against its CPS authorization.
// Anti-corruption: finance can ONLY pay what CPS authorized (approved + amount).
// On full settlement closes the lifecycle in CPS (tranche → paid, auth → consumed).
// Reconciliation stays view-based; the deprecated cps_sync RPC is NOT used here.
// POST /api/po-payments/pay-authorization  { auth_number, paid_amount, notes, receipt? }
router.post('/pay-authorization', authMiddleware, roleGuard(FINANCE_ROLES), upload.single('receipt'), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);
    const { auth_number, paid_amount, notes } = req.body;
    if (!auth_number || paid_amount == null) return fail(res, 'auth_number and paid_amount are required', 400);
    const thisPayment = parseFloat(paid_amount);
    if (!(thisPayment > 0)) return fail(res, 'paid_amount must be positive', 400);

    // 1) validate the authorization in CPS
    const { data: auth, error: aErr } = await cpsSupabase
      .from('cps_payment_authorizations')
      .select('id,auth_number,amount,tranche_id,po_id,auth_type,status')
      .eq('auth_number', auth_number).maybeSingle();
    if (aErr) throw aErr;
    if (!auth) return fail(res, 'Authorization not found', 404);
    if (auth.status !== 'approved') return fail(res, `Authorization is "${auth.status}", not approved — cannot pay`, 409);
    const authorized = Number(auth.amount);

    // PO + supplier for the finance row
    const { data: po } = await cpsSupabase.from('cps_purchase_orders')
      .select('id,po_number,supplier_id,project_code,ship_to_address').eq('id', auth.po_id).maybeSingle();
    let supplierName = null, supplierGstin = null;
    if (po?.supplier_id) {
      const { data: s } = await cpsSupabase.from('cps_suppliers').select('name,gstin').eq('id', po.supplier_id).maybeSingle();
      supplierName = s?.name ?? null; supplierGstin = s?.gstin ?? null;
    }

    // 2) existing finance row for this authorization (partial earlier)?
    const { data: existing } = await supabaseAdmin.from('po_payments')
      .select('id,paid_amount,payment_logs,payment_receipt_path').eq('cps_authorization_ref', auth_number).maybeSingle();
    const alreadyPaid = existing ? Number(existing.paid_amount || 0) : 0;
    if (thisPayment > authorized - alreadyPaid + 0.01)
      return fail(res, `Payment exceeds authorized amount (auth ₹${authorized}, already paid ₹${alreadyPaid})`, 400);

    const newTotalPaid = alreadyPaid + thisPayment;
    const fully = newTotalPaid >= authorized - 0.01;
    const nowIso = new Date().toISOString();

    let receiptPath = existing?.payment_receipt_path ?? null;
    if (req.file) receiptPath = await uploadPaymentReceipt(req.file, `po-receipts/auth-${auth_number}-${Date.now()}`);

    const logEntry = { amount: thisPayment, paid_at: nowIso, paid_by: req.user.id, paid_by_name: req.user.name || req.user.email || 'Finance', notes: notes || null, receipt_path: receiptPath || null };
    const logs = [...(existing?.payment_logs ?? []), logEntry];

    let financeRow;
    if (existing) {
      const { data, error } = await supabaseAdmin.from('po_payments').update({
        paid_amount: newTotalPaid, status: fully ? 'paid' : 'partially_paid',
        paid_by: req.user.id, paid_at: fully ? nowIso : null,
        payment_receipt_path: receiptPath, finance_notes: notes || null, payment_logs: logs,
      }).eq('id', existing.id).select().single();
      if (error) throw error; financeRow = data;
    } else {
      const { data, error } = await supabaseAdmin.from('po_payments').insert([{
        cps_po_id: auth.po_id, cps_po_ref: po?.po_number ?? null,
        payment_model: 'tranche', cps_authorization_ref: auth_number, cps_tranche_id: auth.tranche_id,
        project_name: po?.project_code ?? null, site: po?.ship_to_address ?? null,
        supplier_name: supplierName, supplier_gstin: supplierGstin,
        total_amount: authorized, paid_amount: newTotalPaid,
        status: fully ? 'paid' : 'partially_paid',
        paid_by: req.user.id, paid_at: fully ? nowIso : null,
        payment_receipt_path: receiptPath, finance_notes: notes || null, payment_logs: logs,
      }]).select().single();
      if (error) throw error; financeRow = data;
    }

    // 3) close the lifecycle in CPS (not the deprecated mirror RPC)
    if (auth.tranche_id) {
      await cpsSupabase.from('cps_po_payment_schedules').update({
        status: fully ? 'paid' : 'partially_paid', paid_amount: newTotalPaid,
        paid_at: fully ? nowIso : null, payment_reference: auth_number, updated_at: nowIso,
      }).eq('id', auth.tranche_id);
    }
    if (fully) {
      await cpsSupabase.from('cps_payment_authorizations').update({ status: 'consumed' })
        .eq('id', auth.id).eq('status', 'approved');
    }

    await logAudit({
      userId: req.user.id,
      action: fully ? 'PO_TRANCHE_PAID' : 'PO_TRANCHE_PARTIAL',
      entityType: 'po_payment',
      entityId: financeRow.id,
      newValue: { auth_number, this_payment: thisPayment, total_paid: newTotalPaid, authorized, fully_settled: fully, po_ref: po?.po_number },
    });

    return ok(res, { ...financeRow, authorized_amount: authorized, total_paid: newTotalPaid, fully_settled: fully });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/po-payments/:id/comparison
// Fetches the full comparison sheet from the CPS procurement database.
// Flow: po_payments.cps_po_ref → cps_purchase_orders → cps_comparison_sheets
//       + all quotes with line items and supplier profiles
// ─────────────────────────────────────────────────────────────────────────
router.get('/:id/comparison', authMiddleware, roleGuard([...FINANCE_ROLES, ...PROCUREMENT_ROLES, 'head']), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get our local PO record to get cps_po_ref
    const { data: localPo, error: localErr } = await supabaseAdmin
      .from('po_payments')
      .select('id, cps_po_ref, project_name, site, supplier_name, total_amount, line_items, status')
      .eq('id', id)
      .single();

    if (localErr || !localPo) return fail(res, 'PO not found', 404);

    if (!cpsSupabase) {
      return ok(res, { po: localPo, has_comparison: false, reason: 'CPS not connected' });
    }

    // Look up the PO in CPS to get the comparison_sheet_id and PDF URL
    const { data: cpsPo } = await cpsSupabase
      .from('cps_purchase_orders')
      .select('id, comparison_sheet_id, supplier_id, rfq_id, grand_total, status, po_pdf_url, parent_po_id, po_number')
      .eq('po_number', localPo.cps_po_ref)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Revised POs may not have a PDF yet — fall back to parent PO's PDF
    let pdfUrl = cpsPo?.po_pdf_url || null;
    let pdfIsRevision = true;
    if (!pdfUrl && cpsPo?.parent_po_id) {
      const { data: parentPo } = await cpsSupabase
        .from('cps_purchase_orders')
        .select('po_pdf_url, po_number')
        .eq('id', cpsPo.parent_po_id)
        .maybeSingle();
      if (parentPo?.po_pdf_url) {
        pdfUrl = parentPo.po_pdf_url;
        pdfIsRevision = false;
      }
    }

    if (!cpsPo?.comparison_sheet_id) {
      return ok(res, { po: localPo, has_comparison: false, po_pdf_url: pdfUrl, po_pdf_is_revision: pdfIsRevision, reason: 'No comparison sheet in CPS' });
    }

    // Fetch comparison sheet + quotes + snapshots in parallel
    const [sheetRes, quotesRes, lineSnapshotsRes, supplierSnapshotsRes, supplierTotalsRes] = await Promise.all([
      cpsSupabase
        .from('cps_comparison_sheets')
        .select('id, rfq_id, status, manual_review_status, ai_recommendation, ai_market_rates, total_quotes_received, compliant_quotes_count, potential_savings, reviewer_recommendation, reviewer_recommendation_reason, manual_notes, approved_at')
        .eq('id', cpsPo.comparison_sheet_id)
        .single(),
      cpsSupabase
        .from('cps_quotes')
        .select(`
          id, supplier_id, parse_status, compliance_status,
          total_quoted_value, total_landed_value, payment_terms, delivery_terms,
          warranty_months, validity_days,
          cps_quote_line_items (
            id, original_description, brand, quantity, unit,
            rate, list_rate, discount_pct, special_discount_pct,
            gst_percent, freight, total_landed_rate, lead_time_days, hsn_code
          ),
          cps_suppliers ( id, name, gstin, city, state )
        `)
        .eq('rfq_id', cpsPo.rfq_id)
        .not('parse_status', 'eq', 'failed')
        .neq('channel', 'po_revision'),
      // Structured line-level snapshots with last purchase + market rates
      cpsSupabase
        .from('cps_comparison_line_snapshots')
        .select('id, pr_line_item_id, sort_order, item_description, item_quantity, item_unit, last_purchase_rate, last_purchase_unit, last_purchase_supplier_name, last_purchase_po_number, last_purchase_po_date, market_lowest_rate, market_lowest_unit, market_verdict, market_suppliers')
        .eq('sheet_id', cpsPo.comparison_sheet_id)
        .order('sort_order'),
      // Per-supplier per-line rates
      cpsSupabase
        .from('cps_comparison_supplier_snapshots')
        .select('pr_line_item_id, supplier_name, brand, rate, gst_percent, freight, total_landed_rate, lead_time_days, is_lowest, is_recommended')
        .eq('sheet_id', cpsPo.comparison_sheet_id),
      // Supplier bid totals
      cpsSupabase
        .from('cps_comparison_supplier_totals')
        .select('supplier_name, subtotal, gst_amount, freight_amount, landed_total, payment_terms, delivery_terms, warranty_months, compliance_status, rank, is_winner')
        .eq('sheet_id', cpsPo.comparison_sheet_id)
        .order('rank'),
    ]);

    const sheet = sheetRes.data;
    const quotes = quotesRes.data || [];
    const lineSnapshots = lineSnapshotsRes.data || [];
    const supplierSnapshots = supplierSnapshotsRes.data || [];
    const supplierTotals = supplierTotalsRes.data || [];

    // Build structured line comparison (snapshot-based, when available)
    // Each row = one PR item; columns = each supplier's rate + last purchase + market rates
    let lineComparison = null;
    if (lineSnapshots.length > 0) {
      // Group supplier snapshots by pr_line_item_id
      const snapByItem = {};
      for (const snap of supplierSnapshots) {
        if (!snapByItem[snap.pr_line_item_id]) snapByItem[snap.pr_line_item_id] = [];
        snapByItem[snap.pr_line_item_id].push(snap);
      }

      // Get sorted unique supplier names from totals (or from snapshots)
      const supplierOrder = supplierTotals.length > 0
        ? supplierTotals.map(t => t.supplier_name)
        : [...new Set(supplierSnapshots.map(s => s.supplier_name))];

      lineComparison = {
        suppliers: supplierOrder,
        supplier_totals: supplierTotals,
        rows: lineSnapshots.map(ls => {
          const itemSnaps = snapByItem[ls.pr_line_item_id] || [];
          const supplierRates = {};
          for (const s of itemSnaps) {
            supplierRates[s.supplier_name] = {
              rate: s.rate,
              gst: s.gst_percent,
              freight: s.freight,
              landed_rate: s.total_landed_rate,
              brand: s.brand,
              lead_time_days: s.lead_time_days,
              is_lowest: s.is_lowest,
              is_recommended: s.is_recommended,
            };
          }
          // Get market_suppliers sorted by rate for Market 1 and Market 2 columns
          const mktSuppliers = Array.isArray(ls.market_suppliers)
            ? [...ls.market_suppliers].sort((a, b) => (a.rate_numeric || 0) - (b.rate_numeric || 0))
            : [];
          return {
            description: ls.item_description,
            qty: ls.item_quantity,
            unit: ls.item_unit,
            last_purchase_rate: ls.last_purchase_rate,
            last_purchase_unit: ls.last_purchase_unit,
            last_purchase_supplier: ls.last_purchase_supplier_name,
            last_purchase_po: ls.last_purchase_po_number,
            last_purchase_date: ls.last_purchase_po_date,
            market_lowest_rate: ls.market_lowest_rate,
            market_lowest_unit: ls.market_lowest_unit,
            market_verdict: ls.market_verdict,
            market_1: mktSuppliers[0] || null,
            market_2: mktSuppliers[1] || null,
            supplier_rates: supplierRates,
          };
        }),
      };
    }

    return ok(res, {
      po: localPo,
      has_comparison: true,
      po_pdf_url: pdfUrl,
      po_pdf_is_revision: pdfIsRevision,
      comparison: {
        id: sheet?.id,
        status: sheet?.status,
        review_status: sheet?.manual_review_status,
        total_quotes: sheet?.total_quotes_received || quotes.length,
        compliant_quotes: sheet?.compliant_quotes_count || 0,
        potential_savings: sheet?.potential_savings,
        manual_notes: sheet?.manual_notes,
        approved_at: sheet?.approved_at,
        ai: sheet?.ai_recommendation || null,
        market_rates: sheet?.ai_market_rates || null,
      },
      line_comparison: lineComparison,
      quotes: quotes.map(q => ({
        id: q.id,
        supplier: q.cps_suppliers,
        compliance: q.compliance_status,
        landed_total: q.total_landed_value,
        payment_terms: q.payment_terms,
        delivery_terms: q.delivery_terms,
        warranty_months: q.warranty_months,
        validity_days: q.validity_days,
        is_selected: q.supplier_id === cpsPo.supplier_id,
        line_items: (q.cps_quote_line_items || []).map(li => ({
          description: li.original_description,
          brand: li.brand,
          qty: li.quantity,
          unit: li.unit,
          rate: li.rate,
          list_rate: li.list_rate,
          discount_pct: li.discount_pct,
          gst: li.gst_percent,
          freight: li.freight,
          landed_rate: li.total_landed_rate,
          line_total: li.quantity && li.total_landed_rate ? li.quantity * li.total_landed_rate : null,
        })),
      })),
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/po-payments/project-spend
// Project spend analytics: PO + Imprest + Expenses rolled up per project/site
// ─────────────────────────────────────────────────────────────────────────
router.get('/project-spend', authMiddleware, roleGuard(ALL_VIEWER_ROLES), async (req, res, next) => {
  try {
    const [poSpendRes, imprestRes, expenseRes] = await Promise.all([
      supabaseAdmin.rpc('get_po_spend_by_project'),
      supabaseAdmin.from('imprest_requests').select('site, paid_amount').eq('paid', true).not('paid_amount', 'is', null),
      supabaseAdmin.from('expenses').select('site, amount').in('status', ['auto_verified', 'approved', 'manual_review']),
    ]);

    const projectMap = {};

    (poSpendRes.data || []).forEach(row => {
      const key = row.project_name || row.site;
      if (!projectMap[key]) projectMap[key] = { project_name: key, po_spend: 0, imprest_spend: 0, expense_spend: 0, sites: new Set() };
      projectMap[key].po_spend += parseFloat(row.total_paid || 0);
      projectMap[key].sites.add(row.site);
    });

    (imprestRes.data || []).forEach(row => {
      const key = row.site;
      if (!projectMap[key]) projectMap[key] = { project_name: key, po_spend: 0, imprest_spend: 0, expense_spend: 0, sites: new Set() };
      projectMap[key].imprest_spend += parseFloat(row.paid_amount || 0);
      projectMap[key].sites.add(key);
    });

    (expenseRes.data || []).forEach(row => {
      const key = row.site;
      if (!projectMap[key]) projectMap[key] = { project_name: key, po_spend: 0, imprest_spend: 0, expense_spend: 0, sites: new Set() };
      projectMap[key].expense_spend += parseFloat(row.amount || 0);
      projectMap[key].sites.add(key);
    });

    const result = Object.values(projectMap).map(p => ({
      project_name: p.project_name,
      sites: [...p.sites],
      po_spend: Math.round(p.po_spend * 100) / 100,
      imprest_spend: Math.round(p.imprest_spend * 100) / 100,
      expense_spend: Math.round(p.expense_spend * 100) / 100,
      total_spend: Math.round((p.po_spend + p.imprest_spend + p.expense_spend) * 100) / 100,
    })).sort((a, b) => b.total_spend - a.total_spend);

    return ok(res, result);
  } catch (err) { next(err); }
});

export default router;
