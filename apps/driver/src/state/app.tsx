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
import { getSharing, restoreSharing, startSharing, stopSharing } from '@/lib/location';
import { notifyNewTask } from '@/lib/notifications';
import { type LocalPhoto, queuePhoto } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { colomboDate, colomboTime, startOfColomboDay } from '@/lib/time';
import type { Employee, Language, ReportCategory, TaskStop, TaskWithStops, Vehicle, VehicleReport } from '@/lib/types';
import { enqueue, flushNow, onQueueChange } from '@/sync';
import { clearQueue, queueCounts, type QueueCounts, retryFailed, tasksWaiting } from '@/sync/store';

export type SignInOutcome = 'ok' | 'wrong' | 'network' | 'switched_off' | 'not_configured';
export type SignOutOutcome = 'ok' | 'task' | 'queue';

export interface FuelEntry {
  litres: number | null;
  amountCents: number | null;
  receipt: LocalPhoto | null;
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
  queue: QueueCounts;
  /** Tasks with a start or finish that has not reached the office yet. */
  waitingTasks: Set<string>;
  refreshing: boolean;
  offline: boolean;

  signIn: (username: string, pin: string) => Promise<SignInOutcome>;
  signOut: () => Promise<SignOutOutcome>;
  refresh: () => Promise<void>;
  sendNow: (includeFailed?: boolean) => Promise<void>;
  setSharing: (on: boolean) => Promise<'on' | 'off' | 'no_permission'>;
  chooseVehicle: (vehicleId: string) => void;
  markSeen: (taskIds: string[]) => void;
  markStopDone: (stop: TaskStop) => void;
  startTask: (task: TaskWithStops, odometerKm: number, ocrKm: number | null, photo: LocalPhoto | null) => Promise<void>;
  completeTask: (
    task: TaskWithStops,
    odometerKm: number,
    ocrKm: number | null,
    photo: LocalPhoto | null,
    fuel: FuelEntry | null,
  ) => void;
  logOdometer: (odometerKm: number, ocrKm: number | null, photo: LocalPhoto | null) => void;
  logFuel: (fuel: FuelEntry, odometerKm: number | null) => void;
  sendReport: (category: ReportCategory, note: string, photos: LocalPhoto[], taskId: string | null) => void;
}

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [me, setMe] = useState<Employee | null>(() => getJson<Employee>(KEYS.me));
  const [language, setLanguageState] = useState<Language>(() => getJson<Language>(KEYS.language) ?? deviceLanguage());
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => getJson<Vehicle[]>(KEYS.vehicles) ?? []);
  const [tasks, setTasks] = useState<TaskWithStops[]>(() => getJson<TaskWithStops[]>(KEYS.tasks) ?? []);
  const [reports, setReports] = useState<VehicleReport[]>(() => getJson<VehicleReport[]>(KEYS.reports) ?? []);
  const [sharing, setSharingState] = useState(() => getSharing() !== null);
  const [queue, setQueue] = useState<QueueCounts>(() => queueCounts());
  const [waitingTasks, setWaitingTasks] = useState<Set<string>>(() => tasksWaiting());
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  // The newest values, for callbacks that run later.
  const meRef = useRef(me);
  meRef.current = me;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const seenQueued = useRef(new Set<string>());

  const t = useCallback((key: string, vars?: Vars) => translate(language, key, vars), [language]);
  const tList = useCallback((key: string) => translateList(language, key), [language]);
  const serviceTexts = useMemo(() => ({ title: t('service.title'), body: t('service.body') }), [t]);

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
    clearQueue();
    seenQueued.current.clear();
  }, [saveMe, saveTasks]);

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

  // --- start-up -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        if (meRef.current) forgetEverything();
      } else if (meRef.current) {
        setSharingState(await restoreSharing(serviceTexts));
        void refresh();
      }
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once: later sign-ins go through signIn().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the queue numbers on screen up to date.
  useEffect(
    () =>
      onQueueChange(() => {
        setQueue(queueCounts());
        setWaitingTasks(tasksWaiting());
      }),
    [],
  );

  // Refresh when the app comes back to the front and when the connection returns.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const network = Network.addNetworkStateListener((state) => {
      if (state.isInternetReachable) void refresh();
    });
    return () => {
      appState.remove();
      network.remove();
    };
  }, [refresh]);

  // Live updates: the office assigns, changes or cancels one of my tasks.
  const myId = me?.id;
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      .channel(`my-tasks-${myId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `employee_id=eq.${myId}` }, (change) => {
        if (change.eventType === 'INSERT') {
          const task = change.new as { title?: string; start_at?: string };
          void notifyNewTask(t('today.newTask'), [task.start_at ? colomboTime(task.start_at) : '', task.title ?? ''].join(' ').trim());
        }
        void refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [myId, refresh, t]);

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
    await flushNow();
    const left = queueCounts();
    if (left.ops > 0 || left.points > 0) return 'queue';
    await supabase.auth.signOut({ scope: 'local' });
    forgetEverything();
    return 'ok';
  }, [forgetEverything]);

  const sendNow = useCallback(async (includeFailed = false) => {
    if (includeFailed) retryFailed();
    await refresh();
  }, [refresh]);

  // --- sharing and vehicle ----------------------------------------------------
  const setSharing = useCallback(async (on: boolean) => {
    if (!on) {
      await stopSharing('driver');
      setSharingState(false);
      return 'off' as const;
    }
    const result = await startSharing(serviceTexts);
    setSharingState(result === 'on');
    return result;
  }, [serviceTexts]);

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
    async (task: TaskWithStops, odometerKm: number, ocrKm: number | null, photo: LocalPhoto | null) => {
      const current = meRef.current;
      if (!current) return;
      const now = new Date().toISOString();
      if (photo) queuePhoto(photo, 'odometer', current.id);
      enqueue(
        {
          kind: 'odometer_log',
          row: {
            id: Crypto.randomUUID(),
            vehicle_id: task.vehicle_id,
            employee_id: current.id,
            task_id: task.id,
            reading_km: odometerKm,
            ocr_value: ocrKm,
            photo_id: photo?.id ?? null,
            kind: 'task_start',
            logged_at: now,
          },
        },
        { kind: 'task_patch', id: task.id, patch: { status: 'in_progress', start_odometer_km: odometerKm, started_at: now } },
      );
      patchLocalTask(task.id, (item) => ({ ...item, status: 'in_progress', start_odometer_km: odometerKm, started_at: now }));
      bumpOdometer(task.vehicle_id, odometerKm);
      // The task's vehicle is now the one being driven.
      if (current.current_vehicle_id !== task.vehicle_id) {
        saveMe({ ...current, current_vehicle_id: task.vehicle_id });
        enqueue({ kind: 'employee_patch', id: current.id, patch: { current_vehicle_id: task.vehicle_id } });
      }
      // Starting a task turns location sharing on.
      const result = await startSharing(serviceTexts);
      setSharingState(result === 'on');
      void flushNow();
    },
    [bumpOdometer, patchLocalTask, saveMe, serviceTexts],
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
    (task: TaskWithStops, odometerKm: number, ocrKm: number | null, photo: LocalPhoto | null, fuel: FuelEntry | null) => {
      const current = meRef.current;
      if (!current) return;
      const now = new Date().toISOString();
      if (photo) queuePhoto(photo, 'odometer', current.id);
      enqueue({
        kind: 'odometer_log',
        row: {
          id: Crypto.randomUUID(),
          vehicle_id: task.vehicle_id,
          employee_id: current.id,
          task_id: task.id,
          reading_km: odometerKm,
          ocr_value: ocrKm,
          photo_id: photo?.id ?? null,
          kind: 'task_end',
          logged_at: now,
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
      void flushNow();
    },
    [bumpOdometer, patchLocalTask, queueFuel],
  );

  // --- logs and reports outside a task ---------------------------------------
  const logOdometer = useCallback((odometerKm: number, ocrKm: number | null, photo: LocalPhoto | null) => {
    const current = meRef.current;
    if (!current?.current_vehicle_id) return;
    if (photo) queuePhoto(photo, 'odometer', current.id);
    enqueue({
      kind: 'odometer_log',
      row: {
        id: Crypto.randomUUID(),
        vehicle_id: current.current_vehicle_id,
        employee_id: current.id,
        task_id: null,
        reading_km: odometerKm,
        ocr_value: ocrKm,
        photo_id: photo?.id ?? null,
        kind: 'manual',
        logged_at: new Date().toISOString(),
      },
    });
    bumpOdometer(current.current_vehicle_id, odometerKm);
    void flushNow();
  }, [bumpOdometer]);

  const logFuel = useCallback((fuel: FuelEntry, odometerKm: number | null) => {
    const current = meRef.current;
    if (!current?.current_vehicle_id) return;
    const running = tasksRef.current.find((task) => task.status === 'in_progress');
    queueFuel(fuel, running?.vehicle_id ?? current.current_vehicle_id, running?.id ?? null, odometerKm, new Date().toISOString());
    void flushNow();
  }, [queueFuel]);

  const sendReport = useCallback((category: ReportCategory, note: string, photos: LocalPhoto[], taskId: string | null) => {
    const current = meRef.current;
    if (!current?.current_vehicle_id) return;
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      id,
      vehicle_id: current.current_vehicle_id,
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
    vehicles, vehicle, tasks, reports, sharing, queue, waitingTasks, refreshing, offline,
    signIn, signOut, refresh, sendNow, setSharing, chooseVehicle, markSeen, markStopDone,
    startTask, completeTask, logOdometer, logFuel, sendReport,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
