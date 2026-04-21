import { useState, useCallback, useRef } from 'react';
import { View, TextInput, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import api from '../services/api';

/**
 * Google Places Autocomplete input component.
 * Fetches suggestions from backend proxy and shows a dropdown.
 */
export default function PlacesInput({ value, onChangeText, placeholder, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef(null);

  const fetchSuggestions = useCallback(async (input) => {
    if (!input || input.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get('/api/imprest/places-autocomplete', { params: { input } });
      const items = data?.data || [];
      setSuggestions(items);
      setShowDropdown(items.length > 0);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChangeText = (text) => {
    onChangeText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(text), 300);
  };

  const handleSelect = (item) => {
    onChangeText(item.description);
    setSuggestions([]);
    setShowDropdown(false);
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.inputRow}>
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          style={styles.input}
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        />
        {loading && <ActivityIndicator size="small" color="#e8a24a" style={styles.loader} />}
      </View>
      {showDropdown && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          {suggestions.map((item, idx) => (
            <TouchableOpacity
              key={item.place_id || idx}
              style={[styles.suggestion, idx < suggestions.length - 1 && styles.suggestionBorder]}
              onPress={() => handleSelect(item)}
            >
              <Text style={styles.suggestionText} numberOfLines={2}>{item.description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative', zIndex: 10 },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fff',
  },
  loader: { position: 'absolute', right: 12 },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    maxHeight: 200,
    zIndex: 999,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  suggestionText: { flex: 1, fontSize: 14, color: '#374151' },
});
