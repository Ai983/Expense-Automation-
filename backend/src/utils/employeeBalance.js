import { supabaseAdmin } from '../config/supabase.js';
import { fetchAllRows } from './fetchAll.js';

// PostgREST takes .in() filters in the URL; ~37 bytes per UUID. The board once
// sent 528 imprest ids (~20 KB) in one request, and when that request failed
// the error was ignored — every employee's balance became the total ever paid
// to them (Yash showed ₹19,750 while fully settled).
const ID_BATCH = 100;

const EMPLOYEE_BATCH = 50;

const SETTLED_EXPENSE_STATUSES = ['approved', 'verified', 'auto_verified'];

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Per-employee unsettled advance: cash actually paid out minus approved
 * expenses against it, summed over every paid imprest (never below zero per
 * imprest).
 *
 * Throws on any query failure. A partial read would overstate what people owe,
 * so callers must show "unknown", never a number built from missing data.
 *
 * @param {string[]} employeeIds
 * @returns {Promise<Record<string, number>>} employee_id → balance (rupees, 2dp)
 */
export async function getEmployeeBalances(employeeIds) {
  const empIds = [...new Set((employeeIds || []).filter(Boolean))];
  const balances = {};
  if (empIds.length === 0) return balances;

  const paidImps = [];
  for (const ids of chunk(empIds, EMPLOYEE_BATCH)) {
    paidImps.push(...await fetchAllRows((from, to) => supabaseAdmin
      .from('imprest_requests')
      .select('id, employee_id, paid_amount')
      .in('employee_id', ids)
      .eq('paid', true)
      .order('id')
      .range(from, to)));
  }

  const usedByImprest = {};
  for (const ids of chunk(paidImps.map((r) => r.id), ID_BATCH)) {
    const exps = await fetchAllRows((from, to) => supabaseAdmin
      .from('expenses')
      .select('id, imprest_id, amount')
      .in('imprest_id', ids)
      .in('status', SETTLED_EXPENSE_STATUSES)
      .order('id')
      .range(from, to));
    for (const e of exps) {
      usedByImprest[e.imprest_id] = (usedByImprest[e.imprest_id] || 0) + parseFloat(e.amount || 0);
    }
  }

  for (const imp of paidImps) {
    const bal = Math.max(0, parseFloat(imp.paid_amount || 0) - (usedByImprest[imp.id] || 0));
    balances[imp.employee_id] = (balances[imp.employee_id] || 0) + bal;
  }
  for (const id of Object.keys(balances)) balances[id] = Math.round(balances[id] * 100) / 100;
  return balances;
}

/**
 * Same as getEmployeeBalances, but a failure yields null instead of throwing,
 * so a list page still loads. Callers map a missing map to
 * employee_total_balance = null, which the dashboard renders as unknown.
 */
export async function tryGetEmployeeBalances(employeeIds, context) {
  try {
    return await getEmployeeBalances(employeeIds);
  } catch (err) {
    console.error(`[employeeBalance] ${context}: balance lookup failed — showing unknown`, err?.message || err);
    return null;
  }
}

export function balanceFor(balances, employeeId) {
  return balances ? (balances[employeeId] || 0) : null;
}
