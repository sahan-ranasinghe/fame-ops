# Phase 8: Office mode

The plan, 19 October 2026. Nothing is built yet. Part 8.0 is design first: a clickable prototype from the designs in
`design/office/`, corrected with Sahan and Charuka before anything is wired to the server.

Office mode is a second interface inside the same Expo app as the drivers' one (Fame Fleet, package
`com.fameglobal.driver`). An office sign-in gets it. The web build of the same screens becomes the phone version of the
office site. The work is split into Parts 8.0–8.6, each ending at a checkpoint with tests and a fresh reviewer. Nothing is
deployed without Sahan's go.

Sources:
- Sahan's brief (19 October).
- The 20 designs in `design/office/` (`png/`, `html/` with `canvas.json`, `office-mode.pdf`).
- The office site as built (every function in `docs/phase8-parity.md`).
- The server's permission table (`supabase/functions/_shared/fleet/permissions.ts`).

## 0. Ground rules

- **Permissions, never role names.**
  - The app uses the site's seven permissions: view, request, approve, assign_tasks, vehicles, issues, users.
  - Every tab, Home section, More tile, button and screen is shown when the person holds what it needs, and only then.
  - Where a design shows a role word ("Dispatcher", "Fleet admin", "Admin", a Home "per role"), it is an example of a
    permission set. The app decides by permission. The server stays the guard; the app only hides what would be refused.
- **One server.** The office's rules stay in `supabase/functions/_shared/fleet`, reached through `office-api` with the
  person's own session, exactly as the site does. No new copy of a rule in the app. A tool's inputs and JSON answers are a
  contract (`scripts/tool-shapes.json`): additive changes only.
- **No dead UI.**
  - Every button, tab, chip, card and link in a shipped build does its real action against the live server, or is not
    shown.
  - The 8.0 prototype may use sample data; nothing reaches a round with a placeholder.
  - `docs/phase8-parity.md` tracks every site function and the app screen that does it.
  - An automated tap test (section 9) visits every screen for each permission set and fails on a tap that does nothing.
- **The sample names in the designs are not real people:** never seed them (Palitha, Nimali, Kamal, Sunil, Ruwan, Nimal,
  Priyantha, Sahan in the sample rows). Test data uses the "E2E …" and "Test …" names as now.
- **The standing rules hold:**
  - no secrets in the app, the browser or git;
  - every Supabase push, deploy, EAS build and Cloudflare deploy only with Sahan's go;
  - a go covers exactly what was shown;
  - every schema change is a new migration;
  - English and Sinhala for every string the app shows, with Latin digits;
  - heavy local jobs with hard limits.
- **The driver interface is not touched by Office mode** except where the two share code. A driver signing in sees exactly
  the driver app of 1.3.0.

## 1. What Office mode is

- **Sign in** (design 01): "Driver | Office".
  - Driver is the username and 6-digit PIN, as now.
  - Office is the work e-mail and password: Supabase Auth in the app, the same account as the site.
  - 2-step sign-in where the account has it (the site's TOTP code page, in the app's style; the design has none: 8.0 adds
    it).
  - "Forgot password?" (see section 12, decision 2), and the privacy policy link.
- **The session decides the interface.**
  - A driver's account opens the driver app.
  - An office account opens Office mode, built from `GET /me` (name, permissions, tools, phone, the map package).
  - An account that is both does not exist (the server keeps drivers and office people apart).
  - **Signed out only on a 401 or 403** (Sahan, 19 October 2026). A `GET /me` that is dropped (no connection, a 5xx) is
    asked again once after 2 s, then the app says "Fame Fleet did not answer" with Try again and keeps the session. A token
    that could not be refreshed for want of a connection (supabase-js: no session with `AuthRetryableFetchError`, the
    session still stored) is offline, not signed out: the app opens with what it has and refreshes later, as the driver
    app does (`lib/session.ts`). The office site's rule is `apps/office/src/auth/session.ts` and the `unreachable` step of
    `AuthProvider`; the app uses the same (in `packages/shared` with the API client).
- **Bottom tabs per permission set (4–5)**, from `me.permissions`, by the rule of the site's `tabsFor` and the designs:

| Permission set | Tabs |
|---|---|
| request (+ view) | Home · My trips · Alerts · Me |
| assign_tasks | Home · Tasks · Live · Drivers · More |
| approve (with or without assign_tasks) | Home · Approve · Live · Drivers · More |
| view only | Home · Live · Alerts · More |

  The exact rule is a pure function with a test for every preset and the odd sets (approve without view, vehicles only,
  users only). More holds everything else the person may use, never a tab twice.
- **Home by permission** (designs 02–05):
  - requests to approve (approve);
  - needs a driver (approve or assign_tasks);
  - critical issues (issues, or assign_tasks for the task kinds);
  - today's tasks as a timeline (assign_tasks);
  - on the road (view);
  - my trips (request, or assign_tasks for one's own).

  The big actions: "+ Assign a task" (assign_tasks), "Request" / "+ Request a vehicle" (request). The header chips: on the
  road, free, waiting for OK, in garage.

## 2. What each permission set sees

| Permission | Home | Screens and actions | Under More |
|---|---|---|---|
| view | on the road, the at-a-glance chips | Live (positions, the drivers' cards), vehicles (list and detail, read), drivers (list), notifications, profile | Vehicles, Places (read), Reports only with vehicles |
| request | my trips, + Request a vehicle | New request (the 4 steps), My trips (edit, withdraw), a request's page, the trip's live state | — |
| approve | requests to approve, needs a driver | Approve / decide / re-decide, book in one step, Give it a driver (with assign_tasks), cancel a booking, Ask drivers, the Drivers board and its week, availability | Requests |
| assign_tasks | today's tasks, needs a driver | Assign a task (the 4 steps), Tasks board and history, task detail (change, reassign, cancel, swap vehicle, reopen, stops), Give it a driver, Ask drivers, the Drivers board, Live's trails and playback, clock out, move vehicle, duty log, a driver's day | Tasks, Places |
| vehicles | — | add, edit, switch off vehicles, photos and documents by camera, the driver's private profile part, Reports (Mileage, Fuel, Duty log), places' edit; today also drivers' add / new PIN / switch off (decision 1) | Vehicles, Places, Reports, Drivers |
| issues | critical issues | Issues (take, note, resolve, dismiss, snooze), vehicle problem reports | Issues |
| users | — | office users (add with the one-time set-password link shared by WhatsApp, edit phone and permissions, switch off), quick settings, Google usage counters (read) | Office users, Drivers (decision 1), Quick settings |

Laptop only, with one line in the app saying so ("On a laptop: site import, projects, the map package and Google caps, the
fuel-video checklist and the detailed settings, the audit log"):
- the site import and its history;
- Projects;
- the map package and Google caps;
- the privacy contact e-mail (set once before the store submission);
- the fuel-video checklist, buffer, speeds and rush hours;
- dwell times;
- the accept-window details beyond the quick ones;
- connector keys;
- 2-step enrolment (sign-in with a code works in the app);
- the audit log.

## 3. A dispatcher's full day without a laptop

| Job | Screen (design) | Tools | Notes |
|---|---|---|---|
| See what needs doing | Home (03, 04) | fleet_overview, list_requests, my_trips | sections by permission, 5 rows, View all |
| New request / Assign a task | Trip steps Where → When → Who → Review (06–09) | search_places, google_place, save_place, plan_task, availability, create_task / create_request / book_vehicle | the complete trip editor: stops with type and "what", the time at each stop, arrive-by, back by, the plan timeline, the plan map with Google's line (only on Google's map), leave-by checks ("36 min too late", Use 07:24, Move arrive-by), Who's available, the best match, vehicle on the day; Save draft |
| Approve / decide | Approve a request (10) | decide_request, redecide_request, reviewing, suggest_vehicles, availability | "Sahan is also looking"; Decline with a reason; Change time |
| Give it a driver | Needs a driver (11) | update_task, availability, cancel_task | as Hotfix 4: the task on top, Who can take it, Open task → |
| Ask drivers | the sheet (13) | ask_drivers, ask_answers | as Hotfix 4; answers live on the rows |
| Change, reassign, cancel, swap vehicle, reopen | Task detail (14) | task_detail, update_task, update_task_stops, cancel_task, move_driver_vehicle, reopen_task, swap_reading | Call / WhatsApp the driver and the requester; planned vs actual stops; odometer and fuel photos (design 14 leaves them out: 8.0 adds them) |
| Tasks board and history | a Tasks list (not designed: 8.0) | task_board, list_tasks | today / a day; columns as sections; history with the date range |
| Requests and My trips | My trips (17) and a requests list (not designed) | list_requests, my_trips, update_request, cancel_request | |
| Live | Live (15) | live_drivers, watch_drivers, driver_route | map first, the peek sheet, trails, gap markers, playback 1× 5× 20× 60×, clock out, move to vehicle |
| The Drivers board | Drivers (12) | drivers_board, set_unavailability, remove_unavailability | Now and Week (Week not designed: 8.0), availability entries |
| Issues | Issues (not designed) | list_issues, issue_history, update_issue, update_vehicle_report | |
| Vehicles | (19 → a list, not designed) | list_vehicles, vehicle_documents | view; photos and documents (vehicles permission) |
| Places | (not designed) | list_places, place_detail | search; edit with vehicles |
| Notifications | Notifications (16) | my_inbox, mark_inbox_read | the action pill opens the job |
| Profile | Profile (18) | update_my_profile, my_notification_settings | phone, sounds, language, privacy, version |

## 4. Management under More (designs 19–20)

Each section shows to whoever holds its permission, exactly as on the site. The fleet admin does this work daily; the boss
has the same access.
- **vehicles:**
  - add, edit and switch off vehicles (register_vehicle, update_vehicle);
  - photos and documents by camera (set_vehicle_photo, save_vehicle_document with an upload from the phone: today these
    are web-only tools, see section 10);
  - the rental company inline.
- **users:**
  - **Drivers:** add (create_driver: the PIN shown once, and the phone needed), edit (update_driver: phone, WhatsApp,
    emergency contact, licence), reset PIN, switch off and on, availability (the week strip). Design 20 shows the page.
  - **Office users:** add (create_office_user, the one-time set-password link shared by WhatsApp), edit phone and
    permissions (update_office_user, the presets as chips), new link (reset_office_password), switch off
    (set_office_user_active).
- **Quick settings** (users; design 19):
  - new tasks need the fleet admin's OK (`tasks_need_approval`);
  - vehicle on the day (`vehicle_on_the_day`);
  - drivers' personal trips (`driver_personal_trips`, four choices);
  - auto clock-out time (`duty_cutoff`);
  - accept window (`accept_within_min`, `accept_before_leave_min`);
  - office phone (`office_phone`).
- **Read-only Reports** (vehicles, as on the site): Mileage, Fuel (with the video pieces) and the Duty log with the date
  range, and the Google usage counters (users).
- **The laptop-only line** (section 2).

## 5. Build approach

- **Reuse:** the server, `office-api`, the rules, the strings and the API client. The app calls `office-api` with the
  signed-in person's Supabase session, as `ApiTransport` does on the site (`GET /me`, `POST /tools/<name>`).
- **`packages/shared`** (a workspace package, used by `apps/office`, `apps/driver` and the Deno functions where they
  already share files): the data types of the tool answers (`apps/office/src/data/types.ts`), the formatters
  (`@fleet/durations`, `lib/format`), the pure rules the pages use (paging, availability rows, plan checks, the ask rules,
  `tabsFor` by permission, the issue groups) and the validation of the forms. Deno keeps importing through its import map.
  The move is mechanical and comes first (8.1), with every test of both apps passing before and after.
- **New native screens** with Expo Router in `apps/driver/src/app/(office)/…`, built for Android, iOS and web
  (react-native-web). The driver app's components are reused where they fit: buttons, cards, chips, the plate chip, Txt
  with the Sinhala fonts, sheets, the task map, the phone setup.
- **Maps: both engines, the same rules as the driver app** (Sahan, 19 October; Phase 7 §27b).
  - Office mode uses the driver app's map component (`components/TaskMap.tsx`, grown into a general map with the same two
    engines: Google's map and the free map, MapLibre with OpenFreeMap). Every Office-mode map screen uses it: Live (the
    trails and playback), the trip planner's map with the route line (Review, the plan timeline), task detail, and the
    places search (its pin map).
  - The same rules: Google by default; a phone whose Google map does not load switches to the free map by itself (the
    issue "Google map failed on <person>'s phone"); the map package setting switches every phone, office and driver alike,
    within a minute; neither loading = "Map not available" with the lists.
  - **In the native app (Android and iOS)** Google's map is the free Maps SDK (Android; iOS: Google Maps SDK for iOS, a key
    restricted to the bundle id as an EAS secret), so office use in the app does **not** count against the website's
    map-load cap (`map_loads`).
  - **The web build of Office mode (the mobile website)** uses Google's web map (Maps JavaScript API through
    `register_map_load`), so it **counts** against the cap, and at the cap it does what the website does: no map, the
    lists (`NoMap`); with the package open, the free map.
  - Hard rule 10 holds everywhere: Google's content (road lines, a Google place's pin, Places results) only on Google's
    map, listed on the free map; every paid Google call through the server, counted (`docs/google-maps-setup.md` §7).
  - Every round tests both engines; the reviewer checks map changes against both.
- **Notifications.**
  - Office people get native push in the app on the Part 6 channels (loud ones for a request to approve and a task that
    needs a driver, the question tone for answers).
  - `device_tokens` and `notify-office` learn office people (section 10).
  - Web push stays for the site and the installed web app.
- **iOS** through EAS once Fame's Apple organisation account exists (Unlisted distribution; `docs/store-release.md` §5).
  Office mode needs no background location, so the iOS build of Office mode does not carry the drivers' background mode
  until a driver build for iOS is decided.
- **Versions.** Office mode ships as app 1.4.0: a native build (new screens only, no new native module expected beyond the
  iOS map key) plus updates. The drivers' 1.3.0 phones get the driver part unchanged.

## 6. The UX bar

The office mode must feel like a consumer app (PickMe, Uber), not the site on a small screen.
- **One job per screen, as steps** (Where → When → Who → Review), with a sticky primary button ("Next: When ›").
- **Map-first trip screens** with a draggable bottom sheet (Review, Live, a task's route): snap points at peek, half and
  full, the map's controls clear of the sheet.
- **Bottom tabs per permission set (4–5).** No sidebar, no tables, no hover.
- **48 px tap targets.** The designs' 40 and 44 px icon buttons and 24 px checkboxes are enlarged (or their tap area is) in
  8.0.
- **Cards, chips and status colours** instead of lines of text. Plates in mono inside a thin chip. Times and numbers in
  Plex Mono.
- **Skeletons, not spinners.** Optimistic updates where the server's answer is predictable (mark read, take an issue, a
  snooze). **Undo** on cancel and decline: a 5-second toast before the call is sent, or the matching reverse tool where
  one exists.
- **The boss's design tokens** (amber, ink, the type) throughout, from one theme file.
- **The designs add a status green `#2e7d32`** (free, active) that CLAUDE.md does not list (decision 6).
- **English and Sinhala**, every string through i18n (Gemunu Libre for Sinhala headings, Yaldevi for the body, never mono on
  Sinhala words).
