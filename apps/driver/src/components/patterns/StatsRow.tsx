// Round 4–7, item 12 (the approved mockups 1–3; Shopify's and Stripe's stat tiles, Uber for Business's trip facts): the one
// row of numbers with icons. Two looks, the same component:
// - `tiles` (Home): one card split in equal cells, each a small icon with its label in the tone's colour over a big mono
//   number; a cell with onPress opens its list (a count opens the filtered list), one without stays a number.
// - `facts` (Review, the request, the trip): an icon over a mono value over a grey word ("197 km / distance"), four to a row;
//   `framed` puts them in their own card, else they sit inside the caller's card under a divider.
// The props stay general (a value as text, a compact size) so the driver's own tiles can use it too.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { LucideIcon } from '@/components/icons';
import { Mono, Txt } from '@/components/ui';
import { colors, hoverStyle } from '@/theme';
import { look, TINT, type ToneName } from './look';

export interface StatItem {
  key: string;
  /** The number or the value ("2", "197 km", "14:23"). */
  value: string | number;
  label: string;
  icon?: LucideIcon;
  /** The label's and icon's colour (tiles); facts are always grey. */
  tone?: ToneName | 'ink';
  onPress?: () => void;
  /** The spoken label, when "2 On the road" is not enough. */
  a11y?: string;
}

export function StatsRow({ items, variant = 'tiles', framed = true, compact = false, testID = 'stats-row', itemTestID }: {
  items: readonly StatItem[];
  variant?: 'tiles' | 'facts';
  /** facts only: their own card (false: inside the caller's card, under a divider). */
  framed?: boolean;
  /** A smaller number (a narrow phone, a driver tile). */
  compact?: boolean;
  testID?: string;
  /** Each cell's testID from its key ("stat-road"). */
  itemTestID?: (key: string) => string;
}) {
  if (items.length === 0) return null;
  if (variant === 'facts') {
    return (
      <View style={[styles.facts, framed ? styles.factsFramed : styles.factsInside]} testID={testID}>
        {items.map((x) => (
          <View key={x.key} style={styles.fact} accessible accessibilityLabel={x.a11y ?? `${x.value} ${x.label}`} testID={itemTestID?.(x.key)}>
            {x.icon ? <x.icon size={18} color={colors.muted} strokeWidth={2} /> : null}
            <Mono size={compact ? 14 : 15} bold numberOfLines={1}>{String(x.value)}</Mono>
            <Txt variant="small" size={13} numberOfLines={1}>{x.label}</Txt>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.tiles} testID={testID}>
      {items.map((x, i) => {
        const ink = !x.tone || x.tone === 'ink' ? colors.ink : x.tone === 'muted' ? colors.muted : TINT[x.tone].ink;
        const body: ReactNode = (
          <>
            <View style={styles.tileHead}>
              {x.icon ? <x.icon size={16} color={ink} strokeWidth={2} /> : null}
              <Txt variant="small" size={13} color={ink} numberOfLines={1} style={{ flexShrink: 1 }}>{x.label}</Txt>
            </View>
            <Mono size={compact ? 20 : 24} bold>{String(x.value)}</Mono>
          </>
        );
        const cell = [styles.tile, i < items.length - 1 && styles.tileDivider];
        if (!x.onPress) return <View key={x.key} style={cell} accessible accessibilityLabel={x.a11y ?? `${x.value} ${x.label}`} testID={itemTestID?.(x.key)}>{body}</View>;
        return (
          <Pressable key={x.key} accessibilityRole="button" accessibilityLabel={x.a11y ?? `${x.value} ${x.label}`} onPress={x.onPress}
            style={(state) => [...cell, hoverStyle(state), state.pressed && { opacity: 0.75 }]} testID={itemTestID?.(x.key)}>
            {body}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: look.radius, borderWidth: 1, borderColor: look.border, overflow: 'hidden' },
  tile: { flex: 1, minWidth: 0, paddingVertical: 14, paddingHorizontal: 12, gap: 6, minHeight: 72 },
  tileDivider: { borderRightWidth: 1, borderRightColor: look.divider },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  facts: { flexDirection: 'row', gap: 8 },
  factsFramed: { backgroundColor: colors.card, borderRadius: look.radius, borderWidth: 1, borderColor: look.border, paddingVertical: 14, paddingHorizontal: 16 },
  factsInside: { borderTopWidth: 1, borderTopColor: look.divider, paddingTop: 12 },
  fact: { flex: 1, minWidth: 0, gap: 4 },
});
