// Round 4–7, item 12 (the approved mockups 2–4; Uber for Business's and Airbnb's sticky booking bar, Material 3's bottom app
// bar): the ONE sticky bar at the bottom of a stack screen. White, a line on top, above the safe area: the outlined second
// action on the left (Back, Decline, Save as waiting), the ONE primary button (amber) filling the rest, and ⋯ More for the
// actions that have no room; the reason the primary is disabled stays under it (the disabled rule), and anything else the
// screen needs (a note) under that. The primary button is the app's Button: its own spinner, disabled while busy, so a
// press is never sent twice. While the screen is in front the snackbar sits above the bar (Hotfix O2-H2).
// `children` alone (no primary) stacks them as the old sticky actions did.

import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ellipsis, type LucideIcon } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
import { colors, hoverStyle } from '@/theme';
import { look } from './look';
import { setSnackbarLift } from './Snackbar';

export interface BarAction {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  /** The second action's tone: red text and border (Decline, Cancel). */
  danger?: boolean;
}

export function BottomActionBar({ primary, secondary, more, reason, reasonTestID, reasonTone = 'muted', children, testID = 'bottom-bar' }: {
  primary?: BarAction;
  secondary?: BarAction;
  /** ⋯ More: the actions with no room on the bar (a sheet). */
  more?: { label: string; onPress: () => void; testID?: string };
  /** Why the primary button is disabled, under it. */
  reason?: string | null;
  reasonTestID?: string;
  /** red: a problem the person must fix (the trip editor's "Add a date."); else the quiet grey reason. */
  reasonTone?: 'muted' | 'red';
  children?: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const height = useRef(0);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (height.current) setSnackbarLift(height.current);
      return () => {
        focused.current = false;
        setSnackbarLift(0);
      };
    }, []),
  );
  const row = primary || secondary || more;
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + (row ? 6 : 0) }]}
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
        if (focused.current) setSnackbarLift(height.current);
      }}
      testID={testID}
    >
      {row ? (
        <View style={styles.row}>
          {secondary ? (
            <Button kind={secondary.danger ? 'danger-text' : 'outline'} label={secondary.label} icon={secondary.icon} onPress={secondary.onPress}
              disabled={secondary.disabled || primary?.busy} busy={secondary.busy} testID={secondary.testID}
              style={[styles.btn, styles.secondary, secondary.danger && styles.danger, !primary && { flex: 1 }]} />
          ) : null}
          {primary ? (
            <Button label={primary.label} icon={primary.busy ? undefined : primary.icon} onPress={primary.onPress} disabled={primary.disabled || secondary?.busy}
              busy={primary.busy} testID={primary.testID} style={[styles.btn, { flex: 1 }]} />
          ) : null}
          {more ? (
            <Pressable accessibilityRole="button" accessibilityLabel={more.label} onPress={more.onPress} testID={more.testID ?? 'bar-more'}
              style={(state) => [styles.more, hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
              <Ellipsis size={22} color={colors.ink} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {reason ? (reasonTone === 'red'
        ? <Txt variant="strong" size={15} color={colors.red} style={{ textAlign: 'center' }} testID={reasonTestID}>{reason}</Txt>
        : <Txt variant="small" style={{ textAlign: 'center' }} testID={reasonTestID}>{reason}</Txt>) : null}
      {children}
    </View>
  );
}

/** The bar's row for a screen that lays its own buttons out (each keeps its own testID and spinner): the buttons side by
 *  side, `barButton` / `barSecondary` / `barDanger` their sizes, BarMore the ⋯ at the end. */
export function BarRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function BarMore({ label, onPress, testID = 'bar-more' }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID}
      style={(state) => [styles.more, hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
      <Ellipsis size={22} color={colors.ink} strokeWidth={2.4} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: look.border, paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  btn: { minHeight: 56, borderRadius: 14, paddingVertical: 8 },
  secondary: { paddingHorizontal: 18, flexShrink: 1 },
  danger: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: '#e3b8b4' },
  more: { width: 56, minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});

/** The bar's button sizes, for a screen that lays its buttons out with BarRow. */
export const barButton = styles.btn;
export const barSecondary = [styles.btn, styles.secondary];
export const barDanger = [styles.btn, styles.secondary, styles.danger];
