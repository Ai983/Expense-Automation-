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

// ── Imprest Analytics ────────────────────────────────────────────────────────

export async function getImprestMetrics() {
  const { data } = await api.get('/api/dashboard/imprest/metrics');
  return data.data;
}

export async function getImprestBySite() {
  const { data } = await api.get('/api/dashboard/imprest/by-site');
  return data.data;
}

export async function getImprestByCategory() {
  const { data } = await api.get('/api/dashboard/imprest/by-category');
  return data.data;
}

export async function getImprestByStatus() {
  const { data } = await api.get('/api/dashboard/imprest/by-status');
  return data.data;
}

export async function getImprestBalance() {
  const { data } = await api.get('/api/dashboard/imprest/balance');
  return data.data;
}

export async function getEmployeeImprestBalance() {
  const { data } = await api.get('/api/dashboard/imprest/employee-balance');
  return data.data;
}

// ── Drill-down details ──────────────────────────────────────────────────────

export async function getSiteDetails(site) {
  const { data } = await api.get(`/api/dashboard/by-site/${encodeURIComponent(site)}/details`);
  return data.data;
}

export async function getCategoryDetails(category) {
  const { data } = await api.get(`/api/dashboard/by-category/${encodeURIComponent(category)}/details`);
  return data.data;
}

export async function getImprestSiteDetails(site) {
  const { data } = await api.get(`/api/dashboard/imprest/by-site/${encodeURIComponent(site)}/details`);
  return data.data;
}

export async function getImprestCategoryDetails(category) {
  const { data } = await api.get(`/api/dashboard/imprest/by-category/${encodeURIComponent(category)}/details`);
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
