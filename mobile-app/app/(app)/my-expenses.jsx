import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Alert, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/context/AuthContext';
import { getMyExpenses, fixExpense } from '../../src/services/expenseService';
import ExpenseCard from '../../src/components/ExpenseCard';

export default function MyExpensesScreen() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const [fixingId, setFixingId] = useState(null);
  const { user } = useAuth();

  const fetchExpenses = useCallback(async (showRefresh = false) => {
    if (!user) return;
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await getMyExpenses(user.id);
      setExpenses(data.expenses || []);
      setTotal(data.total || 0);
    } catch {
      // Silently fail — user sees empty list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  function notify(title, message) {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  }

  // Replaces the receipt on the SAME expense. Submitting a fresh one instead is
  // what creates duplicate rows and blocks the corrected version.
  const handleFix = useCallback(async (expense) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return notify('Permission', 'Gallery access is required');

      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
        allowsMultipleSelection: true,
      });
      if (picked.canceled || !picked.assets?.length) return;

      setFixingId(expense.id);
      await fixExpense(
        expense.id,
        picked.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType || 'image/jpeg' }))
      );
      notify('Thank you', 'Your corrected receipt is being checked. You do not need to do anything else.');
      fetchExpenses(true);
    } catch (err) {
      notify('Could Not Update', err.response?.data?.error || 'Please check your connection and try again.');
    } finally {
      setFixingId(null);
    }
  }, [fetchExpenses]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#e8a24a" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.total}>{total} total expense{total !== 1 ? 's' : ''}</Text>
      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ExpenseCard
            expense={item}
            onFix={fixingId === item.id ? null : handleFix}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchExpenses(true)}
            tintColor="#e8a24a"
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No expenses yet.</Text>
            <Text style={styles.emptyHint}>Submit your first expense from the Submit tab.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  total: { fontSize: 13, color: '#6b7280', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  list: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 8 },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },
});
