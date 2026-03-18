import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { getMyExpenses } from '../../src/services/expenseService';
import ExpenseCard from '../../src/components/ExpenseCard';

export default function MyExpensesScreen() {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
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
        renderItem={({ item }) => <ExpenseCard expense={item} />}
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
