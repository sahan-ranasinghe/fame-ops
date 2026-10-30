// Round 4–7, items 9 and 10 (docs/phase8-plan.md §33.8, §33.9) in Office mode and /m/, without a phone:
//   - Settings → Data retention: the rules (office/retentionLogic.ts) against the server's (retention.ts, settings.ts) and the
//     site's twin (apps/office/src/screens/settings/retentionLogic.ts); the screen wired as the plan says (read as text: the
//     preview first, run_retention {confirm: true} only on the second press, the whole setting saved with one change);
//     More → Settings lists it with users only; its web route exists.
//   - Per person: the empty place box's groups (lib/placeSuggestLogic.ts groupedWhere, the same rows as the site's), the
//     header words, for_request only for someone else's request; the trip draft's key per person, its 30 days, the old
//     phone-wide draft (office/trip/draftKeys.ts) and the store wired to them; Ask drivers' list "Mine · Everyone's".
//   - The key actions of every screen changed are still there; every new key in English and Sinhala (en.json / si.json
//     deep-merged with src/i18n/parts/*.json while a sidecar waits for the merge), the same {placeholders}, Latin digits.
//   npx tsx scripts/test-perperson.ts          (from apps/driver)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GROUP_I18N_KEYS, forName, groupedWhere, groupHeader, startsGroup, SUGGEST_MAX_ROWS, type WhereRow, whereRows } from '../src/lib/placeSuggestLogic';
import { asksArgs } from '../src/office/askLogic';
import { MORE_SECTION, moreFor } from '../src/office/nav';
import { PRESETS } from '../src/office/permissions';
import {
  daysInput, MAX_DAYS, MINIMUMS_FALLBACK, minimumOf, NEVER_KEYS, neverWords, nightlyTime, periodsOf, previewLines, RETENTION_DEFAULTS, RETENTION_I18N_KEYS,
  RETENTION_ROWS, RULE_KEYS, ruleKey, whatKey, withPeriod,
} from '../src/office/retentionLogic';
import {
  DRAFT_KEEP_DAYS, DRAFT_PREFIX, draftExpired, draftKeyFor, keepDaysFrom, LAST_EMAIL_KEY, LEGACY_DRAFT_KEY, legacyDropAtSignIn, legacyGoesTo, nextIndex, personOf,
} from '../src/office/trip/draftKeys';
import { suggestArgs } from '../src/office/trip/locationLogic';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const ROOT = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const readRoot = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- The strings: en.json / si.json, deep-merged with the sidecars while they wait for the lead's merge ----
type Tree = { [k: string]: string | Tree | string[] };
function merge(into: Tree, from: Tree): Tree {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) merge(cur, v);
    else into[k] = v;
  }
  return into;
}
const dicts: Record<'en' | 'si', Tree> = { en: JSON.parse(read('i18n/en.json')), si: JSON.parse(read('i18n/si.json')) };
const partsDir = join(SRC, 'i18n', 'parts');
if (existsSync(partsDir)) {
  for (const f of readdirSync(partsDir).filter((x) => x.endsWith('.json')).sort()) {
    const part = JSON.parse(readFileSync(join(partsDir, f), 'utf8')) as { en?: Tree; si?: Tree };
    if (part.en) merge(dicts.en, part.en);
    if (part.si) merge(dicts.si, part.si);
  }
}
const lookup = (lang: 'en' | 'si', key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dicts[lang]);
const tr = (lang: 'en' | 'si') => (key: string, vars: Record<string, string | number> = {}) => {
  const v = lookup(lang, key);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};
const en = tr('en');
const si = tr('si');

