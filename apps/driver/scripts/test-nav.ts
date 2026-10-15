// Tests of the navigation hand-off and the arrival nudge's rule (Part 4b). Pure code, no stack needed:
//
//   npm run test:nav          (from apps/driver)

import { arrivalDue } from '../src/lib/arrivalRule';
import { allStopsLink, navigateLink } from '../src/lib/format';
import { drawnDestination } from '../src/lib/mapRule';
import type { TaskStop, TaskWithStops } from '../src/lib/types';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

const stop = (seq: number, patch: Partial<TaskStop> = {}): TaskStop =>
  ({ id: `s${seq}`, task_id: 't1', seq, type: 'drop', place_name: `Stop ${seq}`, address: null, lat: 7 + seq / 100, lng: 80, status: 'pending', ...patch }) as TaskStop;

// 1. Navigate: turn by turn to the current stop's pin, else its address.
check(navigateLink({ lat: 6.9271, lng: 79.8612 }) === 'https://www.google.com/maps/dir/?api=1&destination=6.9271%2C79.8612&travelmode=driving&dir_action=navigate',
  'Navigate opens turn-by-turn driving to the pin', navigateLink({ lat: 6.9271, lng: 79.8612 }));
check(navigateLink({ text: 'Galle Road, Colombo 03' })?.includes('destination=Galle%20Road%2C%20Colombo%2003&travelmode=driving&dir_action=navigate') === true, 'no pin: the address');
check(navigateLink({}) === null, 'nothing to go to: no link');

// 2. All stops: the remaining stops in order, the last as the destination, at most 9 waypoints.
const three = allStopsLink([stop(1), stop(2, { lat: null, lng: null, address: 'Kandy Road' }), stop(3)]);
check(three !== null && three.shown === 3 && three.left === 0
  && three.url === 'https://www.google.com/maps/dir/?api=1&destination=7.03%2C80&travelmode=driving&dir_action=navigate&waypoints=7.01%2C80%7CKandy%20Road',
  'All stops: the stops in order, an address where there is no pin', three);
const twelve = allStopsLink(Array.from({ length: 12 }, (_, i) => stop(i + 1)));
check(twelve !== null && twelve.shown === 10 && twelve.left === 2 && twelve.url.split('%7C').length === 9, 'twelve stops: the first ten (9 waypoints + the destination), 2 left out', twelve && { shown: twelve.shown, left: twelve.left });
check(allStopsLink([]) === null, 'no stops: no link');

// 3. The arrival nudge: the running task's current stop, within 150 m, once, a sure enough fix.
const task = (stops: TaskStop[], status = 'in_progress'): TaskWithStops => ({ id: 't1', status, task_stops: stops } as unknown as TaskWithStops);
const near = { lat: 7.01 + 100 / 111320, lng: 80, accuracyM: 8 }; // 100 m north of stop 1
const far = { lat: 7.01 + 200 / 111320, lng: 80, accuracyM: 8 };
check(arrivalDue([task([stop(1), stop(2)])], near, [])?.stop.id === 's1', 'within 150 m of the current stop: due');
check(arrivalDue([task([stop(1), stop(2)])], far, []) === null, '200 m away: not yet');
check(arrivalDue([task([stop(1), stop(2)])], near, ['s1']) === null, 'once per stop');
check(arrivalDue([task([stop(1), stop(2)])], { ...near, accuracyM: 120 }, []) === null, 'a fix worse than 75 m never triggers it');
check(arrivalDue([task([stop(1, { status: 'arrived' }), stop(2)])], near, []) === null, 'already tapped Arrived: no nudge');
check(arrivalDue([task([stop(1, { status: 'done' }), stop(2)])], { lat: 7.02, lng: 80, accuracyM: 5 }, [])?.stop.id === 's2', 'after Done the next stop is the current one');
check(arrivalDue([task([stop(1, { lat: null, lng: null })])], near, []) === null, 'a stop without a pin: no nudge');
check(arrivalDue([task([stop(1)], 'assigned')], near, []) === null, 'no task running: no nudge');

console.log('\nThe task map and Google places (Part 5):');
check(JSON.stringify(drawnDestination({ lat: 7.29, lng: 80.63, google_place_id: null }, false)) === '[80.63,7.29]', 'our own stop: drawn on the OpenFreeMap map');
check(drawnDestination({ lat: 7.29, lng: 80.63, google_place_id: 'ChIJ-x' }, false) === null, 'a Google place: never drawn on the OpenFreeMap map (Google\'s terms)');
check(JSON.stringify(drawnDestination({ lat: 7.29, lng: 80.63, google_place_id: 'ChIJ-x' }, true)) === '[80.63,7.29]', 'a Google place on Google\'s map: drawn');
check(drawnDestination({ lat: null, lng: null, google_place_id: null }, false) === null, 'a stop without a pin: nothing drawn');

console.log(failures === 0 ? '\nAll navigation tests passed.' : `\n${failures} navigation test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
