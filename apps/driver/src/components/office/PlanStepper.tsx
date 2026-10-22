// Round 4–7, item 12: a trip's plan on the route stepper (components/patterns/RouteStepper.tsx) for Review, the request page
// and the plan screen: the pure rows of office/stepperRows.ts with their icons (the stay a clock, the leave time an arrow,
// the deadline a flag, the people at the start), in the person's words; the plan screen's rows (timelineRows) carry its
// times as a sentence under each stop and every leg in full. And the ⓘ sheet that says how the plan was made
// (where the leave time came from, each leg in full with its source and the rush hour): the explanations item 11 puts
// behind a small ⓘ, nothing dropped.

import { useState } from 'react';
import { View } from 'react-native';

import { ArrowRight, Clock, Flag, Info, type LucideIcon, Navigation, Users } from '@/components/icons';
import { RouteStepper, type StepperRow } from '@/components/patterns/RouteStepper';
import { Sheet } from '@/components/patterns/Sheet';
import { RoundButton } from '@/components/patterns/TopBar';
import { Txt } from '@/components/ui';
import { durationText } from '@/lib/durations';
import type { MetaIcon, PlanRow, PlanWords } from '@/office/stepperRows';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const ICON: Record<MetaIcon, LucideIcon> = { stay: Clock, leave: ArrowRight, by: Flag, people: Users, next: Navigation };

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The plan rows' words in the person's language (existing keys, and item 12's few in the sidecar office-3). */
export function planWords(t: T): PlanWords {
  return {
    stay: (dur, usual) => `${t('office.ui3.stay', { dur })}${usual ? ` (${t('office.trip.rowUsualHere')})` : ''}`,
    leave: (time) => t('office.trip.rowLeave', { time }),
    by: (time) => t('office.ui3.by', { time }),
    passengersHere: t('office.trip.rowPassengers'),
    onTime: t('office.timeline.onTime'),
    late: (min) => t('office.task.minLate', { min }),
    km: (km) => t('office.trip.kmN', { km }),
    dur: (min) => durationText(t, min),
    expressway: t('office.trip.viaExpressway'),
    theStart: t('office.trip.rowTheStart'),
    backAt: (place) => t('office.request.backAt', { place }),
  };
}

/** The pure rows with their icons (and a row's sentence under it, wrapped), ready for the stepper. */
export function withIcons(rows: readonly PlanRow[], testID?: string): StepperRow[] {
  return rows.map(({ words, ...r }, i) => ({
    ...r,
    meta: r.meta?.map((m) => ({ ...m, icon: m.icon ? ICON[m.icon] : undefined })),
    lines: words ? <Txt variant="muted" size={15} testID={testID ? `${testID}-${i}-words` : undefined}>{words}</Txt> : undefined,
    testID: testID ? `${testID}-${i}` : undefined,
  }));
}

export function PlanStepper({ rows, live = false, framed = true, testID = 'plan-stepper' }: { rows: readonly PlanRow[]; live?: boolean; framed?: boolean; testID?: string }) {
  return <RouteStepper rows={withIcons(rows, `${testID}-row`)} live={live} framed={framed} testID={testID} />;
}

/** ⓘ beside the leave time: "How this was planned", the plan's own words one per line. */
export function PlanInfo({ lines, testID = 'plan-info' }: { lines: readonly string[]; testID?: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  if (lines.length === 0) return null;
  return (
    <>
      <RoundButton icon={<Info size={18} color={colors.muted} strokeWidth={2} />} label={t('office.ui3.howPlanned')} onPress={() => setOpen(true)} size={40} testID={testID} />
      <Sheet visible={open} title={t('office.ui3.howPlanned')} onClose={() => setOpen(false)} testID={`${testID}-sheet`}>
        <View style={{ gap: 10 }}>
          {lines.map((l, i) => <Txt key={i} variant="body" size={15}>{l}</Txt>)}
        </View>
      </Sheet>
    </>
  );
}
