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
| Drivers | Driver page (route by speed, the day's summary card with "No trips recorded this day." for a day with nothing, stops as pins (the legend's pin), gaps, live growth) | driver_route, live_drivers, list_drivers, watch_drivers | AT or Veh | A driver's day (not designed: 8.0) | in the app (O3): today grows every minute; any of the last 90 days on the day strip |
| Drivers | Playback 1× 5× 20× 60× (web only) | — | AT or Veh | A driver's day (not designed: 8.0) | in the app (O3): the shared playback bar on the driver's page and the task's driven route |
| Drivers, Live, Tasks | Snap to roads ("Recorded points" on the site: the line along the roads where the map may draw it, the raw GPS line otherwise, the legend saying which) | driver_route (snap) | AT or Veh | A driver's day, Task detail (14), Live (15) | in the app (Round 48 item 5): the chip over the map on a driver's day, a task's driven route and Live's shown route, "Snapped to roads" / "GPS line", the note under the map or on the card; asked only on Google's map or under the open package (`office/snapLogic.ts`); Google's lines are never stored (the server's 30-minute memory) |
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
| My trips | Round 4–7 (4): a trip nobody drives with the app on the person's own account (/my-trips/:task): the vehicle check before setting off (All good with the four sides, or a problem: what it is, 1–6 photos, a note; the odometer; it starts the trip from 2 h before on its day, earlier it is only recorded; the switch off = the odometer alone) | my_trip, my_trip_check (photos uploaded to the person's own folder) | ANY (own trips) | My trips (17) → the row's Vehicle check → My trip (my-trip/[id]) → the check's step (my-trip/[id]/check); the notification /my-trips/<task> opens My trip | in the app (Round 4–7) |
| My trips | Round 4–7 (4): "Trip finished? Enter the odometer" (the start when there is none, the fuel added, an odometer photo) and "Enter the odometer" for a trip closed as Completed · not confirmed | finish_my_trip | ANY (own trips) | My trip → my-trip/[id]/finish (the fuel and the photo under More details) | in the app (Round 4–7) |
| Vehicles | Round 4–7 (4): Today's check and the last 7 days (a problem's note, photos and issue; a notification's ?check=<id> marked); none on the site while the switch `vehicle_check` is off | list_vehicles `check_today`, vehicle_checks | V (photos: Veh or Iss) | A vehicle (vehicles/[reg]): the Vehicle check section (a problem opens its report); the check first when opened from the notification | in the app (Round 4–7) |
| Issues | Round 4–7 (4): the Pre-trip tag; the kind Trip not confirmed | list_issues `pre_trip`, issue_history | Iss | Issues (row and page): the Pre-trip chip; the kind in the Filter and on the rows | in the app (Round 4–7) |
| Tasks | Round 4–7 (4): a task's vehicle check lines with the photos; Completed · not confirmed (grey, also on the board) | task_detail `vehicle_checks`, `finish_flag`, task_board | AT | Task detail (14): the Vehicle check section and the grey pill; Tasks and Home: the Not confirmed chip | in the app (Round 4–7) |
| Settings | Round 4–7: the five feature switches (Vehicle check before work, "Trip finished?" for self-drive trips, Fuel card at Start task, Passengers on trips, Who holds a busy driver or vehicle; on when absent); the site hides a switched-off feature's part (`screens/switchLogic.ts`, `useSwitch`) and follows a switch saved in Settings in the same tab without a reload (`store.refetchTool("get_settings")`) | get_settings, update_settings | U | More → Quick settings (19): Features | in the app (Round 4–7) |
| Vehicles | Round 4–7 (5): the fuel type (Petrol, Diesel, Hybrid (petrol), Electric) required on Register (Save waits with "Pick the fuel type"); an Edit starts from the vehicle's own and, for a vehicle with none, says "Fuel type: not set" in amber and saves the other changes (the site since the fresh review of 22 October 2026) and the grade that fits it (Petrol 92 / 95, Auto / Super Diesel; none for electric) | register_vehicle, update_vehicle `fuel_type` / `fuel_grade` | Veh | Register / Edit a vehicle (vehicles/form): the fuel type chips and the grade chips; the button waits with the reason above it | in the app (Round 4–7) |
| Vehicles | Round 4–7 (5): the vehicle's fuel on its page and in the list ("Petrol 92", "Diesel"; "Fuel type: not set" in amber, Set it for someone who may edit) | list_vehicles `fuel_type`, `fuel_grade`, `fuel_text` | V | A vehicle (vehicles/[reg]): the Fuel fact with Set it; the list's second line | in the app (Round 4–7) |
| Tasks | Round 4–7 (5): the driver's fuel card (Enough fuel · 07:42 / Fills up on the way / Not answered, the estimate under it; before the start the estimate alone); none while the switch `fuel_card` is off | task_detail `fuel_card` | AT | Task detail: the Fuel section | in the app (Round 4–7) |
| Fuel | Round 4–7 (§33.6): a fill's fuel ("Auto Diesel"); a missing amount is "–", never LKR 0; the totals add only the known amounts and say "N fills without an amount" (the tile and the month line) | list_fuel `fuel`, `totals.without_amount`, `month_totals.without_amount` | Veh | Reports → Fuel: each fill's fuel and "LKR –"; the tile and the month line with "N fills without an amount"; a task's fills "LKR –" | in the app (Round 4–7) |
| Requests, Tasks | Round 4–7 (6): Who rides on New request, Book now, Assign a task, Change the request and Change the task: office people by name (find_people: the photo, the name, the role) as chips with ✕, someone without an account (a name, an optional Sri Lankan phone); the count stays beside ("Asha, Kamal +3"); names alone on an edit = the ids and passenger_list; hidden with the switch `passengers` off | find_people; `passenger_list` on create_request, book_vehicle, create_task, update_request, update_task | R / Ap / AT | The Who step (Assign a task and Request a vehicle, the edit too): Who rides under the passengers (the search, the pick-many rows, the chips, the sheet for someone without an account); Review's chip; Change the task (task/[id]/time) | in the app (Round 4–7) |
| Tasks, Requests | Round 4–7 (6): who rides on a task (the count never under the names, a row each; someone without an account with Call / WhatsApp and Share trip) and on a request (Who rides); with the switch `passengers` off the count alone (no names, no Share trip) | task_detail `passengers_list` (`share`), list_requests `passengers_list` | AT / Ap / R | Task detail: Passengers; a request: Who rides | in the app (Round 4–7) |
| My trips | Round 4–7 (6): the trips the person rides in, tagged Passenger, view only (/my-trips/:task: the time, where it is now, the driver with Call / WhatsApp, the plate, the stops as they go); the passengers' notifications open it | my_trips `role: passenger`, my_trip (viewer passenger) | ANY | My trips: the Passenger tag → My trip (my-trip/[id]) as the passenger's view; /my-trips/<task> opens it | in the app (Round 4–7) |
| Dispatch | Round 4–7 (7): who holds a busy driver or vehicle on every conflict card (the photo or initials, the name and role, "Asked for it / Assigned it · 08:00–11:00", Call, WhatsApp, Ask for it → an optional note → the toast); none while `holder_contact` is off | plan_task, create_task, decide_request (proposal), book_vehicle, update_task, reassign_task `conflicts[].holder`; ask_for_it | Ap or AT (Ask: R, Ap or AT) | Review (09): the conflict cards; Approve (10): the proposal's conflicts as cards; the saved notice after Give it a driver (11), Change the task, Approve, Assign and Book now (the cards with Call, WhatsApp, Ask for it, Open that task) | in the app (Round 4–7) |
| Dispatch | Round 4–7 (7): a busy row's holder under Who's available and under the vehicles' busy group ("Anoja's · 08:00–11:00", Ask for the window shown) | availability `drivers[].holder`, `vehicles.groups.busy[].holder`, suggest_vehicles; ask_for_it | Ap or AT | Who's available on the Who step, Change the task, Give it a driver and Approve; the vehicle groups on Who, Approve and Change the task's Choose… | in the app (Round 4–7) |
| Notifications | Round 4–7 (7): an item's buttons (an Ask for it's Yes / No) in the tray, the banners and /inbox: the item's tool with its args as given, the item read, "You said Yes"; a failed answer "may not have been saved" with Try again; a holder.* item opens /tasks/asks for who cannot open tasks | my_inbox `actions`, answer_holder_ask, mark_inbox_read | ANY | Alerts (16): the buttons under the item, then "You said Yes"; a holder.* item without a task screen opens Asks | in the app (Round 4–7) |
| Tasks | Round 4–7 (7): Asks (/tasks/asks): To me · By me · All (approve); each row what · trip, when, who asked or holds it, the note, the answer chip; Yes / No on an ask to me; ?task= one trip with Show all; the site's More lists it (after the Timeline) and the Timeline has its button only while the switch `holder_contact` is on (a notification's link still opens it) | holder_asks, answer_holder_ask | R, Ap or AT (the tools: ANY) | More → Asks (holder-asks); a task's "Asks about this trip"; a holder.* notification | in the app (Round 4–7) |
| Tasks | Round 4–7 (7): "Asks about this trip · N" on the task page (none, and no 60-second holder_asks poll, while the switch `holder_contact` is off) | holder_asks | AT | Task detail (14): the same line, opening Asks for that trip | in the app (Round 4–7) |
| Drivers | Round 4–7 (7): Timeline (/schedule): Drivers \| Vehicles, the week strip, one row per driver or vehicle with the bookings as bars on 06:00–22:00 with the holder's photo, not available hatched, now on today; a booking opens its task | day_timeline | V | More → Timeline (timeline): the phone layout, a card per row with its track and its bookings (time, title, the holder) | in the app (Round 4–7) |
| Settings | Round 4–7 (item 9): Data retention (/settings/retention): each kind of data with the days it is kept (the minimum shown and checked before Save; the whole `retention` setting sent with the one change), what the next run removes, fuel videos' months, "Never removed", "Runs every night at 02:45", Run now (the preview's counts first, then Remove N now) | get_settings, update_settings `retention` and `fuel_video_keep_months`, retention_preview, run_retention {confirm} | U | More → Settings → Data retention (people/retention): a row per kind, a tap opens the days sheet; Run now with the preview, then Remove N now | in the app (Round 4–7) |
| Places | Round 4–7 (item 10): the empty place box in groups, Saved (the company's) and Recent (the person's own), and "<Name>'s recent" when someone else's request is edited or decided (for_request) | search_places {suggest, for_request} | ANY (for_request: Ap or AT) | The trip editor's Where: the place box's suggestions under their headers (WhereSuggestions); an edit of someone else's request passes its id | in the app (Round 4–7) |
| Shell | Round 4–7 (item 10): form drafts per person, dropped after `retention.drafts_days` (30) | get_settings `retention` | ANY | The trip editor's draft: one per person on the phone (never another's; sign-out keeps each person's), 30 days or the setting | in the app (Round 4–7) |
| Drivers | Round 4–7 (item 10): Questions to drivers are the person's own; "Mine · Everyone's" for approvers (?whose=all) | ask_answers {all} | Ap or AT (all: Ap) | More → Questions: the person's own; the Mine · Everyone's switch for approvers | in the app (Round 4–7) |

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

