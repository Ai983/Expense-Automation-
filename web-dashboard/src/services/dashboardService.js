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

export async function getByEmployee({ site, from, to } = {}) {
  const params = new URLSearchParams();
  if (site) params.append('site', site);
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  const { data } = await api.get(`/api/dashboard/by-employee?${params.toString()}`);
  return data.data;
}
