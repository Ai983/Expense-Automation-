import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { notifyS2, notifyFinance } from '../services/whatsappService.js';

const router = Router();

const EXISTING_WEBHOOK_URL = process.env.MAYTAPI_EXISTING_WEBHOOK || '';
const N8N_FOUNDER_REPLY_URL = process.env.N8N_WEBHOOK_FOUNDER_REPLY || '';

// All known phone numbers
const FOUNDER_PHONE = process.env.FOUNDER_PHONE || '';
const DIRECTOR_PHONE = process.env.DIRECTOR_PHONE || '';
const S1_PHONE = process.env.S1_PHONE || '';
const S2_PHONE = process.env.S2_PHONE || '';
const FINANCE_PHONE = process.env.FINANCE_PHONE || '';

/**
 * Identify the approver role from their phone number.
 */
function identifyApprover(cleanPhone) {
  const last10 = (p) => p.slice(-10);
  const match = (p) => p && (cleanPhone === p || cleanPhone.endsWith(last10(p)));
  if (match(S1_PHONE)) return 's1';
  if (match(S2_PHONE)) return 's2';
  if (match(FINANCE_PHONE)) return 'finance';
  if (match(FOUNDER_PHONE)) return 'founder';
  if (match(DIRECTOR_PHONE)) return 'director';
  return null;
}

/**
 * Extract ref_id from message like "YES IMP-20260409-0001" or "NO IMP-20260409-0001 reason"
 */
function extractRefFromMessage(text) {
  if (!text) return null;
  const m = text.match(/(IMP-\d{8}-\d{4})/i);
  return m ? m[1] : null;
}

/**
 * Extract ReplyID (uuid format) from quoted or inline message.
 */
function extractReplyId(text) {
  if (!text) return '';
  const match = text.match(/ReplyID:\s*(IMP-[^\s]+\|\|[a-f0-9-]+)/i);
  if (match) return match[1];
  const match2 = text.match(/(IMP-\d{8}-\d{4}\|\|[a-f0-9-]+)/);
  if (match2) return match2[1];
  return '';
}

/**
 * POST /api/whatsapp/incoming
 *
 * Central router for ALL incoming Maytapi WhatsApp messages.
 */
router.post('/incoming', async (req, res) => {
  const body = req.body;
  res.json({ status: 'received' });

  console.log('[WhatsApp Incoming] type:', body?.type, 'from:', body?.user?.phone || 'unknown');

  if (body?.type !== 'message') {
    if (EXISTING_WEBHOOK_URL) {
      fetch(EXISTING_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    }
    return;
  }

  const msgText = body?.message?.text || body?.message || '';
  const senderPhone = body?.user?.phone || '';
  const quotedMsg = body?.message?.quotedMsg?.body || body?.message?.quotedMsg?.text || '';

  const upperMsg = (typeof msgText === 'string' ? msgText : '').trim().toUpperCase();
  const isApprovalReply = upperMsg.startsWith('YES') || upperMsg.startsWith('NO');

  const cleanPhone = senderPhone.replace(/\D/g, '');
  const approverRole = identifyApprover(cleanPhone);

  if (isApprovalReply && approverRole) {
    const decision = upperMsg.startsWith('YES') ? 'approved' : 'rejected';
    const comment = (typeof msgText === 'string' ? msgText : '').trim();
    const commentText = comment.indexOf(' ') > 0 ? comment.substring(comment.indexOf(' ') + 1) : '';
    // Remove ref_id from comment if present
    const refInComment = extractRefFromMessage(commentText);
    const cleanComment = refInComment ? commentText.replace(refInComment, '').trim() : commentText;

    try {
      if (approverRole === 'founder' || approverRole === 'director') {
        await handleFounderDirectorReply({ msgText, cleanPhone, quotedMsg, upperMsg, decision, comment: cleanComment });
      } else {
        await handleStageApproverReply({ role: approverRole, msgText, cleanPhone, decision, comment: cleanComment });
      }
    } catch (e) {
      console.error(`[WhatsApp] Error processing ${approverRole} reply:`, e.message);
    }

    // Forward to n8n if configured
    if (N8N_FOUNDER_REPLY_URL && (approverRole === 'founder' || approverRole === 'director')) {
      const replyTo = extractReplyId(msgText) || extractReplyId(quotedMsg);
      fetch(N8N_FOUNDER_REPLY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: { message: msgText, from: cleanPhone, replyTo: replyTo || '' } }),
      }).catch((e) => console.warn('[WhatsApp] n8n forward failed:', e.message));
    }
  }

  // Forward to existing webhook
  if (EXISTING_WEBHOOK_URL) {
    try {
      await fetch(EXISTING_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.warn('[WhatsApp] Failed to forward to existing webhook:', e.message);
    }
  }
});

