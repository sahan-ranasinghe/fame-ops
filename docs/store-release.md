# Fame Fleet in the stores: Google Play now, the App Store later

Written at Phase 7 Part 6 (19 October 2026). Nothing has been submitted or published. This page is the order of work,
what Fame Global Solutions must provide, and the texts to paste. Every step that changes the live system or sends
something to Google or Apple needs Sahan's go.

## 1. What is ready in the repository

| Item | Where | State |
|---|---|---|
| The app: **Fame Fleet 1.3.0**, package `com.fameglobal.driver` (unchanged, so it installs over Fame Driver 1.2.0) | `apps/driver/app.json` | built and checked locally |
| Android versions: **minSdkVersion 24 = Android 7.0**, **targetSdkVersion 36 = Android 16** (compileSdk 36) | Expo SDK 57 defaults, read from the built APK | Play's target-level rule is met |
| `store` build profile: an **.aab** with arm64-v8a and armeabi-v7a (Play gives each phone only its own part), R8 and resource shrinking, the lean build | `apps/driver/eas.json` | built locally with both ABIs |
| `drivers`: **one APK for every phone**, arm64-v8a and armeabi-v7a (64-bit and 32-bit Android; only x86 emulators and Chromebooks left out), native libraries uncompressed and 16 KB page-aligned. `drivers-32` is retired (Sahan, 19 October) | `apps/driver/eas.json` | built locally |
| **Version codes that always go up**: EAS keeps the number (`cli.appVersionSource: remote`) and raises it at every `drivers` and `store` build (`autoIncrement`) | `apps/driver/eas.json` | ready |
| Icon, adaptive and themed icon, splash, notification icon | `apps/driver/assets/`, made by `apps/driver/scripts/make-icons.mjs` | done |
| Store icon 512 × 512 and feature graphic 1024 × 500 | `apps/driver/store/` | done |
| **Privacy policy** at `https://fame-fleet.pages.dev/privacy` (plain English, no sign-in; the same text in `docs/privacy-policy.md`). Its contact is the setting **Privacy contact e-mail** (Settings → Fleet, `privacy_email`), else the office phone | `apps/office/src/screens/Privacy.tsx` | live after the next web deploy |
| **Prominent disclosure** before Android's location question (Agree / Not now) | `apps/driver/src/components/LocationDisclosure.tsx` | in 1.3.0 |
| **Demo account for reviewers**, isolated from the live drivers and the office | migration `20261019150000_phase7_6_demo.sql`, `seed_demo_driver` | made after the push (step 3.2) |
| Unused permissions removed: overlay, fingerprint, biometric | `apps/driver/app.json` `blockedPermissions` | in 1.3.0 |

The permissions the app keeps, each with its reason (for the reviewers and the Data safety form): fine and coarse
location and **background location** (trips while on duty), foreground service of type location (the "On duty"
notification while recording), camera (odometer, receipts, fuel video, photos), notifications (tasks and questions),
**ignore battery optimisations** (see 6.2), boot completed (restart recording after a reboot), internet and network
state, vibrate, wake lock, audio settings (task sounds), storage read/write only up to Android 12 (photo picker).

## 2. Decisions for Fame and Sahan

1. **How the drivers get the app.**
   - **(a) Internal testing track (recommended to start).** Up to 100 people, added by their Google account e-mail. No
     public listing, a quick review, and updates through Play. Drivers and office staff only.
   - **(b) Production, unlisted in practice.** A public listing that only people with the link look for. Full review.
   - **(c) Managed Google Play private app.** Needs Google Workspace or an EMM (device management). Most private, more set-up.

   I suggest (a) now and (b) once the listing and the reviews are through. An organisation account is not held to the
   "12 testers for 14 days" rule that new personal accounts have.
2. **The signing key: decided (Sahan, 19 October).** Upload the existing EAS key as the app signing key; never let Google
   make a new one. Phones that installed the APK directly are signed with the key EAS keeps; with the same key in Play they
   update from Play without uninstalling, and the Android Maps key (restricted to that SHA-1) keeps working. Steps: 4.2.
