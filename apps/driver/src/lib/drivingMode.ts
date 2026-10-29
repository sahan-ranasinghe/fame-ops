// Round 50 (docs/phase8-plan.md §37.4): Driving mode, an office person who drives a trip of their own with the driver's
// screens, in the same account (Uber's driver mode switch: one account, rider ↔ driver; Samsara / Motive's "can drive" on
// any user). The rules here are pure (no phone code), so scripts/test-driving-mode.ts checks them with made-up rows:
//   - who is an office driver: the employees row loaded as the driver state belongs to an office person (role not driver);
//   - who may enter: /me says can_drive true and the setting self_drive_mode is not off (absent = on), on the app only;
//   - which tasks the driver screens read: always the person's own (RLS lets an office person with view read every task),
//     and for an office person only the trips they drive themselves (driven_by self);
//   - sharing for an office person: only while a trip of theirs is in progress (it stops when the last one ends);
//   - what the driver screens leave out for them (the driver's day: duty, Start a trip, Change vehicle, Availability, the
//     forced phone and photo steps, the shift nudge, sign-out on Me);
//   - leaving Driving mode: the driver state stays loaded while a trip runs or something waits to be sent;
//   - the sign-in's Driver | Office switch and the push taps when both an office person and their driver state are here.

import type { Employee, TaskWithStops } from './types';

/** The part of an employees row these rules read. */
export type DriverRow = Pick<Employee, 'id' | 'role'>;

/** The part of GET /me these rules read (office/types.ts Me). */
export interface OfficeDriveFlags {
  can_drive?: boolean;
  self_drive_mode?: boolean;
}

/** The driver state loaded belongs to an office person (Driving mode), not to a driver. */
export function isOfficeDriver(me: Pick<Employee, 'role'> | null | undefined): boolean {
  return !!me && me.role !== 'driver';
}

/**
 * Driving mode is offered: /me says the person can drive (absent = no) and the setting self_drive_mode is on (absent = on),
 * and this is the app (a browser cannot track in the background: /m/ has its own driver-lite page).
 */
export function canEnterDriving(me: OfficeDriveFlags | null | undefined, native: boolean): boolean {
  return native && !!me && me.can_drive === true && me.self_drive_mode !== false;
}

/** What the task list asks the server for: the person's own tasks; for an office person, only the trips they drive. */
export interface TaskScope {
  employeeId: string;
  selfOnly: boolean;
}

export function taskScope(me: DriverRow): TaskScope {
  return { employeeId: me.id, selfOnly: isOfficeDriver(me) };
}

/** A task the driver screens may show for this person (the same rule again on the phone's copy: never another person's). */
export function isOwnTask(
  task: Pick<TaskWithStops, 'employee_id'> & { driven_by?: string | null; driven_in?: string | null },
  me: DriverRow,
): boolean {
  if (task.employee_id !== me.id) return false;
  // An office person: their self trips only, and never one under way on the web or from My trip (it finishes there).
  return !isOfficeDriver(me) || (task.driven_by === 'self' && (task.driven_in == null || task.driven_in === 'app'));
}

export function ownTasks<T extends Pick<TaskWithStops, 'employee_id'> & { driven_by?: string | null; driven_in?: string | null }>(
  tasks: readonly T[],
  me: DriverRow | null,
): T[] {
  return me ? tasks.filter((task) => isOwnTask(task, me)) : [];
}

/** A trip of theirs is under way (the location shares only then, for an office person). */
export function tripRunning(tasks: readonly Pick<TaskWithStops, 'status' | 'id'>[], except?: string): boolean {
  return tasks.some((task) => task.status === 'in_progress' && task.id !== except);
}

/**
 * Sharing stops for an office person when no trip of theirs runs any more: at Finish (the trip just finished is `except`,
 * in case the phone's copy is not written yet) and when a trip is cancelled. A driver keeps sharing until Finish work.
 */
export function shouldStopSharing(input: { officeDriver: boolean; sharing: boolean; tasks: readonly Pick<TaskWithStops, 'status' | 'id'>[]; except?: string }): boolean {
  return input.officeDriver && input.sharing && !tripRunning(input.tasks, input.except);
}

