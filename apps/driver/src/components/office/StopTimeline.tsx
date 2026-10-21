// A trip's stops as a live delivery timeline (Round 2, 21 October 2026; Uber / DoorDash / Samsara route progress), the one
// component for Office mode and /m/ (the site has its own, screens/StopProgress.tsx, with the same rules): a numbered mark
// per stop on a vertical line (filled once left, ringed blue at the current stop, grey when skipped), the place, "Planned
// 10:30 · Arrived 10:52 · Left 11:40", the delta (late amber, early / on time green) and, for a stop still to come,
// "About 12:10 (updated 10:52)". The words: office/stopTimelineLogic.ts. `extra` adds a row's own parts under it (the
// arrival point, Save as our place).

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { stopLine } from '@/office/stopTimelineLogic';
import type { Stop } from '@/office/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const TONE = { late: colors.amberText, early: colors.green, on_time: colors.green } as const;

export function StopTimeline({ stops, extra, testID = 'stop-timeline' }: { stops: readonly Stop[]; extra?: (s: Stop) => ReactNode; testID?: string }) {
  const { t } = useApp();
  return (
    <View testID={testID}>
      {stops.map((s, i) => {
        const line = stopLine(s, t);
        const last = i === stops.length - 1;
        const done = line.state === 'left';
        return (
          <View key={s.id ?? s.seq} style={styles.row} testID={`timeline-stop-${i}`}>
            <View style={styles.rail}>
              <View style={[
                styles.mark,
                done && { backgroundColor: colors.ink },
                line.state === 'here' && { backgroundColor: colors.blue },
                line.state === 'skipped' && { backgroundColor: colors.muted, borderColor: colors.muted },
                s.is_start && !done && { borderColor: colors.amber },
                line.current && styles.current,
              ]}>
                <Mono size={13} bold color={done || line.state === 'here' || line.state === 'skipped' ? '#ffffff' : colors.ink}>{s.is_start ? 'S' : String(s.n ?? s.seq)}</Mono>
              </View>
              {!last && <View style={[styles.line, done && { backgroundColor: colors.ink }]} />}
            </View>
            <View style={styles.body}>
              <Txt variant="strong" numberOfLines={2}>{s.place || s.address || s.label || ''}</Txt>
              {line.times ? <Txt variant="muted" size={15} testID={`timeline-times-${i}`}>{line.times}</Txt> : null}
              {(line.delta || line.arriveBy) && (
                <Txt variant="small" testID={`timeline-delta-${i}`}>
                  {line.delta ? <Txt variant="strong" size={14} color={TONE[line.delta.tone]}>{line.delta.text}</Txt> : null}
                  {line.delta && line.arriveBy ? ' · ' : ''}
                  {line.arriveBy ?? ''}
                </Txt>
              )}
              {line.estimate ? <Txt variant="strong" size={15} color={colors.blue} testID={`timeline-estimate-${i}`}>{line.estimate}</Txt> : null}
              {extra?.(s)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: 30, alignItems: 'center' },
  mark: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  current: { borderColor: colors.blue, borderWidth: 3 },
  line: { flex: 1, width: 2, minHeight: 14, backgroundColor: colors.line, marginVertical: 2 },
  body: { flex: 1, gap: 2, paddingBottom: 14 },
});
