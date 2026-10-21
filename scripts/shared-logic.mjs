#!/usr/bin/env node
// The trip rules both office front ends follow (Part B, Sahan 22 October 2026: "one shared source, or a test that fails
// when they differ"). The site's files are the source; Office mode (the app and /m/) keeps a copy of each, written by
// this script with only the import paths changed (the app has no bundler path into the site). Edit the site's file, then:
//
//   node scripts/shared-logic.mjs --write   copy every site file to its app place
//   node scripts/shared-logic.mjs --check   fail when an app copy is not what --write would write (CI: the app's
//                                           test:shared-logic and the site's src/sharedLogic.test.ts)
//
// What is not shared stays apart: the words (the site's English on its screens; the app's i18n keys,
// apps/driver/src/office/trip/whoWords.ts and words.ts, which read the English sentences these rules return).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "apps/office/src";
const APP = "apps/driver/src/office/trip";

/** [the site's file, the app's copy, the import paths that differ (site → app)]. */
export const PAIRS = [
  ["lib/phones.ts", "phones.ts", {}],
  ["ui/whoDrivesLogic.ts", "whoDrivesLogic.ts", { "../data/types": "../types", "./driverRowLogic": "../text", "../lib/phones": "./phones" }],
  ["screens/stopsLogic.ts", "stopsLogic.ts", { "@fleet/durations": "./durations" }],
  ["screens/tripLogic.ts", "tripLogic.ts", { "../data/types": "../types" }],
  ["screens/vehicleChoiceLogic.ts", "vehicleChoiceLogic.ts", { "./availabilityLogic": "./format" }],
  ["screens/requestLogic.ts", "requestLogic.ts", { "../data/types": "../types", "../ui/whoDrivesLogic": "./whoDrivesLogic" }],
  ["screens/assignLogic.ts", "assignLogic.ts", { "../data/types": "../types", "../lib/format": "./format", "../ui/whoDrivesLogic": "./whoDrivesLogic" }],
];

/** The app's copy of a site file: a header naming the source, then the file with its import paths moved. */
export function appCopy(sitePath, rewrites, source) {
  const header =
    `// Office mode: a copy of ${SITE}/${sitePath}, written by scripts/shared-logic.mjs --write. Never edit it here: edit\n` +
    "// the site's file and run the script (the app's test:shared-logic and the site's sharedLogic test fail until you do).\n\n";
  const body = source.replace(/(from\s+)(["'])([^"']+)\2/g, (whole, from, q, spec) => (spec in rewrites ? `${from}${q}${rewrites[spec]}${q}` : whole));
  for (const spec of Object.keys(rewrites)) {
    if (!source.includes(`"${spec}"`) && !source.includes(`'${spec}'`)) throw new Error(`${sitePath}: no import from ${spec} any more; update PAIRS`);
  }
  return header + body;
}

/** The pairs whose app copy differs from the site's file (an empty list = all the same). */
export function differing() {
  const out = [];
  for (const [site, app, rewrites] of PAIRS) {
    const want = appCopy(site, rewrites, readFileSync(join(ROOT, SITE, site), "utf8"));
    let have = "";
    try {
      have = readFileSync(join(ROOT, APP, app), "utf8");
    } catch {
      /* missing: differs */
    }
    if (have !== want) out.push({ site: `${SITE}/${site}`, app: `${APP}/${app}`, want, have });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  if (mode === "--write") {
    for (const [site, app, rewrites] of PAIRS) writeFileSync(join(ROOT, APP, app), appCopy(site, rewrites, readFileSync(join(ROOT, SITE, site), "utf8")));
    console.log(`wrote ${PAIRS.length} app copies`);
  } else if (mode === "--check") {
    const bad = differing();
    for (const d of bad) {
      const a = d.want.split("\n"), b = d.have.split("\n");
      const i = a.findIndex((line, n) => line !== b[n]);
      console.log(`  FAIL  ${d.app} is not ${d.site} (first difference at line ${i + 1}:\n          site: ${a[i] ?? "(end)"}\n          app:  ${b[i] ?? "(end)"})`);
    }
    if (bad.length) {
      console.log(`${bad.length} of ${PAIRS.length} copies differ: edit the site's file, then run node scripts/shared-logic.mjs --write.`);
      process.exit(1);
    }
    console.log(`  PASS  the ${PAIRS.length} trip-rule files are the same in the site and Office mode`);
  } else {
    console.log("usage: node scripts/shared-logic.mjs --write | --check");
    process.exit(2);
  }
}
