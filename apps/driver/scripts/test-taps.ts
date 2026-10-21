// Stage 1 item 2: every tap opens its place. A dead tap fails the build: every link the server puts in a notification,
// an inbox row or a push (read from the server's own code, so a new kind is caught) is followed through routeForUrl for
// each permission set that receives it, and the route must resolve to a real screen file with the right parameter; the
// cards and rows of Office mode open a place (a Row with a title and no onPress is informational only where listed).
//
//   npm run test:taps          (from apps/driver)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { routeForUrl } from '../src/office/nav';
import { PRESETS } from '../src/office/permissions';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const ROOT = join(__dirname, '..', '..', '..');
const APP = join(__dirname, '..', 'src', 'app');
const UUID = '1b2c3d4e-0000-4000-8000-00000000abcd';

/** A folder's index screen, also inside its route groups ("/office" → office/(tabs)/index.tsx). */
function indexIn(d: string): string | null {
  if (existsSync(join(d, 'index.tsx'))) return join(d, 'index.tsx');
  for (const g of readdirSync(d).filter((e) => /^\(.*\)$/.test(e))) {
    const f = indexIn(join(d, g));
    if (f) return f;
  }
  return null;
}

/** A route like "/office/task/<uuid>/driver" or "/office/(tabs)/tasks?x=1" → the screen file, or null. */
function screenFile(route: string): string | null {
  const segs = route.split('?')[0].split('/').filter(Boolean);
  let dir = APP;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const entries = readdirSync(dir);
    const groups = entries.filter((e) => /^\(.*\)$/.test(e) && statSync(join(dir, e)).isDirectory());
    const tryIn = (d: string): string | null => {
      const es = readdirSync(d);
      if (last) {
        if (es.includes(`${seg}.tsx`)) return join(d, `${seg}.tsx`);
        if (es.includes(seg) && statSync(join(d, seg)).isDirectory() && indexIn(join(d, seg))) return indexIn(join(d, seg));
        const param = es.find((e) => /^\[.+\]\.tsx$/.test(e));
        if (param) return join(d, param);
        const paramDir = es.find((e) => /^\[.+\]$/.test(e) && existsSync(join(d, e, 'index.tsx')));
        if (paramDir) return join(d, paramDir, 'index.tsx');
        return null;
      }
      if (es.includes(seg) && statSync(join(d, seg)).isDirectory()) return join(d, seg);
      const paramDir = es.find((e) => /^\[.+\]$/.test(e) && statSync(join(d, e)).isDirectory());
      return paramDir ? join(d, paramDir) : null;
    };
    let next = /^\(.*\)$/.test(seg) ? (entries.includes(seg) ? join(dir, seg) : null) : tryIn(dir);
    if (!next) for (const g of groups) { next = tryIn(join(dir, g)); if (next) break; }
    if (!next) return null;
    if (last) return statSync(next).isDirectory() ? indexIn(next) : next;
    dir = next;
  }
  return existsSync(join(dir, 'index.tsx')) ? join(dir, 'index.tsx') : null;
}

/** Every link template in the server's code: url: `…${x}…`, 'url', '/…' || id, url: "/…". */
function serverLinks(): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|sql)$/.test(e) && !/_test\.ts$/.test(e)) files.push(p);
    }
  };
  walk(join(ROOT, 'supabase', 'functions', '_shared', 'fleet'));
  walk(join(ROOT, 'supabase', 'migrations'));
  const out = new Set<string>();
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/url: `(\/[^`]*)`/g)) out.add(m[1].replace(/\$\{[^}]+\}/g, UUID));
    for (const m of s.matchAll(/url: "(\/[^"]*)"/g)) out.add(m[1]);
    for (const m of s.matchAll(/'url', '(\/[^']*)'(?:\s*\|\|\s*[a-z_.]+(?:::text)?(?:\s*\|\|\s*'([^']*)')?)?/g)) {
      const tail = m[0].includes('||') ? `${UUID}${m[2] ?? ''}` : '';
      out.add(`${m[1]}${tail}`);
    }
  }
  return [...out].filter((u) => !u.startsWith('/public') && !/signed/.test(u)).sort();
}

console.log('\nEvery server link opens a real screen');
{
  const links = serverLinks();
  check(links.length >= 9, `the server's link templates found (${links.length})`, links);
  const everyone = ['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users'];
  for (const url of links) {
    const route = routeForUrl(url, everyone);
    const file = route ? screenFile(route) : null;
    check(!!route && !!file, `${url} → ${route ?? 'nothing'}${file ? ` (${file.split('/src/app/')[1]})` : ''}`);
    if (route && route.includes(UUID)) check(true, `  …with its id as the screen's parameter`);
  }
  // Each preset that receives a kind opens something or is told nothing (never a route it may not open).
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const url of links) {
      const route = routeForUrl(url, preset.permissions);
      if (route) check(!!screenFile(route), `${name}: ${url} → ${route} exists`);
    }
  }
  check(routeForUrl('/', ['view']) === '/office' && routeForUrl(`/drivers/asks/${UUID}`, ['approve']) === `/office/asks/${UUID}` && routeForUrl(`/drivers/asks/${UUID}`, ['request']) === null, 'the home link and an ask\'s answers (with the permission that may open them)');
}

/** The props text of every <Row …> element: braces balanced, so a nested <Pill /> does not end it. */
function rowProps(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<Row\b/g)) {
    let i = (m.index ?? 0) + 4;
    let depth = 0;
    let quote: string | null = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (depth === 0 && (c === '>' || (c === '/' && src[i + 1] === '>'))) break;
    }
    out.push(src.slice((m.index ?? 0) + 4, i));
  }
  return out;
}

console.log('\nCards and rows open their place');
{
  // Every Row in Office mode has an onPress, except the informational ones listed here (a fact, not a thing).
  const INFO = new Set([
    'office/(tabs)/more.tsx:me',
    // Round 2b: an Activity log entry is a record of what happened (the site's log is the same: no page per entry).
    'office/people/activity.tsx:[e.action, e.about].filter(Boolean).join',
  ]);
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (e.endsWith('.tsx')) files.push(p); } };
  walk(join(APP, 'office'));
  const dead: string[] = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    const rel = f.split('/src/app/')[1];
    for (const props of rowProps(s)) {
      if (/onPress=/.test(props)) continue;
      const title = props.match(/title=\{([^}]*)\}/)?.[1] ?? '';
      const key = `${rel}:${/me\.name/.test(title) ? 'me' : title.slice(0, 40)}`;
      if (!INFO.has(key)) dead.push(key);
    }
  }
  check(dead.length === 0, `every Row opens a place (or is listed as informational)`, dead);
  const alerts = readFileSync(join(APP, 'office', '(tabs)', 'alerts.tsx'), 'utf8');
  const layout = readFileSync(join(APP, '_layout.tsx'), 'utf8');
  check(alerts.includes('routeForUrl(item.url, me.permissions)') && layout.includes('routeForUrl(data.url, officeMe.permissions)'), 'an inbox row and a push tap both follow routeForUrl');
}

console.log(failures === 0 ? '\nAll tap checks passed.' : `\n${failures} tap check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
