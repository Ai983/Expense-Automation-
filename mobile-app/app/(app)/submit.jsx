import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Image, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../../src/context/AuthContext';
import { submitExpense, getMyAdjustments, waitForAuditResult } from '../../src/services/expenseService';
import { getMyReminders, fulfillReminder } from '../../src/services/imprestService';
import { Picker } from '@react-native-picker/picker';
import { SITES, CATEGORIES, IMPREST_TO_EXPENSE_CATEGORY } from '../../src/constants';
import { useSites } from '../../src/hooks/useSites';

const INITIAL_FORM = { site: SITES[0], amount: '', category: CATEGORIES[0], description: '' };

// Own-vehicle (bike/car) trips are paid per km and have no bill. They are settled
// with three camera photos and the two odometer readings instead of a payment
// screenshot (backend utils/ownVehicleProof.js). Order matters — the server reads
// the photos in this order.
const OWN_VEHICLE_RATE = { Bike: 5, Car: 10 };
const TRIP_PHOTOS = [
  { role: 'odometer_start', label: '1. Trip shuru — meter (odometer) ki photo' },
  { role: 'odometer_end', label: '2. Trip khatam — meter (odometer) ki photo' },
  { role: 'site', label: '3. Site par li gayi photo' },
];
const isOwnVehicle = (imp) => imp?.category === 'Conveyance' && imp?.conveyance_mode === 'Own Vehicle';

// The confirmation card is written at submit time, but the AI auditor settles
// most expenses seconds later. These map the refreshed status onto the card so
// it reflects the real outcome instead of freezing on "we're checking".
const RESULT_TITLES = {
  blocked: '🚫 Blocked',
  verified: '✅ Auto-Verified',
  approved: '✅ Approved',
  rejected: '❌ Rejected',
};

function resultTitle(status) {
  return RESULT_TITLES[status] || '📋 Submitted';
}

