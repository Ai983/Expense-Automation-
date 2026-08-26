import axios from 'axios';

// Hagerstone runs its own self-hosted WhatsApp gateway (Baileys on Railway),
// which is deliberately Maytapi-compatible: same path shape, same x-maytapi-key
// header, same body. Only the base URL differs, so pointing at it is a one-value
// change rather than a rewrite.
//
//   own gateway : https://<host>/maytapi/:productId/:phoneId/sendMessage
//   maytapi.com : https://api.maytapi.com/api/:productId/:phoneId/sendMessage
//
// With the gateway, phoneId is the SESSION id (e.g. 'hagerstone-biz') and the
// token is the gateway's GATEWAY_SECRET.
const WHATSAPP_API_BASE_URL = (process.env.WHATSAPP_API_BASE_URL || 'https://api.maytapi.com/api').replace(/\/+$/, '');
const MAYTAPI_PRODUCT_ID = process.env.MAYTAPI_PRODUCT_ID;
const MAYTAPI_PHONE_ID   = process.env.MAYTAPI_PHONE_ID;
const MAYTAPI_API_TOKEN  = process.env.MAYTAPI_API_TOKEN;

function isConfigured() {
  return MAYTAPI_PRODUCT_ID && MAYTAPI_PHONE_ID && MAYTAPI_API_TOKEN;
}

/**
 * Sends a WhatsApp text message via Maytapi.
 * @param {string} phone  - recipient phone number with country code, e.g. "919876543210"
 * @param {string} message - plain text message
 */
