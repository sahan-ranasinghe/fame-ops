// Hotfix O2-H2, Part 2: the office notifications in groups (Instagram's and WhatsApp's settings: one row per group with a
// short summary, the group's switches on its own screen; GitHub's and Gmail's settings pages on the site). ONE definition,
// copied byte for byte to the app (apps/driver/src/office/notificationGroups.ts) and the site
// (apps/office/src/screens/settings/notificationGroups.ts); the app's test-notif checks that the two files are identical,
// that every event of the server's EVENTS (supabase/functions/_shared/fleet/notifications.ts) is in exactly one group
// with the same `needs`, and that en.json's office.notif.* words are these words. The site shows these English words; the
// app shows en.json / si.json (office.notif.ev.<event with _ for .>.title / .text, office.notif.group.<key>.title / .sub).
//
// Who sees what: my_notification_settings answers only the events this person's permissions can bring (the server's
// relevantEvents, `needs` below); the screens show only those, and also check `needs` here. An event the server answers
// that no group knows goes to "Other", never left out. Hidden events keep their saved value: nothing here writes them.
//
// Pause all (Instagram): the server has no pause flag. Pause turns every shown event off and keeps what each was (the
// pause record); Resume puts them back. "Paused" = every shown event is off.

export type Permission = "view" | "request" | "approve" | "assign_tasks" | "vehicles" | "issues" | "users";

export type NotifGroupKey = "requests" | "tasks" | "drivers" | "issues" | "vehicles" | "mine";

export interface NotifEventDef {
  event: string;
  title: string;
  /** One line, optional. */
  text?: string;
  /** Who can get it (any one of these); empty = every office person (the server's EVENTS[].needs). */
  needs: readonly Permission[];
}

export interface NotifGroupDef {
  key: NotifGroupKey;
  title: string;
  /** A second line under the group's title, optional. */
  sub?: string;
  events: readonly NotifEventDef[];
}

export const NOTIF_GROUPS: readonly NotifGroupDef[] = [
  {
    key: "requests",
    title: "Requests and approvals",
    events: [
      { event: "request.created", title: "New vehicle request", text: "Waits for your decision", needs: ["approve"] },
      { event: "request.changed", title: "Approved request changed", text: "Needs your approval again", needs: ["approve"] },
      {
        event: "request.not_decided",
        title: "Not decided, leaves in 30 min",
        text: "A request or a proposed task",
        needs: ["approve", "request", "assign_tasks"],
      },
      { event: "request.late", title: "Leave-by passed, not decided", text: "It waits until someone decides", needs: ["approve"] },
    ],
  },
  {
    key: "tasks",
    title: "Tasks and drivers",
    events: [
      { event: "task.declined", title: "Driver can't do a task", text: "It needs another driver", needs: ["approve", "assign_tasks", "request"] },
      { event: "task.not_accepted", title: "Task not accepted in time", text: "It needs a driver", needs: ["approve", "assign_tasks", "request"] },
      { event: "task.vehicle_needed", title: "Driver needs another vehicle", text: "After a breakdown or an accident", needs: ["approve", "assign_tasks"] },
      { event: "task.running_late", title: "Driver running late", text: "10, 15, 30 minutes or more", needs: ["approve", "assign_tasks"] },
      { event: "task.stop_skipped", title: "Driver skips a stop", text: "With the reason", needs: ["assign_tasks"] },
    ],
  },
  {
    key: "drivers",
    title: "Driver questions and trips",
    events: [
      { event: "ask.answered", title: "Driver answers your question", needs: ["approve", "assign_tasks"] },
      { event: "trip.personal", title: "Driver starts a personal trip", text: "Where to, the vehicle and the time", needs: ["approve", "assign_tasks"] },
    ],
  },
  {
    key: "issues",
    title: "Issues",
    events: [
      { event: "issue.opened", title: "Critical issue", text: "A breakdown, an accident, an expired document", needs: ["issues"] },
      { event: "issue.assigned", title: "Issue given to you", needs: ["issues"] },
      { event: "vehicle.check_urgent", title: "Vehicle check: breakdown, accident", text: "Found before setting off", needs: ["issues"] },
      { event: "vehicle.check_problem", title: "Vehicle check: a problem", text: "Damage, a tyre, a warning light", needs: ["issues"] },
    ],
  },
  {
    key: "vehicles",
    title: "Vehicles and bookings",
    events: [
      { event: "vehicle.booked", title: "Your vehicle is booked", text: "A vehicle you look after", needs: [] },
      { event: "vehicle.booking_cancelled", title: "Your vehicle's booking cancelled", text: "A vehicle you look after", needs: [] },
      { event: "booking.changed", title: "Booking changed by the office", text: "The time, vehicle or driver", needs: [] },
    ],
  },
  {
    key: "mine",
    title: "My trips",
    sub: "Things I asked for",
    events: [
      { event: "request.decided", title: "Request decided", text: "Approved or declined", needs: ["request", "assign_tasks"] },
      { event: "request.redecided", title: "Changed request decided", text: "Kept, changed or declined", needs: ["request"] },
      { event: "request.on_the_way", title: "Driver on the way", needs: ["request"] },
      { event: "request.running_late", title: "Driver running late", needs: ["request"] },
      { event: "request.arrived", title: "Driver arrived", text: "At the first pickup", needs: ["request", "assign_tasks"] },
      { event: "request.stop_arrived", title: "Driver reached a stop", text: "Each later stop, with how late or early", needs: ["request", "assign_tasks"] },
      { event: "request.driver_changed", title: "Driver changed", needs: ["request", "assign_tasks"] },
      { event: "request.cancelled", title: "Trip cancelled", text: "By the office", needs: ["request", "assign_tasks"] },
      { event: "trip.finish_ask", title: "Trip finished? Enter the odometer", text: "A trip you drive or booked for someone else", needs: ["request", "assign_tasks"] },
    ],
  },
];