3. **The battery permission: decided.** Keep it and explain it (6.2); if Play refuses it, the fallback in 6.2.
4. **Who answers privacy questions: decided.** The setting **Privacy contact e-mail** (Settings → Fleet). It holds Sahan's
   test address for now. **Before the store submission it must be Fame's real shared address, and the Play listing's
   contact e-mail must be the same address.**

## 3. Order of work (each line needs Sahan's go)

1. Round: `db push` (the demo migration), the functions, the web (the privacy page goes live).
2. The reviewers' driver:
   - in Claude or on the site: `create_driver` name "Store Reviewer", code `DEMO-01`, username `store.review`, a PIN, a phone
     number;
   - then once: `npx supabase db query --linked "select public.seed_demo_driver('store.review', 3)"`. It refuses any driver
     with real history (a vehicle, tasks, duty, locations, logs). The seeding is quiet (no pushes, no reminder bursts), and
     the nightly job `demo-tasks` keeps three days of tasks ahead from then on.
   - The account tools find the reviewer's driver like any other (`reset_pin`, `set_driver_active`, `update_driver`);
     every other office tool and page leaves it out.
3. `eas build -p android --profile store` (the .aab). For the phones as today: `--profile drivers` (the .apk). Both are on
   the same update channel (`preview`) and runtime (`1.3.0-gmaps`), so one `eas update` reaches the Play-installed and the
   sideloaded phones alike.
4. Before submitting: Settings → Fleet → Privacy contact e-mail = Fame's shared address (the page shows it at once), and
   the same address as the listing's contact e-mail. The keystore backup (4.3) is done and stored offline.
5. Play Console (section 4), first release on **Internal testing**.
6. Later, iOS (section 5) with Phase 8.

## 4. Google Play Console, step by step

**Fame provides first:**
- a **D-U-N-S number** for Fame Global Solutions (free from Dun & Bradstreet; it can take up to 30 days);
- a Google **organisation developer account** (USD 25 once), opened with that D-U-N-S, the legal name, address, phone and
  website, and the account holder's identity check;
- a public **developer contact e-mail** (shown on the listing), the same shared address as the privacy setting;
- the **listing texts** (drafts below; the boss approves them);
- **screenshots** (Sahan takes them on the OPPO with the reviewers' account: Today, the task map, Start work, the fuel
  video, Me), 2 to 8, portrait.

**Steps:**
1. Create app: name **Fame Fleet**, default language English (United Kingdom), App, Free. Accept the declarations.
2. Play App Signing with the existing EAS key (decision 2.2; the exact steps in 4.2 below).
3. Main store listing: name, short description, full description, icon `apps/driver/store/play-icon-512.png`, feature graphic
   `apps/driver/store/feature-graphic.png`, screenshots, category **Business**, contact e-mail, privacy policy URL.
4. App content:
   - Privacy policy: `https://fame-fleet.pages.dev/privacy`.
   - **App access**: "All or some functionality is restricted". Give the reviewers' account: username `store.review` and its
     PIN, with: "Sign in as a driver. Tap Start work to go on duty (location is recorded only while on duty). Open a task on
     Today, Accept, Start task. Start task asks for a photo of the vehicle's odometer: without a vehicle, take any photo
     three times, then tap "Type the reading" and type a number. The places are in Colombo, Sri Lanka, so Arrived asks to
     confirm when you are far away."
   - Ads: no ads.
   - Content rating: the questionnaire (a business tool; no user content shared publicly).
   - Target audience: 18 and over; not for children.
   - **Data safety** (6.1).
   - Government app: no. Financial features: none. Health: none. News: no.
   - **Sensitive permissions**: Location permissions (background), with the declaration (6.3) and its video (6.5); Foreground
     service type **location**, with its description and its own video (6.5).
5. Testing → Internal testing → create a release, upload the .aab by hand (`eas submit` needs a Play service account key
   and a `submit` profile in eas.json first), release notes "First store release of Fame Fleet", add the testers' list,
   roll out.
6. When the review is through: the testers open the opt-in link, install from Play. A phone with Fame Driver 1.2.0 sideloaded
   updates in place only when the signing key is the same (2.2).

### 4.2 Play App Signing with the existing key (exact steps)

