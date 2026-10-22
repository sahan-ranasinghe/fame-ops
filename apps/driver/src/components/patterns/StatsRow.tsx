// The numbers that matter, side by side (Part B design pass, docs/design-pass.md §4.7; Samsara's KPI tiles, Uber Fleet's
// summary): two to six cells in one card, three a line at most on a phone; each a small label, the value big (mono for
// numbers and times), an optional line under it. A cell that counts a list opens it (rule R9).

import { Pressable, StyleSheet, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { colors, hoverStyle } from '@/theme';

export interface StatCell {
  key: string;
  label: string;
  value: string;
  /** A unit or a second line ("km", "back 15:40"). */
  sub?: string;
  tone?: 'ink' | 'blue' | 'amber' | 'red' | 'green';
  /** Words, not a number: the body font. */
  words?: boolean;
  /** The main number, a line of its own and bigger (Review's Leave by, design 09). */
  wide?: boolean;
  onPress?: () => void;
}

const INK = { ink: colors.ink, blue: colors.blue, amber: colors.amberText, red: colors.red, green: colors.green } as const;

export function StatsRow({ cells, testID = 'stats-row' }: { cells: readonly StatCell[]; testID?: string }) {
  const rest = cells.filter((c) => !c.wide);
  const perLine = rest.length === 4 ? 2 : Math.max(1, Math.min(3, rest.length));
  const wideCount = cells.length - rest.length;
  return (
    <View style={styles.card} testID={testID}>
      {cells.map((c, i) => {
        const body = (
          <>
            <Txt variant="label" size={12} color={colors.muted} numberOfLines={2}>{c.label.toUpperCase()}</Txt>
            {c.words
              ? <Txt variant="strong" size={18} color={INK[c.tone ?? 'ink']} numberOfLines={2}>{c.value}</Txt>
              : <Mono size={c.wide ? 34 : 22} bold color={INK[c.tone ?? 'ink']} numberOfLines={1}>{c.value}</Mono>}
            {c.sub ? <Txt variant="small" numberOfLines={2}>{c.sub}</Txt> : null}
          </>
        );
        // A wide cell has its line; the others share the lines after the wide ones, perLine a line.
        const j = i - wideCount;
        const style = c.wide
          ? [styles.cell, { width: '100%' as const }, i > 0 && styles.topLine]
          : [styles.cell, { width: `${100 / perLine}%` as const }, j % perLine !== 0 && styles.divider, (wideCount > 0 || j >= perLine) && styles.topLine];
        return c.onPress ? (
          <Pressable key={c.key} accessibilityRole="button" accessibilityLabel={`${c.label}: ${c.value}`} onPress={c.onPress}
            style={(state) => [...style, hoverStyle(state), state.pressed && { opacity: 0.8 }]} testID={`${testID}-${c.key}`}>
            {body}
          </Pressable>
        ) : (
          <View key={c.key} style={style} testID={`${testID}-${c.key}`} accessible accessibilityLabel={`${c.label}: ${c.value}`}>{body}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  cell: { paddingVertical: 12, paddingHorizontal: 14, gap: 2 },
  divider: { borderLeftWidth: 1, borderLeftColor: colors.line },
  topLine: { borderTopWidth: 1, borderTopColor: colors.line },
});
