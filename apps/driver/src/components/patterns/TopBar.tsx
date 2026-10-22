// Round 4–7, item 12 (the approved mockups 1–3; Gmail's and Uber Fleet's thin app bar, Material 3's top app bar): the one
// thin top bar of Office mode and /m/. No dark block: on the page colour, an optional round back button (44 px, a ring), a
// small grey line above ("Thu 22 Oct", "New trip · step 4 of 4", "Request · Fri 23 Oct") and the title in the heading
// font on one line, then what sits at the right (the bell, the avatar, a link) and, under it, anything that belongs to the
// bar (the trip editor's four step bars). Presentational: office/ui.tsx's TopBar / BackHeader and the trip editor's
// TripHeader wire it (the bell's count, the browser's theme colour, back means back).

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft } from '@/components/icons';
import { Txt } from '@/components/ui';
import { colors, hoverStyle } from '@/theme';
import { look } from './look';

export function TopBar({ above, title, onBack, backLabel, right, children, titleSize = 24, aboveFirst = true, testID = 'top-bar' }: {
  /** The small grey line (the date, the step, the kind and day). */
  above?: string;
  title: string;
  /** A round back button on the left; omitted on a tab's own screen. */
  onBack?: () => void;
  /** The back button's spoken label (the person's language). */
  backLabel?: string;
  right?: ReactNode;
  children?: ReactNode;
  titleSize?: number;
  /** false: the small line under the title (a stack screen's subtitle as it always read). */
  aboveFirst?: boolean;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const small = above ? <Txt variant="small" size={13} numberOfLines={1} testID={`${testID}-above`}>{above}</Txt> : null;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + (onBack ? 14 : 18) }]} testID={testID}>
      <View style={styles.row}>
        {onBack ? (
          <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack}
            style={(state) => [styles.back, hoverStyle(state), state.pressed && { opacity: 0.7 }]} testID={`${testID}-back`}>
            <ChevronLeft size={22} color={colors.ink} strokeWidth={2.4} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {aboveFirst ? small : null}
          <Txt variant="heading" size={titleSize} numberOfLines={1} accessibilityRole="header">{title}</Txt>
          {aboveFirst ? null : small}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}

/** A round 44 px button with a ring (the bell, Call, WhatsApp, ⓘ, ⋯ in the bars): an icon only, its label spoken. */
export function RoundButton({ icon, label, onPress, size = 44, badge, testID }: {
  /** The icon in its own colour (Call blue, WhatsApp green, the bell ink). */
  icon: ReactNode;
  label: string;
  onPress: () => void;
  size?: number;
  badge?: ReactNode;
  testID?: string;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID={testID}
      style={(state) => [styles.round, { width: size, height: size, borderRadius: size / 2 }, hoverStyle(state), state.pressed && { opacity: 0.7 }]}>
      {icon}
      {badge}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingBottom: 12, backgroundColor: colors.page, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: look.ring, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { borderWidth: 1, borderColor: look.ring, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