- **Back always goes back; forward links are labelled** (Hotfix 4's rule, from the start).

## 7. The mobile website

- The web build of the same Office mode screens becomes the phone version of the office site, on the same domain
  (fame-fleet.pages.dev, later the company's).
- Phones (a narrow screen or a mobile user agent) get it; laptops keep the current desktop site. Each has a "Switch to
  desktop / mobile view" link (remembered on the device).
- It is an installable web app (manifest, icons, an offline shell) with web push. iPhone users who add it to the Home
  Screen (iOS 16.4+) get notifications before the App Store app exists. The steps go into the docs:
  1. Open the site in Safari.
  2. Share → Add to Home Screen.
  3. Open it from the icon.
  4. Profile → Notifications → Turn on.
- No separate mobile layout of the desktop site is kept after this: its phone CSS (`ui/phone.ts`, the tab bar, the cards
  for tables) is removed once the mobile site covers every function (the parity table says when).
- Hosting: the same Cloudflare Pages project. The two builds live side by side (`/` decides by the device, `/m/` and
  `/desktop/` force one), each with its own service worker scope. Deploys only with Sahan's go.

## 8. Parts, checkpoints and rounds

Each Part:
- is on its own branch from main;
- ends at a checkpoint (what was built, tests, the reviewer's findings, the parity table, exact test steps);
- reaches the phones and the site only in a round with Sahan's go.

| Part | What | Checkpoint shows |
|---|---|---|
| **8.0 Design first** | A clickable prototype of the 20 designs plus the missing screens (section 11) with sample data, reusing the driver app's components, served as a web link for Sahan and Charuka on their phones (its own Pages project `fame-fleet-proto`, no keys, a "Prototype · sample data" banner, noindex: decision 5). It shows both map engines (a switch on the prototype's map screens: the free map live, Google's map as a sample picture since the prototype holds no key, and "Map not available"). Corrections go in before anything is wired. | the link; every screen against the designs; the corrections list; a fresh reviewer's check of every screen against the designs and these rules |
| **8.1 Foundation** | `packages/shared`; office sign-in (e-mail, password, 2-step code, forgot password per decision 2); the session → interface switch; tabs and More by permission; the API client on office-api; notifications for office people (server work, section 10); the theme; the tap-test harness | sign-in on both apps; the tab sets per preset; the tap test running on the empty shell |
| **8.2 Requester** | Home (02), New request (the 4 steps), My trips (17), a request's page, Alerts (16), Profile (18) | a requester's whole day on a phone |
| **8.3 Dispatcher** | Home (03), Assign a task (06–09), the Tasks board and history, Task detail (14) with every action, Give it a driver (11), Ask drivers (13), the Drivers board (12) with Week, Live (15) with trails and playback | a dispatcher's whole day without a laptop |
| **8.4 Approver and issues** | Home (04, 05), Approve (10) with re-decide and book in one step, Issues, vehicle problem reports, Vehicles (view) | an approver's whole day |
| **8.5 Management** | More (19): vehicles (add, edit, switch off, photos and documents by camera), drivers (20: add, edit, PIN, switch off, availability), office users, quick settings, Reports, the laptop-only line | every management row of the parity table built and tested |
| **8.6 Mobile website and iOS** | the web build as the phone site (device switch, PWA, web push, the iOS Home Screen steps), the removal of the desktop site's phone layout, the iOS build through EAS when the Apple account exists | the parity table complete; the tap test over every screen and permission set on the web build; the iOS build (when possible) |

Rounds follow the Parts (8.1–8.3 may share one), each with the same safe order as Phase 7: secrets list, db push, functions,
web, the EAS update or build last.

## 9. No dead UI: how it is kept

- **`docs/phase8-parity.md`:** every function of the office site (138 rows from the inventory of 19 October), with its tools
  and permission, the app screen that does it, and its status (planned → built → tested, or laptop-only by decision). Every
  checkpoint shows it.
- **The automated tap test:**
  - Playwright on the web build (the snap Chromium, as the e2e), with Maestro for the native builds later if the web build
    is not enough.
  - For each permission set (the five presets and two odd sets) it signs in, visits every screen reachable from the tabs and
    More, and taps every interactive element (role button, link, tab, chip, switch, checkbox, a card with an onPress).
  - It fails when a tap does nothing: no navigation, no request to office-api, no state change in the page's store, no sheet
    or dialog.
  - Destructive actions are tapped against the local stack's test data only.
  - Its list of screens comes from the router, so a new screen is visited without editing the test.
- **The fresh reviewer** checks for dead UI at each checkpoint, besides the designs and these rules.

## 10. Server work Office mode needs

From the designs' inventory; each is additive and each is a separate migration or function change shown at its Part's
checkpoint.
1. **Native push to office people.**
   - `device_tokens` for office employees (today drivers only).
   - `notify-office` sends an Expo push beside the web push, on the Part 6 channels with the office kinds (urgent: a request
     to approve, needs a driver; alert; soft; alarm), honouring the person's event settings and sounds.
   - The custodian case: a task whose employee is an office person must not send that person driver-style task pushes once
     they register a token. The task pushes check the role.
2. **The app as a channel.**
   - `office-api` records channel `app` beside `web` (the audit's check widened).
   - The upload tools that are web-only today (`photo_upload_url`, `vehicle_document_upload_url`, `save_vehicle_document`)
     allowed for the app, with the same checks.
3. **Forgot password** (decision 2): a self-service reset by e-mail, or "ask the fleet admin" as on the site.
4. **The requester's ETA** on Home and My trips ("arrives about 08:55"): `my_trips` carries the running task's ETA from the
   2-minute ETA cache (no new Google call per view).
5. **"Usual here: 1 h 30 (last 4 visits)"** and **"used 3 times this month":** small additions to `place_detail` /
   `search_places`.
6. **"Would be back 12:50 · 10 min before his next task"** per candidate in Who can take it: availability with the task's
   window.
7. **A job title** for office people (design 18 "HR manager"): an optional `employees.title`, or none (decision 7).
8. **The phone's "App stopped" in Notifications** (design 16): today a warning issue; an inbox event only if wanted
   (decision 8).

## 11. What the designs leave open (8.0 designs them in the same style)

- **Sheets and pickers:** the decline and cancel reason sheets, the date and time pickers, the "Other" time at a stop, the
  vehicle "Choose…", the start's "Change".
- **Screens:**
  - the Drivers board's Week;
  - the requester's step 3 (Who: the vehicle type and passengers, no driver);
  - a read-only task page for a requester or an approver without assign_tasks;
  - the lists behind More's tiles (Tasks, Requests, Issues, Vehicles, Places, Reports);
  - the office users' list;
  - a driver's day (route, timeline, playback);
  - an issue's page;
  - the auto clock-out editor;
  - the sound test list;
  - add driver;
  - the reset-PIN and switch-off confirmations;
  - 2-step sign-in.
- **Inputs no step asks for** though Review and Approve show them: title, label / project split, passengers, contact,
  notes, the need type ("any van"), the stop type and "what".
- **Corrections to the designs** (from the inventory):
  - Review says "back at Head office 15:40" against 14:36 in its timeline.
  - "Monday traffic" appears on a Tuesday.
  - "running late 15 min" against "8 min late".
  - "Today's tasks · 5" lists 4.
  - Live's "All · 4" lists 3.
  - The tab "Alerts" against "Notifications" (decision 3).
  - The More tab opens Profile on some screens and the hub on others.
  - Steps 1–2 say "New trip" and step 3 "Assign a task".
  - Two cards break where a link sits inside a link.
  - Some content is hidden under the tab bar or the sticky buttons.
  - Mono is used on Sinhala words.
  - The sample plates clash between screens.

## 12. Decisions (Sahan, 19 October 2026: the eight defaults accepted, 5 changed)

1. **Who manages drivers:** either permission may (vehicles or users), so neither the fleet admin (vehicles) nor an admin
   (users) loses it. (Design 20 and the brief said users; the server gives create_driver, reset_pin and set_driver_active
   to vehicles today.)
2. **Forgot password:** "Ask the fleet admin for a new link" (as on the site); a self-service e-mail reset later.
3. **The notifications tab's name:** "Alerts" on the tab bar, "Notifications" as the screen's title.
4. **More:** the hub (19), with My profile at its top; the Profile screen (18) from there.
5. **The prototype's link (changed by Sahan):** its **own Cloudflare Pages project, `fame-fleet-proto`**, not a preview of the
   production project `fame-fleet`, so it shares no settings with the live site. Sample data only, **no keys of any kind**
   in it (no Supabase URL or key, no Google key: the maps in the prototype are the free map and sample pictures, or Google's
   map only if a later go says how), a **"Prototype · sample data"** banner on every screen, and **noindex** (a robots meta
   tag and an `X-Robots-Tag: noindex` header in its `_headers`). It needs Sahan's go to deploy, like any deploy.
6. **The status green `#2e7d32`** for free / active: yes, added to the tokens.
7. **A job title:** none (the permission chips say what the person does).
8. **"App stopped" in Notifications:** no (it stays an issue).

## 14. O1 as built (19–20 October 2026, branch `phase8-o1`): the approver's and dispatcher's side, a pilot

Sahan's brief (19 October, evening): a pilot on his phone, signed in as an office user against the live server, for Charuka
the next morning; everything shown is real, nothing not built is shown; JavaScript only (an EAS update to the 1.3.0
runtime, no build); the app's navigation as it is (expo-router, no packages/shared yet: the site's client and types
copied); every screen by permission; an office sign-in starts nothing driver-side; the designs' look and both languages.
Built in the brief's order; the trip editor (06–09) is round O2.

### The foundation (`apps/driver/src/office/`)
- `api.ts`: the site's ApiTransport copied for the phone (GET /me, POST /tools/<name> with the session's token and the
  publishable key; no phone-only code, so `scripts/test-office.ts` runs it with a fake server). The retry rule as on the
  site: a read (READ_TOOLS, the server's readOnly tools, and /me) that was dropped is asked again once after 2 s; a write
  never, its error marked `write` ("may not have been saved"); `reviewing` is the one keyed write. Signed out only on a
  401 or 403 (`signedOut`).
- `auth.ts`: the Office sign-in (Supabase Auth with the e-mail and password, then /me); `loadMe` → ok | signed_out (a
  401 or 403 only: no office role, switched off, the session gone) | unreachable (the session kept, Try again); a token
  that could not be refreshed offline is offline, not signed out (`lib/session.ts`); one person per phone (an office
  sign-in clears a driver's, and the other way round in `login.tsx`); `bootOffice` at start. `client.ts` wires it.
- `store.ts`: the office person on the phone (`office.me` in the kv store), read by the route layouts: the driver's tabs
  send an office sign-in to `/office`, `/office` sends nobody to `/login`. `types.ts` and `permissions.ts`: copies of the
  site's `data/types.ts` and the server's permission table (noted at their top; copied again when they change).
- `nav.ts` (pure, tested): the bottom tabs by permission (Home, then Approve for approve, Tasks for assign_tasks, My
  trips for request, Live for view, Alerts, More; never a tab twice; the Drivers tab waits for the Drivers board), Home's
  sections and header chips, More's Work list, and a notification's site link → the app's screen by permission.
- `state.tsx`: `OfficeProvider` (the person, the client, sign-out, the unread count every minute for the badge) and
  `useTool` (a tool's answer with loading, error, reload; read again when the screen comes to the front, on pull to
  refresh and on a timer). `ui.tsx`: the shared pieces in the app's tokens (the dark header with the bell, section cards,
  rows, pills, chips, the back header, the error notice with Try again, the sticky actions). `text.ts`: the error
  sentences as i18n keys. The status green `#2e7d32` (decision 6) in `theme.ts`.
- Strings under `office.*` in `i18n/en.json` and `si.json` (the Sinhala from design 05 where it had the word).

### The screens (`apps/driver/src/app/office/`)
- **Sign in** (01, `app/login.tsx`): Driver | Office under "Sign in"; Office = work e-mail, password with the eye,
  "Forgot password?" → "Ask the fleet admin for a new sign-in link." (decision 2), the help line, the version and the
  privacy link; the last office e-mail is filled in next time.
- **Home** (02–05, `(tabs)/index.tsx`): the date, "Morning / Afternoon / Evening, <first name>", the chips (on the road,
  free = parked, waiting for OK with approve, in garage with vehicles or issues) from fleet_overview; the sections by
  permission: Requests to approve (list_requests waiting, 5 rows, View all → the Approve tab), Needs a driver (red, Give
  a driver → design 11), Critical (read only until the issues screen), Today's tasks (task_board, Board → the Tasks
  tab, "All today's tasks (N)"), On the road (rows → Live on that driver, Live map), My trips (my_trips, View all).
  No big action button (the trip editor is O2).
- **The Approve queue** (`(tabs)/approve.tsx`, not designed as a list): the waiting and changed requests with "<name> is
  reviewing" and "Leave-by passed"; a row → design 10.
- **Approve a request** (10, `request/[id].tsx`): the request (list_requests by id), "<name> is also looking" (reviewing
  every 20 s), the trip card from the request's plan (`approveLogic.tripView`: S / 1 / B rows with the times, the totals,
  needs, notes, Call the requester when their number is known), Who's available (availability at the leave-by until the
  back-by, the type and passengers, nearest the first stop; the proposal's driver, else the best match, picked first; a
  tap picks another; the vehicle fills itself from the driver), Approve · send to <driver> (decide_request; a changed
  booking: redecide_request keep / change / decline with the version), Decline… with a reason sheet; the server's
  "Already approved by … at …" shown and the card read again. Not shown: Plan on map, Change the trip, Change time, Ask
  drivers.
- **The Tasks board** (`(tabs)/tasks.tsx`, not designed as a list): ‹ a day › with today's name, the sections Needs a
  driver (Give a driver), On the way, Sent to the driver, Waiting for approval (→ Approve for an approver), Done.
- **Task detail** (14, `task/[id].tsx`): the pills (status, running late, the label, driver-started, completed early),
  the five steps with their times (`taskLogic.steps`: "~10:38" planned, "—" not yet), "Approved by … · plan vN", the
  driver with the plate, the make and the start odometer, Call and WhatsApp, "next: <stop> · about HH:MM · back about
  HH:MM" with Live map while on the way, Stops · planned vs actual (`stopParts`, "8 min late" from the arrive-by), the
  notes, the km, Reassign driver (→ 11) and Cancel task… (cancel_task with a reason) while the task allows them, the
  requester's line with Call. Not shown: Change time or stops, Swap vehicle, Reopen.
- **Needs a driver / Give it a driver** (11, `task/[id]/driver.tsx`): "leaves in 42 min" / "leave-by passed", the red
  "<driver> declined · <why> · HH:MM", Open task →, the trip card, "asked by · approved by" with Call, Who can take it
  (never the driver who declined: their row says so), Give to <driver> · <plate> (reassign_task with the vehicle they
  hold), Cancel task…. Back means back. Not shown: Move the time, Ask drivers (not wired in the hour).
- **More** (19, `(tabs)/more.tsx`): the person with the permission chips, My profile → 18, Work (the built screens not on
  the bar), the laptop-only line, Sign out (asks first), the version.
