import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { getMyImprestRequests } from '../../src/services/imprestService';
import { IMPREST_STATUS_LABELS, IMPREST_STATUS_COLOURS } from '../../src/constants';

export default function MyImprestScreen() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const { user } = useAuth();

  const fetchRequests = useCallback(async (showRefresh = false) => {
    if (!user) return;
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await getMyImprestRequests(user.id);
      setRequests(data.requests || []);
      setTotal(data.total || 0);
    } catch {
      // Silently fail — user sees empty list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#e8a24a" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>My Imprest / मेरे अग्रिम</Text>
      </View>
      <Text style={styles.total}>{total} total request{total !== 1 ? 's' : ''}</Text>
      <FlatList
        data={requests}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ImprestCard request={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchRequests(true)}
            tintColor="#e8a24a"
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No imprest requests yet. / अभी कोई अग्रिम नहीं है</Text>
            <Text style={styles.emptyHint}>Submit your first advance from the Imprest tab. / इम्प्रेस्ट टैब से अपना पहला अग्रिम जमा करें</Text>
          </View>
        }
      />
    </View>
  );
}

const STAGE_LABELS = {
  's1_pending': 'Under Review',
  's1_approved': 'Forwarded',
  's2_pending': 'Awaiting Approval',
  's2_approved': 'Approved',
  's2_rejected': 'Rejected',
  's3_pending': 'With Finance',
  's3_approved': 'Approved - Payment Pending',
  's3_rejected': 'Rejected by Finance',
  'director_rejected': 'Rejected by Director',
  'paid': 'Paid',
};
const STAGE_COLOURS = {
  's1_pending': '#f59e0b',
  's2_pending': '#f97316',
  's3_pending': '#3b82f6',
  's3_approved': '#10b981',
  'paid': '#16a34a',
  'director_rejected': '#ef4444',
  's3_rejected': '#ef4444',
  's2_rejected': '#ef4444',
};

function ImprestCard({ request }) {
  const stage = request.current_stage;
  const statusLabel = stage ? (STAGE_LABELS[stage] || stage) : (IMPREST_STATUS_LABELS[request.status] || request.status);
  const statusColor = stage ? (STAGE_COLOURS[stage] || '#9ca3af') : (IMPREST_STATUS_COLOURS[request.status] || '#9ca3af');
  const submittedDate = new Date(request.submitted_at).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: statusColor }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.refId}>{request.ref_id}</Text>
        <View style={[styles.badge, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      <Text style={styles.category}>{request.category}</Text>
      <Text style={styles.site}>{request.site}</Text>

      <View style={styles.cardFooter}>
        <Text style={styles.amount}>₹{Number(request.amount_requested).toLocaleString('en-IN')}</Text>
        {(request.status === 'approved' || request.status === 'partially_approved') && request.approved_amount && (
          <Text style={[styles.approvedAmount, request.status === 'approved' && { color: '#16a34a' }]}>
            Approved: ₹{Number(request.approved_amount).toLocaleString('en-IN')}
          </Text>
        )}
        <Text style={styles.date}>{submittedDate}</Text>
      </View>

      {request.paid && request.paid_amount && (
        <Text style={[styles.approvedAmount, { color: '#16a34a', marginTop: 4 }]}>
          Paid: ₹{Number(request.paid_amount).toLocaleString('en-IN')}
        </Text>
      )}
      {request.status === 'rejected' && request.rejection_reason && (
        <Text style={styles.rejectionReason}>Reason: {request.rejection_reason}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  headerBar: { backgroundColor: '#e8a24a', paddingVertical: 14, paddingHorizontal: 20 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  total: { fontSize: 13, color: '#6b7280', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  list: { padding: 20, paddingTop: 8, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151', marginBottom: 8 },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6,
  },
  refId: { fontSize: 13, fontWeight: '700', color: '#e8a24a' },
  badge: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },

  category: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 2 },
  site: { fontSize: 12, color: '#6b7280', marginBottom: 10 },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { fontSize: 16, fontWeight: '700', color: '#111827' },
  approvedAmount: { fontSize: 12, color: '#3b82f6', fontWeight: '600' },
  date: { fontSize: 12, color: '#9ca3af' },

  rejectionReason: {
    marginTop: 8, fontSize: 12, color: '#ef4444', fontStyle: 'italic',
    paddingTop: 8, borderTopWidth: 1, borderTopColor: '#fee2e2',
  },
});
