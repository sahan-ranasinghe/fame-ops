# Phase 7: a driver's day

15 October 2026. Checkpoint 0: the plan only; nothing is built until Sahan's go. Main is
fast-forwarded only after his go at each checkpoint; nothing is deployed without it.

Checkpoint 0 reviewed the same day: the defaults of §32 accepted (4 with a clarification), the two
limits and the rounds accepted, and items 19–28 plus additions to 11 and 17 added (marked "added 15
October"). Every one of the 28 items is planned below. None is left out. Two things that are not built
yet in this repo are called out where they matter: the project-costs screen (Phase C) does not
exist, so item 13's "project costs" part is done in mileage and the task data, ready for Phase C
(§13, Km and costs); and a route is one day, so item 8's control works in one-day mode on the Route
(§8, Where).

## 0. Ground rules for this phase

- One branch per part (`phase7-1`, `phase7-2`, `phase7-2b`, `phase7-3` … `phase7-6`), tests at
  every checkpoint (§31), main fast-forwarded only after the go.
- **No new native modules and no new Android permissions.** §30 checks items 5, 6, 13, 20, 24 and
  28 against what the 1.2.0 build already has. Every driver-app change of Parts 1–5 ships as an EAS
  update to the runtime `1.2.0-gmaps`. The one native build is Part 6 (item 27, at Round B): it
  removes code and adds no module and no permission.
- **Phones on the previous update keep working.** The 1.2.0 phones run their current JS until the
  update lands; 1.1.0 phones (if any are left) never get Phase 7 JS. So every new rule the server
  needs is done by the server itself (triggers, RPCs, jobs), and what old apps still send (a duty
  session with a vehicle, `employees.current_vehicle_id`, stop and task patches) is translated into
  the new model rather than refused (§1).
- Every schema change is a new migration. Everything the phone writes gets its grant and policy,
  tested as the driver role in pgTAP and through the app's real queue (`test:data`).
- Office web: phone first, full-page forms, no dialog that vanishes on an outside click (there are
  none today; none are added).
- Connector: additive only. New fields and tools; nothing removed or renamed; the tool-shapes
  contract only grows. The Teams artifact file is regenerated at the end (Part 5).
- All new UI text in `en.json` and `si.json`; numbers in Latin digits; the new Sinhala in §Sinhala.
- CLAUDE.md is updated where rules change: rule 9 becomes "Location is recorded while on duty".
- **Subagents** (Sahan, 15 October): only in their own worktrees, at most 3 at a time, each with one
  separated piece and the exact files it may edit. The main session owns this plan, every migration,
  the shared types, the i18n files, the connector's tool list and the merging. Subagents run no full
  suite (the main session runs them once after merging), and never deploy, push, set secrets or run
  eas. At every checkpoint a fresh reviewer subagent checks the diff (grants and policies for what the
  phone writes, hard-coded strings, numbers spelled out in Sinhala, behaviour that differs from this
  plan). Each checkpoint says what was delegated and what the reviewer found.

## 1. Clock in / clock out (item 1)

**What exists.** The Today tab has the "On duty" toggle (`setSharing`, `startSharing`,
`stopSharing`); a duty session is a `duty_sessions` row (one open per driver, end_reason
driver/auto/admin, a trigger sets `driver_latest.sharing`); the vehicle is `employees.current_vehicle_id`,
written by the phone (`employee_patch`) from the vehicle screen or at Start task.

**Data.**
- New table `vehicle_assignments`: id, employee_id, vehicle_id, from_at, to_at (null = open), how
  (`clock_in | change | task_start | office`: how it began), ended_how (`change | taken_over |
  clock_out | office | auto`: how it ended), by_name (who did it: the driver, the office person, or
  "system"), task_id (for task_start), created_at. Unique open row per driver and per vehicle
  (partial unique indexes `where to_at is null`): one vehicle, one driver.
- One function does every change: `take_vehicle(employee, vehicle | null, how, at, by)` (security
  definer). It closes the driver's open row, closes the open row of whoever else holds the vehicle
  (ended_how `taken_over`, item 2), opens the new row, and sets `employees.current_vehicle_id` to
  match. **`current_vehicle_id` always equals the open assignment** (a constraint trigger checks it).
- **Times from the phone.** The phone may send late (offline). The later time wins: a take with an
  `at` older than the vehicle's current open row is recorded as a closed row up to that start,
  instead of taking the vehicle back.
- **Triggers, so every app version gives the same result:**
  - A duty session opened with a vehicle → `take_vehicle(how clock_in)`. With no vehicle → the
    driver holds none.
  - A duty session closed → the open row closed (`clock_out`, or `auto` / `office` by end_reason).
  - A driver's own update of `employees.current_vehicle_id` (the old apps' Change vehicle) →
    `take_vehicle(how change)`.
  - A task going `in_progress` on another vehicle → `take_vehicle(how task_start)`. A task started
    while off duty also opens a duty session (the server does it if the phone's session_start is
    late or missing).
- Driver RPCs (security definer, own rows only):
  - `my_vehicle_choices()`: every active vehicle with plate, make/model, seats, in-garage, the photo
    thumbnail path (item 6), who holds it now (first name), my last vehicle and my regular vehicle
    (the driver cannot read `regular_driver_id` from the table, and does not need to).
  - `start_work(vehicle | null, at)`, `change_vehicle(vehicle | null, at)`, `finish_work(at)`.
    Each is idempotent by a client id, so the offline queue can send it twice.
- Setting `duty_cutoff` (HH:MM Colombo, default "21:00"; empty = off).

**Auto clock-out.** A `fleet-jobs` job `duty_cutoff`, run by pg_cron every 15 minutes, closes
every open session older than today's cut-off: end_reason `auto`, assignment `auto`.
- It sends a push "You were clocked out at 21:00 (end of the day)". The new app, on that push or its
  next heartbeat (the heartbeat answer gains `on_duty`), stops location and shows the same text as a
  local notification.
- **Default: a driver with a task in progress is not clocked out;** the next run after that task is
  completed does it.
- **Earlier days close silently** (Sahan, 16 October): a duty period still open from an earlier day is closed at
  its own day's cut-off with end_reason auto and no push (the app shows no notice for it either). "You were
  clocked out" is only for a clock-out on the same day.

**Office clock-out.** Tool `clock_out_driver(driver, reason?)` (assign_tasks or vehicles): end_reason
`admin`, assignment `office`, a push to the driver.

**Driver app (Today).** The toggle goes; duty state takes its place.
- Off duty: a big **Start work** → **Choose today's vehicle** (photo, plate, make/model; the last
  or the regular vehicle preselected; a vehicle someone else holds says "With Kamal now"; "No
  vehicle today" at the bottom) → Start → on duty (location on, the same LocationGate as today).
- On duty: header "On duty since 08:12 · WP CAB-4521 · Office can see you", with **Change vehicle**
  and **Finish work** (asks "Finish work?"; not offered while a task is in progress: "Finish the task
  first").
- Starting a task while off duty clocks the driver in with the task's vehicle (as today, plus the
  assignment).
- Sign out is disabled while on duty: "Finish work first".
- The shift nudge stays; its text becomes "At work? Start work".

**Office.**
- Live lists every active driver with a duty state: **On a task / On duty / Off duty** (replacing
  "Not sharing"), since when, and the vehicle (from the assignment). The signal states (Live / No
  signal / Location off) stay for drivers on duty.
- Chips: All, On a task, On duty, Off duty, Problems (no signal or location off).
- **Drivers → Duty log** (`/drivers/duty`, with the date-range control of item 8; phone: a full
  page). One row per duty session: driver, clock in, clock out with how (driver / auto at cut-off /
  office), the vehicles held in it with times, the tasks, km (GPS from the route builder; odometer
  km of its tasks). Filters: driver, range.

**Connector (additive).**
- `live_drivers` cards gain `duty` (off_duty | on_duty | on_task), `duty_since`, `vehicle_since`. The
  old `state`/`status` stay for the contract; "not_sharing" now reads "Off duty" in `status_text`.
- `availability` rows gain `duty`, `vehicle {reg_no, source: on_duty | regular}`.
- New tools: `duty_log(date? | from?, to?, driver?)`, `clock_out_driver`, and `move_driver_vehicle`
  (item 2).

**CLAUDE.md.** Rule 9 becomes "Location is recorded while on duty (Start work → Finish work;
starting a task clocks in)".

## 2. Vehicle hand-over: one vehicle, one driver (item 2)

**The rule.** `take_vehicle` (1) closes whoever holds the vehicle.
- If A held WP CAB-4521 and B takes it (clock-in choice, Change vehicle, Start task on it, or the
  office moves it), A's row ends `taken_over`, A stays on duty with no vehicle, and A gets a push
  "WP CAB-4521 is now with Kamal · choose your vehicle".