function auditedMessage(status) {
  const messages = {
    approved: 'Approved — this expense has been settled against your imprest.',
    rejected: 'This expense was rejected. Check My Expenses for the reason.',
    blocked: 'This expense was blocked — see the reason below.',
    manual_review: 'Checked — finance will take a look at this one.',
  };
  return messages[status] || 'Expense submitted.';
}

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
  const [adjustments, setAdjustments] = useState([]);
  const [activeAdjustmentId, setActiveAdjustmentId] = useState(null);
  const [settlementForExpenseId, setSettlementForExpenseId] = useState(null);
  const [imprestSiteExtra, setImprestSiteExtra] = useState(null); // site from imprest when not in SITES list
  // Own-vehicle trip proof — set only when the selected imprest is a bike/car trip
  const [ownTrip, setOwnTrip] = useState(null);
  const [tripPhotos, setTripPhotos] = useState({});
  const [startKm, setStartKm] = useState('');
  const [endKm, setEndKm] = useState('');
  const sites = useSites();
  const { user } = useAuth();

  const fetchReminders = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getMyReminders(user.id);
      setReminders(res.reminders || []);
    } catch { /* silently ignore */ }
    finally { setLoadingReminders(false); }
  }, [user]);

  const fetchAdjustments = useCallback(async () => {
    if (!user) return;
    try {
      const res = await getMyAdjustments(user.id);
      setAdjustments(res.adjustments || []);
    } catch { /* silently ignore */ }
  }, [user]);

  useEffect(() => { fetchReminders(); fetchAdjustments(); }, [fetchReminders, fetchAdjustments]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function applyReminder(reminder) {
    const imp = reminder.imprest;
    // The cash actually paid — the advance settles against this, not the approved
    // figure (a founder or finance cut means less was handed over).
    const approvedAmt = parseFloat(reminder.amount_paid ?? imp?.paid_amount ?? imp?.approved_amount ?? imp?.amount_requested ?? 0);
    // The most that can be filed before it is flagged as overspend — the server's rule.
    const claimLimit = parseFloat(reminder.claim_limit ?? approvedAmt);
    // Use actual_submitted (sum of finance-approved expense amounts) over stale fulfilled_amount
    const previouslyFulfilled = parseFloat(reminder.actual_submitted ?? reminder.fulfilled_amount ?? 0);
    const remainingBalance = Math.max(0, approvedAmt - previouslyFulfilled);
    const claimRemaining = Math.max(0, claimLimit - previouslyFulfilled);
    // Use the imprest site as-is — don't fall back to SITES[0] which loses the real site
    const site = imp?.site || SITES[0];
    if (imp?.site && !SITES.includes(imp.site)) setImprestSiteExtra(imp.site);
    else setImprestSiteExtra(null);
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
    setImprestRemainingBalance(claimRemaining > 0 ? claimRemaining : claimLimit);
    setImages([]);
    setResult(null);
    resetTrip(isOwnVehicle(imp) ? {
      vehicleType: imp.vehicle_type || 'Bike',
      rate: OWN_VEHICLE_RATE[imp.vehicle_type] || OWN_VEHICLE_RATE.Bike,
      plannedKm: imp.ai_estimated_distance_km ? parseFloat(imp.ai_estimated_distance_km) : null,
      from: imp.travel_from, to: imp.travel_to, date: imp.travel_date,
    } : null);
  }

  function resetTrip(trip) {
    setOwnTrip(trip);
    setTripPhotos({});
    setStartKm('');
    setEndKm('');
  }

  // Trip photos come from a GPS / timestamp camera app (the same ones posted in the
  // site WhatsApp groups), so they are usually picked from the gallery. The date,
  // time and location printed on the photo are what the server checks — not how
  // it was picked. Full quality keeps that printed stamp readable.
  async function takeTripPhoto(role, source) {
    const options = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
    let picked;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission', 'Camera ki permission chahiye / Camera access is required');
      picked = await ImagePicker.launchCameraAsync(options);
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission', 'Gallery ki permission chahiye / Gallery access is required');
      picked = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (!picked.canceled && picked.assets?.[0]) {
      const asset = picked.assets[0];
      setTripPhotos((p) => ({ ...p, [role]: { uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' } }));
      setResult(null);
    }
  }

  // km ridden and the most that may be claimed for it (null until both readings make sense)
  const tripKm = ownTrip && startKm !== '' && endKm !== '' && parseFloat(endKm) > parseFloat(startKm)
    ? Math.round((parseFloat(endKm) - parseFloat(startKm)) * 10) / 10
    : null;
  const tripMaxAmount = tripKm != null ? Math.round(tripKm * ownTrip.rate) : null;

  function setReading(which, value) {
    const clean = value.replace(/[^0-9.]/g, '');
    const s = which === 'start' ? clean : startKm;
    const e = which === 'end' ? clean : endKm;
    if (which === 'start') setStartKm(clean); else setEndKm(clean);
    // Fill the claim with km × rate as soon as both readings are in
    if (s !== '' && e !== '' && parseFloat(e) > parseFloat(s)) {
      set('amount', String(Math.round((parseFloat(e) - parseFloat(s)) * ownTrip.rate)));
    }
  }

  function applyAdjustment(adj) {
    const remaining = adj.remaining ?? Math.round((parseFloat(adj.original_amount) - parseFloat(adj.amount)) * 100) / 100;
    setForm({
      site: SITES.includes(adj.site) ? adj.site : SITES[0],
      amount: String(remaining),
      category: CATEGORIES.includes(adj.category) ? adj.category : CATEGORIES[0],
      description: `Settlement for finance-adjusted expense ${adj.ref_id}`,
    });
    setActiveAdjustmentId(adj.id);
    setSettlementForExpenseId(adj.id);
    setActiveImprestId(adj.imprest_id);
    setImprestApprovedAmount(null);
    setImprestRemainingBalance(remaining);
    setActiveReminderId(null);
    setImages([]);
    setResult(null);
    resetTrip(null);
  }

  function clearImprest() {
    setActiveReminderId(null);
    setActiveAdjustmentId(null);
    setSettlementForExpenseId(null);
    setActiveImprestId(null);
    setImprestApprovedAmount(null);
    setImprestRemainingBalance(null);
    setImprestSiteExtra(null);
    setForm(INITIAL_FORM);
    setImages([]);
    resetTrip(null);
  }

  async function pickPdf() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        // Trust the picker's reported type, not the filter — Android SAF
        // providers routinely return files outside `type`, and hardcoding
        // application/pdf here stored images that no PDF viewer could open.
        const mimeType = asset.mimeType || 'application/pdf';
        setImages((prev) => [...prev, { uri: asset.uri, mimeType, name: asset.name }]);
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

  async function doSubmit() {
    setLoading(true);
    setResult(null);
    try {
      const expenseAmount = parseFloat(form.amount);
      const res = await submitExpense({
        site: form.site,
        amount: expenseAmount,
        category: form.category,
        description: form.description,
        // Own-vehicle trip: the three photos in the fixed order the server expects
        images: ownTrip ? TRIP_PHOTOS.map((p) => tripPhotos[p.role]) : images,
        imprestId: activeImprestId,
        settlementForExpenseId,
        ...(ownTrip && { odometerStartKm: startKm, odometerEndKm: endKm }),
      });
      setResult(res);
      setImages([]);
      if (activeReminderId) {
        try { await fulfillReminder(activeReminderId, expenseAmount); } catch { /* ignore */ }
      }
      clearImprest();
      fetchReminders();
      fetchAdjustments();

      // The AI audit finishes a few seconds from now, and usually settles the
      // expense outright. Two things come back: the outcome, which refreshes the
      // card so it stops claiming the receipt is still being checked, and a fix
      // hint, which is raised immediately so the employee can re-send while they
      // still have the receipt. Never blocks or fails the submit.
      if (res?.expenseId) {
        waitForAuditResult(res.expenseId)
          .then((audit) => {
            if (!audit) return;

            if (audit.status && audit.status !== res.status) {
              setResult((prev) => (
                prev && prev.expenseId === res.expenseId
                  ? { ...prev, status: audit.status, message: auditedMessage(audit.status) }
                  : prev
              ));
            }

            if (!audit.fixHint) return;
            const title = 'Please Re-send Your Receipt';
            if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
              window.alert(`${title}\n\n${audit.fixHint}`);
            } else {
              Alert.alert(title, audit.fixHint);
            }
          })
          .catch(() => { /* advisory only */ });
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

  function handleSubmit() {
    if (!activeImprestId) {
      return Alert.alert('Imprest Required', 'Please select a pending Imprest Request above before submitting an expense.');
    }
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0) {
      return Alert.alert('Error', 'Enter a valid amount');
    }
    if (ownTrip) {
      const missing = TRIP_PHOTOS.filter((p) => !tripPhotos[p.role]);
      if (missing.length) {
        return Alert.alert('Photo zaroori hai', `Ye photo abhi baaki hai:\n${missing.map((p) => p.label).join('\n')}\n\nTeeno photo compulsory hain.`);
      }
      if (tripKm == null) {
        return Alert.alert('Reading galat hai', 'Start aur end odometer reading bharein. End reading start se zyada honi chahiye.');
      }
      if (parseFloat(form.amount) > tripMaxAmount + 1) {
        return Alert.alert('Amount zyada hai', `${tripKm} km × ₹${ownTrip.rate}/km = ₹${tripMaxAmount}. Isse zyada claim nahi kar sakte.`);
      }
    } else if (images.length === 0) {
      return Alert.alert('Error', 'Upload at least one payment screenshot or PDF');
    }

    const enteredAmt = parseFloat(form.amount);
    const isOverspend = imprestRemainingBalance !== null && enteredAmt > imprestRemainingBalance + 0.01;

    if (isOverspend) {
      const overspendAmt = (enteredAmt - imprestRemainingBalance).toLocaleString('en-IN');
      Alert.alert(
        'Overspend Warning',
        `You are spending ₹${overspendAmt} more than your remaining imprest balance of ₹${imprestRemainingBalance.toLocaleString('en-IN')}.\n\nThe extra amount will be flagged for finance review.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit Anyway', style: 'default', onPress: doSubmit },
        ]
      );
    } else {
      doSubmit();
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">

        {/* ── Success result ───────────────────────────────────────── */}
        {result && (
          <View style={[styles.resultCard, { borderColor: result.status === 'blocked' || result.status === 'rejected' ? '#ef4444' : '#10b981' }]}>
            <Text style={styles.resultTitle}>{resultTitle(result.status)}</Text>
            <Text style={styles.resultRef}>Ref: {result.refId}</Text>
            <Text style={styles.resultMsg}>{result.message}</Text>
            {result.status === 'blocked' && result.blockReason ? (
              <Text style={styles.resultWarn}>🚫 {result.blockReason}</Text>
            ) : null}
            {/* A confidence score is only meaningful when something was actually
                read off the receipt. When nothing was, the number looks like a
                pass mark to the employee — show the ask instead. Once the expense
                is settled neither matters any more. */}
            {result.status === 'approved' || result.status === 'rejected' ? null : result.receiptUnreadable ? (
              <Text style={styles.resultWarn}>
                ⚠ Tip: a clear screenshot of the payment confirmation (showing amount, date and transaction ID) gets approved faster.
              </Text>
            ) : result.confidence > 0 ? (
              <Text style={styles.resultConf}>Confidence: {result.confidence}%</Text>
            ) : null}
            {result.duplicateWarnings?.map((w, i) => (
              <Text key={i} style={styles.resultWarn}>⚠ {w}</Text>
            ))}
          </View>
        )}

        {/* ── Pending Settlements (finance-adjusted expenses) ──────── */}
        {adjustments.length > 0 && (
          <View style={styles.settlementSection}>
            <View style={styles.settlementHeader}>
              <Text style={styles.settlementTitle}>⚠ Pending Settlements</Text>
              <Text style={styles.settlementSubtitle}>
                Finance reduced these expenses. Tap a card to resubmit proof for the remaining amount.
              </Text>
            </View>
            {adjustments.map((adj) => {
              const remaining = adj.remaining ?? Math.round((parseFloat(adj.original_amount) - parseFloat(adj.amount)) * 100) / 100;
              const isActive = activeAdjustmentId === adj.id;
              return (
                <TouchableOpacity
                  key={adj.id}
                  style={[styles.settlementCard, isActive && styles.settlementCardActive]}
                  onPress={() => applyAdjustment(adj)}
                  activeOpacity={0.8}
                >
                  <View style={styles.reminderRow}>
                    <Text style={styles.settlementRef}>{adj.ref_id}</Text>
                    <Text style={styles.settlementBadge}>Settle ₹{remaining.toLocaleString('en-IN')}</Text>
                  </View>
                  <Text style={styles.settlementDetail}>{adj.category} · {adj.site}</Text>
                  <Text style={styles.settlementAmounts}>
                    Claimed ₹{parseFloat(adj.original_amount).toLocaleString('en-IN')}  →  Approved ₹{parseFloat(adj.amount).toLocaleString('en-IN')}
                  </Text>
                  {adj.settledSoFar > 0 && (
                    <Text style={styles.settlementSettled}>
                      Already settled: ₹{adj.settledSoFar.toLocaleString('en-IN')}
                    </Text>
                  )}
                  <Text style={styles.settlementWarning}>
                    ₹{remaining.toLocaleString('en-IN')} still outstanding — submit payment proof to settle
                  </Text>
                  {isActive && <Text style={styles.reminderActive}>✓ Selected — fill the form below and submit</Text>}
                </TouchableOpacity>
              );
            })}
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
              // What was actually paid out — the amount to submit expenses for
              const approvedAmt = parseFloat(r.amount_paid ?? imp?.paid_amount ?? imp?.approved_amount ?? imp?.amount_requested ?? 0);
              // actual_submitted reflects finance-approved amounts; fall back to fulfilled_amount if not present
              const fulfilledAmt = parseFloat(r.actual_submitted ?? r.fulfilled_amount ?? 0);
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
                    Paid to you: ₹{approvedAmt.toLocaleString('en-IN')}
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

            {/* Site — pre-filled from imprest, user can change */}
            <Text style={styles.label}>Site</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={form.site}
                onValueChange={(v) => set('site', v)}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {imprestSiteExtra && (
                  <Picker.Item key={imprestSiteExtra} label={imprestSiteExtra} value={imprestSiteExtra} />
                )}
                {sites.map((s) => <Picker.Item key={s} label={s} value={s} />)}
              </Picker>
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
            {imprestRemainingBalance !== null && (() => {
              const entered = parseFloat(form.amount || 0);
              const over = entered > imprestRemainingBalance + 0.01;
              return (
                <Text style={[styles.balanceHint, over && { color: '#dc2626' }]}>
                  {over
                    ? `⚠️ Overspend by ₹${(entered - imprestRemainingBalance).toLocaleString('en-IN')} — will need finance approval`
                    : `Available balance: ₹${imprestRemainingBalance.toLocaleString('en-IN')}`}
                </Text>
              );
            })()}

            {/* Category — pre-filled from imprest, user can change */}
            <Text style={styles.label}>Category</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={form.category}
                onValueChange={(v) => set('category', v)}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
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

            {/* Own-vehicle trip proof — replaces the payment screenshot */}
            {ownTrip && (
              <View style={styles.tripBox}>
                <Text style={styles.tripTitle}>{`🛵 ${ownTrip.vehicleType} trip — bill ki zaroorat nahi`}</Text>
                <Text style={styles.tripHint}>
                  {`Aapko ₹${ownTrip.rate}/km milta hai. Teeno photo compulsory hain.`}
                </Text>
                <Text style={[styles.tripHint, { fontWeight: '700' }]}>
                  {'GPS camera wali photo lagayein — jis par date, time aur location likhi ho (jaise WhatsApp group me bhejte hain). Bina location wali photo accept nahi hogi.'}
                </Text>
                {(ownTrip.from || ownTrip.to) && (
                  <Text style={styles.tripHint}>
                    {`Route: ${ownTrip.from || '?'} → ${ownTrip.to || '?'}${ownTrip.plannedKm ? ` (${ownTrip.plannedKm} km)` : ''}${ownTrip.date ? ` · ${ownTrip.date}` : ''}`}
                  </Text>
                )}

                {TRIP_PHOTOS.map((p) => {
                  const photo = tripPhotos[p.role];
                  return (
                    <View key={p.role} style={styles.tripPhotoRow}>
                      <Text style={styles.label}>{p.label} *</Text>
                      {photo ? (
                        <View style={styles.imagePreview}>
                          <Image source={{ uri: photo.uri }} style={styles.previewImg} resizeMode="contain" />
                          <TouchableOpacity onPress={() => setTripPhotos((t) => ({ ...t, [p.role]: undefined }))} style={styles.removeImg}>
                            <Text style={styles.removeImgText}>Hatayein / Change</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={styles.imageButtons}>
                          <TouchableOpacity style={styles.imgBtn} onPress={() => takeTripPhoto(p.role, 'gallery')}>
                            <Text style={styles.imgBtnText}>🖼 Gallery</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.imgBtn} onPress={() => takeTripPhoto(p.role, 'camera')}>
                            <Text style={styles.imgBtnText}>📷 Camera</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {p.role === 'odometer_start' && (
                        <TextInput style={styles.input} placeholder="Start reading (km) — e.g. 12400" placeholderTextColor="#9ca3af"
                          value={startKm} onChangeText={(v) => setReading('start', v)} keyboardType="numeric" />
                      )}
                      {p.role === 'odometer_end' && (
                        <TextInput style={styles.input} placeholder="End reading (km) — e.g. 12636" placeholderTextColor="#9ca3af"
                          value={endKm} onChangeText={(v) => setReading('end', v)} keyboardType="numeric" />
                      )}
                    </View>
                  );
                })}

                {tripKm != null ? (
                  <Text style={styles.tripTotal}>
                    {`${tripKm} km × ₹${ownTrip.rate}/km = ₹${tripMaxAmount.toLocaleString('en-IN')} (maximum claim)`}
                  </Text>
                ) : (startKm !== '' && endKm !== '') ? (
                  <Text style={[styles.tripTotal, { color: '#dc2626' }]}>End reading start reading se zyada honi chahiye</Text>
                ) : null}
              </View>
            )}

            {!ownTrip && (<>
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
            </>)}

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

  // Picker
  pickerWrapper: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    backgroundColor: '#fff', marginBottom: 12, overflow: 'hidden',
  },
  picker: { height: 50, color: '#111827' },

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
  tripBox: { marginTop: 16, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, padding: 14 },
  tripTitle: { fontSize: 15, fontWeight: '700', color: '#92400e' },
  tripHint: { fontSize: 12, color: '#b45309', marginTop: 4 },
  tripPhotoRow: { marginTop: 4, gap: 8 },
  tripTotal: { marginTop: 14, fontSize: 14, fontWeight: '700', color: '#065f46' },
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

  // Pending settlements
  settlementSection: { marginBottom: 20 },
  settlementHeader: { marginBottom: 10 },
  settlementTitle: { fontSize: 15, fontWeight: '700', color: '#c2410c', marginBottom: 4 },
  settlementSubtitle: { fontSize: 12, color: '#78716c' },
  settlementCard: {
    backgroundColor: '#fff7ed', borderWidth: 1.5, borderColor: '#f97316',
    borderRadius: 12, padding: 14, marginBottom: 10,
  },
  settlementCardActive: { borderColor: '#16a34a', backgroundColor: '#f0fdf4', borderWidth: 2 },
  settlementRef: { fontSize: 13, fontWeight: '700', color: '#c2410c', fontFamily: 'monospace' },
  settlementBadge: { fontSize: 12, fontWeight: '700', color: '#fff', backgroundColor: '#f97316', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  settlementDetail: { fontSize: 13, color: '#374151', marginTop: 4, marginBottom: 2 },
  settlementAmounts: { fontSize: 13, fontWeight: '600', color: '#111827', marginBottom: 4 },
  settlementSettled: { fontSize: 12, color: '#16a34a', fontWeight: '600', marginBottom: 2 },
  settlementWarning: { fontSize: 12, color: '#b45309', fontWeight: '600' },
});