/** The group of events the server answers that no group above knows (shown with the server's own words). */
export const OTHER_GROUP = { key: "other", title: "Other" } as const;

/** The site's words for the summaries (the app has the same in en.json / si.json, office.notif.*). */
export const NOTIF_TEXT = {
  title: "Notifications",
  pause: "Pause all notifications",
  pauseText: "Nothing reaches you until you turn this off",
  pausedNote: "Paused. Turn off Pause all to change these.",
  allOn: "All on",
  allOff: "Off",
  nOfM: "{on} of {total} on",
  stateOn: "On",
  statePaused: "Paused",
  stateSomeOff: "Some off",
  stateNone: "None for you",
  notSaved: "Not saved. Check the connection.",
  tryAgain: "Try again",
  tellMe: "Tell me about",
  noEvents: "Your permissions bring no notifications.",
} as const;

/** The i18n id of an event ("request.created" → "request_created"). */
export const eventId = (event: string): string => event.replace(/\./g, "_");

const DEF_BY_EVENT: ReadonlyMap<string, { def: NotifEventDef; group: NotifGroupKey }> = new Map(
  NOTIF_GROUPS.flatMap((g) => g.events.map((def) => [def.event, { def, group: g.key }] as const)),
);

/** The definition of an event, or null for one no group knows. */
export const eventDef = (event: string): NotifEventDef | null => DEF_BY_EVENT.get(event)?.def ?? null;

/** What my_notification_settings answers per event (the fields the screens read). */
export interface ServerEvent {
  event: string;
  label: string;
  text: string;
  enabled: boolean;
}

/** May this person get this event? The server's rule (any one of `needs`; none = everyone). An unknown event: the server decided. */
export function canGet(event: string, permissions: readonly string[]): boolean {
  const def = eventDef(event);
  if (!def) return true;
  return def.needs.length === 0 || def.needs.some((p) => permissions.includes(p));
}

/** The events to show: those the server answered and the person's permissions allow. */
export function visibleEvents<E extends ServerEvent>(events: readonly E[], permissions: readonly string[]): E[] {
  return events.filter((e) => canGet(e.event, permissions));
}

export interface ShownGroup<E extends ServerEvent = ServerEvent> {
  key: NotifGroupKey | typeof OTHER_GROUP.key;
  events: E[];
  on: number;
  total: number;
}

