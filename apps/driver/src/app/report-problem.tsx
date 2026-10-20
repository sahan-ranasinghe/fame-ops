// Report a problem with the vehicle, opened on top of a task in progress or
// of Log mileage ("Odometer display broken?"). The vehicle and the task are
// filled in. Back returns to where it was opened, with that screen's state
// kept; after Send, "Report sent" and the same return. Unsaved input asks
// "Discard changes?" on back.
// Phase 7 Part 2: with "I need another vehicle" ticked the message says the office knows; with no
// connection it says the report waits on the phone and offers Call office.

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from '@/components/icons';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLeaveGuard } from '@/components/navigation';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { ReportForm } from '@/components/ReportForm';
import { taskTitle } from '@/components/taskLines';
import { Txt } from '@/components/ui';
import { OFFICE_PHONE } from '@/config';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function ReportProblemScreen() {
  const app = useApp();
  const { t, tasks, vehicles } = app;
  const { taskId, vehicleId } = useLocalSearchParams<{ taskId?: string; vehicleId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [dirty, setDirty] = useState(false);
  const { allowLeave } = useLeaveGuard(dirty, false);

  const task = taskId ? tasks.find((item) => item.id === taskId) : undefined;
  const vehicle = vehicles.find((item) => item.id === (vehicleId ?? task?.vehicle_id)) ?? app.workVehicle;
  const onDirtyChange = useCallback((next: boolean) => setDirty(next), []);

  if (!app.me) return <Redirect href="/login" />;

  function sent({ needsVehicle }: { needsVehicle: boolean }) {
    allowLeave();
    // Hotfix O2-H2, Part 1b: back to where the report was opened, a snackbar says it went (or waits on the phone); a
    // driver who needs another vehicle and has no connection gets "Call office" on it.
    router.back();
    const call = needsVehicle && app.offline && OFFICE_PHONE !== '';
    showSnackbar({
      text: [t('report.sentTitle'), t(app.offline ? 'common.savedOffline' : needsVehicle ? 'report.needVehicleSent' : 'report.sentBody')].join(' · '),
      ms: 6000,
      ...(call ? { action: { label: t('gate.callOffice'), onPress: () => void Linking.openURL(`tel:${OFFICE_PHONE}`) } } : {}),
    });
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 28, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt variant="title" size={28}>{t('report.title')}</Txt>
            {task && <Txt variant="muted" numberOfLines={1}>{taskTitle(t, task, true)}</Txt>}
          </View>
        </View>
        <ReportForm vehicle={vehicle} taskId={task?.id ?? null} onSent={sent} onDirtyChange={onDirtyChange} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
