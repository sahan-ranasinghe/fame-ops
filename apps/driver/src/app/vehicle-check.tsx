// The vehicle check before work (Round 4–7, feature 4: docs/phase8-plan.md §33.1). Samsara / Motive's pre-trip inspection
// and Turo's check-in, on one screen: "Any damage or problem with WP CAB-4521?"
//   ask      "No, all good" (one tap: recorded at once, offline too) or "Yes, report a problem".
//   problem  the report form (components/ReportForm.tsx): a category (Damage is new), 1 to 6 photos, a note, Send. The
//            check goes in the queue first, then the report naming it, then its photos; the server tells the office.
//   done     "All good · Check saved 08:12", Continue, and the optional "Add 4 photos (front, back, left, right)".
//   photos   the guided capture: one labelled shot per side, the camera only (lib/photos.ts takePhoto); a tile taken
//            again replaces its photo; Save photos queues them after the check (kind vehicle_check, each with its side).
// Pushed by every way a driver takes a vehicle (params vehicleId, how = clock_in | change | task_start | vehicle_confirm,
// taskId?): Start work and Change vehicle replace the vehicle picker with it (back = Today); Start task and the vehicle
// confirmed on the day push it over Log mileage (back = the start odometer, its state kept); Today's card pushes it.
// It is not skippable: no Skip. Back from the question asks nothing and goes back without answering: the rule still holds
// (Start task waits, Today keeps its card). Back from a step inside the screen (the report, the photos) returns to the
// step before it, asking "Discard changes?" first when something was entered (CLAUDE.md, back navigation rules).

import { Redirect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Camera, Check, ChevronLeft, ShieldCheck, TriangleAlert } from '@/components/icons';
import { useDirtyMark } from '@/components/navigation';
import { showSnackbar } from '@/components/patterns/Snackbar';
import { Thumb, useVehicleThumbs } from '@/components/Photos';
import { PlateText } from '@/components/PlateText';
import { type ReportInput, ReportForm } from '@/components/ReportForm';
import { Button, Card, Notice, Plate, Txt } from '@/components/ui';
import { discardPhoto, type LocalPhoto, takePhoto } from '@/lib/photos';
import { colomboTime } from '@/lib/time';
import type { CheckSide } from '@/lib/types';
import { CHECK_SIDES, checkToday, nextSide, parseHow, PRE_TRIP_MAX_PHOTOS, type VehicleCheck } from '@/lib/vehicleCheck';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

type Step = 'ask' | 'problem' | 'done' | 'photos';
type Shots = Partial<Record<CheckSide, LocalPhoto>>;

