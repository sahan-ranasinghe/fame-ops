// Web build only: Supabase Realtime on driver_latest, with the person's
// session (the office_read_access policies decide which rows arrive).
import { supabase } from "../auth/supabase";
import type { LatestRow } from "./live";

let serial = 0;

export type RealtimeStatus = "connecting" | "live" | "error";

export function subscribeDriverLatest(cb: (row: LatestRow) => void, onStatus?: (s: RealtimeStatus) => void): () => void {
  if (!supabase) return () => {};
  onStatus?.("connecting");
  const client = supabase;
  // A fresh topic per subscription: a channel that is being removed is never reused
  // (React runs effects twice in development, which would otherwise leave a dead channel).
  const channel = client
    .channel(`driver_latest:${++serial}:${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "driver_latest" }, (payload) => {
      const row = payload.new as Partial<LatestRow>;
      if (row && typeof row.employee_id === "string") cb(row as LatestRow);
    })
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") onStatus?.("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`Realtime driver_latest: ${status}`, err?.message ?? "");
        onStatus?.("error");
      } else if (status === "CLOSED") onStatus?.("connecting");
    });
  return () => { void client.removeChannel(channel); };
}

/** Web only: any change on the issues table (the bell and the Issues page reload their list). */
export function subscribeIssues(cb: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`issues:${++serial}:${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => cb())
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn(`Realtime issues: ${status}`, err?.message ?? "");
    });
  return () => { void client.removeChannel(channel); };
}
