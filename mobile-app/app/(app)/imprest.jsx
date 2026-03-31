import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useAuth } from '../../src/context/AuthContext';
import { IMPREST_SITES, IMPREST_CATEGORIES, IMPREST_REQUESTED_TO } from '../../src/constants';
import { getFoodRates, estimateTravelCost, submitImprest } from '../../src/services/imprestService';

const TOTAL_STEPS = 8;

export default function ImprestScreen() {
  const { user } = useAuth();

  // Step state
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Form fields
  const [site, setSite] = useState(IMPREST_SITES[0]);
  const [category, setCategory] = useState(IMPREST_CATEGORIES[0]);
  const [peopleCount, setPeopleCount] = useState('1');
  const [amountRequested, setAmountRequested] = useState('');
  const [purpose, setPurpose] = useState('');
  const [requestedTo, setRequestedTo] = useState(IMPREST_REQUESTED_TO[0]);

  // Food-specific
  const [foodRate, setFoodRate] = useState(null);
  const [foodRateLoading, setFoodRateLoading] = useState(false);
  const [foodRateError, setFoodRateError] = useState('');

  // Travel-specific
  const [travelFrom, setTravelFrom] = useState('');
  const [travelTo, setTravelTo] = useState('');
  const [aiEstimate, setAiEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [userEditedAmount, setUserEditedAmount] = useState(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const loadFoodRate = useCallback(async (selectedSite) => {
    setFoodRateLoading(true);
    setFoodRateError('');
    setFoodRate(null);
    try {
      const rates = await getFoodRates();
      const match = rates.find((r) => r.site === selectedSite);
      if (match) {
        setFoodRate(match.rate);
        const count = parseInt(peopleCount) || 1;
        setAmountRequested(String(match.rate * count));
      } else {
        setFoodRateError('No food rate configured for this site.');
        setAmountRequested('');
      }
    } catch {
      setFoodRateError('Failed to load food rate. Please try again.');
    } finally {
      setFoodRateLoading(false);
    }
  }, [peopleCount]);

  const handleEstimateTravel = useCallback(async () => {
    if (!travelFrom.trim() || !travelTo.trim()) {
      Alert.alert('Missing info', 'Please enter both From and To locations.');
      return;
    }
    setEstimating(true);
    setAiEstimate(null);
    try {
      const estimate = await estimateTravelCost({
        from: travelFrom.trim(),
        to: travelTo.trim(),
        peopleCount: parseInt(peopleCount) || 1,
      });
      setAiEstimate(estimate);
      setAmountRequested(String(estimate.estimatedAmount));
      setUserEditedAmount(false);
    } catch {
      Alert.alert('Estimation failed', 'Could not estimate travel cost. Please enter the amount manually.');
    } finally {
      setEstimating(false);
    }
  }, [travelFrom, travelTo, peopleCount]);

  const handleNext = () => {
    // Load food rate when moving from step 4 (people count) → step 5 (amount)
    // At this point both site (step 2) and category (step 3) are already confirmed
    if (step === 4 && category === 'Food Expense') {
      loadFoodRate(site);
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    if (!amountRequested || parseFloat(amountRequested) <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid amount.');
      return;
    }
    setSubmitting(true);
    try {
      // Combine purpose + requested-to name into the purpose field
      const purposeParts = [];
      if (purpose.trim()) purposeParts.push(purpose.trim());
      if (requestedTo) purposeParts.push(`Requested to: ${requestedTo}`);

      const payload = {
        site,
        category,
        peopleCount: parseInt(peopleCount) || 1,
        amountRequested: parseFloat(amountRequested),
        purpose: purposeParts.length ? purposeParts.join(' | ') : undefined,
        perPersonRate: foodRate || undefined,
        travelFrom: travelFrom.trim() || undefined,
        travelTo: travelTo.trim() || undefined,
        aiEstimatedAmount: aiEstimate?.estimatedAmount ?? undefined,
        aiEstimatedDistanceKm: aiEstimate?.distanceKm ?? undefined,
        userEditedAmount,
      };
      const res = await submitImprest(payload);
      setResult(res);
    } catch (e) {
      Alert.alert('Submission failed', e?.response?.data?.error || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setResult(null);
    setSite(IMPREST_SITES[0]);
    setCategory(IMPREST_CATEGORIES[0]);
    setPeopleCount('1');
    setAmountRequested('');
    setPurpose('');
    setRequestedTo(IMPREST_REQUESTED_TO[0]);
    setFoodRate(null);
    setFoodRateError('');
    setTravelFrom('');
    setTravelTo('');
    setAiEstimate(null);
    setUserEditedAmount(false);
  };

  // ── Result Screen ────────────────────────────────────────────────────────────

  if (result) {
    return (
      <View style={styles.container}>
        <View style={styles.resultCard}>
          <Text style={styles.resultIcon}>✓</Text>
          <Text style={styles.resultTitle}>Request Submitted</Text>
          <Text style={styles.resultRef}>{result.refId}</Text>
          <Text style={styles.resultMessage}>{result.message}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={resetForm}>
            <Text style={styles.primaryBtnText}>New Request</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Progress Bar ─────────────────────────────────────────────────────────────

  const progress = ((step - 1) / (TOTAL_STEPS - 1)) * 100;

  // ── Step Renders ─────────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // Step 1: Intro
      case 1:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.greeting}>Hi, {user?.name?.split(' ')[0] || 'there'} 👋</Text>
            <Text style={styles.stepTitle}>Request an Imprest / Advance</Text>
            <Text style={styles.stepSubtitle}>
              This form will take you through a few quick steps to submit your advance request.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
              <Text style={styles.primaryBtnText}>Let's Start →</Text>
            </TouchableOpacity>
          </View>
        );

      // Step 2: Site
      case 2:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Which site are you at?</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={site}
                onValueChange={(val) => setSite(val)}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {IMPREST_SITES.map((s) => <Picker.Item key={s} label={s} value={s} />)}
              </Picker>
            </View>
          </View>
        );

      // Step 3: Category
      case 3:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>What is this advance for?</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={category}
                onValueChange={(val) => setCategory(val)}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {IMPREST_CATEGORIES.map((c) => <Picker.Item key={c} label={c} value={c} />)}
              </Picker>
            </View>
          </View>
        );

      // Step 4: People Count
      case 4:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>How many people?</Text>
            <TextInput
              style={styles.input}
              value={peopleCount}
              onChangeText={setPeopleCount}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor="#9ca3af"
            />
          </View>
        );

      // Step 5: Amount (varies by category)
      case 5:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Amount</Text>

            {category === 'Food Expense' && (
              <View>
                {foodRateLoading ? (
                  <ActivityIndicator color="#e8a24a" style={{ marginVertical: 16 }} />
                ) : foodRateError ? (
                  <Text style={styles.errorText}>{foodRateError}</Text>
                ) : foodRate ? (
                  <View>
                    <View style={styles.infoBox}>
                      <Text style={styles.infoText}>
                        ₹{foodRate}/person × {peopleCount} people = ₹{foodRate * (parseInt(peopleCount) || 1)}
                      </Text>
                      <Text style={styles.infoHint}>Rate locked by system for {site}</Text>
                    </View>
                    <TextInput
                      style={[styles.input, styles.inputLocked]}
                      value={amountRequested}
                      editable={false}
                      keyboardType="numeric"
                    />
                  </View>
                ) : null}
              </View>
            )}

            {category === 'Travelling' && (
              <View>
                <Text style={styles.label}>From Location</Text>
                <TextInput
                  style={styles.input}
                  value={travelFrom}
                  onChangeText={setTravelFrom}
                  placeholder="e.g. Connaught Place, Delhi"
                  placeholderTextColor="#9ca3af"
                />
                <Text style={styles.label}>To Location</Text>
                <TextInput
                  style={styles.input}
                  value={travelTo}
                  onChangeText={setTravelTo}
                  placeholder="e.g. Bhuj, Gujarat"
                  placeholderTextColor="#9ca3af"
                />
                <TouchableOpacity
                  style={[styles.secondaryBtn, estimating && styles.btnDisabled]}
                  onPress={handleEstimateTravel}
                  disabled={estimating}
                >
                  {estimating
                    ? <ActivityIndicator color="#111827" size="small" />
                    : <Text style={styles.secondaryBtnText}>Get AI Estimate</Text>}
                </TouchableOpacity>

                {aiEstimate && (
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                      AI Estimate: ₹{aiEstimate.estimatedAmount} ({aiEstimate.mode})
                    </Text>
                    {aiEstimate.distanceKm && (
                      <Text style={styles.infoHint}>Distance: ~{aiEstimate.distanceKm} km</Text>
                    )}
                    <Text style={styles.infoHint}>{aiEstimate.reasoning}</Text>
                  </View>
                )}

                <Text style={styles.label}>
                  {aiEstimate ? 'Your Amount (edit if needed)' : 'Amount (₹)'}
                </Text>
                <TextInput
                  style={styles.input}
                  value={amountRequested}
                  onChangeText={(val) => {
                    setAmountRequested(val);
                    if (aiEstimate && val !== String(aiEstimate.estimatedAmount)) {
                      setUserEditedAmount(true);
                    }
                  }}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor="#9ca3af"
                />
                {userEditedAmount && aiEstimate && (
                  <Text style={styles.deviationNote}>
                    AI estimate: ₹{aiEstimate.estimatedAmount} | Your amount: ₹{amountRequested}
                  </Text>
                )}
              </View>
            )}

            {!['Food Expense', 'Travelling'].includes(category) && (
              <View>
                <TextInput
                  style={styles.input}
                  value={amountRequested}
                  onChangeText={setAmountRequested}
                  keyboardType="numeric"
                  placeholder="Enter amount in ₹"
                  placeholderTextColor="#9ca3af"
                />
              </View>
            )}
          </View>
        );

      // Step 6: Purpose
      case 6:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Purpose / Notes</Text>
            <Text style={styles.stepSubtitle}>Optional — any additional context for the approver.</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={purpose}
              onChangeText={setPurpose}
              placeholder="Describe the purpose of this advance..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={4}
            />
          </View>
        );

      // Step 7: Requested To
      case 7:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Requested To</Text>
            <Text style={styles.stepSubtitle}>Select who this request is directed to.</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={requestedTo}
                onValueChange={(val) => setRequestedTo(val)}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {IMPREST_REQUESTED_TO.map((name) => (
                  <Picker.Item key={name} label={name} value={name} />
                ))}
              </Picker>
            </View>
          </View>
        );

      // Step 8: Confirm + Submit
      case 8:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Review & Submit</Text>
            <View style={styles.summaryCard}>
              <SummaryRow label="Site" value={site} />
              <SummaryRow label="Category" value={category} />
              <SummaryRow label="People" value={peopleCount} />
              <SummaryRow label="Amount" value={`₹${amountRequested}`} highlight />
              {category === 'Travelling' && travelFrom && (
                <SummaryRow label="Route" value={`${travelFrom} → ${travelTo}`} />
              )}
              {purpose ? <SummaryRow label="Purpose" value={purpose} /> : null}
              {requestedTo ? <SummaryRow label="Requested To" value={requestedTo} /> : null}
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, submitting && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Submit Request</Text>}
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  // ── Main Render ──────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Progress bar */}
      <View style={styles.progressBg}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <Text style={styles.stepCounter}>Step {step} of {TOTAL_STEPS}</Text>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {renderStep()}
      </ScrollView>

      {/* Navigation buttons (except step 1 and 8) */}
      {step > 1 && step < TOTAL_STEPS && (
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
            <Text style={styles.primaryBtnText}>Next →</Text>
          </TouchableOpacity>
        </View>
      )}
      {step === TOTAL_STEPS && (
        <TouchableOpacity style={styles.backBtnSmall} onPress={handleBack}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
      )}
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ label, value, highlight }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, highlight && styles.summaryHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  progressBg: { height: 4, backgroundColor: '#e5e7eb' },
  progressFill: { height: 4, backgroundColor: '#e8a24a' },
  stepCounter: { fontSize: 11, color: '#9ca3af', textAlign: 'right', paddingHorizontal: 20, paddingTop: 8 },
  scroll: { padding: 24, paddingBottom: 40 },
  stepContent: { flex: 1 },

  greeting: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 8 },
  stepTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  stepSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 24, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 12 },

  pickerWrapper: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    backgroundColor: '#fff', overflow: 'hidden', marginTop: 8,
  },
  picker: { height: 54, color: '#111827' },

  input: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    backgroundColor: '#fff', padding: 14, fontSize: 16, color: '#111827', marginTop: 8,
  },
  inputLocked: { backgroundColor: '#f3f4f6', color: '#6b7280' },
  textarea: { height: 100, textAlignVertical: 'top' },

  infoBox: {
    backgroundColor: '#fef3c7', borderRadius: 8, padding: 12, marginTop: 12,
  },
  infoText: { fontSize: 14, fontWeight: '600', color: '#92400e' },
  infoHint: { fontSize: 12, color: '#b45309', marginTop: 4 },

  deviationNote: {
    fontSize: 12, color: '#3b82f6', marginTop: 6, fontStyle: 'italic',
  },

  errorText: { color: '#ef4444', fontSize: 13, marginTop: 8 },

  primaryBtn: {
    backgroundColor: '#e8a24a', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', marginTop: 20,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    backgroundColor: '#111827', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', marginTop: 12,
  },
  secondaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnDisabled: { opacity: 0.6 },

  navRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, paddingTop: 8 },
  backBtn: { justifyContent: 'center', paddingHorizontal: 4 },
  backBtnSmall: { paddingHorizontal: 20, paddingBottom: 16 },
  backBtnText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },

  summaryCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 8,
    borderWidth: 1, borderColor: '#e5e7eb',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  summaryLabel: { fontSize: 13, color: '#6b7280', flex: 1 },
  summaryValue: { fontSize: 13, fontWeight: '600', color: '#111827', flex: 2, textAlign: 'right' },
  summaryHighlight: { color: '#e8a24a', fontSize: 15 },

  resultCard: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  resultIcon: { fontSize: 56, marginBottom: 16 },
  resultTitle: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 8 },
  resultRef: { fontSize: 16, color: '#e8a24a', fontWeight: '700', marginBottom: 12 },
  resultMessage: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 32, lineHeight: 20 },
});
