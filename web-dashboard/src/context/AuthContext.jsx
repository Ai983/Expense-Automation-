import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);     // employee profile from backend
  const [session, setSession] = useState(null); // Supabase session
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore session on mount using stored token — only one fetch on load
    const token = localStorage.getItem('hs_access_token');
    if (token) fetchProfile();
    else setLoading(false);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      // Only re-fetch profile on explicit sign-in, not on token refresh or initial session
      if (event === 'SIGNED_IN') fetchProfile();
      if (event === 'SIGNED_OUT') { setUser(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile() {
    try {
      const { data } = await api.get('/api/auth/me');
      setUser(data.data);
    } catch {
      localStorage.removeItem('hs_access_token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password) {
    const { data } = await api.post('/api/auth/login', { email, password });
    // Store token immediately so the interceptor can use it for subsequent requests
    localStorage.setItem('hs_access_token', data.data.accessToken);
    setUser(data.data.employee);
    return data.data;
  }

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    localStorage.removeItem('hs_access_token');
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
