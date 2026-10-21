// Office mode: the one playback bar (O2 on Live; Stage 1, O3 item 1 on a driver's day and a task's driven route), as the
// website's (Phase 7 §22): Play / Pause, 1× 5× 20× 60×, a time slider (a touch or a drag jumps there), the recorded time to
// the second with the speed or "estimated". The clock runs on a 125 ms tick (the phone has no animation frame worth the
// battery) and pauses when the screen leaves the front. The maths: office/liveRouteLogic.ts; the marker is drawn by the
// map (Live's DriversMap `cursor`, RouteMap's `marker`) on both engines.

import { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View } from 'react-native';

import Pause from 'lucide-react-native/icons/pause';

import { Play } from '@/components/icons';
import { Mono, Txt } from '@/components/ui';
import { ChoiceChip } from '@/components/patterns/Select';
import { advance, clockS, type Cursor, type PathPoint, PLAYBACK_TICK_MS, type PlaybackSpeed, sliderFraction, SPEEDS, timeAtFraction } from '@/office/liveRouteLogic';
import { useApp } from '@/state/app';
import { colors, shadow } from '@/theme';

// ---- Playback (the site's usePlayback on a timer: the phone has no animation frame worth the battery) ------------------

export interface Playback {
  /** The recorded time the marker is at, Unix ms. */
  t: number;
  start: number;
  end: number;
  playing: boolean;
  /** Playing, or moved away from the start: the marker is shown. */
  active: boolean;
  speed: PlaybackSpeed;
  toggle: () => void;
  /** To any moment (clamped to the route). */
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

/**
 * The clock runs in recorded time at 1×, 5×, 20× or 60× on a 125 ms tick (each tick moves it on by the real time since
 * the last × the speed, a long tick capped), and stops at the end. A new route (another driver) starts it again at its
 * start, paused; new points on the same route leave the clock alone. Leaving the tab pauses it.
 */
export function usePlayback(path: PathPoint[], focused: boolean): Playback {
  const start = path[0]?.at ?? 0;
  const end = path[path.length - 1]?.at ?? 0;
  const [t, setT] = useState(start);
  const tRef = useRef(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(60);
  const speedRef = useRef<PlaybackSpeed>(60);
  const endRef = useRef(end);
  endRef.current = end;

  useEffect(() => {
    tRef.current = start;
    setT(start);
    setPlaying(false);
  }, [start]);
  useEffect(() => {
    if (!focused) setPlaying(false);
  }, [focused]);

  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const next = advance(tRef.current, now - last, speedRef.current, endRef.current);
      last = now;
      tRef.current = next;
      setT(next);
      if (next >= endRef.current) setPlaying(false);
    }, PLAYBACK_TICK_MS);
    return () => clearInterval(timer);
  }, [playing]);

  const seek = useCallback((v: number) => {
    const clamped = Math.max(start, Math.min(end, v));
    tRef.current = clamped;
    setT(clamped);
  }, [start, end]);
  const toggle = useCallback(() => {
    if (!playing && tRef.current >= end) seek(start);
    setPlaying((p) => !p);
  }, [playing, end, start, seek]);
  const setSpeed = useCallback((s: PlaybackSpeed) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);
  const shown = Math.max(start, Math.min(end, t));
  return { t: shown, start, end, playing, active: playing || shown > start, speed, toggle, seek, setSpeed };
}

/**
 * The bar under the card's lines: Play / Pause and the speeds on one row (48 px each), then the time slider from the
 * day's first minute with the clock (the recorded time to the second, the speed or "estimated") on its right.
 */
export function PlaybackBar({ playback, cursor }: { playback: Playback; cursor: Cursor | null }) {
  const { t } = useApp();
  const words = cursor ? (cursor.estimated ? t('office.live.estimated') : cursor.kmh === null ? '' : t('office.live.kmh', { n: cursor.kmh })) : '';
  return (
    <View style={styles.playback} testID="live-playback">
      <View style={styles.playRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playback.playing ? t('office.live.pause') : t('office.live.play')}
          onPress={playback.toggle}
          testID="live-play"
          style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}
        >
          {playback.playing ? <Pause size={22} color="#ffffff" strokeWidth={2.6} /> : <Play size={22} color="#ffffff" strokeWidth={2.6} />}
        </Pressable>
        {SPEEDS.map((s) => {
          const on = s === playback.speed;
          // The shared chip (docs/ui-patterns.md §11): the picked speed has its check, the tint and the border.
          return <ChoiceChip key={s} small mono label={`${s}×`} selected={on} onPress={() => playback.setSpeed(s)} />;
        })}
      </View>
      <View style={styles.sliderRow}>
        <Mono size={12} color={colors.muted}>{clockS(playback.start).slice(0, 5)}</Mono>
        <Slider fraction={sliderFraction(playback.t, playback.start, playback.end)} onSeek={(k) => playback.seek(timeAtFraction(k, playback.start, playback.end))} label={t('office.live.slider')} />
        <View style={styles.clock}>
          <Mono size={15} bold>{cursor ? cursor.time : clockS(playback.t)}</Mono>
          {words ? <Txt variant="small" size={12} numberOfLines={1}>{words}</Txt> : null}
        </View>
      </View>
    </View>
  );
}

/** A time slider (no slider module in the build): a track with a thumb; a touch or a drag anywhere on it jumps there. */
function Slider({ fraction, onSeek, label }: { fraction: number; onSeek: (k: number) => void; label: string }) {
  const width = useRef(0);
  const left = useRef(0);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const seekAt = (pageX: number) => {
    if (width.current > 0) seekRef.current((pageX - left.current) / width.current);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      // Where the track starts on the screen: the touch's page position less its position inside the track.
      left.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
      seekAt(e.nativeEvent.pageX);
    },
    onPanResponderMove: (e) => seekAt(e.nativeEvent.pageX),
  })).current;
  const pct = Math.round(fraction * 100);
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => { width.current = e.nativeEvent.layout.width; }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => seekRef.current(Math.max(0, Math.min(1, fraction + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))))}
      style={styles.track}
      testID="live-slider"
    >
      <View style={styles.trackBar} pointerEvents="none">
        <View style={[styles.trackFill, { width: `${pct}%` }]} />
      </View>
      <View style={[styles.thumb, { left: `${pct}%` }]} pointerEvents="none" />
    </View>
  );
}

const THUMB = 24;

const styles = StyleSheet.create({
  playback: { gap: 4, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  clock: { alignItems: 'flex-end', minWidth: 76 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 48, justifyContent: 'center' },
  trackBar: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  trackFill: { height: 6, backgroundColor: colors.blue },
  thumb: { position: 'absolute', top: (48 - THUMB) / 2, marginLeft: -THUMB / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.blue, borderWidth: 3, borderColor: colors.card, ...shadow(2) },
});
