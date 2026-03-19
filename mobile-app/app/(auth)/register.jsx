import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { SITES } from '../../src/constants';

const ENGINEER_NAMES = [
  'Sonu',
  'Ajay Dhiman',
  'Dilip Parashar',
  'Shivam',
  'Dilkhush',
  'Mukul Tyagi',
  'Mohit Sharma',
  'Hari Shankar',
  'Shashank Pandey',
  'Akhil',
  'Shubham',
  'Arvind',
  'Vinay Tyagi',
  'Shiv Tyagi',
  'Praveen Kumar',
  'Rishabh Singh',
  'Sanjeev Kumar Upadhyay',
  'Arman Ali',
  'Vishal Tyagi',
  'Other (type below)',
];

function showAlert(title, message) {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function RegisterScreen() {
  const [selectedName, setSelectedName] = useState(ENGINEER_NAMES[0]);
  const [customName, setCustomName]     = useState('');
  const [form, setForm] = useState({ email: '', phone: '', password: '', site: SITES[0] });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const { register } = useAuth();
  const router = useRouter();

  const isOther   = selectedName === 'Other (type below)';
  const finalName = isOther ? customName.trim() : selectedName;

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
  }

  async function handleRegister() {
    if (!finalName || !form.email || !form.password || !form.site) {
      setError('All fields are required');
      return showAlert('Error', 'All fields are required');
    }
    if (isOther && finalName.length < 2) {
      setError('Please enter your full name');
      return showAlert('Error', 'Please enter your full name');
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return showAlert('Error', 'Password must be at least 6 characters');
    }
    setLoading(true);
    setError('');
    try {
      await register({
        name: finalName,
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || undefined,
        password: form.password,
        site: form.site,
      });
      router.replace('/(app)/submit');
    } catch (err) {
      const msg = err.response?.data?.error
        || (err.code === 'ECONNABORTED' || err.message?.includes('timeout')
          ? 'Connection timed out. Check your internet connection.'
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
          {/* Name dropdown */}
          <Text style={styles.label}>Full Name *</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={selectedName}
              onValueChange={(v) => { setSelectedName(v); setCustomName(''); setError(''); }}
              style={styles.picker}
            >
              {ENGINEER_NAMES.map((n) => (
                <Picker.Item key={n} label={n} value={n} />
              ))}
            </Picker>
          </View>

          {/* Custom name input — shown only when "Other" is selected */}
          {isOther && (
            <TextInput
              style={[styles.input, styles.customNameInput]}
              placeholder="Type your full name..."
              placeholderTextColor="#9ca3af"
              value={customName}
              onChangeText={(v) => { setCustomName(v); setError(''); }}
              autoCapitalize="words"
              autoFocus
            />
          )}

          {/* Email */}
          <Text style={styles.label}>Email *</Text>
          <TextInput
            style={styles.input}
            placeholder="raj@hagerstone.com"
            placeholderTextColor="#9ca3af"
            value={form.email}
            onChangeText={(v) => set('email', v)}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          {/* Phone */}
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="+91-9000000000"
            placeholderTextColor="#9ca3af"
            value={form.phone}
            onChangeText={(v) => set('phone', v)}
            keyboardType="phone-pad"
          />

          {/* Password */}
          <Text style={styles.label}>Password (min 6 chars) *</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor="#9ca3af"
            value={form.password}
            onChangeText={(v) => set('password', v)}
            secureTextEntry
          />

          {/* Site */}
          <Text style={styles.label}>Site *</Text>
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
  customNameInput: { marginTop: 8, borderColor: '#e8a24a', borderWidth: 2, backgroundColor: '#fffbf5' },
  pickerWrapper: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, backgroundColor: '#fafafa', marginBottom: 4 },
  picker: { height: 48 },
  errorText: { color: '#dc2626', fontSize: 13, marginTop: 12, textAlign: 'center' },
  btn: { backgroundColor: '#e8a24a', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { alignItems: 'center', marginTop: 16 },
  linkText: { color: '#e8a24a', fontSize: 14, fontWeight: '500' },
});
