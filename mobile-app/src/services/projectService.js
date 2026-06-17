import api from './api';

// Canonical active site list from the unified master (public.projects via the
// backend /api/projects). Throws on any failure so callers can fall back to the
// bundled SITES constant (e.g. offline, or the pre-login register screen).
export async function getProjectSites() {
  const res = await api.get('/api/projects');
  const data = res?.data?.data ?? res?.data;
  if (!Array.isArray(data)) throw new Error('Unexpected /api/projects response');
  return data;
}