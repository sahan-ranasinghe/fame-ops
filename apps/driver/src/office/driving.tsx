// Round 50 (docs/phase8-plan.md §37.4): Office mode's ways into Driving mode (Uber's driver mode switch: one account, the
// office side and the driver side). Home's "You have a trip to drive · Start driving", More's "Driving" row and My trip's
// "Start driving" all go through useStartDriving: the person's own employees row is loaded as the driver state
// (state/app.tsx enterDriving: no new sign-in, nothing forgotten) and the driver screens come to the front, on the trip
// when one is named. Only on the app, only with /me's can_drive and the setting self_drive_mode on (lib/drivingMode.ts).

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { showSnackbar } from '@/components/patterns/Snackbar';
import { getJson, KEYS } from '@/lib/kv';
import { canEnterDriving, type DriverRow, tripToDrive } from '@/lib/drivingMode';
import { colomboDate } from '@/lib/time';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { useOfficeMe } from './store';

/** Driving mode is offered to this person on this device (the app, can_drive, self_drive_mode on). */
export function useCanDrive(): boolean {
  const me = useOfficeMe();
  return canEnterDriving(me, Platform.OS !== 'web');
}

/** Start driving, optionally on one trip: Driving mode in front (Today underneath the trip), or why not in the snackbar. */
export function useStartDriving(): { busy: boolean; start: (taskId?: string) => Promise<void> } {
  const app = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const start = useCallback(async (taskId?: string) => {
    if (busy) return;
    setBusy(true);
    const outcome = await app.enterDriving();
    setBusy(false);
    if (outcome !== 'ok') {
      showSnackbar({ text: app.t(outcome === 'network' ? 'driving.network' : 'driving.refused'), tone: 'error' });
      return;
    }
    // Today first (back from the trip lands there, never in Office mode: Back to office is its own button).
    // The first time, the Permissions step comes first (location "Allow all the time"); the trip is on Today after it.
    router.replace('/');
    if (taskId && getJson<boolean>(KEYS.permissionsSeen)) router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, [app, router, busy]);
  return { busy, start };
}

/**
 * Home's line: a trip of theirs under way, else the first one today still to start; null when there is none (or Driving
 * mode is not offered). The driver state's list when it is loaded (a trip behind Office mode), else read when Home shows.
 */
export function useTripToDrive(): TaskWithStops | null {
  const app = useApp();
  const allowed = useCanDrive();
  const [read, setRead] = useState<{ me: DriverRow; tasks: TaskWithStops[] } | null>(null);
  const loaded = app.officeDriver && app.me !== null;
  // The newest reader (the app's value is a new object at every render: never a dependency of the focus effect).
  const loadRef = useRef(app.loadDriveTrips);
  loadRef.current = app.loadDriveTrips;
  useFocusEffect(useCallback(() => {
    if (!allowed || loaded) return;
    let live = true;
    loadRef.current().then((answer) => {
      if (live) setRead(answer);
    }, () => undefined); // no connection: no line (Start driving is on More too)
    return () => {
      live = false;
    };
  }, [allowed, loaded]));
  if (!allowed) return null;
  const today = colomboDate();
  if (loaded && app.me) return tripToDrive(app.tasks, app.me, today, colomboDate);
  return read ? tripToDrive(read.tasks, read.me, today, colomboDate) : null;
}
