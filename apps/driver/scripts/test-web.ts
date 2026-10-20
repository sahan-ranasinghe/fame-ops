// The mobile website (Phase 8, O4): the browser's own rules, and that no TEMPORARY piece is left in the web build.
//
//   npm run test:web          (from apps/driver)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { pickButtons, promptText } from '../src/lib/webAlert';

let failures = 0;
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

console.log(failures ? `\n${failures} web check(s) FAILED.` : '\nAll web checks passed.');
process.exit(failures ? 1 : 0);
