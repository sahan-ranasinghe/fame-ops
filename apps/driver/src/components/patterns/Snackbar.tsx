// Hotfix O2-H2, Part 1b: the one snackbar (Material's snackbar, Gmail's "Sent · View" / "Conversation archived · Undo"):
// a dark bar at the bottom, one line of text and at most one action, about 4 s (6 s with an action), one at a time (a new
// one replaces the shown one). `showSnackbar` is a plain function, so a save, a background write that failed or the
// global error handler can call it from anywhere; `SnackbarHost` is drawn once at the root, above every screen.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { colors } from '@/theme';

export interface SnackbarAction {
  label: string;
  onPress: () => void;
}
export interface Snack {
  /** Already in the person's language. */
  text: string;
  action?: SnackbarAction;
  /** red: something failed (the text says what). */
  tone?: 'default' | 'error';
  /** How long it stays (ms); default 4 s, 6 s with an action. */
  ms?: number;
}

/** The time a snackbar stays: 4 s, 6 s when it offers an action (Material's guidance). */
export const SNACK_MS = 4_000;
export const SNACK_ACTION_MS = 6_000;
export const snackDuration = (s: Pick<Snack, 'action' | 'ms'>): number => s.ms ?? (s.action ? SNACK_ACTION_MS : SNACK_MS);

type Shown = Snack & { id: number };
let current: Shown | null = null;
let serial = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows a snackbar (replacing the one on screen). */
export function showSnackbar(s: Snack): void {
  current = { ...s, id: ++serial };
  emit();
}

/** Hides the snackbar on screen (a test, a sign-out). */
export function hideSnackbar(): void {
  current = null;
  emit();
}

/** The snackbar on screen now (tests). */
export const shownSnackbar = (): Shown | null => current;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function SnackbarHost() {
  const snack = useSyncExternalStore(subscribe, () => current, () => current);
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!snack) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const id = snack.id;
    const timer = setTimeout(() => {
      if (current?.id === id) hideSnackbar();
    }, snackDuration(snack));
    return () => clearTimeout(timer);
  }, [snack, fade]);

  if (!snack) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 64 }]}>
      <Animated.View style={[styles.bar, snack.tone === 'error' && styles.error, { opacity: fade }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="snackbar">
        <Txt variant="strong" size={15} color="#ffffff" style={{ flex: 1 }} numberOfLines={2}>{snack.text}</Txt>
        {snack.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const a = snack.action;
              hideSnackbar();
              a?.onPress();
            }}
            hitSlop={8}
            style={styles.action}
            testID="snackbar-action"
          >
            <Txt variant="strong" size={15} color={colors.amber}>{snack.action.label}</Txt>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'stretch' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.ink, elevation: 6 },
  error: { backgroundColor: colors.red },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
