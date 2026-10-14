// Record the fill (Phase 6, Part 3 and 3b): a full-screen silent camera at
// the office's quality (480p at about 1.0 Mbps by default, 720p at 1.5 Mbps),
// recording the whole fill from the first frame until the pump stops, at most
// 12 minutes with a countdown in the last 30 s, at least 3 s, with the
// office's checklist to tick while recording. A recording the phone
// interrupts (a call, the app sent to the back, the camera taken away) is
// kept as a piece; "Continue recording" adds another, up to three; "Use this
// video" hands the pieces to the fuel form as one fill marked interrupted.
// Nothing recorded is ever thrown away by itself; the back arrow asks.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft, Square, Video } from '@/components/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  MIN_VIDEO_SECONDS,
  setPendingVideo,
  VIDEO_BITRATE,
  type VideoQuality,
  type VideoSegment,
} from '@/lib/video';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

type Phase = 'idle' | 'recording' | 'interrupted';

export default function RecordVideoScreen() {
  const { t, language, settings } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [quality, setQuality] = useState<VideoQuality>(settings.fuel_video_quality);
  const startedAt = useRef<number | null>(null);
  const stopping = useRef<'driver' | 'interrupted' | null>(null);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

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
      if (state !== 'active' && phaseRef.current === 'recording' && camera.current && !stopping.current) {
        stopping.current = 'interrupted';
        camera.current.stopRecording();
      }
    });
    return () => sub.remove();
  }, []);

  const checklist = settings.fuel_video_checklist;
  const label = (item: { key: string; en: string; si: string }) => (language === 'si' ? item.si : item.en);
  const totalSeconds = segments.reduce((sum, s) => sum + s.durationS, 0);
  const totalBytes = segments.reduce((sum, s) => sum + s.bytes, 0);
  const left = Math.max(0, MAX_VIDEO_SECONDS - seconds);

  function toggle(key: string) {
    setTicked((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
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
        setPhase('interrupted');
        setProblem(t('fuel.recordFailed'));
        return;
      }
      if (duration < MIN_VIDEO_SECONDS) {
        discardSegment({ uri: result.uri });
        setPhase(segments.length ? 'interrupted' : 'idle');
        setProblem(t('fuel.tooShort'));
        return;
      }
      const piece = keepSegment(result.uri, duration);
      const all = [...segments, piece];
      setSegments(all);
      // The driver stopped it: the fill is done. The phone stopped it (or the 12 minutes ran out): offer to continue.
      if (how === 'driver') finish(all);
      else setPhase('interrupted');
    } catch {
      stopping.current = null;
      // The camera was taken away, or the phone refused the quality: keep what there is, offer to continue (at 480p next).
      if (quality === '720p') setQuality('480p');
      setPhase(segments.length ? 'interrupted' : 'idle');
      setProblem(t(segments.length ? 'fuel.interrupted' : 'fuel.recordFailed'));
    }
  }

  function stop() {
    if (!camera.current || phase !== 'recording' || stopping.current) return;
    stopping.current = 'driver';
    camera.current.stopRecording();
  }

  const finish = useCallback((all: VideoSegment[]) => {
    const video = assembleVideo(all, checklist.filter((i) => ticked.has(i.key)).map((i) => i.key));
    setPendingVideo(video);
    router.back();
  }, [checklist, router, ticked]);

  function leave() {
    if (phase === 'recording') {
      stop();
      return;
    }
    if (segments.length === 0) {
      router.back();
      return;
    }
    // Something is recorded: it is never thrown away without asking.
    Alert.alert(t('fuel.interrupted'), t('fuel.useVideo') + '?', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('fuel.useVideo'), onPress: () => finish(segments) },
    ]);
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

  const recording = phase === 'recording';
  const countdown = recording && left <= COUNTDOWN_SECONDS;
  const canContinue = segments.length < MAX_SEGMENTS;

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
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={leave} style={styles.back}>
          <ChevronLeft size={28} color="#fff" strokeWidth={2.6} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt variant="strong" color="#fff" size={18}>{t('fuel.recordTitle')}</Txt>
          <Txt variant="muted" color="#e4e1d8" size={14}>{t('fuel.recordHint')}</Txt>
        </View>
        <View style={[styles.timer, recording && { backgroundColor: countdown ? colors.red : colors.ink }]}>
          {recording && <View style={styles.dot} />}
          <Mono size={18} bold color="#fff">{clockOf(seconds)}</Mono>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {countdown && <Notice tone="warn" text={t('fuel.countdown', { seconds: left })} />}
        <View style={styles.checklist}>
          {checklist.map((item) => {
            const on = ticked.has(item.key);
            return (
              <Pressable key={item.key} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(item.key)} style={styles.item}>
                <View style={[styles.box, on && { backgroundColor: colors.amber, borderColor: colors.amber }]}>
                  {on && <Check size={18} color={colors.ink} strokeWidth={3} />}
                </View>
                <Txt variant="strong" color="#fff" size={16} style={{ flex: 1 }}>{label(item)}</Txt>
              </Pressable>
            );
          })}
        </View>
        {problem && <Notice tone="danger" text={problem} />}
        {phase === 'interrupted' && segments.length > 0 && (
          <View style={{ gap: 8 }}>
            <Txt variant="strong" color="#fff" size={15}>
              {`${t('fuel.recorded', { duration: clockOf(totalSeconds), size: megabytes(totalBytes) })} · ${t('fuel.segments', { n: segments.length })}`}
            </Txt>
            {canContinue
              ? <Txt variant="muted" color="#e4e1d8" size={14}>{t('fuel.segmentsLeft', { n: MAX_SEGMENTS - segments.length })}</Txt>
              : <Txt variant="muted" color="#e4e1d8" size={14}>{t('fuel.noMoreSegments')}</Txt>}
          </View>
        )}
        {!recording && phase !== 'interrupted' && (
          <Txt variant="muted" color="#e4e1d8" size={14} style={{ textAlign: 'center' }}>{t('fuel.maxLength')}</Txt>
        )}
        {recording && <Button kind="dark" icon={Square} label={t('fuel.stop')} onPress={stop} />}
        {phase === 'idle' && <Button icon={Video} label={t('fuel.start')} onPress={start} disabled={!ready} />}
        {phase === 'interrupted' && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {canContinue && <Button kind="outline" icon={Video} label={t('fuel.continueRecording')} onPress={start} disabled={!ready} style={{ flex: 1 }} />}
            {segments.length > 0 && <Button label={t('fuel.useVideo')} onPress={() => finish(segments)} style={{ flex: 1 }} />}
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
  checklist: { gap: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
