// Record the fill (Phase 6, Part 3 and 3b): a full-screen silent camera at
// the office's quality (480p at about 1.0 Mbps by default, 720p at 1.5 Mbps),
// recording the whole fill from the first frame until the pump stops: a piece
// lasts at most 12 minutes with a countdown in the last 30 s, the fill at
// least 30 s. The office's steps are shown one at a time, in order (number
// plate, the pump display at zero, pumping, the final display): the driver
// ticks the current step to move to the next, and Stop opens after the last
// one. Each tick's second in the fill is kept with the entry: the office's
// bookmarks. A recording the phone interrupts (a call, the app sent to the
// back, the camera taken away) is kept as a piece; "Continue recording" adds
// another, up to three; "Use this video" hands the pieces to the fuel form as
// one fill marked interrupted. Nothing recorded is ever thrown away by
// itself: the back arrow, the back button and the gesture all ask first.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft, Square, Video } from '@/components/icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Mono, Notice, Txt } from '@/components/ui';
import {
  assembleVideo,
  clockOf,
  COUNTDOWN_SECONDS,
  discardSegment,
  keepSegment,
  MAX_SEGMENTS,
  MAX_VIDEO_SECONDS,
  megabytes,
  MIN_PIECE_SECONDS,
  MIN_VIDEO_SECONDS,
  setPendingVideo,
  VIDEO_BITRATE,
  type VideoMark,
  type VideoQuality,
  type VideoSegment,
} from '@/lib/video';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

type Phase = 'idle' | 'recording' | 'interrupted';
/** Two taps closer than this count as one (a step is never ticked twice by a double tap). */
const TICK_GAP_MS = 700;

