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

/** A row of location_points, as Realtime delivers an insert (the driver page grows its line from these). */
export interface PointRow {
  employee_id: string;
  recorded_at: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  received_at?: string | null;
}

/** Web only: every new location point of one driver, as it lands (a late backlog too, point by point). */
export function subscribeDriverPoints(employeeId: string, cb: (row: PointRow) => void, onStatus?: (s: RealtimeStatus) => void): () => void {
  return subscribeDriversPoints([employeeId], cb, onStatus);
}

/**
 * Web only: every new location point of several drivers on ONE channel (the live map's trails: the drivers
 * currently sharing). The caller subscribes again when that set changes.
 */
export function subscribeDriversPoints(employeeIds: string[], cb: (row: PointRow) => void, onStatus?: (s: RealtimeStatus) => void): () => void {
  if (!supabase || employeeIds.length === 0) return () => {};
  onStatus?.("connecting");
  const client = supabase;
  const filter = employeeIds.length === 1 ? `employee_id=eq.${employeeIds[0]}` : `employee_id=in.(${employeeIds.join(",")})`;
  const channel = client
    .channel(`location_points:${employeeIds.length}:${++serial}:${Date.now()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "location_points", filter }, (payload) => {
      const row = payload.new as Partial<PointRow>;
      if (row && typeof row.recorded_at === "string" && typeof row.lat === "number" && typeof row.lng === "number") cb(row as PointRow);
    })
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") onStatus?.("live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`Realtime location_points: ${status}`, err?.message ?? "");
        onStatus?.("error");
      } else if (status === "CLOSED") onStatus?.("connecting");
    });
  return () => { void client.removeChannel(channel); };
}

/**
 * Web only (Hotfix 2, A): the signed-in person's notification centre. office_inbox's policy lets a person read only
 * their own rows, so Realtime delivers only theirs: a new item (INSERT) and one read in another tab (UPDATE) reload
 * the bell. Deletes are left out (the nightly clean-up removes read rows; Realtime does not filter deletes by policy).
 */
export function subscribeInbox(cb: () => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`office_inbox:${++serial}:${Date.now()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "office_inbox" }, () => cb())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "office_inbox" }, () => cb())
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn(`Realtime office_inbox: ${status}`, err?.message ?? "");
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

/**
 * Web only (Part 3b, H3): a driver's row on one question changed (sent, seen, answered): the answers page asks
 * ask_answers again. Office people with approve or assign_tasks read driver_ask_answers through RLS.
 */
export function subscribeAskAnswers(askId: string, cb: () => void): () => void {
  // The id goes into the channel's filter: only a uuid.
  if (!supabase || !/^[0-9a-f-]{36}$/i.test(askId)) return () => {};
  const client = supabase;
  const channel = client
    .channel(`driver_ask_answers:${askId}:${++serial}:${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "driver_ask_answers", filter: `ask_id=eq.${askId}` }, () => cb())
    .subscribe((status, err) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn(`Realtime driver_ask_answers: ${status}`, err?.message ?? "");
    });
  return () => { void client.removeChannel(channel); };
}
