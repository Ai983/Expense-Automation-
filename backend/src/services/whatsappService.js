import axios from 'axios';

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

  const url = `https://api.maytapi.com/api/${MAYTAPI_PRODUCT_ID}/${MAYTAPI_PHONE_ID}/sendMessage`;

  console.log(`[WhatsApp] Sending to ${to}...`);
  const resp = await axios.post(
    url,
    { to_number: to, type: 'text', message },
    { headers: { 'x-maytapi-key': MAYTAPI_API_TOKEN, 'Content-Type': 'application/json' } }
  );
  console.log(`[WhatsApp] Sent to ${to} — status: ${resp.status}, success: ${resp.data?.success}`);
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

export async function sendImprestApprovalReminder({ name, phone, refId, approvedAmount, site, category, deadline }) {
  const deadlineStr = new Date(deadline).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const message =
    `Hi ${name}! 👋\n\n` +
    `Your imprest request *${refId}* has been approved ✅\n\n` +
    `💰 *Approved Amount:* ₹${Number(approvedAmount).toLocaleString('en-IN')}\n` +
    `📍 *Site:* ${site}\n` +
    `📁 *Category:* ${category}\n\n` +
    `⏰ *Please submit your expense by: ${deadlineStr}*\n\n` +
    `Open the HagerStone app → Submit tab to fill in your expense details.\n\n` +
    `_If you do not submit within 3 days, your imprest access will be blocked._`;

  try {
    await sendWhatsApp(phone, message);
    console.log(`[WhatsApp] Approval reminder sent to ${name} (${phone})`);
  } catch (err) {
    console.warn(`[WhatsApp] Failed to send to ${name}:`, err.response?.data || err.message);
  }
}
