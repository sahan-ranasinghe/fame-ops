// Start a trip (Phase 7, §13; not designed: built in the style of Log mileage). Opened from Today while on duty with
// no task in progress, pushed on top of it: back returns to Today with nothing lost; "Discard changes?" only when
// something was typed or picked.
//   - Company work or Personal: two big choices per the office's setting (hidden when Personal is off).
//   - Where to? (components/PlaceSearch.tsx): our places first, used before, the map's or Google's, the typed words.
//   - A note (optional), then Start.
// Start asks for Location first (like Start task), then makes the trip: at once on the server when online, else kept
// on the phone and sent by the queue (trip.queued says so). Either way the normal Start task flow follows on this
// trip (Log mileage in start mode, which takes this screen's place): odometer photo, then the task screen.

import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, Play } from '@/components/icons';
import { useLeaveGuard } from '@/components/navigation';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { PlaceSearch } from '@/components/PlaceSearch';
import { Button, Card, Field, Notice, Plate, Segmented, Txt } from '@/components/ui';
import { type Choice, MAX_NOTE, type Purpose, purposeChoices, purposeKey } from '@/lib/trips';
import { type StartTripOutcome, useApp } from '@/state/app';
import { colors } from '@/theme';
import { failedText } from '@/lib/humanReason';

export default function StartTripScreen() {
  const app = useApp();
  const { t, settings, vehicle, tasks, loadKnownPlaces } = app;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const choices = purposeChoices(settings.driver_personal_trips);
  const [purpose, setPurpose] = useState<Purpose>(choices.preselected);
  const [text, setText] = useState('');
  const [pick, setPick] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = text.trim() !== '' || note.trim() !== '' || pick !== null;
  const { allowLeave } = useLeaveGuard(dirty, busy);

  // Our places for no connection: read again when the phone's copy is old (and there is a connection).
  useEffect(() => {
    loadKnownPlaces();
  }, [loadKnownPlaces]);

  if (!app.me) return <Redirect href="/login" />;

  const running = tasks.some((task) => task.status === 'in_progress');
  const noVehicle = !app.me.current_vehicle_id;

  async function start() {
    if (!pick || busy) return;
    setProblem(null);
    setBusy(true);
    const result: { outcome: StartTripOutcome | null } = { outcome: null };
    // Location must be on to drive a trip: the cover asks first; "Not now" makes nothing.
    const went = await app.requireLocation('start', async () => {
      result.outcome = await app.startTrip({ purpose: choices.showChoice ? purpose : 'company', pick, note });
    });
    const outcome = result.outcome;
    if (!went || !outcome) {
      setBusy(false);
      return;
    }
    if (outcome.kind !== 'started') {
      setBusy(false);
      setProblem(
        outcome.kind === 'no_vehicle' ? t('trip.needVehicle') : outcome.kind === 'task_running' ? t('trip.finishFirst') : failedText(t, 'trip.failed', outcome.message),
      );
      return;
    }
    allowLeave();
    // The trip is a task now: the normal Start task flow takes this screen's place (back from it goes to Today, where
    // the trip waits with Start task).
    const go = () => router.replace({ pathname: '/log-mileage', params: { mode: 'start', taskId: outcome.taskId, from: 'trip' } });
    go();
    if (outcome.offline) showSnackbar({ text: t('trip.queued'), ms: 6000 });
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="title" size={28}>{t('trip.title')}</Txt>
            {vehicle && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Plate regNo={vehicle.reg_no} />
                {vehicle.make_model && <Txt variant="muted" numberOfLines={1} style={{ flex: 1 }}>{vehicle.make_model}</Txt>}
              </View>
            )}
          </View>
        </View>

        {noVehicle && <Notice tone="warn" text={t('trip.needVehicle')} />}
        {running && <Notice tone="warn" text={t('trip.finishFirst')} />}

        {choices.showChoice && (
          <View style={{ gap: 8 }}>
            <Segmented value={purpose} onChange={setPurpose} options={choices.options.map((o) => ({ value: o, label: t(purposeKey(o)) }))} />
            {purpose === 'personal' && <Txt variant="small" style={{ marginLeft: 4 }}>{t('trip.officeTold')}</Txt>}
          </View>
        )}

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

        <Card>
          <Field label={t('trip.note')} value={note} onChangeText={setNote} maxLength={MAX_NOTE} multiline style={{ minHeight: 72, textAlignVertical: 'top' }} />
        </Card>

        {problem && <Notice tone="danger" text={problem} />}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        <Button
          icon={busy ? undefined : Play}
          label={t(busy ? 'trip.starting' : 'trip.go')}
          busy={busy}
          disabled={!pick || noVehicle || running}
          onPress={start}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
