// Round 2 (21 October 2026): the stop slides, no phone. The slide's geometry (90 % to complete, a tap never moves it), the
// in-app arrival card's rule (60 s within 150 m; leaving starts again; nothing by itself), the progress words, and the
// screens read as text (no tap left for Arrived / Left, the strings in en and si).
//
//   npm run test:stop-slides          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SLIDE_DONE_AT, slideOffset, slideProgress, slideRelease, slideTravel } from '../src/lib/patterns/slideLogic';
import { type ArrivalWatch, backgroundArrival, GEOFENCE_DWELL_MS, geofenceStep, geofenceTarget, geofenceTargets, NO_DWELL, NO_WATCH, type Dwell } from '../src/lib/stopGeofence';
import { stopProgress } from '../src/lib/stopProgress';
import { nextAbout, progressWords } from '../src/lib/stopProgressWords';
import type { TaskStop } from '../src/lib/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const en = JSON.parse(read('i18n/en.json'));
const si = JSON.parse(read('i18n/si.json'));
const lookup = (dict: unknown, key: string) => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dict);
const t = (key: string, vars: Record<string, string | number> = {}) => {
  const v = lookup(en, key);
  if (typeof v !== 'string') throw new Error(`no text for ${key}`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};

console.log('\nThe slide');
{
  const travel = slideTravel(400, 56, 4);
  check(travel === 336 && slideTravel(50, 56, 4) === 0, 'the travel: the track less the thumb and its padding (never below 0)', travel);
  check(SLIDE_DONE_AT === 0.9, 'done at 90 %');
  check(slideRelease(0, travel) === 'back', 'a tap (no movement) springs back: never done');
  check(slideRelease(travel * 0.89, travel) === 'back' && slideRelease(travel * 0.5, travel) === 'back', 'let go under 90 %: back');
  check(slideRelease(travel * 0.9, travel) === 'done' && slideRelease(travel, travel) === 'done' && slideRelease(travel * 3, travel) === 'done', 'let go at 90 % or more (or past the end): done');
  check(slideRelease(-200, travel) === 'back' && slideOffset(-200, travel) === 0, 'a drag to the left stays at the start');
  check(slideOffset(9999, travel) === travel && slideProgress(9999, travel) === 1, 'a drag past the end is held at the end');
  check(slideRelease(500, 0) === 'back' && slideProgress(500, 0) === 0, 'before the track is laid out nothing completes');
  check(slideOffset(Number.NaN, travel) === 0, 'a broken number stays at the start');
}

const T0 = Date.parse('2026-10-21T04:00:00Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const stop = (seq: number, over: Partial<TaskStop> = {}): TaskStop => ({
  id: `s${seq}`, task_id: 'task', seq, type: 'drop', status: 'pending', place_name: `Stop ${seq} place`,
  lat: 7 + seq / 100, lng: 80, arrived_at: null, done_at: null,
  planned_arrive_at: iso(seq * 60), planned_depart_at: iso(seq * 60 + 20),
  ...over,
} as TaskStop);
const at = (s: TaskStop, metres = 0, accuracyM = 10) => ({ lat: (s.lat as number) + metres / 111_000, lng: s.lng as number, accuracyM });

