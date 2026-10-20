# Phase 8: parity of the office site in Office mode

Every function of the office site (apps/office, as built at main `003c749`, plus Hotfix 4), the tools it calls and the
permission it needs, with the Office-mode screen that does it and its status: **planned 8.x** → **built** → **tested** (the
tap test and the Part's tests), or **laptop only (decided)**. Every checkpoint of Phase 8 shows this table; a row moves only
with its screen's test. The numbers in brackets are the designs in `design/office/png/`. Built from a read-only inventory of
the site on 19 October 2026 (138 rows, with the privacy e-mail added after the Part 6 checkpoint).

**O1 (19–20 October 2026, branch `phase8-o1`):** "built O1" rows are on the phone against the live server after the O1 EAS
update; "O2" rows are the trip editor's round (New request / Assign a task, designs 06–09); "later" rows keep their Part.

**O2 (19–20 October 2026, branch `phase8-o2`):** "built O2" rows are on the phone after the O1+O2 EAS update (the trip
editor 06–09, Ask drivers 13, the Drivers board 12, Issues, Task detail's extras, Live's trails and playback, the management
under More 19–20); "later" rows keep their Part; "laptop only for now" rows wait for an upload tool that is not web-only.

Permissions: V view, R request, Ap approve, AT assign_tasks, Veh vehicles, Iss issues, U users, ANY any office permission.

| Area | Function on the site | Tools | Permission | Office mode | Status |
|---|---|---|---|---|---|
| Sign-in | Sign in e-mail + password | Auth, GET /me | office acct | Sign in (01), 2-step code, set password from the link | built O1 |
| Sign-in | Second step code / set up 2-step when required | Supabase MFA | — | Sign in (01), 2-step code, set password from the link | not in O1 (2-step accounts sign in on the site; the code page later) |
| Sign-in | Set password from one-time link (12+) | updateUser | — | Sign in (01), 2-step code, set password from the link | not in O1 (set the password from the link on the site) |
| Sign-in | Blocked page + sign out | — | — | Sign in (01), 2-step code, set password from the link | built O1 (the sign-in's messages; a switched-off or no-office-role account never keeps a session) |
| Sign-in | 2-step on/off (web only) | MFA | ANY | — | laptop only (decided): enrolment on the site; the code at sign-in works in the app |
| Sign-in | Sign out | — | — | Sign in (01), 2-step code, set password from the link | built O1 (More and Profile) |
| Sign-in | Privacy page /privacy (no sign-in) | — | none | Sign in (01) footer and Profile (18) → /privacy | built O1 |
| Shell | Menu sections collapsible, remembered | my_prefs, set_my_prefs | ANY | Tabs per permission + More (19) | replaced by the tabs (8.1) |
| Shell | Menu badges requests waiting, open issues | fleet_overview, list_issues (+Realtime) | V / Iss or AT | Tab and More badges | built O1 (the Alerts badge and the bell; the counts on Home) |
| Shell | Phone tab bar tabsFor | — | per tab | Tabs per permission (section 1) | built O1 (office/nav.ts tabsFor); O2: the Drivers tab after Live for approvers and dispatchers (designs 03, 04, 12, 15), Alerts under More |
| Shell | More page (name, role, e-mail, phone, version, permissions, My profile, Security, Sign out) | — | — | More (19) + Profile (18) | built O1 (More (19) with My profile → Profile (18)); O2: the management rows by permission (Vehicles, Reports, Drivers, Office users, Quick settings); no Security card |
| Shell | Home big button homeAction | — | by role | Home big actions (02–04) | built O2 (Assign a task with assign_tasks, Request a vehicle with request: the trip editor) |
| Shell | "N tasks need a driver · Show" banner on Tasks pages | fleet_overview | Ap or AT | Home: Needs a driver (03, 04); Tasks list banner | built O1 (Home: Needs a driver; the Tasks board's section) |
| Shell | "Add your phone number" banner | /me phone_required | Ap or AT | Profile prompt after sign-in | built O1 (Profile's notice) |
| Shell | Pull to refresh (phone) | — | — | Pull to refresh on every list | built O1 (every list and page) |
| Shell | No access page | — | — | Not routed without the permission | built O1 (not routed without the permission; a link to a screen the person may not open is not shown) |
| Notifications | Tray All/Unread, by day, Mark all read | my_inbox (+Realtime), mark_inbox_read | ANY | Alerts (16) | built O1 (Alerts: All / Unread, by day, Mark all read) |
| Notifications | Bell → /inbox on phone | — | ANY | Alerts (16) | built O1 (the bell on every tab header) |
| Notifications | Banner per new item + kind's sound | my_inbox, my_notification_settings | ANY | Alerts (16) | O1: the badge only; the sound comes with the office push (item 9, behind a go) |
| Notifications | "Click to turn on sounds" | — | — | Alerts (16) | not needed in the app (its sounds are the phone's) |
| Notifications | Inbox page All/Unread/History, search, paging | my_inbox, mark_inbox_read | ANY | Alerts (16) | built O1 (All / Unread; search, history and paging later) |
| Notifications | Web push tap opens page | sw.js | — | A push tap opens its screen (native and web) | built O1 (a notification's link opens its screen from Alerts); the push tap with item 9 |
| Overview | Sections by role, 5 rows (3 phone), View all, collapse | fleet_overview, prefs | V | Home (02–05) | built O1 (sections by permission, 5 rows, View all; no collapsing) |
| Overview | Requests to approve + Decide | list_requests | Ap | Home (04): Requests to approve | built O1 (Home → Approve (10)) |
| Overview | Needs a driver (best match), row → change page | fleet_overview | Ap or AT | Home (03, 04): Needs a driver → Give it a driver (11) | built O1 (Home → Give it a driver (11)) |
| Overview | Critical issues | fleet_overview | Iss or AT | Home (04): Critical | built O2 (Home: Critical → the issue's page; View all → Issues) |
| Overview | At a glance tiles | fleet_overview | V | Home (02–05) | built O1 (the header chips) |
| Overview | Tile panels /?open= | list_vehicles, task_board, list_requests | V/AT/Ap/Iss | Home (02–05) | O1: the chips open Live and the Approve queue; O2: Critical opens Issues; the other panels later |
| Overview | On the road rows (driver link, Maps, WhatsApp, Call) | fleet_overview | V | Home (02–05) | built O1 (rows open Live on the driver; Call / WhatsApp / Maps on Live's card) |
| Overview | Needs attention groups, expand | fleet_overview | Iss or AT | Home (02–05) | later (8.4) |
| Overview | Snooze / Dismiss row or group | update_issue | Iss | Issues: snooze / dismiss a group | O2: Dismiss on an issue's page; a snoozed row says so; snooze and a group's row later |
| Overview | My trips section | my_trips | R or AT | Home (02): My trips | built O1 (Home → My trips (17)) |
| Overview | New request / Assign task buttons | — | R / AT | Home big actions | built O2 (the trip editor) |
| Reminders | /reminders documents/services due + also needs attention | fleet_overview | Iss or AT | More → Reports → Reminders | planned 8.4 |
| Requests | List chips Waiting/Changed/Approved/Declined/Cancelled/All, search, paging | list_requests | V or R | Requests list and a request's page (not designed: 8.0) | O1: the Approve queue (waiting and changed); the other chips, search and paging later |
| Requests | "X is reviewing" | list_requests | — | Requests list and a request's page (not designed: 8.0) | built O1 (the queue's rows and Approve's "is also looking") |
| Requests | Row Review / Task | — | Ap / task_detail | Requests list and a request's page (not designed: 8.0) | O1: a row opens Approve (10) |
| Requests | New request (on behalf, phone, project, trip editor, type, pax, tools, driver needed, note) | create_request, plan_task, search_places, save_place, google_place | R | Trip steps Where → When → Who → Review (06–09) | built O2 (Where · When · Who · Review → create_request: the location search (our places, the map's results, Google's under the google package, a pasted pin or Maps link), on behalf of, the project by name, pax, type, tools, driver needed, note; a draft kept) |
| Requests | Book now (driver, vehicle groups, Who's available) | book_vehicle, suggest_vehicles, availability | Ap | Trip steps · Who with Book now | later (the Who step has no Book now yet: an approver's request goes to the queue like anyone's) |
| Requests | Request detail (timeline, decided by, Call, trip) | list_requests | V or R | Approve a request (10) | built O1 (Approve (10) shows the trip, who decided, Call; the requester's own page O2) |
| Requests | Edit request | update_request, plan_task | R or Ap | My trips (17): Edit · Withdraw | built O2 (My trips → Edit: the editor from the request, update_request with its version, only the changes sent) |
| Requests | Withdraw own waiting request | cancel_request | R own | My trips (17): Edit · Withdraw | built O1 (My trips: Withdraw with a reason) |
| Requests | Cancel a booking | cancel_request | Ap | A request's page: Cancel booking (with undo) | later (8.4) |
| Requests | Tell requester (WhatsApp text), requester's phone | update_request | Ap | Approve a request (10) | later (8.4) |
| Requests | Decide (driver, vehicle groups, Who's available, plan, Approve & send / Decline) | decide_request, suggest_vehicles, availability, plan_task, reviewing | Ap | Approve a request (10) | built O1 (Who's available with the best match, Approve · send to <driver> / Decline… with a reason); O2: Ask drivers (13); no vehicle groups, no plan map |
| Requests | Re-decide a changed booking (keep/change/decline) | redecide_request | Ap | Approve a request (10) | built O1 (keep / change the driver / decline, with the version) |
| Requests | Trip decide (send as proposed / move day, leave-by, back-by; times asked; decline) | decide_request | Ap | Approve a request (10) | O1: a proposed task is sent as proposed (its driver picked first); move day / leave-by / back-by O2 |
| Requests | Open the task from a request | task_detail | (route needs AT: bug) | Task detail (14), only with assign_tasks | built O1 (Open task → on Give it a driver; from Approve O2) |
| My trips | List (range, status, kind, search, paging, Call/WhatsApp) | my_trips | R or AT | My trips (17); Home (02) action | built O1 (the last 30 to the next 60 days, All / Waiting / Coming up / Done, Call; search and paging later) |
| My trips | New request button | — | R | My trips (17); Home (02) action | built O2 (the trip editor) |
| Tasks | Day board columns incl. Waiting for approval, Needs a driver; ETA, late | task_board | AT | Tasks list / board (not designed: 8.0) | built O1 (the Tasks board: needs a driver, on the way, sent, waiting for approval, done; the late pill) |
| Tasks | Day navigation + date picker | — | AT | Tasks list / board (not designed: 8.0) | built O1 (‹ a day › and today; no picker) |
| Tasks | Column Load more | task_board | AT | Tasks list / board (not designed: 8.0) | later |
| Tasks | Needs a driver block / filter | task_board.needs_driver | AT | Tasks list / board (not designed: 8.0) | built O1 |
| Tasks | Waiting-approval card → decide | — | Ap / own | Tasks list / board (not designed: 8.0) | built O1 (an approver: → Approve) |
| Tasks | /tasks?task= link | — | AT | Tasks list / board (not designed: 8.0) | built O1 (a push link's task opens) |
| Tasks | Assign a task (full trip editor, plan + map, conflicts, driver + vehicle/on the day, Who's available, pax, contact, notes, projects, WhatsApp link, Assign & send / Send for approval) | create_task, plan_task, availability, get_settings, find_project, search_places, google_place, save_place | AT | Trip steps (06–09) | built O2 (Where · When · Who · Review: the plan on the map (both engines) with the timeline, conflicts and warnings, the driver with the best match, the vehicle (the driver's today, On the day / Any <type> when the setting allows, or a free one), pax, contact, the project by name, notes; Assign & send / Send for approval → create_task; a draft kept; the WhatsApp link later) |
| Tasks | Task detail (facts, Call, ETA, running late, contact, charged to, odometer/fuel photos/video, problems, history, warnings, unlogged km, plan + map) | task_detail | AT (route) | Task detail (14) | built O1 (facts, Call / WhatsApp, the ETA, running late, the contact, the stops planned vs actual); O2: Change time, Change stops, Swap vehicle, Reopen; photos, history, warnings and the map later |
| Tasks | Task route map (GPS km, points, gaps) | driver_route | AT or Veh | Task detail (14) | later |
| Tasks | Save as our place (reached Google stop) | save_arrival_place | Veh or AT | Task detail (14) | later |
| Tasks | Driver-started trip purpose / project | set_trip_purpose | AT | Task detail (14) | later |
| Tasks | Reopen today's completed task | reopen_task | AT | Task detail (14) | built O2 (Task detail: Reopen with a reason, a task completed today) |
| Tasks | Type a missing swap odometer reading | swap_reading | AT or Veh | Task detail (14) | later |
| Tasks | Change the task / Give it a driver (TaskEdit) | update_task, availability, task_detail | AT | Needs a driver (11) / Task detail → change | built O1 (Give it a driver (11) through reassign_task); O2: Change time (the day, leave-by, end) through update_task with the plan version; the title, pax, contact and notes later |
| Tasks | Find a driver (/edit?driver=1) | update_task | AT | Needs a driver (11) / Task detail → change | built O1 (Needs a driver (11)) |
| Tasks | Cancel task with reason | cancel_task | AT | Task detail: Cancel task… (with undo) | built O1 (with a reason; no undo) |
| Tasks | Edit stops (Plan now, Save) | update_task_stops, plan_task | AT | Task detail → Change time or stops (07) | built O2 (Task detail → Change stops: the editor's Where and When, update_task_stops with the plan version) |
| Tasks | History (range ≤366 d, filters, paging) | list_tasks | AT | Tasks → History (not designed: 8.0) | later |
| Dispatch | Who's available (best match, pick, tick + Ask drivers, Call/WhatsApp) | availability | Ap or AT | Trip · Who (08), Approve (10), Needs a driver (11) | built O2 (the best match and the pick on Approve, Give it a driver and the Who step; Ask drivers (13) on all three; the rows' Call / WhatsApp later) |
| Dispatch | Conflict cards | plan_task/create_task answers | AT | Trip · Who (08), Approve (10), Needs a driver (11) | built O2 (Review: the conflicts and warnings before sending; the alert after) |
| Dispatch | Location search (ours, used before, map/Google, pasted pin/link → pin map → save) | search_places, google_place, save_place | various | Trip · Where (06): the search | built O2 (the Where step: our places, the map's results, Google's with its credit under the google package, a pasted pin or Google Maps link; a Google pick never saved as ours; the pin map later) |
| Dispatch | Drafts on 13 forms | localStorage | — | Save draft on the trip steps (06) | built O2 (one trip draft kept on the phone: Resume / Start again) |
| Live | Driver list chips All/On a task/On duty/Off duty/Problems | live_drivers (+Realtime driver_latest) | V | Live (15) | built O1 (All / On a task / Free / Off duty) |
| Live | Map markers, pick | — | V | Live (15) | built O1 (both engines) |
| Live | Detail card (position, speed, battery, ETA, phone line, driver page, Maps, Call/WhatsApp) | — | V | Live (15) | built O1 (name, plate, the status line, Call / WhatsApp, Maps; speed, battery and the driver page later) |
| Live | Today's route, points, gaps | driver_route | AT or Veh | Live (15) | built O2 (Live: the selected driver's day by speed band, holes, the estimated legs, the stops; both engines) |
| Live | Today's trails (+Realtime location_points) | driver_route | AT or Veh | Live (15) | built O2 (Live: Today's trails for the first 10 sharing drivers, merged every 60 s; no Realtime on the phone) |
| Live | Watched mode | watch_drivers | V | Live (15) | later |
| Live | Clock out | clock_out_driver | AT or Veh | Live (15) → a driver's card | later |
| Live | Move to vehicle / Swap during a task | move_driver_vehicle, list_vehicles | AT or Veh | Live (15) → a driver's card | O2: Swap during a task from Task detail (move_driver_vehicle); Move to vehicle from Live later |
| Live | Map controls zoom, compass, fit | — | — | Live (15) | O2: the trails toggle in the cluster; zoom, fit and the compass later (pinch and pan) |
| Drivers | List (search, switched-off, paging, Manage, links board/duty log/add) | list_drivers | V | Drivers (12), Ask drivers sheet (13) | built O2 (the Drivers tab (12) is the list; a row opens the driver's page; Manage a driver (20) under More → Drivers with users or vehicles; search later) |
| Drivers | Add driver (random PIN shown once) | create_driver | Veh | Manage a driver (20) | built O2 (More → Drivers → Add driver: the PIN shown once) |
| Drivers | Driver photo (web only) | photo_upload_url, set_driver_photo | Veh | Manage a driver (20) | laptop only for now (the upload tool is web-only) |
| Drivers | Profile sections Contact/Emergency/Licence edit, month, version, changes log | driver_profile, update_driver | Veh or U | Manage a driver (20) | built O2 (Manage a driver (20): phone, WhatsApp, licence, emergency contact through update_driver; the driver's page shows the profile) |
| Drivers | Licence photos (web only) | photo_upload_url, set_driver_licence_photo | Veh or U | Manage a driver (20) | laptop only for now (the upload tool is web-only) |
| Drivers | Not available add/change/remove | set_unavailability, remove_unavailability | Ap or AT | Manage a driver (20): This week; Drivers board Week | built O2 (the Drivers tab's Week: + Not available, Remove; a driver's page: Remove) |
| Drivers | New PIN | reset_pin | Veh | Manage a driver (20) | built O2 (Manage a driver (20): Reset PIN, shown once) |
| Drivers | Switch off/on | set_driver_active | Veh | Manage a driver (20) | built O2 (Manage a driver (20): Switch off / on with a second confirmation) |
| Drivers | Driver page (route by speed, timeline, gaps, live growth) | driver_route, live_drivers, list_drivers, watch_drivers | AT or Veh | A driver's day (not designed: 8.0) | built O2 (a driver's page: today's route by speed band, holes, the estimated legs, the stops, the timeline; no live growth, no watched mode) |
| Drivers | Playback 1× 5× 20× 60× (web only) | — | AT or Veh | A driver's day (not designed: 8.0) | O2: on Live (15); on the driver's page later |
| Drivers | Drivers board Now (filters, search, tick + Ask drivers, New task, Questions) | drivers_board | Ap or AT | Drivers (12), Ask drivers sheet (13) | built O2 (the chips with counts, the rows, Ask drivers; search and New task later) |
| Drivers | Board Week (‹ ›, add/change entry; phone one driver at a time) | drivers_board, set/remove_unavailability | Ap or AT | Drivers (12), Ask drivers sheet (13) | built O2 (the week strip per driver, + Not available, Remove) |
| Drivers | Ask drivers (3 kinds, day/from/to, note, chosen or all free) | ask_drivers, drivers_board | Ap or AT | Drivers (12), Ask drivers sheet (13) | built O2 (the sheet (13): the three questions, the day and window, the note, the drivers chosen; from the board, Approve, Give it a driver and the Who step) |
| Drivers | Questions last 7 days | ask_answers | Ap or AT | Drivers (12), Ask drivers sheet (13) | later (the sheet shows its own question's answers while open) |
| Drivers | Answers (counts, chips, shared point, Call/WhatsApp, Assign on Yes) | ask_answers (+Realtime) | Ap or AT | Drivers (12), Ask drivers sheet (13) | built O2 (the sheet asks ask_answers every 10 s: chips, Call, Map, Use on a Yes; no Realtime) |
| Drivers | Duty log (range ≤62 d, driver, totals, paging) | duty_log | AT or Veh | More → Reports → Duty log | built O2 (More → Reports → Duty log: the range, totals, periods, Load more; no driver filter) |
| Vehicles | Board chips, search, paging | list_vehicles | V | More → Vehicles (list and page; not designed: 8.0) | built O2 (More → Vehicles with view: the chips with counts, the search, 25 a page) |
| Vehicles | Vehicle detail | list_vehicles | V | More → Vehicles (list and page; not designed: 8.0) | built O2 (the vehicle's page) |
| Vehicles | Vehicle photo (web only) | photo_upload_url, set_vehicle_photo | Veh | More → Vehicles: add / edit / photos and documents by camera | laptop only for now (the upload tool is web-only; the photo is shown) |
| Vehicles | Documents upload/replace/view/expiry/remove/restore/other | vehicle_documents, vehicle_document_upload_url, save_vehicle_document, update_vehicle, remove/restore_vehicle_document | Veh | More → Vehicles: add / edit / photos and documents by camera | O2: the documents on file with Open (vehicle_documents); upload, replace, remove and restore laptop only for now (web-only upload tool) |
| Vehicles | Register vehicle | register_vehicle | Veh | More → Vehicles: add / edit / photos and documents by camera | built O2 (More → Vehicles → Register vehicle) |
| Vehicles | Edit vehicle (garage booked, in garage, rent) | update_vehicle | Veh | More → Vehicles: add / edit / photos and documents by camera | built O2 (the vehicle's Edit: only the fields filled are sent; garage booked, in garage, still rented) |
| Vehicles | Add rental company inline | add_rental_company | Veh | More → Vehicles: add / edit / photos and documents by camera | built O2 (inline on the form) |
| Maintenance | Problem reports list (filters, photos, Open task, Call) | list_vehicle_reports | Veh route; tool Iss | Issues → vehicle problems | O2: a vehicle problem is an issue on the Issues list; the reports page itself later |
| Maintenance | Update a report (status, note, take off the road) | update_vehicle_report, update_vehicle | Iss (+Veh) | Issues → vehicle problems | O2: through the issue (Take / Resolve / Dismiss mirror onto the report); take off the road later |
| Maintenance | Service and document reminders | fleet_overview / list_vehicles | Veh | More → Reports → Reminders | planned 8.4 |
| Issues | List (range, status, kind, vehicle, severity, order, search, paging, Realtime) | list_issues | Iss or AT | Issues (not designed: 8.0) | built O2 (Issues: the status and severity chips, search, 50 a page with Load more; no Realtime, no vehicle or kind filter) |
| Issues | Issue panel/page (facts, links, photos, history) | issue_history | Iss or AT | Issues (not designed: 8.0) | built O2 (the issue's page: the facts, the links by permission, the timeline; photos later) |
| Issues | Take / note / resolve / dismiss / reopen | update_issue | Iss | Issues (not designed: 8.0) | built O2 (Take, a note, Resolve, Dismiss, Open again) |
| Places | List (search, ours/Dialog/Mobitel/removed, no pin, paging) | list_places | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Restore | restore_place | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Place page (pin drag/type, address, district, depot, save, remove pin) | place_detail, update_place | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Remove (in use reasons) / restore | remove_place, restore_place | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Import sites (web only; presets, mapping, batches, CSV, save preset) | list_import_presets, import_places, save_import_preset | Veh | — | laptop only (decided) |
| Places | Import history + undo | list_place_imports, undo_place_import | Veh | — | laptop only (decided) |
| Mileage | Range, vehicle, driver; tiles; by vehicle, allowance, gaps, unlogged, odometer checks, personal km | mileage_summary | Veh | More → Reports → Mileage | built O2 (More → Reports → Mileage: the range, the tiles, by vehicle, the month's allowance beside a shorter range, gaps, unlogged km, odometer checks; no vehicle or driver filter; the photos on a laptop) |
| Fuel | List (range, vehicle, driver, tiles, paging) | list_fuel | Veh | More → Reports → Fuel | built O2 (More → Reports → Fuel: the range, the tiles, the fills with each video's state, Load more; no filters) |
| Fuel | Fill detail (video pieces, bookmarks, receipt, links) | list_fuel, get_settings | Veh | More → Reports → Fuel | later (the videos play on a laptop) |
| Projects | Find a project | find_project | V or R | Trip · Review: the project split (find_project) | O2: the project typed by name on the Who step (the server matches it); the search later |
| Projects | Copy the Zoho import message | (import_projects Claude only) | — | — | laptop only (decided) |
| Settings | Settings home + security card | — | — | More (19) | built O1 (More (19)); O2: the management rows |
| Settings | My profile (own phone) | update_my_profile | ANY | Profile (18) | built O1 (Profile (18): the own phone) |
| Settings | Users list | list_office_users | U | More → Office users | built O2 (More → Office users: search, Load more) |
| Settings | Add office user (presets, one-time link) | create_office_user | U | More → Office users | built O2 (More → Office users → Add: the presets as chips, the one-time link shown once with Share) |
| Settings | Manage user (name, phone, permissions) | update_office_user | U | More → Office users | built O2 (the user's page: phone and permissions) |
| Settings | New set-password link | reset_office_password | U | More → Office users | built O2 (the user's page: New set-password link, shown once with Share) |
| Settings | Claude connector keys new/revoke | create_office_key, revoke_office_key | U | — | laptop only (decided) |
| Settings | Switch user off/on | set_office_user_active | U | More → Office users | built O2 (the user's page: Switch off / on) |
| Settings | Fleet settings (below) | get_settings, update_settings | U | More → Quick settings (19): the six quick keys | built O2 (More → Quick settings: the six keys); the other keys laptop only (decided) |
| Settings | Privacy contact e-mail (Part 6: the public /privacy page's contact; removed = the office phone) | get_settings, update_settings `privacy_email` | U | — | laptop only (decided: set once before the store submission and rarely changed; the page itself is linked from Sign in and Profile) |
| Settings | Google usage + caps | get_settings.google, update_settings | U | More → Reports: the counters (read) | later (the counters) |
| Settings | Routing usage 14 days | routing_usage | U | More → Reports: read | later |
| Notif settings | This browser on/off (web only) | register_web_push, remove_web_push | ANY | Profile → Notifications on this phone (native push; web push on the web build) | planned 8.1 |
| Notif settings | Event toggles | set_my_notification_settings | ANY | Profile (18) → Notifications | built O1 (Profile (18)) |
| Notif settings | Browsers with notifications: Remove | remove_web_push | ANY | Profile (18) → Notifications | planned 8.2 |
| Notif settings | Sounds on/off, volume, Test, per kind | set_my_notification_settings | ANY | Profile (18) → Notifications | O1: not shown (the phone has no office push yet; with item 9) |
| Maps | Google map after counted load; else MapLibre/drawn/no map | register_map_load | ANY | Every map (Live with trails and playback, the planner's map and route line, task detail, the places pin map): the driver app's one map component with both engines and its rules (Google by default, the automatic switch to the free map, the map package setting switches every phone, "Map not available"). Native app: the free Maps SDK, not counted. Web build: the counted load, no map at the cap, the free map with the package open | built O1 (Live: both engines, the same rules as the task map; the plan map later) |

**Laptop only (decided at planning, section 2 of the plan):** the site import and its history and undo, the Zoho message for
Projects, Claude connector keys, 2-step enrolment, the detailed fleet settings (everything but the six quick ones), the
Google caps' edit, the audit log (no page yet). One line under More says so.

**Not on the site yet, in the app from the start:** native push for office people (plan section 10.1), the requester's ETA
(10.4).

**Found while making the inventory, fixed by Hotfix 4:** "Open the task" links that led approvers and requesters to No
access; Maintenance's reports list needs issues while its page needs vehicles (left as it is: said here).

## Hotfix O2-H1, Part B: the trip forms field by field (20 October 2026)

The site's New request (`screens/NewRequest.tsx` with `TripEditor`, `StopsEditor`, `AvailabilityPanel`, `requestParts`),
Assign a task (`screens/NewTask.tsx` with `ConflictCards`, `PlanTimeline`, the project split), Edit a request
(`RequestEdit.tsx`), Change the task (`TaskEdit.tsx`) and Change stops (`TaskStops.tsx`), against the server's
`create_request`, `book_vehicle`, `create_task`, `update_request`, `plan_task`, `update_task`, `update_task_stops` and
`decide_request`, and the app's steps Where (06) · When (07) · Who (08) · Review (09). Status: **in** (already in the app),
**built B** (built in this hotfix), **B-moved** (in the app, moved under "More details" by the principle), **O3** (left for
the next round, listed in the plan), **n/a** (the server has it but the site's form does not: the server's default is
used), **decision** (cannot be done the same way on a phone: Sahan decides).

| Site field, check or output | Server input / output | App step · control | Status |
|---|---|---|---|
| **New request** | | | |
| On behalf of (text, 120) | create_request / book_vehicle `on_behalf_of` | Who · More details · text | B-moved |
| Requester's phone (approvers only, 30; "Tell requester" on WhatsApp) | `requester_phone` | Who · More details · phone (with approve) | built B |
| Project or team (text 200; the server matches a Zoho job, else keeps the label) | `project` | Who · More details · text | B-moved |
| Day | `date` | When · Today / Tomorrow / +2 / Pick a date | in |
| Leave by (typed, or planned; the departure check: "Use HH:MM", "Move arrive-by to HH:MM", "Move back by to HH:MM") | `time` (planned when absent and a stop has arrive_by) | When · Leave from card · HH:MM field, the check's line with Use / Move arrive-by / Move back by | in (Move back by built B) |
| Back by | `back_by` | When · Back by on the last stop | in |
| Start from (the search; the base place by default) | `start.place / place_id / google_place_id / lat / lng` | Where · start card · Change → the search | in |
| Passengers get in here (the start is Stop 1) | `start.passengers` | Where · start card · toggle | in |
| What gets in · Note at the start · Time at the start (with passengers) | `start.what / note / dwell_min` | Where · start card · More details (chips, text, minutes) | built B |
| Stop type Pickup / Drop-off / Visit | `stops[].type` | Where · chips on the stop | in |
| Stop place (search; a site id, a town, a Maps link) | `place_id / google_place_id / place / lat / lng` | Where · the search box (Part A) | in |
| "Same as the start · Tick it" (a first pickup at the start) | — (moves the row into `start.passengers`) | Where · the line under the stop with Tick it | built B |
| "<place> has no pin — the plan skips this leg" | `pinned: false` on the place | Where · red line under the stop | in |
| Arrive by | `stops[].arrive_by` | When · HH:MM on the stop | in |
| Time at this stop (15 / 30 / 1 h / 1 h 30 / 2 h / Other; "Usual here: …") | `stops[].dwell_min` | When · chips + Other on the stop | in |
| Details: What (people / goods / documents / other) | `stops[].what` | Where · chips under the stop | in |
| Details: Pin (lat, lng) typed | `stops[].lat / lng` | Where · More details on the stop · text (a pasted pin in the search box also works) | built B |
| Details: Note for the driver (300) | `stops[].note` | Where · More details on the stop · text | B-moved |
| Add stop · Remove · Move up / down (12 at most) | `stops[]` order | Where · + Add a stop, the row's arrows and X | in |
| Return to office · No expressway | `return_to_base`, `avoid_expressway` | Where · two toggles | in |
| Vehicle: Any / Car / Van / Double cab / Lorry / Other | `need_type` | Who · chips (Other added) | in (Other built B) |
| Passengers (0–80) | `pax` | Who · stepper | built B |
| Tools or equipment go too | `tools` | Who · toggle | in |
| A driver is needed (only while self-drive is allowed; "untick when the person drives a vehicle assigned to them") | `driver_required` | Who · toggle with the hint | in |
| Note (1000) | `note` | Who · More details · text (1000) | B-moved |
| Minutes at From / To (the two-stop form without stops) | `from_dwell_min`, `to_dwell_min` | — (the app always sends stops; the time at each stop is the stop's own) | n/a |
| Plan now · the timeline · the map · the reason when there is no plan · the warnings | plan_task | When (Plan now) and Review | in |
| Assign now (book_vehicle): Driver (the free drivers) | book_vehicle `driver` | Who · Book now card (with book_vehicle): the free drivers as rows | built B |
| Assign now: the vehicle in four groups (Free · Assigned to someone, ask first with Call / WhatsApp · Busy, back HH:MM · In the garage), each row's pick / but words; "The driver's vehicle on the day" and "Any van…" with the setting | book_vehicle `vehicle` | Who · Book now card · the groups as rows, the on-the-day chips | built B |
| Assign now: the default vehicle line ("WP CAB-4521 · Kamal's vehicle today. Pick another below", "Instead of …, Use …", "holds no vehicle today") | — | Who · the line under the driver | built B |
| Assign now: the custodian drives (no driver needed, a vehicle assigned to someone) | `driver_required: false`, `vehicle` | Who · the line "<custodian> drives it" when no driver is needed and the vehicle has a custodian | built B |
| Who's available (best match, Use, the rows' status) for people who book | availability | Who · the rows as on Assign (with book_vehicle) | built B |
| Save as waiting · Book now | create_request · book_vehicle | Review · two buttons (with book_vehicle), one without | built B |
| Booked: "<who> has <vehicle> on <when> · leave by", the vehicle used and why, the warnings, Open task | BookResult `vehicle_used`, `vehicle_changed`, `warnings`, `task_id` | Review · the outcome card | built B |
| Sent: "Sent to the fleet admin · you'll be notified" | `next` | Review · the outcome card | in |
| **Assign a task** | | | |
| Task (title, 120) | create_task `title` | Who · text (required: the button says why) | in |
| Date · Leave by with the check · Vehicle free by | `date`, `start_time`/`leave_by`, `end_time` | When (Back by reads "Vehicle free by" on a task) | in (the label built B) |
| The route (start, stops, switches) | `start`, `stops`, `return_to_base`, `avoid_expressway` | Where | in |
| The plan card with the overlaps as cards: the text, Open that task, Call / WhatsApp the requester and the driver, Pick another vehicle / driver | plan_task `conflicts[]` (`task`, `requester`, `driver`) | Review · conflict cards (Open that task with assign_tasks, Call / WhatsApp, Pick another → Who) | built B |
| Driver (the list; Who's available with the best match and Use; "Use suggestion") | `driver` | Who · the rows from availability, the best ticked with its reason | in (the reason line built B) |
| Vehicle: the driver's vehicle today / regular with its `why`; every vehicle; "The driver's vehicle on the day" / "Any van…"; "holds no vehicle today and has no regular one" | `vehicle` (absent = the driver's) | Who · chips (the driver's today · On the day · Any type · Choose…); Choose… lists the four groups | in (the groups built B) |
| Passengers (0–80) | `passengers` | Who · stepper | built B |
| Contact name · Contact phone | `contact_name`, `contact_phone` | Who · More details | B-moved |
| Notes for the driver (1000) | `notes` | Who · More details | B-moved |
| Charge to projects: rows (job no. / DU ID / name with the Zoho match line, percent), Split equally, the total must be 100, "Leave empty for Fame internal" | `projects[] {project, percent}` (find_project for the match) | Who · More details · project rows with the search (find_project), percent, Split equally, the total | built B |
| Label on the task card | `label` (default: the project's short name) | — (not on the site's form) | n/a |
| Buffer minutes | `buffer_min` (default: the fleet setting) | — (not on the site's form) | n/a |
| Send to driver: the app (always) · "Also give me a WhatsApp message" → the link after sending | — (the message built from the input; the driver's phone from list_drivers) | Who · More details · toggle; the outcome card's "WhatsApp the driver" | built B |
| "New tasks need the fleet admin's OK: this one waits for it" | `waiting_for_approval` | Review · the line under the button, "Send for approval" | in |
| After sending: "Sent to <driver>" / "Waiting for the fleet admin's OK", Leave by, the vehicle used and why (or changed), the warnings, the conflicts, Open task / The board / WhatsApp the driver | CreateTaskResult | Review · the outcome card (replaces the alert) | built B |
| The assign checks as warnings, never blocks | create_task `warnings[]` | Review · the outcome card | in |
| "Updating…" while a new plan comes; the plan shown stays | plan_task | Review · "Updating plan…" line while a plan is on screen | built B |
| The plan's "Leave by HH:MM · planned from the arrive-by times / as typed · estimated times" | `timeline.items[leave].source`, `plan.source` | Review · the line under Leave by | built B |
| The vehicle used and why on the preview ("WP CAB-4521 · Kamal's vehicle today") | plan_task `vehicle_used` | Review · the line under the driver chip | built B |
| A draft kept; a refresh never resets a pick | — | the draft on the phone | in |
| **Edit a request** (My trips) | update_request with `version`; only what changed | the same steps from the request | in (the requester's phone with the row above) |
| **Change the task** (Task detail): Title, Day, Leave by, Vehicle free again by, Passengers, Contact, Notes, Driver + Vehicle with Who's available; the words only while under way | update_task with `plan_version` | Task detail → Change the task: day / leave-by / end on the screen, the rest under More details, the driver and vehicle as on Who | built B (was: the time only) |
| **Change stops** (Task detail): the start with passengers / what / note, the stops, a leave time by hand | update_task_stops with `plan_version` | Where · When · Review in mode stops | in (the start's what / note with the row above) |
| **Approve** (design 10): another day / leave-by / back-by, the start, the minutes at From and To on approval | decide_request `date`, `leave_by`, `back_by`, `start`, `from/to_dwell_min` | Approve (10): "Change time" | O3 |
| Times with the native picker | — | the HH:MM field (mono, the colon added as typed; the site's control) | decision: a native picker needs `@react-native-community/datetimepicker` (a new native module = a 1.4.0 build); the typed field stays until then |
