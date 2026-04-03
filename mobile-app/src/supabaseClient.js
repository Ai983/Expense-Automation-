import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

// expo-secure-store is native-only (iOS/Android). On web it has no implementation, so use localStorage.
const getStorage = () => {
  if (Platform.OS === 'web') {
    return {
      getItem: (key) => Promise.resolve(typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null),
      setItem: (key, value) => Promise.resolve(localStorage?.setItem(key, value)),
      removeItem: (key) => Promise.resolve(localStorage?.removeItem(key)),
    };
  }
  // Native: use expo-secure-store (required only on native to avoid web "getValueWithKeyAsync is not a function")
  const SecureStore = require('expo-secure-store');
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  };
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: getStorage(),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
