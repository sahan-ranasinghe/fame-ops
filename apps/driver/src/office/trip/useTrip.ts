// Office mode (Phase 8, O2): the trip editor's rules on the phone, as the site's useTrip (TripEditor.tsx): plan_task
// 1.5 s after the last change (or at once with Plan now), the plan shown stays while the next one comes; the departure
// check from the latest plan (an empty leave-by filled in, a typed one checked against the arrive-by times and the
// back-by); the exact reason when there is no plan. The draft (draft.ts) holds the fields; this hook reads them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

/** plan_task for the draft's trip: debounced, kept while updating, with_line for the map. */
export function usePlanPreview(input: Record<string, unknown> | null): PlanState {
  const { api, me } = useOffice();
  const enabled = me.tools.includes('plan_task') && input !== null;
  const key = input ? JSON.stringify(input) : '';
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [error, setError] = useState<FleetError | null>(null);
  const [updating, setUpdating] = useState(false);
  const seq = useRef(0);
  const run = useCallback(async (k: string) => {
    if (!k) return;
    const n = ++seq.current;
    setUpdating(true);
    try {
      const p = await api.call<PlanPreview>('plan_task', { ...(JSON.parse(k) as Record<string, unknown>), with_line: true });
      if (n !== seq.current) return;
      setPreview(p);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError(e as FleetError);
    } finally {
      if (n === seq.current) setUpdating(false);
    }
  }, [api]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void run(key), PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, key, run]);
  return { preview: enabled ? preview : null, error: enabled ? error : null, updating, input: enabled ? input : null, planNow: () => void run(key) };
}

export interface Trip {
  base: Base;
  plan: PlanState;
  preview: PlanPreview | null;
  check: DepartureCheck | null;
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
  const check = checkDeparture(f.leaveBy, dPlan);
  const lateBack = check?.kind === 'late' && !!check.back;
  // An empty leave-by is filled in from the plan (not on an edit, where empty means "planned").
  const fillTo = d.mode !== 'edit' && check?.kind === 'fill' && !plan.updating ? check.leaveBy : null;
  useEffect(() => {
    if (fillTo) updateDraft((x) => (x.fields.leaveBy ? x : { ...x, fields: { ...x.fields, leaveBy: fillTo } }));
  }, [fillTo]);
  const offset = tripOffset(f);
  const numbers = rowStopNumbers(f.stops, offset);
  const lateKey = check?.kind === 'late' && !check.back ? [...numbers].find(([, n]) => n === check.n)?.[0] : undefined;
  const previewErr = plan.error ? plan.error.message : null;
  const reasons = planReasons({ date: f.date, stops: f.stops, leaveBy: f.leaveBy, start: f.start || base?.name || '', returnToBase: f.returnToBase, offset }, preview, previewErr);
  return {
    base,
    plan,
    preview,
    check,
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
      const t = tickStart(x.fields.stops, i);
      return { ...x, fields: { ...x.fields, stops: t.list, startPax: true, ...t.carried } };
    }),
  };
}
