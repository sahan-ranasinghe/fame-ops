// The drivers build (Phase 7, Part 6; docs/phase7-plan.md §27) leaves out of autolinking what a driver's phone never uses:
//   - the dev client (expo-dev-client, expo-dev-launcher, expo-dev-menu): the development build keeps it; its launcher
//     also brings ML Kit's barcode scanner (libbarhopper and its models);
// and it builds expo-camera from its source: Expo links it as a ready-made library whose dependencies always include ML Kit's
// barcode scanner (libbarhopper, 4.9 MB, and its models); only its own build.gradle reads app.json's
// barcodeScannerEnabled false and leaves the scanner out (the camera then answers "not available" if ever asked to scan;
// plugins/withLeanAndroid.js tells R8 the scanner's classes are missing on purpose).
// MapLibre stays in every build (Sahan, 19 October: both maps on every phone, components/TaskMap.tsx), and so do both ABIs.
// Expo's autolinking reads these only from package.json (expo.autolinking), so this writes them there, for the drivers
// and store profiles only. EAS runs it as the package.json script "eas-build-pre-install"; on the laptop the local
// test build runs it with FAME_LEAN_BUILD=1. Any other build: it changes nothing.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEAN_PROFILES = ['drivers', 'store'];
const DEV_CLIENT = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'];
const FROM_SOURCE = ['expo-camera'];

/** The modules a build leaves out (empty for every build but the drivers ones). Pure. */
export function leanExclusions(env) {
  const lean = LEAN_PROFILES.includes(env.EAS_BUILD_PROFILE ?? '') || env.FAME_LEAN_BUILD === '1';
  if (!lean) return [];
  return [...DEV_CLIENT];
}

/** package.json's expo.autolinking for a build (null: leave it as committed). Pure. */
export function leanAutolinking(env, autolinking = {}) {
  const out = leanExclusions(env);
  if (out.length === 0) return null;
  return { ...autolinking, exclude: out, android: { ...autolinking.android, buildFromSource: FROM_SOURCE } };
}

const main = () => {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const autolinking = leanAutolinking(process.env, pkg.expo?.autolinking);
  if (!autolinking) {
    console.log('lean-build: not a drivers build, package.json unchanged');
    return;
  }
  pkg.expo = { ...pkg.expo, autolinking };
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`lean-build: autolinking leaves out ${autolinking.exclude.join(', ')}; builds ${FROM_SOURCE.join(', ')} from source`);
};

// Run as a script (a symlink in the path must not skip it: app.config.ts stops an EAS drivers build without the exclusions).
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) main();
