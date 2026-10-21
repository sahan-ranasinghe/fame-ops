// The clock (Material 3's time picker on Android, Google Calendar's; 21 October 2026): the time on top, its hours or its
// minutes tapped to choose which the dial sets; a 24-hour dial (outer ring 00–11, inner 12–23), then the minutes, every
// minute pickable by dragging or tapping anywhere on the face; letting go of an hour goes to the minutes. A keyboard toggle
// types the time instead. Pure JS (react-native and react-native-web); the math is lib/patterns/dialLogic.ts.

import { useRef, useState } from 'react';
import { type GestureResponderEvent, PanResponder, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Clock, Keyboard } from '@/components/icons';
import { Mono, Txt } from '@/components/ui';
import { type DialMode, dialLabels, hhmm, hourAt, minuteAt, partsOf, placeOf, pointOf, typedPart } from '@/lib/patterns/dialLogic';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

const SIZE = 264;
const C = SIZE / 2;
const OUTER = 108;
const INNER = 72;
const KNOB = 40;

export function TimeDial({ value, onChange, testID }: { value: string; onChange: (time: string) => void; testID?: string }) {
  const { t } = useApp();
  const { h, m } = partsOf(value);
  const [mode, setMode] = useState<DialMode>('hour');
  const [typing, setTyping] = useState(false);
  const [typedH, setTypedH] = useState(String(h).padStart(2, '0'));
  const [typedM, setTypedM] = useState(String(m).padStart(2, '0'));
  const face = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const latest = useRef({ h, m, mode });
  latest.current = { h, m, mode };

  const setAt = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.pageX - origin.current.x;
    const y = e.nativeEvent.pageY - origin.current.y;
    const cur = latest.current;
    if (cur.mode === 'hour') onChange(hhmm(hourAt(x, y, C, C, OUTER, INNER), cur.m));
    else onChange(hhmm(cur.h, minuteAt(x, y, C, C)));
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: (e) => {
      // The face's page origin from the first touch (its children take no touches, so locationX/Y are the face's own).
      // Not measureInWindow: inside an Android Modal its window coordinates can differ from the page's by the status bar.
      origin.current = { x: e.nativeEvent.pageX - e.nativeEvent.locationX, y: e.nativeEvent.pageY - e.nativeEvent.locationY };
      setAt(e);
    },
    onPanResponderMove: (e) => setAt(e),
    onPanResponderRelease: () => { if (latest.current.mode === 'hour') setMode('minute'); },
  })).current;

  const sel = placeOf(mode, mode === 'hour' ? h : m, OUTER, INNER);
  const knob = pointOf(sel.angle, sel.radius, C, C);
  const step = (d: number) => onChange(mode === 'hour' ? hhmm(h + d, m) : hhmm(h, m + d));

  const commitTyped = (hh: string, mm: string) => {
    const th = typedPart(hh, 23);
    const tm = typedPart(mm, 59);
    if (th !== null && tm !== null) onChange(hhmm(th, tm));
  };

  return (
    <View style={{ alignItems: 'center', gap: 14 }} testID={testID}>
      <View style={styles.top}>
        {typing ? (
          <View style={styles.typedRow}>
            <TextInput value={typedH} onChangeText={(v) => { setTypedH(v); commitTyped(v, typedM); }} keyboardType="number-pad" maxLength={2}
              accessibilityLabel={t('patterns.hour')} style={styles.typed} selectTextOnFocus testID="time-type-hour" />
            <Mono size={40} bold>:</Mono>
            <TextInput value={typedM} onChangeText={(v) => { setTypedM(v); commitTyped(typedH, v); }} keyboardType="number-pad" maxLength={2}
              accessibilityLabel={t('patterns.minute')} style={styles.typed} selectTextOnFocus testID="time-type-minute" />
          </View>
        ) : (
          <View style={styles.typedRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.hour')} accessibilityState={{ selected: mode === 'hour' }} onPress={() => setMode('hour')}
              style={[styles.part, mode === 'hour' && styles.partOn]} testID="time-part-hour">
              <Mono size={40} bold color={mode === 'hour' ? colors.blue : colors.ink}>{String(h).padStart(2, '0')}</Mono>
            </Pressable>
            <Mono size={40} bold>:</Mono>
            <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.minute')} accessibilityState={{ selected: mode === 'minute' }} onPress={() => setMode('minute')}
              style={[styles.part, mode === 'minute' && styles.partOn]} testID="time-part-minute">
              <Mono size={40} bold color={mode === 'minute' ? colors.blue : colors.ink}>{String(m).padStart(2, '0')}</Mono>
            </Pressable>
          </View>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel={t(typing ? 'patterns.useDial' : 'patterns.typeTime')}
          onPress={() => { setTypedH(String(h).padStart(2, '0')); setTypedM(String(m).padStart(2, '0')); setTyping((x) => !x); }} style={styles.toggle} testID="time-keyboard">
          {typing ? <Clock size={24} color={colors.ink} /> : <Keyboard size={24} color={colors.ink} />}
        </Pressable>
      </View>

      {!typing && (
        <View
          ref={face}
          style={styles.face}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t(mode === 'hour' ? 'patterns.hour' : 'patterns.minute')}
          accessibilityValue={{ text: hhmm(h, m) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          testID="time-dial"
          {...pan.panHandlers}
        >
          <View pointerEvents="none" style={[styles.hand, { height: sel.radius, left: C - 1, top: C - sel.radius, transform: [{ translateY: sel.radius / 2 }, { rotate: `${sel.angle}deg` }, { translateY: -sel.radius / 2 }] }]} />
          <View pointerEvents="none" style={[styles.centre, { left: C - 4, top: C - 4 }]} />
          <View pointerEvents="none" style={[styles.knob, { left: knob.x - KNOB / 2, top: knob.y - KNOB / 2 }]} />
          {dialLabels(mode).map((l) => {
            const p = pointOf(placeOf(mode, l.value, OUTER, INNER).angle, l.inner ? INNER : OUTER, C, C);
            const on = mode === 'hour' ? l.value === h : l.value === m;
            return (
              <View key={l.value} pointerEvents="none" style={[styles.label, { left: p.x - 18, top: p.y - 14 }]}>
                <Txt variant={l.inner ? 'small' : 'strong'} size={l.inner ? 13 : 16} color={on ? '#ffffff' : l.inner ? colors.muted : colors.ink}>{l.text}</Txt>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  typedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  part: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: '#ebe9e3' },
  partOn: { backgroundColor: colors.blueChip },
  typed: { width: 76, textAlign: 'center', fontFamily: fonts.monoSemiBold, fontSize: 36, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingVertical: 4, color: colors.ink, backgroundColor: colors.card },
  toggle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  face: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: '#ebe9e3' },
  hand: { position: 'absolute', width: 2, backgroundColor: colors.blue },
  centre: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.blue },
  knob: { position: 'absolute', width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: colors.blue },
  label: { position: 'absolute', width: 36, height: 28, alignItems: 'center', justifyContent: 'center' },
});
