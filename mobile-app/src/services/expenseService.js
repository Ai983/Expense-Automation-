import { Platform } from 'react-native';
import api from './api';

/**
 * Submits an expense with one or more payment screenshots.
 * `images` is an array of { uri, mimeType, name? } objects.
 * Also supports legacy single-image via imageUri/imageMimeType.
 */
export async function submitExpense({ site, amount, category, description, images, imageUri, imageMimeType, imprestId, settlementForExpenseId }) {
  const formData = new FormData();
  formData.append('site', site);
  formData.append('amount', String(amount));
  formData.append('category', category);
  if (description) formData.append('description', description);
  if (imprestId) formData.append('imprestId', imprestId);
  if (settlementForExpenseId) formData.append('settlementForExpenseId', settlementForExpenseId);

  // Normalize to array: support both new `images` array and legacy single image
  const imageList = images?.length ? images : (imageUri ? [{ uri: imageUri, mimeType: imageMimeType || 'image/jpeg' }] : []);

  for (let i = 0; i < imageList.length; i++) {
    const img = imageList[i];
    const mimeType = img.mimeType || 'image/jpeg';
    const ext = mimeType.split('/').pop() || 'jpg';
    const filename = imageList.length > 1 ? `screenshot-${i + 1}.${ext}` : `screenshot.${ext}`;

    if (Platform.OS === 'web') {
      const blob = await (await fetch(img.uri)).blob();
      const file = new File([blob], filename, { type: mimeType });
      formData.append('screenshots', file);
    } else {
      formData.append('screenshots', {
        uri: img.uri,
        name: filename,
        type: mimeType,
      });
    }
  }

  // Longer timeout for multi-image upload + OCR
  const { data } = await api.post('/api/expenses/submit', formData, {
    timeout: 120000,
  });

  return data.data;
}

/**
 * Replaces the receipt on an expense the auditor handed back for correction.
 *
 * This updates the SAME expense — it does not create a new one. Filing a second
 * expense instead leaves the bad row in the finance queue, trips a false
 * duplicate flag on the corrected one, and double-counts the imprest balance.
 */
export async function fixExpense(expenseId, images) {
  const formData = new FormData();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const mimeType = img.mimeType || 'image/jpeg';
    const ext = mimeType.split('/').pop() || 'jpg';
    const filename = images.length > 1 ? `fix-${i + 1}.${ext}` : `fix.${ext}`;

    if (Platform.OS === 'web') {
      const blob = await (await fetch(img.uri)).blob();
      formData.append('screenshots', new File([blob], filename, { type: mimeType }));
    } else {
      formData.append('screenshots', { uri: img.uri, name: filename, type: mimeType });
    }
  }

  const { data } = await api.post(`/api/expenses/${expenseId}/fix`, formData, { timeout: 120000 });
  return data.data;
}

/**
 * Polls for the AI auditor's employee-facing hint after a submission.
 *
 * The audit runs in the background and finishes a few seconds after submit. If
 * it spots something the employee can fix themselves — a blurry screenshot, a
 * bill instead of a payment confirmation — we want to tell them while they still
 * have the receipt to hand, rather than days later.
 *
 * Resolves to null if the audit is not ready in time, or is unavailable. This is
 * a convenience, never a blocker: the expense is already safely submitted.
 */
export async function waitForAuditHint(expenseId, { attempts = 8, intervalMs = 4000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const { data } = await api.get(`/api/expenses/${expenseId}/audit-status`, { timeout: 10000 });
      const result = data.data;
      if (result?.audited) return result.fixHint || null;
    } catch {
      return null; // offline, or auditing disabled — stay silent
    }
  }
  return null;
}

/**
 * Fetches all expenses for the current employee.
 */
export async function getMyExpenses(employeeId, page = 1) {
  const { data } = await api.get(`/api/expenses/my-expenses/${employeeId}`, {
    params: { page, limit: 20 },
  });
  return data.data;
}

/**
 * Fetches expenses where finance reduced the approved amount.
 * Employee must resubmit proof for the remaining gap.
 */
export async function getMyAdjustments(employeeId) {
  const { data } = await api.get(`/api/expenses/my-adjustments/${employeeId}`);
  return data.data;
}
