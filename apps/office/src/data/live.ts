// The live map's rules on the client: the sharing state of a driver from the
// time of their last position (the server's rule, fleet.ts: live under 15
// minutes, stale after, not sharing when off), and how a Realtime row from
// driver_latest updates a card from live_drivers.
import { latLng } from "../lib/format";
import type { LiveDriver, ShareState } from "./types";

export const STALE_AFTER_MINUTES = 15;

/** A row of driver_latest, as Realtime delivers it. */
export interface LatestRow {
  employee_id: string;
  lat: number | null;
  lng: number | null;
  speed_mps: number | null;
  battery_pct: number | null;
  recorded_at: string | null;
  sharing: boolean;
}

export const minutesSince = (at: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60000));

export function ago(at: string, now: Date): string {
  const minutes = minutesSince(at, now);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} d`;
}

export function shareOf(sharing: boolean, recordedAt: string | null | undefined, now: Date): { state: ShareState; text: string } {
  if (!sharing) return { state: "not_sharing", text: "Not sharing" };
  if (!recordedAt) return { state: "stale", text: "Sharing · no location yet" };
  if (minutesSince(recordedAt, now) < STALE_AFTER_MINUTES) return { state: "sharing", text: `Live · ${ago(recordedAt, now)}` };
  return { state: "stale", text: `Last seen ${ago(recordedAt, now)}` };
}

const colomboClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hour12: false });
const colomboDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-10-12 11:51" (Asia/Colombo), the format live_drivers uses for `updated`. */
export const colomboDateTime = (iso: string) => `${colomboDay.format(new Date(iso))} ${colomboClock.format(new Date(iso))}`;

/** The ISO instant behind a card: the Realtime row's time, else the tool's Colombo text. */
export function recordedAtOf(d: LiveDriver): string | null {
  if (d.recorded_at) return d.recorded_at;
  if (d.updated && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d.updated)) return d.updated.replace(" ", "T") + ":00+05:30";
  return null;
}

export function positionOf(d: LiveDriver): { lat: number; lng: number } | null {
  if (typeof d.lat === "number" && typeof d.lng === "number") return { lat: d.lat, lng: d.lng };
  return latLng(d.links?.maps);
}

/** A Realtime row for one driver updates their card; other cards are untouched. A driver not on the list waits for the next fetch. */
export function applyLatest(drivers: LiveDriver[], row: LatestRow, now: Date): LiveDriver[] {
  if (!drivers.some((d) => d.employee_id === row.employee_id)) return drivers;
  return drivers.map((d) => {
    if (d.employee_id !== row.employee_id) return d;
    const share = shareOf(row.sharing, row.recorded_at, now);
    const hasPos = row.lat != null && row.lng != null;
    return {
      ...d,
      state: share.state,
      location: share.text,
      recorded_at: row.recorded_at,
      updated: row.recorded_at ? colomboDateTime(row.recorded_at) : d.updated,
      lat: hasPos ? row.lat! : d.lat,
      lng: hasPos ? row.lng! : d.lng,
      speed_kmh: share.state === "sharing" && row.speed_mps != null ? Math.round(row.speed_mps * 3.6) : undefined,
      battery_pct: row.battery_pct ?? d.battery_pct,
      links: { ...d.links, maps: hasPos ? `https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}` : d.links?.maps },
    };
  });
}

/** Every 30 s the states age: a driver "Live · 2 min" becomes "Live · 3 min", then stale at 15. */
export function refreshStates(drivers: LiveDriver[], now: Date): LiveDriver[] {
  let changed = false;
  const next = drivers.map((d) => {
    if (d.state === "not_sharing") return d;
    const at = recordedAtOf(d);
    if (!at) return d;
    const share = shareOf(true, at, now);
    if (share.state === d.state && share.text === d.location) return d;
    changed = true;
    return { ...d, state: share.state, location: share.text, speed_kmh: share.state === "sharing" ? d.speed_kmh : undefined };
  });
  return changed ? next : drivers;
}

export const stateTone = (state: ShareState) => (state === "sharing" ? "live" : state === "stale" ? "warn" : "bad") as "live" | "warn" | "bad";