- The new app also shows it as a banner on Today, from A's own last assignment (`ended_how =
  taken_over`, read through the driver's select-own policy on `vehicle_assignments`). Tapping it
  opens the vehicle picker.
- The office sees an info line on Live (on A's card and B's) and in the task detail when a Start
  task took the vehicle: "WP CAB-4521 taken over from Nuwan 08:40".

**Issue `vehicle_conflict`** (warning; `issues.ts`):
- Opens only when A's row ended `taken_over` today and A has a task later today, assigned or
  accepted, on that vehicle. ref_key `vehicle_conflict:<task_id>`; the detail names both drivers.
- Auto-resolves when that task's vehicle changes, the task is cancelled, reassigned or started
  (a start makes A take the vehicle back), or the day ends.

**"The driver's vehicle" means the assignment at that moment.** Readers change:
- `live_drivers`: the task's vehicle, else the open assignment. The open duty session's vehicle and
  the bare column are no longer read.
- `list_drivers`, `availability`, assign defaults (3), the odometer prefill (the task's vehicle, as
  now), mileage per driver (from the assignment history).
- A grep of every `current_vehicle_id` read is part of the Part 1 checkpoint.

**Office.**
- Live → driver card → **Move to vehicle** (a page: the vehicles with who holds each, "No
  vehicle"). It calls `move_driver_vehicle(driver, vehicle | null)` (assign_tasks or vehicles; how
  `office`); the driver gets a push.

**Addition at the Part 2 go (16 October): a vehicle swap during a task (a breakdown), built in Part 2.**
- The driver's Change vehicle stays refused during a task. The office's **Move to vehicle** works during a task
  as a **swap**:
  - It asks for the old vehicle's end odometer and the new vehicle's start odometer. Either the office types
    them, or the driver's phone asks for them (the usual odometer photo flow) and they come from there.
  - The task keeps both **segments** (`task_vehicle_segments`: vehicle, start and end odometer, from, to). The task
    moves to the new vehicle; the new holder is the driver (`take_vehicle` how office) and the old vehicle is free.
  - **Task km = the sum of the segments.** The odometer readings carry the task and their own vehicle, so mileage
    and the allowance count each vehicle's own km; fuel logged after the swap goes to the new vehicle.
  - The task detail shows both segments; the driver's push says "Task changed: vehicle WP KL-1234".
- **"I need another vehicle"**: on the driver's Report a problem during a task, with the category breakdown or
  accident, a tick "I need another vehicle". It opens a **critical** issue (`vehicle_needed`, the task's kind,
  auto-resolved when the task's vehicle changes or the task ends) and pushes the fleet admins (event
  `task.vehicle_needed`, approve and assign_tasks).

## 3. Requests and assignment use the clocked-in vehicle (item 3)

**Request form (requester).** What, when, from, to, pax, tools, note. Never a driver or a vehicle.
`create_request` already takes neither; the form stays so. The type-only booking (approver's "Assign
now" by vehicle type) and the custodian path stay.

**Approve and Assign a task.** The driver is picked first; the vehicle fills itself.
- The vehicle is the driver's open assignment if on duty ("Kamal's vehicle today"), else the regular
  vehicle ("Kamal's regular vehicle"), else empty ("Pick a vehicle"). It can be changed.
- Server: `decide_request`, `book_vehicle`, `create_task` and `redecide_request` accept a driver with
  no vehicle and use that default (additive: `vehicle` becomes optional when `driver` is given).
- The answer says which vehicle was used and why.
- **A different vehicle.** If the admin picks another vehicle, the task records it
  (`tasks.vehicle_choice` jsonb: the default vehicle and why, the chosen vehicle, who changed it,
  when). The task shows "Vehicle changed by Palitha: HiAce instead of Kamal's Axio". The hand-over
  (2) happens at Start task.

**Best match.** A server function `best_drivers(at, until, first_stop?)` ranks the candidates:
- Who counts: drivers on duty, with no overlapping task, free at the needed time.
- Ranking: nearest to the first stop by straight line from the last position (off-duty drivers and
  drivers with no position rank after those with one), then fewest tasks today.
- The top one comes with its reasons ("On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task
  today").
- `availability` gains `best` (the top one) and `rank` on each row.
- The decide page and New task show it with **Use suggestion** (fills driver and vehicle).
- Warnings stay inline and never block (17).

## 4. Requester updates (item 4)

New events, in `EVENTS` and per person in `my_notification_settings`; no row means on, as now:
- `request.on_the_way`: the driver starts the task → "On the way · Kamal · WP CAB-4521 · leave
  08:12".
- `request.arrived`: the first pickup is reached, at the Arrived tap or the nudge's
  `auto_detected_at`, whichever comes first, once → "Arrived at Head office · Kamal".
- `request.driver_changed`: on reassign, or the driver changed by `update_task`/`redecide_request` →
  "Driver changed: Nuwan instead of Kamal".
- `request.cancelled`: the task cancelled for any reason (the request's own cancel already says
  "Request cancelled"; this covers a task cancelled directly).

How they are sent and opened:
- Recipients: the request's `requested_by_employee_id` with an office account. The actor never gets
  their own event.
- Each push opens `/requests/<id>`.
- Where they fire: SQL triggers on `tasks` (status, employee_id) and `task_stops` (arrived_at,
  auto_detected_at), calling `queue_notification`. Old apps set the same columns, so it works for
  every phone.

**Decided, enriched.** The push title stays "Request approved · WP CAB-4521 · Kamal". The page it opens
shows the driver's photo, name, phone (Call = tel:, WhatsApp = wa.me), the plate and the vehicle
photo (5, 6). The push icon is the driver's photo and its image the vehicle's photo where the
browser shows one (Chrome on Windows and Android); both are fresh signed URLs in the payload, loaded
once when the notification is shown.

**Requesters without an account** (the name was typed by an approver):
- New optional `requester_phone` on `create_request` / `book_vehicle` / `update_request` and the
  form, additive. The approver can give it.
- The request page shows **Tell requester** for the current moment (approved / on the way /
  arrived / driver changed / cancelled). It opens `https://wa.me/<phone>?text=<message>` (or
  `wa.me/?text=` without a phone, which lets WhatsApp pick the contact) with the message prefilled
  in English. Nothing is sent automatically.

## 5. Driver profile photo (item 5)

**Data.**
- `photos.kind` gains `profile`.
- `employees.photo_id` (references photos); `employees.photo_updated_at`.
- Driver RPC `set_my_photo(photo_id)`: own photo, kind profile, path in own folder.

**Driver app: "Add your photo".**
- A first-run step after Permissions, shown whenever the signed-in driver has no photo. **Default:
  existing drivers see it once at their next app start after the update**, so the office gets every
  photo.
- Buttons: **Take photo** (front camera, `launchCameraAsync`) and **Choose from gallery**
  (`launchImageLibraryAsync`); both with `allowsEditing` and a 1:1 aspect (the square crop).
- Then `expo-image-manipulator` makes it 512 × 512 JPEG (0.8) and uploads it at once (not queued: the
  step needs it done) to `driver-photos/<employee_id>/profile/<uuid>.jpg`, then the photos row, then
  `set_my_photo`.
- No skip. On failure: the error in words ("No connection: try again"), **Try again**, and the other
  button.
- Me tab: the photo at the top, **Change photo** (the same two choices).

**Office.**
- Drivers list: a photo column. The Driver page and the driver card on Live: the photo.
- Drivers → driver → **Replace photo** (vehicles permission): pick a file, crop to a centred square
  and resize to 512 in the browser (canvas), then upload through a signed upload URL from a new tool
  `photo_upload_url(kind: driver_profile, target)` and `set_driver_photo(username, path)`.
- Shown in Live, Tasks (board cards), Approve (who's available, suggestions), requester updates (4),
  task detail and the Teams artifact. Every tool that names a driver there gains `photo_url` (a
  1-hour signed URL, made in one batch per answer).

## 6. Vehicle photos (item 6)

**Data and storage.**
- New private bucket `vehicle-photos`, 5 MB, image/jpeg.
- `vehicles.photo_path`, `photo_thumb_path`, `photo_updated_at`.
- Office uploads go through signed upload URLs (`photo_upload_url(kind: vehicle, target)`), then
  `set_vehicle_photo(reg_no, path, thumb_path)` (vehicles permission). The browser makes the 1600 px
  and 256 px versions (canvas).
- Drivers may read the bucket (a select policy for the driver role), so the app signs its own URLs.
- Drivers may add a photo only to a vehicle that has none:
  - An insert policy on `<vehicle_id>/…` paths, when that vehicle's `photo_path` is null.
  - Then the RPC `set_vehicle_photo_from_driver(vehicle_id, path, thumb_path)`, which refuses if a
    photo exists by then.

**Where it shows.**
- Small beside the plate everywhere: the Vehicles list, Approve, Live, the board.
- Large in the vehicle detail.
- In the driver app: the vehicle picker and the task card.
- Tools gain `photo_url` / `thumb_url` next to every plate they list (1-hour signed, batched).

**Driver app.** In the picker, a vehicle without a photo has **Add a photo** (camera only).
- The phone makes 1600 and 256 px versions (image-manipulator) and uploads both.
- Queued like other photos, so it works offline.

## 7. Phone setup card off the home screen (item 7)

**Driver app (Part 4).**
- The Today tab no longer shows the card.
- The brand's battery and auto-start steps move to the first-run Permissions flow (once, after the
  battery step, with the same "Open settings" button) and to **Me → Phone setup** (a page).
- The gap notes the phone keeps (`noteGap`) stay for the office's numbers; the watchdog stays.

**Office (Part 1).**
- Live shows "App stopped by phone 3× today" on the driver's card when it happened. The count is
  heartbeat gaps over 3 minutes inside one duty session today, from `driver_heartbeats`; it shows
  once the history has been uploaded, as now.
- New issue kind `app_stopped` (warning). It opens when either happens:
  - 2 or more such stops in a Colombo day;
  - no GPS fix for 30 minutes while on duty, from the last point and the heartbeats.
- Its detail names the phone's brand and model (from `duty_sessions.device_info`) and points to Me →
  Phone setup on the phone. ref_key `app_stopped:<employee>:<day>`. Auto-resolves the next day, or
  when a fix comes back for the no-fix case.
- **What is not an app stop** (Sahan, 16 October): a restart after an update or a new install (the app version or
  the update id differs on the two sides of the gap), a sign-out and Finish work (they end the duty period, and
  gaps are counted only inside one). The breakdown of test.driver's 15 stops on 15 October under this rule is
  shown at checkpoint 2 before the count goes into the issue.

## 8. Dates everywhere: one date-range control (item 8)

**The component.**
- `ui/DateRange.tsx`: Today / Yesterday / This week (Monday–Sunday) / This month / Last month /
  Custom (From–To date inputs).
- Kept in the URL as `?range=today|yesterday|week|month|last_month|custom&from=&to=`, read with
  `useDateRange()` (default per page).
- On the phone the chips wrap and Custom opens two date fields in the page, not a dialog.
- It is built in Part 1 for the Duty log and applied to the other screens in Part 4.

**Tools (additive).**
- `from` / `to` next to the existing `month` / `date` on `mileage_summary`, `list_fuel`, `list_issues`
  and `duty_log`.
- New `list_tasks(from, to, driver?, vehicle?, status?, kind?)` for **task history** (Tasks →
  History).

**Where.**
- **Mileage and Fuel** keep the monthly totals and the allowance column (the month that contains
  To). They also show the chosen range's rows and totals, down to a single day.
