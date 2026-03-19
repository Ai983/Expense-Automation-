import axios from 'axios';
import { supabase } from '../supabaseClient';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000',
  timeout: 30000,
});

// Attach stored token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hs_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      supabase.auth.signOut();
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
