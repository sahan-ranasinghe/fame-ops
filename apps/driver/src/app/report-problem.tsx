// Report a problem with the vehicle, opened on top of a task in progress or
// of Log mileage ("Odometer display broken?"). The vehicle and the task are
// filled in. Back returns to where it was opened, with that screen's state
// kept; after Send, "Report sent" and the same return. Unsaved input asks
// "Discard changes?" on back.

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from '@/components/icons';
import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLeaveGuard } from '@/components/navigation';
import { ReportForm } from '@/components/ReportForm';
import { Txt } from '@/components/ui';
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

  function sent() {
    allowLeave();
    Alert.alert(t('report.sentTitle'), t(app.offline ? 'common.savedOffline' : 'report.sentBody'), [
      { text: t('common.ok'), onPress: () => router.back() },
    ]);
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
            {task && <Txt variant="muted" numberOfLines={1}>{task.title}</Txt>}
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
