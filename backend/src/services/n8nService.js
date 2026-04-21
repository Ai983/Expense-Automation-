/**
 * Triggers n8n webhooks for imprest submission confirmation (WF1)
 * and founder/director approval requests (WF2).
 *
 * Configure these env vars:
 *   N8N_WEBHOOK_SUBMISSION  — WF1 webhook URL (imprest-submission)
 *   N8N_WEBHOOK_FOUNDER     — WF2 webhook URL (imprest-founder-approval)
 *   FOUNDER_PHONE           — Dhruv Sir phone number (e.g. 919XXXXXXXXX)
 *   DIRECTOR_PHONE          — Bhaskar Sir phone number (e.g. 919XXXXXXXXX)
 */

const SUBMISSION_URL = process.env.N8N_WEBHOOK_SUBMISSION;
const FOUNDER_URL = process.env.N8N_WEBHOOK_FOUNDER;
const FOUNDER_PHONE = process.env.FOUNDER_PHONE || '';
const DIRECTOR_PHONE = process.env.DIRECTOR_PHONE || '';

async function postJSON(url, body) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    console.warn(`n8n webhook failed (${url}):`, err.message);
    return null;
  }
}

/**
 * WF1 — Send imprest submission confirmation to employee via WhatsApp.
 */
export async function triggerSubmissionConfirmation({
  employeeName, phone, refId, amount, category, site, purpose,
}) {
  return postJSON(SUBMISSION_URL, {
    employeeName,
    phone,
    refId,
    amount,
    category,
    site,
    purpose: purpose || '',
  });
}

/**
 * WF2 — Send founder/director approval request via WhatsApp (amount >= 5000).
 */
export async function triggerFounderApproval({
  imprestId, refId, requestedTo, employeeName, employeeSite,
  amount, category, purpose, oldBalance, submittedAt,
}) {
  return postJSON(FOUNDER_URL, {
    imprestId,
    refId,
    requestedTo,
    founderPhone: FOUNDER_PHONE,
    directorPhone: DIRECTOR_PHONE,
    employeeName,
    employeeSite,
    amount,
    category,
    purpose: purpose || '',
    oldBalance: oldBalance || 0,
    submittedAt,
  });
}
