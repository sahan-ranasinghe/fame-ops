// Round 4–7, feature 5 (docs/phase8-plan.md §33.2): the fuel card at Start task, advisory, never blocking (Google Maps'
// fuel estimate, Samsara / Fleetio's fuel plan, Uber's trip info card). Pure (no React, no phone modules), so
// scripts/test-fuel-card.ts runs it as it is.
//
//   - The card: "About 180 km · roughly 12–15 L petrol (approx.)" from the RPC fuel_estimate(task) (the driver's own task;
//     null keys are absent); electric: "About 180 km · check the battery"; no km (no plan): no card. Offline the copy kept
//     on the phone for the task, else what the phone knows itself (the plan's km, the vehicle's fuel type).
//   - "Enough fuel?" Yes / I'll fill up on the way: answer_fuel_card(task, answer, at) through the offline queue (op
//     fuel_answer, sent after the start). Optional: Start task goes on without it.
//   - "I'll fill up on the way": a reminder 30 min after the start that opens Log fuel for the task, and on the running
//     task's screen "Fill up on the way · Log fuel", both until a fill is logged on the task.
//   - Log fuel: the fill's type preselected from the vehicle (petrol, or diesel; a hybrid fills petrol; electric none) and
//     its grade when the vehicle has one (Petrol 92 / 95, Auto Diesel / Super Diesel), changeable.
//   - The switch fuel_card (get_driver_settings): off = no card, no reminder, no line; the fuel type on Log fuel stays.

import { thousands } from './format';
import type { TaskWithStops } from './types';

export type VehicleFuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';
/** What a pump fills: a hybrid fills petrol; an electric vehicle is not filled. */
export type FillType = 'petrol' | 'diesel';
export type FuelGrade = 'petrol_92' | 'petrol_95' | 'auto_diesel' | 'super_diesel';
export type FuelAnswer = 'enough' | 'fill_on_way';

export const FILL_TYPES: readonly FillType[] = ['petrol', 'diesel'];
export const GRADES: Readonly<Record<FillType, readonly FuelGrade[]>> = {
  petrol: ['petrol_92', 'petrol_95'],
  diesel: ['auto_diesel', 'super_diesel'],
};
const VEHICLE_FUELS: readonly VehicleFuel[] = ['petrol', 'diesel', 'hybrid', 'electric'];
const ALL_GRADES: readonly FuelGrade[] = [...GRADES.petrol, ...GRADES.diesel];

/** The reminder comes this long after the start (when the driver said "I'll fill up on the way"). */
export const FUEL_REMINDER_AFTER_MS = 30 * 60_000;
/** The estimates kept on the phone (the newest tasks'). */
export const ESTIMATES_KEPT = 10;
/** The answers kept on the phone (the newest tasks'). */
export const MEMOS_KEPT = 20;
/** fuel_estimate gets this long to answer before the card shows what the phone knows. */
export const ESTIMATE_TIMEOUT_MS = 8_000;

// --- the estimate ---------------------------------------------------------------------------------------------------

export interface FuelEstimate {
  taskId: string;
  /** The plan's km (with the drive back when the trip returns); null without a plan. */
  km: number | null;
  fuelType: VehicleFuel | null;
  fuelGrade: FuelGrade | null;
  electric: boolean;
  kmPerL: number | null;
  /** history: from the vehicle's last fills; default: by the vehicle's type and fuel; null: worked out on the phone. */
  source: 'history' | 'default' | null;
  litresLow: number | null;
  litresHigh: number | null;
  answer: FuelAnswer | null;
  answeredAt: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function isVehicleFuel(v: unknown): v is VehicleFuel {
  return typeof v === 'string' && (VEHICLE_FUELS as readonly string[]).includes(v);
}

export function isGrade(v: unknown): v is FuelGrade {
  return typeof v === 'string' && (ALL_GRADES as readonly string[]).includes(v);
}

export function isFuelAnswer(v: unknown): v is FuelAnswer {
  return v === 'enough' || v === 'fill_on_way';
}

/** fuel_estimate's answer, read field by field (null when it is not the driver's task, or no answer). */
export function parseFuelEstimate(raw: unknown): FuelEstimate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const taskId = str(o.task_id);
  if (!taskId) return null;
  const fuelType = isVehicleFuel(o.fuel_type) ? o.fuel_type : null;
  const km = num(o.km);
  const low = num(o.litres_low);
  const high = num(o.litres_high);
  return {
    taskId,
    km: km !== null && km > 0 ? km : null,
    fuelType,
    fuelGrade: isGrade(o.fuel_grade) ? o.fuel_grade : null,
    electric: o.electric === true || fuelType === 'electric',
    kmPerL: num(o.km_per_l),
    source: o.source === 'history' || o.source === 'default' ? o.source : null,
    litresLow: low !== null && low > 0 ? low : null,
    litresHigh: high !== null && high > 0 ? high : null,
    answer: isFuelAnswer(o.answer) ? o.answer : null,
    answeredAt: str(o.answered_at),
  };
}

