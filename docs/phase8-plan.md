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

### What moved to O2 or later
- O2 (the trip editor, 06–09): New request, Assign a task, Change the trip / time / stops, Edit a request, Book now, the
  Home's big action buttons, the chips' panels.
- Later Parts: the Drivers board and its tab (12), Ask drivers (13), Live's trails, playback and controls, the issues
  screen, vehicles, the management under More (8.5), 2-step sign-in in the app, the office push on the phone (item 9:
  server work behind Sahan's go, listed apart in the checkpoint).

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
