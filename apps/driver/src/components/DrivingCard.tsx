// Round 50 (docs/phase8-plan.md §37.4): Driving mode for an office person who drives a trip of their own (Uber's driver
// mode switch: one account, the office side and the driver side). On Today the card stands where a driver's duty tiles
// are (no Start work / Finish work for them): "Driving mode", what it records (the location only during a trip; "Sharing
// location until this trip ends" while one runs), and Back to office. Me has the same Back to office in place of Sign out.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ArrowLeft, Radio, Van } from '@/components/icons';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Button, Txt } from '@/components/ui';
import { tripRunning } from '@/lib/drivingMode';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** Back to office: Office mode in front; a trip still running (or its data still waiting) is said once in the snackbar. */
export function useBackToOffice(): { busy: boolean; back: () => Promise<void> } {
  const app = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function back() {
    if (busy) return;
    setBusy(true);
    const running = tripRunning(app.tasks);
    const outcome = await app.leaveDriving();
    setBusy(false);
    router.replace('/office');
    if (outcome === 'keep') showSnackbar({ text: app.t(running ? 'driving.stillRunning' : 'driving.waitingToSend') });
  }
  return { busy, back };
}

export function DrivingCard() {
  const { t, sharing, tasks } = useApp();
  const { busy, back } = useBackToOffice();
  const live = sharing && tripRunning(tasks);
  return (
    <View style={[styles.card, live ? styles.live : styles.quiet]} testID="driving-card">
      <View style={styles.top}>
        {live ? <Radio size={22} color="#ffffff" strokeWidth={2} /> : <Van size={22} color={colors.iconInk} strokeWidth={2} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="strong" size={16} color={live ? '#ffffff' : colors.ink}>{t('driving.banner')}</Txt>
          <Txt variant="small" size={13} color={live ? colors.onBlueSoft : colors.muted} testID="driving-card-line">
            {t(live ? 'driving.sharingUntil' : 'driving.bannerLine')}
          </Txt>
        </View>
      </View>
      <Button compact kind={live ? 'outline' : 'dark'} icon={ArrowLeft} label={t('driving.backToOffice')} busy={busy} onPress={() => void back()} testID="driving-back" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 14, gap: 12 },
  live: { backgroundColor: colors.blue },
  quiet: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardLine },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
