import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);     // employee profile from backend
  const [session, setSession] = useState(null); // Supabase session
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore session on mount using stored token
    const token = localStorage.getItem('hs_access_token');
    if (token) fetchProfile();
    else setLoading(false);

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile();
      else { setUser(null); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile() {
    try {
      const { data } = await api.get('/api/auth/me');
      setUser(data.data);
    } catch {
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
