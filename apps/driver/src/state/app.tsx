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
import { ensureChannels, notifyNewTask, onNotificationTap } from '@/lib/notifications';
import { registerTrackingCheck, unregisterTrackingCheck } from '@/lib/backgroundTask';
import { pushToken, registerPush, unregisterPush } from '@/lib/push';
import { playSound } from '@/lib/sounds';
import { type LocalPhoto, prepareOdometerReader, queuePhoto } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { colomboDate, colomboTime, startOfColomboDay } from '@/lib/time';
import { beginTaskKm, endTaskKm, type KmCounters, kmCounters, resetOdometerKm } from '@/lib/tracking';
import type { Employee, Language, ReportCategory, TaskStop, TaskWithStops, Vehicle, VehicleReport } from '@/lib/types';
import { applyDownloadedUpdate, checkForUpdate, forgetDownloadedUpdate, type UpdateOutcome } from '@/lib/updates';
import { enqueue, flushNow, onQueueChange } from '@/sync';
import { clearQueue, queueCounts, type QueueCounts, retryFailed, tasksWaiting } from '@/sync/store';

export type SignInOutcome = 'ok' | 'wrong' | 'network' | 'switched_off' | 'not_configured';
export type SignOutOutcome = 'ok' | 'task' | 'queue';
export type LiveStatus = 'connected' | 'connecting' | 'off';

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
}

/** How an odometer reading was arrived at (see app/log-mileage.tsx). The server adds what it read. */
export type OdometerEntryKind = 'photo' | 'photo_changed' | 'typed_unreadable' | 'typed_offline';

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

interface AppValue {
  /** false until the saved sign-in has been checked. */
  booted: boolean;
  me: Employee | null;
  language: Language;
  t: (key: string, vars?: Vars) => string;
  tList: (key: string) => string[];
  setLanguage: (language: Language) => void;

  vehicles: Vehicle[];
  /** The driver's current vehicle. */
  vehicle: Vehicle | null;
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
  /** Tasks with a start or finish that has not reached the office yet. */
  waitingTasks: Set<string>;
  refreshing: boolean;
  offline: boolean;

  /** The Location cover, when it is up. */
  gate: GateState | null;
  /** The cover reports: Location is on now ('ready'), or the driver chose "Not now". */
  resolveGate: (outcome: GateOutcome) => void;
  /** Runs the action once Location is on (showing the cover first if it is not); false when the driver cancelled. */
  requireLocation: (purpose: 'start' | 'sharing', action: () => Promise<void> | void) => Promise<boolean>;

  signIn: (username: string, pin: string) => Promise<SignInOutcome>;
  signOut: () => Promise<SignOutOutcome>;
  refresh: () => Promise<void>;
  sendNow: (includeFailed?: boolean) => Promise<void>;
  setSharing: (on: boolean) => Promise<'on' | 'off' | 'no_permission' | 'cancelled'>;
  checkTrackingNow: () => Promise<void>;
  checkUpdate: () => Promise<UpdateOutcome>;
  /** Registers this phone for push notifications (after sign-in, and when notifications are allowed). */
  registerPush: () => Promise<boolean>;
  chooseVehicle: (vehicleId: string) => void;
  markSeen: (taskIds: string[]) => void;
  markStopDone: (stop: TaskStop) => void;
  /** false when Location stayed off and the driver chose "Not now": nothing was started. */
  startTask: (task: TaskWithStops, reading: OdometerEntry) => Promise<boolean>;
  completeTask: (task: TaskWithStops, reading: OdometerEntry, fuel: FuelEntry | null) => void;
  logOdometer: (reading: OdometerEntry) => void;
  logFuel: (fuel: FuelEntry, odometerKm: number | null) => void;
  sendReport: (category: ReportCategory, note: string, photos: LocalPhoto[], taskId: string | null, vehicleId?: string) => void;
}

