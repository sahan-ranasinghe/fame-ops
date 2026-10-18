# Updating the Teams copy of the Fame Fleet artifact

## Part 3b (18 October 2026, main at `9312e4e`)

Build from main at `9312e4e` with `npm run build:artifact` (`apps/office`):

- `apps/office/dist-artifact/index.html` (one file, no Supabase code, no key) and
  `apps/office/dist-artifact/capabilities.json`, pasted unchanged: the connector **Fame Fleet** with 85 tools. New since
  Hotfix 3: `driver_profile`, `set_driver_licence_photo`, `set_unavailability`, `remove_unavailability`, `drivers_board`,
  `ask_drivers`, `ask_answers`. In the artifact the answers to a question refresh every 10 s (the web app gets them at
  once); a question asked through the shared key has no person to notify, so its answers show only on its page.
- Changed for callers: `create_driver` needs the driver's phone number (asked for by the boss).

The message for the Teams chat:

> Fame Fleet is updated. What is new for the office:
>
> - A Drivers board (in the menu under Today): every driver with where they are (on a task until when, on duty, off
>   duty, not available), when they were last seen and near which town, their next task and when they usually start,
>   with Call and WhatsApp. The Week view shows each driver's tasks and the days they are not available.
> - Ask drivers instead of calling around: "Free for a trip tomorrow 09:00–12:00?", "When can you be at the office?" or
>   "Where are you now?". The drivers answer with one tap in their app; a Yes can be given the trip in one tap.
> - Drivers (and the office) can mark when a driver is not available: a day, a morning, an afternoon or a few hours.
>   Who's available, the best match and the warnings when you assign a task take it into account.
> - A driver can say "Running late" (10, 15, 30 minutes or more) or "Can't make it"; it shows on the task and on Live,
>   and the person who asked for the trip is told.
> - Each driver has a profile: WhatsApp number, emergency contact and driving licence with photos, and every change they
>   make is shown. A new driver now needs a phone number.

## Hotfix 3 (18 October 2026, main at `08d45f5`)

Build from main at `08d45f5` with `npm run build:artifact` (`apps/office`):

- `apps/office/dist-artifact/index.html` (one file, no Supabase code, no key) and
  `apps/office/dist-artifact/capabilities.json`, pasted unchanged: the connector **Fame Fleet** with 78 tools. New since
  Hotfix 2: `my_prefs` and `set_my_prefs` (a person's collapsed sections). Through the Teams connector (the shared key, no
  person) the artifact keeps them in the browser instead; the declaration lists them because the shared source names them.
- The lists ask a page at a time (`limit`, `cursor`); a copy of the artifact from before keeps working, since every tool
  answers as before without `limit`.

The message for the Teams chat:

> Fame Fleet is updated. What is new for the office:
>
> - The Overview puts what needs a decision first: Requests to approve, then tasks that need a driver, then critical
>   issues, then the numbers, who is on the road and what needs attention. Each part shows at most 5 rows with "View
>   all", and folds away with its count.
> - Needs attention no longer repeats itself: the same kind of item is one row with a count ("Odometer typed by hand ·
>   10") that opens in place, information-only items stay on Issues, and every row can be snoozed (until tomorrow
>   morning or a week) or dismissed.
> - A task nobody started is marked "Missed" a day after its leave time (one "Missed task" item until someone resolves
>   it), and old items about finished tasks close themselves.
> - A vehicle with no km allowance set is never "over its allowance" any more.
> - Every list shows 25 rows at a time with the count, page numbers, a search box where it helps, and the filters in the
>   link.
> - The menu is in sections (Today, Fleet, Reports, Admin) that fold away.

## Hotfix 2 (18 October 2026, main at `5172554`)

Build from main at `5172554` with `npm run build:artifact` (`apps/office`):

- `apps/office/dist-artifact/index.html` (one file, no Supabase code, no key) and
  `apps/office/dist-artifact/capabilities.json`, pasted unchanged: the connector **Fame Fleet** with 76 tools. New since
  the list below (Phase 6 round 3, 57 tools): `duty_log`, `clock_out_driver`, `move_driver_vehicle`, `swap_reading`,
  `reopen_task`, `set_driver_photo`, `set_vehicle_photo`, `vehicle_documents`, `remove_vehicle_document`,
  `restore_vehicle_document`, `remove_place`, `restore_place`, `list_tasks`, `set_trip_purpose` (Phase 7) and `my_trips`,
  `my_inbox`, `mark_inbox_read`, `update_my_profile`, `reviewing` (Hotfix 2).