export default function RecordVideoScreen() {
  const { t, language, settings } = useApp();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [marks, setMarks] = useState<VideoMark[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [quality, setQuality] = useState<VideoQuality>(settings.fuel_video_quality);
  const startedAt = useRef<number | null>(null);
  const stopping = useRef<'driver' | 'interrupted' | null>(null);
  const lastTick = useRef(0);
  const leaving = useRef(false);
  // The async flows (the recording's end, the leave listener) read the live values here.
  const phaseRef = useRef<Phase>('idle');
  const segmentsRef = useRef<VideoSegment[]>([]);
  const marksRef = useRef<VideoMark[]>([]);
  phaseRef.current = phase;
  segmentsRef.current = segments;
  marksRef.current = marks;

  const steps = settings.fuel_video_checklist;
  const label = (item: { key: string; en: string; si: string }) => (language === 'si' ? item.si : item.en);
  const stepIndex = marks.length;
  const current = steps[stepIndex];
  const allDone = marks.length >= steps.length;
  const recording = phase === 'recording';
  const totalSeconds = segments.reduce((sum, s) => sum + s.durationS, 0);
  const totalBytes = segments.reduce((sum, s) => sum + s.bytes, 0);
  /** The fill so far: the recorded pieces and the piece under way. */
  const fillSeconds = totalSeconds + (recording ? seconds : 0);
  const left = Math.max(0, MAX_VIDEO_SECONDS - seconds);
  const countdown = recording && left <= COUNTDOWN_SECONDS;
  const canContinue = segments.length < MAX_SEGMENTS;
  /** Stop opens after the last step, once the fill is 30 s. */
  const canStop = allDone && fillSeconds >= MIN_VIDEO_SECONDS;
  /** The pieces may be used when the steps are done and the fill is long enough, or when no more pieces can be added (never a retake). */
  const usable = segments.length > 0 && ((allDone && totalSeconds >= MIN_VIDEO_SECONDS) || !canContinue);
  const missing = !allDone ? t('fuel.stepsLeft', { n: steps.length - marks.length }) : t('fuel.minLength');

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);

  // A call or the app sent to the back: the recording stops; what was recorded is kept.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') interrupt();
    });
    return () => sub.remove();
  }, []);

  // Leaving (the arrow, the back button, the gesture): a piece under way is kept first; recorded pieces are never dropped without asking.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current) return;
        if (phaseRef.current === 'recording') {
          event.preventDefault();
          interrupt();
          return;
        }
        const pieces = segmentsRef.current;
        if (pieces.length === 0) return;
        event.preventDefault();
        const go = () => {
          leaving.current = true;
          navigation.dispatch(event.data.action);
        };
        const done = marksRef.current.length >= steps.length;
        const total = pieces.reduce((sum, s) => sum + s.durationS, 0);
        const ok = (done && total >= MIN_VIDEO_SECONDS) || pieces.length >= MAX_SEGMENTS;
        if (ok) {
          Alert.alert(t('fuel.interrupted'), `${t('fuel.useVideo')}?`, [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('fuel.useVideo'), onPress: () => { hand(pieces); go(); } },
          ]);
        } else {
          const why = !done ? t('fuel.stepsLeft', { n: steps.length - marksRef.current.length }) : t('fuel.minLength');
          Alert.alert(t('fuel.interrupted'), t('fuel.notComplete', { reason: why }), [
            { text: t('fuel.continueRecording'), style: 'cancel' },
            { text: t('fuel.discardPieces'), style: 'destructive', onPress: () => { pieces.forEach(discardSegment); go(); } },
          ]);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigation, steps.length, t],
  );

  /** The phone (or the back arrow) stops the piece: it is kept, the driver may continue. */
  function interrupt() {
    if (phaseRef.current === 'recording' && camera.current && !stopping.current) {
      stopping.current = 'interrupted';
      camera.current.stopRecording();
    }
  }

  /** The pieces become the fill the form takes. */
  function hand(all: VideoSegment[]) {
    setPendingVideo(assembleVideo(all, marksRef.current));
  }

  function finish(all: VideoSegment[]) {
    hand(all);
    leaving.current = true;
    router.back();
  }

  /** The current step is shown: its second in the fill is kept, the next step comes up. */
  function tick() {
    if (phaseRef.current !== 'recording' || startedAt.current === null) return;
    const now = Date.now();
    if (now - lastTick.current < TICK_GAP_MS) return;
    lastTick.current = now;
    const before = segmentsRef.current.reduce((sum, s) => sum + s.durationS, 0);
    const at = Math.round(before + (now - startedAt.current) / 1000);
    setMarks((list) => {
      const step = steps[list.length];
      return step ? [...list, { key: step.key, at_s: at }] : list;
    });
  }

  async function start() {
    if (!camera.current || phase === 'recording') return;
    setProblem(null);
    setPhase('recording');
    setSeconds(0);
    startedAt.current = Date.now();
    stopping.current = null;
    try {
      const result = await camera.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
      const duration = (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      const how = stopping.current;
      stopping.current = null;
      if (!result?.uri) {
        setPhase(segmentsRef.current.length ? 'interrupted' : 'idle');
        setProblem(t('fuel.recordFailed'));
        return;
      }
      if (duration < MIN_PIECE_SECONDS) {
        // Nothing worth keeping (the camera stopped at once): not a piece.
        discardSegment({ uri: result.uri });
        setPhase(segmentsRef.current.length ? 'interrupted' : 'idle');
        setProblem(t('fuel.recordFailed'));
        return;
      }
      const piece = keepSegment(result.uri, duration);
      const all = [...segmentsRef.current, piece];
      segmentsRef.current = all;
      setSegments(all);
      // The driver stopped it (after the last step): the fill is done. The phone stopped it (or the 12 minutes ran out): offer to continue.
      if (how === 'driver') finish(all);
      else setPhase('interrupted');
    } catch {
      stopping.current = null;
      // The camera was taken away, or the phone refused the quality: keep what there is, offer to continue (at 480p next).
      if (quality === '720p') setQuality('480p');
      setPhase(segmentsRef.current.length ? 'interrupted' : 'idle');
      setProblem(t(segmentsRef.current.length ? 'fuel.interrupted' : 'fuel.recordFailed'));
    }
  }

  function stop() {
    if (!camera.current || phase !== 'recording' || stopping.current || !canStop) return;
    stopping.current = 'driver';
    camera.current.stopRecording();
  }

  if (!permission) return <View style={styles.page} />;
  if (!permission.granted) {
    return (
      <View style={[styles.page, { padding: 20, paddingTop: insets.top + 20, gap: 16 }]}>
        <StatusBar style="light" />
        <Notice tone="danger" text={t('fuel.cameraDenied')} />
        <Button kind="outline" label={t('common.cancel')} onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <StatusBar style="light" />
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="video"
        mute
        videoQuality={quality}
        videoBitrate={VIDEO_BITRATE[quality]}
        onCameraReady={() => setReady(true)}
      />
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
          <ChevronLeft size={28} color="#fff" strokeWidth={2.6} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt variant="strong" color="#fff" size={18}>{t('fuel.recordTitle')}</Txt>
          <Txt variant="muted" color="#e4e1d8" size={14}>{t('fuel.recordHint')}</Txt>
        </View>
        <View style={[styles.timer, recording && { backgroundColor: countdown ? colors.red : colors.ink }]}>
          {recording && <View style={styles.dot} />}
          <Mono size={18} bold color="#fff">{clockOf(fillSeconds)}</Mono>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {countdown && <Notice tone="warn" text={t('fuel.countdown', { seconds: left })} />}

        {recording && current && (
          <Pressable accessibilityRole="button" accessibilityLabel={`${label(current)} · ${t('fuel.tickStep')}`} onPress={tick} style={styles.stepCard}>
            <Txt variant="label" color="#e4e1d8" size={13}>{t('fuel.step', { n: stepIndex + 1, total: steps.length })}</Txt>
            <Txt variant="strong" color="#fff" size={26} style={{ lineHeight: 32 }}>{label(current)}</Txt>
            <View style={styles.tickRow}>
              <View style={styles.tickBox}>
                <Check size={22} color={colors.ink} strokeWidth={3} />
              </View>
              <Txt variant="strong" color={colors.amber} size={17}>{t('fuel.tickStep')}</Txt>
            </View>
          </Pressable>
        )}
        {recording && allDone && <Notice tone="info" text={t('fuel.allSteps')} />}

        {!recording && phase === 'idle' && (
          <View style={styles.list}>
            {steps.map((item, i) => (
              <Txt key={item.key} variant="strong" color="#fff" size={15}>{`${i + 1}. ${label(item)}`}</Txt>
            ))}
          </View>
        )}

        {marks.length > 0 && (
          <Txt variant="muted" color="#e4e1d8" size={14}>{marks.map((m, i) => `${i + 1} ✓ ${clockOf(m.at_s)}`).join(' · ')}</Txt>
        )}

        {problem && <Notice tone="danger" text={problem} />}
        {phase === 'interrupted' && segments.length > 0 && (
          <View style={{ gap: 6 }}>
            <Txt variant="strong" color="#fff" size={15}>
              {`${t('fuel.recorded', { duration: clockOf(totalSeconds), size: megabytes(totalBytes) })} · ${t('fuel.segments', { n: segments.length })}`}
            </Txt>
            {!usable && <Txt variant="muted" color="#e4e1d8" size={14}>{missing}</Txt>}
            {canContinue
              ? <Txt variant="muted" color="#e4e1d8" size={14}>{t('fuel.segmentsLeft', { n: MAX_SEGMENTS - segments.length })}</Txt>
              : <Txt variant="muted" color="#e4e1d8" size={14}>{t('fuel.noMoreSegments')}</Txt>}
          </View>
        )}
        {phase === 'idle' && (
          <Txt variant="muted" color="#e4e1d8" size={14} style={{ textAlign: 'center' }}>{t('fuel.maxLength')}</Txt>
        )}

        {recording && (
          <View style={{ gap: 6 }}>
            <Button kind="dark" icon={Square} label={t('fuel.stop')} onPress={stop} disabled={!canStop} />
            {!canStop && <Txt variant="muted" color="#e4e1d8" size={13} style={{ textAlign: 'center' }}>{!allDone ? t('fuel.stopAfterSteps') : t('fuel.minLength')}</Txt>}
          </View>
        )}
        {phase === 'idle' && <Button icon={Video} label={t('fuel.start')} onPress={start} disabled={!ready} />}
        {phase === 'interrupted' && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {canContinue && <Button kind={usable ? 'outline' : 'primary'} icon={Video} label={t('fuel.continueRecording')} onPress={start} disabled={!ready} style={{ flex: 1 }} />}
            {segments.length > 0 && <Button kind={usable ? 'primary' : 'outline'} label={t('fuel.useVideo')} onPress={() => finish(segments)} disabled={!usable} style={{ flex: 1 }} />}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, gap: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  stepCard: { gap: 8, padding: 16, borderRadius: 16, borderWidth: 2, borderColor: colors.amber, backgroundColor: 'rgba(0,0,0,0.5)' },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  tickBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.amber, alignItems: 'center', justifyContent: 'center' },
  list: { gap: 4 },
});