- **Live** (15, `(tabs)/live.tsx`, `components/DriversMap.tsx` + `GoogleDriversMap.tsx` + `OpenDriversMap.tsx`,
  `office/liveLogic.ts`): live_drivers every 30 s; the map first, a marker per driver with a position (initials; blue on
  a task, green free, grey off duty; the selected one labelled "Sunil · 62 km/h"), the chips All · On a task · Free ·
  Off duty, the rows (the plate, the server's words, a pill); a tap on a row or a marker selects: the map animates to
  the driver and a card shows the name, the plate, the status line and Call / WhatsApp / Open in Maps when the links
  exist; `?driver=` preselects (Home's rows). The engines as the task map: Google first (the package from /me, read
  again every minute), the free map after `phone_map_wait_s` while online or on an error (the session's flag, as the
  task map's), "Map not available" with Try again when both fail; the free map's credit. No trails, playback or
  controls (later). An office sign-in does not report a Google failure (report_map_state is the driver's RPC).
- **Alerts** (16, `(tabs)/alerts.tsx`, `office/inboxLogic.ts`): "Notifications" (the tab is Alerts, decision 3),
  my_inbox (50, every minute), All / Unread · N, by day (Today / Yesterday / Earlier), the kind's colour, bold while
  unread; a tap marks it read (optimistic, mark_inbox_read) and opens the screen its link maps to (`nav.routeForUrl`:
  a request → Approve, a task → Task detail, a task to give → Needs a driver; "Open ›" only on those); Mark all read.
- **My trips** (17, `(tabs)/trips.tsx`, `office/tripsLogic.ts`): my_trips over the last 30 to the next 60 days, All /
  Waiting / Coming up / Done, the live state pill, "Changed by the office", "Approved by … · …" with Call; Withdraw on an
  own waiting request (a reason sheet, cancel_request); a row opens Approve for an approver. Edit is O2.
- **Profile** (18, `profile.tsx`): the permission chips, "Add your phone number…" while the server asks for it, My
  phone number with Edit → update_my_profile then /me again, the work e-mail, a switch per notification event
  (set_my_notification_settings, optimistic, reverted on a refusal), Language, Office phone with Call (get_settings),
  Privacy, the version, Sign out. No sound switch or Test sound until the phone has office push (item 9).

### Tests
- `npm run test:office` (84): the client with a fake server (a dropped /me and read asked again once, a 401 at once and
  signed out, a dropped write once and marked, the keyed write, the 409's words, the error mapping), the tabs, Home's
  sections and chips and More for every preset and the odd sets, the notification links by permission, Home's words,
  Approve's trip rows / availability arguments / first pick / decide inputs / already-decided, the task screens' steps,
  stop lines, "leaves in", Who can take it, reassign and cancel inputs. `test:live` (69) and `test:inbox` (88): the
  Live rules and the strings, the inbox grouping, the trip buckets, Withdraw, the links. The driver's own suites
  unchanged. The strings: every `office.*` key in both languages, checked by script.
- A fresh reviewer's findings and the full run: below, "The checkpoint".

### The checkpoint (19 October 2026, 22:05; branch `phase8-o1` at its last commit; nothing left the laptop)
- **The fresh reviewer** (after everything was built): no blocker. Six items fixed before the checkpoint: Task detail's
  Live map selected nobody (the name was sent, Live wanted the username); decide_request went without the card's
  version (a request edited while the page was open would have been approved unseen); two of the server's "edited since
  you opened it" refusals did not reload the card; `common.back` was missing; Profile's Office phone never left
  "Loading…" when get_settings failed; a dropped write offered no Try again on three screens. Taken from the minors: the
  decline and cancel reasons go to the office in English whatever the phone's language; Live from Task detail through
  the tabs already there; the task actions also by the tools the person may call. Noted, not changed: the office's
  LanguagePill still runs the driver's channel rename (harmless); Alerts' action words are one "Open ›"; the
  notification events' labels come from the server in English; Live's chips and list are under the map, not the
  design's over-map chips and draggable sheet; an approver without assign_tasks sees Needs a driver rows with no
  action (the server's rule); the design's missing elements per screen are in the reviewer's list (most "by the brief":
  O2 or later; the omissions: the requester's Home "today · on the way" card, My trips' search, timeline line and
  driver card, Profile's "Check for update", Task detail's "near <town>" and "12 seats", Needs a driver's legs and
  "would be back"). **The driver's sign-in page looks different** (design 01: the small "සිං · EN" pill instead of the
  two-button switch, "Sign in" in the dark header, the Driver | Office switch); its behaviour is unchanged.
- **The full run** (22:00, 71 s): the driver app's every suite on the local stack (data 95, the eleven offline suites,
  office 84, live 69, inbox 88: 1,082 checks, 0 failed) and the typecheck (0 errors). Nothing outside `apps/driver`,
  `docs` and `CLAUDE.md` changed, so the site's, Deno's, pgTAP's and the connector's suites were not run.
- **Item 9, office push on the phone (built after the checkpoint on its own branch `phase8-o1-push`, from `phase8-o1`;
  server work behind Sahan's go, listed apart):** the migration `20261020010000_phase8_office_push.sql` widens
  `notifications.channel` to `expo_push` and `queue_notification` adds an `expo_push` outbox row for an office recipient
  whose phone registered a device token (the event's on/off applies to both channels; a driver's token never; pgTAP
  `phase8_office_push.test.sql`). `notify-office` delivers it through Expo's push service (`expo.ts`: a request to
  approve, a task that needs a driver and a critical issue loud on `task-ring`, the rest on `task-updates`; the 1.2.0
  channels on an older phone; a token Expo reports gone is deleted; failed and dead as Web Push; `expo_test.ts`).
  `push-task` answers `not_a_driver` for a task whose employee is an office person (the custodian case: never the
  driver's task pushes). The app: `signInOffice` registers the phone's token (`register_device_token`, when
  notifications are allowed) and `signOutOffice` removes it; a tap on an office push opens its screen (the link through
  `routeForUrl`, else Alerts; `TapData.url`). No new UI. Its go: `db push` (one migration), `functions deploy
  notify-office push-task`, then the branch merged before the EAS update.
- **Not built:** Ask drivers (13), and everything listed under "What moved to O2 or later".
- **The EAS update that follows** (after Sahan's go, from main after the fast-forward): channel `preview`, environment
  `preview` (the Google switch on, so the runtime is `1.3.0-gmaps`): it reaches the 1.3.0 phone only (the 1.2.0 phone
  keeps its runtime's last update and its old channels from push-task). It also carries the phone-side changes waiting
  since the 1.3.0 build: the offline sign-in rule (lib/session.ts), the maps' credits (mapCredit) and every failed
  Google map try reported (mapReport).
- **Deployed (GO O1, 20 October 2026, 07:06):** main fast-forwarded to `phase8-o1` (c88c78f); `eas update --channel preview
  --environment preview --message "Office mode O1"`: runtime 1.3.0-gmaps, update group e1944bd6-2af1-4412-a314-cc3302860b7e,
  Android update 01a156f5-a169-7371-be64-e7b36bc0a0cb, commit c88c78f. The bundle was built from the `fame-ops` checkout
  at the same commit (the `fame-ops-main` worktree has no node_modules).

### What moved to O2 or later
- O2 (the trip editor, 06–09): New request, Assign a task, Change the trip / time / stops, Edit a request, Book now, the
  Home's big action buttons, the chips' panels.
- Later Parts: the Drivers board and its tab (12), Ask drivers (13), Live's trails, playback and controls, the issues
  screen, vehicles, the management under More (8.5), 2-step sign-in in the app, the office push on the phone (item 9:
  server work behind Sahan's go, listed apart in the checkpoint).

## 15. O2 as built (19–20 October 2026, branch `phase8-o2`, on top of O1): the rest of a dispatcher's day

Sahan's brief (19 October, 22:30): the same rules as O1 (JavaScript only, no new native modules, no Expo Router
migration, no `packages/shared`, by permission never by role, no dead UI, both map engines on every map, English and
Sinhala, the driver side untouched); one commit per item, an item ships only when it passes its tests and the final
reviewer, an unfinished one is left out; two gos kept possible in the morning (GO O1 = main fast-forwarded to
`phase8-o1`; GO O1+O2 = to `phase8-o2`); stop at 06:30 at the latest. Built in the brief's order, items 1–7, with two
subagents at a time on disjoint files (the lead owned `nav.ts`, the tabs layout, the strings' merge, `package.json`, the
commits).

### Item 1: the trip editor (designs 06–09), `src/office/trip/` and `src/app/office/trip/`
- One flow, three entries: **Request a vehicle** (Home and My trips, with request → `create_request`), **Assign a task**
  (Home and Tasks, with assign_tasks → `create_task`; "Send for approval" when the server answers `waiting_for_approval`)
  and **Edit** (My trips, on a request the person may change → `update_request` with the card's `version`, only the
  fields that changed since the request was loaded: the draft keeps `was`). Four steps with a sticky button and back
  one step: **Where** (the start as the base place or a picked one, up to 12 stops with their type and what, the
  location search `components/office/PlaceSearch.tsx` through `search_places` {text, google?, session?} — our places,
  "used before", the map's results with their credit, Google's results with "Google Maps" under them only when
  `me.map.places` and the tool `google_place` are there, a pasted "lat, lng" or Google Maps link as a pin, "My
  location" through expo-location; a Google pick calls `google_place` and the stop carries `google_place_id`), **When**
  (the day as chips Today / Tomorrow / +2 / Pick a date, per stop arrive-by and dwell chips (the site's dwell rules,
  `dwell.ts`), Back by on the last stop, Leave from with the departure check's words, Plan now), **Who** (a task: the
  Who's available rows from `availability` with the best match ticked once the answer lands, the vehicle chips — the
  driver's today, "On the day" and "Any <type>" when the setting `vehicle_on_the_day` is on, "Choose…" from the free
  vehicles — the title, pax, contact, the project by name, notes; a request: pax, the type needed, "A driver is needed"
  when `self_drive_allowed`, tools, for whom, the project, a note) and **Review** (the plan on the app's own task map,
  `components/TaskMap.tsx`, fed a synthetic task by `planMap.ts` so both engines draw it; the timeline, the totals, the
  conflicts and warnings, the chips; the button names the driver, "Send for approval" or "Save changes"). The plan is
  previewed with `plan_task` (`with_line: true`) 1.5 s after the last edit (`useTrip.ts`). The site's pure logic is
  copied file by file with a header saying so (`tripLogic`, `stopsLogic`, `planLogic`, `assignLogic`, `requestLogic`,
  `departureLogic`, `vehicleChoiceLogic`, `locationLogic`, `durations`, `time`, `format`, `dwell`); the editor's own
  rules are in `draftLogic.ts` (the draft, the steps per mode), `words.ts` (the site's English reasons and departure
  sentences mapped to keys), `whoLogic.ts`, `timeLogic.ts` (`TimeInput`'s HH:MM rule). One draft on the phone
  (`draft.ts`: "Resume draft from HH:MM · Start again"). `components/office/TripShell.tsx` is the step header and footer.
- Not built: Book now on the Who step (an approver's request goes to the queue like anyone's); the pin map to adjust a
  pasted pin; `find_project` (the project is typed by name, the server matches it).
- Tests: `npm run test:trip` (35): the draft and the steps, the copied logic from a draft, the plan on the map, the words,
  the time field, `whoArgs`, the entries by permission.

### Item 2: Ask drivers (design 13), `components/office/AskDriversSheet.tsx`, `office/askLogic.ts`
- The sheet from Approve (10), Give it a driver (11) and the editor's Who step, and from the Drivers board: three
  questions ("Free for a trip?" with the trip's window under it, "When at the office?", "Where are you?"), the drivers
  with the free ones ticked (a driver with no app never), "Send to N drivers" → `ask_drivers` {kind, drivers, date,
  from, to, note, task_id | request_id}. Then the answers from `ask_answers` every 10 s while the sheet is open and
  someone is still to answer: waiting · seen HH:MM · Yes (with **Use**, which ticks that driver on the page) · No · Call
  me (with Call) · a time or a place (with Map). Only with the tool `ask_drivers`.
- Tests: `npm run test:asks-office` (59).

### Item 3: the Drivers board (design 12), the Drivers tab and a driver's page
- `(tabs)/drivers.tsx` for approvers and dispatchers (`drivers_board`): **Now** with the chips All · Free now · On a task
  · Off duty · Not available and their counts, a row per driver (the dot, the plate held today, the status line, the
  next task, Call); **Week** with a cell per day from `unavailability` (a full day red, a part amber), "+ Not available"
  (`set_unavailability`: the day, Full day / Morning / Afternoon / Hours, the reason, a note) and Remove
  (`remove_unavailability`); "Ask drivers" at the bottom. A row opens `driver/[username].tsx`: the profile
  (`driver_profile`: phone, licence, this month, the emergency contact when the server sends it), today's state, the
  not-available entries, **today's route** on `components/RouteMap.tsx` (`driver_route` at tolerance 0, up to 3,000
  points, `estimate_gaps`): the line by speed band, holes dashed, the estimated legs dashed slate, the stops with their
  times, the numbers and the timeline (a row frames its span); both engines (`GoogleRouteMap.tsx`, `OpenRouteMap.tsx`,
  the same engine rule as the task map). Rules in `office/driversLogic.ts`.
- The bar now follows designs 03, 04, 12 and 15: Approve · Live · Drivers for approvers, Tasks · Live · Drivers for
  dispatchers; Alerts moves under More for them (the bell stays on every header). `routeForUrl` opens `/drivers/board`
  and `/drivers/<username>`.
- Tests: `npm run test:drivers` (96); `test:office`'s bar expectations updated.

### Item 4: Issues, `app/office/issues/index.tsx` and `[id].tsx`, `office/issuesLogic.ts`
- The list (`list_issues`): the status chips Active · Open · In progress · Resolved · Dismissed, the severity chips, a
  search box, 50 a page with Load more; a snoozed row says "Snoozed until…". The page (`issue_history`): the facts, the
  links by permission (the task, the vehicle, the driver, the request), the timeline; **Take** (`update_issue`
  {assign_to: me, status: in_progress}), a note, **Resolve**, **Dismiss**, **Open again** — each only with the tool, each
  patching the row. Home's Critical rows open the issue; View all opens the list; More lists Issues with issues or
  assign_tasks. `routeForUrl` opens `/issues` and `/issues/<id>`.
- Tests: `npm run test:issues` (97).

### Item 5: Task detail's extras, `office/taskExtrasLogic.ts`
- **Change time** (`task/[id]/time.tsx`): the day, the leave-by and the end time through `update_task` with the plan
  version, only what differs; a running task keeps its day and leave-by (its end only); a stale version is refused by
  the server and the page loads the task again. **Change stops**: the editor's Where and When in mode `stops` (the
  task's pending stops as the rows, numbered after the reached ones, no Who step), Review sends `update_task_stops`
  with the plan version, the start, the switches and a leave time typed by hand (never a running task's leave-by).
  **Swap vehicle** during a task (`task/[id]/swap.tsx`): every active vehicle from `list_vehicles` ranked as the site's
  MoveVehicle swap (the task's vehicle shown, not offered; free; held by someone, who is told; the garage; another
  running task not selectable), the readings at the swap typed or left to the phone, a reason → `move_driver_vehicle`;
  the answer's readings read back. **Reopen** (a task completed today, as `task_detail.can_reopen` says): a reason sheet
  → `reopen_task`. Each button only with its tool (`extrasFor`).
- Tests: `npm run test:task-extras` (46).

### Item 6: Live's trails, the shown route and playback (design 15), `office/liveRouteLogic.ts`
- Only with `driver_route` (else as O1). **Today's trails**: a toggle in the map's control cluster; one `driver_route`
  call per sharing driver (the first 10, "+N not drawn"), each trail in its own muted colour with its holes dashed,
  fetched again every 60 s and merged by time, never replaced. **The shown route**: selecting a driver loads their day,
  drawn as runs by speed band (standing / under 20 / 20–60 / over 60 km/h), holes dashed, the estimated legs dashed
  slate (openrouteservice's credit joins the credit line), stops over 10 min as circles with their times; the map
  frames the day once; the card says "Today: 61 km · driving 2 h 10 min · stopped 45 min · 3 stops". **Playback**: Play
  / Pause, 1× 5× 20× 60×, a slider, the clock and the speed on the marker; pauses when the tab loses focus. Google's map
  (Polylines, Markers) and the free map (GeoJSON sources and layers) draw the same content through one `layers` prop on
  `DriversMap`.
- Not built: `watch_drivers` (the phone uploads every 10 s while watched on the site), Realtime growth of the lines, the
  zoom / fit / compass buttons.
- Tests: `npm run test:live-route` (111); `test:live` (69) updated for the restructured screen.

### Item 7: the management under More (designs 19–20)
- More's rows by permission (`nav.ts` `moreFor`, `MORE_SECTION`): under Work also **Vehicles** (view: the list and the
  page are read; Register / Edit by their tools) and **Reports** (vehicles or assign_tasks); **People**: Drivers (users or vehicles: decision 1) and Office users (users); **Quick
  settings** (users); the laptop-only line stays.
- **Vehicles** (`app/office/vehicles/`, rules in `office/manageLogic.ts`): the list (`list_vehicles`: the chips All · On
  a task · Available · In garage · Documents expiring · Returned with counts, a search box, 25 a page with Load more; a
  row = the plate, make · seats, the status pill, the availability line, the document chips); the page (the photo
  when there is one, the facts, km this month against the allowance, the documents on file through
  `vehicle_documents` with Open; "adding photos and documents: on a laptop", their upload tools being web-only);
  the form (Register vehicle → `register_vehicle`; Edit → `update_vehicle` with only the fields filled, the current
  values under them; the type and the regular driver as chips; the rental company with "+ Add a rental company" →
  `add_rental_company`; the custodian by name or e-mail, "none" clears; in garage / still rented as Keep · Yes · No).
- **Reports** (`app/office/reports/index.tsx`, read-only): Mileage · Fuel · Duty log over Today · This week · This month
  · Last month, each section only with its tool (`mileage_summary`, `list_fuel`, `duty_log`): the tiles, each vehicle's
  rows (a whole month asked as `month`; a shorter range with the month's allowance beside it), the biggest gaps,
  unlogged km, the odometer checks; the fills with each video's state and Load more; the duty periods with clock in,
  clock out and how, the vehicles held, hours and km, Load more. No vehicle or driver filter; photos and videos open on a
  laptop.
- **People** and **Quick settings** (`app/office/people/`, rules in `office/peopleLogic.ts`): see "Item 7: People" below
  (built by a subagent; its report is summarised there).
- Tests: `npm run test:manage` (the Vehicles list and form, the days and the three tools' inputs, the mileage view, the
  fuel and duty words, More's rows by permission, the screens as text, the strings), `npm run test:people`.

### Item 7: People (Drivers, Office users, Quick settings)
- Built by a subagent on disjoint files (`app/office/people/`, `office/peopleLogic.ts`, `components/office/PeopleParts.tsx`:
  a search box, a card for a secret shown once with Share, the permission picker with the presets as chips and `view`
  locked while another permission needs it, a toggle), wired by the lead into More.
- **Drivers** (users or vehicles): the list (`list_drivers`: search, Active / With switched off, 25 a page with Load
  more; a row = name, code · phone, on duty since · plate, the active pill, the licence chip); "+ Add driver"
  (`create_driver`: name, code, phone, the username rule, a 6-digit PIN typed or generated; the PIN shown once with
  "Tell <name> by phone"). **Manage a driver** (design 20): the dark header with the pill, Call / WhatsApp / Today's
  route (the driver's page) and This week (the Drivers board); Details with Edit (phone, WhatsApp, the emergency
  contact, the licence number and expiry through `update_driver`, only what changed; the private fields only when the
  server sent them), Driving licence, Emergency contact (+ Call), "Phone changed by the driver · <when>" from the
  changes, Account (the username; Reset PIN → a sheet: typed or generated, `reset_pin`, shown once), Regular vehicle
  (from `list_vehicles`' `regular_driver`), "Switch off <name>…" with a confirmation (`set_driver_active`; the server's
  notes after).
- **Office users** (users): the list (`list_office_users`: search, Load more; permissions as lower-case words);
  "+ Add office user" (`create_office_user`: the presets and chips; the one-time set-password link shown once with
  Share, for WhatsApp); the user's page: phone and permissions (`update_office_user`, only what changed; a person
  cannot remove their own users permission), New set-password link (`reset_office_password`, shown once with Share),
  Switch off / on (`set_office_user_active`).
- **Quick settings** (users; `get_settings` / `update_settings`, each row saved at once with Saved or the error): new
  tasks need the fleet admin's OK (`tasks_need_approval`), vehicle on the day (`vehicle_on_the_day`), drivers' personal
  trips (`driver_personal_trips`, the four choices with one line each), auto clock-out (`duty_cutoff`, empty = off),
  the accept window (`accept_within_min`, `accept_before_leave_min`), the office phone (`office_phone`, stored +94…);
  the laptop-only line. Read-only without `update_settings`.
- A PIN or a link is shown once and never logged (the test greps for it). Tests: `npm run test:people` (150).

### What moved to O3 or later
- The trip editor's Book now (an approver booking in one step), the pin map for a pasted pin, `find_project`, the
  WhatsApp link on a task.
- Live's `watch_drivers`, Realtime growth of the lines, the zoom / fit / compass buttons; Move to vehicle and Clock out
  from Live; the driver's page's playback and live growth.
- Issues' Realtime, the vehicle / kind filters, snooze, the Overview's groups; the Maintenance page and "take off the
  road"; Reminders.
- Task detail: the words (title, pax, contact, notes) through `update_task`, the task's route map, photos and history,
  `set_trip_purpose`, `swap_reading`, Save as our place; Tasks → History and Load more; Requests' other chips, search
  and paging; Cancel a booking and Tell requester; the requester's own request page; My trips' search and paging.
- Vehicles' photos and documents by camera (needs an upload tool that is not web-only), Places under More; Reports'
  filters, the fuel videos, the Google and routing counters; the drivers' and licence photos.
- 2-step sign-in in the app; the office push on the phone (item 9 of O1, behind its own go).

### The checkpoint (20 October 2026, 07:00; branch `phase8-o2` at its last commit; nothing left the laptop)
- **Timing.** The round started 22:30 on 19 October. Items 4 (Issues) and 1 (the trip editor) were committed at 22:54,
  item 5 (Task detail's extras) at 23:08, items 2 and 3 (Ask drivers, the Drivers board) at 23:11, item 6 (Live) at
  23:24; item 7 (the management under More) was built 23:15–23:40 and committed at 06:56 after the laptop lost its
  network at about 23:40 and got it back at 06:55. Item 7 took the longest (about 70 minutes of work: the Vehicles form,
  the three reports and the People screens); then item 1. The docs (this section, the parity table, the test plan,
  CLAUDE.md) were written at 23:30–23:35.
- **The full run** (06:57, 21 s): the driver app's typecheck (0 errors) and every suite — the three on the local stack
  (data 96, trips 98, asks 100) and the twenty without it, 1,745 checks, 0 failed. Nothing outside `apps/driver`, `docs`
  and `CLAUDE.md` changed, so the site's, Deno's, pgTAP's and the connector's suites were not run.
- **The fresh reviewer** ran on 20 October, 07:08–07:20, after GO O1 (the network had been gone from 23:40 to 06:55).
  One blocker, fixed: the trip editor's Review map reused the driver's `TaskMap`, whose mount reported the map's outcome
  through `report_map_state` as if the office person were a driver (a `driver_map_state` row and a possible
  `map_fallback` issue "on <name>'s phone"); `TaskMap` now takes `report` (false from Review) and `mapPackage` (the
  office's package from /me, which it ignored before: major 2). Majors fixed: the review and its alert named the
  username ("Send to kamal.p") with English literals from the copied `assignOutcome` — the draft keeps the driver's
  name and two keys say it; the permission names, descriptions and presets were English in Sinhala (the picker, the
  users list, More, Profile) — `office.permission.*`, `office.permissionText.*`, `office.preset.*`; Vehicles under More
  was hidden from `view` (plan section 2 gives view the list and the page) — `need: ['view']`; the trip draft survived
  a sign-out and the next person's sign-in — cleared in `signOutOffice` and on a different e-mail; the bar had Drivers
  before Live against designs 03, 04, 12 and 15 — swapped; "Try again" after a failed Remove of a not-available entry
  only hid the error — it removes again. Minors fixed: "3 pax" and "12 km" literals on Review (keys), Review's send
  error without Try again, '?' fallbacks on an issue's page, four progress bars in mode stops (three), no leave guard
  on Change time and Swap vehicle. Not changed (noted): design 08's vehicle line under the chips and design 09's
  "15 min early" / "Road time" pills, the not-available pill's reason on the board, the regular-driver chips' 100
  cap, the openrouteservice credit's OSM line under Google's credit. Nothing was removed from the shipped screens.
- **The full run after the fixes** (07:26–07:29): typecheck 0 errors; 23 suites, 1,746 checks, 0 failed (the three stack
  suites 294 on the local stack, the twenty others 1,452 in a last clean run after the test expectations were updated).
- **The driver side.** Changed in `apps/driver` outside `src/office/`, `src/app/office/` and `components/office/`:
  `components/navigation.ts` (the leave guard also counts an office sign-in: one line), `components/icons.ts` (exports),
  `components/DriversMap.tsx` with its two engines and `RouteMap.tsx` with its two (office-mode maps), `i18n/en.json`
  and `si.json` (office keys only), `package.json` (test entries). The driver's own suites pass unchanged.
- **Not built in O2:** Book now on the Who step, the pin map, `find_project`; `watch_drivers`, Realtime growth and the
  zoom / fit / compass buttons on Live; the Overview's groups and snooze; vehicle photos and documents by camera (the
  upload tools are web-only); Places under More; Reports' filters and the fuel videos; the Google and routing counters;
  the design's count lines on More's People rows. Listed under "What moved to O3 or later".
- **The EAS update that follows** (after Sahan's go, from main after the fast-forward): channel `preview`, environment
  `preview` (runtime `1.3.0-gmaps`): it reaches the 1.3.0 phone only. GO O1 fast-forwards main to `phase8-o1`
  (c88c78f); GO O1+O2 to `phase8-o2`'s last commit. Item 9 (the office push on the phone) stays on `phase8-o1-push`
  behind its own go (a migration and two functions).
- **Deployed (GO item 9 and GO O1+O2, 20 October 2026, 07:50–08:05):** (1) main fast-forwarded to `phase8-o1-push`
  (b80a668); `supabase db push --linked` after a dry run that listed exactly one migration: `20261020010000_phase8_office_push.sql`.
  (2) `supabase functions deploy notify-office push-task`; both answer (a call without the server key: 401
  `bad_server_key`). (3) main merged into `phase8-o2` (d5acf8a, no conflicts: auth.ts carries the token registration and
  the draft clearing); typecheck 0, office 84, inbox 88, nav 32, maps 65, rules 131, setup 27, notify-office's Deno
  expo_test 4, pgTAP phase8_office_push 11, all passed; main fast-forwarded to d5acf8a. (4) `eas update --channel preview
  --environment preview --message "Office mode O1+O2"`: runtime 1.3.0-gmaps, update group 78225c20-4546-46c5-bedc-1b54339f74e6,
  Android update 01a15719-ef54-7882-9848-7d444ab17550, commit d5acf8a (the bundle from the `fame-ops` checkout at that commit).

## 17. Hotfix O2-H1 (20 October 2026): the location search, then the trip forms' parity, then the parity audit

### Part A as built: the Where step's search showed nothing
- **The cause (the app, not the server).** The connector answered "Kurunegala", "Head office" and "Colombo 05" with our
  sites, the office and the map's places. In the app, `components/office/PlaceSearch.tsx` skipped the search whenever
  `text === value`; the Where step writes every keystroke into the draft (`onText` → `patchStop`), so the box's `value`
  always equalled the text and no `search_places` call was ever sent for a stop — nothing pending, nothing failed,
  nothing shown. (The site's box keeps a `typed` flag instead.) office-api's call shape was right: `POST
  /functions/v1/office-api/tools/search_places` with the session's `Authorization: Bearer` and the `apikey`, body
  `{"text": …}`, permission view or request, the answer `result.results[]`.
- **The fix.** The box keeps the site's `typed` flag (set by typing, cleared by a pick, My location or the clear button)
  and asks after it; a pasted pin at once, else 300 ms after the last key. Under the field there is always one of four
  things from one rule (`locationLogic.ts searchState`): the results (with the pin, the map note and Google's credit),
  "Searching…", "No places found" or the error with **Try again** (which re-runs the same search); never an empty list
  while a search is pending or failed. An empty box shows **Suggestions · nearest first**: `search_places {suggest,
  near}` (the server's new empty-box answer: the places used in the last 90 days, our own pinned places with the offices
  first, the five nearest towns with their distance, nearest to the phone's last known position when location is already
  allowed — no prompt — else the base place, else Colombo; `_shared/fleet/suggest.ts`, pure, with its Deno test).
  `search_places` keeps its contract: `text` is now optional, `suggest` and `near` are new optional inputs, a typed search
  answers exactly as before; a `town` layer (badge Town) exists only in suggestions.
- **Tests.** `npm run test:search` (the rule, the four states, the suggestions' input, the badges, the box and the
  server read as text, the strings); the connector suite gained five suggestion checks (`scripts/test-mcp-local.py`);
  `suggest_test.ts` (Deno). The office suites and the typecheck unchanged.
- **The office-api audit, when something like this needs looking at on the live server:** Supabase dashboard → SQL
  editor: `select at, tool, args_summary, result_summary, actor_name, channel from office_audit where tool =
  'search_places' and at > now() - interval '1 hour' order by at desc;` (every office-api and connector call is audited
  with the person's name; a call that never reached the server is simply absent, which is what this bug looked like).
  The function's own log: dashboard → Edge Functions → office-api → Logs (filter `search_places`).
- **Deployed (GO Part A, 20 October 2026, 09:05–09:12):** main fast-forwarded to 1d14d0a; `supabase functions deploy
  office-api office-mcp`; office-api `/me` without a session 401, the connector's "Kurunegala" search unchanged (the
  empty-box suggestions could not be called from the session whose tool list predates the deploy: the live server
  refused the new field typed as a string, which shows the new schema is up; verified on the local stack by the suite);
  `eas update --channel preview --environment preview --message "Office mode O2: location search"`: runtime
  1.3.0-gmaps, update group b1755069-fbb4-4577-a843-c8fb95501a6f, Android update 01a15753-01ee-7a48-b3ba-70d799458103,
  commit 1d14d0a.

### Part A addendum (20 October, 09:30): the place box locked after one letter
- On the phone every place field switched to its picked state after the first letter ("s" shown as the chosen place with
  "Change place"), so the rest could not be typed. The cause was the Where step, not the box: it showed the box only
  while the stop had no place text, and wrote every keystroke into the stop's `place`, so one letter made the stop
  "placed". Part A's fix (the search itself) did not cover it.
- The rule now: typing never chooses a place. A stop is picked only by a tapped result, My location, or a pasted pin or
  link (`StopDraft.picked`, set by a pick, cleared by typing: `locationLogic.ts typedPatch`); the box's state comes from
  one rule (`placeBoxState`): the picked state (the name with Change) only after a pick, else the text field with the
  keyboard, the results under it and the typed text kept in the draft (leaving and returning restores the text, the
  header says "Typing: …", never a fake place); Change returns to the field with the previous text selected
  (`selectTextOnFocus`). The start box follows the same rule (its default is the base place). One shared component
  (`components/office/PlaceSearch.tsx`) is behind every place field in Office mode: the stops and the start of every
  flow (Request, Assign, Edit a request, Change stops); Approve's "Change the trip" and Places are not built yet (O3).
  Tests in `test:search`: "s", "sa", "sal" keep the text and show the search states, a pick → the picked state, Change →
  the field, leave and return → the text; a stop loaded from the server counts as picked.

### Part B as built: Request a vehicle and Assign a task, everything the site asks, with the planner
- **Parity first.** `docs/phase8-parity.md` "Hotfix O2-H1, Part B": every field, option, check, warning and planner output
  of the site's New request, Assign a task, Edit a request, Change the task and Change stops, against the server's
  inputs, with the app's step and control and a status (in · built B · B-moved under More details · n/a · O3 ·
  decision). One decision for Sahan: times with the native picker need a native module (a 1.4.0 build); the typed
  HH:MM field stays until then. One row left for O3: Approve's "Change time" (decide_request's date / leave-by / back-by).
- **The fields, by the principle.** Where: the start's what gets in · note · minutes under More details when passengers
  get in there; a stop's typed pin and note under More details; "Same as the start · Tick it". When: "Vehicle free by"
  on a task. Who (request): the passengers as a stepper, the vehicle type with Other, "A driver is needed" and tools as
  toggle rows; under More details for whom, the requester's phone (approvers), the project, a note of 1000. Who (task):
  the title and the passengers on the screen; under More details the contact, the notes, the project split (rows with
  find_project's match line 450 ms after the last key, the percentages, Split equally, the total must be 100, the
  reason under the button) and the WhatsApp message option. Shared controls: `components/office/Controls.tsx` (Stepper,
  MoreDetails, ToggleRow, Chips) and `DriverRows.tsx` (Who's available as rows with the best match's reason and Ask
  drivers), used by the Who step, Book now and Change the task.
- **Book now** (a request, with book_vehicle; the site's "Assign now"): `suggest_vehicles` for the day, the leave-by (typed
  or the plan's), back-by, type and passengers; the free drivers as chips; the vehicle in the four groups (Free ·
  Assigned to someone, ask first with Call / WhatsApp · Busy with its back time · In the garage, shown not offered),
  the on-the-day chips with the setting, the default-vehicle line in the site's cases; the custodian drives when no
  driver is needed and the vehicle is assigned; Who's available with Use. Review then has **Book now** as the primary
  button and **Save as waiting** beside it (`TripFooter secondary`); `book_vehicle` through the site's `bookInput`.
- **The planner on Review.** "Leave by HH:MM" with "planned from the arrive-by times" / "as typed" · "estimated times";
  "Updating plan…" while a new plan comes (the one shown stays, dimmed); the timeline as the site (each stop with its
  times, arrive-by and lateness; each leg with km, road time and source, rush hour, via expressway; the totals; back at
  the start); the plan's warnings in the server's words; the conflicts as cards (the text, Open that task for who may
  open tasks, Call / WhatsApp the requester and the driver, Pick another vehicle / driver → back to Who); the vehicle
  the plan takes and why (`vehicle_used`). The map is the app's task map on both engines (Part B's reviewer checks it
  again). The versions: `plan_version` on update_task and update_task_stops, `version` on update_request.
- **After sending: the outcome card** (`formsLogic.ts taskOutcome / bookOutcome / requestOutcome`) instead of an alert:
  "Sent to Kamal" · "Waiting for the fleet admin's OK" · "Booked" · "Request sent" · "Changes saved", Leave by, the
  vehicle used and why (or the server's "changed" sentence), the warnings, the conflicts; Open task (with
  assign_tasks), WhatsApp the driver (the site's message, through the driver's wa.me link from Who's available; "no
  phone number saved" when there is none), The board / My trips / Done.
- **Change the task** (`task/[id]/time.tsx`, the site's TaskEdit): the title, the day, Leave by and Vehicle free by, the
  passengers; the contact and notes under More details; the driver from Who's available (DriverRows, Ask drivers) and
  the vehicle (Keep, the driver's own, On the day / Any type with the setting, Choose… from the four groups);
  `update_task` with the plan version and only what differs (`taskExtrasLogic.ts changeTaskInput`); a running task takes
  the words, the end and the vehicle; the button disabled until something changed, with "Choose what to change first."
- **Tests.** `npm run test:trip-forms` (the split, Book now, the plan's words, the conflicts, the outcome, the WhatsApp
  message, Change the task's input, the screens as text: every field to its input, the versions, the controls, the
  strings); `test:search` (the box); `test:trip`, `test:task-extras` updated.
- **The fresh reviewer** (20 October, 09:41–09:53; field by field against the site, the server's schemas, the designs
  and the principle). Four blockers, fixed: the outcome card could never show (Review cleared the draft, then its "no
  draft" guard rendered a spinner on every step: the outcome now renders first, from its own state, with the flow's mode
  inside it); Try again after a failed Book now sent create_request instead (the last kind is kept in a ref); Change the
  task showed a new driver's vehicle as chosen but never named it (the server kept the old one: it is sent when it
  differs, the site's rule); a running task offered the end time and the vehicle, which the server refuses (hidden; a
  running task takes the words only). Majors, fixed: plan_task ran once per mounted step (When, Who and Review each
  kept their own plan: one plan store for the app, keyed by the input, a call in flight never doubled — rule 10 counts
  every Google call — and Review shows the plan already made); Change the task had no departure check (the shared
  DepartureNote with "Use HH:MM", and the "needs a driver" reason); a driver known to hold no vehicle was not blocked
  (the site's "Add a vehicle": Next disabled with "Pick a vehicle…", and create_task validated with the known default);
  the "on the day" default was off for a task; the timeline rows were English in Sinhala (`words.ts stopTimesT /
  legTextT`, the usual time through `durationText`); Who's available was asked for the wrong point and without the
  request's type and passengers (`whoArgs`: the start only when passengers get in there, `need_type` and `pax`); the
  server's warnings showed twice. Minors, fixed: the Stepper's hook order; "ends HH:MM" without a return; "Open the
  request" on a waiting outcome (with approve); the Booked card says who has what and when; the request's type chips
  in the site's words; the 5 min time chip; Return to office / No expressway as toggle rows; the start's time as the
  same chips; the custodian's chip on Review; Edit a request's re-approval notice, button and outcome; Change the task's
  end-before-start reason and the availability time floored; the reached stops counted in the rows; no leave-by on a
  running task's Change stops; the legs' "From <start>" / "Back to the base"; the chosen vehicle's facts (design 08);
  "Asked by <me> · <phone>" on a request. Noted, not changed: a draft of another mode is replaced without the question;
  the stops mode sends the start even unchanged; the day chips reach 14 days (the date row is O4).
- **The full run after the fixes** (10:03, 35 s): typecheck 0 errors; 25 suites, 1,859 checks, 0 failed (data 96, trips 98,
  asks 100 on the local stack; the twenty-two others 1,565).
- **Deployed (GO Part B, 20 October 2026):** main fast-forwarded to ab35740; `eas update --channel preview --environment
  preview --message "Office mode O2: the trip forms"`: runtime 1.3.0-gmaps, update group a0c7ff7a-a630-4793-9150-f01eec18a2fd,
  Android update 01a15799-babf-7bda-afa6-dbdad4be218f, commit ab35740. No server change.

## 18. Part C (Hotfix O2-H1, 20 October 2026): the parity audit, and the order for O3 and O4

Every row of `docs/phase8-parity.md` (the 138 of the inventory, plus 3 the inventory missed: the date range control,
the Ask drivers / questions pages, the site's search boxes) is now one of **in the app**, **partial** (what is
missing), **missing**, or **cannot on a phone** (why). Counts after Part B (141 rows): 74 in the app, 33 partial, 26
missing, 8 cannot (6 decided earlier: the site import and its undo, the Zoho message, connector keys, 2-step enrolment,
the privacy e-mail; 2 by the phone's nature: web push is the browser's, and the fuel videos need a video player; the
detailed settings beyond the six quick keys are a decided part of a "partial" row).

**Two decisions for Sahan** (the "cannot" rows that are not decided yet):
1. Times with the native picker: `@react-native-community/datetimepicker` is a native module, so a 1.4.0 build. Until
   then the typed HH:MM field (the site's own control).
2. The fuel videos on the phone: `expo-video` is a native module (1.4.0). The receipt and the links can come sooner.
And one piece of server work that four rows wait for: a phone upload for photos and documents (the upload tools are
web-only today): the vehicle's photo and documents, the driver's photo, the licence photos.

### The order, by value for a day's office work

**O3 — history and polish** (the daily work first: what an approver, a dispatcher and the fleet admin reach for):
1. Approve's **Change time** (another day, leave-by, back-by; the start; the minutes at From / To) — decide_request's
   fields the approver uses daily; and **Tell requester** (the WhatsApp text) with the requester's phone on Approve.
2. Requests: the **Approved / Declined / Cancelled / All** chips, the search and paging; **Cancel a booking** with a
   reason; the requester's own request page with its timeline (from My trips).
3. Tasks: **History** (list_tasks over a range, the filters, paging); Load more on the board's columns; Task detail's
   **photos** (odometer, fuel with the video's state), **history**, warnings, unlogged km, charged to, the plan map; the
   task's **route map** with GPS km; the missing swap reading; a driver-started trip's purpose; Save as our place.
4. Live: **watched mode** (the phone uploads every 10 s while the office looks), **Clock out**, **Move to vehicle**, the
   card's speed and battery and the link to the driver's page, the **Problems** chip, the map's zoom / fit / compass.
5. Overview: the tiles' **panels** (road, free, garage, tasks, requests, reminders), **Needs attention** as groups with
   expand, **Snooze** (tomorrow / a week) on issues and groups, the **Reminders** page (documents and services due).
6. Issues: the kind and vehicle filters, the order, the date range, Realtime; the **Maintenance** page (the reports with
   filters, photos, Open task, Call) and "take off the road".
7. Alerts: the search, the History tab, paging. Drivers: the **Questions** list and a question's page; the board's
   search and New task from a row; the driver's page's playback and live growth; the Duty log's driver filter.
8. **Places** under More: the list with the search and the operator chips, the place's page (pin, address, district,
   depot), Remove with the in-use reasons, Restore; the pin map to adjust a pasted pin before saving.
9. The search field at the top of the Approve queue, Alerts and the Drivers tab (the principle).
10. Server work: a **phone upload** (a signed upload the phone can use) → the vehicle's photo and documents (upload,
    replace, remove, restore), the driver's photo, the licence photos. Reports' vehicle / driver filters.

**O4 — the mobile website** (the web build of the same screens becomes the phone version of the office site), plus:
11. The sign-in rows the app lacks: the 2-step code page ("set up 2-step first" when required), set the password from
    the one-time link.
12. One date row for history: Yesterday and a custom From / To on Mileage, Fuel, the Duty log, Issues and History; the
    board's date picker.
13. Settings: the Google usage and routing counters (read); remove a browser's notifications from the phone; the
    sounds' on / off, volume and Test; the Overview's collapsing per person.
14. The fuel fill's receipt and links (the videos with the 1.4.0 decision).

After O4, the rows not "in the app" are the eight "cannot" rows above — six decided, the videos for Sahan's decision,
web push by nature — and the phone upload's four rows if the server work is deferred.

## 19. Stage 0 and O3 as built (20 October 2026, branch `phase8-o3`; nothing published)

**Stage 0, the standard patterns** (`docs/ui-patterns.md`; CLAUDE.md points to it). One shared component per control in each
codebase. App: `components/patterns/` (FilterBar, Calendar with DateRangeButton / DayStrip / TripDayPicker / DateField and a
year jump, TimeField, ListState, Sheet) and `lib/patterns/` (their rules). Website: `ui/FilterBar`, `ui/DateRangePicker`,
`ui/DayPicker`, `ui/TimeField`, `ui/Sheet`, `ui/ListKit` SkeletonRows. Every filter area, date control and time field of the
driver app, Office mode and the website moved; the URL parameters and the server inputs are as before. The place box's
never-ending Loading is fixed (a sequence number, not its own busy flag, guards the answer; every search has a timeout).
The website's transport times out (20 s reads, 30 s writes, 15 s place search; a timed-out write is never repeated by
itself); the artifact keeps none (Claude may hold a call for approval).

**O3** (the order of §18):
- Item 1, history: the driver page's day strip (today and 89 days back, `?date=`), the day's tasks with km, one shared
  playback bar (`components/office/PlaybackBar.tsx`, also Live's), the marker on both engines; Live's Earlier days; a task's
  Show the driven route (`task/[id]/route`).
- Item 2, every tap opens its place: `npm run test:taps` follows every link the server writes (notifications, inbox, push)
  through `routeForUrl` for every permission preset and fails on a route with no screen; every Row has a target. It found
  `/` and `/drivers/asks/:id`: now Home and the new Questions screens (More → Questions).
- Item 3, rows 1–9: Approve's Change time and Tell requester (`office/decideLogic.ts`, `components/office/TellRequester.tsx`);
  Requests' Filter and paging, Cancel booking, the requester's own request page (`office/requestsLogic.ts`); Tasks →
  History, the board's column paging, Task detail's extras under More details, the plan map, the trip purpose, the swap
  reading, Save as our place; Live's watched mode, Clock out, Move to vehicle, the card lines, Problems, the map controls;
  the Overview's chips, Reminders, Needs attention groups with Snooze (`office/overviewLogic.ts`); Issues' kind / vehicle /
  opened filters and Maintenance (`office/maintenanceLogic.ts`); Alerts' history and paging, New task for a driver, Reports'
  vehicle and driver filter; Places with Remove / Restore and the pin check on pasted pins (`components/office/PinAdjust.tsx`);
  the searches on the Approve queue, Alerts and the Drivers board.
- Item 4: a fuel fill's video opens its 1-hour link in the phone's browser (a list over 50 minutes old is read again first).
- Item 5: photos and documents by camera (vehicle photo, documents per kind, driver photo, licence front / back): the file
  goes from the phone to Storage through the signed upload the existing tools hand out (`office/media.ts`); no server change.
- Item 6: the contract check no longer depends on the hour (`scripts/snapshot-tool-shapes.py`). Replaced at the merge of
  Hotfix O2-H2 by its per-state check (§20; Sahan, 20 October 2026): task_detail in three states, each against its own
  fields, and the optional list fields named with their code, instead of letting any nested field be absent.
- Item 7: `docs/release-1.4.0.md` (the native date / time pickers, expo-video, the 11 expo-doctor patches), not built.

Left out, on purpose: Issues' Realtime (read again on return and pull); removing or restoring a vehicle document and dragging a
saved place's pin stay on the website; PDFs are added on a laptop (no file picker in 1.3.0). Live's map cluster has four
controls (zoom in, zoom out, trails, fit) counting the zoom pair as one: a decision for Sahan against "at most three".

**Paused (20 October 2026, for Hotfix O2-H2)** at the checkpoint run; **resumed** after the hotfix's deploy: the hotfix merged
in (Stage 0 uses its Snackbar, Select, crash screen and the patterns' §11–§14), Stage 0's own controls given its selection
look, the three stale e2e lines moved to the Filter sheet, the fresh reviewer's findings fixed (no blocker).
- **Deployed (GO, 20 October 2026):** main fast-forwarded to 880280b (no server change: the photo and document uploads use
  the Part 3 tools already live and Storage's signed upload into driver-photos / vehicle-photos / vehicle-docs); Cloudflare
  Pages (0 source maps, the secret scan empty); `eas update --channel preview --environment preview --message "Office mode
  O3 + the standard patterns"`: runtime 1.3.0-gmaps, update group 5de017df-e9d2-495c-98ce-b62adac247f1, Android update
  01a15941-ca39-74b6-a3bb-5c5e6d039888, commit 880280b.
- **Sahan's decisions on the reviewer's points (to do at the start of Stage 2, shipped with the next update):** Approve
  keeps live updates after Load more, new items as a "New requests ↑" pill at the top (Twitter / Gmail), the list never
  jumps by itself; the driver page splits: the profile with a "Today's route" card opening the route on its own screen
  (week strip and playback there; Uber's driver profile, Samsara); Live's trails toggle moves into the Filter sheet (at most
  three map controls). The §19 "left out" items stay noted for later.

## 20. Hotfix O2-H2 (20 October 2026, branch `phase8-o2-h2` from main `44fc0d2`): no white screen, saved = snackbar

- **What it did:** the white screen after a save (the trip editor's Who step skipped a hook once the draft was cleared;
  `tests/tripSave.test.tsx`, `npm run lint:hooks`); every save closes its form and opens the item with a snackbar
  (`office/trip/successLogic.ts`, `components/patterns/Snackbar.tsx`, `components/office/SavedNotice.tsx`; the site's
  `ui/Toast.tsx`); a crash screen behind every stack with Show details and the reports in `app_errors` (`list_app_errors`,
  Settings → App errors); notification settings in groups with Pause all (app and site, `notificationGroups.ts`); a picked
  thing always looks picked (`components/patterns/Select.tsx`, the site's `ui/Select.tsx`). Patterns: `docs/ui-patterns.md`.
  The connector's shape contract checks `task_detail` by state (`scripts/snapshot-tool-shapes.py`). The web build makes no
  source maps (`vite.config.ts`).
- **Deployed (GO 2, 20 October 2026):** `supabase db push` (20261020100000_hotfix_o2h2_app_errors); `functions deploy
  office-api office-mcp driver-api`.
- **Deployed (GO 1, 20 October 2026):** main fast-forwarded to cae9f83; Cloudflare Pages (fame-fleet.pages.dev, 0 source
  maps, the secret scan empty); `eas update --channel preview --environment preview --message "Hotfix O2-H2: no white
  screen, saved = snackbar, notification settings, visible selection"`: runtime 1.3.0-gmaps, update group
  66f60b92-396f-4782-b61f-21ab4b29f5b2, Android update 01a158c4-fab1-70bf-aa94-3b62d3d39d27, commit cae9f83.

## 21. Stage 2, O4 the mobile website (20 October 2026, branch `phase8-o4` from main `b423a1c`): steps 1–4 as built

The reviewer decisions first (they ship with the next EAS update): Approve's "N new requests ↑" pill and a quiet look every
minute (c111242; a row another approver decided leaves the list, 0c5c0c9), the driver page split with "Today's route" and
its own route screen (b5c47dc), Live's trails in the Filter sheet, at most three map controls (79b4b8b).

- Step 1, the web build (1c994e1): `FLEET_WEB=1 npm run web:export` (apps/driver) builds Office mode for the browser under
  `/m/` from its own route root `src/web-app` (Expo Router is needed for the web build: Office mode's screens are Expo
  Router routes and their links are route paths; a second router would mean rewriting every screen). The driver's side
  is never in it (`state/app.web.tsx`, empty location / background / duty twins, the Office-only sign-in).
- Step 2, the maps (09fbb76): Google's Maps JavaScript API under the google package, every map counted first through
  `register_map_load`; MapLibre GL JS + OpenFreeMap otherwise or when Google fails; "Map not available" when both fail;
  rule 10 by the engine mounted. Not yet seen with a real key (needs the deployed site).
- Steps 3–4 (5937cb8): the sign-in and session (the app's 401/503 rule; one origin with the desktop site), the redirect
  of a phone (a mobile browser, or a narrow touch screen) with `?from=`, the switch both ways remembered (`fleet.view`),
  `webAlert` (Cancel always the safe choice), `apps/office/scripts/deploy-pages.sh` (both builds, `/m/*` routed, no source
  map, the scan, the upload only with `--deploy`).
- Review fixes (0c5c0c9): uploads from a browser (`office/mediaFile.web.ts`), phone-only buttons hidden or given a
  browser fallback, no Expo push in a browser (`lib/push.web.ts`), more desktop links mapped, the Android Maps key never in
  the web config.
- Tests: `test:web`, `test:web-routes`, `test:web-maps`; the site's `viewChoice.test.ts`; the e2e project `mobile-web`
  (24e6b0e). Left: step 5 (installable, the offline page, web push, the favicon) and the rest of step 6; the browser's
  own back / reload on a form with unsaved input (no `beforeunload` yet).
- Deployed 20 October 2026 (Sahan's GO A and GO B): main fast-forwarded to `7af40d4`; the website (desktop + `/m/`, the
  phone redirect held: `PHONE_REDIRECT = false`) by `scripts/deploy-pages.sh --deploy`, the scans clean, deployment
  a0bace8d; the EAS update to preview, runtime 1.3.0-gmaps, group `08f95e1e-7f81-4fcb-b4e6-f4fa98cd1df6`, Android
  `01a159b8-9cd3-7771-92c5-30b101271d51` (built from `61dcb10`: the app's code as `7af40d4`). The packages added for the
  web build (react-native-web, @expo/metro-runtime, maplibre-gl) have no native code, and no native package changed
  since the 1.3.0 build (`ef69255`, versionCode 2). Found after the deploy: a reload of a deep `/m/office/…` address got the
  desktop page (Pages answers `/m/index.html` with a 308, so the rewrite fell through); fixed in `61dcb10`, waiting for
  its go.

## 37. Round 50: office people who drive themselves get the driver flow (29 October 2026, branch `phase9-r50` from main `9398b64`)

Patterns: Uber's one account with a mode switch (rider ↔ driver); Samsara / Motive's driver capability on any user; Zipcar /
Turo's trip flow for whoever drives. Runtime 1.4.0-gmaps (the app part is JavaScript only). Two read-only audits first (the
server's driver paths, the app's driver screens and mode decisions): their tables are §37.8 and §37.9.

### 37.1 The model (the contract for the server and the three clients)

- **`employees.can_drive`** (boolean, null = never decided). true = the capability; false = an admin took it away. Granted
  automatically (null → true, never over a false) when a self-drive trip is made for the person: decide_request approving a
  `driven_by self` request, book_vehicle / create_task with `driven_by self`. Admins grant or revoke it in Users
  (`update_office_user(can_drive)`, the users permission; `list_office_users` and `/me` answer `can_drive`).
- **Setting `self_drive_mode`** (default on): off = no Driving mode anywhere (office self-drivers keep the manual My trip
  flow of Round 4–7, as today).
- **Drives with the app** (SQL `drives_with_app(employee)`, TS `drivesWithApp`): an active driver, or an office person with
  `can_drive` true while `self_drive_mode` is on. **An app trip** = `driven_by driver`, or `driven_by self` on such a person.
  `driven_by other` never.
- **`tasks.driven_in`** app | web | office (null until started): where the trip was started. Set to app by the driver
  screens' start (a trigger on the in_progress write from a signed-in person), web by /m/'s driver-lite start, office by
  `my_trip_check`'s start. The no-app path (`no_app_trips`: "Trip finished? Enter the odometer", "Completed · not
  confirmed", the issue `trip_not_confirmed`) runs only for self / other trips with `driven_in` null or office.
  `my_trip_check` / `finish_my_trip` refuse a trip started in the app or on the web ("This trip is being driven in the app").
- **Self trips need no Accept**: a `driven_by self` task is accepted when it is made (the person booked it), backfilled.

### 37.2 Privacy (office people), enforced on the server, not only in the app

- Location is shared only during their own trip: the app starts sharing at Start task and stops it at Finish (or cancel);
  the server refuses a duty session for an office person unless they have a self trip in progress (duty_sessions insert
  policy), refuses their location points outside a session's time, and closes their open session when their last running
  self trip completes or is cancelled (which also releases the vehicle, as a clock-out does). The cut-off stays the safety
  net. No "Start work", no shift nudge, no "Start a trip", no Change vehicle for them. The task screen says
  "Sharing location until this trip ends".
- Nothing is recorded outside a trip: no heartbeat loop while not sharing (as for drivers), no ask-a-driver, no phone-health
  issues (app_stops stays drivers only).

### 37.3 Server changes (the role checks the audit found)

`send_heartbeat`, `my_office_contacts`, `tasks_take_vehicle`, `queue_task_reminders`, the server-opened session in
`duty_jobs` and push-task's recipient: drivers, or `drives_with_app` people on their own app trips. driver-api: places search and
/errors for them; `/trips` and its stops and cancel (the trips a driver starts in the app) and `/profile` stay drivers only
(403 `drivers_only`). read-odometer (driver mode): `drives_with_app`. Push: changed / cancelled / reminders to a self-driver
on an app trip; no "New task" push for a trip they booked themselves. Accept reminders, missed tasks, late start, licence and
phone-health issues stay drivers only. Office tools: `live_drivers` includes a self-driver while a trip of theirs runs
(card `self_drive: true`; a web trip `web_trip: true` with `last_seen {at, stop}` and never the Live state);
`driver_route` / `task_detail` / the route views treat their trip like a driver's (`driver` resolves an office person by
name or e-mail too); `mileage_summary` / `list_fuel` include their logs under the vehicle and the person.

### 37.4 The app: Driving mode (Office mode ↔ the driver screens, one account)

- Home: "You have a trip to drive · Start driving" while a self trip of theirs is today (assigned or in progress); More:
  "Driving". Entering loads the person's employee row as the driver state without a new sign-in, and shows the existing
  driver screens for THEIR self trips only (`employee_id = me` and `driven_by self`: never another person's task, whatever
  their view permission); "Back to office" returns (a running trip keeps sharing in the background until it ends).
- Off for them: Start work / Finish work, the duty tiles, the shift nudge, Start a trip, Change vehicle, Availability, the
  forced phone and photo steps, Sign out on Me (they sign out from Office mode). Kept: Today, vehicle check, fuel card, the
  task with its slides, Navigate, odometer photo + OCR, Log mileage, the fuel video, Report a problem, Me.
- The sign-in's Driver | Office switch is hidden once this phone's last office account can drive (they sign in as office);
  drivers-only accounts see no change.

### 37.5 /m/ driver-lite (browsers cannot track in the background, and the page says so)

The same trip in the browser for a self-driver: Start (vehicle check, fuel card, odometer photo from the camera), Arrived /
Done slides per stop, Finish (odometer photo, fuel with a receipt photo; no video: MediaRecorder is not reliable on iOS
Safari). Each action sends ONE browser position taken at that moment (with permission; without it the action still saves,
"no position"). Tool `web_trip_action(task_id, action start|arrive|leave|finish, stop_id?, client_id, at, lat?, lng?,
accuracy_m?, odometer_km?, odometer_photo?, check?, fuel?)`; each action and its one position are kept in
`web_trip_actions` (never location points: no GPS line, no Live state, nothing for the trails), its answer kept so a retry
never doubles. The office sees the timeline with the real times and the stops joined by
straight dashed lines labelled "No live route · web trip"; Live: "Web trip · last seen at <stop> HH:MM". The trip page says
"Live tracking needs the Fame Fleet app".

## 36. Release 1.4.0 prep (29 October 2026, branch `release-1.4.0` from main `2e27b87`; not built)

The native items of `docs/release-1.4.0.md` applied (the final list and the permissions there): the in-app fuel video player
(expo-video), the SDK 57 patches (expo-doctor 21/21), expo-clipboard on the crash screen, the office's two sounds on
`office-requests-2` / `office-issues-2` (the 1.3.0 pair deleted once replaced; notify-office prefers the new ids), light
only (force dark refused). Version 1.4.0, versionCode 3 (EAS raises it at the drivers build), runtime `1.4.0-gmaps`, the
`drivers` profile (Sahan's decisions at the prep).

**Updates after the build.** EAS Update gives a phone only the updates published for its own runtime. Phones still on
1.3.0 (`1.3.0-gmaps`) keep working on the last update published for that runtime (group 4ddf1877, "Password links: 7 days,
preview-safe", commit c0cc9c0) and get nothing newer until they install the 1.4.0 APK; the server keeps answering them as
before (their channels, their tools). **Round 50 and later publish to runtime `1.4.0-gmaps` only**: once main carries 1.4.0,
`eas update --channel preview --environment preview` from main targets it. A JavaScript fix that 1.3.0 phones must still
get is published from a commit whose app.json says 1.3.0 (as the 1.1.0 phones got theirs from d63c838), never from main.
So: build from `release-1.4.0`, install the pilot phones, then fast-forward main.

**Built 29 October 2026 (Sahan's go).** notify-office deployed first (the `-2` channels only for phones that registered
them; 1.3.0 phones keep their pair). EAS build `4e0e0eba-d542-4d41-956c-08e2936c901f` (profile `drivers`, commit `9398b64`,
finished 09:37 UTC): version 1.4.0, **versionCode 3**, runtime **`1.4.0-gmaps`**; the APK
https://expo.dev/artifacts/eas/SMzCo0z0jpR6aqcelesUWfTp_woAq047Yqx1Bh4Tqfo.apk (77.2 MB). Checked: arm64-v8a and
armeabi-v7a for all 28 native libraries, every one stored uncompressed and 16 KB aligned; the eight notification sounds kept
by name (plus the two in-app ones); RECORD_AUDIO not in the final manifest. Main fast-forwarded to `9398b64` (CI run
40847466388 passed); the site and /m/ from the same commit (136d0051). Round 50 and later publish to `1.4.0-gmaps`.

## 35. Round 49: set-password links survive being opened (29 October 2026, branch `r49-password-links` from main `c3103a3`)

**What broke.** Shashen Herath (created 28 October 18:06) could not set his password; a second link followed at 18:10.
Reproduced on the live site the next morning with a test office user (R49 Link Test, view only, switched off after):
a link opened straight in a fresh browser worked (the form, the eye, Save, Overview, and sign-in again), but the same kind
of link fetched once the way WhatsApp's preview fetches it (a GET with WhatsApp's user agent) was used up, and the person
landed on `/set-password#error=access_denied&error_code=otp_expired`, which the site ignored: a plain Sign in page with no
word of why. **Cause in one line: the links were Supabase's own one-hour recovery links, which any GET uses up, and
WhatsApp's link preview made that GET before the person tapped it.** The eye toggle did not cause it: the site with the eye
went live about 18:55, after both links.

**The rule now (Google Workspace's and Slack's invite pattern).** `_shared/fleet/passwordLinks.ts`, migration
`20261029100000_round49_password_links`, office-api's two public routes, the site's `auth/LinkPassword.tsx`:
1. A link is `<site>/set-password#k=<token>` (32 random bytes; only the SHA-256 is stored in `password_links`, service role
   only). The token is after the '#', so loading the page sends it to no server; a preview reads only the page's HTML.
   Opening it any number of times only asks its state (`POST /public/password-link`, notes `opened_at` the first time).
   Valid 7 days.
2. Only a successful Save uses it (`POST /public/password-link/set`: the rule (12+ characters, at most 72 bytes), then the
   link claimed in one locked step (`password_link_check(hash, true)`), then Auth's admin API sets the password; Auth's
   refusal gives the link back). It also dies when a newer link is made for the person (`replaced_at`), when the password
   was set another way since (each link keeps a fingerprint of the account's password hash; nothing is added to the auth
   schema), or when the account is switched off.
3. The page: valid → the form (with the eye) naming the account, then it signs the person in and opens the app; anything
   else (used, replaced, expired, password set, switched off, no token, or one of Supabase's old used links) → "This link
   has expired or was already used. Ask the fleet admin for a new one." with Sign in. English and Sinhala with a switch
   (the site is English; this page is the first a new person sees); the choice is remembered on the browser. Another link
   pasted into the same tab reloads the page. The save is in the activity log ("Set their password through the link").
4. The other link kinds: drivers have no links (an admin types a new PIN: `reset_pin`); a personal connector key's URL is
   not consumed by opening (it works until revoked). Neither changes.
5. The tools: `create_office_user` and `reset_office_password` answer `link_valid_for: "7 days"` (the shape unchanged);
   the site's and Office mode's hints say it works until the password is saved (Office mode: "දින 7" in Sinhala).

Tests: pgTAP `round49_password_links.test.sql`; Deno `passwordLinks_test.ts`, office-api `handler_test.ts`; the connector
suite's section 8 (api channel: opened three times, only the hash stored, short password 400, Save 200, then used 409, an
unknown token, the activity row without the password); Vitest `auth/LinkPassword.test.tsx`; the app's `test:people`; the
e2e `office.spec.ts` "Round 49" (a preview HEAD and GET, a first open in a fresh browser, a second open, Save → Overview,
the used link in English and Sinhala, an expired link, a replaced one, an old Supabase landing) and every e2e sign-in now
through the new link (`e2e/links.ts`).

**Deployed 29 October 2026 (Sahan's go after CI run 40820149117 passed: 49 passed, 1 flaky under CPU cut-offs).** The
migration `20261029100000_round49_password_links` (the dry run listed only it), the site with /m/ (635e2bb8, the scan found
nothing), then office-api and office-mcp (the site first: it still reads Supabase's old links; the old site would not read the
new ones). Live check with the test office user R49 Link Test (switched on for it, off after): a WhatsApp-style HEAD and GET
of a fresh link, two opens in fresh browsers (the form naming the account), Save with the eye → Overview, the activity log
"Set their password through the link", and a third open → "This link can't be used" in English and Sinhala.

### 35.1 The ors_gap errors (29 October 2026, branch `r49-ors-gap` from main `c0cc9c0`; not deployed)

28 October: 6 calls, 6 errors (23 October: 102, 60). Reproduced on test.driver's 23 October route (44 gaps, 42 cached
lines; the 2 missing ones cost 4 calls and 4 errors today): both share one poor fix (7.302749, 80.141455, 100 m accuracy)
about 1.2 km off the road, with only a footpath within 350 m (OpenStreetMap's Overpass). openrouteservice answers that
with HTTP 404 and its own error 2010 ("Could not find routable point within a radius of 350.0 meters"); `orsFetch` took
every 404 for "the path moved" and asked the old host too (two requests, two errors per gap), and a failure is not cached,
so every view of the day asked again. Fix (narrowed at Sahan's review): `orsFetch` skips the old host ONLY when the
answer is openrouteservice's "no road near a point" (code 2010, or its message "Could not find routable point"); any
other 404 or 410 (2009 no route, another code, a gateway's) still tries the old host, and other statuses (a 5xx) are the
answer as before. Only that no-road result is remembered: the gap counts as a call made (not an error), is kept 30 days
as an empty line in `route_gap_lines` (no migration) and is drawn straight with "Some gaps have no road near a GPS point
(a poor fix): they are straight"; every other failure is an error and is asked again next time. Tests: orsHosts_test
(2010, the message alone, 2009 / another code / a gateway's 404 fall back, a 5xx unchanged), gapRoutes_test (no road:
one request, counted ok, kept, the next view asks nothing; by message too; 2009: both hosts, an error, not kept; a 500:
an error, not kept). Deploy: office-api, office-mcp, driver-api, fleet-jobs (routing.ts's road
times use orsFetch too).

## 34. Round 48 (28 October 2026, branch `phase9-r48` from main `99dbab9`, worktree `~/projects/fame-ops-r47`)

**State at the start (28 October):** main `99dbab9` pushed and green (CI 39782874213); Round 4–7 deployed on 22 October
(migrations through `20261022130000` on the remote; `office-api`, `office-mcp`, `driver-api` and the jobs with the new tools
live: `vehicle_checks`, `holder_asks`, `retention_preview`, `list_app_errors`…; the website `f50802c2` from `99dbab9`; EAS
update group `093e3162-c2d6-471e-b804-29239796dc89`, runtime 1.3.0-gmaps, "Round 4–7: vehicle check, fuel card, passengers,
who holds it, lists, retention, per person, new screens"). Nothing unmerged on main's side; `phase9-rd` (the design pilot) and
the `design-pilot-*` branches stay parked (§32); the r47 worktrees (`fame-ops-r47-*`) are merged and can go.

**Deployed (28 October 2026, Sahan's chained go after CI run 40666236974 on `phase9-r48` passed: 49 e2e tests, none
flaky):**
1. Server: `db push` applied `20261028100000_round48_proposed_changes`, `20261028110000_round48_no_stored_google_roads`
   and `20261028120000_round48_cost_controls` (the dry run listed those three alone); `office-api`, `office-mcp`,
   `driver-api`, `fleet-jobs` and `read-odometer` deployed. Checked live: `get_settings` answers `odometer_server_daily_cap`
   500 and the Google caps with today's usage; `retention_preview` names the stored lines as OSRM only; the queue answers
   with the new card shapes. The one live call as a non-approver (a reassignment answering waiting_for_approval) was not
   made from this session (a personal key for another person's account is not Claude's to create): the e2e on this build
   proves it; Sahan checks it on the site as sashen.
2. Main fast-forwarded to `0e0540c` (`~/projects/fame-ops-main`), key scan 0, pushed; main's CI 40671302432.
3. Website and /m/: `scripts/deploy-pages.sh --deploy`, scan: nothing found, https://7908df6b.fame-fleet.pages.dev; `/`,
   `/m/`, `/m/offline` and `/privacy` answer 200.
4. Native check against `99dbab9`: only test scripts changed in `apps/driver/package.json`. EAS update "R48: approvals for
   changes, map pages, trip-date availability, snap in app, cost guards": group **d08b4396-cff9-49e6-b688-d7a1b886870b**,
   Android 01a1820a-1cdd-7443-a7f9-62c76ae1fb7e, runtime 1.3.0-gmaps, commit 0e0540c.

### 34.7 The snap hotfix (28 October 2026, branch `r48-snap-hotfix` from main `0e0540c`)

**What happened.** One real two-hour test drive (Thilina Teshan, to Negombo), watched live by two office viewers (the
activity log: "Watch drivers" every 30 s from 15:26 by Sahan and Test Fleet Admin, which is the driver page or Live with
the route shown, on the site or in Office mode), consumed the whole Google snap-to-roads day cap (215 calls + 10 refused;
351 by evening after the cap was raised). The cap held and the free line took over: a call-volume bug, not a billing one.
**The source:** the office viewers' live watching through `driver_route snap` (the driver's own app never snaps); every
60-second route poll that landed on a cold isolate snapped the whole day again (the Round 48 memory cache is per isolate),
and a growing leg went out only in whole 100-point chunks.

**The fix** (Google's live-tracking guidance for the Roads API; Uber's pattern):
- **Incremental, throttled, shared:** a growing leg is snapped only from its last snapped point (`MATCH_OVERLAP` 5 points
  sent again for a clean join), at most every `TAIL_MIN_MS` (3 min) and only once `TAIL_MIN_POINTS` (30 thinned points,
  about 10 minutes at 20 s a point) are waiting, or a whole chunk; between refreshes the newest tail is drawn raw (the
  small correction on refresh is the industry-normal look). Finished legs are never snapped again; every viewer of an
  isolate reads the same memory (30 minutes). Screen open = one request: the clients already poll once a minute, never per
  Realtime point. A two-hour drive with a point every 20 s costs about 14 Roads calls, whoever watches; a second viewer
  on the same isolate adds none. Honest limit: Supabase runs several isolates; a viewer on another isolate pays its own
  snaps once (then that isolate's memory serves it); the budget below bounds that.
- **The per-driver budget:** the setting `roads_trip_daily_cap` (20 by default, 0 = never snap): `roads_trip_take` (the
  table `roads_day_calls`) is taken BEFORE the fleet counter; past it that driver's route shows the GPS line until
  tomorrow and one info issue opens ("Snap to roads for Thilina paused today: 20 of 20 calls"), instead of one trip eating
  the fleet's day cap.
- **Usage by source:** `google_take` gains `p_source` (the table `google_call_sources`): `driver_route` takes `source`
  (site_route, site_live, site_task, app_route, app_live, app_task; the clients send it; claude / web when absent;
  "_playback" for a past day), and `routing_usage` / `get_settings` answer `sources_today` per feature, so the next
  anomaly reads at a glance. Migration `20261028150000_round48_snap_budget.sql`.
- Tests: `matching_live_test.ts` (the two-hour drive with three screens polling every minute: under 15 calls, the second
  viewer pays nothing, the line never more than a refresh behind; the budget refuses the fourth call and the fleet counter
  saw three; yesterday's playback is one batch and the next viewers pay nothing; the tail rule), `matching_test.ts`,
  `issues_test.ts`, pgTAP `round48_snap_budget.test.sql`, the clients' argument tests.
- Also in this update: the show/hide eye on every password and PIN field (Material's visibility toggle), all four surfaces.

**Hotfix deployed (28 October 2026, Sahan's chained go after CI run 40681397500 on `r48-snap-hotfix` passed: 49 e2e
tests, none flaky):** `db push` applied `20261028150000_round48_snap_budget` alone (the dry run listed it alone);
`office-api`, `office-mcp`, `driver-api`, `fleet-jobs` deployed. Checked live: `get_settings` answers
`roads_trip_daily_cap` 20; `routing_usage` answers `sources_today` from the first Roads call counted after the deploy
(today's 679 calls were all before it). Main fast-forwarded to the hotfix branch; the website and /m/ and the EAS update
"R48 hotfix: snap incremental and budgeted, password eye" follow in the same chain (their ids in the checkpoint).

### 34.1 Item 1: the approval bypass (security, done first)

The hole: with `tasks_need_approval` on, only `create_task` went to the fleet admin (§33). A dispatcher (assign_tasks, no
approve) who resolved a "driver declined" task gave it straight to the new driver: `reassign_task` (Give it a driver, the
needs-a-driver list, Use this driver / Assign →), `update_task` (the day, time, end, driver or vehicle) and
`update_task_stops` (the stops, and with them the plan and the leave-by) all wrote the task and pushed the driver.

The fix (server, both channels, one gate): `tools/changes.ts` `needsApproval(settings, actor)`. When it says so, the call is
written as a vehicle request of **kind change** that names its task (`vehicle_requests.change_task_id`, migration
`20261028100000_round48_proposed_changes.sql`) and carries the exact call, what changes and the task's plan version in
`proposal_json`; the task is untouched; the approvers are pushed "Change to approve · Sashen proposes driver Kamal instead of
Nuwan"; the answer is `waiting_for_approval` + `task_unchanged`. One waiting change per task (a second is refused naming who
proposed what and when). `decide_request` approve applies it by running the same tool as the approver (the history,
`approved_by` and the audit are theirs; a stop change whose plan moved on since is refused); decline leaves the task alone;
`cancel_request` lets the proposer withdraw it; `update_request` refuses to edit a proposal. The words alone (title,
passengers, contact, notes) go straight. `list_requests kind change` and the cards' `change {task_id, task_title, tool,
summary, changes, task_was}`; `pending_change` on the board's cards, the needs-a-driver rows and `task_detail`; the
`request_waiting` issue and the 30-minute reminders name a proposed change.

Every write path audited (the table): see "Item 1 write paths" in the checkpoint; the ones left direct on purpose (for
Sahan to confirm): `cancel_task`, `reopen_task`, `move_driver_vehicle` (a live swap on a breakdown), `swap_reading`,
`set_trip_purpose`, `clock_out_driver`, a driver's own trip (`driver-api /trips`).

Clients: the website (ChangeDecide, the notices on the task page, the board, needs a driver, Requests, the Overview, My
trips, the request's page) and Office mode / /m/ (the same places in the app).

Tests: `tools/changes_test.ts`; pgTAP `round48_proposed_changes.test.sql`; the connector suite's Coordinator section on
both channels (the reassignment waits, the task keeps its driver and gets no push; a second change refused; the queue lists
it; approve → only then the driver changes, in the admin's name; a time change withdrawn; a stop change declined leaves the
stops; a title alone goes straight; the setting off = direct); the site's `changeDecide.test.tsx` and `giveDriver.test.tsx`.

### 34.2 Items 2 and 3: the driver's day and route pages (site, Office mode, /m/)

Patterns: Airbnb's split view / Google Maps Timeline (the layout), Apple Maps' and Google Maps' info sheet (the ⓘ), Google
Maps' Layers inside the one Filter sheet (ui-patterns §1), Google Maps' marker clustering (a grid by zoom, no new native
module: `apps/office/src/map/cluster.ts`, `apps/driver/src/lib/cluster.ts`). The standard is `docs/ui-patterns.md` §18.

- **Site** (`DriverPage`, the task page's route, Live's shown route): a desktop shows the map in a sticky pane that never
  scrolls with the page, the details in their own column, the playback bar overlaid on the map's bottom edge (34 px above
  Google's logo and the free map's attribution); under 768 px the map is a fixed-height pane (45 % of the viewport, min
  300 px) with the playback under it and the content below. The wheel over the map zooms it (MapLibre `cooperativeGestures`
  off, Google `gestureHandling: greedy`); the page never zooms it. The explanatory sentences ("Dashed slate…", "Km from GPS,
  drift filtered…", "Line: N of M points") and the full credits live behind the ⓘ "About this map" sheet (the existing
  `ui/Sheet`); the legend is one compact row; the licence credits stay on the map (Google's logo and terms; "© OpenStreetMap
  contributors · OpenFreeMap"; "Route © openrouteservice.org by HeiGIT · map data © OpenStreetMap contributors" in the row
  whenever an estimated line is drawn). Start and end are pins, stops are dots under the line, the event markers (no GPS, app
  not running, stops) are off until Layers → Events (`?layers=events`); a timeline or gap row still opens its mark with the
  layer off; overlapping marks cluster into one numbered circle (tap = zoom in); the route line draws above the dots (a
  layer before `route-line` on MapLibre, `mapPane` on Google, the SVG order on the drawn map); pins, event marks and
  clusters stay above it so they can be tapped. The mockup picture spec gains `7-driver-day` (1440 × 900 and 412 × 915 of the
  same page with a 49-point route).
- A cancel or a reopen stays direct; one made by someone without approve while tasks need the fleet admin's OK tells the
  approvers ("Sashen cancelled Team drop · Galle"; `tellApproversOfDispatch`, the `request.created` event's recipients).
- **Office mode and /m/** (`components/office/DayRoute.tsx` owns the layout; the driver's day, a task's driven route, Live;
  the task pages' maps at the same height rule): the map at `mapHeight` (45 % of the window, min 300 px) outside any
  scroll, the control row [ⓘ · Filter(Layers)], the snap note, the playback bar, then the content in its own scroll (pull
  to refresh). The ⓘ sheet (`office/routeInfo.ts`) holds the legend drawn as on the map, the notes and the full credits; the
  credit line stays on every map. Start/end pins, stop dots (the time on tap or Layers → Stop times), gap markers via Layers
  → Gaps and signal loss; the summary's gaps line opens a Gaps sheet whose row highlights the spot; clusters by zoom on
  both engines (`lib/cluster.ts`). The driver's running task keeps the approved 50 % (mockup 6); TaskPreview and Review's
  map card are not route/playback screens and stay.
- **Not achievable, said plainly:** "the route line above the markers" on the native SDKs (Google Maps Android draws every
  marker above every polyline; MapLibre RN markers are native views) and for HTML markers on the web maps. The stop dots are
  12 px with a ring so the 5 px line reads through; the playback marker stays on top.
- **Decided at Checkpoint 48 (Sahan):** the Filter/ⓘ row stays between the map and the playback bar in the app; the
  site's "Line: N of M points" sentence and the legend's "Start / end" row (site and app) are removed; the Gaps sheet stays
  under Layers / ⓘ; the summary's "No GPS for …" line stays.

### 34.3 Item 4: free or busy by the trip's date (Google Calendar's room and attendee picker)

One window rule on the server (`_shared/fleet/window.ts` `tripWindow`: start → end_by, else the plan's end, else the rest of
the trip's day; the same for the other tasks, so Who's available and the assign warnings agree), used by `availability`,
`suggest_vehicles`, the needs-a-driver best match, `task_detail.suggestions`, `assignCheck`, `ask_drivers` and
`drivers_board`. The best match: a trip starting within 2 hours keeps the old rule (on duty now, nearest the first stop);
a later trip ranks everyone free THEN (off duty now or on a running task now included), fewest tasks that day, no km. The
words: "Free Thu 29 Oct" / "Free today" / "Free tomorrow", "Busy 09:00–13:00 that day · Title" (with the pieces for the
app's Sinhala), the window as "tomorrow 09:00–13:00"; "In the garage now · not known for Thu 29 Oct" (the garage is the one
thing only known now). Additive tool fields: `availability` (`planned_end` in; `window.words / end_source / soon`, per row
`free_text / free_day / busy_text / busy_from / busy_to / busy_title`, `best.free_day / soon`), `suggest_vehicles`
(`planned_end`, and `date / time / back_by` honoured with `request_id`; the chips; `garage_now / garage_text`),
`drivers_board` (`trip_date / trip_from / trip_to`; `trip_free` and the chips), the needs-driver rows (`window_words`),
`task_detail.suggestions` (the chips and `window`). The clients send the plan's end, show the trip's chip on every list
(Who's available, Who can take it, Give it a driver, Approve, the vehicle select on New task and Change, Ask drivers, the Ask
sheet) and keep every "now" line (status, last seen, next task, "Free now") beside it. Left as a default on purpose:
`defaultVehicleFor` / `pickVehicle` (the held or regular vehicle; `vehicle_on_the_day` covers later days). The audit table
(path | window before | after | words | surfaces | test) is in Checkpoint 48.

### 34.4 Item 5: snap to roads in Office mode and /m/, display only

Provenance: `route_matched` stored each driving leg's road geometry for `google_roads` (Google's Roads API answers) and
`osrm`, written only by `snapLegs` from the website's `driver_route snap`; Google rows went 30 days after `matched_at`
(`prune_google_content`), but a growing leg's re-snap reset `matched_at`, and the retention rule removed them with the
points (183 days). **Sahan's decision applied:** Google's answers are never written: `snapLegs` keeps them in the isolate's
memory (`googleRoadsStore`, 30 minutes from the last match, 200 legs); migration `20261028110000` deletes the stored
google_roads rows and the provider check allows `osrm` only; `retention.ts` and the app's Data retention say so. The app and
/m/ ask `snap` on Google's map (or under the open package, like the site's `snapAllowed`: OSRM users keep snapping; "Google
engine only" is a one-line change in `office/snapLogic.ts`), draw `route_snapped` labelled "Snapped to roads", else the raw
GPS line + the dashed estimates labelled "GPS line"; a chip in the map's control cluster; km from the odometer. The cost:
about one Roads call per 100 thinned points per driving leg per cold view (a new isolate or a leg not asked in 30 minutes);
every call counted before it is made, fail closed, caps 215 a day / 4,750 a month; a day of 8 legs and 80 km ≈ 16 calls
cold; 10 drivers viewed cold once a day ≈ 160, near the day cap. **Decided at Checkpoint 48: display only, for good** (the Roads policy
as read: storage restricted, only place IDs exempt). Google-snapped lines never reach the free map, site included: the server
picks `google_roads` only under the Google package (`snapProvider`), the site asks snap only on Google's map or under the
open package (where the provider is OSRM or none), never on the free map standing in for a failed Google map.

### 34.5 Item 6: cost and security controls

- **6a, every paid call fails closed and is counted first.** Unchanged (already so): the Maps JS load, Places Autocomplete,
  Place Details, Routes, Roads. Fixed: the Gemini odometer read in driver mode (counted BEFORE the model call by the new
  `odometer_take('driver', employee, 60)` under an advisory lock; a counter error = 503, no call; before it counted after
  the call, failed open and raced past 60), the Gemini server mode (no cap → `odometer_server_daily_cap`, default 500, max
  5,000), openrouteservice's directions and gap lines (a counter read error used to throw the whole plan; now no call and
  the estimate; the 404/410 host fallback's first request counted), the map search's autocomplete (failed open on both
  counters; now closed). Uncapped by design: OSRM (self-hosted, free) and the Google short-link resolver (free, 5 hops). New
  issue kind `usage_cap`: one warning per feature per day or month at 80 % of its cap ("Google routes at 82% of today's
  cap"), critical at 100 %, updated in place, resolved when the period rolls over; under the issues permission. Migration
  `20261028120000` (`odometer_calls`, `odometer_take`). Still "check before, bump after" (not atomic): the ORS directions
  and gap counters (a follow-up: an atomic `routing_take`).
- **6b, rate limits** (`_shared/fleet/rateLimit.ts`, token buckets, bounded, one body `429 { code: "rate_limited", message:
  "Too many requests · try again in a minute" }`): office-api 120 a minute per person as before + 30 a minute per person on
  the paid tools (search_places, google_place, register_map_load, plan_task, create_task, update_task_stops, update_task,
  reassign_task, create_request, update_request, decide_request, redecide_request, book_vehicle, driver_route; not
  task_detail, whose one Google call is cached 15 minutes) + 20 refusals a minute per address on the unauthenticated /
  401 / 403 / 404 path BEFORE Auth; driver-api 60 a minute per driver + 30 on the paid routes + the same per-address bucket;
  office-mcp 120 a minute per key (the shared key, or a personal key by a hash prefix, never the key) + 30 on the paid tools
  as a tool error + 20 wrong or missing keys a minute per address before the `office_keys` lookup. Tests for every wrapper.
- **6c, the clients' circuit breaker** (site `transport/breaker.ts`, app `lib/breaker.ts`): the same tool called more than
  30 times in a minute (a page polls at most twice a minute; a loop reaches 30 in seconds; 30 = the server's paid budget, so
  the client stops first) stops for 60 s with `{ code: "loop", message: "This screen asked the server too often · try again
  in a minute" }` and sends ONE app-error report per tool per 10 minutes (Sentry's throttling) through POST /errors; the
  artifact's connector transport stops the loop but has no /errors to report to. Tested with a forced effect loop.
- **6d, the security pass** (a fresh reviewer, read-only, about 40 minutes). No critical or high. Fixed: **M1** the names
  sent with a gated `update_task` (passenger_list) went onto the live task at once while the change waited (now kept with
  the proposal and written at approval); **M2** the per-address buckets took `x-real-ip` first, a header a caller may set
  (now the gateway's last `x-forwarded-for` entry wins); **L1** a proposal was applied over a task the approver had moved
  in between (now the task's state is recorded and the approval refuses when it moved); **L2** one waiting change per task
  was a code check only (now a unique partial index); **L3** a Google pick's name, address and pin stayed in a stops
  proposal for good (now the place id only, rule 10). Checked and clean: every route's auth and permission on the three
  functions; the proposal's tool and args constrained (three tools, the task id and plan version overwritten, no other
  writer of `proposal_json`, a proposer cannot edit or decide their own); `list_requests` without approve is one's own
  whatever the kind; RLS and grants on every table of Round 4–7 and this round, the storage policies; no key in `dist/`,
  the artifact or the /m/ export (the anon key and the URL only); `register_map_load` web-only and counted first; the
  connector key constant-time, 404, never logged, the per-address bucket before the lookup; CORS; every search filter
  escaped; the pasted-link resolver on Google hosts only; the /errors endpoints behind a session, capped and scrubbed.
  Informational: `approveChange` runs the three tools as the approver without a second `canCall` (an approver already
  creates and assigns tasks through `decide_request`); driver-api sends no CORS headers (the native app; /m/ has no
  driver side).

### 34.6 Also this round
- The Ask drivers sheet's initial state read the trip-window rows before they were declared (a crash on open under
  Hermes; jest's Babel turned it into "undefined.filter"): caught by five component suites on the merged tree, fixed.
- `task_detail` is not in the paid-tools bucket (above); the Ask drivers page tests wait the 400 ms the board query now
  debounces.
- pgTAP on the merged tree: a proposed change always carries its proposed driver (`vehicle_requests_proposed_check`),
  `odometer_calls` is one more table (69) and service_role may not delete from it.

## 33. Round 4–7 plan (Sahan, 22 October 2026, branch `phase9-r47` from main `e6057b2`, worktree `~/projects/fame-ops-r47`)

Rounds 4, 5, 6 and 7 are one round: build everything, then test once, review once, deploy once. Each feature has its own
commits and its own migration file (any one can be reverted alone) and its own switch in Settings → Fleet → Dispatch, on by
default, read by all four surfaces and the connector, so the office can switch one off live without a deploy:
`vehicle_check`, `trip_close_prompt`, `fuel_card`, `passengers`, `holder_contact` (migration `20261022120000_round47_switches`:
`fleet_switch(key)`, no row = on; `get_driver_settings` answers the five; `get_settings` / `update_settings` know them).
While building: only the fast checks and the feature's own unit / component tests. At the end: one connector suite run (both
channels), pgTAP, Deno, one CI run, one fresh reviewer for the whole diff. Up to 2 subagents on independent features, each
in its own git worktree (never a stash), none during CI. All four surfaces (the site, /m/, Office mode, the driver app) and
Claude; English and Sinhala; an audit table per feature.

### 33.1 Feature 4: the vehicle check and closing a no-app trip

**Industry patterns:** Samsara / Motive's pre-trip inspection (DVIR: one tap for no defects, a defect with a category and a
photo, each vehicle's latest inspection for the office); Turo / Getaround's check-in photos (front, back, left, right);
Zipcar / Turo's return (End trip with the odometer and the fuel; a trip nobody ended closes by itself and is flagged).

**Sahan's answers (22 October 2026):** Damage is a sixth category: yes. A self-driver's check asks the odometer (typed; no
reading the photo for office people): yes. The check starts a no-app trip (On the way) only on the trip's day and from 2 h
before its planned start; earlier it only records the check. "Trip finished?" at the back-by time, else at `duty_cutoff`
(21:00): yes. Pre-trip problems notify the people with the issues permission: ONE notification per check (never per
photo); breakdown and accident urgent, damage and the rest normal. Relaxing the start / end reading checks only for
"Completed · not confirmed" (a migration): OK. Self-driver fuel without the video: OK.

| Surface | Screen | Today | Round 4–7 |
|---|---|---|---|
| Driver app | Start work, Change vehicle (`app/vehicle.tsx`) | The vehicle is taken; back to Today | On to the vehicle check |
| Driver app | Start task (`startTask`, the task's vehicle) | Takes the task's vehicle | The check first when that vehicle has none today, then the start odometer |
| Driver app | Which vehicle? on the day (`VehicleConfirm`) | Confirms the vehicle | The check after it |
| Driver app | Today | — | "Vehicle check" card while the held vehicle has no check today |
| Driver app | Report form | 1–3 photos, five categories | The pre-trip report: 1–6 photos, + Damage |
| Office mode, /m/ | My trips | A no-app trip shows "Drives themselves"; it stays Sent forever | Its page: Vehicle check before you set off; Trip finished? Enter the odometer |
| Office mode, /m/ | A vehicle | Facts, documents | Today's check and the last 7 days |
| Office mode, /m/ | Issues, a task | — | The Pre-trip tag; the check line; Completed · not confirmed |
| Website | My trips, the vehicle page, Issues, the task page | As Office mode | The same, the site's own components |
| Claude | `list_vehicles`, tools | No checks | `check_today`; `vehicle_checks`; `my_trip`, `my_trip_check`, `finish_my_trip` |

- Data (`20261022120100_round4_vehicle_check`): `vehicle_checks` (id made where answered, vehicle, person, task, checked_at,
  result ok | problem, odometer_km, how clock_in | change | task_start | vehicle_confirm | trip, channel app | office, demo;
  RLS: a driver inserts and reads their own); `vehicle_reports.check_id` (a pre-trip report; the same person's check of the
  same vehicle) and the category `damage`; `photos.vehicle_check_id` + `side` (the optional four), kind `vehicle_check`; one
  notification per problem check (`vehicle.check_urgent` breakdown / accident, `vehicle.check_problem` the rest; the issue it
  opens is not pushed again). (`20261022120200_round4_trip_close`): `tasks.finish_ask_sent_at`; `finish_flag` kind
  `not_confirmed` (the only completed task allowed without its readings); the finish check (completed early) and the
  requester's "On the way" skip no-app trips; job `no-app-trips` every 15 min (`no_app_trips()`: the question once at the
  trip's end, `trip.finish_ask`; the close at 09:00 the day after; nothing while `trip_close_prompt` is off).
- Tools: `vehicle_checks(vehicle?, person?, date? | from+to, result?, paging)` (view; photo links for vehicles or issues);
  `list_vehicles` cards `check_today {result, result_text, at, by, report_id?}`; `my_trip(task_id)`, `my_trip_check(task_id,
  check_id?, result, odometer_km, category?, note?, photos?, sides?)`, `finish_my_trip(task_id, odometer_km,
  start_odometer_km?, fuel? {litres?, amount_lkr?}, photo?)` (personal: the trip's own person; photos uploaded by the page to
  the person's own folder); `my_trips` cards `trip_action` check | finish | confirm; task cards "Completed · not confirmed";
  `list_issues` rows `pre_trip`; the issue kind `trip_not_confirmed` (warning, Needs attention; resolves when confirmed).
- Driver app: one rule (the held vehicle has no check by this driver today → the check is needed; Start task waits for it);
  the screen `vehicle-check` ("No, all good" one tap; "Add 4 photos" after it; "Yes" → category, 1–6 photos, note, Send);
  queued offline like reports (the check, then the report, then the photos); today's checks kept on the phone and read back
  on a fresh sign-in.
- Office mode, /m/, the site: `/my-trips/:task` (the trip, its check, its finish); the vehicle page's Today's check + 7 days;
  the Pre-trip tag; the chip.

### 33.2 Feature 5: the fuel card at Start task (advisory, never blocks)

**Industry patterns:** Google Maps' fuel-efficient routing estimate, the fleet fuel plans of Samsara / Fleetio (km per
litre from the vehicle's own fills, a default by type until there are some), Uber's "trip info" card before a trip.

| Surface | Screen | Today | Round 4–7 |
|---|---|---|---|
| Driver app | Start task (`log-mileage?mode=start`) | Odometer only | "Trip info" card: "About 180 km · roughly 12–15 L petrol (approx.)", "Enough fuel?" Yes / I'll fill up on the way |
| Driver app | Running task | — | "Fill up on the way · Log fuel" line; a reminder 30 min after start that opens Log fuel |
| Driver app | Log fuel | No fuel type | The vehicle's fuel type (and grade) preselected, changeable |
| Site, Office mode, /m/ | Vehicle form and page | No fuel type | Fuel type (petrol / diesel / hybrid (petrol) / electric) required, grade optional; "Fuel type: not set" until filled |
| Site, Office mode, /m/ | Task page | — | The driver's answer and the estimate |
| Claude | vehicles, task_detail | — | `fuel_type`, `fuel_grade`, the task's `fuel` |

- Data (`20261022120300_round5_fuel_card`): `vehicles.fuel_type` petrol | diesel | hybrid | electric (null = not set),
  `fuel_grade` petrol_92 | petrol_95 | auto_diesel | super_diesel (petrol and hybrid take a petrol grade, diesel a diesel
  one, electric none); drivers read both (column grant; the app's `VEHICLE_COLUMNS`); `fuel_logs.fuel_type` / `fuel_grade`;
  `tasks.fuel_answer` enough | fill_on_way + `fuel_answer_at`; `fuel_estimate(task)` (the driver's own task; km per litre
  from the vehicle's last 3 fills with an odometer, tank to tank, else the default by vehicle type and fuel type; the plan's
  km; a range of ±10 %; electric: km and "check the battery"); `answer_fuel_card(task, answer, at)` (the driver; queued).
- Tools: `register_vehicle` requires `fuel_type`; `update_vehicle` takes both; vehicle cards `fuel_type`, `fuel_grade`,
  `fuel_text`; `task_detail.fuel_card {answer, at, estimate}`; `list_fuel` rows the fuel type.

### 33.3 Feature 6: passengers on trips

**Industry patterns:** Google Calendar's guests (search people with their photo, chips, a typed address for someone
outside), Uber's "ride for someone else" (the rider is told and can follow the trip; a shared trip link for someone without
the app).

| Surface | Screen | Today | Round 4–7 |
|---|---|---|---|
| Site, Office mode, /m/ | Request, Assign a task, Book now, their edits | A passenger count | Passengers: search registered office people (photo, avatar chips) or type a name and an optional phone; the count stays |
| Site, Office mode, /m/ | My trips | Own requests and created tasks | + trips I ride in, view only: time, stops, driver name and phone, plate, the live timeline |
| Site, Office mode, /m/ | A task / request | — | The passengers; "Share trip" (wa.me) for each unregistered one with a phone |
| Driver app | Today, the task | "5 passengers · Contact: …" | The passengers' names, Call for those with a phone |
| Claude | trip tools | `passengers` / `pax` counts | `passenger_list` in, `passengers_list` out; `find_people` |

- Data (`20261022120400_round6_passengers`): `task_passengers` and `request_passengers` (person or a typed name + phone;
  removed, never deleted; copied from the request when it is approved or booked); the driver reads their own tasks'
  passengers; `notify_passengers(task, event, title, body)`; registered passengers get the trip's events: assigned,
  accepted, on the way, running late, arrived (each stop), changed, cancelled (events `passenger.trip` alert and
  `passenger.moving` soft; their own switches; nothing while `passengers` is off).
- Tools: `find_people(text)` (any office permission: active office people, name, label, photo; no phone or e-mail);
  `passenger_list [{person? | name, phone?}]` on create_task, create_request, book_vehicle, update_request, update_task,
  decide_request (copies the request's); `my_trips` answers `role: passenger` cards; `my_trip` answers the passenger's view;
  `my_trips` for every office permission (a passenger may have only view).

### 33.4 Feature 7: someone else has that driver or vehicle

**Industry patterns:** Google Calendar's room booking (who booked the room, their photo, the time; "Propose a new time" /
ask the organiser) and resource view (one row per room, the day's bookings as bars); Airbnb's "dates unavailable" with the
host to contact. Never blocks.

| Surface | Screen | Today | Round 4–7 |
|---|---|---|---|
| Site, Office mode, /m/ | Conflict cards (assign, request decide, Book now, edit, reassign) | The other task's requester or driver, text | WHO holds it: photo, name, label, the time range, Call and WhatsApp (office users), Ask for it |
| Site, Office mode, /m/ | Notification centre | Opens a link | An "Ask for it" arrives with Yes / No in one tap |
| Site, Office mode, /m/ | A day's timeline per driver and per vehicle | None | `/schedule`: one row per driver or vehicle, each booking a bar with its holder |
| Everyone involved | A task's driver or vehicle changes | The driver, the requester, the custodian (some paths) | The driver, the requester, the person who assigned it, the passengers, both custodians: told in plain words |
| Claude | availability, suggest_vehicles, task_detail | No holder | `holder` |

- Data (`20261022120500_round7_holders`): `holder_asks` (the held task, driver or vehicle, who asks, for what time, the
  answer yes | no, by whom, when); `office_inbox.actions` (Yes / No buttons calling a tool); `queue_notification` passes
  them; events `holder.asked` (the holder and the fleet admins, urgent) and `holder.answered` (the asker and the fleet
  admins).
- Tools: the holder (the requester of the other trip, else the person who assigned it) on every conflict (`assignCheck`) and
  on `book_vehicle`, `update_task`, `reassign_task` warnings as cards; `availability` busy drivers and `suggest_vehicles`
  busy vehicles carry `holder`; `task_detail.holder`; `ask_for_it(task_id, resource, note?)`,
  `answer_holder_ask(ask_id, answer)`, `holder_asks(status?)`; `day_timeline(date, kind drivers | vehicles)` (view);
  `tell_involved` on every change of driver or vehicle. With `holder_contact` off: the warning without the person or Ask.

### 33.6 Three small UI items (Sahan, 22 October 2026; no switch; every surface where they exist)

| Surface | Screen | Today | Round 4–7 |
|---|---|---|---|
| Site, /m/, Office mode | A driver's day / route page | The map, playback, the day's timeline list and the "Gaps" list | The timeline and the Gaps list removed; ONE summary card above the map (Samsara's driver day, Google Maps Timeline): km driven, driving time, stops, first–last point time, one line for GPS gaps ("No GPS for 2 h 10 min") when any; stops stay pins, a tap says "Stopped near <town> · 06:56–07:15 · 19 min". Claude's `driver_route` unchanged |
| Driver app | Fuel tab, Mileage tab | Every entry of the month in a list | Google Pay / Revolut / PickMe's history: the summary card, the Log buttons, ONE "Recent" card with the last 5 (an icon: fuel pump / odometer gauge; litres or km; the date in words; a video mark when uploaded), "See all" → a history screen grouped by month with Load more; on Mileage the chips All · Odometer · Fuel. Today's tasks on Mileage stay |
| Driver app, site | Fuel tab, the Fuel page, totals | A missing amount reads "LKR 0" | "–"; totals add only the known amounts and say "N fills without an amount" |

### 33.7 Item 8: lists cleaned up everywhere (Sahan, 22 October 2026; no switch)

**Industry patterns:** Gmail's rows (an icon for the kind, one specific title, one grey meta line; select and act in bulk),
Samsara alerts / Sentry / GitHub notifications (mixed kinds grouped with counts, the newest first, "Show all N", most urgent
group first; critical / warning / info), Fleetio's maintenance (service and documents per vehicle, progress bars and expiry
chips).

**The evidence:** the site's Issues shows 24 rows and each repeats its kind three times ("Missed task" / "Missed task · Test
Driver …" / "… System · Missed task"); Maintenance → Reminders repeats the missed tasks and odometer checks of Issues; most
items stay open forever (missed tasks from 10 October, odometer photos that could not be read), so the badge says 24 when a
few need action.

**The rules (every list of every surface):**
1. Rows: an icon for the kind; ONE specific title ("Test Driver missed 'Trip · Head office'", "CAP-2207: 3 documents
   missing"); ONE grey meta line (plate chip · driver · when in words). Never the kind or "System" repeated in the row.
2. Mixed kinds are grouped by kind with counts ("Missed tasks · 12"): each group its 3 newest, "Show all N" for the rest;
   collapsible; the most urgent group first.
3. Severity: every issue kind is critical, warning or info (§33.7 table below). Only critical and warning count in the Issues
   badge, Home's "Needs you now" and the Overview. Info kinds resolve themselves after 7 days ("closed automatically"),
   listed under Resolved, and are not opened again for the same thing.
4. Bulk: select rows or "Select all in this group" → Resolve / Dismiss with a reason (e.g. "test data"); never delete;
   audited (`update_issues`).
5. Tabs Open · Snoozed · Resolved; 25 at a time with Load more; an empty state with an icon.
6. Maintenance: only service and documents, one card per vehicle (service due by km and date with a progress bar; document
   expiries as chips ok / expiring / expired / missing). Missed tasks and odometer checks live in Issues only.
7. Every other long list found by the audit (the audit table at the checkpoint: page · rows today · repeated text ·
   grouping · paging · bulk actions · fix): the summary first, the recent N, See all, grouped where mixed, no repeated text.

### 33.8 Item 9: data retention (Sahan, 22 October 2026; Slack / Google Workspace / Samsara retention policies)

A nightly job (pg_cron, Colombo night) removes what is past its period, in batches (no long locks), and writes ONE activity
log row per run ("Removed 312 read notifications older than 30 days; …"). Each period is an admin setting under Settings →
Data retention (what is removed and when), in `get_settings` for the connector; "Run now" first shows only the counts, then
removes on a second press. Business records are NEVER removed automatically.

| What | Kept | Minimum |
|---|---|---|
| Notifications read / unread (the inbox) | 30 days / 90 days | — |
| Push and notification delivery records (`notifications`, `push_log`) | 14 days | — |
| Activity log: routine entries / changes | 30 days / 2 years | changes ≥ 6 months |
| Issues: info kinds | resolved after 7 days (item 8) | — |
| Issues resolved or dismissed (and their events) | 12 months | — |
| Raw location points | 6 months; a per-driver per-day summary (km, driving time, stops, first and last point) forever | ≥ 30 days |
| Heartbeats, map-load and routing counters | 90 days | — |
| Unsent trip drafts (on the device) | 30 days | — |
| App errors, fuel videos (already) | 90 days, 12 months (shown on the same page) | — |
| NEVER automatic | tasks, stops, requests, odometer and fuel logs, their photos, vehicle reports, documents, employees, vehicles, places, projects, duty sessions | — |

The driver's route, mileage and km for an older day come from the daily summaries. pgTAP for each rule, with "business
records untouched".

### 33.9 Item 10: per person or shared (Sahan, 22 October 2026; Uber, Google Maps, Uber for Business)

**The bug:** the place suggestions (request, assign, approve or edit, book; the driver's own trips) showed the WHOLE
company's place history to everyone (`recent_places` read every trip and request).

**The fix:**
1. An empty box answers two groups, about 5 rows: **Saved** (the company's places: the base place and offices first;
   shared, kept by people with vehicles or office_users) and **Recent** (ONLY the person's own: trips they asked for,
   assigned, booked, ride in, and for a driver drove, personal trips too; the last 90 days by how often and how lately:
   `my_recent_places`). Editing or approving SOMEONE ELSE's trip adds "<Name>'s recent" (`search_places for_person |
   for_request`, approve or assign_tasks only).
2. One person's destinations and a driver's personal trips never reach another's suggestions: tested on both channels (the
   connector suite: A's recent places are not returned to B) and in pgTAP.
3. Typing is unchanged (the saved places, the places, then the map search), with only the person's own recent places.

**The audit (22 October 2026):**

| Feature | Today | Should be | Fix |
|---|---|---|---|
| Place suggestions: Recent | SHARED: the whole company's history (`recent_places`) | per person | `my_recent_places`; Saved shared (done, 5ba624a) |
| A driver's own trips' places (driver-api) | hidden (they were everyone's) | per person | the driver's own Recent, personal trips too (done) |
| Trip drafts, site ("Resume draft") | per person (the e-mail in the key), kept forever | per person, 30 days | dropped after `retention.drafts_days` |
| Trip draft, Office mode and /m/ | ONE per device (`office.trip.draft`) | per person, 30 days | a key per person; dropped after 30 days |
| Recent searches | not kept on the device | — | — |
| Last-used driver / vehicle / project | not remembered (the forms start from /me and the regular vehicle) | per person | — |
| Filters and sort | the page address (site); in memory (Office mode) | per person | — |
| Remembered views (desktop / phone site) | per browser (`fleet.view`) | per device (a phone or a desk) | — (a device choice, not history) |
| The Overview's collapsed sections | per person (`office_prefs`) | per person | — |
| Site import presets | shared | shared (company set-up) | — |
| Home "Needs you now" and the counts | by permission | by permission | — |
| Notification inbox, settings, the pause | per person | per person | — |
| My trips | per person | per person (+ the trips one rides in) | — |
| Ask drivers: the questions list | SHARED: everyone's questions of 7 days | per person (an approver may show everyone's) | `ask_answers` lists the person's own; `all` for approve; an answer by its link as before |
| Map's last view | not kept | — | — |
| The driver app (Today, logs, reports, checks) | per driver (RLS) | per driver | — |

**The rule:** history, drafts, recents and preferences are PER PERSON; company data (vehicles, drivers, saved places,
projects, settings) is SHARED. The audit at the checkpoint (feature · today · should be · fix) covers at least: trip
drafts, recent searches, last-used driver / vehicle / project, filters and sort, remembered tabs and views, the import
presets, Home's "Needs you now" and counts (by permission), the notification inbox and settings, My trips, Ask drivers'
questions and answers, the map's last view.

### 33.10 A: the design is a reference only (Sahan, 22 October 2026, final)

The boss's design (`design/png`, `design/office/png`, `design/fame-fleet.pdf`) was itself made by an AI: it is a reference,
never a constraint. CLAUDE.md now says: follow today's best commercial apps (name the app per pattern); keep the brand
colours and the fonts. Whatever the round kept only because the design showed it is decided by the industry pattern instead,
and listed at the checkpoint (e.g. the driver's Today header, the IN PROGRESS wording, the task page's four buttons). The
design pass stays parked until Sahan brings approved mockups.

### 33.11 Item 11: the detail screens' text cleaned up (Uber / PickMe's trip summary; not a redesign)

The screens: trip Review (step 4), the task page, the request page (office and requester), Approve / decide, the driver's
task screen, the site's task and request pages; every surface where they exist. The look, colours, fonts and components
stay; only the text is restructured:
1. Facts, not sentences: the key numbers as icon + value in one row at the top (distance, drive time, back at, passengers,
   vehicle type); explanations ("planned from the arrive-by times", "Google traffic") behind a small ⓘ.
2. Each fact once per screen.
3. The route as a stepper: a thin line joining the stops, the time on the left, the stop's name on ONE line with its status
   chip ("on time", "late"), ONE meta line under it with small icons (stay, leave, arrive-by), each leg as one small line
   "🚗 99 km · 2 h 23 min".
4. Short labels: a pickup icon instead of "Pickup · passengers get in"; "Back at base" when the base is the office.
The parked pilot's RouteStepper (phase9-rd) is reused where it follows these rules; nothing else of the pilot. Before /
after screenshots (English and Sinhala at phone width, the site at desktop width) as a CI artifact.

### 33.12 C: the map follows the app's theme (Google Maps, Uber)

One theme value drives the page and the map: the website's dark theme → a dark map (Google's dark scheme, a dark free-map
style), light → light; the app and /m/ are light-only today, so their maps are light, and follow the theme when the app gets
a dark one. Checked on every map: Live, the task, Review, the driver's route, playback.

### 33.13 Item 12: build to the approved mockups (approved by Charuka, 22 October 2026)

`design/mockups/2026-10-22/` (png/ the targets at 390 px, html/ the exact colours, sizes, spacing and icons, README.md the
tokens and patterns). They REPLACE item 11 for their screens; item 11's rules stay for every other detail screen, in the
same style.

| Mockup | Built as |
|---|---|
| 1 office-home | Office mode Home and /m/ Home; the site's Overview takes the same structure at desktop width |
| 2 office-review | trip Review (step 4): Office mode, /m/, the site's assign / request / book review |
| 3 office-request-approve | the request page for approvers: Office mode, /m/, the site |
| 4 office-trip-on-the-way | the task / trip page while on the way: Office mode, /m/, the site; requesters and passengers the same without the office's actions |
| 5 driver-today | the driver app's Today |
| 6 driver-task-in-progress | the driver app's task in progress (with Round 2's slide control) |

- Shared components (app `components/patterns`, the site's `ui/`): the thin top bar, StatsRow with icons, StatusBanner,
  RouteStepper with planned and actual times, the list row, the sticky BottomActionBar, the floating New trip button, the
  driver's tiles, the slide control. At desktop width the site puts the map and the stepper on the left, people and actions
  on the right (Uber for Business, Linear's detail layout).
- The fuel card, passengers, the vehicle check and "who holds it" join these screens in the same style (the passengers'
  avatars on Review, the "Checked" vehicle tile on Today); a feature switched off hides its part.
- C (the map follows the app's theme) in the same batch. Sinhala fits at 390 px on every screen.
- The checkpoint: each screen built beside its mockup (English and Sinhala at phone width, the site at desktop width) as a CI
  artifact (Playwright's mockups project, the design pages of `apps/driver/src/design` for the driver's two screens, the
  e2e build only), and the differences with why.
- The connector suite's clock (Sahan, 22 October 2026): no new Docker images; the 21:15–01:40 start guard stays.
- **Restyle, never rebuild (Sahan, 22 October 2026; item 12 and every UI change of the round).**
  - The mockups set the look and the layout only. The existing screens and components are restyled and restructured, never
    rebuilt from the picture. The mockups' names, places and numbers are samples: all text comes from real data and the
    translation files.
  - Everything works as it does today:
    - the crash screen and error boundaries, the success snackbars, the primary button's own spinner, no double-saves,
      timeouts with "Try again", writes never retried by themselves, sign-out only on 401 / 403;
    - the planner (one calculation, advisory, suggestions in grey), the clock time picker, the duration sheet, Where's
      suggestions (Saved and my Recent);
    - the selection marks, dates in words, the i18n guard, Sinhala, Latin digits;
    - visibility by permission, locked accounts with their reasons, the last-admin rule;
    - live stop progress (the slide's arrive / leave / finish, Undo, "corrected", times confirmed later, the background
      prompt), the live timeline and the re-estimates;
    - the notification settings, the offline queue, the map fallbacks (Google → the free map → "Map not available"), the
      contrast rules.
    - Every feature or action that exists today but is not drawn in a mockup stays, placed in the mockup's style (⋯ More,
      a section, a sheet, the bottom bar).
  - A feature inventory comes first for every screen restyled: everything on it today on every surface (buttons, actions,
    menu items, fields, links, filters, tabs, badges, statuses, warnings, empty and error states, each role and permission
    variant), each mapped to its new place.
  - Nothing is removed without Sahan's OK: a candidate stays and is listed under "Proposed removals" with the reason.
  - Each screen gets a test that its key actions still exist.
  - Every existing test keeps passing. Only the selectors or text that legitimately changed are updated, and each is listed.
  - The checkpoint gives per screen:
    - the inventory table (screen · item · old place · new place);
    - "kept behaviour checked" (the tests that cover it);
    - each behaviour change, with the reason;
    - the proposed removals.

### 33.14 The checkpoint's decisions (Sahan, 22 October 2026, before the deploy)

1. Office mode Maintenance opens on "Service and documents" (the drivers' problem reports one tap away): kept.
2. The proposed removals are approved, with two conditions:
   - the Warning / Info chip on Office mode's issue rows goes only where each group shows its severity with an ICON (never
     colour alone);
   - Office mode's five-steps card goes only if sent, seen and accepted, with their times, are on the new timeline (else it
     stays).
3. The Pre-trip tag on an issue stays when the vehicle_check switch is off.
4. Before the deploy:
   - a. A height-only resize never reloads or remounts a page (phones change height when the address bar shows or hides,
     and phones still use the desktop site). An e2e resizes only the height on the task page and asserts no reload and no
     refetch.
   - b. Passengers are saved in the same transaction as their trip or request, on create and update:
     - the write-only column `passenger_list` on tasks and vehicle_requests, applied by triggers in the same statement
       (20261022130000_round6_passengers_tx.sql);
     - office_create_task and office_book_vehicle carry it;
     - every trip tool writes it with its own row (passengerColumn);
     - a name that cannot be saved undoes the trip (pgTAP).
   - c. "Location off" is critical only during a task in progress, which always has its driver on duty. The signal issue
     is opened only for running tasks (issues.ts). Off duty the phone sends no heartbeats, so the status is "Not sharing",
     never "Location off".

**Follow-ups (after this round):**
- The server's English on Sinhala screens (a vehicle type such as "van", issue titles, "Nuwan declined…"): with the Sinhala
  import.
- A search on Maintenance's "All vehicles" and on the Timeline.

### 33.5 Also in the round
- `docs/voice-calls-plan.md` (doc only): WebRTC through a service (LiveKit, Agora, Twilio Voice) with their current prices
  and free tiers (cited), the native modules (react-native-webrtc, CallKeep / ConnectionService, FCM high priority to
  ring), battery and 4G caveats, the effort, the recommendation (after the pilot and the store release).
- The connector suite on a fixed date and clock: `FLEET_NOW` (functions env, local and CI only) read where the tools run
  (`run.ts`), the suite's own clock from it, the "today" checks against it.
- The location-search e2e (office.spec.ts:1326) kept under office-api's 120 calls a minute: it moves between its pages
  inside the site (client navigation) instead of eleven full page loads, so it no longer meets the limit.

## 32. Design pass parked (Sahan, 22 October 2026)

Design pass parked 22 Oct; pilot on phase9-rd, not shipped.

- `phase9-rd` stays as it is (not deleted, not merged): the inventory (`docs/design-pass-inventory.md`), the rules and patterns
  (`docs/design-pass.md`), the six pilot screens and the screenshot spec. No design change goes to main or to any deploy.
- What Part B made that is not design goes on `phase9-r3b` (from main): the trip rules as one source (`scripts/shared-logic.mjs`
  and its check), M5 (the server's relative words in the person's language), two fixes of those two found during the pilot
  (an old edit draft's who-drives read the new way; the request lines on Home and Approve say their day in words) and the
  site's Live card asking `live_drivers` at once when a driver stops sharing (the duty chip's "by the office").
- Next, each round with its checkpoint: Round 4 (the vehicle check, with self-drive and someone-else trips, §31) → Round 5
  (the fuel card at Start task, advisory) → Round 6 (passengers on trips) → Round 7 (someone else has that driver or
  vehicle) → `docs/voice-calls-plan.md` (doc only) → the connector suite on a fixed date and clock. (Changed the same day:
  Rounds 4 to 7 are one round, §33.)

**Deployed (22 October 2026, Sahan's go after CI run 39713363250 on `phase9-r3b` passed):**
1. Server: nothing. No Edge Function bundles the changed code (nothing under `supabase/` changed), so no functions deploy
   and no migration.
2. Main fast-forwarded to `e6057b2` (in `~/projects/fame-ops-main`), key scan 0, pushed. Main's CI 39716033919 passed
   with one flaky test: `office.spec.ts:1326`, the location search box. It had no CPU cut-off in its window. The page
   itself was refused: office-api answered 429 (120 calls a minute per person) after the test's 139 calls in 22 s (eleven
   full page loads). The test is fixed in Round 4–7.
3. Website: `scripts/deploy-pages.sh --deploy`, scan: nothing found, https://c31dda83.fame-fleet.pages.dev. `/`, `/m/`,
   `/m/offline`, `/privacy` and the /m/ files answer 200.
4. Native check against ef69255: only test scripts changed in `package.json` since Round 3's update (the rest are the same
   web and test packages and the FLEET_WEB-only config). EAS update "Shared trip rules, Sinhala times, duty chip fix":
   group **e827a8e9-9752-4ab8-bc61-c829a5e4bd4e**, Android 01a161d5-7fc2-7f79-bc95-a5eec108c833, runtime 1.3.0-gmaps,
   commit e6057b2.

## 31. Queued after Round 3 (Sahan, 22 October 2026, after Checkpoint 3)

The order: **Part B** (Round D, the design pass) → **Round 4** (the vehicle check) → Round 5 (the fuel card) → Round 6
(passengers) → Round 7 (someone else has that driver or vehicle) → `docs/voice-calls-plan.md`.

**Part B (Round D) starts with** two items from Checkpoint 3's review, before the inventory:
- The app's and the site's `requestLogic` / `assignLogic` (`apps/driver/src/office/trip/` and `apps/office/src/screens/`)
  become ONE shared source, or a test fails when they differ (they have drifted; nothing checks them today).
- M5: "2 h ago" and the other relative times still in English on Sinhala screens.
Then: the inventory of every screen; the patterns in `docs/design-pass.md` (Dashboard, List row, Desktop table, Detail page,
RouteStepper, StatusBanner, StatsRow, Forms, Profile / settings, Empty / loading / error states, the rules); a pilot of 6
screens (trip Review, request / task detail, Office Home, the driver's Task in progress, the site's Overview, the site's Tasks
list) with before / after screenshots as a CI artifact; STOP for Sahan's approval; the rollout only after his OK.

**Round 4 (the vehicle check) also covers self-drive and someone-else trips** (Zipcar's and Turo's return pattern):
- The self-driver does the same vehicle check before setting off, from Office mode, /m/ or the site.
- At the back-by time, or at the end of the trip's day when there is none, they get "Trip finished? Enter the odometer"
  (fuel and a photo optional). The answer completes the trip, updates the vehicle's odometer and km, and counts toward the
  monthly allowance.
- No answer by 09:00 the next day: the trip closes as "Completed · not confirmed" and the office sees it in Needs attention.
- (Until then a no-app trip is never started or finished: it stays Assigned after its day and is never marked missed, as the
  custodian's trips were. A someone-else trip is answered by the person it is booked on.)

**Follow-up:** the connector suite runs on a fixed date and clock, so it never fails around midnight (Round 3's run had to wait
until after 03:00: "today" checks crossed midnight).

## 30. Round 3 plan: who drives, driver first (21 October 2026, branch `phase9-r3`; the contract for the server and both clients)

From the Phase 9 brief (Round 3) plus Sahan's additions: the Activity log's routine actions, and the three server items
held for the next server go (office photos, the missed task's wording, English sentences on Sinhala screens).

**1. Who drives?** (the rental and car-sharing booking forms' "Who's driving?", e.g. Turo, Enterprise: one question, three
choices, the details under the chosen one.)
- Choices: **A driver** (pick one; the default), **I'll drive myself** (the person asking drives), **Someone else** (a name and
  a phone; not in Fame Fleet). The last two only while `self_drive_allowed` is on; off = every trip needs a driver.
- Server (migration `20261022100000_round3_who_drives`): `tasks.driven_by` driver | self | other, `tasks.driver_name`,
  `tasks.driver_phone`; `vehicle_requests.driven_by` driver | self | other | custodian (custodian = the old path, the
  vehicle's custodian drives, kept for the Teams artifact's `driver_required: false`), `driver_name`, `driver_phone`;
  `driver_required` stays and always equals `driven_by = 'driver'`. Existing custodian tasks become `self`.
- Whose account the task is on: a driver's (driver), the self-driver's (self), the person who asked or booked it (other:
  never shown as the driver; the shared key cannot book "someone else" or "myself": no person). A self or other trip needs
  a specific vehicle (no app to confirm one on the day); no accept, push or reminders (as today for the custodian).
- Tools take `driven_by`, `driver_name`, `driver_phone`: create_request, update_request, book_vehicle, create_task
  (and its proposal when it waits for approval). decide_request / redecide_request follow the request; naming a driver
  there makes the task `driver`. reassign_task always makes it `driver`.
- Answers: `driven_by` (self | other; absent for a driver) on task_board cards, task_detail.task, list_requests cards (the
  request's and `assigned`), my_trips; for other `driver` = the name and `driver_phone` = the phone, no photo. The status
  line: "Drives themselves · no app" / "Someone else drives · no app" (the app translates both).
- Screens: one "Who drives?" choice row (three choices) on every request / assign / book form (site, /m/, Office mode);
  the task shows the driver, the self-driver or someone else in the same driver card, with a small word instead of the
  duty state ("Drives themselves", "Someone else").

**2. Driver-first cards** (Uber Fleet's and Samsara's driver list: the person first, the vehicle under them).
- One card per codebase: the photo (initials until there is one), the name, on duty / off duty (or the task state), and
  the vehicle as a chip under it: the plate ("WP CAB-4521"; "regular" when it is their regular one, not held today),
  "Vehicle: on the day" (when `vehicle_on_the_day` is on and none is known), or "No vehicle yet".
- Used wherever a driver is picked or listed for a trip: Who's available / Who can take it, the best match, Give it a
  driver, Approve, the Drivers board, Live's list, a task's header and the task board rows; name-only pickers become the
  card list. Server: `photo_url` and `vehicle` on suggest_vehicles' `drivers_free` and the needs-driver best match;
  `regular_vehicle` on list_drivers.
- A future day never needs a vehicle typed: the regular one is suggested, else "on the day" when the setting is on (the
  setting stays off until Sahan turns it on: see 4).

**3. The Activity log's routine actions** (Google Workspace / GitHub audit log): hidden by default; a "Show routine
actions" switch shows them; changes, refusals and failures always show. Routine: watch_drivers, reviewing, set_my_prefs,
register_map_load, mark_inbox_read, register_web_push, remove_web_push, google_place, photo_upload_url,
vehicle_document_upload_url. `activity_log(include_routine?)`; each entry carries `routine: true` when it is one. The driver
app's own trip calls (start_trip, add_trip_stop, cancel_trip, its profile) join the log.

**4. vehicle_on_the_day** (off today; Sahan turns it on himself):
- What it changes. The tools: create_task, decide_request, book_vehicle, update_task, reassign_task and redecide_request take
  "on the day" or "any van / car / double cab / lorry" as the vehicle; a task for a later day with no plate given is saved
  as "the driver's vehicle on the day" (no vehicle yet) instead of being refused with "Pick a vehicle: X holds none today
  and has no regular one" (today's task still takes the vehicle the driver holds). The forms offer "Vehicle: on the day"
  and the driver card shows it. The phone: before Start task on such a task the driver app asks "Which vehicle?" (Log
  mileage, `VehicleConfirm`; queued offline as `task_vehicle`); the database refuses a start with no vehicle.
- What it does not change: a self-driven or someone-else trip always names its plate (Round 3); nothing for tasks that
  already have a vehicle.
- When it is safe: when every active driver's phone runs Hotfix 2's update or later (1.3.0, or 1.2.0 with update group
  1b8e60ce): an older phone (1.1.0) cannot answer "Which vehicle?", so its Start would be refused. On 21 October: Test
  Driver on 1.3.0; Test Driver 2's phone last reported 1.1.0 (16 October); Kanishka has not signed in yet. Safe once
  Test Driver 2's phone has 1.3.0 (or that test account is switched off) and every real driver signs in on 1.3.0.

**5. The held server items.** (a) Office people's photos: `photo_url` on /me, list_office_users, the requester on
request cards, the assignee on issues and who assigned a task; the site's My profile gets Change photo. (b) A missed task
says "Missed · not started" (never "Cancelled:"). (c) The English sentences most seen on Sinhala screens get a code beside
the words, translated by key on the app (the English stays as the fallback): the assign and plan warnings, the vehicle note
and the best match's reason, "Not available" / "Running late", the missed line; the app's "Last seen Last seen" doubling
fixed.

**Part A (Sahan, 21 October 2026, evening), into Round 3**, all four surfaces:
- A1. A driver's day timeline (and its Gaps list): no coloured bars beside the rows; one small icon per row (Google Maps
  Timeline): a car = driving, a pin = stopped, a warning = app not running / no GPS.
- A2. No language switch on any office screen's header (Live, Approve, Drivers, More, any other); only My profile has
  it (Office mode and /m/). The driver app's Today keeps its සිංහල switch (the boss's design).
- A3. Every map light: Google's map never follows the phone's dark mode; the light colour scheme on every Google and free
  map (the app, /m/, the site's light theme).
- A4. Dates in words everywhere: never "2026-10-20 20:47" on a screen; "Today 20:47", "Yesterday 20:47", "Mon 19 Oct 20:47"
  (a year only when it is not this year). One formatter per codebase, applied to every date the server sends.
- A5. Self-drive for anyone with the request permission (Zipcar for Business / Enterprise CarShare): office people add
  their driving licence (number, expiry, front and back photos) on My profile: `update_my_profile(licence_no?,
  licence_expiry?)`, the photos through `set_my_licence_photo` (the driver's own path), GET /me answers `licence {number,
  expiry, state on_file | none | expired, front_url, back_url}`. Request cards with `driven_by` self carry
  `self_drive_licence` on_file | none | expired: the approver sees "Self-drive · licence on file ✓" / "no licence on file"
  / "licence expired" (a warning, never a block); approving, booking or assigning a self-driven trip with no licence
  adds the warning "X has no driving licence on file (self-drive)." Server: in this round's go.
- A6. Expired requests (migration `20261022110000_round3_expired_requests`): a request still waiting when its trip day is
  over becomes `expired` (every 15 minutes; `expired_at`, the card's `expired` and `timeline.expired`, live state
  "Expired · nobody decided it in time"); out of the waiting lists and counts; the person who asked is told once (their
  request.decided notice); list_requests and my_trips take status `expired`. Its page has "Request again": a new request
  with everything copied but the day. Requests already past when it is deployed expire quietly.

**Deployed** (22 October 2026, Sahan's four gos after Checkpoint 3; CI 39661858641 on the branch, the connector suite on
both channels (593 + 656 calls, the shape contract with Round 3's 14 additive fields, the smoke test), pgTAP 33 files /
1159, Deno 228):
- Server: `db push` applied only `20261022100000_round3_who_drives` and `20261022110000_round3_expired_requests`;
  `office-api`, `office-mcp`, `driver-api` deployed. Checked live: `list_requests` status expired answers the 5 requests
  that were waiting past their day (19, 20 and three of 21 October; expired quietly at 04:36, the event "Nobody decided it
  before its day was over"), each with `fields.driven_by` driver.
- main fast-forwarded to `4a896a4` and pushed (the push scan 0); main's CI 39691359846 passed (fast; e2e 40 passed, none
  flaky).
- The website: deployment d18dc16e (the scan clean); `/`, `/m/`, `/m/offline`, `/privacy`, the /m/ worker, manifest and
  fonts answer 200 with their own types.
- The EAS update to preview, runtime 1.3.0-gmaps: group `dcc4b2dc-8557-47eb-995b-4625ca99b5dd`, Android
  `01a160d5-9606-7ee9-8f81-8eccf5a93b00`, from `4a896a4` (no native package changed since `ef69255`: only the web-only
  packages and the test tools; `app.config.ts` only under `FLEET_WEB=1`; since `25971b3` two test scripts).

## 29. Round 2b as built (21 October 2026, branch `phase9-r2b`)

Home, dark mode and contrast, no duplicate navigation, the Coordinator (`office_users`; `docs/coordinator-guide.md`),
Today's attendance (`drivers_board.attendance`), the Activity log (`activity_log`, admins only), and three changes after
Checkpoint 2b (Sahan):

- **The help-desk rule** (Google Workspace's help-desk admin): someone who is not an admin creates, edits, links and
  switches off only accounts holding none of Office accounts, Users and Approve, and never gives those
  (`accountGuards.ts` rule 4, both channels). Another Coordinator, a Fleet admin or an admin opens locked with the reason
  ("Only an admin can change this account: it holds …"); the permission pickers offer only what may be given
  (`givablePermissions`; the app's copy in `office/peopleLogic.ts`).
- **The last active admin** (GitHub's last owner, Google's last super admin): never switched off, never loses Users,
  never another role label, whoever asks, the shared key included (rule 5: `countActiveAdmins` in `tools/accounts.ts`).
  Nobody changes their own permissions still holds.
- **A stop driven past, confirmed later** (migration `20261021400000_round2b_confirmed_visits`): "Yes, I was there" is one
  queued write (`confirmed_later_at`); the server takes Arrived / Left from the driver's location points within 150 m of
  the pin (the first and the last, between the stop before it and the confirmation; `confirmed_visit_times`), at once and
  every 5 minutes for 2 days (`fill_confirmed_visits`, cron `confirmed-visits`). With none: visited, "time not recorded",
  no late / early, never the re-estimate's anchor (`stopProgress.ts`: `confirmed_later`, `time_not_recorded`). No
  "arrived" notice for it. Undo clears it. Shown as "Confirmed later" on the site, /m/, Office mode and the driver app.

Deployed (21 October 2026, Sahan's go after Checkpoint 2b; CI 39614878831 on the branch, the connector suite on both
channels, pgTAP 1131, Deno 220):

- Server: `db push` applied `20261021300000_round2b_coordinator` and `20261021400000_round2b_confirmed_visits`;
  `office-api`, `office-mcp`, `driver-api` deployed. Checked live: `list_office_users`, `task_detail` (stop progress);
  Sahan checked `drivers_board` attendance and `activity_log` from Claude chat.
- main fast-forwarded to `25971b3` and pushed (the push scan 0); main's CI 39619998196 passed (it carries the Users-search
  fix that failed 39584038398).
- The website: deployment 4f15cbd7 (the scan clean; two uploads before it dropped at 58/80 files on a weak network and
  published nothing); `/`, `/m/`, `/m/offline`, `/privacy` and the /m/ fonts answer 200.
- The EAS update to preview, runtime 1.3.0-gmaps: group `1f77a602-fbec-4892-b46c-eac9b79f4ba0`, Android
  `01a15f28-bf53-7877-afc9-f2e7c34a8926`, from `25971b3` (no native package changed since `1547884`; since `ef69255`
  only the web build's switch and web / test packages).

## 28. Round 2 deployed (21 October 2026, branch `phase9-r2`, Sahan's go after Checkpoint 2)

Live stop progress: the driver slides Arrived / Left / finish (Undo 6 s), the "Arrived at <stop>?" card on the task
screen, each stop's Planned · Arrived · Left with minutes late or early everywhere (site, Office mode, /m/, the driver
app, `task_detail.stops[].progress`), the stops to come re-estimated from the planner's own leg times
(`_shared/fleet/stopProgress.ts`), Realtime on the task pages, `request.stop_arrived` once per stop after the first pickup.

- Server: `db push` applied only `20261021200000_round2_stop_progress`; `office-api`, `office-mcp`, `driver-api` deployed.
  Checked live: `task_detail` answers `stops[].progress` (planned times, the current stop).
- main fast-forwarded to `1547884` and pushed (the push scan 0); CI run on main: 39584038398.
- The website: deployment 68cb37cc, the scan clean; `/`, `/m/`, `/m/offline` and the fonts answer 200.
- The EAS update to preview, runtime 1.3.0-gmaps: group `090a0836-34ad-45bd-b452-9c98329b81b9`, Android
  `01a15e00-f21c-75d8-a993-3efa0ee4a87f`, from `1547884` (no native package changed since `ef69255`).
- Decisions (Sahan): the arrival flag stays after Undo (shown "corrected", never erased); a stop driven past without
  Arrived is asked about at the next stop; the "Arrived at <stop>?" prompt also in the background (a local notification
  from the background location task, JS only); the artifact's 60 s refresh stays. These four are Round 2b work.

## 27. Round 1 deployed (21 October 2026, branch `phase9-r1`, Sahan's four gos after CI run 39562826733 passed)

The boss's review, Round 1 (Checkpoint 1): the Home tiles, Gmail rows, the When step (Arrive by + Stay), the planner as
advice (the suggestion never written into the form; `planner_suggestions`), the clock only (no quick-time chips), Where
suggestions, driver photos for the office and an office person's own photo in Office mode and /m/, contacts for drivers
(`employees.driver_contact`), nothing internal on any screen.

- Server: the connector suite on both channels and the MCP protocol test passed on `phase9-r1` (1255 checks, the shape
  contract with `get_settings.planner_suggestions` and, new, `list_office_users.users[].driver_contact`); pgTAP 28 files /
  1086 tests. `db push` applied only `20261021100000_round1_driver_contacts`; `office-api`, `office-mcp` and `driver-api`
  deployed. Checked live: `list_office_users` answers `driver_contact` (false for all five: no account named Palitha, so
  nobody was switched on), `get_settings` answers `planner_suggestions: true`.
- main fast-forwarded to `615482c` and pushed (the push scan 0); CI run on main: 39569558938.
- The website: `scripts/deploy-pages.sh --deploy` from `615482c`, the scan clean (deployment 2b7d1ab8); `/`, `/m/`,
  `/m/offline`, `/privacy` and the fonts (desktop woff2, /m/ ttf) answer 200 with their own types.
- The EAS update to preview, runtime 1.3.0-gmaps: group `04a9a76d-503e-4cac-ac7e-40b7abd9d1bc`, Android
  `01a15d96-2f37-7a0c-9807-94166e8c3aa2`, from `615482c` (no native package changed since the 1.3.0 build `ef69255`: only
  the web-only `react-native-web`, `@expo/metro-runtime` and `maplibre-gl` and the test tools; `app.config.ts` changes
  only under `FLEET_WEB=1`).
- For Round 2's server go: the office photo on the site and next to office people elsewhere (`photo_url` for office
  people, a site upload tool), a missed task's line ("Cancelled:" today), the server sentences still in English on
  Sinhala screens (match reasons, vehicle notes, not available).

## 26. The time sheet and the office's channels (21 October 2026, branch `o4-time-sounds`, CI run 39543429881 passed)

- TimeField (site and app): from 08:56 "Now" rounded to 09:00 and the 09:00 chip gave way to it; now "Now" is its own
  choice and every common time stays. Tests on fixed clocks; the site's unit suite can run at any time (`FLEET_TEST_CLOCK`).
- Office mode's channels `office-requests` (office_ask.ogg) and `office-issues` (new_task.wav), made only for an office
  person and registered with the token. notify-office's choice of them (`notify-office/expo.ts`) is on main but NOT deployed:
  its own go (`npx supabase functions deploy notify-office`). Until then office pushes go on task-ring / task-updates.
- 1.4.0: two office sounds drafted (`apps/driver/assets/sound-drafts/`, `docs/release-1.4.0.md` section 5).
- main fast-forwarded to `8071c15` and pushed; main's CI run 39546010586 passed (1 flaky: office.spec.ts:421; the branch
  run's flaky one was phone.spec.ts:179). The website deployed (6cbce83b, the scan clean, every /m/ file checked live). The
  EAS update to preview, runtime 1.3.0-gmaps: group `2929e79c-fc3a-472b-a864-04b7b348ce64`, Android
  `01a15ce5-2bb9-7675-8142-c98a837613cf`, from `8071c15` (no native change since the 1.3.0 build but jest-expo).

## 25. /m/ fixes deployed (21 October 2026, branch `o4-m-fixes`, CI run 39535454329 passed)

- Causes: Google's map on /m/ never stayed (withinLimit called the browser's setTimeout with the wrong `this`: "Illegal
  invocation", the tab took the free map silently); the fonts were never online (wrangler's upload leaves out
  `assets/node_modules/`, so the site's HTML answered every font); the map's warnings (missing sprite images, the web's
  missing native animation driver); the offline page redirected (1db4467).
- main fast-forwarded to `a650a20` and pushed; the website deployed (4b31833a; the scan clean; every /m/ font, sw.js, the
  manifest and /m/offline checked live: 200, their own type, no redirect); the phone redirect stays off.
- The EAS update to preview, runtime 1.3.0-gmaps: group `ed41a27b-a5bc-435f-a71d-a2d8a5d054e1`, Android
  `01a15c80-3b29-798e-940e-e8aba1e52d59`, from `a650a20` (no native package changed since the 1.3.0 build but the test tool
  jest-expo; none since the last update).
- main's CI run 39537830212 failed on one site unit test: `src/ui/TimeField.test.tsx` "is never typed: a tap opens the
  sheet; 09:00 counts…" (no 09:00 button at 08:48 Colombo); the same test passed on the branch run 26 minutes earlier. Not
  investigated (Sahan's rule).

## 24. Parked follow-ups (Sahan, 21 October 2026; not now)

- Snapped routes in the app and /m/: don't store Google Roads results (policy restricts storage, and results can't be
  shown on non-Google maps). If wanted later: our own OSRM map matching on OpenStreetMap data, stored once per trip and
  shown on both maps.
- Later: a proper dark theme for the app and /m/ (Office mode and the driver's side: dark tokens in `theme.ts`, every
  screen checked dark as the site's are in `e2e/contrast.spec.ts`). Until then both stay light on purpose
  (`docs/release-1.4.0.md` §6: force dark refused in the 1.4.0 build; /m/ says `color-scheme: only light`).

## 23. Step 5 deployed (21 October 2026, Sahan's three gos after CI run 39480596443 passed)

- main fast-forwarded to `035efea` (step 5, the review fixes, the Notifications limits, Live without zoom buttons, the CI
  workflow) and pushed (the push scan 0); CI run on main: 39484688927.
- The website: `scripts/deploy-pages.sh --deploy` from `035efea`, the scan clean (deployment 7fc55645); the phone redirect
  stays off. Checked live: `/` the desktop site, `/m/` and `/m/office/approve` the mobile page, `/m/manifest.webmanifest`
  (Fame Fleet, scope `/m/`, 3 icons), `/m/sw.js`, the icons. Found after the deploy: Pages answers `/m/offline.html` with a
  308 to `/m/offline` (its pretty addresses), and Chrome refuses a redirected answer for a page, so the worker's "No
  connection" page cannot show on the live site; fixed on branch `o4-offline-fix` (the worker asks `/m/offline`), not
  deployed: waiting for its go.
- The EAS update to preview, runtime 1.3.0-gmaps: group `f0754f7e-bf67-473b-835d-b88be6011b5a`, Android
  `01a15ad6-190c-75df-9573-a0ddde875ee5`, from `035efea` (no native package changed since the 1.3.0 build `ef69255` but
  the test tool jest-expo; none added or changed by step 5).

## 22. Queued next (Sahan, 20 October 2026; not built)

- **Live as a full-screen map with a draggable bottom sheet** (Google Maps, Uber, PickMe, and the boss's design 15): the map
  edge to edge with the duty chips floating on it; the list in a sheet that drags between peek, half and full; list and map
  in sync; the same in the app and on `/m/`.
- Decided 20 October with it: no zoom buttons on Live (pinch and the wheel zoom); fit stays; the compass only while the map
  is turned, a tap turns north. Live has no my-location or layers button today (none was added).

## 16. The principle (Sahan, 20 October 2026): everything the site does, laid out as a phone app

The office will do from the phone everything they do on the website, because they don't always have a laptop. So every
function, field, check, warning and view the site has must be in the app, by permission, with nothing silently left
out. But it must never become the site squeezed onto a phone. It is laid out the way good phone apps are, and it must
stay simple and organised as it grows. The rules, which govern every Office-mode round from now on:

- **One job per screen.** Long jobs are steps with one sticky primary button; the button is disabled until the step is
  valid, with the reason under it.
- **Required things on the screen; optional things under a "More details" fold** on the same screen, never a separate
  page. Sensible defaults and pre-fills (from /me, the last choice, the regular vehicle), so the common case takes a few
  taps.
- **The same patterns everywhere:** one card style, one list style, one bottom sheet, one date row for history, one
  playback bar, one filter-chip row, one search field at the top of every long list, one place for the primary button.
  Nothing is invented twice.
- **Every screen is at most two taps from a tab.** The tabs carry the daily work; everything else is under More, grouped
  by permission, with a search at the top of More.
- **Every tappable thing opens its own place:** cards, chips, rows, counts, badges, notifications and pushes open the
  screen scrolled to the item; a count opens the filtered list; back returns to where the person was.
- **The map stays plain:** a map with a draggable sheet, the list and the map in sync, at most three controls on the
  map, clustering when markers overlap, the industry patterns (PickMe, Uber, Samsara, Google Maps), not new ideas.
- **Text is short, in the site's words; English and Sinhala.**
- **A fresh reviewer checks every screen against these rules at each checkpoint**, and flags any screen that looks like
  the desktop site compacted.

## 13. Risks

- **Scope.** 138 site functions, about 45 screens. Mitigation:
  - the parity table at every checkpoint;
  - the laptop-only list agreed now;
  - Parts that each finish a person's whole day.
- **Two interfaces in one app:** a bug in the session switch could show a driver the office or the other way round.
  Mitigation:
  - the switch reads the server's `me`;
  - the office screens live in their own route group;
  - a test signs in as each kind.
- **Permissions leaking into the UI:** a hidden button is not a guard.
  - The server refuses as now.
  - The tap test runs per permission set.
  - A screen that needs a permission is not even routed without it.
- **Drift from the site:** two front ends of the same rules. Mitigation: `packages/shared` holds the pure rules, and the
  site's own phone layout is retired once parity is reached.
- **react-native-web and the maps:** the web build needs Google's JS map or the open package behind the same component.
  Proven in 8.0 with the prototype's Live and Review.
- **Two map engines on every map screen:** Live's trails and playback, the planner's route line and the pin map must work on
  Google's map and on the free map, and fall back by themselves. Mitigation:
  - one map component for the driver app and Office mode, with the engine rules in one pure module (`lib/mapEngine.ts`);
  - `npm run test:maps` grows with every Office-mode map screen, and each round's phone tests run on both engines;
  - the reviewer checks map changes against both.
- **Google's web map in the mobile website counts against the map-load cap** (430 a day): a dispatcher using the phone site
  all day uses loads the native app would not. Mitigation: the native app is the main phone tool (its Google map is free);
  the phone site's map loads are counted like the desktop's, and the usage card shows them.
- **Office push beside driver push:** one token table with two kinds of people. Mitigation: the role check in every push
  path, and pgTAP for each.
- **iOS:** Apple's review of an app that also holds a driver interface with background location. Mitigation:
  - Office mode alone on iOS until a driver iOS build is decided;
  - Unlisted distribution;
  - the reviewers' demo account (Part 6) extended with an office demo account (view only).
- **The size of the app:** Office mode is JavaScript and images. The 1.3.0 base stays; the bundle grows by an estimated
  1–2 MB.
- **The tap test's brittleness:** it reads the router's screen list and taps by role, never by position; a screen that
  needs data gets the local stack's test data.