const AppContext = createContext<AppValue | null>(null);

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
  const [language, setLanguageState] = useState<Language>(() => getJson<Language>(KEYS.language) ?? deviceLanguage());
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => getJson<Vehicle[]>(KEYS.vehicles) ?? []);
  const [tasks, setTasks] = useState<TaskWithStops[]>(() => getJson<TaskWithStops[]>(KEYS.tasks) ?? []);
  const [reports, setReports] = useState<VehicleReport[]>(() => getJson<VehicleReport[]>(KEYS.reports) ?? []);
  const [sharing, setSharingState] = useState(() => getSharing() !== null);
  const [tracking, setTracking] = useState<TrackingStatus>(TRACKING_OFF);
  const [gpsKm, setGpsKm] = useState<KmCounters>(() => kmCounters());
  const [live, setLive] = useState<LiveStatus>('off');
  const [liveGeneration, setLiveGeneration] = useState(0);
  const [queue, setQueue] = useState<QueueCounts>(() => queueCounts());
  const [waitingTasks, setWaitingTasks] = useState<Set<string>>(() => tasksWaiting());
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [gate, setGate] = useState<GateState | null>(null);
  const gateResolve = useRef<((outcome: GateOutcome) => void) | null>(null);

  // The newest values, for callbacks that run later.
  const meRef = useRef(me);
  meRef.current = me;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const seenQueued = useRef(new Set<string>());
  const liveRef = useRef<LiveStatus>('off');

  const t = useCallback((key: string, vars?: Vars) => translate(language, key, vars), [language]);
  const tList = useCallback((key: string) => translateList(language, key), [language]);
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

  const forgetEverything = useCallback(() => {
    saveMe(null);
    saveTasks([]);
    setVehicles([]);
    setReports([]);
    remove(KEYS.vehicles);
    remove(KEYS.reports);
    remove(KEYS.permissionsSeen);
    remove(KEYS.track);
    clearQueue();
    seenQueued.current.clear();
  }, [saveMe, saveTasks]);

  /** New code may start only when no task is in progress and nothing is waiting to be sent. */
  const safeToApplyUpdate = useCallback(() => {
    const counts = queueCounts();
    return !tasksRef.current.some((task) => task.status === 'in_progress') && counts.ops === 0 && counts.points === 0;
  }, []);

  const refresh = useCallback(async () => {
    if (!meRef.current) return;
    setRefreshing(true);
    try {
      const sent = await flushNow();
      const [row, vehicleRows, taskRows, reportRows] = await Promise.all([
        api.fetchMe(supabase),
        api.fetchVehicles(supabase),
        api.fetchTasks(supabase, startOfColomboDay(colomboDate())),
        api.fetchReports(supabase),
      ]);
      if (!row) {
        // The office switched this account off.
        await stopSharing('auto');
        setSharingState(false);
        await supabase.auth.signOut({ scope: 'local' });
        forgetEverything();
        return;
      }
      saveMe(row);
      setVehicles(vehicleRows);
      setJson(KEYS.vehicles, vehicleRows);
      setReports(reportRows);
      setJson(KEYS.reports, reportRows);
      // While something is still waiting on the phone, keep what the driver did rather than the older server copy.
      if (!sent.offline) saveTasks(taskRows);
      setOffline(sent.offline);
    } catch {
      setOffline(true);
    } finally {
      setRefreshing(false);
    }
  }, [forgetEverything, saveMe, saveTasks]);

  /** Looks at the location service and tells the screens what it found. */
  const checkTrackingNow = useCallback(async () => {
    if (!meRef.current) return;
    try {
      const status = await checkTracking(serviceTexts);
      setTracking(status);
      setSharingState(status.sharing);
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
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        if (meRef.current) forgetEverything();
      } else if (meRef.current) {
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
        void applyDownloadedUpdate(safeToApplyUpdate);
      }),
    [safeToApplyUpdate],
  );

  // Coming back to the front: check the location service, reconnect live updates
  // if they dropped, refresh, and look for a code update (at most every 30 min).
  // Also refresh when the connection returns.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void checkTrackingNow();
      if (liveRef.current !== 'connected') setLiveGeneration((n) => n + 1);
      void refresh();
      void checkForUpdate(safeToApplyUpdate);
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isInternetReachable) void refresh();
    });
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
        // A phone with a push token hears about the task from the server; the others from here.
        if (change.eventType === 'INSERT' && !pushToken()) {
          const task = change.new as { id?: string; title?: string; start_at?: string };
          void notifyNewTask(t('today.newTask'), [task.start_at ? colomboTime(task.start_at) : '', task.title ?? ''].join(' ').trim(), task.id ?? '');
        }
        void refresh();
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
    await stopSharing('driver');
    setSharingState(false);
    setTracking(TRACKING_OFF);
    await flushNow();
    const left = queueCounts();
    if (left.ops > 0 || left.points > 0) return 'queue';
    await unregisterPush();
    await unregisterTrackingCheck();
    await supabase.auth.signOut({ scope: 'local' });
    forgetEverything();
    return 'ok';
  }, [forgetEverything]);

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
      void sendHeartbeat(); // the office hears "not sharing" at once
      return 'off' as const;
    }
    const outcome = { result: 'no_permission' as StartResult };
    const went = await requireLocation('sharing', async () => {
      outcome.result = await startSharing(serviceTexts);
    });
    if (!went) return 'cancelled' as const;
    setSharingState(outcome.result === 'on');
    if (outcome.result === 'on') void checkTrackingNow();
    return outcome.result;
  }, [serviceTexts, checkTrackingNow, requireLocation]);

  const chooseVehicle = useCallback((vehicleId: string) => {
    const current = meRef.current;
    if (!current || current.current_vehicle_id === vehicleId) return;
    saveMe({ ...current, current_vehicle_id: vehicleId });
    enqueue({ kind: 'employee_patch', id: current.id, patch: { current_vehicle_id: vehicleId } });
    void flushNow();
  }, [saveMe]);

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

  const markStopDone = useCallback((stop: TaskStop) => {
    const now = new Date().toISOString();
    enqueue({ kind: 'stop_patch', id: stop.id, patch: { status: 'done', done_at: now } });
    patchLocalTask(stop.task_id, (task) => ({
      ...task,
      task_stops: task.task_stops.map((item) => (item.id === stop.id ? { ...item, status: 'done', done_at: now } : item)),
    }));
    void flushNow();
  }, [patchLocalTask]);

  const startTask = useCallback(
    (task: TaskWithStops, reading: OdometerEntry) => requireLocation('start', async () => {
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
            vehicle_id: task.vehicle_id,
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
      patchLocalTask(task.id, (item) => ({ ...item, status: 'in_progress', start_odometer_km: odometerKm, started_at: now }));
      bumpOdometer(task.vehicle_id, odometerKm);
      void playSound('start');
      beginTaskKm(task.id);
      setGpsKm(kmCounters());
      // The task's vehicle is now the one being driven.
      if (current.current_vehicle_id !== task.vehicle_id) {
        saveMe({ ...current, current_vehicle_id: task.vehicle_id });
        enqueue({ kind: 'employee_patch', id: current.id, patch: { current_vehicle_id: task.vehicle_id } });
      }
      // Starting a task turns location sharing on.
      const result = await startSharing(serviceTexts);
      setSharingState(result === 'on');
      void checkTrackingNow();
      void flushNow();
    }),
    [bumpOdometer, patchLocalTask, saveMe, serviceTexts, checkTrackingNow, requireLocation],
  );

  const queueFuel = useCallback((fuel: FuelEntry, vehicleId: string, taskId: string | null, odometerKm: number | null, at: string) => {
    const current = meRef.current;
    if (!current) return;
    if (fuel.receipt) queuePhoto(fuel.receipt, 'fuel_receipt', current.id);
    enqueue({
      kind: 'fuel_log',
      row: {
        id: Crypto.randomUUID(),
        vehicle_id: vehicleId,
        employee_id: current.id,
        task_id: taskId,
        litres: fuel.litres,
        amount_cents: fuel.amountCents,
        receipt_photo_id: fuel.receipt?.id ?? null,
        odometer_km: odometerKm,
        logged_at: at,
      },
    });
  }, []);

  const completeTask = useCallback(
    (task: TaskWithStops, reading: OdometerEntry, fuel: FuelEntry | null) => {
      const current = meRef.current;
      if (!current) return;
      const now = new Date().toISOString();
      const odometerKm = reading.km;
      queuePhoto(reading.photo, 'odometer', current.id);
      enqueue({
        kind: 'odometer_log',
        row: {
          id: Crypto.randomUUID(),
          vehicle_id: task.vehicle_id,
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
      if (fuel) queueFuel(fuel, task.vehicle_id, task.id, odometerKm, now);
      // Stops can only be marked while the task is running, so close the open ones first.
      const open = task.task_stops.filter((stop) => stop.status === 'pending' || stop.status === 'arrived');
      enqueue(
        ...open.map((stop) => ({ kind: 'stop_patch' as const, id: stop.id, patch: { status: 'done', done_at: now } })),
        { kind: 'task_patch', id: task.id, patch: { status: 'completed', end_odometer_km: odometerKm, completed_at: now } },
      );
      patchLocalTask(task.id, (item) => ({
        ...item,
        status: 'completed',
        end_odometer_km: odometerKm,
        completed_at: now,
        km: item.start_odometer_km === null ? null : odometerKm - item.start_odometer_km,
        task_stops: item.task_stops.map((stop) => (open.includes(stop) ? { ...stop, status: 'done', done_at: now } : stop)),
      }));
      bumpOdometer(task.vehicle_id, odometerKm);
      void playSound('done');
      endTaskKm();
      setGpsKm(kmCounters());
      void flushNow();
    },
    [bumpOdometer, patchLocalTask, queueFuel],
  );

  // --- logs and reports outside a task ---------------------------------------
  const logOdometer = useCallback((reading: OdometerEntry) => {
    const current = meRef.current;
    if (!current?.current_vehicle_id) return;
    queuePhoto(reading.photo, 'odometer', current.id);
    enqueue({
      kind: 'odometer_log',
      row: {
        id: Crypto.randomUUID(),
        vehicle_id: current.current_vehicle_id,
        employee_id: current.id,
        task_id: null,
        reading_km: reading.km,
        ocr_value: reading.ocrKm,
        photo_id: reading.photo.id,
        kind: 'manual',
        logged_at: new Date().toISOString(),
        entry: reading.entry,
        photo_attempts: reading.attempts,
      },
    });
    bumpOdometer(current.current_vehicle_id, reading.km);
    void flushNow();
  }, [bumpOdometer]);

  const logFuel = useCallback((fuel: FuelEntry, odometerKm: number | null) => {
    const current = meRef.current;
    if (!current?.current_vehicle_id) return;
    const running = tasksRef.current.find((task) => task.status === 'in_progress');
    queueFuel(fuel, running?.vehicle_id ?? current.current_vehicle_id, running?.id ?? null, odometerKm, new Date().toISOString());
    void flushNow();
  }, [queueFuel]);

  const sendReport = useCallback((category: ReportCategory, note: string, photos: LocalPhoto[], taskId: string | null, vehicleId?: string) => {
    const current = meRef.current;
    const vehicle = vehicleId ?? current?.current_vehicle_id;
    if (!current || !vehicle) return;
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      vehicle_id: vehicle,
      employee_id: current.id,
      task_id: taskId,
      category,
      note: note.trim() === '' ? null : note.trim(),
      created_at: now,
    };
    // The report first, then its photos: a photo may only point at a report that exists.
    enqueue({ kind: 'report', row });
    for (const photo of photos) queuePhoto(photo, 'vehicle_report', current.id, id);
    setReports((list) => {
      const next = [{ ...row, status: 'open', closed_at: null, office_note: null }, ...list];
      setJson(KEYS.reports, next);
      return next;
    });
    void flushNow();
  }, []);

  const vehicle = useMemo(
    () => vehicles.find((item) => item.id === me?.current_vehicle_id) ?? null,
    [vehicles, me?.current_vehicle_id],
  );

  const value: AppValue = {
    booted, me, language, t, tList, setLanguage,
    vehicles, vehicle, tasks, reports, sharing, tracking, gpsKm, live, queue, waitingTasks, refreshing, offline,
    gate, resolveGate, requireLocation,
    signIn, signOut, refresh, sendNow, setSharing, checkTrackingNow, checkUpdate, registerPush, chooseVehicle, markSeen, markStopDone,
    startTask, completeTask, logOdometer, logFuel, sendReport,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
