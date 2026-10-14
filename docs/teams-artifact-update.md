# Updating the Teams copy of the Fame Fleet artifact (Phase 6, Part 2)

14 October 2026 (Phase 6 Part 2, deploy round 1, commit f9bc685). Sahan updates the Teams
artifact (`RsGzozM5V4qCv4UeAECatu`, made in his Teams chat) himself from the file below;
Claude Code never publishes to it, and nobody else gets access yet.

## The file

- `apps/office/dist-artifact/index.html`, built with `npm run build:artifact` from main at
  f9bc685 (one self-contained file; no Supabase code, no key inside).
- `apps/office/dist-artifact/capabilities.json`, the declaration to paste unchanged when
  publishing: the connector named exactly **Fame Fleet** (as claude.ai shows it) and exactly
  the tools the artifact build calls, derived by `scripts/artifact-declaration.mjs` from the
  page's source. The Settings → Notifications route is bundled in the artifact too and loads
  the person's settings (`my_notification_settings`) before it says the rest is on the web
  app, so that tool is declared; the three actions behind its buttons
  (`set_my_notification_settings`, `register_web_push`, `remove_web_push`) are reached only on
  the web and are not, nor are `add_place` and `import_projects`, which no screen calls.

The declared tools, 48 in the connector's order (claude.ai derives the same set from the page):

- `fleet_overview`
- `live_drivers`
- `driver_route`
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

If claude.ai shows a different count when the Teams copy is updated, the page and the
declaration have drifted: rebuild with `npm run build:artifact` and compare.

## In the Teams chat

1. Open the artifact, choose Update, give it the file, keep the declaration as in
   `capabilities.json` (the server name must read "Fame Fleet": the `mcp__…` segment is not
   resolved for you).
2. Open it once: the Overview loads after the connector's permission prompt; the Issues
   item is in the menu; Settings lists Users and Fleet.
3. Do not share it with anyone new yet.

## The message for the Teams chat (Phase 6, Part 2)

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
