import api from './api';

export async function getKanban() {
  const res = await api.get('/api/head/kanban');
  return res.data?.data || { imprests: [], expenses: [], pos: [] };
}

export async function getOverview() {
  const res = await api.get('/api/head/overview');
  return res.data?.data || {};
}
