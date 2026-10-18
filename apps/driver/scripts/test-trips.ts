// Tests of the trips the driver starts (Phase 7 §13): the purpose choices by the office's setting, the destination
// from each kind of search result, what may be picked with no connection, the request and queue payloads (ids made on
// the phone), the phone's own copy of a trip and the server's answer merged into it, driver-api's answers, and the
// queue: a trip started offline goes before the Start task that follows it, its first stop's id is mapped to the
// server's, a resend after a lost answer makes nothing twice, a removed place falls back to its pin, a refusal is kept.
// Pure code, no stack needed:
//
//   npm run test:trips          (from apps/driver)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as realApi from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { canMarkDone, earlyFinish, lastStopOpen } from '../src/lib/dayRules';
import { createDriverApi } from '../src/lib/driverApi';
import { drawnDestination } from '../src/lib/mapRule';
import {
  allowedOffline,
  answerKind,
  canAddStop,
  type Choice,
  errorWords,
  isSessionToken,
  isUuid,
  keepLocalTrips,
  type KnownPlace,
  knownFromPick,
  knownFromTasks,
  localTrip,
  MAX_STOPS,
  mergeKnown,
  offlineMatches,
  parsePersonalTrips,
  parseSearchAnswer,
  parseTripAnswer,
  pickFromKnown,
  pickFromPin,
  pickFromResult,
  pickFromText,
  purposeChoices,
  rememberPlace,
  rememberStopId,
  type SearchResult,
  shouldSearch,
  stopRequest,
  type TripAnswer,
  tripCreateOp,
  type TripRequest,
  tripRequest,
  tripStopOp,
  tripTitle,
  withAddedStop,
  withCard,
} from '../src/lib/trips';
import type { TaskWithStops } from '../src/lib/types';
import { createSync, type Op, type QueueStore, type StoredOp } from '../src/sync/engine';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const TRIP_ID = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const STOP_LOCAL = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const STOP_SERVER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PLACE_ID = '11111111-2222-4333-8444-555555555555';
const VEHICLE = '99999999-8888-4777-8666-555555555555';
const AT = '2026-10-18T08:30:00.000Z';

