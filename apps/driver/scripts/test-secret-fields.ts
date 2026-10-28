// The show/hide eye on every password and PIN field (Material's password field with the visibility toggle), read from
// the source of both codebases: no secureTextEntry or type="password" outside the two shared components
// (components/SecretInput.tsx, the site's ui/SecretField.tsx); every field of the audit uses its component with the
// rules it had (a 6-digit PIN: maxLength 6, the number pad / inputMode numeric; the site's autoComplete); the eye's words
// in both languages; the error reports carry no field value.
//
//   npm run test:secret-fields          (from apps/driver)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

const APP = join(__dirname, '..', 'src');
const SITE = join(__dirname, '..', '..', 'office', 'src');
const read = (root: string, p: string) => readFileSync(join(root, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== '__fixtures__') walk(p, out); }
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

console.log('\nNo secret field outside the shared component');
{
  const allowed = new Set(['components/SecretInput.tsx']);
  const stray = walk(APP).filter((p) => !allowed.has(relative(APP, p)) && /secureTextEntry/.test(readFileSync(p, 'utf8'))).map((p) => relative(APP, p));
  check(stray.length === 0, 'the app: secureTextEntry only in components/SecretInput.tsx', stray);
  const siteAllowed = new Set(['ui/SecretField.tsx']);
  const siteStray = walk(SITE).filter((p) => !siteAllowed.has(relative(SITE, p)) && !/\.test\.tsx?$/.test(p) && /type=["']password["']|type: ["']password["']/.test(readFileSync(p, 'utf8'))).map((p) => relative(SITE, p));
  check(siteStray.length === 0, 'the site: type="password" only in ui/SecretField.tsx', siteStray);
}

console.log('\nThe audit: every field uses the component with its rules');
{
  // [file, what the field must say]
  const app: [string, RegExp, string][] = [
    ['app/login.tsx', /<SecretInput\s+kind="pin"[\s\S]*?label=\{t\('login\.pin'\)\}[\s\S]*?keyboardType="number-pad"[\s\S]*?maxLength=\{6\}[\s\S]*?\/>/, 'the driver\'s PIN: a 6-digit PIN box with the number pad'],
    ['app/login.tsx', /<SecretInput\s+label=\{t\('office\.login\.password'\)\}[\s\S]*?autoComplete="password"[\s\S]*?\/>/, 'Office sign-in: the password box, autoComplete kept'],
    ['app/office/people/driver-new.tsx', /<SecretInput kind="pin" label=\{t\('office\.people\.pin'\)\}[^\n]*maxLength=\{6\} keyboardType="number-pad"[^\n]*mono/, 'Add a driver: the 6-digit PIN box'],
    ['app/office/people/driver/[username].tsx', /<SecretInput kind="pin" label=\{t\('office\.people\.pinLabel'\)\}[^\n]*maxLength=\{6\} keyboardType="number-pad"[^\n]*autoFocus/, 'Reset PIN: the 6-digit PIN box in the sheet'],
  ];
  for (const [f, re, label] of app) check(re.test(read(APP, f)), `app ${f}: ${label}`);
  const site: [string, RegExp, string][] = [
    ['auth/SignIn.tsx', /<SecretField id="si-password" autoComplete="current-password"/, 'Sign in: the password'],
    ['auth/SetPassword.tsx', /<SecretField id="sp-1" autoComplete="new-password"[\s\S]*<SecretField id="sp-2" autoComplete="new-password"/, 'Choose a password: both boxes'],
    ['screens/DriverForm.tsx', /<SecretField kind="pin" id="nd-pin" maxLength=\{6\} inputMode="numeric" autoComplete="off" className="mono"/, 'Add driver: the 6-digit PIN'],
    ['screens/DriverManage.tsx', /<SecretField kind="pin" maxLength=\{6\} inputMode="numeric" autoComplete="off" className="mono"[^\n]*aria-label="New 6-digit PIN"/, 'the driver page: New PIN'],
  ];
  for (const [f, re, label] of site) check(re.test(read(SITE, f)), `site ${f}: ${label}`);
  const login = read(APP, 'app/login.tsx');
  check(!/showPassword|EyeOff|styles\.eye/.test(login), 'the sign-in page has no eye of its own any more');
}

console.log('\nThe components');
{
  const app = read(APP, 'components/SecretInput.tsx');
  check(/Material's password field with the visibility toggle/.test(app) && /accessibilityRole="button"/.test(app) && /accessibilityLabel=\{t\(shown \? words\.hide : words\.show\)\}/.test(app) && /secureTextEntry=\{!shown\}/.test(app) && /useState\(false\)/.test(app),
    'the app: the pattern named, a button with its label, secureTextEntry until pressed, hidden by default');
  check(/from '@\/components\/icons'/.test(app) && /<EyeOff /.test(app) && /<Eye /.test(app), 'the app: lucide\'s eye / eye-off through components/icons');
  const site = read(SITE, 'ui/SecretField.tsx');
  check(/Material's password field with the visibility toggle/.test(site) && /aria-pressed=\{shown\}/.test(site) && /type=\{shown \? "text" : "password"\}/.test(site) && /type="button"/.test(site) && /useState\(false\)/.test(site),
    'the site: the pattern named, type password ↔ text, aria-pressed, a real button, hidden by default');
  check(/"Show password"[\s\S]*"Hide password"[\s\S]*"Show PIN"[\s\S]*"Hide PIN"/.test(site), 'the site: the four words');
  const icons = read(SITE, 'ui/icons.tsx');
  check(/\n  eye: '/.test(icons) && /\n  eye_off: '/.test(icons), 'the site\'s icon set has eye and eye_off');
  const css = read(SITE, 'styles.css');
  check(/\.secret-eye \{[^\n]*position: absolute[^\n]*right: 2px/.test(css) && /\.secret > input \{ padding-right: 48px \}/.test(css), 'the site: the eye inside the field at the right, room for it');
}

console.log('\nThe words in both languages');
{
  const en = JSON.parse(read(APP, 'i18n/en.json')) as { common: Record<string, string>; office: { login: Record<string, string> } };
  const si = JSON.parse(read(APP, 'i18n/si.json')) as { common: Record<string, string>; office: { login: Record<string, string> } };
  const keys = ['showPassword', 'hidePassword', 'showPin', 'hidePin'];
  check(keys.every((k) => typeof en.common[k] === 'string' && en.common[k].trim() !== ''), 'common.showPassword / hidePassword / showPin / hidePin in English', keys.map((k) => en.common[k]));
  check(keys.every((k) => typeof si.common[k] === 'string' && si.common[k].trim() !== '' && si.common[k] !== en.common[k]), 'the same four in Sinhala, translated', keys.map((k) => si.common[k]));
  check(en.common.showPassword === 'Show password' && en.common.hidePassword === 'Hide password' && en.common.showPin === 'Show PIN' && en.common.hidePin === 'Hide PIN', 'the English words are Material\'s');
  check(keys.every((k) => !/[෦-෯]/.test(si.common[k])) && si.common.showPin.includes('PIN') && si.common.hidePin.includes('PIN'), 'Sinhala says PIN in Latin letters, no Sinhala digits');
  check(!('showPassword' in en.office.login) && !('hidePassword' in si.office.login), 'the sign-in page\'s own two keys are gone (the component says common.*)');
  const comp = read(APP, 'components/SecretInput.tsx');
  check(keys.every((k) => comp.includes(`'common.${k}'`)), 'the component says exactly those keys');
}

console.log('\nThe error reports carry no field value');
{
  const crash = read(APP, 'lib/crashLogic.ts');
  const body = crash.slice(crash.indexOf('export function reportBody'));
  check(/message: d\.message, stack: d\.stack\.join/.test(body) && !/value|password|pin\b/i.test(body.slice(0, body.indexOf('}'))), 'the app: reportBody sends message, screen and stack, never a field');
  const site = read(SITE, 'transport/report.ts');
  check(/message: r\.message\.slice\(0, 600\)/.test(site) && !/value|password/i.test(site.slice(site.indexOf('return {'), site.indexOf('};'))), 'the site: reportBody sends message, screen and the build, never a field');
  check(!/console\.(log|warn|error)\(/.test(read(APP, 'components/SecretInput.tsx')) && !/console\./.test(read(SITE, 'ui/SecretField.tsx')), 'neither component logs anything');
}

console.log(failures ? `\n${failures} FAILED\n` : '\nAll passed\n');
process.exit(failures ? 1 : 0);
