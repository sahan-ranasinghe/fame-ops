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
- **C (later)**: Project costs, Maintenance, Mileage and Drivers office pages; road distance /
  ETA (routing API); WhatsApp automation; pushing costs to
  Zoho Books; daily allowance claims in the driver app (our addition, waiting for the
  boss's OK; tables may exist, no UI yet).

## Hard rules
1. Drivers never need a Claude account.
2. No hosted office web app. Office access = the connector (+ a Claude artifact in the
   boss's account in Phase B). One planned exception, not built yet: a small live-map web
   app `apps/web` on Cloudflare Pages (office sign-in, MapLibre, Realtime positions, one
   driver's route), because artifacts cannot load map tiles. Plan: `docs/live-map-plan.md`.
3. Do NOT use the official Supabase MCP connector for the office (it gets full write access
   to the whole org). Our connector exposes only the tools listed below.
4. Do NOT modify the existing "Fame Group Allowance Desk" artifact. Its business rules are
   in `docs/Allowance_Desk_How_It_Works.md`. That file contains internal company IDs:
   keep this repo private.
5. Secrets never go in the app or in git. The app only gets the Supabase URL and the
   publishable (anon) key and is protected by Row Level Security. The service_role key and
   OFFICE_MCP_KEY live only in Edge Function secrets. `.env*` files are gitignored.
6. Times stored as timestamptz (UTC), shown in Asia/Colombo.
7. Money: LKR stored as integer cents (bigint).
8. No Zoho calls from our code. The office's existing Zoho connector in Claude reads Zoho
   and sends us projects through `import_projects`.
9. Location is recorded only while "Sharing my location" is on. Starting a task turns it
   on automatically; the driver can turn it off when not working.

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

## Data model
- `employees`: id uuid, code (unique), name, phone, role ('driver'|'office'|'admin'),
  active, language ('en'|'si'), licence_expiry (date, nullable),
  current_vehicle_id (nullable), auth_user_id (unique, nullable), created_at, updated_at.
- `rental_companies`: id, name, phone.
- `vehicles`: id, reg_no (unique, e.g. "WP CAB-4521"), make_model ("Toyota HiAce"),
  vehicle_type ('car'|'van'|'double_cab'|'lorry'|'other'), seats, rental_company_id,
  rent_until (date), monthly_rent_cents, monthly_km_allowance, regular_driver_id,
  current_odometer_km, service_interval_km, last_service_odometer_km, next_service_date,
  garage_booked_date, in_garage (bool), licence_expiry, insurance_expiry,
  emission_expiry, active. Status shown = in_garage → "In garage", has an in-progress
  task → "On a task", else "Available".
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
  request_id (nullable), created_by (text), cancelled_reason.
- `task_stops`: id, task_id, seq, type ('pickup'|'drop'|'visit'), place_id (nullable),
  place_name, address, lat/lng (nullable), status ('pending'|'arrived'|'done'|'skipped'),
  arrived_at, done_at. The design shows one pickup and one drop-off; more stops allowed.
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
  project_id (nullable), project_label, needed_at, back_by, route_from, route_to,
  need_type, pax, tools (bool), note, status ('waiting'|'approved'|'declined'),
  decided_at, decided_by, decline_reason, task_id.
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
  battery_pct, recorded_at, sharing (bool). Kept current by trigger (only newer points win).
- `office_audit`: id, at, tool, args_summary, result_summary.
- `device_tokens`: id, employee_id, token (unique, Expo push token), platform, device_model,
  app_version, language, created_at, updated_at. Drivers read their own; they write through
  `register_device_token()` / `remove_device_token()`.
- `push_log`: one row per push-task call (task_id, employee_id, kind, tokens, sent, failed,
  errors). Service role only.
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
- Status words for the office: Sharing = last point < 15 min; Stale = older; Not sharing =
  sharing off. "Seen by driver HH:MM" from seen_at; "Sent · not opened yet" if seen_at is null.
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
   Change, "Sharing my location · Office can see you · works in background" toggle,
   NEXT TASK card (time, title, Pickup, Drop-off, passengers · contact, Start task),
   "Later today" list. Records seen_at the first time a task is shown. Pull to refresh +
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
Offline: location points, odometer/fuel logs, reports and photos are queued on the phone
and retried. Location: a fix every ~5 s (High accuracy, handed over in batches of up to
15 s); the GPS drift filter `src/lib/track.ts` (same file in the connector) ignores fixes
worse than 50 m, jumps over 150 km/h and drift while standing still, and a move only
counts once a second fix agrees; one point recorded every 5 s while moving, one a minute
while parked; upload every ~30 s or 10+ queued points. A dead location service is
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

## Office connector (Edge Function `office-mcp`), Phase A tools
MCP over Streamable HTTP, deployed with `--no-verify-jwt`, path `/office-mcp/<KEY>/mcp`,
key compared in constant time with OFFICE_MCP_KEY (wrong/missing → 404). Uses
service_role internally but only through these tools. No raw SQL, no deletes. Compact
JSON, times in Asia/Colombo, Google Maps / tel: / wa.me links. Every call logged to
office_audit.
- Overview: `fleet_overview(date?)`: vehicles on the road / total / parked, tasks today
  (in progress, done), requests waiting (+ oldest), reminders due in 14 days, on-the-road
  list, needs-attention list. (Powers Desktop · Overview and Office · Home later.)
- Locations: `live_drivers(filter?)` (sharing / stale / not sharing, near town, speed,
  vehicle, current task, links), `driver_route(driver, date)` (thinned to ~300 points,
  drift-filtered km, stops > 10 min).
- Drivers: `list_drivers`, `create_driver(name, code, username, pin, phone?)`,
  `reset_pin(username, pin)`, `set_driver_active(username, active)`,
  `update_driver(username, phone?, licence_expiry?)`.
- Vehicles: `list_vehicles(filter?)` (km this month vs allowance, next service, document
  chips, status), `register_vehicle(...)`, `update_vehicle(reg_no, ...)`,
  `add_rental_company(name, phone?)`.
- Places: `list_places`, `add_place(name, address?, lat?, lng?, kind?)`.
- Tasks: `create_task(title, date, start_time, driver, vehicle, pickup, dropoff,
  passengers?, contact_name?, contact_phone?, notes?, projects[{project, percent}])`
  returning warnings; `task_board(date)` (assigned / in progress / completed with status
  lines); `task_detail(task_id)` (odometer/fuel photo links, GPS km); `cancel_task(task_id, reason)`;
  `reassign_task(task_id, driver?, vehicle?, start_time?)`.
- Requests: `create_request(...)`, `list_requests(status?)`, `suggest_vehicles(request_id)`
  (free all day / over km allowance / booked), `decide_request(request_id, decision,
  vehicle?, driver?, reason?)` (approve creates the task).
- Mileage and reports: `mileage_summary(month, vehicle?, driver?)` (task km, odometer km vs
  allowance, between_tasks_km and overnight_km per vehicle with the biggest gaps, unlogged
  km flags, check_odometer, fuel litres/LKR), `list_vehicle_reports(status?)`,
  `update_vehicle_report(id, status, office_note?)`.
- Projects: `import_projects(projects[])` (upsert; the office's Claude reads Zoho and sends
  them), `find_project(text)`.

## Not now
Office artifact (Phase B); project costs, maintenance and driver pages, FCM push, routing
and ETA, WhatsApp as a location source or automated WhatsApp sending (use wa.me links),
Zoho cost push, allowance claims UI (Phase C); HR; iOS; Play Store.

## Working rules for Claude Code
- Explain each command before running anything that changes Supabase (migrations,
  deploys, secrets).
- Every schema change is a new migration file in `supabase/migrations`. Never edit a
  migration that has already been pushed.
- After building something, give Sahan exact test steps and what he should see.
- Keep the driver app simple: big buttons, few words, works in sunlight.
