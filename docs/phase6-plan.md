# Phase 6: office UX on phone and desktop, approvals with availability, edits and redo, fuel videos, site lists, Google package (plan)

Written 14 October 2026 after reading CLAUDE.md, `docs/dispatch-plan.md`,
`docs/route-quality-plan.md`, `apps/office/src`, `apps/driver/src`, the two site files in
`data/sites/` and the live project's settings. Nothing in this document is built. The rules of
Phase 5 apply: one branch per part, a checkpoint before any migration push, deploy, secret,
eas update, web redeploy or build; a change made after a go is shown before it is deployed;
additive schema and tool shapes; audit through `run.ts`; driver strings in en + si with the
Sinhala listed at the end.

`data/` is now in `.gitignore` (this branch); `data/sites/dialog.xlsx` and `mobitel.xlsx`
stay on the laptop only.

## 0. Decisions I made while reading, for Sahan to confirm or change

1. **Why the leave-by did not appear in your test (checked on the live site).** Your test task
   `d5c7dc19` (Tue 13 Oct 17:33, "Trip · Head office, Colombo 05", from the request of
   14:33) has `plan_version 0`, no `leave_by` and no plan: it was created at 14:34 on 13 October
   by approving a request, and the planner reached the approval path only with Part 4
   (commit 041e23f, 23:05 that evening). Tasks made before that have no leave-by and show
   their start time only. Two smaller things in the same test: both stops are the head office
   (from = to, 0 km), and the live project has no base place set (`get_settings` still says
   "No base place set"). Part 2 backfills `leave_by = start_at` (source manual) for the old
   assigned tasks and re-plans a task whenever the decide or redecide page touches it; the
   Part 1 checkpoint re-verifies with a fresh request on the live site.
2. **Who is a "requester".** The tab sets you gave (requester: Home, My requests, Live,
   Vehicles, More) need `view` for Live and Vehicles, so "requester" below means
   `view + request` (the staff preset). A person with `request` alone gets Home (= My
   requests), More, and nothing else, as today.
3. **Detail pages on desktop.** Every detail keeps a URL on both layouts (`/requests/:id`,
   `/tasks/:id`, `/vehicles/:id`, …). On a desktop the list stays on the left and the detail
   renders in the right panel (today's drawer look); on a phone the detail is the whole screen
   with a back arrow. One route, one component, the layout decides. Forms are always pages.
4. **Mobitel naming rule, refined.** With the rule exactly as written, 3,084 of the 4,112
   pinned Mobitel places get neither a code nor a name, because the sheet glues digits to the
   names (`Galkulama2`, `Sigiriya4`, `KYKAD3Kadugannawa8L`). Section 8.2 keeps your rule and
   adds two steps (split a code glued to a name; strip a trailing digit group from a name
   token). That gives 650 places with code and name, 3,124 with a code only (named by the
   code), 333 with a name only and 5 with neither. Counts in section 8.4.
5. **Mobitel rounding.** At 4 decimals (about 11 m) the 4G sheet gives 4,112 places; at
   5 decimals 4,357. Your "about 4,400" matches 5 decimals, but 245 of those are rows of one
   site a few metres apart (sectors). I keep 4 decimals as you wrote; say so if you want 5.
6. **Google caching, read from the current Service Specific Terms (last modified
   10 June 2026).** Routes API 19.3 and Roads API 17.3 allow caching only latitude and
   longitude values, for up to 30 consecutive calendar days. Nothing allows caching a
   duration or a distance. So: Google route times and distances are never stored (the
   existing `route_legs` cache serves OpenRouteService only; the Google branch of
   `routing.ts` stops writing it); Google snapped lines (lat/lng) are cached per leg for
   30 days, not 90. Details and the quotes in section 9.4.
7. **Fuel videos are silent.** `app.json` builds expo-camera with `recordAudioAndroid:
   false`, so the installed dev build has no RECORD_AUDIO permission; a video with sound
   needs a new native build, which the Part 3 deploy round (eas update only) does not
   include. The checklist (pump display, odometer, plate) is visual, so I plan silent
   recording. Say so if you want sound and a build.
8. **No in-app playback.** Playing a video on the phone needs `expo-video` (a native module,
   not installed). The Fuel tab shows "Recorded · 0:47 · 16 MB" with Retake; the office plays
   it in the browser. Same reason: no new build in this phase.
9. **The TUS client is ours.** `tus-js-client` reads a whole file into memory on React
   Native and runs its own retry loop, which would fight the queue's backoff ladder. A small
   TUS client (create, head, patch 6 MB chunks read with `expo-file-system/legacy` at a
   position) lives behind the queue instead; about 150 lines, tested with a fake server.
10. **Map loads are counted on the server before the key is handed out.** The browser never
    holds the Google key in its bundle: `GET /me` answers the package and, under `google`,
    the browser key with today's count; `register_map_load` is called once per map
    initialisation and answers allowed or not. The artifact never asks (drawn map).
11. **Part 4 ships in the Part 5 round.** You listed three deploy rounds (after Parts 2, 3
    and 5); the sites migration and the import page go out with Part 5. If you want the
    import earlier, Part 4 can have its own server + web round.
12. **The old `ROUTING_PROVIDER` secret becomes a fallback.** The `map_package` setting
    decides the chain (google → ors → estimate under google; ors → estimate under open).

## 1. What changes, in one picture

| Area | Today | After Phase 6 |
|---|---|---|
| Office forms | drawers on every screen | full pages with URLs, drafts that survive leaving, phone layout with a role-aware tab bar |
| Stops | one editor dialog, labels change when a row is added | typed rows with their own arrive-by, numbered within the type, the plan on the page with the reason when it cannot plan |
| Approvals | approve or decline once | "Who's available" panel, edits by the requester, re-approval, change / postpone / decline at any time, every change in the timeline and pushed to the driver |
| Presence | on duty = location shared | "On duty since HH:MM" everywhere; a shift-start nudge on the phone |
| Fuel | litres, amount, receipt photo | a Fuel tab with a required video, resumable upload through the queue, a Fuel page in the office with the video |
| Places | 2 kinds of saved places, typed names | 3,791 Dialog and about 4,100 Mobitel sites with ids, trigram search in the stops editor, a pin page, an import page |
| Maps | OpenFreeMap tiles, ORS times, no snapping | a Google package (tiles, snapped lines, traffic times) with daily caps and automatic fallback to the open package, never mixed |

## 2. Order of work, branches, checkpoints, deploy rounds

| Part | Branch | Server | Web | Driver app | Checkpoint shows | Deploy round |
|---|---|---|---|---|---|---|
| 1 Pages, phone layout, drafts, stops editor | `phase6-1-pages` | — | yes | — | every form as a page on desktop and phone (screenshots at 412 px), the drafts test, the stops editor, the plan panel with its reasons; the leave-by cause re-verified live | none (goes with round 1) |
| 2 Availability, approvals, edits, presence | `phase6-2-approvals` | migration `phase6_requests`, tools, notify | yes | shift nudge, "Task changed" texts | the decide page with the panel, an edit → re-approval → redecide, a postponed task and its push, the shift notification on the OPPO | **Round 1: db push, office-mcp + office-api + fleet-jobs + notify-office, web** |
| 3 Fuel videos | `phase6-3-fuel` | migration `fuel_videos` (bucket, columns, prune), tools | Fuel page, task detail, Mileage | Fuel tab, recording, TUS upload | a 60-second recording uploaded through a signal loss, the office page playing it, the storage numbers | **Round 2: db push (bucket), functions, web, eas update** |
| 4 Site lists and search | `phase6-4-sites` | migration `places_sites`, tools | import page, search in the stops editor, place page | — | the presets run against the two files on the local stack with the report counts, the search from 2 characters, the pin page | with round 3 |
| 5 Google package | `phase6-5-google` | migration `google_package`, routing chain, caps | Google map provider, legend, Settings counts | — | the package switch, the caps hit by a test counter, the fallback, the setup doc | **Round 3: db push, functions, web, the Teams artifact file + message** |
| 6 Finish | `phase6-6-docs` | — | — | — | CLAUDE.md, docs, README, the test plan, the Sinhala list | — |

Each part: tests pass (section 10) → checkpoint → go → ff-merge. Rounds in the order db push
→ functions → web → (round 2) eas update, as in Phase 5. The site import on the live project
is yours to run through the page after round 3. Secrets by name only: `GOOGLE_MAPS_JS_KEY`,
`GOOGLE_ROUTES_KEY`, `GOOGLE_ROADS_KEY` (round 3, optional), nothing else.

Deployed so far (14 October 2026): round 1 at f9bc685 (Part 2); round 2 at 413d820 (Part 3);
**round 2b at 3cc39d8** (Part 3b, the ordered steps, and the five driver-app items): migrations
`fuel_video_segments`, `fuel_video_steps`, `heartbeat_video_columns_grant` pushed; office-mcp,
office-api and fleet-jobs deployed; web deployment 1f08955f on fame-fleet.pages.dev; EAS update
group 435a33d9 (Android update 01a13a6e, runtime 1.1.0, channel preview). **Round 2c at
a6610c0** (every route view at tolerance 0 with merging refetches, playback by point, watched
mode): migration `watched_drivers` pushed; office-mcp, office-api and fleet-jobs deployed; web
deployment 3bab9784. No eas update: the phones' watched-mode uploads and the heartbeat answer
wait for round 3. **Part 4 round at 9b98b87** (15 October, phone health and Part 4 together):
migrations `phone_health` and `places_sites` pushed; office-mcp, office-api and fleet-jobs
deployed; web deployment dcdcca05; EAS update group 58879074 (Android update 01a13d66, runtime
1.1.0, channel preview) with the watchdog, the Phone setup card and watched mode. Within minutes
the phones' kept heartbeat history arrived (test.driver 98 rows, test.driver2 124 from 14 October
18:13 on), and test.driver2's 06:12–06:28 holes read "App not running · 7 min" (the app frozen),
then "Stopped · no GPS signal" 3 and 5 min (the app alive, location silent: the watchdog's case).
The site import on the live project is yours through Settings → Import sites. The Teams artifact
copy is still the Part 2 build: its update is round 3.

## 3. Data model: four migrations, all additive

### 3.1 `phase6_requests` (Part 2)

- `vehicle_requests`: status check widened to `waiting | approved | changed | declined |
  cancelled`; new columns `changed_at`, `changed_by`, `change_note`, `previous jsonb` (the
  values before the last edit), `version integer default 0` (bumped on every edit and
  decision; `update_request` / `redecide_request` send the one they loaded, like
  `plan_version`).
- `request_events` (new): `id, request_id, at, action ('created'|'seen'|'edited'|'approved'|
  'declined'|'changed'|'redecided'|'postponed'|'cancelled'), actor, note, changes jsonb
  ({ field: { from, to } })`. Office roles read through RLS (`view` or `request` for own
  requests); written by the tools. The requester's timeline on the request page and the
  cards' `timeline` come from here (the existing columns stay and keep feeding the old
  fields).
