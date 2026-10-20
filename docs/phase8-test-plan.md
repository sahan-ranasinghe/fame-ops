# Phase 8 test plan: Office mode, as built, per round

Where: the Fame Fleet app (1.3.0) on Sahan's phone, signed in as an office user against the live server; the office site
at https://fame-fleet.pages.dev beside it where a test needs a second person. Write down what you saw next to each test;
"as expected" is enough when it matched. Words in quotes are the screen's own words. Names, plates and times are examples.
Every time is Colombo time. Plan and as built: `docs/phase8-plan.md`; the parity table: `docs/phase8-parity.md`.

## O1: the approver's and dispatcher's side (20 October 2026, after the EAS update)

About 10 minutes on the phone. Before you start: the phone has 1.3.0 with the O1 update (Me → App version shows the new
update id; or open the app twice on Wi-Fi), an office account with approve + assign_tasks + request (the Fleet admin
preset, or your admin account), one request waiting for a decision (make it on the site as the Requester: a trip with a
stop and a time later today), one task sent to a driver for today, and test.driver on duty on the OPPO so Live has a
position.

### O1.1 Sign in as the office
1. Open the app signed out (Me → Sign out on a driver sign-in first). The sign-in page has a **Driver | Office** switch
   under "Sign in"; the language pill is on the right.
2. Tap **Office**. Type your work e-mail and password; the eye shows the password; **Forgot password?** says "Ask the
   fleet admin for a new sign-in link."
3. Tap **Sign in**. Expected: Home opens (dark header "Morning, <first name>", the date, the chips "N on the road",
   "N free", "N waiting for OK", "N in garage") and the bottom bar is **Home · Approve · Live · Alerts · More** for an
   approver (a dispatcher without approve gets **Tasks** instead of Approve; a requester **My trips**; everyone Alerts).
4. Nothing driver-side started: no "Sharing my location" notification, no duty, no vehicle. Put the phone in flight mode
   and open the app again: it opens on Home with what it had (not the sign-in page); a card says "Fame Fleet did not
   answer" with **Try again**. Flight mode off, Try again: the data comes back.
5. A wrong password: "Wrong e-mail or password." A driver's username on the Office side: "This account has no office
   role in Fame Fleet."

### O1.2 Home by permission
1. **Requests to approve · N** lists the waiting request with who asked, the day and time and "asked N min ago";
   **View all** opens the Approve tab (the same rows).
2. **Needs a driver · N** (red): a task declined or not accepted in time, with "Kamal declined · not available" and a
   red **Give a driver** button (nothing listed = "Every task has its driver.").
3. **Critical · N**: the critical issues (information; no issues screen in O1).
4. **Today's tasks · N** with the time, title, "Sunil · WP CAB-4521 · 4 pax" and the pill (sent / accepted / on the way /
   running late N min / done); **Board** opens the Tasks board; "All today's tasks (N)" when more than 5.
5. **On the road · N**: each driver with the plate, what they are doing and near where, "on a task" / "on duty";
   **Live map** opens Live; a row opens Live with that driver selected.
6. **My trips · N**: your own requests with their state pill; **View all** opens My trips.
7. Pull down: everything refreshes (the chips too). Leave to another tab and come back: refreshed again.
8. The language pill: සිං turns every word Sinhala (the numbers stay Latin); EN turns it back.

### O1.3 Approve a request (design 10)
1. Open the waiting request from Home. The header: the title, "Request · <who> · asked N min ago", the pill "waiting
   for your OK". On a laptop, open the same request's decide page on the site as approver B: within 20 s the phone
   shows "<B> is also looking".
