// The time pattern (docs/ui-patterns.md §4): the field shows HH:MM (mono), else the suggestion in grey or a dash; a tap
// opens the one time sheet: the clock only (Material 3's time picker, any minute, a keyboard toggle; TimeDial.tsx; no
// quick-time chips since the boss's review, 21 October 2026), starting at the value, the suggestion or now; Clear and Done.

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Clock, X } from '@/components/icons';
import { Button, Mono, Txt } from '@/components/ui';
import { colomboTime } from '@/lib/time';
import { isHHMM } from '@/lib/patterns/timeLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

import { Sheet } from './Sheet';
import { TimeDial } from './TimeDial';

export function TimeField({ value, onCommit, label, placeholder, tone, suggested, compact = false, testID }: {
  value: string;
  onCommit: (time: string) => void;
  label?: string;
  /** Shown when empty ("Planned from the stops"). */
  placeholder?: string;
  /** red: wrong; amber: a check's hint (the planner's, never an error). */
  tone?: 'red' | 'amber';
  /** The planner's time: where the clock starts (shown grey through `placeholder`). */
  suggested?: string;
  /** The small size, two to a row (a stop's Arrive by beside its Stay). */
  compact?: boolean;
  testID?: string;
}) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [touched, setTouched] = useState(false);
  const now = colomboTime(Date.now());
  const pick = (time: string) => { onCommit(time); setOpen(false); };
  // The draft starts at the value, else the suggestion, else now (the time, not a preset). Done on an empty field whose
  // clock was not moved keeps it empty when it shows the suggestion: the planner's own time stays the planner's (written
  // in, it would be planned again as a chosen time and judged a few minutes late; Round 1 review).
  const done = () => {
    if (!touched && !isHHMM(value) && suggested && draft === suggested) setOpen(false);
    else pick(draft);
  };
  const setDial = (time: string) => { setTouched(true); setDraft(time); };
  return (
    <View style={{ flex: 1, gap: 6 }}>
      {label ? <Txt variant="label" color={colors.muted}>{label.toUpperCase()}</Txt> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={label ?? t('patterns.time')} onPress={() => { setTouched(false); setDraft(isHHMM(value) ? value : suggested && isHHMM(suggested) ? suggested : now); setOpen(true); }} style={[styles.box, compact && styles.compact, tone === 'red' && { borderColor: colors.red }, tone === 'amber' && { borderColor: colors.amber }]} testID={testID}>
        <Clock size={20} color={colors.muted} />
        {isHHMM(value) ? <Mono size={compact ? 20 : 26} bold>{value}</Mono> : <Txt variant="muted" size={16} style={{ flex: 1 }} numberOfLines={1}>{placeholder ?? '--:--'}</Txt>}
        {isHHMM(value) ? <View style={{ flex: 1 }} /> : null}
        {isHHMM(value) && (
          <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.clear')} onPress={() => onCommit('')} hitSlop={8} style={styles.clear}><X size={20} color={colors.muted} /></Pressable>
        )}
      </Pressable>
      <Sheet visible={open} title={label ?? t('patterns.time')} onClose={() => setOpen(false)} scroll={false} testID="time-sheet" actions={(
        <>
          <Button kind="outline" label={t('patterns.clear')} onPress={() => pick('')} style={{ flex: 1, minHeight: 52 }} />
          <Button label={t('patterns.done')} disabled={!isHHMM(draft)} onPress={done} style={{ flex: 1.4, minHeight: 52 }} />
        </>
      )}>
        <TimeDial value={draft} onChange={setDial} testID="time-clock" />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingLeft: 14 },
  compact: { minHeight: 48, borderRadius: 12, paddingLeft: 12, gap: 8 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
