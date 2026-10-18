// The drivers build (Phase 7, Part 6; docs/phase7-plan.md §27) leaves out of autolinking what a driver's phone never uses:
//   - the dev client (expo-dev-client, expo-dev-launcher, expo-dev-menu): the development build keeps it; its launcher
//     also brought ML Kit's barcode scanner (libbarhopper and its models) into every build;
//   - MapLibre, when the build has the Google map (GOOGLE_ANDROID_MAPS=on): the task map is Google's, and the OpenFreeMap
//     map's module is required only without it (components/TaskMap.tsx). A build with the switch off keeps MapLibre.
// Expo's autolinking reads its exclusions only from package.json (expo.autolinking.exclude), so this writes them there,
// for the drivers profiles only. EAS runs it as the package.json script "eas-build-pre-install"; on the laptop the local
// test build runs it with FAME_LEAN_BUILD=1. Any other build: it changes nothing.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEAN_PROFILES = ['drivers', 'drivers-32'];
const DEV_CLIENT = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'];
const MAPLIBRE = '@maplibre/maplibre-react-native';

/** The modules a build leaves out (empty for every build but the drivers ones). Pure. */
export function leanExclusions(env) {
  const lean = LEAN_PROFILES.includes(env.EAS_BUILD_PROFILE ?? '') || env.FAME_LEAN_BUILD === '1';
  if (!lean) return [];
  return [...DEV_CLIENT, ...(env.GOOGLE_ANDROID_MAPS?.trim() === 'on' ? [MAPLIBRE] : [])];
}

const main = () => {
  const out = leanExclusions(process.env);
  if (out.length === 0) {
    console.log('lean-build: not a drivers build, package.json unchanged');
    return;
  }
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.expo = { ...pkg.expo, autolinking: { ...pkg.expo?.autolinking, exclude: out } };
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`lean-build: autolinking leaves out ${out.join(', ')}`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
