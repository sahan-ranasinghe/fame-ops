// Hotfix O2-H1, Part A: the office's location search box, no phone: the search rule (from 2 characters or a pasted pin),
// the states under the field (never an empty list while a search is pending or failed), the suggestions' input, the
// badges, and the box read as text: the search runs after the person typed (never skipped because the form holds the
// text), the request's shape (search_places {text} / {text, google, session} / {suggest, near}), Try again re-asks, the
// Google opt-in, the strings in both languages, and the server's suggestions branch.
//
//   npm run test:search          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { badgeTone, DEBOUNCE_MS, looksPasted, MIN_CHARS, placeBoxState, searchState, shouldSearch, suggestArgs, typedPatch } from '../src/office/trip/locationLogic';
import { draftsFromStops, newStop } from '../src/office/trip/stopsLogic';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

console.log('\nThe search rule');
{
  check(MIN_CHARS === 2 && DEBOUNCE_MS === 300, 'from 2 characters, 300 ms after the last key (the site\'s rule)');
  check(!shouldSearch('K') && shouldSearch('Ku') && shouldSearch('  Kurunegala ') && !shouldSearch('   '), 'two characters, spaces not counted');
  check(looksPasted('6.9271, 79.8612') && shouldSearch('6.9271, 79.8612') && looksPasted('https://maps.app.goo.gl/abc'), 'a pasted pin or link is searched whatever its length');
}

console.log('\nThe states under the field');
{
  const none = { results: [] as unknown[] };
  check(searchState({ searchable: false, busy: false, answer: null, problem: null }) === 'idle', 'an empty box: idle (the suggestions show instead)');
  check(searchState({ searchable: true, busy: true, answer: null, problem: null }) === 'searching', 'a search pending with no answer yet: Searching…');
  check(searchState({ searchable: true, busy: false, answer: none, problem: null }) === 'none', 'an answer with nothing: No places found');
  check(searchState({ searchable: true, busy: false, answer: { results: [{}] }, problem: null }) === 'results', 'results');
  check(searchState({ searchable: true, busy: false, answer: { results: [], pin: { lat: 1, lng: 2 } }, problem: null }) === 'results', 'a pin alone is a result');
  check(searchState({ searchable: true, busy: false, answer: null, problem: 'Fame Fleet did not answer' }) === 'error', 'a failed search: the error (with Try again)');
  check(searchState({ searchable: true, busy: true, answer: { results: [{}] }, problem: null }) === 'results', 'a new search keeps the last results on screen while it runs');
  check(searchState({ searchable: true, busy: false, answer: null, problem: null }) === 'idle', 'searchable but not typed (a value the form loaded): nothing pending, nothing shown');
}

console.log('\nTyping never chooses a place (the box locked after one letter: Hotfix O2-H1)');
{
  // A fresh stop: the box is a field; "s", "sa", "sal" keep the text in the draft and the box stays a field with the search states under it.
  let stop = newStop('drop');
  check(placeBoxState(stop, false) === 'field', 'a fresh stop: a text field');
  const states: string[] = [];
  for (const text of ['s', 'sa', 'sal']) {
    stop = { ...stop, ...typedPatch(text) };
    states.push(`${placeBoxState(stop, false)}/${searchState({ searchable: shouldSearch(text), busy: shouldSearch(text), answer: null, problem: null })}`);
  }
  check(same(states, ['field/idle', 'field/searching', 'field/searching']) && stop.place === 'sal' && stop.picked === false, '"s", "sa", "sal": the box keeps the text and shows the search states, never the picked state', states);
  check(stop.placeId === undefined && stop.googlePlaceId === undefined && stop.lat === undefined, 'typing clears any earlier pick and its ids');
  // A result tapped → the picked state; Change → the field again with the text; leaving and returning restores the text.
  const picked = { ...stop, place: 'Salawa site', picked: true as const, placeId: 'p1', placePinned: true, lat: 6.9, lng: 80.0 };
  check(placeBoxState(picked, false) === 'picked', 'a tapped result: the picked state');
  check(placeBoxState(picked, true) === 'field', 'Change: the text field again');
  const typedAgain = { ...picked, ...typedPatch('Salawa s') };
  check(placeBoxState(typedAgain, false) === 'field' && typedAgain.place === 'Salawa s', 'typing after Change: the field, the new text kept');
  check(placeBoxState({ ...stop, place: 'sal' }, false) === 'field', 'leaving and returning with "sal" typed: the field with the text, not a fake place');
  check(draftsFromStops([{ type: 'drop', place: 'Kandy', place_id: 'p2' }])[0].picked === true && draftsFromStops([{ type: 'drop', place: 'Kandy town' }])[0].picked === true && draftsFromStops([{ type: 'drop' }])[0].picked === false, 'a stop loaded from the server (a request, a task) is a picked one; an empty one is not');
}

console.log('\nThe suggestions and the badges');
{
  check(same(suggestArgs(null), { suggest: true }) && same(suggestArgs({ lat: 6.9, lng: 79.8 }), { suggest: true, near: { lat: 6.9, lng: 79.8 } }), 'search_places {suggest} with the phone\'s position when known');
  check(badgeTone('Town') === 'muted' && badgeTone('Used before') === 'muted' && badgeTone('Office') === 'green' && badgeTone('Site · Dialog') === 'blue' && badgeTone('Map') === 'amber' && badgeTone('Google') === 'blue', 'the badge tones, the Town badge among them');
}

