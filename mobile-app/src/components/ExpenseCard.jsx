import { View, Text, StyleSheet } from 'react-native';
import StatusBadge from './StatusBadge';

export default function ExpenseCard({ expense }) {
  const dateStr = new Date(expense.submitted_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.refId}>{expense.ref_id}</Text>
        <Text style={styles.amount}>₹{Number(expense.amount).toLocaleString('en-IN')}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.meta}>{expense.category} · {expense.site}</Text>
        <Text style={styles.date}>{dateStr}</Text>
      </View>
      {expense.description ? (
        <Text style={styles.description} numberOfLines={1}>{expense.description}</Text>
      ) : null}
      <View style={styles.footer}>
        <StatusBadge status={expense.status} />
        {expense.duplicate_flag && (
          <Text style={styles.dupWarning}>⚠ Duplicate flagged</Text>
        )}
      </View>
      {expense.rejection_reason && (
        <Text style={styles.rejectionReason}>Reason: {expense.rejection_reason}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  refId: { fontSize: 12, fontFamily: 'monospace', color: '#6b7280' },
  amount: { fontSize: 18, fontWeight: '700', color: '#111827' },
  meta: { fontSize: 13, color: '#6b7280' },
  date: { fontSize: 12, color: '#9ca3af' },
  description: { fontSize: 13, color: '#4b5563', marginTop: 4, marginBottom: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  dupWarning: { fontSize: 11, color: '#f97316', fontWeight: '600' },
  rejectionReason: { fontSize: 12, color: '#ef4444', marginTop: 8, fontStyle: 'italic' },
});