- **Issues and Duty log:** the range plus the other filters.
- **Task history:** the range.
- **Route** (the driver page): a route is one day, so the control runs in one-day mode there (Today,
  Yesterday, Custom day). This replaces the current date bar, and the day goes into the URL.

## 9. Issues page (item 9)

**The panel.**
- The issue becomes a child route of the list (`ListWithDetail`): a panel beside the list on a
  desktop, a full page with Back on a phone.
- The panel has an **X** and Esc closes it. Back on the phone does the same.
- After Take, Resolve or Dismiss it closes itself. The list updates in place: the issue's row is
  patched in the store, with no reload flash.

**What each issue shows.**
- Opened (date-time, Colombo).
- Opened by: "System · <rule>" or the person, from `issue_events`.
- Taken by: the assignee.
- Resolved or dismissed at and by.

**The list.** The date-range control (8) on opened_at, a status filter (Open / In progress / Resolved /
Dismissed / All), kind and vehicle as now, newest first. `list_issues` gains `from` / `to`, `sort`,
and `opened_by` / `taken_by` / `resolved_at` on each row (additive).

## 10. Operational screens: no flicker, no resets (item 10)

**What the survey found** (to be confirmed with a recording at the start of Part 2):
- The decide page re-runs `suggest_vehicles` when its inputs change. Until the answer comes back it
  shows "Finding free vehicles…" in place of the groups.
- Each answer picks the first vehicle and driver again, so a choice the admin made is reset.
- Who's available on New task depends on the plan's leave-by, which changes with every plan preview.
  So each preview refetches it.
- List screens call `store.reset` on a filter or day change, so the whole list becomes "Loading"
  until the new answer comes.
- The request page's `useRequest` reads the "reqs" entry, which is refreshed every 60 s. Each tick
  makes a new request object, and effects that depend on it run again.

**One pattern, for every operational screen** (Request, Approve, Assign a task, Who's available,
Live, Task detail):
- A hook `useQuery(key, tool, args, {every, debounce})` on top of the store:
  - The previous answer stays on screen while a new one loads (a small "Updating…" next to the
    title instead of a Loading block).
  - The answer is keyed by the args, so a changed filter never shows another filter's rows.
  - The store compares answers deep-equal and keeps the old object when nothing changed. A refresh
    with the same data re-renders nothing.
- Defaults (the first vehicle, a driver) are filled only while the person has not chosen. A choice
  is never overwritten by a background refresh.
- Forms are keyed by their record's id, never by data that refreshes. Panels are never unmounted
  because data refreshed.
- Realtime bursts are folded into one update per 500 ms (the live map) or 1 s (issues, as now).
- Who's available on New task takes the leave-by rounded to 5 minutes, so a plan that moves by a
  minute does not refetch.

**Tests.**
- Vitest: a refetch keeps the same DOM nodes (node identity) and the typed values, on the decide page
  and on Who's available, with a fake transport answering changed data.
- Playwright: the decide page open for 30 seconds while Realtime and the watches deliver updates.
  Layout shifts are measured with a `PerformanceObserver('layout-shift')`; the summed shift must stay
  under 0.01, and the chosen vehicle and driver must stay chosen.

## 11. "Start from" and stop numbering (item 11)

**Passengers get in here.**
- "Start from" gets a tick **Passengers get in here**. When ticked, the start becomes Stop 1, a
  Pickup at seq 1 marked `is_start` (new column `task_stops.is_start`).
- The planner starts from that stop's point, so there is no leg from "start" to it. The next stop
  the admin adds is Stop 2.
- At Start task the server marks it arrived at `started_at` (a trigger, so it works for every
  phone).
- `create_task` / `plan_task` / `update_task_stops` / `book_vehicle` take `start.passengers: true`.

**A pickup at the start (added 15 October).** For example, cars kept in the office basement.
- Start from defaults to the base place (`base_place_id`, which the live database has set) on Assign
  a task, Approve and the one-step booking. The admin can change it.
- A pickup added or moved to the same place as Start from (the same place, or pins within 50 m) gets
  a line on its row: "Same as the start. Tick 'Passengers get in here' instead", with the button
  **Tick it**. One tap removes that pickup row and ticks the box. The stop's what, note and time at
  the stop (17) move to the start stop.
- `plan_task` and `create_task` give the same sentence as a warning (`pickup_at_start`) when a first
  pickup is at the start without `start.passengers`, so Claude can say it. The server changes
  nothing by itself.

**Labels by order everywhere:** "Stop 1 · Pickup · Head office", "Stop 2 · Drop · Kurunegala site".
- Office: `stopLabel` changes from numbering within the type to the stop's place in the order.
- Driver app: the stop list, the task card, the arrival nudge "Arrived at Stop 2 · Kurunegala site?".
- Connector: stop cards gain `label`; plan legs name "Stop 2" instead of "stop 4".
- Pushes: "Task changed: Stop 2 moved".
- The number is the position among the stops still on the task (removed stops are not counted). The
  seq in the database is not renumbered.

## 12. Permission dependencies (item 12)

- Any of request, approve, assign_tasks, vehicles, issues or users implies **view**.
  `normalisePermissions` adds view whenever another permission is present, so `create_office_user`,
  `update_office_user` and office-api all enforce it, and the stored row always has it.
- The form ticks view by itself. While any other is ticked, the view box is greyed and locked, with
  the hint "Needed by the other permissions".
- Migration: everyone with any permission but no view gets view (the count is reported in the
  checkpoint).
- The Requester preset becomes request + view.
- **View is exactly what a viewer sees today** (Sahan, 15 October): no maintenance, no mileage and
  no attention items. The implied view adds no tool that view does not already give. A test pins
  view's tool list and menu to today's. A requester therefore sees what a viewer sees, and nothing
  more.

## 13. Driver-started trips (item 13)

**Setting.** `driver_personal_trips`:
- `allowed` (the default): Company work preselected, Personal offered.
- `default`: Personal preselected.
- `off`: no Personal choice.
- `ask_first` is reserved: the value is accepted and documented, and behaves as `allowed` until it is
  built.

**Data.**
- `tasks.kind` (`dispatch` | `self`, default dispatch), `tasks.purpose` (`company` | `personal`,
  default company).
- `created_by` "driver: Kamal".
- A self trip has no request and no plan deadline. Its leave-by is its start.

**The server for the phone: a new Edge Function `driver-api`.** It checks the driver's session and
role. Endpoints:
- `POST /places/search {text, session?}`: the same three layers as the office's box, from the same
  code: our places, used before, then Google Places Autocomplete through our gate. Sri Lanka only,
  the same caps, the 30-day rule. openrouteservice when Google refuses.
- `POST /places/google {google_place_id, session?}`: the pin, through the same gate.
- `POST /trips {id, purpose, destination {place_id | google_place_id + name | text | lat,lng},
  note?, vehicle_id?, at}`: creates the task, kind self, one stop, status assigned, created_by the
  driver. Idempotent by the phone's id, so the queue can resend it.
- `POST /trips/:id/stops {id, destination, at}`: a stop added on the way. Self trips only, and only
  while in progress.

**Driver app.**
- Today, on duty, no task in progress: **Start a trip**.
- The trip page: purpose (two big choices, per the setting), destination (the search box; our places
  first, with "Google Maps" under Google results), optional note.
- **Start** creates the trip:
  - Online it goes straight to `driver-api`.
  - Offline, only free text or one of our places can be chosen (no search answers). It is queued as
    `trip_create`, and the normal Start task follows from the local copy.
- From there: the normal flow. Odometer start, navigation, Arrived (18), Complete with odometer and
  fuel.
- **Add a stop** on the task screen of a self trip.

**Office.**
- The board tags **Driver-started** and **Personal**.
- Push to the fleet admins (approve or assign_tasks) for personal trips, event `trip.personal`: "Kamal
  started a personal trip to Kadawatha · WP CAB-4521 · 14:05". Company trips are only tagged, to
  avoid noise. This is a default; say if company trips should push too.
- The task detail lets the admin **attach a project** or **switch company / personal** (tool
  `set_trip_purpose(task_id, purpose, project?)`, assign_tasks).
- The connector and the Teams artifact show `kind` and `purpose`.

**Km and costs (13.6).**
- `mileage_summary` gains `personal_km` per vehicle and driver: the odometer km of personal trips, on
  their own line, left out of the task km charged to jobs.
- There is no project-costs screen yet (Phase C). Personal trips have no task_projects row and carry
  `purpose = personal`, so the Phase C cost model can leave them out of job costs; that rule is
  written into the cost model notes in CLAUDE.md.
- Item 18's rules apply to these trips.

## 14. Finish (item 14, Part 5)

- `docs/phase7-test-plan.md`: phone and office steps per role.
- The Sinhala table (§Sinhala) completed with every new key as built.
- `docs/teams-artifact-update.md` regenerated with the new file, tools and message.
- The deployment log at the end of this document.
- CLAUDE.md and the README as built.
- Part 6's section (the 1.3.0 build, its sizes, the one-time install) is added at checkpoint 6.

## 15. Remove a place (item 15)

**Data.** `places.removed_at`, `removed_by`. Search, lists and pickers already filter `active`; they
now also leave out `removed_at is not null` (`search_places_ranked`, `recent_places` for our places,
`list_places`, `findPlace`). Past tasks keep the name: their stops carry `place_name`.

**Tools.**
- `remove_place(id, confirm?)` (vehicles):
  - If it is the base place, or has a task today or later (stops or start), it answers
    `needs_confirm` with the reason and the tasks: "Head office is the base place; 2 tasks today
    start there".
  - With `confirm: true` it removes the place. Removing the base place also clears the setting, which
    the answer says.
- `restore_place(id)`.
- `list_places(…, removed?: true)` lists only the removed ones.
- The connector's "Nothing can be deleted" instruction becomes "Nothing is deleted: tasks are
  cancelled, drivers and vehicles switched off, places removed and restored".

**Web.**
- The place page gets **Remove** with a second, explicit step on the page itself, the way switching
  off a user works today (no dialog). The reasons are shown above the second button.
- Places → **Removed places** (vehicles permission) with **Restore**.
- The sample "Head office" is not touched: Sahan removes it with the new button.

