// backend/src/routes/woPayments.js
// Work Order payments — finance pays WOs that CPS handed off ("Send to Finance").
// CPS owns the data: WOs live in cps_work_orders. Procurement sets
// sent_to_finance = true (with bank details); finance reads those rows here and
// records payments back into the WO's payment_* columns in CPS (single source
// of truth, same anti-corruption pattern as PO tranche payments).
import express from 'express';
import multer from 'multer';
import { supabaseAdmin, cpsSupabase } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleGuard } from '../middleware/roleGuard.js';
import { ok, fail } from '../utils/responseHelper.js';
import { logAudit } from '../services/auditService.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const FINANCE_ROLES = ['finance', 'manager', 'admin'];
const ALL_VIEWER_ROLES = ['procurement_finance', 'finance', 'manager', 'admin', 'head'];

// Columns finance needs for the queue + payment math.
const WO_SELECT =
  'id,wo_number,category,project_site,project_code,supplier_name_text,supplier_gstin,' +
  'grand_total,wo_pdf_url,status,sent_to_finance,sent_to_finance_at,' +
  'bank_account_holder_name,bank_name,bank_ifsc,bank_account_number,' +
  'paid_amount,payment_status,paid_at,payment_logs';

// Receipt upload helper (Supabase Storage bucket 'po-receipts', reused for WOs).
async function uploadReceipt(file, storagePath) {
  const ext = file.mimetype.split('/')[1].replace('jpeg', 'jpg');
  const fullPath = `${storagePath}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from('po-receipts')
    .upload(fullPath, file.buffer, { contentType: file.mimetype, upsert: true });
  if (error) throw new Error(`Receipt upload failed: ${error.message}`);
  return fullPath;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/wo-payments/finance-queue
// Work orders CPS has sent to finance. Newest handoffs first.
// ─────────────────────────────────────────────────────────────────────────
router.get('/finance-queue', authMiddleware, roleGuard(ALL_VIEWER_ROLES), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);
    const { data, error } = await cpsSupabase
      .from('cps_work_orders')
      .select(WO_SELECT)
      .eq('sent_to_finance', true)
      .order('sent_to_finance_at', { ascending: false });
    if (error) throw error;
    return ok(res, data ?? []);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/wo-payments/:id/pay   { paid_amount, notes, receipt? }
// Record a full/partial payment against a WO. Writes back to CPS.
// ─────────────────────────────────────────────────────────────────────────
router.post('/:id/pay', authMiddleware, roleGuard(FINANCE_ROLES), upload.single('receipt'), async (req, res, next) => {
  try {
    if (!cpsSupabase) return fail(res, 'CPS connection not configured', 500);
    const { id } = req.params;
    const { paid_amount, notes } = req.body;
    const thisPayment = parseFloat(paid_amount);
    if (!(thisPayment > 0)) return fail(res, 'paid_amount must be positive', 400);

    // Load the WO from CPS (must have been sent to finance).
    const { data: wo, error: woErr } = await cpsSupabase
      .from('cps_work_orders')
      .select('id,wo_number,grand_total,sent_to_finance,paid_amount,payment_logs')
      .eq('id', id).maybeSingle();
    if (woErr) throw woErr;
    if (!wo) return fail(res, 'Work order not found', 404);
    if (!wo.sent_to_finance) return fail(res, 'Work order has not been sent to finance', 409);

    const total = Number(wo.grand_total || 0);
    const alreadyPaid = Number(wo.paid_amount || 0);
    if (thisPayment > total - alreadyPaid + 0.01)
      return fail(res, `Payment exceeds WO total (total ₹${total}, already paid ₹${alreadyPaid})`, 400);

    const newTotalPaid = alreadyPaid + thisPayment;
    const fully = newTotalPaid >= total - 0.01;
    const nowIso = new Date().toISOString();

    let receiptPath = null;
    if (req.file) receiptPath = await uploadReceipt(req.file, `wo-receipts/${wo.wo_number}-${Date.now()}`);

    const logEntry = {
      amount: thisPayment,
      paid_at: nowIso,
      paid_by: req.user.id,
      paid_by_name: req.user.name || req.user.email || 'Finance',
      notes: notes || null,
      receipt_path: receiptPath || null,
    };
    const logs = [...(Array.isArray(wo.payment_logs) ? wo.payment_logs : []), logEntry];

    const { data: updated, error: upErr } = await cpsSupabase
      .from('cps_work_orders')
      .update({
        paid_amount: newTotalPaid,
        payment_status: fully ? 'paid' : 'partially_paid',
        paid_at: fully ? nowIso : null,
        payment_logs: logs,
      })
      .eq('id', id)
      .select(WO_SELECT)
      .single();
    if (upErr) throw upErr;

    await logAudit({
      userId: req.user.id,
      action: fully ? 'WO_PAYMENT_PAID' : 'WO_PAYMENT_PARTIAL',
      entityType: 'work_order',
      entityId: id,
      newValue: { wo_number: wo.wo_number, this_payment: thisPayment, total_paid: newTotalPaid, grand_total: total, fully_settled: fully },
    });

    return ok(res, { ...updated, total_paid: newTotalPaid, fully_settled: fully });
  } catch (err) { next(err); }
});

export default router;
