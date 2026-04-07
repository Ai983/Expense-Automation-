import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

const EXISTING_WEBHOOK_URL = process.env.MAYTAPI_EXISTING_WEBHOOK || '';
const N8N_FOUNDER_REPLY_URL = process.env.N8N_WEBHOOK_FOUNDER_REPLY || '';

// Founder/Director phone numbers for matching
const FOUNDER_PHONE = process.env.FOUNDER_PHONE || '';
const DIRECTOR_PHONE = process.env.DIRECTOR_PHONE || '';

/**
 * POST /api/whatsapp/incoming
 *
 * Central router for ALL incoming Maytapi WhatsApp messages.
 * Maytapi webhook URL should be set to:
 *   https://your-backend.railway.app/api/whatsapp/incoming
 */
router.post('/incoming', async (req, res) => {
  const body = req.body;

  // Always respond 200 immediately
  res.json({ status: 'received' });

  // Log payload type for debugging
  console.log('[WhatsApp Incoming] type:', body?.type, 'from:', body?.user?.phone || 'unknown');

  // Skip non-message payloads (ack, delivery receipts, etc.)
  if (body?.type !== 'message') {
    console.log('[WhatsApp] Skipping non-message type:', body?.type);
    // Still forward to existing webhook
    if (EXISTING_WEBHOOK_URL) {
      fetch(EXISTING_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
    }
    return;
  }

  // Maytapi message payload: message.text has the actual text, user.phone has sender
  const msgText = body?.message?.text || body?.message || '';
  const senderPhone = body?.user?.phone || '';
  const quotedMsg = body?.message?.quotedMsg?.body || body?.message?.quotedMsg?.text || '';

  const upperMsg = (typeof msgText === 'string' ? msgText : '').trim().toUpperCase();
  const isApprovalReply = upperMsg.startsWith('YES') || upperMsg.startsWith('NO');

  // Check if sender is founder or director
  const cleanPhone = senderPhone.replace(/\D/g, '');
  const isFounderOrDirector = cleanPhone === FOUNDER_PHONE || cleanPhone === DIRECTOR_PHONE
    || cleanPhone.endsWith(FOUNDER_PHONE.slice(-10)) || cleanPhone.endsWith(DIRECTOR_PHONE.slice(-10));

  if (isApprovalReply && isFounderOrDirector) {
    try {
      // Try to extract ReplyID from the message text, quoted message, or both
      let replyTo = extractReplyId(msgText) || extractReplyId(quotedMsg);
      console.log('[WhatsApp] Message:', msgText, '| Quoted:', quotedMsg, '| ReplyTo:', replyTo);
      let imprestId = '';

      if (replyTo) {
        imprestId = replyTo.split('||')[1] || '';
      }

      // If no ReplyID found, find the latest pending imprest awaiting founder review
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

      if (imprestId) {
        const decision = upperMsg.startsWith('YES') ? 'approved' : 'rejected';
        const comment = msgText.trim().indexOf(' ') > 0
          ? msgText.trim().substring(msgText.trim().indexOf(' ') + 1)
          : '';

        // Update founder review AND advance stage
        const updateFields = {
          founder_review_status: decision,
          founder_review_comment: comment || null,
          founder_review_at: new Date().toISOString(),
          founder_review_phone: cleanPhone,
        };

        if (decision === 'approved') {
          // Director approved — advance to S3 (finance)
          updateFields.current_stage = 's3_pending';
          updateFields.director_approved_amount = null; // will be set from amount_requested
          // Fetch amount to set ceiling
          const { data: impData } = await supabaseAdmin
            .from('imprest_requests').select('amount_requested').eq('id', imprestId).single();
          if (impData) updateFields.director_approved_amount = parseFloat(impData.amount_requested);
          updateFields.s2_approved_at = new Date().toISOString();
        } else {
          // Director rejected — permanent death
          updateFields.current_stage = 'director_rejected';
          updateFields.status = 'rejected';
          updateFields.rejection_reason = 'Rejected by Director via WhatsApp' + (comment ? ': ' + comment : '');
        }

        const { error: updateErr } = await supabaseAdmin
          .from('imprest_requests')
          .update(updateFields)
          .eq('id', imprestId);

        if (updateErr) {
          console.error('[WhatsApp] Failed to update imprest:', updateErr.message);
        } else {
          console.log(`[WhatsApp] Director ${decision} — stage: ${updateFields.current_stage} for imprest ${imprestId}`);
        }
      } else {
        console.log('[WhatsApp] No pending imprest found to process');
      }

      // Also forward to n8n if configured (for logging/additional processing)
      if (N8N_FOUNDER_REPLY_URL) {
        fetch(N8N_FOUNDER_REPLY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: { message: msgText, from: cleanPhone, replyTo: replyTo || '' } }),
        }).catch((e) => console.warn('[WhatsApp] n8n forward failed:', e.message));
      }
    } catch (e) {
      console.error('[WhatsApp] Error processing founder reply:', e.message);
    }
  }

  // Forward to existing webhook for other processing
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

function extractReplyId(text) {
  if (!text) return '';
  const match = text.match(/ReplyID:\s*(IMP-[^\s]+\|\|[a-f0-9-]+)/i);
  if (match) return match[1];
  const match2 = text.match(/(IMP-\d{8}-\d{4}\|\|[a-f0-9-]+)/);
  if (match2) return match2[1];
  return '';
}

export default router;
