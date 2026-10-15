// Tests of the "Phone setup" card's rules (src/lib/phoneSetup.ts). Pure code, no stack needed:
//
//   npm run test:setup          (from apps/driver)

import { brandName, gapMinutes, gapsToShow, keepGaps, noteBeat, settingsIntents, setupBrand } from '../src/lib/phoneSetup';

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

// 2. What is kept and what the card shows.
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
check(shown.length === 3 && shown[0].from === T + min(8), 'the card shows the gaps of the last 3 days, newest first', shown);
check(gapsToShow(kept, T + min(20), now).length === 0, 'after Done the card stays away …');
check(gapsToShow([...kept, { from: T + min(30), to: T + min(35) }], T + min(20), now).length === 1, '… until the phone stops the app again');
check(gapsToShow(kept, null, T + 4 * 86_400_000).length === 0, 'gaps older than 3 days no longer show the card');

// 3. Brands, names and the settings pages.
check(setupBrand('OPPO', 'OPPO') === 'oppo' && setupBrand('realme', 'realme') === 'realme' && setupBrand('OnePlus', 'OnePlus') === 'oppo', 'OPPO, realme (its own steps) and OnePlus (ColorOS)');
check(setupBrand('Redmi', 'Xiaomi') === 'xiaomi' && setupBrand('POCO', 'Xiaomi') === 'xiaomi' && setupBrand('iQOO', 'vivo') === 'vivo' && setupBrand('samsung', 'samsung') === 'samsung', 'Redmi and POCO are Xiaomi, iQOO is vivo, Samsung');
check(setupBrand('Nokia', 'HMD Global') === 'other' && setupBrand(null, null) === 'other', 'anything else gets the general steps');
check(brandName('OPPO', 'OPPO') === 'OPPO' && brandName('redmi', 'Xiaomi') === 'Redmi' && brandName('nokia', null) === 'Nokia' && brandName('', null) === null, 'the brand as the phone shows it');
const xiaomi = settingsIntents('xiaomi', 'com.fameglobal.driver', 'Fame Driver');
check(xiaomi[0]?.extra?.package_name === 'com.fameglobal.driver' && xiaomi[0]?.extra?.package_label === 'Fame Driver', 'Xiaomi\'s battery saver page is opened for this app');
check((['oppo', 'realme', 'xiaomi', 'vivo', 'samsung'] as const).every((b) => settingsIntents(b, 'x', 'y').length >= 2) && settingsIntents('other', 'x', 'y').length === 0,
  'every listed brand has at least two pages to try; any other phone goes to App info');

console.log(failures === 0 ? '\nAll phone setup tests passed.' : `\n${failures} phone setup test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
