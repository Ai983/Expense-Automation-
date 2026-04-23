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
// ─────────────────────────────────────────────────────────────────────────
router.get('/finance-queue', authMiddleware, roleGuard([...FINANCE_ROLES, 'head']), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .select(`
        id, cps_po_ref, project_name, site, supplier_name, total_amount,
        payment_terms_type, payment_terms_json, payment_due_date,
        status, procurement_approved_amount, procurement_notes,
        procurement_approved_at, paid_amount, paid_at, finance_notes, created_at
      `)
      .in('status', ['pending_payment', 'paid', 'payment_rejected'])
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
// POST /api/po-payments/:id/pay
// Stage 2: Finance team marks as paid + optional receipt upload
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/pay', authMiddleware, roleGuard(FINANCE_ROLES), upload.single('receipt'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { paid_amount, notes } = req.body;

    if (!paid_amount) return fail(res, 'paid_amount is required', 400);

    const { data: current } = await supabaseAdmin
      .from('po_payments')
      .select('id, status, procurement_approved_amount, cps_po_ref')
      .eq('id', id)
      .single();

    if (!current || current.status !== 'pending_payment') {
      return fail(res, `Cannot pay — current status is ${current?.status}`, 400);
    }

    const parsedPaid = parseFloat(paid_amount);
    if (current.procurement_approved_amount && parsedPaid > current.procurement_approved_amount) {
      return fail(res, 'Paid amount cannot exceed procurement-approved amount', 400);
    }

    let receiptPath = null;
    if (req.file) {
      receiptPath = await uploadPaymentReceipt(req.file, `po-receipts/${id}`);
    }

    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .update({
        status: 'paid',
        paid_amount: parsedPaid,
        paid_by: req.user.id,
        paid_at: new Date().toISOString(),
        payment_receipt_path: receiptPath,
        finance_notes: notes || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAudit({
      userId: req.user.id,
      action: 'PO_PAYMENT_PAID',
      entityType: 'po_payment',
      entityId: id,
      newValue: { paid_amount: parsedPaid, has_receipt: !!receiptPath, po_ref: current.cps_po_ref },
    });

    // Fire-and-forget: confirm payment back to CPS procurement system
    if (cpsSupabase && current.cps_po_ref) {
      cpsSupabase
        .from('cps_purchase_orders')
        .update({ finance_paid_at: data.paid_at, finance_paid_amount: parsedPaid })
        .eq('po_number', current.cps_po_ref)
        .then(({ error }) => { if (error) console.error('[CPS sync] finance_paid update failed:', error.message); })
        .catch(err => console.error('[CPS sync] error:', err.message));
    }

    return ok(res, data);
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