/** What the phone knows by itself (offline, nothing kept): the plan's km and the vehicle's fuel; no litres. */
export function phoneEstimate(
  task: Pick<TaskWithStops, 'id' | 'plan_json' | 'fuel_answer' | 'fuel_answer_at'>,
  vehicle: { fuel_type?: string | null; fuel_grade?: string | null } | null | undefined,
): FuelEstimate {
  const fuelType = isVehicleFuel(vehicle?.fuel_type) ? vehicle.fuel_type : null;
  const km = planKm(task.plan_json);
  return {
    taskId: task.id,
    km,
    fuelType,
    fuelGrade: isGrade(vehicle?.fuel_grade) ? vehicle.fuel_grade : null,
    electric: fuelType === 'electric',
    kmPerL: null,
    source: null,
    litresLow: null,
    litresHigh: null,
    answer: isFuelAnswer(task.fuel_answer) ? task.fuel_answer : null,
    answeredAt: task.fuel_answer_at ?? null,
  };
}

/** The plan's km, as the server counts it (total_km, else the legs added up); null without a plan. */
export function planKm(plan: unknown): number | null {
  if (!plan || typeof plan !== 'object') return null;
  const p = plan as { total_km?: unknown; legs?: unknown };
  const total = num(p.total_km);
  if (total !== null) return total > 0 ? Math.round(total) : null;
  const legs = Array.isArray(p.legs) ? p.legs : [];
  const kms = legs.map((l) => (l && typeof l === 'object' ? num((l as { km?: unknown }).km) : null));
  if (kms.length === 0 || kms.some((k) => k === null)) return null;
  const sum = kms.reduce<number>((a, b) => a + (b ?? 0), 0);
  return sum > 0 ? Math.round(sum) : null;
}

/** The card shows only with the switch on and the trip's km known. */
export function fuelCardShown(on: boolean, est: FuelEstimate | null | undefined): est is FuelEstimate {
  return on && !!est && est.km !== null && est.km > 0;
}

