import 'dotenv/config';
import { supabaseAdmin } from '../src/config/supabase.js';
import { resolveImprestRouting } from '../src/utils/imprestRouting.js';
import { triggerFounderApproval } from '../src/services/n8nService.js';

/**
 * One-time reconciliation of historical imprest data to the three-tier
 * approval logic. Idempotent — re-running makes no further changes once
 * everything is consistent.
 *
 * For each ACTIVE item (s1_pending / s2_pending / director_pending):
 *   1. Recompute the correct approval_route from (site, amount).
 *   2. Fix ONLY the two genuinely-broken stage cases (conservative — never
 *      advance an item forward based on approval timestamps, because
 *      s1_approved_at is unreliably populated on un-approved rows):
 *        - HO/Blr item mis-started at s1_pending          → s2_pending
 *        - legacy director item parked at s2_pending      → director_pending (+ Director WhatsApp)
 *      Every other item keeps its current stage (route may still be corrected).
 *   3. Write only rows whose route or stage actually changes.
 *   4. Fire the Director (Bhaskar Sir) WhatsApp for items NEWLY moved to
 *      director_pending — mirrors imprest.js s1-approve.
 *
 * Run from backend/:  node scripts/reconcile-imprest-routes.js
 */

const ACTIVE_STAGES = ['s1_pending', 's2_pending', 'director_pending'];

function deriveStage(route, item) {
  const s = item.current_stage;
  // HO/Blr request mis-started in Avisha's S1 queue → belongs in Ritu's S2 queue
  if (route === 's2_finance_founder' && s === 's1_pending') return 's2_pending';
  // Legacy ≥₹10K item parked at s2_pending (old Director-WhatsApp wait) → new Director gate
  if (route === 'avisha_director_finance_founder' && s === 's2_pending') return 'director_pending';
  // Otherwise leave the stage untouched
  return s;
}

// Outstanding balance for an employee (excludes the item itself) — mirrors
// the calcOutstanding() helper inside imprest.js s1-approve.
async function calcOutstanding(item) {
  let out = 0;
  const { data: empImps } = await supabaseAdmin
    .from('imprest_requests').select('id, approved_amount, amount_requested')
    .eq('employee_id', item.employee_id)
    .in('status', ['approved', 'partially_approved'])
    .neq('id', item.id);
  if (empImps?.length > 0) {
    const aIds = empImps.map((r) => r.id);
    const { data: exps } = await supabaseAdmin.from('expenses').select('imprest_id, amount, status')
      .in('imprest_id', aIds).not('status', 'in', '("rejected","blocked")');
    const expMap = {};
    for (const e of (exps || [])) { expMap[e.imprest_id] = (expMap[e.imprest_id] || 0) + parseFloat(e.amount); }
    for (const r of empImps) {
      out += Math.max(0, parseFloat(r.approved_amount || r.amount_requested) - (expMap[r.id] || 0));
    }
  }
  return Math.round(out * 100) / 100;
}

async function notifyDirector(item) {
  const { data: emp } = await supabaseAdmin
    .from('employees').select('name').eq('id', item.employee_id).single();
  const oldBalance = await calcOutstanding(item);
  await triggerFounderApproval({
    imprestId: item.id, refId: item.ref_id, requestedTo: 'Bhaskar Sir',
    employeeName: emp?.name || '', employeeSite: item.site,
    amount: parseFloat(item.amount_requested), category: item.category,
    purpose: item.purpose || '', oldBalance,
    submittedAt: item.s1_approved_at || item.submitted_at,
  });
}

async function main() {
  console.log('🔄 Reconciling imprest routes/stages...\n');

  const { data: items, error } = await supabaseAdmin
    .from('imprest_requests')
    .select('id, ref_id, site, amount_requested, current_stage, approval_route, status, employee_id, category, purpose, submitted_at, s1_approved_at, s2_approved_at, director_approved_at')
    .in('current_stage', ACTIVE_STAGES);

  if (error) { console.error('❌ Load failed:', error.message); process.exit(1); }
  console.log(`Loaded ${items.length} active items.\n`);

  const summary = { routeFixed: 0, toDirector: 0, toS2: 0, toFinance: 0, toS1: 0, unchanged: 0 };
  const directorNotifications = [];

  for (const item of items) {
    const amount = parseFloat(item.amount_requested);
    const { approvalRoute } = resolveImprestRouting(item.site, amount);
    const newStage = deriveStage(approvalRoute, item);

    const routeChanged = approvalRoute !== item.approval_route;
    const stageChanged = newStage !== item.current_stage;
    if (!routeChanged && !stageChanged) { summary.unchanged++; continue; }

    const { error: upErr } = await supabaseAdmin
      .from('imprest_requests')
      .update({ approval_route: approvalRoute, current_stage: newStage })
      .eq('id', item.id);
    if (upErr) { console.error(`  ❌ ${item.ref_id}: ${upErr.message}`); continue; }

    if (routeChanged) summary.routeFixed++;
    if (stageChanged) {
      if (newStage === 'director_pending') { summary.toDirector++; directorNotifications.push(item); }
      else if (newStage === 's2_pending') summary.toS2++;
      else if (newStage === 's3_pending') summary.toFinance++;
      else if (newStage === 's1_pending') summary.toS1++;
    }
    console.log(`  ✓ ${item.ref_id} (₹${amount}, ${item.site}): ${item.current_stage}/${item.approval_route} → ${newStage}/${approvalRoute}`);
  }

  // Fire Director WhatsApp for items newly moved to director_pending
  if (directorNotifications.length > 0) {
    console.log(`\n📲 Sending ${directorNotifications.length} Director (Bhaskar Sir) WhatsApp notification(s)...`);
    for (const item of directorNotifications) {
      try {
        await notifyDirector(item);
        console.log(`  📤 ${item.ref_id} → Director WhatsApp sent`);
      } catch (e) {
        console.warn(`  ⚠️  ${item.ref_id} → Director WhatsApp failed: ${e.message}`);
      }
    }
  }

  console.log('\n──────── Summary ────────');
  console.log(`  Route corrected:        ${summary.routeFixed}`);
  console.log(`  → director_pending:     ${summary.toDirector}  (Director WhatsApp sent)`);
  console.log(`  → s2_pending (Ritu):    ${summary.toS2}  (silent)`);
  console.log(`  → s3_pending (Finance): ${summary.toFinance}`);
  console.log(`  → s1_pending (Avisha):  ${summary.toS1}`);
  console.log(`  Unchanged:              ${summary.unchanged}`);
  console.log('─────────────────────────\n✅ Done.');
  process.exit(0);
}

main().catch((e) => { console.error('❌ Fatal:', e); process.exit(1); });
