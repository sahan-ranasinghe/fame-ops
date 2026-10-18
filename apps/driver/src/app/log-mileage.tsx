// Log mileage (designed: design/png/Driver · Log mileage.png). One screen, six uses:
//   finish      end of a task: odometer photo, fuel yes/no, "Save & finish task"
//   start       start of a task: odometer photo, "Start task"
//   manual      a reading outside a task (from the Mileage tab)
//   fuel        fuel outside the end-of-task flow (from the Mileage tab)
//   swap_end    the office moved the running task to another vehicle (Phase 7 Part 2): the old vehicle's
//               end reading (its stretch's start is the lowest allowed); opened from the task screen's card
//   swap_start  the same swap: the new vehicle's start reading
// The swap readings go on the task with their own vehicle (vehicleId param) and come back to the task screen.
//
// The odometer number comes from the photo, read by the server
// (lib/odometerAi.ts). The driver confirms it ("Correct") or, after a
// warning, changes it. A photo that does not show the total odometer gets a
// clear message and "Retake photo"; typing is offered only after three
// failed photos in a row, or when there is no connection (the server checks
// the photo later). What the driver did goes with the log (entry, number of
// photos) so the office sees what was checked.
//
// Phase 7 (item 18): at Save & finish, a trip much shorter than its plan (under 70 % of the
// planned km, or under half the planned drive time) asks "Check the reading" first: Correct
// it (back to the reading, nothing saved) or Go on (saved as it is; the server flags it too).
// After a swap, Save & finish checks the end against the start of the stretch in the vehicle now,
// and "N km this task" adds the stretches up.
// Hotfix 2 (J): Start task on a task made without a vehicle asks "Which vehicle?" first
// (components/VehicleConfirm.tsx); the odometer step follows once the vehicle is set (or kept on the
// phone to be sent before the start).