export async function sendWhatsApp(phone, message) {
  if (!isConfigured()) {
    console.warn('[WhatsApp] Maytapi credentials not set — skipping message');
    return;
  }
  if (!phone) {
    console.warn('[WhatsApp] No phone number provided — skipping message');
    return;
  }

  // Normalise: strip spaces, dashes, +; ensure starts with 91 for India
  const normalised = phone.replace(/[\s\-\+]/g, '');
  const to = normalised.startsWith('91') ? normalised : `91${normalised}`;

  const url = `${WHATSAPP_API_BASE_URL}/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/sendMessage`;

  console.log(`[WhatsApp] Sending to ${to}...`);
  const resp = await axios.post(
    url,
    { to_number: to, type: 'text', message },
    { headers: { 'x-maytapi-key': MAYTAPI_API_TOKEN, 'Content-Type': 'application/json' }, timeout: 20000 }
  );

  // A 200 with success:false is a silent failure — the message did not go out.
  // Historically this looked like a success in the logs and messages vanished.
  if (resp.data?.success === false) {
    throw new Error(`WhatsApp gateway rejected the message: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }
  console.log(`[WhatsApp] Sent to ${to} — status: ${resp.status}, success: ${resp.data?.success}`);
}

/**
 * Tells an employee their expense was rejected, and what to do about it.
 *
 * Sent the moment finance confirms a rejection. Without it employees only found
 * out by opening the app — a median of 38 hours later, and over a week for 29 of
 * them. Since 80% do resubmit once they know, and 74% of those get approved,
 * closing this gap turns a stalled expense into a fixed one within the day.
 */
export async function notifyExpenseRejected({ name, phone, refId, amount, category, reason }) {
  if (!phone) {
    console.warn(`[WhatsApp] No phone for ${name || 'employee'} — cannot send rejection notice`);
    return;
  }

  const msg =
    `❌ *Expense Not Accepted*\n\n` +
    `Hi ${name || 'there'}, your expense could not be approved.\n\n` +
    `Ref: ${refId}\n` +
    `Amount: Rs.${Number(amount).toLocaleString('en-IN')}\n` +
    `Category: ${category || '-'}\n\n` +
    `*Reason:* ${reason}\n\n` +
    `Please submit it again with the correct payment screenshot from the app. ` +
    `Your imprest stays open until the expense is accepted.\n\n` +
    `कृपया सही पेमेंट स्क्रीनशॉट के साथ दोबारा भेजें।`;

  await sendWhatsApp(phone, msg);
}

/**
 * Sends the imprest approval WhatsApp reminder.
 */
const S1_PHONE = process.env.S1_PHONE || '';
const S2_PHONE = process.env.S2_PHONE || '';
const FINANCE_PHONE = process.env.FINANCE_PHONE || '';

/**
 * Notify S1 approver (Avisha) when a new imprest arrives at s1_pending.
 */
export async function notifyS1({ refId, employeeName, site, category, amount, purpose }) {
  if (!S1_PHONE) return;
  const msg =
    `🔔 *New Imprest Request*\n\n` +
    `Ref: ${refId}\n` +
    `Employee: ${employeeName}\n` +
    `Site: ${site}\n` +
    `Category: ${category}\n` +
    `Amount: Rs.${Number(amount).toLocaleString('en-IN')}\n` +
    `Purpose: ${purpose || 'Not specified'}\n\n` +
    `Reply: *YES ${refId}* to approve\n` +
    `Reply: *NO ${refId} <reason>* to reject`;
  try {
    await sendWhatsApp(S1_PHONE, msg);
  } catch (e) { console.warn('[WhatsApp] S1 notify failed:', e.message); }
}

/**
 * Notify S2 approver (Ritu) when a request arrives at s2_pending.
 */
export async function notifyS2({ refId, employeeName, site, category, amount, purpose, s1Notes }) {
  if (!S2_PHONE) return;
  const msg =
    `🔔 *Imprest Forwarded to You*\n\n` +
    `Ref: ${refId}\n` +
    `Employee: ${employeeName}\n` +
    `Site: ${site}\n` +
    `Category: ${category}\n` +
    `Amount: Rs.${Number(amount).toLocaleString('en-IN')}\n` +
    `Purpose: ${purpose || 'Not specified'}\n` +
    (s1Notes ? `S1 Notes: ${s1Notes}\n` : '') +
    `\nReply: *YES ${refId}* to approve\n` +
    `Reply: *NO ${refId} <reason>* to reject`;
  try {
    await sendWhatsApp(S2_PHONE, msg);
  } catch (e) { console.warn('[WhatsApp] S2 notify failed:', e.message); }
}

/**
 * Notify Finance team when a request arrives at s3_pending.
 */
export async function notifyFinance({ refId, employeeName, site, category, amount, purpose, s2Notes }) {
  if (!FINANCE_PHONE) return;
  const msg =
    `🔔 *Imprest Ready for Finance Approval*\n\n` +
    `Ref: ${refId}\n` +
    `Employee: ${employeeName}\n` +
    `Site: ${site}\n` +
    `Category: ${category}\n` +
    `Amount: Rs.${Number(amount).toLocaleString('en-IN')}\n` +
    `Purpose: ${purpose || 'Not specified'}\n` +
    (s2Notes ? `S2 Notes: ${s2Notes}\n` : '') +
    `\nReply: *YES ${refId}* to approve\n` +
    `Reply: *NO ${refId} <reason>* to reject`;
  try {
    await sendWhatsApp(FINANCE_PHONE, msg);
  } catch (e) { console.warn('[WhatsApp] Finance notify failed:', e.message); }
}

export async function sendImprestApprovalReminder({ name, phone, refId, approvedAmount, site, category, deadline, paymentRemark }) {
  const deadlineStr = new Date(deadline).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const message =
    `Hi ${name}! 👋\n\n` +
    `💸 *Payment Dispatched — ${refId}*\n\n` +
    `Your imprest advance has been approved by the Founder and payment has been released ✅\n\n` +
    `💰 *Amount Paid:* ₹${Number(approvedAmount).toLocaleString('en-IN')}\n` +
    `📍 *Site:* ${site}\n` +
    `📁 *Category:* ${category}\n` +
    (paymentRemark ? `📝 *Finance Note:* ${paymentRemark}\n` : '') +
    `\n⏰ *Please submit your expenses by: ${deadlineStr}*\n\n` +
    `Open the HagerStone app → My Imprest to view this update.\n\n` +
    `_Expense submission required within 7 days or your imprest access will be blocked._`;

  try {
    await sendWhatsApp(phone, message);
    console.log(`[WhatsApp] Payment notification sent to ${name} (${phone})`);
  } catch (err) {
    console.warn(`[WhatsApp] Failed to send to ${name}:`, err.response?.data || err.message);
  }
}
