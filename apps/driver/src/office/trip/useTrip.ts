// Office mode (Phase 8, O2): the trip editor's rules on the phone, as the site's useTrip (TripEditor.tsx): plan_task
// 1.5 s after the last change (or at once with Plan now), the plan shown stays while the next one comes; the departure
// check from the latest plan (an empty leave-by filled in, a typed one checked against the arrive-by times and the
// back-by); the exact reason when there is no plan. The draft (draft.ts) holds the fields; this hook reads them.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { useOffice } from '../state';
import type { FleetError, PlanPreview, SettingsResult } from '../types';
import { planInput as assignPlanInput } from './assignLogic';
import { checkDeparture, type DepartureCheck, departurePlan } from './departureLogic';
import { type TripDraft, updateDraft } from './draft';
import { type PlanReason, planReasons, rowStopNumbers } from './planLogic';
import { tickStart } from './stopsLogic';
import { type Base, tripOffset, tripPlanInput } from './tripLogic';

export const PLAN_DEBOUNCE_MS = 1_500;

export interface PlanState {
  preview: PlanPreview | null;
  error: FleetError | null;
  /** A plan is on its way (the one shown stays). */
  updating: boolean;
  /** The input the shown plan answers; null = nothing to plan. */
  input: Record<string, unknown> | null;
  planNow: () => void;
}

/**
 * plan_task for the draft's trip. One store for the whole app (Hotfix O2-H1 Part B, the reviewer's major 5): When, Who
 * and Review stay mounted in the stack and each asks for the same input, so the answer is kept by its input and a call
 * in flight is never doubled (every Google Routes call is counted); the step that comes to the front shows the plan
 * already made instead of "Planning…". Debounced 1.5 s after the last change; the plan shown stays while a new one comes.
 */
interface PlanEntry {
  preview: PlanPreview | null;
  error: FleetError | null;
  inFlight: boolean;
}
const planStore = new Map<string, PlanEntry>();
const planListeners = new Set<() => void>();
const PLAN_STORE_MAX = 24;
const notifyPlan = () => planListeners.forEach((l) => l());
const subscribePlan = (l: () => void) => {
  planListeners.add(l);
  return () => {
    planListeners.delete(l);
  };
};
function setEntry(key: string, e: PlanEntry) {
  planStore.delete(key);
  planStore.set(key, e);
  while (planStore.size > PLAN_STORE_MAX) planStore.delete(planStore.keys().next().value as string);
  notifyPlan();
}
async function runPlan(api: { call: <T>(tool: string, args?: Record<string, unknown>) => Promise<T> }, key: string): Promise<void> {
  const cur = planStore.get(key);
  if (!key || cur?.inFlight) return;
  setEntry(key, { preview: cur?.preview ?? null, error: null, inFlight: true });
  try {
    const p = await api.call<PlanPreview>('plan_task', { ...(JSON.parse(key) as Record<string, unknown>), with_line: true });
    setEntry(key, { preview: p, error: null, inFlight: false });
  } catch (e) {
    setEntry(key, { preview: cur?.preview ?? null, error: e as FleetError, inFlight: false });
  }
}
/** For the tests: forget every plan. */
export const clearPlans = () => {
  planStore.clear();
  notifyPlan();
};

