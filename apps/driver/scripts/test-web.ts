// The mobile website (Phase 8, O4): the browser's own rules, and that no TEMPORARY piece is left in the web build.
//
//   npm run test:web          (from apps/driver)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { pickButtons, promptText } from '../src/lib/webAlert';
import { browserPushLine, endpointHash, keyBytes, sitePath } from '../src/office/browserPushLogic';

let failures = 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

console.log('\nConfirmations in a browser');
{
  const discard = pickButtons([{ text: 'Cancel', style: 'cancel' }, { text: 'Discard', style: 'destructive' }]);
  check(discard.ok?.text === 'Discard' && discard.cancel?.text === 'Cancel', 'Discard changes?: OK discards, Cancel stays');
  const resume = pickButtons([{ text: 'Start again', style: 'destructive' }, { text: 'Resume' }]);
  check(resume.ok?.text === 'Start again' && resume.cancel?.text === 'Resume', 'Resume your draft?: Cancel (and Esc) keeps the draft, the safe choice');
  const signOut = pickButtons([{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive' }]);
  check(signOut.ok?.text === 'Sign out', 'Sign out?: OK signs out');
  const info = pickButtons([{ text: 'OK' }]);
  check(info.ok?.text === 'OK' && info.cancel === null, 'one button: the browser\'s alert, then that button');
  check(promptText('Sign out?', 'You can sign in again.', signOut, { ok: 'OK', cancel: 'Cancel' }).endsWith('OK: Sign out · Cancel: Cancel'), 'the text names what OK and Cancel do');
}

console.log('\nNothing temporary left in the web build');
{
  const root = join(__dirname, '..', 'src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  const temporary = walk(root).filter((f) => /\.web\.tsx?$/.test(f) && /TEMPORARY/.test(readFileSync(f, 'utf8')));
  check(temporary.length === 0, 'no .web file says TEMPORARY (the spike\'s placeholders are replaced)', temporary.map((f) => f.slice(root.length + 1)));
}

console.log('\nStep 5: installable, offline, web push (public/, office/browserPushLogic.ts)');
{
  const pub = join(__dirname, '..', 'public');
  const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as { name: string; scope: string; start_url: string; display: string; icons: { src: string; purpose: string }[] };
  check(manifest.name === 'Fame Fleet' && manifest.scope === '/m/' && manifest.start_url === '/m/' && manifest.display === 'standalone', 'the manifest: Fame Fleet, its own scope /m/, standalone');
  check(manifest.icons.some((i) => i.purpose === 'maskable') && manifest.icons.every((i) => i.src.startsWith('/icons/')), 'the site\'s FF icons, one maskable');
  const html = readFileSync(join(pub, 'index.html'), 'utf8');
  check(html.includes('href="/m/manifest.webmanifest"') && html.includes('rel="icon"') && html.includes('apple-touch-icon') && html.includes('<div id="root">'), 'the page links the manifest, the favicon and the iPhone icon');
  const sw = readFileSync(join(pub, 'sw.js'), 'utf8');
  check(sw.includes('"/m/offline.html"') && /req\.mode !== "navigate"/.test(sw) && !/caches\.open\(CACHE\)\.then\(\(c\) => c\.addAll/.test(sw), 'the worker caches only the offline page, for pages opened with no connection');
  check(sw.includes('"/m/?from=" + encodeURIComponent(path)') && sw.includes('u.pathname.startsWith("/m/")'), 'a tap: an open mobile window is told, else /m/?from=<the link>');
  const offline = readFileSync(join(pub, 'offline.html'), 'utf8');
  check(offline.includes('No connection') && offline.includes('lang="si"') && offline.includes('location.reload()'), 'the offline page: No connection in both languages, Try again, back by itself when online');
  check(same(browserPushLine('off', true, false), { key: 'off', tone: 'warn', can: 'on' }) && same(browserPushLine('on', true, true), { key: 'on', tone: 'ok', can: 'off' }), 'off → Turn on; on and known → Turn off');
  check(browserPushLine('on', true, false).can === 'on' && browserPushLine('on', false, true).key === 'notConfigured' && browserPushLine('ios_not_installed', true, false).can === null && browserPushLine('blocked', true, false).can === null, 'on but not for this person → Turn on; not configured, an iPhone not installed, blocked: no button');
  check(keyBytes('AQID').join() === '1,2,3' && keyBytes('-_8').join() === '251,255', 'the VAPID key: base64url to bytes');
  check(sitePath('/tasks?task=1', 'https://x.dev') === '/tasks?task=1' && sitePath('https://x.dev/requests/1', 'https://x.dev') === '/requests/1' && sitePath('https://evil.dev/x', 'https://x.dev') === null, 'a link from a notification: only this site\'s paths');
  void endpointHash('e').then((h) => check(h.length === 16, 'the endpoint label: 16 hex characters, as the server keeps it', h));
}

// The endpoint label's check is asynchronous (the browser's digest): the report waits for it.
setTimeout(() => {
  console.log(failures ? `\n${failures} web check(s) FAILED.` : '\nAll web checks passed.');
  process.exit(failures ? 1 : 0);
}, 100);
