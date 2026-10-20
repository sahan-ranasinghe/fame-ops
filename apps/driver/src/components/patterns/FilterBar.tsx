// The filter pattern (docs/ui-patterns.md §1): a search bar, one Filter button with a count badge, Sort as its own small
// menu, the filters in use as removable chips under it. The button opens the filter sheet: sections of tick boxes or
// radio choices (with the server's counts beside them), Clear and Apply; nothing changes until Apply.

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChevronDown, Search, SlidersHorizontal, X } from '@/components/icons';
import { Button, Mono, Txt } from '@/components/ui';
import { Checkbox, Radio } from '@/components/patterns/Select';
import { activeChips, activeCount, clearValues, type FilterDef, type FilterValues, isChosen, toggle } from '@/lib/patterns/filterLogic';
import { useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

import { Sheet } from './Sheet';

export interface SortOption {
  value: string;
  label: string;
}

export function FilterBar({ search, onSearch, placeholder, defs, values, onApply, sort, testID = 'filter-bar' }: {
  /** Omit both for a list without a search (a short list). */
  search?: string;
  onSearch?: (text: string) => void;
  placeholder?: string;
  defs: readonly FilterDef[];
  values: FilterValues;
  onApply: (values: FilterValues) => void;
  sort?: { value: string; options: SortOption[]; onChange: (value: string) => void };
  testID?: string;
}) {
  const { t, language } = useApp();
  const [open, setOpen] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [draft, setDraft] = useState<FilterValues>(values);
  const count = activeCount(defs, values);
  const chips = activeChips(defs, values);
  const sortLabel = sort?.options.find((o) => o.value === sort.value)?.label;
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {onSearch ? (
          <View style={styles.search}>
            <Search size={20} color={colors.muted} />
            <TextInput value={search} onChangeText={onSearch} placeholder={placeholder ?? t('patterns.search')} placeholderTextColor="#9aa0a6" autoCorrect={false} returnKeyType="search" accessibilityLabel={placeholder ?? t('patterns.search')} style={[styles.searchInput, { fontFamily: language === 'si' ? fonts.sinhalaBody : fonts.body }]} />
            {search ? <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.clearSearch')} onPress={() => onSearch('')} hitSlop={8}><X size={18} color={colors.muted} /></Pressable> : null}
          </View>
        ) : <View style={{ flex: 1 }} />}
        {defs.length > 0 && (
          <Pressable accessibilityRole="button" accessibilityLabel={count ? t('patterns.filtersN', { n: count }) : t('patterns.filters')} accessibilityState={{ expanded: open }} onPress={() => { setDraft(values); setOpen(true); }} style={[styles.filterBtn, count > 0 && { borderColor: colors.ink }]} testID="filter-button">
            <SlidersHorizontal size={20} color={colors.ink} />
            {!onSearch && <Txt variant="strong" size={15}>{t('patterns.filters')}</Txt>}
            {count > 0 && <View style={styles.badge}><Mono size={12} bold color="#ffffff">{String(count)}</Mono></View>}
          </Pressable>
        )}
      </View>
      {(chips.length > 0 || sort) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {chips.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={t('patterns.removeFilter', { label: c.label })} onPress={() => onApply(c.remove)} style={styles.chip} testID="filter-chip">
              <Txt variant="strong" size={14}>{c.label}</Txt>
              <X size={16} color={colors.ink} />
            </Pressable>
          ))}
          {chips.length > 1 && (
            <Pressable accessibilityRole="button" onPress={() => onApply(clearValues(defs))} hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Txt variant="strong" size={14} color={colors.blue}>{t('patterns.clearAll')}</Txt>
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          {sort && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.sortBy', { label: sort.options.find((o) => o.value === sort.value)?.label ?? '' })} accessibilityState={{ expanded: sorting }} onPress={() => setSorting(true)} style={styles.sortBtn} testID="sort-button">
              <Txt variant="small">{t('patterns.sortBy', { label: sortLabel ?? '' })}</Txt>
              <ChevronDown size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}

      <Sheet visible={open} title={t('patterns.filters')} onClose={() => setOpen(false)} testID="filter-sheet" actions={(
        <>
          <Button kind="outline" label={t('patterns.clear')} onPress={() => setDraft(clearValues(defs))} style={{ flex: 1, minHeight: 52 }} />
          <Button label={t('patterns.apply')} onPress={() => { onApply(draft); setOpen(false); }} style={{ flex: 1.4, minHeight: 52 }} />
        </>
      )}>
        {defs.map((d) => (
          <View key={d.key} style={{ gap: 4 }}>
            <Txt variant="label" color={colors.muted}>{d.label.toUpperCase()}</Txt>
            {d.options.map((o) => {
              const on = isChosen(d, draft, o.value);
              // The shared Checkbox / Radio (docs/ui-patterns.md §11): the mark, never the colour alone.
              const label = o.count !== undefined ? `${o.label} · ${o.count}` : o.label;
              return d.kind === 'multi'
                ? <Checkbox key={o.value} checked={on} onChange={() => setDraft(toggle(d, draft, o.value))} label={label} />
                : <Radio key={o.value} checked={on} onPress={() => setDraft(toggle(d, draft, o.value))} label={label} />;
            })}
          </View>
        ))}
      </Sheet>

      {sort && (
        <Sheet visible={sorting} title={t('patterns.sort')} onClose={() => setSorting(false)} testID="sort-sheet">
          {sort.options.map((o) => (
            <Radio key={o.value} checked={o.value === sort.value} onPress={() => { sort.onChange(o.value); setSorting(false); }} label={o.label} />
          ))}
        </Sheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 17, color: colors.ink, paddingVertical: 8 },
  filterBtn: { minWidth: 50, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 12 },
  badge: { position: 'absolute', top: -6, right: -6, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.blueChip },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 6 },
});
