// The one rule for a driver's location status, used by the connector tools
// (live_drivers, fleet_overview), the office web app and the Fame Fleet
// artifact (the web app imports this very file through a Vite alias). No
// imports, so it runs unchanged in Deno, in the browser and in the tests.
//
//   live          the last GPS point is under 3 minutes old
//   location_off  the phone's last heartbeat (under 3 minutes old) says Location
//                 services are off or the location permission is not "always"
//   no_signal     sharing is on, but no point and no fresh heartbeat for over
//                 3 minutes (no coverage, phone off or app closed; points may
//                 still upload later), or a fresh heartbeat but no GPS fix
//   not_sharing   the driver turned sharing off
//
// A task in progress that has been location_off or no_signal for more than
// 10 minutes goes into the fleet overview's "needs attention".

export const LIVE_WITHIN_MINUTES = 3;
export const ATTENTION_AFTER_MINUTES = 10;

export type DriverStatus =
  | "live"
  | "location_off"
  | "no_signal"
  | "not_sharing";

export interface StatusInput {
  /** The driver has an open sharing period. */
  sharing: boolean;
  /** ISO time of the newest GPS point, if any. */
  pointAt: string | null;
  /** ISO time of the newest heartbeat, if any. */
  heartbeatAt: string | null;
  /** What that heartbeat said. */
  locationOn: boolean | null;
  permission: string | null;
  /** Since when the phone has reported Location off / permission missing. */
  locationOffSince: string | null;
  /** Points the server refused and the phone keeps (the last heartbeat's count); shown as "N points refused". */
  rejectedPoints?: number | null;
}

export interface StatusResult {
  status: DriverStatus;
  /** ISO time the state began, when known: the last point (live), the first "off" heartbeat, the last signal. */
  since: string | null;
  /** Minutes since the newest point or heartbeat, whichever is later; null when there was never one. */
  minutesSinceSignal: number | null;
  /** The heartbeat is fresh and says the permission is missing (not just the switch). */
  permissionProblem: boolean;
  /** Points the server refused, when the phone reported any. */
  rejectedPoints?: number;
}

export const minutesBetween = (fromIso: string, now: Date): number =>
  Math.max(
    0,
    Math.floor((now.getTime() - new Date(fromIso).getTime()) / 60000),
  );

const fresh = (iso: string | null, now: Date) =>
  iso !== null && minutesBetween(iso, now) < LIVE_WITHIN_MINUTES;
const later = (
  a: string | null,
  b: string | null,
) => (a && b ? (a > b ? a : b) : a ?? b);

export function driverStatus(i: StatusInput, now: Date): StatusResult {
  const newest = later(i.pointAt, i.heartbeatAt);
  const minutesSinceSignal = newest ? minutesBetween(newest, now) : null;
  const rejected = i.rejectedPoints != null && i.rejectedPoints > 0
    ? { rejectedPoints: i.rejectedPoints }
    : {};
  if (!i.sharing) {
    return {
      status: "not_sharing",
      since: null,
      minutesSinceSignal,
      permissionProblem: false,
      ...rejected,
    };
  }
  if (fresh(i.pointAt, now)) {
    return {
      status: "live",
      since: i.pointAt,
      minutesSinceSignal,
      permissionProblem: false,
      ...rejected,
    };
  }
  const heartbeatFresh = fresh(i.heartbeatAt, now);
  const locationOff = i.locationOn === false ||
    (i.permission !== null && i.permission !== "always");
  if (heartbeatFresh && locationOff) {
    return {
      status: "location_off",
      since: i.locationOffSince ?? i.heartbeatAt,
      minutesSinceSignal,
      permissionProblem: i.permission !== null && i.permission !== "always",
      ...rejected,
    };
  }
  // No fresh point: either nothing at all reaches the office, or the phone is alive but has no GPS fix.
  return {
    status: "no_signal",
    since: newest,
    minutesSinceSignal,
    permissionProblem: false,
    ...rejected,
  };
}

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
/** "HH:MM" in Asia/Colombo. */
export const colomboClock = (iso: string): string =>
  clock.format(new Date(iso));
const clockS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Colombo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
/** "HH:MM:SS" in Asia/Colombo: the position time beside a live marker. */
export const colomboClockS = (iso: string): string =>
  clockS.format(new Date(iso));

/** The age text the office reads: "2 min", "3 h", "2 d". */
export function ageText(iso: string, now: Date): string {
  const minutes = minutesBetween(iso, now);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} d`;
}

/** The sentence for a status, the same on every screen; "· N points refused" when the server refused points the phone keeps. */
export function statusText(r: StatusResult, now: Date): string {
  const refused = r.rejectedPoints
    ? ` · ${r.rejectedPoints} point${r.rejectedPoints === 1 ? "" : "s"} refused`
    : "";
  switch (r.status) {
    case "live":
      return `Live · ${r.since ? ageText(r.since, now) : "now"}${refused}`;
    case "location_off":
      return `${
        r.permissionProblem ? "Location permission removed" : "Location off"
      }${r.since ? ` since ${colomboClock(r.since)}` : ""}${refused}`;
    case "no_signal":
      return `No signal${
        r.since ? ` since ${colomboClock(r.since)}` : ""
      }${refused}`;
    case "not_sharing":
      return `Not sharing${refused}`;
  }
}

/** True when a running task has been without location for long enough to flag. */
export function needsAttention(
  r: StatusResult,
  taskStartedAt: string | null,
  now: Date,
): boolean {
  if (r.status !== "location_off" && r.status !== "no_signal") return false;
  const from = r.since ?? taskStartedAt;
  return from !== null && minutesBetween(from, now) >= ATTENTION_AFTER_MINUTES;
}
