// backend/src/routes/prqPayments.js
// Payment Requests (PRQ) — the CPS compliance-gated payment queue.
//
// This replaces working off the WhatsApp sheet. CPS owns the data: PRQs live in
// cps.cps_payment_requests and are exposed through cps.cps_v_prq_for_finance,
// which shows ONLY requests that already reached compliance_cleared. Finance
// reads them here and writes decisions back with cps_sync_prq_from_finance.
//
// Same shape as woPayments.js / poPayments.js — cross-schema read through the
// `cpsSupabase` client, single source of truth stays in CPS, nothing copied.
//
// ⚠️ BANK DETAILS ARE READ LIVE FROM CPS AND NEVER STORED HERE.
// finance.po_payments has no bank columns and this route adds none. Copying
// them would recreate the stale cps_purchase_orders.bank_* snapshot that CPS
// Phase 1 found useless. Every read comes from the view, every time.
import express from 'express';
import multer from 'multer';
import { supabaseAdmin, cpsSupabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok, fail } from '../utils/responseHelper.js';
import { PRQ_VIEWER_ROLES, PRQ_FINANCE_ROLES } from '../config/constants.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Imported, not restated — the sidebar derives its link from these same two
// arrays via the `permissions` object on /api/auth/me. See config/constants.js.
const FINANCE_ROLES = PRQ_FINANCE_ROLES;
const VIEWER_ROLES = PRQ_VIEWER_ROLES;

// A hold without a category is how "as per sir's instruction" ends up counted
// as a system failure forever. CPS enforces this too, in a CHECK constraint —
// this is the friendly error, not the control.
const HOLD_CATEGORIES = ['compliance', 'discretionary', 'commercial', 'funds'];

const CPS_DOC_BUCKET = 'cps-prq-documents';

// ─────────────────────────────────────────────────────────────────────────
// GET /api/prq-payments/queue?status=
// Compliance-cleared payment requests. Soonest expected payment first.
// ─────────────────────────────────────────────────────────────────────────
router.get('/queue', authMiddleware, roleGuard(VIEWER_ROLES), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);

    let q = cpsSupabase.from('cps_v_prq_for_finance').select('*');
    if (req.query.status) q = q.eq('status', req.query.status);
    else q = q.in('status', ['compliance_cleared', 'finance_queued', 'finance_hold']);

    const { data, error } = await q.order('expected_payment_date', { ascending: true });
    if (error) throw error;
    return ok(res, data ?? []);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/prq-payments/:id/documents
// Every attachment, signed server-side so Accounts never leaves this app.
// The bucket is private; only this backend (service role) can sign it.
// ─────────────────────────────────────────────────────────────────────────
router.get('/:id/documents', authMiddleware, roleGuard(VIEWER_ROLES), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);

    const { data: docs, error } = await cpsSupabase
      .from('cps_v_prq_documents_for_finance')
      .select('*')
      .eq('prq_id', req.params.id)
      .order('sort_order');
    if (error) throw error;

    const signed = await Promise.all((docs ?? []).map(async (d) => {
      if (!d.file_url) return { ...d, signed_url: null };
      const { data: s } = await supabaseAdmin.storage
        .from(CPS_DOC_BUCKET)
        .createSignedUrl(d.file_url, 60 * 30);   // 30 minutes
      return { ...d, signed_url: s?.signedUrl ?? null };
    }));

    return ok(res, signed);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/prq-payments/:id/pay   { paid_amount, payment_status, reference, note, receipt? }
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/pay', authMiddleware, roleGuard(FINANCE_ROLES), upload.single('receipt'),
  async (req, res, next) => {
    try {
      if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);
      const { paid_amount, payment_status = 'paid', reference, note } = req.body;
      if (!paid_amount || Number(paid_amount) <= 0) {
        return fail(res, 'paid_amount is required', 400);
      }

      let receiptPath = null;
      if (req.file) {
        const ext = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg');
        receiptPath = `prq/${req.params.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from('po-receipts')
          .upload(receiptPath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
        if (upErr) throw new Error(`Receipt upload failed: ${upErr.message}`);
      }

      const { data, error } = await cpsSupabase.rpc('cps_sync_prq_from_finance', {
        p_prq_id: req.params.id,
        p_action: 'paid',
        p_paid_amount: Number(paid_amount),
        p_payment_status: payment_status,
        p_reference: reference ?? null,
        p_note: note ?? null,
        p_receipt_path: receiptPath,
        p_actor_name: req.user?.name ?? null,
        p_actor_email: req.user?.email ?? null,
      });
      if (error) throw error;
      if (data?.success === false) return fail(res, data.error, 400);
      return ok(res, data);
    } catch (err) { next(err); }
  });

// ─────────────────────────────────────────────────────────────────────────
// POST /api/prq-payments/:id/hold   { hold_category, hold_reason }
// CATEGORY IS MANDATORY AND HAS NO DEFAULT.
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/hold', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);
    const { hold_category, hold_reason } = req.body;

    if (!hold_category || !HOLD_CATEGORIES.includes(hold_category)) {
      return fail(res, `hold_category is required and must be one of: ${HOLD_CATEGORIES.join(', ')}`, 400);
    }
    if (!hold_reason || !String(hold_reason).trim()) {
      return fail(res, 'hold_reason is required — a hold with no stated reason cannot be reported on', 400);
    }

    const { data, error } = await cpsSupabase.rpc('cps_sync_prq_from_finance', {
      p_prq_id: req.params.id,
      p_action: 'hold',
      p_hold_category: hold_category,
      p_hold_reason: String(hold_reason).trim(),
      p_actor_name: req.user?.name ?? null,
      p_actor_email: req.user?.email ?? null,
    });
    if (error) throw error;
    if (data?.success === false) return fail(res, data.error, 400);
    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/prq-payments/:id/release — lift a hold, back into the queue.
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/release', authMiddleware, roleGuard(FINANCE_ROLES), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);
    const { data, error } = await cpsSupabase.rpc('cps_sync_prq_from_finance', {
      p_prq_id: req.params.id,
      p_action: 'release',
      p_note: req.body?.note ?? null,
      p_actor_name: req.user?.name ?? null,
      p_actor_email: req.user?.email ?? null,
    });
    if (error) throw error;
    if (data?.success === false) return fail(res, data.error, 400);
    return ok(res, data);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/prq-payments/holds-by-category — discretionary vs real failures.
// ─────────────────────────────────────────────────────────────────────────
router.get('/holds-by-category', authMiddleware, roleGuard(VIEWER_ROLES), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);
    const { data, error } = await cpsSupabase.from('cps_v_prq_holds_by_category').select('*');
    if (error) throw error;
    return ok(res, data ?? []);
  } catch (err) { next(err); }
});

export default router;
