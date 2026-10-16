// Tests of the driver's day rules (src/lib/dayRules.ts, Phase 7 item 18): Arrived near the stop,
// Done after Arrived, Complete after the last stop, the odometer against the plan. Pure code,
// no stack needed:
//
//   npm run test:rules          (from apps/driver)

import { distanceKm } from '../src/lib/format';
import {
  ARRIVE_MAX_ACCURACY_M,
  ARRIVE_WITHIN_M,
  arrivalCheck,
  arrivalRecord,
  canMarkDone,
  dutyEndIsToday,
  earlyFinish,
  lastStopOpen,
  NO_GPS_OVERRIDE_AFTER_MS,
  stopNumber,
  stretchStartKm,
  swapReadingsWaiting,
  taskKmSoFar,
  withSwapReading,
} from '../src/lib/dayRules';
import type { TaskSegment, TaskStop } from '../src/lib/types';
import { shownTaskKm, splitAtPlate, stopLabel, stopTimeAt, stretches, swapCard, type Translate } from '../src/components/taskLines';
import {
  currentStop,
  fitKey,
  frameOf,
  hasRouteLine,
  isTurned,
  kmText,
  mapStops,
  planLegs,
  roadKmLeft,
  routeLines,
  startPoint,
} from '../src/components/taskMapLogic';
import { encodePolyline } from '../src/lib/polyline';
import en from '../src/i18n/en.json';
import si from '../src/i18n/si.json';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

/** A stop row with everything empty but what the test sets. */
function stop(fields: Partial<TaskStop>): TaskStop {
  return {
    address: null, arrival_accuracy_m: null, arrival_at: null, arrival_distance_m: null, arrival_flag: null, arrival_lat: null,
    arrival_lng: null, arrive_by: null, arrived_at: null, auto_detected_at: null, done_at: null, dwell_min: null, dwell_source: null,
    google_fetched_at: null, google_place_id: null, id: 's', is_start: false, lat: null, lng: null, note: null, place_id: null,
    place_name: 'Kurunegala site', planned_arrive_at: null, planned_depart_at: null, removed_at: null, saved_place_id: null,
    seq: 1, skip_note: null, skip_reason: null, status: 'pending', task_id: 't', type: 'drop', what: null,
    ...fields,
  };
}

// The stop's pin (Kurunegala) and points due north of it (1° of latitude ≈ 111.195 km).
const PIN = { lat: 7.4863, lng: 80.3623 };
const north = (m: number) => ({ lat: PIN.lat + m / 111_195, lng: PIN.lng });
const pinned = stop({ lat: PIN.lat, lng: PIN.lng });

// 1. Arrived: near the stop, far from it, no usable fix, no pin.
check(Math.abs(distanceKm(north(250), PIN) * 1000 - 250) < 2, 'the test points are where they claim (250 m north)');
const near = arrivalCheck(pinned, { ...north(250), accuracyM: 20 });
check(near.state === 'ok' && Math.abs(near.distanceM - 250) <= 2, 'within 300 m with a 20 m fix: ok, with the distance', near);
const edge = arrivalCheck(pinned, { ...north(ARRIVE_WITHIN_M - 5), accuracyM: ARRIVE_MAX_ACCURACY_M });
check(edge.state === 'ok', '295 m with a fix of exactly 100 m: still ok', edge);
check(arrivalCheck(pinned, { ...north(250) }).state === 'ok', 'a fix with no accuracy given is taken as it is');
const far = arrivalCheck(pinned, { ...north(42_000), accuracyM: 10 });
check(far.state === 'far' && Math.abs(far.distanceM - 42_000) < 50, '42 km away: far, with the distance (for "You are 42 km from …")', far);
check(arrivalCheck(pinned, { ...north(320), accuracyM: 10 }).state === 'far', 'just over 300 m: far');
check(arrivalCheck(pinned, { ...north(250), accuracyM: 150 }).state === 'waiting', 'a 150 m-accuracy fix is not sure enough: waiting');
check(arrivalCheck(pinned, { ...north(42_000), accuracyM: 150 }).state === 'waiting', 'an unsure fix far away is waiting too, never "far"');
check(arrivalCheck(pinned, null).state === 'waiting', 'no fix at all: waiting');
check(arrivalCheck(stop({ lat: null, lng: null }), { ...north(250), accuracyM: 10 }).state === 'no_pin', 'a stop with no pin: no_pin, whatever the fix');
check(arrivalCheck(stop({ lat: PIN.lat, lng: null }), null).state === 'no_pin', 'half a pin is no pin');
check(NO_GPS_OVERRIDE_AFTER_MS === 60_000, 'the override for no GPS comes after 60 s');

