// The warning about location sharing, shown on Today and on a task in
// progress: location switched off, permission missing, battery saving, a
// task running without sharing, or "it had stopped and is running again".

import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Txt } from '@/components/ui';
import { openLocationSettings } from '@/lib/settingsLinks';
import { colomboTime } from '@/lib/time';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

type Tone = 'danger' | 'warn' | 'info';

const TONE: Record<Tone, { text: string; background: string }> = {
  danger: { text: colors.red, background: '#fbeceb' },
  warn: { text: colors.amberText, background: '#fdf1d6' },
  info: { text: colors.blue, background: colors.blueChip },
};

export function TrackingNotice() {
  const { t, sharing, tracking, tasks, startWork } = useApp();
  const router = useRouter();
  const running = tasks.find((task) => task.status === 'in_progress');
  const taskRunning = running !== undefined;

  let tone: Tone;
  let text: string;
  let action: { label: string; onPress: () => void } | null = null;

  if (!sharing) {
    if (!taskRunning) return null;
    tone = 'danger';
    text = t('tracking.taskNotSharing');
    action = {
      label: t('tracking.shareNow'),
      // Phase 7: back on duty with the task's vehicle (a duty session; the server already holds it from the task's start).
      onPress: () => void startWork(running?.vehicle_id ?? null).then((result) => result === 'no_permission' && router.push('/permissions')),
    };
  } else if (tracking.problem === 'location_off') {
    tone = 'danger';
    text = t('tracking.locationOff');
    action = { label: t('tracking.turnOnLocation'), onPress: () => void openLocationSettings() };
  } else if (tracking.problem === 'no_permission') {
    tone = 'danger';
    text = t('tracking.noPermission');
    action = { label: t('tracking.fix'), onPress: () => router.push('/permissions') };
  } else if (tracking.problem === 'no_background') {
    tone = 'danger';
    text = t('tracking.noBackground');
    action = { label: t('tracking.fix'), onPress: () => router.push('/permissions') };
  } else if (tracking.problem === 'battery') {
    tone = 'warn';
    text = t('tracking.battery');
    action = { label: t('tracking.fix'), onPress: () => router.push('/permissions') };
  } else if (tracking.restarted) {
    tone = 'info';
    text = t('tracking.restarted');
  } else {
    return null;
  }

  const palette = TONE[tone];
  return (
    <View style={[styles.box, { backgroundColor: palette.background }]}>
      <Txt variant="strong" size={16} color={palette.text}>{text}</Txt>
      {tracking.lastFixAt !== null && tone !== 'info' && (
        <Txt variant="small" color={palette.text}>{t('tracking.lastFix', { time: colomboTime(tracking.lastFixAt) })}</Txt>
      )}
      {action && <Button kind={tone === 'danger' ? 'dark' : 'outline'} label={action.label} onPress={action.onPress} />}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, padding: 14, gap: 10 },
});