console.log('\nThe arrival card (60 s within 150 m)');
{
  const stops = [stop(1), stop(2)];
  check(geofenceTarget(stops)?.kind === 'arrive' && geofenceTarget(stops)?.stop.id === 's1', 'the current stop not yet arrived: "Arrived at …?"');
  let d: Dwell = NO_DWELL;
  let r = geofenceStep(stops, at(stops[0], 80), d, T0);
  check(r.prompt === null && r.dwell.since === T0, 'the first fix inside starts the count, no card yet');
  d = r.dwell;
  r = geofenceStep(stops, at(stops[0], 60), d, T0 + 30_000);
  check(r.prompt === null, 'inside for 30 s: no card yet');
  d = r.dwell;
  r = geofenceStep(stops, at(stops[0], 40), d, T0 + GEOFENCE_DWELL_MS);
  check(r.prompt?.kind === 'arrive', 'inside for 60 s: the card');
  d = r.dwell;
  r = geofenceStep(stops, at(stops[0], 400), d, T0 + 70_000);
  check(r.prompt === null && r.dwell.since === null, 'drove on (a sure fix outside 150 m): the card goes and the count starts again');
  d = r.dwell;
  r = geofenceStep(stops, at(stops[0], 10), d, T0 + 80_000);
  check(r.prompt === null && r.dwell.since === T0 + 80_000, 'back inside: a new 60 s');
  d = r.dwell;
  r = geofenceStep(stops, null, d, T0 + 150_000);
  check(r.prompt === null && r.dwell.since === T0 + 80_000, 'no fix: no card, the count is kept');
  r = geofenceStep(stops, at(stops[0], 10, 120), d, T0 + 150_000);
  check(r.prompt === null && r.dwell.since === T0 + 80_000, 'a fix not sure enough (over 75 m): no card, the count is kept');
  r = geofenceStep(stops, at(stops[0], 10), d, T0 + 150_000);
  check(r.prompt?.kind === 'arrive', 'a sure fix inside again: the card');
  check(geofenceStep([stop(1, { lat: null, lng: null })], { lat: 7, lng: 80 }, NO_DWELL, T0).prompt === null, 'a stop with no pin: never asked');
}

console.log('\nLeft without sliding: "Mark … as done?" at the next stop');
{
  const stops = [stop(1, { status: 'arrived', arrived_at: iso(55) }), stop(2)];
  const target = geofenceTarget(stops);
  check(target?.kind === 'leave_previous' && target.stop.id === 's1' && target.next.id === 's2', 'the stop Arrived but never Left, with the next one ahead');
  let r = geofenceStep(stops, at(stops[0], 0), NO_DWELL, T0);
  check(r.prompt === null && r.dwell.since === null, 'still at the arrived stop: nothing (the leave slide is on its row)');
  r = geofenceStep(stops, at(stops[1], 50), r.dwell, T0 + 10_000);
  const r2 = geofenceStep(stops, at(stops[1], 50), r.dwell, T0 + 10_000 + GEOFENCE_DWELL_MS);
  check(r.prompt === null && r2.prompt?.kind === 'leave_previous', '60 s within 150 m of the next stop: "Mark Stop 1 as done?"');
  const changed = [stop(1, { status: 'done', arrived_at: iso(55), done_at: iso(80) }), stop(2)];
  const r3 = geofenceStep(changed, at(changed[1], 50), r2.dwell, T0 + 10_000 + GEOFENCE_DWELL_MS + 5_000);
  check(r3.prompt === null && r3.dwell.key === 'arrive:s2' && r3.dwell.since !== null, 'once marked, the question changes (Arrived at Stop 2?) and its own 60 s start');
  check(geofenceTarget([stop(1, { status: 'arrived', arrived_at: iso(55) })]) === null, 'the last stop Arrived: no question (its slide is "Slide to finish")');
  check(geofenceTarget([stop(1, { status: 'done', done_at: iso(1) }), stop(2, { status: 'skipped', done_at: iso(2) })]) === null, 'every stop behind: nothing');
}