// 2. What an Arrived tap records.
const okRecord = arrivalRecord(near);
check(okRecord.flag === 'ok' && okRecord.distanceM === (near.state === 'ok' ? near.distanceM : -1), 'ok records flag ok and the distance', okRecord);
const farRecord = arrivalRecord(far);
check(farRecord.flag === 'override' && farRecord.distanceM !== null && farRecord.distanceM > 40_000, '"I\'m here, the pin is wrong" records override and the distance', farRecord);
const noGps = arrivalRecord({ state: 'waiting' });
check(noGps.flag === 'no_gps' && noGps.distanceM === null, 'the override with no GPS records no_gps, no distance', noGps);
const noPin = arrivalRecord({ state: 'no_pin' });
check(noPin.flag === 'no_pin' && noPin.distanceM === null, 'a stop with no pin records no_pin, no distance', noPin);

// 3. Done only after Arrived.
check(!canMarkDone(stop({ status: 'pending' })), 'pending: no Done');
check(canMarkDone(stop({ status: 'arrived', arrived_at: '2026-10-15T04:00:00Z' })), 'arrived: Done');
check(!canMarkDone(stop({ status: 'arrived', arrived_at: null })), 'arrived with no arrival time: no Done (the server would refuse it)');
check(!canMarkDone(stop({ status: 'done', arrived_at: '2026-10-15T04:00:00Z' })) && !canMarkDone(stop({ status: 'skipped' })), 'done or skipped: no Done again');

// 4. Complete task needs the last stop Done or Skipped (removed stops do not count; order is by seq).
const task = (stops: Partial<TaskStop>[]) => ({ task_stops: stops.map((s, i) => stop({ id: `s${i + 1}`, seq: i + 1, ...s })) });
check(lastStopOpen(task([{ status: 'done' }, { status: 'pending' }]))?.id === 's2', 'last stop pending: Complete is blocked by it');
check(lastStopOpen(task([{ status: 'done' }, { status: 'arrived' }]))?.id === 's2', 'last stop arrived but not done: still blocked');
check(lastStopOpen(task([{ status: 'pending' }, { status: 'done' }])) === null, 'last stop done (an earlier one open): Complete works, the earlier one becomes not visited');
check(lastStopOpen(task([{ status: 'done' }, { status: 'skipped' }])) === null, 'last stop skipped: Complete works');
check(lastStopOpen(task([{ status: 'done' }, { status: 'removed' }])) === null, 'a removed last stop is not the last stop (the one before it is done)');
check(lastStopOpen(task([{ status: 'pending' }, { status: 'removed' }]))?.id === 's1', 'a removed last stop: the open one before it blocks');
const shuffled = { task_stops: [stop({ id: 'b', seq: 2, status: 'done' }), stop({ id: 'a', seq: 1, status: 'pending' })] };
check(lastStopOpen(shuffled) === null, 'the last stop is the highest seq, not the last in the list');
check(lastStopOpen({ task_stops: [] }) === null, 'a task with no stops: Complete works');

