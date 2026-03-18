import { View, Text, StyleSheet } from 'react-native';
import { STATUS_LABELS, STATUS_COLOURS } from '../constants';

export default function StatusBadge({ status }) {
  const colour = STATUS_COLOURS[status] || '#6b7280';
  const label = STATUS_LABELS[status] || status;

  return (
    <View style={[styles.badge, { backgroundColor: colour + '20', borderColor: colour + '40' }]}>
      <Text style={[styles.text, { color: colour }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
