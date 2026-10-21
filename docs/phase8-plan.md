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
