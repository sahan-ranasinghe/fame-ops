// The app's state and every action the screens can trigger.
//
// Pattern for actions: write to the offline queue first (so nothing is lost
// without a connection), update what the screen shows straight away, then try
// to send. The server stays the source of truth: every refresh replaces the
// local copy.

import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { isSupabaseConfigured } from '@/config';
import { deviceLanguage, translate, translateList, type Vars } from '@/i18n';
import * as api from '@/lib/api';
import { getJson, KEYS, remove, setJson } from '@/lib/kv';
import { sendHeartbeat, startHeartbeatLoop } from '@/lib/heartbeat';
import { checkTracking, getSharing, readiness, type StartResult, startSharing, stopSharing, type TrackingStatus } from '@/lib/location';
import {
  armFuelReminder,
  armShiftNudge,
  disarmFuelReminder,
  disarmShiftNudge,
  ensureChannels,
  notifyNewTask,
  onNotificationTap,
  onPushReceived,
  onTaskPushReceived,
  presentedTaskPushes,
  renameChannels,
  type TapData,
} from '@/lib/notifications';
import type { OfficeContacts, TaskContacts } from '@/lib/contacts';
import { type PushChanges, pushChanges, type SeenCopy, seenCopy, type TaskChanges, taskChanges } from '@/lib/taskPreview';
import { type ConfirmAnswer, refusalWords, refusedAnswer, taskVehicleOp, wantedType } from '@/lib/vehicleConfirm';
import {
  type CheckHow,
  checkOp,
  checkRow,
  type HeldHow,
  heldHowFor,
  mergeChecks,
  needsCheck,
  parseCheck,
  problemOps,
  reportOps,
  reportRow,
  sidePhotoOps,
  type VehicleCheck,
} from '@/lib/vehicleCheck';
import { type DutyEnded, onDutyEnded } from '@/lib/duty';
import {
  FUEL_REMINDER_AFTER_MS,
  type FillChoice,
  fillColumns,
  fillOnWayPending,
  type FuelAnswer,
  fuelAnswerOp,
  type FuelMemos,
  rememberAnswer,
  rememberFilled,
} from '@/lib/fuelCard';
import { useFuelReminderSwitch } from '@/lib/fuelReminderSwitch';
import { type ArrivalFlag, canMarkDone, taskKmSoFar, withSwapReading } from '@/lib/dayRules';
import { noteArrivalUndone } from '@/lib/stopCorrections';
import { registerTrackingCheck, unregisterTrackingCheck } from '@/lib/backgroundTask';
import { pushToken, registerPush, unregisterPush } from '@/lib/push';
import { playSound } from '@/lib/sounds';
import { mapSession, SETTINGS_EVERY_MS } from '@/lib/mapEngine';
import { flushMapReport } from '@/lib/mapReport';
import { type LocalPhoto, type LocalProfilePhoto, prepareOdometerReader, queuePhoto, removeFile } from '@/lib/photos';
import { profilePhotoPath } from '@/lib/photoRules';
import { type AskAnswerInput, askAnswerOp, type AskRow, mergeAsk, withAnswer } from '@/lib/asks';
import { licencePhotoPath, type LicenceSide, type ProfilePatch } from '@/lib/profile';
import { queueVideoUpload, type RecordedVideo, videoSegmentRows, videoStoragePath } from '@/lib/video';
import { sessionKind } from '@/lib/session';
import { canEnterDriving, driverParts, drivingShown, isOfficeDriver, leaveOutcome, ownTasks, shouldStopSharing, taskScope, tripRunning } from '@/lib/drivingMode';
import { getOfficeMe, OFFICE_KEYS, useOfficeMe } from '@/office/store';
import { supabase } from '@/lib/supabase';
import { colomboDate, colomboTime, startOfColomboDay } from '@/lib/time';
import { beginTaskKm, endTaskKm, type KmCounters, kmCounters, resetOdometerKm } from '@/lib/tracking';
import { driverApi } from '@/lib/driverApiClient';
import {
  canAddStop,
  type Choice,
  isSelfTrip,
  keepLocalTrips,
  knownFromPick,
  knownFromTasks,
  type KnownPlace,
  localTrip,
  mergeKnown,
  type Purpose,
  rememberPlace,
  stopRequest,
  tripCreateOp,
  tripRequest,
  tripStopOp,
  withAddedStop,
  withCard,
} from '@/lib/trips';
import type { CheckSide, Employee, Language, ReportCategory, TaskStop, TaskWithStops, Vehicle, VehicleReport } from '@/lib/types';
import { applyDownloadedUpdate, checkForUpdate, forgetDownloadedUpdate, runningUpdateId, type UpdateOutcome } from '@/lib/updates';
import {
  enqueue,
  flushNow,
  maybeRetryRejected,
  onAnswer,
  onAskSent,
  onLateSent,
  onOpRefused,
  onQueueChange,
  onTripSent,
  onVehiclePhotoAnswer,
  uploadPhotoFile,
  waitingAskAnswers,
} from '@/sync';
import type { VehiclePhotoOp } from '@/sync/engine';
import { clearQueue, opsBeforeTrip, pendingVehiclePhotos, queueCounts, type QueueCounts, retryFailed, tasksWaiting } from '@/sync/store';

export type SignInOutcome = 'ok' | 'wrong' | 'network' | 'switched_off' | 'not_configured';
/** Why a stop was skipped (task_stops.skip_reason); not_visited = the task was finished with the stop still open. */
export type SkipReason = 'closed' | 'nobody_there' | 'not_needed' | 'not_visited' | 'other';
export type SignOutOutcome = 'ok' | 'task' | 'duty' | 'queue';
/** Round 50 (§37.4): Start driving: the driver screens are in front, or why not (no connection, or the person may not drive). */
export type EnterDrivingOutcome = 'ok' | 'network' | 'refused';
/** Round 50: Office mode's sign-out with the driver state behind it: not while a trip of theirs runs or its data waits. */
export type OfficeSignOutCheck = 'ok' | 'task' | 'queue';
export type StartWorkOutcome = 'on' | 'no_permission' | 'cancelled';
/** "{plate} is now with {name}": the vehicle this driver held was taken by another driver (Phase 7, item 2). */
export interface VehicleTaken {
  /** The assignment row, so a closed banner stays closed. */
  id: string;
  plate: string;
  name: string;
  at: string;
}
export type LiveStatus = 'connected' | 'connecting' | 'off';
/** The driver's photo was saved, or why not: no connection (try again) or the server refused it. */
export type ProfilePhotoOutcome = 'ok' | 'network' | 'failed';
/** The driver's own photo kept on the phone (KEYS.profilePhoto). */
export interface KeptProfilePhoto {
  photoId: string;
  uri: string;
}
/** Part 3b (G): the licence photos kept on the phone (KEYS.licencePhotos), each as the profile photo is. */
export type KeptLicencePhotos = Partial<Record<LicenceSide, KeptProfilePhoto>>;
/**
 * Part 3b (H3, H4): an answer or a "Running late" went to the server now ('sent'), waits in the queue ('queued': no
 * connection, or no answer in time), the question had closed ('expired'), the task is over ('closed'), or the server
 * refused it ('failed', with the words).
 */
export type SendOutcome = { kind: 'sent' } | { kind: 'queued' } | { kind: 'expired' } | { kind: 'closed' } | { kind: 'failed'; message: string };
/** Part 3b (G): the profile was saved, or why not (online only). */
export type ProfileSaveOutcome = { kind: 'ok' } | { kind: 'network' } | { kind: 'refused'; message: string };

/** The "Turn on Location" cover (components/LocationGate.tsx): why it is up and what for. */
export interface GateState {
  reason: 'services' | 'permission';
  /** start = starting a task, sharing = switching sharing on, task = a task is in progress with Location off. */
  purpose: 'start' | 'sharing' | 'task';
}
export type GateOutcome = 'ready' | 'cancelled';

export interface FuelEntry {
  litres: number | null;
  amountCents: number | null;
  receipt: LocalPhoto | null;
  /** The video of the fill (Phase 6, Part 3): required for every fuel entry. */
  video: RecordedVideo | null;
  /** Round 4–7 (§33.2): what was filled (petrol or diesel, and the grade), preselected from the vehicle; none = not given. */
  fill?: FillChoice | null;
}

/** How an odometer reading was arrived at (see app/log-mileage.tsx). The server adds what it read. */
export type OdometerEntryKind = 'photo' | 'photo_changed' | 'typed_unreadable' | 'typed_offline';

/** Which swap reading a log is (Phase 7): the server's trigger puts it on the task's stretch of that vehicle. */
export interface SwapReading {
  kind: 'task_end' | 'task_start';
  vehicleId: string;
  taskId: string;
}

/**
 * Start a trip (Phase 7 §13): made on the server at once (`queued` false), or kept on the phone and sent by the queue
 * (`offline` true when there was no connection: the driver is told). A refusal carries the server's words.
 */
export type StartTripOutcome =
  | { kind: 'started'; taskId: string; queued: boolean; offline: boolean }
  | { kind: 'refused'; message: string }
  | { kind: 'no_vehicle' }
  | { kind: 'task_running' };
/** Add a stop on the way: added now, or kept on the phone; refused with the server's words; or the trip has 12 stops. */
export type AddStopOutcome = { kind: 'added'; queued: boolean; offline: boolean } | { kind: 'refused'; message: string } | { kind: 'full' };
export type CancelTripOutcome = { kind: 'cancelled' } | { kind: 'offline' } | { kind: 'refused'; message: string };
/**
 * A queued trip or stop the server refused for good: Today and the task screen say why (trip.failed / trip.stopFailed).
 * Hotfix 2 (J): also a vehicle confirmed offline for a task and refused (vehicleConfirm.failed, the refusal in words).
 */
export interface TripProblem {
  key: 'trip.failed' | 'trip.stopFailed' | 'vehicleConfirm.failed';
  reason: string;
}

/**
 * Round 4–7 (§33.1): the answer to "Any damage or problem with <plate>?": "No, all good" (one tap), or a problem with its
 * report (a category, 1 to 6 photos, a note). `how`: the way the vehicle was taken; `taskId`: the task it is for, if any.
 */
export type CheckAnswer =
  | { vehicleId: string; how: CheckHow; taskId: string | null; result: 'ok' }
  | {
    vehicleId: string;
    how: CheckHow;
    taskId: string | null;
    result: 'problem';
    report: { category: ReportCategory; note: string; photos: LocalPhoto[] };
  };

/** Hotfix 2 (J): the vehicle of a task made without one: set now, kept on the phone for the queue, or refused (the word). */
export type ConfirmVehicleOutcome = { kind: 'ok' } | { kind: 'queued' } | { kind: 'refused'; answer: ConfirmAnswer | string };

/** Who to call about a task, as last read, with the task's updated_at then (read again when the task changes). */
interface KeptContacts {
  at: number;
  updatedAt: string;
  contacts: TaskContacts | null;
}

/** Contacts are read again after this long even when the task did not change (a number the office edited). */
const CONTACTS_MAX_AGE_MS = 30 * 60_000;
/** Me's office contacts are read again after this long. */
const OFFICE_CONTACTS_MAX_AGE_MS = 10 * 60_000;
/** Part 3b: an answer or a late report gets this long to reach the server before the screen says "Will be sent". */
const SEND_WAIT_MS = 8_000;
/** Part 3b (H3): questions closed less than this long ago stay on the phone (a late tap on the push still shows them). */
const ASKS_KEEP_CLOSED_MS = 24 * 3600_000;

/** Waiting for the queue to send what must go before a trip: at most this long, then the trip is queued behind it. */
const TRIP_FLUSH_WAIT_MS = 8_000;
/** Our places for Start a trip offline are read again after this long (on the trip page), or 12 hours (on refresh). */
const OUR_PLACES_MAX_AGE_MS = 3600_000;
const OUR_PLACES_REFRESH_MS = 12 * 3600_000;

export interface OdometerEntry {
  km: number;
  entry: OdometerEntryKind;
  /** The photo the reading belongs to. */
  photo: LocalPhoto;
  /** What the phone's own reader found, for the record. */
  ocrKm: number | null;
  /** How many photos the driver took for this reading. */
  attempts: number;
}

export interface AppValue {
  /** false until the saved sign-in has been checked. */
  booted: boolean;
  me: Employee | null;
  /** true once the server answered who this driver is in this run of the app (the "Add your photo" step waits for it). */
  meFresh: boolean;
  language: Language;
  t: (key: string, vars?: Vars) => string;
  tList: (key: string) => string[];
  setLanguage: (language: Language) => void;

