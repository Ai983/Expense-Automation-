import api from './api';

export async function getFoodRates() {
  const { data } = await api.get('/api/imprest/food-rates');
  return data.data; // returns array: [{ site, rate }, ...]
}

export async function estimateTravelCost({ from, to, peopleCount }) {
  const { data } = await api.post('/api/imprest/estimate-travel', { from, to, peopleCount });
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