## Round 4–7, item 8: the list audit

Branch `r47-lists` (22 October 2026), from `docs/phase8-plan.md` §33.7 and the Round 4–7 UI rules (restructure, never
rebuild; remove nothing; every item mapped to its place; a test per reworked screen). Surfaces: **S** = the website
(`apps/office`), **O** = Office mode in the app, which is also **/m/** (its web build: the same screens). Status: **done**
(this branch), **described** (the file is another agent's in this round: the fix is written here for them), **later** (a
proposal, not built). Part 2 (branch `r47-lists2` from `9e5f240`, 22 October 2026) built every row that was described or
later; **proposed** = kept as it is, its removal proposed (below).

### The audit

| Page | Surface | Rows today (before) | Repeated text | Grouping | Paging | Bulk | Fix | Status |
|---|---|---|---|---|---|---|---|---|
| Issues | S | title / kind · detail · due / "Opened … · System · kind · taken by …" / snooze; plate, taker, status pill | the kind twice ("System · Vehicle problem"), the status pill = the filter | none | 25 a page (Load more / page numbers) | none | tabs Open · Snoozed · Resolved; Open grouped by kind (most urgent first, 3 newest, Show all N, collapsible); Gmail's row (kind icon tinted by severity, ONE title = headline, ONE grey line = plate chip · driver · when); status only when not implied; ticks + Resolve / Dismiss with one reason (update_issues); the badge = needs_action | done |
| Issues | O | tile / title / kind · detail · due / plate, taker, "Opened … · System · kind · taken by …" / snooze; Pre-trip, severity and status chips | the kind twice, severity twice (tile + chip), status = the section | none | 50, Load more | none | the same as S (tabs, groups in the shared Section with a severity dot and collapse, the icon is the tick, a long press ticks, the bar at the bottom, the reason sheet); the header counts needs_action | done |
| Maintenance | S | the drivers' problem reports (cards with their form) + "Reminders" rows from the overview (missed tasks and odometer checks included) | the reminders repeat Reminders and Issues | none | reports 25 a page; reminders 25 local | none | reports unchanged; "Service and documents" = one card per vehicle (service by km and date with its bar, document chips ok / expiring / expired / missing, the rental's end), the summary first, Need attention \| All vehicles; the rest (the drivers' licences included) counted in one line to Issues; the vehicles list failing shows its error with Try again | done |
| Maintenance | O | the problem reports only | the status chip = the section | none | 25, Load more | none | first view Service and documents (the same cards), second view Problem reports (unchanged; the Issues header opens it) | done |
| Reminders | S | "Documents and services due" rows, "Also needs attention" rows (each issue) | every issue counted as a reminder; the tile counted all active issues | two groups | 25 local per group | none | one card per vehicle with its reminders (each to the vehicle), the licences as rows, the rest counted in one line to Issues; the Overview tile counts these reminders only; the panel and the page start with the same number and what it is made of ("3 reminders · 1 vehicle · 1 driver licence") | done |
| Reminders | O | the same two sections | the same | two groups | all at once | none | the same as S; Home's reminders row counts service and documents only | done |
| Home / Overview "Needs attention" | O | the server's attention groups | — | by kind | 5 rows | Snooze a group | the count is needs_action (as the Issues header and the site's badge) | done |
| Overview | S | sections of 5 (3 on a phone) + View all; tiles | Reminders tile = every active issue | by kind | View all | Snooze / Dismiss a group | the Reminders tile counts service and document reminders | done |
| Task history | S | when / task + tags / driver / plate / route / status pill + times / km | the status pill = the Status filter | none | 25 a page | none | the pill only when the filter does not say it | done |
| Task history | O | time + day / title / driver · plate · route / label · times · km / chip | the chip = the Status filter; "Task history" in the header and the section | none | 25, Load more | none | the chip only when the filter does not say it; the section titled "Tasks" under the header's "Task history" (part 2) | done |
| Activity log | S | when / action · about / person · channel / reason / outcome pill | "Done" on nearly every row | none | **bug: 25 only on a desktop** (no page numbers) | none | page numbers on a desktop | done; hiding "Done" is a proposed removal |
| Activity log | O | time / action · about / day · person · channel / reason / chip | "Done" on nearly every row; the title twice | none | 50, Load more | none | the section titled "Changes" (the site's word) under the header's "Activity log" (part 2); hiding "Done" stays a proposed removal | done (the title); proposed ("Done") |
| Notification inbox | S | dot / who · title / body / "ago · unread" | "· unread" on every unread row (the dot says it) | none (the tray: Today / Yesterday / Earlier) | 25 a page | Mark all read | "· unread" for the screen reader only (the dot shows it) | done |
| Alerts (the inbox) | O | tile / title / body / time / "Open ›" | "Open ›" on nearly every row | Today / Yesterday / Earlier | 50, Load more | Mark all read | the chevron alone ("Open" the screen reader's hint; an item with no screen shows none, as before); the Unread filter asked of the server (my_inbox `unread`: Load more pages the unread ones) (part 2) | done |
| Requests | S | requester / project / when / route / need / status + steps / Review | the status pill = the filter (Waiting) | none | 25 a page | none | the pill only when the filter does not say it (every row under All; under Waiting a Changed one; RequestStatusPill itself unchanged, its use in the list only); the step under it without the status word ("10:42 by Palitha") (part 2) | done |
| Approve (requests) | O | avatar / title / requester · when · need · proposed / reviewing / chips | the requester up to three times; the chip = the section | none | 25, Load more | none | the title is the trip, the requester once in the line (a request with no trip words: the name as the title, the line without it); the chip only when the section does not say it (Changed under Waiting) (part 2) | done |
| Fuel | S (`Fuel.tsx`, another agent) | when / plate / driver / litres / LKR / odometer / video pill + "Video 0:47 · 16 MB" | "Video" twice | none | 25 a page | none | an uploaded video: the video icon ("Video uploaded" to the screen reader) with "0:47 · 16 MB"; the pill only for a fill without its video (on the phone, uploading, failed, none, pruned) (part 2) | done |
| Fuel | O (reports) | date + plate + Video / driver · litres · LKR · km · length / Watch video | — | none | 25, Load more | none | — | fine |
| Mileage | S | five tables (by vehicle, allowance, gaps, unlogged, checks) | — | by table | 25 local per table | none | — | fine |
| Mileage | O (reports) | the same five sections | — | by section | all at once | none | 5 rows per section, "Show all N" in its header (25), then Load more 25 at a time (one answer, nothing asked again) (part 2) | done |
| Duty log | S | driver / clock in (with the day) / out / hours / vehicles / tasks / km | — | none | 25 a page, totals row | none | — | fine |
| Duty log | O (reports) | driver + day / clock in (with the day again) → out / vehicles · tasks · km | the day twice | none | 25, Load more | none | the day once (in words), the clock-in its time | done |
| Drivers | S | avatar · name / code / username / phone / licence / vehicle / status / "N accepted · 0 declined" / Manage | "· 0 declined" on most rows | none | 25 a page | none | "· 0 declined" kept (it is the only place the zero is said; its removal stays proposed) | proposed |
| Drivers board | S | avatar / name / status pill + vehicle / last seen / Next / New task, Call | the pill echoes the Show filter | Attendance groups | all at once | Ask drivers (sheet) | under On a task, Off duty or Not available the chip says only what it adds ("Until ~15:40", "Since 07:40", "Back 13:00"; none for a plain "Off duty"); All and Free now keep the whole status (part 2) | done |
| Drivers (tab) | O | avatar + dot / name / vehicle / status sentence / Next · last seen / Call | the state twice (dot and sentence) | Attendance groups | all at once | Ask drivers (sheet) | the Not available pill (Call's place, as before) unless the Show filter says it; beside it, or under On a task / Off duty / Not available, the first line says only what the state adds ("Back 13:00", "Since 07:40 · usually starts 07:30"); the dot (presence colour) kept (part 2) | done |
| Drivers (People) | O | avatar / name / code · phone / on duty · plate / "active" + licence chips | "active" on every row (the filter's default) | none | 25, Load more | none | "active" only off the default (a switched-off driver keeps its chip) | done |
| Vehicles | S (`Vehicles.tsx`, another agent) | thumb + plate / make · seats / rented / regular driver / assigned / km bar / next service / Lic Ins Emi / status + availability | Lic / Ins / Emi on every row; the status pill and the availability line say the same; the status = the filter | none | 25 a page | none | one status (the availability line, the pill only for In garage); the document chips kept, a valid one quiet (a tick and its name, "valid" to the screen reader; expiring, expired, not set coloured as before) (part 2) | done |
| Vehicles | O (`vehicles/**`, another agent) | plate / make · seats / availability · holder · km / status pill + Lic / Ins / Emi | the status twice, the chips on every row, the plate twice without a make | none | 25, Load more | none | the same as S (the pill only for In garage or Returned; a valid document quiet); the title never the plate (no make: the type in words, else "Make not set") (part 2) | done |
| Places | S | name / address / kind pill / site id / district / "Pinned" or "no pin" | "Pinned" on nearly every row; the kind pill = the filter | none | 25 a page | none | Pin: a check named Pinned, the words for "no pin"; no Kind column under Dialog sites / Mobitel sites (part 2) | done |
| Places | O | name / site · address · district / removed / "No pin" or operator | the operator = the section ("Dialog sites") | by section | 50, Load more | none | the operator only outside its own section | done |
| Projects | S | a search page (find_project), not a list | — | — | — | — | — | fine |
| Projects | O | none (the pickers in Who and Purpose) | — | — | — | — | — | n/a |
| Office users | S | avatar / e-mail / phone / permissions / since / keys / Manage | — | none | 25 a page | none | — | fine |
| Office users | O | avatar / name / e-mail · phone / permissions / "active" | "active" on every row | none | 25, Load more | none | "active" only off the default | done |
| Questions (Asks) | S | question / day time · by · counts / note / open pill | — | none | 25 a page | none | — | fine |
| Questions (Asks) | O | question / name · time (no day) / counts with "N yes" / "N yes" pill | "N yes" twice; no day | none | 20, Load more | none | the day with the time in words; "N yes" once (the pill) | done |
| My trips | S (`MyTrips.tsx`, another agent) | when / trip / status pill + live text + approved by / driver | "Approved" up to three times; "Task I created" under that filter | none | 25 a page | none | the pill, what the live text adds ("14:20" after Done) and the decision with the pill's verb beside it ("[Approved] by Palitha · 10:42", the verb read to the screen reader); a decline's reason once; "Task I created" only under All; Passenger always (part 2) | done |
| My trips | O (`(tabs)/trips.tsx`, another agent) | cards in Waiting / Coming up / Done / Expired | the chip = the group | by state | 100 at once | none | the chip only when it differs from the section and the "Approved by" line; 25 with Load more (part 2) | done |
| Tasks board | S | columns with cards (status sentence) | the sentence echoes the column | by column | 25 per column | none | "Not confirmed" (not "Completed · not confirmed") in the Completed column; the sentence keeps its verb (its time needs it) (part 2) | done |
| Tasks (tab) | O | sections with rows (line + chip) | "Done" three times in DONE; the line and the chip say the same | by section | 50 per column | none | no Done chip in DONE, no Under way in On the way, no Sent / Seen / Accepted / Self-drive / Someone else beside the line that says it; Late, Not confirmed kept (`office/lists2Logic.ts` taskChipShown; `statusWords.ts` unchanged) (part 2) | done |
| Today | driver app | next task, later today (3), All tasks | — | — | — | — | — | done (another agent, §33.6) |
| Fuel / Mileage / Report | driver app | summary, Recent 5, See all (by month, 20 at a time) | — | by month | Load more | — | — | done (another agent, §33.6) |

### Inventory: every item of the reworked screens and its place (from the code at 1dceefc, the same as this branch's base)

**Issues (S, `screens/Issues.tsx`, `IssuePage.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Status filter: Active, Open, In progress, Snoozed (with its count), Resolved, Dismissed, All | Filter panel · Status | Filter panel · Status (all seven, the Snoozed count) **and** the tabs Open · Snoozed · Resolved as shortcuts (Resolved, Dismissed, All light Resolved) |
| Kind, Vehicle, Severity filters | Filter panel | Filter panel (unchanged) |
| Date range (Opened, this month by default) and "N more were opened outside these dates · Show the last 12 months" | top card; notice above the list | unchanged, on every tab (the notice also over the groups) |
| Search (title, plate, driver, detail) | top card | unchanged; words searched for list their results as one list |
| Order (Most urgent first / Newest first) | Sort menu | Sort menu on a list (the groups keep the most urgent first) |
| The list's title and count ("Active · 24") | list header | list header over the groups or the list ("Active · N", a kind's name on its list) |
| Row: the kind ("Vehicle problem · …") | first grey line | the icon (named for the screen reader, the kind as its tooltip) and the group's heading |
| Row: the title | title | the issue page's heading; the row shows the server's headline (the specific line) |
| Row: the detail | first grey line | the issue's page (the headline carries the specific) |
| Row: the due words | first grey line | the grey line's "when" (the server's meta uses the due words when there are some) |
| Row: "Opened … · System · kind · taken by … · closed …" | second grey line | the issue's page (Opened, Opened by, Taken by, Resolved / Dismissed with when and by); the taker's avatar on the row; on Resolved "by Sahan" / "closed automatically" |
| Row: the snooze ("Snoozed until … · by …") | third line | unchanged |
| Row: the plate | a chip at the right | the plate chip at the start of the grey line |
| Row: the taker's photo | right | right (unchanged) |
| Row: the status pill | every row | only when the filter does not say it (Active: In progress only; All: every row) |
| Row: Pre-trip | after the title | unchanged |
| Open an issue (panel on a desktop, a page on a phone; X, Esc, Back keep the filters) | row | unchanged |
| Take, Add note, Resolve (with the resolution), Dismiss, Reopen; the task, driver, call, WhatsApp, request links; the report with photos; the history | the issue's panel | unchanged |
| Loading skeleton, the error with Try again, "Couldn't refresh" over rows, Updating… | the list | unchanged (also for the groups) |
| Empty states (by status, search, filters, days) | the list | unchanged words, with an icon |
| Realtime reload within a second; 60 s watch | the page | unchanged (the groups too) |
| Load more (phone) / page numbers (desktop), 25 a page | the list | the lists (a kind's, Snoozed, Resolved, a search); the groups show 3 each with Show all N |
| The menu badge (open + in progress) | menu / More / tab bar | the same badge, counting needs_action (critical and warning, not snoozed); patched when an issue closes |
| new: ticks, "Select all N in this group", the bar (N selected · Resolve · Dismiss · Clear), the reason sheet (required, chips), update_issues | — | the list (with update_issues) |
| new: "N need action · N critical" | — | under the page's title |

**Issues (O, `app/office/issues/index.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Header "Issues · N" (open + in progress) | dark header | dark header, N = needs_action |
| Chips: N open, N in progress (tap = that status), N snoozed | dark header | unchanged; N snoozed now opens the Snoozed tab |
| "Vehicle problems reported by drivers ›" (with list_vehicle_reports) | dark header | unchanged; opens Maintenance on its Problem reports view |
| Search (sent half a second after the last key) | FilterBar | unchanged |
| Filter sheet: Status (Active, Open, In progress, Resolved, Dismissed, with counts), Severity (with counts), Kind, Vehicle, Opened | Filter sheet | unchanged (the severity's row counts on a list; the groups ask the server for the severity) and the tabs Open · Snoozed · Resolved |
| Sort (most urgent / newest) | FilterBar | unchanged (it orders the groups' rows too) |
| Row: severity tile | left | left: the kind's icon tinted by severity (the tick with update_issues) |
| Row: title; "kind · detail · due"; plate + taker + "Opened … · System · …"; snooze | the row | ONE title (headline); ONE grey line (plate chip · driver · when, in words); the taker's avatar at the right; the snooze line; the kind → the icon's label and the group's heading; the detail and who opened it → the issue's page |
| Row chips: Pre-trip, severity, status | right | Pre-trip, severity (kept; its removal is proposed), status only when the tab does not say it |
| A row opens its issue (Take, note, Resolve, Dismiss, Reopen there) | row | unchanged (while rows are ticked, a tap ticks) |
| Skeletons, the error with Try again, "Couldn't refresh", pull to refresh, read again on focus | the screen | unchanged |
| Load more (50, the cursor) | the list | unchanged on a list; the groups: Show all N |
| Empty states | the list | unchanged words, with an icon; Snoozed has its own |

**Maintenance (S)**: the problem reports (status in the URL, search, Status filter, each report's photos, Open task, Call driver, Status, Note for the driver, Also take off the road, Save, 25 a page) — unchanged. "Service and documents · Reminders" rows → each vehicle's card (documents, service, rental end, garage booking); the rows that were not service or documents (km allowance, licences, missed tasks, odometer checks, km gaps, late starts and the rest of the overview's list) → Issues (one line here counts them and opens Issues; the licences are also on Reminders); the empty line → the cards' empty line; the 25-at-a-time paging → the cards' Load more / page numbers. A person with vehicles but not issues: the reminders read off the vehicles list → the same cards (from list_vehicles). The vehicles list failing → its error with Try again (it was a skeleton for ever; the fresh review, 22 October 2026).

**Maintenance (O)**: the problem reports list (search, Filter: Not closed / Open / In garage / Closed / All, 25 with Load more, a row to its report: photos, Open task, Call, the status, the note, off the road, Save) → the Problem reports view, one tap from the screen's segmented control, and opened directly from the Issues header. More shows Maintenance with vehicles or issues (before: issues).

**Reminders (S page and the Overview's panel; O)**: "Documents and services due" rows (each to its vehicle) → the vehicle's card, its rows (each to the vehicle), with the service bar from list_vehicles; the driver licences → their rows (each to its issue); "Also needs attention" / "Also counted" rows (each to its issue) → one line "N more need attention · Open Issues" (every one of them is in Issues); the back link, the window ("Due in the next 14 days"), the empty states and the note kept. The tile (S) and Home's row (O) count the service and document reminders (before: every active issue).

**Home (O)**: Needs attention's groups, their expand, Snooze (tomorrow / a week) with Undo, View all → unchanged; its count = needs_action (before: the groups' count).

### Behaviour changes (with the reason)

- Issues open grouped by kind; the badge, the Office mode header and Home's Needs attention count needs_action (critical and warning, not snoozed), not every open issue (§33.7 rule 3: the badge said 24 when a few needed action).
- The Office mode Open tab leaves the snoozed out (they are on the Snoozed tab), as the site's Active did.
- Office mode Maintenance opens on Service and documents; the problem reports are its second view (one job per screen, §16; the Issues header opens the reports).
- The Reminders tile / row and page hold service and documents only; the rest is counted in one line to Issues (§33.7 rule 6; the evidence: Reminders repeated the missed tasks and odometer checks of Issues).
- The site's Activity log pages by number on a desktop (a bug: only 25 rows were reachable).
- Repeated words that the filter, the section or the tab already says are shown only where they add something: the status pill on Issues and Task history, "active" on People, the operator on Places, "Pinned" on the site's Places (a check named Pinned), "· unread" (for the screen reader), the day on the Duty log, "N yes" on Questions.

### Proposed removals (kept for now)

- Issues (S): the Filter's Status choices Snoozed, Resolved, Dismissed, All duplicate the tabs; remove them from the Filter once the tabs are accepted.
- Issues (S, O): the date range / Opened filter on the Open tab (this month by default): propose "any time" for the Open tab (an open issue is open whenever it was opened), which also makes the "outside these dates" note unnecessary.
- Issues (O): the Warning / Info severity chip on each row (the tile's tint, the group's dot and the screen reader's label say it; Critical keeps its chip).
- Activity log (S, O): the "Done" pill / chip on every done row (Refused, Failed and In progress keep theirs).
- Drivers (S): "· 0 declined" on the Last 30 days column.
- `ReminderList`'s "Also needs attention" group (S) and `dueFromVehicles` (S, `maintenanceLogic.ts`): no longer reached from the screens (kept with their tests).

### Tests

- S: `issuesLogic.test.ts` and `issuesPages.test.tsx` kept (4 assertions updated where the default view or the row legitimately changed: the first call is the groups', the row's grey line, the taker as the avatar, the paging tests on a kind's list); `issuesGroups.test.tsx` (groups, tabs, bulk, every action still there), `vehicleCare.test.tsx` (the rules, Maintenance's cards and actions, Reminders' cards), `listAudit.test.tsx`; `overviewOpen.test.tsx`'s two Reminders expectations updated; the e2e's issue row text and the L7 list (now a search) updated (CI runs them).
- O: `test:issues`, `test:maintenance`, `test:overview`, `test:office` keep every check and add the new ones; `tests/officeLists.test.tsx` (7).

### Part 2 (branch `r47-lists2`): inventory of every reworked list (from the code at 9e5f240)

The rules: the site's `screens/lists2Logic.ts`, Office mode's `office/lists2Logic.ts` (`office/statusWords.ts` unchanged:
it is shared with Home and the task page). A word the filter, the section or the row's own line already says is left
out; a fact the row alone carries (a time, a size, who decided, an action) always stays.

**Fuel (S, `screens/Fuel.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Date range (this week by default), Vehicle / Driver filter, the month line, the four tiles (Fills, Fuel, Videos, Without a video) | top | unchanged |
| Row: when, plate, driver, fuel, litres, LKR ("–" when none), odometer | the row | unchanged |
| Row: an uploaded video — the green "Video" pill (or "Video · interrupted") and "Video 0:47 · 16 MB · interrupted, 2 pieces" under it | Video cell | the video icon (green) with "0:47 · 16 MB · interrupted, 2 pieces"; "Video uploaded" to the screen reader and on hover; "Uploaded" when the answer has neither length nor size |
| Row: a fill without its video — On the phone, Uploading, Upload failed, No video, Pruned pills | Video cell | unchanged |
| A row opens the fill beside the list (`/fuel/:id`, the filters kept) | row | unchanged |
| Loading, "Adding up the fills…", the error, "Couldn't refresh", the empty line in words, Updating… | the list | unchanged |
| 25 a page (page numbers on a desktop, Load more on a phone), the count in the header | the list | unchanged |

**Vehicles (S, `screens/Vehicles.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Register vehicle (register_vehicle); the search (plate, make, driver, custodian, holder); the Show filter with the fleet's counts (?filter=) | top | unchanged |
| Row: photo + plate, make · seats · fuel, "Fuel type: not set · Set it" (update_vehicle) | Vehicle | unchanged |
| Row: rented from, until; regular driver; Assigned to with the note, Call, WhatsApp (or Pool); km this month with its bar or "no km allowance set"; next service (toned) | the row | unchanged |
| Row: Lic / Ins / Emi chips (green ok, orange, red, dashed not set) with the expiry on hover; "no document" and what is missing | Documents | the same chips; a valid one quiet (a tick and its name, no fill; "valid" to the screen reader; the expiry on hover); expiring, expired, not set and "no document" coloured as before |
| Row: the status pill (Available / On a task / In garage) and the availability line under it | Status | ONE status: the availability line ("Free", "On a task · back ~14:30 (live)", "Booked later today · 15:00") in its tone; the pill only for In garage (then no line saying it again); an answer without the line keeps the pill |
| The legend under the board | bottom | unchanged, plus "A tick = valid" |
| A row opens the vehicle beside the list (the filter kept); 25 a page, the count; loading, empty, error, Couldn't refresh | the list | unchanged |

**My trips (S, `screens/MyTrips.tsx`)**

| Item | Old place | New place |
|---|---|---|
| New request (create_request); All · Requests · Tasks I created; the date range; the Status filter; the search; the totals line | top | unchanged |
| Request row: when, back by; Task pill and title on a proposal; the route (a link); N stops; for X; the project | When, Trip | unchanged |
| Status: the live pill (or the Expired badge) | Status, first line | unchanged (the first thing in the status line) |
| Status: the live text ("Approved", "Completed · 14:20", "Driver accepted · 10:42") | its own line | beside the pill, only what it adds ("14:20", "10:42", "Its leave time has passed"); left out when it is the pill's word or a decision line carries it (a decline's reason) |
| Status: "Approved by Palitha · 10:42", "Declined by … · reason", "Cancelled by … · reason" | lines under | beside the pill when its verb is the pill's ("[Approved] by Palitha · 10:42", the verb read to the screen reader); a line of its own otherwise ("Approved by …" under On the way) |
| Call fleet admin, Request again (expired), the trip's action (Vehicle check / Trip finished? / Enter the odometer) | Status | unchanged |
| Driver and vehicle (photo, chip, thumbnail, make), Call driver / "Not assigned yet" | Driver | unchanged |
| Created task row: "Task I created" pill | Trip | only under All (under "Tasks I created" every row is one); Passenger always |
| Created task row: title (link), route, stops, label; status as above; the approver's line; the driver; opens the task (a passenger's: its view) | the row | unchanged (the status said once as above) |
| Call office card; loading, the error with Try again / Open permissions, the empty line in words; Load more / page numbers, 25 | the page | unchanged |

**Requests (S, `screens/Requests.tsx`; RequestStatusPill unchanged, its use in the list only)**

| Item | Old place | New place |
|---|---|---|
| New request (desktop, phone); the Status filter (Waiting by default; Changed, Approved, Declined, Cancelled, Expired, All); the search | top | unchanged |
| Row: requester with avatar · for X, or Task pill + title + "proposed by" / the proposal line; asked; project; when, back by; route, stops; need or passengers; who drives | the row | unchanged |
| Row: the status pill | Status | only when the filter does not say it: every row under All; under Waiting (which holds the changed ones) a Changed one; none under a one-status filter |
| Row: "Leave-by passed" pill; "X is reviewing" | Status | unchanged |
| Row: the step line ("Approved · 10:42 by Palitha", "Seen by the office · …", "sent 2 h ago", "booked directly") | under the pill | a step that is the row's status says only what it adds ("10:42 by Palitha", "Needs re-approval · 11:05"); the others unchanged |
| Review (decide_request, waiting / changed) or Task → (canOpenTask) | right | unchanged |
| A row opens the request beside the list; 25 a page; loading, error, Couldn't refresh, empty in words | the list | unchanged |

**Drivers board (S, `screens/DriversBoard.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Ask drivers (sheet), Questions; the search; the Show filter with counts; Now · Attendance · Week; the ask's status line with All answers → | top | unchanged |
| Row: photo, name, licence pill, the status chip, the vehicle chip, not available, last seen · usual start, Next, the answer line, Call / WhatsApp, New task or Assign → | the row | unchanged, except: under On a task, Off duty or Not available the status chip says only what the filter does not ("Until ~15:40", "Since 07:40", "Back 13:00"; no chip for a plain "Off duty"); All and Free now keep the whole status |
| Attendance groups and Week (‹ ›, This week, "+", an entry to change or remove, one driver at a time on a phone) | views | unchanged |

**Tasks board (S, `screens/Tasks.tsx`)**: the needs-a-driver block, History, Assign a task, the week strip, the waiting-
approval column, each column with its count and Load more, the card (time, label, title, tags, route, leave by, ETA, late,
the driver's late word, the driver card, the status sentence, "Approved by …") and a card opening its task — unchanged.
The finish flag chip in the Completed column → "Not confirmed" (was "Completed · not confirmed"; its words on hover as
before); "Completed early" and the chip in any other column unchanged. The status sentence keeps "Done 11:40 · 42 km
logged": its verb tells its time from the card's own time at the top.

**Places (S, `screens/Places.tsx`)**: Import sites, the search, the Places filter (Our places, Dialog sites, Mobitel
sites, Removed places), Without a pin, the count, rows opening the place, Restore on removed ones, the empty lines —
unchanged. The Kind column (its header and its pill) is left out under Dialog sites and Mobitel sites (every row said
"Site · Dialog" / "Site · Mobitel"); kept under Our places (Office / Saved / Site differ) and Removed places.

**My trips (O, `app/office/(tabs)/trips.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Request a vehicle (create_request); the search; the Filter (All, Waiting, Coming up, Done, Expired, with the counts of the trips loaded); "Request withdrawn." | top | unchanged |
| Sections Waiting · Coming up · Done · Expired | the list | unchanged |
| Card: Passenger tag; title; the line (when · back by · need · driver · who drives · plate); "Changed by the office …" | the card | unchanged |
| Card: the state chip (with the calendar icon when expired) | right of the title | only when it says something the section and the "Approved by" line do not: no Waiting in WAITING, Done in DONE, Expired in EXPIRED, Approved beside "Approved by …"; Accepted, On the way, Arrived, Sent, Changed, Declined, Cancelled, Missed stay |
| "Approved by Palitha · Sun 16:40" with Call; the trip's action; Edit; the expired line; Request again; Withdraw (the reasons sheet, its error with Try again) | the card | unchanged |
| A card opens the request (a passenger trip: its view) | card | unchanged |
| 100 trips at once | the list | 25 at a time with Load more (my_trips' cursor; the error with Try again; "No trips under this filter" only when nothing more is to load) |
| Skeleton, the error with Try again, Couldn't refresh, the empty states with their actions, pull to refresh | the screen | unchanged |

**Approve (O, `app/office/(tabs)/approve.tsx`)**

| Item | Old place | New place |
|---|---|---|
| "N new requests ↑" (the quiet look every minute); the search; the Filter (Waiting, Approved, Declined, Cancelled, Expired, All); ?status= from Home | top | unchanged |
| Row: avatar (the requester), title (the trip, else the requester), line (requester · when in words · need · proposal) | the row | the title is the trip (title, route or project); the requester once: in the line, or as the title when the request has no trip words (the line then without the name) |
| Row: "X is reviewing" / "Leave-by passed" / the asker's licence line | line 2 | unchanged |
| Row: New chip; the status chip (expired with its icon); asked in words | right | New and asked unchanged; the status chip only when the section does not say it (a Changed one under Waiting; every chip under All) |
| A row opens the request; Load more with its error; skeleton, error, empty | the list | unchanged |

**Alerts (O, `app/office/(tabs)/alerts.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Mark all read (with its error and Try again); the search; the Filter (All / Unread with the count; Last 30 days / Older) | top | unchanged; Unread is asked of the server (my_inbox `unread`), so Load more pages only the unread ones (before: the 50 loaded, filtered on the phone) |
| Today / Yesterday / Earlier | groups | unchanged |
| Row: the kind's tile, title (bold while unread, the amber edge), body, "08:14 · 48 min ago" | the row | unchanged |
| Row: "Open ›" (an amber pill) on a row that opens a screen | foot | the chevron alone (grey); "Open" is the row's screen reader hint; a row with no screen shows none, as before |
| A tap: marked read at once (put back if refused), the screen opened | row | unchanged |
| An item's Yes / No (InboxActions, Round 4–7 feature 7) | under the row | unchanged |
| Load more, skeleton, error, Couldn't refresh, the empty states | the list | unchanged |

**Mileage (O, `app/office/reports/index.tsx`)**: Mileage · Fuel · Duty log, the date range, the Filter (vehicle, driver),
the tiles, personal km, the notes under each section's title, the empty lines — unchanged. Each section (By vehicle, the
month's allowance, Biggest gaps, Unlogged km, Odometer checks): its first 5 rows; "Show all N" in its header shows 25,
then Load more 25 at a time with "25 of N" (before: every row at once). One answer: nothing is asked again; another range
or filter starts each section again at 5; a pull to refresh keeps what was opened. Fuel and Duty log unchanged.

**Drivers (O, `app/office/(tabs)/drivers.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Now · Attendance · Week; the search; the Filter (All, Free now, On a task, Off duty, Not available with the counts); Ask drivers (the bar and its sheet) | top / bottom | unchanged |
| Row: avatar with the state's dot; name; the vehicle chip | the row | unchanged (the dot is the presence colour, as Slack's and Teams') |
| Row: line 1, the status sentence ("Not available, back 13:00", "On a task until ~15:40 (live)"), an off-duty driver's usual start | line 1 | beside the Not available pill, or under the filter of the same state, only what it adds ("Back 13:00", "Until ~15:40 (live)", "Since 07:40 · usually starts 07:30"; nothing for a plain "Off duty"); otherwise unchanged |
| Row: line 2 (next, last seen, starts) | line 2 | unchanged |
| Row: the Not available pill in Call's place; Call | right | the pill unless the filter is Not available (then nothing, as there was no Call); Call unchanged |
| Attendance rows (their own line, the pill) and Week (cells, + Not available, Remove with its confirmation) | views | unchanged |

**Tasks (O, `app/office/(tabs)/tasks.tsx`)**: History, the week strip, Assign a task, Needs a driver with Give a driver,
the sections with their counts and Load more, Waiting for approval, a row opening its task, the line (driver · the
sentence), the driver's late word — unchanged. The chip: none where the section or the line says it (Done in DONE, Under
way in On the way, Sent / Seen / Accepted beside the same sentence, Self-drive / Someone else beside the line that names
who drives); Late N min, Not confirmed and a chip the line does not say stay.

**Vehicles (O, `app/office/vehicles/index.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Register vehicle; the search; the Filter with the fleet's counts (?filter= from Home); the count in the header | top | unchanged |
| Row: the plate | left | unchanged |
| Row: title make · seats, else the plate again | title | make · seats, else the type in words ("Van"), else "Make not set" (never the plate twice) |
| Row: line (availability · with X now / assigned to X · km of allowance); line 2 the fuel ("Fuel type: not set" amber) | lines | unchanged, except the availability left out when it is "In garage" (the pill says it) |
| Row: the status pill (Available / On a task / In garage / Returned) | right | only In garage (amber) and Returned; an answer without the availability line keeps the status pill |
| Row: Lic / Ins / Emi pills | under the row | a valid one quiet (a green tick and its name, "Lic valid" to the screen reader); expiring, expired and not set as before |
| A row opens the vehicle; Load more; skeleton, error, empty with Register | the list | unchanged |

**Task history and Activity log (O)**: the header keeps the title ("Task history", "Activity log"); the section under it
names what it holds ("Tasks", "Changes": the site's list headers), with its count. Everything else unchanged.

### Part 2: behaviour changes (with the reason)

- My trips (O) loads 25 at a time with Load more (my_trips' cursor; before 100 at once): the audit's paging rule. The
  Filter's counts stay those of the trips loaded (as before); "No trips under this filter" waits until nothing more is
  to load.
- Alerts (O): Unread is asked of the server (my_inbox `unread`), so Load more pages the unread ones (before, the filter
  hid the read ones among the 50 loaded and Load more brought read ones too).
- Mileage (O): 5 rows a section, Show all, Load more (the audit's "the summary first, the recent N, See all").
- The Drivers tab (O) under the Not available filter shows no Not available pill (the filter says it); the row's right
  side is then empty, as before (no Call for a driver who is not available).
- A word the filter, the section or the row's line already says is shown once (the status pills and chips listed above,
  "Video", "Approved", "Task I created", the Kind column, the plate, the section titles). Each such word stays where it
  carries something (a time, who, a tone where the row has nothing else) and is read to the screen reader where the
  picture says it (the video icon, a valid document, the approval's verb).
- The Tasks tab's Sent section loses its Sent / Seen / Accepted chips (the line says the same with its time): the
  green / amber colour of those chips is gone there; the words are kept.

### Part 2: proposed removals (kept for now)

- Drivers (S): "· 0 declined" in the Last 30 days column (kept: the zero is said only there).
- Activity log (S, O): the "Done" pill / chip on every done row (from part 1; kept).
- The Tasks tab (O): the Waiting chip on every row of "Waiting for approval" (the section says it; kept because its red
  colour is the only sign of a late one there: removing it needs a "late" word first).
- Vehicles (S, O): the document chips of a vehicle whose three documents are valid could become one "Documents valid"
  line (kept as three quiet chips, so each document's state and expiry stay on the row).

### Part 2: tests

- S: `screens/lists2.test.tsx` (14): the rules, and per list its key actions with the new rows (Fuel: rows, date range,
  Filter, pages, a row opening; Vehicles: Register, search, Filter, Call / WhatsApp the custodian, a row opening, the one
  status, quiet valid documents; Requests: Review, Task →, New request, search, Filter, pages; My trips: New request,
  Show, date range, Filter, search, Call, a row opening, Passenger; Drivers board: New task, Call, Ask drivers,
  Questions, search, Filter; Tasks: Assign a task, History, the day strip, a card opening; Places: search, Filter, a row
  opening, Restore). `MyTrips.test.tsx`: two expectations of the status line updated (the words shown: "On the way
  09:30", "Declined by Palitha · …" without "Declined · no vehicle that day" again; the created task's "On the way
  08:10"). Every other site test unchanged; the e2e's Fuel check ("Video", "0:41") and My trips checks ("Waiting",
  "Approved", "Approved by E2E HF2 One") hold as written (the words are in the cells, the verb for the screen reader).
- O: `tests/officeLists2.test.tsx` (9 through the router: My trips' chips and Load more with Passenger, Call, Withdraw,
  Request a vehicle; Approve's requester and chips, All, a row opening; Alerts' chevron, Unread asked of the server,
  Mark all read, a tap opening and marking read; Mileage's 5 / Show all / Load more; Drivers' state once under each
  filter, Call, Ask drivers, a row opening; Tasks' chips, Assign a task, History, a row opening; Vehicles' one status,
  quiet documents, Register, Filter, Load more, a row opening; Task history's and Activity log's titles, Load more);
  `scripts/test-lists2.ts` (53 checks: the rules in both languages, the strings, the screens' source; the lead adds
  `"test:lists2": "tsx scripts/test-lists2.ts"` to package.json). `scripts/test-inbox.ts`: the Alerts source check now
  reads `inboxWithUnread(inboxArgs(LIMIT, search, archived), filter)` (the Unread filter asked of the server).
- The strings: `apps/driver/src/i18n/parts/lists2.json` (13 keys under `office.lists2`, English and Sinhala), for the
  lead's merge into en.json / si.json.

## Round 4–7, item 12: the screens built to the approved mockups (22 October 2026)

`design/mockups/2026-10-22` (mockups 1–4: Office mode's Home, Review, the request to approve, the trip on the way; the
site at a desktop's width). Restyled in place, nothing removed (§33.13). No row of the table above changes its status: every
function is where it was or one tap away (⋯ More). The rows that moved, and what is new:

| Area | Function on the site | Office mode before | Office mode now |
|---|---|---|---|
| Requests | Decide: Change time (Trip decide's day and times) | a button above the decision | ⋯ More in the bottom bar (Decline · Approve · ⋯) |
| Requests | Ask drivers (from Who's available) | the section's link | the section's link and ⋯ More |
| Requests | Cancel a changed booking | a button at the end | ⋯ More (an approved booking: the bottom bar) |
| Requests | Edit / Withdraw (the person who asked) | buttons at the end | the bottom bar |
| Requests | Who's available | every driver listed, the best match picked | the best match first, Choose another opens the rest in place |
| Requests | Call the requester | a button in the trip card | Call and (new) WhatsApp beside their name |
| Tasks | Change the task, Change stops, Swap vehicle, Reassign / Give it a driver, Reopen, Cancel task, Show the driven route | buttons at the end of the page | the bottom bar: the two used most for the task's state (office/detailBanner.ts `taskActions`), the rest under ⋯ More |
| Tasks | Live map of the running task | a row with Live map | the status banner (a tap opens Live) and (new) the map at the top with the driver's position (`live_drivers`) |
| Tasks | The trip's holder (`task_detail.task.holder`) | not shown | the trip's row: asked by / assigned by, Call, WhatsApp (website: the task page's "Asked for by" card) |
| Trip editor | Review's driver, who drives, passengers, project, contact | chips | rows; a tap (or Change / Edit) opens the Who step |

### Inventory: every item of the four screens and its place

**Home (Office mode and /m/, `app/office/(tabs)/index.tsx`; the site's Overview)**

| Item | Old place | New place |
|---|---|---|
| Greeting, date | top bar: greeting, the date under it | thin top bar: the date small above, the greeting in the heading font |
| Bell with the unread count (→ Alerts) | top bar | top bar, round with the red badge |
| My profile | More | More, and (new) the avatar in the top bar |
| Saved notice (after a save) | top of the page | unchanged |
| Tiles On the road / Free / In garage (each to its list; In garage with vehicles or issues) | a strip of tiles | the stats row with icons (blue, green, grey), the same links |
| The overview's error (Try again, Sign in again) | under the tiles | unchanged |
| Needs you now | a heading | the heading with the total (requests waiting + needs a driver + needs attention) |
| Requests to approve: 5 rows (photo, title, who · when · need · proposal, asked), each to its request; View all → Approve; skeleton, error, empty | a section card | a card under Needs you now; the row's tile (the photo, else the clipboard); "asked" in the meta line |
| Needs a driver: rows (title, when · line), Give a driver (assign_tasks) or the time pill; View all → Tasks (assign_tasks) | a red section card | a card under Needs you now; the red tile; the same button and pill |
| Needs attention: the server's groups (expand in place, each item to its issue), the severity chip, Snooze (tomorrow / a week, Undo in the snackbar), the count `needs_action`, View all → Issues | a section card | a card under Needs you now; a tile per group (a document or an alert; a chevron for a group) |
| Reminders (service and document) → Reminders | a row | a card row with the bell tile |
| Today's tasks: 5 rows (time, title, line, chip), Board, All today's tasks (N), empty with Assign a task | a section card before On the road | a list-look section after On the road (the mockup's order) |
| On the road: 5 rows (avatar, driver · plate, task · near, chip), each to Live with the driver; Live map | a section card | a list-look section; the plate as a chip beside the name |
| My trips: 5 rows, View all, empty with Request a vehicle | a section card | a list-look section |
| Pull to refresh, the 60 s reads, skeletons | | unchanged |
| New trip (Assign a task, Request a vehicle; a sheet with both) | the floating button | the floating button in the mockup's look |
| Site: the six tiles with their panels (?open=…) and the full pages on a phone | the "At a glance" tiles | one stats row with icons, the same links, panels and order (Hotfix 3: action first) |
| Site: a requester's "Need a vehicle?" | a notice | the status banner |

**Review (`app/office/trip/review.tsx`; the site: the plan of every trip form)**

| Item | Old place | New place |
|---|---|---|
| Back (one step), "New trip · step 4 of 4", the step bars | dark header | thin top bar; Back also (new) beside the primary in the bottom bar |
| The plan on the map (both engines) | full width, 300 px | a rounded card, 200 px |
| Re-approval notice, Planning…, Updating plan… | top | unchanged |
| The plan's reasons (what is missing) | amber lines | amber strips with an alert icon |
| The leave time when there is none (the clock) | a field | a card with the field |
| Leave by HH:MM, its note (planned / as typed · estimated) | a block | "Leave by · <day>" with the big time and its note |
| km · driving · ends / back at | a line beside the leave time | the facts row (distance, driving, back or ends, people) |
| The timeline: each stop's times, the arrive-by pill (on time / late), the legs with their source, rush hour, the expressway, back at base | rows | the route stepper (one meta line: the stay, the leave time, by; the chip; the leg under the stop, via the expressway kept); each leg in full with its source and the rush hour under ⓘ "How this was planned" |
| Conflict cards: the sentence, the holder (Call, WhatsApp, Ask for it), Open that task, Call / WhatsApp the requester and the driver, Pick another driver / vehicle | red cards | the same in the card look with an alert icon |
| The plan's notes | small lines | unchanged |
| Driver + plate | a chip | the driver row (avatar, plate chip, "Driver", ✓ Checked from today's vehicle check, Change → Who) |
| Who drives with no app | a chip | a row (→ Who) |
| Contact, notes, passengers, riders | chips | rows: the contact (→ Who), the note, who rides with their avatars (Edit → Who); (new) the task's projects (→ Who) |
| Vehicle: the plate · why | a line | under the driver row |
| Send request / Book now + Save as waiting / Send to <driver> / Send for approval / Save changes / Save trip, disabled with the reason, the spinner, Try again after a dropped send, the approval note | footer | the bottom bar (the reason under the buttons, in red) |
| Site: the plan (PlanTimeline) on Assign a task, a request, Book now, the edits, Approve | rows | on the stepper's rail (a mark per stop), the words unchanged |

**The request page (`app/office/request/[id].tsx`; the site: RequestDecide, TripDecide, the request's panel)**

| Item | Old place | New place |
|---|---|---|
| Title (the route), "Request / Proposed task · who · asked" | header | thin top bar: "Request · <day>" above the route |
| Status: waiting for your OK / changed · decide again / the status words / expired with its icon | a pill | the status banner (amber, green, red, grey) |
| Leave by HH:MM, asked when | the trip card | the banner's line ("Leaves 09:29 · 1 h ago") |
| Decided by / declined by / cancelled by with when and why | a section | the banner's line |
| Also looking, Leave-by passed | pills | pills under the banner |
| Expired · nobody decided it, Request again | a section | a card under the banner |
| Asked by (photo), need, project, on behalf of | the trip card | the requester card |
| Call the requester | a button | a round Call; (new) WhatsApp |
| The trip's stops, the totals | the trip card | the facts row and the route stepper (the plan's timeline when planned, else the stops as asked) |
| Notes (the request's, the proposal's) | a line | a note card |
| The new time with Undo (Change time) | above the decision | under the stepper |
| Change time | a button | ⋯ More |
| Tell requester | after a decision | unchanged |
| The proposal's conflicts with their holders | cards | unchanged |
| Who drives (asked, licence, the assigned driver with Call / WhatsApp, as asked · give a driver) | a section | a list-look section |
| Who rides | a section | a list-look section |
| The vehicle (approved as asked) | a section | a list-look section |
| Who's available: the drivers (best match, pills, presence, holders with Ask), Ask drivers | a section, every driver | "Best match" with the pick first, Choose another · N opens the rest; Ask drivers the section's link and ⋯ |
| The timeline (request_events) | a section | a list-look section |
| Approve (label by the pick, disabled with the reason, spinner), Decline… (the reason sheet) | sticky, stacked | the bottom bar: Decline · Approve · ⋯ |
| Cancel booking… | a button | the bottom bar (approved); ⋯ (changed) |
| Edit, Withdraw (the person who asked) | buttons | the bottom bar |
| Done (after a decision) | sticky | unchanged |
| Site: the decide pages | the page top | (new) the status banner "Waiting for your OK" with when it leaves and Call / WhatsApp the person who asked; Approve amber |

**The trip on the way (`app/office/task/[id].tsx`, `my-trip/[id].tsx`; the site: TaskDetail, PassengerTrip, MyTripPage)**

| Item | Old place | New place |
|---|---|---|
| Title, Task · start · asked by / made by | header | header, or (on the way) the map with a floating back button, the title in the trip's row |
| Status, late (the driver's report or the ETA), label, driver-started, completed early / not confirmed | pills | the status banner (on the way to <stop> · arrives about · back about, the late chip; needs a driver; the state in words) and the pills for the label, driver-started, the finish flag |
| Needs a driver since … · declined / not accepted | a red box | the banner (red) |
| Cancelled because, Missed · … | lines | the banner's line; the missed line unchanged |
| Warnings saved past, unlogged km, Asks about this trip | | unchanged |
| The five steps with their times, approved by, plan version | a card | unchanged (compact) |
| The driver (photo, who drives, plate, model, start odo), Call, WhatsApp | a card | the card with round Call (blue) and WhatsApp (green) |
| Where the driver is now (next stop, about, back about), Live map | a row | the banner (a tap opens Live with that driver selected: the site's `/live?task=<id>`; "Live map" in it) and (new) the map at the top |
| Vehicle taken / changed | lines | unchanged |
| The vehicle check (with the photos) | a section | a list-look section |
| Passengers (the count never under the names, a row each with Call / WhatsApp / Share trip) | a section | a card: their avatars and names, then the rows |
| The fuel card | a section | a row with the fuel pump |
| The trip's holder | — | (new) the trip's row: asked by / assigned by, Call, WhatsApp; a tap opens the request (approve) |
| Trip purpose (Change) | a card | unchanged |
| The stops: the start, the live timeline (planned / arrived / left, late or early, the estimate, confirmed later), the arrival point and Save as our place, back at base, the notes | a section | the route stepper (live rail), the same words and parts |
| Task km, GPS km; the vehicle swap's stretches and Type the reading | lines | unchanged |
| Change the task, Change stops, Swap vehicle, Reassign / Give a driver, Reopen (with its explanation card), Cancel task…, Show the driven route | buttons | the bottom bar (two by the task's state) and ⋯ More (the rest); Reopen's explanation stays as a card |
| Requester told of every change, Call the requester | a line | unchanged |
| More details (charged to, odometer and fuel with photos and videos, problems, history, Show the plan on the map) | the fold | unchanged |
| Passenger's view: Passenger, the live words, plate, leave · back by, the driver with Call / WhatsApp, the stops as they go, the note | a card of pills and lines | the status banner (the live words, the Passenger chip, leave · back by), the driver card, the route stepper, the note |
| No-app trip: its stops | lines | the compact stepper |
| Site task page | | (new) the banner on the way (a link to Live) or needing a driver (Find a driver); (new) the holder card; the map and the stops left, the people and the rest right when the page is wide (≥ 1360 px the panel takes more room); the rest unchanged |
| Site passenger's trip | a notice with the live pill | the status banner; the stops on the rail |

## Round 4–7, item 12: the driver's two screens (inventory, from the code at 1dceefc)

**Today (driver app, `app/(tabs)/index.tsx`)**

| Item | Old place | New place |
|---|---|---|
| Date, greeting | dark header | thin top bar ("Good morning / afternoon") |
| සිංහල / English | header pill | the same pill, light, top right (where the mockup draws a bell: drivers have no notification centre) |
| Off duty, hint, Start work | dark duty card | grey tile |
| On duty since, Office can see you | duty card line | the tile's subtitle |
| Plate, model; Change vehicle (not during a task) | duty card | vehicle tile, "· Change" |
| Finish work (asked first; not during a task) | duty card button | the tile's switch (the same question) |
| "Finish the task first." | under the buttons | under the tiles |
| Vehicle check card / Check now | a card under the notices | the vehicle tile: "Check needed" (amber; the same route and parameters), "✓ Checked" (green), "Problem reported" (red) |
| Offline line, vehicle taken, duty ended, notices, refused trip, tracking notice, the office's question, points waiting | under the header | under the tiles (unchanged) |
| NEXT TASK / IN PROGRESS | the card's label | the section head "Next task" / "In progress" with its chip (Leave in 25 min, Leave now, 12 min late, Tomorrow, a day) |
| Leave time, "Leave by · in 45 min", another day | the card's top | the big mono time + the chip |
| Title, Changed tag | card | the same |
| Stops (up to 4, Show all, Arrive by, the Google credit) | StopTimeline | the shared RouteStepper (S / numbers / B "Back at base", the plan's times, "by 11:00" as a chip; the credit under it) |
| "5 passengers · Contact: name number" | a muted line | "3 people · 197 km" + a call link to the first person; every person with WhatsApp under ⋯; a contact with no phone by name; the full line is the card's screen-reader label |
| Riders' names; the task's vehicle (only when not the held one); Not sent yet; swap; Accepted ✓ | card | the same |
| Accept + Start task / Start task / Open task; Running late; Can't do this task / Can't make it (+ the reasons sheet) | card | the same (56 px buttons) |
| The card opens the preview / the task; the empty state | card | the same |
| Start a trip | dark button | outline button (amber when nothing is next) |
| Later today / Coming up rows | rows | "Later today · N" list rows (time, title, people · km · From …, one chip, Changed, the credit) |
| All today's tasks + "N more later today"; pull to refresh; seen marks; contacts | screen | unchanged |

**The running task (driver app, `app/task/[id].tsx`)**

| Item | Old place | New place |
|---|---|---|
| Map (both engines, the fallbacks, the note) | top 40 % | top 50 % |
| Back | top left | the same (its screen-reader name "Back") |
| On duty / Off duty pill (a tap starts work) | top right | "● In progress since 08:21" (red with a tap that starts work when off duty) |
| IN PROGRESS + Started 08:21 | sheet head | the pill |
| Stop name, Google credit, title · people | sheet | the same, with "Next stop · n of N" |
| Refused trip, tracking notice, arrival card, swap card | sheet | the same, at the top |
| Fill up on the way · Log fuel | sheet | the same |
| Distance left (road or straight line) | stats | the grey stats box (+ "arrive about", "be there by") |
| Start odo, GPS km; the stop list (progress, Skip, the out-of-order slides, notes); Add a stop; All stops in Google Maps; passengers; every call with WhatsApp; Approved by; Running late | sheet | the stops sheet (the stops button) |
| The current stop's slide (arrive, override, waiting, leave, finish, Undo) | in the list | on the sheet ("Slide when you arrive"; the stop's name for the screen reader) |
| Navigate, Call contact | two buttons | Navigate (blue) + the call square |
| Complete task (disabled until the last stop) + its reason | sheet | the stops sheet; on the sheet too once the last stop is done |
| Report a problem | red text | "Problem with the vehicle?" (the same route and parameters) |
| Skip sheet, finish question, Log mileage; completed / cancelled / declined views; preview; missing / loading | — | unchanged |

Kept behaviour checked: tests/driverToday.test.tsx (9), tests/taskSheet.test.tsx (7), tests/driverStops.test.tsx,
scripts/test-driver-3.ts, test-stop-slides, test-vehicle-check, test-part-a. Proposed removals: none.

## Round 4–7: the proposed removals, as decided (Sahan, 22 October 2026)

All approved and done, with his two conditions:
- **Office mode's Warning / Info chip on issue rows:** gone only inside a group, whose heading shows its severity with an
  icon (octagon, triangle, info) and the word for the screen reader. Critical keeps its chip; a flat list keeps every chip;
  a warning row in a critical group keeps its own.
- **Office mode's five-steps card:** gone, because its lines moved onto the timeline card: "Approved by X · at · plan vN",
  then "Sent HH:MM · Seen HH:MM · Accepted HH:MM" (and "Left HH:MM" when no start row shows it).

The others:
- **Issues (site):** the Filter's Snoozed / Resolved / All choices. The Resolved tab's Filter offers Resolved and
  Dismissed, so Dismissed (no tab of its own) stays a tap away. The Open tab is any time, with no "outside these dates"
  note.
- **Activity log (both):** no "Done" pill.
- **Drivers (site):** no "· 0 declined".
- **Reminders (site):** the "Also needs attention" group and `dueFromVehicles` are deleted (dead code).
- **Vehicles list (both):** one "Documents valid" line when all three are valid. Each document stays on the vehicle's own
  page with its date.
- **Tasks tab (Office mode):** no always-on Waiting chip; a red "Late" chip in words when the request is late.
- **The site's task page:** no Status row (its location words moved to the banner). The Gaps list is one line, "No GPS for
  30 min · N gaps", with the markers kept on the map.
- **Review (Office mode):** no vehicle-used line for a chosen plate already on the driver's row.
- **The holder's conflict card (both):** the requester's own Call / WhatsApp is not drawn again when the holder line shows
  that number.
- **Kept:** the Pre-trip tag when the vehicle_check switch is off.

## Round 48, item 1: a proposed change (28 October 2026)

| Site | Office mode / /m/ | Tool |
|---|---|---|
| Requests (the queue): "Change · <task>" row with "<summary> · proposed by <name>" | Approve tab row, Home's request lines | list_requests kind change |
| /requests/:id/decide for a change (ChangeDecide): the task, each line from → to, Approve the change / Decline… with a reason, Open the task | the request page's change screen (ChangeDecide: one sticky bar; Decline through the ReasonSheet) | decide_request |
| /requests/:id: the change explained, Open the task, Withdraw (the proposer, while it waits) | the same screen for the proposer: "The fleet admin will approve or decline this change…", Withdraw the change | cancel_request |
| The task page, the board's cards, the needs-a-driver rows: "Change waiting for approval · <name> · …" → Decide it / Open the request | the task page's card, the Tasks tab's cards and rows, Home's needs-a-driver rows | task_detail / task_board pending_change |
| Change, Give it a driver, Stops: "Waiting for the fleet admin's OK · the task is unchanged" and back | Give it a driver, Change time, the stops editor: the same snackbar and back | update_task / reassign_task / update_task_stops |
| My trips: "Change · <task>" | My trips | my_trips |


## Round 52: archive, delete and Recently deleted (30 October 2026, §40)

| Site | Office mode / /m/ | Tool |
|---|---|---|
| A driver's page: Archive / Restore (trips from today on listed first, Archive anyway) | People → a driver: "Archive <name>…" / "Restore <name>", the trips sheet (each opens its task), Archive anyway | set_driver_active (confirm) |
| A driver's, an office user's, a vehicle's page: Delete permanently (no history only; the name or plate typed) | the same pages' foot: Delete permanently, or "Has history (…): archive instead", or the account guard's sentence; the sheet with the name or plate typed | can_delete, delete_record |
| A vehicle's page: Archive / Restore (trips first) | Vehicles → a vehicle: Archive this vehicle… / Restore this vehicle, the trips sheet; the form's Active chips kept | set_vehicle_active (confirm) |
| A place's page: Archive (was Remove) / Restore, Delete permanently | More → Places → a place: Archive this place (same confirm), Restore, Delete permanently (one confirm) | remove_place, restore_place, can_delete, delete_record |
| Filters: Show archived (drivers), Archived (returned) (vehicles), Archived (places) | the same Filter values, the new words | list_drivers, list_vehicles, list_places |
| Projects (list, search, Show archived, Archive / Restore, Delete) | More → Projects (view or request; the actions by their tools) | list_projects, set_project_archived, can_delete, delete_record |
| Rental companies (vehicles count, Show archived, Archive / Restore, Delete with no vehicle) | More → Rental companies (vehicles) | list_rental_companies, set_rental_company_archived, can_delete, delete_record |
| Recently deleted (search, rows, Restore) | More → Recently deleted (users) | list_bin, restore_bin_item |
| Wrong entries: Delete… on a task, a request, an issue, a fill, an odometer reading, a vehicle check | Delete… on the task page (the task, each fill, each vehicle check), the request page, the issue page, the fill's player; the odometer readings have no id in task_detail (no Delete in the app) | delete_entry (preview, reason) |
