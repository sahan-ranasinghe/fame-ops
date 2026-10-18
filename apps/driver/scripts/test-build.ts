// Part 6 (the 1.3.0 drivers build; docs/phase7-plan.md §27): the lean build's pieces, checked without building.
//   npm run test:build
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import appConfig from '../app.config';
import { leanAutolinking, leanExclusions } from './lean-build.mjs';

const here = __dirname;
let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const read = (path: string) => readFileSync(join(here, '..', path), 'utf8');

console.log('\n== Part 6: the drivers build ==');
const DEV = ['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'];
check(leanExclusions({}).length === 0 && leanExclusions({ EAS_BUILD_PROFILE: 'preview', GOOGLE_ANDROID_MAPS: 'on' }).length === 0,
  'the development and preview builds leave nothing out');
check(JSON.stringify(leanExclusions({ EAS_BUILD_PROFILE: 'drivers', GOOGLE_ANDROID_MAPS: 'on' })) === JSON.stringify([...DEV, '@maplibre/maplibre-react-native']),
  'drivers with the Google map: the dev client (and its barcode scanner) and MapLibre out', leanExclusions({ EAS_BUILD_PROFILE: 'drivers', GOOGLE_ANDROID_MAPS: 'on' }));
check(JSON.stringify(leanExclusions({ EAS_BUILD_PROFILE: 'drivers-32' })) === JSON.stringify(DEV),
  'drivers without the Google map keeps MapLibre (the OpenFreeMap task map)');
const linking = leanAutolinking({ EAS_BUILD_PROFILE: 'drivers', GOOGLE_ANDROID_MAPS: 'on' });
check(leanAutolinking({}) === null && JSON.stringify(linking?.android) === JSON.stringify({ buildFromSource: ['expo-camera'] }),
  'drivers builds expo-camera from source (its build.gradle leaves the barcode scanner out); other builds unchanged', linking);

