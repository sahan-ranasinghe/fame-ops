# Release 1.4.0: the native changes collected for one EAS build

Every change the app needs that JavaScript alone cannot deliver (a new native module, a native version bump, a config
plugin), collected here so they go out as **one** EAS build of the `drivers` profile later, after Sahan's go and on
office or home Wi-Fi (CLAUDE.md: no local native builds; 15 Android builds a month on the free plan; one build per
native change, never a build to try something). **Nothing here is built yet.** Until 1.4.0 every phone stays on the
`1.3.0-gmaps` runtime and gets JavaScript through EAS Update; the JavaScript fallbacks below stay in place.

Collected 20 October 2026 (Stage 1 item 7).

## 1. The native date and time pickers

- **Need:** the system date and time wheels (Material 3 on Android) for the time sheet and the calendar
  (`docs/ui-patterns.md` §2–§4).
- **Module:** `@react-native-community/datetimepicker` (the SDK 57 version from `npx expo install`).
- **Until then:** the JavaScript sheets in `components/patterns/TimeField.tsx` (5-minute list, Now, the common times)
  and `components/patterns/Calendar.tsx`. These keep working after 1.4.0. The build may add a "wheel" option to the time
  sheet; the calendar stays (the range pattern needs it).
- **Check after the build:** the time sheet's tests (`test:patterns`), a pick on the phone in both languages.

## 2. An in-app video player (the fuel videos)

- **Need:** the fuel fill's video pieces played in the app, with the checklist bookmarks (the site's `/fuel/:id`).
- **Module:** `expo-video` (SDK 57).
- **Until then:** Stage 1 item 4 — the fill's 1-hour video link opens in the phone's browser.
- **Check after the build:** a fill with two pieces plays one after the other; a bookmark jumps to its second.

## 3. expo-doctor: 11 patch versions behind the SDK

`npx expo-doctor` (20 October 2026, 20 of 21 checks pass) wants these patch updates, all within SDK 57:

| Package | Installed | Expected |
|---|---|---|
| expo | 57.0.27 | ~57.0.30 |
| expo-asset | 57.0.19 | ~57.0.20 |
| expo-constants | 57.0.21 | ~57.0.22 |
| expo-crypto | 57.0.3 | ~57.0.4 |
| expo-dev-client | 57.0.19 | ~57.0.20 |
| expo-linking | 57.0.12 | ~57.0.13 |
| expo-location | 57.0.20 | ~57.0.21 |
| expo-notifications | 57.0.22 | ~57.0.23 |
| expo-router | 57.0.25 | ~57.0.28 |
| expo-splash-screen | 57.0.9 | ~57.0.10 |
| expo-updates | 57.0.25 | ~57.0.26 |

Several of these carry native code (expo-location, expo-notifications, expo-updates, expo-dev-client), so the updates go
in with 1.4.0, not through EAS Update (a JS bundle built against newer native modules than the installed APK can
crash). Do them together: `npx expo install --check`, then the full suite, `expo prebuild` into a scratch folder,
`npm run test:build`.

## 4. Anything else found so far

- **Photos and documents by camera** (Stage 1 item 5) need no new module: `expo-image-picker` and
  `expo-image-manipulator` are already in the 1.3.0 build. The work is the server's upload path (its own go).
- **The runtime version:** 1.4.0 becomes `1.4.0-gmaps` (the Google switch stays on). Phones on 1.3.0 keep their
  runtime's last update until they install 1.4.0; updates published after the build target 1.4.0 only (as at 1.3.0).
- **Store:** the `store` profile (.aab) is built from the same commit only when Sahan asks for a store release.

## The build, when Sahan says go

1. Count this month's builds (`eas build:list`) and say how many are left.
2. `npx expo install @react-native-community/datetimepicker expo-video` and `npx expo install --check` (the 11 patches).
3. The full suite; `expo prebuild` into a scratch folder (nothing committed); `expo-doctor` (21/21); `npm run test:build`.
4. Raise the version to 1.4.0 (`app.json`); the runtime follows.
5. `eas build --profile drivers --platform android --no-wait`; check with `eas build:view`.
6. Download the APK: its size, an arm64-v8a and an armeabi-v7a copy of every native library, 16 KB alignment, all six
   sounds.
7. Install on the test phone; then the update channel targets 1.4.0.