// 5. The odometer against the plan at Complete.
const STARTED = '2026-10-15T03:00:00Z';
const at = (minutes: number) => Date.parse(STARTED) + minutes * 60_000;
// The plan as the server stores it: legs, the drive back to base (to_seq -1) left out of the check.
const asLegs = (plan: { total_km?: number; total_drive_min?: number } | null) =>
  plan === null ? null : { legs: [{ km: plan.total_km, minutes: plan.total_drive_min ?? 0, to_seq: 1 }] };
const planned = (plan: { total_km?: number; total_drive_min?: number } | null, start: number | null = 84_000) =>
  ({ plan_json: asLegs(plan) as never, start_odometer_km: start, started_at: STARTED });
const trip = { total_km: 95, total_drive_min: 120 };
const early = earlyFinish(planned(trip), 84_003, at(130));
check(early !== null && early.km === 3 && early.plannedKm === 95, 'planned 95 km, the odometer says 3: ask', early);
check(earlyFinish(planned(trip), 84_090, at(130)) === null, '90 of 95 km in 130 of 120 min: looks right');
check(earlyFinish(planned(trip), 84_067, at(130)) === null && earlyFinish(planned(trip), 84_066, at(130)) !== null, 'the line is 70 % of the planned km (66.5)');
const quick = earlyFinish(planned(trip), 84_095, at(50));
check(quick !== null && quick.minutes === 50 && quick.plannedMinutes === 120, 'the right km but in 50 of 120 planned minutes: ask', quick);
check(earlyFinish(planned(trip), 84_095, at(60)) === null, 'exactly half the planned time: no question');
check(earlyFinish(planned({ total_km: 2.5, total_drive_min: 8 }), 84_000, at(1)) === null, 'a plan under 3 km is not checked (the odometer counts whole km)');
check(earlyFinish(planned({ total_km: 3, total_drive_min: 0 }), 84_000, at(1)) !== null, 'a 3 km plan is checked; no planned time means only the km count');
check(earlyFinish(planned(null), 84_000, at(1)) === null, 'no plan (a self trip): no question');
check(earlyFinish(planned({ total_drive_min: 120 }), 84_000, at(1)) === null, 'a plan without km: no question');
check(earlyFinish(planned(trip, null), 84_003, at(130)) === null, 'no start reading: no question');
const withReturn = { plan_json: { legs: [{ km: 50, minutes: 60, to_seq: 1 }, { km: 50, minutes: 60, to_seq: -1 }] } as never, start_odometer_km: 84_000, started_at: STARTED };
check(earlyFinish(withReturn, 84_048, at(70)) === null, 'completed at the last stop: the drive back to base is not counted (48 of 50 km)');
check(earlyFinish(withReturn, 84_030, at(70))?.plannedKm === 50, 'and the line is 70 % of the km up to the last stop');
const rounded = earlyFinish(planned({ total_km: 12.345, total_drive_min: 30.6 }), 84_001, at(40));
check(rounded !== null && rounded.plannedKm === 12.3 && rounded.plannedMinutes === 31, 'the planned numbers are rounded for the question', rounded);

// 6. A vehicle swap during the task (Phase 7, §2 addition): km = the stretches added up.
const iso = (minutes: number) => new Date(at(minutes)).toISOString();
const seg = (fields: Partial<TaskSegment>): TaskSegment => ({
  by_name: null, created_at: STARTED, end_odometer_km: null, from_at: STARTED, id: 'g', reason: null, seq: 1,
  start_odometer_km: null, task_id: 't', to_at: null, vehicle_id: 'A', ...fields,
});
const swapped = {
  start_odometer_km: 10_000,
  task_vehicle_segments: [
    seg({ seq: 2, vehicle_id: 'B', start_odometer_km: 5_000, from_at: iso(60) }),
    seg({ seq: 1, vehicle_id: 'A', start_odometer_km: 10_000, end_odometer_km: 10_040, to_at: iso(60) }),
  ],
};
check(taskKmSoFar({ start_odometer_km: 84_000 }, 84_095) === 95, 'no swap: end − start');
check(taskKmSoFar(swapped, 5_055) === 95, 'a swap: 40 km in A and 55 in B make 95', taskKmSoFar(swapped, 5_055));
check(stretchStartKm(swapped) === 5_000 && stretchStartKm({ start_odometer_km: 84_000 }) === 84_000,
  'the end reading is checked against the start of the stretch in the vehicle now');
