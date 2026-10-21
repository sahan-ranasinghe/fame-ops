// Arrived needs the phone near the stop (Phase 7, item 18; docs/phase7-plan.md §18). The rule
// is lib/dayRules.ts; this file reads the phone's own position while the task screen is open
// (foreground only, a fix about every 5 s) and draws the current stop's buttons:
//   ok       within 300 m with a fix of 100 m or better: Arrived
//   far      "You are 42 km from Kurunegala site" and "I'm here, the pin is wrong" (flag override)
//   waiting  "Waiting for GPS…"; after 60 s the same override (flag no_gps)
//   no pin   Arrived, with the note "No pin for this stop" (flag no_pin)
// Done (Left) appears only once the stop is Arrived.
// Round 2 (21 October 2026): every one of these is a slide (components/patterns/SlideToConfirm.tsx), never a tap, with
// Undo in a snackbar for 6 s; the last stop's Left is "Slide to finish" (then Log mileage).

import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { showSnackbar, SNACK_ACTION_MS } from '@/components/patterns/Snackbar';
import { SlideToConfirm } from '@/components/patterns/SlideToConfirm';
import { Txt } from '@/components/ui';
import type { Vars } from '@/i18n';
import { type ArrivalCheck, arrivalCheck, arrivalRecord, canMarkDone, type Fix, NO_GPS_OVERRIDE_AFTER_MS } from '@/lib/dayRules';
import type { TaskStop } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** How often the screen asks for a fix, and re-checks how old the last one is. */
const FIX_EVERY_MS = 5_000;
/** A fix older than this is no fix (the GPS lost the sky, or the phone stopped giving positions). */
const FIX_MAX_AGE_MS = 30_000;

export interface Here {
  /** The phone's latest usable fix, or null (none, or too old). */
  fix: Fix | null;
  /** The clock the checks use, moving every 5 s so a fix ages and the 60 s wait ends. */
  now: number;
}

/** The phone's position while a task screen is open: one foreground watcher, nothing recorded. */
export function useHere(enabled: boolean): Here {
  const [latest, setLatest] = useState<(Fix & { at: number }) | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    const keep = (position: Location.LocationObject, at: number) => {
      if (cancelled) return;
      setLatest({ lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: position.coords.accuracy, at });
    };
    (async () => {
      try {
        if (!(await Location.getForegroundPermissionsAsync()).granted) return;
        // A recent fix shows at once; an old one (from somewhere else) is not used.
        const last = await Location.getLastKnownPositionAsync({ maxAge: FIX_MAX_AGE_MS });
        if (last) keep(last, last.timestamp);
        const watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: FIX_EVERY_MS, distanceInterval: 0 },
          (update) => keep(update, Date.now()),
        );
        if (cancelled) watcher.remove();
        else subscription = watcher;
      } catch {
        // No position: Arrived waits for GPS, then offers the override.
      }
    })();
    const timer = setInterval(() => setNow(Date.now()), FIX_EVERY_MS);
    return () => {
      cancelled = true;
      subscription?.remove();
      clearInterval(timer);
    };
  }, [enabled]);

  const fresh = latest !== null && now - latest.at <= FIX_MAX_AGE_MS;
  return { fix: fresh ? latest : null, now };
}

/** "420 m" under 1 km, "4.2 km" under 10 km, "42 km" above; Latin digits in both languages. */
export function distanceText(t: (key: string, vars?: Vars) => string, meters: number): string {
  if (meters < 1000) return t('arrive.m', { n: Math.round(meters / 10) * 10 });
  const km = meters / 1000;
  return t('arrive.km', { n: km < 10 ? km.toFixed(1) : String(Math.round(km)) });
}

/**
 * Round 2: the slides with their Undo (a snackbar for 6 s). Arrived and Left are the same queued writes as before, with
 * the phone's own time; Undo queues the revert after them.
 */
export function useStopSlides(): { arrive: (stop: TaskStop, made: ArrivalCheck) => void; leave: (stop: TaskStop) => void } {
  const { t, markStopArrived, markStopDone, undoStopStep } = useApp();
  return {
    arrive: (stop, made) => {
      markStopArrived(stop, arrivalRecord(made));
      showSnackbar({
        text: t('task.undoArrived', { stop: stop.place_name }),
        action: { label: t('task.undo'), onPress: () => undoStopStep(stop, 'arrived') },
        ms: SNACK_ACTION_MS,
      });
    },
    leave: (stop) => {
      if (!canMarkDone(stop)) return;
      markStopDone(stop);
      showSnackbar({
        text: t('task.undoLeft', { stop: stop.place_name }),
        action: { label: t('task.undo'), onPress: () => undoStopStep(stop, 'left') },
        ms: SNACK_ACTION_MS,
      });
    },
  };
}

/**
 * The current stop's one action, always a slide (never a tap): "Slide when you arrive at …" by the distance rule (or the
 * override slide, flagged as before), then "Slide when you leave …"; on the last stop "Slide to finish", which hands over
 * to the screen's finish (Log mileage, as Complete task does; no Undo there).
 */
export function ArrivalButton({ stop, here, last = false, onFinish }: { stop: TaskStop; here: Here; last?: boolean; onFinish?: (stop: TaskStop) => void }) {
  const { t } = useApp();
  const slides = useStopSlides();
  const check = arrivalCheck(stop, here.fix);
  const waitStart = useWaitStart(check.state === 'waiting', here.now);

  if (canMarkDone(stop)) {
    return last && onFinish
      ? <SlideToConfirm tone="dark" label={t('task.slideFinish')} onConfirm={() => onFinish(stop)} testID="slide-finish" />
      : <SlideToConfirm tone="dark" label={t('task.slideLeave', { stop: stop.place_name })} onConfirm={() => slides.leave(stop)} testID="slide-leave" />;
  }

  const arrive = () => slides.arrive(stop, check);
  const override = <SlideToConfirm tone="outline" label={t('arrive.override')} onConfirm={arrive} testID="slide-override" />;
  const slide = <SlideToConfirm label={t('task.slideArrive', { stop: stop.place_name })} onConfirm={arrive} testID="slide-arrive" />;

  switch (check.state) {
    case 'ok':
      return slide;
    case 'no_pin':
      return (
        <View style={{ gap: 6 }}>
          {slide}
          <Txt variant="small">{t('arrive.noPin')}</Txt>
        </View>
      );
    case 'far':
      return (
        <View style={{ gap: 8 }}>
          <View style={styles.status} accessibilityRole="text">
            <Txt variant="strong" color={colors.amberText} style={{ textAlign: 'center' }}>
              {t('arrive.far', { distance: distanceText(t, check.distanceM), place: stop.place_name })}
            </Txt>
          </View>
          {override}
        </View>
      );
    case 'waiting':
      return (
        <View style={{ gap: 8 }}>
          <View style={[styles.status, { flexDirection: 'row', gap: 10 }]} accessibilityRole="text">
            <ActivityIndicator color={colors.muted} />
            <Txt variant="strong" color={colors.muted}>{t('arrive.waitingGps')}</Txt>
          </View>
          {waitStart !== null && here.now - waitStart >= NO_GPS_OVERRIDE_AFTER_MS && override}
        </View>
      );
  }
}

/** Since when the screen has been waiting for a usable fix (null while it has one). */
function useWaitStart(waiting: boolean, now: number): number | null {
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (!waiting) setSince(null);
    else setSince((old) => old ?? now);
  }, [waiting, now]);
  return waiting ? since : null;
}

const styles = StyleSheet.create({
  // Reads like a button, but is not one: the phone is not at the stop yet.
  status: { minHeight: 56, borderRadius: 16, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.page, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
});
