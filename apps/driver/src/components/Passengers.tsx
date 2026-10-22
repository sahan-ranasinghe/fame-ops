// Round 4–7, feature 6 (docs/phase8-plan.md §33.3): who rides on the task, on the task screen and its preview: each
// passenger's name with a round Call for those with a phone (the dialler opens with the number filled; nothing dials by
// itself, as lib/contacts.ts). The count line ("5 passengers") stays where it was; nothing with the switch passengers
// off. The names come with the task (lib/api.ts fetchTasks), so they show offline from the copy on the phone.

import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Phone, User } from '@/components/icons';
import { Txt } from '@/components/ui';
import { passengerRows } from '@/lib/passengers';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function PassengerList({ task, calls = true }: { task: TaskWithStops; calls?: boolean }) {
  const { t, settings } = useApp();
  const rows = passengerRows(task.task_passengers, settings.passengers);
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 6 }} testID="passenger-list">
      <Txt variant="label" color={colors.muted}>{t('pax.title')}</Txt>
      {rows.map((p) => (
        <View key={p.id} style={styles.row}>
          <View style={styles.icon}><User size={18} color={colors.ink} /></View>
          <View style={{ flex: 1 }}>
            <Txt variant="strong" numberOfLines={1}>{p.name}</Txt>
            {p.display ? <Txt variant="small">{p.display}</Txt> : null}
          </View>
          {calls && p.tel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('pax.call', { name: p.name })}
              onPress={() => void Linking.openURL(p.tel as string).catch(() => undefined)}
              hitSlop={6}
              style={({ pressed }) => [styles.call, pressed && { opacity: 0.8 }]}
              testID="passenger-call"
            >
              <Phone size={20} color="#ffffff" strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.page, alignItems: 'center', justifyContent: 'center' },
  call: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
});
