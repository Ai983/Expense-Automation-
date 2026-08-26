import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import StatusBadge from './StatusBadge';

export default function ExpenseCard({ expense, onFix }) {
  // The auditor handed this back to the employee to correct. It is deliberately
  // NOT in the finance queue while this is set — it is theirs to fix.
  const awaitingFix = expense.awaiting_fix_until
    && new Date(expense.awaiting_fix_until) > new Date();
  const dateStr = new Date(expense.submitted_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const claimed = expense.original_amount ? parseFloat(expense.original_amount) : null;
  const approved = parseFloat(expense.amount);
  const isReduced = claimed != null && expense.status === 'approved' && claimed - approved > 0.01;
  const notReimbursed = isReduced ? Math.round((claimed - approved) * 100) / 100 : 0;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.refId}>{expense.ref_id}</Text>
        {isReduced ? (
          <View style={styles.amountBlock}>
            <Text style={styles.amountStruck}>₹{claimed.toLocaleString('en-IN')}</Text>
            <Text style={styles.amountApproved}>₹{approved.toLocaleString('en-IN')}</Text>
          </View>
        ) : (
          <Text style={styles.amount}>₹{approved.toLocaleString('en-IN')}</Text>
        )}
      </View>
      <View style={styles.row}>
        <Text style={styles.meta}>{expense.category} · {expense.site}</Text>
        <Text style={styles.date}>{dateStr}</Text>
      </View>
      {expense.description ? (
        <Text style={styles.description} numberOfLines={1}>{expense.description}</Text>
      ) : null}
      <View style={styles.footer}>
        {awaitingFix ? (
          <View style={styles.fixBadge}><Text style={styles.fixBadgeText}>📸 Needs your correction</Text></View>
        ) : (
          <StatusBadge status={expense.status} />
        )}
        {expense.duplicate_flag && !awaitingFix && (
          <Text style={styles.dupWarning}>⚠ Duplicate flagged</Text>
        )}
      </View>

      {awaitingFix && (
        <View style={styles.fixBox}>
          <Text style={styles.fixReason}>{expense.fix_request_reason}</Text>
          <Text style={styles.fixDeadline}>
            Please correct by {new Date(expense.awaiting_fix_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
          {onFix && (
            <TouchableOpacity style={styles.fixButton} onPress={() => onFix(expense)}>
              <Text style={styles.fixButtonText}>Replace Receipt</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.fixHint}>Update this expense — do not submit a new one.</Text>
        </View>
      )}
      {isReduced && (
        <View style={styles.adjustmentBanner}>
          <Text style={styles.adjustmentTitle}>Amount adjusted by finance</Text>
          <Text style={styles.adjustmentDetail}>
            Claimed ₹{claimed.toLocaleString('en-IN')} — Approved ₹{approved.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.adjustmentWarning}>
            ₹{notReimbursed.toLocaleString('en-IN')} not reimbursed — please settle this amount separately.
          </Text>
        </View>
      )}
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
  amountBlock: { alignItems: 'flex-end' },
  amountStruck: { fontSize: 12, color: '#9ca3af', textDecorationLine: 'line-through' },
  amountApproved: { fontSize: 18, fontWeight: '700', color: '#16a34a' },
  meta: { fontSize: 13, color: '#6b7280' },
  date: { fontSize: 12, color: '#9ca3af' },
  description: { fontSize: 13, color: '#4b5563', marginTop: 4, marginBottom: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  dupWarning: { fontSize: 11, color: '#f97316', fontWeight: '600' },
  adjustmentBanner: {
    marginTop: 10,
    backgroundColor: '#fff7ed',
    borderLeftWidth: 3,
    borderLeftColor: '#f97316',
    borderRadius: 6,
    padding: 10,
  },
  adjustmentTitle: { fontSize: 12, fontWeight: '700', color: '#c2410c', marginBottom: 2 },
  adjustmentDetail: { fontSize: 12, color: '#374151', marginBottom: 4 },
  adjustmentWarning: { fontSize: 12, color: '#b45309', fontWeight: '600' },
  rejectionReason: { fontSize: 12, color: '#ef4444', marginTop: 8, fontStyle: 'italic' },
  fixBadge: { backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  fixBadgeText: { fontSize: 12, fontWeight: '700', color: '#92400e' },
  fixBox: { marginTop: 10, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 10, padding: 12 },
  fixReason: { fontSize: 13, color: '#78350f', lineHeight: 19 },
  fixDeadline: { fontSize: 12, color: '#b45309', marginTop: 6, fontWeight: '600' },
  fixButton: { backgroundColor: '#e8a24a', borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  fixButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  fixHint: { fontSize: 11, color: '#a16207', marginTop: 6, textAlign: 'center' },
});
