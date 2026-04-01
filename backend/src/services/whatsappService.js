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

  await axios.post(
    url,
    { to_number: to, type: 'text', message },
    { headers: { 'x-maytapi-key': MAYTAPI_API_TOKEN, 'Content-Type': 'application/json' } }
  );
}

/**
 * Sends the imprest approval WhatsApp reminder.
 */
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
