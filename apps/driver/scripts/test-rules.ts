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
  earlyFinish,
  lastStopOpen,
  NO_GPS_OVERRIDE_AFTER_MS,
} from '../src/lib/dayRules';
import type { TaskStop } from '../src/lib/types';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

/** A stop row with everything empty but what the test sets. */
function stop(fields: Partial<TaskStop>): TaskStop {
  return {
    address: null, arrival_accuracy_m: null, arrival_at: null, arrival_distance_m: null, arrival_flag: null, arrival_lat: null,
    arrival_lng: null, arrive_by: null, arrived_at: null, auto_detected_at: null, done_at: null, dwell_min: null,
    google_fetched_at: null, google_place_id: null, id: 's', lat: null, lng: null, note: null, place_id: null,
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

console.log(failures === 0 ? '\nAll day rules tests passed.' : `\n${failures} day rules test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
