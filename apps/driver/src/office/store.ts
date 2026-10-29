// Office mode (Phase 8, O1): the signed-in office person, kept on the phone like the driver's row (lib/kv.ts), read by the
// route layouts to decide the interface (the session decides: docs/phase8-plan.md section 1). A driver sign-in and an
// office sign-in never both exist on one phone: office/auth.ts clears the other first. Round 50 (§37.4): one exception, the
// office person's own employees row loaded as the driver state in Driving mode (state/app.tsx enterDriving).

import { useSyncExternalStore } from 'react';

import { getJson, remove, setJson } from '@/lib/kv';
import type { Me } from './types';

export const OFFICE_KEYS = {
  /** GET /me as last answered (the person, their permissions and tools). */
  me: 'office.me',
  /** The e-mail typed at the last office sign-in (filled in next time). */
  email: 'office.email',
  /**
   * Round 50 (§37.4): whether this phone's last office sign-in could drive (GET /me can_drive). Kept after sign-out: the
   * sign-in screen then hides its Driver | Office switch (they sign in as office). A driver's sign-in clears it.
   */
  lastCanDrive: 'office.lastCanDrive',
} as const;

type Listener = () => void;
const listeners = new Set<Listener>();
let cached: Me | null | undefined;

export function getOfficeMe(): Me | null {
  if (cached === undefined) cached = getJson<Me>(OFFICE_KEYS.me);
  return cached;
}

export function setOfficeMe(me: Me | null): void {
  cached = me;
  if (me) {
    setJson(OFFICE_KEYS.me, me);
    setJson(OFFICE_KEYS.lastCanDrive, me.can_drive === true);
  } else remove(OFFICE_KEYS.me);
  listeners.forEach((l) => l());
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The office person on this phone (null = none), live. */
export function useOfficeMe(): Me | null {
  return useSyncExternalStore(subscribe, getOfficeMe, getOfficeMe);
}