/** What a pump fills for a vehicle's fuel type: petrol and a hybrid petrol, diesel diesel; electric or not set none. */
export function fillTypeOf(fuel: string | null | undefined): FillType | null {
  if (fuel === 'petrol' || fuel === 'hybrid') return 'petrol';
  if (fuel === 'diesel') return 'diesel';
  return null;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "12–15", or "12" when the two ends meet. */
export function litresRange(low: number, high: number): string {
  const a = Math.round(Math.min(low, high));
  const b = Math.round(Math.max(low, high));
  return a === b ? String(a) : `${a}–${b}`;
}

/**
 * The card's line: "About 180 km · roughly 12–15 L petrol (approx.)", "About 180 km · check the battery" (electric),
 * "About 180 km" (no litres known, offline); null without km (no card).
 */
export function estimateLine(t: Translate, est: FuelEstimate | null | undefined): string | null {
  if (!est || est.km === null || est.km <= 0) return null;
  const parts = [t('fuelCard.km', { km: thousands(est.km) })];
  if (est.electric) parts.push(t('fuelCard.battery'));
  else if (est.litresLow !== null && est.litresHigh !== null) {
    const range = litresRange(est.litresLow, est.litresHigh);
    const fill = fillTypeOf(est.fuelType);
    parts.push(fill ? t('fuelCard.litres', { range, fuel: t(`fuelKind.word.${fill}`) }) : t('fuelCard.litresNoType', { range }));
  }
  return parts.join(' · ');
}

/** The small grey line under it: where the litres come from (none when there are no litres). */
export function sourceKey(est: FuelEstimate): 'fuelCard.fromHistory' | 'fuelCard.fromDefault' | null {
  if (est.electric || est.litresLow === null) return null;
  return est.source === 'history' ? 'fuelCard.fromHistory' : est.source === 'default' ? 'fuelCard.fromDefault' : null;
}

/** The question is for a vehicle that is filled (never for an electric one). */
export function asksQuestion(est: FuelEstimate): boolean {
  return !est.electric;
}

/** The copies kept on the phone (per task, the newest ESTIMATES_KEPT). */
export function keepEstimate(cache: Record<string, FuelEstimate> | null | undefined, est: FuelEstimate, max = ESTIMATES_KEPT): Record<string, FuelEstimate> {
  const rest = Object.entries(cache ?? {}).filter(([id]) => id !== est.taskId).slice(-(max - 1));
  return Object.fromEntries([...rest, [est.taskId, est]]);
}

// --- the answer: the queue's op --------------------------------------------------------------------------------------

/** The queue's op (sync/engine.ts): answer_fuel_card with the phone's time; id = the task. */
export interface FuelAnswerOp {
  kind: 'fuel_answer';
  /** The task's id. */
  id: string;
  answer: FuelAnswer;
  at: string;
}

/** answer_fuel_card's reply: 'ok', 'not_yours' (given to someone else: nothing to do) or 'bad' (refused). */
export type FuelAnswerReply = 'ok' | 'not_yours' | 'bad';

export function fuelAnswerOp(taskId: string, answer: FuelAnswer, at: string): FuelAnswerOp {
  return { kind: 'fuel_answer', id: taskId, answer, at };
}

/** 'ok' and 'not_yours' are final (done); anything else is a refusal, kept on the phone. */
export function fuelAnswerDone(reply: unknown): boolean {
  return reply === 'ok' || reply === 'not_yours';
}

// --- "Fill up on the way" until a fill is logged ----------------------------------------------------------------------

/** What the phone keeps per task: the answer given at the start, and when a fill was logged on the task. */
export interface FuelMemo {
  answer: FuelAnswer;
  at: string;
  filledAt?: string | null;
}
export type FuelMemos = Record<string, FuelMemo>;

export function rememberAnswer(memos: FuelMemos | null | undefined, taskId: string, answer: FuelAnswer, at: string, max = MEMOS_KEPT): FuelMemos {
  const rest = Object.entries(memos ?? {}).filter(([id]) => id !== taskId).slice(-(max - 1));
  return Object.fromEntries([...rest, [taskId, { answer, at, filledAt: null }]]);
}

/** A fill was logged on the task: the line and the reminder are done. */
export function rememberFilled(memos: FuelMemos | null | undefined, taskId: string, at: string, max = MEMOS_KEPT): FuelMemos {
  const had = memos?.[taskId];
  const rest = Object.entries(memos ?? {}).filter(([id]) => id !== taskId).slice(-(max - 1));
  return Object.fromEntries([...rest, [taskId, { answer: had?.answer ?? 'fill_on_way', at: had?.at ?? at, filledAt: at }]]);
}

/** The running task's "Fill up on the way · Log fuel": the switch on, the task under way, the answer given, no fill yet. */
export function fillOnWayPending(
  task: Pick<TaskWithStops, 'id' | 'status' | 'fuel_answer'>,
  memos: FuelMemos | null | undefined,
  on: boolean,
): boolean {
  if (!on || task.status !== 'in_progress') return false;
  const memo = memos?.[task.id];
  const answer = memo?.answer ?? (isFuelAnswer(task.fuel_answer) ? task.fuel_answer : null);
  return answer === 'fill_on_way' && !memo?.filledAt;
}

// --- Log fuel: the fill's type and grade ------------------------------------------------------------------------------

export interface FillChoice {
  type: FillType | null;
  grade: FuelGrade | null;
}

/** A grade belongs to its fill type (Petrol 92 / 95 to petrol, Auto / Super Diesel to diesel). */
export function gradeFits(type: FillType | null, grade: FuelGrade | null | undefined): boolean {
  return !!type && !!grade && GRADES[type].includes(grade);
}

/** Preselected from the vehicle: petrol (a hybrid fills petrol) or diesel with its grade when it fits; electric or not set: none. */
export function fillPreselect(vehicle: { fuel_type?: string | null; fuel_grade?: string | null } | null | undefined): FillChoice {
  const type = fillTypeOf(vehicle?.fuel_type);
  const grade = isGrade(vehicle?.fuel_grade) && gradeFits(type, vehicle.fuel_grade) ? vehicle.fuel_grade : null;
  return { type, grade };
}

/** The driver picked another type: the grade stays only when it still fits. */
export function withFillType(choice: FillChoice, type: FillType): FillChoice {
  return { type, grade: gradeFits(type, choice.grade) ? choice.grade : null };
}

/** The driver tapped a grade (again: none). */
export function withGrade(choice: FillChoice, grade: FuelGrade): FillChoice {
  if (!gradeFits(choice.type, grade)) return choice;
  return { ...choice, grade: choice.grade === grade ? null : grade };
}

/** The fuel_logs columns of a fill (absent when nothing is picked: an older server, or not known). */
export function fillColumns(choice: FillChoice | null | undefined): { fuel_type?: FillType; fuel_grade?: FuelGrade } {
  if (!choice?.type) return {};
  return { fuel_type: choice.type, ...(gradeFits(choice.type, choice.grade) ? { fuel_grade: choice.grade as FuelGrade } : {}) };
}
