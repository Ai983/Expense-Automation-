import { supabaseAdmin } from '../config/supabase.js';
import { notifyImprestRejected } from '../services/whatsappService.js';

/**
 * WhatsApps the employee that their imprest was rejected. Looks up the request
 * and employee itself so every reject path (dashboard and WhatsApp replies) is a
 * one-line, fire-and-forget call. Never throws — a failed message must not undo
 * or block the rejection.
 */
export async function sendImprestRejectionNotice(imprestId, { rejectedBy, reason }) {
  try {
    const { data: imp } = await supabaseAdmin
      .from('imprest_requests')
      .select('ref_id, employee_id, amount_requested, site, category')
      .eq('id', imprestId).single();
    if (!imp) return;
    const { data: emp } = await supabaseAdmin
      .from('employees').select('name, phone').eq('id', imp.employee_id).single();
    await notifyImprestRejected({
      name: emp?.name, phone: emp?.phone, refId: imp.ref_id,
      amount: imp.amount_requested, site: imp.site, category: imp.category,
      rejectedBy, reason,
    });
  } catch (e) {
    console.warn(`[WhatsApp] Imprest rejection notice failed for ${imprestId}:`, e.message);
  }
}
