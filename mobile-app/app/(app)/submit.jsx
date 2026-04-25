import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Image, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../../src/context/AuthContext';
import { submitExpense } from '../../src/services/expenseService';
import { getMyReminders, fulfillReminder } from '../../src/services/imprestService';
import { SITES, CATEGORIES, IMPREST_TO_EXPENSE_CATEGORY } from '../../src/constants';

const INITIAL_FORM = { site: SITES[0], amount: '', category: CATEGORIES[0], description: '' };

export default function SubmitExpenseScreen() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [loadingReminders, setLoadingReminders] = useState(true);
  const [activeReminderId, setActiveReminderId] = useState(null);
  const [activeImprestId, setActiveImprestId] = useState(null);
  const [imprestApprovedAmount, setImprestApprovedAmount] = useState(null);
  const [imprestRemainingBalance, setImprestRemainingBalance] = useState(null);
  const { user } = useAuth();

  const fetchReminders = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getMyReminders(user.id);
      setReminders(res.reminders || []);
    } catch { /* silently ignore */ }
    finally { setLoadingReminders(false); }
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
    const category = mappedCategory && CATEGORIES.includes(mappedCategory)
      ? mappedCategory
      : (imp?.category && CATEGORIES.includes(imp.category) ? imp.category : CATEGORIES[0]);

    setForm({
      site,
      amount: remainingBalance > 0 ? String(remainingBalance) : (approvedAmt ? String(approvedAmt) : ''),
      category,
      description: `Expense for imprest ${imp?.ref_id || ''}`,
    });
    setActiveReminderId(reminder.id);
    setActiveImprestId(imp?.id || null);
    setImprestApprovedAmount(approvedAmt);
    setImprestRemainingBalance(remainingBalance > 0 ? remainingBalance : approvedAmt);
    setImages([]);
    setResult(null);
  }

  function clearImprest() {
    setActiveReminderId(null);
    setActiveImprestId(null);
    setImprestApprovedAmount(null);
    setImprestRemainingBalance(null);
    setForm(INITIAL_FORM);
    setImages([]);
  }

  async function pickPdf() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        setImages((prev) => [...prev, { uri: asset.uri, mimeType: 'application/pdf', name: asset.name }]);
        setResult(null);
      }
    } catch {
      Alert.alert('Error', 'Could not open document picker');
    }
  }

  async function pickImage(source) {
    const options = { mediaTypes: ['images'], quality: 0.85, allowsEditing: false };
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
      setImages((prev) => [...prev, { uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' }]);
      setResult(null);
    }
  }

  function removeImage(index) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!activeImprestId) {
      return Alert.alert('Imprest Required', 'Please select a pending Imprest Request above before submitting an expense.');
    }
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      return Alert.alert('Error', 'Enter a valid amount');
    }
    if (imprestRemainingBalance !== null && parseFloat(form.amount) > imprestRemainingBalance + 1) {
      return Alert.alert(
        'Amount Too High',
        `The expense amount (₹${parseFloat(form.amount).toLocaleString('en-IN')}) exceeds the remaining imprest balance of ₹${imprestRemainingBalance.toLocaleString('en-IN')}.`
      );
    }
    if (images.length === 0) {
      return Alert.alert('Error', 'Upload at least one payment screenshot or PDF');
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
        images,
        imprestId: activeImprestId,
      });
      setResult(res);
      setImages([]);

      if (activeReminderId) {
        try { await fulfillReminder(activeReminderId, expenseAmount); } catch { /* ignore */ }
      }
      clearImprest();
      fetchReminders();
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

        {/* ── Step 1: Imprest Selection ─────────────────────────────── */}
        <View style={styles.stepHeader}>
          <View style={[styles.stepBadge, activeImprestId && styles.stepBadgeDone]}>
            <Text style={styles.stepBadgeText}>{activeImprestId ? '✓' : '1'}</Text>
          </View>
          <Text style={styles.stepTitle}>Select Imprest Request</Text>
        </View>

        {loadingReminders ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#e8a24a" />
            <Text style={styles.loadingText}>Loading your pending imprests...</Text>
          </View>
        ) : reminders.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>📋</Text>
            <Text style={styles.emptyStateTitle}>No Pending Imprests</Text>
            <Text style={styles.emptyStateText}>
              You must raise an Imprest Request and have it approved before you can submit an expense.
            </Text>
            <Text style={styles.emptyStateHint}>
              Go to the "Request Imprest" tab to raise one.
            </Text>
          </View>
        ) : (
          <>
            {!activeImprestId && (
              <Text style={styles.remindersSubtitle}>
                Tap a card below to select the imprest you are submitting this expense against.
              </Text>
            )}
            {reminders.map((r) => {
              const imp = r.imprest;
              const deadline = new Date(r.deadline);
              const msLeft = deadline - Date.now();
              const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
              const daysLeft = Math.floor(hoursLeft / 24);
              const isActive = activeReminderId === r.id;
              const isExpired = r.status === 'expired' || msLeft < 0;
              const approvedAmt = parseFloat(imp?.approved_amount || imp?.amount_requested || 0);
              const fulfilledAmt = parseFloat(r.fulfilled_amount || 0);
              const remainingBal = Math.max(0, approvedAmt - fulfilledAmt);
              const hasPartial = fulfilledAmt > 0;

              return (
                <TouchableOpacity
                  key={r.id}
                  style={[
                    styles.reminderCard,
                    isActive && styles.reminderCardActive,
                    isExpired && styles.reminderCardExpired,
                  ]}
                  onPress={() => applyReminder(r)}
                  activeOpacity={0.8}
                >
                  <View style={styles.reminderRow}>
                    <Text style={styles.reminderRef}>{imp?.ref_id}</Text>
                    <View style={[styles.reminderBadge, isExpired ? styles.reminderBadgeExpired : hoursLeft < 24 && styles.reminderBadgeUrgent]}>
                      <Text style={[styles.reminderBadgeText, isExpired ? styles.reminderBadgeTextExpired : hoursLeft < 24 && styles.reminderBadgeTextUrgent]}>
                        {isExpired ? 'Overdue — submit now' : daysLeft > 0 ? `${daysLeft}d left` : hoursLeft > 0 ? `${hoursLeft}h left` : 'Due today'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.reminderDetail}>{imp?.category} · {imp?.site}</Text>
                  <Text style={styles.reminderAmount}>
                    Approved: ₹{approvedAmt.toLocaleString('en-IN')}
                    {remainingBal < approvedAmt ? `  •  Balance: ₹${remainingBal.toLocaleString('en-IN')}` : ''}
                  </Text>
                  {hasPartial && (
                    <View style={styles.balanceRow}>
                      <Text style={styles.balanceFulfilled}>Submitted: ₹{fulfilledAmt.toLocaleString('en-IN')}</Text>
                      <Text style={styles.balanceRemaining}>Balance: ₹{remainingBal.toLocaleString('en-IN')}</Text>
                    </View>
                  )}
                  <Text style={styles.reminderDeadline}>
                    Submit by {deadline.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </Text>
                  {isActive && (
                    <Text style={styles.reminderActive}>✓ Selected — fill the form below and submit</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* ── Step 2: Expense Form (only shown after imprest selected) ── */}
        {activeImprestId && (
          <>
            <View style={[styles.stepHeader, { marginTop: 24 }]}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <Text style={styles.stepTitle}>Fill Expense Details</Text>
              <TouchableOpacity onPress={clearImprest} style={styles.changeLink}>
                <Text style={styles.changeLinkText}>Change imprest</Text>
              </TouchableOpacity>
            </View>

            {/* Site — locked to imprest */}
            <Text style={styles.label}>Site</Text>
            <View style={styles.lockedField}>
              <Text style={styles.lockedFieldValue}>{form.site}</Text>
              <Text style={styles.lockedFieldBadge}>🔒 Locked to imprest</Text>
            </View>

            {/* Amount — editable, constrained to remaining balance */}
            <Text style={styles.label}>Amount (₹) *</Text>
            <TextInput
              style={styles.input}
              placeholder={`Max ₹${(imprestRemainingBalance || 0).toLocaleString('en-IN')}`}
              placeholderTextColor="#9ca3af"
              value={form.amount}
              onChangeText={(v) => set('amount', v)}
              keyboardType="numeric"
            />
            {imprestRemainingBalance !== null && (
              <Text style={styles.balanceHint}>
                Available balance: ₹{imprestRemainingBalance.toLocaleString('en-IN')}
              </Text>
            )}

            {/* Category — locked to imprest */}
            <Text style={styles.label}>Category</Text>
            <View style={styles.lockedField}>
              <Text style={styles.lockedFieldValue}>{form.category}</Text>
              <Text style={styles.lockedFieldBadge}>🔒 Locked to imprest</Text>
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

            {/* Payment proof */}
            <Text style={styles.label}>Payment Proof * {images.length > 0 && `(${images.length} attached)`}</Text>

            {images.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                {images.map((img, idx) => (
                  <View key={idx} style={styles.imagePreview}>
                    {img.mimeType === 'application/pdf' ? (
                      <View style={styles.pdfPreview}>
                        <Text style={styles.pdfIcon}>📄</Text>
                        <Text style={styles.pdfName} numberOfLines={2}>{img.name || 'document.pdf'}</Text>
                      </View>
                    ) : (
                      <Image source={{ uri: img.uri }} style={styles.previewImg} resizeMode="contain" />
                    )}
                    <TouchableOpacity onPress={() => removeImage(idx)} style={styles.removeImg}>
                      <Text style={styles.removeImgText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {images.length < 5 && (
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
            {images.length > 0 && images.length < 5 && (
              <Text style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 4 }}>
                You can add up to {5 - images.length} more screenshot{5 - images.length !== 1 ? 's' : ''}
              </Text>
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

            <Text style={styles.hint}>Logged in as {user?.name} · {user?.site}</Text>
          </>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  inner: { padding: 20, paddingBottom: 40 },

  // Step indicator
  stepHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 4 },
  stepBadge: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#e8a24a', alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  stepBadgeDone: { backgroundColor: '#16a34a' },
  stepBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  stepTitle: { fontSize: 15, fontWeight: '700', color: '#1f2937', flex: 1 },
  changeLink: { paddingHorizontal: 8, paddingVertical: 4 },
  changeLinkText: { fontSize: 12, color: '#e8a24a', fontWeight: '600' },

  // Reminders
  remindersSubtitle: { fontSize: 12, color: '#78716c', marginBottom: 10 },
  reminderCard: {
    backgroundColor: '#fffbeb', borderWidth: 1.5, borderColor: '#fbbf24',
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  reminderCardActive: { borderColor: '#16a34a', backgroundColor: '#f0fdf4', borderWidth: 2 },
  reminderCardExpired: { backgroundColor: '#fff1f2', borderColor: '#f87171', borderWidth: 2 },
  reminderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  reminderRef: { fontSize: 13, fontWeight: '700', color: '#e8a24a', fontFamily: 'monospace' },
  reminderBadge: { backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  reminderBadgeUrgent: { backgroundColor: '#fee2e2' },
  reminderBadgeExpired: { backgroundColor: '#fee2e2' },
  reminderBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400e' },
  reminderBadgeTextUrgent: { color: '#dc2626' },
  reminderBadgeTextExpired: { color: '#dc2626', fontWeight: '700' },
  reminderDetail: { fontSize: 13, color: '#374151', marginBottom: 2 },
  reminderAmount: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 2 },
  reminderDeadline: { fontSize: 11, color: '#6b7280' },
  reminderActive: { fontSize: 12, color: '#16a34a', fontWeight: '600', marginTop: 6 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, marginBottom: 2 },
  balanceFulfilled: { fontSize: 12, color: '#16a34a', fontWeight: '600' },
  balanceRemaining: { fontSize: 12, color: '#dc2626', fontWeight: '700' },

  // Loading / empty states
  loadingState: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, backgroundColor: '#fff', borderRadius: 12, marginBottom: 12 },
  loadingText: { fontSize: 13, color: '#6b7280' },
  emptyState: { alignItems: 'center', padding: 28, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: '#e5e7eb', marginBottom: 12 },
  emptyStateIcon: { fontSize: 42, marginBottom: 10 },
  emptyStateTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  emptyStateText: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginBottom: 8, lineHeight: 19 },
  emptyStateHint: { fontSize: 12, color: '#e8a24a', fontWeight: '600', textAlign: 'center' },

  // Form fields
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', backgroundColor: '#fff' },
  textarea: { height: 80, textAlignVertical: 'top' },

  // Locked fields
  lockedField: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#f3f4f6',
  },
  lockedFieldValue: { fontSize: 15, color: '#374151', fontWeight: '500' },
  lockedFieldBadge: { fontSize: 11, color: '#9ca3af' },

  // Balance hint
  balanceHint: { fontSize: 11, color: '#16a34a', fontWeight: '600', marginTop: 4, marginLeft: 2 },

  // Image upload
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

  // Submit
  submitBtn: { backgroundColor: '#e8a24a', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  btnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 16 },

  // Result card
  resultCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 2, padding: 16, marginBottom: 20 },
  resultTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  resultRef: { fontSize: 12, fontFamily: 'monospace', color: '#6b7280', marginBottom: 4 },
  resultMsg: { fontSize: 13, color: '#374151', marginBottom: 4 },
  resultConf: { fontSize: 12, color: '#3b82f6', fontWeight: '600' },
  resultWarn: { fontSize: 12, color: '#f97316', marginTop: 4 },
});
