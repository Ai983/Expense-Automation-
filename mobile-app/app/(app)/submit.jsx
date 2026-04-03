import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Image, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Picker } from '@react-native-picker/picker';
import { useAuth } from '../../src/context/AuthContext';
import { submitExpense } from '../../src/services/expenseService';
import { getMyReminders, fulfillReminder } from '../../src/services/imprestService';
import { SITES, CATEGORIES, IMPREST_TO_EXPENSE_CATEGORY } from '../../src/constants';

const INITIAL_FORM = { site: SITES[0], amount: '', category: CATEGORIES[0], description: '' };

export default function SubmitExpenseScreen() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [activeReminderId, setActiveReminderId] = useState(null); // reminder being fulfilled
  const [activeImprestId, setActiveImprestId] = useState(null); // linked imprest id
  const [imprestApprovedAmount, setImprestApprovedAmount] = useState(null); // for showing balance info
  const { user } = useAuth();

  const fetchReminders = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getMyReminders(user.id);
      setReminders(res.reminders || []);
    } catch { /* silently ignore */ }
  }, [user]);

  useEffect(() => { fetchReminders(); }, [fetchReminders]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function applyReminder(reminder) {
    const imp = reminder.imprest;
    const approvedAmt = parseFloat(imp?.approved_amount || imp?.amount_requested || 0);
    const previouslyFulfilled = parseFloat(reminder.fulfilled_amount || 0);
    const remainingBalance = Math.max(0, approvedAmt - previouslyFulfilled);
    const site = imp?.site && SITES.includes(imp.site) ? imp.site : SITES[0];
    const mappedCategory = IMPREST_TO_EXPENSE_CATEGORY[imp?.category] || null;
    const category = mappedCategory && CATEGORIES.includes(mappedCategory) ? mappedCategory : (imp?.category && CATEGORIES.includes(imp.category) ? imp.category : CATEGORIES[0]);

    setForm({
      site,
      amount: remainingBalance > 0 ? String(remainingBalance) : (approvedAmt ? String(approvedAmt) : ''),
      category,
      description: `Expense for imprest ${imp?.ref_id || ''}`,
    });
    setActiveReminderId(reminder.id);
    setActiveImprestId(imp?.id || null);
    setImprestApprovedAmount(approvedAmt);
    setImage(null);
    setResult(null);
  }

  async function pickPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setImage({ uri: asset.uri, mimeType: 'application/pdf', name: asset.name });
        setResult(null);
      }
    } catch {
      Alert.alert('Error', 'Could not open document picker');
    }
  }

  async function pickImage(source) {
    const options = {
      mediaTypes: ['images'],
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
      return Alert.alert('Error', 'Upload a payment screenshot or PDF');
    }

    setLoading(true);
    setResult(null);

    try {
      const expenseAmount = parseFloat(form.amount);
      const res = await submitExpense({
        site: form.site,
        amount: expenseAmount,
        category: form.category,
        description: form.description,
        imageUri: image.uri,
        imageMimeType: image.mimeType,
        imprestId: activeImprestId || undefined,
      });
      setResult(res);
      setForm(INITIAL_FORM);
      setImage(null);

      // Mark the linked reminder as fulfilled (or partially fulfilled)
      if (activeReminderId) {
        try { await fulfillReminder(activeReminderId, expenseAmount); } catch { /* ignore */ }
        setActiveReminderId(null);
        setActiveImprestId(null);
        setImprestApprovedAmount(null);
        fetchReminders(); // refresh reminder list
      }
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

        {/* ── Imprest Reminders ────────────────────────────────────── */}
        {reminders.length > 0 && (
          <View style={styles.remindersSection}>
            <Text style={styles.remindersTitle}>⏰ Pending Imprest Expenses</Text>
            <Text style={styles.remindersSubtitle}>
              Tap a card to fill the expense for that imprest
            </Text>
            {reminders.map((r) => {
              const imp = r.imprest;
              const deadline = new Date(r.deadline);
              const msLeft = deadline - Date.now();
              const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
              const daysLeft = Math.floor(hoursLeft / 24);
              const isActive = activeReminderId === r.id;
              const approvedAmt = parseFloat(imp?.approved_amount || imp?.amount_requested || 0);
              const fulfilledAmt = parseFloat(r.fulfilled_amount || 0);
              const remainingBal = Math.max(0, approvedAmt - fulfilledAmt);
              const hasPartialExpense = fulfilledAmt > 0;

              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.reminderCard, isActive && styles.reminderCardActive]}
                  onPress={() => applyReminder(r)}
                  activeOpacity={0.8}
                >
                  <View style={styles.reminderRow}>
                    <Text style={styles.reminderRef}>{imp?.ref_id}</Text>
                    <View style={[styles.reminderBadge, hoursLeft < 24 && styles.reminderBadgeUrgent]}>
                      <Text style={[styles.reminderBadgeText, hoursLeft < 24 && styles.reminderBadgeTextUrgent]}>
                        {daysLeft > 0 ? `${daysLeft}d left` : hoursLeft > 0 ? `${hoursLeft}h left` : 'Due today'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.reminderDetail}>
                    {imp?.category} · {imp?.site}
                  </Text>
                  <Text style={styles.reminderAmount}>
                    Approved: ₹{approvedAmt.toLocaleString('en-IN')}
                  </Text>
                  {hasPartialExpense && (
                    <View style={styles.balanceRow}>
                      <Text style={styles.balanceFulfilled}>
                        Submitted: ₹{fulfilledAmt.toLocaleString('en-IN')}
                      </Text>
                      <Text style={styles.balanceRemaining}>
                        Balance: ₹{remainingBal.toLocaleString('en-IN')}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.reminderDeadline}>
                    Submit by {deadline.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {hasPartialExpense ? ' · You can submit remaining amount' : ''}
                  </Text>
                  {isActive && (
                    <Text style={styles.reminderActive}>✓ Form pre-filled — add screenshot & submit</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── Success result ───────────────────────────────────────── */}
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

        {/* ── Form ─────────────────────────────────────────────────── */}
        {activeReminderId && (
          <View style={styles.prefilledBanner}>
            <Text style={styles.prefilledText}>
              Form pre-filled from imprest · You can submit partial or full amount
            </Text>
            <TouchableOpacity onPress={() => { setActiveReminderId(null); setActiveImprestId(null); setImprestApprovedAmount(null); setForm(INITIAL_FORM); }}>
              <Text style={styles.prefilledClear}>Clear</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>Site *</Text>
        <View style={styles.pickerWrapper}>
          <Picker selectedValue={form.site} onValueChange={(v) => set('site', v)} style={styles.picker}>
            {SITES.map((s) => <Picker.Item key={s} label={s} value={s} />)}
          </Picker>
        </View>

        <Text style={styles.label}>Amount (₹) *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. 1500"
          placeholderTextColor="#9ca3af"
          value={form.amount}
          onChangeText={(v) => set('amount', v)}
          keyboardType="numeric"
        />

        <Text style={styles.label}>Category *</Text>
        <View style={styles.pickerWrapper}>
          <Picker selectedValue={form.category} onValueChange={(v) => set('category', v)} style={styles.picker}>
            {CATEGORIES.map((c) => <Picker.Item key={c} label={c} value={c} />)}
          </Picker>
        </View>

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

        <Text style={styles.label}>Payment Proof *</Text>
        {image ? (
          <View style={styles.imagePreview}>
            {image.mimeType === 'application/pdf' ? (
              <View style={styles.pdfPreview}>
                <Text style={styles.pdfIcon}>📄</Text>
                <Text style={styles.pdfName} numberOfLines={2}>{image.name || 'document.pdf'}</Text>
                <Text style={styles.pdfNote}>PDF will be parsed by AI to extract amount</Text>
              </View>
            ) : (
              <Image source={{ uri: image.uri }} style={styles.previewImg} resizeMode="contain" />
            )}
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
            <TouchableOpacity style={styles.imgBtn} onPress={pickPdf}>
              <Text style={styles.imgBtnText}>📄 PDF</Text>
            </TouchableOpacity>
          </View>
        )}

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
  pdfPreview: { width: '100%', backgroundColor: '#eff6ff', borderWidth: 1.5, borderColor: '#93c5fd', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 8 },
  pdfIcon: { fontSize: 36, marginBottom: 6 },
  pdfName: { fontSize: 14, fontWeight: '600', color: '#1d4ed8', textAlign: 'center', marginBottom: 4 },
  pdfNote: { fontSize: 11, color: '#3b82f6', textAlign: 'center' },
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

  // Reminders
  remindersSection: { marginBottom: 20 },
  remindersTitle: { fontSize: 15, fontWeight: '700', color: '#92400e', marginBottom: 2 },
  remindersSubtitle: { fontSize: 12, color: '#78716c', marginBottom: 10 },
  reminderCard: {
    backgroundColor: '#fffbeb', borderWidth: 1.5, borderColor: '#fbbf24',
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  reminderCardActive: {
    borderColor: '#e8a24a', backgroundColor: '#fff7ed', borderWidth: 2,
  },
  reminderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reminderRef: { fontSize: 13, fontWeight: '700', color: '#e8a24a', fontFamily: 'monospace' },
  reminderBadge: { backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  reminderBadgeUrgent: { backgroundColor: '#fee2e2' },
  reminderBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400e' },
  reminderBadgeTextUrgent: { color: '#dc2626' },
  reminderDetail: { fontSize: 13, color: '#374151', marginBottom: 2 },
  reminderAmount: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 2 },
  reminderDeadline: { fontSize: 11, color: '#6b7280' },
  reminderActive: { fontSize: 12, color: '#16a34a', fontWeight: '600', marginTop: 6 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, marginBottom: 2 },
  balanceFulfilled: { fontSize: 12, color: '#16a34a', fontWeight: '600' },
  balanceRemaining: { fontSize: 12, color: '#dc2626', fontWeight: '700' },

  // Pre-filled banner
  prefilledBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 4, marginBottom: 4,
  },
  prefilledText: { fontSize: 12, color: '#15803d', flex: 1 },
  prefilledClear: { fontSize: 12, color: '#dc2626', fontWeight: '600', marginLeft: 8 },
});
