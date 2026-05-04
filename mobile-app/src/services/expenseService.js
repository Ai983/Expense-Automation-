import { Platform } from 'react-native';
import api from './api';

/**
 * Submits an expense with one or more payment screenshots.
 * `images` is an array of { uri, mimeType, name? } objects.
 * Also supports legacy single-image via imageUri/imageMimeType.
 */
export async function submitExpense({ site, amount, category, description, images, imageUri, imageMimeType, imprestId }) {
  const formData = new FormData();
  formData.append('site', site);
  formData.append('amount', String(amount));
  formData.append('category', category);
  if (description) formData.append('description', description);
  if (imprestId) formData.append('imprestId', imprestId);

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
