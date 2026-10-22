// "Where" suggestions (docs/ui-patterns.md "Where suggestions"): what an empty place box offers, as Google Maps' and Uber's
// destination box: at most 5 rows (our places, offices first, then the 3 used most recently), each with an icon (a building
// for ours, a clock for a recent one) and no text badge; "More places" under them shows the rest in place. One component
// for both place boxes of the app (Office mode's components/office/PlaceSearch.tsx and the driver's components/PlaceSearch.tsx);
// the rows come from lib/placeSuggestLogic.ts whereRows. Round 4–7 (item 10): rows that carry a group (Office mode's box,
// groupedWhere) sit under small headers "Saved", "Recent" and "<Name>'s recent"; the driver's box has none.

import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Building, Clock } from '@/components/icons';
import { Txt } from '@/components/ui';
import { groupHeader, startsGroup, type WhereLists, type WhereRow } from '@/lib/placeSuggestLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function WhereSuggestions<T>({ lists, keyOf, title, detail, onPick, testID = 'where-suggestions' }: {
  lists: WhereLists<T>;
  keyOf: (item: T, i: number) => string;
  title: (item: T) => string;
  detail?: (item: T) => string | null | undefined;
  onPick: (item: T) => void;
  testID?: string;
}) {
  const { t } = useApp();
  const [more, setMore] = useState(false);
  const rows = more ? [...lists.top, ...lists.more] : lists.top;
  if (rows.length === 0) return null;
  const row = (r: WhereRow<T>, i: number) => {
    const sub = detail?.(r.item);
    const Icon = r.icon === 'building' ? Building : Clock;
    const head = startsGroup(rows, i) ? groupHeader(r) : null;
    return (
      <Fragment key={keyOf(r.item, i)}>
      {head && (
        <Txt variant="label" color={colors.muted} style={[styles.group, i > 0 && styles.groupGap]} accessibilityRole="header" testID="where-group">
          {t(head.key, head.vars).toUpperCase()}
        </Txt>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title(r.item)}, ${t(r.icon === 'building' ? 'where.ours' : 'where.recent')}`}
        onPress={() => onPick(r.item)}
        style={({ pressed }) => [styles.row, i > 0 && !head && styles.divider, pressed && { backgroundColor: colors.page }]}
        testID="where-row"
      >
        <View style={styles.icon} testID={`where-icon-${r.icon}`}>
          <Icon size={20} color={colors.ink} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="strong" numberOfLines={1}>{title(r.item)}</Txt>
          {sub ? <Txt variant="small" numberOfLines={1}>{sub}</Txt> : null}
        </View>
      </Pressable>
      </Fragment>
    );
  };
  return (
    <View testID={testID}>
      {rows.map(row)}
      {!more && lists.more.length > 0 && (
        <Pressable accessibilityRole="button" onPress={() => setMore(true)} hitSlop={4} style={styles.more} testID="where-more">
          <Txt variant="strong" size={15} color={colors.blue}>{t('where.morePlaces')}</Txt>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 4 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.page, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  group: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 2 },
  groupGap: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
});
