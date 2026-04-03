import { supabaseAdmin } from '../config/supabase.js';

/**
 * Generates a unique expense reference ID in the format HSE-YYYYMMDD-XXXX.
 * XXXX is a zero-padded daily sequence number (resets each day).
 */
export async function generateRefId() {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

  const startOfDay = `${today.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const endOfDay = `${today.toISOString().slice(0, 10)}T23:59:59.999Z`;

  const { count, error } = await supabaseAdmin
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .gte('submitted_at', startOfDay)
    .lte('submitted_at', endOfDay);

  if (error) {
    throw new Error(`Failed to generate ref_id: ${error.message}`);
  }

  const sequence = String((count || 0) + 1).padStart(4, '0');
  return `HSE-${datePart}-${sequence}`;
}

/**
 * Generates a unique imprest reference ID in the format IMP-YYYYMMDD-XXXX.
 * XXXX is a zero-padded daily sequence number (resets each day).
 */
export async function generateImprestRefId() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const { data, error } = await supabaseAdmin
    .from('imprest_requests')
    .select('ref_id')
    .like('ref_id', `IMP-${dateStr}-%`)
    .order('ref_id', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to generate imprest ref_id: ${error.message}`);
  }

  const lastSeq = data?.[0]?.ref_id?.split('-')[2] || '0000';
  const nextSeq = String(parseInt(lastSeq, 10) + 1).padStart(4, '0');
  return `IMP-${dateStr}-${nextSeq}`;
}
