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
| `fuel.checklist.pump` | Pump display: litres and amount | පොම්ප තිරය: ලීටර් සහ මුදල |
| `fuel.checklist.odometer` | Odometer | ඔඩෝමීටරය |
| `fuel.checklist.plate` | Number plate | අංක තහඩුව |
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

## 12. Documents at the end (Part 6)

CLAUDE.md (phases, stack, data model, tools, the phone layout, the Google rule), this plan
with "as built" notes per part, `docs/google-maps-setup.md`, README (site data credit:
the operators' lists are the company's own files; GeoNames stays), the Teams artifact file
and the message for the Teams chat, `docs/phase6-test-plan.md` per role on a phone and on a
desktop, the Sinhala list.

## 13. Questions for Sahan

1. Decision 2: is "requester" `view + request` (the staff preset) everywhere in this phase?
2. Decision 5: Mobitel at 4 decimals (4,112 places) or 5 (4,357)?
3. Decisions 7 and 8: silent videos and no in-app playback, or a new native build in this
   phase?
4. The recording checklist items (section 7.1): pump display, odometer, number plate, or
   more?
5. Decision 11: Part 4 in the Part 5 round, or its own round?
6. The shift nudge: `shift_start` 08:00 Mon–Sat as the default, and one nudge only (no
   repeat 30 minutes later)?