async function main() {
  // --- 1. Company work or Personal, by driver_personal_trips -------------------------------------------------------
  console.log('Purpose by the setting:');
  check(same(purposeChoices('allowed'), { options: ['company', 'personal'], preselected: 'company', showChoice: true }), 'allowed: both, Company work preselected');
  check(same(purposeChoices('default'), { options: ['company', 'personal'], preselected: 'personal', showChoice: true }), 'default: both, Personal preselected');
  check(same(purposeChoices('off'), { options: ['company'], preselected: 'company', showChoice: false }), 'off: company only, no choice shown');
  check(same(purposeChoices('ask_first'), purposeChoices('allowed')), 'ask_first (reserved) behaves as allowed');
  check(parsePersonalTrips('default') === 'default' && parsePersonalTrips('nonsense') === 'allowed' && parsePersonalTrips(undefined) === 'allowed', 'an unknown or missing value reads as allowed (the server default)');

  // --- 2. The destination from each kind of search result ------------------------------------------------------------
  console.log('\nThe destination the server takes:');
  const session = '7b0f6a5e-0d2c-4e5a-9f1b-2c3d4e5f6a7b';
  const ours: SearchResult = { layer: 'place', badge: 'Office', name: 'Head office, Colombo 05', detail: 'Havelock Road', id: PLACE_ID, pinned: true, lat: 6.88, lng: 79.86 };
  const google: SearchResult = { layer: 'google', badge: 'Google', name: 'Kadawatha Junction', detail: 'Kadawatha', google_place_id: 'ChIJ-abc', pinned: false, attribution: 'Google Maps' };
  const map: SearchResult = { layer: 'map', badge: 'Map', name: 'Kiribathgoda', pinned: true, lat: 6.98, lng: 79.93 };
  const recentNoPin: SearchResult = { layer: 'recent', badge: 'Used before', name: 'Site gate 4', pinned: false };
  const pOurs = pickFromResult(ours, session);
  check(same(pOurs.destination, { place_id: PLACE_ID }) && pOurs.placeId === PLACE_ID && pOurs.lat === 6.88, 'our place: by its id (the phone keeps its pin for its own copy)', pOurs);
  check(same(pOurs.fallback, { lat: 6.88, lng: 79.86, name: 'Head office, Colombo 05' }), 'our place carries its pin as the fallback (a place removed while the trip waited)', pOurs.fallback);
  const pGoogle = pickFromResult(google, session);
  check(same(pGoogle.destination, { google_place_id: 'ChIJ-abc', name: 'Kadawatha Junction', session }), "Google's: its id, its name and the box's session token", pGoogle.destination);
  check(pGoogle.lat === null && pGoogle.lng === null && pGoogle.googlePlaceId === 'ChIJ-abc', "Google's pin is never on the phone (the server fetches it)");
  check(!('session' in pickFromResult(google, 'bad token!').destination), 'a session that is not a token is left out');
  check(same(pickFromResult(map).destination, { lat: 6.98, lng: 79.93, name: 'Kiribathgoda' }), "the map's: by its pin and name");
  check(same(pickFromResult(recentNoPin).destination, { text: 'Site gate 4' }), 'used before with no pin: its words');
  check(same(pickFromPin({ lat: 6.9, lng: 79.9 }).destination, { lat: 6.9, lng: 79.9 }), 'a pasted pin: its coordinates (the server names it)');
  check(same(pickFromText('  Kadawatha market  ')?.destination, { text: 'Kadawatha market' }) && pickFromText('   ') === null, 'the typed words, trimmed; nothing typed = no choice');
  check((pickFromText('x'.repeat(300))?.name.length ?? 0) === 160, 'the words are cut at 160 characters (the server takes 160)');
  check(shouldSearch('ka') && !shouldSearch('k') && !shouldSearch('  k '), 'the box asks from 2 characters');

  // --- 3. What works with no connection ------------------------------------------------------------------------------
  console.log('\nNo connection:');
  check(allowedOffline(pOurs) && allowedOffline(pickFromText('Kadawatha')!), 'our place and the typed words may be picked offline');
  check(!allowedOffline(pGoogle) && !allowedOffline(pickFromResult(map)) && !allowedOffline(pickFromPin({ lat: 1, lng: 2 })), "Google's, the map's and a pin need the search (not offered offline)");
  const known: KnownPlace[] = [
    { id: 'p1', name: 'Head office, Colombo 05', address: 'Havelock Road', lat: 6.88, lng: 79.86 },
    { id: 'p2', name: 'Kandy store', address: 'Peradeniya Road', lat: 7.29, lng: 80.63 },
    { id: 'p3', name: 'Colombo warehouse', address: null, lat: null, lng: null, site_id: 'CW01' },
  ];
  check(same(offlineMatches('colombo', known).map((p) => p.id), ['p3', 'p1']), 'a name starting with the text comes first', offlineMatches('colombo', known).map((p) => p.id));
  check(same(offlineMatches('head havelock', known).map((p) => p.id), ['p1']), 'every word must be in the name, site id or address');
  check(same(offlineMatches('cw0', known).map((p) => p.id), ['p3']), 'a site id matches');
  check(offlineMatches('k', known).length === 0, 'one character: nothing yet');
  const pKnown = pickFromKnown(known[1]);
  check(same(pKnown.destination, { place_id: 'p2' }) && same(pKnown.fallback, { lat: 7.29, lng: 80.63, name: 'Kandy store' }), 'a known place: by its id, its pin as the fallback');
  check(same(pickFromKnown(known[2]).fallback, { text: 'Colombo warehouse' }), 'a known place with no pin falls back to its words');
  const list = rememberPlace(rememberPlace(rememberPlace([], known[0]), known[1]), known[0]);
  check(same(list.map((p) => p.id), ['p1', 'p2']), 'picked places: newest first, each once');
  check(rememberPlace(Array.from({ length: 60 }, (_, i) => ({ ...known[0], id: `x${i}` })), known[1]).length === 50, 'at most 50 kept');
  check(knownFromPick(pGoogle) === null && knownFromPick(pOurs)?.id === PLACE_ID, 'only our places are remembered');
  const taskStops = [{ task_stops: [{ place_id: 'p9', place_name: 'Site 9', address: null, lat: 7, lng: 80, google_place_id: null }, { place_id: 'g', place_name: 'G', address: null, lat: 7, lng: 80, google_place_id: 'ChIJ' }] }] as unknown as TaskWithStops[];
  check(same(knownFromTasks(taskStops).map((p) => p.id), ['p9']), "our places on the driver's tasks count (never a Google stop)");
  check(same(mergeKnown([known[1]], known).map((p) => p.id), ['p2', 'p1', 'p3']), 'the lists together, each place once');

  // --- 4. The request and the queue's ops -------------------------------------------------------------------------
  console.log('\nThe request and the queue:');
  const req = tripRequest({ id: TRIP_ID, purpose: 'personal', pick: pOurs, note: '  dropping the laptop  ', vehicleId: VEHICLE, at: AT });
  check(same(req, { id: TRIP_ID, purpose: 'personal', destination: { place_id: PLACE_ID }, note: 'dropping the laptop', vehicle_id: VEHICLE, at: AT }), 'POST /trips: id, purpose, destination, the note trimmed, the vehicle, the time', req);
  const bare = tripRequest({ id: TRIP_ID, purpose: 'company', pick: pickFromText('Kadawatha')!, note: '   ', vehicleId: null, at: AT });
  check(!('note' in bare) && !('vehicle_id' in bare) && !('stop_id' in bare), 'no note and no vehicle: left out (the server takes the vehicle today)');
  const withStop = tripRequest({ id: TRIP_ID, stopId: STOP_LOCAL, purpose: 'company', pick: pickFromText('Kadawatha')!, note: '', vehicleId: VEHICLE, at: AT });
  check(withStop.stop_id === STOP_LOCAL, "the first stop's id is the phone's (the server keeps it: Arrived queued before the trip lands on it)", withStop);
  check(isUuid(TRIP_ID) && !isUuid('trip-1') && isSessionToken(session) && !isSessionToken('short'), 'ids are uuids; a uuid is a valid session token (36 of [A-Za-z0-9_-])');
  const createOp = tripCreateOp(req, STOP_LOCAL, pOurs);
  check(same(createOp, { kind: 'trip_create', id: TRIP_ID, request: req, local_stop_id: STOP_LOCAL, fallback: pOurs.fallback }), 'trip_create: the request, the local stop id and the fallback', createOp);
  const sreq = stopRequest('cccccccc-dddd-4eee-8fff-000000000000', pickFromText('Petrol shed')!);
  check(same(tripStopOp(TRIP_ID, sreq, pickFromText('Petrol shed')!), { kind: 'trip_stop', id: sreq.id, task_id: TRIP_ID, destination: { text: 'Petrol shed' } }), 'trip_stop: the stop id, the trip and the destination');
  check(answerKind(201) === 'ok' && answerKind(200) === 'ok' && answerKind(409) === 'refused', '2xx ok; 409 a refusal (its words on the screen)');
  check(['retry', 'retry', 'retry', 'retry', 'retry'].join() === [0, 401, 408, 429, 503].map(answerKind).join(), 'no answer, 401, 408, 429, 5xx: try again later');
  check(answerKind(400) === 'failed' && answerKind(403) === 'failed' && answerKind(404) === 'failed', 'other 4xx: sending again changes nothing');
  check(errorWords({ error: 'refused', message: 'Finish "X" first.' }, 409) === 'Finish "X" first.' && errorWords({ error: 'bad_input' }, 400) === 'bad_input' && errorWords(null, 502) === 'HTTP 502', "an error's words: its message, its code, or the status");

  // --- 5. The phone's copy of a trip ------------------------------------------------------------------------------
  console.log("\nThe phone's copy:");
  const gReq = tripRequest({ id: TRIP_ID, purpose: 'company', pick: pGoogle, note: '', vehicleId: VEHICLE, at: AT });
  const copy = localTrip({ request: gReq, pick: pGoogle, employeeId: 'e1', employeeName: 'Kamal Perera', vehicleId: VEHICLE, localStopId: STOP_LOCAL });
  check(copy.kind === 'self' && copy.purpose === 'company' && copy.status === 'assigned' && copy.accepted_at === AT && copy.seen_at === AT, 'kind self, assigned, already seen and accepted (as the server makes it)');
  check(copy.leave_by === AT && copy.start_at === AT && copy.created_by === 'driver: Kamal Perera' && copy.title === tripTitle('company', 'Kadawatha Junction'), 'its leave-by is its start; created by the driver; the server\'s title', copy.title);
  check(copy.task_stops.length === 1 && copy.task_stops[0].id === STOP_LOCAL && copy.task_stops[0].type === 'visit' && copy.task_stops[0].status === 'pending', 'one visit, the local id');
  check(drawnDestination(copy.task_stops[0], false) === null && copy.task_stops[0].google_place_id === 'ChIJ-abc', 'a Google stop is never drawn on the OpenFreeMap map (its id is kept on the copy)');
  const runningCopy: TaskWithStops = { ...copy, status: 'in_progress', started_at: AT, start_odometer_km: 1000 };
  check(earlyFinish(runningCopy, 1001, Date.parse(AT) + 60_000) === null, 'no plan: no odometer check at Complete (item 18)');
  check(lastStopOpen(copy)?.id === STOP_LOCAL && !canMarkDone(copy.task_stops[0]), 'the stop rules still apply: Complete waits for the stop, Done after Arrived');
  check(tripTitle('personal', 'Kadawatha') === 'Personal trip · Kadawatha', 'a personal trip\'s title');

  // The server's answer merged in: the first stop takes the server's id, the copy's progress stays.
  const card: TripAnswer['trip'] = {
    task_id: TRIP_ID, title: 'Trip · Kadawatha Junction', kind: 'self', purpose: 'company', status: 'assigned', vehicle_id: VEHICLE, started_at: AT,
    stops: [{ stop_id: STOP_SERVER, seq: 1, type: 'visit', place: 'Kadawatha Junction', lat: 7.0, lng: 79.95, google: true, status: 'pending' }],
  };
  const arrived = { ...copy, status: 'in_progress', task_stops: [{ ...copy.task_stops[0], status: 'arrived', arrived_at: AT }] };
  const withQueuedStop = withAddedStop(arrived, 'local-added', pickFromText('Petrol shed')!);
  check(withQueuedStop.task_stops.length === 2 && withQueuedStop.task_stops[1].seq === 2 && withQueuedStop.task_stops[1].id === 'local-added', 'a stop added on the way comes last');
  check(withAddedStop(withQueuedStop, 'local-added', pickFromText('Petrol shed')!) === withQueuedStop, 'the same stop twice: added once');
  const merged = withCard(withQueuedStop, card, STOP_LOCAL);
  check(merged.task_stops[0].id === STOP_SERVER && merged.task_stops[0].status === 'arrived', "the first stop takes the server's id and keeps the phone's Arrived", merged.task_stops[0]);
  check(merged.task_stops[0].lat === 7.0 && drawnDestination(merged.task_stops[0], false) === null, "the server's pin comes in, still off the OpenFreeMap map");
  check(merged.task_stops.length === 2 && merged.task_stops[1].id === 'local-added', 'a stop still waiting on the phone stays');
  const markOnly = withCard({ ...copy, task_stops: [{ ...copy.task_stops[0], google_place_id: null }] }, card, STOP_LOCAL);
  check(drawnDestination(markOnly.task_stops[0], false) === null, 'a stop the server marks google stays off the OpenFreeMap map even without its id on the phone');
  check(canAddStop(merged) && !canAddStop(copy) && !canAddStop({ ...merged, kind: 'dispatch' }), "Add a stop: the driver's own trip, under way");
  const full = { ...merged, task_stops: Array.from({ length: MAX_STOPS }, (_, i) => ({ ...merged.task_stops[0], id: `s${i}`, seq: i + 1 })) };
  check(!canAddStop(full), '12 stops: no more');

  // A refresh read a moment before the trip was made keeps the phone's copy; once the list has it, the server's row.
  const pending = new Set([TRIP_ID]);
  const other = { ...copy, id: 'other', start_at: '2026-10-18T07:00:00.000Z' } as TaskWithStops;
  check(same(keepLocalTrips([other], [copy], pending).map((t) => t.id), ['other', TRIP_ID]) && pending.has(TRIP_ID), 'not in the list yet: the copy stays');
  const serverRow = { ...copy, title: 'from the server' } as TaskWithStops;
  const after = keepLocalTrips([other, serverRow], [copy], pending);
  check(after[1].title === 'from the server' && !pending.has(TRIP_ID), "in the list: the server's row, and it is no longer pending");
  let ids: Record<string, string> = {};
  for (let i = 0; i < 205; i++) ids = rememberStopId(ids, `l${i}`, `s${i}`);
  check(Object.keys(ids).length === 200 && ids.l204 === 's204' && !('l0' in ids), 'mapped stop ids: the newest 200 kept');

  // --- 6. The server's answers ------------------------------------------------------------------------------------
  console.log("\ndriver-api's answers:");
  const answerBody = { trip: { ...card, stops: [{ ...card.stops[0], lat: undefined }] }, repeated: false, personal_note: 'The office is told.' };
  check(parseTripAnswer(answerBody)?.trip.stops[0].stop_id === STOP_SERVER && parseTripAnswer(answerBody)?.personal_note === 'The office is told.', 'a trip answer is read');
  check(parseTripAnswer({ trip: { task_id: 1 } }) === null && parseTripAnswer(null) === null, 'anything else is not a trip');
  const search = parseSearchAnswer({ text: 'kad', results: [ours, google, { layer: 'odd', name: 'x' }, { layer: 'map', name: '' }], map_note: 'Google limit' });
  check(search.results.length === 2 && search.results[1].google_place_id === 'ChIJ-abc' && search.map_note === 'Google limit', 'a search answer is read; odd rows are left out');
  check(same(parseSearchAnswer({ text: '6.9,79.9', results: [], pin: { lat: 6.9, lng: 79.9, from: 'typed' } }).pin, { lat: 6.9, lng: 79.9 }), 'a pasted pin answer');

  type Sent = { url: string; headers: Record<string, string>; body: unknown };
  const sent: Sent[] = [];
  const fakeFetch = (status: number, body: unknown, fail?: Error) => (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    if (fail) throw fail;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const client = (status: number, body: unknown, fail?: Error, token: string | null = 'tok') =>
    createDriverApi({ baseUrl: 'https://x.supabase.co/functions/v1/driver-api', apiKey: 'pk', token: async () => token, fetch: fakeFetch(status, body, fail) });
  const made = await client(201, answerBody).createTrip(req);
  check(made.trip.task_id === TRIP_ID && !made.repeated, '201: the trip');
  check(sent[0].url === 'https://x.supabase.co/functions/v1/driver-api/trips' && sent[0].headers.Authorization === 'Bearer tok' && sent[0].headers.apikey === 'pk' && same(sent[0].body, req), 'POST /trips with the session and the key, the request as the body', sent[0]);
  check((await client(200, { ...answerBody, repeated: true }).createTrip(req)).repeated, '200 repeated: the same id again made nothing new');
  await client(201, answerBody).addTripStop(TRIP_ID, sreq);
  check(sent.at(-1)?.url.endsWith(`/trips/${TRIP_ID}/stops`) === true && same(sent.at(-1)?.body, sreq), 'POST /trips/:id/stops with the stop request');
  await client(200, answerBody).cancelTrip(TRIP_ID);
  check(sent.at(-1)?.url.endsWith(`/trips/${TRIP_ID}/cancel`) === true && same(sent.at(-1)?.body, {}), 'POST /trips/:id/cancel: a trip started by mistake');
  const errorOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ApiError);
  const refused = await errorOf(client(409, { error: 'refused', message: 'Personal trips are switched off by the office: choose Company work.' }).createTrip(req));
  check(refused instanceof ApiError && refused.permanent && refused.code === 'refused' && refused.message.startsWith('Personal trips are switched off'), "409: a refusal, permanent, the server's words as they are", refused?.message);
  const bad = await errorOf(client(400, { error: 'bad_input', issues: [] }).createTrip(req));
  check(bad instanceof ApiError && bad.permanent && bad.code !== 'refused', '400: permanent');
  for (const status of [401, 429, 500]) {
    const e = await errorOf(client(status, { error: 'x' }).createTrip(req));
    check(e instanceof ApiError && !e.permanent, `${status}: try again later`);
  }
  const net = await errorOf(client(0, null, new Error('Network request failed')).createTrip(req));
  check(net instanceof ApiError && !net.permanent, 'no connection: try again later (the trip is queued)');
  const noToken = await errorOf(client(201, answerBody, undefined, null).createTrip(req));
  check(noToken instanceof ApiError && !noToken.permanent, 'not signed in yet: later');
  const garbled = await errorOf(client(201, { nothing: true }).createTrip(req));
  check(garbled instanceof ApiError && !garbled.permanent, 'an answer with no trip: as if none came (the id makes the next try harmless)');
  const found = await client(200, { text: 'kad', results: [ours] }).searchPlaces('kad', session);
  check(found.results[0].id === PLACE_ID && same(sent.at(-1)?.body, { text: 'kad', session }), 'search: the text and the session');

  // --- 7. The queue ------------------------------------------------------------------------------------------------
  console.log('\nThe queue:');
  await queueTests(req, pOurs);

  // --- 8. Strings ----------------------------------------------------------------------------------------------------
  console.log('\nStrings (en and si):');
  const here = dirname(fileURLToPath(import.meta.url));
  const en = JSON.parse(readFileSync(join(here, '../src/i18n/en.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const si = JSON.parse(readFileSync(join(here, '../src/i18n/si.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const files = ['src/app/start-trip.tsx', 'src/app/add-stop.tsx', 'src/components/PlaceSearch.tsx', 'src/app/(tabs)/index.tsx', 'src/app/task/[id].tsx', 'src/state/app.tsx', 'src/lib/trips.ts', 'src/components/taskLines.ts'];
  const keys = new Set<string>();
  for (const file of files) for (const m of readFileSync(join(here, '..', file), 'utf8').matchAll(/'((?:trip|common|today|task|log)\.[A-Za-z.]+)'/g)) keys.add(m[1]);
  const lookup = (src: Record<string, Record<string, unknown>>, key: string) => key.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown> | undefined)?.[p], src);
  const missing = [...keys].filter((k) => typeof lookup(en, k) !== 'string' || typeof lookup(si, k) !== 'string');
  check(missing.length === 0 && keys.has('trip.typed') && keys.has('trip.queued'), `every key the trip screens use is in en and si (${keys.size} keys)`, missing);
  const tripKeys = Object.keys(en.trip ?? {});
  check(tripKeys.length > 0 && tripKeys.every((k) => typeof si.trip?.[k] === 'string'), 'every trip.* key has its Sinhala');

  // The screens' source, read as text (they need React Native). The back rules of CLAUDE.md.
  console.log('\nNavigation (the screens as text):');
  const source = (file: string) => readFileSync(join(here, '..', file), 'utf8');
  const today = source('src/app/(tabs)/index.tsx');
  const startTrip = source('src/app/start-trip.tsx');
  const addStop = source('src/app/add-stop.tsx');
  const taskScreen = source('src/app/task/[id].tsx');
  check(/app\.sharing && !running && \(\s*<Button [^\n]*t\('trip\.start'\)[^\n]*router\.push\('\/start-trip'\)/.test(today), 'Today: Start a trip only on duty with no task in progress, pushed (back returns to Today)');
  check(/useLeaveGuard\(dirty, busy\)/.test(startTrip) && /const dirty = text\.trim\(\) !== '' \|\| note\.trim\(\) !== '' \|\| pick !== null/.test(startTrip), 'Start a trip: "Discard changes?" only when something was typed or picked; nothing while it starts');
  check(/allowLeave\(\);[\s\S]*router\.replace\(\{ pathname: '\/log-mileage', params: \{ mode: 'start', taskId: outcome\.taskId/.test(startTrip), 'after Start: the normal Start task flow takes the page\'s place (no question asked)');
  check(/requireLocation\('start'/.test(startTrip), 'Location first (like Start task): "Not now" makes nothing');
  check(/useLeaveGuard\(dirty, busy\)/.test(addStop) && /allowLeave\(\);[\s\S]*router\.back\(\)/.test(addStop), 'Add a stop: pushed on the task screen, back returns there; after adding, no question');
  check(/canAddStop\(task\) && \([\s\S]*pathname: '\/add-stop'/.test(taskScreen), 'the task screen offers Add a stop only on a self trip under way');
  check(/!isSelfTrip\(task\) && <Button kind="danger-text" label=\{t\('task\.cantDo'\)\}/.test(taskScreen) && /!isSelfTrip\(next\) && <Button kind="danger-text"/.test(today), "no \"Can't do this task\" on a trip the driver started");

  console.log(failures === 0 ? '\nAll trip tests passed.' : `\n${failures} trip test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/** The queue in memory (as test-sync.ts), with the failed marks the phone's SQLite keeps. */
function memoryStore() {
  let seq = 0;
  const ops: (StoredOp & { failed?: string })[] = [];
  const store: QueueStore = {
    nextOps: (limit) => ops.filter((item) => item.failed === undefined).slice(0, limit),
    removeOp: (id) => void ops.splice(ops.findIndex((item) => item.seq === id), 1),
    updateOp: (id, op) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.op = op;
    },
    failOp: (id, error) => {
      const found = ops.find((item) => item.seq === id);
      if (found) found.failed = error;
    },
    nextPoints: () => [],
    removePoints: () => undefined,
    rejectPoints: () => undefined,
    nextHeartbeats: () => [],
    removeHeartbeats: () => undefined,
    rejectHeartbeats: () => undefined,
  };
  return {
    store,
    add: (...list: Op[]) => list.forEach((op) => ops.push({ seq: ++seq, op })),
    waiting: () => ops.filter((item) => item.failed === undefined).map((item) => item.op.kind),
    failed: () => ops.filter((item) => item.failed !== undefined).map((item) => ({ kind: item.op.kind, error: item.failed })),
  };
}

/** A fake driver-api with the server's rules that matter here: one trip per id, a stop only on a trip it has. */
function fakeTrips() {
  const trips = new Map<string, TripAnswer['trip']>();
  const log: string[] = [];
  let network = false;
  let loseAnswer = false;
  const refusePlaces = new Set<string>();
  let refuseAll: string | null = null;
  const api = {
    async createTrip(request: TripRequest): Promise<TripAnswer> {
      log.push(`trip:${JSON.stringify(request.destination)}`);
      if (request.queued !== true) log.push('trip:not-marked-queued');
      if (network) throw new ApiError('trip: Network request failed', false);
      if (refuseAll) throw new ApiError(refuseAll, true, 'refused', 409);
      const d = request.destination as { place_id?: string };
      if (d.place_id && refusePlaces.has(d.place_id)) throw new ApiError('That place is not in the list any more: search again.', true, 'refused', 409);
      const had = trips.get(request.id);
      if (had) return { trip: had, repeated: true };
      const trip = { task_id: request.id, title: 'Trip · X', kind: 'self', purpose: request.purpose, status: 'assigned', vehicle_id: VEHICLE, started_at: AT, stops: [{ stop_id: STOP_SERVER, seq: 1, type: 'visit', place: 'X', status: 'pending' }] };
      trips.set(request.id, trip);
      if (loseAnswer) {
        loseAnswer = false;
        throw new ApiError('trip: Network request failed', false); // made on the server, the answer lost on the way
      }
      return { trip, repeated: false };
    },
    async addTripStop(taskId: string, request: { id: string; queued?: boolean }): Promise<TripAnswer> {
      log.push(`stop:${taskId}:${request.id}`);
      if (request.queued !== true) log.push('stop:not-marked-queued');
      if (network) throw new ApiError('trip stop: Network request failed', false);
      const trip = trips.get(taskId);
      if (!trip) throw new ApiError('No such trip.', true, 'refused', 409);
      if (!trip.stops.some((s) => s.stop_id === request.id)) trip.stops.push({ stop_id: request.id, seq: trip.stops.length + 1, type: 'visit', place: 'Y', status: 'pending' });
      return { trip, repeated: false };
    },
  };
  return {
    api,
    log,
    trips,
    set: (o: { network?: boolean; loseAnswer?: boolean; refusePlace?: string; refuseAll?: string | null }) => {
      if (o.network !== undefined) network = o.network;
      if (o.loseAnswer !== undefined) loseAnswer = o.loseAnswer;
      if (o.refusePlace) refusePlaces.add(o.refusePlace);
      if (o.refuseAll !== undefined) refuseAll = o.refuseAll;
    },
  };
}

async function queueTests(req: TripRequest, pick: Choice) {
  const clock = { now: 1_000_000 };
  const make = (q: ReturnType<typeof memoryStore>, trips: ReturnType<typeof fakeTrips>, calls: string[], extra: { refused?: string[]; answers?: string[] } = {}) => {
    const api = {
      ...realApi,
      insertPhoto: async () => void calls.push('photo'),
      insertOdometerLog: async (_c: unknown, row: realApi.OdometerInsert) => void calls.push(`odometer:${row.task_id}`),
      patchTask: async (_c: unknown, id: string, patch: realApi.TaskPatch) => void calls.push(`task:${id}:${patch.status}`),
      patchStop: async (_c: unknown, id: string, patch: realApi.StopPatch) => void calls.push(`stop:${id}:${patch.status}`),
      insertReport: async () => void calls.push('report'),
    } as unknown as typeof realApi;
    return createSync({
      client: {} as realApi.Client,
      store: q.store,
      employeeId: () => 'e1',
      uploadFile: async () => void calls.push('upload'),
      removeFile: () => undefined,
      api,
      now: () => clock.now,
      trips: trips.api,
      onTrip: (op, answer) => extra.answers?.push(`${op.kind}:${answer.repeated}`),
      onRefused: (op, message) => extra.refused?.push(`${op.kind}:${message}`),
    });
  };
  const photo: Op = { kind: 'photo', id: 'ph1', employee_id: 'e1', photo_kind: 'odometer', storage_path: 'e1/x.jpg', local_uri: 'file:///x.jpg', taken_at: AT, lat: null, lng: null, vehicle_report_id: null };
  const odometer: Op = { kind: 'odometer_log', row: { id: 'o1', vehicle_id: VEHICLE, employee_id: 'e1', task_id: req.id, reading_km: 1000, kind: 'task_start', logged_at: AT } };
  const start: Op = { kind: 'task_patch', id: req.id, patch: { status: 'in_progress', start_odometer_km: 1000, started_at: AT } };
  const arrivedOp: Op = { kind: 'stop_patch', id: STOP_LOCAL, patch: { status: 'arrived', arrived_at: AT, arrival_flag: 'no_pin' } };
  const addedId = 'cccccccc-dddd-4eee-8fff-000000000000';
  const addStop = tripStopOp(req.id, stopRequest(addedId, pickFromText('Petrol shed')!), pickFromText('Petrol shed')!);

  // A trip started offline, then started, a stop arrived and another added, all with no connection.
  {
    const q = memoryStore();
    const trips = fakeTrips();
    const calls: string[] = [];
    const answers: string[] = [];
    const sync = make(q, trips, calls, { answers });
    q.add(tripCreateOp(req, STOP_LOCAL, pick), photo, odometer, start, arrivedOp, addStop);
    trips.set({ network: true });
    let r = await sync.flush();
    check(r.offline && q.waiting().join() === 'trip_create,photo,odometer_log,task_patch,stop_patch,trip_stop' && calls.length === 0, 'no connection: everything waits, in order (the Start task behind its trip)', q.waiting());
    trips.set({ network: false });
    clock.now = sync.backoff().nextTryAt;
    r = await sync.flush();
    check(r.sent === 6 && q.waiting().length === 0, 'the connection is back: all six go', r);
    // The log has the failed try with no connection, then the one that went.
    check(trips.log.join() === [`trip:${JSON.stringify(req.destination)}`, `trip:${JSON.stringify(req.destination)}`, `stop:${req.id}:${addedId}`].join() &&
      calls.join() === `upload,photo,odometer:${req.id},task:${req.id}:in_progress,stop:${STOP_SERVER}:arrived`,
      "the trip first, then the start; Arrived goes to the server's stop id; the added stop after", { calls, log: trips.log });
    check(answers.join() === 'trip_create:false,trip_stop:false', 'the screens hear both answers (the phone\'s copy takes the server\'s ids)', answers);
    check(!trips.log.some((l) => l.includes('not-marked-queued')), "the queue marks what it sends as queued (the trip happened: the server notes its rules instead of refusing)", trips.log);
  }

  // The server made the trip but the answer was lost: the queue sends it again; nothing is made twice.
  {
    const q = memoryStore();
    const trips = fakeTrips();
    const calls: string[] = [];
    const answers: string[] = [];
    const sync = make(q, trips, calls, { answers });
    q.add(tripCreateOp(req, STOP_LOCAL, pick), arrivedOp);
    trips.set({ loseAnswer: true });
    let r = await sync.flush();
    check(r.offline && q.waiting().join() === 'trip_create,stop_patch' && trips.trips.size === 1, 'the answer is lost: the op stays (the server has the trip)');
    clock.now = sync.backoff().nextTryAt;
    r = await sync.flush();
    check(r.sent === 2 && trips.trips.size === 1 && answers.join() === 'trip_create:true', 'sent again: the same trip answered as repeated, one trip on the server', { answers, n: trips.trips.size });
    check(calls.join() === `stop:${STOP_SERVER}:arrived`, "and Arrived still reaches the server's stop", calls);
  }

  // Our place was removed while the trip waited: once more with its pin.
  {
    const q = memoryStore();
    const trips = fakeTrips();
    const calls: string[] = [];
    const sync = make(q, trips, calls);
    trips.set({ refusePlace: PLACE_ID });
    q.add(tripCreateOp(req, STOP_LOCAL, pick));
    const r = await sync.flush();
    check(r.sent === 1 && trips.log.length === 2 && trips.log[1] === `trip:${JSON.stringify(pick.fallback)}`, 'the place refused: sent again with its pin, the trip is made', trips.log);
  }

  // Refused for good (personal switched off meanwhile): kept as failed, the screens hear why, the rest goes on.
  {
    const q = memoryStore();
    const trips = fakeTrips();
    const calls: string[] = [];
    const refused: string[] = [];
    const sync = make(q, trips, calls, { refused });
    trips.set({ refuseAll: 'Personal trips are switched off by the office: choose Company work.' });
    const report: Op = { kind: 'report', row: { id: 'r1', vehicle_id: VEHICLE, employee_id: 'e1', task_id: null, category: 'tyre', note: null, created_at: AT } };
    q.add(tripCreateOp(req, STOP_LOCAL, pickFromText('Kadawatha')!), report);
    const r = await sync.flush();
    check(r.failed === 1 && same(q.failed(), [{ kind: 'trip_create', error: 'Personal trips are switched off by the office: choose Company work.' }]), 'refused: kept on the phone as failed with the words (Me can try it again)', q.failed());
    check(r.sent === 1 && calls.join() === 'report', 'the rest of the queue goes on', { r, calls });
    check(refused.join() === 'trip_create:Personal trips are switched off by the office: choose Company work.', 'the screens hear the refusal and its words (trip.failed)', refused);
    check(trips.log.length === 1, 'no fallback for the typed words: asked once');
  }

  // No driver-api client (an old wiring): trip ops wait, never fail.
  {
    const q = memoryStore();
    const calls: string[] = [];
    const sync = createSync({ client: {} as realApi.Client, store: q.store, employeeId: () => 'e1', uploadFile: async () => undefined, removeFile: () => undefined, api: realApi, now: () => clock.now });
    q.add(tripCreateOp(req, STOP_LOCAL, pick));
    const r = await sync.flush({ force: true });
    check(r.offline && q.waiting().join() === 'trip_create' && calls.length === 0, 'without the client the trip waits (tried again later)');
  }
}

void main();
