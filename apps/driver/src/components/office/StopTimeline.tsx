// A trip's stops as a live delivery timeline (Round 2, 21 October 2026; Uber / DoorDash / Samsara route progress), the one
// component for Office mode and /m/ (the site has its own, screens/StopProgress.tsx, with the same rules): a numbered mark
// per stop on a vertical line (filled once left, ringed blue at the current stop, grey when skipped), the place, "Planned
// 10:30 · Arrived 10:52 · Left 11:40", the delta (late amber, early / on time green) and, for a stop still to come,
// "About 12:10 (updated 10:52)". The words: office/stopTimelineLogic.ts. `extra` adds a row's own parts under it (the
// arrival point, Save as our place).
// Round 4–7, item 12 (the approved mockup 4): drawn on the one route stepper (components/patterns/RouteStepper.tsx): the time
// that is true now on the left (left or arrived, else the new estimate in blue, else the plan; the plan struck through
// under a stop left), the mark (a check once left, ringed with a halo here or next), the rail blue up to the last stop left;
// the words above stay as they were, under the place. `before` / `after` are the start (S) and back at base (B).

import type { ReactNode } from 'react';
import { View } from 'react-native';

import { RouteStepper, type StepperRow } from '@/components/patterns/RouteStepper';
import { Txt } from '@/components/ui';
import { stopLine } from '@/office/stopTimelineLogic';
import type { Stop } from '@/office/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const TONE = { late: colors.amberText, early: colors.green, on_time: colors.green } as const;

export function StopTimeline({ stops, extra, before, after, live = false, framed = false, testID = 'stop-timeline' }: {
  stops: readonly Stop[];
  extra?: (s: Stop) => ReactNode;
  /** The start (S) when it is not one of the stops. */
  before?: StepperRow | null;
  /** Back at base (B). */
  after?: StepperRow | null;
  /** The trip is running: the rail is blue up to the last stop left. */
  live?: boolean;
  framed?: boolean;
  testID?: string;
}) {
  const { t } = useApp();
  const rows: StepperRow[] = stops.map((s, i) => {
    const line = stopLine(s, t);
    const p = s.progress;
    const actual = p?.left ?? s.done ?? p?.arrived ?? s.arrived;
    const planned = p?.planned_arrive ?? s.planned_arrive;
    const estimate = !actual && line.state !== 'skipped' ? p?.estimate?.arrive : undefined;
    const state: StepperRow['state'] = line.state === 'left' ? 'done' : line.state === 'skipped' ? 'skipped' : line.state === 'here' || line.current ? 'current' : 'todo';
    return {
      key: String(s.id ?? s.seq),
      mark: s.is_start ? 'S' : String(s.n ?? s.seq),
      kind: s.is_start ? 'start' : 'stop',
      state,
      time: actual ?? estimate ?? planned,
      timeTone: state === 'current' ? 'blue' : 'ink',
      sub: line.state === 'left' && planned && planned !== actual ? planned : undefined,
      subStruck: true,
      title: s.place || s.address || s.label || '',
      titleLines: 2,
      testID: `timeline-stop-${i}`,
      lines: (
        <View style={{ gap: 2 }}>
          {line.times ? <Txt variant="muted" size={14} testID={`timeline-times-${i}`}>{line.times}</Txt> : null}
          {(line.delta || line.arriveBy) && (
            <Txt variant="small" testID={`timeline-delta-${i}`}>
              {line.delta ? <Txt variant="strong" size={14} color={TONE[line.delta.tone]}>{line.delta.text}</Txt> : null}
              {line.delta && line.arriveBy ? ' · ' : ''}
              {line.arriveBy ?? ''}
            </Txt>
          )}
          {line.estimate ? <Txt variant="strong" size={14} color={colors.blue} testID={`timeline-estimate-${i}`}>{line.estimate}</Txt> : null}
          {line.confirmed ? <Txt variant="small" testID={`timeline-confirmed-${i}`}>{line.confirmed}</Txt> : null}
          {extra?.(s)}
        </View>
      ),
    };
  });
  const all = [...(before ? [before] : []), ...rows, ...(after ? [after] : [])];
  return <RouteStepper rows={all} live={live} framed={framed} testID={testID} />;
}
