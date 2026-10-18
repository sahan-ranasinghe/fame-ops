# Fame Fleet in the stores: Google Play now, the App Store later

Written at Phase 7 Part 6 (19 October 2026). Nothing has been submitted or published. This page is the order of work,
what Fame Global Solutions must provide, and the texts to paste. Every step that changes the live system or sends
something to Google or Apple needs Sahan's go.

## 1. What is ready in the repository

| Item | Where | State |
|---|---|---|
| The app: **Fame Fleet 1.3.0**, package `com.fameglobal.driver` (unchanged, so it installs over Fame Driver 1.2.0) | `apps/driver/app.json` | built and checked locally |
| Android versions: **minSdkVersion 24 = Android 7.0**, **targetSdkVersion 36 = Android 16** (compileSdk 36) | Expo SDK 57 defaults, read from the built APK | Play's target-level rule is met |
| `store` build profile: an **.aab** with arm64-v8a and armeabi-v7a (Play gives each phone only its own part), R8 and resource shrinking, the lean build | `apps/driver/eas.json` | built locally (arm64 only, to save time) |
| `drivers` (APK for the phones today) and `drivers-32` (a 32-bit phone) | `apps/driver/eas.json` | ready |
| **Version codes that always go up**: EAS keeps the number (`cli.appVersionSource: remote`) and raises it at every `drivers` and `store` build (`autoIncrement`) | `apps/driver/eas.json` | ready |
| Icon, adaptive and themed icon, splash, notification icon | `apps/driver/assets/`, made by `apps/driver/scripts/make-icons.mjs` | done |
| Store icon 512 × 512 and feature graphic 1024 × 500 | `apps/driver/store/` | done |
| **Privacy policy** at `https://fame-fleet.pages.dev/privacy` (plain English, no sign-in) | `apps/office/src/screens/Privacy.tsx` | live after the next web deploy |
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
2. **The signing key (important).** Phones that installed the APK directly are signed with the key EAS keeps. If Google
   makes a new signing key, those phones cannot update from Play, and the Android Maps key (restricted to the signing key's
   SHA-1) stops working there. Choose **"Use the existing app signing key"** in Play App Signing and upload the EAS key
   (`eas credentials` → Android → download the keystore, then Google's PEPK tool). Then sideloaded and Play-installed apps
   are the same app.
3. **The battery permission** (6.2): keep it and explain it, or drop it for the store build and open the battery
   settings list instead (one more tap for the driver).
4. **Who answers privacy questions**: a contact e-mail for the policy and the listing (the policy now says "the fleet
   admin"; Play wants a contact).

## 3. Order of work (each line needs Sahan's go)

1. Round: `db push` (the demo migration), the functions, the web (the privacy page goes live).
2. The reviewers' driver:
   - in Claude or on the site: `create_driver` name "Store Reviewer", code `DEMO-01`, username `store.review`, a PIN, a phone
     number;
   - then once: `npx supabase db query --linked "select public.seed_demo_driver('store.review', 30)"` (it refuses any driver
     with real history; run it again every few weeks to top up the tasks).
3. `eas build -p android --profile store` (the .aab). For the phones as today: `--profile drivers` (the .apk).
4. Play Console (section 4), first release on **Internal testing**.
5. Later, iOS (section 5) with Phase 8.

## 4. Google Play Console, step by step

**Fame provides first:**
- a **D-U-N-S number** for Fame Global Solutions (free from Dun & Bradstreet; it can take up to 30 days);
- a Google **organisation developer account** (USD 25 once), opened with that D-U-N-S, the legal name, address, phone and
  website, and the account holder's identity check;
- a public **developer contact e-mail** (shown on the listing);
- the **listing texts** (drafts below; the boss approves them);
- **screenshots** (Sahan takes them on the OPPO with the reviewers' account: Today, the task map, Start work, the fuel
  video, Me), 2 to 8, portrait.

**Steps:**
1. Create app: name **Fame Fleet**, default language English (United Kingdom), App, Free. Accept the declarations.
2. Play App Signing: use the existing key (decision 2.2), then **add the app signing key's SHA-1** to the Android Maps key's
   restriction in the Google Cloud console if it is not the EAS one already listed.
3. Main store listing: name, short description, full description, icon `apps/driver/store/play-icon-512.png`, feature graphic
   `apps/driver/store/feature-graphic.png`, screenshots, category **Business**, contact e-mail, privacy policy URL.
4. App content:
   - Privacy policy: `https://fame-fleet.pages.dev/privacy`.
   - **App access**: "All or some functionality is restricted". Give the reviewers' account: username `store.review` and its
     PIN, with: "Sign in as a driver. Tap Start work to go on duty (location is recorded only while on duty). Open a task on
     Today, Accept, Start task. The places are in Colombo, Sri Lanka, so Arrived asks to confirm when you are far away."
   - Ads: no ads.
   - Content rating: the questionnaire (a business tool; no user content shared publicly).
   - Target audience: 18 and over; not for children.
   - **Data safety** (6.1).
   - Government app: no. Financial features: none. Health: none. News: no.
   - **Sensitive permissions**: Location permissions (background), with the declaration (6.3) and a video; Foreground
     service type **location**, with the same description and video.
5. Testing → Internal testing → create a release, upload the .aab (or `eas submit -p android --profile store`), release
   notes "First store release of Fame Fleet", add the testers' list, roll out.
6. When the review is through: the testers open the opt-in link, install from Play. A phone with Fame Driver 1.2.0 sideloaded
   updates in place only when the signing key is the same (2.2).

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
allows the permission only where the core function suffers without it; if the review refuses it, the store build drops it
and the step opens the battery settings list instead (decision 2.3).

### 6.3 Background location declaration (Play, about 500 characters)
"Fame Fleet is used only by the drivers employed by Fame Global Solutions. While a driver is on duty, from Start work to
Finish work in the app, Fame Fleet records the vehicle's location in the background so the fleet office can see where each
vehicle is, record each trip and its kilometres, and confirm arrival at each stop. Drivers keep the phone in a holder or a
pocket with the screen off while they drive, so recording must go on when the app is not open. Recording stops at Finish
work or at the day's cut-off, and the "On duty" notification shows the whole time."

The in-app disclosure (shown before Android's question) says: "Fame Fleet collects location data to show the office where
your vehicle is, to record your trips and the km of each task, and to mark when you reach each stop, while you are on duty
(from Start work to Finish work), even when the app is closed or not in use."

**The video** (30–60 s, recorded on the OPPO with test.driver, a real test account, because the office's pages leave the
reviewers' account out): sign in → Permissions → Allow location → the disclosure → Agree → Android's question → "Allow all
the time" → Today → Start work → the "On duty" notification → lock the phone → the office's Live page showing the moving
point.

### 6.4 What the reviewers' account can do
It signs in like any driver and sees only its own demo tasks and the demo vehicle `DEMO-0001`. Everything it does is kept
apart: the office's lists, searches, suggestions, issues and notifications leave it out, a real driver never sees its vehicle,
and it can never be given a real task (the database refuses the mix). Its location points are deleted after 90 days like
everyone's.
