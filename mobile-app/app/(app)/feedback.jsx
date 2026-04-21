import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import api from '../../src/services/api';

function showAlert(title, message) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function FeedbackScreen() {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (rating === 0 && !comment.trim()) {
      return showAlert('Feedback Required', 'Please provide a rating or write your feedback.');
    }

    setLoading(true);
    try {
      const body = {};
      if (rating > 0) body.rating = rating;
      if (comment.trim()) body.comment = comment.trim();
      await api.post('/api/feedback', body);
      setSubmitted(true);
      showAlert('Thank You!', 'Your feedback has been submitted successfully.');
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to submit feedback. Please try again.';
      showAlert('Error', msg);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setRating(0);
    setComment('');
    setSubmitted(false);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.heading}>Share Your Feedback</Text>
          <Text style={styles.subheading}>Help us improve the app experience</Text>

          {submitted ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>Your feedback has been submitted!</Text>
              <TouchableOpacity style={styles.btn} onPress={resetForm}>
                <Text style={styles.btnText}>Submit Another</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Star Rating */}
              <Text style={styles.label}>Rating</Text>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity key={star} onPress={() => setRating(star)} style={styles.starBtn}>
                    <Text style={[styles.star, star <= rating && styles.starFilled]}>
                      {star <= rating ? '\u2605' : '\u2606'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {rating > 0 && (
                <Text style={styles.ratingLabel}>
                  {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
                </Text>
              )}

              {/* Comment */}
              <Text style={styles.label}>Your Feedback</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Tell us what you think..."
                placeholderTextColor="#9ca3af"
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleSubmit}
                disabled={loading}
              >
                <Text style={styles.btnText}>{loading ? 'Submitting...' : 'Submit Feedback'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  inner: { flexGrow: 1, padding: 16, paddingTop: 8 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  heading: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  subheading: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 4, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 16 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  starBtn: { padding: 4 },
  star: { fontSize: 36, color: '#d1d5db' },
  starFilled: { color: '#e8a24a' },
  ratingLabel: { textAlign: 'center', fontSize: 13, color: '#e8a24a', fontWeight: '600', marginTop: 4 },
  textArea: {
    borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#111827', backgroundColor: '#fafafa',
    minHeight: 120,
  },
  btn: {
    backgroundColor: '#e8a24a', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginTop: 24,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  successBox: { alignItems: 'center', paddingVertical: 32 },
  successText: { fontSize: 16, fontWeight: '600', color: '#059669', marginBottom: 20 },
});
