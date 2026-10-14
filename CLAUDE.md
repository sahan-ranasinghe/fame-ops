# Fame Fleet: driver app + fleet office for Fame Global Solutions

## What this is
- **Fame Driver**: an Android app for drivers. Drivers sign in with a username and 6-digit
  PIN (no Claude account). It shows their tasks, shares their location in the background,
  logs odometer readings with photos, logs fuel, and reports vehicle problems.
- **Fame Fleet (office)**: designed by the boss (see `design/`). Office users (the boss and
  the fleet admin) keep working in Claude Teams. They use our MCP connector `office-mcp`
  directly in Claude chat, and later a Claude artifact built from the office screens in
  `design/` that calls the same connector. There is NO separately hosted office web app.
- **Backend**: Supabase (Postgres, Auth, Storage, Edge Functions).
- Gallery HR / HR features are a separate, later project: do not build them.

## UI source of truth: the boss's design
- `design/png/` (one PNG per screen) and `design/fame-fleet.pdf` (same screens, with text).
  `design/fame-fleet.html` is a bundled viewer; its text is not readable, so use the PNGs/PDF.
- Driver app screens: `Driver · Today.png`, `Driver · Task in progress.png`,
  `Driver · Log mileage.png`. Bottom tabs: Today, Mileage, Report, Me.
- Office screens (Phase B, not now): `Desktop · Overview / Live locations / Tasks /
  Vehicles / Project costs.png`, `Office · Home.png`, `Office · Approve request.png`.
- Match layout, wording, hierarchy and style. Screens not designed yet (login, permissions,
  Mileage tab, Report tab, Me tab) must be built in the same style.

### Design tokens (sampled from the PNGs)
- Ink / dark header `#15181c`, dark surface `#22272c`, page background `#f3f2ee`,
  card `#ffffff`, map land `#e9e7e0`.
- Accent amber `#f2a900`: primary buttons (Start task, Save & finish task), active tab pill.
- Blue `#1e4fa0`: live / sharing / in progress; blue chip background `#e6edf8`.
- Amber text `#8a5a00`: stale / warnings. Red `#b3261e`: danger, not sharing, expired.
- Fonts: closest Google Fonts to the PNGs: IBM Plex Sans (body), IBM Plex Mono (plates,
  times, odometer numbers), a heavy grotesque for big headings (e.g. Archivo ExtraBold);
  compare with the PNGs. Sinhala: Yaldevi (body), Gemunu Libre (headings, big buttons),
  Noto Sans Sinhala as fallback. Plates are shown in mono inside a thin bordered chip.
- Numbers, plates, times and LKR amounts always in Latin digits, in both languages.

## Phases
- **A (today)**: backend + complete driver app (all four tabs) + connector tools so the
  office can run everything from Claude chat.
- **B (next)**: office artifact "Fame Fleet" from the office designs (Overview, Live
  locations, Tasks + Assign a task, Requests, Vehicles), desktop and mobile layouts.
- **A2 (now)**: push notifications for new, changed, reassigned and cancelled tasks
  (Expo push + FCM, `device_tokens`, trigger `tasks_notify_push` → pg_net → Edge Function
  `push-task`) and task sounds (channels with bundled sounds, expo-audio in the app).
  Details: `docs/push-notifications-plan.md`.
- **Phase 5 (done, 14 October 2026)**: dispatch with stops and a planned leave-by time,
  permissions per person, the issues centre, office notifications (web push) and the
  installable web app, the driver's accept / decline, custodians and booking by vehicle type
  in one step. Plan and as-built notes: `docs/dispatch-plan.md`; test plan:
  `docs/phase5-test-plan.md`; the driver strings for the Sinhala check:
  `docs/phase5-sinhala-strings.md`.
- **Route quality (14 October 2026, branch `route-quality`, local checkpoint)**: the phone
  stores raw fixes (150 m cut, jump, duplicate and jitter rules) and the server filters;
  uploads in batches of 500 with a backoff ladder, refused batches kept as rejected;
  heartbeat history (`driver_heartbeats`); timeline kinds no_gps / no_data and "uploaded
  later"; full-resolution line for the web, Realtime on `location_points`; smoothing,
  confidence drawing, labelled holes, headed gliding markers; snap to roads behind the
  `map_matching` setting. As built and the phone test steps: `docs/route-quality-plan.md`.
