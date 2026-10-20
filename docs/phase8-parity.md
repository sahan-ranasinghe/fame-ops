# Phase 8: parity of the office site in Office mode

Every function of the office site (apps/office, as built at main `003c749`, plus Hotfix 4), the tools it calls and the
permission it needs, with the Office-mode screen that does it and its status: **planned 8.x** → **built** → **tested** (the
tap test and the Part's tests), or **laptop only (decided)**. Every checkpoint of Phase 8 shows this table; a row moves only
with its screen's test. The numbers in brackets are the designs in `design/office/png/`. Built from a read-only inventory of
the site on 19 October 2026 (138 rows, with the privacy e-mail added after the Part 6 checkpoint).

**O1 (19–20 October 2026, branch `phase8-o1`):** "built O1" rows are on the phone against the live server after the O1 EAS
update; "O2" rows are the trip editor's round (New request / Assign a task, designs 06–09); "later" rows keep their Part.

**Part C of Hotfix O2-H1 (20 October 2026):** every row is one of **in the app**, **partial: …** (what is missing), **missing: …** or
**cannot on a phone: …** (why; "decided" = Sahan's earlier decision), with the round it goes to (O3 / O4). The ordered list for
O3 and O4 is in `docs/phase8-plan.md` section 18.

**O2 (19–20 October 2026, branch `phase8-o2`):** "built O2" rows are on the phone after the O1+O2 EAS update (the trip
editor 06–09, Ask drivers 13, the Drivers board 12, Issues, Task detail's extras, Live's trails and playback, the management
under More 19–20); "later" rows keep their Part; "laptop only for now" rows wait for an upload tool that is not web-only.

**Stage 0 and O3 (20 October 2026, branch `phase8-o3`, nothing published yet):** 141 rows: 124 in the app, 4 partial, 5
missing, 8 cannot. What is left is O4's (the 2-step code and the set-password link in the app, the Google and routing
counters, removing a browser's notifications, the sounds' settings, the Overview's collapsing per person) and the Drivers
list's links; the phone upload for photos and documents needed no server change (office-api already runs the upload tools
as channel web).

Permissions: V view, R request, Ap approve, AT assign_tasks, Veh vehicles, Iss issues, U users, ANY any office permission.

| Area | Function on the site | Tools | Permission | Office mode | Status |
|---|---|---|---|---|---|
| Sign-in | Sign in e-mail + password | Auth, GET /me | office acct | Sign in (01), 2-step code, set password from the link | in the app |
| Sign-in | Second step code / set up 2-step when required | Supabase MFA | — | Sign in (01), 2-step code, set password from the link | missing: the 2-step code page and "set up 2-step first" (O4) |
| Sign-in | Set password from one-time link (12+) | updateUser | — | Sign in (01), 2-step code, set password from the link | missing: set the password from the one-time link in the app (O4) |
| Sign-in | Blocked page + sign out | — | — | Sign in (01), 2-step code, set password from the link | in the app |
| Sign-in | 2-step on/off (web only) | MFA | ANY | — | cannot on a phone (decided): 2-step enrolment stays on the site; the code at sign-in is the O4 row above |
| Sign-in | Sign out | — | — | Sign in (01), 2-step code, set password from the link | in the app |
| Sign-in | Privacy page /privacy (no sign-in) | — | none | Sign in (01) footer and Profile (18) → /privacy | in the app |
| Shell | Menu sections collapsible, remembered | my_prefs, set_my_prefs | ANY | Tabs per permission + More (19) | in the app (replaced by the tabs and More's sections) |
| Shell | Menu badges requests waiting, open issues | fleet_overview, list_issues (+Realtime) | V / Iss or AT | Tab and More badges | in the app |
| Shell | Phone tab bar tabsFor | — | per tab | Tabs per permission (section 1) | in the app |
| Shell | More page (name, role, e-mail, phone, version, permissions, My profile, Security, Sign out) | — | — | More (19) + Profile (18) | in the app |
| Shell | Home big button homeAction | — | by role | Home big actions (02–04) | in the app |
| Shell | "N tasks need a driver · Show" banner on Tasks pages | fleet_overview | Ap or AT | Home: Needs a driver (03, 04); Tasks list banner | in the app |
| Shell | "Add your phone number" banner | /me phone_required | Ap or AT | Profile prompt after sign-in | in the app |
| Shell | Pull to refresh (phone) | — | — | Pull to refresh on every list | in the app |
| Shell | No access page | — | — | Not routed without the permission | in the app |
| Notifications | Tray All/Unread, by day, Mark all read | my_inbox (+Realtime), mark_inbox_read | ANY | Alerts (16) | in the app |
| Notifications | Bell → /inbox on phone | — | ANY | Alerts (16) | in the app |
| Notifications | Banner per new item + kind's sound | my_inbox, my_notification_settings | ANY | Alerts (16) | in the app (the badge; the sound and the banner are the phone's push, item 9) |
| Notifications | "Click to turn on sounds" | — | — | Alerts (16) | in the app (not needed: the phone's sounds) |
| Notifications | Inbox page All/Unread/History, search, paging | my_inbox, mark_inbox_read | ANY | Alerts (16) | in the app (O3): All / Unread, the search, how far back (archived), Load more |
| Notifications | Web push tap opens page | sw.js | — | A push tap opens its screen (native and web) | in the app |
| Overview | Sections by role, 5 rows (3 phone), View all, collapse | fleet_overview, prefs | V | Home (02–05) | partial: sections by permission, 5 rows, View all; missing the collapsing per person (O4) |
| Overview | Requests to approve + Decide | list_requests | Ap | Home (04): Requests to approve | in the app |
| Overview | Needs a driver (best match), row → change page | fleet_overview | Ap or AT | Home (03, 04): Needs a driver → Give it a driver (11) | in the app |
| Overview | Critical issues | fleet_overview | Iss or AT | Home (04): Critical | in the app |
| Overview | At a glance tiles | fleet_overview | V | Home (02–05) | in the app |
| Overview | Tile panels /?open= | list_vehicles, task_board, list_requests | V/AT/Ap/Iss | Home (02–05) | in the app (O3): every chip opens its list (Live, Vehicles free / in garage, Approve, Reminders); a phone has no side panel, the full page |
| Overview | On the road rows (driver link, Maps, WhatsApp, Call) | fleet_overview | V | Home (02–05) | in the app |
| Overview | Needs attention groups, expand | fleet_overview | Iss or AT | Home (02–05) | in the app (O3): Needs attention as the server's groups, expanding in place |
| Overview | Snooze / Dismiss row or group | update_issue | Iss | Issues: snooze / dismiss a group | in the app (O3): Snooze tomorrow / a week on a group (every issue behind it); Dismiss on the issue's page |
| Overview | My trips section | my_trips | R or AT | Home (02): My trips | in the app |
| Overview | New request / Assign task buttons | — | R / AT | Home big actions | in the app |
| Reminders | /reminders documents/services due + also needs attention | fleet_overview | Iss or AT | More → Reports → Reminders | in the app (O3): Reminders (from the Reminders chip): documents and services due, then the rest |
| Requests | List chips Waiting/Changed/Approved/Declined/Cancelled/All, search, paging | list_requests | V or R | Requests list and a request's page (not designed: 8.0) | in the app (O3): the Approve tab's search and one Filter (Waiting, Approved, Declined, Cancelled, All), Load more |
| Requests | "X is reviewing" | list_requests | — | Requests list and a request's page (not designed: 8.0) | in the app |
| Requests | Row Review / Task | — | Ap / task_detail | Requests list and a request's page (not designed: 8.0) | in the app |
| Requests | New request (on behalf, phone, project, trip editor, type, pax, tools, driver needed, note) | create_request, plan_task, search_places, save_place, google_place | R | Trip steps Where → When → Who → Review (06–09) | in the app |
| Requests | Book now (driver, vehicle groups, Who's available) | book_vehicle, suggest_vehicles, availability | Ap | Trip steps · Who with Book now | in the app (Part B: Book now on the Who step with book_vehicle; Save as waiting beside it) |
| Requests | Request detail (timeline, decided by, Call, trip) | list_requests | V or R | Approve a request (10) | in the app (O3): the request's page with its timeline, for the approver and for the person who asked (from My trips) |
| Requests | Edit request | update_request, plan_task | R or Ap | My trips (17): Edit · Withdraw | in the app |
| Requests | Withdraw own waiting request | cancel_request | R own | My trips (17): Edit · Withdraw | in the app |
| Requests | Cancel a booking | cancel_request | Ap | A request's page: Cancel booking (with undo) | in the app (O3): Cancel booking with a reason on an approved or changed request |
| Requests | Tell requester (WhatsApp text), requester's phone | update_request | Ap | Approve a request (10) | in the app (O3): Tell requester (the server's message in WhatsApp) and the requester's phone with Change / Add phone |
| Requests | Decide (driver, vehicle groups, Who's available, plan, Approve & send / Decline) | decide_request, suggest_vehicles, availability, plan_task, reviewing | Ap | Approve a request (10) | in the app |
| Requests | Re-decide a changed booking (keep/change/decline) | redecide_request | Ap | Approve a request (10) | in the app |
| Requests | Trip decide (send as proposed / move day, leave-by, back-by; times asked; decline) | decide_request | Ap | Approve a request (10) | in the app (O3): Change time (another day, leave-by, back-by, the start, the minutes at From / To), sent with the decision |
| Requests | Open the task from a request | task_detail | (route needs AT: bug) | Task detail (14), only with assign_tasks | in the app |
| My trips | List (range, status, kind, search, paging, Call/WhatsApp) | my_trips | R or AT | My trips (17); Home (02) action | in the app (Stage 0): the search and the Show filter with counts; one page of the range (no paging needed at 100) |
| My trips | New request button | — | R | My trips (17); Home (02) action | in the app |
| Tasks | Day board columns incl. Waiting for approval, Needs a driver; ETA, late | task_board | AT | Tasks list / board (not designed: 8.0) | in the app |
| Tasks | Day navigation + date picker | — | AT | Tasks list / board (not designed: 8.0) | in the app (Stage 0): the week strip with Today and the calendar, any day |
| Tasks | Column Load more | task_board | AT | Tasks list / board (not designed: 8.0) | in the app (O3): Load more on each column |
| Tasks | Needs a driver block / filter | task_board.needs_driver | AT | Tasks list / board (not designed: 8.0) | in the app |
| Tasks | Waiting-approval card → decide | — | Ap / own | Tasks list / board (not designed: 8.0) | in the app |
| Tasks | /tasks?task= link | — | AT | Tasks list / board (not designed: 8.0) | in the app |
| Tasks | Assign a task (full trip editor, plan + map, conflicts, driver + vehicle/on the day, Who's available, pax, contact, notes, projects, WhatsApp link, Assign & send / Send for approval) | create_task, plan_task, availability, get_settings, find_project, search_places, google_place, save_place | AT | Trip steps (06–09) | in the app |
| Tasks | Task detail (facts, Call, ETA, running late, contact, charged to, odometer/fuel photos/video, problems, history, warnings, unlogged km, plan + map) | task_detail | AT (route) | Task detail (14) | in the app (O3): unlogged km and warnings; under More details charged to, odometer and fuel photos with the video links, problems, history, the plan map |
| Tasks | Task route map (GPS km, points, gaps) | driver_route | AT or Veh | Task detail (14) | in the app (O3): Show the driven route (driver_route task_id: the line by speed, GPS km, playback) |
| Tasks | Save as our place (reached Google stop) | save_arrival_place | Veh or AT | Task detail (14) | in the app (O3): Save as our place on a reached Google stop |
| Tasks | Driver-started trip purpose / project | set_trip_purpose | AT | Task detail (14) | in the app (O3): a driver-started trip's purpose and project |
| Tasks | Reopen today's completed task | reopen_task | AT | Task detail (14) | in the app |
| Tasks | Type a missing swap odometer reading | swap_reading | AT or Veh | Task detail (14) | in the app (O3): Type the reading when a swap reading is owed |
| Tasks | Change the task / Give it a driver (TaskEdit) | update_task, availability, task_detail | AT | Needs a driver (11) / Task detail → change | in the app (Part B: Change the task — the title, day, leave-by, end, passengers, contact, notes, driver and vehicle; Give it a driver) |
| Tasks | Find a driver (/edit?driver=1) | update_task | AT | Needs a driver (11) / Task detail → change | in the app |
| Tasks | Cancel task with reason | cancel_task | AT | Task detail: Cancel task… (with undo) | in the app (with a reason; no undo: the phone asks first) |
| Tasks | Edit stops (Plan now, Save) | update_task_stops, plan_task | AT | Task detail → Change time or stops (07) | in the app |
| Tasks | History (range ≤366 d, filters, paging) | list_tasks | AT | Tasks → History (not designed: 8.0) | in the app (O3): Tasks → History (the range up to 366 days, the filters, Load more) |
| Dispatch | Who's available (best match, pick, tick + Ask drivers, Call/WhatsApp) | availability | Ap or AT | Trip · Who (08), Approve (10), Needs a driver (11) | in the app |
| Dispatch | Conflict cards | plan_task/create_task answers | AT | Trip · Who (08), Approve (10), Needs a driver (11) | in the app (Part B: the conflict cards before sending and on the outcome) |
| Dispatch | Location search (ours, used before, map/Google, pasted pin/link → pin map → save) | search_places, google_place, save_place | various | Trip · Where (06): the search | in the app (O3): the search, and a pasted pin or link checked on the map first (move the map under the pin, Use this point) |
| Dispatch | Drafts on 13 forms | localStorage | — | Save draft on the trip steps (06) | in the app |
| Live | Driver list chips All/On a task/On duty/Off duty/Problems | live_drivers (+Realtime driver_latest) | V | Live (15) | in the app (O3): the Problems choice in the Filter, with its count |
| Live | Map markers, pick | — | V | Live (15) | in the app |
| Live | Detail card (position, speed, battery, ETA, phone line, driver page, Maps, Call/WhatsApp) | — | V | Live (15) | in the app (O3): the speed and battery lines, the driver's page and Earlier days |
| Live | Today's route, points, gaps | driver_route | AT or Veh | Live (15) | in the app |
| Live | Today's trails (+Realtime location_points) | driver_route | AT or Veh | Live (15) | in the app (the first 10 sharing drivers, merged every 60 s; no Realtime growth on the phone) |
| Live | Watched mode | watch_drivers | V | Live (15) | in the app (O3): watched mode every 30 s while the tab is in front |
| Live | Clock out | clock_out_driver | AT or Veh | Live (15) → a driver's card | in the app (O3): Clock out from the card (no task running) |
| Live | Move to vehicle / Swap during a task | move_driver_vehicle, list_vehicles | AT or Veh | Live (15) → a driver's card | in the app (O3): Move to vehicle from the card; Swap vehicle while on a task |
| Live | Map controls zoom, compass, fit | — | — | Live (15) | in the app (O3): zoom in / out, fit everyone, the trails, the compass, on both engines |
| Drivers | List (search, switched-off, paging, Manage, links board/duty log/add) | list_drivers | V | Drivers (12), Ask drivers sheet (13) | partial: the Drivers tab is the list, a row opens the driver; missing the search (O3) |
| Drivers | Add driver (random PIN shown once) | create_driver | Veh | Manage a driver (20) | in the app |
| Drivers | Driver photo (web only) | photo_upload_url, set_driver_photo | Veh | Manage a driver (20) | in the app (O3): Take photo / Choose from photos on Manage a driver (the existing signed upload; office-api runs it as web) |
| Drivers | Profile sections Contact/Emergency/Licence edit, month, version, changes log | driver_profile, update_driver | Veh or U | Manage a driver (20) | in the app |
| Drivers | Licence photos (web only) | photo_upload_url, set_driver_licence_photo | Veh or U | Manage a driver (20) | in the app (O3): the licence's front and back on Manage a driver |
| Drivers | Not available add/change/remove | set_unavailability, remove_unavailability | Ap or AT | Manage a driver (20): This week; Drivers board Week | in the app |
| Drivers | New PIN | reset_pin | Veh | Manage a driver (20) | in the app |
| Drivers | Switch off/on | set_driver_active | Veh | Manage a driver (20) | in the app |
| Drivers | Driver page (route by speed, timeline, gaps, live growth) | driver_route, live_drivers, list_drivers, watch_drivers | AT or Veh | A driver's day (not designed: 8.0) | in the app (O3): today grows every minute; any of the last 90 days on the day strip |
| Drivers | Playback 1× 5× 20× 60× (web only) | — | AT or Veh | A driver's day (not designed: 8.0) | in the app (O3): the shared playback bar on the driver's page and the task's driven route |
| Drivers | Drivers board Now (filters, search, tick + Ask drivers, New task, Questions) | drivers_board | Ap or AT | Drivers (12), Ask drivers sheet (13) | in the app (O3): the board's search (Stage 0); New task for a driver from their page |
| Drivers | Board Week (‹ ›, add/change entry; phone one driver at a time) | drivers_board, set/remove_unavailability | Ap or AT | Drivers (12), Ask drivers sheet (13) | in the app |
| Drivers | Ask drivers (3 kinds, day/from/to, note, chosen or all free) | ask_drivers, drivers_board | Ap or AT | Drivers (12), Ask drivers sheet (13) | in the app |
| Drivers | Questions last 7 days | ask_answers | Ap or AT | Drivers (12), Ask drivers sheet (13) | in the app (O3): More → Questions and a question's page |
| Drivers | Answers (counts, chips, shared point, Call/WhatsApp, Assign on Yes) | ask_answers (+Realtime) | Ap or AT | Drivers (12), Ask drivers sheet (13) | in the app |
| Drivers | Duty log (range ≤62 d, driver, totals, paging) | duty_log | AT or Veh | More → Reports → Duty log | in the app (O3): the driver in Reports' Filter |
| Vehicles | Board chips, search, paging | list_vehicles | V | More → Vehicles (list and page; not designed: 8.0) | in the app |
| Vehicles | Vehicle detail | list_vehicles | V | More → Vehicles (list and page; not designed: 8.0) | in the app |
| Vehicles | Vehicle photo (web only) | photo_upload_url, set_vehicle_photo | Veh | More → Vehicles: add / edit / photos and documents by camera | in the app (O3): Take photo / Replace photo on the vehicle's page (1600 px + 256 px thumbnail) |
| Vehicles | Documents upload/replace/view/expiry/remove/restore/other | vehicle_documents, vehicle_document_upload_url, save_vehicle_document, update_vehicle, remove/restore_vehicle_document | Veh | More → Vehicles: add / edit / photos and documents by camera | in the app (O3): one row per kind, each document's screen with the photo, the expiry, the name (PDFs on a laptop); remove / restore stay on the website |
| Vehicles | Register vehicle | register_vehicle | Veh | More → Vehicles: add / edit / photos and documents by camera | in the app |
| Vehicles | Edit vehicle (garage booked, in garage, rent) | update_vehicle | Veh | More → Vehicles: add / edit / photos and documents by camera | in the app |
| Vehicles | Add rental company inline | add_rental_company | Veh | More → Vehicles: add / edit / photos and documents by camera | in the app |
| Maintenance | Problem reports list (filters, photos, Open task, Call) | list_vehicle_reports | Veh route; tool Iss | Issues → vehicle problems | in the app (O3): More → Maintenance (search, Filter, Load more), a report's page with photos, Open task, Call |
| Maintenance | Update a report (status, note, take off the road) | update_vehicle_report, update_vehicle | Iss (+Veh) | Issues → vehicle problems | in the app (O3): the status, a note for the driver, Also take it off the road |
| Maintenance | Service and document reminders | fleet_overview / list_vehicles | Veh | More → Reports → Reminders | in the app (O3): the Reminders page |
| Issues | List (range, status, kind, vehicle, severity, order, search, paging, Realtime) | list_issues | Iss or AT | Issues (not designed: 8.0) | in the app (O3): kind, vehicle and when opened added to the Filter; Realtime not in (read again on return and pull) |
| Issues | Issue panel/page (facts, links, photos, history) | issue_history | Iss or AT | Issues (not designed: 8.0) | in the app: the report's photos on the issue's page (they were already there) |
| Issues | Take / note / resolve / dismiss / reopen | update_issue | Iss | Issues (not designed: 8.0) | in the app (O3): Snooze from Home's Needs attention groups |
| Places | List (search, ours/Dialog/Mobitel/removed, no pin, paging) | list_places | Veh | More → Places (search, page, pin, remove / restore) | in the app (O3): More → Places (search, whose, pin, Load more) |
| Places | Restore | restore_place | Veh | More → Places (search, page, pin, remove / restore) | in the app (O3): Restore on a removed place |
| Places | Place page (pin drag/type, address, district, depot, save, remove pin) | place_detail, update_place | Veh | More → Places (search, page, pin, remove / restore) | in the app (O3): the page with the pin and Open in Maps, Edit (name, address, district, depot); dragging a saved place's pin stays on the website |
| Places | Remove (in use reasons) / restore | remove_place, restore_place | Veh | More → Places (search, page, pin, remove / restore) | in the app (O3): Remove with the in-use reasons, the second press confirms |
| Places | Import sites (web only; presets, mapping, batches, CSV, save preset) | list_import_presets, import_places, save_import_preset | Veh | — | cannot on a phone (decided): the site import |
| Places | Import history + undo | list_place_imports, undo_place_import | Veh | — | cannot on a phone (decided): the import history and undo |
| Mileage | Range, vehicle, driver; tiles; by vehicle, allowance, gaps, unlogged, odometer checks, personal km | mileage_summary | Veh | More → Reports → Mileage | in the app (O3): the vehicle and driver in Reports' Filter; the range control (Stage 0) has Yesterday and any days |
| Fuel | List (range, vehicle, driver, tiles, paging) | list_fuel | Veh | More → Reports → Fuel | in the app (O3): the vehicle and driver in Reports' Filter |
| Fuel | Fill detail (video pieces, bookmarks, receipt, links) | list_fuel, get_settings | Veh | More → Reports → Fuel | cannot on a phone until a build adds a video player (expo-video is a native module: 1.4.0); the receipt and the links are doable (O4) |
| Projects | Find a project | find_project | V or R | Trip · Review: the project split (find_project) | in the app (Part B: Assign's project rows search find_project; a request's project is typed and matched by the server, as on the site) |
| Projects | Copy the Zoho import message | (import_projects Claude only) | — | — | cannot on a phone (decided): the Zoho message |
| Settings | Settings home + security card | — | — | More (19) | in the app |
| Settings | My profile (own phone) | update_my_profile | ANY | Profile (18) | in the app |
| Settings | Users list | list_office_users | U | More → Office users | in the app |
| Settings | Add office user (presets, one-time link) | create_office_user | U | More → Office users | in the app |
| Settings | Manage user (name, phone, permissions) | update_office_user | U | More → Office users | in the app |
| Settings | New set-password link | reset_office_password | U | More → Office users | in the app |
| Settings | Claude connector keys new/revoke | create_office_key, revoke_office_key | U | — | cannot on a phone (decided): connector keys |
| Settings | Switch user off/on | set_office_user_active | U | More → Office users | in the app |
| Settings | Fleet settings (below) | get_settings, update_settings | U | More → Quick settings (19): the six quick keys | partial: the six quick keys; the other keys cannot on a phone (decided) |
| Settings | Privacy contact e-mail (Part 6: the public /privacy page's contact; removed = the office phone) | get_settings, update_settings `privacy_email` | U | — | cannot on a phone (decided): set once on the site |
| Settings | Google usage + caps | get_settings.google, update_settings | U | More → Reports: the counters (read) | missing: the Google usage counters (read) (O4) |
| Settings | Routing usage 14 days | routing_usage | U | More → Reports: read | missing: the routing usage (read) (O4) |
| Notif settings | This browser on/off (web only) | register_web_push, remove_web_push | ANY | Profile → Notifications on this phone (native push; web push on the web build) | cannot on a phone: web push is the browser's; the phone has its own push (item 9) — the mobile website (O4) keeps the browser's |
| Notif settings | Event toggles | set_my_notification_settings | ANY | Profile (18) → Notifications | in the app |
| Notif settings | Browsers with notifications: Remove | remove_web_push | ANY | Profile (18) → Notifications | missing: remove a browser's notifications from the phone (remove_web_push) (O4) |
| Notif settings | Sounds on/off, volume, Test, per kind | set_my_notification_settings | ANY | Profile (18) → Notifications | partial: the phone's channels ring and tone; missing the sounds' on / off, volume and Test (O4) |
| Maps | Google map after counted load; else MapLibre/drawn/no map | register_map_load | ANY | Every map (Live with trails and playback, the planner's map and route line, task detail, the places pin map): the driver app's one map component with both engines and its rules (Google by default, the automatic switch to the free map, the map package setting switches every phone, "Map not available"). Native app: the free Maps SDK, not counted. Web build: the counted load, no map at the cap, the free map with the package open | in the app (every map on both engines: Live, the driver's route, the plan map; the website's maps are O4) |
| Reports and lists | The date range control: Yesterday and a custom From / To (Mileage, Fuel, the Duty log, Issues, History) | — | V / Veh / AT | Reports: the four range chips | in the app (Stage 0): one date range button (Today, Yesterday, Last 7 days, This month, Last month, any days on the calendar) |
| Drivers | The Ask drivers page from the board's row (drivers/ask), a question's page (drivers/asks/:id) | ask_drivers, ask_answers | Ap or AT | The sheet (13) from the board, Approve, Give it a driver, the Who step | in the app (O3): Ask drivers from the board and Approve; More → Questions and a question's page |
| Shell | The site's search boxes (Requests, Alerts, the Drivers board, Places) | — | — | One search field at the top of every long list (the principle) | in the app (Stage 0 / O3): the search at the top of the Approve queue, Alerts, the Drivers board, Places |

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
| Day | `date` | When · Today / Tomorrow / +2 / Pick a date (14 days ahead) | in the app (Stage 0): Today / Tomorrow / Pick a date, any date |
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
| Time at this stop (5 / 15 / 30 / 1 h / 1 h 30 / 2 h / Other; "Usual here: …") | `stops[].dwell_min` | When · chips + Other on the stop (the start's time the same chips, Part B) | in |
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
| Who's available (best match, Use, the rows' status) for people who book | availability (the day, the leave-by floored, the back-by, the first stop — the start only when passengers get in there — the type and passengers) | Who · the rows as on Assign (with book_vehicle) | built B |
| Save as waiting · Book now | create_request · book_vehicle | Review · two buttons (with book_vehicle), one without | built B |
| Booked: "<who> has <vehicle> on <when> · leave by", the vehicle used and why, the warnings, Open task | BookResult `vehicle_used`, `vehicle_changed`, `warnings`, `task_id` | Review · the outcome card | built B |
| Sent: "Sent to the fleet admin · you'll be notified" | `next` | Review · the outcome card | in |
| **Assign a task** | | | |
| Task (title, 120) | create_task `title` | Who · text (required: the button says why) | in |
| Date · Leave by with the check · Vehicle free by | `date`, `start_time`/`leave_by`, `end_time` | When (Back by reads "Vehicle free by" on a task) | in (the label built B) |
| The route (start, stops, switches) | `start`, `stops`, `return_to_base`, `avoid_expressway` | Where | in |
| The plan card with the overlaps as cards: the text, Open that task, Call / WhatsApp the requester and the driver, Pick another vehicle / driver | plan_task `conflicts[]` (`task`, `requester`, `driver`) | Review · conflict cards (Open that task with assign_tasks, Call / WhatsApp, Pick another → Who) | built B |
| Driver (the list; Who's available with the best match and Use; "Use suggestion"; a driver known to hold no vehicle must get one) | `driver` | Who · the rows from availability, the best ticked with its reason; Next disabled with "Pick a vehicle…" when the driver holds none | in (the reason line and the known-none rule built B) |
| Vehicle: the driver's vehicle today / regular with its `why`; every vehicle; "The driver's vehicle on the day" / "Any van…"; "holds no vehicle today and has no regular one" | `vehicle` (absent = the driver's) | Who · chips (the driver's today · On the day · Any type · Choose…); Choose… lists the four groups | in (the groups built B) |
| Passengers (0–80) | `passengers` | Who · stepper | built B |
| Contact name · Contact phone | `contact_name`, `contact_phone` | Who · More details | B-moved |
| Notes for the driver (1000) | `notes` | Who · More details | B-moved |
| Charge to projects: rows (job no. / DU ID / name with the Zoho match line, percent), Split equally, the total must be 100, "Leave empty for Fame internal" | `projects[] {project, percent}` (find_project for the match) | Who · More details · project rows with the search (find_project), percent, Split equally, the total | built B |
| Label on the task card | `label` (default: the project's short name) | — (not on the site's form) | n/a |
| Buffer minutes | `buffer_min` (default: the fleet setting) | — (not on the site's form) | n/a |
| Send to driver: the app (always) · "Also give me a WhatsApp message" → the link after sending | — (the message built from the input; the driver's phone from list_drivers) | Who · More details · toggle; the outcome card's "WhatsApp the driver" | built B |
| "New tasks need the fleet admin's OK: this one waits for it" | `waiting_for_approval` | Review · the line under the button, "Send for approval" | in |
| After sending: "Sent to <driver>" / "Waiting for the fleet admin's OK", Leave by, the vehicle used and why (or changed), the warnings, the conflicts, Open task / Open the request / The board / WhatsApp the driver | CreateTaskResult | Review · the outcome card (replaces the alert) | built B |
| The assign checks as warnings, never blocks | create_task `warnings[]` | Review · the outcome card | in |
| "Updating…" while a new plan comes; the plan shown stays | plan_task | Review · "Updating plan…" line while a plan is on screen | built B |
| The plan's "Leave by HH:MM · planned from the arrive-by times / as typed · estimated times" | `timeline.items[leave].source`, `plan.source` | Review · the line under Leave by | built B |
| The vehicle used and why on the preview ("WP CAB-4521 · Kamal's vehicle today") | plan_task `vehicle_used` | Review · the line under the driver chip | built B |
| A draft kept; a refresh never resets a pick | — | the draft on the phone | in |
| **Edit a request** (My trips) | update_request with `version`; only what changed; an approved booking: "needs re-approval" notice, "Save · ask for re-approval", "the office will decide again" | the same steps from the request; Review's notice, label and outcome | in (the re-approval words built B) |
| **Change the task** (Task detail): Title, Day, Leave by with the departure check, Vehicle free again by, Passengers, Contact, Notes, Driver + Vehicle with Who's available (the new driver's vehicle named), "needs a driver" reason; the words only while under way | update_task with `plan_version` | Task detail → Change the task: day / leave-by (with Use HH:MM) / end on the screen, the rest under More details, the driver and vehicle as on Who; a running task: the words only | built B (was: the time only) |
| **Change stops** (Task detail): the start with passengers / what / note, the stops, a leave time by hand | update_task_stops with `plan_version` | Where · When · Review in mode stops | in (the start's what / note with the row above) |
| **Approve** (design 10): another day / leave-by / back-by, the start, the minutes at From and To on approval | decide_request `date`, `leave_by`, `back_by`, `start`, `from/to_dwell_min` | Approve (10): "Change time" | O3 |
| Times with the native picker | — | the HH:MM field (mono, the colon added as typed; the site's control) | decision: a native picker needs `@react-native-community/datetimepicker` (a new native module = a 1.4.0 build); the typed field stays until then |
