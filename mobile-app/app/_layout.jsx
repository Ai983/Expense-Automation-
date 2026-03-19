import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { AuthProvider, useAuth } from '../src/context/AuthContext';

function RouteGuard() {
  const { user, loading, logout } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && user.role !== 'employee') {
      // Finance/admin/manager logged into wrong app — sign them out
      logout();
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
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
