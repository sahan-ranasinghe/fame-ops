# Fame Fleet

Driver app (Fame Driver) and fleet office tools for Fame Global Solutions.
This repository is private: `docs/` contains internal company IDs.

- `CLAUDE.md`: the specification (what we build, hard rules, data model).
- `design/`: the Fame Fleet screens (PNG and PDF).
- `docs/`: how the existing Allowance Desk artifact works.
- `supabase/migrations/`: the database (tables, Row Level Security, the private
  `driver-photos` bucket, towns).
- `supabase/tests/`: database tests for the access rules.
- `supabase/functions/_shared/fleet/`: the office rules and tools, shared by
  `office-mcp` (Claude) and `office-api` (the web app).
- `supabase/functions/office-mcp/`: the office connector (Edge Function).
- `supabase/functions/office-api/`: the same tools over HTTP for the web app.
- `apps/office/fame-fleet.html`: the Fame Fleet artifact's source, as published
  in Claude; `scripts/tool-shapes.json` is the contract its calls rely on.
- `scripts/`: connector tests.
- `apps/driver/`: the Fame Driver Android app (Expo).

## Driver app (`apps/driver`)

Expo SDK 57, Android only, package `com.fameglobal.driver`, Expo project
`@fame-global/fame-driver`. It is a development build, not Expo Go: background
location, the map and the other native modules need it.

- Every native module the app will use is already installed, so one cloud build
  is enough; after that, changes to screens and logic reload live.
- `app.json` holds the name, package, permissions and config plugins.
  The `android/` folder is generated and is not committed.
