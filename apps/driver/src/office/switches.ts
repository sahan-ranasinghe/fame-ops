// Round 4–7 (docs/phase8-plan.md §33.13: "a feature switched off hides its part"): the fleet's five feature switches as
// Office mode and /m/ read them (get_settings settings.<key>; absent = on, as the server's defaults). The server leaves a
// switched-off feature's data out of its answers; the screens also hide its part themselves, so a switch turned off shows at
// once (the Quick settings write it here) and an answer read before the change shows nothing of it either.
//
// One copy for every screen and component (a list of rows asks once, not once a row): get_settings at most once a minute
// per person, the answers shared; a failed read keeps the last one (else every switch on, as the server's defaults).

import { useEffect, useSyncExternalStore } from 'react';

import { FEATURE_KEYS, type FeatureKey } from './peopleLogic';
import { useOffice } from './state';
import type { FleetSettings, SettingsResult } from './types';

/** The five switches (Settings → Fleet, Office mode's Quick settings: peopleLogic.ts FEATURE_KEYS). */
export const SWITCH_KEYS = FEATURE_KEYS;
export type SwitchKey = FeatureKey;

/** get_settings is read again when the copy held is older than this. */
export const SWITCHES_FRESH_MS = 60_000;

/** A switch in a get_settings answer: off only when the answer says false (absent = on). */
export function switchOn(s: { settings?: Partial<FleetSettings> | null } | null | undefined, key: SwitchKey): boolean {
  return s?.settings?.[key] !== false;
}

interface Held {
  person: string;
  at: number;
  settings: Partial<FleetSettings>;
}

let held: Held | null = null;
let asking: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const read = () => held;

/** Whose switches: the e-mail, else the name (a person with neither shares nothing with anyone). */
const personOf = (me: { email?: string; name: string }): string => (me.email ?? '').trim().toLowerCase() || `name:${me.name}`;

/** A get_settings answer read by a screen (or the Quick settings after a write): every component follows at once. */
export function noteSettings(me: { email?: string; name: string }, answer: Pick<SettingsResult, 'settings'> | null | undefined): void {
  if (!answer?.settings) return;
  held = { person: personOf(me), at: Date.now(), settings: { ...answer.settings } };
  notify();
}

/** One switch changed by the Quick settings (update_settings answered): shown at once, before the next read. */
export function noteSwitch(me: { email?: string; name: string }, key: SwitchKey, on: boolean): void {
  const person = personOf(me);
  held = { person, at: held?.person === person ? held.at : 0, settings: { ...(held?.person === person ? held.settings : {}), [key]: on } };
  notify();
}

/** Sign-out, or a test starting again. */
export function forgetSwitches(): void {
  held = null;
  asking = null;
  notify();
}

/** The switches as held for this person (null = nothing read yet: every switch on). */
export function heldSwitches(me: { email?: string; name: string }): Partial<FleetSettings> | null {
  return held && held.person === personOf(me) ? held.settings : null;
}

/**
 * Is this feature switched on? Reads get_settings when the copy held is not this person's or older than a minute (one read
 * at a time for the whole app); without the tool, or before the first answer, a switch is on (the server's default, and
 * the server leaves out what is off).
 */
export function useSwitch(key: SwitchKey): boolean {
  const { api, me } = useOffice();
  const now = useSyncExternalStore(subscribe, read, read);
  const person = personOf(me);
  const may = me.tools.includes('get_settings');
  useEffect(() => {
    if (!may) return;
    if (held && held.person === person && Date.now() - held.at < SWITCHES_FRESH_MS) return;
    if (asking === person) return;
    asking = person;
    void api.call<SettingsResult>('get_settings', {})
      .then((answer) => {
        if (asking === person) noteSettings(me, answer);
      })
      .catch(() => undefined)
      .finally(() => {
        if (asking === person) asking = null;
      });
    // The person and the tool decide; `me` itself changes every minute (/me read again).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, person, may]);
  return switchOn(now && now.person === person ? now : null, key);
}