const owed = {
  task_vehicle_segments: [
    seg({ seq: 1, vehicle_id: 'A', start_odometer_km: 10_000, to_at: iso(60) }),
    seg({ seq: 2, vehicle_id: 'B', from_at: iso(60) }),
  ],
};
const waiting = swapReadingsWaiting(owed);
check(waiting.oldEnd?.vehicleId === 'A' && waiting.oldEnd.startKm === 10_000 && waiting.newStart?.vehicleId === 'B',
  "after the office's swap the driver owes A's end and B's start", waiting);
check(taskKmSoFar({ start_odometer_km: 10_000, ...owed }, 5_055) === null, 'a reading still owed: no km yet');
check(earlyFinish({ ...planned(trip, 10_000), ...owed }, 5_055, at(130)) === null, 'and no early-finish question while one is owed');
check(earlyFinish({ ...planned(trip, 10_000), ...swapped }, 5_055, at(130)) === null, 'the swapped task drove 95 of 95 km: no question');
check(earlyFinish({ ...planned(trip, 10_000), ...swapped }, 5_010, at(130))?.km === 50, 'but 40 + 10 km is early (50 of 95)');
const filled = withSwapReading(withSwapReading(owed.task_vehicle_segments, { kind: 'task_end', vehicleId: 'A' }, 10_040), { kind: 'task_start', vehicleId: 'B' }, 5_000);
check(filled[0].end_odometer_km === 10_040 && filled[1].start_odometer_km === 5_000 && taskKmSoFar({ start_odometer_km: 10_000, task_vehicle_segments: filled }, 5_055) === 95,
  "the phone fills the stretches as the server's trigger does (A's end, B's start)", filled);
const twice = withSwapReading(filled, { kind: 'task_end', vehicleId: 'A' }, 10_099);
check(twice[0].end_odometer_km === 10_040, 'a stretch that has its reading keeps it');
const none = swapReadingsWaiting({ task_vehicle_segments: [] });
check(none.oldEnd === null && none.newStart === null, 'no swap: nothing owed');

// 8. Stops are named by their place in the order (Phase 7, §11).
const ordered = { task_stops: [stop({ id: 'c', seq: 7 }), stop({ id: 'a', seq: 2 }), stop({ id: 'x', seq: 3, status: 'removed' }), stop({ id: 'b', seq: 5 })] };
check(stopNumber(ordered, 'a') === 1 && stopNumber(ordered, 'b') === 2 && stopNumber(ordered, 'c') === 3 && stopNumber(ordered, 'x') === 0,
  'Stop 1, 2, 3 by seq order; a removed stop has no number');

// 7. A duty from an earlier day closes silently (the first cut-off run); today's says so.
check(dutyEndIsToday('2026-10-16T15:30:00Z', Date.parse('2026-10-16T16:00:00Z')), '21:00 Colombo today: the notice');
check(!dutyEndIsToday('2026-10-15T15:30:00Z', Date.parse('2026-10-16T03:00:00Z')), "yesterday's 21:00, run this morning: silent");

// 9. What the screens say (src/components/taskLines.ts, Phase 7 Part 2), with the real strings in both languages.
// (src/i18n/index.ts needs expo-localization, so the same lookup and {placeholder} filling is done here.)
const tr = (source: unknown): Translate => (key, vars) => {
  let node = source;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  let text = typeof node === 'string' ? node : key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};