console.log('\nRound 2b: a stop driven past ("Did you stop at …?" at the next stop)');
{
  const stops = [stop(1), stop(2), stop(3)];
  const kinds = geofenceTargets(stops).map((x) => `${x.kind}:${x.stop.id}${'next' in x ? `>${x.next.id}` : ''}`).join();
  check(kinds === 'arrive:s1,passed:s1>s2', 'the current stop not arrived: "Arrived at …?" there, "Did you stop at …?" at the next stop', kinds);
  let r = geofenceStep(stops, at(stops[1], 40), NO_DWELL, T0);
  check(r.prompt === null && r.dwell.key === 'passed:s1' && r.dwell.since === T0, 'at the next stop: the count starts, no card yet');
  r = geofenceStep(stops, at(stops[1], 40), r.dwell, T0 + 30_000);
  check(r.prompt === null, '30 s: no card yet');
  r = geofenceStep(stops, at(stops[1], 20), r.dwell, T0 + GEOFENCE_DWELL_MS);
  check(r.prompt?.kind === 'passed' && r.prompt.stop.id === 's1' && r.prompt.next.id === 's2', '60 s within 150 m of the next stop: "Did you stop at Stop 1?"', r.prompt);
  const drove = geofenceStep(stops, at(stops[1], 600), r.dwell, T0 + 70_000);
  check(drove.prompt === null && drove.dwell.since === null, 'drove on: the card goes and the count starts again');
  const switched = geofenceStep(stops, at(stops[0], 10), r.dwell, T0 + 70_000);
  check(switched.prompt === null && switched.dwell.key === 'arrive:s1' && switched.dwell.since === T0 + 70_000, 'back at the passed stop itself: its own "Arrived?" with a new 60 s');
  const noPin = [stop(1, { lat: null, lng: null }), stop(2)];
  check(geofenceTargets(noPin).map((x) => x.kind).join() === 'passed', 'a passed stop with no pin is still asked about at the next one');
  check(geofenceStep(noPin, at(noPin[1], 10), { key: 'passed:s1', since: T0 }, T0 + GEOFENCE_DWELL_MS).prompt?.kind === 'passed', '… after the same 60 s');
  check(geofenceTargets([stop(1), stop(2, { lat: null, lng: null })]).map((x) => x.kind).join() === 'arrive', 'the next stop with no pin: nothing to wait at, only the current stop\'s question');
  check(geofenceTargets([stop(1), stop(2, { status: 'skipped', done_at: iso(1) }), stop(3)]).map((x) => `${x.kind}:${'next' in x ? x.next.id : ''}`).join() === 'arrive:,passed:s3',
    'a skipped stop between: the next stop still to do');
  const skipped = [stop(1, { status: 'skipped', done_at: iso(70) }), stop(2)];
  const after = geofenceStep(skipped, at(skipped[1], 20), r.dwell, T0 + GEOFENCE_DWELL_MS + 5_000);
  check(after.prompt === null && after.dwell.key === 'arrive:s2', 'once answered (Skip it, or Yes = Arrived and Left), the next stop\'s own question with its own 60 s');
}

console.log('\nRound 2b: the background notification (the same 60 s within 150 m, once per stop)');
{
  type BgTask = { id: string; status: string; task_stops: TaskStop[] };
  const fixAt = (s: TaskStop, sec: number, metres = 20) => ({ ...at(s, metres), at: T0 + sec * 1000 });
  const stops = [stop(1), stop(2)];
  const running: BgTask[] = [{ id: 'task', status: 'in_progress', task_stops: stops }];
  let w: ArrivalWatch = NO_WATCH;
  let r = backgroundArrival(running, [fixAt(stops[0], 0), fixAt(stops[0], 5), fixAt(stops[0], 15)], w);
  check(r.notify === null && r.watch.dwell.since === T0, 'the first delivery inside: counting, no notification');
  w = r.watch;
  r = backgroundArrival(running, [fixAt(stops[0], 45), fixAt(stops[0], 60), fixAt(stops[0], 30)], w);
  check(r.notify?.stop.id === 's1' && r.notify.target.kind === 'arrive' && r.notify.task.id === 'task', '60 s inside (the fixes taken in time order): "Arrived at Stop 1?"', r.notify);
  w = r.watch;
  r = backgroundArrival(running, [fixAt(stops[0], 90)], w);
  check(r.notify === null && w.notified.includes('s1'), 'once per stop: never again for Stop 1');
  r = backgroundArrival(running, [fixAt(stops[0], 100, 900), fixAt(stops[0], 300)], r.watch);
  check(r.notify === null, '… also after driving off and coming back');
  const before = backgroundArrival(running, [fixAt(stops[0], 0), fixAt(stops[0], 30)], NO_WATCH);
  check(before.notify === null, 'only 30 s inside: nothing');
  const through = backgroundArrival(running, [fixAt(stops[0], 0), fixAt(stops[0], 30, 400), fixAt(stops[0], 61)], NO_WATCH);
  check(through.notify === null && through.watch.dwell.since === T0 + 61_000, 'driven through (a fix outside in between): the count starts again');
  const unsure = backgroundArrival(running, [fixAt(stops[0], 0), { ...fixAt(stops[0], 70), accuracyM: 200 }], NO_WATCH);
  check(unsure.notify === null, 'the latest fix not sure enough: nothing yet');
  const passed = backgroundArrival(running, [fixAt(stops[1], 0), fixAt(stops[1], 65)], NO_WATCH);
  check(passed.notify?.stop.id === 's2' && passed.notify.target.kind === 'passed', 'Stop 1 driven past, 60 s at Stop 2: one notification for Stop 2 (the card asks about Stop 1)', passed.notify);
  const answered: BgTask[] = [{ id: 'task', status: 'in_progress', task_stops: [stop(1, { status: 'skipped', done_at: iso(1) }), stop(2)] }];
  const later = backgroundArrival(answered, [fixAt(stops[1], 100), fixAt(stops[1], 200)], passed.watch);
  check(later.notify === null, '… and not a second time for Stop 2 once Stop 1 is answered (one notification per stop)');
  const arrivedPrev = [stop(1, { status: 'arrived', arrived_at: iso(55) }), stop(2)];
  const lp = backgroundArrival([{ id: 'task', status: 'in_progress', task_stops: arrivedPrev }], [fixAt(arrivedPrev[1], 0), fixAt(arrivedPrev[1], 60)], NO_WATCH);
  check(lp.notify?.stop.id === 's2' && lp.notify.target.kind === 'leave_previous', 'Stop 1 never Left, 60 s at Stop 2: one notification for Stop 2');
  check(backgroundArrival([{ id: 'task', status: 'assigned', task_stops: stops }], [fixAt(stops[0], 0), fixAt(stops[0], 90)], NO_WATCH).notify === null, 'no task under way: nothing');
  check(backgroundArrival(running, [], w).notify === null, 'no fixes: nothing');
}

