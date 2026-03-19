import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { SITES } from '../../src/constants';

// On web, Alert.alert often doesn't show; use window.alert so user always sees feedback
function showAlert(title, message) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function RegisterScreen() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', site: SITES[0] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const router = useRouter();

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
  }

  async function handleRegister() {
    if (!form.name || !form.email || !form.password || !form.site) {
      setError('All fields are required');
      return showAlert('Error', 'All fields are required');
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return showAlert('Error', 'Password must be at least 6 characters');
    }
    setLoading(true);
    setError('');
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        password: form.password,
        site: form.site,
      });
      router.replace('/(app)/submit');
    } catch (err) {
      const msg = err.response?.data?.error
        || (err.code === 'ECONNABORTED' || err.message?.includes('timeout')
          ? 'Connection timed out. Is the backend running? (npm run dev in backend folder, port 4000)'
          : err.message || 'Please try again');
      setError(msg);
      showAlert('Registration Failed', msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Site Engineer Registration</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>Role: Site Engineer</Text>
          </View>
        </View>

        <View style={styles.form}>
          {[
            { key: 'name', label: 'Full Name', placeholder: 'Raj Kumar', autoCapitalize: 'words' },
            { key: 'email', label: 'Email', placeholder: 'raj@hagerstone.com', keyboard: 'email-address', autoCapitalize: 'none' },
            { key: 'phone', label: 'Phone (optional)', placeholder: '+91-9000000000', keyboard: 'phone-pad' },
            { key: 'password', label: 'Password (min 6 chars)', placeholder: '••••••••', secure: true },
          ].map(({ key, label, placeholder, keyboard, autoCapitalize, secure }) => (
            <View key={key}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                style={styles.input}
                placeholder={placeholder}
                placeholderTextColor="#9ca3af"
                value={form[key]}
                onChangeText={(v) => set(key, v)}
                keyboardType={keyboard || 'default'}
                autoCapitalize={autoCapitalize || 'none'}
                secureTextEntry={secure}
              />
            </View>
          ))}

          <Text style={styles.label}>Site</Text>
          <View style={styles.pickerWrapper}>
            <Picker selectedValue={form.site} onValueChange={(v) => set('site', v)} style={styles.picker}>
              {SITES.map((s) => <Picker.Item key={s} label={s} value={s} />)}
            </Picker>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            <Text style={styles.btnText}>{loading ? 'Creating account...' : 'Create Account'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.back()} style={styles.link}>
            <Text style={styles.linkText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  inner: { flexGrow: 1, padding: 24 },
  header: { alignItems: 'center', marginBottom: 28, marginTop: 40 },
  roleBadge: { backgroundColor: '#fef3c7', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4, marginTop: 8, borderWidth: 1, borderColor: '#f59e0b' },
  roleBadgeText: { color: '#92400e', fontWeight: '600', fontSize: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  form: { backgroundColor: '#fff', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', backgroundColor: '#fafafa' },
  pickerWrapper: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, backgroundColor: '#fafafa', marginBottom: 4 },
  picker: { height: 48 },
  errorText: { color: '#dc2626', fontSize: 13, marginTop: 12, textAlign: 'center' },
  btn: { backgroundColor: '#e8a24a', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { alignItems: 'center', marginTop: 16 },
  linkText: { color: '#e8a24a', fontSize: 14, fontWeight: '500' },
});