const tEn = tr(en);
const tSi = tr(si);
const three = {
  task_stops: [
    stop({ id: 'p', seq: 1, type: 'pickup', place_name: 'Head office', is_start: true }),
    stop({ id: 'd', seq: 4, type: 'drop', place_name: 'Kurunegala site' }),
    stop({ id: 'v', seq: 6, type: 'visit', place_name: 'Kandy store' }),
  ],
};
check(stopLabel(tEn, three, three.task_stops[0]) === 'Stop 1 · Pickup', 'the start is Stop 1 · Pickup', stopLabel(tEn, three, three.task_stops[0]));
check(stopLabel(tEn, three, three.task_stops[1]) === 'Stop 2 · Drop' && stopLabel(tEn, three, three.task_stops[2]) === 'Stop 3 · Visit',
  'the others by their place in the order, not their seq ("Stop 2 · Drop")');
check(stopLabel(tSi, three, three.task_stops[1]) === 'නැවතුම 2 · බැස්සවීම', 'in Sinhala, the number in Latin digits', stopLabel(tSi, three, three.task_stops[1]));
check(stopLabel(tEn, three, stop({ id: 'gone', type: 'drop' })) === 'Drop', 'a stop not on the task: its type only, never "Stop 0"');
// 09:00 and 10:30 Colombo are 03:30 and 05:00 UTC.
const timed = stop({ planned_arrive_at: '2026-10-16T03:30:00Z', planned_depart_at: '2026-10-16T05:00:00Z' });
check(stopTimeAt(tEn, timed) === '09:00–10:30 at Kurunegala site', 'the time there: "09:00–10:30 at Kurunegala site" (Colombo time)', stopTimeAt(tEn, timed));
check(stopTimeAt(tSi, timed) === 'Kurunegala site හි 09:00–10:30', 'in Sinhala the place comes first', stopTimeAt(tSi, timed));
check(stopTimeAt(tEn, stop({ planned_arrive_at: '2026-10-16T03:30:00Z' })) === null && stopTimeAt(tEn, stop({})) === null,
  'without both planned times: null (the screen keeps "N min there")');

const B_SWAP = {
  end_odometer_km: null as number | null,
  km: null as number | null,
  start_odometer_km: 10_000,
  task_vehicle_segments: [
    seg({ seq: 1, vehicle_id: 'A', start_odometer_km: 10_000, to_at: iso(60) }),
    seg({ seq: 2, vehicle_id: 'B', from_at: iso(60) }),
  ],
};
const card = swapCard(B_SWAP);
check(card !== null && card.newVehicleId === 'B' && card.oldVehicleId === 'A' && card.oldEnd.owed && card.oldEnd.startKm === 10_000 && card.newStart.owed,
  "the swap card: A's end (not below 10,000) and B's start are owed", card);
const halfway = { ...B_SWAP, task_vehicle_segments: withSwapReading(B_SWAP.task_vehicle_segments, { kind: 'task_end', vehicleId: 'A' }, 10_040) };
const half = swapCard(halfway);
check(half !== null && !half.oldEnd.owed && half.oldEnd.km === 10_040 && half.newStart.owed, "A's end logged: the card shows it (Logged ✓ 10,040 km), B's start still owed", half);
const both = { ...halfway, task_vehicle_segments: withSwapReading(halfway.task_vehicle_segments, { kind: 'task_start', vehicleId: 'B' }, 5_000) };
check(swapCard(both) === null, 'both logged: the card goes');
check(swapCard({ task_vehicle_segments: [] }) === null && swapCard({}) === null, 'no swap (or a task cached by an older app): no card');
const officeTyped = { task_vehicle_segments: [seg({ seq: 1, vehicle_id: 'A', start_odometer_km: 10_000, end_odometer_km: 10_040, to_at: iso(60) }), seg({ seq: 2, vehicle_id: 'B', from_at: iso(60) })] };
const typedCard = swapCard(officeTyped);
check(typedCard !== null && !typedCard.oldEnd.owed && typedCard.newStart.owed, 'the office typed the old end: only the new start is asked for', typedCard);