console.log('\nThe progress words');
{
  const stops = [
    stop(1, { status: 'done', arrived_at: iso(82), done_at: iso(100) }),
    stop(2, { status: 'arrived', arrived_at: iso(112) }),
    stop(3),
  ];
  const p = stopProgress(stops, new Date(T0 + 113 * 60_000));
  const w1 = progressWords(t, p[0]);
  check(w1.line === 'Planned 10:30 · Arrived 10:52 · Left 11:10' && w1.delta?.text === '22 min late' && w1.delta.late && w1.about === null,
    'a stop left: "Planned 10:30 · Arrived 10:52 · Left 11:10", "22 min late" (amber)', w1);
  const w2 = progressWords(t, p[1]);
  check(w2.line === 'Planned 11:30 · Arrived 11:22' && w2.delta?.text === '8 min early' && !w2.delta.late, 'arrived early: "8 min early" (green)', w2);
  const w3 = progressWords(t, p[2]);
  // Stop 2: arrived 11:22, planned stay 20 min → leaves 11:42; the planned leg 11:50 → 12:30 is 40 min → about 12:22.
  check(w3.line === 'Planned 12:30' && w3.delta === null && w3.about === 'about 12:22', 'a stop to come: "about 12:22" from the re-estimate', w3);
  check(JSON.stringify(nextAbout(p)) === JSON.stringify({ id: 's3', time: '12:22' }), 'Today\'s card: the next stop\'s "about"');
  const onTime = progressWords(t, stopProgress([stop(1, { status: 'arrived', arrived_at: iso(61) })], new Date(T0 + 62 * 60_000))[0]);
  check(onTime.delta?.text === 'on time' && !onTime.delta.late, 'within 2 minutes: "on time"');
  check(nextAbout(stopProgress([stop(1), stop(2)], new Date(T0))) === null, 'nothing confirmed yet: no "about" (the plan is what is known)');
  check(progressWords(t, undefined).line === '', 'no progress: nothing');
  check(progressWords(t, p[1], true).line === 'Planned 11:30 · Arrived 11:22 · corrected', 'Round 2b: an Arrived undone and marked again: "Arrived 11:22 · corrected"', progressWords(t, p[1], true));
  check(progressWords(t, p[2], true).line === 'Planned 12:30', 'not Arrived (yet again): no "corrected"');
  check(progressWords(t, p[0], true).line === 'Planned 10:30 · Arrived 10:52 · corrected · Left 11:10', '… and it stays once Left');
  // Round 2b (Sahan, 21 October 2026): a stop driven past, "Yes, I was there" later.
  const untimed = stopProgress([stops[0], stop(2, { status: 'done', confirmed_later_at: iso(130) }), stop(3)], new Date(T0 + 131 * 60_000));
  const wu = progressWords(t, untimed[1]);
  check(wu.line === 'Planned 11:30 · Visited · time not recorded · confirmed later' && wu.delta === null && wu.about === null,
    'confirmed later with no location points: "Visited · time not recorded · confirmed later", never late or early', wu);
  check(nextAbout(untimed)?.id === 's3', 'Today\'s card: the next stop is the one after it (the visited stop is not "next")', nextAbout(untimed));
  const timed = stopProgress([stops[0], stop(2, { status: 'done', arrived_at: iso(112), done_at: iso(115), confirmed_later_at: iso(130) }), stop(3)], new Date(T0 + 131 * 60_000));
  const wt = progressWords(t, timed[1]);
  check(wt.line === 'Planned 11:30 · Arrived 11:22 · Left 11:25 · confirmed later' && wt.delta?.text === '8 min early',
    'confirmed later with the points\' times: Arrived and Left from them, its difference, "confirmed later"', wt);
}

