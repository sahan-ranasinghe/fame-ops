// Part 6: tells the server whether Google's map loads on this phone (report_map_state; the rules are in lib/mapEngine.ts).
// The newest report waits on the phone until the server takes it: sent at once, and again when the app refreshes (it
// comes to the front, the network is back, pull to refresh).

import * as api from './api';
import { appVersionLabel } from './heartbeat';
import { getJson, KEYS, remove, setJson } from './kv';
import { type FailReason, type MapReport, nextReport } from './mapEngine';
import { supabase } from './supabase';

let sending: Promise<void> | null = null;

/** A map's outcome on this phone: queues the report it needs (if any) and sends it. */
export function noteMapOutcome(outcome: { googleFailed?: FailReason; googleLoaded?: true }, now = new Date()): void {
  const pending = getJson<MapReport>(KEYS.mapReportPending);
  const last = pending ? pending.google_ok : getJson<boolean>(KEYS.mapReported);
  const report = nextReport(typeof last === 'boolean' ? last : null, outcome, now.toISOString());
  if (!report) return;
  setJson(KEYS.mapReportPending, report);
  void flushMapReport();
}

/** Sends the waiting report, if any; kept for the next try when the server cannot be reached. */
export function flushMapReport(): Promise<void> {
  if (sending) return sending;
  sending = (async () => {
    const pending = getJson<MapReport>(KEYS.mapReportPending);
    if (!pending) return;
    try {
      await api.reportMapState(supabase, { ...pending, app_version: appVersionLabel() });
      setJson(KEYS.mapReported, pending.google_ok);
      // A newer report may have been queued meanwhile: only this one leaves.
      if (getJson<MapReport>(KEYS.mapReportPending)?.at === pending.at) remove(KEYS.mapReportPending);
    } catch {
      // Offline or refused: tried again at the next refresh.
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}
