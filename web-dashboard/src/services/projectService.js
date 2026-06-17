import api from './api';

// Canonical active site list from the unified master (public.projects via backend).
export async function getSites() {
  const { data } = await api.get('/api/projects');
  return data.data; // string[]
}
