// Hotfix O2-H2: component tests (React Native Testing Library on jest-expo) for what the tsx test scripts cannot reach:
// a screen rendered through the router, from the press of its last button to the screen after success. `npm run
// test:components`. The office client answers from the real fixtures (src/office/__fixtures__, scripts/make-office-
// fixtures.py); maps are stubbed (both engines have their own source checks in test:maps).
module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: { '^lucide-react-native/icons/.*$': '<rootDir>/tests/iconStub.js', '^@/(.*)$': '<rootDir>/src/$1' },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|lucide-react-native|@maplibre/.*|react-native-maps|standard-navigation)',
  ],
  testTimeout: 30000,
};