2. The trip card: the day, "Leave by HH:MM", the stops (S "passengers get in here · 07:24", 1 "arrive by 10:30 · 1 h
   30 min there · leave 11:45", B "about 14:36 · back by 17:00"), the km and the driving time, "needs any van", the
   notes. **Call <who>** only when the request carries a phone number (a request from someone without an account).
3. **Who's available · N**: the drivers ranked free first, the best match marked "best match" and already ticked, the
   plate they hold, "busy" / "off duty" / "not available" pills on the rest. Tap another free driver: the tick moves
   and the button says "Approve · send to <name>".
4. **Approve · send to <name>**: the alert "Approved · sent to <name>" (with any warnings), OK returns to where you
   came from; the request is gone from the queue; the driver's phone gets the task.
5. On a second waiting request: **Decline…** opens the reason sheet (No vehicle free then / Not approved / Other, a
   note); Decline: "Declined", the requester is told.
6. Already decided: open a waiting request on the phone, approve it on the site as B, then tap Approve on the phone:
   the red notice shows the server's words ("Already approved by <B> at HH:MM"), the card reloads and shows "Decided ·
   Approved by <B> · HH:MM" with no buttons.
7. Not shown in O1 (round O2): Plan on map, Change the trip, Change time, Ask drivers.

### O1.4 Needs a driver → Give it a driver (design 11)
1. Have test.driver2 (or any driver) decline a task on their phone (or let the accept window pass). Home shows it under
   Needs a driver; tap **Give a driver**.
2. The header: the title, "Needs a driver · leaves in N min" (or "leave-by passed N min ago"), the red pill "<driver>
   declined · <why> · HH:MM", **Open task →** (opens Task detail; back returns here).
3. The trip card: the day, "Leave by HH:MM", "N pax · <vehicle or type>", the stops, "asked by <who> · Approved by
   <who> · <when>" with a Call button when the requester has a number.
4. **Who can take it · N**: the best match ticked first, never the driver who declined (their row says "Declined this
   task · <why>" and cannot be picked). Tap a driver: the tick moves; the button says "Give to <name> · <plate>".
5. **Give to <name> · <plate>**: the alert "Given to <name>", OK returns to Home; the task is off Needs a driver and the
   new driver's phone gets it.
6. **Cancel task…** on another task that needs a driver: the reason sheet, then "Task cancelled".
7. Back from this screen goes back to where it was opened (Home, the Tasks board or Task detail), never elsewhere.

### O1.5 Tasks: the board and Task detail (design 14)
1. The Tasks tab (dispatcher; an approver finds it under More → Work): the date switch ‹ Today · Mon 19 Oct ›; the
   sections Needs a driver, On the way, Sent to the driver, Waiting for approval (only when there is one; opens
   Approve for an approver), Done. The day's name resets to today.
2. Open a task on the way: the pills ("on the way", "running late N min", the project label), the five steps Approved ·
   Accepted · On the way · Arrived · Done with their times ("~10:38" planned, "—" not yet), "Approved by <who> · plan
   vN", the driver with the plate, make and start odometer, Call and WhatsApp (when the driver has a number), "next:
   <stop> · about HH:MM" with **Live map** (opens Live on that driver).
3. **Stops · planned vs actual**: S "planned 08:30 · left 08:31 · 4 passengers", 1 "arrive by 10:30 · about 10:38 8 min
   late · 1 h 30 min there", B "about 14:50 · back by 17:00"; the notes.
4. A sent task (not started): **Reassign driver** opens Give it a driver for it; **Cancel task…** asks why, then "Task
   cancelled" and the driver is told. A task on the way: only Cancel task…. A done or cancelled task: no buttons.
5. The bottom line "Requester <who> gets a push for every change · Call <who>" when the task has a contact.
6. Not shown in O1: Change time or stops, Swap vehicle, Reopen.

### O1.6 Live (design 15)
1. The Live tab: the map first with a marker per driver with a position (blue on a task, green on duty and free, grey
   off duty), the chips All · On a task · Free · Off duty with their counts, the rows under them.
2. Tap a row or a marker: the map centres on the driver and the card shows the name, the plate, the status line, Call
   and WhatsApp (when the driver has a number) and Open in Maps.
3. Both engines: Settings → Fleet on the site, Map package **open**: within a minute the phone's Live shows the free map
   (the credit "© OpenStreetMap contributors · OpenFreeMap" on it) with the same markers; back to **google**: Google's
   map again. With no connection at all: "Map not available".
4. Trails and playback are not in O1 and have no button.

### O1.7 Alerts, My trips, Profile (designs 16–18)
1. **Alerts**: the bell on Home and the tab badge show the unread count; the screen "Notifications" with All / Unread,
   items by day (Today / Yesterday / Earlier), the unread ones bold; tapping one marks it read and opens its screen (a
   request → Approve; a task → Task detail; a task that needs a driver → Give it a driver); **Mark all read** clears
   the badge.
2. **My trips**: your requests and trips with All / Waiting / Coming up / Done, the state pill, "Approved by <who>" with
   Call; on a waiting request of yours, **Withdraw** asks why and withdraws it (the approvers are told). "Edit" is O2.
3. **More → My profile**: your name, the permission chips, "My phone number" with Edit (type a number, Save: it shows as
   07X XXX XXXX and the site shows the same), the work e-mail, Notifications (a switch per event: turn one off, check
   on the site Settings → Notifications that it is off), Language, Office phone with Call, Privacy (opens the policy),
   the version, **Sign out** (asks first; returns to the sign-in page; opening the app again shows the sign-in page).

### O1.8 The driver is untouched
1. Sign out of the office account; sign in as test.driver on the Driver side: Today, Mileage, Fuel, Report, Me exactly
   as before; nothing office-side anywhere.
2. Sign in as the office again on the same phone: the driver's data is gone from the phone (one person per phone).

### If something looks wrong
- "Fame Fleet did not answer" on a screen: pull down, or Try again; it was a dropped call, not a sign-out.
- A button missing: it is a function not built in O1 (listed above as "not shown"), not a bug; say which one you wanted.
- The sign-in page after a cold start while signed in: the session was revoked or expired for good (a 401); sign in
  again. Note the time: the office site's audit shows what happened.

## O2: the rest of a dispatcher's day (20 October 2026, after the O1+O2 EAS update)

About 15 minutes on the phone, in the order a day runs: a request → its approval → a driver found → the live map → the
rest. Before you start: the phone has 1.3.0 with the O2 update (Me → App version shows the new update id), your admin
account (every permission) and a Requester account on the site, test.driver on duty on the OPPO so Live has a position.
Every button named below exists only with its tool: a missing one on another account is the permission, not a bug.

### O2.1 Request a vehicle (designs 06–09), 3 min
1. Sign in as the office. Home shows the big buttons **Assign a task** and **Request a vehicle**; the bar is Home ·
   Approve · Drivers · Live · More (Alerts is under More; the bell stays in the header).
2. **Request a vehicle** → "New trip · step 1/4". Where: the start says the base place; "+ Add a stop" → type "Kuru" in
   the search: our places first, then the map's results with their credit (and Google's with "Google Maps" under them
   when the google package is on). Pick one. Next: When.
3. When: the day chips (Today · Tomorrow · the day after · Pick a date); the stop's "arrive by" (type 10:30) and dwell
   chips; "Back by" on the last stop; the "Leave from" card says the leave-by the plan found, or why it cannot. Next: Who.
4. Who (a request): passengers 3, the type needed (van), "A driver is needed" on, a note. Next: Review.
5. Review: the plan on the map with the stop pins and the line (the free map or Google's as the setting says), the
   timeline (leave · each stop with its time · back), the totals, any warning. **Send request** → "Request sent" → My
   trips shows it as Waiting.
6. Back from any step keeps the step before it with its fields; kill the app on step 2, open it again, Request a vehicle
   → "Resume draft from HH:MM · Start again".

### O2.2 Approve it, with Ask drivers (designs 10, 13), 3 min
1. Home → Requests to approve → the request. Beside **Who's available**: **Ask drivers** → the sheet: "Free for a
   trip?" with the trip's window under it, the drivers with the free ones ticked (test.driver among them). **Send to N
   drivers**: the question stays on top, the rows say "waiting…".
2. On the OPPO (test.driver): the question arrives; answer Yes. On the phone within 10 s the row says "Yes · HH:MM" with
   **Use** → the sheet closes and test.driver is ticked on the page.
3. **Approve · send to test.driver** → "Approved · sent to test.driver"; the OPPO gets the task.

### O2.3 Give it a driver and Task detail's extras (designs 11, 14), 3 min
1. On the OPPO decline the task (Can't do this task → Not available). On the phone Home → Needs a driver → **Give a
   driver**: Who can take it with the best match; **Ask drivers** is there too. Pick test.driver again → Assign.
2. Open the task (Tasks or Home). Under the stops: **Change time** → the day chips, Leave by, Back by; set Back by to
   17:30 → Save changes → "Time changed · The driver is told"; the task shows the new end. **Change stops** → the
   editor's Where with the task's pending stops (numbered after any reached one) → When → Review → Save changes → the
   task shows the new plan (plan v+1).
3. On the OPPO start the task. On the phone the task now shows **Swap vehicle**: the list with the task's vehicle first
   ("The task's vehicle now", not selectable), the free ones, the ones someone holds, the garage, another running
   task's vehicle greyed. Pick a free one, leave the readings empty, a reason "Puncture" → **Swap vehicle** → "Vehicle
   swapped · The task goes on in <plate> · End of <old>: the driver enters it on the phone"; the OPPO asks for the
   readings.
4. On the OPPO finish the task. On the phone the task shows **Reopen this task** with its note → Reopen task → a reason
   (Wrong end reading) → "Task reopened · The driver finishes it again"; the OPPO's task is in progress again. Finish it
   once more on the OPPO.

### O2.4 Live: trails, the route and playback (design 15), 2 min
1. Live: the trails toggle (the route icon) in the map's cluster → "Loading trails…" then every sharing driver's day as a
   muted line (holes dashed). Tap test.driver's marker: their route by speed band (grey standing, amber under 20, blue
   20–60, dark blue over 60), stops as circles ("09:11–09:25 · 14 min" on a tap), the estimated legs dashed slate over
   GPS gaps; the card says "Today: N km · driving … · stopped … · N stops".
2. Playback: Play at 60×: the marker runs the day with the clock and the speed; the chips 1× 5× 20× 60×; drag the slider.
   Leave the tab and come back: paused where it was. Switch the setting `map_package` on the site and pull down: the
   same on the other engine.

### O2.5 The Drivers tab and a driver's page (designs 12, 20), 2 min
1. Drivers (the bar): Now with the chips and counts; test.driver's row with the plate held and the status line. Week: a
   cell per day; "+ Not available" on a driver → Tomorrow · Morning · Leave → Save: the cell turns amber; Remove it.
2. A row → the driver's page: the profile (phone, licence chip, this month), today's route on the map with the
   timeline (a row frames its span), the numbers.
3. More → Drivers → test.driver → Manage a driver (20): the details with Edit, Driving licence, Emergency contact,
   Account with **Reset PIN** (do not reset test.driver's PIN unless you mean it), Regular vehicle, "Switch off…". More →
   Drivers → **+ Add driver** → the form (do not add one; cancel).

### O2.6 Issues, Vehicles, Reports, Office users, Quick settings (designs 19), 2 min
1. More → Issues: the chips (Active · Open · In progress · Resolved · Dismissed), the rows; one → the facts, the links,
   the timeline; **Take** → "taken by you"; **Resolve** with a note. Home's Critical rows open the same page.
2. More → Vehicles: the chips with counts, the search ("CAB"), a row → the page (status, rented from, km this month,
   odometer, next service, the document chips, the files on file with Open) → **Edit** → change nothing → Save:
   "Nothing to change yet."; set "Garage booked for" 2026-10-25 → Save → "Vehicle updated".
3. More → Reports: Mileage this month (the tiles, by vehicle, gaps, unlogged, checks); Fuel (the fills with the video's
   state); Duty log today (test.driver's period with clock in and the vehicle held); Last month on each.
4. More → Office users: the rows; your own → permissions as chips (you cannot remove your own users permission);
   **+ Add office user** → the form (cancel). More → Quick settings: the switches (do not change them), Auto clock-out
   21:00, the laptop-only line.

### O2.7 Both languages and the driver untouched, 1 min
1. සිංහල on Profile: every O2 screen in Sinhala with Latin digits, plates and times.
2. Sign out; sign in as test.driver: the Driver side exactly as before.

### If something looks wrong (O2)
- A write that fails with "Fame Fleet did not answer": nothing was sent twice; Try again sends it once more.
- "Edited since you opened it" on Change time or Change stops: someone changed the task on the site; the page loads it
  again and shows the new plan version.
- The trails show "+N not drawn": more than 10 drivers are sharing; the first 10 in the server's order are drawn.