const load = createRequire(import.meta.url);
const site = {
  retention: load(join(ROOT, 'apps', 'office', 'src', 'screens', 'settings', 'retentionLogic.ts')) as {
    RETENTION_ROWS: readonly { key: string }[];
    RETENTION_DEFAULTS: Record<string, number>;
    MINIMUMS_FALLBACK: Record<string, number>;
    MAX_DAYS: number;
    daysInput: (text: string, min: number) => { days: number } | { error: string };
  },
  places: load(join(ROOT, 'apps', 'office', 'src', 'ui', 'placeSuggestLogic.ts')) as {
    groupedWhere: <T extends { layer: string; group?: string; group_label?: string }>(r: readonly T[], n: (i: T) => string) => { top: { item: T; group?: string }[]; more: { item: T }[] };
    SUGGEST_MAX_ROWS: number;
  },
};
const siteAskList = readRoot('apps/office/src/screens/asks/AskList.tsx');

console.log('\nData retention: the rules match the server and the site');
{
  const settingsTs = readRoot('supabase/functions/_shared/fleet/settings.ts');
  const defaultsBlock = settingsTs.slice(settingsTs.indexOf('export const RETENTION_DEFAULTS'), settingsTs.indexOf('};', settingsTs.indexOf('export const RETENTION_DEFAULTS')));
  const serverDefaults = Object.fromEntries(Array.from(defaultsBlock.matchAll(/(\w+_days): (\d+)/g)).map((m) => [m[1], Number(m[2])]));
  check(same(serverDefaults, RETENTION_DEFAULTS), 'the periods and their defaults are the server\'s (RETENTION_DEFAULTS)', serverDefaults);
  const minLine = settingsTs.match(/RETENTION_MINIMUMS[^=]*= (\{[^}]*\})/)?.[1] ?? '';
  const serverMins = Object.fromEntries(Array.from(minLine.matchAll(/(\w+_days): (\d+)/g)).map((m) => [m[1], Number(m[2])]));
  check(same(serverMins, MINIMUMS_FALLBACK), 'the minimums are the server\'s: location 30 days, the activity log\'s changes 183', serverMins);
  check(settingsTs.includes('min, 3650, true') && MAX_DAYS === 3650, 'at most 3,650 days, as the server');
  check(same(RETENTION_ROWS.map((r) => r.key).sort(), Object.keys(RETENTION_DEFAULTS).sort()), 'every period has its row, once');
  check(same(site.retention.RETENTION_ROWS.map((r) => r.key), RETENTION_ROWS.map((r) => r.key)) && same(site.retention.RETENTION_DEFAULTS, RETENTION_DEFAULTS) && same(site.retention.MINIMUMS_FALLBACK, MINIMUMS_FALLBACK) && site.retention.MAX_DAYS === MAX_DAYS, 'the site\'s page has the same rows, defaults and minimums, in the same order');

  const retentionTs = readRoot('supabase/functions/_shared/fleet/retention.ts');
  const rulesBlock = retentionTs.slice(retentionTs.indexOf('export const RULES'), retentionTs.indexOf('];', retentionTs.indexOf('export const RULES')));
  const serverRules = Array.from(rulesBlock.matchAll(/key: "(\w+)"/g)).map((m) => m[1]);
  check(serverRules.length >= 14 && same(serverRules, [...RULE_KEYS]), 'every rule of the job has its words in the app (the preview and the result lines)', serverRules);
  check(ruleKey('inbox_read') === 'office.retention.rule.inbox_read' && ruleKey('a_new_rule') === null, 'a rule this app does not know keeps the server\'s words');
  const neverBlock = retentionTs.slice(retentionTs.indexOf('export const NEVER'), retentionTs.indexOf('] as const', retentionTs.indexOf('export const NEVER')));
  const serverNever = Array.from(neverBlock.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  check(serverNever.length === 10 && same(serverNever.sort(), Object.keys(NEVER_KEYS).sort()), '"Never removed" has words for each of the server\'s ten', serverNever);
  check(same(neverWords(['requests', 'something new'], (k) => en(k)), ['requests', 'something new']) && neverWords(['requests'], (k) => si(k))[0] === 'ඉල්ලීම්', 'never removed in the person\'s language; an unknown item as the server says it');

  check(minimumOf('location_days', null) === 30 && minimumOf('audit_changes_days', { audit_changes_days: 183 }) === 183 && minimumOf('inbox_read_days', MINIMUMS_FALLBACK) === 1, 'each kind\'s minimum (the preview\'s, else the known floors, else 1 day)');
  check(same(daysInput('20', 30), { error: { key: 'office.retention.err.min', vars: { n: 30 } } }) && same(daysInput('', 1), { error: { key: 'office.retention.err.empty' } }) && same(daysInput('4000', 1), { error: { key: 'office.retention.err.max', vars: { n: 3650 } } }) && same(daysInput(' 45 ', 30), { days: 45 }), 'a typed period: under the minimum, empty and over 10 years are refused before Save; a valid one is the days');
  for (const [text, min] of [['20', 30], ['', 1], ['4000', 1], ['45', 30], ['abc', 1], ['183', 183]] as const) {
    const a = daysInput(text, min);
    const b = site.retention.daysInput(text, min);
    check(('days' in a) === ('days' in b) && ('days' in a ? a.days === (b as { days: number }).days : true), `the site and the app agree on "${text}" (minimum ${min})`);
  }
  const saved = periodsOf({ inbox_read_days: 60 });
  check(same(withPeriod(saved, 'location_days', 90), { ...RETENTION_DEFAULTS, inbox_read_days: 60, location_days: 90 }), 'one change keeps every other period as saved (update_settings stores what it is sent over its defaults)');
  check(nightlyTime('02:45 Colombo') === '02:45' && nightlyTime(undefined) === '02:45', 'the nightly time from the preview ("02:45 Colombo")');
  const p = { rules: [{ key: 'inbox_read', what: 'read notifications', days: 30, before: '2026-09-22', count: 312 }, { key: 'heartbeats', what: 'phone heartbeats', days: 90, before: '2026-07-24', count: 0 }], would_remove: 312 };
  check(same(previewLines(p).lines.map((l) => l.key), ['inbox_read']) && previewLines(p).total === 312, 'the preview lists only what would go, with the total');
}