// ─── Founder / Director Reply Handler ──────────────────────────────────────────
async function handleFounderDirectorReply({ msgText, cleanPhone, quotedMsg, upperMsg, decision, comment }) {
  let replyTo = extractReplyId(msgText) || extractReplyId(quotedMsg);
  let imprestId = replyTo ? (replyTo.split('||')[1] || '') : '';

  if (!imprestId) {
    console.log('[WhatsApp] No ReplyID found, looking up latest pending imprest...');
    const { data: latestPending } = await supabaseAdmin
      .from('imprest_requests')
      .select('id, ref_id')
      .eq('requires_founder_approval', true)
      .eq('founder_review_status', 'pending')
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();
    if (latestPending) {
      imprestId = latestPending.id;
      console.log('[WhatsApp] Found pending imprest:', latestPending.ref_id);
    }
  }

  if (!imprestId) {
    console.log('[WhatsApp] No pending imprest found to process');
    return;
  }

  const updateFields = {
    founder_review_status: decision,
    founder_review_comment: comment || null,
    founder_review_at: new Date().toISOString(),
    founder_review_phone: cleanPhone,
  };

  if (decision === 'approved') {
    updateFields.current_stage = 's3_pending';
    updateFields.director_approved_amount = null;
    const { data: impData } = await supabaseAdmin
      .from('imprest_requests').select('amount_requested, employee_id, ref_id, site, category, purpose').eq('id', imprestId).single();
    if (impData) {
      updateFields.director_approved_amount = parseFloat(impData.amount_requested);
      // Notify Finance
      const empName = (await supabaseAdmin.from('employees').select('name').eq('id', impData.employee_id).single()).data?.name || '';
      notifyFinance({ refId: impData.ref_id, employeeName: empName, site: impData.site, category: impData.category, amount: parseFloat(impData.amount_requested), purpose: impData.purpose || '', s2Notes: 'Director approved' });
    }
    updateFields.s2_approved_at = new Date().toISOString();
  } else {
    updateFields.current_stage = 'director_rejected';
    updateFields.status = 'rejected';
    updateFields.rejection_reason = 'Rejected by Director via WhatsApp' + (comment ? ': ' + comment : '');
  }

  const { error: updateErr } = await supabaseAdmin
    .from('imprest_requests').update(updateFields).eq('id', imprestId);

  if (updateErr) {
    console.error('[WhatsApp] Failed to update imprest:', updateErr.message);
  } else {
    console.log(`[WhatsApp] Director ${decision} — stage: ${updateFields.current_stage} for imprest ${imprestId}`);
  }
}

// ─── S1 / S2 / Finance Reply Handler ──────────────────────────────────────────
async function handleStageApproverReply({ role, msgText, cleanPhone, decision, comment }) {
  const refId = extractRefFromMessage(msgText);

  // Map role to expected stage and actions
  const stageMap = {
    s1: { stage: 's1_pending', approveStage: 's2_pending', rejectStage: 's1_rejected' },
    s2: { stage: 's2_pending', approveStage: 's3_pending', rejectStage: 's2_rejected' },
    finance: { stage: 's3_pending', approveStage: 's3_approved', rejectStage: 's3_rejected' },
  };
  const cfg = stageMap[role];
  if (!cfg) return;

  // Find the imprest
  let query = supabaseAdmin.from('imprest_requests')
    .select('id, ref_id, employee_id, site, category, purpose, amount_requested, approval_route, current_stage')
    .eq('current_stage', cfg.stage);

  if (refId) {
    query = query.eq('ref_id', refId);
  } else {
    // Fallback: latest pending at this stage
    query = query.order('submitted_at', { ascending: false }).limit(1);
  }

  const { data, error } = refId ? await query.single() : await query;
  const imp = refId ? data : data?.[0];

  if (error || !imp) {
    console.log(`[WhatsApp] No ${cfg.stage} imprest found${refId ? ` for ${refId}` : ''}`);
    return;
  }

  const now = new Date().toISOString();
  const updateFields = {};
  const empName = (await supabaseAdmin.from('employees').select('name').eq('id', imp.employee_id).single()).data?.name || '';

  if (decision === 'approved') {
    updateFields.current_stage = cfg.approveStage;

    if (role === 's1') {
      updateFields.s1_approved_at = now;
      updateFields.s1_notes = comment || 'Approved via WhatsApp';
      // For director route, also set founder_review_status
      if (imp.approval_route === 'avisha_director_finance') {
        updateFields.founder_review_status = 'pending';
      }
      // Notify S2 for ritu route
      if (imp.approval_route === 'avisha_ritu_finance') {
        notifyS2({ refId: imp.ref_id, employeeName: empName, site: imp.site, category: imp.category, amount: parseFloat(imp.amount_requested), purpose: imp.purpose || '', s1Notes: comment || 'Approved via WhatsApp' });
      }
    } else if (role === 's2') {
      updateFields.s2_approved_at = now;
      updateFields.s2_notes = comment || 'Approved via WhatsApp';
      // Notify Finance
      notifyFinance({ refId: imp.ref_id, employeeName: empName, site: imp.site, category: imp.category, amount: parseFloat(imp.amount_requested), purpose: imp.purpose || '', s2Notes: comment || 'Approved via WhatsApp' });
    } else if (role === 'finance') {
      updateFields.status = 'approved';
      updateFields.approved_amount = parseFloat(imp.amount_requested);
      updateFields.approved_at = now;
    }
  } else {
    updateFields.current_stage = cfg.rejectStage;
    updateFields.status = 'rejected';
    updateFields.rejection_reason = `Rejected by ${role.toUpperCase()} via WhatsApp` + (comment ? ': ' + comment : '');

    if (role === 's1') { updateFields.s1_approved_at = now; }
    else if (role === 's2') { updateFields.s2_approved_at = now; }
    else if (role === 'finance') { updateFields.approved_at = now; }
  }

  const { error: updateErr } = await supabaseAdmin
    .from('imprest_requests').update(updateFields).eq('id', imp.id);

  if (updateErr) {
    console.error(`[WhatsApp] Failed to update imprest for ${role}:`, updateErr.message);
  } else {
    console.log(`[WhatsApp] ${role} ${decision} — ${imp.ref_id} → ${updateFields.current_stage}`);
  }
}

export default router;