- My trips, the notification centre and My profile are a person's own: through the Teams connector (the shared key, no
  person) they hide themselves; each person uses them in the web app with their own sign-in.

The message for the Teams chat:

> Fame Fleet is updated. What is new for the office:
>
> - Several people can approve: a request shows who is reviewing it right now, and once one person decides, the other
>   is told "Already approved by … at 10:42": a request is never decided twice. Every card says who approved, declined
>   or cancelled it, with Call and WhatsApp.
> - Times are said one way everywhere: "in 45 min", "3 h 20 min ago", "tomorrow 09:00".
> - Typing a time no longer plans for every half-typed value: the plan follows once the time is complete.
> - Call buttons for drivers on Live, Who's available, the task page and the request page (on a phone they open the
>   dialler or WhatsApp; on a computer the number with Copy and WhatsApp web).
> - A driver who is off duty is not chased: the 15 minutes to accept a task start when they start work (30 minutes
>   before leaving it needs a driver in any case).
>
> In the web app at fame-fleet.pages.dev each person also has My trips (their requests with the trip's live state),
> a notification centre with sounds, and My profile (your phone number, so drivers can call you).

## Phase 6, round 3

15 October 2026 (Phase 6 Parts 3 to 5b, deploy round 3). Sahan updates the Teams artifact
(`RsGzozM5V4qCv4UeAECatu`, made in his Teams chat) himself from the file below; Claude Code never
publishes to it, and nobody else gets access yet. Build the file from main at the round's commit
(the one recorded in `docs/phase6-plan.md`, deploy rounds) with `npm run build:artifact`.

## The file

- `apps/office/dist-artifact/index.html` (one self-contained file; no Supabase code, no key, no
  Google script inside: the artifact keeps its drawn map and never asks Google).
- `apps/office/dist-artifact/capabilities.json`, the declaration to paste unchanged: the connector
  named exactly **Fame Fleet** and exactly the tools the artifact build's source calls
  (`scripts/artifact-declaration.mjs`). `google_place` and `register_map_load` are declared because
  the shared source names them; the artifact never calls them (its person has no Google package:
  its search box never asks Google and its maps are the drawn one). `save_arrival_place` is used
  ("Save as our place" on a reached Google stop: one of our places at the driver's arrival point).

The declared tools, 57 in the connector's order:

- `fleet_overview`
- `live_drivers`
- `driver_route`
- `watch_drivers`
- `list_drivers`
- `create_driver`
- `reset_pin`
- `set_driver_active`
- `update_driver`
- `list_vehicles`
- `register_vehicle`
- `update_vehicle`
- `add_rental_company`
- `list_places`
- `search_places`
- `save_place`
- `place_detail`
- `update_place`
- `google_place`
- `register_map_load`
- `save_arrival_place`
- `create_task`
- `task_board`
- `task_detail`
- `cancel_task`
- `reassign_task`
- `create_request`
- `list_requests`
- `suggest_vehicles`
- `decide_request`
- `book_vehicle`
- `cancel_request`
- `mileage_summary`
- `list_vehicle_reports`
- `update_vehicle_report`
- `find_project`
- `list_office_users`
- `create_office_user`
- `reset_office_password`
- `set_office_user_active`
- `create_office_key`
- `revoke_office_key`
- `update_office_user`
- `plan_task`
- `update_task_stops`
- `get_settings`
- `update_settings`
- `routing_usage`
- `list_issues`
- `update_issue`
- `issue_history`
- `my_notification_settings`
- `availability`
- `update_request`
- `redecide_request`
- `update_task`
- `list_fuel`

If claude.ai shows a different count when the Teams copy is updated, the page and the
declaration have drifted: rebuild with `npm run build:artifact` and compare.

## In the Teams chat

1. Open the artifact, choose Update, give it the file, keep the declaration as in
   `capabilities.json` (the server name must read "Fame Fleet": the `mcp__…` segment is not
   resolved for you).
2. Open it once: the Overview loads after the connector's permission prompt; Fuel and Places are
   in the menu; a task's route shows dashed slate lines where the phone had a gap.
3. Do not share it with anyone new yet.

## The message for the Teams chat (Phase 6, round 3)

> Fame Fleet is updated. What is new for the office:
>
> - Fuel: every fill has a short silent video from the driver's phone (number plate, pump at
>   zero, pumping, the final display). The Fuel page lists the month's fills; each video opens
>   at the step you pick.
> - Places: one search box for every place field finds our offices, saved places and the Dialog
>   and Mobitel sites (by name or site id), the places used before and public places on the map.
>   A Google Maps link or "lat, lng" can be pasted. Settings → Import sites takes any site list.
> - Road times: plans and arrival times use Google's live traffic when the Google package is on
>   (the plan says "road time · Google traffic"). In the web app a stop can also be a Google
>   place; this artifact lists such stops but does not draw them (Google's rule).
> - Drivers: Navigate opens Google Maps turn by turn; near a stop the phone asks "Arrived?". Each
>   reached stop shows where the driver arrived; a reached Google stop can be saved as one of our
>   places under your own name ("Save as our place").
> - Route maps: where the phone lost GPS for a while, a dashed slate line follows the likely road,
>   marked "estimated". It is never counted in the km.
>
> The web app at fame-fleet.pages.dev has the same screens on Google's map, plus the live map,
> the driver pages with playback, and notifications.

## The earlier message (Phase 6, Part 2), kept for reference

> Fame Fleet is updated. What is new for the office:
>
> - Who's available: when you decide a request, book a vehicle or assign a task, every driver
>   is listed with On duty since, Off duty, or On a task until about when, what they have next,
>   today's accepted and declined counts and the licence. A click picks the driver.
> - The person who asked for a vehicle can change their request. A waiting one stays waiting.
>   An approved booking becomes "Changed · needs re-approval": you see what changed and decide
>   again — keep as asked, change the vehicle, driver or time, or decline. The driver's phone
>   follows, and the vehicle's custodian is told.
> - Change a task without recreating it: the day, leave-by, end time, driver, vehicle, title,
>   passengers, contact or notes. Every change is in the task's history with what changed, and
>   the driver's phone says "Task changed: new time 09:30 · vehicle WP KL-1234".
> - A request is always in the asker's name; "On behalf of" names who the vehicle is for.
> - Drivers show On duty since HH:MM on the drivers list, the live map and the driver page.
> - Settings → Fleet: the time and days of the drivers' "At work? Switch On duty" reminder.
>
> The web app at fame-fleet.pages.dev has the same screens plus the live map, the driver
> pages with playback, and notifications; it can be installed on a phone from Chrome's menu.

## The earlier message (Phase 5), kept for reference

> Fame Fleet is updated to Phase 5. What is new for the office:
>
> - Tasks have stops now (pickup, drop-offs, visits) and a leave-by time worked out from the
>   deadlines. Assign a task shows the plan: each leg's road time, the minutes at each stop,
>   and when the driver must leave. You can change the stops later; the driver's phone follows.
> - Each person has their own permissions (Settings → Users): what you cannot open is greyed
>   with a lock, and the requests queue, the tasks board, vehicles, issues and users are
>   separate rights.
> - Issues: the bell shows everything that needs attention (a breakdown, a document about to
>   expire, a task not accepted, running late, a request waiting). Take one, add a note, resolve
>   it; resolving a vehicle problem closes the driver's report.
> - Drivers accept or decline a task on the phone. A declined task waits under "Needs a
>   driver" with the reason; Reassign offers who is free.
> - Vehicles can be assigned to someone (a custodian). Booking a vehicle for someone is one
>   step from New request: the free vehicles for that time in four groups, the free drivers,
>   Book now. A booking can be cancelled with a reason. Everyone who asks for a vehicle sees
>   their request's timeline: sent, seen, approved or declined.
> - Notifications on your laptop or phone (a request comes in, your request is decided, a task
>   declined, a critical issue, a booking of your vehicle) are in the web app only:
>   fame-fleet.pages.dev → Settings → Notifications. This artifact refreshes by itself every
>   half minute instead.
>
> The web app at fame-fleet.pages.dev has the same screens plus the live map, the driver
> pages with playback, and notifications; it can be installed on a phone from Chrome's menu.
