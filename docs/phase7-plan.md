# Phase 7: a driver's day

15 October 2026. Checkpoint 0: the plan only; nothing is built until Sahan's go. Main is
fast-forwarded only after his go at each checkpoint; nothing is deployed without it.

Every one of the 18 items is planned below. None is left out. Two things that are not built
yet in this repo are called out where they matter: the project-costs screen (Phase C) does not
exist, so item 13's "project costs" part is done in mileage and the task data, ready for Phase C
(13.6); and a route is one day, so item 8's control works in one-day mode on the Route (8.3).

## 0. Ground rules for this phase

- One branch per part (`phase7-1` … `phase7-5`), tests at every checkpoint (§11), main
  fast-forwarded only after the go.
- **No new native modules and no new Android permissions.** §10 checks items 5, 6 and 13 against
  what the 1.2.0 build already has. Every driver-app change ships as an EAS update to the runtime
  `1.2.0-gmaps`.
- **Phones on the previous update keep working.** The 1.2.0 phones run their current JS until the
  update lands; 1.1.0 phones (if any are left) never get Phase 7 JS. So every new rule the server
  needs is done by the server itself (triggers, RPCs, jobs), and what old apps still send (a duty
  session with a vehicle, `employees.current_vehicle_id`, stop and task patches) is translated into
  the new model rather than refused (§12).
- Every schema change is a new migration. Everything the phone writes gets its grant and policy,
  tested as the driver role in pgTAP and through the app's real queue (`test:data`).
- Office web: phone first, full-page forms, no dialog that vanishes on an outside click (there are
  none today; none are added).
- Connector: additive only. New fields and tools; nothing removed or renamed; the tool-shapes
  contract only grows. The Teams artifact file is regenerated at the end (Part 5).
- All new UI text in `en.json` and `si.json`; numbers in Latin digits; the new Sinhala in §Sinhala.
- CLAUDE.md is updated where rules change: rule 9 becomes "Location is recorded while on duty".

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
- The Requester preset becomes request + view. This changes what a requester sees: Live, Vehicles
  and Drivers become visible to requesters, as the rule implies. That is called out at checkpoint 2.

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
  dwell.
- Between stops, one row per leg: distance, drive time and its source ("Google traffic",
  "openrouteservice" or "estimate"); then separate lines for the rush-hour factor and "via
  expressway".
- Totals at the bottom: drive time, km, end time.

**The departure field is checked at once** (in the browser, from the latest plan):
- An arrive-by is set and the departure is empty → the recommended departure is filled in.
- The departure is later than leave-by → in red: "Leave by 07:24 to arrive at 09:00. 08:00 is 36 min
  too late", with **Use 07:24**.
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
- Kinds: `{kind: leave, at}`, `{kind: stop, n, label, place, planned_arrive, arrive_by?, dwell_min}`,
  `{kind: leg, from_n, to_n, km, minutes, source, rush_factor?, via_expressway?}`.
- Totals.
- `conflicts[]` with the fields above.

The Teams artifact shows the same timeline and cards.

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

## 19. Parts, order and rounds

Sahan's split, with one change: the date-range control (8) is built in Part 1, because the Duty log
needs it, and applied everywhere else in Part 4.

| Part | Branch | Items | Why here |
|---|---|---|---|
| 1 | `phase7-1` | 1, 2, 7 (office), 18, the date-range control | the driver's day and its data model first; everything else reads the assignment |
| 2 | `phase7-2` | 3, 10, 11, 12, 17 | the dispatch screens, rebuilt once on the no-flicker pattern |
| 3 | `phase7-3` | 4, 5, 6 | photos and requester updates use the screens of Part 2 |
| 4 | `phase7-4` | 7 (app), 8 (everywhere), 9, 13, 15, 16 | the trips build on 11 and 18; the rest is the office's reading screens |
| 5 | `phase7-5` | 14 | docs, the test plan, the Sinhala list, the artifact |

**Rounds: two, not one.**
- **Round A** comes after Part 2 (go at checkpoint 2). It contains the migrations of Parts 1–2,
  office-mcp, office-api, fleet-jobs and push-task, the web, and an EAS update for `1.2.0-gmaps`.
  - Parts 1–2 change how a driver works all day (clock in, hand-over, the arrival and finish rules)
    and the dispatch screens. That should meet the field before photos and trips are built on top of
    it.
  - The flicker fix (10) is wanted now.
- **Round B** comes after Part 5: Parts 3–4's migrations, functions (including the new `driver-api`),
  the web, an EAS update, and the Teams artifact file.
- **Safe order in each round:**
  1. `npx supabase secrets list` (names only).
  2. `db push` (additive tables and columns; triggers that translate old apps' writes).
  3. Functions.
  4. Web.
  5. The EAS update, last. Phones on the previous update keep working against the new server, and
     the new app finds the server ready.
- No 1.1.0 update is needed: those phones are told to install 1.2.0.

## 20. Native check: items 5, 6, 13 work in 1.2.0 (no native change)

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
- **Plus:** push handling (expo-notifications), the local notification for the auto clock-out, and
  reading the position for the 300 m rule (expo-location) are all in the build.
- **To verify on the OPPO at checkpoint 3:** the gallery picker and the crop screen open and return a
  square, on the 1.2.0 build, before anything else is built on them. If they don't, I stop and say so.

## 21. Tests per part

Every checkpoint runs the whole set, each on a fresh database where it needs one:
- Deno (each folder's `deno fmt --check`, `deno check`, `deno test`).
- pgTAP, a new file per part: `phase7_duty.test.sql`, `phase7_dispatch.test.sql`,
  `phase7_photos.test.sql`, `phase7_trips.test.sql`. Each covers the driver role's writes (grants,
  policies, RPCs) and the old-app translations (a duty session with a vehicle opens an assignment; a
  bare `current_vehicle_id` update becomes a change).
- The connector suite, both channels, with new sections; the tool-shapes contract checked for
  additions only.
- Vitest: the new logic, the no-flicker node-identity test, the date range, the timeline, the
  permission lock.
- Playwright: the duty log; the approve page's 30-second layout-shift test; overview panels; the
  issues panel; remove and restore a place.
- Driver: `test:data` through the real queue (start work, change vehicle, taken over, finish work,
  Arrived with the flags, the completed-early check, a self trip); `test:nav`, `test:track`,
  `test:sync`, `test:setup`, typecheck.

## 22. Questions with my defaults (change any)

1. A driver with a task in progress at the cut-off is not clocked out until the task is done (1).
2. Existing drivers without a photo get the photo step at their next app start (5).
3. Personal trips push to the fleet admins; company trips are only tagged (13).
4. The Requester preset becomes request + view, so requesters see Live, Vehicles and Drivers (12).
5. "Tell requester" messages are in English (4).
6. A departure 20 minutes or more earlier than needed shows "Arrives N min early" (17).
7. The Route keeps one day at a time with the same control in one-day mode (8).
8. Removed places are restored by people with the vehicles permission (15).

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

## Deployment log

Nothing deployed yet.