import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Camera, ChevronLeft, Video } from '@/components/icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLeaveGuard } from '@/components/navigation';
import { PlateText } from '@/components/PlateText';
import { VehicleConfirm } from '@/components/VehicleConfirm';
import { Button, Card, Field, Mono, Notice, Segmented, Txt } from '@/components/ui';
import { earlyFinish, stretchStartKm, swapReadingsWaiting, taskKmSoFar } from '@/lib/dayRules';
import { parseDecimal, parseWhole, thousands } from '@/lib/format';
import { readOdometerPhoto, type ReadStatus } from '@/lib/odometerAi';
import { discardPhoto, type LocalPhoto, takePhoto } from '@/lib/photos';
import { clockOf, discardVideo, megabytes, type RecordedVideo, takePendingVideo } from '@/lib/video';
import { needsVehicle } from '@/lib/vehicleConfirm';
import { type FuelEntry, type OdometerEntry, type OdometerEntryKind, useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

type Mode = 'finish' | 'start' | 'manual' | 'fuel' | 'swap_end' | 'swap_start';
const OTHER_MODES: Mode[] = ['start', 'manual', 'fuel', 'swap_end', 'swap_start'];

type Step =
  | { kind: 'none' }
  | { kind: 'checking'; photo: LocalPhoto }
  | { kind: 'ok'; photo: LocalPhoto; km: number; ocrKm: number | null }
  | { kind: 'failed'; photo: LocalPhoto; status: ReadStatus; lastKm: number | null; ocrKm: number | null }
  | { kind: 'typing'; photo: LocalPhoto; entry: Exclude<OdometerEntryKind, 'photo'>; aiKm: number | null; ocrKm: number | null };

const MAX_FAILED_PHOTOS = 3;

const TITLE: Record<Mode, string> = {
  finish: 'log.title', start: 'log.titleStart', manual: 'log.title', fuel: 'log.titleFuel', swap_end: 'swap.logTitle', swap_start: 'swap.logTitle',
};
/** Under the title; the swap modes' text has {plate} in it ("{plate}: end reading"), drawn in its chip. */
const SUBTITLE: Record<Mode, string> = {
  finish: 'log.endOfTask', start: 'log.startOfTask', manual: 'log.reading', fuel: 'log.fuelEntry', swap_end: 'swap.oldEnd', swap_start: 'swap.newStart',
};
const SAVE: Record<Mode, string> = {
  finish: 'log.saveFinish', start: 'log.startTask', manual: 'log.saveReading', fuel: 'log.saveFuel', swap_end: 'log.saveReading', swap_start: 'log.saveReading',
};
const CORRECT: Record<Mode, string> = {
  finish: 'log.correctFinish', start: 'log.correctStart', manual: 'log.correctSave', fuel: 'log.saveFuel', swap_end: 'log.correctSave', swap_start: 'log.correctSave',
};
const FAILED: Record<ReadStatus, string> = {
  ok: 'log.couldNotRead',
  no_odometer: 'log.photo.noOdometer',
  trip_meter_only: 'log.photo.tripMeter',
  blurry: 'log.photo.blurry',
  covered_or_dark: 'log.photo.covered',
  not_dashboard: 'log.photo.notDashboard',
  unsure: 'log.photo.unsure',
  out_of_range: 'log.photo.outOfRange',
};
const WHY_TYPING: Record<Exclude<OdometerEntryKind, 'photo'>, string> = {
  photo_changed: 'log.typing.changed',
  typed_unreadable: 'log.typing.unreadable',
  typed_offline: 'log.typing.offline',
};

export default function LogMileageScreen() {
  const app = useApp();
  const { t, tasks, vehicles, gpsKm } = app;
  const params = useLocalSearchParams<{ mode?: string; taskId?: string; from?: string; vehicleId?: string }>();
  const mode: Mode = OTHER_MODES.find((item) => item === params.mode) ?? 'finish';
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const swapMode = mode === 'swap_end' || mode === 'swap_start';
  // A swap reading belongs to its own vehicle (the old one's end, the new one's start), not the task's.
  const swapVehicleId = swapMode ? params.vehicleId ?? null : null;
  const task = params.taskId ? tasks.find((item) => item.id === params.taskId) : undefined;
  const vehicle = swapMode
    ? vehicles.find((item) => item.id === swapVehicleId) ?? null
    : task ? vehicles.find((item) => item.id === task.vehicle_id) ?? null : app.workVehicle;
  const lastKm = vehicle?.current_odometer_km ?? null;
  // The reading the end is checked against: the task's start, or after a swap the start of the stretch in the
  // vehicle now; for the old vehicle's end at a swap, the start of its stretch.
  const startKm = mode === 'finish' && task
    ? stretchStartKm(task)
    : mode === 'swap_end' && task
    ? swapReadingsWaiting(task).oldEnd?.startKm ?? null
    : null;
  const endsStretch = mode === 'finish' || mode === 'swap_end';
  // Km by GPS since the reading this one follows (the task's start when finishing a task or leaving its vehicle).
  // The new vehicle at a swap: unknown (this phone did not drive it).
  const gpsSinceLast = mode === 'swap_start' ? null : endsStretch && task && gpsKm.taskId === task.id ? gpsKm.taskKm : gpsKm.odometerKm;
  const baseKm = endsStretch ? startKm ?? lastKm : lastKm;

  const [step, setStep] = useState<Step>({ kind: 'none' });
  const [attempts, setAttempts] = useState(0);
  const [failures, setFailures] = useState(0);
  const [odometer, setOdometer] = useState('');
  const [typedFuelKm, setTypedFuelKm] = useState('');
  const [addedFuel, setAddedFuel] = useState<'yes' | 'no'>(mode === 'fuel' ? 'yes' : 'no');
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [receipt, setReceipt] = useState<LocalPhoto | null>(null);
  // The video of the fill (Phase 6): recorded on its own screen, required for every fuel entry.
  const [video, setVideo] = useState<RecordedVideo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Unsaved input asks "Discard changes?" on back; nothing is asked after a save or while one runs.
  const dirty = step.kind !== 'none' || typedFuelKm !== '' || litres.trim() !== '' || amount.trim() !== '' || receipt !== null || video !== null;
  const { allowLeave } = useLeaveGuard(dirty, saving || confirmBusy);
  // Back from the recording screen: take what it left.
  useFocusEffect(
    useCallback(() => {
      const recorded = takePendingVideo();
      if (recorded) {
        setVideo((old) => {
          discardVideo(old);
          return recorded;
        });
        setProblem(null);
      }
    }, []),
  );

  if (!app.me) return <Redirect href="/login" />;
  if ((mode === 'finish' || mode === 'start' || swapMode) && !task) return <Redirect href="/" />;
  if (swapMode && !swapVehicleId) return <Redirect href="/" />;

  // J: a task made without a vehicle confirms one before the odometer.
  const confirming = mode === 'start' && !!task && needsVehicle(task);
  const needsOdometer = mode !== 'fuel' && !confirming;
  const showFuel = mode === 'finish' || mode === 'fuel';
  const typedKm = parseWhole(odometer);
  const stepPhoto = step.kind === 'none' ? null : step.photo;

  async function photographOdometer() {
    const shot = await takePhoto();
    if (shot === 'denied') return setProblem(t('common.cameraDenied'));
    if (!shot) return;
    if (stepPhoto) discardPhoto(stepPhoto);
    setProblem(null);
    setStep({ kind: 'checking', photo: shot });
    setAttempts((n) => n + 1);

    const read = await readOdometerPhoto(shot, {
      employeeId: app.me?.id ?? '',
      vehicleId: vehicle?.id ?? swapVehicleId,
      lastKm: baseKm,
      gpsKm: gpsSinceLast === null ? null : Math.round(gpsSinceLast),
    });
    if (read.kind === 'offline') {
      setFailures(0);
      setOdometer(read.km !== null ? thousands(read.km) : '');
      setStep({ kind: 'typing', photo: shot, entry: 'typed_offline', aiKm: null, ocrKm: read.ocrKm });
      return;
    }
    if (read.status === 'ok' && read.km !== null) {
      setFailures(0);
      setStep({ kind: 'ok', photo: shot, km: read.km, ocrKm: read.ocrKm });
      return;
    }
    setFailures((n) => n + 1);
    setStep({ kind: 'failed', photo: shot, status: read.status, lastKm: read.lastKm, ocrKm: read.ocrKm });
  }

  function change() {
    if (step.kind !== 'ok') return;
    setOdometer(thousands(step.km));
    setStep({ kind: 'typing', photo: step.photo, entry: 'photo_changed', aiKm: step.km, ocrKm: step.ocrKm });
  }

  function typeInstead() {
    if (step.kind !== 'failed') return;
    setOdometer('');
    setStep({ kind: 'typing', photo: step.photo, entry: 'typed_unreadable', aiKm: null, ocrKm: step.ocrKm });
  }

  async function photographReceipt() {
    const shot = await takePhoto();
    if (shot === 'denied') return setProblem(t('common.cameraDenied'));
    if (!shot) return;
    if (receipt) discardPhoto(receipt);
    setReceipt(shot);
  }

  function fuelEntry(): FuelEntry | null | 'invalid' | 'no_video' {
    if (!showFuel || addedFuel === 'no') return null;
    const litresValue = litres.trim() === '' ? null : parseDecimal(litres);
    const amountValue = amount.trim() === '' ? null : parseDecimal(amount);
    const bad = (litres.trim() !== '' && (litresValue === null || litresValue <= 0)) || (amount.trim() !== '' && amountValue === null);
    if (bad || (litresValue === null && amountValue === null)) return 'invalid';
    if (!video) return 'no_video';
    return { litres: litresValue, amountCents: amountValue === null ? null : Math.round(amountValue * 100), receipt, video };
  }

  /** The driver changed the number the photo shows: say so, and ask once. */
  function confirmChange(aiKm: number | null): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(t('log.changeTitle'), t('log.changeWarning', { km: thousands(aiKm ?? 0) }), [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('log.saveAnyway'), style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  }

  /** The odometer says the trip was much shorter than planned: ask once; false = correct the reading. */
  function confirmEarly(km: number): Promise<boolean> {
    const early = task ? earlyFinish(task, km, Date.now()) : null;
    if (!early) return Promise.resolve(true);
    const planned = early.plannedKm >= 10 ? thousands(early.plannedKm) : String(early.plannedKm);
    return new Promise((resolve) => {
      Alert.alert(t('complete.checkTitle'), t('complete.checkBody', { planned, km: thousands(early.km) }), [
        { text: t('complete.correct'), style: 'cancel', onPress: () => resolve(false) },
        { text: t('complete.goOn'), onPress: () => resolve(true) },
      ]);
    });
  }

  async function save() {
    if (saving) return;
    if ((mode === 'manual' || mode === 'fuel') && !vehicle) return setProblem(t('log.needVehicle'));
    const fuel = fuelEntry();
    if (fuel === 'invalid') return setProblem(t('log.needFuel'));
    if (fuel === 'no_video') return setProblem(t('fuel.required'));

    if (mode === 'fuel') {
      if (!fuel) return setProblem(t('log.needFuel'));
      setSaving(true);
      allowLeave();
      app.logFuel(fuel, parseWhole(typedFuelKm));
      router.back();
      return;
    }

    const reading: OdometerEntry | null = step.kind === 'ok'
      ? { km: step.km, entry: 'photo', photo: step.photo, ocrKm: step.ocrKm, attempts }
      : step.kind === 'typing' && typedKm !== null
      ? { km: typedKm, entry: step.entry, photo: step.photo, ocrKm: step.ocrKm, attempts }
      : null;
    if (step.kind === 'typing' && typedKm === null) return setProblem(t('log.needOdometer'));
    if (!reading) return setProblem(t('log.needPhoto'));
    if (endsStretch && startKm !== null && reading.km < startKm) return setProblem(t('log.lowerThanStart', { km: thousands(startKm) }));
    if (step.kind === 'typing' && step.entry === 'photo_changed' && !(await confirmChange(step.aiKm))) return;
    if (mode === 'finish' && !(await confirmEarly(reading.km))) return;

    setSaving(true);
    if (mode === 'start' && task) {
      // Location must be on: the cover asks for it; "Not now" leaves the form as it is.
      if (!(await app.startTask(task, reading))) {
        setSaving(false);
        return;
      }
      allowLeave();
      // Opened from the task screen: back to it, now in progress. Opened from Today: the task takes this screen's place.
      if (params.from === 'task') router.back();
      else router.replace({ pathname: '/task/[id]', params: { id: task.id } });
    } else if (mode === 'finish' && task) {
      allowLeave();
      app.completeTask(task, reading, fuel);
      router.back();
    } else if (swapMode && task && swapVehicleId) {
      // On the task, with its own vehicle; the card on the task screen says "Logged ✓" at once.
      allowLeave();
      app.logOdometer(reading, { kind: mode === 'swap_end' ? 'task_end' : 'task_start', vehicleId: swapVehicleId, taskId: task.id });
      router.back();
    } else {
      allowLeave();
      app.logOdometer(reading);
      router.back();
    }
  }

  // A typed reading that does not match the last one is allowed, but the driver is told the office will see it.
  // (Not at the end of a task or of a stretch: the vehicle has driven since its last reading.)
  const gap = step.kind === 'typing' && !endsStretch && typedKm !== null && lastKm !== null ? typedKm - lastKm : 0;
  /** Under the reading: "Start: 195,049" and "51 km this task" (or "40 km in WP CAB-4521" at a swap), else the last reading. */
  const under = (km: number | null) => {
    const counted = km !== null && startKm !== null && km >= startKm;
    return {
      left: endsStretch
        ? startKm === null ? null : t('log.start', { km: thousands(startKm) })
        : lastKm === null ? null : t('log.lastReading', { km: thousands(lastKm) }),
      thisTask: mode === 'finish' && counted && task ? taskKmSoFar(task, km) : null,
      stretchKm: mode === 'swap_end' && counted ? km - startKm : null,
    };
  };
  const plate = vehicle?.reg_no ?? '–';
  const bottomButton = mode === 'fuel' || step.kind === 'ok' || step.kind === 'typing';

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt variant="title" size={28}>{t(TITLE[mode])}</Txt>
            {swapMode ? (
              <PlateText text={t(SUBTITLE[mode])} plate={plate} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {vehicle && <Mono size={16} bold>{vehicle.reg_no}</Mono>}
                <Txt variant="muted">{`${vehicle ? '· ' : ''}${t(SUBTITLE[mode])}`}</Txt>
              </View>
            )}
          </View>
        </View>

        {confirming && task && <VehicleConfirm task={task} onBusy={setConfirmBusy} />}

        {needsOdometer && step.kind === 'none' && (
          <Pressable accessibilityRole="button" onPress={photographOdometer} style={styles.photoCard}>
            <View style={styles.cameraTile}>
              <Camera size={30} color={colors.amber} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="big">{t('log.photoTitle')}</Txt>
              <Txt variant="muted">{t('log.photoHint')}</Txt>
            </View>
          </Pressable>
        )}

        {needsOdometer && step.kind === 'checking' && (
          <View style={styles.photoCard}>
            <Image source={{ uri: step.photo.uri }} style={styles.thumb} />
            <View style={{ flex: 1 }}>
              <Txt variant="big">{t('log.photoTitle')}</Txt>
              <Txt variant="muted">{t('log.reading_')}</Txt>
            </View>
            <ActivityIndicator color={colors.ink} />
          </View>
        )}

        {needsOdometer && step.kind === 'ok' && (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('log.retake')} onPress={photographOdometer}>
                <Image source={{ uri: step.photo.uri }} style={styles.thumb} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Txt variant="muted">{t('log.photoReading')}</Txt>
                <Mono size={40} bold>{thousands(step.km)}</Mono>
              </View>
            </View>
            <UnderReading {...under(step.km)} plate={plate} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button kind="outline" label={t('log.change')} onPress={change} style={{ flex: 1 }} />
              <Button kind="outline" label={t('log.retake')} onPress={photographOdometer} style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        {needsOdometer && step.kind === 'failed' && (
          <Card style={{ gap: 14 }}>
            <Image source={{ uri: step.photo.uri }} style={styles.preview} />
            <Notice tone="danger" text={t(FAILED[step.status], { km: thousands(step.lastKm ?? 0) })} />
            <Button icon={Camera} label={t('log.retake')} onPress={photographOdometer} />
            {failures >= MAX_FAILED_PHOTOS && (
              <>
                <Button kind="outline" label={t('log.typeInstead')} onPress={typeInstead} />
                <Button
                  kind="danger-text"
                  label={t('log.displayBroken')}
                  onPress={() => {
                    const vehicleId = swapVehicleId ?? vehicle?.id;
                    router.push({ pathname: '/report-problem', params: { ...(task ? { taskId: task.id } : {}), ...(vehicleId ? { vehicleId } : {}) } });
                  }}
                />
              </>
            )}
          </Card>
        )}

        {needsOdometer && step.kind === 'typing' && (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('log.retake')} onPress={photographOdometer}>
                <Image source={{ uri: step.photo.uri }} style={styles.thumb} />
              </Pressable>
              <Txt variant="muted" style={{ flex: 1 }}>{t(WHY_TYPING[step.entry], { km: thousands(step.aiKm ?? 0) })}</Txt>
            </View>
            <Txt variant="big">{t('log.odometerNow')}</Txt>
            <TextInput
              value={odometer}
              onChangeText={(text) => {
                const value = parseWhole(text);
                setOdometer(value === null ? '' : thousands(value));
                setProblem(null);
              }}
              keyboardType="number-pad"
              maxLength={9}
              placeholder="0"
              placeholderTextColor="#c4c0b8"
              style={styles.odometer}
            />
            <UnderReading {...under(typedKm)} plate={plate} />
            {gap > 2 && <Notice tone="warn" text={t('log.moreThanLast', { km: thousands(gap) })} />}
            {gap < -2 && lastKm !== null && <Notice tone="warn" text={t('log.lowerThanLast', { km: thousands(lastKm) })} />}
          </Card>
        )}

        {needsOdometer && !swapMode && (step.kind === 'ok' || step.kind === 'typing') && gpsSinceLast !== null && gpsSinceLast >= 0.5 && (
          <Txt variant="small">{t(mode === 'finish' ? 'log.gpsThisTask' : 'log.gpsSinceLast', { km: thousands(gpsSinceLast) })}</Txt>
        )}

        {mode === 'fuel' && (
          <Card style={{ gap: 12 }}>
            <Txt variant="big">{t('log.odometerOptional')}</Txt>
            <TextInput
              value={typedFuelKm}
              onChangeText={(text) => {
                const value = parseWhole(text);
                setTypedFuelKm(value === null ? '' : thousands(value));
              }}
              keyboardType="number-pad"
              maxLength={9}
              placeholder="0"
              placeholderTextColor="#c4c0b8"
              style={styles.odometer}
            />
            {lastKm !== null && <Txt variant="muted">{t('log.lastReading', { km: thousands(lastKm) })}</Txt>}
          </Card>
        )}

        {showFuel && (
          <Card style={{ gap: 14 }}>
            {mode === 'finish' && (
              <>
                <Txt variant="big">{t('log.addedFuel')}</Txt>
                <Segmented
                  value={addedFuel}
                  onChange={setAddedFuel}
                  options={[{ value: 'yes', label: t('common.yes') }, { value: 'no', label: t('common.no') }]}
                />
              </>
            )}
            {addedFuel === 'yes' && (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Field label={t('log.litres')} mono value={litres} onChangeText={setLitres} keyboardType="decimal-pad" maxLength={7} />
                  <Field label={t('log.amount')} mono value={amount} onChangeText={setAmount} keyboardType="decimal-pad" maxLength={10} />
                </View>
                <Button kind="outline" label={t(receipt ? 'log.receiptAdded' : 'log.addReceipt')} onPress={photographReceipt} />
                {video ? (
                  <View style={styles.videoRow}>
                    <Video size={22} color={colors.blue} />
                    <Txt variant="strong" color={colors.blue} style={{ flex: 1 }}>
                      {t('fuel.recorded', { duration: clockOf(video.durationS), size: megabytes(video.bytes) }) + (video.interrupted ? ` · ${t('fuel.segments', { n: video.segments.length })} · ${t('fuel.interruptedShort')}` : '')}
                    </Txt>
                    <Button kind="outline" label={t('fuel.retake')} onPress={() => router.push('/record-video')} />
                  </View>
                ) : (
                  <>
                    <Button icon={Video} label={t('fuel.record')} onPress={() => router.push('/record-video')} />
                    <Txt variant="small">{t('fuel.required')}</Txt>
                  </>
                )}
              </>
            )}
          </Card>
        )}

        {problem && <Notice tone="danger" text={problem} />}
      </ScrollView>

      {bottomButton && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
          <Button label={t(step.kind === 'ok' ? CORRECT[mode] : SAVE[mode])} onPress={save} busy={saving} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** "Start: 195,049 · 51 km this task", "Start: 10,000 · 40 km in WP CAB-4521" (a swap) or "Last reading: 195,049". */
function UnderReading({ left, thisTask, stretchKm, plate }: { left: string | null; thisTask: number | null; stretchKm: number | null; plate: string }) {
  const { t } = useApp();
  return (
    <View style={styles.underOdometer}>
      {left !== null && <Txt variant="muted">{left}</Txt>}
      {thisTask !== null && <Txt variant="strong" color={colors.blue}>{t('log.thisTask', { km: thousands(thisTask) })}</Txt>}
      {stretchKm !== null && <PlateText text={t('swap.stretches', { km: thousands(stretchKm) })} plate={plate} variant="strong" color={colors.blue} />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  photoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#b8b2a6',
  },
  cameraTile: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 72, height: 72, borderRadius: 14, backgroundColor: colors.line },
  preview: { width: '100%', height: 180, borderRadius: 14, backgroundColor: colors.line },
  odometer: {
    minHeight: 68,
    borderWidth: 2.5,
    borderColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontFamily: fonts.monoSemiBold,
    fontSize: 32,
    color: colors.ink,
  },
  underOdometer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  videoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
