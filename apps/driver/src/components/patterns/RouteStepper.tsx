// Round 4–7, item 12 (the approved mockups 2–4; item 11's rules; Uber's and DoorDash's route progress, Samsara's route
// view): the one route stepper of Office mode and /m/. Each row: the time on the left in mono (the actual or expected time
// big, the planned one small under it, struck through once something happened), a mark on one thin rail (S the start in
// amber, a numbered stop in ink, B back at base ringed; done = blue with a check, here / next = ringed blue with a halo,
// skipped = grey), the place on ONE line with its chip ("On time", "7 min late"), ONE meta line of small icon + text items
// ("1 h stay", "by 11:00", "Next · 42 km to go") and, under it, the leg to the next row ("🚗 99 km · 2 h 23 min"). While
// the trip runs (`live`) the rail is blue up to the last stop left.
// Presentational and general (planned / actual times, a compact size): the plan (Review, the request), the live timeline
// (components/office/StopTimeline.tsx) and the driver's own screens can all feed it rows (a compact card: the time at the
// right with `timeSide="right"`, the stops behind the driver `passed`, a "Show all N stops" link as a row's `after`).

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Car, Check, type LucideIcon } from '@/components/icons';
import { Mono, Txt } from '@/components/ui';
import { colors } from '@/theme';
import { look, TINT, type ToneName } from './look';

export interface StepperMeta {
  icon?: LucideIcon;
  text: string;
  tone?: ToneName | 'ink';
  /** A time or a number inside the words: in mono. */
  mono?: boolean;
  testID?: string;
}

export interface StepperRow {
  key: string;
  /** "S", "2", "B". */
  mark: string;
  kind: 'start' | 'stop' | 'back';
  /** done = left (a blue check), passed = behind the driver on a compact card (a quiet check, the place grey). */
  state?: 'done' | 'passed' | 'current' | 'todo' | 'skipped';
  /** The big time on the left (the actual, the expected, else the planned one). */
  time?: string;
  timeTone?: 'blue' | 'ink';
  /** A small time under it (the planned one). */
  sub?: string;
  /** The small time struck through (the plan, once the real time differs). */
  subStruck?: boolean;
  title: string;
  titleLines?: 1 | 2;
  chip?: { text: string; tone: ToneName } | null;
  /** ONE meta line. */
  meta?: StepperMeta[];
  /** More lines under the meta (the live timeline's words, the arrival point, Save as our place). */
  lines?: ReactNode;
  /** The leg to the next row ("99 km · 2 h 23 min"). */
  leg?: string;
  /** Under the row, on the rail (a "Show all N stops" link). */
  after?: ReactNode;
  testID?: string;
}

