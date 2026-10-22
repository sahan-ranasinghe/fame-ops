// Round 4–7, item 12: the sample state the design pages draw the driver's real screens with (src/design/DriverToday.tsx,
// DriverTask.tsx; the mockup comparison's screenshots, the e2e build only). No phone, no network: every action does
// nothing. The names, places and plates are samples in the style of the tests (never seeded anywhere). A .ts file, so
// scripts/make-web-routes.mjs makes no page of it.

import { translate, translateList, type Vars } from '@/i18n';
import type { Here } from '@/components/ArrivalButton';
import { DEFAULT_DRIVER_SETTINGS } from '@/lib/api';
import type { TaskContacts } from '@/lib/contacts';
import { NO_CHANGES } from '@/lib/taskPreview';
import type { Employee, Language, TaskStop, TaskWithStops, Vehicle } from '@/lib/types';
import type { VehicleCheck } from '@/lib/vehicleCheck';
import type { AppValue } from '@/state/app';

const MIN = 60_000;

/** Today's page: accepted (the mockup), new (not accepted yet), check (the vehicle check needed), off (off duty), empty. */
export type TodayState = 'accepted' | 'new' | 'check' | 'off' | 'empty';
/** The running task: near (within 300 m of the stop: the arrive slide) or far (the distance and the override). */
export type TaskState = 'near' | 'far';

export function todayState(value: unknown): TodayState {
  return value === 'new' || value === 'check' || value === 'off' || value === 'empty' ? value : 'accepted';
}

export function taskState(value: unknown): TaskState {
  return value === 'far' ? 'far' : 'near';
}

export function designLanguage(value: unknown): Language {
  return value === 'si' ? 'si' : 'en';
}

const iso = (ms: number) => new Date(ms).toISOString();

export const SAMPLE_VEHICLE: Vehicle = {
  id: 'v-sample-1', reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', vehicle_type: 'van', seats: 14, current_odometer_km: 45210,
  monthly_km_allowance: 3000, in_garage: false, active: true, photo_path: null, photo_thumb_path: null, fuel_type: 'diesel', fuel_grade: 'auto_diesel',
};

const ME = { id: 'e-sample-1', name: 'Kamal Perera', code: 'D-01', language: 'en' } as unknown as Employee;

function stop(over: Partial<TaskStop> & Pick<TaskStop, 'id' | 'seq' | 'place_name'>): TaskStop {
  return {
    task_id: 't-sample-1', type: 'visit', status: 'pending', lat: null, lng: null, address: null, arrive_by: null, planned_arrive_at: null,
    planned_depart_at: null, arrived_at: null, done_at: null, is_start: false, google_place_id: null, note: null, dwell_min: null, what: null,
    ...over,
  } as TaskStop;
}

/** The next task: leaves from head office with passengers, a site visit with a deadline, back at base. */
function sampleTask(now: number, running: boolean): TaskWithStops {
  const leave = running ? now - 95 * MIN : now + 25 * MIN;
  const arrive = leave + 150 * MIN;
  return {
    id: 't-sample-1', title: 'Team drop · Kurunegala site', label: 'Mobitel MS', kind: 'dispatch', purpose: 'company', status: running ? 'in_progress' : 'assigned',
    employee_id: ME.id, vehicle_id: SAMPLE_VEHICLE.id, vehicle_mode: 'specific', start_at: iso(leave), leave_by: iso(leave), started_at: running ? iso(leave + 5 * MIN) : null,
    accepted_at: iso(now - 60 * MIN), seen_at: iso(now - 70 * MIN), passengers: 3, contact_name: 'Ashan W.', contact_phone: '+94771234567',
    return_to_base: true, start_name: 'Head office, Colombo 05', start_lat: 6.8935, start_lng: 79.8573,
    plan_json: {
      total_km: 197, total_drive_min: 290, ends_at: iso(arrive + 218 * MIN),
      legs: [{ from_seq: 1, to_seq: 2, km: 98, line: null, source: 'estimate' }, { from_seq: 2, to_seq: 3, km: 31, line: null, source: 'estimate' }, { from_seq: 3, to_seq: -1, km: 68, line: null, source: 'estimate' }],
    },
    task_stops: [
      stop({ id: 's-sample-1', seq: 1, type: 'pickup', is_start: true, place_name: 'Head office, Colombo 05', lat: 6.8935, lng: 79.8573, planned_depart_at: iso(leave), status: running ? 'done' : 'pending', arrived_at: running ? iso(leave) : null, done_at: running ? iso(leave + 5 * MIN) : null }),
      stop({ id: 's-sample-2', seq: 2, type: 'drop', place_name: 'Kurunegala site', lat: 7.4867, lng: 80.3647, planned_arrive_at: iso(arrive), arrive_by: iso(arrive + 15 * MIN), planned_depart_at: iso(arrive + 30 * MIN) }),
      stop({ id: 's-sample-3', seq: 3, type: 'visit', place_name: 'Kandy depot', lat: 7.2906, lng: 80.6337, planned_arrive_at: iso(arrive + 90 * MIN), planned_depart_at: iso(arrive + 110 * MIN) }),
    ],
    task_passengers: [],
  } as unknown as TaskWithStops;
}

function laterTasks(now: number): TaskWithStops[] {
  const one = (id: string, inMin: number, title: string, pax: number, km: number, accepted: boolean) => ({
    id, title, label: null, kind: 'dispatch', purpose: 'company', status: 'assigned', employee_id: ME.id, vehicle_id: SAMPLE_VEHICLE.id, vehicle_mode: 'specific',
    start_at: iso(now + inMin * MIN), leave_by: iso(now + inMin * MIN), accepted_at: accepted ? iso(now - 30 * MIN) : null, seen_at: iso(now - 30 * MIN),
    passengers: pax, return_to_base: false, plan_json: { total_km: km }, task_stops: [stop({ id: `${id}-s1`, seq: 1, task_id: id, place_name: 'Head office, Colombo 05' })],
  }) as unknown as TaskWithStops;
  return [one('t-sample-2', 6 * 60, 'Kurunegala → Kandy depot', 2, 58, true), one('t-sample-3', 8 * 60 + 30, 'Team drop · Kiribathgoda', 4, 12, false)];
}