- `eas.json` has two build profiles, both producing an APK for internal
  installs: `development` (with the developer menu, loads code from the laptop)
  and `preview` (standalone, for trying on a driver's phone).
- The Supabase URL and the publishable key are public values. They are in
  `eas.json` for builds and in `apps/driver/.env` (not committed; see
  `.env.example`) for the dev server.
- `.easignore` (at the top of the repository) limits what a build uploads to
  Expo to `apps/`. Without it the whole repository would be uploaded,
  including `docs/` and the git history.
- `app.config.ts` adds to `app.json` what depends on the machine: the
  Firebase file for push notifications (on an EAS build from the file
  environment variable `GOOGLE_SERVICES_JSON`; on the laptop from
  `apps/driver/google-services.json`, which is not committed), and the task
  map's Google map (Phase 6 Part 5), from two EAS variables in the preview
  environment: the switch `GOOGLE_ANDROID_MAPS=on` (plain text, so the laptop
  and EAS work out the same runtime: `1.2.0-gmaps` on, `1.2.0` off) and the key
  `GOOGLE_ANDROID_MAPS_KEY` (secret, readable only on EAS's build workers;
  restricted in Google Cloud to the package and the preview signing key's
  SHA-1), which goes into the Android manifest through `android.config.googleMaps`.
  An EAS build with the switch on and no key stops instead of making an app
  whose map would crash.

```bash
cd apps/driver
source ~/.nvm/nvm.sh && nvm use

npx expo-doctor                                       # 21/21 checks
npm run typecheck                                     # type check (app and test script)
npx expo prebuild --platform android --no-install     # config check; then: rm -rf android

eas build --profile development --platform android    # cloud build (Sahan starts builds himself)
npx expo start --dev-client                           # then open the app on the phone
```

### Preview build and code updates

The `preview` profile makes a standalone APK for drivers' phones. It is kept
small by switches that only this profile passes to Gradle (see
`gradleCommand` in `eas.json`); the `development` profile is not affected:

- only the two ARM CPU types real phones use (`arm64-v8a`, `armeabi-v7a`),
- R8 minify and resource shrinking,
- ML Kit text recognition from Google Play services instead of five models
  bundled in the app (`plugins/withMlKitFromPlayServices.js`). The model is
  fetched once by Play services, so the very first odometer photo on a phone
  may not get a suggested number.

Measured on 7 October 2026 with a local build using the same switches: 72 MB,
against more than 360 MB for the development build.

```bash
cd apps/driver
eas build --profile preview --platform android        # Sahan starts builds himself
```

The preview build takes code updates over the air (EAS Update, channel
`preview`). Each time the app starts it looks for an update; one that arrives
within 5 seconds is used straight away, otherwise from the next start. Me →
"Check for update" does the same on demand, and Me shows when the running code
was published.

```bash
cd apps/driver
eas update --channel preview --environment preview --message "What changed"
```

- An update can change screens, text and logic (everything under `src/`). It
  cannot add a native module or change `app.json` settings such as
  permissions: that needs a new build.
- Updates only reach builds with the same runtime (`version` in `app.json`,
  now 1.2.0; `1.2.0-gmaps` when built with the Google key). When a new build is
  needed for a native change, raise the version first, so older builds do not
  receive code they cannot run. Phones on 1.1.0 got their last update from
  commit d63c838 (Google stops kept off their OpenFreeMap map); the 1.2.0 build
  adds react-native-maps.
- `eas update` does not read `apps/driver/.env`. The app therefore also takes
  the Supabase URL and publishable key from `extra` in `app.json`.
- The app also looks for an update each time it comes back to the front, at
  most every 30 minutes. New code is started only when no task is in progress
  and nothing is waiting to be uploaded; otherwise it waits for that moment
  or for the next start. Me → "Check for update" follows the same rule.

How the app is put together (`apps/driver/src`):

- `app/`: the screens. `login`, `permissions`, the four tabs in `(tabs)/`
  (Today, Mileage, Report, Me), `task/[id]` (a task, with the map while it is
  in progress), `log-mileage` (odometer and fuel), `vehicle` (choose vehicle).
- `state/app.tsx`: who is signed in, the language, tasks, and every action a
  screen can trigger.
- `components/navigation.ts`: the back rules of the forms ("Discard changes?"
  on the driver's own back, never after a save), and the "is a form open with
  unsaved input" question the root layout asks when a notification is tapped.
  The rules themselves are in `CLAUDE.md` (Back navigation rules).
- `lib/api.ts`: every call to Supabase. `sync/engine.ts`: the offline queue.
  What the driver does is written to the phone first and sent in order when
  there is a connection; sending the same thing twice is harmless.
- `lib/location.ts`, `lib/locationTask.ts`, `lib/tracking.ts`, `lib/track.ts`:
  "Sharing my location". A position every 5 s (handed over in batches of up
  to 15 s), one recorded point every 5 s while moving and one a minute while
  parked, uploads every 30 s. `track.ts` is the GPS drift filter (fixes worse
  than 50 m, jumps over 150 km/h and drift while standing still count for
  nothing; a move needs a second fix that agrees); the connector has the
  same file. `checkTracking()` starts a dead location service again (when
  the app opens, comes to the front, and every minute while on screen) and
  reports what the driver must fix; the background task keeps a watchdog
  notification armed that fires 12 minutes after the last position.
- `lib/backgroundTask.ts`: the tracking check without the app (expo-background-task,
  a WorkManager job Android runs about every 15 minutes). With sharing on and no
  position for 3 minutes it restarts the location service (Android 11 and
  older) or, on Android 12 and newer where a job may not start one, shows
  "Location sharing stopped. Tap to turn it back on". A force-stopped app
  runs no jobs until it is opened again.
- `lib/odometerAi.ts`: reads the odometer from the photo. The photo is
  uploaded at once and the Edge Function `read-odometer` asks Gemini; with no
  connection the phone's own text reader (ML Kit) is used instead. Either
  way the driver checks the number.
- `lib/updates.ts`: code updates (see above).
- `i18n/en.json` and `i18n/si.json`: all text. Screens contain no text.
- `lib/database.types.ts` is a copy of the connector's generated types; copy it
  again after a schema change.

Test of the app's server code and offline queue against the local stack
(sign-in, reading, a whole working day queued offline and then sent, repeated
sends, refused changes, a second driver who must see nothing):

```bash
npx supabase start            # from the repository root
cd apps/driver && npm run test:data
```

The GPS drift filter has its own test, with the real recording of a phone
that stood still indoors for 47 minutes (`scripts/fixtures/`) and some
made-up drives. It needs no stack:

```bash
cd apps/driver && npm run test:track
```

The parts that only exist on a phone (location service, camera, map) have no
automated test; they are checked by hand on the development build.

Known risk: `@react-native-ml-kit/text-recognition` (reads the odometer from a
photo) is listed as "untested on the New Architecture" and is excluded from
that one `expo-doctor` check in `package.json`. If a build fails in that
library, or reading a photo does not work, remove it: the odometer is always
typed or confirmed by hand anyway.

## Office web app (`apps/office`)

The office screens from the boss's design, built once and shipped two ways
(docs/office-web-plan.md, section 4): `npm run build:web` for the web app on
Cloudflare Pages (every person signs in with their own account; every call goes
through `office-api`) and `npm run build:artifact` for the Fame Fleet artifact in
Claude (one file; it uses the viewer's "Fame Fleet" connector, no key inside).
Phase 2 has Overview, Tasks (board, assign a task, task detail, reassign, cancel)
and Requests (list, approve or decline, new request), plus sign-in, the
set-password page and optional 2-step sign-in (Settings). Phase 3 adds Live
locations: a real map (MapLibre, OpenFreeMap tiles) on the web with markers
that move the moment a driver's phone reports a position (Supabase Realtime on
`driver_latest`), the drawn map in the artifact, and today's route per driver.
Phase 4 adds Vehicles, Drivers, Mileage (with km outside tasks and odometer
checks), Maintenance, Projects and, for admins, Accounts (office users,
set-password links, connector keys). Every screen of the published artifact
is now in the new source, so the artifact can be republished from
`npm run build:artifact`. The driver page (a driver's name anywhere opens it)
shows the driver's status, the day's GPS km, driving and stopped time and
stops, the route on the map coloured by speed with stops and data gaps marked,
a timeline beside it, any day's history (Today, Yesterday, a date) and, on the
web, playback with a moving marker. "Show today's trails" on Live locations
draws every sharing driver's line; the task drawer shows the task's own route.
The route comes from one builder shared with the connector
(`supabase/functions/_shared/fleet/route.ts`: the drift filter, a timeline of
driving / stopped / no data, Douglas–Peucker thinning so the line follows the
roads on a long day) and today's line grows live from the same Realtime rows
the live map uses.

Phase 5 (docs/dispatch-plan.md, October 2026) adds: tasks with stops and a leave-by
time planned from the deadlines (the plan panel, the stops editor, road times from
openrouteservice when the key is set, the estimate otherwise); permissions per person
with locked menu items and Settings → Users; the issues centre (the bell, the Issues
pages, a vehicle problem that closes the driver's report when resolved); office
notifications by web push (Settings → Notifications, web only) and the installable web
app; the driver's accept and decline with "Needs a driver" and reassign from
suggestions; custodians, the request timeline, booking by vehicle type in one step
("Assign now"), cancelling a booking, and the self-drive switch in Settings → Fleet.

```bash
cd apps/office && npm install && cp .env.example .env.local   # add the publishable key
npm run dev                                                   # http://localhost:5173
scripts/test-office-local.sh /tmp/office-mcp.env              # from the repo root: every check, local stack only
```

See `apps/office/README.md`.

## Driver status and heartbeats

One rule decides what the office sees for a driver, in
`supabase/functions/_shared/fleet/status.ts`, used by the connector tools, the
web app and the artifact alike: **Live** (a GPS point under 3 minutes old),
**Location off** (the phone's heartbeat says Location services are off or the
permission is not "Allow all the time", with since when), **No signal** (sharing
on, but nothing from the phone for over 3 minutes), **Not sharing**. The phone
sends a small heartbeat about every minute while sharing, at once when
Location changes, so the office sees the truth within about a minute; a task in
progress without location for 10 minutes goes into "needs attention". In the
driver app, Location is required for work: starting a task or sharing with
Location off shows a full-screen "Turn on Location" cover with Android's own
dialog, and a task in progress is covered until Location is back.

## Office rules, connector and API

Everything the office can do is a tool in `supabase/functions/_shared/fleet`
(49 tools, no raw SQL, no deletes). `permissions.ts` says which permission each
tool needs (view, request, approve, assign_tasks, vehicles, issues, users; a
person holds any set of them, `roles.ts` keeps the role as a label); `run.ts`
runs a call for a person: the permission check, the audit row (with the
person's name and the channel), the tool, the outcome. Two thin wrappers use
it:

- `office-mcp`, the connector Claude uses: an MCP server over Streamable
  HTTP at `https://hinurfsaxvplbyqgtozj.supabase.co/functions/v1/office-mcp/<KEY>/mcp`.
  Our Claude Teams workspace has one org-wide custom connector named "Fame
  Fleet" with the shared `OFFICE_MCP_KEY` (an admin key); the boss and Sahan
  use it, and so do the test scripts. The Fame Fleet artifact has no key of
  its own: it uses the viewer's "Fame Fleet" connector. Never add a second
  connector named "Fame Fleet" to an account. A personal key made with
  `create_office_key` runs the tools as that person (name in the audit log,
  their role applied, only their tools listed) from a person's own Claude
  account or a test. A wrong or missing key answers 404. Treat a key URL as
  a password.
- `office-api`, for the web app, which uses no connector and no key: every
  person signs in with their own account, and the API checks the session
  and the role on every call. `GET /office-api/me`, `GET /office-api/tools`
  (with JSON schemas for the forms) and `POST /office-api/tools/<name>` with
  the same arguments and the same JSON answer as the connector. The session
  token is checked with Supabase Auth. 2-step sign-in is optional for every
  role; the secret `REQUIRE_MFA_ROLES` (for example `admin,fleet_admin`) makes
  the API refuse those roles until their session has done the second step.
  120 calls a minute per person; CORS allows `OFFICE_WEB_URL`.

Permissions per person (Settings → Users, with the presets Fleet admin, Dispatcher,
Requester, Viewer): the table is in `docs/dispatch-plan.md`, section 4.1. The role
(admin, fleet_admin, office, staff, viewer, driver) is a label derived from them.

Office accounts never involve a password in a chat: `create_office_user`
returns a one-time set-password link (sent by WhatsApp), `reset_office_password`
a fresh one, `set_office_user_active` switches a person off (sign-in banned,
keys revoked, sessions refused at once).

- `database.types.ts` is generated. After a schema change:
  `npx supabase gen types typescript --local --schema public > supabase/functions/_shared/fleet/database.types.ts`
  (and copy it to `apps/driver/src/lib/database.types.ts`).

Deploying (needs Sahan's go-ahead each time):

```bash
source ~/.nvm/nvm.sh && nvm use
npx supabase db push                                         # only when there is a new migration
npx supabase functions deploy office-mcp --no-verify-jwt     # the key in the URL replaces the JWT check
npx supabase functions deploy read-odometer --no-verify-jwt  # checks the driver's token itself
npx supabase functions deploy push-task --no-verify-jwt      # called by the database with the server key
npx supabase functions deploy office-api --no-verify-jwt     # checks the office user's session and role itself
npx supabase functions deploy fleet-jobs --no-verify-jwt     # the issue sync, called by the database with the server key
npx supabase functions deploy notify-office --no-verify-jwt  # web push to the office, called by the database with the server key
```

Secrets for office-api: `OFFICE_WEB_URL` (the web app's origin, for CORS and
the set-password links; the local test needs none). Secrets for
`notify-office`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`
(see "Office notifications" below); without them every notification is marked
dead and nothing else breaks.

## Office notifications (web push) and the installable web app

The office web app tells people about what concerns them even when the tab is
closed (docs/dispatch-plan.md, section 9): a new vehicle request (to everyone
who approves), a request decided (to the one who asked), a task declined or not
accepted in time (to everyone who approves or assigns), a critical issue (to the
issues permission), an issue given to you. The sender never hears about their
own action.

1. The tools and the database write one row per recipient into the outbox
   `notifications` through `queue_notification`, which skips a person who
   switched that event off (Settings → Notifications) or has no browser with
   notifications on (`web_push_subscriptions`).
2. The insert trigger hands the row to the Edge Function `notify-office`
   through pg_net (the Vault secrets `functions_url` / `server_key`, as the
   driver push does); the pg_cron job `notify-retry` (every 5 minutes) asks it
   to take rows that failed (tried again after 1, 5, 15 and 60 minutes, dead
   after 5 attempts) or were never picked up.
3. `notify-office` encrypts the message (RFC 8291, `@negrel/webpush`) and sends
   it with VAPID to every browser of the recipient; a browser the push service
   reports gone (404 / 410) is marked removed.
4. In the browser the service worker `sw.js` shows the notification and a tap
   opens the link in the open Fame Fleet window (or a new one). The web build
   is installable (manifest, icons from `apps/office/scripts/make-icons.mjs`,
   rendered with the e2e's Chromium: nothing downloaded): Android Chrome works
   best with it installed, a laptop needs the browser running, an iPhone needs
   Add to Home Screen first.

What Sahan sets up once, himself: the VAPID key pair, printed by

```bash
source ~/.nvm/nvm.sh && nvm use >/dev/null && node scripts/make-vapid-keys.mjs
```

and set as the Edge Function secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
and `VAPID_SUBJECT` (`mailto:<an office address>`) with `npx supabase secrets
set`. The browser gets the public key from `my_notification_settings`, so
nothing is built into the web app and a new pair needs no redeploy (people turn
notifications on again). The local test suite uses a throwaway pair in the
`functions serve` env file; without one the outbox rows are marked dead
(`no_vapid_keys`) and the suite checks that instead.

## Push notifications and sounds

New, changed, reassigned and cancelled tasks reach the phone even when the
app is closed:

1. After sign-in the app asks Expo for its push token
   (`Notifications.getExpoPushTokenAsync`, which needs the Firebase file in
   the build) and registers it with `register_device_token()`; sign-out
   removes it with `remove_device_token()`. One row per phone in
   `device_tokens`; a phone used by another driver moves to that driver.
2. The trigger `tasks_notify_push` on `tasks` hands each office change (new
   task, time or vehicle changed, cancelled, given to another driver) to the
   Edge Function `push-task` through pg_net, with the URL and key from Vault
   (`functions_url`, `server_key`). Changes made by the driver's own app are
   not pushed.
3. `push-task` writes the text in the driver's language, sends it through
   Expo's push API (which talks to FCM with the service-account key uploaded
   to EAS), deletes tokens Expo reports as gone, and logs to `push_log`.
4. On the phone, Android plays the channel's sound: `tasks-new` (loud ring),
   `tasks-changed`, `general`. Tapping the notification opens the task. The
   app plays its own short sounds on Start task and Save & finish task
   (expo-audio). All sounds are made by `apps/driver/scripts/make-sounds.sh`
   (pure tones with ffmpeg, nothing downloaded).

A phone with no push token (older build, notifications refused) still gets a
local notification for a new task while the app is open, from Realtime.

What Sahan sets up once: a Firebase project with the Android app
`com.fameglobal.driver` (`google-services.json` in `apps/driver/`, ignored by
git, uploaded to EAS as the file variable `GOOGLE_SERVICES_JSON`), the FCM V1
service-account key uploaded with `eas credentials`, the Edge Function secret
`SERVER_KEY`, and the two Vault secrets. A new build is needed once (native
modules and bundled sounds); after that, updates go over the air again.

## Km outside tasks

Consecutive odometer readings of a vehicle are paired (`pairGaps` in
`fleet.ts`): a task's own start and end are the task's km; every other pair
is a gap, "between tasks" when both readings are on the same Colombo day,
"overnight" otherwise. `mileage_summary` shows both per vehicle (and for one
driver: the gaps that start with that driver's reading) with the biggest
gaps, their time window, the driver who had the vehicle and where it was at
both readings (the odometer photos' GPS). `fleet_overview` lists gaps over
30 km (`GAP_ATTENTION_KM`) from the last 7 days. The monthly km against the
rental allowance (`list_vehicles`, `mileage_summary`, `fleet_overview`) comes
from odometer readings, so it already includes these km.

## Odometer photos prove the reading (`read-odometer`)

The driver app photographs the odometer (camera only, never the gallery),
uploads the photo to the private bucket at once, and calls this Edge Function
with the photo's path, the reading this one follows and the km driven since
(GPS). The function downloads the photo (service role) and asks Gemini what
it shows, reading only the total odometer (never speed, RPM, trip A/B, range,
clock or temperature). It answers a status:

| status | the app shows |
|---|---|
| `ok` | the number, big, with **Correct** and a small **Change** |
| `no_odometer`, `trip_meter_only`, `blurry`, `covered_or_dark`, `not_dashboard`, `unsure` | the photo, a message saying what to do, and **Retake photo** |
| `out_of_range` | the same, with the last reading (under it, or more than 500 km above last + GPS km) |

Typing a number is possible only after three failed photos in a row ("Still
can't read it? Type the reading", with a link to report a broken display), after
the **Change** warning, or with no connection. The phone's own text reader (ML
Kit) runs first: text with no digits means "no odometer" without asking the
server; its number is the suggestion when the server cannot be reached.

What the driver did is sent with the reading (`entry`: photo, photo_changed,
typed_unreadable, typed_offline; `photo_attempts`). What the server read is
written by the server alone (`ai_value`, `ai_status`, `ai_checked_at`, `flag`):
drivers have no privilege on those columns, and a trigger fills them from the
read of the very photo the log points at. A reading typed with no connection
is checked within minutes of its photo arriving: the pg_cron job
`check-odometer-photos` (every 5 minutes) sends unchecked logs to the function
through pg_net, in server mode (header `x-server-key`), which writes the
result back with `set_odometer_ai()`. Flags: `photo_changed`,
`typed_unreadable`, `ai_differs`, `ai_failed`; the connector shows them in
`task_detail`, `mileage_summary` (`check_odometer`) and `fleet_overview`.

- Signed-in drivers only in driver mode: the function checks the session
  token with Supabase Auth and only reads photos inside the caller's own
  folder. `verify_jwt` is off in `config.toml` for that reason.
- Every model call is written to `odometer_reads` (service role only); 60
  driver-mode calls per driver per day.
- Secrets: `GEMINI_API_KEY` (set), `SERVER_KEY` (shared with the database:
  the same value goes into Vault as `server_key`, next to `functions_url`),
  `GEMINI_MODEL` (optional, default `gemini-3.5-flash-lite`).

Trying the function on real photos, locally (the photos stay in their folder):

```bash
npx supabase start
printf 'GEMINI_API_KEY=%s\nSERVER_KEY=%s\n' '<key>' "$(openssl rand -hex 24)" > ~/odo-test/.env   # outside the repo
npx supabase functions serve read-odometer --env-file ~/odo-test/.env                              # leave running
scripts/test-read-odometer-local.sh ~/odo-test --last-km 195049
```

## Data retention

Location points are kept for 90 days. A pg_cron job (`prune-location-points`,
03:00 Colombo every night) deletes older ones in batches; sharing periods and
the latest position per driver stay.

`OFFICE_MCP_KEY` is an Edge Function secret (at least 32 characters). Sahan
sets it himself with `npx supabase secrets set`; it is never committed.

Smoke test of the deployed connector (wrong key gives 404, lists the tools,
calls three read-only tools):

```bash
export OFFICE_MCP_KEY='...'    # in your own terminal
scripts/test-mcp.sh
```

## Tests

Everything here runs against a local Supabase stack in Docker and never
touches the real project.

```bash
source ~/.nvm/nvm.sh && nvm use
npx supabase start

# 1. Database rules, pgTAP (needs an empty local database): access rules, permissions, the
#    task plan, accept/decline, issues, notifications, custodians and booking, Phase 6's
#    requests, fuel videos, sites and imports, the Google call counter and the arrival points
npx supabase db reset --local
npx supabase test db                 # last line: Result: PASS

# 2. The office tools, end to end, through both channels: every tool, plus what the
#    driver app does; then the tool answers are compared with the artifact's contract
#    (scripts/tool-shapes.json), then the smoke test
printf 'OFFICE_MCP_KEY=%s\nSERVER_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > /tmp/office-mcp.env
npx supabase functions serve --env-file /tmp/office-mcp.env                   # all functions; leave running
scripts/test-mcp-local.sh /tmp/office-mcp.env                                 # in a second terminal
# After a change that is meant to alter a tool's answer: SHAPES=write scripts/test-mcp-local.sh /tmp/office-mcp.env
# Run it between 01:40 and 21:15 Colombo: the route checks straddle midnight before that,
# and after 21:15 the tasks fall on tomorrow. With VAPID keys in the env file the suite
# pushes a real encrypted notification into a sink on the laptop; without them it checks
# the dead rows instead.

npx supabase stop                    # when finished
```

Type check, lint and tests of the two Edge Functions (Deno is not installed
on the laptop, so it runs in Docker):

```bash
docker run --rm --cpus 2 --memory 2g -v deno-cache:/deno-dir -v "$PWD/supabase/functions:/fn:ro" \
  -w /fn denoland/deno:alpine \
  sh -c 'cd /fn/_shared/fleet && deno check index.ts && deno lint && deno fmt --check && deno test \
         && cd /fn/office-mcp && deno check index.ts && deno lint && deno fmt --check \
         && cd /fn/office-api && deno check index.ts && deno lint && deno fmt --check \
         && cd /fn/read-odometer && deno check index.ts && deno lint && deno fmt --check \
         && cd /fn/push-task && deno check index.ts && deno lint && deno fmt --check \
         && cd /fn/fleet-jobs && deno check index.ts && deno lint && deno fmt --check \
         && cd /fn/notify-office && deno check index.ts && deno lint && deno fmt --check'
```

## Data credits

The `towns` table (used for "Near <town>") holds names and coordinates of
populated places in Sri Lanka from the [GeoNames](https://www.geonames.org)
geographical database, licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source file: <https://download.geonames.org/export/dump/LK.zip>, downloaded 2026-10-07.
- Kept: feature class P (populated places), 17,837 rows. Left out: 18 places
  marked abandoned (feature code PPLQ) and one entry that is a private house.
- Columns used: geonameid, name, latitude, longitude, population.

The map search's public places and the dashed "estimated" lines over GPS gaps
come from [openrouteservice](https://openrouteservice.org) (HeiGIT) on
[OpenStreetMap](https://www.openstreetmap.org/copyright) data (© OpenStreetMap
contributors, ODbL); the office map under the open package is
[OpenFreeMap](https://openfreemap.org) on OpenStreetMap data. The operators'
site lists (Dialog, Mobitel) are the company's own files.

Under the Google package (Phase 6 Part 5) the maps are Google's (Google's own
credit on the map) and the location search credits Google's results as
"Google Maps". Google's content is never shown on another map, a Google place
is never saved as one of ours, and every Google call is counted against a cap
before it is made: `docs/google-maps-setup.md`.
