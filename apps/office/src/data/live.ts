// The live map's rules on the client, all from the one shared status rule
// (supabase/functions/_shared/fleet/status.ts, imported as @fleet/status):
// how a Realtime row from driver_latest updates a driver card, and how the
// cards age as the clock ticks. The older state/location fields (15 min
// rule) are kept for the published Teams artifact.
import { colomboClock, colomboClockS, driverStatus, statusText } from "@fleet/status";
import { latLng } from "../lib/format";
import type { DriverStatus, LiveDriver, ShareState, Signal } from "./types";

export const STALE_AFTER_MINUTES = 15;

/** A row of driver_latest, as Realtime delivers it. */
export interface LatestRow {
  employee_id: string;
  lat: number | null;
  lng: number | null;
  speed_mps: number | null;
  accuracy_m?: number | null;
  battery_pct: number | null;
  recorded_at: string | null;
  sharing: boolean;
  hb_at?: string | null;
  hb_location_on?: boolean | null;
  hb_permission?: string | null;
  hb_location_off_since?: string | null;
  hb_battery_pct?: number | null;
  hb_app_version?: string | null;
  hb_queued_points?: number | null;
  hb_rejected_points?: number | null;
  hb_data_available?: boolean | null;
  hb_app_state?: string | null;
  heading?: number | null;
}

export const minutesSince = (at: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60000));

export function ago(at: string, now: Date): string {
  const minutes = minutesSince(at, now);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} d`;
}

/** The old 15-minute rule, kept for the fields the Teams artifact reads. */
export function shareOf(sharing: boolean, recordedAt: string | null | undefined, now: Date): { state: ShareState; text: string } {
  if (!sharing) return { state: "not_sharing", text: "Not sharing" };
  if (!recordedAt) return { state: "stale", text: "Sharing · no location yet" };
  if (minutesSince(recordedAt, now) < STALE_AFTER_MINUTES) return { state: "sharing", text: `Live · ${ago(recordedAt, now)}` };
  return { state: "stale", text: `Last seen ${ago(recordedAt, now)}` };
}

const colomboDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-10-12 11:51" (Asia/Colombo), the format the tools use. */
export const colomboDateTime = (iso: string) => `${colomboDay.format(new Date(iso))} ${colomboClock(iso)}`;

/** The status fields of a card from its raw signal, with the shared rule. */
export function statusFields(signal: Signal, now: Date): Pick<LiveDriver, "status" | "status_text" | "status_since" | "last_position_at" | "last_position_time"> {
  const r = driverStatus({
    sharing: signal.sharing,
    pointAt: signal.point_at,
    heartbeatAt: signal.heartbeat_at,
    locationOn: signal.location_on,
    permission: signal.permission,
    locationOffSince: signal.location_off_since,
    rejectedPoints: signal.rejected_points,
  }, now);
  return {
    status: r.status,
    status_text: statusText(r, now),
    status_since: r.since ? colomboDateTime(r.since) : undefined,
    last_position_at: signal.point_at ? colomboClock(signal.point_at) : undefined,
    last_position_time: signal.point_at ? colomboClockS(signal.point_at) : undefined,
  };
}

/** The ISO instant behind a card's position: the signal, else the tool's Colombo text. */
export function recordedAtOf(d: LiveDriver): string | null {
  if (d.signal?.point_at) return d.signal.point_at;
  if (d.recorded_at) return d.recorded_at;
  if (d.updated && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d.updated)) return d.updated.replace(" ", "T") + ":00+05:30";
  return null;
}

export function positionOf(d: LiveDriver): { lat: number; lng: number } | null {
  if (typeof d.lat === "number" && typeof d.lng === "number") return { lat: d.lat, lng: d.lng };
  return latLng(d.links?.maps);
}

/** A Realtime row for one driver updates their card (position, heartbeat, status); other cards are untouched. */
export function applyLatest(drivers: LiveDriver[], row: LatestRow, now: Date): LiveDriver[] {
  if (!drivers.some((d) => d.employee_id === row.employee_id)) return drivers;
  return drivers.map((d) => {
    if (d.employee_id !== row.employee_id) return d;
    const signal: Signal = {
      sharing: row.sharing,
      point_at: row.recorded_at,
      heartbeat_at: row.hb_at ?? d.signal?.heartbeat_at ?? null,
      location_on: row.hb_location_on ?? d.signal?.location_on ?? null,
      permission: row.hb_permission ?? d.signal?.permission ?? null,
      location_off_since: row.hb_location_off_since ?? null,
      rejected_points: row.hb_rejected_points ?? d.signal?.rejected_points ?? null,
    };
    const share = shareOf(row.sharing, row.recorded_at, now);
    const hasPos = row.lat != null && row.lng != null;
    const status = statusFields(signal, now);
    return {
      ...d,
      ...status,
      signal,
      state: share.state,
      location: share.text,
      recorded_at: row.recorded_at,
      updated: row.recorded_at ? colomboDateTime(row.recorded_at) : d.updated,
      lat: hasPos ? row.lat! : d.lat,
      lng: hasPos ? row.lng! : d.lng,
      speed_kmh: status.status === "live" && row.speed_mps != null ? Math.round(row.speed_mps * 3.6) : undefined,
      battery_pct: row.hb_battery_pct ?? row.battery_pct ?? d.battery_pct,
      heartbeat_at: row.hb_at ? colomboDateTime(row.hb_at) : d.heartbeat_at,
      location_on: row.hb_location_on ?? d.location_on,
      permission: row.hb_permission ?? d.permission,
      app_version: row.hb_app_version ?? d.app_version,
      queued_points: row.hb_queued_points ?? d.queued_points,
      rejected_points: row.hb_rejected_points ?? d.rejected_points,
      data_available: row.hb_data_available ?? d.data_available,
      app_state: row.hb_app_state ?? d.app_state,
      heading: row.heading ?? d.heading,
      links: { ...d.links, maps: hasPos ? `https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}` : d.links?.maps },
    };
  });
}

/** Every 30 s the cards age: "Live · 2 min" becomes "Live · 3 min", live turns into no signal after 3 minutes. */
export function refreshStates(drivers: LiveDriver[], now: Date): LiveDriver[] {
  let changed = false;
  const next = drivers.map((d) => {
    if (!d.signal) return d;
    const status = statusFields(d.signal, now);
    const share = shareOf(d.signal.sharing, d.signal.point_at, now);
    if (status.status === d.status && status.status_text === d.status_text && share.text === d.location) return d;
    changed = true;
    return { ...d, ...status, state: share.state, location: share.text, speed_kmh: status.status === "live" ? d.speed_kmh : undefined };
  });
  return changed ? next : drivers;
}

/** The colour of a status: live blue, no signal amber, location off red, not sharing red. */
export const statusTone = (status: DriverStatus | undefined, fallback: ShareState = "not_sharing") => {
  const s = status ?? (fallback === "sharing" ? "live" : fallback === "stale" ? "no_signal" : "not_sharing");
  return (s === "live" ? "live" : s === "no_signal" ? "warn" : "bad") as "live" | "warn" | "bad";
};

/** The sentence for a card: the new status when the tool gave one, else the old text. */
export const statusLine = (d: Pick<LiveDriver, "status_text" | "location"> & { state?: ShareState }) =>
  d.status_text ?? (d.state === "not_sharing" ? "Not sharing" : d.location ?? "—");

/** Kept for older callers. */
export const stateTone = (state: ShareState) => statusTone(undefined, state);
