// Record the fill (Phase 6, Part 3): a full-screen camera, silent, 720p at
// about 1.5 Mbps (480p when the phone has no 720p), at most 90 seconds, with
// the office's checklist on screen to tick while recording. Stop keeps the
// file in the app's folder and hands it back to the fuel form; the back arrow
// or a recording shorter than 3 s throws it away.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft, Square, Video } from '@/components/icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Mono, Notice, Txt } from '@/components/ui';
import { clockOf, discardVideo, keepRecording, MAX_VIDEO_SECONDS, setPendingVideo } from '@/lib/video';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const MIN_SECONDS = 3;

export default function RecordVideoScreen() {
  const { t, language, settings } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [quality, setQuality] = useState<'720p' | '480p'>('720p');
  const startedAt = useRef<number | null>(null);
  const stopping = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 250);
    return () => clearInterval(timer);
  }, [recording]);

  const checklist = settings.fuel_video_checklist;
  const label = (item: { key: string; en: string; si: string }) => (language === 'si' ? item.si : item.en);

  function toggle(key: string) {
    setTicked((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function start() {
    if (!camera.current || recording) return;
    setProblem(null);
    setRecording(true);
    setSeconds(0);
    startedAt.current = Date.now();
    stopping.current = false;
    try {
      const result = await camera.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
      const duration = (Date.now() - (startedAt.current ?? Date.now())) / 1000;
      setRecording(false);
      if (!result?.uri) {
        setProblem(t('fuel.recordFailed'));
        return;
      }
      if (duration < MIN_SECONDS) {
        discardVideo({ id: '', uri: result.uri, durationS: 0, bytes: 0, recordedAt: '', checklist: [] });
        setProblem(t('fuel.tooShort'));
        return;
      }
      const kept = keepRecording(result.uri, duration, checklist.filter((i) => ticked.has(i.key)).map((i) => i.key));
      setPendingVideo(kept);
      router.back();
    } catch {
      setRecording(false);
      if (quality === '720p') {
        // Some phones refuse 720p: the next try uses 480p.
        setQuality('480p');
        setProblem(t('fuel.recordFailed'));
      } else {
        setProblem(t('fuel.recordFailed'));
      }
    }
  }

  function stop() {
    if (!camera.current || !recording || stopping.current) return;
    stopping.current = true;
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
        videoBitrate={quality === '720p' ? 1_500_000 : 1_000_000}
        onCameraReady={() => setReady(true)}
      />
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => (recording ? stop() : router.back())} style={styles.back}>
          <ChevronLeft size={28} color="#fff" strokeWidth={2.6} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Txt variant="strong" color="#fff" size={18}>{t('fuel.recordTitle')}</Txt>
          <Txt variant="muted" color="#e4e1d8" size={14}>{t('fuel.recordHint')}</Txt>
        </View>
        <View style={[styles.timer, recording && { backgroundColor: colors.red }]}>
          {recording && <View style={styles.dot} />}
          <Mono size={18} bold color="#fff">{clockOf(seconds)}</Mono>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
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
        <Txt variant="muted" color="#e4e1d8" size={14} style={{ textAlign: 'center' }}>{t('fuel.maxLength', { seconds: MAX_VIDEO_SECONDS })}</Txt>
        {recording
          ? <Button kind="dark" icon={Square} label={t('fuel.stop')} onPress={stop} />
          : <Button icon={Video} label={t('fuel.start')} onPress={start} disabled={!ready} />}
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
