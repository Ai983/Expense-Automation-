import { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import {
  IMPREST_SITES, IMPREST_CATEGORIES,
  CONVEYANCE_MODES, OWN_VEHICLE_TYPES, TRAVEL_SUBTYPES, LABOUR_SUBCATEGORIES,
} from '../../src/constants';
import {
  getFoodRates, estimateTravelCost, scanConveyanceReceipt, submitImprest,
} from '../../src/services/imprestService';

// ── Helpers ──────────────────────────────────────────────────────────────────

function showAlert(title, msg) {
  if (Platform.OS === 'web' && window?.alert) window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  const ms = new Date(to) - new Date(from);
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

// Simple date input that works on both web and native
function DateInput({ label, value, onChange, minDate }) {
  if (Platform.OS === 'web') {
    return (
      <View>
        <Text style={styles.label}>{label} *</Text>
        <input
          type="date"
          value={value}
          min={minDate}
          onChange={(e) => onChange(e.target.value)}
          style={{
            borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
            padding: 12, fontSize: 15, color: '#111827', backgroundColor: '#fafafa',
            marginBottom: 4, width: '100%', boxSizing: 'border-box',
            border: '1px solid #d1d5db',
          }}
        />
      </View>
    );
  }
  return (
    <View>
      <Text style={styles.label}>{label} * (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="e.g. 2025-06-15"
        placeholderTextColor="#9ca3af"
        keyboardType="numbers-and-punctuation"
      />
    </View>
  );
}

// ── Step computation: total steps depends on category ────────────────────────

function getStepLabels(category) {
  // Returns ordered array of step keys for the selected category
  const base = ['intro', 'site', 'category'];
  switch (category) {
    case 'Food Expense':
      return [...base, 'people', 'food_dates', 'food_amount', 'purpose', 'review'];
    case 'Site Room Rent':
      return [...base, 'people', 'dates', 'amount', 'purpose', 'review'];
    case 'Hotel Expense':
      return [...base, 'people', 'dates', 'amount', 'purpose', 'review'];
    case 'Travelling':
      return [...base, 'travel_subtype', 'people', 'travel_route', 'travel_amount', 'purpose', 'review'];
    case 'Conveyance':
      return [...base, 'conveyance_mode', 'conveyance_detail', 'purpose', 'review'];
    case 'Labour Expense':
      return [...base, 'labour_sub', 'people', 'amount', 'purpose', 'review'];
    case 'Porter':
      return [...base, 'people', 'amount', 'purpose', 'review'];
    case 'Site Expense':
      return [...base, 'requirement', 'amount', 'purpose', 'review'];
    case 'Material Expense':
      return [...base, 'requirement', 'amount', 'purpose', 'review'];
    default:
      return [...base, 'people', 'amount', 'purpose', 'review'];
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ImprestScreen() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Step tracking
  const [stepIndex, setStepIndex] = useState(0);

  // Common fields
  const [site, setSite] = useState(IMPREST_SITES[0]);
  const [customSite, setCustomSite] = useState(''); // used when site === 'Others'
  const [category, setCategory] = useState(IMPREST_CATEGORIES[0]);
  const [peopleCount, setPeopleCount] = useState('1');
  const [amountRequested, setAmountRequested] = useState('');
  const [purpose, setPurpose] = useState('');

  // Food / Site Room Rent / Hotel — date range
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [foodRate, setFoodRate] = useState(null);
  const [foodRateLoading, setFoodRateLoading] = useState(false);
  const [foodRateError, setFoodRateError] = useState('');
  const [customFoodRate, setCustomFoodRate] = useState('');

  // Travelling
  const [travelSubtype, setTravelSubtype] = useState(TRAVEL_SUBTYPES[0]);
  const [travelFrom, setTravelFrom] = useState('');
  const [travelTo, setTravelTo] = useState('');
  const [travelDate, setTravelDate] = useState('');
  const [aiEstimate, setAiEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [userEditedAmount, setUserEditedAmount] = useState(false);

  // Conveyance
  const [conveyanceMode, setConveyanceMode] = useState(CONVEYANCE_MODES[0]);
  const [vehicleType, setVehicleType] = useState(OWN_VEHICLE_TYPES[0]);
  const [conveyanceImage, setConveyanceImage] = useState(null);
  const [scanningRide, setScanningRide] = useState(false);
  const [convFrom, setConvFrom] = useState('');
  const [convTo, setConvTo] = useState('');
  const [ownVehicleEstimate, setOwnVehicleEstimate] = useState(null);

  // Labour
  const [labourSub, setLabourSub] = useState(LABOUR_SUBCATEGORIES[0]);

  // Site Expense / Material Expense — requirement description
  const [requirement, setRequirement] = useState('');

  // ── Derived step list ────────────────────────────────────────────────────────
  const steps = getStepLabels(category);
  const totalSteps = steps.length;
  const currentStep = steps[stepIndex];
  const progress = totalSteps > 1 ? (stepIndex / (totalSteps - 1)) * 100 : 100;

  // ── Food rate loader ─────────────────────────────────────────────────────────
  const loadFoodRate = useCallback(async (selectedSite, currentDateFrom, currentDateTo, currentPeopleCount) => {
    if (selectedSite === 'Others') {
      setFoodRate(null);
      setFoodRateError('');
      return;
    }
    setFoodRateLoading(true);
    setFoodRateError('');
    setFoodRate(null);
    try {
      const rates = await getFoodRates();
      const match = rates.find((r) => r.site === selectedSite);
      if (match) {
        setFoodRate(match.rate);
        // Use passed-in values (not stale closure)
        const days = daysBetween(currentDateFrom, currentDateTo);
        const people = parseInt(currentPeopleCount) || 1;
        if (days > 0) setAmountRequested(String(match.rate * people * days));
      } else {
        setFoodRateError('No food rate configured for this site.');
      }
    } catch {
      setFoodRateError('Failed to load food rate.');
    } finally {
      setFoodRateLoading(false);
    }
  }, []);

  // Recalculate food amount when rate, people, or dates change
  const recalcFoodAmount = useCallback((rate, people, from, to) => {
    const r = parseFloat(rate) || 0;
    const p = parseInt(people) || 1;
    const days = daysBetween(from, to);
    if (r > 0 && days > 0) setAmountRequested(String(r * p * days));
  }, []);

  // ── Travel estimate ──────────────────────────────────────────────────────────
  const handleEstimateTravel = useCallback(async () => {
    if (!travelFrom.trim() || !travelTo.trim()) {
      return showAlert('Missing info', 'Please enter both From and To locations.');
    }
    if (['Flight', 'Train', 'Bus'].includes(travelSubtype) && !travelDate) {
      return showAlert('Missing info', 'Please enter the travel date.');
    }
    setEstimating(true);
    setAiEstimate(null);
    try {
      const estimate = await estimateTravelCost({
        from: travelFrom.trim(),
        to: travelTo.trim(),
        mode: travelSubtype,
        travelDate: travelDate || undefined,
        peopleCount: parseInt(peopleCount) || 1,
      });
      setAiEstimate(estimate);
      setAmountRequested(String(estimate.estimatedAmount));
      setUserEditedAmount(false);
    } catch {
      showAlert('Estimation failed', 'Could not estimate cost. Please enter manually.');
    } finally {
      setEstimating(false);
    }
  }, [travelFrom, travelTo, travelSubtype, travelDate, peopleCount]);

  // ── Own Vehicle estimate ─────────────────────────────────────────────────────
  const handleEstimateOwnVehicle = useCallback(async () => {
    if (!convFrom.trim() || !convTo.trim()) {
      return showAlert('Missing info', 'Please enter both From and To locations.');
    }
    setEstimating(true);
    setOwnVehicleEstimate(null);
    try {
      const estimate = await estimateTravelCost({
        from: convFrom.trim(),
        to: convTo.trim(),
        mode: 'Own Vehicle',
        vehicleType,
      });
      setOwnVehicleEstimate(estimate);
      setAmountRequested(String(estimate.estimatedAmount));
      setUserEditedAmount(false);
    } catch {
      showAlert('Estimation failed', 'Could not estimate. Please enter manually.');
    } finally {
      setEstimating(false);
    }
  }, [convFrom, convTo, vehicleType]);

  // ── Scan ride receipt ────────────────────────────────────────────────────────
  const handleScanRideReceipt = useCallback(async () => {
    const opts = { mediaTypes: ['images'], quality: 0.85 };
    let picked;
    if (Platform.OS === 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return showAlert('Permission', 'Gallery access required');
      picked = await ImagePicker.launchImageLibraryAsync(opts);
    } else {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') return showAlert('Permission', 'Camera access required');
      picked = await ImagePicker.launchCameraAsync(opts);
    }
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const mimeType = asset.mimeType || 'image/jpeg';
    setConveyanceImage({ uri: asset.uri, mimeType });
    setScanningRide(true);
    try {
      const result = await scanConveyanceReceipt(asset.uri, mimeType);
      setAmountRequested(String(result.amount));
    } catch (e) {
      showAlert('Scan failed', e?.response?.data?.error || 'Could not read amount. Please enter manually.');
    } finally {
      setScanningRide(false);
    }
  }, []);

  // ── Navigation ───────────────────────────────────────────────────────────────
  const validateCurrentStep = () => {
    switch (currentStep) {
      case 'site':
        if (!site) { showAlert('Required', 'Please select a site.'); return false; }
        if (site === 'Others' && !customSite.trim()) { showAlert('Required', 'Please enter the site name.'); return false; }
        return true;
      case 'category':
        if (!category) { showAlert('Required', 'Please select a category.'); return false; }
        return true;
      case 'people':
        if (!peopleCount || parseInt(peopleCount) < 1) { showAlert('Required', 'Please enter number of people.'); return false; }
        return true;
      case 'food_dates':
      case 'dates':
        if (!dateFrom) { showAlert('Required', 'Please select start date.'); return false; }
        if (!dateTo) { showAlert('Required', 'Please select end date.'); return false; }
        if (new Date(dateTo) < new Date(dateFrom)) { showAlert('Invalid', 'End date must be after start date.'); return false; }
        return true;
      case 'food_amount':
        if (!amountRequested || parseFloat(amountRequested) <= 0) { showAlert('Required', 'Amount is required.'); return false; }
        if (site === 'Others') {
          const r = parseFloat(customFoodRate);
          if (!r || r <= 0) { showAlert('Required', 'Please enter per-person daily rate.'); return false; }
          if (r > 600) { showAlert('Limit exceeded', 'Rate cannot exceed ₹600 per person per day.'); return false; }
        }
        return true;
      case 'amount':
        if (!amountRequested || parseFloat(amountRequested) <= 0) { showAlert('Required', 'Amount is required.'); return false; }
        return true;
      case 'travel_subtype':
        if (!travelSubtype) { showAlert('Required', 'Please select travel type.'); return false; }
        return true;
      case 'travel_route':
        if (!travelFrom.trim()) { showAlert('Required', 'Please enter From location.'); return false; }
        if (!travelTo.trim()) { showAlert('Required', 'Please enter To location.'); return false; }
        if (['Flight', 'Train', 'Bus'].includes(travelSubtype) && !travelDate) {
          showAlert('Required', 'Please enter travel date.'); return false;
        }
        return true;
      case 'travel_amount':
        if (!aiEstimate) { showAlert('Required', 'Please click the estimate button first to get a cost estimate.'); return false; }
        if (!amountRequested || parseFloat(amountRequested) <= 0) { showAlert('Required', 'Amount is required.'); return false; }
        return true;
      case 'conveyance_mode':
        if (!conveyanceMode) { showAlert('Required', 'Please select mode.'); return false; }
        return true;
      case 'conveyance_detail':
        if (conveyanceMode === 'Ola/Rapido/Uber') {
          if (!amountRequested || parseFloat(amountRequested) <= 0) { showAlert('Required', 'Please scan receipt or enter amount.'); return false; }
        }
        if (conveyanceMode === 'Own Vehicle') {
          if (!convFrom.trim() || !convTo.trim()) { showAlert('Required', 'Please enter From and To locations.'); return false; }
          if (!amountRequested || parseFloat(amountRequested) <= 0) { showAlert('Required', 'Please get estimate or enter amount.'); return false; }
        }
        if (conveyanceMode === 'Public Transport') {
          if (!amountRequested || parseFloat(amountRequested) <= 0) { showAlert('Required', 'Please enter amount.'); return false; }
        }
        return true;
      case 'requirement':
        if (!requirement.trim()) { showAlert('Required', 'Please describe the requirement.'); return false; }
        return true;
      case 'labour_sub':
        if (!labourSub) { showAlert('Required', 'Please select sub-category.'); return false; }
        return true;
      case 'purpose':
        if (!purpose.trim()) { showAlert('Required', 'Purpose / notes are required.'); return false; }
        return true;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (!validateCurrentStep()) return;
    // Special side effects on transition
    if (currentStep === 'food_dates' && category === 'Food Expense') {
      loadFoodRate(site, dateFrom, dateTo, peopleCount);
    }
    setStepIndex((i) => Math.min(i + 1, totalSteps - 1));
  };

  const handleBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const systemLockedFood = category === 'Food Expense' && foodRate && site !== 'Others';
    if (!systemLockedFood && (!amountRequested || parseFloat(amountRequested) <= 0)) {
      return showAlert('Invalid amount', 'Please enter a valid amount.');
    }
    setSubmitting(true);
    try {
      const effectiveFoodRate = site === 'Others'
        ? parseFloat(customFoodRate) || null
        : foodRate;

      // For system-locked food rates, compute final amount from rate × people × days
      const finalAmount = (category === 'Food Expense' && effectiveFoodRate && site !== 'Others')
        ? effectiveFoodRate * (parseInt(peopleCount) || 1) * daysBetween(dateFrom, dateTo)
        : parseFloat(amountRequested);

      const payload = {
        site: site === 'Others' ? customSite.trim() : site,
        category,
        peopleCount: parseInt(peopleCount) || 1,
        amountRequested: finalAmount,
        purpose: purpose.trim() || undefined,
        // Date range
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        // Food
        perPersonRate: effectiveFoodRate || undefined,
        // Travel
        travelSubtype: travelSubtype || undefined,
        travelFrom: travelFrom.trim() || undefined,
        travelTo: travelTo.trim() || undefined,
        travelDate: travelDate || undefined,
        aiEstimatedAmount: aiEstimate?.estimatedAmount ?? ownVehicleEstimate?.estimatedAmount ?? undefined,
        aiEstimatedDistanceKm: aiEstimate?.distanceKm ?? ownVehicleEstimate?.distanceKm ?? undefined,
        userEditedAmount,
        // Conveyance
        conveyanceMode: category === 'Conveyance' ? conveyanceMode : undefined,
        vehicleType: conveyanceMode === 'Own Vehicle' ? vehicleType : undefined,
        // Labour
        labourSubcategory: category === 'Labour Expense' ? labourSub : undefined,
        // Site Expense / Material Expense
        requirement: ['Site Expense', 'Material Expense'].includes(category) ? requirement.trim() : undefined,
      };
      const res = await submitImprest(payload);
      setResult(res);
    } catch (e) {
      showAlert('Submission failed', e?.response?.data?.error || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setStepIndex(0);
    setResult(null);
    setSite(IMPREST_SITES[0]);
    setCustomSite('');
    setCategory(IMPREST_CATEGORIES[0]);
    setPeopleCount('1');
    setAmountRequested('');
    setPurpose('');
    setDateFrom(''); setDateTo('');
    setFoodRate(null); setFoodRateError(''); setCustomFoodRate('');
    setTravelSubtype(TRAVEL_SUBTYPES[0]);
    setTravelFrom(''); setTravelTo(''); setTravelDate('');
    setAiEstimate(null); setUserEditedAmount(false); setEstimating(false);
    setConveyanceMode(CONVEYANCE_MODES[0]);
    setVehicleType(OWN_VEHICLE_TYPES[0]);
    setConveyanceImage(null);
    setConvFrom(''); setConvTo('');
    setOwnVehicleEstimate(null);
    setLabourSub(LABOUR_SUBCATEGORIES[0]);
    setRequirement('');
  };

  // ── Result screen ────────────────────────────────────────────────────────────
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

  // ── Step renders ─────────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (currentStep) {

      case 'intro':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.greeting}>Hi, {user?.name?.split(' ')[0] || 'there'} 👋</Text>
            <Text style={styles.stepTitle}>Request an Imprest / Advance</Text>
            <Text style={styles.stepSubtitle}>
              This form will take you through a few quick steps to submit your advance request.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStepIndex(1)}>
              <Text style={styles.primaryBtnText}>Let's Start →</Text>
            </TouchableOpacity>
          </View>
        );

      case 'site':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Which site are you at? *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={site}
                onValueChange={(v) => { setSite(v); setCustomSite(''); }}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {IMPREST_SITES.map((s) => <Picker.Item key={s} label={s} value={s} />)}
              </Picker>
            </View>
            {site === 'Others' && (
              <View>
                <Text style={styles.label}>Enter Site Name *</Text>
                <TextInput
                  style={styles.input}
                  value={customSite}
                  onChangeText={setCustomSite}
                  placeholder="Type your site name..."
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="words"
                  autoFocus
                />
              </View>
            )}
          </View>
        );

      case 'category':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>What is this advance for? *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={category}
                onValueChange={(val) => {
                  setCategory(val);
                  setAmountRequested('');
                  setAiEstimate(null);
                  setOwnVehicleEstimate(null);
                }}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {IMPREST_CATEGORIES.map((c) => <Picker.Item key={c} label={c} value={c} />)}
              </Picker>
            </View>
          </View>
        );

      case 'people':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>How many people? *</Text>
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

      // ── Food: date range then computed amount ────────────────────────────────
      case 'food_dates':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Food Expense Duration *</Text>
            <Text style={styles.stepSubtitle}>Select the date range for food expense</Text>
            <DateInput label="From Date" value={dateFrom} onChange={(v) => {
              setDateFrom(v);
              setAmountRequested('');
            }} />
            <DateInput label="To Date" value={dateTo} minDate={dateFrom} onChange={(v) => {
              setDateTo(v);
              setAmountRequested('');
            }} />
            {dateFrom && dateTo && new Date(dateTo) >= new Date(dateFrom) && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>Duration: {daysBetween(dateFrom, dateTo)} day(s)</Text>
              </View>
            )}
          </View>
        );

      case 'food_amount': {
        const isOtherSite = site === 'Others';
        const rateToUse = isOtherSite ? (parseFloat(customFoodRate) || 0) : (foodRate || 0);
        const days = daysBetween(dateFrom, dateTo);
        const people = parseInt(peopleCount) || 1;
        const computed = rateToUse > 0 ? rateToUse * people * days : 0;

        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Food Amount</Text>

            {foodRateLoading && <ActivityIndicator color="#e8a24a" style={{ marginVertical: 16 }} />}
            {foodRateError ? <Text style={styles.errorText}>{foodRateError}</Text> : null}

            {isOtherSite && (
              <View>
                <Text style={styles.label}>Per Person Daily Rate (₹) — max ₹600 *</Text>
                <TextInput
                  style={styles.input}
                  value={customFoodRate}
                  onChangeText={(v) => {
                    setCustomFoodRate(v);
                    const r = parseFloat(v) || 0;
                    if (r > 0) recalcFoodAmount(r, peopleCount, dateFrom, dateTo);
                    else setAmountRequested('');
                  }}
                  keyboardType="numeric"
                  placeholder="e.g. 300"
                  placeholderTextColor="#9ca3af"
                />
                {parseFloat(customFoodRate) > 600 && (
                  <Text style={styles.errorText}>Rate cannot exceed ₹600 per person per day</Text>
                )}
              </View>
            )}

            {!isOtherSite && rateToUse > 0 && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  ₹{rateToUse}/person × {people} people × {days} day(s) = ₹{computed}
                </Text>
                <Text style={styles.infoHint}>Rate locked by system for {site}</Text>
              </View>
            )}

            <Text style={styles.label}>Total Amount (₹) *</Text>
            <TextInput
              style={[styles.input, !isOtherSite && rateToUse > 0 ? styles.inputLocked : null]}
              value={!isOtherSite && computed > 0 ? String(computed) : amountRequested}
              editable={isOtherSite && !rateToUse}
              onChangeText={setAmountRequested}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#9ca3af"
            />
          </View>
        );
      }

      // ── Site Room Rent / Hotel: date range ──────────────────────────────────
      case 'dates':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>
              {category === 'Hotel Expense' ? 'Duration of Stay *' : 'Rent Duration *'}
            </Text>
            <Text style={styles.stepSubtitle}>
              {category === 'Hotel Expense'
                ? 'Select check-in and check-out dates'
                : 'Select the from and to date for the rent period'}
            </Text>
            <DateInput label="From Date" value={dateFrom} onChange={setDateFrom} />
            <DateInput label="To Date" value={dateTo} minDate={dateFrom} onChange={setDateTo} />
            {dateFrom && dateTo && new Date(dateTo) >= new Date(dateFrom) && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>Duration: {daysBetween(dateFrom, dateTo)} day(s)</Text>
              </View>
            )}
          </View>
        );

      case 'amount':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Amount (₹) *</Text>
            <TextInput
              style={styles.input}
              value={amountRequested}
              onChangeText={setAmountRequested}
              keyboardType="numeric"
              placeholder="Enter amount in ₹"
              placeholderTextColor="#9ca3af"
            />
          </View>
        );

      // ── Travelling ───────────────────────────────────────────────────────────
      case 'travel_subtype':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Mode of Travel *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={travelSubtype}
                onValueChange={(v) => { setTravelSubtype(v); setAiEstimate(null); setAmountRequested(''); }}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {TRAVEL_SUBTYPES.map((t) => <Picker.Item key={t} label={t} value={t} />)}
              </Picker>
            </View>
          </View>
        );

      case 'travel_route':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Travel Details *</Text>
            <Text style={styles.label}>From *</Text>
            <TextInput
              style={styles.input}
              value={travelFrom}
              onChangeText={setTravelFrom}
              placeholder="e.g. Connaught Place, Delhi"
              placeholderTextColor="#9ca3af"
            />
            <Text style={styles.label}>To *</Text>
            <TextInput
              style={styles.input}
              value={travelTo}
              onChangeText={setTravelTo}
              placeholder="e.g. Bhuj, Gujarat"
              placeholderTextColor="#9ca3af"
            />
            {['Flight', 'Train', 'Bus'].includes(travelSubtype) && (
              <DateInput label="Travel Date" value={travelDate} onChange={setTravelDate} />
            )}
            {travelSubtype === 'Contractual Cab' && (
              <View style={styles.infoBox}>
                <Text style={styles.infoHint}>Rate: ₹12/km (distance fetched from Google Maps)</Text>
              </View>
            )}
          </View>
        );

      case 'travel_amount':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Travel Amount *</Text>

            <TouchableOpacity
              style={[styles.secondaryBtn, estimating && styles.btnDisabled]}
              onPress={handleEstimateTravel}
              disabled={estimating}
            >
              {estimating
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.secondaryBtnText}>
                    {travelSubtype === 'Contractual Cab' ? 'Calculate Distance Cost' : 'Get AI Estimate'}
                  </Text>}
            </TouchableOpacity>

            {aiEstimate && (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Estimate: ₹{aiEstimate.estimatedAmount}
                  {aiEstimate.distanceKm ? ` (${aiEstimate.distanceKm} km)` : ''}
                </Text>
                <Text style={styles.infoHint}>{aiEstimate.reasoning}</Text>
              </View>
            )}

            <Text style={styles.label}>{aiEstimate ? 'Amount (edit if needed) *' : 'Amount (₹) *'}</Text>
            <TextInput
              style={styles.input}
              value={amountRequested}
              onChangeText={(v) => {
                setAmountRequested(v);
                if (aiEstimate && v !== String(aiEstimate.estimatedAmount)) setUserEditedAmount(true);
              }}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#9ca3af"
            />
            {userEditedAmount && aiEstimate && (
              <Text style={styles.deviationNote}>
                Estimate: ₹{aiEstimate.estimatedAmount} | Entered: ₹{amountRequested}
              </Text>
            )}
          </View>
        );

      // ── Conveyance ───────────────────────────────────────────────────────────
      case 'conveyance_mode':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Mode of Conveyance *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={conveyanceMode}
                onValueChange={(v) => { setConveyanceMode(v); setAmountRequested(''); setConveyanceImage(null); }}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {CONVEYANCE_MODES.map((m) => <Picker.Item key={m} label={m} value={m} />)}
              </Picker>
            </View>
          </View>
        );

      case 'conveyance_detail':
        if (conveyanceMode === 'Ola/Rapido/Uber') {
          return (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Attach Ride Receipt *</Text>
              <Text style={styles.stepSubtitle}>
                Take a screenshot of your Ola/Uber/Rapido fare and the AI will read the amount automatically.
              </Text>
              <TouchableOpacity
                style={[styles.secondaryBtn, scanningRide && styles.btnDisabled]}
                onPress={handleScanRideReceipt}
                disabled={scanningRide}
              >
                {scanningRide
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.secondaryBtnText}>📷 Scan Ride Receipt</Text>}
              </TouchableOpacity>
              {conveyanceImage && (
                <Image source={{ uri: conveyanceImage.uri }} style={styles.receiptPreview} resizeMode="contain" />
              )}
              <Text style={styles.label}>Amount (₹) *</Text>
              <TextInput
                style={styles.input}
                value={amountRequested}
                onChangeText={setAmountRequested}
                keyboardType="numeric"
                placeholder="Scanned or enter manually"
                placeholderTextColor="#9ca3af"
              />
            </View>
          );
        }

        if (conveyanceMode === 'Own Vehicle') {
          return (
            <View style={styles.stepContent}>
              <Text style={styles.stepTitle}>Own Vehicle Details *</Text>
              <Text style={styles.label}>Vehicle Type *</Text>
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={vehicleType}
                  onValueChange={(v) => { setVehicleType(v); setOwnVehicleEstimate(null); setAmountRequested(''); }}
                  style={styles.picker}
                  dropdownIconColor="#e8a24a"
                >
                  {OWN_VEHICLE_TYPES.map((v) => <Picker.Item key={v} label={v} value={v} />)}
                </Picker>
              </View>
              <View style={styles.infoBox}>
                <Text style={styles.infoHint}>
                  Rate: ₹{vehicleType === 'Car' ? '10' : '8'}/km
                </Text>
              </View>
              <Text style={styles.label}>From *</Text>
              <TextInput
                style={styles.input}
                value={convFrom}
                onChangeText={setConvFrom}
                placeholder="e.g. Noida Sector 62"
                placeholderTextColor="#9ca3af"
              />
              <Text style={styles.label}>To *</Text>
              <TextInput
                style={styles.input}
                value={convTo}
                onChangeText={setConvTo}
                placeholder="e.g. MAX Hospital, Delhi"
                placeholderTextColor="#9ca3af"
              />
              <TouchableOpacity
                style={[styles.secondaryBtn, estimating && styles.btnDisabled, { marginTop: 12 }]}
                onPress={handleEstimateOwnVehicle}
                disabled={estimating}
              >
                {estimating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.secondaryBtnText}>Calculate Cost</Text>}
              </TouchableOpacity>
              {ownVehicleEstimate && (
                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>{ownVehicleEstimate.reasoning}</Text>
                </View>
              )}
              <Text style={styles.label}>Amount (₹) *</Text>
              <TextInput
                style={styles.input}
                value={amountRequested}
                onChangeText={(v) => { setAmountRequested(v); if (ownVehicleEstimate) setUserEditedAmount(true); }}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#9ca3af"
              />
            </View>
          );
        }

        // Public Transport
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Public Transport Amount *</Text>
            <Text style={styles.stepSubtitle}>Enter the fare you paid for public transport.</Text>
            <Text style={styles.label}>Amount (₹) *</Text>
            <TextInput
              style={styles.input}
              value={amountRequested}
              onChangeText={setAmountRequested}
              keyboardType="numeric"
              placeholder="Enter amount in ₹"
              placeholderTextColor="#9ca3af"
            />
          </View>
        );

      // ── Site Expense / Material Expense — requirement ───────────────────────
      case 'requirement':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>
              {category === 'Site Expense' ? 'Site Expense Requirement *' : 'Material Expense Requirement *'}
            </Text>
            <Text style={styles.stepSubtitle}>
              {category === 'Site Expense'
                ? 'Describe what the site expense is for'
                : 'Describe what material is needed'}
            </Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={requirement}
              onChangeText={setRequirement}
              placeholder={category === 'Site Expense'
                ? 'e.g. Electrical wiring repair, plumbing work...'
                : 'e.g. Cement bags, steel rods, paint...'}
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={4}
            />
          </View>
        );

      // ── Labour ───────────────────────────────────────────────────────────────
      case 'labour_sub':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Labour Expense Type *</Text>
            <View style={styles.pickerWrapper}>
              <Picker
                selectedValue={labourSub}
                onValueChange={setLabourSub}
                style={styles.picker}
                dropdownIconColor="#e8a24a"
              >
                {LABOUR_SUBCATEGORIES.map((s) => <Picker.Item key={s} label={s} value={s} />)}
              </Picker>
            </View>
          </View>
        );

      // ── Purpose ──────────────────────────────────────────────────────────────
      case 'purpose':
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Purpose / Notes *</Text>
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

      // ── Review & Submit ──────────────────────────────────────────────────────
      case 'review': {
        const effectiveRate = site === 'Others' ? parseFloat(customFoodRate) || 0 : foodRate;
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Review & Submit</Text>
            <View style={styles.summaryCard}>
              <SummaryRow label="Site" value={site === 'Others' ? customSite.trim() : site} />
              <SummaryRow label="Category" value={category} />
              {category !== 'Conveyance' && <SummaryRow label="People" value={peopleCount} />}
              {['Food Expense', 'Site Room Rent', 'Hotel Expense'].includes(category) && (dateFrom || dateTo) && (
                <SummaryRow label="Duration" value={`${dateFrom} → ${dateTo} (${daysBetween(dateFrom, dateTo)} days)`} />
              )}
              {category === 'Travelling' && travelFrom && (
                <SummaryRow label="Route" value={`${travelFrom} → ${travelTo}`} />
              )}
              {category === 'Travelling' && travelDate && (
                <SummaryRow label="Travel Date" value={travelDate} />
              )}
              {category === 'Travelling' && (
                <SummaryRow label="Mode" value={travelSubtype} />
              )}
              {category === 'Conveyance' && (
                <SummaryRow label="Mode" value={conveyanceMode} />
              )}
              {conveyanceMode === 'Own Vehicle' && vehicleType && (
                <SummaryRow label="Vehicle" value={vehicleType} />
              )}
              {category === 'Labour Expense' && (
                <SummaryRow label="Sub-type" value={labourSub} />
              )}
              {['Site Expense', 'Material Expense'].includes(category) && requirement && (
                <SummaryRow label="Requirement" value={requirement} />
              )}
              {category === 'Food Expense' && effectiveRate > 0 && (
                <SummaryRow label="Rate/person/day" value={`₹${effectiveRate}`} />
              )}
              <SummaryRow label="Amount" value={`₹${amountRequested}`} highlight />
              {purpose ? <SummaryRow label="Purpose" value={purpose} /> : null}
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
      }

      default:
        return null;
    }
  };

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.progressBg}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <Text style={styles.stepCounter}>Step {stepIndex + 1} of {totalSteps}</Text>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {renderStep()}
      </ScrollView>

      {stepIndex > 0 && currentStep !== 'review' && (
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleNext}>
            <Text style={styles.primaryBtnText}>Next →</Text>
          </TouchableOpacity>
        </View>
      )}
      {currentStep === 'review' && (
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
  stepSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 16, lineHeight: 20 },
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

  infoBox: { backgroundColor: '#fef3c7', borderRadius: 8, padding: 12, marginTop: 12 },
  infoText: { fontSize: 14, fontWeight: '600', color: '#92400e' },
  infoHint: { fontSize: 12, color: '#b45309', marginTop: 4 },

  deviationNote: { fontSize: 12, color: '#3b82f6', marginTop: 6, fontStyle: 'italic' },
  errorText: { color: '#ef4444', fontSize: 13, marginTop: 8 },

  receiptPreview: { width: '100%', height: 180, borderRadius: 8, marginTop: 12, borderWidth: 1, borderColor: '#e5e7eb' },

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

  resultCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  resultIcon: { fontSize: 56, marginBottom: 16 },
  resultTitle: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 8 },
  resultRef: { fontSize: 16, color: '#e8a24a', fontWeight: '700', marginBottom: 12 },
  resultMessage: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 32, lineHeight: 20 },

  // Requested To step — radio card styles
  optionCard: {
    borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 12,
    padding: 16, marginBottom: 12, backgroundColor: '#fff',
  },
  optionCardSelected: {
    borderColor: '#e8a24a', backgroundColor: '#fffbeb',
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: '#e8a24a' },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#e8a24a' },
  optionLabel: { fontSize: 16, fontWeight: '600', color: '#374151' },
  optionLabelSelected: { color: '#92400e' },
  optionHint: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
});
