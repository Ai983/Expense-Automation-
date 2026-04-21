import api from './api';

export async function getExpenseQueue({ status = 'all', site = 'all', employeeId = 'all', dateFrom, dateTo, page = 1, limit = 50 } = {}) {
  const params = { status, site, employeeId, page, limit };
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;
  const { data } = await api.get('/api/expenses/finance/queue', { params });
  return data.data;
}

export async function getExpenseDetails(expenseId) {
  const { data } = await api.get(`/api/expenses/${expenseId}/details`);
  return data.data;
}

export async function approveExpense(expenseId, adjustedAmount) {
  const body = adjustedAmount != null ? { adjustedAmount } : {};
  const { data } = await api.post(`/api/expenses/${expenseId}/approve`, body);
  return data.data;
}

export async function rejectExpense(expenseId, reason) {
  const { data } = await api.post(`/api/expenses/${expenseId}/reject`, { reason });
  return data.data;
}

export async function bulkApprove(expenseIds) {
  const { data } = await api.post('/api/expenses/bulk-approve', { expenseIds });
  return data.data;
}