const appJson = JSON.parse(read('app.json')) as { expo: Parameters<typeof appConfig>[0]['config'] };
const configFor = (env: Record<string, string>) => {
  const keep = { ...process.env };
  for (const k of ['EAS_BUILD_PROFILE', 'FAME_LEAN_BUILD', 'GOOGLE_ANDROID_MAPS', 'EAS_BUILD']) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return appConfig({ config: appJson.expo } as Parameters<typeof appConfig>[0]);
  } finally {
    process.env = keep;
  }
};
const camera = (appJson.expo.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-camera') as [string, { barcodeScannerEnabled?: boolean }] | undefined;
const leanPlugin = read('plugins/withLeanAndroid.js');
check(camera?.[1].barcodeScannerEnabled === false && /-dontwarn com\.google\.mlkit\.vision\.barcode\.\*\*/.test(leanPlugin)
  && /-dontwarn com\.google\.mlkit\.vision\.codescanner\.\*\*/.test(leanPlugin)
  && /R8_MARK = '#/.test(leanPlugin)
  && (leanPlugin.match(/const R8_RULES = `([\s\S]*?)`;/)?.[1] ?? '//').split('\n').every((l) => l === '' || /^(#|-|\$\{R8_MARK\})/.test(l)),
  'app.json turns the camera\'s barcode scanner off; withLeanAndroid tells R8 its classes are left out');
const { soundNames } = require('../plugins/withKeptSounds') as { soundNames: (c: unknown) => string[] };
const kept = read('plugins/withKeptSounds.js');
check(JSON.stringify(soundNames(appJson.expo)) === JSON.stringify(['new_task', 'task_changed', 'general', 'task_ring', 'task_update', 'office_ask'])
  && /fame_sounds_keep\.xml/.test(kept) && /tools:keep=/.test(kept),
  'every notification sound is kept through resource shrinking (raw/fame_sounds_keep.xml)', soundNames(appJson.expo));
const names = (c: ReturnType<typeof appConfig>) => (c.plugins ?? []).map((p) => (Array.isArray(p) ? String(p[0]) : String(p)));
const lean = configFor({ EAS_BUILD_PROFILE: 'drivers', GOOGLE_ANDROID_MAPS: 'on' });
const dev = configFor({});
check(!names(lean).includes('expo-dev-client') && !names(lean).includes('@maplibre/maplibre-react-native') && names(lean).at(-1) === './plugins/withLeanAndroid'
  && lean.runtimeVersion === '1.3.0-gmaps' && lean.version === '1.3.0',
  'the drivers config: no dev client or MapLibre plugin, withLeanAndroid added, runtime 1.3.0-gmaps', { plugins: names(lean), runtime: lean.runtimeVersion });
check(names(dev).includes('expo-dev-client') && names(dev).includes('@maplibre/maplibre-react-native') && !names(dev).includes('./plugins/withLeanAndroid'),
  'the development config is as before');
check(names(dev).includes('./plugins/withKeptSounds') && names(lean).includes('./plugins/withKeptSounds'),
  'every build keeps the notification sounds (a preview build from main too)');

const eas = JSON.parse(read('eas.json')) as { build: Record<string, { environment?: string; extends?: string; channel?: string; android?: { gradleCommand?: string } }> };
const drivers = eas.build.drivers;
check(drivers?.environment === 'preview' && drivers.channel === 'preview'
  && /-PreactNativeArchitectures=arm64-v8a /.test(drivers.android?.gradleCommand ?? '')
  && /enableMinifyInReleaseBuilds=true/.test(drivers.android?.gradleCommand ?? '') && /enableShrinkResourcesInReleaseBuilds=true/.test(drivers.android?.gradleCommand ?? ''),
  'the drivers profile: arm64-v8a only, R8 and resource shrinking, the preview environment and channel', drivers);
check(eas.build['drivers-32']?.extends === 'drivers' && /-PreactNativeArchitectures=armeabi-v7a /.test(eas.build['drivers-32']?.android?.gradleCommand ?? ''),
  'drivers-32: the same for a 32-bit phone, built only when asked');
const store = eas.build.store as typeof drivers & { distribution?: string; autoIncrement?: boolean; android?: { buildType?: string; gradleCommand?: string } };
check(store?.extends === 'drivers' && store.android?.buildType === 'app-bundle' && /^:app:bundleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a /.test(store.android?.gradleCommand ?? '')
  && store.autoIncrement === true && (drivers as { autoIncrement?: boolean }).autoIncrement === true
  && (JSON.parse(read('eas.json')) as { cli?: { appVersionSource?: string } }).cli?.appVersionSource === 'remote'
  && JSON.stringify(leanExclusions({ EAS_BUILD_PROFILE: 'store', GOOGLE_ANDROID_MAPS: 'on' })) === JSON.stringify([...DEV, '@maplibre/maplibre-react-native']),
  'store: an .aab with both ABIs (Play gives each phone its own), lean; EAS raises the version code at every drivers and store build');
check(/arm64-v8a,armeabi-v7a/.test(eas.build.preview?.android?.gradleCommand ?? '') && !eas.build.preview?.environment,
  'the preview profile is as it was (1.2.0)');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; expo?: { autolinking?: unknown } };
check(pkg.scripts['eas-build-pre-install'] === 'node scripts/lean-build.mjs' && !pkg.expo?.autolinking,
  'EAS runs lean-build before installing; the committed package.json leaves nothing out');

const taskMap = read('src/components/TaskMap.tsx');
const openMap = read('src/components/OpenTaskMap.tsx');
check(!/@maplibre\/maplibre-react-native/.test(taskMap) && /from '@maplibre\/maplibre-react-native'/.test(openMap)
  && /GOOGLE_MAP_BUILD\s*\n?\s*\?\s*null\s*\n?[\s\S]*require\('\.\/OpenTaskMap'\)/.test(taskMap),
  'MapLibre is imported only by OpenTaskMap.tsx, which TaskMap requires only without the Google map');
const layout = read('src/app/_layout.tsx');
check(!/GemunuLibre_700Bold|NotoSansSinhala/.test(layout), 'the two fonts no screen uses are not loaded');

console.log('\n== Part 6 additions: store readiness ==');
check(appJson.expo.name === 'Fame Fleet' && (appJson.expo as { android?: { package?: string } }).android?.package === 'com.fameglobal.driver'
  && lean.name === 'Fame Fleet' && dev.name === 'Fame Fleet',
  'the app is "Fame Fleet"; the package stays com.fameglobal.driver');
const strings = { en: read('src/i18n/en.json'), si: read('src/i18n/si.json') };
check(!/Fame Driver/.test(strings.en) && !/Fame Driver/.test(strings.si), 'no string the driver sees says "Fame Driver" any more');
const pngSize = (path: string) => {
  const b = readFileSync(join(here, '..', path));
  return b.toString('ascii', 1, 4) === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
};
const sizes = Object.fromEntries(['assets/icon.png', 'assets/android-icon-foreground.png', 'assets/android-icon-monochrome.png', 'assets/splash-icon.png',
  'assets/notification-icon.png', 'store/play-icon-512.png', 'store/feature-graphic.png'].map((f) => [f, pngSize(f)?.join('x')]));
check(Object.values(sizes).join(' ') === '1024x1024 1024x1024 1024x1024 1024x1024 96x96 512x512 1024x500',
  'the icon, adaptive icon, splash, notification icon and the store\'s icon and feature graphic (scripts/make-icons.mjs)', sizes);
const permissionsScreen = read('src/app/permissions.tsx');
const askScreen = read('src/app/ask/[id].tsx');
check(/if \(!locationDisclosureAgreed\(me\?\.id\)\) \{\s*setDisclosure\(true\);\s*return;\s*\}\s*setAskedLocation\(true\);\s*await requestLocationPermissions\(\)/.test(permissionsScreen)
  && /!locationDisclosureAgreed\(app\.me\?\.id\)[\s\S]{0,160}setDisclosure\(true\);\s*return;[\s\S]{0,200}await oneFix\(\)/.test(askScreen),
  'Android\'s location question comes only after the disclosure\'s Agree (Permissions, "Where are you now?")');
const lookup = (json: string, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], JSON.parse(json));
const keys = ['disclosure.title', 'disclosure.body', 'disclosure.offDuty', 'disclosure.whoSees', 'disclosure.settings', 'disclosure.next',
  'disclosure.agree', 'disclosure.notNow', 'common.privacy', 'login.version'];
check(keys.every((k) => typeof lookup(strings.en, k) === 'string' && typeof lookup(strings.si, k) === 'string')
  && /even when the app is closed or not in use/.test(String(lookup(strings.en, 'disclosure.body'))),
  'the disclosure in en and si, with "even when the app is closed or not in use"');
check(/"privacyUrl": "https:\/\/fame-fleet\.pages\.dev\/privacy"/.test(read('app.json')) && /PRIVACY_URL/.test(read('src/app/login.tsx'))
  && /PRIVACY_URL/.test(read('src/app/(tabs)/me.tsx')) && /PRIVACY_URL/.test(read('src/components/LocationDisclosure.tsx')),
  'the privacy policy from sign-in, Me and the disclosure');

console.log(failed ? `\n${failed} build check(s) failed.` : '\nAll build checks passed.');
process.exit(failed ? 1 : 0);
