# Release 1.4.0: the native changes collected for one EAS build

Every change the app needs that JavaScript alone cannot deliver (a new native module, a native version bump, a config
plugin), collected here so they go out as **one** EAS build of the `drivers` profile later, after Sahan's go and on
office or home Wi-Fi (CLAUDE.md: no local native builds; 15 Android builds a month on the free plan; one build per
native change, never a build to try something). **Nothing here is built yet.** Until 1.4.0 every phone stays on the
`1.3.0-gmaps` runtime and gets JavaScript through EAS Update; the JavaScript fallbacks below stay in place.

Collected 20 October 2026 (Stage 1 item 7).

## Applied, 29 October 2026 (branch `release-1.4.0` from main `2e27b87`; not built)

Sahan's decisions at the prep: the build uses the **`drivers`** profile (as 1.3.0; the `preview` profile is the old 1.2.0
one: the dev client in a release APK, not lean, no version code raise) and the runtime stays **`1.4.0-gmaps`** (the
existing rule: `<version>-gmaps` with EAS's GOOGLE_ANDROID_MAPS on).

| # | Item | State |
|---|---|---|
| 1 | Native date and time pickers | Dropped (21 October): the time sheet is a JavaScript dial and the calendar stays JavaScript; `@react-native-community/datetimepicker` is not added |
| 2 | In-app fuel video player | Done: `expo-video` 57.0.5; `app/office/fuel-video.tsx` + `office/fuelPlayer.ts` (pieces one after another, the steps as bookmarks, the pieces to pick, "Open in the browser" kept); Reports → Fuel and a task's fills open it. expo-video's own config plugin (background playback, picture-in-picture) is not added: not needed |
| 3 | expo-doctor patches | Done: `npx expo install --fix` (12 by now: the 11 listed plus expo-network 57.0.3; expo 57.0.31, expo-router 57.0.29, expo-location 57.0.22, expo-notifications 57.0.24, expo-updates 57.0.26 …). expo-doctor 21/21 |
| 4 | expo-clipboard | Done: `expo-clipboard` 57.0.2; the crash screen's Copy puts the scrubbed details on the clipboard and says "Copied" for 2 s (no snackbar there: the crash screen needs no provider); Share (the 1.3.0 way) stays beside it |
| 5 | The office's own sounds | Done: `request_waiting.ogg` and `issue_critical.ogg` moved to `assets/sounds/`, listed in app.json (eight sounds, all kept by withKeptSounds); a 1.4.0 build makes `office-requests-2` / `office-issues-2` instead of the 1.3.0 pair and deletes the old two once the server has its token with the new ones (`replacedChannels`); notify-office prefers the `-2` ids (**deploy notify-office before the first 1.4.0 phone**: until then a 1.4.0 office phone's pushes would fall back to the driver channels' sounds) |
| 6 | Light only | Done: `userInterfaceStyle` "light" kept; `plugins/withLightOnly.js` sets `android:forceDarkAllowed="false"` on AppTheme (the prebuilt styles.xml carries it; `test:build` checks the plugin) |
| 7 | Version | 1.4.0 (app.json); runtime `1.4.0-gmaps`; the version code is EAS's (remote, 2 after 1.3.0): the drivers profile's autoIncrement makes it **3** at this build |

The Android permissions (prebuilt manifest of the drivers config, plus every native module's own manifest, compared with the
1.3.0 dependencies: the same 12 library permissions; expo-video adds INTERNET only, expo-clipboard none): ACCESS_COARSE_LOCATION,
ACCESS_FINE_LOCATION, ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, CAMERA, POST_NOTIFICATIONS,
REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, READ_EXTERNAL_STORAGE and WRITE_EXTERNAL_STORAGE (both up to Android 12, maxSdk 32),
INTERNET, VIBRATE, MODIFY_AUDIO_SETTINGS; removed as before (`tools:node="remove"`): RECORD_AUDIO, SYSTEM_ALERT_WINDOW,
USE_BIOMETRIC, USE_FINGERPRINT. Nothing new; RECORD_AUDIO stays out (the player only plays).

## 1. The native date and time pickers: dropped (21 October 2026)

Not needed any more. The time sheet is now a pure JavaScript clock (Material 3's time picker: a 24-hour dial with a
keyboard toggle, any minute; `components/patterns/TimeDial.tsx`, the math in `lib/patterns/dialLogic.ts`, the same file as
the site's `ui/dialLogic.ts`), and the calendar stays JavaScript (the range pattern needs it). So
`@react-native-community/datetimepicker` is not added in 1.4.0.

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

## 4. expo-clipboard (the crash screen's Copy)

- **Need:** "Show details → Copy" on the crash screen (Hotfix O2-H2, Part 1c) puts the details on the clipboard and says
  "Copied" in the snackbar (WhatsApp's "Message copied").
- **Module:** `expo-clipboard` (SDK 57).
- **Until then:** Copy opens Android's share sheet (`Share.share`, `components/patterns/CrashScreen.tsx`); it stays as
  "Share" beside Copy after the build.
- **Check after the build:** a crash screen's Copy, then a paste in WhatsApp shows the details (scrubbed).

## 5. Office sounds of their own (Sahan, 21 October 2026)

- **Need:** office pushes sound like the office's, not like a driver's task. 1.3.0 (an EAS update, 21 October) already
  gives them two office channels with the closest 1.3.0 sounds: `office-requests` "Requests and approvals"
  (`office_ask.ogg`) and `office-issues` "Issues" (`new_task.wav`), made only for an office person (`lib/channels.ts`), and
  notify-office sends on them once a phone registered them (`notify-office/expo.ts`).
- **Sounds:** two new files, original synthesised tones (pure sines with a sine envelope, no third-party audio), under 2 s,
  as loud as the six in 1.3.0 (mean about −10.5 dB): `request_waiting.ogg` (1.6 s, a bright rising C–E–G twice: decide this)
  and `issue_critical.ogg` (1.8 s, quick alternating high–low pulses twice: an alarm). Made by
  `apps/driver/scripts/make-sounds-1.4.0.sh` into `apps/driver/assets/sound-drafts/` (not in `app.json`: no build or update
  carries them yet). To ship: move them to `assets/sounds/`, list them in `app.json`'s expo-notifications sounds, and add
  them to the keep list (`plugins/withKeptSounds.js`, `test:build`): eight sounds.
- **Channels:** a channel's sound is fixed when it is first made, so new ids in 1.4.0: `office-requests-2`
  ("Requests and approvals", `request_waiting.ogg`) and `office-issues-2` ("Issues", `issue_critical.ogg`). At start-up a
  1.4.0 phone makes them and registers them; once the server has its token with them it deletes `office-requests` and
  `office-issues` (the same rule as the 1.2.0 channels: `replacedChannels`). notify-office prefers the `-2` ids, then the
  1.3.0 ones, then the driver channels.
- **Check after the build:** a request to approve and a critical issue each sound their own tone, in both languages'
  channel names; the APK has all eight sounds.

## 6. Light only, also when the phone is dark (Round 2b, 21 October 2026)

The app and /m/ are light on purpose for now (a proper dark theme is a later item: `docs/phase8-plan.md` §24).
- **What a phone in dark mode does today (1.3.0, from the code):** `app.json` already has `"userInterfaceStyle": "light"`
  and expo-system-ui is installed, so the prebuilt Android theme is the light one and React Native's `Appearance` always
  answers light; nothing in the app reads `useColorScheme`, and every colour comes from `theme.ts`. So the system's own
  dark theme does not change the app. What can still darken it is **force dark**: Android 10+ can recolour a light-themed
  app's views when "Override force-dark" (developer options) is on, and OEM skins do it from their settings (ColorOS / realme
  UI "Dark mode for third-party apps", MIUI / HyperOS "Dark mode for more apps", some Samsung and vivo builds). The light
  framework themes allow it and our theme does not refuse it (no `android:forceDarkAllowed` in the generated `styles.xml`).
  The result is the app half-inverted: dark cards with our dark ink text, recoloured amber buttons, photos untouched.
  Not tested on a phone yet: check on the OPPO with Settings → Display → Dark mode → "Dark mode for third-party apps" on.
- **The change for the 1.4.0 build (native: a config plugin, not now):** keep `userInterfaceStyle: "light"`, and add
  `android:forceDarkAllowed="false"` to the app's theme (`AppTheme` in `styles.xml`) with a small config plugin
  (`plugins/withLightOnly.js`: `withAndroidStyles`, sets the item on AppTheme; listed in `app.json` plugins). On the
  build's targetSdk check that the attribute is still honoured (Android 16 reworked force dark); `npm run test:build`
  gets a check that the prebuilt `styles.xml` carries it.
- **/m/ (no build needed, done in Round 2b):** `public/index.html` and `offline.html` say
  `<meta name="color-scheme" content="only light">` and `:root { color-scheme: only light }`, so Chrome's auto dark mode
  and the browsers' forced dark leave the mobile website alone (`npm run test:web` checks both; the e2e
  `contrast.spec.ts` checks the built page with the phone in dark).
- **Check after the build:** the OPPO in dark mode with the third-party dark switch on: Today, a task, Log mileage and
  Office mode look exactly as in light mode.

## 7. Anything else found so far

- **Photos and documents by camera** (Stage 1 item 5) need no new module: `expo-image-picker` and
  `expo-image-manipulator` are already in the 1.3.0 build. The work is the server's upload path (its own go).
- **The runtime version:** 1.4.0 becomes `1.4.0-gmaps` (the Google switch stays on). Phones on 1.3.0 keep their
  runtime's last update until they install 1.4.0; updates published after the build target 1.4.0 only (as at 1.3.0).
- **Store:** the `store` profile (.aab) is built from the same commit only when Sahan asks for a store release.

## Built

**29 October 2026 (Sahan's go).** notify-office deployed first (the `-2` channels only for phones that registered
them; 1.3.0 phones keep their pair). EAS build `4e0e0eba-d542-4d41-956c-08e2936c901f` (profile `drivers`, commit `9398b64`,
finished 09:37 UTC): version 1.4.0, **versionCode 3**, runtime **`1.4.0-gmaps`**; the APK
https://expo.dev/artifacts/eas/SMzCo0z0jpR6aqcelesUWfTp_woAq047Yqx1Bh4Tqfo.apk (77.2 MB). Checked: arm64-v8a and
armeabi-v7a for all 28 native libraries, every one stored uncompressed and 16 KB aligned; the eight notification sounds kept
by name (plus the two in-app ones); RECORD_AUDIO not in the final manifest. Main fast-forwarded to `9398b64` (CI run
40847466388 passed); the site and /m/ from the same commit (136d0051). Round 50 and later publish to `1.4.0-gmaps`.

## The build, when Sahan says go

1. Count this month's builds (`eas build:list`) and say how many are left.
2. Deploy notify-office first (its go): the `-2` channels.
3. From `apps/driver` on `release-1.4.0`: `npx eas build --platform android --profile drivers --no-wait`; check with `eas build:view`.
4. Download the APK: its size, an arm64-v8a and an armeabi-v7a copy of every native library, 16 KB alignment, all eight
   sounds, version 1.4.0 (3), runtime 1.4.0-gmaps.
5. Install on the test phone (the checks after the build: items 2, 4, 5 and 6 above), then the pilot phones.
6. Fast-forward main to the build's commit; from then every EAS update targets 1.4.0-gmaps only.
