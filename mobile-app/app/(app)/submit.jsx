import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Image, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Picker } from '@react-native-picker/picker';
import { useAuth } from '../../src/context/AuthContext';
import { submitExpense } from '../../src/services/expenseService';
import { SITES, CATEGORIES } from '../../src/constants';

const INITIAL_FORM = { site: SITES[0], amount: '', category: CATEGORIES[0], description: '' };

export default function SubmitExpenseScreen() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [image, setImage] = useState(null); // { uri, mimeType }
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const { user } = useAuth();

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function pickImage(source) {
    const options = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    };

    let pickerResult;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission', 'Camera access is required');
      pickerResult = await ImagePicker.launchCameraAsync(options);
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission', 'Gallery access is required');
      pickerResult = await ImagePicker.launchImageLibraryAsync(options);
    }

    if (!pickerResult.canceled && pickerResult.assets?.[0]) {
      const asset = pickerResult.assets[0];
      setImage({ uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' });
      setResult(null);
    }
  }

  async function handleSubmit() {
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      return Alert.alert('Error', 'Enter a valid amount');
    }
    if (!image) {
      return Alert.alert('Error', 'Upload a payment screenshot');
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await submitExpense({
        site: form.site,
        amount: parseFloat(form.amount),
        category: form.category,
        description: form.description,
        imageUri: image.uri,
        imageMimeType: image.mimeType,
      });
      setResult(res);
      setForm(INITIAL_FORM);
      setImage(null);
    } catch (err) {
      const msg = err.response?.data?.error || 'Submission failed. Check your connection.';
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
        window.alert(`Submission Failed\n\n${msg}`);
      } else {
        Alert.alert('Submission Failed', msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {/* Success result */}
        {result && (
          <View style={[styles.resultCard, { borderColor: result.status === 'blocked' ? '#ef4444' : '#10b981' }]}>
            <Text style={styles.resultTitle}>
              {result.status === 'blocked' ? '🚫 Blocked' : result.status === 'verified' ? '✅ Auto-Verified' : '📋 Submitted for Review'}
            </Text>
            <Text style={styles.resultRef}>Ref: {result.refId}</Text>
            <Text style={styles.resultMsg}>{result.message}</Text>
            {result.confidence > 0 && (
              <Text style={styles.resultConf}>Confidence: {result.confidence}%</Text>
            )}
            {result.duplicateWarnings?.map((w, i) => (
              <Text key={i} style={styles.resultWarn}>⚠ {w}</Text>
            ))}
          </View>
        )}

        {/* Site */}
        <Text style={styles.label}>Site *</Text>
        <View style={styles.pickerWrapper}>
          <Picker selectedValue={form.site} onValueChange={(v) => set('site', v)} style={styles.picker}>
            {SITES.map((s) => <Picker.Item key={s} label={s} value={s} />)}
          </Picker>
        </View>

        {/* Amount */}
        <Text style={styles.label}>Amount (₹) *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 1500"
          placeholderTextColor="#9ca3af"
          value={form.amount}
          onChangeText={(v) => set('amount', v)}
          keyboardType="numeric"
        />

        {/* Category */}
        <Text style={styles.label}>Category *</Text>
        <View style={styles.pickerWrapper}>
          <Picker selectedValue={form.category} onValueChange={(v) => set('category', v)} style={styles.picker}>
            {CATEGORIES.map((c) => <Picker.Item key={c} label={c} value={c} />)}
          </Picker>
        </View>

        {/* Description */}
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          placeholder="Optional details about this expense..."
          placeholderTextColor="#9ca3af"
          value={form.description}
          onChangeText={(v) => set('description', v)}
          multiline
          numberOfLines={3}
        />

        {/* Screenshot */}
        <Text style={styles.label}>Payment Screenshot *</Text>
        {image ? (
          <View style={styles.imagePreview}>
            <Image source={{ uri: image.uri }} style={styles.previewImg} resizeMode="contain" />
            <TouchableOpacity onPress={() => setImage(null)} style={styles.removeImg}>
              <Text style={styles.removeImgText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.imageButtons}>
            <TouchableOpacity style={styles.imgBtn} onPress={() => pickImage('camera')}>
              <Text style={styles.imgBtnText}>📷 Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imgBtn} onPress={() => pickImage('gallery')}>
              <Text style={styles.imgBtnText}>🖼 Gallery</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.submitBtnText}>Verifying & Submitting...</Text>
            </View>
          ) : (
            <Text style={styles.submitBtnText}>Submit Expense</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Logged in as {user?.name} · {user?.site}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  inner: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', backgroundColor: '#fff' },
  textarea: { height: 80, textAlignVertical: 'top' },
  pickerWrapper: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, backgroundColor: '#fff' },
  picker: { height: 50 },
  imageButtons: { flexDirection: 'row', gap: 12 },
  imgBtn: { flex: 1, borderWidth: 2, borderColor: '#e8a24a', borderStyle: 'dashed', borderRadius: 12, paddingVertical: 20, alignItems: 'center' },
  imgBtnText: { color: '#e8a24a', fontWeight: '600', fontSize: 15 },
  imagePreview: { alignItems: 'center' },
  previewImg: { width: '100%', height: 200, borderRadius: 12, marginBottom: 8 },
  removeImg: { backgroundColor: '#fee2e2', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
  removeImgText: { color: '#ef4444', fontWeight: '600', fontSize: 13 },
  submitBtn: { backgroundColor: '#e8a24a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  btnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 16 },
  resultCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 2, padding: 16, marginBottom: 20 },
  resultTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  resultRef: { fontSize: 12, fontFamily: 'monospace', color: '#6b7280', marginBottom: 4 },
  resultMsg: { fontSize: 13, color: '#374151', marginBottom: 4 },
  resultConf: { fontSize: 12, color: '#3b82f6', fontWeight: '600' },
  resultWarn: { fontSize: 12, color: '#f97316', marginTop: 4 },
});
