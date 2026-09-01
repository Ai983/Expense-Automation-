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
const WHATSAPP_API_BASE_URL = (
  process.env.WHATSAPP_API_BASE_URL || 'https://wa-gateway-production-26c1.up.railway.app/maytapi'
).replace(/\/+$/, '');
// When set, EVERY outbound message goes here instead of the real recipient.
// Unset it to go live.
const WHATSAPP_TEST_NUMBER = process.env.WHATSAPP_TEST_NUMBER || '';

// We send through our own self-hosted gateway (Plumbline / hagerstone-wa-gateway),
// not Maytapi. The gateway is deliberately Maytapi-COMPATIBLE — same path shape,
// same x-maytapi-key header — which is why those names survive in the wire
// protocol. The MAYTAPI_* env names are read only as a fallback for older
// deployments; WHATSAPP_* is the correct set.
//
//   SESSION_ID     the gateway session, e.g. 'hagerstone-biz'
//   GATEWAY_SECRET the gateway's GATEWAY_SECRET value
const WHATSAPP_PRODUCT_ID = process.env.WHATSAPP_PRODUCT_ID || process.env.MAYTAPI_PRODUCT_ID || 'hagerstone';
const WHATSAPP_SESSION_ID = process.env.WHATSAPP_SESSION_ID || process.env.MAYTAPI_PHONE_ID;
const WHATSAPP_GATEWAY_SECRET = process.env.WHATSAPP_GATEWAY_SECRET || process.env.MAYTAPI_API_TOKEN;

/**
 * Turns a stored phone number into a deliverable Indian WhatsApp number.
 *
 * The employee table holds them in several shapes: "+91 9958524885",
 * "+91 97954 07133", "+91-9000000001", and "09220908366" with a leading zero
 * (the STD-dialling habit). The previous version stripped only spaces, dashes
 * and plus signs, so the leading-zero form became 9109220908366 — thirteen
 * digits, undeliverable, and silently so.
 *
 * Returns null when the number cannot be made sense of, so the caller skips
 * the send rather than firing at a wrong number.
 */
export function normalisePhone(raw) {
  if (!raw) return null;

  let digits = String(raw).replace(/\D/g, '');
  digits = digits.replace(/^0+/, ''); // 09220908366 → 9220908366

  // Already carries the country code.
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  // Plain 10-digit Indian mobile.
  if (digits.length === 10) return `91${digits}`;

  return null;
}

function isConfigured() {
  return WHATSAPP_PRODUCT_ID && WHATSAPP_SESSION_ID && WHATSAPP_GATEWAY_SECRET;
}

/**
 * Sends a WhatsApp text message via Maytapi.
 * @param {string} phone  - recipient phone number with country code, e.g. "919876543210"
 * @param {string} message - plain text message
 */
export async function sendWhatsApp(phone, message, { divertible = false } = {}) {
  if (!isConfigured()) {
    console.warn('[WhatsApp] Gateway credentials not set — skipping message');
    return;
  }
  if (!phone) {
    console.warn('[WhatsApp] No phone number provided — skipping message');
    return;
  }

  let to = normalisePhone(phone);
  if (!to) {
    console.warn(`[WhatsApp] Unusable phone number "${phone}" — not sending`);
    return;
  }

  // Test mode: every message is diverted to one number, tagged with who it was
  // actually for. This exists so a test run can never message a real employee —
  // the messages tell people their expense was rejected, and an accidental
  // send during testing is not something an apology fixes.
  // Test mode applies ONLY to messages the expense auditor sends to employees.
  // It must never touch the imprest flow: those messages tell approvers a
  // request is waiting and tell employees their money has been paid, and
  // diverting them silently stalls real work and real cash.
  if (divertible && WHATSAPP_TEST_NUMBER) {
    const testTo = normalisePhone(WHATSAPP_TEST_NUMBER);
    if (!testTo) {
      console.warn(`[WhatsApp] TEST MODE set to an unusable number "${WHATSAPP_TEST_NUMBER}" — not sending`);
      return;
    }
    const realTo = to;
    to = testTo;
    message = `🧪 *TEST MODE* — this would have gone to ${realTo}\n\n${message}`;
    console.log(`[WhatsApp] TEST MODE: diverting message for ${realTo} → ${to}`);
  }

  const url = `${WHATSAPP_API_BASE_URL}/${WHATSAPP_PRODUCT_ID}/${WHATSAPP_SESSION_ID}/sendMessage`;

  console.log(`[WhatsApp] Sending to ${to}...`);
  const resp = await axios.post(
    url,
    { to_number: to, type: 'text', message },
    { headers: { 'x-maytapi-key': WHATSAPP_GATEWAY_SECRET, 'Content-Type': 'application/json' }, timeout: 20000 }
  );

  // A 200 with success:false is a silent failure — the message did not go out.
  // Historically this looked like a success in the logs and messages vanished.
  if (resp.data?.success === false) {
    throw new Error(`WhatsApp gateway rejected the message: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }
  console.log(`[WhatsApp] Sent to ${to} — status: ${resp.status}, success: ${resp.data?.success}`);
}

/**
 * Asks an employee to correct their own expense.
 *
 * Sent ONCE per expense and never repeated — a second failed attempt goes to
 * finance instead, because a third automated message teaches nothing that the
 * first two did not. Real volume is roughly 20-35 of these a month.
 *
 * The expense is NOT rejected at this point: it is sitting in the employee's
 * hands, and they fix the original rather than filing a second one.
 */
export async function notifyExpenseNeedsFix({ name, phone, refId, amount, fixHint, deadline }) {
  if (!phone) {
    console.warn(`[WhatsApp] No phone for ${name || 'employee'} — cannot send fix request`);
    return;
  }

  const by = deadline
    ? new Date(deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  // Hinglish — Hindi in Roman script with everyday English words. This is how
  // the site staff who receive these actually message.
  const msg =
    `📸 *Expense Sahi Karna Hai*\n\n` +
    `Hi ${name || 'ji'}, aapka expense abhi accept nahi ho paya.\n\n` +
    `Ref: ${refId}\n` +
    `Amount: Rs.${Number(amount).toLocaleString('en-IN')}\n\n` +
    `*Kya karna hai:* ${fixHint}\n\n` +
    `App kholiye aur *isi expense* ko update kar dijiye — naya expense mat banaiye.` +
    (by ? `\n\n⏰ ${by} tak kar dijiye, warna ye expense reject ho jayega.` : '');

  await sendWhatsApp(phone, msg, { divertible: true });
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
    `❌ *Expense Reject Ho Gaya*\n\n` +
    `Hi ${name || 'ji'}, aapka expense approve nahi ho paya.\n\n` +
    `Ref: ${refId}\n` +
    `Amount: Rs.${Number(amount).toLocaleString('en-IN')}\n` +
    `Category: ${category || '-'}\n\n` +
    `*Reason:* ${reason}\n\n` +
    `Kripya sahi payment screenshot ke saath app se dobara submit kijiye. ` +
    `Jab tak expense accept nahi hota, aapka imprest open rahega aur naya imprest lene mein dikkat aa sakti hai.`;

  await sendWhatsApp(phone, msg, { divertible: true });
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
