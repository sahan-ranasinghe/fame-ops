// The time pattern (docs/ui-patterns.md §4): the field shows HH:MM (mono) or a dash; a tap opens the one time sheet: the
// suggested time ("Planned 07:24"), Now (rounded up to 5 minutes) and the office's common times as chips, then every
// time in 5-minute steps scrolled to the value; Clear and Done. Typing a time is never needed on a phone.

import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Clock, X } from '@/components/icons';
import { Button, Mono, Txt } from '@/components/ui';
import { colomboTime } from '@/lib/time';
import { isHHMM, openIndex, quickTimes, TIME_STEPS } from '@/lib/patterns/timeLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

import { Sheet } from './Sheet';

const ROW_H = 52;

export function TimeField({ value, onCommit, label, placeholder, tone, suggested, testID }: {
  value: string;
  onCommit: (time: string) => void;
  label?: string;
  /** Shown when empty ("Planned from the stops"). */
  placeholder?: string;
  /** red: a check says the time is late. */
  tone?: 'red';
  /** A time to offer first ("Planned 07:24"). */
  suggested?: string;
  testID?: string;
}) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const now = colomboTime(Date.now());
  const pick = (time: string) => { onCommit(time); setOpen(false); };
  return (
    <View style={{ flex: 1, gap: 6 }}>
      {label ? <Txt variant="label" color={colors.muted}>{label.toUpperCase()}</Txt> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={label ?? t('patterns.time')} onPress={() => { setDraft(value); setOpen(true); }} style={[styles.box, tone === 'red' && { borderColor: colors.red }]} testID={testID}>
        <Clock size={20} color={colors.muted} />
        {isHHMM(value) ? <Mono size={26} bold>{value}</Mono> : <Txt variant="muted" size={16} style={{ flex: 1 }} numberOfLines={1}>{placeholder ?? '--:--'}</Txt>}
        {isHHMM(value) ? <View style={{ flex: 1 }} /> : null}
        {isHHMM(value) && (
          <Pressable accessibilityRole="button" accessibilityLabel={t('patterns.clear')} onPress={() => onCommit('')} hitSlop={8} style={styles.clear}><X size={20} color={colors.muted} /></Pressable>
        )}
      </Pressable>
      <Sheet visible={open} title={label ?? t('patterns.time')} onClose={() => setOpen(false)} scroll={false} testID="time-sheet" actions={(
        <>
          <Button kind="outline" label={t('patterns.clear')} onPress={() => pick('')} style={{ flex: 1, minHeight: 52 }} />
          <Button label={t('patterns.done')} disabled={!isHHMM(draft)} onPress={() => pick(draft)} style={{ flex: 1.4, minHeight: 52 }} />
        </>
      )}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {quickTimes(now, suggested).map((q) => (
            <Pressable key={q.key} accessibilityRole="button" onPress={() => pick(q.time)} style={[styles.chip, q.kind === 'suggested' && { borderColor: colors.amber, backgroundColor: colors.amberChip }]} testID={`time-quick-${q.key}`}>
              <Txt variant="strong" size={14}>{q.kind === 'suggested' ? t('patterns.planned', { time: q.time }) : q.kind === 'now' ? t('patterns.now', { time: q.time }) : q.time}</Txt>
            </Pressable>
          ))}
        </View>
        <FlatList
          data={TIME_STEPS as string[]}
          keyExtractor={(x) => x}
          style={{ maxHeight: ROW_H * 6 }}
          initialScrollIndex={Math.max(0, openIndex(draft, suggested, now) - 2)}
          getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: item === draft }} onPress={() => setDraft(item)} style={[styles.step, item === draft && { backgroundColor: colors.ink }]}>
              <Mono size={20} bold color={item === draft ? '#ffffff' : colors.ink}>{item}</Mono>
            </Pressable>
          )}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, borderWidth: 1.5, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.card, paddingLeft: 14 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: colors.line, justifyContent: 'center' },
  step: { height: ROW_H, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