/** The groups with something to show, in order; each event in the group's order, unknown ones last under Other. */
export function groupsFor<E extends ServerEvent>(events: readonly E[], permissions: readonly string[]): ShownGroup<E>[] {
  const shown = visibleEvents(events, permissions);
  const byEvent = new Map(shown.map((e) => [e.event, e]));
  const out: ShownGroup<E>[] = [];
  for (const g of NOTIF_GROUPS) {
    const list = g.events.flatMap((d) => {
      const e = byEvent.get(d.event);
      return e ? [e] : [];
    });
    if (list.length > 0) out.push({ key: g.key, events: list, on: list.filter((e) => e.enabled).length, total: list.length });
  }
  const other = shown.filter((e) => !DEF_BY_EVENT.has(e.event));
  if (other.length > 0) out.push({ key: OTHER_GROUP.key, events: other, on: other.filter((e) => e.enabled).length, total: other.length });
  return out;
}

export type GroupSummary = { kind: "all_on" } | { kind: "off" } | { kind: "some"; on: number; total: number };

/** A group's one line: All on, Off, or "4 of 5 on". */
export function groupSummary(on: number, total: number): GroupSummary {
  if (on >= total) return { kind: "all_on" };
  if (on === 0) return { kind: "off" };
  return { kind: "some", on, total };
}

/** The site's words for a group's summary. */
export function groupSummaryText(on: number, total: number): string {
  const s = groupSummary(on, total);
  if (s.kind === "all_on") return NOTIF_TEXT.allOn;
  if (s.kind === "off") return NOTIF_TEXT.allOff;
  return NOTIF_TEXT.nOfM.replace("{on}", String(s.on)).replace("{total}", String(s.total));
}

export type NotifState = "on" | "paused" | "some_off" | "none";

/** The Notifications row's one line: On (all on), Paused (all off), Some off, or none for this person. */
export function notifState(events: readonly ServerEvent[], permissions: readonly string[]): NotifState {
  const shown = visibleEvents(events, permissions);
  if (shown.length === 0) return "none";
  const on = shown.filter((e) => e.enabled).length;
  if (on === 0) return "paused";
  return on === shown.length ? "on" : "some_off";
}

export function notifStateText(state: NotifState): string {
  return { on: NOTIF_TEXT.stateOn, paused: NOTIF_TEXT.statePaused, some_off: NOTIF_TEXT.stateSomeOff, none: NOTIF_TEXT.stateNone }[state];
}

/** What Pause all keeps: when, and each shown event's value before the pause. */
export interface PauseRecord {
  at: string;
  saved: Record<string, boolean>;
}

/** Pause all: the record to keep, and the events to switch off (only those on now). */
export function pauseChanges(
  events: readonly ServerEvent[],
  permissions: readonly string[],
  at: string,
): { record: PauseRecord; changes: Record<string, boolean> } {
  const shown = visibleEvents(events, permissions);
  const saved: Record<string, boolean> = {};
  const changes: Record<string, boolean> = {};
  for (const e of shown) {
    saved[e.event] = e.enabled;
    if (e.enabled) changes[e.event] = false;
  }
  return { record: { at, saved }, changes };
}

/**
 * Resume: each shown event back to what it was before the pause (an event with no record, or no record at all: on).
 * When the record would leave everything off (it was all off before), everything goes on: Resume never stays paused.
 * Only the events that change are named.
 */
export function resumeChanges(record: PauseRecord | null, events: readonly ServerEvent[], permissions: readonly string[]): Record<string, boolean> {
  const shown = visibleEvents(events, permissions);
  const target = new Map(shown.map((e) => [e.event, record?.saved[e.event] ?? true]));
  if (shown.length > 0 && [...target.values()].every((v) => !v)) for (const k of target.keys()) target.set(k, true);
  const changes: Record<string, boolean> = {};
  for (const e of shown) {
    const want = target.get(e.event) ?? true;
    if (want !== e.enabled) changes[e.event] = want;
  }
  return changes;
}

/** The events with `changes` applied (the optimistic flip, and putting it back). */
export function applyChanges<E extends ServerEvent>(events: readonly E[], changes: Record<string, boolean>): E[] {
  return events.map((e) => (e.event in changes ? { ...e, enabled: changes[e.event] } : e));
}

/** The opposite of `changes` against `before` (what a failed save puts back). */
export function undoChanges(before: readonly ServerEvent[], changes: Record<string, boolean>): Record<string, boolean> {
  const back: Record<string, boolean> = {};
  for (const e of before) if (e.event in changes) back[e.event] = e.enabled;
  return back;
}