## 16. Overview blocks open their lists (item 16)

**The tiles become links.**
- Vehicles on the road → Live filtered to on the road.
- Free now → Vehicles filtered to free.
- In garage → Vehicles filtered to garage.
- Tasks today → Tasks for today.
- Requests to approve → Requests waiting.
- Reminders due → a new **Reminders** list: the documents and services due, with the vehicle and the
  date, from `fleet_overview`'s reminders.

**How they open.**
- Desktop: a side panel next to the Overview with an **X** (and Esc). The filter is kept in the URL
  (`/?open=road`), so a reload or a shared link opens it.
- Phone: the full page (`/live?filter=road`, `/vehicles?filter=free`, …). Back returns to Overview.
- The list screens accept these filters in the URL (Live and Vehicles already have chips; they gain
  the URL).
- **Office · Home** counts link the same way.
- The Teams artifact's Overview tiles link where its build has the screen (it has Live, Vehicles,
  Tasks and Requests).

## 17. The plan and the warnings: structured (item 17)

**The plan as a timeline** (`PlanTimeline`, replacing `PlanPanel` on Approve, Assign a task, Task
stops and the task detail):
- **Leave by 07:24** at the top, big.
- One row per stop: planned arrival, the arrive-by deadline if set (red when missed), the place, the
  time there and the planned leave (see "Time at each stop" below).
- Between stops, one row per leg: distance, drive time and its source ("Google traffic",
  "openrouteservice" or "estimate"); then separate lines for the rush-hour factor and "via
  expressway".
- Totals at the bottom: drive time, km, end time.

**The departure field is checked at once** (in the browser, from the latest plan):
- An arrive-by is set and the departure is empty → the recommended departure is filled in.
- The departure is later than leave-by → in red, next to both fields, in item 20's words: "Leaving
  08:00 you reach Kurunegala site at 09:36, 36 min after 09:00. Leave by 07:24." with **Use 07:24**
  and **Move arrive-by to 09:40**.
- The departure is 20 minutes or more earlier → information: "Arrives 25 min early".
- Approve stays possible; warnings never block. The warning is recorded on the task (`tasks.warnings`
  jsonb with the text and who approved past it) and shown in its detail.

**Overlaps as cards.** `assignWarnings` returns structured conflicts beside the text it returns
today:
- Each conflict carries kind (vehicle / driver / garage), the other task (id, title, window), its
  requester (name, phone) and its driver (name, phone).
- The card reads "WP CAB-4521 is on task Team drop 08:00–11:00 for Dilini (driver Kamal)".
- Buttons: **Open that task**, **Call** / **WhatsApp** the requester, **Call** / **WhatsApp** the
  driver, and **Pick another vehicle** / **Pick another driver**, which scrolls to the suggestions
  (3).
- The same for a driver overlap and a vehicle in the garage.

**Connector (additive).** `plan_task` and `task_detail` gain `timeline`: one compact object per item.
- Kinds: `{kind: leave, at}`, `{kind: stop, n, label, place, planned_arrive, planned_leave, arrive_by?,
  dwell_min, dwell_source}`,
  `{kind: leg, from_n, to_n, km, minutes, source, rush_factor?, via_expressway?}`.
- Totals.
- `conflicts[]` with the fields above.

The Teams artifact shows the same timeline and cards.

**Time at each stop (added 15 October).**
- **The field.** Every stop row in Request (From and To), Approve, Assign a task and Edit stops shows
  **Time at this stop**. Quick picks: 5 min, 15 min, 30 min, 1 h, 1 h 30, 2 h, and **Other** (minutes
  or h:mm, up to 12 h). It is always visible, never behind a "more" link.
- **Its first value.**
  - The place's usual time (the last time used at that place), marked "usual here".
  - Otherwise the default by type: pickup 5 min, drop 5 min, visit 1 h.
- **Data.**
  - `places.usual_dwell_min` and `usual_dwell_at`, set by a trigger whenever a stop on that place is
    saved.
  - `task_stops.dwell_source` (`chosen | place | default`) records where the value came from.
  - The setting `dwell_min` keeps the defaults. The live row today says pickup.people 10,
    pickup.goods 15, drop.people 5, drop.goods 15, visit 60, documents 10, default 10. The Round A
    migration sets pickup 5, drop 5, visit 60; checkpoint 2 shows the row before and after.
- **The requester fills it in on the request.**
  - New `vehicle_requests.from_dwell_min` and `to_dwell_min`, taken by `create_request`,
    `update_request` and `book_vehicle` (additive).
  - They are copied to the pickup and the drop when the request is approved; the admin can change
    them there.
- **The plan uses it exactly.**
  - Leave a stop = arrival + time there; the next leg starts from that moment.
  - Leave-by and every arrival check (this item and item 20) include it.
  - No waiting is added for an early arrival. That shows as "Arrives N min early" (§32 default 6).
- **Shown as:**
  - The timeline row: "Stop 2 · Drop · Kurunegala site · arrive 09:00 · 1 h 30 · leave 10:30".
  - The map label (20): "2 · Kurunegala site · 09:00–10:30".
  - The driver app's stop list and task card: "09:00–10:30 at Kurunegala site".
- **Connector (additive).**
  - `plan_task`, `create_task` and `update_task_stops` already take `dwell_min` per stop. Their
    answers gain `planned_leave` and `dwell_source` per stop.
  - `task_detail` stops gain `planned {arrive, leave, minutes}` next to `actual {arrived, done,
    minutes}` (arrived_at to done_at).

## 18. A task can't be finished before it has been driven (item 18)

**Arrived needs the phone near the stop.** Driver app, using the phone's own current position:
- **Within 300 m, accuracy 100 m or better:** Arrived works.
- **Farther:** the button reads "You are 42 km from Kurunegala site", with **I'm here, the pin is
  wrong**. That marks the stop arrived with `arrival_flag = 'override'` and the distance.
- **No fix:** "Waiting for GPS…". After 60 seconds the same override appears (`arrival_flag =
  'no_gps'`).
- **A stop with no pin:** Arrived is allowed, flagged `no_pin`.
- New `task_stops` columns: `arrival_flag`, `arrival_distance_m`, with driver update grants.
- An `override` or `no_gps` flag opens issue `arrival_override` (warning, ref per stop), naming the
  stop, the distance, and where the phone was (the arrival point of 5b).

**The other stop rules.**
- **Done needs Arrived first:** the button only appears after Arrived. It is enforced by the server
  too, by a trigger for the new app's writes; old apps' writes pass and are flagged.
- **Skip needs a reason** (as now). The office is told: a web push to the task's assigners (event
  `task.stop_skipped`) and a line in the task history.
- **Complete task needs the last stop Done or Skipped.** Stops before it that are still open become
  "skipped · not visited" at Complete, as now.

**At Complete, the odometer is checked against the plan.**
- If end − start is under 70 % of the planned km, or the task took under 50 % of the planned drive
  time, the app asks "Check the reading: the trip is 95 km, the odometer says 3 km". The driver can
  **Correct it** (back to the reading) or **Go on**.
- The server makes the same check by trigger at completion, so every app version is covered. It sets
  `tasks.finish_flag = {kind: completed_early, odometer_km, planned_km, minutes, planned_minutes}` and
  opens issue `completed_early` (warning) with the numbers.
- Task detail, `task_board` cards and the Teams artifact show the flag.
- Trips without a plan (self trips) skip the plan check. They still need the stop rules.

**Reopen.** `reopen_task(task_id, reason)` (assign_tasks) works the same Colombo day:
- It sets the status back to in_progress, clears completed_at and the end odometer, and keeps them in
  the task history.
- The history records it: `task_assignment_events.action` gains `reopened`.
- The driver gets a push "Task reopened".
- It is refused if the driver already has another task in progress.

Driver-started trips (13) follow the same rules.

## 19. A task that needs a driver can't be missed (item 19, added 15 October)

**When a task needs a driver.**
- The driver declines it (`decline_task`, as now), or the accept window passes without an answer.
- **The accept window:** 15 min after the task was sent, or 30 min before its start, whichever comes
  first.
  - Settings → Fleet: `accept_within_min` and `accept_before_leave_min`. The live rows say 30 and 60
    today; the Round A migration sets 15 and 30.
  - New `accept_reminder_min` (5): the driver gets one push 5 minutes after the task is sent, "Accept
    or decline: Team drop · Kurunegala 09:00". The reminder at the window's end goes.
- New `tasks.needs_driver_since` and `needs_driver_reason` (`declined | not_accepted`). Both cases
  set them; reassign, accept or cancel clear them.
- A not-accepted task stays with its driver. Accepting late clears it.
- It is done in SQL (`decline_task`, the minute job `queue_accept_reminders`), so every phone version
  gives the same result.

**Who is told, at once.** A web push to:
- every fleet admin (approve or assign_tasks, as now);
- the person who assigned the task (new `tasks.assigned_by_employee_id`, set by the runner from the
  signed-in person or personal key; empty with the shared key);
- the requester (the request's `requested_by_employee_id`, when they have an office account).

One push per person, never to the person who acted.
- Text: "Kamal declined 'Team drop · Kurunegala' 09:00 · Vehicle problem · needs a driver", or "Kamal
  hasn't accepted 'Team drop · Kurunegala' 09:00 · needs a driver".
- For the admins and the assigner it opens the task's change page (`/tasks/<id>/edit?driver=1`): the
  reason at the top, the driver field first, and the best match (3) with **Use suggestion**.
- For the requester it opens `/requests/<id>`.

**Where it shows.**
- **Overview:** a red **Needs a driver** block at the top while the count is above 0.
  - The list: start time, title, who declined or didn't accept, the reason, and the time to the start
    ("in 42 min", "18 min late").
  - It opens like item 16's tiles (`/tasks?filter=needs_driver`).
- **Every Tasks page** (board, detail, history, the forms): a red banner "2 tasks need a driver ·
  Show" while any does. It reads the issues store, which Realtime keeps current (the bell's
  channel), so it appears within a second.
- **Live:** the driver's row says "declined the 09:00 task" (or "hasn't accepted the 09:00 task")
  while that task still needs a driver.

