#!/usr/bin/env node
// After the mobile website's export (npm run web:export; 21 October 2026): the files Expo takes from packages (the app's
// fonts, expo-router's images) are under <out>/assets/node_modules/, and Cloudflare Pages' upload (wrangler) leaves every
// node_modules folder out: the fonts were never online, and the site's catch-all answered them with its HTML page. They
// move to <out>/assets/vendor/ and the bundle's addresses follow. Run on the export's folder:
//
//   node scripts/web-vendor-assets.mjs dist-web
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out || !existsSync(out)) {
  console.error('Usage: node scripts/web-vendor-assets.mjs <the export folder>');
  process.exit(2);
}
const from = join(out, 'assets', 'node_modules');
const to = join(out, 'assets', 'vendor');
if (existsSync(from)) renameSync(from, to);

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
let changed = 0;
for (const file of walk(out).filter((f) => /\.(js|css|html|json)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('/assets/node_modules/')) continue;
  writeFileSync(file, text.split('/assets/node_modules/').join('/assets/vendor/'));
  changed += 1;
}
const left = walk(out).filter((f) => f.split('/').includes('node_modules'));
if (left.length) {
  console.error(`node_modules is still in the export: ${left.slice(0, 3).join(', ')}`);
  process.exit(1);
}
console.log(`assets/vendor: ${existsSync(to) ? walk(to).length : 0} files, ${changed} file(s) pointed at it`);
