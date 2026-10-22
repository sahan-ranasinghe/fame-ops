// The driver's task under way, the sheet under the map (design/png/Driver · Task in progress.png; Part B pilot,
// docs/design-pass.md §5 d). A view only: app/task/[id].tsx hands it the task's words, the numbers, the steps and the
// parts that live on the phone (the slides, the notices, the call buttons); so the same sheet is drawn for a screenshot
// with sample data (src/design/DriverTaskHarness.tsx, only in the e2e build).
//
// Top to bottom, as designed: IN PROGRESS and the start time; the stop being driven to (big), the task and its people;
// the notices; three numbers (Distance left, Arrive about, Start odo); Navigate and Call contact; then the stops as the
// compact RouteStepper (the current stop with its slide, the others one line each); the rest; Complete task; Report a
// problem.

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Check, MapPin, Navigation, Phone, Plus } from '@/components/icons';
import { GoogleCredit } from '@/components/GoogleCredit';
import { RouteStepper, type Step } from '@/components/patterns/RouteStepper';
import { type StatCell, StatsRow } from '@/components/patterns/StatsRow';
import { Button, Mono, Notice, Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export interface RunningSheetProps {
  /** "Started 07:06". */
  startedLine?: string;
  /** The stop being driven to (or the task's title when none is left). */
  title: string;
  /** "Team drop · 5 passengers". */
  subtitle?: string;
  googleCredit?: boolean;
  /** "The planned line is on Google's map only", when there is one. */
  lineNote?: string;
  /** The notices that apply now (a refused trip, location sharing, the arrival card, the vehicle swap). */
  notices?: ReactNode;
  stats: StatCell[];
  /** "GPS ≈ 12 km" under the numbers. */
  gpsLine?: ReactNode;
  steps: Step[];
  focus?: string;
  onNavigate?: () => void;
  onCall?: () => void;
  onAllStops?: () => void;
  onAddStop?: () => void;
  /** The calls to the requester, the fleet admin, the office; who approved; Running late. */
  more?: ReactNode;
  /** The last stop is still open: Complete waits for it. */
  lastOpen?: boolean;
  onComplete: () => void;
  onReport: () => void;
}

export function RunningSheet(p: RunningSheetProps) {
  const { t } = useApp();
  return (
    <>
      {p.lineNote ? <Txt variant="small" style={{ marginTop: -6 }}>{p.lineNote}</Txt> : null}
      <View style={styles.topRow}>
        <Txt variant="label" color={colors.blue}>{t('today.inProgress')}</Txt>
        {p.startedLine ? <Mono size={16} color={colors.muted}>{p.startedLine}</Mono> : null}
      </View>
      <View>
        <Txt variant="title" size={28}>{p.title}</Txt>
        <GoogleCredit show={!!p.googleCredit} />
        {p.subtitle ? <Txt variant="muted" size={18}>{p.subtitle}</Txt> : null}
      </View>
      {p.notices}
      <StatsRow testID="task-stats" cells={p.stats} />
      {p.gpsLine}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button kind="outline" icon={Navigation} label={t('task.navigate')} disabled={!p.onNavigate} onPress={() => p.onNavigate?.()} style={{ flex: 1 }} />
        <Button kind="outline" icon={Phone} label={t('task.callContact')} disabled={!p.onCall} onPress={() => p.onCall?.()} style={{ flex: 1 }} />
      </View>
      <View style={styles.stops}>
        <RouteStepper steps={p.steps} compact focus={p.focus} testID="task-stops" />
      </View>
      {p.onAddStop ? <Button kind="outline" icon={Plus} label={t('trip.addStop')} onPress={p.onAddStop} /> : null}
      {p.onAllStops ? <Button kind="outline" icon={MapPin} label={t('task.allStops')} onPress={p.onAllStops} /> : null}
      {p.more}
      {p.lastOpen ? <Notice tone="warn" text={t('complete.needsLastStop')} /> : null}
      <Button kind="dark" icon={Check} label={t('task.complete')} disabled={!!p.lastOpen} onPress={p.onComplete} />
      <Button kind="danger-text" label={t('task.reportProblem')} onPress={p.onReport} />
    </>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stops: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingVertical: 14, paddingRight: 14, paddingLeft: 4 },
});