console.log('\nThe box as text');
{
  const box = read('src/components/office/PlaceSearch.tsx');
  const where = read('src/app/office/trip/where.tsx');
  check(where.includes("const box = placeBoxState(s, editing === s.key);") && where.includes("const open = box === 'field';") && where.includes("onText={(text) => patchStop(s.key, typedPatch(text))}") && where.includes("box === 'picked' ? <Txt"), 'Where: every stop box follows placeBoxState; the header names the place only when picked');
  check(where.includes("const startPicked = !f.start.trim() || !!(f.startPlaceId || f.startGooglePlaceId || (f.startLat !== undefined && f.startLng !== undefined));") && where.includes("start: text, startPlaceId: undefined"), 'Where: the start box too (typed text kept, the ids cleared, the base place as the default)');
  check(where.includes("picked: true, placeId: p.placeId") && where.includes("picked: true, placeId: undefined, placePinned: undefined, googlePlaceId: p.googlePlaceId"), 'a pick (a result, Google, My location, a pin) marks the stop picked');
  check(box.includes('selectTextOnFocus={editing}') && where.includes("editing={editing === s.key} autoFocus={editing === s.key}"), 'Change returns to the field with the previous text selected');
  check(box.includes('const typed = useRef(false);') && box.includes('if (!canSearch || !typed.current) return;') && !box.includes('text === value'), 'the search runs after the person typed, never skipped because the form already holds the text (the O2 bug)');
  check(box.includes('typed.current = true;\n            setText(v);\n            onText(v);'), 'typing sets the flag before the text');
  check((box.match(/typed\.current = false;/g) ?? []).length >= 3, 'a pick, My location and the clear button reset the flag');
  check(box.includes("api.call<SearchAnswer>('search_places', { text: text.trim(), ...(withGoogle ? { google: true, session: session.current } : {}) })"), 'the request: search_places {text} and, with the Google opt-in, {google, session}');
  check(box.includes("looksPasted(text) ? 0 : DEBOUNCE_MS"), 'a pasted pin is asked at once');
  check(box.includes("searchState({ searchable: !empty && typed.current, busy, answer, problem })") && ['searching', 'error', 'none', 'results'].every((s) => box.includes(`state === '${s}'`)), 'one of four things under the field, from the one rule');
  check(box.includes("setRetry((n) => n + 1)") && box.includes(", retry]);"), 'Try again re-runs the same search');
  check(box.includes("api.call<SearchAnswer>('search_places', suggestArgs(near))") && box.includes('Location.getLastKnownPositionAsync()') && !box.includes('requestForegroundPermissionsAsync().granted;\n      const pos = await Location.getLastKnownPositionAsync'), 'an empty box asks for suggestions, with the last known position only when already allowed (no prompt)');
  check(box.includes("setSuggest({ answer: null, busy: false, failed: false })") && box.includes('office.trip.suggestionsFailed'), 'failed suggestions say so with Try again');
  check(box.includes("canGoogle && !empty && !google") && box.includes("typed.current = true; setGoogle(true);"), 'the Google opt-in chip only under the google package, and it triggers a search');
  check(box.includes("r.layer === 'town' ? t('office.trip.townBadge') : r.badge"), 'the Town badge in the phone\'s language');
  check(!/'(admin|fleet_admin|office|viewer|staff)'/.test(box), 'no role names');
}

console.log('\nThe server\'s suggestions');
{
  const places = read('../../supabase/functions/_shared/fleet/tools/places.ts');
  check(places.includes('text: z.string().trim().max(500).optional()') && places.includes('suggest: z.boolean().optional()') && places.includes('near: z.object({ lat:'), 'search_places takes an optional text, suggest and near (additive: the contract keeps its shape)');
  check(places.includes('if (suggest && typed.length < SEARCH_MIN_CHARS) {') && places.includes('db.rpc("recent_places", { p_text: "", p_since: since, p_limit: SUGGEST_LIMITS.recent })') && places.includes('.eq("operator", "other").not("lat", "is", null)') && places.includes('db.from("towns")'), 'an empty box: the places used before, our own pinned places, the towns in a box around the point');
  check(places.includes('nearPoint ?? (await basePoint(db, settings))?.point ?? COLOMBO'), 'nearest to the phone, else the base place, else Colombo');
  check(places.includes('layer: "town", badge: "Town"') && places.includes('suggested: true'), 'towns as their own layer; the answer says it is suggestions');
  check(places.includes('const pin = typed ? await pastedPin(typed) : null;') && places.includes('if (typed.length < SEARCH_MIN_CHARS) return { result: { text: typed, results: [] }, summary: "search: too short" };'), 'a typed search is unchanged (a pin, the short rule, the three layers)');
  const suggest = read('../../supabase/functions/_shared/fleet/suggest.ts');
  check(suggest.includes('export function nearestFirst') && suggest.includes('export function ourPlacesFirst') && read('../../supabase/functions/_shared/fleet/suggest_test.ts').includes('Deno.test('), 'the ranking is pure, with its Deno test');
}

console.log('\nStrings in both languages');
{
  type Tree = { [k: string]: string | Tree };
  const en = JSON.parse(read('src/i18n/en.json')) as { office: { trip: Record<string, string>; common: Record<string, string> } };
  const si = JSON.parse(read('src/i18n/si.json')) as typeof en;
  const keys = ['searching', 'noPlaces', 'suggestions', 'suggestionsFailed', 'townBadge', 'searchGoogle', 'googleCredit', 'thisPin', 'myLocation', 'noLocation', 'noLocationPermission'];
  const missing = keys.filter((k) => !en.office.trip[k] || !si.office.trip[k]);
  check(missing.length === 0 && en.office.common.tryAgain && si.office.common.tryAgain, 'every key the box uses exists in en and si', missing);
  check(!/[෦-෯]/.test(keys.map((k) => si.office.trip[k]).join(' ')), 'Latin digits only in Sinhala');
  void (0 as unknown as Tree);
}

console.log(failures === 0 ? '\nAll search checks passed.' : `\n${failures} search check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
