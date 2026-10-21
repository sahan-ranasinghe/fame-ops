// Round 2 (21 October 2026): the in-app arrival card (Uber's "Arrived?"), from the rule in lib/stopGeofence.ts and the
// task screen's own position watch (useHere). After 60 s within 150 m of the current stop: "Arrived at <stop>?" with the
// slide; a stop Arrived but never Left and 60 s at the next one: "Mark <stop> as done?" with the slide. Drive on and it
// goes; nothing is marked by itself. The slides are the stop rows' own (useStopSlides: the 300 m rule, Undo).
// Round 2b: a stop driven past (never Arrived) and 60 s at the next one: "Did you stop at <stop>?" with two choices, the
// slide "Yes, I was there" (Arrived and Left now, marked as a far-away Arrived is) or "Skip it" (the skip sheet's reasons).

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { type Here, useStopSlides } from '@/components/ArrivalButton';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import { Button, Txt } from '@/components/ui';
import { arrivalCheck } from '@/lib/dayRules';
import { geofenceStep, NO_DWELL, type Dwell } from '@/lib/stopGeofence';
import type { TaskStop, TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function GeofenceCard({ task, here, onSkip }: { task: TaskWithStops; here: Here; onSkip: (stop: TaskStop) => void }) {
  const { t } = useApp();
  const slides = useStopSlides();
  const [dwell, setDwell] = useState<Dwell>(NO_DWELL);
  const step = geofenceStep(task.task_stops, here.fix, dwell, here.now);
  const nextKey = step.dwell.key;
  const nextSince = step.dwell.since;
  useEffect(() => {
    setDwell((old) => (old.key === nextKey && old.since === nextSince ? old : { key: nextKey, since: nextSince }));
  }, [nextKey, nextSince]);

  const prompt = step.prompt;
  if (!prompt) return null;
  if (prompt.kind === 'arrive') {
    return (
      <View style={styles.card} testID="geofence-card">
        <Txt variant="heading" size={22}>{t('geofence.arrivedTitle', { stop: prompt.stop.place_name })}</Txt>
        <SlideToConfirm
          label={t('task.slideArrive', { stop: prompt.stop.place_name })}
          onConfirm={() => slides.arrive(prompt.stop, arrivalCheck(prompt.stop, here.fix))}
          testID="geofence-arrive"
        />
      </View>
    );
  }
  if (prompt.kind === 'passed') {
    return (
      <View style={styles.card} testID="geofence-card">
        <Txt variant="heading" size={22}>{t('geofence.passedTitle', { stop: prompt.stop.place_name })}</Txt>
        <Txt variant="muted">{t('geofence.doneBody', { next: prompt.next.place_name })}</Txt>
        <SlideToConfirm
          label={t('geofence.passedYes')}
          onConfirm={() => slides.passed(prompt.stop, arrivalCheck(prompt.stop, here.fix))}
          testID="geofence-passed-yes"
        />
        <Button kind="outline" label={t('geofence.passedSkip')} onPress={() => onSkip(prompt.stop)} testID="geofence-passed-skip" />
      </View>
    );
  }
  return (
    <View style={styles.card} testID="geofence-card">
      <Txt variant="heading" size={22}>{t('geofence.doneTitle', { stop: prompt.stop.place_name })}</Txt>
      <Txt variant="muted">{t('geofence.doneBody', { next: prompt.next.place_name })}</Txt>
      <SlideToConfirm tone="dark" label={t('task.slideLeave', { stop: prompt.stop.place_name })} onConfirm={() => slides.leave(prompt.stop)} testID="geofence-leave" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, borderRadius: 16, borderWidth: 2, borderColor: colors.amber, backgroundColor: colors.amberChip, padding: 14 },
});
