// How long at a stop (Google Calendar's duration, 21 October 2026): one compact field, "Stay  1 h" (the suggested stay in
// grey until one is chosen); a tap opens the sheet: 5 min · 15 min · 30 min · 1 h · 2 h · 4 h · Custom, where Custom is an
// hours column and a minutes column (5 h is two taps). Replaces the per-stop chip rows and the minutes-only box.

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ChoiceChip } from '@/components/patterns/Select';
import { Button, Mono, Txt } from '@/components/ui';
import { durationText, STAY_PRESETS } from '@/lib/durations';
import { useApp } from '@/state/app';
import { colors, hoverStyle } from '@/theme';

import { Sheet } from './Sheet';

/** Up to 12 h 00 (the server's longest stay, DWELL_MAX 720). */
const HOURS = Array.from({ length: 13 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** The minutes a field holds ("90", "" = none chosen). */
export const stayMinutes = (v: string): number | null => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : null);

export function DurationField({ value, onCommit, label, suggestedMin, testID }: {
  /** Minutes as text ("90"), "" when none is chosen. */
  value: string;
  onCommit: (minutes: string) => void;
  label?: string;
  /** The planner's stay here (the place's usual, or the type's default): shown in grey as "suggested". */
  suggestedMin?: number;
  testID?: string;
}) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const chosen = stayMinutes(value);
  const start = chosen ?? suggestedMin ?? 60;
  const [h, setH] = useState(Math.floor(start / 60));
  const [m, setM] = useState(start % 60 - ((start % 60) % 5));
  const pick = (min: number | null) => { onCommit(min === null ? '' : String(min)); setOpen(false); };
  const openSheet = () => {
    const s = chosen ?? suggestedMin ?? 60;
    setH(Math.floor(s / 60));
    setM(s % 60 - ((s % 60) % 5));
    setCustom(chosen !== null && !(STAY_PRESETS as readonly number[]).includes(chosen));
    setOpen(true);
  };
  const title = label ?? t('patterns.stay');
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Txt variant="label" color={colors.muted}>{title.toUpperCase()}</Txt>
      <Pressable accessibilityRole="button" accessibilityLabel={`${title} ${chosen !== null ? durationText(t, chosen) : ''}`} onPress={openSheet}
        style={(state) => [styles.box, hoverStyle(state)]} testID={testID}>
        {chosen !== null
          ? <Txt variant="strong" size={17} numberOfLines={1}>{durationText(t, chosen)}</Txt>
          : <Txt variant="muted" size={16} numberOfLines={1}>{suggestedMin !== undefined ? t('patterns.suggestedValue', { value: durationText(t, suggestedMin) }) : '–'}</Txt>}
      </Pressable>
      <Sheet visible={open} title={title} onClose={() => setOpen(false)} scroll={false} testID="stay-sheet" actions={(
        <>
          <Button kind="outline" label={t('patterns.clear')} onPress={() => pick(null)} style={{ flex: 1, minHeight: 52 }} />
          {custom && <Button label={t('patterns.done')} disabled={h * 60 + m === 0} onPress={() => pick(Math.min(h * 60 + (h === 12 ? 0 : m), 12 * 60))} style={{ flex: 1.4, minHeight: 52 }} />}
        </>
      )}>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {STAY_PRESETS.map((min) => (
            <ChoiceChip key={min} label={durationText(t, min)} selected={!custom && chosen === min} onPress={() => pick(min)} testID={`stay-${min}`} />
          ))}
          <ChoiceChip label={t('patterns.custom')} selected={custom} onPress={() => setCustom(true)} testID="stay-custom" />
        </View>
        {custom && (
          <View style={styles.wheels} testID="stay-wheels">
            <Wheel label={t('patterns.hoursCol')} items={HOURS} value={h} onChange={setH} testID="stay-hours" />
            <Wheel label={t('patterns.minutesCol')} items={h === 12 ? [0] : MINUTES} value={h === 12 ? 0 : m} onChange={setM} testID="stay-minutes" />
          </View>
        )}
      </Sheet>
    </View>
  );
}

const ROW = 44;

/** One column of numbers (a wheel): the chosen one marked; a tap chooses. */
function Wheel({ label, items, value, onChange, testID }: { label: string; items: number[]; value: number; onChange: (n: number) => void; testID?: string }) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Txt variant="label" color={colors.muted} style={{ textAlign: 'center' }}>{label.toUpperCase()}</Txt>
      <ScrollView style={styles.wheel} contentOffset={{ x: 0, y: Math.max(0, items.indexOf(value) - 1) * ROW }} testID={testID}>
        {items.map((n) => {
          const on = n === value;
          return (
            <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: on, selected: on }} accessibilityLabel={`${n} ${label}`}
              onPress={() => onChange(n)} style={[styles.wheelRow, on && styles.wheelOn]} testID={testID ? `${testID}-${n}` : undefined}>
              <Mono size={20} bold color={on ? colors.blue : colors.ink}>{String(n).padStart(2, '0')}</Mono>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { minHeight: 48, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.card, paddingHorizontal: 12, justifyContent: 'center' },
  wheels: { flexDirection: 'row', gap: 12 },
  wheel: { maxHeight: ROW * 4, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line },
  wheelRow: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  wheelOn: { backgroundColor: colors.blueChip },
});
