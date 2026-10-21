// Round 2 (21 October 2026): the one slide-to-confirm (Uber's "slide to arrive", PickMe, DoorDash): a wide track with a
// round thumb the driver drags to the right. It completes only when let go at 90 % of the way or more
// (lib/patterns/slideLogic.ts); anything less springs back. A tap never completes it: there is no press handler at all.
// Screen readers: the track is "adjustable" with the action "activate" (TalkBack's double tap), which completes it — the
// one path without a drag. Disabled: greyed, no drag. Busy: a spinner on the thumb, no drag.
// The drag uses React Native's own touch responder (the system PanResponder is built on): no native module, so the same
// control runs on the phone and on react-native-web (/m/).

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ChevronRight } from '@/components/icons';
import { Txt } from '@/components/ui';
import { slideOffset, slideRelease, slideTravel } from '@/lib/patterns/slideLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

// The drag moves the thumb from JavaScript (setValue on every move), so the spring back and the finish run there too: one
// driver for the value, the same on the phone and the web.
const NATIVE_DRIVER = false;
const THUMB = 56;
const PAD = 4;

export interface SlideToConfirmProps {
  /** Already in the person's language: "Slide when you arrive at Kurunegala site". */
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** primary: amber (the main step); dark: ink; outline: the second way (an override). */
  tone?: 'primary' | 'dark' | 'outline';
  testID?: string;
}

export function SlideToConfirm({ label, onConfirm, disabled = false, busy = false, tone = 'primary', testID }: SlideToConfirmProps) {
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

  const track = tone === 'primary' ? colors.amber : tone === 'dark' ? colors.ink : colors.card;
  const text = tone === 'dark' ? '#ffffff' : colors.ink;
  const thumbBg = tone === 'dark' ? colors.amber : colors.ink;
  const arrow = tone === 'dark' ? colors.ink : '#ffffff';
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
      style={[styles.track, { backgroundColor: track }, tone === 'outline' && styles.outline, locked && { opacity: disabled ? 0.45 : 0.8 }]}
    >
      <Animated.View pointerEvents="none" style={[styles.labelWrap, { opacity: fade }]}>
        <Txt variant="button" color={text} numberOfLines={2} style={{ textAlign: 'center' }}>{label}</Txt>
      </Animated.View>
      <Animated.View
        {...responder}
        testID={testID ? `${testID}-thumb` : undefined}
        style={[styles.thumb, { backgroundColor: thumbBg, transform: [{ translateX: x }] }]}
      >
        {busy ? <ActivityIndicator color={arrow} /> : <ChevronRight size={30} color={arrow} strokeWidth={3} />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { minHeight: THUMB + 2 * PAD, borderRadius: (THUMB + 2 * PAD) / 2, padding: PAD, justifyContent: 'center', overflow: 'hidden' },
  outline: { borderWidth: 1.5, borderColor: colors.line },
  labelWrap: { position: 'absolute', left: THUMB + 2 * PAD, right: 16, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2, alignItems: 'center', justifyContent: 'center' },
});
