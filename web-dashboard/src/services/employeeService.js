import api from './api';

export async function getEmployees() {
  const { data } = await api.get('/api/employees');
  return data.data.employees;
}