const done = { ...both, end_odometer_km: 5_055, km: 5_055 - 10_000 };
const list = stretches(done);
check(list.length === 2 && list[0].vehicleId === 'A' && list[0].km === 40 && list[1].vehicleId === 'B' && list[1].km === 55,
  "each vehicle's km: 40 in A, 55 in B (the last stretch ends at the task's end reading)", list);
check(shownTaskKm(done) === 95, "the finished task's km adds the stretches up, even before the server's km reaches the phone", shownTaskKm(done));
check(shownTaskKm({ ...done, task_vehicle_segments: [] }) === done.km && stretches({ ...done, task_vehicle_segments: [] }).length === 0,
  'no swap: the task\'s own km, no stretches');
check(stretches({ ...B_SWAP, end_odometer_km: 5_055 }).length === 0, 'readings still missing: no stretch is made up');

check(JSON.stringify(splitAtPlate(tEn('swap.oldEnd'))) === JSON.stringify({ before: '', after: ': end reading' }), 'the plate goes in its chip: "{plate}: end reading"');
check(splitAtPlate(tSi('swap.stretches', { km: '40' }))?.before === '' && splitAtPlate(tEn('swap.stretches', { km: '40' }))?.before === '40 km in ',
  'the plate goes where each language puts it');
check(splitAtPlate(tEn('swap.logTitle')) === null, 'a sentence with no plate is shown as it is');

// 7. The task map (Phase 7 Part 2b, §20): distance left by road, the stops and Google's line, the framing, the compass.
// Points due north of A (1° of latitude ≈ 111.195 km): A the start, B 10 km on, C 20 km past B.
const A = { lat: 7, lng: 80 };
const northOf = (p: { lat: number; lng: number }, km: number) => ({ lat: p.lat + km / 111.195, lng: p.lng });
const B = northOf(A, 10);
const C = northOf(B, 20);
const D = northOf(C, 5);
const lineAB = encodePolyline([A, northOf(A, 4), B]);
const lineBC = encodePolyline([B, C]);
const lineCD = encodePolyline([C, D]);
const mapTask = (stops: Partial<TaskStop>[], legs: unknown, start: { lat: number; lng: number } | null = A) => ({
  task_stops: stops.map((f, i) => stop({ id: `m${i + 1}`, seq: i + 1, ...f })),
  plan_json: (legs === null ? null : { legs }) as never,
  start_lat: start?.lat ?? null,
  start_lng: start?.lng ?? null,
  start_google_place_id: null as string | null,
});
const LEGS = [
  { from_seq: 0, to_seq: 1, km: 14, minutes: 20, source: 'google', line: lineAB },
  { from_seq: 1, to_seq: 2, km: 26, minutes: 30, source: 'google', line: lineBC },
  { from_seq: 2, to_seq: 3, km: 6, minutes: 8, source: 'google', line: lineCD },
  { from_seq: 3, to_seq: -1, km: 40, minutes: 50, source: 'google' },
];
const ROUTE = [{ ...B }, { ...C }, { ...D }];
const nearKm = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 0.05;