console.log('\nThe screens');
{
  const screen = code('app/task/[id].tsx');
  const button = code('components/ArrivalButton.tsx');
  check(!/onPress=\{\(\) => app\.markStop(Arrived|Done)/.test(screen) && !/onPress=\{\(\) => markStop(Arrived|Done)/.test(button), 'no tap marks a stop Arrived or Left any more');
  check(/<SlideToConfirm[^>]*label=\{t\('task\.slideArrive'/.test(button) && /label=\{t\('task\.slideLeave'/.test(button) && /label=\{t\('task\.slideFinish'\)\}/.test(button) && /label=\{t\('arrive\.override'\)\}/.test(button),
    'the current stop: arrive, override, leave and finish are all slides');
  check(/<ArrivalButton key=\{item\.id\} stop=\{item\} here=\{here\} last=\{item\.id === lastId\} onFinish=\{finishTask\} \/>/.test(screen) && /onPress=\{\(\) => finishTask\(\)\}/.test(screen),
    'Slide to finish and Complete task share one finish (the question about open stops, then Log mileage)');
  check(/pathname: '\/log-mileage', params: \{ mode: 'finish', taskId: task\.id \}/.test(screen), 'the finish opens Log mileage as before');
  check(/slides\.leave\(item\)/.test(screen) && /slides\.arrive\(item, nearHere\)/.test(screen), 'a stop visited out of order: the same slides (with Undo)');
  check(/<GeofenceCard task=\{task\} here=\{here\} onSkip=\{setSkipping\} \/>/.test(screen) && /<StopProgressLine progress=\{progress\.get\(item\.id\)\} corrected=\{undone\.includes\(item\.id\)\} \/>/.test(screen), 'the arrival card and every row\'s progress line');
  check(/undoStopStep\(stop, 'arrived'\)/.test(button) && /undoStopStep\(stop, 'left'\)/.test(button) && /SNACK_ACTION_MS/.test(button), 'Undo for 6 s after each slide');
  const app = code('state/app.tsx');
  check(/patchStop\(stop, \{ status: 'pending', arrived_at: null \}\)/.test(app) && /patchStop\(stop, \{ status: 'arrived', done_at: null \}\)/.test(app), 'Undo goes through the same queued stop write');
  check(/noteArrivalUndone\(stop\.id\);\s*patchStop\(stop, \{ status: 'pending', arrived_at: null \}\)/.test(app), 'Round 2b: an undone Arrived is remembered on the phone (the "corrected" note); the server keeps how it was first marked');
  check(/patchStop\(stop, \{ status: 'done', confirmed_later_at: new Date\(\)\.toISOString\(\), arrived_at: null, done_at: null \}\)/.test(app)
    && !/markStopPassed[\s\S]{0,200}arrived_at: now/.test(app),
    'Round 2b: "Yes, I was there" = one queued write, visited and confirmed now; never the phone\'s time as the visit (the server takes the points)');
  check(/patchStop\(stop, \{ status: 'pending', confirmed_later_at: null, arrived_at: null, done_at: null \}\)/.test(app), '… and its Undo clears it all: the stop is to do again');
  const card = code('components/GeofenceCard.tsx');
  check(/slides\.passed\(prompt\.stop\)/.test(card) && /onPress=\{\(\) => onSkip\(prompt\.stop\)\}/.test(card) && /label=\{t\('geofence\.passedYes'\)\}/.test(card),
    'Round 2b: the passed stop\'s card: the slide "Yes, I was there" (confirmed later) and "Skip it" (the skip sheet)');
  check(/markStopPassed\(stop\)/.test(button) && /undoStopStep\(stop, 'passed'\)/.test(button), '… with Undo');
  const bg = code('lib/arrival.ts');
  const bgTask = code('lib/locationTask.ts');
  check(/await checkArrival\(locations\.map\(toPhoneFix\)\)/.test(bgTask) && (bg.match(/notifyArrival\(/g) ?? []).length === 1 && /backgroundArrival\(tasks, fixes, watch\)/.test(bg)
    && /arrivalDue\(tasks, newest, nudged\)/.test(bg) && /auto_detected_at: at/.test(bg),
    'Round 2b: the background task: ONE arrival notification per stop by the 60 s rule; auto_detected_at recorded as before');
  check(/AppState\.currentState === 'active' && taskOnScreen === step\.notify\.task\.id/.test(bg) && /setTaskOnScreen\(id\)/.test(screen), '… quiet while this task\'s own screen (with its card) is in front');
  const slide = code('components/patterns/SlideToConfirm.tsx');
  check(!/onPress|Pressable|PanResponder\.create\(\{[^}]*onPanResponderRelease[^}]*confirm/.test(slide) && /actionName === 'activate'/.test(slide), 'the slide has no press handler; "activate" is the screen reader\'s path');
  const today = code('app/(tabs)/index.tsx');
  check(/t\('today\.nextStopAbout'/.test(today), 'Today\'s card under way: the next stop\'s "about"');
}

console.log('\nThe strings (en and si)');
{
  const keys = ['task.slideArrive', 'task.slideLeave', 'task.slideFinish', 'task.undo', 'task.undoArrived', 'task.undoLeft',
    'task.progress.planned', 'task.progress.arrived', 'task.progress.left', 'task.progress.late', 'task.progress.early', 'task.progress.onTime',
    'task.progress.about', 'geofence.arrivedTitle', 'geofence.doneTitle', 'geofence.doneBody', 'geofence.passedTitle', 'geofence.passedYes', 'geofence.passedSkip', 'task.undoPassed', 'task.progress.corrected', 'task.progress.confirmedLater', 'task.progress.timeNotRecorded', 'arrival.title', 'arrival.body', 'today.nextStopAbout', 'patterns.slideHint'];
  const missing = keys.filter((k) => typeof lookup(en, k) !== 'string' || typeof lookup(si, k) !== 'string');
  check(missing.length === 0, `every new key in en and si (${keys.length})`, missing);
  const ph = (x: unknown) => (String(x).match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const differ = keys.filter((k) => ph(lookup(en, k)) !== ph(lookup(si, k)));
  check(differ.length === 0, 'the same placeholders in both', differ);
  check(!/[෦-෯]/.test(keys.map((k) => String(lookup(si, k))).join(' ')), 'Latin digits in Sinhala');
  const used = Array.from(new Set(['app/task/[id].tsx', 'components/ArrivalButton.tsx', 'components/GeofenceCard.tsx', 'components/patterns/SlideToConfirm.tsx', 'lib/stopProgressWords.ts', 'app/(tabs)/index.tsx']
    .flatMap((f) => Array.from(code(f).matchAll(/t\('((?:task|geofence|today|patterns|arrive)\.[A-Za-z.]+)'/g)).map((m) => m[1]))));
  const unknown = used.filter((k) => typeof lookup(en, k) !== 'string' || typeof lookup(si, k) !== 'string');
  check(unknown.length === 0 && used.length > 20, `every key these screens use exists in both (${used.length})`, unknown);
}

console.log(failures === 0 ? '\nAll stop slide checks passed.' : `\n${failures} stop slide check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