  vehicles: Vehicle[];
  /** The driver's current vehicle (the one held on duty). */
  vehicle: Vehicle | null;
  /** The vehicle manual readings, fuel and reports go to: the current one, else (off duty) the one held last. */
  workVehicle: Vehicle | null;
  tasks: TaskWithStops[];
  reports: VehicleReport[];
  sharing: boolean;
  /** What the last check of the location service found. */
  tracking: TrackingStatus;
  /** Km by GPS for the task in progress and since the last odometer reading. */
  gpsKm: KmCounters;
  /** Whether the live connection for new and changed tasks is up. */
  live: LiveStatus;
  queue: QueueCounts;
  /** The fleet settings a driver may read: the shift nudge and the fuel video checklist. */
  settings: api.DriverSettings;
  /** "Upload videos on Wi-Fi only" (Me tab). */
  wifiOnly: boolean;
  setWifiOnly: (on: boolean) => void;
  /** Tasks with a start or finish that has not reached the office yet. */
  waitingTasks: Set<string>;
  refreshing: boolean;
  offline: boolean;
  /** Whether the phone has a data connection, as Android reports it (false shows "Offline · N points waiting"). */
  dataAvailable: boolean;

  /** The Location cover, when it is up. */
  gate: GateState | null;
  /** The cover reports: Location is on now ('ready'), or the driver chose "Not now". */
  resolveGate: (outcome: GateOutcome) => void;
  /** Runs the action once Location is on (showing the cover first if it is not); false when the driver cancelled. */
  requireLocation: (purpose: 'start' | 'sharing', action: () => Promise<void> | void) => Promise<boolean>;

  signIn: (username: string, pin: string) => Promise<SignInOutcome>;
  signOut: () => Promise<SignOutOutcome>;
  /**
   * Round 50 (§37.4), Driving mode (Uber's driver mode switch: one account, the office side and the driver side): the
   * loaded `me` is an office person driving their own trips (role not driver). false for every driver.
   */
  officeDriver: boolean;
  /** The driver screens are in front: always for a driver; for an office person after Start driving, until Back to office. */
  driving: boolean;
  /**
   * Start driving (Office mode's Home, More, My trip): loads the person's own employees row as the driver state, with no new
   * sign-in and nothing forgotten (the queue stays), and puts the driver screens in front.
   */
  enterDriving: () => Promise<EnterDrivingOutcome>;
  /**
   * Back to office: Office mode in front. 'keep' = the driver state stays loaded behind it (a trip of theirs runs: the
   * location and the queue go on in the background; or something waits to be sent: dropped once it is); 'drop' = it went
   * (the sign-in stays).
   */
  leaveDriving: () => Promise<'keep' | 'drop'>;
  /** The driver screens in front again (a task notification tapped while Office mode was), the state already loaded. */
  showDriving: () => void;
  /** Office mode's Sign out asks first: refused while a trip of theirs runs, or its data could not be sent yet. */
  officeSignOutCheck: () => Promise<OfficeSignOutCheck>;
  /**
   * Office mode's Home, before Driving mode is entered: the person's own row and the trips they drive themselves from today
   * (read as the driver screens read them; nothing kept). null = no row. Throws without a connection.
   */
  loadDriveTrips: () => Promise<{ me: Pick<Employee, 'id' | 'role'>; tasks: TaskWithStops[] } | null>;
  refresh: () => Promise<void>;
  sendNow: (includeFailed?: boolean) => Promise<void>;
  setSharing: (on: boolean) => Promise<'on' | 'off' | 'no_permission' | 'cancelled'>;
  /** Phase 7, the driver's day. On duty since (ISO), from this phone's open duty period. */
  dutySince: string | null;
  /** Start work with today's vehicle (null = no vehicle today): the duty session carries it, the server records the take. */
  startWork: (vehicleId: string | null) => Promise<StartWorkOutcome>;
  /** Change vehicle while on duty (null = no vehicle), at the phone's time. */
  changeVehicle: (vehicleId: string | null) => void;
  /** Finish work: not while a task is in progress. */
  finishWork: () => Promise<'off' | 'task'>;
  /** The vehicles to choose from with who holds each (null without a connection: the screen falls back to `vehicles`). */
  loadVehicleChoices: () => Promise<api.VehicleChoice[] | null>;
  /** The banner when another driver took this driver's vehicle; null when there is none. */
  vehicleTaken: VehicleTaken | null;
  dismissVehicleTaken: () => void;
  /** The server ended the duty (the cut-off or the office): Today shows it once. */
  dutyEnded: DutyEnded | null;
  clearDutyEnded: () => void;
  checkTrackingNow: () => Promise<void>;
  checkUpdate: () => Promise<UpdateOutcome>;
  /** Registers this phone for push notifications (after sign-in, and when notifications are allowed). */
  registerPush: () => Promise<boolean>;
  chooseVehicle: (vehicleId: string) => void;
  markSeen: (taskIds: string[]) => void;
  /** Arrived, with how it was marked (item 18: within 300 m = ok; override / no_gps / no_pin) and the distance from the pin. */
  markStopArrived: (stop: TaskStop, record?: { flag: ArrivalFlag; distanceM: number | null }) => void;
  markStopDone: (stop: TaskStop) => void;
  /** Round 2: Undo after a slide: Arrived → back to pending; Left → back to arrived (queued after the slide's own write). */
  undoStopStep: (stop: TaskStop, step: 'arrived' | 'left' | 'passed') => void;
  /** Round 2b: a stop driven past, confirmed at the next stop ("Yes, I was there"): Arrived and Left now, flagged as recorded. */
  /** Round 2b: "Yes, I was there" for a stop driven past: visited, confirmed now; the server takes its times from the points. */
  markStopPassed: (stop: TaskStop) => void;
  skipStop: (stop: TaskStop, reason: SkipReason, note: string) => void;
  /** Accept a task (the server keeps the earliest time). */
  acceptTask: (task: TaskWithStops) => void;
  /** "Can't do this task": the office gives it to someone else. */
  declineTask: (task: TaskWithStops, reason: api.DeclineReason, note: string) => void;
  /** An i18n key to show once (e.g. "This task was already given to another driver."), or null. */
  notice: string | null;
  clearNotice: () => void;
  /**
   * false when Location stayed off and the driver chose "Not now": nothing was started. Round 4–7 (§33.2): `fuelAnswer`,
   * the fuel card's "Enough fuel?" (optional), queued after the start; "I'll fill up on the way" arms the reminder.
   */
  startTask: (task: TaskWithStops, reading: OdometerEntry, fuelAnswer?: FuelAnswer | null) => Promise<boolean>;
  completeTask: (task: TaskWithStops, reading: OdometerEntry, fuel: FuelEntry | null) => void;
  /**
   * A manual reading for the vehicle held (or held last); with `swap`, one of the two readings of a vehicle swap during
   * a task (Phase 7): the old vehicle's end (task_end) or the new vehicle's start (task_start), on that task.
   */
  logOdometer: (reading: OdometerEntry, swap?: SwapReading) => void;
  logFuel: (fuel: FuelEntry, odometerKm: number | null) => void;
  /** Round 4–7 (§33.2): the running task's "Fill up on the way · Log fuel" (the driver said so at the start, no fill yet). */
  fillOnWay: (task: TaskWithStops) => boolean;
  /** Phase 7 §5, "Add your photo" and Change photo: sent at once (not queued); the photo stays on the phone for Me. */
  saveProfilePhoto: (photo: LocalProfilePhoto) => Promise<ProfilePhotoOutcome>;
  /** Phase 7 §6: vehicle photos waiting on the phone (vehicle id → the thumbnail's file). */
  pendingVehiclePhotos: Record<string, string>;
  /** Queues a vehicle's first photo (made by lib/photos.ts takeVehiclePhoto); works offline. */
  addVehiclePhoto: (op: VehiclePhotoOp) => void;
  /** Phase 7 §13: our places the phone can offer for a trip with no connection (picked before, on my tasks, the office's own). */
  knownPlaces: KnownPlace[];
  /** Reads our places again when the copy on the phone is older than an hour (and there is a connection). */
  loadKnownPlaces: () => void;
  /** Start a trip: driver-api at once when online and nothing must go first, else the queue (works offline). */
  startTrip: (input: { purpose: Purpose; pick: Choice; note: string }) => Promise<StartTripOutcome>;
  /** Add a stop to my trip under way (the same two ways). */
  addTripStop: (task: TaskWithStops, pick: Choice) => Promise<AddStopOutcome>;
  /** A self trip that has not started, cancelled by the driver (online only). */
  cancelTrip: (task: TaskWithStops) => Promise<CancelTripOutcome>;
  /** Hotfix 2 (J): confirms the vehicle of a task made without one, before Start task (online at once, else queued first). */
  confirmTaskVehicle: (task: TaskWithStops, vehicleId: string) => Promise<ConfirmVehicleOutcome>;
  /** Hotfix 2 (F, K): who to call about each task, as last read (kept on the phone: shown offline). */
  taskContacts: Record<string, TaskContacts>;
  /** Reads a task's contacts (when the copy is old or the task changed; `force` when a screen opens with a connection). */
  loadTaskContacts: (taskId: string, force?: boolean) => void;
  /** Hotfix 2 (F): Me's Call office and Call fleet admin, as last read. */
  officeContacts: OfficeContacts | null;
  loadOfficeContacts: (force?: boolean) => void;
  /** Hotfix 2 (I): what changed in a task since the driver last saw it (and what the newest "Task changed" push named). */
  changesFor: (task: TaskWithStops) => TaskChanges;
  /** The copy the driver last saw of a task (the preview keeps it while open, so its marks stay until it is left). */
  seenCopyOf: (taskId: string) => SeenCopy | null;
  /** The push changes kept for a task (the preview keeps them while open). */
  pushChangesOf: (taskId: string) => PushChanges | null;
  /** The tasks are on screen: the first copy of each is kept (what later changes are measured against). */
  rememberShown: (tasks: TaskWithStops[]) => void;
  /** The driver opened the task: this is the copy seen now; the push's marks are done. */
  markPreviewed: (task: TaskWithStops) => void;
  /** A task notification (tapped, received, or still in the tray): a "Task changed" push's changes are kept. */
  rememberPush: (data: TapData) => void;
  tripProblem: TripProblem | null;
  clearTripProblem: () => void;
  /**
   * needsVehicle: "I need another vehicle" (a breakdown or accident during a task, Phase 7). check (Round 4–7): a pre-trip
   * report, made by that vehicle check: the check goes in the queue first, the report names it (check_id), its photos follow.
   */
  sendReport: (
    category: ReportCategory,
    note: string,
    photos: LocalPhoto[],
    taskId: string | null,
    vehicleId?: string,
    needsVehicle?: boolean,
    check?: VehicleCheck,
  ) => void;
  /** Round 4–7 (§33.1): my vehicle checks of today (kept on the phone, read back from the server on refresh). */
  vehicleChecks: VehicleCheck[];
  /** THE rule (lib/vehicleCheck.ts needsCheck): this vehicle needs its check before work (the switch on, none by me today). */
  checkNeeded: (vehicleId: string | null | undefined) => boolean;
  /** How the vehicle held was taken (clock_in, change, task_start): Today's card answers the check with it. */
  heldHow: (vehicleId: string) => CheckHow;
  /** Records the answer (the phone's copy at once, the queue: the check, then a problem's report and photos); offline too. */
  answerVehicleCheck: (input: CheckAnswer) => VehicleCheck | null;
  /** The optional four photos of an all-good check (front, back, left, right), queued after the check. */
  addCheckPhotos: (check: VehicleCheck, shots: { side: CheckSide; photo: LocalPhoto }[]) => void;
  /** Part 3b (H3): the office's questions as last read (open and closed today), with the answers given on this phone. */
  asks: AskRow[];
  /** The questions with an answer still waiting on the phone (ask ids). */
  asksWaiting: Set<string>;
  /** Reads the questions again (refresh, a question's push, Realtime). */
  loadAsks: () => Promise<void>;
  /** One question (the ask screen): the server's copy, else the phone's; null = not mine or gone; 'offline' = not on the phone. */
  loadAsk: (askId: string) => Promise<AskRow | null | 'offline'>;
  /** The driver opened a question: 'seen' on the server (online, best effort). */
  markAskSeen: (askId: string) => void;
  /** Answers a question through the queue (offline too); the last answer given before it closes wins. */
  answerAsk: (ask: AskRow, input: AskAnswerInput) => Promise<SendOutcome>;
  /** Part 3b (H4): "Running late" by `minutes` (queued; the server keeps the latest report). */
  reportLate: (task: TaskWithStops, minutes: number) => Promise<SendOutcome>;
  /** Part 3b (G): my profile's changed fields, then new licence photos (online only; each part saved stays saved). */
  saveProfile: (patch: ProfilePatch, photos: Partial<Record<LicenceSide, LocalPhoto>>) => Promise<ProfileSaveOutcome>;
}

const AppContext = createContext<AppValue | null>(null);

/**
 * Round 4–7, item 12: a screen drawn with a given state, for the design pages of src/design (the mockup comparison's
 * screenshots, the e2e build only): sample data, no phone, no network. Nothing else uses it.
 */
