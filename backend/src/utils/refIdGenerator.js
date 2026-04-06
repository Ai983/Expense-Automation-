import { supabaseAdmin } from '../config/supabase.js';

/**
 * Generates a unique expense reference ID in the format HSE-YYYYMMDD-XXXX.
 * Uses the highest existing sequence number for the day to avoid collisions.
 */
export async function generateRefId() {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');

  const { data, error } = await supabaseAdmin
    .from('expenses')
    .select('ref_id')
    .like('ref_id', `HSE-${datePart}-%`)
    .order('ref_id', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to generate ref_id: ${error.message}`);
  }

  const lastSeq = data?.[0]?.ref_id?.split('-').pop() || '0000';
  const nextSeq = String(parseInt(lastSeq, 10) + 1).padStart(4, '0');
  return `HSE-${datePart}-${nextSeq}`;
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
