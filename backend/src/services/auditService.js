import { supabaseAdmin } from '../config/supabase.js';

/**
 * Logs an action to the audit_trail table.
 * Never throws — audit failures should not block the main operation.
 */
export async function logAudit({ userId, action, entityType, entityId, oldValue, newValue, ipAddress }) {
  try {
    await supabaseAdmin.from('audit_trail').insert({
      user_id: userId || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      old_value: oldValue || null,
      new_value: newValue || null,
      ip_address: ipAddress || null,
    });
  } catch (err) {
    console.error('Audit log failed (non-fatal):', err.message);
  }
}