- `task_assignment_events`: action check widened with `'changed'`; new column `changes
  jsonb`. The task history card shows "Changed by X: time 09:00 → 09:30, vehicle
  WP CAB-4521 → WP KL-1234".
- `tasks`: nothing new. Backfill: `update tasks set leave_by = start_at, leave_by_source =
  'manual' where leave_by is null and status in ('assigned', 'declined')` (the pre-Part-4
  tasks, decision 1).
- `fleet_settings` keys (no schema): `shift_start` "08:00", `shift_days` [1,2,3,4,5,6]
  (Mon–Sat, 0 = Sunday as in `rush_hour`).
- RPC `get_driver_settings()` (security definer, drivers): `{ shift_start, shift_days }`,
  the only fleet settings a driver may read.
- Notification events (`notifications.ts`): `request.changed` (approvers: "Request changed ·
  needs re-approval"), `request.redecided` (the requester: kept / changed / declined),
  `booking.changed` (the custodian and the requester when time, vehicle or driver change on
  an approved booking). Push kinds to the driver: the existing `changed` with the changed
  fields in the body ("Task changed: new time 09:30"), `removed` after a reassign (exists),
  `cancelled` (exists).
- pgTAP `phase6_requests.test.sql`: a requester edits only own waiting or approved requests;
  an edit of an approved one sets `changed` and bumps `version`; a stale version is refused;
  `request_events` readable by the requester for own rows only; a driver reads neither.

### 3.2 `fuel_videos` (Part 3)

- Bucket `fuel-videos`: private, `file_size_limit` 120 MB, `allowed_mime_types
  ['video/mp4']`; policies like `driver-photos` (a driver inserts and reads inside
  `<employee_id>/`; nothing else), the office reads through signed URLs made by the tools
  (service role), 1 hour.
- `fuel_logs`: `video_path text`, `video_status text check in ('none','recorded',
  'uploading','uploaded','failed','pruned') default 'none'`, `video_duration_s integer`,
  `video_bytes bigint`, `video_uploaded_at timestamptz`, `video_checklist jsonb` (which
  checklist items the driver ticked while recording). Drivers may insert and update the
  four video columns on their own rows (the log is inserted when the entry is saved; the
  upload finishes later).
- `prune_fuel_videos` is a `fleet-jobs` job (not SQL: deleting `storage.objects` rows leaves
  the files behind): once a month (pg_cron `fuel-videos-prune`, 1st, 21:45 UTC) it removes
  objects older than 12 months through the storage API in batches of 100 and sets
  `video_status = 'pruned'`, `video_path` kept for the record.
- pgTAP `fuel_videos.test.sql`: a driver updates `video_status` on own rows only; the office
  cannot write it; storage policies: own folder only (the existing pattern).

### 3.3 `places_sites` (Part 4)

- `create extension if not exists pg_trgm`.
- `places`: `operator text check in ('dialog','mobitel','other') default 'other'`,
  `site_id text`, `other_ids text[] default '{}'`, `region text`, `district text`, `depot
  text`, `source text` (the preset name or 'manual' / 'claude'), `imported_at timestamptz`,
  `updated_at`, and `pinned boolean generated always as (lat is not null) stored`. Places
  without coordinates are allowed (the existing `lat is null = lng is null` check stays).
- Indexes: `unique (operator, site_id) where site_id is not null`; `unique (operator,
  round(lat::numeric, 4), round(lng::numeric, 4)) where site_id is null and operator =
  'mobitel'` (the coordinate key); GIN trigram on `site_id`, `name`, and
  `array_to_string(other_ids, ' ')`; GIN on `other_ids` for exact id lookups; `(operator,
  district)`.
- RLS: drivers keep reading places (the app shows a stop's name); office `vehicles` writes
  through the tools only (service role).
- pgTAP `places_sites.test.sql`: the two unique keys refuse a duplicate; a place without a
  pin has `pinned = false`; a driver cannot write; the trigram index is used by the search
  function's query plan (`explain` contains "Bitmap Index Scan").

### 3.4 `google_package` (Part 5)

- `fleet_settings` keys (no schema): `map_package` (`google` | `open`; see 9.1 for the
  default), `google_map_loads_daily_cap` 300, `google_routes_daily_cap` 150,
  `google_roads_daily_cap` 150.
- `routing_calls` gains the provider names `google_map_loads`, `google` (exists),
  `google_roads` (exists since route quality); `bump_routing_calls` is reused. A new RPC
  `count_call(p_provider, p_cap)` (service role) increments and answers `{ count, allowed }`
  in one statement so two tabs cannot both pass at the cap.
- `route_matched`: `prune_route_matched` takes the provider into account: `google_roads`
  rows after 30 days (17.3), others 90.
- `route_legs`: the Google branch never writes it (19.3); a one-off `delete from route_legs
  where provider = 'google'` (there are none on the live project: no key was ever set).

## 4. Part 1: pages, phone layout, menu, drafts, stops editor

### 4.1 Routes

| URL | Who | Desktop | Phone |
|---|---|---|---|
| `/` | all | Overview, or My requests, or Settings | Home with the role's one big action |
| `/requests` | view+request, approve | list + right panel | list |
| `/requests/new` | request, approve | page | page, sticky Send |
| `/requests/:id` | own, approve | panel beside the list | full-screen, back arrow |
| `/requests/:id/edit` | own (waiting or approved), approve | page | page |
| `/requests/:id/decide` | approve | page: the panel "Who's available", approve / decline, or redecide | page |
| `/tasks` | assign_tasks | board + right panel | board as a list of cards |
| `/tasks/new` | assign_tasks | page (today's Assign card, with the stops editor and the plan on the page) | page |
| `/tasks/:id` | assign_tasks, approve (a request's task), own request | panel | full-screen |
| `/tasks/:id/edit` | assign_tasks | page: time, leave-by, driver, vehicle, title, passengers, contact, notes; Cancel with a reason | page |
| `/tasks/:id/stops` | assign_tasks | page: the stops editor + plan | page |
| `/live`, `/drivers/:username`, `/issues`, `/issues/:id`, `/mileage`, `/maintenance`, `/projects`, `/more` | as today | as today | detail pages full-screen |
| `/vehicles`, `/vehicles/new`, `/vehicles/:id`, `/vehicles/:id/edit` | view; vehicles for new/edit | list + panel; forms as pages | cards; pages |
| `/drivers`, `/drivers/new`, `/drivers/:username/edit` | view; vehicles | pages | pages |
| `/fuel`, `/fuel/:id` (Part 3) | vehicles | list + panel with the video | cards; full-screen video |
| `/places`, `/places/:id` (Part 4) | vehicles | list + pin page | pages |
| `/settings`, `/settings/users`, `/settings/users/new`, `/settings/users/:id/edit`, `/settings/fleet`, `/settings/notifications`, `/settings/import-sites` (Part 4) | as today; import = vehicles | pages | pages |

A direct URL to a page the person may not open shows "No access" (the `Guard` stays; the
server refuses the tools either way). `ui/Drawer.tsx` stays for the desktop detail panel
only; its dirty-state and discard rules move to the page forms (`useDraft` → the drafts of
4.3, `beforeunload` stays).

### 4.2 Phone layout (≤ 768 px)

- One breakpoint for the layout, `--phone: 768px` (today 900 px in two places; the tiles and
  tables keep their own narrower breakpoints).
- Bottom tab bar: at most five tabs, chosen from the person's permissions in this order
  until four are filled, then More: Home; Requests (approve) or My requests (request);
  Tasks (assign_tasks); Live (view); Vehicles (view); Issues (issues or assign_tasks);
  Drivers (view). So a requester gets Home, My requests, Live, Vehicles, More; a fleet admin
  Home, Requests, Tasks, Live, More; a dispatcher Home, Tasks, Live, Vehicles, More; a
  viewer Home, Live, Vehicles, Drivers, More. `nav.ts` gets a pure `tabsFor(me)` with Vitest
  for each preset.
- Targets 48 px high, cards instead of tables (every GenericTable gets a card renderer on
  the phone: label/value pairs), the primary button sticky above the tab bar (safe-area
  aware), native `date` and `time` inputs (already), pull to refresh (a `PullToRefresh`
  wrapper on list pages: touch-drag past 70 px → `store.invalidate()`), no hover-only
  actions (every row action is a visible button or the row itself opens the detail).
- Home on a phone: the person's one most-used action as a large button at the top:
  requester "New request"; approver "Requests to approve (N)"; dispatcher "Assign a task";
  fleet admin "Requests to approve (N)" when any wait, else "Assign a task"; viewer "Live
  locations". Under it the tiles the role already sees.
- Desktop keeps the side rail.

### 4.3 Menu and drafts

- Menu: `navState` loses the greyed lock in the rail and the More list: items the person
  cannot use are not rendered. More lists `NAV` minus the tabs actually shown. `nav.test.ts`
  proves no duplicate between the bar and More for every preset.
- Drafts (`src/data/drafts.ts`): `localStorage` key `fame-fleet:draft:<user id>:<form id>`
  plus `:<record id>` for an edit; value `{ at, state }`; saved on every change (300 ms after
  the last keystroke) and on `visibilitychange`; coming back to the form shows "Resume draft
  from HH:MM · Discard" (a banner above the form; Resume fills the state, Discard deletes);
  Save and Discard clear it; a successful Save also clears it. The user id comes from
  `me.email` (web) or "artifact" (the artifact has no user: drafts are per browser profile).
  A Playwright test types in `/requests/new`, navigates to `/live`, returns, resumes and sees
  the text; a second one discards.

### 4.4 Stops editor

- Rows: each stop row has its own type selector (Pickup / Drop-off / Visit), the place (the
  picker of Part 4; a saved place, a town or free text until then), what, minutes there,
  arrive-by on the row, a note. The start place is its own row above (default the base
  place; "Return to office" toggle below the list).
- Numbering within the type: Pickup 1, Drop-off 1, Drop-off 2, Visit 1 (`stopLabel` becomes
  a pure function of the list, Vitest: adding, removing, moving a row never changes
  another row's type; labels follow the type counts).
- "Stops in detail" (the dialog) goes: the rows are the editor, on `/tasks/new` and
  `/tasks/:id/stops`.
- The plan panel is on the page above Save and follows the rows (700 ms after the last
  change, `plan_task`). One line in words: "Leave by 07:10 · Kalutara 07:35 · Galle 08:40 ·
  Matara 09:45 · 2 h 35 driving · road time OpenRouteService" (the source label follows the
  package after Part 5: "Google" or "OpenRouteService" or "estimate"). When it cannot plan,
  the exact reason in the same place, from the plan's warnings and the input check:
  "Galle site has no pin — add one" (`no_coordinates` with the stop's name), "No base place
  set — pick it in Settings → Fleet" (`no_base`, only when Return to office or no start is
  given), "Arrive by 08:00 is before the leave time" (`not_reachable`, with the earliest
  arrival), "Add a date", "Add at least one stop with a place", "No routing key — times are
  estimates" (source estimate, shown as a note, not an error).

### 4.5 Part 1 as built (14 October 2026, branch `phase6-1-pages`)

- Pages and routes as in 4.1: `/requests/new`, `/requests/:id` (child route of the list),
  `/requests/:id/decide`, `/tasks/new`, `/tasks/:id`, `/tasks/:id/edit` (driver, vehicle, day,
  leave-by through `reassign_task`; Cancel with a reason), `/tasks/:id/stops`, `/vehicles/:reg`,
  `/vehicles/new`, `/vehicles/:reg/edit`, `/drivers/new`, `/drivers/:username/edit`,
  `/settings/users/new`, `/settings/users/:email/edit`. `ui/Page.tsx`: `PageTop` (the back
  arrow; Esc goes back), `StickyActions`, `ListWithDetail` (the child route in a right panel on
  a desktop, alone and full screen on a phone). The modal drawer (`ui/Drawer.tsx`) is gone.
  A change saved on `/tasks/:id/edit` returns to `/tasks/:id`, which shows the tool's
  warnings (the vehicle is busy, a document expired, …) above the facts; the board's day
  (`?date=`) travels through a task's detail, edit and stops pages back to the board. A
  vehicle's or a request's detail follows its list as the list refreshes (`useVehicle`,
  `useRequest`), so an edit shows at once.
- Phone (`ui/phone.ts`, 768 px): `tabsFor(me)` in `app/nav.ts` (Home, then the first of
  Requests (approve), Tasks, My requests (request), Map, Vehicles, Issues, Drivers the person
  may open until four are filled, then More; `moreFor(me)` lists the rest, never a tab twice;
  a dispatcher who may also ask gets Home, Tasks, My requests, Map, More); `homeAction(me,
  waiting)` is the big button on Home (New request / Requests to approve (N) / Assign a task /
  Live locations; for someone who approves it appears once the overview is in, so it never
  changes under the thumb); tables become cards (`td[data-label]`), 48 px targets, `StickyActions`
  above the tab bar, `PullToRefresh` around every page (70 px from the top →
  `store.invalidate()`); hidden menu items (`allowed`), the `Guard` keeps "No access".
- Drafts (`data/drafts.ts`, `useFormDraft(form, record, initial)`): localStorage
  `fame-fleet:draft:<e-mail or artifact>:<form>[:<record>]`, saved 300 ms after a change and
  when the page is hidden; `DraftBanner` "Resume draft from HH:MM · Discard"; `clear()` after
  a save. Forms: request-new, request-decide, task-new, task-edit, task-stops, vehicle-new,
  vehicle-edit, driver-new, driver-edit, user-new, user-edit.
- Stops editor (`StopsRows`): rows with a type select, the place, the arrive-by time, and
  Details (what, minutes there, pin, note); `stopLabel(list, i)` numbers within the type. The
  plan (`planLogic.ts`): `planLine` "Leave by 07:30 · Head office, Colombo 05 07:30 · Galle
  09:45 · 2 h 5 min driving · road time OpenRouteService" and `planReasons` ("Add a date.",
  "Add at least one stop with a place.", "Add a leave-by time, or an arrive-by time on a stop,
  so it can be planned.", "<stop> has no pin — add one.", "No base place set — pick it in
  Settings → Fleet.", the server's other warnings, the estimate note); computed 1.5 s after
  the last edit or with Plan now.
- The live check: `plan_task` on the real project with the pinned head office and Galle
  (6.0329, 80.2168) with arrive-by 10:00 answers "Leave by Fri 16 Oct 07:30" (OpenRouteService,
  117.5 km, via the expressway) and the warning "No base place set"; the page shows that line.
- Tests: Vitest 94 (nav tabs and More per preset, the home action, drafts, stop numbering,
  the plan line and reasons, the rest as before); Playwright desktop (the full flows on the
  pages) and the `phone` project (`e2e/phone.spec.ts`: five tabs and More for a fleet admin,
  four for a requester, the big action, the stops rows, a detail as a full screen with Back,
  drafts, pull to refresh).
- Mobitel names (the split rule, refined once more): after the code, tokens with a digit
  (`0UL00`, `GUL00`, `89L`) are skipped until the first word; the name is the words that
  follow until a token with a digit, a 2-letter district tag or a tag such as NOA / IP / BK;
  trailing digits come off a name token (`Padiyathalawa2` → `Padiyathalawa`). Result on the
  real file: 3,543 places with a code and a name, 231 with a bare code only, 338 with a name
  only, none with neither (4,112 in all).

## 5. Tools: new and changed, by part (inputs → result fields)

All additive; new tools at the end of `TOOLS` and `ALL_TOOLS`; `SHAPES=write` once per part.

**Part 2**
- `availability(at, until?)` (approve | assign_tasks; `at` ISO or "YYYY-MM-DD HH:MM",
  `until` optional): `{ as_of, drivers[] { name, username, on_duty_since?, off_duty?,
  current_task? { title, ends_planned?, ends_live? }, next_task_start?, declined_today,
  accepted_today, licence { chip: ok|orange|red, expiry? }, free: bool }, vehicles { groups
  (as suggest_vehicles), drivers_free[] } }`. `on_duty_since` from the open duty session.
- `update_request(request_id, version, date?, time?, back_by?, route_from?, route_to?,
  need_type?, pax?, tools?, note?)` (request for own; approve for any): a waiting request
  stays waiting (event `edited`); an approved one becomes `changed` (event `changed`,
  `request.changed` to approvers); result `{ request, needs_reapproval }`. A stale version
  is refused like `plan_version`.
- `redecide_request(request_id, version, decision: keep | change | decline, vehicle?,
  driver?, date?, time?, back_by?, reason?)` (approve): `keep` → approved again with the
  edited fields applied to the task (re-planned, `changed` push); `change` → the task
  reassigned and/or moved (reassign_task / update_task inside, `postponed` event when only
  the time moved); `decline` with a reason → request declined, the task cancelled ("Request
  declined: {reason}"), the requester, the driver and the custodian told. Works on
  `approved` too (the approver's "change at any time").
- `update_task(task_id, plan_version, date?, time?, leave_by?, driver?, vehicle?, title?,
  passengers?, contact_name?, contact_phone?, notes?, end_by?)` (assign_tasks): until
  completed; re-plans when the time moves; writes a `changed` event with `changes`; the push
  "Task changed: new time 09:30 · vehicle WP KL-1234" lists the changed fields; a driver
  change goes through the reassign rules (the old driver gets `removed` if he had accepted).
- `list_requests`: cards add `version`, `events[]`, status `changed`. `task_detail`:
  `assignment_history[]` rows add `changes`. `list_drivers` and `live_drivers` cards add
  `on_duty_since`. `decide_request` and `book_vehicle` keep working unchanged.
- `get_settings` / `update_settings`: `shift_start`, `shift_days`.

**Part 3**
- `list_fuel(month, vehicle?, driver?)` (vehicles): `{ month, totals { litres, lkr, entries,
  videos }, entries[] { id, at, vehicle, driver, task_id?, litres, lkr, odometer_km,
  receipt (signed), video { status, duration_s, bytes, url (signed, 1 h) } } }`.
- `task_detail.fuel[]` and `mileage_summary` entries add `video { status, url }`.

**Part 4**
- `import_places(rows[] { operator, site_id?, other_ids?[], name, lat?, lng?, region?,
  district?, depot?, source }, preset?)` (vehicles; at most 500 rows a call): the upsert of
  8.3; result `{ added, updated, no_pin, skipped[] { row, reason } }`.
- `search_places(text, limit?)` (view | request): `{ places[] { id, operator, site_id,
  other_ids, name, district, depot, pinned, lat?, lng? } }`, prefix matches first, then
  trigram, 2 characters minimum.
- `update_place(id, name?, address?, lat?, lng?, kind?, district?, depot?)` (vehicles):
  set or move the pin; `pinned` follows.
- `list_places` keeps its shape and adds `operator`, `site_id`, `pinned`, `district`.
- `create_task` / `plan_task` / `update_task_stops` stops accept `place_id` (a picked
  site) besides `place`.

**Part 5**
- `register_map_load()` (view; web only): `{ allowed, count, cap, package }` — one call per
  map initialisation; at the cap `allowed: false` and `package: "open"` until midnight
  Colombo.
- `routing_usage(days?)`: rows now carry `google_map_loads`, `google`, `google_roads` with
  the caps; `today { map_loads: "41/300", routes: "12/150", roads: "30/150", package }`.
- `get_settings`: `map_package`, the three caps, `map_package_effective` (what the server
  will use now: the setting, the secrets present, the caps), `google_configured { js, routes,
  roads }` (booleans, never the keys).
- `driver_route(snap)`: under `open`, `snap` is ignored (status `off`); under `google` with
  `GOOGLE_ROADS_KEY`, the provider is `google_roads`. The artifact and Claude never pass
  `snap`.
- office-api `GET /me` adds `map { package, google_js_key? }` (the browser key only under
  `google` and under the cap; the web app re-reads `/me` after a cap answer).

## 6. Part 2: availability, approvals, edits and redo, presence

- **"Who's available" panel** (`src/screens/AvailabilityPanel.tsx`, from `availability`):
  on `/requests/:id/decide`, on `/requests/new` for an approver ("Assign now"), and on
  `/tasks/new` beside the driver and vehicle selects. Rows: a status chip (On duty since
  07:12 / Off duty / On a task until ~10:40 (live) / Next task 13:00), the counts today, the
  licence chip; a click fills the select. Refreshed when the time field changes (400 ms) and
  every 60 s while open.
- **Requester edits**: `/requests/:id/edit` (own, waiting or approved): time, back-by,
  route, pax, type, note; a note "This booking is approved: your change needs re-approval"
  on an approved one; Save → `update_request`; the request page shows "Changed · needs
  re-approval" and the approver gets `request.changed`. Cancel: the existing Cancel on own
  waiting requests, and on approved ones (`cancel_request`).
- **Re-decision**: `/requests/:id/decide` on a `changed` (or approved) request shows what
  changed (from → to), the availability panel, and Keep (re-plan) / Change vehicle or driver
  / Postpone (new time) / Decline with a reason → `redecide_request`. The requester's
  timeline: sent → seen → approved → changed → kept / changed / declined.
- **Task edits**: `/tasks/:id/edit` (until completed): `update_task`; `/tasks/:id/stops`:
  `update_task_stops`. Each change: a `changed` event with the diff, on the task history
  card and on the requester's timeline (a request's task), and the push "Task changed: new
  time 09:30" to the driver (the existing `changed` kind, now with the fields in the body).
  A reassign after an accept sends the old driver "Task removed" (exists).
- **Presence**: On duty = at work. `on_duty_since` on the driver page, the Drivers table,
  the live cards and the availability panel ("On duty since 07:12", "Off duty since 17:40").
- **Shift nudge (driver app)**: `get_driver_settings()` at sign-in and every refresh; a
  repeating local notification at `shift_start` on each of `shift_days` ("At work? Switch On
  duty" / "වැඩට ආවද? රාජකාරියේ යන්න ඔන් කරන්න"), channel `general`; armed whenever the app
  runs and the driver is off duty, disarmed when On duty is switched on, armed again when it
  is switched off; tapping opens Today. Nothing else is asked of drivers.

### 6.1 Part 2 as built (14 October 2026, branch `phase6-2-approvals`)

- Migration `20261014180000_phase6_requests.sql`: `vehicle_requests.version` (bumped on every
  edit and decision), `changed_at / changed_by / change_note`, `previous` (the fields before
  the last edit), `on_behalf_of`, status `changed` (= approved and edited since; `changed_at`
  marks it and is cleared when decided again); `request_events` (created, seen, edited,
  approved, declined, changed, redecided, postponed, cancelled; actor, note, changes; read
  through RLS by approvers and by the requester for their own; backfilled from the columns);
  `task_assignment_events.changes` and the action `changed`; the leave-by backfill;
  `get_driver_settings()` (shift_start, shift_days; a driver may read nothing else);
  `send_push(…, p_extra)` and a `tasks_notify_push` that names what changed (time, end_by,
  vehicle, title, stops = plan_json changed, passengers, notes); `office_book_vehicle` carries
  on_behalf_of. pgTAP: `phase6_requests.test.sql`.
- Tools (`_shared/fleet`): `availability(at, until?, need_type?, pax?)` (`availability.ts`:
  `driverAvailability` pure, with `availability_test.ts`; the vehicles through
  `availabilityFor`, now shared with `suggest_vehicles`), `update_request` and
  `redecide_request` (`requests_rules.ts`: `requestDiff`, `diffText`, `statusAfterEdit`,
  `checkVersion`, `canRedecide`, with `requests_edit_test.ts`), `update_task` on top of
  `changeTask` in `tools/tasks.ts` (also used by redecide: a moved time shifts the planned
  times; a new driver gets the task as new; a route replaces the pending stops through
  `office_update_task_stops` and re-plans from the new leave time; one history event with the
  diff; `booking.changed` to the requester and the custodian, `vehicle.booking_cancelled` to a
  custodian whose vehicle is no longer used). `create_request` / `book_vehicle` take
  `on_behalf_of` (`requested_by` is now optional: the request is in the asker's name).
  `list_requests`: `status=waiting` includes `changed`, `status=changed` alone; cards carry
  `version`, `on_behalf_of`, `fields` (date, time, back_by, route, need_type, pax, tools, note,
  driver_required, on_behalf_of: what the edit form needs), `changed`, `changes` (previous →
  now, for a changed one), `timeline.changed`, `events[]`. `task_detail.task` adds `date` and
  `time`; `assignment_history[]` rows add `changes`. `list_drivers` adds `on_duty_since` /
  `off_duty_since`, `live_drivers` `on_duty_since`. `fleet_overview` and the `request_waiting`
  issue count a changed booking as waiting (from its edit). Events `request.changed`
  (approvers), `request.redecided` (the requester), `booking.changed` (requester + custodian).
  Settings `shift_start` (HH:MM) and `shift_days` (0 = Sunday … 6). Every decision bumps the
  version. push-task: "Task changed: new time 09:30 · vehicle WP KL-1234 · stops changed" in
  en and si. Deno: 108 tests. `tool-shapes.json` rewritten (SHAPES=write).
- Web: `AvailabilityPanel` (`availabilityLogic.ts`: tones, the line, the arguments; 400 ms
  after the time settles, every 60 s while open; a click fills the driver) on the decide page,
  the request form's "Assign now", the task form and the task edit page; "On behalf of" on the
  request form (everyone asks in their own name; "Who needs it" is gone); `/requests/:id/edit`
  (`RequestEdit`: `editFields`, `updateRequestInput`; "This booking is approved: your change
  needs re-approval"); the decide page's second mode for an approved or changed booking (what
  changed, Keep as asked / Change the vehicle, driver, day, time or back-by / Decline;
  `redecideInput`); the request detail and list show "Changed · needs re-approval" with the diff,
  Edit request, Review on a changed one, a Changed filter, "for X"; the timeline comes from
  the events (`timelineSteps`, `diffLines`). `/tasks/:id/edit` uses `update_task` for the
  day, leave-by, end time, driver, vehicle, title, passengers, contact and notes (the words
  only while under way) with the task's plan_version; the history card prints each change's
  diff. Presence on Drivers, the live card and the driver page. Settings → Fleet: the shift
  nudge's time and days. Vitest 103; Playwright adds "a requester changes an approved booking;
  the approver sees who is available and keeps it; a task is changed with its history".
- Driver app: `get_driver_settings` on every refresh (`fetchDriverSettings`, cached);
  `armShiftNudge` / `disarmShiftNudge` in `lib/notifications.ts` (one weekly local
  notification per day on the `general` channel, armed while signed in and off duty,
  disarmed when On duty goes on and on sign-out; nothing is rescheduled while the settings and
  texts are the ones already scheduled); strings `shift.title` / `shift.body` (en + si).
- The connector suite's section 3b covers the edit (waiting stays waiting; approved becomes
  changed), stale versions, keep / postpone / change / decline, `update_task` with the history
  and the planned times, `availability`, presence and the shift settings.

## 7. Part 3: the Fuel tab and the videos

### 7.1 Driver app

- Tabs: Today, Mileage, Fuel, Report, Me (five; the pill bar already scales).
- Fuel tab: the vehicle (prefilled from the current vehicle, changeable), the odometer photo
  with the existing reader (the same `log-mileage` step component, mode `fuel`), litres,
  amount (LKR), the receipt photo, and **Record video** (required): `expo-camera`
  `CameraView` full-screen, `recordAsync({ maxDuration: 90, mute: true })`, quality `720p`
  with `videoBitrate 1_500_000` (falls back to `480p` at 1,000,000 when 720p is not offered
  by the phone), a timer, and an on-screen checklist the driver ticks while recording
  (default items: pump display with litres and amount · odometer · number plate; you confirm
  the list; stored in `video_checklist`). Retake replaces the file. The entry cannot be saved
  without a video; the file lives in `Paths.document/videos/<uuid>.mp4` until the server
  confirms the upload, then it is deleted.
- The entry is saved like today (`fuel_log` op with `video_status 'recorded'`, duration and
  bytes), followed by a `video_upload` op (section 7.2). The Fuel tab lists this month's
  entries with the upload state: "Uploading 45 % · continues when there is signal",
  "Waiting for Wi-Fi", "Uploaded", "Failed · tap to retry".
- Setting on Me: "Upload videos on Wi-Fi only" (default off; `expo-network` tells the type).

### 7.2 Upload design (resumable, through the queue)

- One module behind one interface, `apps/driver/src/lib/videoStore.ts`:
  `createUpload(meta) → { url }`, `offset(url) → number`, `sendChunk(url, offset, bytes) →
  number`, `finish(path)`; `SupabaseTusStore` now, a `DriveStore` later (a server endpoint
  would mint a Drive resumable session with a service account; the queue code does not
  change).
- TUS against `${SUPABASE_URL}/storage/v1/upload/resumable`: POST (headers `Authorization`,
  `apikey`, `x-upsert: false`, `Tus-Resumable: 1.0.0`, `Upload-Length`, `Upload-Metadata`
  with `bucketName`, `objectName`, `contentType`, `cacheControl` base64) → the upload URL;
  HEAD → `Upload-Offset`; PATCH chunks of exactly 6 MB (Supabase's chunk size) read at a
  position with `expo-file-system/legacy` `readAsStringAsync(uri, { encoding: 'base64',
  position, length })`; the last chunk completes the object. The URL lives 24 hours: on a
  404 / 410 the op creates a new upload and starts from the server's offset (0).
- The op `video_upload { fuel_log_id, path, local_uri, bytes, url?, offset }` sits in `ops`
  like everything else, in order, after the `fuel_log` row; the engine sends one chunk per
  step and saves the offset after each, so a signal loss or an app restart continues from the
  last chunk; a connection error goes through the backoff ladder (5 s, 30 s, 2 min, 5 min,
  5 min…) with the rest of the queue; a permanent refusal (4xx that is not 404/410/409)
  marks the op failed (shown as "Failed · tap to retry", `video_status 'failed'`). "Wi-Fi
  only" on: the op is skipped while the connection is mobile data (the heartbeat says why).
  On completion the engine patches `fuel_logs` (`video_status 'uploaded'`, `video_uploaded_at`)
  and deletes the file. Progress (`offset / bytes`) reaches the Fuel tab through
  `onQueueChange`.
- Heartbeat adds `video_uploads_waiting` and `video_bytes_waiting`; the office's phone line
  shows "1 video waiting (12 MB)".
- Tests (`scripts/test-sync.ts`, a fake TUS server in memory): chunk order and size, resume
  from the server's offset after a drop, a new upload after 410, Wi-Fi-only skipping, the
  backoff ladder, the `fuel_logs` patch at the end.

### 7.3 Office

- `/fuel` (vehicles): filters month, vehicle, driver; tiles litres and LKR; cards or rows
  with the entry, the receipt, the odometer and the video (a `<video controls>` on a signed
  URL; "Uploading on the phone" / "No video" / "Pruned" states). Task detail and the Mileage
  page link to the same entries.
- Storage estimate for 12 vehicles: a 90-second 720p video at 1.5 Mbps is about 17 MB
  (480p at 1 Mbps about 11 MB). At 2 fills a week per vehicle: 12 × 8.7 = about 104 videos a
  month = 1.8 GB a month at 720p (1.2 GB at 480p); with the 12-month prune the bucket holds
  about 21 GB (14 GB). Supabase Pro includes 100 GB of storage; office viewing adds a few GB
  of egress a month at most. Most fills are shorter than 90 s, so these are upper figures.

### 7.4 Part 3 as built (14 October 2026, branch `phase6-3-fuel`)

- Migration `20261014190000_fuel_videos.sql`: the private bucket `fuel-videos` (120 MB,
  video/mp4; insert, update and select inside the driver's own folder, so the resumable
  upload works), `fuel_logs.video_path / video_status / video_duration_s / video_bytes /
  video_uploaded_at / video_checklist` (a driver inserts them with the log and may update the
  video columns of their own rows; `video_path` must be in their folder), the setting
  `fuel_video_checklist` seeded with the three defaults (the office edits it; Sinhala falls
  back to the English), `get_driver_settings()` answering it, `driver_heartbeats` /
  `driver_latest` with `video_uploads_waiting` / `video_bytes_waiting` (`send_heartbeat` takes
  two more optional parameters), and pg_cron `fuel-videos-prune` (the 1st, 21:45 UTC) calling
  `fleet-jobs` `{"job": "prune_fuel_videos"}`. pgTAP `fuel_videos.test.sql`.
- Server: `videos.ts` (`videoCard`, `videoLinks` 1-hour signed links, `pruneDue` pure,
  `pruneFuelVideos` through the storage API in batches of 100, with `videos_test.ts`),
  `list_fuel(month, vehicle?, driver?)` (vehicles permission; totals entries / litres / lkr /
  videos / videos_waiting / videos_missing / bytes), `task_detail.fuel[]` rows with `id` and
  `video`, `mileage_summary` by-vehicle rows with `fuel_videos`, `live_drivers` cards with
  `video_uploads_waiting` / `video_bytes_waiting`; the connector suite uploads a tiny MP4
  through the resumable endpoint and checks the links, the prune job and the checklist.
- Driver app: a fifth tab, Fuel (this month's fills with the state of each video: Uploading
  NN % · continues when there is signal, Waiting for Wi-Fi, Uploaded, Failed · tap to retry,
  No video; Log fuel). The fuel form (`log-mileage`, mode fuel, and the end-of-task fill) needs
  a video: `record-video` is a full-screen silent `CameraView` (720p at 1.5 Mbps, 480p at
  1 Mbps when a phone refuses 720p, at most 90 s, at least 3 s) with the office's checklist to
  tick; the file lives in `Paths.document/videos/<id>.mp4` until the server confirms the
  upload. The upload is an op in the queue (`video_upload`, after the `fuel_log` row) behind
  `lib/videoStore.ts` (`SupabaseTusStore`: create, head, 6 MB chunks read at a position with
  `expo-file-system/legacy`); the engine keeps the server's offset after every chunk, asks the
  server where it is on resume, starts afresh after a 404/410, treats "already there" as
  uploaded, steps over a video waiting for Wi-Fi so the rest of the queue goes on, marks the
  row failed when the file is gone, and patches `fuel_logs` uploaded at the end; the heartbeat
  carries the waiting videos and bytes; Me has "Upload videos on Wi-Fi only". `test:sync`
  covers the chunking, the resume, the 410, Wi-Fi only and the failed file; `test:data`
  uploads a real tiny video into the local bucket.
- Web: `/fuel` and `/fuel/:id` (filters month, vehicle, driver; tiles; a `<video controls>`
  on the signed link; the ticked items by name), Fuel in the menu (vehicles), the video on the
  task detail's fills with a link, "Fuel entries and videos" on Mileage with the per-vehicle
  count, "1 video waiting (12 MB)" on the live card's phone line, the checklist editor in
  Settings → Fleet (1 to 8 items, English and Sinhala). Vitest `fuelLogic.test.ts`; Playwright
  "the Fuel page: a fill with its video uploaded from the phone plays in the office; the
  checklist is edited in Fleet settings".
- Not done here, on purpose: no in-app playback and silent recording (decisions 7 and 8); the
  nudge and the Fuel tab reach phones with the round-2 EAS update.

### 7.5 Part 3b as built (14 October 2026, branch `phase6-3b-fullfill`)

- The video covers the whole fill: one piece lasts up to 12 minutes (`MAX_VIDEO_SECONDS`),
  a countdown shows in the last 30 s, at least 3 s. Default 480p at about 1.0 Mbps; 720p at
  1.5 Mbps only when the setting `fuel_video_quality` says so (`get_driver_settings()` carries
  it). The bucket's per-file limit is 250 MB (migration `20261014200000_fuel_video_segments`).
- Interrupted recordings: when a call, the app going to the back or the camera being taken
  away stops the recording (also when the 12 minutes run out), the piece is kept and the
  screen offers "Continue recording" (up to 3 pieces) or "Use this video"; the back arrow
  never throws a recorded piece away without asking. The pieces are stored as
  `fuel_logs.video_segments` [{path, duration_s, bytes}] (`<id>.mp4`, `<id>-2.mp4`,
  `<id>-3.mp4`), `video_interrupted` true, totals in `video_duration_s` / `video_bytes`;
  each piece is its own `video_upload` op, the first marks the row uploading, the last marks
  it uploaded after a look at the row (a piece that failed for good keeps it failed). The
  office sees "Video · interrupted", "interrupted, 2 pieces", and plays the pieces one after
  another on `/fuel/:id`; `list_fuel.totals.interrupted` counts them; the prune removes every
  piece.
- Storage, 12 vehicles × 8 fills a month (96 fills): at 480p a 5-minute fill is about 38 MB,
  so about 3.5 GB a month, 21 GB over 6 months, 42 GB over 12; if every fill ran the full
  12 minutes (90 MB) it would be 8.4 GB a month, 51 GB over 6 months, 101 GB over 12. At 720p
  a 5-minute fill is about 56 MB: 5.3 GB a month, 32 GB over 6 months, 63 GB over 12.
  Recommendation: 12 months at 480p (typical fills stay far inside the Pro plan's 100 GB,
  86 GB even if fills average 10 minutes); switch `fuel_video_keep_months` to 6 if 720p is
  turned on or the bucket passes about 70 GB. The setting is live: the prune reads it each
  month and answers `keep_months`.
- The Fuel tab says "Uploading 38 MB · 12 %" for the whole fill (every piece still on the
  phone counted); "Upload videos on Wi-Fi only" stays off by default.
- Addition (same branch, 14 October): the checklist is an ordered sequence of steps. The
  default, from the setting `fuel_video_checklist` (migration
  `20261014210000_fuel_video_steps` replaces the seeded value where it was never edited):
  1 Number plate, 2 Pump display at zero before pumping, 3 Pumping, 4 Final pump display
  (litres and amount), each with a `short` word for the office ("Plate", "Zero", "Pumping",
  "Final"; the English text when missing). The recording screen shows the current step large
  with "Done · next step"; a double tap never ticks two; Stop is disabled until the last step
  is ticked and the fill is 30 s (`MIN_VIDEO_SECONDS`, "Stop opens after the last step" /
  "At least 30 s" under the button). Each tick's second in the fill (across the pieces) is
  saved in `fuel_logs.video_checklist` as [{key, at_s}] (older rows keep their list of keys);
  `list_fuel` and `task_detail` answer `video.checklist` (the keys, unchanged), `video.marks`
  [{key, label, at_s, clock}] and `video.timeline` ("Plate 0:04 · Zero 0:11 · Pumping 0:15 ·
  Final 3:52"). On `/fuel/:id` the bookmarks sit under the video; a click opens the video
  there (the right piece, then the second within it: `pieceAt`). Settings → Fleet ("Fuel video
  steps") orders them (Move up / down), names the short word, adds and removes. An interrupted
  fill continues at the next step; "Use this video" waits for the steps and the 30 s unless no
  more pieces can be added (never a retake of a fill that happened); leaving with pieces that
  are not complete asks "Continue recording / Discard", and a piece under way is kept first.
- Driver app additions (same branch, 14 October, before round 2b):
  1. Upload cadence: the location task uploads every 20 s while the vehicle moves (the recording
     rules' `moving`), every 60 s while it stands, or at 10+ waiting points (`UPLOAD_MOVING_MS`,
     `UPLOAD_PARKED_MS` in `lib/locationTask.ts`).
  2. Retry: two ladders in `sync/engine.ts`: moving 5 s, 15 s, 30 s, then every 30 s
     (`BACKOFF_MOVING_MS`); parked 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min
     (`BACKOFF_PARKED_MS`). When expo-network's listener says the network is back (the phone's
     own report; `@react-native-community/netinfo` is not in the build and would need a new
     native build), `sync/index.ts` resets the ladder and flushes at once. A batch that fails is
     the first one sent next time: the batches before it were removed from the phone as they went
     (test-sync proves it with point 501).
  3. Standing still (`lib/recording.ts`): a fixed 10 m radius from the anchor, never widened by
     the accuracy, no speed test; the vehicle leaves "still" when a fix is over 10 m from the
     anchor or the movement added up fix to fix since the last stored point passes 10 m, and that
     fix becomes the anchor; one point a minute while still. Walking at 4 km/h stores a point
     every 10–15 m; a parked car with the half-metre wobble of a standing GPS gets one a minute
     (test-track covers both). A phone whose fixes wobble 8 m while parked, or the real indoor
     recording, now stores most of its fixes (the wobble counts as movement under this rule; the
     server's filter still removes the phantom km).
  4. Heartbeat history: `driver_route` answered `heartbeats: 0` for every driver all day because
     the route_quality migration grants drivers INSERT on an explicit column list and the
     fuel_videos migration added `video_uploads_waiting` / `video_bytes_waiting` without extending
     it; the app sends both, PostgREST answered "permission denied", and the queue dropped every
     refused batch as "history the server will never take". So the rows were written on the phone
     and uploaded, and refused on the server. Fix: migration `20261014220000_heartbeat_video_columns_grant`
     (the grant), the pgTAP test and the connector suite insert a row as a driver with every
     column the app sends (a column added without its grant now fails the tests), and the queue
     keeps a refused history batch as rejected (retried with the points) instead of dropping it.
     Today's rows before the fix are gone from the phones (they were dropped); from the fix on,
     "App not running" and "no GPS" are real.
  5. The live card and the marker show "position HH:MM:SS" (`last_position_time` on every
     driver card, additive; the web's Realtime update keeps it current).
- Round 2c (branch `phase6-3c-live-trails`, 14 October): (a) the Live page bug: the trail calls
  passed only the driver name (the tool's default 12 m thinning) and the 60-second refetch
  replaced the trail, so the dense Realtime line collapsed to a few far-apart points every
  minute. The trails now ask for 3 m / 3000 points like the driver page, and the refetch merges
  by recorded_at into the line already drawn (`mergeRoute` in `src/data/route.ts`: the fresh
  line plus the Realtime points it lacks, the numbers from the fresh answer); the shown route
  merges the same way. (b) Watched mode: `watch_drivers(drivers[])` (view) sets
  `driver_latest.watched_until` 90 s ahead (migration `20261014230000_watched_drivers`); the web
  calls it every 30 s (`useWatchDrivers`) for the driver page today, the selected driver on Live
  locations, and every sharing driver while the trails are on; `send_heartbeat()` now answers
  `{watched}` (jsonb; void before), the phone keeps the mode 150 s after a heartbeat that said
  so and uploads every 10 s while moving (`UPLOAD_WATCHED_MS`), 20 s unwatched, 60 s parked.
  (c) Every route view asks for tolerance 0 with 3,000 points: the driver page (today and a past
  day), the task route and the Live page. The server (`simplifyLine`) removes nothing while the
  line fits the cap; above it, it finds the smallest tolerance that gets under (doubling from
  0.5 m, then bisecting to 5 cm). Claude's default 12 m is applied and doubled as before. The
  driver page's 60-second refetch merges too (`mergeRoute`) and keeps the selected timeline row;
  playback steps through every point of the line in time order (a gap waits at most 1.5 s).
  Round 2c deploys the migration, the three functions and the web; the phone part waits for the
  round 3 eas update.
- Phone health (branch `phase6-3d-phone-health`, 15 October): (1) driver_heartbeats had never held
  a row on the live project. The app uploads the history as an upsert that ignores repeats
  (`ON CONFLICT DO NOTHING`), and Postgres checks that form against the SELECT policies; drivers
  had an INSERT policy only, so every batch was refused ("new row violates row-level security
  policy"). The grant fix of 14 October was real but not enough, and every test used a plain
  insert. Migration `20261015090000_phone_health` adds `driver_heartbeats_select_own`; pgTAP, the
  connector suite and test:data now upload the way the app does, twice (a repeat is ignored). The
  phones on 01a13a6e kept each refused batch as rejected and put it back in line on pull to
  refresh, after an update and once a day, so the rows since 14 October 18:05 arrive once the
  migration is live. Every other table the app upserts into already lets a driver read their own
  rows. (2) test.driver2's 15 October 06:12–06:28: the app frozen for 7, 3 and 5 minutes with
  2–7 m GPS around the gaps and nothing uploaded later, the battery manager. Two defences, shipped
  with Part 4's eas update: the watchdog (on duty, moving, no position for 90 s: the location
  service is stopped and started again, at most once every 90 s; `location_restarts` on the next
  history row, migration column with its grant; `driver_route` answers the sum), and the Phone
  setup card on Today (a gap of over 3 minutes between two heartbeats of one duty period, kept 7
  days on the phone, shown for the last 3 days until Done; the brand's settings page through
  expo-intent-launcher with App info as the fallback; steps for OPPO, realme, Xiaomi, vivo,
  Samsung and other phones in both languages; `npm run test:setup`).

## 8. Part 4: site lists and place search

### 8.1 What is in the files (read on 14 October 2026)

| File · sheet | Rows | Columns used | Found |
|---|---|---|---|
| `dialog.xlsx` · `All Operational Sites_DNS Data` | 3,791 | Site ID, Other Site IDS, Site Name, New Region, District, Depot, Latitude, Longitude (the depot officer and contact columns are skipped) | 3,791 ids, none missing, no duplicates; **20 without usable coordinates** |
| `mobitel.xlsx` · `4G-LTE` | 24,689 | SiteName, Longitude, Latitude (NEName is a copy of SiteName) | only **5,051 rows carry coordinates** (19,598 are empty rows, 40 say `#N/A`); they give **4,112 places** at 4 decimals (4,357 at 5) |
| `mobitel.xlsx` · `EP Issue` | 2,457 | Site ID, Lat. (N), Lon. (E) | 2,457 ids; **2,259 within 100 m** of a 4G place, **197 nowhere near one** (new places named by the id), 1 with a bad coordinate |

### 8.2 Presets (parsed in the browser with SheetJS, web build only, lazy chunk)

- **Dialog site list**: one row = one place, `operator dialog`, `site_id` = Site ID,
  `other_ids` = Other Site IDS split on `,` `;` `/` and spaces (e.g. `CM0164`), name = Site
  Name, region = New Region, district, depot, lat/lng when both parse and lie in Sri Lanka
  (5–10 N, 79–82 E), else no pin.
- **Mobitel 4G-LTE**: rows without a coordinate pair are skipped (reported). One place per
  coordinate rounded to 4 decimals. From SiteName, after `_` becomes a space: the code is
  the first token when it matches `^[A-Z]{2,6}\d+[A-Z]?` — also when a name is glued to it
  (`KYKAD3Kadugannawa8L` → code `KYKAD3`, rest `Kadugannawa8L`); the name is the following
  tokens, each with a trailing digit group (and one letter after it) stripped
  (`Galkulama2` → `Galkulama`, `Kadugannawa8L` → `Kadugannawa`), up to the first token that
  is empty after that, has 3 characters or fewer, or still contains a digit; the most
  frequent name among the rows of one coordinate wins, the most frequent code too. A place
  with a code gets `site_id` = code; one without a code is keyed by its coordinates and
  named by its name; a place with a code and no name is named by the code.
- **Mobitel EP**: one row = one id; attach the id to `other_ids` of the Mobitel place within
  100 m (the nearest when several), else create a Mobitel place with that id as `site_id`
  and as its name, pinned at the row's coordinates.
- Numbers from the local run are reported at the Part 4 checkpoint; the live import is yours
  to run through the page after round 3.

### 8.3 Upsert and dedupe rules (`import_places`, the same for the page and for Claude)

1. Key: `(operator, site_id)` when the row has an id; else `(operator, round(lat, 4),
   round(lng, 4))`.
2. Match → update name, region, district, depot, `other_ids` (union), coordinates when the
   row has them and the place has none or the row is from the same preset (a manual pin set
   on the place page is never overwritten by an import: `source = 'manual'` on the pin wins),
   `imported_at`, `updated_at`; count `updated`.
3. No match → insert with `kind 'site'`, `source` = the preset, `pinned` by the pin; count
   `added`, and `no_pin` when it has none.
4. A row with neither an id nor coordinates nor a name → `skipped` with the reason.
5. An id already attached as an `other_id` of another place of the same operator → `skipped`
   "already an other_id of <site>". Batches of 500 rows a call, in one transaction each.

### 8.4 Import page, search, place page

- `/settings/import-sites` (vehicles): choose a file, pick the preset, Preview (counts:
  rows, with pin, without, ids), Import (batches with a progress bar), the report (added,
  updated, no pin, skipped with reasons, downloadable as CSV).
- `search_places`: `where name ilike 'text%' or site_id ilike 'text%' or other_ids @>
  array[upper(text)]` first, then `similarity(name, text) > 0.3 or site_id % text or
  array_to_string(other_ids,' ') % text` ordered by similarity, `limit` 20. The stops editor's
  place picker (2 characters on) shows "MT0184 · Inamaluwa Town · Dambulla · Dialog" rows
  and a red "no pin" chip; choosing a site without a pin warns under the row ("Inamaluwa
  Town has no pin — the plan skips this leg; set it on the place page").
- `/places` (vehicles): search, filters by operator and pinned, the list; `/places/:id`: the
  details, the ids, the map with the pin draggable (web) or lat/lng fields (both), Save →
  `update_place`.

### 8.5 Part 4 as built (15 October 2026, branch `phase6-4-sites`)

- Migration `20261015100000_places_sites`: `pg_trgm`; places gain operator, site_id, other_ids,
  region, district, depot, source, pin_source, attribution, provider_ref, imported_at,
  updated_at, pinned (generated) and ids_text (trigger: site id and other ids, lower case).
  Keys: one place per (operator, site_id); one Mobitel place without an id per coordinate at
  4 decimals. The unique name rule (`places_name_key` on lower(name)) became
  `places_saved_name_key`: only the office's own places (operator other, source manual or
  claude) must have unique names; sites repeat names (thousands of towers) and places saved
  from the map may too (save_place answers the one within 30 m instead). Functions:
  `search_places_ranked` (exact id, name or id prefix, a word of the name, then trigram
  similarity; offices first at equal rank), `recent_places` (names typed in task stops,
  task starts and requests' From / To in the window, not our places' names),
  `import_place_rows` (the rules of 8.3 in one transaction a call; EP rows attach within
  100 m; answers added, updated, attached, unchanged, no_pin, skipped with reasons). Table
  `geocode_cache` (service role, pruned nightly by `prune-geocode-cache`), setting
  `ors_autocomplete_daily_cap` 1000.
- The presets (`_shared/fleet/sites.ts`, `@fleet/sites` in the web): Dialog, Mobitel 4G-LTE,
  Mobitel EP, with repairs reported (latitude and longitude swapped, a space inside a number).
  On the real files: Dialog 3,791 sites (20 without a pin); Mobitel 4G 5,091 rows with
  coordinates or text → 4,116 places (40 rows without coordinates skipped; 3,659 carry a
  code); Mobitel EP 2,457 ids (3 repaired, none lost). Imported into the local stack in about
  4 s: Dialog 3,789 added (2 skipped: the id is another site's other id), Mobitel 4G 4,116
  added, EP 159 added, 220 attached within 100 m, 2,078 already there (the 4G site's own code).
  `apps/office/scripts/site-counts.mts [--local]` repeats the counts and the local import.
- The location search box (`ui/LocationSearch.tsx`, the addition of 15 October): one box for
  the stops and the start of Assign a task / Edit stops and for From / To on the request forms.
  `search_places(text, limit?, map?)` answers our places (badges Office, Site · Dialog,
  Site · Mobitel, Saved), the places used in the last 90 days (Used before), then the map's
  public places (Map) from openrouteservice geocode autocomplete (`_shared/fleet/geocode.ts`:
  boundary.country LK, focus the base place, size 8, from 3 characters, the existing ORS_KEY,
  cached 30 days per normalised text, counted per day as `ors_autocomplete` in
  routing_calls; at `ors_autocomplete_daily_cap` only our places show, with "Map search limit
  reached for today"). 300 ms after the last key; from 2 characters. A pasted "lat, lng" or
  Google Maps link answers `pin` (`_shared/fleet/pasted.ts`; a maps.app.goo.gl link is
  resolved on the server, every redirect hop on a Google host). A Map result or a pin opens a
  small map to confirm (`map/PinMap.tsx`: draggable on the web, the drawn map and the "lat,
  lng" field in the artifact) and `save_place` keeps it (kind other, source ors / link / pin,
  the OSM credit and the provider id). The provider sits behind `geocode.ts`, which describes
  how Google Places Autocomplete replaces it under map_package google (session tokens,
  `storable: false`: the place id kept, not its coordinates; Google tiles only); not built.
- Stops and starts take `place_id` (create_task, plan_task, update_task_stops, book_vehicle's
  stops; task_detail's stops answer it). Typed text: the exact name, else a site id or other
  id, else, unless the text is a town's name, part of the name of one of the office's own
  places (never part of a site's name: "Galle" stays the town, "Matara" never becomes a
  tower). `list_places` leaves the sites out unless asked (operator, kind site or a search)
  and adds id, operator, site_id, district, pinned.
- Pages: `/places` and `/places/:id` (vehicles: find by name or id, owner and pin filters; the
  place with its ids, the pin on the map, Save → `update_place`, a pin set by hand is never
  moved by an import), `/settings/import-sites` (web: SheetJS 0.20.3 from the SheetJS CDN, a
  lazy chunk; Preview, Import in batches of 500 with progress, the report and its CSV).
  Tools: search_places and place_detail (view or request), save_place (request, approve,
  assign_tasks, vehicles), import_places and update_place (vehicles).

### 8.6 Part 4b as built (15 October 2026, branch `phase6-4b`)

- Custom site import (migration `20261015120000_phase6_4b`): Settings → Import sites takes any
  .xlsx, .xls or .csv; the sheet, the row with the column names and a drop-down per field (name
  required; latitude + longitude or one "lat, lng" column; site id, other ids, district, region,
  depot, address, kind; the operator as a column or one value; optionally "attach each id to a
  site within N m"). One engine (`mapTable` in `_shared/fleet/sites.ts`, `@fleet/sites` in the
  web) with the built-in Dialog and Mobitel EP lists as mappings on it (Mobitel 4G keeps its
  name rule; the real files give the same counts as before). Preview: counts and the first 20
  problem rows (outside Sri Lanka, an id twice, no name: skipped, never fatal; swapped
  coordinates and a space inside a number repaired and said). "Save this mapping as a preset"
  (`save_import_preset`, `site_import_presets`; a saved name again replaces it; built-in names
  refused). Every import is recorded (`place_imports`: who, when, the file, the preset, the
  counts; `place_import_changes`: each place added, updated or attached with how it was before);
  "Undo this import" (`undo_place_import`): added places switched off (`places.active`; left out
  of every search and list, kept for the stops that used them, switched on again by a later
  import that matches them), updated and attached ones put back; a place changed since (by hand,
  by a later import) is left as it is and named. Nothing is deleted. The preset key an import
  records is the preset's own while its mapping is unchanged (`dialog`, `custom:<id>`), else
  `custom`; an import replaces only pins from the same key.
- openrouteservice on api.heigit.org (`_shared/fleet/orsHosts.ts`): directions at
  `/openrouteservice/v2/directions/driving-car/json`, autocomplete at `/pelias/v1/autocomplete`
  (the announcement maps `/geocode` to `/pelias/v1`; both answer 401 without a key, unknown
  paths 404), the same key in the Authorization header; the deprecated api.openrouteservice.org
  (a tenth of the quota since 27 August, shut down 2–6 November 2026) only on a 404 or 410. The
  dashboard's Geocoding quota (3,000 a day, 100 a minute, shared by autocomplete, search and
  reverse): `ors_autocomplete_daily_cap` 2,500 (the seeded 1,000 replaced where nobody changed
  it), `ors_autocomplete_per_minute` 90 (`api_minute_calls`, `bump_minute_calls`; over it "Map
  search is busy, try again in a minute").
- Driver navigation: Navigate opens Google Maps turn by turn (`travelmode=driving&dir_action=
  navigate`) to the current stop's pin, else its address; after Done or Skip it points to the
  next stop. "All stops in Google Maps" opens the stops still to do in order (the last as the
  destination, at most 9 waypoints; with more, a dialog says how many are left out). Arrival
  nudge (`lib/arrival.ts`, `lib/arrivalRule.ts`, from the background location task): a position
  of 75 m or better within 150 m of the current stop during a task → once per stop "Arrived at
  <stop>? Tap to mark Arrived" (opens the task) and `task_stops.auto_detected_at` (the phone's
  queue; the driver's column grant), shown in task_detail as `auto_detected` ("near the stop
  HH:MM (phone)" beside "arrived HH:MM"). No new native module (`npm run test:nav`).
- The shift nudge's default days are Monday to Friday (settings, `get_driver_settings()`, the
  app's default); the live setting had no row, so the default applies there.

New driver strings (en + si):

| Key | English | Sinhala |
|---|---|---|
| `task.allStops` | All stops in Google Maps | සියලු නැවතුම් Google Maps හි |
| `task.allStopsLeftTitle` | Google Maps takes 10 stops at a time | Google Maps එක වරකට නැවතුම් 10 ක් ගනී |
| `task.allStopsLeftBody` | The first 10 stops are in; {n} more come after them. Open All stops again when you reach the tenth. | පළමු නැවතුම් 10 ඇතුළත් ය; ඉන් පසු තවත් {n} ක් ඇත. දහවැනි නැවතුමට ළඟා වූ විට සියලු නැවතුම් නැවත විවෘත කරන්න. |
| `arrival.title` | Arrived at {stop}? | {stop} වෙත ළඟා වුණාද? |
| `arrival.body` | Tap to mark Arrived | ළඟා විය ලෙස සටහන් කිරීමට තට්ටු කරන්න |

## 9. Part 5: the Google package with free-cap fallbacks

### 9.1 The setting and the rule

- `map_package` = `google | open`. Default: `google` when all three secrets exist, else
  `open`; an admin may force `open`. `get_settings.map_package_effective` is what the server
  uses now.
- Never mixed: under `google` the web app shows Google tiles, Google-snapped lines and Google
  times; under `open` OpenFreeMap tiles, raw lines and OpenRouteService times. The server
  guards it: `driver_route` answers no Google geometry under `open`; the planner never
  returns a Google leg under `open`; `plan.source_label` says which. The Teams artifact
  (drawn map) and the driver app never draw Google geometry: the artifact's transport sends
  `snap: false` and reads only times as numbers; the driver app receives `leave_by` and
  nothing of the plan.

### 9.2 Map

- A third `MapProvider` implementation, `src/map/GoogleMap.tsx` (web only, lazy): the Maps
  JavaScript API loaded through `@googlemaps/js-api-loader` with the key from `/me`,
  `v=weekly`, Advanced Markers for the gliding, turning markers, polylines by speed and
  confidence, the holes dashed, the stops, the playback marker. `MapView` picks Google when
  `me.map.package === "google"` and `register_map_load` answered allowed; otherwise
  MapLibre; the drawn map stays the artifact's.
- Map loads: one `register_map_load` per map initialisation (a page with a map, once per
  mount); at the cap the app switches to the open package for the rest of the Colombo day
  and shows "Google map limit reached for today" once (a toast and a legend line).

### 9.3 Routing

- Chain under `google`: Google Routes `computeRoutes` (TRAFFIC_AWARE, `departureTime` when
  in the future) → ORS → estimate; under `open`: ORS → estimate. A switch to the next
  provider on a quota, auth or timeout error, and at `google_routes_daily_cap` (counted with
  `count_call`). `plan.legs[].source` and the plan panel's source label tell which.
- No cache for Google route results (9.4): every plan with Google legs is a call; the
  700 ms debounce on the form, the cap and the ORS fallback keep it in budget.

### 9.4 Caching, as the terms allow (`docs/google-maps-setup.md` cites them)

Google Maps Platform Service Specific Terms, last modified 10 June 2026
(https://cloud.google.com/maps-platform/terms/maps-service-terms):
- 19.3 Routes API: "Customer may temporarily cache latitude (lat) and longitude (lng)
  values from the Routes API for up to 30 consecutive calendar days, after which Customer
  must delete the cached latitude and longitude values." Durations and distances are not
  named, so they are not cached: `routing.ts` stops writing `route_legs` for Google.
- 17.3 Roads API: the same sentence for latitude and longitude values from the Roads API;
  the snapped line is latitude/longitude only, so `route_matched` rows of `google_roads`
  live 30 days.
- 19.2 and 17.2: "Customer must not use Google Maps Content from the Routes API / Roads API
  in conjunction with a non-Google map" (the "never mixed" rule; the Google Maps Platform
  Terms 3.2.3(e) say the same for Google Maps Content in general).
- "Google ID Caching": place ids may be cached (not used here).
- The Maps JavaScript API section has no caching allowance: tiles are never stored.

### 9.5 Matching

`google_roads` under the google package: snapToRoads, 100 points a call, thinned to 5 m
before sending (built in route quality); run only when someone opens a route (`snap: true`
from the web only), cached per leg 30 days, `google_roads_daily_cap` 150 through
`count_call`; at the cap or on an error the leg is raw and the legend says "raw GPS".

### 9.6 Settings, secrets, setup

- Settings → Fleet: the package (effective and chosen), the three caps, today's counts
  "Map loads 41/300 · Routes 12/150 · Roads 30/150" (from `routing_usage.today`), and which
  secrets exist (booleans).
- Secrets by name: `GOOGLE_MAPS_JS_KEY` (browser key, referrer-restricted to
  `https://fame-fleet.pages.dev/*` and `http://localhost:5173/*`, served by office-api, never
  in the bundle), `GOOGLE_ROUTES_KEY`, `GOOGLE_ROADS_KEY` (server keys, may be one key
  restricted to the two APIs); `ORS_KEY` stays as the fallback.
- `docs/google-maps-setup.md`: the Cloud console steps (project, billing, enable Maps
  JavaScript API + Routes API + Roads API, the two keys and their restrictions, per-day
  quotas 330 / 160 / 160 on the three APIs as a hard stop above our caps, a $1 budget
  alert), the terms quoted above, and how to switch the package off.

## 10. Tests and checks, per part

- **Deno** (`_shared/fleet`): Part 2 `availability_test.ts` (the chip rules from fixed
  sessions and tasks), `requests_edit_test.ts` (the diff → event text, the status machine
  waiting / approved / changed, stale versions); Part 3 `videos_test.ts` (signed URL paths,
  the prune selection); Part 4 `sites_test.ts` (the three presets on small fixtures made from
  the real files — ten rows each, anonymised; the upsert key; the EP 100 m rule;
  `search_places` ranking on a fixture); Part 5 `routing_test.ts` additions (the chain under
  each package, the cap and error fallbacks, no `route_legs` write for Google),
  `caps_test.ts` (count_call arithmetic, midnight Colombo). The existing 94 keep passing.
- **pgTAP** (`supabase/tests/database`, `npx supabase test db`): the files of 3.1 to 3.4.
- **Connector suite** (`scripts/test-mcp-local.py`, both channels): a requester edits a
  waiting and an approved request (the second becomes `changed`), the approver redecides
  keep / change / decline, `update_task` moves the time and the driver's push row says the
  fields, `availability` at a time with one driver on duty and one on a task, `list_fuel`
  with a video entry (a tiny mp4 uploaded through TUS to the local bucket), `import_places`
  with ten rows of each preset and the counts, `search_places` by id, other id and name,
  `register_map_load` to the cap, `routing_usage.today`. `SHAPES=write` once per part.
- **Vitest** (`apps/office`): `tabsFor` per preset, no duplicate in More, drafts
  (save/resume/discard with a fake storage), the stops editor labels and type stability, the
  plan line and its reasons, the availability chips, the request diff text, the fuel list
  states, the import presets' pure parsers (`sitesLogic.ts`, run on the same ten-row
  fixtures), the package switch and cap handling (`mapPackage.ts`).
- **Playwright** (`e2e/office.spec.ts` + `e2e/phone.spec.ts`): a second project `phone`
  (`viewport 412 × 915, isMobile, hasTouch`) runs the tagged `@phone` tests: the tab bar per
  role, a request as a page, the detail as a full screen with the back arrow, pull to
  refresh, the drafts test (type, leave, return, resume; discard), the stops editor on a
  phone; the desktop project runs the full flows: edit → re-approval → redecide; task edit
  and the history card; the Fuel page with a video (the local bucket); the import page with
  the ten-row fixtures; the place search in the stops editor; the Google package forced to
  `open` (no key locally) and the Settings counts. `scripts/test-office-local.sh` runs both
  projects.
- **Driver** (`apps/driver`): typecheck, `test:track`, `test:sync` (the TUS op), `test:data`
  (a fuel log with a video and the status patch), a recording on the OPPO at the Part 3
  checkpoint (duration, size, the file gone after the upload).

## 11. Driver strings (Part 2 and 3; the Sinhala for your check)

| Key | English | Sinhala |
|---|---|---|
| `tabs.fuel` | Fuel | ඉන්ධන |
| `fuel.title` | Log fuel | ඉන්ධන සටහන |
| `fuel.record` | Record video | වීඩියෝව පටිගත කරන්න |
| `fuel.retake` | Retake | නැවත පටිගත කරන්න |
| `fuel.required` | A video of the fill is needed. | ඉන්ධන පිරවීමේ වීඩියෝවක් අවශ්‍යයි. |
| `fuel.checklist.plate` (step 1, the setting's default) | Number plate | අංක තහඩුව |
| `fuel.checklist.zero` (step 2) | Pump display at zero before pumping | පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ |
| `fuel.checklist.pumping` (step 3) | Pumping | පොම්ප කරමින් |
| `fuel.checklist.final` (step 4) | Final pump display: litres and amount | අවසාන පොම්ප තිරය: ලීටර් සහ මුදල |
| `fuel.recordHint` | Show each step in turn and tick it. No sound is recorded. | එක් එක් පියවර පිළිවෙළින් පෙන්වා හරි ලකුණ තබන්න. ශබ්දය පටිගත නොවේ. |
| `fuel.maxLength` | At least 30 s · up to 12 minutes | අවම තත්පර 30 · උපරිම විනාඩි 12 |
| `fuel.step` | Step {n} of {total} | පියවර {n} / {total} |
| `fuel.tickStep` | Done · next step | හරි · ඊළඟ පියවර |
| `fuel.allSteps` | All steps done. Tap Stop when the pump has stopped. | සියලු පියවර අවසන්. පොම්පය නැවතුණු විට නවත්වන්න තට්ටු කරන්න. |
| `fuel.stopAfterSteps` | Stop opens after the last step | අවසාන පියවරෙන් පසු නවත්වන්න විවෘත වේ |
| `fuel.minLength` | At least 30 s | අවම තත්පර 30 |
| `fuel.stepsLeft` | {n} steps still to show | තව පියවර {n} ක් පෙන්විය යුතුයි |
| `fuel.notComplete` | The video is not complete: {reason} | වීඩියෝව සම්පූර්ණ නැත: {reason} |
| `fuel.discardPieces` | Discard | ඉවත දමන්න |
| `fuel.tooShort` | Record at least 30 seconds. | අවම වශයෙන් තත්පර 30 ක් පටිගත කරන්න. |
| `fuel.recorded` | Recorded · {duration} · {size} | පටිගත කළා · {duration} · {size} |
| `fuel.uploading` | Uploading {pct} % · continues when there is signal | උඩුගත වෙමින් {pct} % · සංඥාව ලැබුණු විට ඉදිරියට යයි |
| `fuel.waitingWifi` | Waiting for Wi-Fi | Wi-Fi සඳහා රැඳී සිටී |
| `fuel.uploaded` | Uploaded | උඩුගත කළා |
| `fuel.failed` | Failed · tap to retry | අසාර්ථකයි · නැවත උත්සාහ කිරීමට තට්ටු කරන්න |
| `me.wifiOnly` | Upload videos on Wi-Fi only | වීඩියෝ Wi-Fi හරහා පමණක් උඩුගත කරන්න |
| `shift.title` | At work? | වැඩට ආවද? |
| `shift.body` | Switch On duty when you start. | වැඩ පටන් ගත් විට රාජකාරියේ ඔන් කරන්න. |
| `task.changedTime` | Task changed: new time {time} | කාර්යය වෙනස් විය: නව වේලාව {time} |
| `task.changedVehicle` | Task changed: vehicle {plate} | කාර්යය වෙනස් විය: වාහනය {plate} |

The push texts live in `push-task` (en + si) and are listed again at the Part 2 checkpoint.

The Phone setup card (15 October, ships with Part 4's eas update; menu names stay in English, as the phones show them):

| Key | English | Sinhala |
|---|---|---|
| `phoneSetup.title` | Phone setup | දුරකථන සැකසුම |
| `phoneSetup.yourBrand` | Your {brand} phone | ඔබගේ {brand} දුරකථනය |
| `phoneSetup.yourPhone` | Your phone | ඔබගේ දුරකථනය |
| `phoneSetup.stoppedOnce` | {phone} stopped Fame Driver for {minutes} min ({when}). No trip is recorded while it is stopped. | {phone} Fame Driver විනාඩි {minutes} ක් නවත්වා තැබුවා ({when}). එය නවතා ඇති විට ගමන සටහන් නොවේ. |
| `phoneSetup.stoppedMany` | {phone} stopped Fame Driver {count} times since {when}, {minutes} min in all. No trip is recorded while it is stopped. | {phone} {when} සිට Fame Driver {count} වතාවක් නවත්වා තැබුවා, මුළු විනාඩි {minutes}. එය නවතා ඇති විට ගමන සටහන් නොවේ. |
| `phoneSetup.doOnce` | Change these settings once: | මේ සැකසුම් එක් වරක් වෙනස් කරන්න: |
| `phoneSetup.open` | Open {brand} settings | {brand} සැකසුම් විවෘත කරන්න |
| `phoneSetup.openApp` | Open app settings | යෙදුමේ සැකසුම් විවෘත කරන්න |
| `phoneSetup.done` | Done | කළා |
| `phoneSetup.steps.oppo` 1 | Settings → Apps → Fame Driver → Battery usage: turn on "Allow background activity" and "Allow auto launch". | Settings → Apps → Fame Driver → Battery usage: "Allow background activity" සහ "Allow auto launch" ක්‍රියාත්මක කරන්න. |
| `phoneSetup.steps.oppo` 2 | Settings → Battery → More settings → Optimise battery use: Fame Driver → "Don't optimise". | Settings → Battery → More settings → Optimise battery use: Fame Driver → "Don't optimise" තෝරන්න. |
| `phoneSetup.steps.oppo` 3 | Recent apps: pull Fame Driver down (or tap the lock) so it stays locked. | Recent apps තුළ Fame Driver පහළට අදින්න (හෝ අගුල තට්ටු කරන්න), එවිට එය අගුළු වී තිබේ. |
| `phoneSetup.steps.realme` 1 | Settings → Apps → Fame Driver → Battery usage: turn on "Allow background activity" and "Allow auto launch". | Settings → Apps → Fame Driver → Battery usage: "Allow background activity" සහ "Allow auto launch" ක්‍රියාත්මක කරන්න. |
| `phoneSetup.steps.realme` 2 | Settings → Battery → App battery management: Fame Driver → allow running in the background. | Settings → Battery → App battery management: Fame Driver පසුබිමේ ක්‍රියාත්මක වීමට ඉඩ දෙන්න. |
| `phoneSetup.steps.realme` 3 | Recent apps: pull Fame Driver down (or tap the lock) so it stays locked. | Recent apps තුළ Fame Driver පහළට අදින්න (හෝ අගුල තට්ටු කරන්න), එවිට එය අගුළු වී තිබේ. |
| `phoneSetup.steps.xiaomi` 1 | Settings → Apps → Fame Driver: turn on "Autostart". | Settings → Apps → Fame Driver: "Autostart" ක්‍රියාත්මක කරන්න. |
| `phoneSetup.steps.xiaomi` 2 | Same page → Battery saver: "No restrictions". | එම පිටුවේම → Battery saver: "No restrictions" තෝරන්න. |
| `phoneSetup.steps.xiaomi` 3 | Recent apps: hold Fame Driver and tap the lock. | Recent apps තුළ Fame Driver ඔබාගෙන සිට අගුල තට්ටු කරන්න. |
| `phoneSetup.steps.vivo` 1 | Settings → Battery → Background power consumption management: Fame Driver → "Allow". | Settings → Battery → Background power consumption management: Fame Driver → "Allow" තෝරන්න. |
| `phoneSetup.steps.vivo` 2 | i Manager → App manager → Autostart: turn on Fame Driver. | i Manager → App manager → Autostart: Fame Driver ක්‍රියාත්මක කරන්න. |
| `phoneSetup.steps.vivo` 3 | Recent apps: pull Fame Driver down so it stays locked. | Recent apps තුළ Fame Driver පහළට අදින්න, එවිට එය අගුළු වී තිබේ. |
| `phoneSetup.steps.samsung` 1 | Settings → Apps → Fame Driver → Battery: "Unrestricted". | Settings → Apps → Fame Driver → Battery: "Unrestricted" තෝරන්න. |
| `phoneSetup.steps.samsung` 2 | Settings → Battery → Background usage limits: Fame Driver must not be in "Sleeping apps" or "Deep sleeping apps"; add it to "Never sleeping apps". | Settings → Battery → Background usage limits: Fame Driver "Sleeping apps" හෝ "Deep sleeping apps" තුළ නොතිබිය යුතුයි; එය "Never sleeping apps" වලට එක් කරන්න. |
| `phoneSetup.steps.samsung` 3 | Recent apps: tap the Fame Driver icon → "Keep open". | Recent apps තුළ Fame Driver අයිකනය තට්ටු කර → "Keep open" තෝරන්න. |
| `phoneSetup.steps.other` 1 | Settings → Apps → Fame Driver → Battery: allow background activity, no restrictions. | Settings → Apps → Fame Driver → Battery: පසුබිම් ක්‍රියාකාරිත්වයට ඉඩ දෙන්න, සීමා නැතිව. |
| `phoneSetup.steps.other` 2 | If the phone has "Autostart" or "Auto launch", turn it on for Fame Driver. | දුරකථනයේ "Autostart" හෝ "Auto launch" ඇත්නම්, Fame Driver සඳහා එය ක්‍රියාත්මක කරන්න. |
| `phoneSetup.steps.other` 3 | Recent apps: lock Fame Driver so it stays open. | Recent apps තුළ Fame Driver අගුළු දමන්න, එවිට එය විවෘතව පවතී. |

## 12. Documents at the end (Part 6)

CLAUDE.md (phases, stack, data model, tools, the phone layout, the Google rule), this plan
with "as built" notes per part, `docs/google-maps-setup.md`, README (site data credit:
the operators' lists are the company's own files; GeoNames stays), the Teams artifact file
and the message for the Teams chat, `docs/phase6-test-plan.md` per role on a phone and on a
desktop, the Sinhala list.

## 13. Questions for Sahan, and the answers (14 October 2026)

Answered after the review: (1) a requester is anyone with the `request` permission;
`requested_by` is their office user; the request form gets an optional "On behalf of" name
for a request made for someone else, and the asker stays the one notified. (2) Silent videos;
the driver sees only "Recorded 0:45 · retake"; playback on the office web only. (3) The
checklist defaults (pump display with litres and amount, the vehicle's odometer, the number
plate) live in a fleet setting `fuel_video_checklist` so they can change without an app
update. (4) Part 4 stays in round 3; round 3 does not wait for Google: `map_package` is
`open` until the secrets exist. (5) Shift nudge 08:00 Mon–Sat, only when off duty, a fleet
setting for the time and the days, no per-driver override. (6) Everything else: my default,
listed at the Part 1 checkpoint. Also: Mobitel names get the split rule for the
run-together form (code = the leading capitals up to and including the first digit run, name
= the letters that follow until the next digit, the sector suffix dropped; counts at the
Part 1 checkpoint); the plan preview is computed 1.5 s after the last edit or on a Plan
button, kept only in page memory for the editing session, and every Google call counts
against `google_routes_daily_cap`; the live check at the Part 1 checkpoint is a new task
with two pinned stops and an arrive-by showing "Leave by" on the page.

The questions as asked:

1. Decision 2: is "requester" `view + request` (the staff preset) everywhere in this phase?
2. Decision 5: Mobitel at 4 decimals (4,112 places) or 5 (4,357)?
3. Decisions 7 and 8: silent videos and no in-app playback, or a new native build in this
   phase?
4. The recording checklist items (section 7.1): pump display, odometer, number plate, or
   more?
5. Decision 11: Part 4 in the Part 5 round, or its own round?
6. The shift nudge: `shift_start` 08:00 Mon–Sat as the default, and one nudge only (no
   repeat 30 minutes later)?
