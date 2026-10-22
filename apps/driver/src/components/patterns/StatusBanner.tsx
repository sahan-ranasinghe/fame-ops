// The one banner above a page's content (Part B design pass, docs/design-pass.md §4.6; Material 3's banner): an icon, one
// strong line, one muted line, at most one action. Tones by rule R3: red = someone must act now, amber = watch it, blue =
// moving / for your information, green = done, grey = over or off. The word is always there; the colour never stands alone.

import { Pressable, StyleSheet, View } from 'react-native';

import { CircleCheck, Info, type LucideIcon, TriangleAlert } from '@/components/icons';
import { Txt } from '@/components/ui';
import { colors, hoverStyle, webHitSlop } from '@/theme';

export type BannerTone = 'red' | 'amber' | 'blue' | 'green' | 'grey';

const TONE: Record<BannerTone, { bg: string; ink: string; icon: LucideIcon }> = {
  red: { bg: colors.redChip, ink: colors.red, icon: TriangleAlert },
  amber: { bg: colors.amberChip, ink: colors.amberText, icon: TriangleAlert },
  blue: { bg: colors.blueChip, ink: colors.blue, icon: Info },
  green: { bg: colors.greenChip, ink: colors.green, icon: CircleCheck },
  // Over or off (R3): expired, cancelled.
  grey: { bg: '#ebe9e3', ink: colors.muted, icon: Info },
};

export function StatusBanner({ tone, title, line, action, children, testID = 'status-banner' }: {
  tone: BannerTone;
  title: string;
  line?: string;
  action?: { label: string; onPress: () => void; testID?: string };
  /** More inside the banner (the other warnings as lines, a conflict's buttons). */
  children?: React.ReactNode;
  testID?: string;
}) {
  const c = TONE[tone];
  const Icon = c.icon;
  return (
    <View style={[styles.band, { backgroundColor: c.bg, borderLeftColor: c.ink }]} testID={testID} accessibilityRole="alert">
      <Icon size={20} color={c.ink} strokeWidth={2.4} />
      <View style={{ flex: 1, gap: 4 }}>
        <Txt variant="strong" size={16} color={c.ink}>{title}</Txt>
        {line ? <Txt variant="body" size={15} color={colors.ink}>{line}</Txt> : null}
        {children}
        {action ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8} style={(state) => [{ alignSelf: 'flex-start', paddingTop: 4 }, webHitSlop(8), hoverStyle(state)]} testID={action.testID}>
            <Txt variant="strong" size={16} color={c.ink}>{action.label}</Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 14, borderLeftWidth: 4, paddingVertical: 12, paddingHorizontal: 14 },
});