Do this when creating the first release, before any .aab is uploaded (afterwards the key can no longer be chosen):
1. On the laptop, get the key EAS signs with (Sahan runs it himself; the passwords appear only on his screen):
   `cd apps/driver && npx eas credentials -p android` → profile **drivers** → "Keystore: Manage everything needed to build
   your project" → "Download existing keystore". It saves the `.jks` file and shows the keystore password, the key alias
   and the key password. Note the **SHA-1** it shows: it is the one on the Android Maps key today.
2. Play Console → the app → Test and release → Setup → **App signing** (shown as "App integrity" on some accounts) →
   **Choose signing key** → **Use a different key**... → **Export and upload a key from Java KeyStore**.
3. Download the two files the page offers: Google's **PEPK tool** (`pepk.jar`) and the **encryption public key**
   (`encryption_public_key.pem`).
4. Run PEPK (the laptop has no Java, so in the Android build image, from the folder with the three files):
   `docker run --rm -it -v "$PWD":/w -w /w reactnativecommunity/react-native-android java -jar pepk.jar
   --keystore=<the .jks> --alias=<the alias> --output=fame-fleet-signing.zip --include-cert --rsa-aes-encryption
   --encryption-key-path=encryption_public_key.pem` and type the two passwords when asked.
5. Upload `fame-fleet-signing.zip` on the same page and save.
6. Check on the App signing page: the **App signing key certificate** SHA-1 is the SHA-1 from step 1. The **Upload key**
   is the same key (Play takes the key of the first upload; EAS signs every `store` build with it).
7. Delete the `.jks`, the zip and `pepk.jar` from the laptop once the backup (4.3) holds them.

If an app signing key's SHA-1 ever changes (a key upgrade in Play, a new upload key that is also used for an APK), **add the
new SHA-1 to the Android Maps key's restriction first** (Google Cloud console → APIs & Services → Credentials → the Android
key → Android apps → Add, package `com.fameglobal.driver`), or the Google map goes grey on the phones (they then switch to
the free map by themselves and the office sees "Google map failed" issues). `docs/google-maps-setup.md` section 9.

### 4.3 The keystore backup (Sahan runs it; Fame keeps it)

`cd apps/driver && npx eas credentials -p android` → profile **drivers** → "Keystore: Manage everything needed to build
your project" → "Download existing keystore". Keep the `.jks` file and the three values it shows (keystore password, key
alias, key password) **offline**: for example an encrypted USB drive in the office safe and the passwords on paper in a
sealed envelope, or Fame's password manager. **Never in git, a chat, an e-mail or a shared drive.** Without this key no
update can ever reach the sideloaded phones or the store app if EAS lost it.

**Listing drafts**
- Short description (80 characters): "Tasks, trips and mileage for Fame Global Solutions' drivers and fleet office."
- Full description: "Fame Fleet is Fame Global Solutions' own fleet app, for its drivers. See today's tasks with their
  stops and times, accept them, start and finish them with the odometer photo, log fuel with a short video, report a vehicle
  problem and tell the office when you are running late. While you are on duty the app records the trip so the office can
  plan, and nothing is recorded off duty. For Fame Global Solutions employees only: accounts are made by the company."

## 5. The App Store (later, Phase 8)

- **Fame provides:** the Apple Developer Program as an **organisation** (USD 99 a year, the same D-U-N-S), someone with the
  right to sign for the company, the website, and later the **Unlisted app distribution** request (or a custom app through
  Apple Business Manager).
