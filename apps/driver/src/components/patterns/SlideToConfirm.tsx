// Round 2 (21 October 2026): the one slide-to-confirm (Uber's "slide to arrive", PickMe, DoorDash): a wide track with a
// round thumb the driver drags to the right. It completes only when let go at 90 % of the way or more
// (lib/patterns/slideLogic.ts); anything less springs back. A tap never completes it: there is no press handler at all.
// Screen readers: the track is "adjustable" with the action "activate" (TalkBack's double tap), which completes it — the
// one path without a drag. Disabled: greyed, no drag. Busy: a spinner on the thumb, no drag.
// The drag uses React Native's own touch responder (the system PanResponder is built on): no native module, so the same
// control runs on the phone and on react-native-web (/m/).
// Round 4–7, item 12 (design/mockups/2026-10-22, mockup 6): the mockup's look: the main step on a light amber track with
// its thin amber edge, the amber thumb with the arrow and its shadow, the words in deep amber; the dark (leave, finish)
// and outline (the override) tones keep their colours with the same thumb and arrow. `text` is the shorter words shown
// when the screen already names the stop ("Slide when you arrive" under the stop's name); `label` stays what a screen
// reader says.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ArrowRight } from '@/components/icons';
import { Txt } from '@/components/ui';
import { slideOffset, slideRelease, slideTravel } from '@/lib/patterns/slideLogic';
import { useApp } from '@/state/app';
import { colors, shadow } from '@/theme';

// The drag moves the thumb from JavaScript (setValue on every move), so the spring back and the finish run there too: one
// driver for the value, the same on the phone and the web.
const NATIVE_DRIVER = false;
const THUMB = 56;
const PAD = 4;

export interface SlideToConfirmProps {
  /** Already in the person's language: "Slide when you arrive at Kurunegala site" (what a screen reader says). */
  label: string;
  /** The words on the track when shorter than the label ("Slide when you arrive"); the label otherwise. */
  text?: string;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** primary: amber (the main step); dark: ink; outline: the second way (an override). */
  tone?: 'primary' | 'dark' | 'outline';
  testID?: string;
}

export function SlideToConfirm({ label, text: shown, onConfirm, disabled = false, busy = false, tone = 'primary', testID }: SlideToConfirmProps) {
  const { t } = useApp();
  const [travel, setTravel] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const start = useRef<number | null>(null);
  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  }, [onConfirm]);
  const locked = disabled || busy;

  // A new label (the next step) or a lock starts the thumb at the left again.
  useEffect(() => {
    x.setValue(0);
  }, [label, locked, x]);

  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: NATIVE_DRIVER, bounciness: 6 }).start();
  const complete = () => {
    Animated.timing(x, { toValue: travel, duration: 120, useNativeDriver: NATIVE_DRIVER }).start(() => {
      x.setValue(0);
    });
    confirmRef.current();
  };

  const onLayout = (e: LayoutChangeEvent) => setTravel(slideTravel(e.nativeEvent.layout.width, THUMB, PAD));
  const pageX = (e: GestureResponderEvent) => e.nativeEvent.pageX ?? 0;
  const responder = {
    onStartShouldSetResponder: () => !locked,
    onMoveShouldSetResponder: () => !locked,
    // A list scrolling under the finger never takes the drag away half way.
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      start.current = pageX(e);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      if (start.current === null) return;
      x.setValue(slideOffset(pageX(e) - start.current, travel));
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const from = start.current;
      start.current = null;
      if (from === null || locked) return back();
      if (slideRelease(pageX(e) - from, travel) === 'done') complete();
      else back();
    },
    onResponderTerminate: () => {
      start.current = null;
      back();
    },
  };

  const track = tone === 'primary' ? colors.amberSoft : tone === 'dark' ? colors.ink : colors.card;
  const text = tone === 'dark' ? '#ffffff' : tone === 'primary' ? colors.amberDeep : colors.ink;
  const thumbBg = tone === 'outline' ? colors.ink : colors.amber;
  const arrow = tone === 'outline' ? '#ffffff' : colors.ink;
  const fade = travel > 0 ? x.interpolate({ inputRange: [0, travel * 0.6], outputRange: [1, 0], extrapolate: 'clamp' }) : 1;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint={t('patterns.slideHint')}
      accessibilityState={{ disabled: locked, busy }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate' && !locked) confirmRef.current();
      }}
      onLayout={onLayout}
      testID={testID}
      style={[styles.track, { backgroundColor: track }, tone === 'primary' && styles.primaryEdge, tone === 'outline' && styles.outline, locked && { opacity: disabled ? 0.45 : 0.8 }]}
    >
      <Animated.View pointerEvents="none" style={[styles.labelWrap, { opacity: fade }]}>
        <Txt variant="strong" size={16} color={text} numberOfLines={2} style={{ textAlign: 'center' }}>{shown ?? label}</Txt>
      </Animated.View>
      <Animated.View
        {...responder}
        testID={testID ? `${testID}-thumb` : undefined}
        style={[styles.thumb, { backgroundColor: thumbBg, transform: [{ translateX: x }] }, shadow(3)]}
      >
        {busy ? <ActivityIndicator color={arrow} /> : <ArrowRight size={22} color={arrow} strokeWidth={2.4} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { minHeight: THUMB + 2 * PAD, borderRadius: (THUMB + 2 * PAD) / 2, padding: PAD, justifyContent: 'center', overflow: 'hidden' },
  outline: { borderWidth: 1.5, borderColor: colors.line },
  primaryEdge: { borderWidth: 1, borderColor: colors.amberEdge },
  labelWrap: { position: 'absolute', left: THUMB + 2 * PAD, right: 16, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2, alignItems: 'center', justifyContent: 'center' },
});