export function RouteStepper({ rows, live = false, framed = true, compact = false, timeSide = 'left', testID = 'route-stepper' }: {
  rows: readonly StepperRow[];
  /** The trip is running: the rail is blue up to the last stop done. */
  live?: boolean;
  /** Its own card (false: inside the caller's card). */
  framed?: boolean;
  compact?: boolean;
  /** right: the time at the end of the place's line (a compact card, the driver's Today), no time column. */
  timeSide?: 'left' | 'right';
  testID?: string;
}) {
  if (rows.length === 0) return null;
  const timeW = timeSide === 'right' ? 0 : compact ? 46 : 52;
  return (
    <View style={framed ? styles.card : undefined} testID={testID}>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        const doneRail = live && r.state === 'done' && !last;
        return (
          <View key={r.key} style={styles.row} testID={r.testID}>
            {timeSide === 'left' ? (
              <View style={{ width: timeW, paddingTop: 3 }}>
                {r.time ? <Mono size={compact ? 14 : 15} bold color={r.timeTone === 'blue' ? colors.blue : colors.ink}>{r.time}</Mono> : null}
                {r.sub ? <Mono size={12} color={colors.muted} style={r.subStruck ? styles.struck : undefined}>{r.sub}</Mono> : null}
              </View>
            ) : null}
            <View style={styles.rail}>
              <Mark row={r} live={live} />
              {!last ? <View style={[styles.line, doneRail && { backgroundColor: colors.blue }]} /> : null}
            </View>
            <View style={[styles.body, !last && { paddingBottom: compact ? 14 : 18 }]}>
              <View style={styles.titleRow}>
                <Txt variant="strong" size={compact ? 14 : 16} numberOfLines={r.titleLines ?? 1} color={r.state === 'passed' ? colors.muted : colors.ink} style={{ flexShrink: 1, flexGrow: timeSide === 'right' ? 1 : 0 }}>{r.title}</Txt>
                {r.chip ? <View style={[styles.chip, { backgroundColor: TINT[r.chip.tone].bg }]}><Txt variant="strong" size={13} color={TINT[r.chip.tone].ink} numberOfLines={1}>{r.chip.text}</Txt></View> : null}
                {timeSide === 'right' && r.time ? <Mono size={13} color={colors.muted}>{r.time}</Mono> : null}
              </View>
              {r.meta && r.meta.length > 0 ? (
                <View style={styles.meta}>
                  {r.meta.map((m, k) => {
                    const ink = !m.tone ? colors.muted : m.tone === 'ink' ? colors.ink : TINT[m.tone].ink;
                    return (
                      <View key={k} style={styles.metaItem} testID={m.testID}>
                        {m.icon ? <m.icon size={14} color={ink} strokeWidth={2} /> : null}
                        {m.mono ? <Mono size={13} color={ink}>{m.text}</Mono> : <Txt variant="small" size={14} color={ink}>{m.text}</Txt>}
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {r.lines}
              {r.leg ? (
                <View style={styles.leg}>
                  <Car size={14} color={colors.muted} strokeWidth={2} />
                  <Mono size={12} color={colors.muted} style={{ flexShrink: 1 }}>{r.leg}</Mono>
                </View>
              ) : null}
              {r.after}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Mark({ row, live }: { row: StepperRow; live: boolean }) {
  const s = row.state ?? 'todo';
  if (s === 'done') {
    return <View style={[styles.mark, { backgroundColor: colors.blue }]}><Check size={14} color="#ffffff" strokeWidth={3} /></View>;
  }
  if (s === 'passed') {
    return <View style={[styles.mark, { backgroundColor: look.rail }]}><Check size={13} color={colors.ink} strokeWidth={3} /></View>;
  }
  if (s === 'current') {
    return (
      <View style={styles.halo}>
        <View style={[styles.mark, { marginTop: 0, backgroundColor: colors.card, borderWidth: 3, borderColor: colors.blue }]}>
          <Mono size={11} bold color={colors.blue}>{row.mark}</Mono>
        </View>
      </View>
    );
  }
  if (s === 'skipped') return <View style={[styles.mark, { backgroundColor: colors.muted }]}><Mono size={11} bold color="#ffffff">{row.mark}</Mono></View>;
  if (row.kind === 'back') {
    const quiet = live;
    return (
      <View style={[styles.mark, { backgroundColor: colors.card, borderWidth: 2, borderColor: quiet ? look.railTodo : colors.ink }]}>
        <Mono size={11} bold color={quiet ? colors.muted : colors.ink}>{row.mark}</Mono>
      </View>
    );
  }
  if (row.kind === 'start') return <View style={[styles.mark, { backgroundColor: colors.amber }]}><Mono size={11} bold>{row.mark}</Mono></View>;
  return <View style={[styles.mark, { backgroundColor: colors.ink }]}><Mono size={11} bold color="#ffffff">{row.mark}</Mono></View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: look.radius, borderWidth: 1, borderColor: look.border, padding: 16 },
  row: { flexDirection: 'row' },
  rail: { width: 28, alignItems: 'center' },
  mark: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  halo: { width: 32, height: 32, borderRadius: 16, marginTop: -2, marginBottom: -2, backgroundColor: 'rgba(30,79,160,0.15)', alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, minHeight: 10, backgroundColor: look.rail, marginTop: 2 },
  body: { flex: 1, minWidth: 0, paddingLeft: 10, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, flexShrink: 0 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  struck: { textDecorationLine: 'line-through' },
});
