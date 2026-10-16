// Arrived needs the phone near the stop (Phase 7, item 18; docs/phase7-plan.md §18). The rule
// is lib/dayRules.ts; this file reads the phone's own position while the task screen is open
// (foreground only, a fix about every 5 s) and draws the current stop's buttons:
//   ok       within 300 m with a fix of 100 m or better: Arrived
//   far      "You are 42 km from Kurunegala site" and "I'm here, the pin is wrong" (flag override)
//   waiting  "Waiting for GPS…"; after 60 s the same override (flag no_gps)
//   no pin   Arrived, with the note "No pin for this stop" (flag no_pin)
// Done appears only once the stop is Arrived.

import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Check, MapPin } from '@/components/icons';
import { Button, Txt } from '@/components/ui';
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

/** The current stop's actions: Arrived (with the distance rule) or, once arrived, Done. */
export function ArrivalButton({ stop, here }: { stop: TaskStop; here: Here }) {
  const { t, markStopArrived, markStopDone } = useApp();
  const check = arrivalCheck(stop, here.fix);
  const waitStart = useWaitStart(check.state === 'waiting', here.now);

  if (canMarkDone(stop)) {
    return <Button kind="dark" icon={Check} label={t('task.done')} onPress={() => markStopDone(stop)} style={styles.button} />;
  }

  const arrive = (made: ArrivalCheck) => markStopArrived(stop, arrivalRecord(made));
  const override = <Button kind="outline" icon={MapPin} label={t('arrive.override')} onPress={() => arrive(check)} style={styles.button} />;

  switch (check.state) {
    case 'ok':
      return <Button kind="dark" label={t('task.arrived')} onPress={() => arrive(check)} style={styles.button} />;
    case 'no_pin':
      return (
        <View style={{ gap: 6 }}>
          <Button kind="dark" label={t('task.arrived')} onPress={() => arrive(check)} style={styles.button} />
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
  button: { minHeight: 56 },
  // Reads like a button, but is not one: the phone is not at the stop yet.
  status: { minHeight: 56, borderRadius: 16, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.page, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
});
