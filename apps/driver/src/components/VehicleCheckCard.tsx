// Round 4–7 (§33.1): "Vehicle check · WP CAB-4521" with a big Check now, while a vehicle the driver takes needs its check
// (lib/vehicleCheck.ts needsCheck). On Today for the vehicle held on duty; on Start task (app/log-mileage.tsx) in place of
// the odometer step, when the driver came back from the check without answering it. Check now opens the one screen that
// asks it (app/vehicle-check.tsx), pushed on top: back from it returns here.

import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ShieldCheck } from '@/components/icons';
import { PlateText } from '@/components/PlateText';
import { Button, Txt } from '@/components/ui';
import type { CheckHow } from '@/lib/vehicleCheck';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function VehicleCheckCard({ vehicleId, how, taskId = null, body = 'vehicleCheck.cardBody' }: {
  vehicleId: string;
  /** How the vehicle was taken (the check records it). */
  how: CheckHow;
  /** The task the check is for (Start task), if any. */
  taskId?: string | null;
  /** The line under the title (Today: check it before you drive; Start task: the start waits for it). */
  body?: 'vehicleCheck.cardBody' | 'vehicleCheck.startWaits';
}) {
  const { t, vehicles } = useApp();
  const router = useRouter();
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const open = () => router.push({ pathname: '/vehicle-check', params: { vehicleId, how, ...(taskId ? { taskId } : {}) } });
  return (
    <View style={styles.card} testID="vehicle-check-card">
      <View style={styles.top}>
        <ShieldCheck size={26} color={colors.amberText} strokeWidth={2.4} />
        <View style={{ flex: 1 }}>
          <PlateText text={t('vehicleCheck.cardTitle')} plate={vehicle?.reg_no ?? '–'} variant="big" />
        </View>
      </View>
      {vehicle?.make_model && <Txt variant="muted">{vehicle.make_model}</Txt>}
      <Txt variant="body">{t(body)}</Txt>
      <Button label={t('vehicleCheck.checkNow')} icon={ShieldCheck} onPress={open} testID="vehicle-check-now" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 2.5, borderColor: colors.amber, borderRadius: 22, padding: 20, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
