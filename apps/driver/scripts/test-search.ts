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
import { BADGE_I18N_KEYS, badgeKey, officesFirst, splitSuggestions, WHERE_MAX_RECENT, WHERE_MAX_ROWS, whereRows } from '../src/lib/placeSuggestLogic';

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
  check(draftsFromStops([{ type: 'drop', place: 'Kandy', place_id: 'p2' }])[0].picked === true && draftsFromStops([{ type: 'drop', place: 'Kandy town' }])[0].picked === true && !draftsFromStops([{ type: 'drop' }])[0].picked, 'a stop loaded from the server (a request, a task) is a picked one; an empty one is not');
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
  check(box.includes("api.call<SearchAnswer>('search_places', suggestArgs(near, forRequest))") && box.includes('Location.getLastKnownPositionAsync()') && !box.includes('requestForegroundPermissionsAsync().granted;\n      const pos = await Location.getLastKnownPositionAsync'), 'an empty box asks for suggestions, with the last known position only when already allowed (no prompt)');
  check(box.includes("onRetry={() => setSuggestTry((n) => n + 1)}") && box.includes('office.trip.suggestionsFailed'), 'failed suggestions say so with Try again (it asks again)');
  check(box.includes("canGoogle && !empty && !google") && box.includes("typed.current = true; setGoogle(true);"), 'the Google opt-in chip only under the google package, and it triggers a search');
  check(box.includes('const key = badgeKey(r.badge, r.layer);') && !box.includes('text={r.badge}') && !box.includes(': r.badge'), 'every server badge in the phone\'s language (never the English word raw)');
  check(box.includes('<WhereSuggestions') && box.includes('groupedWhere(results, (r) => r.name)') && !box.includes('suggest.answer.results.map(row)'), 'an empty box: the Where suggestions (ours, then 3 recent, no towns, More places; Round 4–7: the server\'s groups under their headers, groupedWhere)');
  const driverBox = read('src/components/PlaceSearch.tsx');
  check(driverBox.includes('<WhereSuggestions') && driverBox.includes('whereRows(officesFirst(known), [], (p) => p.name)') && driverBox.includes('badge={badgeText(r.badge, r.layer)}') && !driverBox.includes('accessibilityLanguage="en"'), 'the driver\'s box: our places (offices first) in an empty box, the badges translated');
  check(!/'(admin|fleet_admin|office|viewer|staff)'/.test(box), 'no role names');
}

console.log('\nWhere suggestions (Round 1 item 6)');
{
  const P = (name: string, kind = 'other') => ({ layer: 'place', name, kind });
  const R = (name: string) => ({ layer: 'recent', name });
  const T = (name: string) => ({ layer: 'town', name });
  const answer = [R('Kandy depot'), R('Galle site'), R('Head office'), R('Jaffna store'), R('Matara'), P('Head office', 'office'), P('Store A'), P('Store B'), P('Store C'), T('Kurunegala'), T('Kegalle')];
  const { ours, recent } = splitSuggestions(answer);
  const w = whereRows(ours, recent, (r) => r.name);
  check(w.top.length === WHERE_MAX_ROWS && WHERE_MAX_ROWS === 5, 'at most 5 rows', w.top.map((r) => r.item.name));
  check(same(w.top.map((r) => r.item.name), ['Head office', 'Store A', 'Kandy depot', 'Galle site', 'Jaffna store']), 'ours first, then the 3 most recent (a recent place that is one of ours shows once)', w.top.map((r) => r.item.name));
  check(w.top.filter((r) => r.icon === 'clock').length === WHERE_MAX_RECENT && w.top.every((r) => r.icon === (r.item.layer === 'place' ? 'building' : 'clock')), 'a building for ours, a clock for a recent one');
  check(![...w.top, ...w.more].some((r) => r.item.layer === 'town'), 'no towns, not even under More places');
  check(same(w.more.map((r) => r.item.name), ['Store B', 'Store C', 'Matara']), 'More places: the rest of ours, then the rest of the recent');
  const few = whereRows([P('Head office', 'office')], [R('Kandy')], (r) => r.name);
  check(few.top.length === 2 && few.more.length === 0, 'fewer: fewer rows, no More places');
  const none = whereRows([], [], (r: { name: string }) => r.name);
  check(none.top.length === 0 && none.more.length === 0, 'nothing: nothing');
  check(same(officesFirst([{ kind: 'store', n: 1 }, { kind: 'office', n: 2 }, { kind: null, n: 3 }]).map((p) => p.n), [2, 1, 3]), 'the driver\'s own list: offices first, the rest in order');
  check(badgeKey('Office') === 'where.badge.office' && badgeKey('Site · Dialog') === 'where.badge.siteDialog' && badgeKey('Used before') === 'where.badge.usedBefore' && badgeKey('Town', 'town') === 'where.badge.town', 'the server\'s badge words map to keys');
  check(badgeKey('Something new', 'map') === 'where.badge.map' && badgeKey('Something new', 'typed') === null && badgeKey(null, 'known') === 'where.badge.saved', 'an unknown word falls back to its layer (never shown raw)');
  const enAll = JSON.parse(read('src/i18n/en.json')) as Record<string, unknown>;
  const siAll = JSON.parse(read('src/i18n/si.json')) as Record<string, unknown>;
  const look = (tree: Record<string, unknown>, k: string) => k.split('.').reduce<unknown>((n, part) => (n as Record<string, unknown> | undefined)?.[part], tree);
  const keys = [...BADGE_I18N_KEYS, 'where.morePlaces', 'where.ours', 'where.recent'];
  const gone = keys.filter((k) => typeof look(enAll, k) !== 'string' || typeof look(siAll, k) !== 'string');
  check(gone.length === 0, 'every Where key in en and si', gone);
}

console.log('\nThe server\'s suggestions');
{
  const places = read('../../supabase/functions/_shared/fleet/tools/places.ts');
  check(places.includes('text: z.string().trim().max(500).optional()') && places.includes('suggest: z.boolean().optional()') && places.includes('near: z.object({ lat:'), 'search_places takes an optional text, suggest and near (additive: the contract keeps its shape)');
  const emptyBox = places.slice(places.indexOf('if (suggest && typed.length < SEARCH_MIN_CHARS) {'), places.indexOf('const pin = typed ? await pastedPin(typed) : null;'));
  // Round 4–7 (item 10, Uber / Google Maps): Saved (the company's) and Recent (the person's OWN, my_recent_places), about 5
  // rows; "<Name>'s recent" for someone else's trip; no towns and never the company's whole history (recent_places).
  check(places.includes('if (suggest && typed.length < SEARCH_MIN_CHARS) {') && places.includes('myRecent(actor.employeeId, "", other ? 2 : 3)') && places.includes('.eq("operator", "other").not("lat", "is", null)') && !emptyBox.includes('db.from("towns")') && !places.includes('db.rpc("recent_places"'), 'an empty box: Saved (our own pinned places) and the person\'s own Recent; no towns, never the company\'s history');
  check(places.includes('const point = nearPoint ?? base?.point ?? COLOMBO;'), 'nearest to the phone, else the base place, else Colombo');
  check(places.includes('group: "saved"') && places.includes('group: "recent"') && places.includes('group: "for"') && places.includes('suggested: true'), 'each suggestion with its group (Saved, Recent, <Name>\'s recent); the answer says it is suggestions');
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
