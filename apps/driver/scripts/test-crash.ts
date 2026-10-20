// Hotfix O2-H2, Part 1c: what a crash shows and reports (src/lib/crashLogic.ts): never personal data or a key.
//
//   npm run test:crash          (from apps/driver)
import { crashDetails, detailsText, messageOf, reportBody, screenOf, scrub, shouldReport, shouldShowSoft, stackLines, STACK_LINES } from '../src/lib/crashLogic';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

console.log('\nScrubbing');
{
  const s = scrub('kamal@fame.lk 0771234567 +94 77 123 4567 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc sb_secret_abcdefg AIzaSyA1234567890abcdefghijkl 3f2b1c4d-1111-4222-8333-444455556666 123456789012 ?token=abc&x=1');
  check(!/kamal@|0771234567|77 123 4567|eyJhbGci|sb_secret_abc|AIzaSyA|3f2b1c4d|123456789012|token=abc/.test(s), 'e-mails, phones, tokens, keys, ids and long numbers are replaced', s);
  check(scrub('Cannot read property id of undefined') === 'Cannot read property id of undefined', 'an ordinary message is kept as it is');
}

console.log('\nThe details');
{
  const e = new Error('Rendered fewer hooks than expected');
  e.stack = `Error: Rendered fewer hooks than expected\n${Array.from({ length: 20 }, (_, i) => `    at fn${i} (index.bundle:1:${i})`).join('\n')}`;
  const lines = stackLines(e.stack);
  check(lines.length === STACK_LINES && lines[0].startsWith('at fn0'), 'the first stack lines only, without the message line', lines);
  const d = crashDetails(e, { screen: '/office/trip/review', appVersion: '1.3.0+ab12cd34', updateId: 'ab12cd34-0000', runtime: '1.3.0-gmaps', side: 'office' }, true, new Date('2026-10-20T06:00:00Z'));
  const text = detailsText(d);
  check(/^Error: Rendered fewer hooks/.test(text) && /Screen: \/office\/trip\/review/.test(text) && /App: 1\.3\.0\+ab12cd34/.test(text) && /Runtime: 1\.3\.0-gmaps/.test(text) && /Stack:/.test(text), 'Show details: the error, the screen, the app, the update, the runtime, the stack', text);
  const body = reportBody(d);
  check(body.side === 'office' && body.fatal === true && typeof body.stack === 'string' && !('email' in body), 'the report: the details and nothing else', body);
  check(messageOf('a string') === 'a string' && messageOf({ message: 'm' }) === 'm' && messageOf(new Error('x')) === 'x', 'any thrown value becomes a message');
}

console.log('\nReporting');
{
  const d = { message: 'x', screen: '/a' };
  check(shouldReport(null, d, 0) && !shouldReport({ key: '/a|x', at: 0 }, d, 30_000) && shouldReport({ key: '/a|x', at: 0 }, d, 61_000) && shouldReport({ key: '/b|x', at: 0 }, d, 1), 'the same error once a minute (a render loop never floods the server)');
}

console.log('\nThe soft snackbar and the screen (the reviewer\'s findings)');
{
  const t0 = 1_000_000;
  check(shouldShowSoft(null, { message: 'a' }, t0), 'the first soft error shows');
  check(!shouldShowSoft({ key: 'a', at: t0 }, { message: 'b' }, t0 + 5_000), 'another one within 10 s does not');
  check(!shouldShowSoft({ key: 'a', at: t0 }, { message: 'a' }, t0 + 20_000), 'the same one within 30 s does not');
  check(shouldShowSoft({ key: 'a', at: t0 }, { message: 'b' }, t0 + 11_000) && shouldShowSoft({ key: 'a', at: t0 }, { message: 'a' }, t0 + 31_000), 'a different one after 10 s, the same after 30 s');
  check(screenOf(['office', 'driver', '[username]']) === '/office/driver/[username]' && screenOf([]) === '/', 'the screen is the route\'s pattern, never the person in it');
}

console.log(failures === 0 ? '\nAll crash checks passed.' : `\n${failures} crash check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
