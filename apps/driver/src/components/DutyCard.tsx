// The driver's day on Today (Phase 7, docs/phase7-plan.md §1 and §2): in place of the
// old "On duty" switch, the header says whether the driver is at work.
//   Off duty: a big Start work (it opens the vehicle picker in start mode).
//   On duty:  "On duty since 08:12 · WP CAB-4521 · Office can see you", Change vehicle and
//             Finish work (not offered while a task is in progress).
// Under the header, two notices: another driver took my vehicle (tap → choose one), and the
// server ended my duty (the day's cut-off or the office).

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Play, X } from '@/components/icons';
import { Button, Plate, Txt } from '@/components/ui';
import { colomboTime } from '@/lib/time';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** The duty part of Today's dark header. */
export function DutyHeader() {
  const { t, sharing, dutySince, vehicle, tasks, finishWork } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [taskFirst, setTaskFirst] = useState(false);
  const taskRunning = tasks.some((task) => task.status === 'in_progress');

  if (!sharing) {
    return (
      <View style={styles.box}>
        <View style={styles.line}>
          <View style={[styles.halo, { backgroundColor: '#3a4047' }]}>
            <View style={[styles.dot, { backgroundColor: '#8b9198' }]} />
          </View>
          <Txt variant="big" color="#ffffff">{t('duty.offDuty')}</Txt>
        </View>
        <Txt variant="muted" color="#b9bec4">{t('duty.offDutyHint')}</Txt>
        <Button
          label={t('duty.startWork')}
          icon={Play}
          onPress={() => router.push({ pathname: '/vehicle', params: { mode: 'start' } })}
        />
      </View>
    );
  }

  function confirmFinish() {
    setTaskFirst(false);
    Alert.alert(t('duty.finishConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('duty.finishConfirmYes'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const outcome = await finishWork();
          setBusy(false);
          setTaskFirst(outcome === 'task');
        },
      },
    ]);
  }

  return (
    <View style={styles.box}>
      <View style={[styles.line, { flexWrap: 'wrap' }]}>
        <View style={styles.halo}>
          <View style={styles.dot} />
        </View>
        <Txt variant="strong" color="#ffffff">
          {dutySince ? t('duty.onDutySince', { time: colomboTime(dutySince) }) : t('today.sharing')}
        </Txt>
        <Txt variant="strong" color="#8b9198">·</Txt>
        {vehicle ? <Plate regNo={vehicle.reg_no} dark /> : <Txt variant="strong" color="#ffffff">{t('duty.noVehicle')}</Txt>}
        <Txt variant="strong" color="#8b9198">·</Txt>
        <Txt variant="body" color="#b9bec4">{t('duty.officeCanSee')}</Txt>
      </View>
      {vehicle?.make_model && <Txt variant="muted" color="#b9bec4">{vehicle.make_model}</Txt>}
      <View style={styles.buttons}>
        <Button
          kind="dark"
          label={t('vehicle.change')}
          onPress={() => router.push({ pathname: '/vehicle', params: { mode: 'change' } })}
          style={styles.ghost}
        />
        {!taskRunning && <Button kind="dark" label={t('duty.finishWork')} busy={busy} onPress={confirmFinish} style={styles.ghost} />}
      </View>
      {(taskRunning || taskFirst) && <Txt variant="muted" color="#b9bec4">{t('duty.finishTaskFirst')}</Txt>}
    </View>
  );
}

/** The notices about the driver's day under the header: a vehicle taken over, a duty ended by the server. */
export function DutyNotices() {
  const { t, vehicleTaken, dismissVehicleTaken, dutyEnded, clearDutyEnded } = useApp();
  const router = useRouter();
  const ended = dutyEnded && dutyEnded.reason !== 'driver' ? dutyEnded : null;
  if (!vehicleTaken && !ended) return null;
  return (
    <>
      {vehicleTaken && (
        <View style={styles.notice}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/vehicle', params: { mode: 'change' } })}
            style={{ flex: 1 }}
          >
            <Txt variant="strong" size={16} color={colors.amberText}>
              {t('vehicle.takenBanner', { plate: vehicleTaken.plate, name: vehicleTaken.name })}
            </Txt>
          </Pressable>
          <Close label={t('common.ok')} onPress={dismissVehicleTaken} />
        </View>
      )}
      {ended && (
        <View style={styles.notice}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="strong" size={16} color={colors.amberText}>{t('duty.autoOutTitle')}</Txt>
            <Txt variant="body" size={15} color={colors.ink}>
              {t(ended.reason === 'admin' ? 'duty.officeOutBody' : 'duty.autoOutBody', { time: colomboTime(ended.at) })}
            </Txt>
          </View>
          <Close label={t('common.ok')} onPress={clearDutyEnded} />
        </View>
      )}
    </>
  );
}

function Close({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={styles.close}>
      <X size={22} color={colors.amberText} strokeWidth={2.6} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.darkSurface, borderRadius: 14, padding: 16, gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // The blue "live" dot of the design's sharing card.
  halo: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 13, height: 13, borderRadius: 7, backgroundColor: colors.blue },
  buttons: { flexDirection: 'row', gap: 10 },
  // A secondary button on the dark header: white words, a thin light border.
  ghost: { flex: 1, minHeight: 56, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#5a6068' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 12, paddingLeft: 14, paddingRight: 6, backgroundColor: '#fdf1d6' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
