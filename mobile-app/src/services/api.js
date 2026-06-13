import axios from 'axios';
import { supabase } from '../supabaseClient';
import { API_BASE_URL } from '../constants';

const api = axios.create({
  baseURL: API_BASE_URL,
  // Site/field connections are frequently slow or congested (single-digit KB/s
  // on "full bars"). Give a marginal link enough time to complete the small
  // login payload before giving up. (Was 30s.)
  timeout: 60000,
});

api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

// Retry ONLY transient connectivity failures — i.e. no server response at all
// (request timed out, network dropped mid-flight, or the Railway backend was
// cold-starting). A real server response (401/403/404/5xx) is NEVER retried:
// a 401 is a genuine bad credential, not something to hammer. Up to 2 retries
// with a short backoff is what gets a login through on a flaky site link.
const MAX_RETRIES = 2;
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const transient =
      !error.response &&
      (error.code === 'ECONNABORTED' ||
        error.code === 'ERR_NETWORK' ||
        /timeout|network/i.test(error.message || ''));
    if (!config || !transient) return Promise.reject(error);

    config.__retryCount = (config.__retryCount || 0) + 1;
    if (config.__retryCount > MAX_RETRIES) return Promise.reject(error);
    await new Promise((resolve) => setTimeout(resolve, 1500 * config.__retryCount));
    return api(config);
  }
);

export default api;
