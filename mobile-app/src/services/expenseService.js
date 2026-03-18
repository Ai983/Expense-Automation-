import { Platform } from 'react-native';
import api from './api';

/**
 * Submits an expense with a payment screenshot image.
 * imageUri is the local file URI from expo-image-picker (or blob/data URL on web).
 */
export async function submitExpense({ site, amount, category, description, imageUri, imageMimeType }) {
  const formData = new FormData();
  formData.append('site', site);
  formData.append('amount', String(amount));
  formData.append('category', category);
  if (description) formData.append('description', description);

  const mimeType = imageMimeType || 'image/jpeg';
  const ext = mimeType.split('/').pop() || 'jpg';
  const filename = `screenshot.${ext}`;

  if (Platform.OS === 'web') {
    // On web, FormData must receive a real File/Blob; { uri, name, type } is not sent as a file.
    const blob = await (await fetch(imageUri)).blob();
    const file = new File([blob], filename, { type: mimeType });
    formData.append('screenshot', file);
  } else {
    // React Native: FormData accepts { uri, name, type } and the native layer sends the file.
    formData.append('screenshot', {
      uri: imageUri,
      name: filename,
      type: mimeType,
    });
  }

  // Do not set Content-Type; axios adds multipart/form-data with boundary automatically.
  const { data } = await api.post('/api/expenses/submit', formData, {
    timeout: 60000, // longer timeout for image upload + OCR
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
