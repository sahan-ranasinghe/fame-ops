// The server can end a driver's duty (Phase 7, docs/phase7-plan.md §1): at the day's cut-off (duty_jobs)
// or by the office (office_clock_out). Both push "You were clocked out"; when the app missed the push
// it still finds out from the next heartbeat's answer (on_duty false, with how the duty ended). Then
// it stops recording location here, without a screen (the heartbeat may run in the background
// location task), clears the vehicle it holds, keeps the reason for Today's notice and tells the
// driver once. Loaded by the app's entry (index.ts), so it listens from the start.

import { translate } from '../i18n';
import { onHeartbeatAnswer } from '../sync';
import { opsWaiting } from '../sync/store';
import type { HeartbeatAnswer } from './api';
import { getJson, KEYS, setJson } from './kv';
import { getSharing, type SharingState, stopSharing } from './location';
import { notifyDutyEnded } from './notifications';
import { colomboTime } from './time';
import type { Employee, Language } from './types';

/** A duty this new is not stopped by a heartbeat (its own start may not have reached the server yet). */
export const DUTY_ANSWER_GRACE_MS = 2 * 60_000;

export interface DutyEnded {
  at: string;
  reason: 'driver' | 'auto' | 'admin';
}

/** Whether the answer means "stop": the server says off duty, this phone records, and its start is not still on the way. */
export function dutyEndedByServer(
  answer: HeartbeatAnswer,
  sharing: Pick<SharingState, 'startedAt'> | null,
  startsWaiting: number,
  now: number,
): boolean {
  if (answer.on_duty !== false || !sharing || startsWaiting > 0) return false;
  return now - new Date(sharing.startedAt).getTime() >= DUTY_ANSWER_GRACE_MS;
}

/** The notice's words: "Clocked out at 21:00 (end of the day)." or "The office clocked you out at 15:20." */
export function dutyEndedText(language: Language, ended: DutyEnded): { title: string; body: string } {
  const time = colomboTime(ended.at);
  return {
    title: translate(language, 'duty.autoOutTitle'),
    body: translate(language, ended.reason === 'admin' ? 'duty.officeOutBody' : 'duty.autoOutBody', { time }),
  };
}

type Listener = (ended: DutyEnded) => void;
const listeners = new Set<Listener>();

/** The screens hear when the server ended the duty (Today shows the notice, the switch goes off). */
export function onDutyEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let stopping = false;

export async function handleDutyAnswer(answer: HeartbeatAnswer, now = Date.now()): Promise<boolean> {
  if (stopping || !dutyEndedByServer(answer, getSharing(), opsWaiting('session_start'), now)) return false;
  stopping = true;
  try {
    // The session is already closed on the server: the session_end this sends changes nothing there.
    await stopSharing('auto');
    const me = getJson<Employee>(KEYS.me);
    if (me && me.current_vehicle_id !== null) setJson(KEYS.me, { ...me, current_vehicle_id: null });
    const ended: DutyEnded = answer.duty_end ?? { at: new Date(now).toISOString(), reason: 'auto' };
    setJson(KEYS.dutyEnded, ended);
    if (ended.reason !== 'driver') {
      const text = dutyEndedText(getJson<Language>(KEYS.language) ?? 'en', ended);
      await notifyDutyEnded(text.title, text.body);
    }
    for (const listener of listeners) listener(ended);
    return true;
  } finally {
    stopping = false;
  }
}

onHeartbeatAnswer((answer) => {
  void handleDutyAnswer(answer);
});
