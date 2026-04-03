import { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/context/AuthContext';

function RouteGuard() {
  const { user, loading, logout } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const loggingOut = useRef(false);

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && user.role !== 'employee' && !loggingOut.current) {
      // Finance/admin logged into wrong app — sign out once, then redirect
      loggingOut.current = true;
      logout().finally(() => { loggingOut.current = false; });
      router.replace('/(auth)/login');
    } else if (user && user.role === 'employee' && inAuthGroup) {
      router.replace('/(app)/submit');
    }
  }, [user, loading, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RouteGuard />
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
