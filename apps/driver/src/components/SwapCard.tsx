// The vehicle swap during a task (Phase 7 Part 2, docs/phase7-plan.md §2): the office moved the running task to
// another vehicle (a breakdown). The task screen shows this card until both readings are in: the old vehicle's end
// and the new vehicle's start. Each button opens Log mileage on top of the task screen (the usual odometer photo
// flow, mode swap_end / swap_start); after Save it comes back here and the row says "Logged ✓ 10,040 km". When
// both are logged (by the driver or typed by the office) the card goes.

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChevronRight, Gauge } from '@/components/icons';
import { PlateText } from '@/components/PlateText';
import { splitAtPlate, stretches, swapCard } from '@/components/taskLines';
import { Mono, Txt } from '@/components/ui';
import { thousands } from '@/lib/format';
import type { TaskWithStops, Vehicle } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** A vehicle's plate, or a dash when the phone does not know the vehicle (switched off since). */
export function plateOf(vehicles: Vehicle[], id: string): string {
  return vehicles.find((item) => item.id === id)?.reg_no ?? '–';
}

export function SwapCard({ task }: { task: TaskWithStops }) {
  const { t, vehicles } = useApp();
  const router = useRouter();
  const card = swapCard(task);
  if (!card) return null;
  const newPlate = plateOf(vehicles, card.newVehicleId);
  const oldPlate = plateOf(vehicles, card.oldVehicleId);
  const body = splitAtPlate(t('swap.body'));
  const open = (mode: 'swap_end' | 'swap_start', vehicleId: string) =>
    router.push({ pathname: '/log-mileage', params: { mode, taskId: task.id, vehicleId } });

  return (
    <View style={styles.card}>
      <PlateText text={t('swap.title')} plate={newPlate} variant="big" color={colors.amberText} />
      {body ? (
        <Txt variant="body">
          {body.before}
          <Mono bold>{newPlate}</Mono>
          {body.after}
        </Txt>
      ) : (
        <Txt variant="body">{t('swap.body', { plate: newPlate })}</Txt>
      )}
      <Reading label={t('swap.oldEnd')} plate={oldPlate} km={card.oldEnd.owed ? undefined : card.oldEnd.km} onPress={() => open('swap_end', card.oldVehicleId)} />
      <Reading label={t('swap.newStart')} plate={newPlate} km={card.newStart.owed ? undefined : card.newStart.km} onPress={() => open('swap_start', card.newVehicleId)} />
    </View>
  );
}

/** One reading: a big button while it is owed (km undefined), else "Logged ✓ 10,040 km". */
function Reading({ label, plate, km, onPress }: { label: string; plate: string; km: number | null | undefined; onPress: () => void }) {
  const { t } = useApp();
  if (km !== undefined) {
    return (
      <View style={[styles.reading, styles.logged]}>
        <View style={{ flex: 1, gap: 4 }}>
          <PlateText text={label} plate={plate} />
          {km !== null && <Txt variant="strong" color={colors.blue}>{t('swap.logged', { km: thousands(km) })}</Txt>}
        </View>
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.reading, styles.owed, pressed && { opacity: 0.8 }]}>
      <Gauge size={24} color={colors.ink} strokeWidth={2.4} />
      <View style={{ flex: 1 }}>
        <PlateText text={label} plate={plate} variant="button" color={colors.ink} />
      </View>
      <ChevronRight size={24} color={colors.ink} strokeWidth={2.4} />
    </Pressable>
  );
}

/** Each vehicle's km on a task after a swap: "40 km in WP CAB-4521", one line each; nothing without a swap. */
export function Stretches({ task, size }: { task: TaskWithStops; size?: number }) {
  const { t, vehicles } = useApp();
  const list = stretches(task);
  if (list.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      {list.map((item, index) => (
        <PlateText key={`${item.vehicleId}-${index}`} text={t('swap.stretches', { km: thousands(item.km) })} plate={plateOf(vehicles, item.vehicleId)} size={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, borderWidth: 2.5, borderColor: colors.amber, borderRadius: 18, padding: 16, backgroundColor: colors.card },
  reading: { minHeight: 64, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  owed: { backgroundColor: colors.amber },
  logged: { backgroundColor: colors.blueChip },
});