**The issue.** The kinds `declined` and `not_accepted` already exist.
- They become **critical**, one per task, auto-resolved on reassign, accept or cancel.
- New `issue_events` action `notified`: who was told and when. It is written when the pushes are
  queued and shown in the issue's history.
- The critical `issue.opened` push is not sent for these two kinds: the wider push above has already
  gone out, so nobody gets two.

**Connector (additive).**
- `task_board` gains `needs_driver[]`, first in its answer. It covers today and later, not only the
  board's date: task, start, title, driver, kind, reason, note, since, minutes to start, best match.
- `fleet_overview` gains `needs_driver {count, tasks[]}`.
- `live_drivers` cards gain `task_note` ("declined the 09:00 task").
- The Teams artifact lists Needs a driver first on Overview and Tasks.

## 20. The plan on the map (item 20, added 15 October)

**Web: a map beside the timeline.** `PlanMap`, on Approve, Assign a task, Edit stops and the task
detail. On a desktop it sits beside the timeline (17); on a phone it is a fixed-height block above
the timeline.
- **Pins:** numbered, Start first (or Stop 1 when passengers get in there), then every stop.
  - Each is labelled "2 · Kurunegala site · 09:00–10:30" (arrive and leave, 17).
  - A missed arrive-by is red.
- **The line:** Google's route line between them, from the Routes API polyline of **the same call as
  the road times**.
  - The field mask gains `routes.legs.polyline.encodedPolyline`. There is no extra call.
  - The polyline is a basic field, so the SKU stays Compute Routes Pro. This is checked against
    Google's field list at checkpoint 2b.
- **On screen:** the map fits the route. Tapping a pin highlights its row in the timeline, and a row
  highlights its pin.
- **Re-planning:** a change to a stop, a time or the departure re-plans and redraws 1.5 s after the
  last edit, as now. That is one Routes call per settled change, counted as today.
- **Storage:**
  - The polyline is kept with the plan (`plan_json.legs[].line`, `plan_json.line_fetched_at`).
  - The nightly `google_content` job removes it 30 days after it was fetched. The pins and times
    stay.
  - `plan_task` and `task_detail` return the line only when asked (`with_line: true`, which the web
    passes), so Claude's answers stay small.
- **Where Google's map is not available** (the open package, a refused map load, the Teams
  artifact): the pins only, with thin straight connectors marked "not the road". Google stops are
  listed, not drawn (rule 10).

**Wording (on top of 17).** When the departure is set first, and an arrive-by set later can't be met
with Google's traffic-aware time, red text appears next to both fields:
- "Leaving 08:00 you reach Kurunegala site at 09:36, 36 min after 09:00. Leave by 07:24."
- The buttons **Use 07:24** and, second, **Move arrive-by to 09:40** (the arrival rounded up to 5
  minutes).
- The same for the last stop and for "back by": "Leaving 08:00 you are back at 18:20, 20 min after
  18:00. Leave by 07:40."

**Driver app: the task map.** Today it draws one straight line from the phone to the destination.
- **The new map:** every stop numbered with its arrive-by (or planned) time, the planned Google route
  line from the stored polyline, and the driver's own position.
  - It fits the route on open.
  - It follows the office's changes (the task is fetched again on Realtime, as now).
  - Drivers already read their own tasks' `plan_json` (no column limit on `tasks`).
- **"Distance left"** comes from the plan's road distance: the current leg's road km in proportion to
  the straight distance still to go to the next stop, plus the legs after it. The straight-line
  figure and its "straight line" note go.
- **A task without a stored line** (the open package, the estimate, an old plan): stops only.
- **Phones on the old map** (the OpenFreeMap builds): stops only, never Google's line (rule 10).

## 21. Gap markers instead of labels (item 21, added 15 October)

