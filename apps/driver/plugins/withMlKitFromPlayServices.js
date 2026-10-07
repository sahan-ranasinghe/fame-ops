// Config plugin: lets a build use ML Kit's small "Google Play services" text
// recognition instead of the models bundled in the app.
//
// @react-native-ml-kit/text-recognition pulls in five bundled script models
// (Latin, Chinese, Devanagari, Japanese, Korean) for every CPU type. Google
// publishes the same API in an "unbundled" form: a small client in the app, and
// the model is downloaded once by Google Play services on the phone.
//
// The swap only happens when Gradle is run with
//   -Pfame.mlkitFromPlayServices=true
// which eas.json does for the preview profile. Without it (the development
// build) nothing changes.
//
// Trade-off: the very first reading on a phone may find nothing while Play
// services fetches the model (needs internet once). The driver always checks
// or types the number anyway, and the app asks for the model at start-up.

const { withProjectBuildGradle } = require('expo/config-plugins');

const MARK = '// [fame-driver] ML Kit text recognition from Google Play services';

const SWAPS = [
  ['com.google.mlkit:text-recognition', 'com.google.android.gms:play-services-mlkit-text-recognition:19.0.1'],
  ['com.google.mlkit:text-recognition-chinese', 'com.google.android.gms:play-services-mlkit-text-recognition-chinese:16.0.1'],
  ['com.google.mlkit:text-recognition-devanagari', 'com.google.android.gms:play-services-mlkit-text-recognition-devanagari:16.0.1'],
  ['com.google.mlkit:text-recognition-japanese', 'com.google.android.gms:play-services-mlkit-text-recognition-japanese:16.0.1'],
  ['com.google.mlkit:text-recognition-korean', 'com.google.android.gms:play-services-mlkit-text-recognition-korean:16.0.1'],
];

const BLOCK = `
${MARK}
// Added by plugins/withMlKitFromPlayServices.js. Active only with -Pfame.mlkitFromPlayServices=true.
if ((findProperty('fame.mlkitFromPlayServices') ?: 'false').toBoolean()) {
  allprojects {
    configurations.all {
      resolutionStrategy.dependencySubstitution {
${SWAPS.map(([from, to]) => `        substitute module('${from}') using module('${to}')`).join('\n')}
      }
    }
  }
}
`;

module.exports = function withMlKitFromPlayServices(config) {
  return withProjectBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== 'groovy') {
      throw new Error('withMlKitFromPlayServices expects android/build.gradle to be a Groovy file.');
    }
    if (!gradle.modResults.contents.includes(MARK)) gradle.modResults.contents += BLOCK;
    return gradle;
  });
};