const halfwayKm = roadKmLeft(mapTask(ROUTE, LEGS), northOf(A, 5));
check(nearKm(halfwayKm, 14 * 0.5 + 26 + 6), 'halfway to Stop 1: half its 14 road km, plus the later legs (26 + 6), never the 40 km back to base', halfwayKm);
const beforeStart = roadKmLeft(mapTask(ROUTE, LEGS), { lat: A.lat - 0.05, lng: A.lng });
check(nearKm(beforeStart, 14 + 26 + 6), 'farther from Stop 1 than the start is: the proportion stops at 1 (the whole leg)', beforeStart);
const atStop = roadKmLeft(mapTask(ROUTE, LEGS), B);
check(nearKm(atStop, 26 + 6), 'at Stop 1: nothing left of its leg', atStop);
const arrived = roadKmLeft(mapTask([{ ...B, status: 'arrived', arrived_at: STARTED }, { ...C }, { ...D }], LEGS), northOf(A, 3));
check(nearKm(arrived, 26 + 6), 'Stop 1 reached (Arrived, not Done yet): its leg counts nothing, wherever the phone is', arrived);
const second = roadKmLeft(mapTask([{ ...B, status: 'done' }, { ...C }, { ...D }], LEGS), northOf(B, 15));
check(nearKm(second, 26 * 0.25 + 6), 'Stop 1 done, 15 of 20 km towards Stop 2: a quarter of its 26 road km, plus the 6 after it', second);
const skippedLater = roadKmLeft(mapTask([{ ...B }, { ...C, status: 'skipped' }, { ...D }], LEGS), northOf(A, 5));
check(nearKm(skippedLater, 7 + 6), 'a later stop skipped: its leg is not counted', skippedLater);
check(roadKmLeft(mapTask([{ ...B, status: 'done' }, { ...C, status: 'done' }, { ...D, status: 'skipped' }], LEGS), C) === 0,
  'every stop done or skipped: 0 km left (the drive back to base is not counted)');
check(roadKmLeft(mapTask(ROUTE, null), northOf(A, 5)) === null, 'no plan: null (the screen keeps the straight line)');
check(roadKmLeft(mapTask(ROUTE, LEGS.map(({ km: _km, ...leg }) => leg)), northOf(A, 5)) === null, 'a plan without km for the legs: null');
check(roadKmLeft(mapTask(ROUTE, LEGS), null) === null, 'no position yet: null');
check(roadKmLeft(mapTask([{ lat: null, lng: null }, { ...C }], LEGS), northOf(A, 5)) === null, 'the current stop has no pin: null');
const fromLine = roadKmLeft(mapTask(ROUTE, LEGS, null), northOf(A, 5));
check(nearKm(fromLine, 7 + 32), "the start's pin unknown (the base was used): the leg starts at its own line's first point", fromLine);
check(roadKmLeft(mapTask(ROUTE, LEGS.map(({ line: _line, ...leg }) => leg), null), northOf(A, 5)) === null,
  'no start pin and no line: the proportion cannot be said, null');
check(planLegs({ legs: [{ from_seq: 0, to_seq: 1, km: 'x' }, null, { to_seq: 2 }] }).length === 1 && planLegs(null).length === 0 && planLegs({ legs: 3 }).length === 0,
  'the stored plan is read defensively (a leg without its seqs is dropped, a bad km is null)');
check(kmText(4.24) === '4.2' && kmText(9.96) === '10' && kmText(42.4) === '42', 'km shown with one decimal under 10 km ("4.2", "10", "42")',
  [kmText(4.24), kmText(9.96), kmText(42.4)]);

// The stops on the map: numbered by order, the time there, the state; a Google place only on Google's map (rule 10).
const shown = mapTask([
  { ...A, is_start: true, type: 'pickup', planned_arrive_at: '2026-10-16T02:30:00Z', status: 'arrived', arrived_at: STARTED },
  { ...B, status: 'removed' },
  { ...B, arrive_by: '2026-10-16T04:00:00Z', planned_arrive_at: '2026-10-16T03:40:00Z' },
  { ...C, google_place_id: 'gp1', planned_arrive_at: '2026-10-16T05:00:00Z' },
  { lat: null, lng: null },
  { ...D },
], LEGS);
const googleStops = mapStops(shown, true);
check(googleStops.map((s) => `${s.n}:${s.state}:${s.time ?? '-'}${s.isStart ? ':start' : ''}`).join(' ') === '1:current:08:00:start 2:todo:09:30 3:todo:10:30 5:todo:-',
  'Google map: Stop 1 the start (marked), removed stops not counted, the arrive-by before the planned time, a stop with no pin left out',
  googleStops.map((s) => `${s.n}:${s.state}:${s.time ?? '-'}${s.isStart ? ':start' : ''}`).join(' '));
