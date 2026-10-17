// Tests of Phone setup's rules (src/lib/phoneSetup.ts): the gaps the phone notes, the note at the top of
// Me → Phone setup, the brand's steps and settings pages, and the texts in both languages (Phase 7 item 7: the
// steps left Today for the first-run Permissions flow and Me → Phone setup). Pure code, no stack needed:
//
//   npm run test:setup          (from apps/driver)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  brandName,
  gapMinutes,
  gapsToShow,
  keepGaps,
  noteBeat,
  openSettingsLabel,
  settingsIntents,
  type SetupBrand,
  setupBrand,
  stepsKey,
  stoppedNote,
} from '../src/lib/phoneSetup';

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

const T = Date.parse('2026-10-15T06:12:46+05:30');
const min = (n: number) => n * 60_000;

// 1. Gaps between heartbeats of one duty period.
check(noteBeat({ at: T, sessionId: 's1' }, { at: T + min(1), sessionId: 's1' }) === null, 'a heartbeat a minute later: no gap');
check(noteBeat({ at: T, sessionId: 's1' }, { at: T + min(3), sessionId: 's1' }) === null, 'exactly 3 minutes: no gap');
const gap = noteBeat({ at: T, sessionId: 's1' }, { at: T + min(7) + 19_000, sessionId: 's1' });
check(gap !== null && gap.from === T && gapMinutes(gap) === 7, 'the 06:12–06:20 freeze is a gap of 7 minutes', gap);
check(noteBeat({ at: T, sessionId: 's1' }, { at: T + min(30), sessionId: 's2' }) === null, 'a new duty period is no gap (off duty in between)');
check(noteBeat(null, { at: T, sessionId: 's1' }) === null && noteBeat({ at: T, sessionId: 's1' }, { at: T + min(9), sessionId: null }) === null, 'no previous heartbeat, or off duty now: no gap');

// 2. What is kept and what Me → Phone setup tells about.
const now = T + min(60);
const gaps = [
  { from: T - 8 * 86_400_000, to: T - 8 * 86_400_000 + min(5) },
  { from: T - 2 * 86_400_000, to: T - 2 * 86_400_000 + min(4) },
  { from: T, to: T + min(7) },
  { from: T + min(8), to: T + min(11) },
];
const kept = keepGaps(gaps, now);
check(kept.length === 3 && kept[0].from === gaps[1].from, 'older than 7 days goes; the rest is kept oldest first', kept);
check(keepGaps(Array.from({ length: 80 }, (_, i) => ({ from: T + i * min(10), to: T + i * min(10) + min(4) })), T + min(800)).length === 60, 'at most 60 gaps are kept');
const shown = gapsToShow(kept, null, now);
check(shown.length === 3 && shown[0].from === T + min(8), 'the gaps of the last 3 days, newest first', shown);
check(gapsToShow(kept, T + min(20), now).length === 0, 'after Done on Me → Phone setup nothing is told …');
check(gapsToShow([...kept, { from: T + min(30), to: T + min(35) }], T + min(20), now).length === 1, '… until the phone stops the app again');
check(gapsToShow(kept, null, T + 4 * 86_400_000).length === 0, 'gaps older than 3 days are no longer told');

// 2b. The note at the top of Me → Phone setup (it used to be the card on Today).
const many = stoppedNote(kept, null, now);
check(many?.key === 'phoneSetup.stoppedMany' && many.count === 3 && many.minutes === 4 + 7 + 3 && many.at === gaps[1].from,
  'stopped 3 times: how many, the minutes in all, since the oldest', many);
const once = stoppedNote([{ from: T, to: T + min(7) + 19_000 }], null, now);
check(once?.key === 'phoneSetup.stoppedOnce' && once.minutes === 7 && once.at === T, 'stopped once: how long and when', once);
check(stoppedNote(kept, T + min(20), now) === null, 'after Done: no note');
check(stoppedNote([], null, now) === null && stoppedNote(gaps.slice(0, 1), null, now) === null, 'no gaps, or only old ones: no note');

