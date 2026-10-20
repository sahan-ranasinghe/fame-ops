// Add a stop (Phase 7, §13): a stop on the way, for a trip the driver started that is under way. Opened from the task
// screen, pushed on top of it: back returns there with nothing lost; "Discard changes?" only when something was typed
// or picked. The same search box as Start a trip. Added at once on the server when online, else kept on the phone
// and sent by the queue after what went before it; either way the task's stop list shows it at once (trip.stopAdded).

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, Plus } from '@/components/icons';
import { useLeaveGuard } from '@/components/navigation';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { PlaceSearch } from '@/components/PlaceSearch';
import { taskTitle } from '@/components/taskLines';
import { Button, Notice, Txt } from '@/components/ui';
import { canAddStop, type Choice } from '@/lib/trips';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export default function AddStopScreen() {
  const app = useApp();
  const { t, tasks, loadKnownPlaces } = app;
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState('');
  const [pick, setPick] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = text.trim() !== '' || pick !== null;
  const { allowLeave } = useLeaveGuard(dirty, busy);

  useEffect(() => {
    loadKnownPlaces();
  }, [loadKnownPlaces]);

  const task = taskId ? tasks.find((item) => item.id === taskId) : undefined;
  if (!app.me) return <Redirect href="/login" />;
  // Only a trip of the driver's own, under way, with room for another stop (the task screen offers it only then).
  if (!task || (!canAddStop(task) && !busy)) return <Redirect href="/" />;

  async function add() {
    if (!pick || !task || busy) return;
    setProblem(null);
    setBusy(true);
    const outcome = await app.addTripStop(task, pick);
    if (outcome.kind !== 'added') {
      setBusy(false);
      setProblem(outcome.kind === 'refused' ? t('trip.stopFailed', { reason: outcome.message }) : null);
      return;
    }
    allowLeave();
    router.back();
    showSnackbar({ text: outcome.offline ? `${t('trip.stopAdded')} · ${t('done.onPhone')}` : t('trip.stopAdded') });
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt variant="title" size={28}>{t('trip.addStop')}</Txt>
            <Txt variant="muted" numberOfLines={1}>{taskTitle(t, task, true)}</Txt>
          </View>
        </View>

        <PlaceSearch
          online={app.dataAvailable}
          known={app.knownPlaces}
          pick={pick}
          onPick={(next) => {
            setPick(next);
            setProblem(null);
          }}
          text={text}
          onTextChange={setText}
        />

        {problem && <Notice tone="danger" text={problem} />}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        <Button icon={busy ? undefined : Plus} label={t('trip.addStop')} busy={busy} disabled={!pick} onPress={add} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
