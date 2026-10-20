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
//     runtime <version>-gmaps (1.3.0-gmaps) and Google's map as the task map's
//     first engine; off (unset) the runtime <version> and only the free map
//     (OpenFreeMap; both engines are in every build since 1.3.0,
//     components/TaskMap.tsx). An update made with the switch on never reaches a
//     phone built with it off (Google's map has no key there).
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
// The drivers build (Phase 7, Part 6; docs/phase7-plan.md §27): the EAS profiles drivers and store (or
// FAME_LEAN_BUILD=1 for the local test build) leave out the dev client's plugin and add plugins/withLeanAndroid.js.
// MapLibre stays: every build has both maps (components/TaskMap.tsx). Their autolinking exclusions are written by scripts/lean-build.mjs.

// The mobile website (Phase 8, O4; docs/mobile-website.md): FLEET_WEB=1 (npm run web:export) builds Office mode for the
// browser from this same app: the web platform, a single-page output served under /m/ on the office site, and its own
// routes folder src/web-app (Expo Router's `root`), which holds only Office mode and the office sign-in: the driver's
// side is never in the web build. Without the switch nothing here changes (the Android app, its updates, its runtime).

import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LEAN_PROFILES = ['drivers', 'store'];

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
  const web = process.env.FLEET_WEB === '1';
  const leftOut = lean ? ['expo-dev-client'] : [];
  const plugins = lean
    ? [...(config.plugins ?? []).filter((p) => !leftOut.includes(pluginName(p))), './plugins/withLeanAndroid']
    : config.plugins;
  return {
    ...config,
    plugins,
    name: config.name ?? 'Fame Fleet',
    slug: config.slug ?? 'fame-driver',
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      // Expo's own setting (manifest meta-data com.google.android.geo.API_KEY); unlike a plugin's
      // options it is left out of the public config, so it is not in the update manifests.
      ...(mapsOn && mapsKey ? { config: { ...config.android?.config, googleMaps: { apiKey: mapsKey } } } : {}),
    },
    ...(mapsOn ? { runtimeVersion: `${config.version}-gmaps` } : {}),
    ...(web
      ? {
        platforms: ['web'],
        web: { ...config.web, bundler: 'metro', output: 'single', name: 'Fame Fleet', shortName: 'Fame Fleet', themeColor: '#15181c', backgroundColor: '#f3f2ee' },
        experiments: { ...config.experiments, baseUrl: '/m' },
      }
      : {}),
    extra: { ...config.extra, googleMapsAndroid: mapsOn, ...(web ? { router: { ...(config.extra?.router as object | undefined), root: 'src/web-app' } } : {}) },
  };
};