// 3. Brands, names and the settings pages.
check(setupBrand('OPPO', 'OPPO') === 'oppo' && setupBrand('realme', 'realme') === 'realme' && setupBrand('OnePlus', 'OnePlus') === 'oppo', 'OPPO, realme (its own steps) and OnePlus (ColorOS)');
check(setupBrand('Redmi', 'Xiaomi') === 'xiaomi' && setupBrand('POCO', 'Xiaomi') === 'xiaomi' && setupBrand('iQOO', 'vivo') === 'vivo' && setupBrand('samsung', 'samsung') === 'samsung', 'Redmi and POCO are Xiaomi, iQOO is vivo, Samsung');
check(setupBrand('HUAWEI', 'HUAWEI') === 'huawei' && setupBrand('HONOR', 'HONOR') === 'huawei', 'Huawei and HONOR keep their own steps (App launch)');
check(setupBrand('Nokia', 'HMD Global') === 'other' && setupBrand(null, null) === 'other', 'anything else gets the general steps');
check(brandName('OPPO', 'OPPO') === 'OPPO' && brandName('redmi', 'Xiaomi') === 'Redmi' && brandName('nokia', null) === 'Nokia' && brandName('', null) === null, 'the brand as the phone shows it');
const xiaomi = settingsIntents('xiaomi', 'com.fameglobal.driver', 'Fame Driver');
check(xiaomi[0]?.extra?.package_name === 'com.fameglobal.driver' && xiaomi[0]?.extra?.package_label === 'Fame Driver', 'Xiaomi\'s battery saver page is opened for this app');
check((['oppo', 'realme', 'xiaomi', 'vivo', 'samsung'] as const).every((b) => settingsIntents(b, 'x', 'y').length >= 2) && settingsIntents('other', 'x', 'y').length === 0,
  'every listed brand has at least two pages to try; any other phone goes to App info');
check(JSON.stringify(openSettingsLabel('oppo', 'OPPO')) === '{"key":"phoneSetup.open","brand":"OPPO"}' && JSON.stringify(openSettingsLabel('xiaomi', 'Redmi')) === '{"key":"phoneSetup.open","brand":"Redmi"}',
  'the button names the brand: "Open OPPO settings", "Open Redmi settings"');
check(openSettingsLabel('other', 'Nokia').key === 'phoneSetup.openApp' && openSettingsLabel('samsung', null).key === 'phoneSetup.openApp',
  'any other phone, or a phone that does not say: "Open app settings"');

// 4. The texts, in English and Sinhala: the steps for every brand and the words the Permissions flow and
//    Me → Phone setup use.
const here = dirname(fileURLToPath(import.meta.url));
const lang = (code: string) => JSON.parse(readFileSync(join(here, '..', 'src', 'i18n', `${code}.json`), 'utf8')) as Record<string, unknown>;
const lookup = (source: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), source);
const en = lang('en');
const si = lang('si');
const brands: SetupBrand[] = ['oppo', 'realme', 'xiaomi', 'vivo', 'samsung', 'huawei', 'other'];
const stepCounts = brands.map((b) => [lookup(en, stepsKey(b)), lookup(si, stepsKey(b))]);
check(stepCounts.every(([e, s]) => Array.isArray(e) && Array.isArray(s) && e.length >= 2 && e.length === s.length && [...e, ...s].every((x) => typeof x === 'string' && x.length > 0)),
  'every brand (and any other phone) has its steps in English and Sinhala, the same number in both', stepCounts.map(([e, s]) => [(e as unknown[] | undefined)?.length, (s as unknown[] | undefined)?.length]));
const words = ['title', 'meHint', 'yourBrand', 'yourPhone', 'stoppedOnce', 'stoppedMany', 'doOnce', 'open', 'openApp', 'done'].map((k) => `phoneSetup.${k}`)
  .concat(['permissions.background', 'permissions.backgroundWhy', 'common.close']);
const missing = words.filter((k) => typeof lookup(en, k) !== 'string' || typeof lookup(si, k) !== 'string');
check(missing.length === 0, 'every word the two places use is in en.json and si.json', missing);
const placeholders = (text: unknown) => (typeof text === 'string' ? (text.match(/\{\w+\}/g) ?? []).sort().join(',') : null);
const mismatched = ['phoneSetup.yourBrand', 'phoneSetup.stoppedOnce', 'phoneSetup.stoppedMany', 'phoneSetup.open'].filter((k) => placeholders(lookup(en, k)) !== placeholders(lookup(si, k)));
check(mismatched.length === 0, 'the Sinhala sentences carry the same {brand} / {phone} / {minutes} / {count} / {when} as the English ones', mismatched);

console.log(failures === 0 ? '\nAll phone setup tests passed.' : `\n${failures} phone setup test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
