import api from './api';

export async function getMetrics() {
  const { data } = await api.get('/api/dashboard/metrics');
  return data.data;
}

export async function getBySite() {
  const { data } = await api.get('/api/dashboard/by-site');
  return data.data;
}

export async function getByCategory() {
  const { data } = await api.get('/api/dashboard/by-category');
  return data.data;
}

export async function getByStatus() {
  const { data } = await api.get('/api/dashboard/by-status');
  return data.data;
}