- **C (later)**: Project costs; WhatsApp automation; pushing costs to
  Zoho Books; daily allowance claims in the driver app (our addition, waiting for the
  boss's OK; tables may exist, no UI yet); an audit page (needs a tool).

## Hard rules
1. Drivers never need a Claude account.
2. Office access = Claude for the boss and Sahan, and the office web app `apps/office`
   (Cloudflare Pages, `*.pages.dev` for the pilot) for everyone else; approved by the boss on
   9 October 2026, plan in `docs/office-web-plan.md`. Both call the same rules in
   `supabase/functions/_shared/fleet` through `office-mcp` and `office-api`. No other hosted
   app. How Claude reaches the fleet: our Claude Teams workspace has ONE org-wide custom
   connector named "Fame Fleet" (`office-mcp` with the shared OFFICE_MCP_KEY, an admin key),
   used by the boss and Sahan; the Fame Fleet artifact (source `apps/office/fame-fleet.html`)
   has no key of its own, it uses the viewer's "Fame Fleet" connector. Never two connectors
   named "Fame Fleet" in one account. The test scripts use the same shared key. Personal keys
   (`office_keys`) exist for a person's own Claude account and for tests; the plan's later
   phase gives the connector OAuth sign-in so each Teams member is named without a key. The
   web app uses no connector and no key: every person signs in with their own account, and
   `office-api` checks their session and role on every call. Every person has their own
   account and role; writes are checked by the server and audited with the person's name. The
   artifact's tool names, inputs and JSON answers are a contract (`scripts/tool-shapes.json`):
   never change them in a way that breaks it.
3. Do NOT use the official Supabase MCP connector for the office (it gets full write access
   to the whole org). Our connector exposes only the tools listed below.
4. Do NOT modify the existing "Fame Group Allowance Desk" artifact. Its business rules are
   in `docs/Allowance_Desk_How_It_Works.md`. That file contains internal company IDs:
   keep this repo private.
5. Secrets never go in the app, in the browser or in git. The driver app and the web app
   only get the Supabase URL and the publishable (anon) key and are protected by Row Level
   Security; office writes go through `office-api`, which alone runs as service role. The
   service_role key, OFFICE_MCP_KEY, SERVER_KEY and the VAPID keys live only in Edge Function
   secrets (the VAPID public key reaches the browser through `my_notification_settings`).
   `.env*` files are gitignored.
6. Times stored as timestamptz (UTC), shown in Asia/Colombo.
7. Money: LKR stored as integer cents (bigint).
8. No Zoho calls from our code. The office's existing Zoho connector in Claude reads Zoho
   and sends us projects through `import_projects`.
9. Location is recorded only while "On duty" is on (the app's wording since Phase 5; the
   code and the tables still say sharing). Starting a task turns it on automatically; the
   driver can turn it off when not working.

## Environment notes (Sahan's laptop)
- Ubuntu, Node managed by nvm. The default Node (v22) belongs to another project: never
  change it, never run `nvm alias default`, never install anything globally with sudo.
- This repo uses the Node version in `.nvmrc` (v24.21.0). Every Bash command that runs
  node, npm, npx or eas must start with: `source ~/.nvm/nvm.sh && nvm use >/dev/null && `
- Supabase project ref: hinurfsaxvplbyqgtozj (already linked).
- Expo: logged in as `fameops`. The app's owner is the Expo organisation `fame-global`
  (`owner` in app.json). App name "Fame Driver".
- Never print, log or commit secrets. Sahan sets secrets himself with
  `npx supabase secrets set`.

## Stack (driver app, `apps/driver`)
- Expo (React Native, TypeScript), Android only for now, development build (expo-dev-client).
- expo-location + expo-task-manager: background location with an Android foreground
  service ("Sharing my location" notification, both languages).
- @maplibre/maplibre-react-native with OpenFreeMap tiles
  (`https://tiles.openfreemap.org/styles/liberty`, no API key) for the task map.
- Odometer OCR: on-device Google ML Kit text recognition through a React Native library
  that works in an Expo dev build (e.g. @react-native-ml-kit/text-recognition). It only
  suggests a number; the driver always checks it. If the library breaks the build, remove
  it and keep manual entry.
- expo-image-picker (camera), expo-image-manipulator (resize to max 1600 px, JPEG ~0.7),
  expo-file-system, expo-sqlite (offline queue), expo-secure-store (session),
  expo-localization, expo-notifications (push from the server; a local notification for a
  new task only on a phone with no push token), expo-audio (short sounds on Start task and
  Save & finish task), expo-background-task (a WorkManager job about every 15 min that
  restarts a dead location service on Android ≤ 11 and, on Android 12+, shows "Location
  sharing stopped. Tap to turn it back on"), expo-camera (installed for a later guided
  odometer camera; no screen yet), @supabase/supabase-js, @expo-google-fonts.
- `apps/driver/google-services.json` (Firebase, package com.fameglobal.driver) is NOT
  committed; builds get it from the EAS file variable GOOGLE_SERVICES_JSON through
  `app.config.ts`. Sounds are made by `scripts/make-sounds.sh` (ffmpeg tones), never
  downloaded. App version 1.1.0 = the first build with push; updates target that runtime.
- ALL native modules are installed before the first development build, so the rest of the
  day is live reload (`npx expo start --dev-client`) without new builds.
- Background location does not work properly in Expo Go: always use the dev build.
- i18n: all UI text in `src/i18n/en.json` and `src/i18n/si.json`. No hard-coded strings.
- Links: Navigate = `https://www.google.com/maps/dir/?api=1&destination=<lat,lng or address>`,
  call = `tel:`, WhatsApp = `https://wa.me/<number>`.

## Stack (office app, `apps/office`)
- Vite 7 + React 19 + TypeScript + react-router 7, no UI library; the artifact's CSS is
  `src/styles.css` unchanged (design tokens from this file). Node from `.nvmrc`; run
  everything with `./node_modules/.bin/<tool>` or `npm run` from `apps/office`.
- One source, two builds: `npm run build:web` → `dist/` (Cloudflare Pages, code-split,
  `public/_redirects` for the SPA) and `npm run build:artifact` → `dist-artifact/index.html`
  (vite-plugin-singlefile, no Supabase code inside; `__BUILD__` from `vite.config.ts`).
  Every screen of the published artifact is ported (Phase 4 done). Republish from
  `dist-artifact/index.html` to Sahan's test artifact (1cUAyZpGXt94XfKXoJntHT) only with his
  go-ahead, never to the Teams copy (RsGzozM5V4qCv4UeAECatu, made in his Teams chat; he
  updates it himself from the file + message we give him). V6vpsqYZoF1WiQQb7wMjKP is a
  different artifact: never publish to it. The capability
  declaration MUST name the connector exactly as claude.ai shows it: `src/connector.json`
  holds `"Fame Fleet"`, the page's calls read it, and `npm run build:artifact` writes the
  matching declaration (connector name + every tool the source calls) to
  `dist-artifact/capabilities.json` through `scripts/artifact-declaration.mjs`. Publish with
  that file's content unchanged; the mcp__ tool-prefix segment is NOT resolved for you.
- `src/transport`: the `Transport` interface (`me`, `call`, `watch`, `invalidate`),
  `ClaudeTransport` (window.claude → the viewer's "Fame Fleet" connector, `watchTool` with
  refetchInterval) and `ApiTransport` (office-api with the session; `watch` polls on the
  same intervals: overview and board 30 s, requests 60 s; `invalidate` refetches every watch).
  Errors become `{ code, message }` and `errors.ts` turns them into one sentence + a fix.
- `src/data/store.ts`: one entry per key (`overview`, `board`, `reqs`, `reqWaiting`,
  `issues` (the bell), `issuesAll` (the Issues page), `lists.*`); screens use `useEntry` / `useWatch` / `useLists` (a list load that fails on a
  dropped connection is retried twice by itself, then the form shows the error with Try again).
  Menus are filtered by `me.tools`; the server is the guard.
- Web sign-in (`src/auth`): e-mail + password → (2-step on for this person? the code page,
  `mfa.getAuthenticatorAssuranceLevel` says nextLevel aal2) → `GET /me` → ready. A
  `create_office_user` link lands with a recovery session → `/set-password`
  (`PASSWORD_RECOVERY`, or `type=recovery` in the hash) → `updateUser({ password })` →
  straight to Overview. 2-step sign-in is OPTIONAL for every role (decided 12 Oct 2026):
  the Settings page (web only, lazy) turns it on or off (`TotpEnrol`: QR + secret + one
  code). If office-api answers 403 `mfa_required` (secret `REQUIRE_MFA_ROLES` set), the
  second-step page makes the person set it up first. Office passwords: 12+ characters
  (`MIN_PASSWORD`, the set-password page only). Auth's own minimum password length stays 6
  (dashboard and config.toml): drivers' 6-digit PINs are passwords in the same Auth project,
  and `create_driver` / `reset_pin` fail with anything higher. Sign-out resets the
  URL to `/`. Browser holds only the URL and the anon key (`.env.local`, gitignored;
  `.env.example` committed).
- Live locations (`src/screens/Live.tsx`, Phase 3): the list, the map and the detail card
  from `live_drivers` (watched every 30 s), plus `driver_route` for "Today's route". One
  `MapProps` interface, two maps (`src/map`): `DrawnMap` (the artifact's SVG, both builds)
  and `MapLibreMap` (web only, lazy chunk, OpenFreeMap Liberty tiles, markers animated
  over ~1 s, falls back to the drawn map when the style cannot load). On the web a
  Realtime channel on `driver_latest` (`src/data/realtime.ts`) moves a marker at once
  (`applyLatest` in `src/data/live.ts`); the states age every 30 s (`refreshStates`,
  the server's 15-minute rule). `live_drivers` cards carry `employee_id`, `lat`, `lng`
  (additive; the contract snapshot records no live driver rows, so it did not change).
  "Show today's trails" draws every sharing driver's line today (one `driver_route` call
  each, then grown point by point from ONE Realtime channel on `location_points` filtered to
  the drivers currently sharing, each point inserted by its time; the trails and the shown
  route are fetched again every 60 s as the fallback; never one point per upload); the
  detail card links to the driver page.
- Driver page (`src/screens/DriverPage.tsx`, route `/drivers/:username`, opened from a
  driver's name on Drivers, Live locations, the map card and Overview's on-the-road list;
  since 14 October: the line at 3 m tolerance, every new point through Realtime on
  `location_points` inserted by time (`insertPoint` in `src/data/route.ts`), poor fixes thin
  and lighter, holes dashed and labelled, the "Snap to roads" toggle and legend when a provider
  is set, markers gliding over the real time between positions and turning to the heading):
  name, phone (Call / WhatsApp), status with the last position time, vehicle and task,
  the day's numbers (GPS km, driving time, stopped time, stops), the map with the route
  coloured by speed (standing / under 20 / 20–60 / over 60 km/h), stops as circles with
  their times, data gaps dashed, a date bar (Today / Yesterday / a date), the timeline
  beside the map (a row zooms the map to it) and, web only, playback (`usePlayback`:
  Play / Pause, ×10 ×60 ×300, a time slider, a marker with time and speed). Data: one
  shared builder `supabase/functions/_shared/fleet/route.ts` (imported as `@fleet/route`,
  with `@fleet/track`) feeds `driver_route`; the page watches it every 60 s for today
  (once for a past day) and grows today's line at once from the driver_latest Realtime
  rows (`appendLive` in `src/data/route.ts`); no Realtime on location_points. The task
  drawer shows the task's own route (`driver_route(task_id)`) with GPS km next to the
  odometer. The artifact has the same screens on the drawn map, polling, no playback.
- Phase 4 screens (`src/screens`): Vehicles (filters, table, register/update drawer with an inline
  rental company), Drivers (add with a one-time PIN, manage: phone/licence, new PIN, switch
  off with a second click), Mileage (month/vehicle/driver; tiles incl. km outside tasks; by
  vehicle, biggest gaps, unlogged km, odometer checks as generic tables), Maintenance (reports
  with status/note/"take off the road", service and document reminders from the overview),
  Projects (find + the Zoho import message), Accounts (admin: add office user → one-time
  set-password link shown once, new link, switch off, personal connector keys shown once,
  revoke). Buttons appear only when `me.tools` allows the tool; the server guards. Phone tabs:
  Home, Map, Tasks, Vehicles, More (More lists the rest). No audit page yet (no tool for it).
- `npm run dev:live` runs the dev server against the REAL project (`.env.live.local`,
  gitignored, publishable key only) for a laptop trial; `npm run dev` uses `.env.local`.
- Requests (Phase 5 Part 6): the new-request form has "A driver is needed" (unticked = the
  custodian drives) and, for someone with `book_vehicle`, the "Assign now" section
  (`suggest_vehicles` for the day and time, the four groups with the custodian's links and
  "ask first", the free drivers, "Book now" → `book_vehicle`, or "Save as waiting"). The
  request drawer shows the timeline (sent → seen → decided / cancelled), the groups, "the
  custodian drives" when no driver is needed, and Cancel booking (`cancel_request`) on an
  approved one. The Vehicles board has an "Assigned to" column and the availability line;
  the vehicle drawer has the custodian fields ("none" clears).
- Settings → Notifications (`src/screens/settings/Notifications.tsx`, web only, lazy; the
  artifact points to the web app): this browser's push state in words (`notificationsLogic.ts`),
  Turn on / off in this browser (`src/push.ts`: permission → `pushManager.subscribe` with the
  public key from `my_notification_settings` → `register_web_push`; off = unsubscribe +
  `remove_web_push`), a checkbox per event the person's permissions can bring, the browsers
  with notifications on (Remove). `WebApp` registers `public/sw.js` after sign-in (push →
  showNotification; a tap focuses the open window and posts `{type: "navigate", url}` to the
  router, or opens one); `/tasks?task=<id>` opens that task. The web build is installable:
  `public/manifest.webmanifest`, `public/icons/*` (made by `scripts/make-icons.mjs` with the
  e2e's Chromium), the head tags come from the `pwaTags` plugin in `vite.config.ts` (web only).
- Hosting: Cloudflare Pages project `fame-fleet`, https://fame-fleet.pages.dev, direct upload:
  `npm run build:web` (reads `.env.production.local`, gitignored) then
  `npx wrangler pages deploy --branch main` from `apps/office` (`wrangler.toml`). Deploys to
  Cloudflare need Sahan's go-ahead like Supabase deploys. The set-password links and CORS
  come from the Edge Function secret `OFFICE_WEB_URL` (the Pages address; localhost:5173
  stays allowed for CORS in code).
- Checks: `npm run typecheck`, `npm test` (Vitest: transports, form rules, Overview, live rules),
  both builds, `npm run test:e2e` (Playwright against the LOCAL stack: set-password link →
  Overview → assign and cancel a task → the live map with a Realtime position → vehicles,
  drivers, maintenance, mileage, projects, accounts → 2-step on in Settings → sign out and in
  with the code; the local stack must run Realtime). All of it:
  `scripts/test-office-local.sh <functions env file>` (before the e2e it waits until Realtime
  delivers a driver_latest change: a `db reset` restarts the Realtime container and its change
  stream takes about half a minute more, during which subscriptions succeed but deliver nothing). The e2e uses the snap Chromium
  (`PW_CHROMIUM=/snap/bin/chromium`, profile under `~/snap/chromium/common`); no browser download.
- Local Auth redirects for the dev server are in `supabase/config.toml` (`site_url`
  localhost:5173); the real project's Site URL and redirect URLs are set in the dashboard.

## Data model
- `employees`: id uuid, code (unique), name, phone, email (office people, unique),
  role ('driver'|'staff'|'viewer'|'office'|'fleet_admin'|'admin'), active, language
  ('en'|'si'), licence_expiry (date, nullable), current_vehicle_id (nullable),
  auth_user_id (unique, nullable), created_at, updated_at. Which tool each role may call:
  `supabase/functions/_shared/fleet/roles.ts` (the permission table of the plan).
- `office_keys`: personal connector keys for Claude (employee_id, key_hash sha256, label,
  created_at, last_used_at, revoked_at). Service role only.
- `rental_companies`: id, name, phone.
- `vehicles`: id, reg_no (unique, e.g. "WP CAB-4521"), make_model ("Toyota HiAce"),
  vehicle_type ('car'|'van'|'double_cab'|'lorry'|'other'), seats, rental_company_id,
  rent_until (date), monthly_rent_cents, monthly_km_allowance, regular_driver_id,
  current_odometer_km, service_interval_km, last_service_odometer_km, next_service_date,
  garage_booked_date, in_garage (bool), licence_expiry, insurance_expiry,
  emission_expiry, active. Status shown = in_garage → "In garage", has an in-progress
  task → "On a task", else "Available". Phase 5 Part 6: `custodian_employee_id`
  and `custodian_note`: the office person a pooled vehicle is assigned to ("Assigned to" on the
  Vehicles board, "ask first" when the office books it; with `driver_required` false they
  drive it themselves: the task's employee is then an office person, with no app behind it, and
  the leave-by / accept reminders and the not-accepted / late-start issue rules skip it).
- `places`: id, name ("Head office, Colombo 05"), address, lat, lng (nullable),
  kind ('office'|'store'|'site'|'other').
- `towns`: id, name, lat, lng. Seed from GeoNames Sri Lanka populated places (CC BY 4.0,
  credit in README). Used for "Near <town>".
- `projects` (Zoho Books jobs): id, zoho_project_id (unique), job_no ("13021"),
  short_name ("TRKAN1"), name, customer_id, customer_name, status, updated_at.
  Filled by `import_projects`. Matching rules: section 7.2 of the Allowance Desk doc.
- `tasks`: id, title ("Team drop · Kurunegala site"), label (short project label shown on
  cards, e.g. "Mobitel MS"), employee_id (driver), vehicle_id, start_at (planned),
  end_by (nullable), passengers, contact_name, contact_phone, notes,
  status ('assigned'|'in_progress'|'completed'|'cancelled'), sent_at, seen_at,
  started_at, completed_at, start_odometer_km, end_odometer_km, km (computed),
  request_id (nullable), created_by (text), cancelled_reason, plus the plan (Phase 5 Part 4):
  start_place_id/start_name/start_lat/start_lng (where the trip starts; default the base
  place or the first stop), return_to_base, avoid_expressway, leave_by, leave_by_source
  ('plan'|'manual'), buffer_min, plan_json (legs, warnings, settings used), plan_version
  (update_task_stops must send the one it loaded), reminder_30_sent_at, reminder_0_sent_at.
  start_at = leave_by. Accept / decline (Phase 5 Part 5): status also 'declined'; accepted_at,
  declined_at, declined_by, declined_reason ('vehicle_problem'|'not_available'|'unwell'|'other'),
  declined_note, declined_after_accept, accept_reminder_sent_at. The driver calls the RPCs
  `accept_task(p_task_id, p_at)` and `decline_task(p_task_id, p_reason, p_note, p_at)` (security
  definer; only the task's driver, only while assigned; answers 'accepted' | 'declined' |
  'already_started' | 'already_reassigned' | 'already_declined' | 'cancelled'; the earliest
  accepted_at wins; starting a task accepts it). `task_assignment_events` (task_id, at, action
  'assigned'|'accepted'|'declined'|'reassigned'|'cancelled', employee_id, vehicle_id, actor,
  note): drivers read their own tasks' rows, the office sees them in task_detail. Pushes: a
  reassigned task is 'removed' to the old driver only if he had accepted it; 'accept_reminder'
  once, accept_within_min after sending or accept_before_leave_min before leave-by
  (`queue_accept_reminders`, in the task-reminders minute job).
  Planner: `_shared/fleet/plan.ts` (pure; leave-by from the deadlines
  minus the buffer, dwell per stop kind); road times: `routing.ts` (ROUTING_PROVIDER
  secret: ors with ORS_KEY, google with GOOGLE_ROUTES_KEY, or estimate = straight line ×
  road_factor ÷ avg_speed_kmh when unset; `route_legs` cache 30 days, `routing_calls` per
  day, rush-hour factor from settings); `eta.ts` (`task_eta`, 2-minute cache) for the
  running task's ETA and "late by N min". `fleet_settings` (key, value jsonb, updated_by):
  dwell_min, buffer_min, base_place_id (null until an admin picks a real place: no seeded
  sample place), avg_speed_kmh, road_factor, accept_within_min, accept_before_leave_min,
  rush_hour, self_drive_allowed (default true; off = every booking needs a driver, the
  request form hides "A driver is needed" and the custodian-drives path). The pg_cron job
  `task-reminders` (every minute) queues leave_30 / leave_now
  pushes through `send_push`.
- `task_stops`: id, task_id, seq, type ('pickup'|'drop'|'visit'), place_id (nullable),
  place_name, address, lat/lng (nullable), status ('pending'|'arrived'|'done'|'skipped'|
  'removed'), arrived_at, done_at, what ('people'|'goods'|'documents'|'other'), note,
  dwell_min, arrive_by (deadline), planned_arrive_at, planned_depart_at, skip_reason
  ('closed'|'nobody_there'|'not_needed'|'not_visited'|'other'), skip_note, removed_at.
  The design shows one pickup and one drop-off; up to 12 stops allowed. A stop the office
  edits out is marked 'removed' (never deleted) and shown nowhere; the driver's unfinished
  stops at Save & finish become skipped · not_visited.
- `task_projects`: task_id, project_id (null = Fame internal), percent. Sum = 100 per task.
- `odometer_logs`: id, vehicle_id, employee_id, task_id (nullable), reading_km,
  ocr_value (nullable), photo_id, kind ('task_start'|'task_end'|'manual'), logged_at,
  entry ('photo'|'photo_changed'|'typed_unreadable'|'typed_offline'), photo_attempts,
  and server-only ai_value, ai_status, ai_checked_at, ai_attempts, flag.
  Every log updates vehicles.current_odometer_km.
- `fuel_logs`: id, vehicle_id, employee_id, task_id (nullable), litres, amount_cents,
  receipt_photo_id, odometer_km (nullable), logged_at.
- `vehicle_reports`: id, vehicle_id, employee_id, task_id (nullable),
  category ('breakdown'|'accident'|'tyre'|'warning_light'|'other'), note,
  status ('open'|'in_garage'|'closed'), created_at, closed_at, office_note.
- `vehicle_requests`: id, requested_by_name, requested_by_employee_id (nullable),
  requested_by_user_id (the Auth account that submitted it), project_id (nullable),
  project_label, needed_at, back_by, route_from, route_to, need_type, pax, tools (bool), note,
  driver_required (false = the custodian drives), one_step (booked directly by the office),
  status ('waiting'|'approved'|'declined'|'cancelled'), seen_at / seen_by (the first time
  someone who approves opens it), decided_at, decided_by, decline_reason, task_id,
  cancelled_at / cancelled_by / cancel_reason. `office_book_vehicle(request, task, stops,
  projects, decided_by)` inserts the request (one_step, seen) and its task through
  `office_create_task` in one transaction.
- `photos`: id, employee_id, kind ('odometer'|'fuel_receipt'|'vehicle_report'|'bill'),
  storage_path, taken_at, lat, lng, plus nullable links (odometer_log_id, fuel_log_id,
  vehicle_report_id, claim_line_id).
- `duty_sessions`: one row per "Sharing my location" on → off period: employee_id,
  vehicle_id, started_at, ended_at, end_reason ('driver'|'auto'|'admin'), device_info.
  At most one open session per employee. (Odometer columns, if they exist from an earlier
  migration, are unused: odometer is per task now.)
- `location_points`: id bigint identity, employee_id, session_id, recorded_at, lat, lng,
  accuracy_m, speed_mps, heading, battery_pct, is_mock, source ('app'), received_at.
  Unique (employee_id, recorded_at); uploads use on conflict do nothing.
- `driver_latest`: employee_id PK, session_id, lat, lng, accuracy_m, speed_mps,
  battery_pct, recorded_at, sharing (bool), plus the heartbeat columns hb_at, hb_sharing,
  hb_location_on, hb_permission ('always'|'foreground'|'denied'|'unknown'), hb_battery_pct,
  hb_app_version, hb_queued_points, hb_location_off_since (written by `send_heartbeat()`).
  Kept current by trigger (only newer points win).
  Also hb_rejected_points, hb_data_available, hb_app_state, hb_fix_age_s and the last point's
  heading (migration `route_quality`). In the Realtime publication; office roles (admin,
  fleet_admin, office, viewer) read it through RLS (`current_office_role()`, migration
  `office_read_access`), drivers and staff read nothing. The same roles read all tasks,
  task_stops and (since `route_quality`) location_points through RLS; location_points is in
  the Realtime publication too (the driver page grows its line point by point). Everything
  else the office reads comes through the tools. No policy checks aal2.
- `driver_heartbeats`: the heartbeat history (employee_id, at, session_id, sharing, location_on,
  permission, battery_pct, app_state, data_available, fixes_seen, fixes_stored, dropped_accuracy,
  dropped_jump, dropped_jitter, dropped_duplicate, last_gps_fix_age_s, queued_points,
  rejected_points, app_version, received_at; unique employee_id + at). Drivers insert their own
  rows in batches, office roles read; pruned after 30 days by the nightly `prune_location_data()`
  job (points 90 days, heartbeats 30, `route_matched` 90).
- `route_matched`: a driving leg snapped to roads (employee_id, date, provider, leg_from,
  leg_to, geometry [[ms, lat, lng]…], matched_at, status, error). Service role only.
- `office_audit`: id, at, tool, args_summary, result_summary, actor_employee_id,
  actor_name, channel ('claude'|'web'|'driver'). Office tools write it through both
  channels; triggers add the driver app's task starts/finishes and problem reports.
- `device_tokens`: id, employee_id, token (unique, Expo push token), platform, device_model,
  app_version, language, created_at, updated_at. Drivers read their own; they write through
  `register_device_token()` / `remove_device_token()`.
- `push_log`: one row per push-task call (task_id, employee_id, kind, tokens, sent, failed,
  errors). Service role only.
- `issues` (Phase 5 Part 3a): one row per thing that needs the office's attention: kind
  (vehicle_report, odometer_flag, km_gap, service_due, document, licence, allowance, rental,
  garage_booked, signal, late_start, running_late, not_accepted, declined, request_waiting,
  push_failed, routing_failed), severity ('info'|'warning'|'critical'), title, detail, due,
  sort_key, the links (vehicle_id, employee_id, task_id, request_id, vehicle_report_id),
  ref_key (unique while open or in progress), status ('open'|'in_progress'|'resolved'|
  'dismissed'), assigned_to, opened_at, updated_at, resolved_at, resolved_by ('system' or the
  person), resolution_note, auto. `issue_events`: opened, assigned, note, status,
  auto_resolved with actor and from/to. Office people with `view` read both through RLS;
  `issues` is in the Realtime publication (the web's bell). The rules live in
  `_shared/fleet/issues.ts` (`computeWanted` + the pure `reconcile`; `syncIssues(db, now,
  scope?)` opens, updates in place and auto-resolves). `fleet_overview` runs `syncIssues`
  and answers `needs_attention` from the active issues (with issue_id, kind, severity).
  The Edge Function `fleet-jobs` (x-server-key = SERVER_KEY) runs a sync when pg_cron
  (`fleet-sync`, every 5 min) or the triggers on vehicle_reports, tasks and vehicle_requests
  call `fleet_sync(scope)` → `call_edge_function` (Vault functions_url / server_key). A key
  a person resolved or dismissed stays quiet for 30 days unless it comes back worse. Who
  reads `issues` / `issue_events` (RLS, `issue_visible(kind)`): the issues permission every
  row, assign_tasks the task kinds (signal, late_start, running_late, not_accepted, declined),
  nobody else; the view permission alone reads nothing. `job_runs` (job, started_at,
  finished_at, result; service role only) records the full sync: `fleet_overview` skips its own
  sync when one finished (or is running since) under 60 s ago (`syncIssuesIfStale`).
- Office notifications (Phase 5 Part 3b): `web_push_subscriptions` (employee_id, endpoint
  unique, p256dh, auth, user_agent, created_at, last_ok_at, removed_at, removed_reason
  'user'|'gone'; nothing deleted), `notification_settings` (employee_id, event, enabled; no row
  = on), `notifications` (the outbox: event, payload {title, body, url, tag, …},
  recipient_employee_id, channel 'web_push'|'email', status 'queued'|'sent'|'failed'|'dead',
  attempts, next_try_at, sent_at, error). All service role only. `queue_notification(event,
  payload, recipients[])` (security definer) writes one row per active office recipient who
  has the event on and a browser; the trigger `notifications_deliver` →
  `call_edge_function('notify-office', {id})`; cron `notify-retry` (5 min) → `{retry: true}`
  when a row is due (backoff 1, 5, 15, 60 min; dead after 5). Events (`_shared/fleet/
  notifications.ts`: `EVENTS`, pure `recipientsFor`, `notifyEvent`): request.created (approve),
  request.decided (the requester), task.declined and task.not_accepted (approve + assign_tasks;
  written in SQL by `decline_task` and `queue_accept_reminders`), issue.opened (critical only,
  issues; from `syncIssues`), issue.assigned (the assignee); vehicle.booked /
  vehicle.booking_cancelled come with Part 6. The sender never gets their own event.
- `odometer_reads`: one row per `read-odometer` model call (employee_id, vehicle_id,
  photo_path, last_km, gps_km, reading_km, confidence, status, mode ('driver'|'server'),
  log_id, model, ok, error, ms, created_at). Service role only.
- Claims tables (`allowance_types`, `claims`, `claim_lines`, `claim_sites`) may exist from an
  earlier migration. Keep them; no UI or tools until Phase C.

Storage: private bucket `driver-photos`, path `<employee_id>/<yyyy-mm-dd>/<uuid>.jpg`.
The office sees photos only through 1-hour signed URLs returned by connector tools.

### Business rules
- Start task: start odometer is prefilled from vehicles.current_odometer_km; the driver
  confirms or corrects it. If it differs from the last logged reading by more than 2 km,
  flag "unlogged km" for the office.
- Task km = end_odometer_km − start_odometer_km (must be ≥ 0).
- Driver status (ONE rule, `supabase/functions/_shared/fleet/status.ts`, used by live_drivers,
  fleet_overview, the web app and the artifact; the web imports the same file as
  `@fleet/status`): Live = last GPS point under 3 min (blue); Location off = the phone's last
  heartbeat (under 3 min old) says Location services off or the permission not "always", with
  "since HH:MM" (red); No signal = sharing on but no point and no fresh heartbeat for over 3 min,
  or a fresh heartbeat with no GPS fix (amber); Not sharing = the driver turned sharing off
  (red). Every card also carries `last_position_at` ("HH:MM") and the raw `signal` times. A task
  in progress that is Location off / No signal for 10+ min is in fleet_overview needs-attention.
  The old fields stay for the Teams artifact: Sharing = last point < 15 min; Stale = older;
  Not sharing = sharing off. "Seen by driver HH:MM" from seen_at; "Sent · not opened yet" if
  seen_at is null.
- Heartbeats (`apps/driver/src/lib/heartbeat.ts` → RPC `send_heartbeat` → columns `hb_*` on
  `driver_latest`, Realtime to the web): about every 60 s while sharing, at once when Location
  or the permission changes (checked every 10 s), once when sharing stops, and whenever the
  background job runs; sharing on/off, Location on/off, permission, battery, app version
  (`1.1.0+<update id>`), queued points. Queued offline like points, only the newest waits
  (`replaceOp`); the server ignores one older than the stored heartbeat and never stores a
  phone time after now(). Drivers only; the office reads the columns through RLS.
- Assign checks (warnings, not blocks): the vehicle has another task overlapping the time;
  the driver has another task at the same time; the vehicle is over its monthly km
  allowance; the vehicle is in garage; a document has expired.
- Document chips: orange when expiring within 30 days, red within 7 days or expired.
- Service due: next by km (last_service_odometer_km + service_interval_km) or by date.
- Km outside tasks: consecutive odometer readings of a vehicle are paired; a task's own
  start→end pair is task km, every other pair is a gap: between_tasks (same Colombo day) or
  overnight (next reading on a later day). A gap shows its window, the driver of the reading
  before it, and where the vehicle was at both readings (the photos' GPS). Monthly km vs the
  rental allowance always comes from odometer readings (everything the vehicle drove). Gaps
  over GAP_ATTENTION_KM (30, in fleet.ts) go to fleet_overview needs-attention for 7 days.
- Cost model (Phase C): fuel from fuel_logs; rent share = vehicle monthly rent split across
  jobs by km; split by task_projects percent; tasks with no project go to "Fame internal".

## Auth and RLS
- Supabase Auth email+password with synthetic email `<username>@drivers.fame.invalid` and
  the 6-digit PIN as password. Drivers only type username + PIN.
- Accounts are created by the connector tool `create_driver` (service_role).
- Helper `current_employee_id()` (security definer, stable, fixed search_path).
- RLS on every table. Drivers: read their own employee row, active vehicles, places,
  projects, towns; read their own tasks, task_stops, task_projects; update only the
  driver-side fields of their own tasks/stops (seen_at, started_at, completed_at,
  odometer fields, status changes they are allowed to make); insert/read their own
  duty_sessions, location_points, odometer_logs, fuel_logs, vehicle_reports, photos.
  Update employees.current_vehicle_id and language for themselves only.
  No access to office_audit, vehicle_requests or other drivers' rows. No anon access.
- Vehicles for drivers: only the columns id, reg_no, make_model, vehicle_type, seats,
  current_odometer_km, monthly_km_allowance, in_garage, active (column privileges). No
  rent, contract, regular driver, service or document columns. `select *` on vehicles
  (and `vehicles(*)` inside another query) fails for a driver, so the app keeps this
  list in one constant and uses it in every vehicles query.
- Storage policies: drivers upload/read only inside their own `<employee_id>/` folder.

## Driver app (Fame Driver), Phase A
Tabs: Today, Mileage, Report, Me.
1. Login (not designed): language, username, PIN.
2. Permissions (not designed): location "Allow all the time", notifications, battery
   optimisation help.
3. Today (designed): date, "Morning, <name>", සිංහල/English switch, current vehicle +
   Change, "On duty" toggle, NEXT TASK card (leave-by time, title, the first two stops,
   passengers · contact, Accept + Start task, or "Accepted ✓ HH:MM" + Start task, and the
   link "Can't do this task" → a reasons sheet: Vehicle problem / Not available / Unwell /
   Other, an optional note; a declined task leaves the list), "Later today" list (each
   row: Accepted / Not accepted yet). Records seen_at the first time a task is shown. Pull to refresh +
   Supabase Realtime.
4. Task in progress (designed): map with my position and the destination (straight line
   when the destination has coordinates), IN PROGRESS, Started HH:MM, destination,
   title · passengers, Distance left (straight-line, marked approximate), Arrive about
   (hide until routing exists), Start odo, Navigate, Call contact, Complete task,
   "Report a problem with the vehicle".
5. Log mileage (designed): odometer photo → OCR suggestion → driver checks; Odometer now;
   "Start: X · N km this task"; Did you add fuel? Yes/No → Litres, Amount (LKR), fuel
   receipt photo; Save & finish task. Reused from the Mileage tab for a manual log.
6. Mileage tab (not designed): this month's km for my vehicle vs its allowance, today's
   tasks with km, Log odometer, Log fuel.
7. Report tab (not designed): category, note, 1–3 photos, vehicle filled in, Send; list of
   my reports with status.
8. Me tab (not designed): name, code, phone, language, current vehicle, app version,
   sign out (disabled while a task is in progress).
Location required for work (`components/LocationGate.tsx`, like going online in a
ride-hailing app): Start task and switching "Sharing my location" on need Location services
on and the permission "Allow all the time". If not, a full-screen "Turn on Location" cover with
one big button opens Android's own dialog (`Location.enableNetworkProviderAsync`, fallback the
Location settings page; for the permission, the app's settings page); once Location is on the
driver continues where they were (`requireLocation(purpose, action)` in `state/app.tsx`);
"Not now" cancels. While a task is in progress and Location goes off, the same cover goes over
the whole app ("Location is off. Turn it on to continue the task") with "Call office"
(`EXPO_PUBLIC_OFFICE_PHONE` / app.json `extra.officePhone`; no button when empty) and "Report a
problem" still reachable, and disappears by itself when Location is back (checked every 5 s;
the cover looks every 2 s). Everything else (Me, Report, Mileage, sign out with no task running)
works with Location off. Texts under `gate.*` in en + si.
Back navigation rules (Android back button, our back arrow and the back gesture always do
the same thing):
- A screen opened from another screen is pushed on top of it. Back returns to that screen
  with its state kept (photos taken, failed photo count, numbers typed, fuel fields,
  selected category). Never jump to a tab route from inside a flow.
- "Report a problem" (from Log mileage and from Task in progress) opens the report form as
  a stack screen (`report-problem`) on top, with the vehicle and task filled in. Back
  returns to where it was opened. After Send it shows "Report sent" and returns there too;
  on Log mileage the "Type the reading" option is still available.
- After saving a flow (Start task, Save & finish task, manual odometer, fuel, report),
  return to where the flow started, not always to Today. After Save & finish the task
  screen (completed) shows a big "Back to Today" button, and back goes to Today.
- A form with unsaved input asks "Discard changes?" on the driver's own back (en + si).
  Nothing typed: no question. Never after a successful save, on a notification tap, or
  when the session ends and the app moves to Login. While Save is running, back does
  nothing. (`components/navigation.ts`, `useLeaveGuard`.)
- A sheet, dialog, picker or the camera closes first; the next back leaves the screen.
- Login and Permissions (first run) are replaced, not pushed: after signing in, back
  cannot return to Login; after sign-out, back cannot return into the app.
- A notification tap that opens a task puts Today underneath, so back from that task goes
  to Today, not out of the app. If a form with unsaved input is open, the task is pushed
  on top of it instead, so back returns to the form with its data.
- Back on Today puts the app in the background. It never signs out and never stops
  "Sharing my location". Back from Mileage, Report or Me goes to Today, then the app goes
  to the background. A list that opens a screen (Today's lists, today's tasks on Mileage)
  gets it back on back.

Offline: location points, odometer/fuel logs, reports, photos and heartbeats are queued on the
phone and retried. The point queue (SQLite) has no cap: a parked vehicle adds about 60 points
an hour, a moving one about 720 (one every 5 s), about 150 bytes each, so a 10-hour day is
~1 MB. Uploads go in batches of 500 with a 45 s limit per request (`UPLOAD_TIMEOUT_MS`), one
batch after another until the queue is empty, from the location task (every ~60 s or 10+
points), every heartbeat, on refresh (forced), and from the background job; after a failed
connection the next try waits 5 s, 30 s, 2 min, 5 min, then every 5 min (`sync/engine.ts`
BACKOFF_MS; a forced flush ignores it). A batch the server refuses for good is never dropped:
it is marked rejected (status + message) and put back in line once a day, after an app update
and on pull to refresh; the heartbeat reports `rejected_points` and the office status line says
"N points refused". driver_latest keeps the newest point by recorded_at whatever the upload
order, and driver_route orders by recorded_at. Location: a fix every ~5 s (High accuracy,
handed over in batches of up to 15 s). Recording is "store raw, filter on the server"
(`src/lib/recording.ts`, since 14 October 2026): every fix is stored unless it is worse than
150 m, a jump over 150 km/h from the last stored fix (three agreeing fixes in a row win), a
repeat of the previous fix's exact coordinates with no speed under a minute after the last
stored point, or jitter (within max(10 m, accuracy) of the standing anchor with a speed under
1 m/s; then one a minute). So every fix while moving or walking, one a minute parked. The GPS
drift filter `src/lib/track.ts` (same file in the connector) runs on the phone only for the km
counters; the server's buildRoute (`_shared/fleet/route.ts`) decides km, stops, the timeline
and the line from the stored points. The heartbeat (every 60 s) carries the fix counters
(seen, stored, dropped by reason), data available, app state, GPS age, queued and rejected
points; every heartbeat is also logged on the phone (30 days) and uploaded in batches into
`driver_heartbeats`. A dead location service is
restarted when the app opens, comes to the front, or every minute while on screen; a
watchdog notification fires 12 min after the last position. Location points are kept 90
days (pg_cron job `prune-location-points`).
Odometer rules: the photo proves the reading. Camera only. The photo is uploaded at once and
the Edge Function `read-odometer` (Gemini, `GEMINI_API_KEY`) answers a status: ok |
no_odometer | trip_meter_only | blurry | covered_or_dark | not_dashboard | unsure |
out_of_range (under the last reading, or over last + GPS km + 500). Only `ok` gives a number,
shown big with "Correct" and a small "Change" (Change warns that the office sees both numbers
and flags the log). Any other status: no number field, a message, "Retake photo". Typing only
after 3 failed photos in a row ("Still can't read it? Type the reading" + "Odometer display
broken? Report a problem", log flagged typed_unreadable, last photo kept) or with no
connection (ML Kit suggestion, entry typed_offline, checked by the server later through the
pg_cron job `check-odometer-photos` + pg_net, Vault secrets `functions_url` / `server_key`).
ML Kit text with no digits = "no odometer" without calling the server. `odometer_logs`:
entry, photo_attempts (phone) and ai_value, ai_status, ai_checked_at, flag (server only;
drivers have no privilege on them; trigger fills them from the photo's own read). Flags:
photo_changed, typed_unreadable, ai_differs, ai_failed (+ the computed "unlogged km"). 60
driver reads per driver per day (`odometer_reads`, service role only).

## Office rules: `supabase/functions/_shared/fleet` (used by `office-mcp` and `office-api`)
All tools, the role table (`roles.ts`), the runner (`run.ts`: role check, audit row with the
person's name and channel, the tool, the outcome) and the helpers live here. Two wrappers:
- `office-mcp`: MCP over Streamable HTTP, deployed with `--no-verify-jwt`, path
  `/office-mcp/<KEY>/mcp`. The shared OFFICE_MCP_KEY is the admin key of the org-wide
  "Fame Fleet" connector in Claude Teams (constant-time compare; wrong/missing → 404). A
  personal key (`office_keys`, made with `create_office_key`) runs the tools as that person
  with their role, for a person's own Claude account or a test; the audit log then carries
  their name. Only the tools the role may call are listed.
- `office-api`: HTTP for the web app, deployed with `--no-verify-jwt`: `GET /me`,
  `GET /tools` (with JSON schemas), `POST /tools/<name>` (same inputs and the same JSON
  answer as the connector; 400 bad_input, 403 role or mfa_required, 409 the tool said no).
  The session token is checked with Supabase Auth. 2-step sign-in is optional; the secret
  `REQUIRE_MFA_ROLES` (comma-separated roles, empty by default) makes office-api refuse
  those roles with 403 mfa_required until their session is aal2. No RLS policy checks aal2.
  120 calls a minute per person; CORS from OFFICE_WEB_URL.
Uses service_role internally but only through these tools. No raw SQL, no deletes. Compact
JSON, times in Asia/Colombo, Google Maps / tel: / wa.me links. Every call logged to
office_audit.
- Accounts (admin): `list_office_users`, `create_office_user(name, email, role)` (returns a
  one-time set-password link; no passwords in chat), `reset_office_password(email)`,
  `set_office_user_active(email, active)` (off = banned sign-in, keys revoked),
  `create_office_key(email, label?)` (personal connector URL, shown once),
  `revoke_office_key(key_id)`.
- Overview: `fleet_overview(date?)`: vehicles on the road / total / parked, tasks today
  (in progress, done), requests waiting (+ oldest), reminders due in 14 days, on-the-road
  list, needs-attention list. (Powers Desktop · Overview and Office · Home later.)
- Locations: `live_drivers(filter?)` (sharing / stale / not sharing, near town, speed,
  vehicle, current task, links, heading), `driver_route(driver?, date?, task_id?, from?, to?,
  line_tolerance_m?, max_line_points?, snap?)` (a day, a task's own window from Start task to
  Save & finish, or two times of a day: drift-filtered km from the raw points, driving and
  stopped minutes, stops > 10 min near a town, gaps > 10 min with their kind (no_gps = heartbeats
  but no fix, "Stopped · no GPS signal"; no_data = nothing, "App not running"), a timeline of
  driving / stopped / no_gps / no_data rows with sentences and "Offline here · uploaded HH:MM"
  on legs whose points landed over 5 min late, holes (> 2 min between line points, dashed on the
  map), the line smoothed for display (never the km) and thinned by shape (Douglas–Peucker
  `line_tolerance_m` default 12, the web passes 3, at most `max_line_points` 3000) with km/h,
  the ISO time and the accuracy per point, points_stored / points_shown, and with `snap` the
  driving legs snapped to roads (`route_snapped`, `snapped.status`) when the `map_matching`
  setting names a provider (google_roads: GOOGLE_ROADS_KEY, osrm: OSRM_URL; results cached per
  leg in `route_matched`, a live leg re-matched at most every 2 min, calls counted in
  routing_calls). Two rules learnt from test.driver's real
  12 October: stops with under 100 m of accepted movement between them are ONE stay (the
  filter only corrected where the parked phone is; never a "Driving · 0 km" row), and the
  line gets a wait (two points at one place) only for a pause of 60 s or more, so slow
  traffic keeps its true average speed. Check a route change against a real day through
  the connector before the checkpoint, not after the deploy.
- Drivers: `list_drivers`, `create_driver(name, code, username, pin, phone?)`,
  `reset_pin(username, pin)`, `set_driver_active(username, active)`,
  `update_driver(username, phone?, licence_expiry?)`.
- Vehicles: `list_vehicles(filter?)` (km this month vs allowance, next service, document
  chips, status, plus `assigned_to` / `assigned_to_links` / `custodian_note` and
  `availability` "Free" | "On a task · back ~HH:MM (planned | live)" | "On a task · end time
  not set" | "Booked later today · HH:MM" | "Booked · HH:MM (not started yet)" | "In garage",
  with `back_at`, `back_source`), `register_vehicle(...)`, `update_vehicle(reg_no, ...,
  custodian? name|e-mail|null, custodian_note?)`, `add_rental_company(name, phone?)`.
- Places: `list_places`, `add_place(name, address?, lat?, lng?, kind?)`.
- Tasks: `create_task(title, date, start_time?, driver, vehicle, pickup, dropoff | stops[{type,
  what?, place?, address?, lat?, lng?, dwell_min?, arrive_by?, note?}], start?, return_to_base?,
  avoid_expressway?, leave_by?, buffer_min?, passengers?, contact_name?, contact_phone?,
  notes?, projects[{project, percent}])` returning warnings, leave_by, stops and the plan
  (start_time or leave_by, or an arrive_by on a stop, is needed); `plan_task(date, same
  stop fields, driver?, vehicle?)` (preview, creates nothing); `update_task_stops(task_id,
  plan_version, stops[])` (pending stops → removed, new ones appended, re-planned, driver
  told "Task changed"; a stale plan_version is refused); `task_board(date)` (assigned / in
  progress / completed / declined = needs a driver, with status lines "Seen by driver HH:MM",
  "Accepted HH:MM", "Declined (reason) · note", stops_count, leave_by, accepted, eta_next,
  eta_final, late_min); `task_detail(task_id)` (odometer/fuel photo links, GPS km, plan,
  planned and actual times per stop, skip reasons, removed_stops, plan_version, accepted,
  declined {at, reason, reason_text, note, after_accept}, assignment_history[], and for a
  declined task `suggestions` = who is free then); `cancel_task(task_id, reason)` (assigned,
  in progress or declined); `reassign_task(task_id, driver?, vehicle?, start_time?)` (shifts
  leave_by and the planned times; a declined task goes back to assigned, the decline cleared,
  result `was: "declined"`). `list_drivers` adds `last_30_days {accepted, declined}`.
- Settings: `get_settings` (any office permission: the request form reads
  `self_drive_allowed`), `update_settings(key, value)` (also `map_matching {provider}`) and
  `routing_usage(days?)` (users).
  Tool answers never carry null fields (run.ts prunes them): a null setting such as
  base_place_id is simply absent.
- Requests: `create_request(..., driver_required?)` (a staff member asks in their own name;
  result `next` "Sent to the fleet admin · you'll be notified."), `list_requests(status?
  waiting|approved|declined|cancelled|all)` (cards carry `timeline {sent, seen, decided,
  decided_by, cancelled}`, `driver_required`, `one_step`, `cancelled`, `cancel_reason`),
  `suggest_vehicles(request_id? | date, time, back_by?, need_type?, pax?)` (the old
  `vehicles[]` / `drivers[]`, plus `groups {free_pool, free_assigned (custodian, call,
  whatsapp, note "ask first"), busy (back), in_garage}` and `drivers_free[]`; opening a
  request this way marks it seen), `decide_request(request_id, decision, vehicle?, driver?,
  reason?)` (approve creates the task; no driver needed when the request says
  driver_required false and the vehicle has a custodian), `book_vehicle(requested_by?,
  project?, date, time, back_by?, route_from?, route_to?, need_type?, pax?, tools?, note?,
  driver_required?, vehicle, driver?, title?, stops?, start?, return_to_base?,
  avoid_expressway?)` (approve; request + task in one transaction, audited as requested and
  approved by the caller), `cancel_request(request_id, reason)` (approve; a waiting or
  approved request → cancelled, its task cancelled with "Request cancelled: {reason}"; the
  custodian and the requester are told). Saving a task on a custodian's vehicle queues
  `vehicle.booked` for the custodian (not when they booked it).
- Mileage and reports: `mileage_summary(month, vehicle?, driver?)` (task km, odometer km vs
  allowance, between_tasks_km and overnight_km per vehicle with the biggest gaps, unlogged
  km flags, check_odometer, fuel litres/LKR), `list_vehicle_reports(status?)`,
  `update_vehicle_report(id, status, office_note?)` (mirrors onto the report's issue).
- Notifications (personal: a signed-in person or a personal key; any office permission):
  `my_notification_settings()` (events with on/off, devices with endpoint_hash, push
  {configured, public_key}), `set_my_notification_settings(events {event: bool})`,
  `register_web_push(endpoint, p256dh, auth, user_agent?)`, `remove_web_push(endpoint? | id?)`.
- Issues: `list_issues(status? active|open|in_progress|resolved|dismissed|all, kind?,
  vehicle?, assigned_to? email|me, limit?)` (issues, or assign_tasks for the task kinds only;
  `open` / `in_progress` counts for the bell), `update_issue(id, status?, note?, assign_to?
  email|me|none)` (issues; a vehicle_report issue mirrors onto the driver's report: resolved
  or dismissed = closed, in_progress = in the garage, open = open), `issue_history(id)`
  (events + the linked task / report with photos / request).
- Projects: `import_projects(projects[])` (upsert; the office's Claude reads Zoho and sends
  them), `find_project(text)`.

## Not now
Project costs, WhatsApp as a location source or automated WhatsApp sending (use wa.me links),
Zoho cost push, allowance claims UI (Phase C); an audit page; the e-mail channel for office
notifications (designed, `dead: email_not_implemented`); Google routing (code path present, no
key); a Claude Teams OAuth connector; road snapping of GPS lines; HR; iOS; Play Store.

## Working rules for Claude Code
- Explain each command before running anything that changes Supabase (migrations,
  deploys, secrets).
- Every schema change is a new migration file in `supabase/migrations`. Never edit a
  migration that has already been pushed.
- After building something, give Sahan exact test steps and what he should see.
- Keep the driver app simple: big buttons, few words, works in sunlight.
