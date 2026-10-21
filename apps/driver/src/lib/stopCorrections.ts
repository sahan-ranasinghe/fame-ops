// Round 2b: an Arrived the driver undid stays on the server as first recorded (task_stops_driver_rules keeps the first
// arrival flag). The phone remembers the stops it undid, so a stop marked Arrived again says so honestly on its progress
// line ("Arrived 10:52 · corrected", lib/stopProgressWords.ts). Only the phone's own small store; never the flag's name.

import { getJson, KEYS, setJson } from './kv';

const KEEP = 200;

export function noteArrivalUndone(stopId: string): void {
  const undone = getJson<string[]>(KEYS.arrivalUndone) ?? [];
  if (!undone.includes(stopId)) setJson(KEYS.arrivalUndone, [...undone, stopId].slice(-KEEP));
}

export function arrivalUndoneStops(): string[] {
  return getJson<string[]>(KEYS.arrivalUndone) ?? [];
}
