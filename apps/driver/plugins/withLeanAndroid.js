// Config plugin for the drivers build (Phase 7, Part 6; docs/phase7-plan.md §27): what a driver's phone never uses stays
// out of the APK. Added by app.config.ts only for the drivers profiles (FAME_LEAN_BUILD or EAS_BUILD_PROFILE drivers…);
// the development and preview builds are as before.
//
// - BouncyCastle's post-quantum "Picnic" tables (about 1.2 MB of resources) come with expo-updates' code signing, which
//   never uses them (it checks RSA and ECDSA signatures): left out of the packaging.
// The rest of the lean build is not here: the dev client (with its ML Kit barcode scanner) and, in the Google-map build,
// MapLibre are left out of autolinking by scripts/lean-build.mjs; arm64 only and R8 are the drivers profile's Gradle
// flags in eas.json.

const { withAppBuildGradle } = require('expo/config-plugins');

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

module.exports = function withLeanAndroid(config) {
  return withAppBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== 'groovy') {
      throw new Error('withLeanAndroid expects android/app/build.gradle to be a Groovy file.');
    }
    if (!gradle.modResults.contents.includes(MARK)) gradle.modResults.contents += BLOCK;
    return gradle;
  });
};