check(mapStops(shown, false).every((s) => s.id !== 'm4') && mapStops(shown, false).length === 3, 'OpenFreeMap map: the Google place is not drawn');
const doneFirst = mapTask([{ ...B, status: 'done' }, { ...C, status: 'skipped' }, { ...D }], LEGS);
check(mapStops(doneFirst, true).map((s) => s.state).join(',') === 'done,done,current' && currentStop(doneFirst)?.id === 'm3',
  'done and skipped stops look done, the first one still to do is the current stop');

const lines = routeLines(mapTask([{ ...B, status: 'done' }, { ...C }, { ...D }], LEGS), true);
check(lines.length === 3 && lines[0].done && !lines[1].done && !lines[2].done && lines[0].points.length === 3,
  "Google's line, leg by leg: the driven leg muted, the base leg without a line left out", lines.map((l) => [l.key, l.done, l.points.length]));
check(routeLines(mapTask(ROUTE, LEGS), false).length === 0, "the OpenFreeMap map never gets Google's line (rule 10)");
check(routeLines(mapTask([{ ...B }, { ...C }], LEGS), true).length === 2, 'a leg to a stop no longer on the task is not drawn');
check(hasRouteLine(mapTask(ROUTE, LEGS)) && !hasRouteLine(mapTask(ROUTE, LEGS.map(({ line: _line, ...leg }) => leg))) && !hasRouteLine(mapTask(ROUTE, null))
  && !hasRouteLine(mapTask(ROUTE, [{ ...LEGS[0], line: '~' }])),
  'a stored line, none (the open package, the estimate, after 30 days), no plan, a broken line: "Stops only"');

const startTask = mapTask(ROUTE, LEGS);
check(startPoint(startTask, false)?.lat === A.lat, "the trip's start is drawn when it is not a stop");
check(startPoint({ ...startTask, start_google_place_id: 'gp0' }, false) === null && startPoint({ ...startTask, start_google_place_id: 'gp0' }, true) !== null,
  "a start from Google's search: on Google's map only");
check(startPoint(shown, true) === null, 'passengers get in at the start: the start is Stop 1, no separate start pin');

// The framing: again when the stops, the line or the start change, or the first position comes; never on a status or a move.
const keyOf = (task: ReturnType<typeof mapTask>, hasMe: boolean) => fitKey(mapStops(task, true), routeLines(task, true), startPoint(task, true), hasMe);
const k0 = keyOf(mapTask(ROUTE, LEGS), true);
check(keyOf(mapTask([{ ...B, status: 'done' }, { ...C }, { ...D }], LEGS), true) === k0, 'a stop done: the map does not jump');
check(keyOf(mapTask([{ ...B }, { ...northOf(C, 1) }, { ...D }], LEGS), true) !== k0, 'the office moved a stop: the map frames the route again');
check(keyOf(mapTask(ROUTE, LEGS), false) !== k0, 'the first position: the map frames again with the phone');
const one = frameOf([B, northOf(B, 0.05)]);
const box = frameOf([A, B, C]);
check(frameOf([]).kind === 'none' && one.kind === 'point' && box.kind === 'box' && box.sw.lat === A.lat && box.ne.lat === C.lat,
  'framing: nothing, one place (a zoom), or the box around the route', [one, box]);

// The compass: only while the map is turned or tilted.
check(!isTurned(0, 0) && !isTurned(359.5, 0) && !isTurned(-0.4, 0.2) && !isTurned(null, undefined), 'north-up and flat: no compass');
check(isTurned(12, 0) && isTurned(350, 0) && isTurned(0, 30), 'turned or tilted: the compass shows');

console.log(failures === 0 ? '\nAll day rules tests passed.' : `\n${failures} day rules test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