export default function VehicleCheckScreen() {
  const app = useApp();
  const { t } = app;
  const params = useLocalSearchParams<{ vehicleId?: string; how?: string; taskId?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const vehicleId = params.vehicleId ?? '';
  const how = parseHow(params.how);
  const taskId = params.taskId ? params.taskId : null;
  const vehicle = app.vehicles.find((v) => v.id === vehicleId) ?? null;
  const plate = vehicle?.reg_no ?? '–';
  const thumbs = useVehicleThumbs(vehicle ? [vehicle.id] : []);

  // The check answered here, else (opened again, or the check was switched off) the one of today.
  const [answered, setAnswered] = useState<VehicleCheck | null>(null);
  const check = answered ?? checkToday(vehicleId, app.vehicleChecks, Date.now(), app.me?.id);
  const [step, setStep] = useState<Step>(() => (app.checkNeeded(vehicleId) ? 'ask' : 'done'));
  const [problemDirty, setProblemDirty] = useState(false);
  // A new key empties the report form (after "Discard changes?").
  const [formKey, setFormKey] = useState(0);
  const [shots, setShots] = useState<Shots>({});
  const [photosAdded, setPhotosAdded] = useState(0);
  const [cameraBusy, setCameraBusy] = useState<CheckSide | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const leaving = useRef(false);
  const taken = CHECK_SIDES.filter((side) => shots[side]).length;

  // Unsaved input on screen: a notification tap puts the task on top instead of closing this screen.
  useDirtyMark((step === 'problem' && problemDirty) || (step === 'photos' && taken > 0));

  const leave = useCallback(() => {
    leaving.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  // Nothing to ask and nothing answered (the office switched the check off meanwhile): nothing to show.
  const nothing = step === 'done' && !check;
  useEffect(() => {
    if (nothing) leave();
  }, [nothing, leave]);

  const discardShots = useCallback(() => {
    for (const photo of Object.values(shots)) if (photo) discardPhoto(photo);
    setShots({});
  }, [shots]);

  // Back (the Android button, the arrow, the gesture): out of the question or the saved check; from the report or the
  // photos, one step back inside the screen (asking first when something was entered). Never while the camera is open.
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (leaving.current) return;
    if (cameraBusy) {
      event.preventDefault();
      return;
    }
    const type = event.data.action.type;
    if (type !== 'GO_BACK' && type !== 'POP') return;
    const stepBack = (to: Step, dirty: boolean, discard: () => void) => {
      event.preventDefault();
      const go = () => {
        discard();
        setProblem(null);
        setStep(to);
      };
      if (!dirty) return go();
      Alert.alert(t('common.discardTitle'), t('common.discardBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.discard'), style: 'destructive', onPress: go },
      ]);
    };
    if (step === 'problem') {
      stepBack('ask', problemDirty, () => {
        setFormKey((k) => k + 1);
        setProblemDirty(false);
      });
    } else if (step === 'photos') {
      stepBack('done', taken > 0, discardShots);
    }
  }), [navigation, step, problemDirty, taken, cameraBusy, discardShots, t]);

  if (!app.me) return <Redirect href="/login" />;
  if (!vehicleId) return <Redirect href="/" />;

  const offline = app.offline || !app.dataAvailable;

  function allGood() {
    const saved = app.answerVehicleCheck({ vehicleId, how, taskId, result: 'ok' });
    if (!saved) return;
    setAnswered(saved);
    setStep('done');
  }

  function sendProblem(report: ReportInput) {
    const saved = app.answerVehicleCheck({ vehicleId, how, taskId, result: 'problem', report });
    if (saved) setAnswered(saved);
  }

  function problemSent() {
    // Back to where the vehicle was taken (the flow goes on from there), with the report's snackbar (§12).
    leave();
    showSnackbar({ text: [t('report.sentTitle'), offline ? t('done.onPhone') : t('report.sentBody')].join(' · '), ms: 6000 });
  }

  async function shoot(side: CheckSide) {
    if (cameraBusy) return;
    setProblem(null);
    setCameraBusy(side);
    let shot: Awaited<ReturnType<typeof takePhoto>>;
    try {
      shot = await takePhoto();
    } catch {
      shot = null;
    }
    setCameraBusy(null);
    if (shot === 'denied') return setProblem(t('common.cameraDenied'));
    if (!shot) return;
    const photo = shot;
    setShots((old) => {
      const before = old[side];
      if (before) discardPhoto(before);
      return { ...old, [side]: photo };
    });
  }

  function savePhotos() {
    if (!check || taken === 0) return;
    const list = CHECK_SIDES.flatMap((side) => (shots[side] ? [{ side, photo: shots[side] as LocalPhoto }] : []));
    app.addCheckPhotos(check, list);
    setPhotosAdded((n) => n + list.length);
    setShots({});
    setStep('done');
  }

  const next = nextSide(shots);
  const sideWord = (side: CheckSide) => t(`vehicleCheck.side.${side}`);

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={28} style={{ flex: 1 }}>
            {t(step === 'problem' ? 'report.title' : step === 'photos' ? 'vehicleCheck.photosTitle' : 'vehicleCheck.title')}
          </Txt>
        </View>

        <View style={styles.vehicleLine}>
          <Thumb uri={vehicle ? thumbs[vehicle.id] : null} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Plate regNo={plate} />
            {vehicle?.make_model && <Txt variant="muted" numberOfLines={1}>{vehicle.make_model}</Txt>}
          </View>
        </View>

        {step === 'ask' && (
          <View style={{ gap: 12 }}>
            <PlateText text={t('vehicleCheck.question')} plate={plate} variant="heading" size={26} />
            <Txt variant="muted">{t('vehicleCheck.hint')}</Txt>
          </View>
        )}

        {step === 'problem' && (
          <>
            <Txt variant="muted">{t('vehicleCheck.problemHint')}</Txt>
            <ReportForm
              key={formKey}
              vehicle={vehicle}
              taskId={taskId}
              maxPhotos={PRE_TRIP_MAX_PHOTOS}
              onDirtyChange={setProblemDirty}
              onSend={sendProblem}
              onSent={problemSent}
            />
          </>
        )}

        {step === 'done' && check && (
          <Card style={{ gap: 10 }}>
            <View style={styles.doneLine}>
              <View style={[styles.doneMark, check.result === 'problem' && { backgroundColor: colors.amberChip }]}>
                {check.result === 'ok'
                  ? <Check size={30} color={colors.blue} strokeWidth={3} />
                  : <TriangleAlert size={28} color={colors.amberText} strokeWidth={2.6} />}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                {check.result === 'ok' && <Txt variant="heading">{t('vehicleCheck.savedTitle')}</Txt>}
                <Txt variant={check.result === 'ok' ? 'muted' : 'strong'}>
                  {t(check.result === 'ok' ? 'vehicleCheck.savedAt' : 'vehicleCheck.problemAt', { time: colomboTime(check.checked_at) })}
                </Txt>
              </View>
            </View>
            {offline && <Txt variant="small" color={colors.amberText}>{t('done.onPhone')}</Txt>}
            {photosAdded > 0 && <Txt variant="strong" color={colors.blue}>{t('vehicleCheck.photosAdded', { n: photosAdded })}</Txt>}
          </Card>
        )}

        {step === 'photos' && (
          <View style={{ gap: 12 }}>
            <Txt variant="muted">{t('vehicleCheck.photosHint')}</Txt>
            <View style={styles.grid}>
              {CHECK_SIDES.map((side) => {
                const photo = shots[side];
                const isNext = side === next;
                return (
                  <Pressable
                    key={side}
                    accessibilityRole="button"
                    accessibilityLabel={t('vehicleCheck.takeSide', { side: sideWord(side) })}
                    disabled={cameraBusy !== null}
                    onPress={() => void shoot(side)}
                    style={[styles.tile, isNext && styles.tileNext]}
                    testID={`check-side-${side}`}
                  >
                    {photo ? (
                      <Image source={{ uri: photo.uri }} style={styles.tileImage} />
                    ) : cameraBusy === side ? (
                      <ActivityIndicator color={colors.ink} />
                    ) : (
                      <Camera size={30} color={isNext ? colors.ink : colors.muted} />
                    )}
                    <View style={[styles.tileLabel, photo && styles.tileLabelOn]}>
                      {photo && <Check size={16} color="#ffffff" strokeWidth={3} />}
                      <Txt variant="strong" size={15} color={photo ? '#ffffff' : colors.ink}>{sideWord(side)}</Txt>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {taken > 0 && <Txt variant="small">{t('vehicleCheck.retakeHint')}</Txt>}
          </View>
        )}

        {problem && <Notice tone="danger" text={problem} />}
      </ScrollView>

      {step !== 'problem' && (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          {step === 'ask' && (
            <>
              <Button icon={Check} label={t('vehicleCheck.allGood')} onPress={allGood} testID="check-all-good" />
              <Button kind="outline" icon={TriangleAlert} label={t('vehicleCheck.problem')} onPress={() => setStep('problem')} testID="check-problem" />
              <Txt variant="small" style={{ textAlign: 'center' }}>{t('vehicleCheck.required')}</Txt>
            </>
          )}
          {step === 'done' && check && (
            <>
              <Button icon={ShieldCheck} label={t('vehicleCheck.continue')} onPress={leave} testID="check-continue" />
              {check.result === 'ok' && photosAdded === 0 && (
                <Button kind="outline" icon={Camera} label={t('vehicleCheck.addPhotos')} onPress={() => setStep('photos')} testID="check-add-photos" />
              )}
            </>
          )}
          {step === 'photos' && (
            <>
              {next ? (
                <Button icon={Camera} label={t('vehicleCheck.takeSide', { side: sideWord(next) })} busy={cameraBusy !== null} onPress={() => void shoot(next)} />
              ) : (
                <Button icon={Check} label={t('vehicleCheck.savePhotos')} onPress={savePhotos} testID="check-save-photos" />
              )}
              {next && taken > 0 && <Button kind="outline" label={t('vehicleCheck.savePhotos')} disabled={cameraBusy !== null} onPress={savePhotos} />}
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  vehicleLine: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  doneLine: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  doneMark: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '47%',
    flexGrow: 1,
    aspectRatio: 4 / 3,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#b8b2a6',
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileNext: { borderStyle: 'solid', borderColor: colors.amber, borderWidth: 2.5 },
  tileImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  tileLabel: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.page,
  },
  tileLabelOn: { backgroundColor: colors.blue },
  bottom: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
});