- **The labels go.** Today the gaps carry black text labels ("App not running · 42 min · estimated ·
  21.3 km road") on all three maps:
  - the MapLibre symbol layers `holes-label` and `estimated-label`;
  - the Google map's overlays;
  - the drawn map's text.

  They are removed everywhere.
- **In their place:** one small grey marker at each gap's midpoint (the middle of the dashed line),
  with an icon by kind:
  - no app: `no_data` ("App not running");
  - no GPS: `no_gps` ("Stopped · no GPS signal");
  - no signal: a stretch recorded but uploaded late ("Offline here · uploaded 14:20"). Its line is
    drawn as usual; the marker shows where it was.
- **The text** shows on hover (desktop) or tap (phone), in a small card next to the marker.
- **A Gaps list beside the map:** in the timeline column on the driver page, under a task's route,
  and in the Live card of the shown route.
  - Each row: time, type, duration, estimated km by road.
  - A row zooms the map to the gap and opens its card.
- The dashed estimated lines and the dashed holes stay. No map has permanent text.
- The same on Live, the driver page, task routes and playback.

## 22. Playback on a constant time scale (item 22, added 15 October)

Today `usePlayback` steps the marker from point to point: ×10, ×60 or ×300, a long gap waited out in
at most 1.5 s, nothing interpolated. It is rewritten:
- **The clock** runs in recorded time at the chosen speed: **1×, 5×, 20×, 60×** (on animation
  frames).
- **The marker's position at time t:**
  - between two recorded points, interpolated along the drawn path (the snapped line where there is
    one, 26);
  - across a gap, along the dashed estimated line (or the straight dashed hole when there is none),
    spread over the gap's whole duration. The marker is hollow while estimated.
  - at a stop, still.
- **Heading and continuity:** the marker turns to the path's direction. It never jumps: the position
  is continuous in time.
- **Controls:** a time scrubber (drag to any moment), and the clock showing the recorded time
  ("14:32:05", plus "estimated" while in a gap).
- **Tested with test.driver2's route of 15 October:**
  - Vitest on the saved answer: the position is continuous across every gap and stop, and a full
    pass at 60× takes the day's span ÷ 60.
  - Playwright plays it at 60×.

## 23. Map gestures (item 23, added 15 October)

- Every Google map uses `gestureHandling: "greedy"`, so "Use ctrl + scroll to zoom" and "Use two
  fingers to move the map" never show. Today it is `cooperative` in `googleMaps.ts` and in
  `GooglePin`'s edit mode.
- MapLibre's cooperative gestures stay off (they are not set today).
- Maps inside forms (the pin confirm, the plan map) are fixed-height blocks, so the rest of the form
  still scrolls the page.
- The app's maps already move with one finger.

## 24. Compass (item 24, added 15 October)

- Whenever a map is rotated or tilted, a compass button appears. One tap turns the map north-up with
  no tilt.
- **Web:** the button sits in the control cluster with the zoom buttons (25).
  - MapLibre: shown when the bearing or the pitch is not 0. The built-in compass is off today and
    stays off.
  - Google: shown when the heading or the tilt is not 0 (`heading_changed`, `tilt_changed`). Our
    Google map has no map id, so it is a raster map that can't be rotated by hand. In practice the
    button appears there only on the 45° imagery.
- **App:** on the task map (Google and the old map) and the trip map (13), our own button over the
  map when the camera's heading or pitch is not 0.
  - react-native-maps: `animateCamera({heading: 0, pitch: 0})`.
  - MapLibre: the camera's reset.
  - JS only.

## 25. Live: one control cluster (item 25, added 15 October)

- The big "Show today's trails" control becomes a small icon button, the size of the zoom buttons. It
  has a tooltip ("Today's trails") and an active state (filled when on).
- All map controls are the same size (40 px) and sit in one cluster: zoom in, zoom out, the compass
  (when needed), trails, fit.
- The cluster sits on the right edge, centred vertically on the phone, so it covers no corner. The
  corners stay with Google's logo, the legend and the attribution.
- One component serves all three maps. Google's own zoom control is turned off in favour of it.

## 26. Trails on the roads: Google snap to roads, bounded (item 26, added 15 October)

**The licence note is corrected** in `docs/google-maps-setup.md` and in the settings comment.
- The Roads API overview says "The Speed Limit service is available to all customers with an Asset
  Tracking license".
- Snap to roads has no such condition. It is on the standard pay-as-you-go plan (Roads – Route
  Traveled, 5,000 free a month).
- We call only `snapToRoads`, never Speed Limits.

**Caps.** `google_caps.roads` becomes 200 a day (Sahan, 15 October) and 4,750 a month (95 % of
5,000).
- 200 × 31 = 6,200 is above the month, so in a heavy month the monthly ceiling stops it first.
- Both fail closed, counted before each call (`google_take`, as built).
- The half day between our month and Google's (Pacific time) stays covered: 4,750 + 200 = 4,950,
  under 5,000.
- The counter is the Settings → Fleet Map package card (built).
- The live database has no `google_caps` row, so the new default is what applies.

**What is snapped.** Recorded driving legs only (the route builder's driving rows). Gaps stay dashed
estimates and are never sent.
- **When:** a person opens a route: the driver page, a task's route, playback, or the selected
  driver's route on Live. Not the all-driver trails, and not Claude (snapping stays web only).
- **Default:** under the google package it is on. A toggle, "Recorded points", shows the raw line.
- **How:** each leg is thinned to about one point per 50 m and sent in requests of 100 points
  (`interpolate=true`, one point of overlap between requests). The snapped line is drawn. Km stay
  from the odometer, and the GPS km from the raw points.
- **Cache:** per leg of the day (`route_matched`, as built), 30 days, then back to the raw trail (the
  existing prune). A task's route or a playback window reuses the day's legs, clipped to it, so the
  same road is never paid for twice.
- **Incremental on Live:** only the points since the last snapped one.
  - A new request is sent once 100 new thinned points have collected (about 5 km), or when the leg
    ends. Until then the tail since the last snap is drawn raw.
  - So watching a driver costs no more than opening the day later. The current rule, which matches a
    growing leg again every 2 minutes, goes.
- **At a cap:** the raw line, with "Snap to roads limit reached for today" (built).

**Expected calls, from live data.** 8–15 October 2026. A driving leg is 0.5 km or more, split at a
5-minute stand. One call per started 5 km of a leg.

| Driver | Days | km a day | Legs a day | Calls a day |
|---|---|---|---|---|
| test.driver | 8, 9, 12, 13, 14, 15 Oct | 1.9–22.5 | 1–5 | 7, 2, 3, 1, 5, 2 |
| test.driver2 | 13, 14, 15 Oct | 40.8–48.8 | 3–9 | 13, 14, 10 |

- A call is spent only the first time a leg is opened. Later views are free for 30 days.
- 12 drivers driving like test.driver2, every day opened once: about 12 × 12 = 145 calls a day,
  under the 200 cap.
- A full field day of 150–200 km in about 8 legs is about 38–48 calls. The cap covers 4–5 such days
  opened in full; the rest of the day shows the raw line.
- The month (4,750, about 215 a working day of 22) binds only after a run of days near 200.

## 27. App size: the native build (item 27, Part 6, at Round B; added 15 October)

**Measured now.** The 1.2.0 APK (build ddc92043), from its zip entries (compressed sizes). apkanalyzer
gives the per-class detail in Part 6.

| Part of the APK | MB |
|---|---|
| Native libraries, armeabi-v7a (all) | 28.6 |
| Native libraries, arm64-v8a: MapLibre (`libmaplibre.so`) | 10.8 |
| Native libraries, arm64-v8a: ML Kit barcode (`libbarhopper_v3.so`) | 4.9 |
| Native libraries, arm64-v8a: the rest (React Native 7.0, app modules 3.1, Hermes 2.5, SQLite 1.8, Reanimated 1.5, …) | 25.1 |
| Dex (4 files) | 9.7 |
| JS bundle | 3.8 |
| Fonts (14 files) | 1.4 |
| BouncyCastle tables (`org/bouncycastle/pqc/…/picnic`) | 1.2 |
| ML Kit barcode models (assets) | 0.9 |
| Other resources and `resources.arsc` | 1.7 |
| Other | 0.2 |
| **Total (the file is 89.1 MB)** | **88.4** |

What the measurement shows:
- **Libraries uncompressed.** The native libraries are stored uncompressed (Android loads them
  straight from the APK), so they count at full size.
- **Some of item 27 is already asked for.** The `preview` profile is a release build of arm64-v8a and
  armeabi-v7a only, and it asks for R8 and resource shrinking
  (`-Pandroid.enableMinifyInReleaseBuilds=true -Pandroid.enableShrinkResourcesInReleaseBuilds=true`).
  Yet the dex still holds expo-dev-launcher and dev-menu classes. Whether R8 really ran is the first
  thing Part 6 checks.
- **The barcode library is there** although expo-camera has `barcodeScannerEnabled: false`. On
  Android it comes with expo-camera's ML Kit dependency.
- **The phones we know** (device tokens) are an OPPO CPH2119 and a Samsung SM-A226B, both arm64.

**The `drivers` build profile.**
- A release build on the `preview` update channel, runtime `1.3.0-gmaps`.
- `development` keeps the dev client for live-reload work. `preview` stays as the 1.2.0 profile.

| Change | Expected saving on the arm64 APK (MB) |
|---|---|
| arm64-v8a only. A ready `drivers-32` profile (armeabi-v7a) is kept in eas.json, built only when Sahan asks | 28.6 |
| MapLibre out of the Google-map build: excluded from autolinking when `GOOGLE_ANDROID_MAPS=on`, and the OpenFreeMap map loaded only when the switch is off. A switch-off build keeps it, so the no-Google fallback is not lost | 10.8, plus its dex |
| expo-dev-client out of the drivers build (dev launcher and dev menu) | dex, measured |
| R8 and resource shrinking really on, with keep rules tested for ML Kit text recognition, react-native-maps, the camera and the fuel video, expo-updates, notifications and SQLite | part of the 9.7 dex |
| ML Kit barcode out (a Gradle exclude of `com.google.mlkit:barcode-scanning`; the scanner is never called), tested with the fuel video | 5.8 |
| Fonts cut to the weights in use | up to 1.4 |
| BouncyCastle post-quantum tables (a packaging exclude, if nothing loads them) | 1.2 |

- **Expected result:** an arm64 APK of about 35 MB, under the 40 MB target, without compressing the
  native libraries.
  - If it is still over, the native libraries go compressed (`useLegacyPackaging`): a smaller
    download, but the libraries are extracted on install.
  - Each change is measured on its own. The report gives before and after, and what each change
    saved.
- **A 32-bit phone.** The test plan gets a line on how to tell: installing the arm64 APK ends with
  "App not installed" on a 32-bit Android (typically an Android Go phone); Settings → About phone
  or a CPU-info app shows armeabi-v7a only. Then Sahan asks for a `drivers-32` build.
- **Nothing lost.** Every 1.2.0 function is checked on the OPPO with 1.3.0: Today, the task map, the
  fuel video, odometer OCR, photos, push and sounds, background location, and updates.
- **At Round B:**
  - First the last `1.2.0-gmaps` update, from the commit before Part 6 (as d63c838 was for 1.1.0).
  - Then the 1.3.0 build. Phones install it once; later updates target 1.3.0 only.

## 28. Vehicle documents (item 28, Part 3, added 15 October)

**Data and storage.**
- New table `vehicle_documents`. Columns:
  - id, vehicle_id;
  - kind (`revenue_licence | insurance | emission | registration | lease | other`), name (for
    Other);
  - path, content_type, bytes;
  - expiry (a date, where one applies);
  - uploaded_by (employee), uploaded_at;
  - removed_at, removed_by, removed_reason (`removed | replaced`).
- New private bucket `vehicle-docs`: 10 MB a file; image/jpeg, image/png or application/pdf; path
  `<vehicle_id>/<kind>/<uuid>.<ext>`.
- The current document of a kind is the newest one not removed.
- **One expiry date, two ways in.**
  - A trigger writes the current document's expiry to `vehicles.licence_expiry`, `insurance_expiry`
    or `emission_expiry` (and to `rent_until` for the rent or lease agreement). The chips, the
    14-day reminders and the `document` and `rental` issues keep working as now.
  - `update_vehicle` setting one of those dates (from Claude or the old artifact) also updates the
    current document's expiry.
- **What an active vehicle should have:** revenue licence, insurance, emission test, registration
  (CR), and the rent or lease agreement for a rented one (a rental company set). Other is never
  required.
- **A missing one:**
  - a grey "no document" chip on the vehicle;
  - in the reminders (fleet_overview and item 16's Reminders list), one row per vehicle: "3
    documents missing: insurance, emission test, CR".

**Office web** (the vehicles permission): the Register vehicle page and the vehicle detail get a
**Documents** section, one row per kind.
- **Each row:** the file's name and type, the expiry where one applies, "Uploaded by Palitha 14 Oct
  10:05", and **View** (a 1-hour signed URL, opened in a new tab), **Replace** and **Remove**.
- **Upload:**
  - A photo or a PDF, up to 10 MB. Photos are resized in the browser (canvas) to 2000 px on the long
    side, JPEG 0.85, so the text stays readable.
  - The file goes through a signed upload URL from `vehicle_document_upload_url(reg_no, kind,
    content_type, bytes)`, then `save_vehicle_document(reg_no, kind, path, expiry?, name?)`, as for
    photos (5, 6).
  - On Register vehicle the section opens after the first save, because the path needs the vehicle's
    id.
- **Remove and Replace:**
  - Remove is soft: a second step on the page itself, no dialog.
  - **Removed documents** lists them with **Restore**.
  - Replace keeps the old file as removed (reason "replaced"), so it is in that list too. Nothing is
    deleted.

**Connector (additive).**
- `list_vehicles` rows gain `documents [{kind, expiry, has_file}]` and `documents_missing`.
- New `vehicle_documents(reg_no, removed?)` (vehicles): the documents with 1-hour links.
- New `remove_vehicle_document(id)` and `restore_vehicle_document(id)` (vehicles).
- Uploads only from the web: `vehicle_document_upload_url` and `save_vehicle_document` are web-only
  tools, not listed on office-mcp (like `register_map_load`). No files go through chat.

**Driver app (read-only).**
- **Me → my vehicle → Documents** shows the current revenue licence, insurance and emission test of
  the vehicle the driver holds (the open assignment, 1).
  - Each shows its expiry ("Valid until 12 Mar 2027"), amber or red as on the chips.
  - **Open** uses a 1-hour signed link: a photo opens in the app, a PDF in the phone's browser.
  - For roadside checks.
- **Policy.** A driver reads `vehicle_documents` rows and `vehicle-docs` objects only for the vehicle
  of their open assignment, and only those three kinds (a security-definer helper
  `my_held_vehicle()`). Drivers write nothing here. It is tested as the driver role in pgTAP.
- **Offline:** without a connection, "Needs a connection to open" (§32 default 13).

## 29. Parts, order and rounds

Sahan's split, with these changes:
- The date-range control (8) is built in Part 1 (the Duty log needs it) and applied everywhere else in
  Part 4.
- Items 19–28 are placed as Sahan set them on 15 October: 19 in Part 2, a new Part 2b for the maps
  (20–26) before Round A, 28 in Part 3, and 27 as Part 6 (the native build at Round B).

| Part | Branch | Items | Why here |
|---|---|---|---|
| 1 | `phase7-1` | 1, 2, 7 (office), 18, the date-range control | the driver's day and its data model first; everything else reads the assignment |
| 2 | `phase7-2` | 3, 10, 11 (with the pickup at the start), 12, 17 (with the time at each stop), 19; the mid-task vehicle swap (§2 addition) | the dispatch screens, rebuilt once on the no-flicker pattern; needs-a-driver uses the best match (3) |
| 2b | `phase7-2b` | 20, 21, 22, 23, 24, 25, 26 | the maps: the plan map draws Part 2's timeline; the route views, playback and controls change together |
| 3 | `phase7-3` | 4, 5, 6, 28 | photos, documents and requester updates use the screens of Part 2 and the signed-upload tools together |
| 4 | `phase7-4` | 7 (app), 8 (everywhere), 9, 13, 15, 16 | the trips build on 11 and 18; the rest is the office's reading screens |
| 5 | `phase7-5` | 14 | docs, the test plan, the Sinhala list, the Teams artifact file |
| 6 | `phase7-6` | 27 | the native build; Part 5's docs get its section at checkpoint 6 |

**Rounds: two.**
- **Round A** comes after Part 2b (go at checkpoint 2b). It contains:
  - the migrations of Parts 1–2b;
  - office-mcp, office-api, fleet-jobs and push-task (with the Routes polyline and the Roads caps);
  - the web;
  - an EAS update for `1.2.0-gmaps`.

  Why then:
  - Parts 1–2b change how a driver works all day (clock in, hand-over, the arrival and finish rules),
    the dispatch screens and the maps. That should meet the field before photos and trips are built
    on top of it.
  - The flicker fix (10) is wanted now.
- **Round B** comes after Part 6. It contains:
  - Parts 3–4's migrations;
  - the functions, including the new `driver-api`;
  - the web;
  - the last `1.2.0-gmaps` update (from Part 5's commit);
  - the 1.3.0 build (from Part 6's), installed once on every phone;
  - the Teams artifact file.
- **Safe order in each round:**
  1. `npx supabase secrets list` (names only).
  2. `db push` (additive tables and columns; triggers that translate old apps' writes).
  3. Functions.
  4. Web.
  5. The EAS update, last. Phones on the previous update keep working against the new server, and
     the new app finds the server ready.
  6. Round B only: the 1.3.0 build, after the 1.2.0 update.
- No 1.1.0 update is needed: those phones are told to install 1.2.0 (at Round B, 1.3.0).

## 30. Native check: items 5, 6, 13, 20, 24, 28 work in 1.2.0 (no native change before Part 6)

- **5, the profile photo.**
  - Camera and gallery: `expo-image-picker` is in the 1.2.0 build (`launchCameraAsync` is used today;
    `launchImageLibraryAsync` and `allowsEditing` with an aspect are part of the same module and its
    Android activities).
  - Gallery permission: on Android 13+ the system photo picker needs no permission; below that,
    `READ_EXTERNAL_STORAGE` is already declared in app.json.
  - Resize and crop: `expo-image-manipulator` (in the build). Upload: fetch to Storage (as today).
- **6, vehicle photos.** The same camera and manipulator; display with React Native's `Image` and
  signed URLs.
- **13, driver trips.** The search is HTTP to `driver-api`. The map is the task map (react-native-maps
  in `1.2.0-gmaps` builds, MapLibre otherwise). Navigation hands off to Google Maps as now.
- **20, the plan on the task map.** react-native-maps' `Polyline` and `Marker` are in the build (the
  task map uses both today); the polyline is decoded in JS.
- **24, the compass.** The camera APIs of react-native-maps (`getCamera`, `animateCamera`) and of
  MapLibre are in the build.
- **28, the documents on the phone.** React Native's `Image` shows a photo; `Linking` opens a PDF's
  signed link in the phone's browser.
- **Plus:** push handling (expo-notifications), the local notification for the auto clock-out, and
  reading the position for the 300 m rule (expo-location) are all in the build.
- **Part 6 (27)** is the one native build, ordered by Sahan: it removes MapLibre (from the Google-map
  build), the dev client, the barcode scanner and unused files, and adds no module and no Android
  permission.
- **To verify on the OPPO at checkpoint 3:** the gallery picker and the crop screen open and return a
  square, on the 1.2.0 build, before anything else is built on them. If they don't, I stop and say so.

## 31. Tests per part

Every checkpoint runs the whole set, each on a fresh database where it needs one:
- Deno (each folder's `deno fmt --check`, `deno check`, `deno test`).
- pgTAP, a new file per part: `phase7_duty.test.sql`, `phase7_dispatch.test.sql` (with needs a
  driver: decline, the window, accept late, reassign), `phase7_maps.test.sql` (the line's 30-day
  removal, the Roads caps), `phase7_photos.test.sql` (with the documents: a driver reads only the
  held vehicle's three kinds, rows and objects), `phase7_trips.test.sql`. Each covers the driver
  role's writes (grants, policies, RPCs) and the old-app translations (a duty session with a vehicle
  opens an assignment; a bare `current_vehicle_id` update becomes a change).
- The connector suite, both channels, with new sections; the tool-shapes contract checked for
  additions only.
- Vitest:
  - the new logic, the no-flicker node-identity test, the date range, the timeline, the permission
    lock;
  - the time at each stop in the plan;
  - the departure wording;
  - the plan map's pins and labels;
  - the gap markers (no text on any map);
  - playback continuity on test.driver2's 15 October route;
  - the compass;
  - the snap thinning and the incremental rule.
- Playwright:
  - the duty log; the approve page's 30-second layout-shift test; overview panels; the issues panel;
    remove and restore a place;
  - the needs-a-driver block and banner;
  - the plan map;
  - playback at 60×;
  - the Live control cluster at phone width;
  - documents: upload, view, replace, remove, restore.
- Driver:
  - `test:data` through the real queue: start work, change vehicle, taken over, finish work, Arrived
    with the flags, the completed-early check, a self trip;
  - the documents read as the driver;
  - `test:nav`, `test:track`, `test:sync`, `test:setup`, typecheck.
- Part 6: the APK measured before and after each change; the 1.3.0 build run on the OPPO through every
  screen.

## 32. Questions with my defaults

All accepted (1–8 at checkpoint 0; 9–15 with Part 1's go, 15 October, 11 and 15 as changed there).

1. A driver with a task in progress at the cut-off is not clocked out until the task is done (1).
2. Existing drivers without a photo get the photo step at their next app start (5).
3. Personal trips push to the fleet admins; company trips are only tagged (13).
4. The Requester preset becomes request + view, and view is exactly what a viewer sees today: no
   maintenance, mileage or attention items (12).
5. "Tell requester" messages are in English (4).
6. A departure 20 minutes or more earlier than needed shows "Arrives N min early" (17).
7. The Route keeps one day at a time with the same control in one-day mode (8).
8. Removed places are restored by people with the vehicles permission (15).
9. A task not accepted in its window stays with its driver; accepting late clears "needs a driver"
   (19).
10. For declined and not-accepted tasks the critical-issue push is not sent, because the wider push
    already went; the issue's history records who was told and when (19).
11. Snap to roads is on by default when a route opens, under the google package, with a "Recorded
    points" toggle. Live's growing leg is snapped in whole 5 km pieces, with the tail raw
    meanwhile. Changed: the daily cap is 200; the monthly ceiling stays 4,750, fail closed (26).
12. Required documents: revenue licence, insurance, emission test and CR for every active vehicle,
    and the rent or lease agreement for a rented one. Missing ones are one reminder row per vehicle,
    not an issue each (28).
13. The driver's documents open online only (1-hour links), with no copy kept on the phone (28).
14. Reading the document files (`vehicle_documents`) needs the vehicles permission; the expiry chips
    stay visible with view, as now (28).
15. The 1.3.0 APK is arm64 only. Changed: a ready `drivers-32` profile (armeabi-v7a) and a test-plan
    line on how to tell a phone needs it; no 32-bit build unless Sahan asks (27).

## As built

### Part 1 (branch `phase7-1`)

Migration `20261015190000_phase7_duty.sql`; tests `supabase/tests/database/phase7_duty.test.sql`, the connector
suite's section 7, `test:data`'s Phase 7 block, `test:rules`. Where the build differs from the text above (the
behaviour is the same):

- **Start work and Finish work are the duty session itself.** The new app writes what every app already writes:
  a duty session with today's vehicle (Start work) and its end (Finish work). The triggers turn them into the
  clock-in and the clock-out, so one path serves every app version; there is no separate `start_work` /
  `finish_work` RPC. **Change vehicle** is the RPC `change_vehicle(vehicle, at, client_id)` (the phone's time,
  idempotent by the phone's id), and the picker reads `my_vehicle_choices()`.
- **`current_vehicle_id` = the open assignment** is kept by `take_vehicle` / `release_vehicle` and by triggers on
  every other write path (a driver's own update, SQL by an admin or a test), and a deferred constraint trigger
  refuses any commit where they differ.
- **The later take wins** for every take, a task start included: a write older than the vehicle's current holder
  is recorded as a closed stretch, and a write older than the driver's own current row (an office move came after
  it) changes nothing.
- **The cut-off runs in SQL**: `duty_jobs()` by pg_cron every 15 minutes (`duty-jobs`), not through fleet-jobs.
  It also gives up a vehicle still held off duty (an older app's pick) at the cut-off, and opens a duty session
  for a task running with none (the phone's own replaces it without splitting the vehicle's record). The
  heartbeat's answer carries `on_duty` and `duty_end {at, reason}`, so an app that missed the push stops by
  itself (`lib/duty.ts`, loaded by the app's entry, also with no screen open).
- **The office's clock-out and move are refused** while the driver has a task running; a move is also refused
  for a driver off duty, and onto a vehicle on another driver's running task. `duty_log`, `clock_out_driver`
  and `move_driver_vehicle` need assign_tasks or vehicles; `reopen_task` needs assign_tasks.
- **Done needs Arrived** on the server: the new app sends Done on its own after Arrived, and a Done write with
  no arrival is refused; an older app sends `arrived_at` with its Done, which passes and is flagged
  `not_arrived`.
- **Completed early** is not checked for plans under 3 km (an odometer counts whole km), the same in the app
  and on the server.
- `list_vehicles` gains `held_by` / `held_since` (the Move to vehicle page and, in Part 2, the assign forms).
- `duty_log`: up to 62 days; GPS km only for ranges of up to 7 days (the odometer km of the tasks always).
- **Change vehicle needs duty and no running task** (a new default, from the checkpoint review): the app offers it
  only on duty with no task in progress, and the server answers `refused: off_duty | task_running` and changes
  nothing otherwise (a change queued offline after a clock-out cannot take a vehicle from someone on duty; the task
  keeps its vehicle, as the office's move already does). An older app's bare vehicle pick still goes through.
- **How Arrived was marked stands**: once a stop has its `arrival_flag`, a later driver write cannot change it.
- **Completed early** compares with the plan up to the last stop: the drive back to base (the leg to `-1`) is left
  out, since the driver completes at the last stop.
- **Skip a stop** (§18): a line in the task's history (`task_assignment_events` action `stop_skipped`, "Stop 2 ·
  Kurunegala site: Closed · note") and a web push to the dispatchers (event `task.stop_skipped`, assign_tasks; the
  assigner alone with item 19), both from a trigger, so every app version.
- **Reopen** takes the vehicle at the reopen (not back-dated) and, when the driver had finished work, opens a duty
  session for the task (the server's; the phone's own replaces it).
- **App stopped, no fix**: a fresh heartbeat that reports a recent fix means the points are only waiting, so that is
  not "no GPS fix". **Vehicle conflict** stands past the leave-by, until the task starts or changes or the day ends.
- The old `location` field keeps "Not sharing" (the Teams artifact reads it); `status_text` says "Off duty".
  `availability` rows carry `duty` (the same as `state`) and `vehicle`.
- **Off duty, the logs still have a vehicle**: Finish work gives the vehicle up, so manual odometer readings, fuel
  and problem reports off duty go to the vehicle held last (kept on the phone).

## Sinhala

The new driver-app strings planned now (Sinhala drafts written by Claude Code, for the check with
the boss or a driver). The table is completed with every key as built at each checkpoint.

| key | English | Sinhala (draft) |
|---|---|---|
| `duty.startWork` | Start work | වැඩ ආරම්භ කරන්න |
| `duty.finishWork` | Finish work | වැඩ අවසන් කරන්න |
| `duty.finishConfirm` | Finish work? Location stops. | වැඩ අවසන් කරනවාද? ස්ථානය යැවීම නවතී. |
| `duty.onDutySince` | On duty since {time} | {time} සිට රාජකාරියේ |
| `duty.officeCanSee` | Office can see you | කාර්යාලයට ඔබව පෙනේ |
| `duty.offDuty` | Off duty | රාජකාරියෙන් පිටත |
| `duty.finishTaskFirst` | Finish the task first. | පළමුව කාර්යය අවසන් කරන්න. |
| `duty.autoOutTitle` | You were clocked out | ඔබව රාජකාරියෙන් ඉවත් කළා |
| `duty.autoOutBody` | Clocked out at {time} (end of the day). | {time} ට රාජකාරියෙන් ඉවත් කළා (දවසේ අවසානය). |
| `duty.officeOutBody` | The office clocked you out at {time}. | කාර්යාලය {time} ට ඔබව රාජකාරියෙන් ඉවත් කළා. |
| `vehicle.pickTitle` | Choose today's vehicle | අද වාහනය තෝරන්න |
| `vehicle.noVehicleToday` | No vehicle today | අද වාහනයක් නැත |
| `vehicle.withDriver` | With {name} now | දැන් {name} ළඟ |
| `vehicle.yourLast` | Your last vehicle | ඔබේ අවසන් වාහනය |
| `vehicle.yourRegular` | Your regular vehicle | ඔබේ සාමාන්‍ය වාහනය |
| `vehicle.addPhoto` | Add a photo | ඡායාරූපයක් එක් කරන්න |
| `vehicle.change` | Change vehicle | වාහනය වෙනස් කරන්න |
| `vehicle.takenBanner` | {plate} is now with {name} · choose your vehicle | {plate} දැන් {name} ළඟ · ඔබේ වාහනය තෝරන්න |
| `me.finishWorkFirst` | Finish work first | පළමුව වැඩ අවසන් කරන්න |
| `me.phoneSetup` | Phone setup | දුරකථන සැකසුම |
| `me.changePhoto` | Change photo | ඡායාරූපය වෙනස් කරන්න |
| `photo.title` | Add your photo | ඔබේ ඡායාරූපය එක් කරන්න |
| `photo.why` | The office and the people you drive see it. | කාර්යාලයට සහ ඔබ රැගෙන යන අයට එය පෙනේ. |
| `photo.take` | Take photo | ඡායාරූපයක් ගන්න |
| `photo.gallery` | Choose from gallery | ගැලරියෙන් තෝරන්න |
| `photo.failed` | The photo could not be saved: {reason} | ඡායාරූපය සුරැකිය නොහැකි විය: {reason} |
| `photo.noConnection` | No connection: try again. | සම්බන්ධතාවක් නැත: නැවත උත්සාහ කරන්න. |
| `photo.retry` | Try again | නැවත උත්සාහ කරන්න |
| `shift.titleWork` | At work? Start work | වැඩට ආවාද? වැඩ ආරම්භ කරන්න |
| `stop.label` | Stop {n} · {type} | නැවතුම {n} · {type} |
| `arrive.far` | You are {distance} from {place} | ඔබ {place} සිට {distance} ක් දුරින් |
| `arrive.override` | I'm here, the pin is wrong | මම මෙහි සිටිමි, පින් එක වැරදියි |
| `arrive.waitingGps` | Waiting for GPS… | GPS සඳහා රැඳී සිටිමින්… |
| `arrive.noPin` | No pin for this stop | මෙම නැවතුමට පින් එකක් නැත |
| `complete.needsLastStop` | Mark the last stop Done or Skip it first. | පළමුව අවසන් නැවතුම අවසන් ලෙස සලකුණු කරන්න හෝ මඟ හරින්න. |
| `complete.checkTitle` | Check the reading | කියවීම පරීක්ෂා කරන්න |
| `complete.checkBody` | The trip is {planned} km, the odometer says {km} km. | ගමන කි.මී. {planned} යි, ඔඩෝමීටරය කි.මී. {km} ක් පෙන්වයි. |
| `complete.correct` | Correct the reading | කියවීම නිවැරදි කරන්න |
| `complete.goOn` | Go on | ඉදිරියට යන්න |
| `trip.start` | Start a trip | ගමනක් ආරම්භ කරන්න |
| `trip.company` | Company work | සමාගම් වැඩ |
| `trip.personal` | Personal | පෞද්ගලික |
| `trip.where` | Where to? | කොහෙටද? |
| `trip.note` | Note (optional) | සටහන (අත්‍යවශ්‍ය නොවේ) |
| `trip.go` | Start | ආරම්භ කරන්න |
| `trip.addStop` | Add a stop | නැවතුමක් එක් කරන්න |
| `trip.offlineOnly` | No connection: type the place or pick one of the list. | සම්බන්ධතාවක් නැත: ස්ථානය ටයිප් කරන්න හෝ ලැයිස්තුවෙන් තෝරන්න. |

Added in Part 1 (as built; the push texts are the server's, `push-task`):

| key | English | Sinhala (draft) |
|---|---|---|
| `duty.finishConfirmYes` | Finish work | වැඩ අවසන් කරන්න |
| `duty.offDutyHint` | Start work to record trips and mileage. | ගමන් සහ කිලෝමීටර සටහන් කිරීමට වැඩ ආරම්භ කරන්න. |
| `duty.noVehicle` | No vehicle | වාහනයක් නැත |
| `vehicle.yours` | Yours now | දැන් ඔබ ළඟ |
| `vehicle.listOffline` | No connection: who has each vehicle is not shown. | සම්බන්ධතාවක් නැත: එක් එක් වාහනය කා ළඟදැයි පෙන්වන්නේ නැත. |
| `vehicle.start` | Start | ආරම්භ කරන්න |
| `shift.bodyWork` | Choose today's vehicle and tap Start work. | අද වාහනය තෝරා වැඩ ආරම්භ කරන්න ඔබන්න. |
| `arrive.km` | {n} km | කි.මී. {n} |
| `arrive.m` | {n} m | මී. {n} |
| `common.close` | Close | වසන්න |
| push `vehicle_taken` | Your vehicle was taken · {plate} is now with {name} · choose your vehicle | ඔබේ වාහනය වෙනත් අයෙකු ගත්තා · {plate} දැන් {name} ළඟ · ඔබේ වාහනය තෝරන්න |
| push `vehicle_moved` | The office changed your vehicle · Your vehicle is now {plate} / You have no vehicle now. | කාර්යාලය ඔබේ වාහනය වෙනස් කළා · ඔබේ වාහනය දැන් {plate} / ඔබට දැන් වාහනයක් නැත. |
| push `duty_auto_out` | You were clocked out · Clocked out at {time} (end of the day). | ඔබව රාජකාරියෙන් ඉවත් කළා · {time} ට රාජකාරියෙන් ඉවත් කළා (දවසේ අවසානය). |
| push `duty_office_out` | You were clocked out · The office clocked you out at {time}. | ඔබව රාජකාරියෙන් ඉවත් කළා · කාර්යාලය {time} ට ඔබව රාජකාරියෙන් ඉවත් කළා. |
| push `reopened` | Task reopened · {title} · finish it again in the app | කාර්යය නැවත විවෘත කළා · {title} · යෙදුමෙන් නැවත අවසන් කරන්න |

Added 15 October (items 17, 19, 20, 24, 28):

| key | English | Sinhala (draft) |
|---|---|---|
| `stop.timeAt` | {from}–{to} at {place} | {place} හි {from}–{to} |
| `push.acceptReminder` | Accept or decline: {title} {time} | භාරගන්න හෝ ප්‍රතික්ෂේප කරන්න: {title} {time} |
| `task.distanceLeftRoad` | Distance left by road | මාර්ගයේ ඉතිරි දුර |
| `task.noRouteLine` | Stops only: no planned road line for this task | නැවතුම් පමණි: මෙම කාර්යයට සැලසුම් කළ මාර්ග රේඛාවක් නැත |
| `map.northUp` | North up | උතුර ඉහළට |
| `docs.title` | Documents | ලේඛන |
| `docs.revenueLicence` | Revenue licence | ආදායම් බලපත්‍රය |
| `docs.insurance` | Insurance | රක්ෂණය |
| `docs.emission` | Emission test | දුම් පරීක්ෂණය |
| `docs.validUntil` | Valid until {date} | {date} දක්වා වලංගුයි |
| `docs.expired` | Expired {date} | {date} කල් ඉකුත් විය |
| `docs.open` | Open | විවෘත කරන්න |
| `docs.none` | No document yet | තවම ලේඛනයක් නැත |
| `docs.needsConnection` | Needs a connection to open. | විවෘත කිරීමට සම්බන්ධතාවක් අවශ්‍යයි. |
| `docs.noVehicle` | Start work with a vehicle to see its documents. | එහි ලේඛන බැලීමට වාහනයක් සමඟ වැඩ ආරම්භ කරන්න. |

## Deployment log

Nothing deployed yet.