- **Steps:** an App ID `com.fameglobal.driver`; the app in App Store Connect; the iOS build through EAS (`eas build -p ios`);
  the location texts (`NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, the
  disclosure's sentence) and background mode `location`; the App Privacy answers (the same as Play's Data safety); the
  reviewers' account and notes; screenshots for 6.9-inch and 6.5-inch iPhones; submit, then request Unlisted.

## 6. The texts

### 6.1 Data safety (Play)
- Data collected, none shared with third parties for their own use (the service providers are processors), all encrypted
  in transit, deletion on request through the fleet admin:
  - **Location**: precise and approximate. Purpose: app functionality. Required for drivers. Collected in the background
    while on duty.
  - **Personal info**: name, phone number, user IDs (username, employee code). App functionality, account management.
  - **Photos and videos**: odometer, receipts, fuel fill videos, vehicle problems, profile and licence photos. App
    functionality.
  - **App info and performance**: whether location and notifications are on, the battery level, the app version.
    Diagnostics (the office sees when recording stops).
  - **Device or other IDs**: the push notification token, the phone model. App functionality.
- Not collected: contacts, messages, calls, files, web browsing, financial or health data. No ads.

### 6.2 Ignore battery optimisations
The app asks once (Permissions, "Keep running in the background") so the phone does not stop recording during a trip:
phones in Sri Lanka (OPPO, realme, Xiaomi, vivo) stop background apps aggressively and the office then loses the trip. Play
allows the permission only where the core function suffers without it. **Keep it, with this explanation** (decision 2.3).

**The fallback if Play refuses it** (a small change, shown to Sahan before it is built):
- add `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` to `blockedPermissions` in `apps/driver/app.json`;
- `askIgnoreBatteryOptimisation` (`apps/driver/src/lib/location.ts`) opens Android's battery list directly
  (`IGNORE_BATTERY_OPTIMIZATION_SETTINGS`, which needs no permission) instead of the one-tap question; the driver finds Fame
  Fleet there and picks "Don't optimise" (Me → Phone setup's brand steps already say where). Without the permission the
  one-tap question silently does nothing, so this must be a switch in the code, not a try-and-fall-back.

### 6.3 Background location declaration (Play, about 500 characters)
"Fame Fleet is used only by the drivers employed by Fame Global Solutions. While a driver is on duty, from Start work to
Finish work in the app, Fame Fleet records the vehicle's location in the background so the fleet office can see where each
vehicle is, record each trip and its kilometres, and confirm arrival at each stop. Drivers keep the phone in a holder or a
pocket with the screen off while they drive, so recording must go on when the app is not open. Recording stops at Finish
work or at the day's cut-off, and the "On duty" notification shows the whole time."

The in-app disclosure (shown before Android's question) says: "Fame Fleet collects location data to show the office where
your vehicle is, to record your trips and the km of each task, and to mark when you reach each stop, while you are on duty
(from Start work to Finish work), even when the app is closed or not in use."

The video for this declaration: 6.5.

### 6.4 What the reviewers' account can do
It signs in like any driver and sees only its own demo tasks and the demo vehicle `DEMO-0001`. Everything it does is kept
apart: the office's lists, searches ("Used before" too), suggestions, issues and notifications leave it out, a real driver
never sees its vehicle, and it can never be given a real task (the database refuses the mix). Its location points are deleted
after 90 days like everyone's.

What is not apart, said here: its actions are in the audit log like everyone's; its searches, photos and odometer reads use
the same daily Google, openrouteservice and Gemini allowances (60 odometer reads a day per driver); a push that fails to reach
its phone counts towards the "push failed" issue; and office people could read its rows directly in the database (no page
shows them).

### 6.5 The two declaration videos (each a short screen recording, uploaded to YouTube as unlisted, the link in the form)

Recorded on the OPPO with test.driver (a real test account: the office's pages leave the reviewers' account out). About
30 seconds each; no speech needed; the screen readable.

1. **Background location** (Location permissions declaration). It must show, in this order:
   - the in-app **prominent disclosure** (the full screen "Location while you are on duty" with its text) **before**
     Android's question, and tapping **Agree**;
   - Android's runtime question, and choosing **"Allow all the time"** (on Android 11+ the app's location settings page);
   - the feature that needs it: **Start work**, the "On duty" notification, then the app **leaving the screen** (Home, then
     the screen locked);
   - proof that recording goes on in the background: the office's Live page (on a laptop, filmed or recorded) with the
     driver's point moving, or the trip's line growing.
2. **Foreground service of type location** (Foreground service permissions declaration). It must show:
   - the **user action that starts it**: Start work (or Start task) in the app;
   - the **notification** that appears at once and stays ("On duty" / "Sharing my location"), shown in the notification
     shade;
   - the task the service does while the app is in the background (the phone locked, the notification still there, the
     point moving on Live);
   - the **user action that ends it**: Finish work, and the notification going away.
