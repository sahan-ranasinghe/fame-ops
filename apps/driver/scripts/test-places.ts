// Stage 1 (O3 row 8): Places under More and the pin check (office/placesLogic.ts, the screens, PinAdjust).
//
//   npm run test:places          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appendPlaces, placeFields, placeLine, placesArgs, placesChoice, placesFilterDefs, type PlacesList, updatePlaceInput } from '../src/office/placesLogic';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

console.log('\nThe list');
{
  const defs = placesFilterDefs((k) => k);
  check(defs.map((d) => `${d.key}:${d.default}`).join() === 'who:ours,pin:any', 'one Filter: whose places (ours first), the pin');
  check(same(placesChoice({ who: 'mobitel', pin: 'without' }), { who: 'mobitel', pin: 'without' }) && same(placesChoice({ who: 'x' }), { who: 'ours', pin: 'any' }), 'a broken value reads the default');
  check(same(placesArgs('ours', 'any', ''), { limit: 50 }) && same(placesArgs('dialog', 'with', ' DL123 '), { limit: 50, operator: 'dialog', pinned: true, search: 'DL123' })
    && same(placesArgs('other_sites', 'without', '', 'c'), { limit: 50, operator: 'other', pinned: false, cursor: 'c' }) && same(placesArgs('removed', 'any', ''), { limit: 50, removed: true }),
    "list_places' own operator / pinned / removed / search");
  const a = { count: 1, places: [{ id: '1', name: 'A' }], next: 'n' } as unknown as PlacesList;
  check(appendPlaces(a, { count: 2, places: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] } as unknown as PlacesList).places.length === 2, 'Load more: never a place twice');
  check(placeLine({ site_id: 'DL1', address: 'Main St', district: 'Kandy' }) === 'DL1 · Main St · Kandy', "a row's line");
}

console.log('\nThe page');
{
  const was = placeFields({ name: 'Head office', address: 'Colombo 05', district: undefined, depot: undefined });
  check(updatePlaceInput('p1', was, { ...was }) === null && updatePlaceInput('p1', was, { ...was, name: ' ' }) === 'name', 'nothing changed: nothing sent; a name is needed');
  check(same(updatePlaceInput('p1', was, { ...was, district: ' Colombo ' }), { id: 'p1', district: 'Colombo' }), 'update_place: only what changed');
  const page = src('app/office/places/[id].tsx');
  check(page.includes("api.call<RemoveAnswer>('remove_place', { id: p.id, ...(confirm ? { confirm: true } : {}) })") && page.includes('if (r.needs_confirm)') && page.includes('testID="place-remove-confirm"') && page.includes('testID="place-in-use"'),
    'Remove: the reasons first, the second press confirms');
  check(page.includes("api.call('restore_place', { id: p.id })") && page.includes("me.tools.includes('update_place') && !removed") && page.includes("me.tools.includes('remove_place')") && page.includes("me.tools.includes('restore_place') && removed"),
    'Edit, Remove and Restore each with its tool');
  const list = src('app/office/places/index.tsx');
  check(list.includes('<FilterBar') && list.includes('<LoadMore') && list.includes("pathname: '/office/places/[id]'"), 'the list: search, the Filter, Load more, a row to its place');
}

console.log('\nThe pin check');
{
  const pin = src('components/office/PinAdjust.tsx');
  check(pin.includes('PROVIDER_GOOGLE') && pin.includes('<Map ') && pin.includes('useRouteMapEngine(mapPackage)') && pin.includes('OSM_CREDIT') && pin.includes('testID="pin-centre"'), 'both engines, the free map with its credit, the pin fixed in the middle');
  check(pin.includes('onRegionChangeComplete') && pin.includes('onRegionDidChange') && pin.includes('onUse(roundPin('), "the map's centre is the point used");
  const box = src('components/office/PlaceSearch.tsx');
  check(box.includes('testID="place-search-pin"') && box.includes('setPinCheck({') && box.includes("void pick({ layer: 'map', badge: 'Pin', name, lat: p.lat, lng: p.lng, pinned: true })"), 'a pasted pin is checked on the map before it is used');
}

console.log('\nWords');
{
  const en = JSON.parse(src('i18n/en.json'));
  const si = JSON.parse(src('i18n/si.json'));
  for (const ns of ['places', 'pin'] as const) check(Object.keys(en.office[ns]).every((k) => typeof si.office[ns][k] === 'string'), `office.${ns} in both languages`);
  const used = src('app/office/places/index.tsx') + src('app/office/places/[id].tsx') + src('components/office/PinAdjust.tsx');
  const asked = [...used.matchAll(/office\.(places|pin)\.([a-zA-Z_]+)/g)].filter((m) => !m[2].endsWith('_')).map((m) => [m[1], m[2]] as const);
  check(asked.every(([ns, k]) => k in en.office[ns]), 'every key asked for exists', asked.filter(([ns, k]) => !(k in en.office[ns])));
  check(['ours', 'dialog', 'mobitel', 'other_sites', 'removed'].every((w) => `who_${w}` in si.office.places && `none_${w}` in si.office.places), 'every filter has its words and its empty state');
}

console.log(failures === 0 ? '\nAll places checks passed.' : `\n${failures} places check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