console.log('\nData retention: More → Settings, the screen, the web route');
{
  const admin = moreFor(['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users']);
  check(admin.includes('retention') && MORE_SECTION.retention === 'settings', 'with users: More → Settings → Data retention');
  for (const [name, preset] of Object.entries(PRESETS)) {
    const has = preset.permissions.includes('users');
    check(moreFor(preset.permissions).includes('retention') === has, `${name}: Data retention ${has ? 'listed' : 'not listed'} (users)`);
  }
  const more = read('app/office/(tabs)/more.tsx');
  check(more.includes("retention: { icon: ShieldCheck, label: 'office.more.retention', path: '/office/people/retention' }") && more.includes("key === 'retention' ? t('office.more.retentionLine')"), 'More: the row, its line (found by More\'s search) and its route');
  check(existsSync(join(SRC, 'app', 'office', 'people', 'retention.tsx')) && existsSync(join(SRC, 'web-app', 'office', 'people', 'retention.tsx')), 'the screen and its /m/ route exist');
  const screen = read('app/office/people/retention.tsx');
  check(screen.includes("useTool<SettingsResult>('get_settings', {}") && screen.includes("useTool<RetentionPreview>('retention_preview', {}"), 'opening: get_settings (the periods, fuel videos) and the preview (minimums, never removed, the nightly time)');
  check(screen.includes("api.call('update_settings', { key: 'retention', value: { [editing.key]: v.days } })") && screen.includes('withPeriod(periods, editing.key, v.days)'), 'a period is saved alone (the server keeps the others as stored); the screen shows the whole setting with the one change');
  check(screen.includes("api.call('update_settings', { key: 'fuel_video_keep_months', value: editing.months })"), 'fuel videos\' months on the same screen, their own setting');
  const runAt = screen.indexOf("api.call<RetentionRun>('run_retention', { confirm: true })");
  check(runAt > 0 && (screen.match(/api\.call<RetentionRun>\('run_retention'/g) ?? []).length === 1 && screen.lastIndexOf('async function', runAt) === screen.indexOf('async function remove('), 'run_retention {confirm: true} only from Remove N now (one call, in remove())');
  check(screen.includes("api.call<RetentionPreview>('retention_preview', {})") && screen.includes("label={t('office.retention.runCheck')}") && screen.includes("t('office.retention.remove', { n: n(previewLines(run.preview).total) })"), 'Run now asks the preview first; the second button says how many go');
  check(screen.includes('// A write is never sent again by itself') && !/run_retention[\s\S]{0,200}setTimeout/.test(screen), 'a failed run is never sent again by itself');
  check(screen.includes("const canEdit = me.tools.includes('update_settings');") && screen.includes("const canRun = me.tools.includes('retention_preview') && me.tools.includes('run_retention');") && screen.includes('disabled={!canEdit}') && screen.includes('{canRun && ('), 'without update_settings the periods are read only; without the run tools no Run now');
  check(screen.includes("disabled={unchanged || (!!editingProblem && 'error' in editingProblem)}") && screen.includes('problemText(editingProblem.error)') && screen.includes("t('office.retention.atLeast'"), 'Save stays disabled with the reason under it until the days are valid; the minimum is shown');
  check(screen.includes('busy={saving}') && screen.includes('if (!editing || saving) return;') && screen.includes("busy={run.step === 'removing'}"), 'the button\'s own spinner, no double save or double run');
  check(screen.includes('showSnackbar({') && screen.includes('<SkeletonRows') && screen.includes('<ErrorNotice error={failed} onRetry='), 'a snackbar after a save, skeletons while loading, the error with Try again');
  check(!/[a-z]+_days['"]?\s*}?\)?\s*<\/Txt>/.test(screen) && !screen.includes('{row.key}</'), 'no setting key on the screen');
}

console.log('\nPer person: the empty place box in groups');
{
  const G = (name: string, layer: string, group: string, group_label: string) => ({ layer, name, group, group_label });
  const answer = [
    G('Head office', 'place', 'saved', 'Saved'), G('Store A', 'place', 'saved', 'Saved'),
    G('Kandy depot', 'recent', 'recent', 'Recent'), G('Galle site', 'recent', 'recent', 'Recent'),
    G('Matara', 'recent', 'for', "Anoja's recent"), G('Head office', 'recent', 'for', "Anoja's recent"),
    { layer: 'town', name: 'Kegalle' },
  ];
  const w = groupedWhere(answer, (r) => r.name);
  const names = (rows: { item: { name: string } }[]) => rows.map((r) => r.item.name);
  check(same(names(w.top), ['Head office', 'Store A', 'Kandy depot', 'Galle site', 'Matara']) && w.more.length === 0, 'Saved, Recent, then the trip\'s person\'s recent; a name shown once; no towns');
  check(same(w.top.map((r) => r.icon), ['building', 'building', 'clock', 'clock', 'clock']), 'a building for a saved place, a clock for a recent one');
  check(same(w.top.map((_, i) => startsGroup(w.top, i)), [true, false, true, false, true]), 'a header above the first row of each group');
  const s = site.places.groupedWhere(answer, (r) => r.name);
  check(same(names(s.top), names(w.top)) && same(s.top.map((r) => r.group), w.top.map((r) => r.group)) && site.places.SUGGEST_MAX_ROWS === SUGGEST_MAX_ROWS, 'the site\'s box shows the same rows in the same groups');
  const old = groupedWhere([{ layer: 'recent', name: 'Kandy' }, { layer: 'place', name: 'Head office' }], (r) => r.name);
  const plain = whereRows([{ layer: 'place', name: 'Head office' }], [{ layer: 'recent', name: 'Kandy' }], (r) => r.name);
  check(same(old, plain) && !old.top.some((r) => r.group), 'an answer without groups: the Round 1 rows (ours, then 3 recent), no headers');
  check(forName("Anoja's recent") === 'Anoja' && forName('Anoja’s recent') === 'Anoja' && forName('Recent') === null, 'the person\'s name read from "Anoja\'s recent"');
  const head = (r: Pick<WhereRow<unknown>, 'group' | 'label'>) => groupHeader(r);
  check(same(head({ group: 'saved' }), { key: 'where.group.saved' }) && same(head({ group: 'for', label: "Anoja's recent" }), { key: 'where.group.for', vars: { name: 'Anoja' } }) && same(head({ group: 'for', label: 'Their recent' }), { key: 'where.group.forSomeone' }) && head({}) === null, 'the headers in the person\'s language; none for a row with no group (the driver\'s box)');
  check(en('where.group.for', { name: 'Anoja' }) === "Anoja's recent" && si('where.group.for', { name: 'Anoja' }) === 'Anojaගේ මෑත', 'the header words in both languages');
  check(same(suggestArgs(null), { suggest: true }) && same(suggestArgs(null, 'r-1'), { suggest: true, for_request: 'r-1' }) && same(suggestArgs({ lat: 6.9, lng: 79.8 }, 'r-1'), { suggest: true, near: { lat: 6.9, lng: 79.8 }, for_request: 'r-1' }), 'search_places {suggest}, with for_request only for someone else\'s request');

  const box = read('components/office/PlaceSearch.tsx');
  check(box.includes('groupedWhere(results, (r) => r.name)') && box.includes("suggestArgs(near, forRequest)") && box.includes('forRequest?: string;'), 'Office mode\'s box: the groups, and the request passed on');
  // The box's key actions are all still there (the coordinator's rule: nothing the box does today goes).
  check(box.includes('<WhereSuggestions') && box.includes("searchState({ searchable: !empty && typed.current, busy, answer, problem })") && box.includes('looksPasted(text) ? 0 : DEBOUNCE_MS') && box.includes("api.call<GooglePlaceAnswer>('google_place'") && box.includes('typed.current = true; setGoogle(true);') && box.includes('PinAdjust') && box.includes('myLocation') && box.includes("t('office.trip.suggestionsFailed')"), 'kept: the results, a pasted pin (checked on the map), Google\'s results with its pick, My location, the suggestions\' error with Try again');
  const ws = read('components/patterns/WhereSuggestions.tsx');
  check(ws.includes('startsGroup(rows, i) ? groupHeader(r) : null') && ws.includes('accessibilityRole="header"') && ws.includes('testID="where-group"'), 'WhereSuggestions: a header above each group (an accessibility header)');
  check(ws.includes('onPress={() => onPick(r.item)}') && ws.includes('testID="where-more"') && ws.includes("t('where.morePlaces')") && ws.includes('testID={`where-icon-${r.icon}`}'), 'kept: a row picks its place, More places, the icons');
  const driverBox = read('components/PlaceSearch.tsx');
  check(driverBox.includes('whereRows(officesFirst(known), [], (p) => p.name)') && !driverBox.includes('groupedWhere'), 'the driver\'s box is unchanged (whereRows, no groups, so no headers)');
  const where = read('app/office/trip/where.tsx');
  check(where.includes("...(card.requested_by !== me.name ? { forRequest: id } : {})") && (where.match(/forRequest=\{d\.forRequest\}/g) ?? []).length === 2, 'the trip editor: someone else\'s request carries its id to both kinds of place box (the start and the stops)');
  check(where.includes('<PlaceSearch value={f.start}') && where.includes('myLocation') && where.includes("t('office.trip.addStop')") && where.includes('addStop(f.stops, f.returnToBase)') && where.includes('moveStopTo(f.stops, optIndex, to, f.returnToBase)') && where.includes('drop(i, dy)') && where.includes("t('office.trip.nextWhen')"), 'kept: From with My location, the stops, + Add stop (before To), move up / down (⋯ Options) and the drag, Next: When');
}

console.log('\nPer person: the trip draft');
{
  const store = read('office/store.ts');
  check(store.includes(`email: '${LAST_EMAIL_KEY}'`) && LEGACY_DRAFT_KEY === 'office.trip.draft', 'the last sign-in\'s e-mail and the old phone-wide key are the ones the app used');
  check(personOf('  Anoja@Fame.LK ') === 'anoja@fame.lk' && personOf('') === null && personOf(undefined) === null, 'a draft\'s person: the e-mail, trimmed, lower case; nobody = nothing kept');
  check(draftKeyFor('anoja@fame.lk') === `${DRAFT_PREFIX}anoja@fame.lk` && draftKeyFor('a@b') !== draftKeyFor('c@d'), 'one key per person');
  const now = Date.UTC(2026, 9, 22, 6);
  const day = 86_400_000;
  check(!draftExpired(now - 30 * day, 30, now) && draftExpired(now - 30 * day - 1, 30, now) && draftExpired(Number.NaN, 30, now), 'kept 30 days, then dropped');
  check(keepDaysFrom(7) === 7 && keepDaysFrom(0) === DRAFT_KEEP_DAYS && keepDaysFrom('x') === 30 && keepDaysFrom(undefined) === 30, 'the period from the setting, else 30 days');
  const idx = nextIndex({ 'a@b': now - 40 * day, 'c@d': now - 2 * day, 'me@x': now - 50 * day }, 'me@x', now, 30, now);
  check(same(idx.index, { 'c@d': now - 2 * day, 'me@x': now }) && same(idx.drop, ['a@b']), 'a write: the person\'s own entry, anyone\'s expired draft removed, another\'s fresh one untouched');
  check(same(nextIndex({ 'me@x': now }, 'me@x', null, 30, now), { index: {}, drop: [] }), 'a cleared draft leaves the index');
  check(legacyGoesTo('me@x', 'ME@x', false) && !legacyGoesTo('me@x', 'other@x', false) && !legacyGoesTo('me@x', 'me@x', true), 'the old phone-wide draft goes only to the person who signed in last, when they have none of their own');
  const draft = read('office/trip/draft.ts');
  check(draft.includes('getOfficeMe()') && draft.includes('setJson(draftKeyFor(person), next)') && !draft.includes('setJson(LEGACY_DRAFT_KEY') && !draft.includes('setJson(DRAFT_KEY'), 'the store writes only the person\'s own key (never the phone-wide one)');
  check(draft.includes('if (!cached || cached.person !== person)') && draft.includes('draftExpired(d.at, keepDays())'), 'another person\'s draft is never shown (the draft on screen is the person\'s); an expired one is dropped when read');
  const auth = read('office/auth.ts');
  // Review of Round 4–7: the sign-in kept the new e-mail before the draft was first read, so the old draft moved to anyone.
  check(legacyDropAtSignIn('kamal@x', 'anoja@x') && legacyDropAtSignIn('kamal@x', null) && legacyDropAtSignIn('', 'kamal@x') && !legacyDropAtSignIn(' Kamal@X ', 'kamal@x'),
    'at a sign-in the old phone-wide draft is dropped unless the person signing in signed in last');
  const settle = auth.indexOf('settleLegacyDraft(email)');
  check(settle > 0 && settle < auth.indexOf('setJson(OFFICE_KEYS.email') && draft.includes('legacyDropAtSignIn(signingIn, getJson<string>(LAST_EMAIL_KEY))'),
    'the sign-in settles the old draft with the e-mail of the last sign-in, before keeping the new one');
  check(!auth.includes('setDraft(null)') && (auth.match(/forgetDraftCache\(\)/g) ?? []).length === 2, 'sign-in and sign-out leave every person\'s draft on the phone, and show none');
  check(read('app/office/trip/where.tsx').includes('setDraftKeepDays(settings.data?.settings.retention?.drafts_days)'), 'the trip editor remembers the setting\'s period for the store');
}

console.log('\nPer person: Ask drivers\' questions');
{
  check(same(asksArgs('mine', true), {}) && same(asksArgs('all', true), { all: true }) && same(asksArgs('all', false), {}), 'Mine by default; everyone\'s only for an approver who chose it');
  check(siteAskList.includes('(approver && whose === "all" ? { all: true } : {})') && read('office/askLogic.ts').includes("(approver && whose === 'all' ? { all: true } : {})"), 'the same rule as the site');
  const list = read('app/office/asks/index.tsx');
  check(list.includes("const approver = me.permissions.includes('approve');") && list.includes('{approver && (') && list.includes('<Segmented<Whose>'), 'the switch only for approvers');
  check(list.includes("useTool<AskAnswers>('ask_answers', { ...args, limit: 20 }") && list.includes("api.call<AskAnswers>('ask_answers', { ...args, limit: 20, cursor: q.data.next })"), 'the list and Load more ask the same questions (all: true on both for Everyone\'s)');
  check(list.includes("router.push({ pathname: '/office/asks/[id]', params: { id: a.id } })") && list.includes('<LoadMore') && list.includes('onRefresh={() => void q.reload()}') && list.includes("t('office.asks.empty')"), 'kept: a row opens its question, Load more, pull to refresh, the empty state');
}

console.log('\nThe strings, in English and Sinhala');
{
  const files = ['app/office/people/retention.tsx', 'app/office/asks/index.tsx', 'app/office/(tabs)/more.tsx', 'components/patterns/WhereSuggestions.tsx'].map(read).join('\n');
  const used = Array.from(new Set(Array.from(files.matchAll(/t\('((?:office|where)\.[A-Za-z0-9_.]+)'/g)).map((m) => m[1])));
  const keys = Array.from(new Set([...used, ...RETENTION_I18N_KEYS, ...GROUP_I18N_KEYS, ...RETENTION_ROWS.map((r) => whatKey(r.key))]));
  const missing = keys.filter((k) => typeof lookup('en', k) !== 'string' || typeof lookup('si', k) !== 'string');
  check(keys.length > 60 && missing.length === 0, `every key the screens use is in en and si (${keys.length})`, missing);
  const holes = (s: string) => Array.from(s.matchAll(/\{(\w+)\}/g)).map((m) => m[1]).sort();
  const odd = keys.filter((k) => typeof lookup('en', k) === 'string' && typeof lookup('si', k) === 'string' && !same(holes(lookup('en', k) as string), holes(lookup('si', k) as string)));
  check(odd.length === 0, 'the same {placeholders} in both languages', odd);
  const sinhalaDigits = keys.filter((k) => /[෦-෯]/.test(String(lookup('si', k) ?? '')));
  check(sinhalaDigits.length === 0, 'Latin digits in Sinhala too', sinhalaDigits);
  const sameAsEnglish = keys.filter((k) => lookup('si', k) === lookup('en', k) && /[A-Za-z]/.test(String(lookup('en', k)).replace(/\{\w+\}/g, '')));
  check(sameAsEnglish.length === 0, 'every Sinhala text is Sinhala (none left in English)', sameAsEnglish);
  check(en('office.retention.days', { n: '30' }) === '30 days' && si('office.retention.days', { n: '30' }) === 'දින 30' && en('office.retention.remove', { n: '4,522' }) === 'Remove 4,522 now', 'the numbers stay Latin in the words');
}

console.log(failures === 0 ? '\nAll per-person checks passed.' : `\n${failures} per-person check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
