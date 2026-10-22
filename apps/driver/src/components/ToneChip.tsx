// Round 4–7, item 12 (design/mockups/2026-10-22, README's tokens): the small status chip of the driver's screens: "Leave
// in 25 min" beside Next task, a row's "Not accepted yet". One colour per meaning: amber waiting / soon, red late, blue
// under way, green done, grey a plain fact.

import { StyleSheet, View } from 'react-native';

import { Txt } from '@/components/ui';
import type { ChipTone } from '@/lib/todayCard';
import { colors } from '@/theme';

const TONES: Record<ChipTone, { text: string; background: string }> = {
  amber: { text: colors.amberText, background: colors.amberSoft },
  red: { text: colors.red, background: colors.redSoft },
  blue: { text: colors.blue, background: colors.blueChip },
  green: { text: colors.greenText, background: colors.greenSoft },
  grey: { text: colors.muted, background: colors.divider },
};

export function ToneChip({ text, tone, testID }: { text: string; tone: ChipTone; testID?: string }) {
  const palette = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: palette.background }]} testID={testID}>
      <Txt variant="strong" size={12} color={palette.text} numberOfLines={1}>{text}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 2, flexShrink: 1, maxWidth: '100%' },
});
