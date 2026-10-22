// The live map's rules on the client, all from the one shared status rule
// (supabase/functions/_shared/fleet/status.ts, imported as @fleet/status):
// how a Realtime row from driver_latest updates a driver card, and how the
// cards age as the clock ticks. The older state/location fields (15 min
// rule) are kept for the published Teams artifact. Phase 7: every active
// driver is listed with a duty (on a task, on duty, off duty); the signal
// states only matter for drivers on duty.
import { colomboClock, colomboClockS, driverStatus, statusText } from "@fleet/status";
import { hhmm, joinDots, latLng, type Tone } from "../lib/format";
import type { DriverStatus, DutyState, LiveDriver, ShareState, Signal } from "./types";
import { whenText } from "@fleet/durations";

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


/** The old 15-minute rule, kept for the fields the Teams artifact reads. */
export function shareOf(sharing: boolean, recordedAt: string | null | undefined, now: Date): { state: ShareState; text: string } {
  if (!sharing) return { state: "not_sharing", text: "Off duty" };
  if (!recordedAt) return { state: "stale", text: "Sharing · no location yet" };
  if (minutesSince(recordedAt, now) < STALE_AFTER_MINUTES) return { state: "sharing", text: `Live · ${whenText(recordedAt, now)}` };
  return { state: "stale", text: `Last seen ${whenText(recordedAt, now)}` };
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
      ...dutyAfter(d, row.sharing),
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

/** Every 30 s the cards age: "Live · 2 min ago" becomes "Live · 3 min ago", live turns into no signal after 3 minutes. */
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
  d.status_text ?? (d.state === "not_sharing" ? "Off duty" : d.location ?? "—");

// ---- Phase 7: duty ----

/** The card's duty; an answer from before Phase 7 has none: a task = on a task, sharing = on duty, else off duty. */
export function dutyOf(d: Pick<LiveDriver, "duty" | "task" | "state" | "signal">): DutyState {
  if (d.duty) return d.duty;
  if (d.task) return "on_task";
  return (d.signal ? d.signal.sharing : d.state !== "not_sharing") ? "on_duty" : "off_duty";
}

/**
 * A Realtime row moves the duty on at once: sharing off = off duty, sharing on = on duty
 * (a card on a task keeps it). The since times, how it ended and the vehicle come with the
 * tool's next answer (clocking out gives the vehicle up, so the old one is not shown meanwhile).
 */
function dutyAfter(d: LiveDriver, sharing: boolean): Partial<LiveDriver> {
  if (!d.duty || d.duty === "on_task") return {};
  if (!sharing && d.duty === "on_duty") {
    return { duty: "off_duty", duty_text: "Off duty", duty_since: undefined, on_duty_since: undefined, off_duty_how: undefined, vehicle: undefined, vehicle_since: undefined };
  }
  if (sharing && d.duty === "off_duty") return { duty: "on_duty", duty_text: "On duty", duty_since: undefined, off_duty_how: undefined };
  return {};
}

/**
 * A Realtime row saying a sharing driver stopped (clocked out by the phone, the office or the cut-off): the card goes off
 * duty at once, but how it ended and since when come only with live_drivers, so the screen asks for it at once rather
 * than at the next 30 s poll. Only the change asks: later rows of a driver already off are left to the poll.
 */
export function stoppedSharing(drivers: LiveDriver[], row: LatestRow): boolean {
  if (row.sharing) return false;
  const d = drivers.find((x) => x.employee_id === row.employee_id);
  if (!d) return false;
  return d.signal ? d.signal.sharing : dutyOf(d) !== "off_duty";
}

const DUTY_TEXT: Record<DutyState, string> ={ on_task: "On a task", on_duty: "On duty", off_duty: "Off duty" };

/** The duty chip: "On a task · since 08:12", "On duty · since 08:02", "Off duty · since 17:40 · auto at the cut-off". */
export function dutyLine(d: Pick<LiveDriver, "duty" | "duty_text" | "duty_since" | "off_duty_how" | "task" | "state" | "signal">): string {
  const duty = dutyOf(d);
  return joinDots([d.duty_text ?? DUTY_TEXT[duty], d.duty_since && `since ${d.duty_since}`, duty === "off_duty" && d.off_duty_how]);
}

/** The dot and the pill of a card: the signal's colour while on duty, grey off duty (off duty is not a problem). */
export const liveTone = (d: LiveDriver): Tone => (dutyOf(d) === "off_duty" ? "muted" : statusTone(d.status, d.state));

/** No signal or Location off while on duty (the Problems chip). */
export function hasProblem(d: LiveDriver): boolean {
  const s = d.status ?? (d.state === "sharing" ? "live" : d.state === "stale" ? "no_signal" : "not_sharing");
  return dutyOf(d) !== "off_duty" && (s === "no_signal" || s === "location_off");
}

export type LiveFilter = "all" | "on_task" | "on_duty" | "off_duty" | "problems";
export const LIVE_FILTERS: [LiveFilter, string][] = [["all", "All"], ["on_task", "On a task"], ["on_duty", "On duty"], ["off_duty", "Off duty"], ["problems", "Problems"]];

/** A chip matches the cards' own duty chip: On duty is clocked in without a task, so the three duties add up to All. */
export const inFilter = (d: LiveDriver, f: LiveFilter) => f === "all" || (f === "problems" ? hasProblem(d) : dutyOf(d) === f);

/** Counted on the cards (not the answer's counts), so a Realtime change moves a driver between the chips at once. */
export function filterCounts(drivers: LiveDriver[]): Record<LiveFilter, number> {
  const out: Record<LiveFilter, number> = { all: 0, on_task: 0, on_duty: 0, off_duty: 0, problems: 0 };
  for (const d of drivers) for (const [f] of LIVE_FILTERS) if (inFilter(d, f)) out[f] += 1;
  return out;
}

/** Only drivers on duty or on a task are drawn on the map; off duty is the list only. */
export const onMap = (d: LiveDriver) => dutyOf(d) !== "off_duty";

/** Clock out and Move to vehicle: only for a driver on duty without a task (the server checks again). */
export const canClockOut = (d: LiveDriver) => dutyOf(d) === "on_duty";
/** Move to vehicle: on duty; on a task it is a swap during the task (Phase 7, §2 addition). */
export const canMoveVehicle = (d: LiveDriver) => dutyOf(d) === "on_duty" || dutyOf(d) === "on_task";

/** clock_out_driver's answer. */
export interface ClockOutResult {
  clocked_out: string | false;
  at?: string;
  reason?: string;
  note?: string;
}

/** The line after Clock out: "Kamal Perera is off duty since 17:40. The driver's phone gets a push…", or the tool's note. */
export function clockOutLine(r: ClockOutResult): string {
  if (r.clocked_out === false) return r.note ?? "Already off duty.";
  return `${r.clocked_out} is off duty${r.at ? ` since ${hhmm(r.at)}` : ""}.${r.note ? ` ${r.note}` : ""}`;
}

/** Kept for older callers. */
export const stateTone = (state: ShareState) => statusTone(undefined, state);
