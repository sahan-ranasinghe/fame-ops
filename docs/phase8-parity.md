# Phase 8: parity of the office site in Office mode

Every function of the office site (apps/office, as built at main `003c749`, plus Hotfix 4), the tools it calls and the
permission it needs, with the Office-mode screen that does it and its status: **planned 8.x** → **built** → **tested** (the
tap test and the Part's tests), or **laptop only (decided)**. Every checkpoint of Phase 8 shows this table; a row moves only
with its screen's test. The numbers in brackets are the designs in `design/office/png/`. Built from a read-only inventory of
the site on 19 October 2026 (138 rows, with the privacy e-mail added after the Part 6 checkpoint).

Permissions: V view, R request, Ap approve, AT assign_tasks, Veh vehicles, Iss issues, U users, ANY any office permission.

| Area | Function on the site | Tools | Permission | Office mode | Status |
|---|---|---|---|---|---|
| Sign-in | Sign in e-mail + password | Auth, GET /me | office acct | Sign in (01), 2-step code, set password from the link | planned 8.1 |
| Sign-in | Second step code / set up 2-step when required | Supabase MFA | — | Sign in (01), 2-step code, set password from the link | planned 8.1 |
| Sign-in | Set password from one-time link (12+) | updateUser | — | Sign in (01), 2-step code, set password from the link | planned 8.1 |
| Sign-in | Blocked page + sign out | — | — | Sign in (01), 2-step code, set password from the link | planned 8.1 |
| Sign-in | 2-step on/off (web only) | MFA | ANY | — | laptop only (decided): enrolment on the site; the code at sign-in works in the app |
| Sign-in | Sign out | — | — | Sign in (01), 2-step code, set password from the link | planned 8.1 |
| Sign-in | Privacy page /privacy (no sign-in) | — | none | Sign in (01) footer and Profile (18) → /privacy | planned 8.1 |
| Shell | Menu sections collapsible, remembered | my_prefs, set_my_prefs | ANY | Tabs per permission + More (19) | replaced by the tabs (8.1) |
| Shell | Menu badges requests waiting, open issues | fleet_overview, list_issues (+Realtime) | V / Iss or AT | Tab and More badges | planned 8.1 |
| Shell | Phone tab bar tabsFor | — | per tab | Tabs per permission (section 1) | planned 8.1 |
| Shell | More page (name, role, e-mail, phone, version, permissions, My profile, Security, Sign out) | — | — | More (19) + Profile (18) | planned 8.1 |
| Shell | Home big button homeAction | — | by role | Home big actions (02–04) | planned 8.2 |
| Shell | "N tasks need a driver · Show" banner on Tasks pages | fleet_overview | Ap or AT | Home: Needs a driver (03, 04); Tasks list banner | planned 8.3 |
| Shell | "Add your phone number" banner | /me phone_required | Ap or AT | Profile prompt after sign-in | planned 8.1 |
| Shell | Pull to refresh (phone) | — | — | Pull to refresh on every list | planned 8.1 |
| Shell | No access page | — | — | Not routed without the permission | planned 8.1 |
| Notifications | Tray All/Unread, by day, Mark all read | my_inbox (+Realtime), mark_inbox_read | ANY | Alerts (16) | planned 8.2 |
| Notifications | Bell → /inbox on phone | — | ANY | Alerts (16) | planned 8.2 |
| Notifications | Banner per new item + kind's sound | my_inbox, my_notification_settings | ANY | Alerts (16) | planned 8.2 |
| Notifications | "Click to turn on sounds" | — | — | Alerts (16) | planned 8.2 |
| Notifications | Inbox page All/Unread/History, search, paging | my_inbox, mark_inbox_read | ANY | Alerts (16) | planned 8.2 |
| Notifications | Web push tap opens page | sw.js | — | A push tap opens its screen (native and web) | planned 8.1 |
| Overview | Sections by role, 5 rows (3 phone), View all, collapse | fleet_overview, prefs | V | Home (02–05) | planned 8.2–8.4 |
| Overview | Requests to approve + Decide | list_requests | Ap | Home (04): Requests to approve | planned 8.4 |
| Overview | Needs a driver (best match), row → change page | fleet_overview | Ap or AT | Home (03, 04): Needs a driver → Give it a driver (11) | planned 8.3 |
| Overview | Critical issues | fleet_overview | Iss or AT | Home (04): Critical | planned 8.4 |
| Overview | At a glance tiles | fleet_overview | V | Home (02–05) | planned 8.2–8.4 |
| Overview | Tile panels /?open= | list_vehicles, task_board, list_requests | V/AT/Ap/Iss | Home (02–05) | planned 8.2–8.4 |
| Overview | On the road rows (driver link, Maps, WhatsApp, Call) | fleet_overview | V | Home (02–05) | planned 8.2–8.4 |
| Overview | Needs attention groups, expand | fleet_overview | Iss or AT | Home (02–05) | planned 8.2–8.4 |
| Overview | Snooze / Dismiss row or group | update_issue | Iss | Issues: snooze / dismiss a group | planned 8.4 |
| Overview | My trips section | my_trips | R or AT | Home (02): My trips | planned 8.2 |
| Overview | New request / Assign task buttons | — | R / AT | Home big actions | planned 8.2 |
| Reminders | /reminders documents/services due + also needs attention | fleet_overview | Iss or AT | More → Reports → Reminders | planned 8.4 |
| Requests | List chips Waiting/Changed/Approved/Declined/Cancelled/All, search, paging | list_requests | V or R | Requests list and a request's page (not designed: 8.0) | planned 8.2 / 8.4 |
| Requests | "X is reviewing" | list_requests | — | Requests list and a request's page (not designed: 8.0) | planned 8.2 / 8.4 |
| Requests | Row Review / Task | — | Ap / task_detail | Requests list and a request's page (not designed: 8.0) | planned 8.2 / 8.4 |
| Requests | New request (on behalf, phone, project, trip editor, type, pax, tools, driver needed, note) | create_request, plan_task, search_places, save_place, google_place | R | Trip steps Where → When → Who → Review (06–09) | planned 8.2 |
| Requests | Book now (driver, vehicle groups, Who's available) | book_vehicle, suggest_vehicles, availability | Ap | Trip steps · Who with Book now | planned 8.4 |
| Requests | Request detail (timeline, decided by, Call, trip) | list_requests | V or R | Approve a request (10) | planned 8.4 |
| Requests | Edit request | update_request, plan_task | R or Ap | My trips (17): Edit · Withdraw | planned 8.2 |
| Requests | Withdraw own waiting request | cancel_request | R own | My trips (17): Edit · Withdraw | planned 8.2 |
| Requests | Cancel a booking | cancel_request | Ap | A request's page: Cancel booking (with undo) | planned 8.4 |
| Requests | Tell requester (WhatsApp text), requester's phone | update_request | Ap | Approve a request (10) | planned 8.4 |
| Requests | Decide (driver, vehicle groups, Who's available, plan, Approve & send / Decline) | decide_request, suggest_vehicles, availability, plan_task, reviewing | Ap | Approve a request (10) | planned 8.4 |
| Requests | Re-decide a changed booking (keep/change/decline) | redecide_request | Ap | Approve a request (10) | planned 8.4 |
| Requests | Trip decide (send as proposed / move day, leave-by, back-by; times asked; decline) | decide_request | Ap | Approve a request (10) | planned 8.4 |
| Requests | Open the task from a request | task_detail | (route needs AT: bug) | Task detail (14), only with assign_tasks | planned 8.3 |
| My trips | List (range, status, kind, search, paging, Call/WhatsApp) | my_trips | R or AT | My trips (17); Home (02) action | planned 8.2 |
| My trips | New request button | — | R | My trips (17); Home (02) action | planned 8.2 |
| Tasks | Day board columns incl. Waiting for approval, Needs a driver; ETA, late | task_board | AT | Tasks list / board (not designed: 8.0) | planned 8.3 |
| Tasks | Day navigation + date picker | — | AT | Tasks list / board (not designed: 8.0) | planned 8.3 |
| Tasks | Column Load more | task_board | AT | Tasks list / board (not designed: 8.0) | planned 8.3 |
| Tasks | Needs a driver block / filter | task_board.needs_driver | AT | Tasks list / board (not designed: 8.0) | planned 8.3 |
| Tasks | Waiting-approval card → decide | — | Ap / own | Tasks list / board (not designed: 8.0) | planned 8.3 |
| Tasks | /tasks?task= link | — | AT | Tasks list / board (not designed: 8.0) | planned 8.3 |
| Tasks | Assign a task (full trip editor, plan + map, conflicts, driver + vehicle/on the day, Who's available, pax, contact, notes, projects, WhatsApp link, Assign & send / Send for approval) | create_task, plan_task, availability, get_settings, find_project, search_places, google_place, save_place | AT | Trip steps (06–09) | planned 8.3 |
| Tasks | Task detail (facts, Call, ETA, running late, contact, charged to, odometer/fuel photos/video, problems, history, warnings, unlogged km, plan + map) | task_detail | AT (route) | Task detail (14) | planned 8.3 |
| Tasks | Task route map (GPS km, points, gaps) | driver_route | AT or Veh | Task detail (14) | planned 8.3 |
| Tasks | Save as our place (reached Google stop) | save_arrival_place | Veh or AT | Task detail (14) | planned 8.3 |
| Tasks | Driver-started trip purpose / project | set_trip_purpose | AT | Task detail (14) | planned 8.3 |
| Tasks | Reopen today's completed task | reopen_task | AT | Task detail (14) | planned 8.3 |
| Tasks | Type a missing swap odometer reading | swap_reading | AT or Veh | Task detail (14) | planned 8.3 |
| Tasks | Change the task / Give it a driver (TaskEdit) | update_task, availability, task_detail | AT | Needs a driver (11) / Task detail → change | planned 8.3 |
| Tasks | Find a driver (/edit?driver=1) | update_task | AT | Needs a driver (11) / Task detail → change | planned 8.3 |
| Tasks | Cancel task with reason | cancel_task | AT | Task detail: Cancel task… (with undo) | planned 8.3 |
| Tasks | Edit stops (Plan now, Save) | update_task_stops, plan_task | AT | Task detail → Change time or stops (07) | planned 8.3 |
| Tasks | History (range ≤366 d, filters, paging) | list_tasks | AT | Tasks → History (not designed: 8.0) | planned 8.3 |
| Dispatch | Who's available (best match, pick, tick + Ask drivers, Call/WhatsApp) | availability | Ap or AT | Trip · Who (08), Approve (10), Needs a driver (11) | planned 8.3 |
| Dispatch | Conflict cards | plan_task/create_task answers | AT | Trip · Who (08), Approve (10), Needs a driver (11) | planned 8.3 |
| Dispatch | Location search (ours, used before, map/Google, pasted pin/link → pin map → save) | search_places, google_place, save_place | various | Trip · Where (06): the search | planned 8.2 |
| Dispatch | Drafts on 13 forms | localStorage | — | Save draft on the trip steps (06) | planned 8.2 |
| Live | Driver list chips All/On a task/On duty/Off duty/Problems | live_drivers (+Realtime driver_latest) | V | Live (15) | planned 8.3 |
| Live | Map markers, pick | — | V | Live (15) | planned 8.3 |
| Live | Detail card (position, speed, battery, ETA, phone line, driver page, Maps, Call/WhatsApp) | — | V | Live (15) | planned 8.3 |
| Live | Today's route, points, gaps | driver_route | AT or Veh | Live (15) | planned 8.3 |
| Live | Today's trails (+Realtime location_points) | driver_route | AT or Veh | Live (15) | planned 8.3 |
| Live | Watched mode | watch_drivers | V | Live (15) | planned 8.3 |
| Live | Clock out | clock_out_driver | AT or Veh | Live (15) → a driver's card | planned 8.3 |
| Live | Move to vehicle / Swap during a task | move_driver_vehicle, list_vehicles | AT or Veh | Live (15) → a driver's card | planned 8.3 |
| Live | Map controls zoom, compass, fit | — | — | Live (15) | planned 8.3 |
| Drivers | List (search, switched-off, paging, Manage, links board/duty log/add) | list_drivers | V | Drivers (12), Ask drivers sheet (13) | planned 8.3 |
| Drivers | Add driver (random PIN shown once) | create_driver | Veh | Manage a driver (20) | planned 8.5 |
| Drivers | Driver photo (web only) | photo_upload_url, set_driver_photo | Veh | Manage a driver (20) | planned 8.5 |
| Drivers | Profile sections Contact/Emergency/Licence edit, month, version, changes log | driver_profile, update_driver | Veh or U | Manage a driver (20) | planned 8.5 |
| Drivers | Licence photos (web only) | photo_upload_url, set_driver_licence_photo | Veh or U | Manage a driver (20) | planned 8.5 |
| Drivers | Not available add/change/remove | set_unavailability, remove_unavailability | Ap or AT | Manage a driver (20): This week; Drivers board Week | planned 8.3 / 8.5 |
| Drivers | New PIN | reset_pin | Veh | Manage a driver (20) | planned 8.5 |
| Drivers | Switch off/on | set_driver_active | Veh | Manage a driver (20) | planned 8.5 |
| Drivers | Driver page (route by speed, timeline, gaps, live growth) | driver_route, live_drivers, list_drivers, watch_drivers | AT or Veh | A driver's day (not designed: 8.0) | planned 8.3 |
| Drivers | Playback 1× 5× 20× 60× (web only) | — | AT or Veh | A driver's day (not designed: 8.0) | planned 8.3 |
| Drivers | Drivers board Now (filters, search, tick + Ask drivers, New task, Questions) | drivers_board | Ap or AT | Drivers (12), Ask drivers sheet (13) | planned 8.3 |
| Drivers | Board Week (‹ ›, add/change entry; phone one driver at a time) | drivers_board, set/remove_unavailability | Ap or AT | Drivers (12), Ask drivers sheet (13) | planned 8.3 |
| Drivers | Ask drivers (3 kinds, day/from/to, note, chosen or all free) | ask_drivers, drivers_board | Ap or AT | Drivers (12), Ask drivers sheet (13) | planned 8.3 |
| Drivers | Questions last 7 days | ask_answers | Ap or AT | Drivers (12), Ask drivers sheet (13) | planned 8.3 |
| Drivers | Answers (counts, chips, shared point, Call/WhatsApp, Assign on Yes) | ask_answers (+Realtime) | Ap or AT | Drivers (12), Ask drivers sheet (13) | planned 8.3 |
| Drivers | Duty log (range ≤62 d, driver, totals, paging) | duty_log | AT or Veh | More → Reports → Duty log | planned 8.5 |
| Vehicles | Board chips, search, paging | list_vehicles | V | More → Vehicles (list and page; not designed: 8.0) | planned 8.4 |
| Vehicles | Vehicle detail | list_vehicles | V | More → Vehicles (list and page; not designed: 8.0) | planned 8.4 |
| Vehicles | Vehicle photo (web only) | photo_upload_url, set_vehicle_photo | Veh | More → Vehicles: add / edit / photos and documents by camera | planned 8.5 |
| Vehicles | Documents upload/replace/view/expiry/remove/restore/other | vehicle_documents, vehicle_document_upload_url, save_vehicle_document, update_vehicle, remove/restore_vehicle_document | Veh | More → Vehicles: add / edit / photos and documents by camera | planned 8.5 |
| Vehicles | Register vehicle | register_vehicle | Veh | More → Vehicles: add / edit / photos and documents by camera | planned 8.5 |
| Vehicles | Edit vehicle (garage booked, in garage, rent) | update_vehicle | Veh | More → Vehicles: add / edit / photos and documents by camera | planned 8.5 |
| Vehicles | Add rental company inline | add_rental_company | Veh | More → Vehicles: add / edit / photos and documents by camera | planned 8.5 |
| Maintenance | Problem reports list (filters, photos, Open task, Call) | list_vehicle_reports | Veh route; tool Iss | Issues → vehicle problems | planned 8.4 |
| Maintenance | Update a report (status, note, take off the road) | update_vehicle_report, update_vehicle | Iss (+Veh) | Issues → vehicle problems | planned 8.4 |
| Maintenance | Service and document reminders | fleet_overview / list_vehicles | Veh | More → Reports → Reminders | planned 8.4 |
| Issues | List (range, status, kind, vehicle, severity, order, search, paging, Realtime) | list_issues | Iss or AT | Issues (not designed: 8.0) | planned 8.4 |
| Issues | Issue panel/page (facts, links, photos, history) | issue_history | Iss or AT | Issues (not designed: 8.0) | planned 8.4 |
| Issues | Take / note / resolve / dismiss / reopen | update_issue | Iss | Issues (not designed: 8.0) | planned 8.4 |
| Places | List (search, ours/Dialog/Mobitel/removed, no pin, paging) | list_places | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Restore | restore_place | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Place page (pin drag/type, address, district, depot, save, remove pin) | place_detail, update_place | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Remove (in use reasons) / restore | remove_place, restore_place | Veh | More → Places (search, page, pin, remove / restore) | planned 8.5 |
| Places | Import sites (web only; presets, mapping, batches, CSV, save preset) | list_import_presets, import_places, save_import_preset | Veh | — | laptop only (decided) |
| Places | Import history + undo | list_place_imports, undo_place_import | Veh | — | laptop only (decided) |
| Mileage | Range, vehicle, driver; tiles; by vehicle, allowance, gaps, unlogged, odometer checks, personal km | mileage_summary | Veh | More → Reports → Mileage | planned 8.5 |
| Fuel | List (range, vehicle, driver, tiles, paging) | list_fuel | Veh | More → Reports → Fuel | planned 8.5 |
| Fuel | Fill detail (video pieces, bookmarks, receipt, links) | list_fuel, get_settings | Veh | More → Reports → Fuel | planned 8.5 |
| Projects | Find a project | find_project | V or R | Trip · Review: the project split (find_project) | planned 8.3 |
| Projects | Copy the Zoho import message | (import_projects Claude only) | — | — | laptop only (decided) |
| Settings | Settings home + security card | — | — | More (19) | planned 8.1 |
| Settings | My profile (own phone) | update_my_profile | ANY | Profile (18) | planned 8.2 |
| Settings | Users list | list_office_users | U | More → Office users | planned 8.5 |
| Settings | Add office user (presets, one-time link) | create_office_user | U | More → Office users | planned 8.5 |
| Settings | Manage user (name, phone, permissions) | update_office_user | U | More → Office users | planned 8.5 |
| Settings | New set-password link | reset_office_password | U | More → Office users | planned 8.5 |
| Settings | Claude connector keys new/revoke | create_office_key, revoke_office_key | U | — | laptop only (decided) |
| Settings | Switch user off/on | set_office_user_active | U | More → Office users | planned 8.5 |
| Settings | Fleet settings (below) | get_settings, update_settings | U | More → Quick settings (19): the six quick keys | planned 8.5; the other keys laptop only (decided) |
| Settings | Privacy contact e-mail (Part 6: the public /privacy page's contact; removed = the office phone) | get_settings, update_settings `privacy_email` | U | — | laptop only (decided: set once before the store submission and rarely changed; the page itself is linked from Sign in and Profile) |
| Settings | Google usage + caps | get_settings.google, update_settings | U | More → Reports: the counters (read) | planned 8.5; caps laptop only (decided) |
| Settings | Routing usage 14 days | routing_usage | U | More → Reports: read | planned 8.5 |
| Notif settings | This browser on/off (web only) | register_web_push, remove_web_push | ANY | Profile → Notifications on this phone (native push; web push on the web build) | planned 8.1 |
| Notif settings | Event toggles | set_my_notification_settings | ANY | Profile (18) → Notifications | planned 8.2 |
| Notif settings | Browsers with notifications: Remove | remove_web_push | ANY | Profile (18) → Notifications | planned 8.2 |
| Notif settings | Sounds on/off, volume, Test, per kind | set_my_notification_settings | ANY | Profile (18) → Notifications | planned 8.2 |
| Maps | Google map after counted load; else MapLibre/drawn/no map | register_map_load | ANY | Every map (Live with trails and playback, the planner's map and route line, task detail, the places pin map): the driver app's one map component with both engines and its rules (Google by default, the automatic switch to the free map, the map package setting switches every phone, "Map not available"). Native app: the free Maps SDK, not counted. Web build: the counted load, no map at the cap, the free map with the package open | planned 8.0 (the prototype shows both engines) and 8.3 |

**Laptop only (decided at planning, section 2 of the plan):** the site import and its history and undo, the Zoho message for
Projects, Claude connector keys, 2-step enrolment, the detailed fleet settings (everything but the six quick ones), the
Google caps' edit, the audit log (no page yet). One line under More says so.

**Not on the site yet, in the app from the start:** native push for office people (plan section 10.1), the requester's ETA
(10.4).

**Found while making the inventory, fixed by Hotfix 4:** "Open the task" links that led approvers and requesters to No
access; Maintenance's reports list needs issues while its page needs vehicles (left as it is: said here).
