// push-task's kinds and the Android channel each push goes on (split out of index.ts in Part 6 so channel_test.ts can
// run the rule without starting the server).

export type TaskKind = "new" | "changed" | "cancelled" | "removed" | "leave_30" | "leave_now" | "accept_reminder" | "reopened";
/** About the driver's day, with no task (Phase 7); Part 3b: ask = a question from the office (ask_drivers). */
export type DayKind = "vehicle_taken" | "vehicle_moved" | "duty_auto_out" | "duty_office_out" | "ask";
export type Kind = TaskKind | DayKind;
export const TASK_KINDS: TaskKind[] = ["new", "changed", "cancelled", "removed", "leave_30", "leave_now", "accept_reminder", "reopened"];
export const DAY_KINDS: DayKind[] = ["vehicle_taken", "vehicle_moved", "duty_auto_out", "duty_office_out", "ask"];
export const CHANNEL: Record<Kind, string> = {
  new: "tasks-new",
  changed: "tasks-changed",
  cancelled: "tasks-changed",
  removed: "general",
  leave_30: "tasks-changed",
  leave_now: "tasks-new",
  accept_reminder: "tasks-new",
  reopened: "tasks-changed",
  vehicle_taken: "general",
  vehicle_moved: "general",
  duty_auto_out: "general",
  duty_office_out: "general",
  // Part 3b (H3): the "driver-asks" channel on a phone that made it (below); else the loud new-task channel.
  ask: "tasks-new",
};

/** Part 3b (H3): the office's questions have their own channel (maximum importance, its own vibration). */
export const ASKS_CHANNEL = "driver-asks";

/**
 * Part 6 (the 1.3.0 build's own sounds): a new task rings for 30 s on "task-ring", a change or cancellation has its own
 * tone on "task-updates", a question its own on "office-asks". A phone gets them once its app has made them (it registers
 * them with its token); before that, the channels above.
 */
export const RING_CHANNEL = "task-ring";
export const UPDATES_CHANNEL = "task-updates";
export const OFFICE_ASKS_CHANNEL = "office-asks";
/**
 * Part 6, after the checkpoint (Sahan, 19 October): the reminders (leave in 30 min, leave now, accept or decline) get a
 * 1.3.0 channel of their own, so a 1.3.0 phone needs none of the 1.2.0 channels for tasks and deletes them once the
 * server has its new ones (the app's lib/push.ts): one "New tasks" in the phone's settings, not two.
 */
export const REMINDERS_CHANNEL = "task-reminders";
const ON_UPDATES: ReadonlySet<Kind> = new Set<Kind>(["changed", "cancelled", "removed", "reopened"]);
const ON_REMINDERS: ReadonlySet<Kind> = new Set<Kind>(["leave_30", "leave_now", "accept_reminder"]);

/** The channel a push of this kind goes on, for a phone with these channels. Pure (channel_test.ts). */
export function channelFor(kind: Kind, channels: readonly string[]): string {
  const has = (c: string) => channels.includes(c);
  if (kind === "new" && has(RING_CHANNEL)) return RING_CHANNEL;
  if (ON_UPDATES.has(kind) && has(UPDATES_CHANNEL)) return UPDATES_CHANNEL;
  if (ON_REMINDERS.has(kind) && has(REMINDERS_CHANNEL)) return REMINDERS_CHANNEL;
  if (kind === "ask") return has(OFFICE_ASKS_CHANNEL) ? OFFICE_ASKS_CHANNEL : has(ASKS_CHANNEL) ? ASKS_CHANNEL : CHANNEL.ask;
  if (ON_NEW_TASKS.has(kind) && has(NEW_TASKS_CHANNEL)) return NEW_TASKS_CHANNEL;
  return CHANNEL[kind];
}

/**
 * Hotfix 2 (B): new, changed, cancelled and reassigned tasks go to the "New tasks" channel (maximum importance, a long
 * vibration) on a phone whose app has made it (device_tokens.channels); an older phone keeps the channels above.
 */
export const NEW_TASKS_CHANNEL = "new-tasks";
export const ON_NEW_TASKS: ReadonlySet<Kind> = new Set<Kind>(["new", "changed", "cancelled", "removed"]);
