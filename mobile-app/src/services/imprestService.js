import { Platform } from 'react-native';
import api from './api';

export async function getFoodRates() {
  const { data } = await api.get('/api/imprest/food-rates');
  return data.data;
}

export async function estimateTravelCost({ from, to, peopleCount, mode, travelDate, vehicleType }) {
  const { data } = await api.post('/api/imprest/estimate-travel', {
    from, to, peopleCount, mode, travelDate, vehicleType,
  });
  return data.data;
}

/**
 * Uploads a ride-hailing screenshot for Claude OCR and returns { amount, confidence }.
 */
export async function scanConveyanceReceipt(imageUri, mimeType = 'image/jpeg') {
  const formData = new FormData();
  const ext = mimeType.split('/').pop() || 'jpg';
  const filename = `receipt.${ext}`;

  if (Platform.OS === 'web') {
    const blob = await (await fetch(imageUri)).blob();
    const file = new File([blob], filename, { type: mimeType });
    formData.append('screenshot', file);
  } else {
    formData.append('screenshot', { uri: imageUri, name: filename, type: mimeType });
  }

  const { data } = await api.post('/api/imprest/scan-conveyance', formData, { timeout: 30000 });
  return data.data;
}

export async function submitImprest(payload) {
  const { data } = await api.post('/api/imprest/submit', payload, { timeout: 30000 });
  return data.data;
}

export async function getMyImprestRequests(employeeId, page = 1) {
  const { data } = await api.get(`/api/imprest/my-requests/${employeeId}`, {
    params: { page, limit: 20 },
  });
  return data.data;
}

export async function getMyReminders(employeeId) {
  const { data } = await api.get(`/api/imprest/my-reminders/${employeeId}`);
  return data.data;
}

export async function fulfillReminder(reminderId) {
  await api.post(`/api/imprest/reminders/${reminderId}/fulfill`);
}