export function AppValueProvider({ value, children }: { value: AppValue; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

const TRACKING_OFF: TrackingStatus = { sharing: false, problem: null, restarted: false, lastFixAt: null };
/** While the app is on screen: km counters every 15 s, the location service every minute. */
const TICK_MS = 15_000;
const TRACKING_EVERY_TICKS = 4;

export function AppProvider({ children }: { children: ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [me, setMe] = useState<Employee | null>(() => getJson<Employee>(KEYS.me));
  // Round 50 (§37.4): the office person on this phone (Office mode), and whether their driver screens are in front.
  const officeMe = useOfficeMe();
  const [drivingView, setDrivingViewState] = useState<boolean>(() => getJson<boolean>(KEYS.drivingView) === true);
  const setDrivingView = useCallback((on: boolean) => {
    setDrivingViewState(on);
    setJson(KEYS.drivingView, on);
  }, []);
  const officeDriver = isOfficeDriver(me);
  const officeDriverRef = useRef(officeDriver);
  officeDriverRef.current = officeDriver;
  const [meFresh, setMeFresh] = useState(false);
  const [vehiclePhotos, setVehiclePhotos] = useState<Record<string, string>>(() => pendingVehiclePhotos());
  const [language, setLanguageState] = useState<Language>(() => getJson<Language>(KEYS.language) ?? deviceLanguage());
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => getJson<Vehicle[]>(KEYS.vehicles) ?? []);
  const [tasks, setTasks] = useState<TaskWithStops[]>(() => getJson<TaskWithStops[]>(KEYS.tasks) ?? []);
  const [reports, setReports] = useState<VehicleReport[]>(() => getJson<VehicleReport[]>(KEYS.reports) ?? []);
  // Round 4–7 (§33.1): my vehicle checks of today (the card and the rule work offline).
  const [checks, setChecks] = useState<VehicleCheck[]>(() =>
    mergeChecks((getJson<unknown[]>(KEYS.vehicleChecks) ?? []).flatMap((row) => parseCheck(row) ?? []), [], Date.now())
  );
  const checksRef = useRef(checks);
  checksRef.current = checks;
  const [sharing, setSharingState] = useState(() => getSharing() !== null);
  const [shift, setShift] = useState<api.DriverSettings>(() => ({ ...api.DEFAULT_DRIVER_SETTINGS, ...(getJson<Partial<api.DriverSettings>>(KEYS.shift) ?? {}) }));
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  // The switch fuel_card off: a fill-up reminder armed before is cancelled (lib/fuelReminderSwitch.ts).
  useFuelReminderSwitch(shift.fuel_card);
  // Round 4–7 (§33.2): "Enough fuel?" as answered on this phone, and the fills logged since (the line and the reminder).
  const [fuelMemos, setFuelMemos] = useState<FuelMemos>(() => getJson<FuelMemos>(KEYS.fuelMemos) ?? {});
  const fuelMemosRef = useRef(fuelMemos);
  fuelMemosRef.current = fuelMemos;
  const saveFuelMemos = useCallback((next: FuelMemos) => {
    fuelMemosRef.current = next;
    setFuelMemos(next);
    setJson(KEYS.fuelMemos, next);
  }, []);
  const [wifiOnly, setWifiOnlyState] = useState<boolean>(() => getJson<boolean>(KEYS.videoWifiOnly) === true);
  const setWifiOnly = useCallback((on: boolean) => {
    setWifiOnlyState(on);
    setJson(KEYS.videoWifiOnly, on);
    if (!on) void flushNow(true); // mobile data is fine now: send what waited
  }, []);
  const [tracking, setTracking] = useState<TrackingStatus>(TRACKING_OFF);
  const [gpsKm, setGpsKm] = useState<KmCounters>(() => kmCounters());
  const [live, setLive] = useState<LiveStatus>('off');
  const [liveGeneration, setLiveGeneration] = useState(0);
  const [queue, setQueue] = useState<QueueCounts>(() => queueCounts());
  const [waitingTasks, setWaitingTasks] = useState<Set<string>>(() => tasksWaiting());
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [dataAvailable, setDataAvailable] = useState(true);
  const [gate, setGate] = useState<GateState | null>(null);
  const gateResolve = useRef<((outcome: GateOutcome) => void) | null>(null);
  const [dutySince, setDutySince] = useState<string | null>(() => getSharing()?.startedAt ?? null);
  const [vehicleTaken, setVehicleTaken] = useState<VehicleTaken | null>(null);
  const [dutyEnded, setDutyEnded] = useState<DutyEnded | null>(() => getJson<DutyEnded>(KEYS.dutyEnded));
  const [lastVehicleId, setLastVehicleIdState] = useState<string | null>(() => getJson<string>(KEYS.lastVehicle));
  const [ourPlaces, setOurPlaces] = useState<KnownPlace[]>(() => getJson<{ at: number; rows: KnownPlace[] }>(KEYS.tripPlaces)?.rows ?? []);
  const [pickedPlaces, setPickedPlaces] = useState<KnownPlace[]>(() => getJson<KnownPlace[]>(KEYS.tripPicked) ?? []);
  const [tripProblem, setTripProblem] = useState<TripProblem | null>(null);
  const clearTripProblem = useCallback(() => setTripProblem(null), []);
  // Part 3b (H3): the office's questions, and the ones with an answer still waiting on the phone.
  const [asks, setAsks] = useState<AskRow[]>(() => getJson<AskRow[]>(KEYS.asks) ?? []);
  const asksRef = useRef(asks);
  asksRef.current = asks;
  const [asksWaiting, setAsksWaiting] = useState<Set<string>>(() => waitingAskAnswers());
  /** The server's replies to answers and late reports, by the op's client id (the screen waits a moment for its own). */
  const replies = useRef(new Map<string, SendOutcome>());
  // Hotfix 2: who to call (per task, and the office), and the copies that show what changed in a task.
  const [keptContacts, setKeptContacts] = useState<Record<string, KeptContacts>>(() => getJson<Record<string, KeptContacts>>(KEYS.taskContacts) ?? {});
  const [officeContacts, setOfficeContacts] = useState<OfficeContacts | null>(() => getJson<{ at: number; contacts: OfficeContacts | null }>(KEYS.officeContacts)?.contacts ?? null);
  const [seen, setSeen] = useState<Record<string, SeenCopy>>(() => getJson<Record<string, SeenCopy>>(KEYS.taskSeen) ?? {});
  const [pushed, setPushed] = useState<Record<string, PushChanges>>(() => getJson<Record<string, PushChanges>>(KEYS.pushChanges) ?? {});
  // The newest copies, written at once (a notification tap records its changes and opens the task in the same moment).
  const seenRef = useRef(seen);
  const pushedRef = useRef(pushed);
  const contactsRef = useRef(keptContacts);
  contactsRef.current = keptContacts;
  const contactsLoading = useRef(new Set<string>());
  /** Trips this phone made that the server's task list may not have yet (lib/trips.ts keepLocalTrips). */
  const pendingTrips = useRef(new Set<string>());
  const lastVehicleRef = useRef(lastVehicleId);
  const setLastVehicleId = useCallback((id: string) => {
    lastVehicleRef.current = id;
    setLastVehicleIdState(id);
    setJson(KEYS.lastVehicle, id);
  }, []);

  // The newest values, for callbacks that run later.
  const meRef = useRef(me);
  meRef.current = me;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;
  const seenQueued = useRef(new Set<string>());
  const liveRef = useRef<LiveStatus>('off');

  const t = useCallback((key: string, vars?: Vars) => translate(language, key, vars), [language]);
  const tRef = useRef(t);
  tRef.current = t;
  const tList = useCallback((key: string) => translateList(language, key), [language]);
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const serviceTexts = useMemo(
    () => ({
      title: t('service.title'),
      body: t('service.body'),
      stoppedTitle: t('tracking.stoppedTitle'),
      stoppedBody: t('tracking.stoppedBody'),
    }),
    [t],
  );

  const saveTasks = useCallback((next: TaskWithStops[]) => {
    tasksRef.current = next;
    setTasks(next);
    setJson(KEYS.tasks, next);
  }, []);

  const saveMe = useCallback((next: Employee | null) => {
    meRef.current = next;
    setMe(next);
    if (next) setJson(KEYS.me, next);
    else remove(KEYS.me);
  }, []);

  const saveAsks = useCallback((next: AskRow[]) => {
    asksRef.current = next;
    setAsks(next);
    setJson(KEYS.asks, next);
  }, []);

  const saveChecks = useCallback((next: VehicleCheck[]) => {
    checksRef.current = next;
    setChecks(next);
    setJson(KEYS.vehicleChecks, next);
  }, []);
  /** Notes how the vehicle held was taken (Today's check card answers with it). */
  const noteHeld = useCallback((vehicleId: string, how: CheckHow) => setJson(KEYS.heldHow, { vehicleId, how } satisfies HeldHow), []);

  /**
   * Everything of the driver on this phone goes (sign-out, a switched-off account). Round 50: `keepPermissions` when an
   * office person's driver state is dropped (Back to office with nothing running): the first-run Permissions step was done
   * on this phone and is not asked again at their next Start driving.
   */
  const forgetEverything = useCallback((options?: { keepPermissions?: boolean; keepQueue?: boolean }) => {
    saveMe(null);
    remove(KEYS.drivingView);
    setDrivingViewState(false);
    setMeFresh(false);
    removeFile(getJson<KeptProfilePhoto>(KEYS.profilePhoto)?.uri);
    remove(KEYS.profilePhoto);
    const licence = getJson<KeptLicencePhotos>(KEYS.licencePhotos);
    removeFile(licence?.front?.uri);
    removeFile(licence?.back?.uri);
    remove(KEYS.licencePhotos);
    remove(KEYS.monthTotals);
    remove(KEYS.availability);
    remove(KEYS.asks);
    asksRef.current = [];
    setAsks([]);
    remove(KEYS.documents);
    remove(KEYS.vehicleChecks);
    remove(KEYS.heldHow);
    checksRef.current = [];
    setChecks([]);
    remove(KEYS.fuelEstimates);
    remove(KEYS.fuelMemos);
    fuelMemosRef.current = {};
    setFuelMemos({});
    void disarmFuelReminder();
    saveTasks([]);
    setVehicles([]);
    setReports([]);
    remove(KEYS.vehicles);
    remove(KEYS.reports);
    if (!options?.keepPermissions) remove(KEYS.permissionsSeen);
    remove(KEYS.track);
    remove(KEYS.lastVehicle);
    lastVehicleRef.current = null;
    setLastVehicleIdState(null);
    remove(KEYS.tripPlaces);
    remove(KEYS.tripPicked);
    remove(KEYS.tripStopIds);
    remove(KEYS.mapReportPending);
    remove(KEYS.mapReported);
    setOurPlaces([]);
    setPickedPlaces([]);
    setTripProblem(null);
    remove(KEYS.taskContacts);
    remove(KEYS.officeContacts);
    remove(KEYS.taskSeen);
    remove(KEYS.pushChanges);
    setKeptContacts({});
    setOfficeContacts(null);
    seenRef.current = {};
    pushedRef.current = {};
    setSeen({});
    setPushed({});
    pendingTrips.current.clear();
    if (!options?.keepQueue) clearQueue();
    seenQueued.current.clear();
  }, [saveMe, saveTasks]);

  /** New code may start only when no task is in progress and nothing is waiting to be sent. */
  const safeToApplyUpdate = useCallback(() => {
    const counts = queueCounts();
    return !tasksRef.current.some((task) => task.status === 'in_progress') && counts.ops === 0 && counts.points === 0;
  }, []);

  /** Our places for Start a trip with no connection: read again when the phone's copy is older than `maxAgeMs`. */
  const loadOurPlaces = useCallback(async (maxAgeMs: number) => {
    const cached = getJson<{ at: number; rows: KnownPlace[] }>(KEYS.tripPlaces);
    if (cached && Date.now() - cached.at < maxAgeMs) return;
    try {
      const rows = (await api.fetchOurPlaces(supabase)).map((p): KnownPlace => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, site_id: p.site_id, kind: p.kind }));
      setJson(KEYS.tripPlaces, { at: Date.now(), rows });
      setOurPlaces(rows);
    } catch {
      // The list as it was (or none: the typed words still work).
    }
  }, []);
  const loadKnownPlaces = useCallback(() => void loadOurPlaces(OUR_PLACES_MAX_AGE_MS), [loadOurPlaces]);

  // --- Hotfix 2: who to call (F, K), and what changed in a task (I) --------------------------------
  const keepContacts = useCallback((next: Record<string, KeptContacts>) => {
    contactsRef.current = next;
    setKeptContacts(next);
    setJson(KEYS.taskContacts, next);
  }, []);

  const loadTaskContacts = useCallback((taskId: string, force = false) => {
    const task = tasksRef.current.find((item) => item.id === taskId);
    if (!task || contactsLoading.current.has(taskId)) return;
    const had = contactsRef.current[taskId];
    if (!force && had && had.updatedAt === task.updated_at && Date.now() - had.at < CONTACTS_MAX_AGE_MS) return;
    contactsLoading.current.add(taskId);
    void api.fetchTaskContacts(supabase, taskId)
      .then((contacts) => keepContacts({ ...contactsRef.current, [taskId]: { at: Date.now(), updatedAt: task.updated_at, contacts } }))
      .catch(() => undefined) // no connection: the copy kept on the phone stays
      .finally(() => contactsLoading.current.delete(taskId));
  }, [keepContacts]);

  const loadOfficeContacts = useCallback((force = false) => {
    const had = getJson<{ at: number; contacts: OfficeContacts | null }>(KEYS.officeContacts);
    if (!force && had && Date.now() - had.at < OFFICE_CONTACTS_MAX_AGE_MS) return;
    void api.fetchOfficeContacts(supabase)
      .then((contacts) => {
        setJson(KEYS.officeContacts, { at: Date.now(), contacts });
        setOfficeContacts(contacts);
      })
      .catch(() => undefined);
  }, []);

  const keepSeen = useCallback((next: Record<string, SeenCopy>) => {
    seenRef.current = next;
    setSeen(next);
    setJson(KEYS.taskSeen, next);
  }, []);
  const keepPushed = useCallback((next: Record<string, PushChanges>) => {
    pushedRef.current = next;
    setPushed(next);
    setJson(KEYS.pushChanges, next);
  }, []);

  /** What the phone keeps per task (contacts, the copy seen, the push's marks) goes with the task from the list. */
  const pruneTaskMemory = useCallback((ids: Set<string>) => {
    const keep = <T,>(all: Record<string, T>) => Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)));
    const size = (o: object) => Object.keys(o).length;
    const contacts = keep(contactsRef.current);
    if (size(contacts) !== size(contactsRef.current)) keepContacts(contacts);
    const copies = keep(seenRef.current);
    if (size(copies) !== size(seenRef.current)) keepSeen(copies);
    const marks = keep(pushedRef.current);
    if (size(marks) !== size(pushedRef.current)) keepPushed(marks);
  }, [keepContacts, keepSeen, keepPushed]);

  const rememberShown = useCallback((list: TaskWithStops[]) => {
    const old = seenRef.current;
    const missing = list.filter((task) => !old[task.id]);
    if (missing.length === 0) return;
    const now = Date.now();
    const next = { ...old };
    for (const task of missing) next[task.id] = seenCopy(task, now);
    keepSeen(next);
  }, [keepSeen]);

  const markPreviewed = useCallback((task: TaskWithStops) => {
    keepSeen({ ...seenRef.current, [task.id]: seenCopy(task, Date.now(), true) });
    if (pushedRef.current[task.id]) {
      const rest = { ...pushedRef.current };
      delete rest[task.id];
      keepPushed(rest);
    }
  }, [keepSeen, keepPushed]);

  const rememberPush = useCallback((data: TapData) => {
    const taskId = data.taskId;
    if (!taskId || data.kind !== 'changed') return;
    const found = pushChanges(data.changes, data.at ?? Date.now());
    if (!found) return;
    const had = pushedRef.current[taskId];
    if (had && had.at >= found.at) return; // this push (or a newer one) is kept already
    // A push the driver saw already (older than the copy kept when the task was opened) marks nothing.
    const copy = seenRef.current[taskId];
    const read = (at: number) => !!copy?.opened && at <= copy.at;
    if (read(found.at)) return;
    // An older push not read yet adds its marks.
    const before = had && !read(had.at) ? had : null;
    const merged: PushChanges = before
      ? { at: found.at, fields: [...new Set([...before.fields, ...found.fields])], stops: [...(before.stops ?? []), ...(found.stops ?? [])] }
      : found;
    keepPushed({ ...pushedRef.current, [taskId]: merged });
  }, [keepPushed]);

  const changesFor = useCallback((task: TaskWithStops) => taskChanges(seen[task.id] ?? null, task, pushed[task.id] ?? null), [seen, pushed]);
  const seenCopyOf = useCallback((taskId: string) => seenRef.current[taskId] ?? null, []);
  const pushChangesOf = useCallback((taskId: string) => pushedRef.current[taskId] ?? null, []);

  // --- Part 3b (H3): questions from the office -----------------------------------------------------
  const loadAsks = useCallback(async () => {
    const current = meRef.current;
    if (!current) return;
    try {
      const rows = await api.fetchMyAsks(supabase, current.id, new Date(Date.now() - ASKS_KEEP_CLOSED_MS));
      // An answer still waiting on the phone keeps the phone's copy of its question.
      const waiting = waitingAskAnswers();
      saveAsks(rows.map((row) => (waiting.has(row.ask_id) ? asksRef.current.find((a) => a.ask_id === row.ask_id) ?? row : row)));
    } catch {
      // No connection (or the server has no questions yet): the copy kept on the phone.
    }
  }, [saveAsks]);
  const loadAsksRef = useRef(loadAsks);
  loadAsksRef.current = loadAsks;

  const loadAsk = useCallback(async (askId: string): Promise<AskRow | null | 'offline'> => {
    const current = meRef.current;
    const kept = asksRef.current.find((a) => a.ask_id === askId) ?? null;
    if (!current) return kept;
    try {
      const row = await api.fetchMyAsk(supabase, current.id, askId);
      if (!row) return null;
      if (waitingAskAnswers().has(askId) && kept) return kept;
      saveAsks(mergeAsk(asksRef.current, row));
      return row;
    } catch {
      return kept ?? 'offline';
    }
  }, [saveAsks]);

  const markAskSeen = useCallback((askId: string) => {
    const kept = asksRef.current.find((a) => a.ask_id === askId);
    if (kept?.seen_at) return;
    const at = new Date().toISOString();
    void api.answerAsk(supabase, askId, 'seen', {}, at)
      .then(() => saveAsks(asksRef.current.map((a) => (a.ask_id === askId ? { ...a, seen_at: a.seen_at ?? at } : a))))
      .catch(() => undefined); // best effort: an answer marks it seen too
  }, [saveAsks]);

  const refresh = useCallback(async () => {
    if (!meRef.current) return;
    const scope = taskScope(meRef.current);
    setRefreshing(true);
    try {
      // The driver asked (or the app came back): refused points get another go, and the upload backoff is ignored.
      maybeRetryRejected('refresh');
      const sent = await flushNow(true);
      const [row, vehicleRows, taskRows, reportRows, shiftSettings, checkRows] = await Promise.all([
        api.fetchMe(supabase),
        api.fetchVehicles(supabase),
        // Round 50: the person's own tasks (an office person's: only the trips they drive), never left to RLS alone.
        api.fetchTasks(supabase, startOfColomboDay(colomboDate()), scope),
        api.fetchReports(supabase),
        api.fetchDriverSettings(supabase).catch(() => null),
        // Round 4–7: my checks of today (after a fresh sign-in too); none read = the phone's copy stays.
        api.fetchMyChecks(supabase, startOfColomboDay(colomboDate())).catch(() => null),
      ]);
      // Round 50: the driver state went while this was read (Back to office dropped it, or a sign-out): nothing comes back.
      if (!meRef.current) return;
      if (!row) {
        // No row: the office switched this account off, or the request went without a session because an expired token
        // could not be refreshed (no connection to Auth; lib/session.ts). Only the first signs the driver out.
        if (sessionKind(await supabase.auth.getSession()) === 'offline') {
          setOffline(true);
          return;
        }
        // The office switched this account off.
        await stopSharing('auto');
        setSharingState(false);
        await supabase.auth.signOut({ scope: 'local' });
        forgetEverything();
        return;
      }
      saveMe(row);
      setMeFresh(true);
      setVehicles(vehicleRows);
      setJson(KEYS.vehicles, vehicleRows);
      setReports(reportRows);
      setJson(KEYS.reports, reportRows);
      if (shiftSettings) {
        setShift(shiftSettings);
        setJson(KEYS.shift, shiftSettings);
      }
      // The server's checks of today with the phone's own still on their way (a check answered offline is kept).
      if (checkRows) saveChecks(mergeChecks(checksRef.current, checkRows, Date.now()));
      // While something is still waiting on the phone, keep what the driver did rather than the older server copy.
      // A trip this phone just made stays until the list has it (the list may have been read a moment before).
      if (!sent.offline) {
        saveTasks(keepLocalTrips(ownTasks(taskRows, meRef.current), tasksRef.current, pendingTrips.current));
        // Hotfix 2: what the phone keeps per task follows the list; the open tasks' contacts are read when they changed.
        pruneTaskMemory(new Set(tasksRef.current.map((task) => task.id)));
        for (const task of tasksRef.current) if (task.status === 'assigned' || task.status === 'in_progress') loadTaskContacts(task.id);
        loadOfficeContacts();
      }
      setOffline(sent.offline);
      // Part 6: a map report that did not reach the server yet.
      void flushMapReport();
      void loadOurPlaces(OUR_PLACES_REFRESH_MS);
      // Part 3b (H3): the office's questions (Today's banner).
      void loadAsksRef.current();
      // Phase 7: another driver took my vehicle while I am on duty → the banner (until I choose or close it).
      const rows = await api.fetchMyAssignments(supabase, 1).catch(() => null);
      const last = rows?.[0];
      if (last) setLastVehicleId(last.vehicle_id);
      if (last && last.ended_how === 'taken_over' && row.current_vehicle_id === null && getSharing() && last.id !== getJson<string>(KEYS.takenSeen)) {
        const plate = vehicleRows.find((v) => v.id === last.vehicle_id)?.reg_no ?? '';
        setVehicleTaken({ id: last.id, plate, name: (last.ended_by_name ?? '').split(' ')[0], at: last.to_at ?? last.from_at });
      } else if (rows) {
        setVehicleTaken(null);
      }
    } catch {
      setOffline(true);
    } finally {
      setRefreshing(false);
    }
  }, [forgetEverything, saveMe, saveTasks, saveChecks, setLastVehicleId, loadOurPlaces, pruneTaskMemory, loadTaskContacts, loadOfficeContacts]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  /** Looks at the location service and tells the screens what it found. */
  const checkTrackingNow = useCallback(async () => {
    if (!meRef.current) return;
    try {
      const status = await checkTracking(serviceTexts);
      setTracking(status);
      setSharingState(status.sharing);
      setDutySince(getSharing()?.startedAt ?? null);
    } catch {
      // The screens keep the last status.
    }
    setGpsKm(kmCounters());
  }, [serviceTexts]);

  // --- Location required for work --------------------------------------------
  const resolveGate = useCallback((outcome: GateOutcome) => {
    const resolve = gateResolve.current;
    gateResolve.current = null;
    setGate(null);
    resolve?.(outcome);
  }, []);

  const requireLocation = useCallback(async (purpose: 'start' | 'sharing', action: () => Promise<void> | void) => {
    const ready = await readiness();
    if (!ready.ok) {
      const outcome = await new Promise<GateOutcome>((resolve) => {
        gateResolve.current = resolve;
        setGate({ reason: ready.servicesOn ? 'permission' : 'services', purpose });
      });
      if (outcome !== 'ready') return false;
    }
    await action();
    return true;
  }, []);

  // --- start-up -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      forgetDownloadedUpdate();
      // 'offline' = the session is stored but its token could not be refreshed (no connection): still signed in.
      const session = sessionKind(await supabase.auth.getSession());
      if (cancelled) return;
      if (session === 'none') {
        if (meRef.current) forgetEverything();
      } else if (meRef.current) {
        maybeRetryRejected('start', runningUpdateId());
        await checkTrackingNow();
        void refresh();
        // The channels (with their sounds) must exist before the first push arrives.
        void ensureChannels().then(registerPush);
        void registerTrackingCheck();
      }
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once: later sign-ins go through signIn().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once signed in, get the odometer reader ready in the background.
  const signedIn = me !== null;

  // Part 6: the settings again every minute while the app is open, so the office's map package reaches the phone's map
  // within a minute (lib/mapEngine.ts); the other settings come along. A failed read keeps the last ones.
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void api.fetchDriverSettings(supabase).then((next) => {
        if (JSON.stringify(next) === JSON.stringify(getJson<api.DriverSettings>(KEYS.shift))) return;
        setShift(next);
        setJson(KEYS.shift, next);
      }).catch(() => undefined);
    }, SETTINGS_EVERY_MS);
    return () => clearInterval(timer);
  }, [signedIn]);
  useEffect(() => {
    if (signedIn) void prepareOdometerReader();
  }, [signedIn]);

  // Keep the queue numbers on screen up to date, and start a downloaded update once everything is sent.
  useEffect(
    () =>
      onQueueChange(() => {
        setQueue(queueCounts());
        setWaitingTasks(tasksWaiting());
        setGpsKm(kmCounters());
        const photos = pendingVehiclePhotos();
        setVehiclePhotos((old) => (JSON.stringify(old) === JSON.stringify(photos) ? old : photos));
        const waitingAsks = waitingAskAnswers();
        setAsksWaiting((old) => ([...old].join() === [...waitingAsks].join() ? old : waitingAsks));
        void applyDownloadedUpdate(safeToApplyUpdate);
      }),
    [safeToApplyUpdate],
  );

  // A vehicle photo reached the server (or another one was there first): read the vehicles again for its paths.
  useEffect(() => onVehiclePhotoAnswer(() => void refresh()), [refresh]);

  // Coming back to the front: check the location service, reconnect live updates
  // if they dropped, refresh, and look for a code update (at most every 30 min).
  // Also refresh when the connection returns.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Part 6: Google's map is tried again when the app opens 30 minutes or more after it failed.
      mapSession.appOpened(Date.now());
      void checkTrackingNow();
      if (liveRef.current !== 'connected') setLiveGeneration((n) => n + 1);
      void refresh();
      void checkForUpdate(safeToApplyUpdate);
    });
    const network = Network.addNetworkStateListener((state) => {
      const up = state.isInternetReachable ?? state.isConnected ?? true;
      setDataAvailable(up);
      if (up) void refresh();
    });
    void Network.getNetworkStateAsync().then((state) => setDataAvailable(state.isInternetReachable ?? state.isConnected ?? true)).catch(() => undefined);
    return () => {
      appState.remove();
      network.remove();
    };
  }, [checkTrackingNow, refresh, safeToApplyUpdate]);

  // While on screen: km counters every 15 s, the location service every minute (only while sharing).
  useEffect(() => {
    if (!signedIn) return;
    let ticks = 0;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      ticks += 1;
      setGpsKm(kmCounters());
      if (ticks % TRACKING_EVERY_TICKS === 0 && getSharing()) void checkTrackingNow();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [signedIn, checkTrackingNow]);

  // The shift nudge ("At work? Start work"): scheduled while the driver is signed in and off duty, gone while on duty.
  // Round 50 (§37.2): never for an office person in Driving mode (no Start work for them): gone if one was armed.
  useEffect(() => {
    if (!signedIn) return;
    if (sharing || !driverParts(officeDriver).shiftNudge) void disarmShiftNudge();
    else void armShiftNudge(shift, { title: t('shift.titleWork'), body: t('shift.bodyWork') });
  }, [signedIn, sharing, shift, t, officeDriver]);

  // While sharing is on: a heartbeat a minute, and one the moment Location or the permission changes.
  useEffect(() => {
    if (!signedIn || !sharing) return;
    return startHeartbeatLoop();
  }, [signedIn, sharing]);

  // A task in progress needs Location: the cover goes up when it is off and comes down by itself when it is back.
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (!tasksRef.current.some((task) => task.status === 'in_progress')) {
        setGate((current) => (current?.purpose === 'task' ? null : current));
        return;
      }
      void readiness().then((ready) => {
        setGate((current) => {
          if (ready.ok) return current?.purpose === 'task' ? null : current;
          return current ?? { reason: ready.servicesOn ? 'permission' : 'services', purpose: 'task' };
        });
      });
    }, 5_000);
    return () => clearInterval(timer);
  }, [signedIn]);

  // Phase 7: a push about the driver's day while the app runs: the vehicle was taken or moved → refresh;
  // a clock-out → a heartbeat now (its answer stops location, lib/duty.ts), then refresh.
  useEffect(() => onPushReceived((kind) => {
    if (kind === 'ask') void loadAsksRef.current(); // Part 3b (H3): Today's banner
    else if (kind === 'vehicle_taken' || kind === 'vehicle_moved' || kind === 'reopened') void refresh();
    else if (kind === 'duty_auto_out' || kind === 'duty_office_out') void sendHeartbeat().then(() => refresh());
  }), [refresh]);

  // Hotfix 2 (I): a "Task changed" push keeps what it named (also the ones still in the tray when the app starts or comes
  // back), so the preview marks it, offline too.
  useEffect(() => onTaskPushReceived(rememberPush), [rememberPush]);
  useEffect(() => {
    if (!signedIn) return;
    const look = () => void presentedTaskPushes().then((list) => list.forEach(rememberPush));
    look();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') look();
    });
    return () => sub.remove();
  }, [signedIn, rememberPush]);

  // The server ended the duty (lib/duty.ts stopped location): the screens follow.
  useEffect(() => onDutyEnded((ended, silent) => {
    setSharingState(false);
    setTracking(TRACKING_OFF);
    setDutySince(null);
    if (!silent) setDutyEnded(ended);
    const current = meRef.current;
    if (current?.current_vehicle_id) saveMe({ ...current, current_vehicle_id: null });
  }), [saveMe]);

  // The driver tapped the "sharing stopped" notification: look again right away.
  useEffect(() => onNotificationTap((data) => {
    if (data.kind === 'watchdog' || data.kind === 'restart') void checkTrackingNow();
  }), [checkTrackingNow]);

  // Live updates: the office assigns, changes or cancels one of my tasks.
  const myId = me?.id;
  useEffect(() => {
    if (!myId) {
      liveRef.current = 'off';
      setLive('off');
      return;
    }
    liveRef.current = 'connecting';
    setLive('connecting');
    const channel = supabase
      .channel(`my-tasks-${myId}-${liveGeneration}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `employee_id=eq.${myId}` }, (change) => {
        // A phone with a push token hears about the task from the server; the others from here. A trip the driver
        // started (kind self, Phase 7 §13) is not news to them.
        // Round 50: none for an office person (the trips they drive are the ones they booked).
        if (change.eventType === 'INSERT' && !pushToken() && driverParts(officeDriverRef.current).newTaskNotice && (change.new as { kind?: string }).kind !== 'self') {
          const task = change.new as { id?: string; title?: string; start_at?: string };
          void notifyNewTask(t('today.newTask'), [task.start_at ? colomboTime(task.start_at) : '', task.title ?? ''].join(' ').trim(), task.id ?? '');
        }
        void refresh();
      })
      // Part 3b (H3): a question from the office (the driver reads their own rows): Today's banner at once.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_ask_answers', filter: `employee_id=eq.${myId}` }, () => {
        void loadAsksRef.current();
      })
      .subscribe((status) => {
        const next: LiveStatus = status === 'SUBSCRIBED' ? 'connected' : status === 'CLOSED' ? 'off' : 'connecting';
        liveRef.current = next;
        setLive(next);
        // Anything that happened while the connection was down is picked up now.
        if (next === 'connected') void refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [myId, liveGeneration, refresh, t]);

  // --- language -------------------------------------------------------------
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    setJson(KEYS.language, next);
    void renameChannels(next); // the "New tasks" channel's name in Android's settings
    const current = meRef.current;
    if (current && current.language !== next) {
      saveMe({ ...current, language: next });
      enqueue({ kind: 'employee_patch', id: current.id, patch: { language: next } });
      void flushNow();
    }
  }, [saveMe]);

  // --- sign in / out --------------------------------------------------------
  const signIn = useCallback(async (username: string, pin: string): Promise<SignInOutcome> => {
    if (!isSupabaseConfigured) return 'not_configured';
    const result = await api.signIn(supabase, username, pin);
    if (result !== 'ok') return result;
    try {
      const row = await api.fetchMe(supabase);
      if (!row) {
        await supabase.auth.signOut({ scope: 'local' });
        return 'switched_off';
      }
      // A language picked on the sign-in screen wins; otherwise use the one the office has.
      const picked = getJson<Language>(KEYS.language);
      if (picked && picked !== row.language) {
        enqueue({ kind: 'employee_patch', id: row.id, patch: { language: picked } });
        row.language = picked;
      } else if (row.language === 'en' || row.language === 'si') {
        setLanguageState(row.language);
        setJson(KEYS.language, row.language);
      }
      saveMe(row);
      setMeFresh(true);
      // Round 50: a driver signed in on this phone: the sign-in screen shows its Driver | Office switch again.
      remove(OFFICE_KEYS.lastCanDrive);
      void refresh();
      void ensureChannels().then(registerPush);
      void registerTrackingCheck();
      return 'ok';
    } catch {
      await supabase.auth.signOut({ scope: 'local' });
      return 'network';
    }
  }, [refresh, saveMe]);

  const signOut = useCallback(async (): Promise<SignOutOutcome> => {
    if (tasksRef.current.some((task) => task.status === 'in_progress')) return 'task';
    // Phase 7: Finish work first (sign-out is disabled on Me while on duty).
    if (getSharing()) return 'duty';
    await stopSharing('driver');
    setSharingState(false);
    setTracking(TRACKING_OFF);
    await flushNow();
    const left = queueCounts();
    if (left.ops > 0 || left.points > 0) return 'queue';
    await unregisterPush();
    await unregisterTrackingCheck();
    await disarmShiftNudge();
    await supabase.auth.signOut({ scope: 'local' });
    forgetEverything();
    return 'ok';
  }, [forgetEverything]);

  // --- Round 50 (§37.4): Driving mode, an office person's own trips on the driver screens -------------------------------
  // Uber's driver mode switch: the same account; Office mode stays signed in underneath (its session is the one Supabase
  // client's), the driver state is the person's own employees row (RLS reads it as a driver's).

  /** Sharing ends with the trip (§37.2): the location service stops and the duty period closes (the server closes it too). */
  const stopTripSharing = useCallback(async () => {
    await stopSharing('driver');
    setSharingState(false);
    setTracking(TRACKING_OFF);
    setDutySince(null);
    const current = meRef.current;
    if (current?.current_vehicle_id) saveMe({ ...current, current_vehicle_id: null });
  }, [saveMe]);

  const enterDriving = useCallback(async (): Promise<EnterDrivingOutcome> => {
    // Loaded already (a trip of theirs runs behind Office mode, or its data waits): only the screens change.
    if (meRef.current) {
      setDrivingView(true);
      return 'ok';
    }
    if (!canEnterDriving(getOfficeMe(), true)) return 'refused';
    let row: Employee | null;
    try {
      row = await api.fetchMe(supabase);
    } catch {
      return 'network';
    }
    if (!row || !isOfficeDriver(row)) return 'refused';
    // No signIn, nothing forgotten: the session is Office mode's; push is registered by Office mode already (every channel).
    saveMe(row);
    setMeFresh(true);
    setDrivingView(true);
    await checkTrackingNow();
    void refresh();
    void registerTrackingCheck();
    return 'ok';
  }, [saveMe, setDrivingView, checkTrackingNow, refresh]);

  /** The driver state goes, the sign-in stays (Office mode is the same account). Only with nothing running or waiting. */
  const dropping = useRef(false);
  const dropDriving = useCallback(async () => {
    // Once at a time (Back to office and the effect below may both ask).
    if (dropping.current) return;
    dropping.current = true;
    try {
      if (getSharing()) await stopTripSharing();
      await unregisterTrackingCheck();
      await disarmShiftNudge();
      forgetEverything({ keepPermissions: true });
    } finally {
      dropping.current = false;
    }
  }, [stopTripSharing, forgetEverything]);

  const leaveDriving = useCallback(async (): Promise<'keep' | 'drop'> => {
    setDrivingView(false);
    // What waits goes now if it can (a moment at most); whatever is left keeps the state until it is sent.
    if (dataAvailable) await Promise.race([flushNow(true), new Promise((resolve) => setTimeout(resolve, SEND_WAIT_MS))]);
    const outcome = leaveOutcome({ tasks: tasksRef.current, queue: queueCounts() });
    if (outcome === 'drop') await dropDriving();
    return outcome;
  }, [setDrivingView, dataAvailable, dropDriving]);

  const showDriving = useCallback(() => {
    if (officeDriverRef.current) setDrivingView(true);
  }, [setDrivingView]);

  const loadDriveTrips = useCallback(async () => {
    const row = await api.fetchMe(supabase);
    if (!row) return null;
    const rows = await api.fetchTasks(supabase, startOfColomboDay(colomboDate()), { employeeId: row.id, selfOnly: true });
    return { me: row, tasks: ownTasks(rows, row) };
  }, []);

  const officeSignOutCheck = useCallback(async (): Promise<OfficeSignOutCheck> => {
    if (!officeDriverRef.current) return 'ok';
    if (tripRunning(tasksRef.current)) return 'task';
    await Promise.race([flushNow(true), new Promise((resolve) => setTimeout(resolve, SEND_WAIT_MS))]);
    const left = queueCounts();
    return left.ops > 0 || left.points > 0 ? 'queue' : 'ok';
  }, []);

  // A trip of theirs ended without Finish on this phone (the office cancelled it, or it finished elsewhere): sharing stops
  // once nothing of a start or finish waits on the phone (the list is the server's then).
  useEffect(() => {
    if (waitingTasks.size > 0) return;
    if (shouldStopSharing({ officeDriver, sharing, tasks })) void stopTripSharing();
  }, [officeDriver, sharing, tasks, waitingTasks, stopTripSharing]);

  // Back to office with the state kept: it goes once no trip of theirs runs and everything is sent.
  useEffect(() => {
    if (!officeDriver || drivingView) return;
    if (leaveOutcome({ tasks, queue }) === 'drop') void dropDriving();
  }, [officeDriver, drivingView, tasks, queue, dropDriving]);

  // Office mode signed out (the person, or the server: the session is gone): the driver state goes with it. A trip's
  // finish, readings and points still waiting are their own rows: they stay on the phone and go up after the next sign-in
  // (the fresh review, finding 6: a sign-out forced mid-trip never deletes them).
  const officeSignedIn = officeMe !== null;
  useEffect(() => {
    if (officeSignedIn || !officeDriverRef.current) return;
    void (async () => {
      if (getSharing()) await stopTripSharing();
      await unregisterTrackingCheck();
      const left = queueCounts();
      forgetEverything({ keepQueue: left.ops > 0 || left.points > 0 });
    })();
  }, [officeSignedIn, stopTripSharing, forgetEverything]);

  const sendNow = useCallback(async (includeFailed = false) => {
    if (includeFailed) retryFailed();
    await refresh();
  }, [refresh]);

  const checkUpdate = useCallback(() => checkForUpdate(safeToApplyUpdate, true), [safeToApplyUpdate]);

  // --- sharing and vehicle ----------------------------------------------------
  const setSharing = useCallback(async (on: boolean) => {
    if (!on) {
      await stopSharing('driver');
      setSharingState(false);
      setTracking(TRACKING_OFF);
      setDutySince(null);
      void sendHeartbeat(); // the office hears "not sharing" at once
      return 'off' as const;
    }
    const outcome = { result: 'no_permission' as StartResult };
    const went = await requireLocation('sharing', async () => {
      outcome.result = await startSharing(serviceTexts);
    });
    if (!went) return 'cancelled' as const;
    setSharingState(outcome.result === 'on');
    setDutySince(getSharing()?.startedAt ?? null);
    if (outcome.result === 'on') void checkTrackingNow();
    return outcome.result;
  }, [serviceTexts, checkTrackingNow, requireLocation]);

  // --- Phase 7: the driver's day ------------------------------------------------
  // Start work = a duty session with today's vehicle (the server records the take, item 2); Change vehicle = an RPC
  // with the phone's time; Finish work = the session's end (the server gives the vehicle up).
  const startWork = useCallback(async (vehicleId: string | null): Promise<StartWorkOutcome> => {
    const current = meRef.current;
    if (!current) return 'cancelled';
    // The session picks the vehicle up from the saved me (lib/location.ts startSharing).
    saveMe({ ...current, current_vehicle_id: vehicleId });
    const outcome = { result: 'no_permission' as StartResult };
    const went = await requireLocation('sharing', async () => {
      outcome.result = await startSharing(serviceTexts);
    });
    if (!went || outcome.result !== 'on') {
      // Not on duty after all (Location stayed off, or no permission): the phone holds what it held before.
      const now = meRef.current;
      if (now) saveMe({ ...now, current_vehicle_id: current.current_vehicle_id });
      if (!went) return 'cancelled';
    }
    setSharingState(outcome.result === 'on');
    setDutySince(getSharing()?.startedAt ?? null);
    if (outcome.result === 'on') {
      if (vehicleId) {
        setLastVehicleId(vehicleId);
        noteHeld(vehicleId, 'clock_in');
      }
      setVehicleTaken(null);
      setDutyEnded(null);
      remove(KEYS.dutyEnded);
      void checkTrackingNow();
    }
    return outcome.result;
  }, [saveMe, serviceTexts, checkTrackingNow, requireLocation, setLastVehicleId, noteHeld]);

  const changeVehicle = useCallback((vehicleId: string | null) => {
    const current = meRef.current;
    if (!current || current.current_vehicle_id === vehicleId) return;
    saveMe({ ...current, current_vehicle_id: vehicleId });
    if (vehicleId) {
      setLastVehicleId(vehicleId);
      noteHeld(vehicleId, 'change');
    }
    enqueue({ kind: 'vehicle_change', id: Crypto.randomUUID(), vehicle_id: vehicleId, at: new Date().toISOString() });
    setVehicleTaken(null);
    void flushNow();
  }, [saveMe, setLastVehicleId, noteHeld]);

  const finishWork = useCallback(async (): Promise<'off' | 'task'> => {
    if (tasksRef.current.some((task) => task.status === 'in_progress')) return 'task';
    await stopSharing('driver');
    setSharingState(false);
    setTracking(TRACKING_OFF);
    setDutySince(null);
    setVehicleTaken(null);
    const current = meRef.current;
    if (current?.current_vehicle_id) saveMe({ ...current, current_vehicle_id: null });
    void sendHeartbeat(); // the office hears "off duty" at once
    return 'off';
  }, [saveMe]);

  const loadVehicleChoices = useCallback(async () => {
    try {
      return await api.fetchVehicleChoices(supabase);
    } catch {
      return null;
    }
  }, []);

  const dismissVehicleTaken = useCallback(() => {
    setVehicleTaken((banner) => {
      if (banner) setJson(KEYS.takenSeen, banner.id);
      return null;
    });
  }, []);

  const clearDutyEnded = useCallback(() => {
    setDutyEnded(null);
    remove(KEYS.dutyEnded);
  }, []);

  /** The older picker's entry point: the same as Change vehicle. */
  const chooseVehicle = useCallback((vehicleId: string) => changeVehicle(vehicleId), [changeVehicle]);

  const bumpOdometer = useCallback((vehicleId: string, km: number) => {
    setVehicles((list) => {
      const next = list.map((v) => (v.id === vehicleId ? { ...v, current_odometer_km: km } : v));
      setJson(KEYS.vehicles, next);
      return next;
    });
    resetOdometerKm();
    setGpsKm(kmCounters());
  }, []);

  // --- tasks ------------------------------------------------------------------
  const patchLocalTask = useCallback((id: string, change: (task: TaskWithStops) => TaskWithStops) => {
    saveTasks(tasksRef.current.map((task) => (task.id === id ? change(task) : task)));
  }, [saveTasks]);

  const markSeen = useCallback((taskIds: string[]) => {
    const now = new Date().toISOString();
    for (const id of taskIds) {
      const task = tasksRef.current.find((item) => item.id === id);
      if (!task || task.seen_at || seenQueued.current.has(id)) continue;
      seenQueued.current.add(id);
      enqueue({ kind: 'task_patch', id, patch: { seen_at: now } });
      patchLocalTask(id, (item) => ({ ...item, seen_at: now }));
    }
    void flushNow();
  }, [patchLocalTask]);

  const patchStop = useCallback((stop: TaskStop, patch: api.StopPatch) => {
    enqueue({ kind: 'stop_patch', id: stop.id, patch });
    patchLocalTask(stop.task_id, (task) => ({
      ...task,
      task_stops: task.task_stops.map((item) => (item.id === stop.id ? { ...item, ...patch } : item)),
    }));
    void flushNow();
  }, [patchLocalTask]);

  const markStopArrived = useCallback((stop: TaskStop, record?: { flag: ArrivalFlag; distanceM: number | null }) => {
    patchStop(stop, {
      status: 'arrived',
      arrived_at: new Date().toISOString(),
      arrival_flag: record?.flag ?? 'ok',
      arrival_distance_m: record?.distanceM ?? null,
    });
  }, [patchStop]);

  // Done only after Arrived (item 18): the write carries no arrival, so the server refuses one without it.
  const markStopDone = useCallback((stop: TaskStop) => {
    if (!canMarkDone(stop)) return;
    patchStop(stop, { status: 'done', done_at: new Date().toISOString() });
  }, [patchStop]);

  // Round 2: the snackbar's Undo. The same queued write as the slide, after it in the queue (the order is kept), so offline
  // the two land in turn. How Arrived was marked (arrival_flag) stays on the server as recorded.
  // Round 2b: an undone Arrived is remembered on the phone, so the stop marked again shows "corrected" (lib/stopCorrections.ts).
  // 'passed' undoes "Yes, I was there": the stop is to do again, the confirmation and any times from the points cleared.
  const undoStopStep = useCallback((stop: TaskStop, step: 'arrived' | 'left' | 'passed') => {
    if (step === 'passed') patchStop(stop, { status: 'pending', confirmed_later_at: null, arrived_at: null, done_at: null });
    else if (step === 'arrived') {
      noteArrivalUndone(stop.id);
      patchStop(stop, { status: 'pending', arrived_at: null });
    } else patchStop(stop, { status: 'arrived', done_at: null });
  }, [patchStop]);

  // Round 2b (Sahan, 21 October 2026): "Did you stop at …?" → "Yes, I was there". Never the time of this answer as the visit
  // time: one queued write, visited with confirmed_later_at; the server takes Arrived and Left from the location points that
  // passed within 150 m of the stop (first and last), or none ("time not recorded").
  const markStopPassed = useCallback((stop: TaskStop) => {
    patchStop(stop, { status: 'done', confirmed_later_at: new Date().toISOString(), arrived_at: null, done_at: null });
  }, [patchStop]);

  const skipStop = useCallback((stop: TaskStop, reason: SkipReason, note: string) => {
    patchStop(stop, { status: 'skipped', skip_reason: reason, skip_note: note.trim() === '' ? null : note.trim(), done_at: new Date().toISOString() });
  }, [patchStop]);

  const acceptTask = useCallback((task: TaskWithStops) => {
    const now = new Date().toISOString();
    enqueue({ kind: 'task_accept', id: task.id, at: now });
    patchLocalTask(task.id, (item) => ({ ...item, accepted_at: item.accepted_at ?? now }));
    void flushNow();
  }, [patchLocalTask]);

  const declineTask = useCallback((task: TaskWithStops, reason: api.DeclineReason, note: string) => {
    const now = new Date().toISOString();
    const trimmed = note.trim() === '' ? null : note.trim();
    enqueue({ kind: 'task_decline', id: task.id, reason, note: trimmed, at: now });
    patchLocalTask(task.id, (item) => ({
      ...item,
      status: 'declined',
      declined_at: now,
      declined_reason: reason,
      declined_note: trimmed,
      declined_after_accept: item.accepted_at !== null,
    }));
    void flushNow();
  }, [patchLocalTask]);

  // The server's answer to an accept or decline: a task given away or started meanwhile is told once, then the list is refreshed.
  useEffect(() => onAnswer((_op, answer) => {
    if (answer === 'already_reassigned') setNotice('task.alreadyReassigned');
    else if (answer === 'already_started') setNotice('task.alreadyStarted');
    else if (answer !== 'cancelled') return;
    void refresh();
  }), [refresh]);

  const startTask = useCallback(
    (task: TaskWithStops, reading: OdometerEntry, fuelAnswer?: FuelAnswer | null) => {
      // Hotfix 2 (J): a task made without a vehicle starts only once one is confirmed (the phone's copy has it then).
      const vehicleId = task.vehicle_id ?? tasksRef.current.find((item) => item.id === task.id)?.vehicle_id ?? null;
      if (!vehicleId) return Promise.resolve(false);
      return requireLocation('start', async () => {
        const current = meRef.current;
        if (!current) return;
        const now = new Date().toISOString();
        const odometerKm = reading.km;
        queuePhoto(reading.photo, 'odometer', current.id);
        enqueue(
          {
            kind: 'odometer_log',
            row: {
              id: Crypto.randomUUID(),
              vehicle_id: vehicleId,
              employee_id: current.id,
              task_id: task.id,
              reading_km: odometerKm,
              ocr_value: reading.ocrKm,
              photo_id: reading.photo.id,
              kind: 'task_start',
              logged_at: now,
              entry: reading.entry,
              photo_attempts: reading.attempts,
            },
          },
          { kind: 'task_patch', id: task.id, patch: { status: 'in_progress', start_odometer_km: odometerKm, started_at: now } },
        );
        // Round 4–7 (§33.2): the fuel card's answer after the start (the latest answer wins); "I'll fill up on the way"
        // reminds the driver 30 min on, until a fill is logged on the task. Nothing with the switch off.
        const answer = shiftRef.current.fuel_card ? fuelAnswer ?? null : null;
        if (answer) {
          enqueue(fuelAnswerOp(task.id, answer, now));
          saveFuelMemos(rememberAnswer(fuelMemosRef.current, task.id, answer, now));
          if (answer === 'fill_on_way') {
            void armFuelReminder(task.id, { title: tRef.current('fuelCard.reminderTitle'), body: tRef.current('fuelCard.reminderBody') }, FUEL_REMINDER_AFTER_MS);
          } else void disarmFuelReminder();
        }
        // The start stop (passengers get in where the trip starts) is arrived with the start, as the server marks it
        // (trigger tasks_start_stop_arrived): no Arrived button and no arrival nudge for it.
        patchLocalTask(task.id, (item) => ({
          ...item,
          vehicle_id: vehicleId,
          status: 'in_progress',
          start_odometer_km: odometerKm,
          started_at: now,
          ...(answer ? { fuel_answer: answer, fuel_answer_at: now } : {}),
          task_stops: item.task_stops.map((stop) => (stop.is_start && stop.status === 'pending' ? { ...stop, status: 'arrived', arrived_at: now } : stop)),
        }));
        bumpOdometer(vehicleId, odometerKm);
        void playSound('start');
        beginTaskKm(task.id);
        setGpsKm(kmCounters());
        // The task's vehicle is now the one being driven: the server records it from the task's start (Phase 7);
        // the duty session opened below (when off duty) carries it too.
        if (current.current_vehicle_id !== vehicleId) {
          saveMe({ ...current, current_vehicle_id: vehicleId });
          noteHeld(vehicleId, 'task_start');
        }
        // Starting a task turns location sharing on (clocks in when off duty).
        const result = await startSharing(serviceTexts);
        setSharingState(result === 'on');
        setDutySince(getSharing()?.startedAt ?? null);
        void checkTrackingNow();
        void flushNow();
      });
    },
    [bumpOdometer, patchLocalTask, saveMe, serviceTexts, checkTrackingNow, requireLocation, noteHeld, saveFuelMemos],
  );

  const queueFuel = useCallback((fuel: FuelEntry, vehicleId: string, taskId: string | null, odometerKm: number | null, at: string) => {
    const current = meRef.current;
    if (!current) return;
    if (fuel.receipt) queuePhoto(fuel.receipt, 'fuel_receipt', current.id);
    // The video is named after the fuel log; its row goes first, the upload follows in the queue.
    const id = fuel.video?.id ?? Crypto.randomUUID();
    enqueue({
      kind: 'fuel_log',
      row: {
        id,
        vehicle_id: vehicleId,
        employee_id: current.id,
        task_id: taskId,
        litres: fuel.litres,
        amount_cents: fuel.amountCents,
        receipt_photo_id: fuel.receipt?.id ?? null,
        odometer_km: odometerKm,
        logged_at: at,
        // Round 4–7 (§33.2): petrol or diesel and the grade (none when not given).
        ...fillColumns(fuel.fill),
        ...(fuel.video
          ? {
            video_path: videoStoragePath(current.id, id, fuel.video.recordedAt),
            video_status: 'recorded',
            video_duration_s: fuel.video.durationS,
            video_bytes: fuel.video.bytes,
            video_checklist: fuel.video.marks,
            video_segments: videoSegmentRows(fuel.video, id, current.id),
            video_interrupted: fuel.video.interrupted,
          }
          : {}),
      },
    });
    if (fuel.video) queueVideoUpload(fuel.video, id, current.id);
    // Round 4–7 (§33.2): a fill on the task ends its "Fill up on the way" (the line and the reminder).
    if (taskId) {
      saveFuelMemos(rememberFilled(fuelMemosRef.current, taskId, at));
      void disarmFuelReminder();
    }
  }, [saveFuelMemos]);

  const completeTask = useCallback(
    (task: TaskWithStops, reading: OdometerEntry, fuel: FuelEntry | null) => {
      const current = meRef.current;
      if (!current) return;
      // A task under way always has its vehicle (the server refuses a start without one); the held one is a fallback.
      const vehicleId = task.vehicle_id ?? current.current_vehicle_id ?? lastVehicleRef.current;
      if (!vehicleId) return;
      const now = new Date().toISOString();
      const odometerKm = reading.km;
      queuePhoto(reading.photo, 'odometer', current.id);
      enqueue({
        kind: 'odometer_log',
        row: {
          id: Crypto.randomUUID(),
          vehicle_id: vehicleId,
          employee_id: current.id,
          task_id: task.id,
          reading_km: odometerKm,
          ocr_value: reading.ocrKm,
          photo_id: reading.photo.id,
          kind: 'task_end',
          logged_at: now,
          entry: reading.entry,
          photo_attempts: reading.attempts,
        },
      });
      if (fuel) queueFuel(fuel, vehicleId, task.id, odometerKm, now);
      // Stops can only be marked while the task is running: the ones still open are
      // skipped as "not visited" first (the driver confirmed finishing without them).
      const open = task.task_stops.filter((stop) => stop.status === 'pending' || stop.status === 'arrived');
      const skipped = { status: 'skipped', skip_reason: 'not_visited', done_at: now } as const;
      enqueue(
        ...open.map((stop) => ({ kind: 'stop_patch' as const, id: stop.id, patch: { ...skipped } })),
        { kind: 'task_patch', id: task.id, patch: { status: 'completed', end_odometer_km: odometerKm, completed_at: now } },
      );
      patchLocalTask(task.id, (item) => ({
        ...item,
        status: 'completed',
        end_odometer_km: odometerKm,
        completed_at: now,
        // After a vehicle swap the km are the stretches added up (null while a reading is owed); the last stretch ends here.
        km: taskKmSoFar(item, odometerKm),
        task_vehicle_segments: item.task_vehicle_segments?.map((g, i, all) =>
          i === all.length - 1 ? { ...g, end_odometer_km: odometerKm, to_at: now } : g
        ),
        task_stops: item.task_stops.map((stop) => (open.includes(stop) ? { ...stop, ...skipped } : stop)),
      }));
      bumpOdometer(vehicleId, odometerKm);
      void playSound('done');
      // The task is over: no "Fill up on the way" reminder after it.
      void disarmFuelReminder();
      endTaskKm();
      setGpsKm(kmCounters());
      // Round 50 (§37.2): an office person shares only during their trip: it stops at Finish (after the finish in the
      // queue, so the period closes after the trip), unless another trip of theirs runs. A driver stays on duty.
      if (shouldStopSharing({ officeDriver: officeDriverRef.current, sharing: getSharing() !== null, tasks: tasksRef.current, except: task.id })) {
        void stopTripSharing();
      }
      void flushNow();
    },
    [bumpOdometer, patchLocalTask, queueFuel, stopTripSharing],
  );

  // --- logs and reports outside a task ---------------------------------------
  const logOdometer = useCallback((reading: OdometerEntry, swap?: SwapReading) => {
    const current = meRef.current;
    // Off duty (Phase 7) the reading goes to the vehicle held last; a swap reading to its own vehicle.
    const vehicleId = swap?.vehicleId ?? current?.current_vehicle_id ?? lastVehicleRef.current;
    if (!current || !vehicleId) return;
    queuePhoto(reading.photo, 'odometer', current.id);
    enqueue({
      kind: 'odometer_log',
      row: {
        id: Crypto.randomUUID(),
        vehicle_id: vehicleId,
        employee_id: current.id,
        task_id: swap?.taskId ?? null,
        reading_km: reading.km,
        ocr_value: reading.ocrKm,
        photo_id: reading.photo.id,
        kind: swap?.kind ?? 'manual',
        logged_at: new Date().toISOString(),
        entry: reading.entry,
        photo_attempts: reading.attempts,
      },
    });
    bumpOdometer(vehicleId, reading.km);
    // The swap card follows at once (offline too): the stretch gets the reading the server's trigger will give it.
    if (swap) {
      saveTasks(tasksRef.current.map((task) => task.id !== swap.taskId ? task : {
        ...task,
        task_vehicle_segments: withSwapReading(task.task_vehicle_segments ?? [], swap, reading.km),
      }));
    }
    void flushNow();
  }, [bumpOdometer, saveTasks]);

  const logFuel = useCallback((fuel: FuelEntry, odometerKm: number | null) => {
    const current = meRef.current;
    const vehicleId = current?.current_vehicle_id ?? lastVehicleRef.current;
    if (!current || !vehicleId) return;
    const running = tasksRef.current.find((task) => task.status === 'in_progress');
    queueFuel(fuel, running?.vehicle_id ?? vehicleId, running?.id ?? null, odometerKm, new Date().toISOString());
    void flushNow();
  }, [queueFuel]);

  const sendReport = useCallback((
    category: ReportCategory,
    note: string,
    photos: LocalPhoto[],
    taskId: string | null,
    vehicleId?: string,
    needsVehicle = false,
    check?: VehicleCheck,
  ) => {
    const current = meRef.current;
    const vehicle = check?.vehicle_id ?? vehicleId ?? current?.current_vehicle_id ?? lastVehicleRef.current;
    if (!current || !vehicle) return;
    const now = new Date().toISOString();
    const row = reportRow({ id: Crypto.randomUUID(), vehicleId: vehicle, employeeId: current.id, taskId, category, note, at: now, needsVehicle, checkId: check?.id });
    // The report first, then its photos: a photo may only point at a report that exists. A pre-trip report: its check
    // before both (the report names it).
    enqueue(...(check ? problemOps(check, row, photos, current.id) : reportOps(row, photos, current.id)));
    // The phone's copy for the list (demo is the server's, set from the driver; never sent).
    const local: VehicleReport = {
      id: row.id,
      vehicle_id: vehicle,
      employee_id: current.id,
      task_id: taskId,
      category,
      note: row.note ?? null,
      created_at: now,
      needs_vehicle: needsVehicle,
      check_id: check?.id ?? null,
      status: 'open',
      closed_at: null,
      office_note: null,
      demo: current.demo,
    };
    setReports((list) => {
      const next = [local, ...list];
      setJson(KEYS.reports, next);
      return next;
    });
    void flushNow();
  }, []);

  // --- Round 4–7 (§33.2): the fuel card's "Fill up on the way" ---------------------------------------------------------
  const fillOnWay = useCallback((task: TaskWithStops) => fillOnWayPending(task, fuelMemos, shift.fuel_card), [fuelMemos, shift.fuel_card]);

  // --- Round 4–7 (§33.1): the vehicle check before work ----------------------------------------------------------------
  const checkNeeded = useCallback(
    (vehicleId: string | null | undefined) => needsCheck(vehicleId, checks, Date.now(), shift, me?.id),
    [checks, shift, me?.id],
  );
  const heldHow = useCallback((vehicleId: string) => heldHowFor(getJson<HeldHow>(KEYS.heldHow), vehicleId), []);

  const answerVehicleCheck = useCallback((input: CheckAnswer): VehicleCheck | null => {
    const current = meRef.current;
    if (!current) return null;
    const check = checkRow({
      id: Crypto.randomUUID(),
      vehicleId: input.vehicleId,
      employeeId: current.id,
      taskId: input.taskId,
      at: new Date().toISOString(),
      result: input.result,
      // The odometer when the phone knows it (the vehicle's last reading); never asked here.
      odometerKm: vehiclesRef.current.find((v) => v.id === input.vehicleId)?.current_odometer_km ?? null,
      how: input.how,
    });
    // The phone's copy at once: the card goes and Start task goes on, offline too.
    saveChecks(mergeChecks([...checksRef.current, check], [], Date.now()));
    if (input.result === 'problem') {
      const { category, note, photos } = input.report;
      sendReport(category, note, photos, input.taskId, input.vehicleId, false, check);
    } else {
      enqueue(checkOp(check));
      void flushNow();
    }
    return check;
  }, [saveChecks, sendReport]);

  const addCheckPhotos = useCallback((check: VehicleCheck, shots: { side: CheckSide; photo: LocalPhoto }[]) => {
    const current = meRef.current;
    if (!current || shots.length === 0) return;
    enqueue(...sidePhotoOps(check, shots, current.id));
    void flushNow();
  }, []);

  // A check the server refused for good (a phone clock far ahead): not on the server, so the question comes back.
  useEffect(() => onOpRefused((op) => {
    if (op.kind === 'vehicle_check') saveChecks(checksRef.current.filter((check) => check.id !== op.row.id));
  }), [saveChecks]);

  // --- Phase 7 Part 3: the driver's photo and vehicle photos ------------------------
  const saveProfilePhoto = useCallback(async (photo: LocalProfilePhoto): Promise<ProfilePhotoOutcome> => {
    const current = meRef.current;
    if (!current) return 'failed';
    try {
      const answer = await api.saveProfilePhoto(
        supabase,
        { id: photo.id, employee_id: current.id, storage_path: profilePhotoPath(current.id, photo.id), taken_at: photo.takenAt },
        (path) => uploadPhotoFile(photo.uri, path),
      );
      if (answer !== 'ok') return 'failed';
    } catch (error) {
      return error instanceof api.ApiError && error.permanent ? 'failed' : 'network';
    }
    // The new photo stays on the phone for Me; the one before it goes.
    const before = getJson<KeptProfilePhoto>(KEYS.profilePhoto);
    if (before && before.uri !== photo.uri) removeFile(before.uri);
    setJson(KEYS.profilePhoto, { photoId: photo.id, uri: photo.uri } satisfies KeptProfilePhoto);
    const now = meRef.current;
    if (now) saveMe({ ...now, photo_id: photo.id, photo_updated_at: new Date().toISOString() });
    return 'ok';
  }, [saveMe]);

  const addVehiclePhoto = useCallback((op: VehiclePhotoOp) => {
    enqueue(op);
    void flushNow();
  }, []);

  // --- Phase 7 §13: trips the driver starts ------------------------------------------
  const dataRef = useRef(dataAvailable);
  dataRef.current = dataAvailable;

  /**
   * Whether a trip (or its stop) can go straight to driver-api: a connection, and nothing waiting in the queue that must
   * reach the server first (a finish, a vehicle change, a duty period). What waits gets a short chance to go first.
   */
  const canGoDirect = useCallback(async (): Promise<boolean> => {
    if (!dataRef.current) return false;
    if (opsBeforeTrip() > 0) {
      await Promise.race([flushNow(true), new Promise((resolve) => setTimeout(resolve, TRIP_FLUSH_WAIT_MS))]);
    }
    return opsBeforeTrip() === 0;
  }, []);

  // Hotfix 2 (J): the vehicle of a task made without one, before its start. Online the server answers at once (a
  // refusal is said on the screen); with no connection (or no answer) it is queued, so it goes before the start's ops.
  const confirmTaskVehicle = useCallback(async (task: TaskWithStops, vehicleId: string): Promise<ConfirmVehicleOutcome> => {
    const setLocal = () => patchLocalTask(task.id, (item) => ({ ...item, vehicle_id: vehicleId }));
    const queue = (): ConfirmVehicleOutcome => {
      enqueue(taskVehicleOp(task.id, vehicleId, new Date().toISOString()));
      setLocal();
      void flushNow();
      return { kind: 'queued' };
    };
    if (!dataRef.current) return queue();
    try {
      const answer = await api.confirmTaskVehicle(supabase, task.id, vehicleId);
      if (answer === 'ok') {
        setLocal();
        return { kind: 'ok' };
      }
      // The task moved on meanwhile (another driver, started, a vehicle set by the office): the list is read again.
      if (answer === 'not_yours' || answer === 'started' || answer === 'has_vehicle') void refresh();
      return { kind: 'refused', answer };
    } catch (error) {
      if (error instanceof api.ApiError && error.permanent) return { kind: 'refused', answer: error.message };
      return queue();
    }
  }, [patchLocalTask, refresh]);

  const rememberPick = useCallback((pick: Choice) => {
    const place = knownFromPick(pick);
    if (!place) return;
    setPickedPlaces((list) => {
      const next = rememberPlace(list, place);
      setJson(KEYS.tripPicked, next);
      return next;
    });
  }, []);

  const startTrip = useCallback(async ({ purpose, pick, note }: { purpose: Purpose; pick: Choice; note: string }): Promise<StartTripOutcome> => {
    const current = meRef.current;
    if (!current) return { kind: 'refused', message: '' };
    if (tasksRef.current.some((task) => task.status === 'in_progress')) return { kind: 'task_running' };
    const vehicleId = current.current_vehicle_id;
    if (!vehicleId) return { kind: 'no_vehicle' };
    // The first stop's id is the phone's too (the server keeps it): Arrived and Done queued before the trip land on it.
    const localStopId = Crypto.randomUUID();
    const request = tripRequest({ id: Crypto.randomUUID(), stopId: localStopId, purpose, pick, note, vehicleId, at: new Date().toISOString() });
    const local = localTrip({ request, pick, employeeId: current.id, employeeName: current.name, vehicleId, localStopId });
    const keep = (task: TaskWithStops) => {
      pendingTrips.current.add(task.id);
      saveTasks([...tasksRef.current.filter((item) => item.id !== task.id), task].sort((a, b) => a.start_at.localeCompare(b.start_at)));
      rememberPick(pick);
    };
    let offline = !dataRef.current;
    if (await canGoDirect()) {
      try {
        const answer = await driverApi.createTrip(request);
        keep(withCard(local, answer.trip, localStopId));
        return { kind: 'started', taskId: request.id, queued: false, offline: false };
      } catch (error) {
        if (error instanceof api.ApiError && error.permanent) return { kind: 'refused', message: error.message };
        // No answer: kept on the phone below. If the server did make it, the same id makes the queue's send harmless.
        offline = true;
      }
    }
    // The queue sends it before the Start task that follows (queue order); the phone's copy lets that start run now.
    enqueue(tripCreateOp(request, localStopId, pick));
    keep(local);
    void flushNow();
    return { kind: 'started', taskId: request.id, queued: true, offline };
  }, [canGoDirect, rememberPick, saveTasks]);

  const addTripStop = useCallback(async (task: TaskWithStops, pick: Choice): Promise<AddStopOutcome> => {
    if (!canAddStop(task)) return { kind: 'full' };
    const request = stopRequest(Crypto.randomUUID(), pick);
    let offline = !dataRef.current;
    if (await canGoDirect()) {
      try {
        const answer = await driverApi.addTripStop(task.id, request);
        patchLocalTask(task.id, (item) => withCard(withAddedStop(item, request.id, pick), answer.trip));
        rememberPick(pick);
        return { kind: 'added', queued: false, offline: false };
      } catch (error) {
        if (error instanceof api.ApiError && error.permanent) return { kind: 'refused', message: error.message };
        offline = true;
      }
    }
    enqueue(tripStopOp(task.id, request, pick));
    patchLocalTask(task.id, (item) => withAddedStop(item, request.id, pick));
    rememberPick(pick);
    void flushNow();
    return { kind: 'added', queued: true, offline };
  }, [canGoDirect, patchLocalTask, rememberPick]);

  // A trip started by mistake: cancelled on the server while it has not started (online only: a trip still waiting in the
  // queue is sent first, as with a direct start).
  const cancelTrip = useCallback(async (task: TaskWithStops): Promise<CancelTripOutcome> => {
    if (!isSelfTrip(task) || task.status !== 'assigned') return { kind: 'refused', message: '' };
    if (!(await canGoDirect())) return { kind: 'offline' };
    try {
      await driverApi.cancelTrip(task.id);
      pendingTrips.current.delete(task.id);
      saveTasks(tasksRef.current.filter((item) => item.id !== task.id));
      return { kind: 'cancelled' };
    } catch (error) {
      if (error instanceof api.ApiError && error.permanent) return { kind: 'refused', message: error.message };
      return { kind: 'offline' };
    }
  }, [canGoDirect, saveTasks]);

  // A queued trip or stop reached the server: the phone's copy takes its ids (the first stop's) and pins.
  useEffect(() => onTripSent((op, answer) => {
    if (!tasksRef.current.some((task) => task.id === answer.trip.task_id)) return;
    patchLocalTask(answer.trip.task_id, (item) => withCard(item, answer.trip, op.kind === 'trip_create' ? op.local_stop_id : null));
  }), [patchLocalTask]);

  // The server refused a queued trip or stop for good (kept, failed: Me can try it again): the driver is told why.
  useEffect(() => onOpRefused((op, message) => {
    if (op.kind === 'trip_create') {
      // Not on the server: the next refresh leaves the phone's copy out.
      pendingTrips.current.delete(op.id);
      if (kmCounters().taskId === op.id) endTaskKm();
      setTripProblem({ key: 'trip.failed', reason: message });
    } else if (op.kind === 'trip_stop') {
      setTripProblem({ key: 'trip.stopFailed', reason: message });
    } else if (op.kind === 'task_vehicle') {
      // Hotfix 2 (J): the vehicle confirmed offline was refused (the start behind it is refused too and kept): why, in
      // words, and the server's copy of the task again (no vehicle: Start task asks for one again).
      const task = tasksRef.current.find((item) => item.id === op.id);
      const plate = vehiclesRef.current.find((v) => v.id === op.vehicle_id)?.reg_no ?? '';
      setTripProblem({ key: 'vehicleConfirm.failed', reason: refusalWords(tRef.current, refusedAnswer(message), plate, task ? wantedType(task) : null) });
      void refreshRef.current();
    }
  }), []);

  // --- Part 3b: answers to the office's questions (H3), Running late (H4), the profile (G) ------------------------
  useEffect(() => onAskSent((op, reply) => {
    replies.current.set(op.client_id, reply === 'ok' ? { kind: 'sent' } : reply === 'expired' ? { kind: 'expired' } : { kind: 'failed', message: reply });
    // Closed before the answer was given, or not taken: the server's copy again.
    if (reply !== 'ok') void loadAsksRef.current();
  }), []);
  useEffect(() => onLateSent((op, reply) => {
    replies.current.set(op.client_id, reply === 'ok' ? { kind: 'sent' } : { kind: 'closed' });
    if (reply !== 'ok') void refreshRef.current();
  }), []);
  useEffect(() => onOpRefused((op, message) => {
    if (op.kind === 'ask_answer' || op.kind === 'task_late') replies.current.set(op.client_id, { kind: 'failed', message });
  }), []);

  /** Sends what waits (a moment at most, with a connection) and says what became of the op with this client id. */
  const waitForReply = useCallback(async (clientId: string): Promise<SendOutcome> => {
    if (dataRef.current) await Promise.race([flushNow(true), new Promise((resolve) => setTimeout(resolve, SEND_WAIT_MS))]);
    else void flushNow();
    const reply = replies.current.get(clientId);
    replies.current.delete(clientId);
    return reply ?? { kind: 'queued' };
  }, []);

  const answerAsk = useCallback(async (ask: AskRow, input: AskAnswerInput): Promise<SendOutcome> => {
    const at = new Date().toISOString();
    const clientId = Crypto.randomUUID();
    enqueue(askAnswerOp(ask.ask_id, clientId, input, at));
    // The phone's copy at once (offline too): the banner goes, the screen shows the answer.
    const known = asksRef.current.some((a) => a.ask_id === ask.ask_id) ? asksRef.current : mergeAsk(asksRef.current, ask);
    saveAsks(withAnswer(known, ask.ask_id, input, at));
    setAsksWaiting(waitingAskAnswers());
    return waitForReply(clientId);
  }, [saveAsks, waitForReply]);

  const reportLate = useCallback(async (task: TaskWithStops, minutes: number): Promise<SendOutcome> => {
    const at = new Date().toISOString();
    const clientId = Crypto.randomUUID();
    enqueue({ kind: 'task_late', id: task.id, client_id: clientId, minutes, at });
    patchLocalTask(task.id, (item) => ({ ...item, late_report_min: minutes, late_report_at: at }));
    return waitForReply(clientId);
  }, [patchLocalTask, waitForReply]);

  const saveProfile = useCallback(async (patch: ProfilePatch, photos: Partial<Record<LicenceSide, LocalPhoto>>): Promise<ProfileSaveOutcome> => {
    const current = meRef.current;
    if (!current) return { kind: 'refused', message: '' };
    try {
      if (Object.keys(patch).length > 0) {
        const answer = await driverApi.saveProfile(patch);
        const now = meRef.current;
        if (now) saveMe({ ...now, ...answer.profile });
      }
      for (const side of ['front', 'back'] as const) {
        const photo = photos[side];
        if (!photo) continue;
        const answer = await api.saveLicencePhoto(
          supabase,
          { id: photo.id, employee_id: current.id, storage_path: licencePhotoPath(current.id, photo.id), taken_at: photo.takenAt },
          side,
          (path) => uploadPhotoFile(photo.uri, path),
        );
        if (answer !== 'ok') return { kind: 'refused', message: answer };
        // The new photo stays on the phone for Me; the one before it goes.
        const kept = getJson<KeptLicencePhotos>(KEYS.licencePhotos) ?? {};
        const before = kept[side];
        if (before && before.uri !== photo.uri) removeFile(before.uri);
        setJson(KEYS.licencePhotos, { ...kept, [side]: { photoId: photo.id, uri: photo.uri } } satisfies KeptLicencePhotos);
        const now = meRef.current;
        if (now) saveMe({ ...now, ...(side === 'front' ? { licence_front_photo_id: photo.id } : { licence_back_photo_id: photo.id }) });
      }
      return { kind: 'ok' };
    } catch (error) {
      return error instanceof api.ApiError && error.permanent ? { kind: 'refused', message: error.message } : { kind: 'network' };
    }
  }, [saveMe]);

  const knownPlaces = useMemo(() => mergeKnown(pickedPlaces, knownFromTasks(tasks), ourPlaces), [pickedPlaces, tasks, ourPlaces]);
  const taskContacts = useMemo(
    () => Object.fromEntries(Object.entries(keptContacts).flatMap(([id, kept]) => (kept.contacts ? [[id, kept.contacts]] : []))) as Record<string, TaskContacts>,
    [keptContacts],
  );

  const vehicle = useMemo(
    () => vehicles.find((item) => item.id === me?.current_vehicle_id) ?? null,
    [vehicles, me?.current_vehicle_id],
  );
  const workVehicle = useMemo(
    () => vehicle ?? vehicles.find((item) => item.id === lastVehicleId) ?? null,
    [vehicle, vehicles, lastVehicleId],
  );

  const value: AppValue = {
    booted, me, meFresh, language, t, tList, setLanguage,
    vehicles, vehicle, workVehicle, tasks, reports, sharing, tracking, gpsKm, live, queue, settings: shift, wifiOnly, setWifiOnly, waitingTasks, refreshing, offline, dataAvailable,
    gate, resolveGate, requireLocation,
    signIn, signOut, officeDriver, driving: drivingShown(officeDriver, drivingView), enterDriving, leaveDriving, showDriving, officeSignOutCheck, loadDriveTrips,
    refresh, sendNow, setSharing, checkTrackingNow, checkUpdate, registerPush, chooseVehicle, markSeen, markStopArrived, markStopDone, undoStopStep, markStopPassed, skipStop,
    dutySince, startWork, changeVehicle, finishWork, loadVehicleChoices, vehicleTaken, dismissVehicleTaken, dutyEnded, clearDutyEnded,
    acceptTask, declineTask, notice, clearNotice,
    startTask, completeTask, logOdometer, logFuel, fillOnWay, sendReport,
    vehicleChecks: checks, checkNeeded, heldHow, answerVehicleCheck, addCheckPhotos,
    saveProfilePhoto, pendingVehiclePhotos: vehiclePhotos, addVehiclePhoto,
    knownPlaces, loadKnownPlaces, startTrip, addTripStop, cancelTrip, tripProblem, clearTripProblem,
    confirmTaskVehicle, taskContacts, loadTaskContacts, officeContacts, loadOfficeContacts,
    changesFor, seenCopyOf, pushChangesOf, rememberShown, markPreviewed, rememberPush,
    asks, asksWaiting, loadAsks, loadAsk, markAskSeen, answerAsk, reportLate, saveProfile,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