const CONTACTS: TaskContacts = {
  requester: { name: 'Nimal Silva', phone: '+94771112222' },
  assigner: null,
  approver: { name: 'Palitha', phone: '+94773334444', at: null },
  approvers: [],
  officePhone: '+94112223333',
} as unknown as TaskContacts;

const noop = () => undefined;

/** The state a design page hands to the real screens (AppValueProvider). */
export function sampleApp(input: { language: Language; now: number; today?: TodayState; running?: boolean }): AppValue {
  const { language, now } = input;
  const today = input.today ?? 'accepted';
  const running = input.running ?? false;
  const sharing = today !== 'off';
  const main = sampleTask(now, running);
  if (today === 'new') main.accepted_at = null;
  const tasks = today === 'empty' ? [] : running ? [main] : [main, ...laterTasks(now)];
  const checks: VehicleCheck[] = today === 'check' || !sharing
    ? []
    : [{ id: 'c-sample-1', vehicle_id: SAMPLE_VEHICLE.id, employee_id: ME.id, task_id: null, checked_at: iso(now - 40 * MIN), result: 'ok', odometer_km: 45210, how: 'clock_in' }];
  const t = (key: string, vars?: Vars) => translate(language, key, vars);
  return {
    booted: true,
    me: ME,
    meFresh: true,
    language,
    t,
    tList: (key) => translateList(language, key),
    setLanguage: noop,
    vehicles: [SAMPLE_VEHICLE],
    vehicle: sharing ? SAMPLE_VEHICLE : null,
    workVehicle: SAMPLE_VEHICLE,
    tasks,
    reports: [],
    sharing,
    tracking: { sharing, problem: null, restarted: false, lastFixAt: now - 5_000 },
    gpsKm: { taskId: running ? main.id : null, taskKm: running ? 54.2 : 0, odometerKm: 0 },
    live: 'connected',
    queue: { ops: 0, points: 0, rejected: 0, heartbeats: 0, rejectedHeartbeats: 0, failed: 0, videos: 0, videoBytes: 0 },
    settings: DEFAULT_DRIVER_SETTINGS,
    wifiOnly: false,
    setWifiOnly: noop,
    waitingTasks: new Set(),
    refreshing: false,
    offline: false,
    dataAvailable: true,
    gate: null,
    resolveGate: noop,
    requireLocation: async () => true,
    signIn: async () => 'not_configured',
    signOut: async () => 'ok',
    refresh: async () => undefined,
    sendNow: async () => undefined,
    setSharing: async () => 'cancelled',
    dutySince: sharing ? iso(now - 50 * MIN) : null,
    startWork: async () => 'cancelled',
    changeVehicle: noop,
    finishWork: async () => 'task',
    loadVehicleChoices: async () => null,
    vehicleTaken: null,
    dismissVehicleTaken: noop,
    dutyEnded: null,
    clearDutyEnded: noop,
    checkTrackingNow: async () => undefined,
    checkUpdate: async () => 'none' as never,
    registerPush: async () => false,
    chooseVehicle: noop,
    markSeen: noop,
    markStopArrived: noop,
    markStopDone: noop,
    undoStopStep: noop,
    markStopPassed: noop,
    skipStop: noop,
    acceptTask: noop,
    declineTask: noop,
    notice: null,
    clearNotice: noop,
    startTask: async () => false,
    completeTask: noop,
    logOdometer: noop,
    logFuel: noop,
    fillOnWay: () => running,
    saveProfilePhoto: async () => 'failed',
    pendingVehiclePhotos: {},
    addVehiclePhoto: noop,
    knownPlaces: [],
    loadKnownPlaces: noop,
    startTrip: async () => ({ kind: 'refused', message: '' }) as never,
    addTripStop: async () => ({ kind: 'full' }),
    cancelTrip: async () => ({ kind: 'offline' }),
    confirmTaskVehicle: async () => ({ kind: 'queued' }),
    taskContacts: { [main.id]: CONTACTS },
    loadTaskContacts: noop,
    officeContacts: null,
    loadOfficeContacts: noop,
    changesFor: () => NO_CHANGES,
    seenCopyOf: () => null,
    pushChangesOf: () => null,
    rememberShown: noop,
    markPreviewed: noop,
    rememberPush: noop,
    tripProblem: null,
    clearTripProblem: noop,
    sendReport: noop,
    vehicleChecks: checks,
    checkNeeded: (vehicleId) => sharing && !!vehicleId && checks.length === 0,
    heldHow: () => 'clock_in',
    answerVehicleCheck: () => null,
    addCheckPhotos: noop,
    asks: [],
    asksWaiting: new Set(),
    loadAsks: async () => undefined,
    loadAsk: async () => null,
    markAskSeen: noop,
    answerAsk: async () => ({ kind: 'closed' }),
    reportLate: async () => ({ kind: 'closed' }),
    saveProfile: async () => ({ kind: 'network' }),
  };
}

/** Where the phone is on the design page of the running task: 250 m from the next stop (near) or about 42 km away (far). */
export function sampleHere(state: TaskState, now: number): Here {
  const fix = state === 'near' ? { lat: 7.4845, lng: 80.3647, accuracyM: 8 } : { lat: 7.1420, lng: 80.0990, accuracyM: 8 };
  return { fix, now };
}