/** The driver's day the driver screens leave out for an office person (§37.4 "Off for them"); all shown for a driver. */
export interface DriverParts {
  /** Today's duty tiles (Start work / Finish work, the vehicle tile with Change) and the duty notices. */
  duty: boolean;
  /** Start a trip (driver-api /trips stays drivers only). */
  startTrip: boolean;
  /** Change vehicle (change_vehicle stays drivers only). */
  changeVehicle: boolean;
  /** Me → Availability. */
  availability: boolean;
  /** Me → Edit the profile (driver-api /profile stays drivers only; they edit it in Office mode's My profile). */
  profileEdit: boolean;
  /** The forced "Your phone number" and "Add your photo" steps before the tabs. */
  forcedSteps: boolean;
  /** "At work? Start work" (the shift nudge). */
  shiftNudge: boolean;
  /** Sign out on Me (an office person signs out from Office mode; Me has "Back to office" instead). */
  signOut: boolean;
  /** Can't do this task, Running late, Can't make it: they booked the trip themselves. */
  declineAndLate: boolean;
  /** The local "New task" notification from Realtime (no new-task push for a trip they booked). */
  newTaskNotice: boolean;
}

export function driverParts(officeDriver: boolean): DriverParts {
  const on = !officeDriver;
  return {
    duty: on,
    startTrip: on,
    changeVehicle: on,
    availability: on,
    profileEdit: on,
    forcedSteps: on,
    shiftNudge: on,
    signOut: on,
    declineAndLate: on,
    newTaskNotice: on,
  };
}

/**
 * Back to office: what becomes of the driver state. 'keep' while a trip of theirs runs (the location and the queue go on in
 * the background until it ends) or anything is still waiting to be sent (dropped once it is: never lost); else 'drop' (the
 * state goes, the sign-in stays: Office mode is the same account).
 */
export function leaveOutcome(input: { tasks: readonly Pick<TaskWithStops, 'status' | 'id'>[]; queue: { ops: number; points: number } }): 'keep' | 'drop' {
  if (tripRunning(input.tasks)) return 'keep';
  return input.queue.ops > 0 || input.queue.points > 0 ? 'keep' : 'drop';
}

/** The driver screens are in front: always for a driver; for an office person only after Start driving (until Back to office). */
export function drivingShown(officeDriver: boolean, drivingView: boolean): boolean {
  return !officeDriver || drivingView;
}

/** The sign-in's Driver | Office switch: none in a browser, and none once this phone's last office account can drive. */
export function showSideSwitch(input: { web: boolean; lastOfficeCanDrive: boolean }): boolean {
  return !input.web && !input.lastOfficeCanDrive;
}

/**
 * A tapped notification, with an office person and (maybe) their driver state on the phone: an office notification
 * (notify-office, kind office) opens its Office mode screen; a task's (push-task, every other kind) the driver screen,
 * entering Driving mode first when only the office side is loaded and the person can drive. null = nothing to open.
 */
export type TapSide = 'office' | 'driver' | 'enter_driving' | null;

export function tapSide(data: { kind?: string; taskId?: string }, state: { driver: boolean; office: boolean; canDrive: boolean }): TapSide {
  if (data.kind === 'office') return state.office ? 'office' : null;
  if (state.driver) return 'driver';
  if (state.office && state.canDrive && data.taskId) return 'enter_driving';
  return null;
}

/**
 * Home's "You have a trip to drive · Start driving": a trip of theirs under way, else the first one today still to start.
 * `today` is the Colombo date (YYYY-MM-DD); `dateOf` gives a task's Colombo date.
 */
export function tripToDrive<T extends Pick<TaskWithStops, 'status' | 'start_at' | 'employee_id'> & { driven_by?: string | null; id: string }>(
  tasks: readonly T[],
  me: DriverRow,
  today: string,
  dateOf: (iso: string) => string,
): T | null {
  const own = tasks.filter((task) => task.employee_id === me.id && task.driven_by === 'self');
  const running = own.find((task) => task.status === 'in_progress');
  if (running) return running;
  return own.filter((task) => task.status === 'assigned' && dateOf(task.start_at) === today).sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null;
}
