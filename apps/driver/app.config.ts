// The app config is app.json plus the parts that depend on the machine the
// build runs on. At the moment that is only the Firebase file for push
// notifications (google-services.json):
//
//   - on an EAS build worker it comes from the file environment variable
//     GOOGLE_SERVICES_JSON (eas env:set ... --type file), whose value is the
//     path of the file on the worker;
//   - on the laptop (expo prebuild, expo run) the local copy next to this
//     file is used. It is not committed (.gitignore).
//
// A build without the file still builds; push notifications then do not work.
//
// The task map's Google map (Phase 6, Part 5), two EAS environment variables:
//
//   - GOOGLE_ANDROID_MAPS=on (plain text): the switch. Read the same on the
//     laptop (eas build, eas update --environment) and on the EAS worker, so the
//     runtime version and extra.googleMapsAndroid agree everywhere: on gives the
//     runtime 1.2.0-gmaps and the Google task map; off (unset) the runtime 1.2.0
//     and the OpenFreeMap map. An update made with the switch on never reaches a
//     phone built with it off (the Google map would crash there for want of a key).
//   - GOOGLE_ANDROID_MAPS_KEY (secret, never in git, readable only on EAS's build
//     workers): the key, restricted in the Google Cloud console to the package
//     com.fameglobal.driver and the signing key's SHA-1, written into the
//     manifest (android.config.googleMaps: com.google.android.geo.API_KEY). An
//     EAS build with the switch on and no key stops here, rather than make an app
//     whose map would crash.
//
// (The first try, 15 October 2026, took the switch from the secret itself: the
// laptop could not read it, worked out 1.2.0 against EAS's 1.2.0-gmaps, and EAS
// stopped the build on the mismatch.)

//
// The drivers build (Phase 7, Part 6; docs/phase7-plan.md §27): the EAS profiles drivers and drivers-32 (or
// FAME_LEAN_BUILD=1 for the local test build) leave out the dev client's plugin and, with the Google map, MapLibre's,
// and add plugins/withLeanAndroid.js. Their autolinking exclusions are written by scripts/lean-build.mjs.

import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LEAN_PROFILES = ['drivers', 'drivers-32'];

/** A plugin entry's name ("expo-dev-client" or ["expo-camera", {…}]). */
const pluginName = (p: unknown): string => (Array.isArray(p) ? String(p[0]) : String(p));

export default ({ config }: ConfigContext): ExpoConfig => {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON?.trim();
  const local = join(__dirname, 'google-services.json');
  const googleServicesFile = fromEnv && fromEnv !== '' ? fromEnv : existsSync(local) ? './google-services.json' : undefined;
  const mapsOn = process.env.GOOGLE_ANDROID_MAPS?.trim() === 'on';
  const mapsKey = process.env.GOOGLE_ANDROID_MAPS_KEY?.trim() || undefined;
  if (mapsOn && process.env.EAS_BUILD === 'true' && !mapsKey) {
    throw new Error('GOOGLE_ANDROID_MAPS is on but this EAS build has no GOOGLE_ANDROID_MAPS_KEY: set the secret in its environment');
  }
  const lean = LEAN_PROFILES.includes(process.env.EAS_BUILD_PROFILE ?? '') || process.env.FAME_LEAN_BUILD === '1';
  if (lean && process.env.EAS_BUILD === 'true') {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')) as { expo?: { autolinking?: { exclude?: string[] } } };
    if (!pkg.expo?.autolinking?.exclude?.length) {
      throw new Error('A drivers build without scripts/lean-build.mjs\'s exclusions in package.json: eas-build-pre-install did not run');
    }
  }
  const leftOut = lean ? ['expo-dev-client', ...(mapsOn ? ['@maplibre/maplibre-react-native'] : [])] : [];
  const plugins = lean
    ? [...(config.plugins ?? []).filter((p) => !leftOut.includes(pluginName(p))), './plugins/withLeanAndroid']
    : config.plugins;
  return {
    ...config,
    plugins,
    name: config.name ?? 'Fame Driver',
    slug: config.slug ?? 'fame-driver',
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      // Expo's own setting (manifest meta-data com.google.android.geo.API_KEY); unlike a plugin's
      // options it is left out of the public config, so it is not in the update manifests.
      ...(mapsOn && mapsKey ? { config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } } } : {}),
    },
    ...(mapsOn ? { runtimeVersion: `${config.version}-gmaps` } : {}),
    extra: { ...config.extra, googleMapsAndroid: mapsOn },
  };
};
