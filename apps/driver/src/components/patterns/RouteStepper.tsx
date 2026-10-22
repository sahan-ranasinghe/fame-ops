// A trip as steps (Part B design pass, docs/design-pass.md §4.5; Uber's and DoorDash's trip progress, Samsara's route
// view): one rail top to bottom; a time column (the planned time, the actual under it); a mark per step (S the start,
// 1…n the stops, B back to base: green once left, blue at the stop now, ringed blue for the one being driven to, red
// when skipped, plain still to come: docs/ui-patterns.md §16); the place, its type, the times line and the difference
// ("22 min late" amber, "On time" green); the leg to the next step between them. The one stepper for a planned trip
// (Review, a request) and a live one (a task, the driver's sheet). `compact`: the step in focus in full, the others one line.

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { colors } from '@/theme';

export type StepState = 'done' | 'here' | 'next' | 'skipped' | 'todo';

export interface Step {
  key: string;
  /** "S", "1", "2", …, "B". */
  mark: string;
  state: StepState;
  place: string;
  /** "Pickup · People" in words. */
  type?: string;
  /** The planned time (mono), and the actual one under it. */
  time?: string;
  actual?: string;
  /** "Planned 10:30–11:00 · Arrived 10:52 · Left 11:40". */
  times?: string;
  /** "22 min late" (late) or "On time" / "8 min early" (ok). */
  delta?: { text: string; tone: 'late' | 'ok' };
  /** A line of its own under the times (an estimate, an arrive-by, "Confirmed later"). */
  note?: string;
  noteTone?: 'blue' | 'muted' | 'amber';
  /** The leg to the next step: "12 km · 25 min". */
  legAfter?: string;
  /** The step's own parts (a slide, a button, the arrival point). */
  extra?: ReactNode;
  /** One small action at the right of the place (the driver's Skip). */
  aside?: ReactNode;
  /** Shown in full also when compact (a stop visited out of order, whose slide applies now). */
  keepOpen?: boolean;
}

const MARK: Record<StepState, { bg: string; border: string; ink: string; ring?: boolean }> = {
  done: { bg: colors.green, border: colors.green, ink: '#ffffff' },
  here: { bg: colors.blue, border: colors.blue, ink: '#ffffff' },
  next: { bg: colors.card, border: colors.blue, ink: colors.blue, ring: true },
  skipped: { bg: colors.red, border: colors.red, ink: '#ffffff' },
  todo: { bg: colors.card, border: colors.line, ink: colors.ink },
};

export function RouteStepper({ steps, compact = false, focus, testID = 'route-stepper' }: {
  steps: readonly Step[];
  /** The driver's sheet: only the step in focus shows its times and parts. */
  compact?: boolean;
  /** The step shown in full when compact (default: the first here / next). */
  focus?: string;
  testID?: string;
}) {
  const inFocus = focus ?? steps.find((s) => s.state === 'here' || s.state === 'next')?.key;
  return (
    <View testID={testID} accessibilityRole="list">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const m = MARK[s.state];
        const full = !compact || s.key === inFocus || !!s.keepOpen;
        return (
          <View key={s.key} style={styles.row} testID={`${testID}-step-${s.key}`} accessibilityLabel={[s.mark, s.place, s.time].filter(Boolean).join(', ')}>
            <View style={styles.timeCol}>
              {s.time ? <Mono size={15} bold>{s.time}</Mono> : null}
              {s.actual && full ? <Mono size={13} color={colors.muted}>{s.actual}</Mono> : null}
            </View>
            <View style={styles.rail}>
              <View style={[styles.mark, { backgroundColor: m.bg, borderColor: m.border }, m.ring && styles.ring]}>
                <Mono size={13} bold color={m.ink}>{s.mark}</Mono>
              </View>
              {!last && <View style={[styles.line, s.state === 'done' && { backgroundColor: colors.green }]} />}
            </View>
            <View style={[styles.body, last && { paddingBottom: 0 }]}>
              <View style={styles.head}>
                <Txt variant="strong" numberOfLines={full ? 2 : 1} style={{ flex: 1 }}>{s.place}</Txt>
                {s.aside}
              </View>
              {s.type && full ? <Txt variant="small">{s.type}</Txt> : null}
              {s.times && full ? <Txt variant="muted" size={15}>{s.times}</Txt> : null}
              {s.delta ? <Txt variant="strong" size={14} color={s.delta.tone === 'late' ? colors.amberText : colors.green}>{s.delta.text}</Txt> : null}
              {s.note && full ? <Txt variant={s.noteTone === 'blue' ? 'strong' : 'small'} size={s.noteTone === 'blue' ? 15 : undefined} color={s.noteTone === 'blue' ? colors.blue : s.noteTone === 'amber' ? colors.amberText : undefined}>{s.note}</Txt> : null}
              {full ? s.extra : null}
              {s.legAfter && !last ? <Txt variant="small" style={styles.leg}>{s.legAfter}</Txt> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  timeCol: { width: 52, paddingTop: 5, alignItems: 'flex-end' },
  rail: { width: 30, alignItems: 'center' },
  mark: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 3 },
  line: { flex: 1, width: 2, minHeight: 14, backgroundColor: colors.line, marginVertical: 2 },
  body: { flex: 1, gap: 2, paddingBottom: 14, paddingTop: 4 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  leg: { marginTop: 6 },
});
