// Config plugin for the drivers build (Phase 7, Part 6; docs/phase7-plan.md §27): what a driver's phone never uses stays
// out of the APK. Added by app.config.ts only for the drivers profiles (FAME_LEAN_BUILD or EAS_BUILD_PROFILE drivers…);
// the development and preview builds are as before.
//
// - BouncyCastle's post-quantum "Picnic" tables (about 1.2 MB of resources) come with expo-updates' code signing, which
//   never uses them (it checks RSA and ECDSA signatures): left out of the packaging.
// - R8 is told that ML Kit's barcode scanner is missing on purpose: expo-camera, built from source for this build
//   (scripts/lean-build.mjs), leaves it out (app.json barcodeScannerEnabled false) and checks for it before any scan.
// - The notification sounds (app.json, expo-notifications' sounds) are kept by name: a channel names its sound, no code
//   does, so the resource shrinker would drop some of them (the first local build lost new_task and general).
// The rest of the lean build is not here: the dev client (with its ML Kit barcode scanner) and, in the Google-map build,
// MapLibre are left out of autolinking by scripts/lean-build.mjs; arm64 only and R8 are the drivers profile's Gradle
// flags in eas.json.

const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, extname, join } = require('node:path');

const MARK = '// [fame-driver] Part 6: the drivers build';

const BLOCK = `
${MARK}
// Added by plugins/withLeanAndroid.js.
android {
  packagingOptions {
    resources {
      excludes += ['org/bouncycastle/pqc/**']
    }
  }
}
`;

const R8_RULES = `
${MARK}
# Added by plugins/withLeanAndroid.js: expo-camera's barcode scanning is left out of this build.
-dontwarn com.google.mlkit.vision.barcode.**
-dontwarn com.google.mlkit.vision.codescanner.**
`;

/** The raw resource names of the notification sounds app.json lists ("./assets/sounds/new_task.wav" → "new_task"). */
function soundNames(config) {
  const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
  const sounds = (Array.isArray(entry) && entry[1]?.sounds) || [];
  return sounds.map((f) => basename(f, extname(f)));
}

const keepXml = (names) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!-- Added by plugins/withLeanAndroid.js: the notification channels' sounds, named only by the channels. -->
<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="${names.map((n) => `@raw/${n}`).join(',')}" />
`;

module.exports = function withLeanAndroid(config) {
  const sounds = soundNames(config);
  config = withAppBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== 'groovy') {
      throw new Error('withLeanAndroid expects android/app/build.gradle to be a Groovy file.');
    }
    if (!gradle.modResults.contents.includes(MARK)) gradle.modResults.contents += BLOCK;
    return gradle;
  });
  return withDangerousMod(config, [
    'android',
    (c) => {
      const file = join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const now = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (!now.includes(MARK)) writeFileSync(file, now + R8_RULES);
      // Its own name: React Native's bundled-assets keep file is raw/keep.
      const raw = join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      mkdirSync(raw, { recursive: true });
      if (sounds.length > 0) writeFileSync(join(raw, 'fame_sounds_keep.xml'), keepXml(sounds));
      return c;
    },
  ]);
};

module.exports.soundNames = soundNames;