export function usePlanPreview(input: Record<string, unknown> | null): PlanState {
  const { api, me } = useOffice();
  const enabled = me.tools.includes('plan_task') && input !== null;
  const key = enabled && input ? JSON.stringify(input) : '';
  const entry = useSyncExternalStore(subscribePlan, () => planStore.get(key), () => planStore.get(key));
  // The last plan this screen showed stays on screen while the next input's plan comes.
  const last = useRef<PlanPreview | null>(null);
  if (entry?.preview) last.current = entry.preview;
  useEffect(() => {
    if (!key) return;
    const have = planStore.get(key);
    if (have?.preview || have?.inFlight || have?.error) return;
    const timer = setTimeout(() => void runPlan(api, key), PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key, api]);
  const updating = !!key && (!entry || entry.inFlight);
  const preview = !key ? null : entry?.preview ?? (entry?.error ? null : last.current);
  return { preview, error: entry?.error ?? null, updating, input: enabled ? input : null, planNow: () => void runPlan(api, key) };
}

export interface Trip {
  base: Base;
  plan: PlanState;
  preview: PlanPreview | null;
  check: DepartureCheck | null;
  /** The planner's own leave time ("09:22"), shown in grey as the suggestion while the field is empty; never sent (the
   *  server plans from the deadlines, the one calculation: 21 October 2026). null with planner_suggestions off. */
  suggestedLeave: string | null;
  /** planner_suggestions (Fleet settings): off = just the fields, no suggestion and no hint. */
  suggestions: boolean;
  lateBack: boolean;
  /** The row whose arrive-by the typed leave-by misses (the note goes under it). */
  lateKey?: string;
  offset: number;
  reasons: PlanReason[];
  setLeave: (time: string) => void;
  setEnd: (time: string) => void;
  moveArriveBy: (n: number, time: string) => void;
  onTickStart: (i: number) => void;
  dwellSetting?: Record<string, number> | null;
}

/** The draft's trip with its plan and checks. `settings`: get_settings (the base place, the stop times). */
export function useTrip(d: TripDraft, settings: SettingsResult | null): Trip {
  const base: Base = settings?.base_place ? { id: settings.base_place.id, name: settings.base_place.name } : null;
  const f = d.fields;
  const input = useMemo(() => (d.mode === 'task' ? assignPlanInput(f, base) : tripPlanInput(f, base)), [f, base, d.mode]);
  const plan = usePlanPreview(input);
  const preview = plan.error ? null : plan.preview;
  const dPlan = departurePlan(preview?.timeline, preview?.plan?.buffer_min, f.end);
  // The planner advises, never blocks (Sahan, 21 October 2026). Its leave time is a suggestion shown in grey, never written
  // into the form: a suggestion written back used to be planned again as a typed time (the road times asked again for that
  // departure: rush hour, live traffic) and then judged a few minutes late ("09:22 … Use 09:18"). Only a time the person
  // chose is checked, and a miss is an amber hint with Use.
  const suggestions = settings?.settings.planner_suggestions !== false;
  const raw = suggestions ? checkDeparture(f.leaveBy, dPlan) : null;
  const check: DepartureCheck | null = raw?.kind === 'fill' ? null : raw;
  const suggestedLeave = suggestions && !f.leaveBy && raw?.kind === 'fill' ? raw.leaveBy : null;
  const lateBack = check?.kind === 'late' && !!check.back;
  const offset = tripOffset(f) + (d.reached ?? 0);
  const numbers = rowStopNumbers(f.stops, offset);
  const lateKey = check?.kind === 'late' && !check.back ? [...numbers].find(([, n]) => n === check.n)?.[0] : undefined;
  const previewErr = plan.error ? plan.error.message : null;
  const reasons = planReasons({ date: f.date, stops: f.stops, leaveBy: f.leaveBy, start: f.start || base?.name || '', returnToBase: f.returnToBase, offset }, preview, previewErr);
  return {
    base,
    plan,
    preview,
    check,
    suggestedLeave,
    suggestions,
    lateBack,
    lateKey,
    offset,
    reasons,
    dwellSetting: settings?.settings.dwell_min,
    setLeave: (time) => updateDraft((x) => ({ ...x, fields: { ...x.fields, leaveBy: time } })),
    setEnd: (time) => updateDraft((x) => ({ ...x, fields: { ...x.fields, end: time } })),
    moveArriveBy: (n, time) => {
      const key = [...numbers].find(([, m]) => m === n)?.[0];
      if (key) updateDraft((x) => ({ ...x, fields: { ...x.fields, stops: x.fields.stops.map((s) => (s.key === key ? { ...s, arriveBy: time } : s)) } }));
    },
    onTickStart: (i) => updateDraft((x) => {
      const t = tickStart(x.fields.stops, i, x.fields.returnToBase);
      return { ...x, fields: { ...x.fields, stops: t.list, startPax: true, ...t.carried } };
    }),
  };
}
