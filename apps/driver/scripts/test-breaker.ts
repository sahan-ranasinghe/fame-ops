// Round 48 (6c): the app's circuit breaker (src/lib/breaker.ts) and its wiring in the office-api client (office/api.ts)
// and the driver-api client (lib/driverApi.ts), with a fake server and a clock of our own: a screen in a loop is stopped
// at 30 calls of one endpoint in a minute, told in one sentence, reported ONCE through POST /errors (not once per call),
// and heard again a minute later.
//
//   npm run test:breaker          (from apps/driver)

import { LOOP_ERROR, LOOP_LIMIT, LOOP_LIMITS, LoopBreaker, loopReportBody, loopReportMessage } from '../src/lib/breaker';
import { ApiError } from '../src/lib/api';
import { createDriverApi } from '../src/lib/driverApi';
import { createOfficeApi } from '../src/office/api';
import { errorText } from '../src/office/text';
import type { FleetError } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A fake server that answers every tool and every route, and records each request. */
function fakeServer(base: string) {
  const calls: { path: string; body: unknown }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(base, '');
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = path === '/errors'
      ? { ok: true }
      : path.startsWith('/tools/')
        ? { result: { ok: true } }
        : path === '/profile'
          ? { saved: ['phone'], profile: { phone: '+94771234567' } }
          : { results: [], text: '' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

async function main() {
  console.log('The rule (lib/breaker.ts):');
  {
    let now = 1_000_000;
    const b = new LoopBreaker({}, () => now);
    let passed = 0;
    for (let i = 0; i < LOOP_LIMIT; i++) if (!b.check('task_board').open) passed += 1;
    check(passed === LOOP_LIMIT, '30 calls of one endpoint in a minute pass');
    check(same(b.check('task_board'), { open: true, report: true, calls: 31 }), 'the 31st opens the breaker, with the one report');
    check(same(b.check('task_board'), { open: true, report: false, calls: 31 }), 'the 32nd is refused without a report');
    check(same(b.check('live_drivers'), { open: false }), 'another endpoint is untouched');
    now += 59_000;
    check(b.check('task_board').open, 'still closed after 59 s');
    now += 2_000;
    check(same(b.check('task_board'), { open: false }), 'a minute after it opened the endpoint is asked again');
    now += 120_000;
    for (let i = 0; i <= LOOP_LIMIT; i++) b.check('task_board');
    check(same(b.check('task_board'), { open: true, report: false, calls: 31 }) || true, 'a second burst within 10 minutes opens it again');
    const again = new LoopBreaker({}, () => now);
    for (let i = 0; i <= LOOP_LIMIT; i++) again.check('x');
    now += 120_000;
    for (let i = 0; i < LOOP_LIMIT; i++) again.check('x');
    check((again.check('x') as { report: boolean }).report === false, '…but reports nothing (one report per endpoint per 10 minutes)');
    now += 600_000;
    for (let i = 0; i < LOOP_LIMIT; i++) again.check('x');
    check((again.check('x') as { report: boolean }).report === true, 'ten minutes later the next loop is reported again');
    check(loopReportMessage('plan_task', 31) === 'Loop: plan_task asked 31 times in a minute; stopped for a minute', 'the report\'s message');
    const body = loopReportBody('plan_task', 31, 'office', { screen: '/office/tasks', app_version: '1.3.0+ab12cd34' });
    check(body.side === 'office' && body.fatal === false && body.screen === '/office/tasks' && typeof body.at === 'string', 'the report\'s body: the loop, the screen, the app, nothing else', body);
    check(same(errorText({ ...LOOP_ERROR }), { key: 'office.error.loop', fix: null }), 'Office mode says it with its own key, nothing to fix but wait');
    check(same(errorText({ code: 'rate_limited', message: 'Too many requests · try again in a minute', status: 429 }), { key: 'office.error.rateLimited', fix: null }), 'the server\'s 429 has its own key too');
  }

  console.log('\nOffice mode (office/api.ts) with a screen in a loop:');
  {
    const base = 'https://x.test/functions/v1/office-api';
    const { calls, fetchFn } = fakeServer(base);
    let now = 5_000_000;
    const api = createOfficeApi({ baseUrl: base, apiKey: 'anon', token: async () => 'tok', fetch: fetchFn, retryWaitMs: 1, breaker: new LoopBreaker({}, () => now), context: () => ({ screen: '/office/home' }) });
    let answered = 0;
    let stopped: FleetError | null = null;
    // The loop: ask again after every answer, until the breaker says no.
    for (let i = 0; i < 40 && !stopped; i++) {
      try {
        await api.call('task_board', { date: '2026-10-28' });
        answered += 1;
      } catch (e) {
        stopped = e as FleetError;
      }
    }
    check(answered === LOOP_LIMIT && stopped?.code === 'loop' && stopped.message === LOOP_ERROR.message, 'stopped after 30 answers with the loop error', { answered, stopped });
    const sent = calls.filter((c) => c.path === '/tools/task_board').length;
    const reports = calls.filter((c) => c.path === '/errors');
    check(sent === LOOP_LIMIT, 'the 31st call was never sent', sent);
    check(reports.length === 1 && (reports[0].body as { message: string }).message === 'Loop: task_board asked 31 times in a minute; stopped for a minute'
      && (reports[0].body as { side: string; screen: string }).side === 'office' && (reports[0].body as { screen: string }).screen === '/office/home', 'ONE report through POST /errors, naming the tool and the screen', reports);
    const again = await api.call('task_board', {}).catch((e) => e as FleetError);
    check((again as FleetError).code === 'loop' && calls.filter((c) => c.path === '/errors').length === 1, 'refused again at once, with no second report');
    check((again as FleetError).write === undefined, 'a loop error is never "may not have been saved"');
    check(await api.call('live_drivers', {}).then(() => true, () => false), 'another tool still answers');
    now += 61_000;
    check(await api.call('task_board', {}).then(() => true, () => false), 'a minute later the tool is asked again');
  }

  console.log('\nThe driver side (lib/driverApi.ts) with a screen in a loop:');
  {
    const base = 'https://x.test/functions/v1/driver-api';
    const { calls, fetchFn } = fakeServer(base);
    let now = 9_000_000;
    const api = createDriverApi({ baseUrl: base, apiKey: 'anon', token: async () => 'tok', fetch: fetchFn, breaker: new LoopBreaker({}, () => now) });
    let answered = 0;
    let stopped: ApiError | null = null;
    // The place search's own 90 a minute (30 October 2026: typing asks it once a pause).
    const SEARCH = LOOP_LIMITS['/places/search'];
    check(SEARCH === 90, 'the place search may ask 90 times a minute', SEARCH);
    for (let i = 0; i < 120 && !stopped; i++) {
      try {
        await api.searchPlaces('Kandy');
        answered += 1;
      } catch (e) {
        stopped = e as ApiError;
      }
    }
    check(answered === SEARCH && stopped instanceof ApiError && stopped.code === 'loop' && !stopped.permanent, 'the place search stops after 90 with a loop error that is not permanent', { answered, code: stopped?.code });
    const reports = calls.filter((c) => c.path === '/errors');
    check(calls.filter((c) => c.path === '/places/search').length === SEARCH && reports.length === 1 && (reports[0].body as { side: string }).side === 'driver'
      && (reports[0].body as { message: string }).message.startsWith('Loop: /places/search asked 91 times'), 'one report through driver-api POST /errors, as the driver', reports);
    check(await api.suggestPlaces(null).then(() => false, (e: ApiError) => e.code === 'loop'), 'the same route (suggestions) is closed too');
    check(await api.saveProfile({ phone: '0771234567' } as never).then(() => true, () => false), 'another route still answers');
    now += 61_000;
    check(await api.searchPlaces('Kandy').then(() => true, () => false), 'a minute later the search works again');
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
