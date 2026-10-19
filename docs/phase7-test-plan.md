# Phase 7 test plan: a driver's day, as built, per role

18 October 2026, after Round Part 3b. Everything below is live: Parts 1, 2 and 2b (Round A), the hotfix after Round A,
Part 3 (Round A2), Part 4 (Round A3), Hotfix 2, Hotfix 3 and Part 3b. Part 6 (the 1.3.0 build, installed once) has its
own section at the end, for after the install.

Where: the office web app at https://fame-fleet.pages.dev (laptop and phone), the Fame Driver app on the test phones,
and Claude with the "Fame Fleet" connector. Write down what you saw next to each test; "as expected" is enough when it
matched. Words in quotes are the screen's own words. Names, plates and times in them are examples.

Plan, rules and as-built notes: `docs/phase7-plan.md`. The driver strings for the Sinhala check: its §Sinhala.

## Before you start

- **Office accounts** (Settings → Users, with the presets):
  - Sahan (admin).
  - Fleet admin **A** and a second approver **B** (the Fleet admin preset: everything but Users).
  - A **Dispatcher** (assign tasks + view, no approve).
  - A **Requester** (request + view).
  - A **Viewer** (view only).
  - Give each one a mobile number (Settings → My profile) for the call tests.
- **Screens.** The laptop (Chrome, a wide window) and a phone (Chrome, or Fame Fleet installed from Chrome's menu).
  Each person: Settings → Notifications → **Turn on in this browser**, then click once anywhere on the page, so sounds
  can play.
- **Drivers.** test.driver on the OPPO CPH2119 and test.driver2 on the second phone. Both on the 1.2.0 build with the
  Part 3b update: open the app twice on Wi-Fi; Me → App version shows `1.2.0+…`. Put one phone in Sinhala (Me →
  Language) for the Sinhala lines.
- **Vehicles.** Two active vehicles the drivers can take (below WP CAB-4521 and WP KL-1234), one of them with no photo.
  The base place is set (Settings → Fleet → Base place).
- **Settings → Fleet as live:** End of the working day 21:00; Accept window 15 / 30 and the reminder 5; "New tasks need
  the fleet admin's OK" on; "Vehicle on the day" off (switch it on only for A23 and F5, once both phones have the
  update); Personal trips Allowed; Office phone number set.
- Use made-up titles ("Test · …") and cancel what is left at the end. Every time is Colombo time.

## A. The driver (Fame Driver on the phone)

### A1. The phone number prompt (Part 3b)
Setup: a driver with no mobile number. On 18 October that is test.driver, test.driver2 and Kanishka.
1. Open the app online.
2. Type `0771234567` and tap **Save**.
3. On the other phone, turn Wi-Fi and data off, then open the app.

You should see:
- A full screen "Your phone number" / "The office and the people you drive need it to reach you." / "Mobile number" /
  "Save", with no way past it while online. Sinhala: "ඔබේ දුරකථන අංකය".
- After Save: the photo step (A2) or Today.
- Offline: "No connection. The app asks again when you are online." with **Continue**. It asks again at the next start.
- Office, Drivers → Manage test.driver → Contact: "077 123 4567". Changes: "Phone: … · **changed by the driver** ·
  …".

### A2. Add your photo (Part 3)
Setup: a driver with no profile photo.
1. Open the app after A1.
2. **Take photo** (the front camera), crop the square, accept.
3. Me → **Change photo** → **Choose from gallery**.

You should see:
- "Add your photo" / "The office and the people you drive see it with your name." / "Take photo" / "Choose from
  gallery". There is no skip.
- "Saving your photo…", then "Photo saved".
- If the camera or gallery fails twice: "Not now: ask me next time".
- Office: the photo on the Drivers list, the Live card, Who's available and the board's cards.

### A3. Start work with today's vehicle (Part 1)
Setup: test.driver off duty, no task running.
1. Today → **Start work**.
2. In "Choose today's vehicle", look at the rows, pick WP CAB-4521, tap **Start**.
3. If Location is off, the "Turn on Location" cover comes first: turn it on.

You should see:
- Off duty: "Off duty" / "Start work to record trips and mileage." / **Start work**.
- The picker: your last vehicle marked "Your last vehicle", your regular one "Your regular vehicle", one another driver
  holds "With <name> now", "In garage" on a garaged one, "No vehicle today" at the bottom.
- On duty: "On duty since 08:12", the plate, "Office can see you", **Change vehicle**, **Finish work**. The
  notification "Fame Driver · On duty" / "Recording trips".
- Office Live, chip **On duty**: the card "On duty · since 08:12" and "WP CAB-4521 · since 08:12".
- Sinhala: "වැඩ ආරම්භ කරන්න", "අද වාහනය තෝරන්න", "08:12 සිට රාජකාරියේ", "කාර්යාලයට ඔබව පෙනේ".

### A4. Change vehicle and the hand-over (Part 1, two phones)
Setup: test.driver on duty with WP CAB-4521; test.driver2 on duty with no vehicle or another one.
1. test.driver2: Today → **Change vehicle** → WP CAB-4521 (it says "With <test.driver's name> now") → **Start**.
2. Look at test.driver's phone.
3. On test.driver's phone, tap the banner.

You should see:
- test.driver2 now shows WP CAB-4521.
- test.driver: a push "Your vehicle was taken · WP CAB-4521 is now with <name> · choose your vehicle", and on Today
  the banner "WP CAB-4521 is now with <name> · choose your vehicle" with **Close**. The card says "No vehicle"; the
  driver stays on duty.
- Tapping the banner opens the picker.
- Office Live: test.driver's card "WP CAB-4521 now with <name> 08:40"; test.driver2's card "WP CAB-4521 taken over
  from <name> 08:40".
- During a task, Change vehicle is not offered.

### A5. Finish work, and sign out (Part 1)
1. With a task in progress, look at Today's duty card.
2. With no task: **Finish work** → the dialog → **Finish work**.
3. Start work again, then Me → **Sign out**.

You should see:
- During a task: no Finish work, and "Finish the task first."
- The dialog "Finish work? Location stops." with Cancel / **Finish work**. After it: the Off duty card, and the "On
  duty" notification is gone.
- Me while on duty: "Finish work first" instead of signing out.
- Office Live: "Off duty · since 17:40 · by the driver". Duty log (C8): the period with its clock-out.

### A6. A new task: the card, the preview, Accept (Hotfix 2 I)
Setup: on duty. The fleet admin sends test.driver a task with five stops (D6, or Assign a task as A).
1. Wait for the push.
2. Look at Today's card.
3. Tap the card.
4. Tap **Accept**.
5. Turn data off and open the preview again.
6. Turn data on. The office adds a stop (Task → Edit stops).

You should see:
- The push on the "New tasks" channel: loud, on the lock screen.
- The card "NEXT TASK", "Leave by 09:00", the stops "Stop 1 · Pickup · …" (four, then "Show all 5 stops").
- The preview "New task": every stop with "arrive 09:00 · leave 09:05" and "by 09:30" for an arrive-by; the map with
  the route line and numbered pins; "42 km · 1 h 5 min driving"; "Leave by 08:40"; "5 passengers"; the contact;
  "Vehicle" and the plate; "Asked by …" / "Given by …" / "Approved by Palitha · 10:42" with Call. **Accept** and
  "Can't do this task" at the bottom. Sinhala title: "නව කාර්යය".
- After Accept: "Accepted ✓ 08:15". The office board's card: "Accepted 08:15".
- Offline: "No connection: shown from the last copy on this phone."
- After the office's change: a "Task changed" push naming the stop ("Stop 6 added: …"). The preview's title is
  "Task changed", the new stop marked "Changed", a removed one "Removed".

### A7. The accept window counts only at work (Hotfix 2 E)
Setup: test.driver off duty. The dispatcher sends a task leaving in about 2 hours.
1. Do not Start work for 20 minutes.
2. Then **Start work** and do not accept.
3. Accept after the office sees "Needs a driver".

You should see:
- Off duty: no reminder, and the task does not need a driver.
- 5 minutes after Start work: the push "Accept or decline: <title> <time> · …".
- 15 minutes after Start work: the office's Needs a driver lists it ("<name> hasn't accepted · needs a driver").
- Accepting late clears it. 30 minutes before its leave-by a task needs a driver even if the driver is off duty.

### A8. Start task, and Arrived within 300 m (Part 1, §18)
Setup: an accepted task. One stop near you, one in another town, one with no pin. On one task the office ticked
"Passengers get in here".
1. **Start task** (the odometer photo as usual).
2. Near a stop (within 300 m): **Arrived**, then **Done**.
3. At the far stop: look at the button, then tap the second line.
4. Indoors with no GPS fix: wait 60 seconds.
5. At the stop with no pin: Arrived.

You should see:
- With the tick, Stop 1 "Start · passengers get in here" is arrived at Start task.
- Done appears only after Arrived.
- Far: "You are 42 km from Kurunegala site" with **I'm here, the pin is wrong**.
- No fix: "Waiting for GPS…", then after 60 s the same "I'm here, the pin is wrong".
- No pin: "No pin for this stop"; Arrived works.
- Office task page, under each stop: "Marked arrived 42 km from the pin ("I'm here, the pin is wrong")", "Marked
  arrived with no GPS fix", "Arrived (the stop has no pin)". The issue "Arrived away from the stop" (warning).
- Sinhala: "මම මෙහි සිටිමි, පින් එක වැරදියි", "GPS සඳහා රැඳී සිටිමින්…".

### A9. Skip, finish and completed early (§18)
Setup: a task in progress with a planned route of about 50 km.
1. A middle stop → **Skip** → "Why?" → Closed, a note → **Skip stop**.
2. **Complete task** with the last stop still open.
3. Mark the last stop Done, then Complete task with only 3 km more on the odometer than at the start.
4. Tap **Go on**.

You should see:
- 1: the office gets "A driver skips a stop" (the dispatchers), and the task's history "Stop 2 · Kurunegala site:
  Closed · <note>".
- 2: "Mark the last stop Done or Skip it first."
- An earlier stop still open asks "N stops are not done" / "Finish the task anyway? They will be marked as not
  visited." (the office sees it as not visited).
- 3: "Check the reading" / "The trip is 50 km, the odometer says 3 km." with **Correct the reading** and **Go on**.
- 4: the task completes. Office: the pill "Completed early" on the board, the notice "Completed early: 3 km on the
  odometer for a 50 km plan (…)" on the task page, and the issue "Completed early". A plan under 3 km is never checked.

### A10. Call buttons (Hotfix 2 F)
1. Look at the task card, the task screen and the preview.
2. Look at Me.
3. Tap a Call and a WhatsApp.

You should see:
- "Call contact", "Call requester", "Call fleet admin" and "Call office", each with "WhatsApp". A row with no number is
  hidden.
- Me: "Call office" and "Call fleet admin".
- Call opens the phone's dialler with the number (nothing dials by itself); WhatsApp opens the chat.

### A11. Running late, and Can't make it (Part 3b H4)
Setup: two accepted tasks, not started.
1. Today's card (or the preview) → **Running late** → "How late?" → **15 min** → **Send**.
2. Start the task. On the task screen: Running late → **Other** → `200` → **Send**.
3. The other accepted task → **Can't make it** → Unwell, a note → **Can't do it**.

You should see:
- 1: "The office knows: 15 min late", then under the button "You said 15 min late at 08:52". Offline: "Will be sent
  when you are online".
- Office: the amber "Running late 15 min · said 08:52" on the task page, the board's card and Live. The notification
  "<name> is running late · 15 min" ("A driver is running late"); the requester gets "Your driver is running late".
- 2: "Enter minutes between 5 and 180."
- 3: the sheet "Can't do this task?" (Vehicle problem / Not available / Unwell / Other). The task leaves Today. The
  office: Needs a driver, "declined after accepting" with the reason; the requester is told.
- Before Accept the link reads "Can't do this task". A trip the driver started has neither.
- Sinhala: "ප්‍රමාදයි", "කොපමණ ප්‍රමාදද?", "එන්න බැහැ".

### A12. The vehicle swap during a task, on the phone (Part 2; the office side is C7)
Setup: a task in progress on WP CAB-4521. The dispatcher swaps it to WP KL-1234 with both readings left empty.
1. Look at the task screen.
2. Tap "WP CAB-4521: end reading" and log it.
3. Tap "WP KL-1234: start reading" and log it.
4. Save & finish at the end.

You should see:
- A "Task changed" push. On the task: "Vehicle changed: WP KL-1234" / "The office moved this task to WP KL-1234. Log
  both odometers." Sinhala: "වාහනය වෙනස් විය: WP KL-1234".
- Each reading opens "Odometer at the vehicle change" (the usual photo). Then "Logged ✓ 45,262 km".
- At Save & finish: "12 km in WP CAB-4521" and the line for WP KL-1234. The task's km is the two added up.

### A13. "I need another vehicle" (Part 2)
Setup: a task in progress.
1. Task → **Report a problem with the vehicle** → Breakdown.
2. Tick **I need another vehicle**, add a note and a photo, **Send to office**.

You should see:
- Under the tick: "The fleet admins are told at once." It is offered only for Breakdown or Accident, on your own running
  task.
- After Send: "Report sent" and "The office knows you need another vehicle."
- Office at once: "A driver needs another vehicle" (push and the tray), and the critical issue "Needs another vehicle"
  under Critical issues. It resolves itself when the office swaps the vehicle (C7) or the task ends.

### A14. The task map (Part 2b)
Setup: a task planned under the Google package, in progress.
1. Open the task.
2. Rotate or tilt the map with two fingers, then tap the compass.
3. Open a task planned with no road line (an old plan, or the open package).

You should see:
- Every stop by its number with its time, the start, your position, and Google's line per leg (legs already driven in
  grey). "Distance left by road".
- The compass button ("North up") appears only while rotated or tilted. One tap: north up, no tilt.
- With no line: "Stops only: no planned road line for this task", and "Distance left" with "straight line".
- A Google stop has "Google Maps" under its name.

### A15. Start a trip: company work (Part 4, §13)
Setup: on duty, no task running, Personal trips Allowed.
1. Today → **Start a trip**.
2. Keep Company work. In "Where to?" type a place; pick one of ours, or a Google row.
3. Add a note → **Start**. Then the usual Start task with the odometer.
4. On the way: **Add a stop**.
5. Arrived, Done, Complete task.

You should see:
- "Start a trip" only on duty with no task running; otherwise "Finish the task in progress first."
- Search rows: "Our place" first, then "Map" rows; Google rows with "Google Maps" under them.
- The task screen: "Your trip · Company work". No "Can't do this task". No new-task push.
- "Stop added".
- Office: the board's card tagged "Driver-started" (C13).
- Sinhala: "ගමනක් ආරම්භ කරන්න", "සමාගම් වැඩ", "ඔබේ ගමන".

### A16. A personal trip, a cancelled trip, an offline trip (Part 4)
1. Start a trip → **Personal** → a place → Start.
2. Start another trip, and before Start task tap **Cancel this trip** → confirm.
3. Airplane mode on: Start a trip, type a place, Start, then Start task. Turn airplane mode off.

You should see:
- 1: "The office sees personal trips." The fleet admins get "<name> started a personal trip to <place>". The board's
  card has "Personal".
- 2: "Cancel this trip? It has not started." → "Trip cancelled". No push to the phone; the office history says
  Cancelled by the driver.
- 3: "No connection: type the place or pick one of the list." Only our places or the typed words. Then "No connection:
  the trip is saved and sent when the connection is back." The trip, its start and the odometer arrive in order when
  the signal is back.

### A17. My profile (Part 3b G)
1. Me: look at the top.
2. **Edit** → change the WhatsApp number, add an Emergency contact (Name, Relationship, Phone), the Licence number,
   the Expiry date (`2027-03-12`), and the licence's Front and Back photos → **Save**.
3. Type a bad number (`12345`) and Save.

You should see:
- Me: the photo, the name, "Employee no.", "Phone", "WhatsApp", "Emergency contact", "Driving licence" (expiry in amber
  or red when near), "Language", "Current vehicle", "This month" ("3 tasks · 120 km"), "App version",
  "Availability", "Phone setup", "Documents", "Permissions", "Sign out".
- The edit page: "The office sees these details. Every change is shown to them." After Save: "Saved". Offline: "No
  connection: try again when you are online."
- 3: "Enter a Sri Lankan number, e.g. 077 123 4567."
- Office, the manage page's Changes: every field, "changed by the driver" in bold.

### A18. Availability (Part 3b H1)
1. Me → **Availability** → **Add a time I'm not available**.
2. Day: tomorrow; When: "Morning (until 13:00)"; Reason: Half day; a note → **Save**.
3. Tap an entry the office added (C11) → Remove.
4. Remove your own entry.

You should see:
- "Tell the office when you can't take trips. This is not leave: ask HR for leave."
- The list "<day> · until 13:00" with "Added by <you>". Nothing added: "You are available every day."
- 3: "The office added this: ask them to change it."
- 4: "Remove this? The office will see you as available."
- Office: Who's available says "Not available · half day, back 13:00" for that morning, and the board's week view shows
  the entry.
- Sinhala: "නිදහස් බව", "මට නොහැකි කාලයක් එක් කරන්න".

### A19. A question from the office (Part 3b H3; the office side is C12)
Setup: the office asks "Free for a trip?", then "When can you be at the office?", then "Where are you now?".
1. Tap the push. Answer **Yes**.
2. Answer the time question with one of the time buttons; then **Change answer** with **Another time**.
3. Off duty, answer the location question with **Share my location**.
4. Open a question after it closed.

You should see:
- The push on the channel "Questions from the office". Today's banner "The office asked you a question" with
  **Answer**.
- "Question from the office" / "<name> asks", with "Yes", "No", "Call me". After: "Answer sent", "Your answer: Yes",
  "Change answer".
- The time: "Pick a time" with 8 quarter-hour buttons, "Another time", "Send 10:30".
- The location: "Sends where you are now, once. It does not turn on location sharing." It works off duty.
- Closed: "This question has closed." Offline: "Will be sent when you are online".
- Sinhala: "කාර්යාලයෙන් ප්‍රශ්නයක්", "ගමනකට නිදහස්ද?", "මගේ ස්ථානය යවන්න".

### A20. Vehicle photos and the held vehicle's documents (Part 3)
1. Change vehicle → the vehicle with no photo → **Add a photo** (camera).
2. Me → **Documents**.
3. Open one with data off. Finish work and open Documents.

You should see:
- "Saving the photo…" then "Photo added"; offline "The photo is sent when the connection is back". A vehicle with a
  photo: "This vehicle already has a photo". The office's vehicle page shows it.
- "Documents of WP CAB-4521": "Revenue licence", "Insurance", "Emission test", each "Valid until 12 Mar 2027" (amber
  within 30 days, red within 7, "Expired …"), or "Not uploaded yet"; **Open**.
- 3: "Needs a connection to open"; off duty with no vehicle: "Start work with a vehicle to see its documents".

### A21. Phone setup (item 7)
1. Today: look for the old Phone setup card.
2. Me → **Phone setup**.

You should see:
- Today has no Phone setup card.
- Me's row turns amber after the phone stopped the app in the last 3 days, and the page opens with "Your OPPO phone
  stopped Fame Driver 2 times since 06:12, 25 min in all. No trip is recorded while it is stopped."
- The page: "Your OPPO phone", "Change these settings once:", the brand's steps, **Open OPPO settings**, "Done".
- Office: Live's card "App stopped by phone 2× today", and the issue "App stopped" naming the phone.

### A22. Today's short list (Hotfix 3 L6)
Setup: six tasks today for test.driver.
1. Look at Today.
2. Tap **All today's tasks**.
3. Fuel, Report (My reports) and Mileage (Today's tasks): scroll to the end.

You should see:
- NEXT TASK, then at most 3 under "Later today", then "2 more later today" and "All today's tasks".
- "Today's tasks": the full list.
- 20 rows, then "Load more".
- A task missed (never started, leave-by over 24 hours ago) is shown nowhere.

### A23. "Which vehicle?" (Hotfix 2 J; only after F5 switched Vehicle on the day on)
Setup: one task with "Driver's vehicle on the day", one with "Any van".
1. Open the preview of each.
2. Start task on the first.
3. Start the "Any van" task holding a car.

You should see:
- The preview's "Vehicle": "Your vehicle on the day" / "Any van".
- "Which vehicle?" / "This task has no vehicle yet. Confirm the one you are driving." with "Use WP CAB-4521" and
  "Choose another vehicle".
- A car for "Any van": "WP X is not a van."; a garaged one: "WP X is in the garage."
- Office board: "Vehicle: on the day" until confirmed, then the plate.
- Sinhala: "කුමන වාහනයද?", "එදින ඔබ ළඟ ඇති වාහනය".

### A24. Clocked out at the end of the day (Part 1)
Setup: test.driver on duty after 20:45, no task running.
1. Leave the phone. Look at it after 21:15.
2. Another evening: keep a task running past 21:00, complete it later.

You should see:
- "You were clocked out" / "Clocked out at 21:00 (end of the day)." Location stops.
- Office Duty log: Clock out 21:00 "auto at the cut-off".
- With a task running at 21:00 the driver is not clocked out; the next run after the task is completed does it (within
  15 minutes).
- A period left open from an earlier day closes at that day's 21:00 with no notice.
- Sinhala: "ඔබව රාජකාරියෙන් ඉවත් කළා".

### A25. The phone's notification channels (Hotfix 2 B)
1. Android Settings → Apps → Fame Driver → Notifications.
2. Lock the phone and have the office send a new task.

You should see:
- The channels "New tasks" ("New, changed and cancelled tasks") and "Questions from the office".
- The new task rings loud and shows on the lock screen. (The ringtone that rings until opened: 1.3.0, Part 6 P2.)

## B. The requester (staff: request + view)

### B1. What a requester sees (Hotfix 3 L1, L5)
Setup: sign in as the Requester on the laptop and on the phone.
1. Look at the Overview and the menu.
2. On the phone, look at the bar.
3. Open `/drivers/board` and `/tasks` by URL.

You should see:
- Overview: "My trips" (the latest 5 with their live state) and "At a glance". "Need a vehicle? … sends it to the
  fleet office; you are told when it is decided." with **New request**.
- The menu: Today (Overview, Live locations, Requests, My trips) · Fleet (Vehicles, Drivers) · Admin (Projects,
  Settings).
- The phone bar: Home, My trips, Vehicles, Live, More.
- Both URLs: "No access" / "Your account does not have this permission (…). Ask an admin for access."

### B2. A new request with the full planner (Part 3, §34)
1. **New request**.
2. Project or team; the Day; Leave by (or an arrive-by on a stop); Back by.
3. Stops: a pickup and two drops. On each, "Time at this stop": 5 min, 15 min, 30 min, 1 h, 1 h 30 min, 2 h, or
   Other.
4. Wait 1.5 s or press **Plan now**.
5. Vehicle, Passengers, "A driver is needed" → **Save request**.
6. Start another request, leave the page, come back.

You should see:
- "New vehicle request" / "Ask the fleet office for a vehicle". No driver, no vehicle, no Who's available.
- The plan: "Leave by 07:24"; rows "Stop 2 · Drop · Kurunegala site" with "arrive 09:00 · 1 h 30 min · leave 10:30";
  the map with numbered pins and Google's road line.
- Saved: "Sent to the fleet admin · you'll be notified". The approvers get "Vehicle request · <name>".
- 6: "Resume draft from HH:MM · Discard".

### B3. My trips (Hotfix 2 A, Hotfix 3 L3)
1. My trips (`/my-trips`).
2. Try the status filter, the date range and the search box.

You should see:
- "My trips" / "The vehicles you asked for and the tasks you proposed or created".
- Status: Waiting, Approved, Under way, Completed, Declined, Cancelled, All.
- Each row's live state: "Waiting", "Approved", "Driver accepted · 09:12", "On the way · 09:30", "Arrived · 10:05",
  "Completed · 11:40", "Declined · <reason>", "Cancelled · <reason>".
- Approved rows: "Approved by Palitha · 10:42", the driver's photo and plate, **Call driver**, **Call fleet admin**.
- At the bottom: "The fleet office" / "Questions about a trip" / **Call office**.
- 25 rows a page: page numbers on a computer, "Load more" on a phone.

### B4. The request page after approval (§4, Part 3)
1. Open an approved request.
2. Ask the fleet admin to move its time on the task, then reload.

You should see:
- Before approval: never a driver or a vehicle.
- After: "Driver and vehicle" with both photos, Call driver and WhatsApp (a phone: Call and WhatsApp; a computer: the
  number, Copy and WhatsApp web), and "Approved by Palitha · 10:42".
- After the office's change: the task's time and stops, and "Changed by the office · was 09:00 Sat 17 Oct · stops
  changed". Never the old plan.

### B5. Updates while the trip runs (§4, Part 3b)
Setup: the trip from B2, approved. The driver starts it, reaches the first pickup and reports Running late; the office
changes the driver, then cancels.
1. Keep the web app open; watch the tray and the pushes.
2. Open each item.

You should see:
- "On the way · <driver> · <plate>", "Arrived at <stop> · <driver>", "<driver> is running late · 15 min", "Driver
  changed: <new> instead of <old>", and the cancellation.
- Each opens the request page. The tray's count goes up, then down as you open them.

### B6. Change or withdraw a request (Phase 6 Part 2, Part 3)
1. A waiting request → **Edit request** → change the passengers → **Save changes**.
2. An approved booking → Edit request → change the time → **Save · ask for re-approval**.
3. Another waiting request → **Withdraw** → a reason → **Withdraw the request**.

You should see:
- 1: it stays waiting.
- 2: first "This booking is approved: your change needs re-approval. The office is told, and the booking keeps its old
  plan until they decide again." Then "Changed · the office will decide again". The approvers get "Request changed ·
  needs re-approval · <name>".
- 3: "Request withdrawn".

### B7. What a requester never sees (H6, §12)
1. Live locations and Drivers.
2. Settings.

You should see:
- No phone numbers and no Call on Live and Drivers. No Who's available, no Ask drivers, no Drivers board.
- Settings: My profile and Notifications only.

### B8. A requester's notifications (Hotfix 2 A, B)
1. Settings → Notifications → "Tell me when".
2. Untick one, reload.

You should see:
- Among them: "Your request is decided", "Your driver is on the way", "Your driver is running late", "Your driver has
  arrived", "Your driver is changed", "Your trip is cancelled".
- The untick stays. The tray still lists everything you were told about.

## C. The dispatcher (assign tasks + view, no approve)

### C1. Overview and menu (Hotfix 3 L1, L5)
1. Sign in as the Dispatcher on the laptop and the phone.
2. Collapse "On the road" on the laptop (click its title), then open the Overview on the phone.

You should see:
- Sections: Needs a driver (only while any), Critical issues (the task kinds, only while any), At a glance, On the
  road, Needs attention. No Requests to approve.
- 5 rows a section (3 on the phone) and "View all (N)".
- The menu: Today (Overview, Live locations, Tasks, Requests, My trips, Issues, Drivers board) · Fleet (Vehicles,
  Drivers) · Reports (Duty log) · Admin (Projects, Settings). A section's title collapses it.
- The phone bar: Home, Tasks, Live, Issues, More. Home's big button: "Assign a task".
- 2: on the phone "On the road" is collapsed too (kept for the person).

### C2. Assign a task: the vehicle fills itself, the best match (Part 2, the hotfix after Round A)
1. Tasks → **Assign a task**. Title, Date, the stops.
2. Watch Who's available. Click the best match's **Use suggestion**, then click another row.
3. Leave the page open for two minutes, in light and in dark mode.

You should see:
- "Who's available": each row with the photo, "On duty since 07:12 · next task 13:00 · 2 accepted · 1 declined",
  "Free", "Busy", "Free · off duty", or "Not available · half day, back 13:00" (never free).
- "Best match" with its reasons ("On duty · free 08:00–12:00 · 3.2 km from the pickup · 1 task today") and **Use
  suggestion** ("Using it" once picked).
- The vehicle fills itself: "WP CAB-4521 · Kamal's vehicle today" or "… Kamal's regular vehicle". With neither: "This
  driver holds no vehicle today and has no regular one."
- A picked row has ✓ and a blue bar, readable in dark mode. It stays picked through the refreshes; the rows do not
  reorder or flicker.

### C3. The plan: start, stops, timeline, departure (Part 2, 2b, Hotfix 2 C, D)
1. Start from: the base place. Tick **Passengers get in here**.
2. Add a pickup at the same place.
3. Stops with "Time at this stop" (1 h 30 min on one) and an arrive-by 09:00 on Stop 3.
4. Type a Leave by later than needed (`08:00`), slowly, digit by digit.
5. Clear Leave by.

You should see:
- The start is "Stop 1 · Pickup · <base place>". The next stop is Stop 2.
- 2: on that row "Same as the start. Tick ‘Passengers get in here’ instead." with **Tick it** (it removes the row).
- The timeline: "Leave by 07:24" at the top; each stop "arrive 09:00 · 1 h 30 min · leave 10:30"; legs "42 km · 1 h
  5 min · Google traffic"; "Via expressway" where it applies; the totals. A place used before shows its time with
  "· usual here".
- 4: nothing plans or warns while you type. After you leave the field (or Enter, or 1 s after a whole time), in red:
  "Leaving 08:00 you reach Kurunegala site at 09:36, 36 min after 09:00. Leave by 07:24." with **Use 07:24** and
  **Move arrive-by to 09:40**. Much earlier: "Arrives 25 min early".
- 5: "Empty: planned from the stops’ arrive-by times."
- The plan map beside the timeline (above it on a phone); a pin and its row highlight each other.

### C4. Send for approval (Part 3, §33)
1. Finish C3 and save.
2. Pick a vehicle that is on another task at that time, then save again.

You should see:
- Above the button: "New tasks need the fleet admin’s OK: this one waits for it, then goes to the driver." The button
  says **Send for approval**.
- After: "Waiting for the fleet admin's OK · you'll be notified." with **Open the request**. The driver's phone gets
  nothing yet.
- Tasks board: the first column "Waiting for approval" with the card.
- 2: a card such as "WP CAB-4521 is on task Team drop 08:00–11:00 for Dilini (driver Kamal)" with **Open that task**,
  Call / WhatsApp the requester and the driver, and **Pick another vehicle**. Saving is never blocked.

### C5. Needs a driver (Part 2, §19)
Setup: a driver declines a task (A11), or does not accept in the window (A7).
1. Look at any Tasks page, then the Overview.
2. Tap the push (or the Overview's row).
3. In "Give it to a driver": Use suggestion → **Reassign**.

You should see:
- Within a second on every Tasks page: "1 task needs a driver" with **Show**. Show opens "Tasks that need a driver" /
  "Today and later" with "Back to the board".
- The Overview's red "Needs a driver": "<name> declined · Vehicle problem" or "<name> hasn't accepted · needs a
  driver", the note, "in 42 min" or "18 min late", and "Best match: Nuwan Perera · WP CAB-4521".
- The push "<name> declined '<title>' 09:00 · Vehicle problem · needs a driver" to the dispatchers, the person who
  assigned it and the requester.
- 2 opens the task's change page with the reason at the top: "<name> declined: Vehicle problem. Give it to another
  driver, or cancel it." (or "… hasn’t accepted it. Give it to another driver, or call <name>.").
- 3: "Task sent to <driver>". The banner goes. Live's row said "declined the 09:00 task" until then.

### C6. Live: duty, Clock out, Move to vehicle (Part 1)
1. Live locations → the chips All / On a task / On duty / Off duty / Problems.
2. test.driver (on duty, no task) → **Move to vehicle** → pick a vehicle another driver holds → **Move**.
3. Back on Live → **Clock out** → **Clock out**.

You should see:
- Each card's duty chip: "On a task · since 08:12", "On duty · since 08:02", "Off duty · since 17:40 · auto at the
  cut-off". Off-duty drivers are in the list, not on the map.
- 2: "Move <name> to a vehicle", "Choose the vehicle": "Current vehicle · since 08:40", "With Nuwan Perera now · since
  07:55", "Free", "In garage". After Move: "<name> is now on WP CAB-4521. <other> was told." The phone gets "The office
  changed your vehicle · Your vehicle is now WP CAB-4521".
- 3: "Clock out <first name>?" / "Their location stops being recorded." with **Clock out** and **Keep on duty**. Then
  "<name> is off duty since 17:40." The phone: "You were clocked out" / "The office clocked you out at 17:40." The card:
  "Off duty · since 17:40 · by the office".
- Clock out is not offered during a task.

### C7. Swap the vehicle during a task (Part 2)
Setup: test.driver on a task in progress on WP CAB-4521 (the phone side is A12).
1. Live → test.driver → **Move to vehicle**.
2. "The vehicle the task goes on in": WP KL-1234. Leave both odometer fields empty. Reason: "Breakdown near
   Kurunegala" → **Swap**.
3. On the task page, type the old vehicle's reading in the swap section → **Save**.

You should see:
- The page "Swap the vehicle during the task", with "Old vehicle's odometer now (km)", "New vehicle's odometer now
  (km)" and "Leave empty and the driver enters it on the phone."
- After: "Swapped to WP KL-1234" / "The task goes on in WP KL-1234." with **Open the task**.
- The task page's "Vehicle swap": both stretches, "Reading to come from the driver" until the phone sends it, then the
  km added up ("Total …").
- 3: "Reading saved".
- A "Needs another vehicle" issue (A13) resolves itself.

### C8. The duty log (Part 1)
1. Drivers → **Duty log** (or Reports → Duty log).
2. Today, Yesterday, This week; one driver.

You should see:
- "Duty log" / "Drivers · Start work to Finish work". The table "Duty periods": Driver, Clock in, Clock out, Hours,
  Vehicles, Tasks, Task km, GPS km.
- Clock out with "by the driver", "by the office" or "auto at the cut-off"; "On duty" while open.
- Vehicles: "08:12–12:40 · clocked in → taken over by Nuwan".
- A period the server opened: "opened by the server: a task was running".
- GPS km only for ranges up to 7 days. Empty: "Nobody has started work today."

### C9. Reopen a task (§18)
Setup: a task completed today with a wrong end reading.
1. Task page → **Reopen task** → "Why is it reopened?" → "Wrong end reading" → **Reopen task**.

You should see:
- The second step on the page (no dialog), with **Keep completed** to back out.
- "Task reopened: the driver finishes it again". The status is In progress.
- The driver: "Task reopened · <title> · finish it again in the app".
- History: "Reopened by <you>: Wrong end reading · was completed 14:20 · end odometer 1003 km".
- Only the same Colombo day; refused while the driver has another task running.

### C10. The task page after the day (Parts 1, 2, Phase 6 5b)
1. Open a completed task with arrivals, a swap and a skipped stop.

You should see:
- Each stop: "Stop 2 · Drop · Kurunegala site", "planned 09:00–10:30 (1 h 30 min) · actual 09:04–10:41 (1 h 37 min)",
  the arrival flag (A8), and where the driver arrived ("the driver arrived 09:04 near … · phone ±12 m · map").
- "WP CAB-4521 taken over from Nuwan 08:40" when Start task took the vehicle.
- "Vehicle changed by Palitha: WP X instead of Kamal's regular vehicle WP Y" when the office chose another vehicle.
- "Saved past these warnings:" when it was saved over a warning.
- The History list.

### C11. The Drivers board and its week view (Part 3b H5, H1)
1. **Drivers board** (`/drivers/board`). Try the filters and Find a driver.
2. View: **Week**. Previous week / Next week / This week.
3. On test.driver2's row, a day from today on: **+** → Day, Last day, When: Full day, Reason: Leave → **Save**.
4. Open the entry → **Remove** → click again.
5. **New task** on a row.

You should see:
- "Drivers board" / "Who can drive now and this week". Filters with counts: All, Free now, On a task, Off duty, Not
  available.
- Each row: the photo, the status, "Last seen 17:42 near Kadawatha · usually starts 07:40", "Next: Team drop · 14:30",
  Call and WhatsApp, a tick box, "New task".
- The week: each day's tasks ("09:00–11:30 Team drop") and the not-available chips; "· today" on today.
- 3: the editor "Not available: <name>" with "Full day", "Morning until 13:00", "Afternoon from 13:00", "From–to" and
  Leave / Half day / Personal / Other. Saved: "Saved: <name> · Leave · all day". The driver's Me → Availability lists
  it, "Added by <you>".
- 4: "Remove? Click again", then "Removed: <name> is available Mon 20 Oct".
- 5: Assign a task with the driver filled in.
- On a phone the week shows one driver at a time.

### C12. Ask drivers (Part 3b H3)
1. In Who's available tick two drivers → **Ask drivers** (or Drivers board → Ask drivers).
2. "Free for a trip?" with the Day, From, To and a Note → **Send the question**.
3. Watch the answers page while the drivers answer (A19).
4. A Yes asked from a task page → **Assign**.
5. Ask "When can you be at the office?" and "Where are you now?" to "All free ones".
6. Ask about a trip time already passed.

You should see:
- "Ask drivers" / "Drivers · one question, one-tap answers". The three questions, "Drivers I choose" / "All free ones".
- "Asked 2 drivers". The page "Answers from drivers": "2 asked · 2 seen · 1 answered · 1 yes"; each driver "Sent
  10:02 · Seen 10:03 · Answered 10:05"; answers "Yes", "Call me", "At the office at 10:30", "Shared where they are"
  with "near Kadawatha · ±12 m" and Map; "No answer yet". The answers arrive without a reload.
- The tray: "A driver answers your question".
- 4: the task's change page (or the decide page, or a new task) with the driver, the day and the time filled in.
- "Open until Mon 20 Oct 09:00", then "Closed". Questions → "Questions to drivers" / "Drivers · the last 7 days".
- 6: "That trip time has passed: ask about a later time."

### C13. Trips a driver started, in the office (Part 4, §13)
1. Tasks: find the trips from A15 and A16.
2. Open the personal one → "Company or personal" → Company work → a project (job number) → **Save**.
3. Open the company one → Personal → **Save**.
4. Mileage, this month.

You should see:
- The cards tagged "Driver-started" and "Personal".
- The task page: "Driver-started trip", the switch and "Attach a project".
- 2: "Now company work · charged to TRKAN1". 3: "Now personal: its km are counted apart from the jobs." A personal
  trip with a project: "A personal trip has no project: choose Company work to attach one."
- 4: "Personal km: 42 km, never charged to a job."

### C14. Task history and the date range (§8, Hotfix 3 L3)
1. Tasks → **History** (on a phone: More → Task history).
2. This week (the default), then Custom; Status: Missed; Kind: Driver-started; search "Title, driver or plate".

You should see:
- "Task history": When, Task, Route ("Head office → Kurunegala site · 4 stops"), Km. The header "12 completed · 1
  cancelled · 340 km · 2 driver-started · 1 personal".
- The range chips: Today, Yesterday, This week, This month, Last month, Custom. The range is kept in the URL.
- Status: All statuses, Assigned, In progress, Completed, Cancelled, Declined, Missed. Kind: All, Office tasks,
  Driver-started.
- 25 rows a page (page numbers on a desktop, "Load more" on a phone). Empty: "No tasks (Mon 12 Oct – Sun 18 Oct
  2026)."

### C15. The maps (Part 2b)
1. A task's plan map (Assign a task, the task page).
2. The driver page (`/drivers/test.driver`) on a day with a gap: hover or tap the grey gap marker; click a Gaps row.
3. **Play** at 60×, then drag the time slider.
4. Live: the map controls on a desktop and a phone.

You should see:
- 1: the start "S · <name>" and pins "2 · Kurunegala site · 09:00–10:30" (a missed arrive-by in red, "· late"),
  Google's road line. Under the open package: "Straight lines, not the road". A Google stop on a map that is not
  Google's: "Google place, not drawn: …".
- 2: no text on the map; one grey marker per gap. Its card: "App not running · 14:02–14:44 · 42 min · about 21.3 km by
  road" (or "Stopped · no GPS signal", "Offline here · uploaded 14:20"). The "Gaps" list beside the timeline; a row
  zooms there. Estimated lines dashed slate. "Recorded points" switches the snapped line off.
- The day control in one-day mode: Today, Yesterday, Custom day.
- 3: speeds 1×, 5×, 20×, 60×. The clock "14:32:05", with "· estimated" in a gap (the marker hollow there). The marker
  turns with the road and never jumps.
- 4: one cluster on the right edge: Zoom in, Zoom out, "North up" (only while rotated or tilted), "Today’s trails"
  (filled when on), "Fit everyone on the map". Never "Use ctrl + scroll to zoom".

## D. The approver / fleet admin (approve, vehicles, issues)

### D1. The Overview for an approver (Hotfix 3 L1, L2)
1. Sign in as Fleet admin A on the laptop and the phone.
2. Click a Needs attention group.

You should see:
- In this order: Requests to approve (amber), Needs a driver (red, only while any), Critical issues (red, only while
  any), At a glance, On the road, Needs attention.
- Requests to approve: "Oldest waiting 5 h 11 min"; it never says "Nothing waiting" while something waits. Proposals
  marked "Proposed task", late ones "Leave-by passed".
- Needs attention groups: "Odometer typed by hand · 9", "Documents missing on 3 vehicles", "Km outside tasks · 2
  vehicles", "Missed tasks · 6"; a group opens in place. No info rows; no row of the sections above repeated.
- The phone bar: Home, Requests, Tasks, Live, More.

### D2. Snooze and dismiss (Hotfix 3 L2)
1. A Needs attention row → "Snooze or dismiss" → Snooze → **Until tomorrow**.
2. Another → **1 week**.
3. A group → **Dismiss** → **Yes, dismiss 9**.
4. Issues → Status: Snoozed.

You should see:
- "Snoozed … until tomorrow 07:00", "Snoozed … for a week". The row leaves the Overview and the counts.
- 3: "Dismiss all 9?" / "It leaves the lists until it comes back worse." with **Keep**.
- 4: "Snoozed until 2026-10-19 07:00 · by <you>".

### D3. Missed tasks and expired issues (Hotfix 3 L2)
Setup: a dispatched task never started, its leave-by over 24 hours ago (the first sync marked 7 such tasks on 18
October).
1. Task history, Status: Missed. My trips of its asker.
2. Issues.

You should see:
- Its status "Missed"; My trips "Missed · never started". The driver's app no longer lists it; no push went.
- One "Missed task" issue per task until someone resolves it.
- The task's own issues resolved with "Expired: the task is over and its leave-by passed over 24 hours ago". A vehicle
  problem or an odometer check stays open.

### D4. A proposed task: decide it (Part 3, §33)
Setup: the dispatcher's task from C4.
1. Requests (Waiting): the card "Task for <driver> · <plate> · proposed by <dispatcher>" with the "Proposed task" pill
   → **Review**.
2. **Send as proposed**.
3. Another proposal: change the driver → the button; then decline one with a reason.

You should see:
- The push to everyone with approve: "Task to approve · <dispatcher> proposes <driver>".
- "Decide the task": the stops and plan as proposed with the map, the warnings and conflicts, "As proposed" with the
  driver and vehicle.
- 2: "Sent as proposed." / "The task is in the driver’s app." with **Open task**. Only now the driver gets the new-task
  push, and the accept window starts.
- The dispatcher: "Task approved by <you> · sent to <driver>"; a decline: "Task declined by <you> · <title>".
- 3: a change turns the button into **Approve and send**.

### D5. Not decided in time (Part 3, §35)
Setup: a waiting request or proposal leaving in 35 minutes.
1. Do not decide it.

You should see:
- 30 minutes before its leave-by: "Not decided yet: <title> …" to every approver and the asker.
- At its leave-by, once, to the approvers: "Leave-by passed, not decided: …".
- The card: "Leave-by passed" and "It is never sent by itself: send it with a later leave-by, or decline it."

### D6. A requester's trip: decide the request (Part 2 item 3, Part 3 §34)
Setup: the requester's request from B2.
1. Requests → **Review** → "Decide the request".
2. Let Who's available load. Keep the best match. Pick a vehicle other than the default.
3. **Approve and send**.

You should see:
- The driver field starts on "The best match" once Who's available has loaded (it does not jump).
- The vehicle fills itself from the driver ("Kamal's vehicle today").
- "Approved." / "The task is in the driver’s app." The request's stops are on the task as asked (nothing retyped).
- The requester: "Request approved by <you> · …", with the driver's photo where Chrome shows one.
- The task page: "Vehicle changed by <you>: WP X instead of Kamal's regular vehicle WP Y".

### D7. Two approvers at once (Hotfix 2 K)
Setup: Fleet admin A on the laptop, B on the phone, one waiting request.
1. A opens its decide page.
2. B opens Requests, then the same request.
3. A approves. Then B taps the approve button.

You should see:
- Within 20 s, on B's queue row and decide page: "A is reviewing" (two at once: "A and B are reviewing").
- B: "Already approved by A at 10:42." Nothing is made twice.
- The request page and task: "Approved by A · 10:42".

### D8. Tell requester (§4)
Setup: a request "On behalf of" someone without an account, with a "Requester's phone".
1. Approve it. On the request page use **Tell requester**.
2. Clear the phone ("Requester's phone:" → Change → empty → Save) and use it again.

You should see:
- WhatsApp opens with the message in English for the moment (approved, driver changed, on the way, arrived,
  cancelled). Nothing is sent by itself.
- "Phone cleared", then "With no phone saved, WhatsApp asks whom to send it to."

### D9. A changed booking (Phase 6 Part 2, Part 3)
Setup: B6 step 2 done.
1. The push "Request changed · needs re-approval · <name>" → "Decide the change".
2. **Keep as asked**.

You should see:
- "The booking keeps its old plan until it is decided again."
- After Keep: only what the requester changed is applied; the office's own edits to the task stay.

### D10. Vehicle photos (Part 3 §6)
1. Vehicles → a vehicle → **Upload photo** (a JPEG). Then replace it.

You should see:
- "Photo added.", then "Photo replaced. The old one is kept."
- The thumbnail beside the plate on Vehicles, Live, the board, Who's available, the decide page and the driver's
  picker.

### D11. Vehicle documents (Part 3 §28)
1. A vehicle → "Documents" → Revenue licence: set Expires → **Upload** (a photo or a PDF).
2. **View**. Then **Replace** with another file.
3. Insurance → **Remove** → Remove.
4. "Removed documents" → **Restore**.
5. A file over 10 MB.
6. Register vehicle: a new one.

You should see:
- "A photo or a PDF, up to 10 MB. Set the expiry date before you upload or replace the file: it is the vehicle's date
  too." Each row "Uploaded by <you> 18 Oct 10:05", or "No document".
- "Saved."; "Replaced. The old file is under Removed documents."; View opens a 1-hour link in a new tab.
- 3: "It moves to Removed documents and can be restored. The vehicle's date stays as it is." with **Keep it**.
- 5: "This file is … : a document can be up to 10 MB." (a PDF: "This PDF is …").
- 6: "Add its documents now, or later on the vehicle's page."
- Vehicles: the chips Lic / Ins / Emi in their tones and a grey "no document". Issues and Reminders: "3 documents
  missing: insurance, emission test, CR" (info, never on the Overview).

### D12. A driver's photo and profile (Part 3, Part 3b G)
1. Drivers → **Manage** test.driver (`/drivers/test.driver/edit`) → **Replace photo**.
2. Contact → **Edit**: change the mobile. Then try to empty it.
3. Emergency contact → Edit. Driving licence → **Replace front**, **Add back**.
4. Not available → **Add**.
5. Look at Changes. Then open the same page as the Dispatcher.

You should see:
- "A clear photo of the face. It is cut to a square in the middle and made 512 × 512." → "Photo replaced. The old one
  is kept."
- 2: "Driver updated"; emptying: "A driver always has a mobile number: type the new one instead of emptying it."
- 3: "Licence front saved. The old photo is kept."
- "Missing: phone, licence expiry and emergency contact." while anything is missing.
- Changes: "Phone: 077 111 2222 → 077 333 4444 · changed by <you> · …"; the driver's own "changed by the driver" in
  bold.
- The Dispatcher (assign tasks only): no emergency contact, no licence. A Requester never.

### D13. The Issues page (Part 4 §9, Hotfix 3)
1. Issues. Try Status (Active, Open, In progress, Snoozed, Resolved, Dismissed, All), Kind, Vehicle, Severity, Order,
   the date range and the search.
2. Open an issue on the laptop; press Esc. Open it on the phone; Back.
3. **Take**; **Add note**; **Resolve** without a note, then with one.

You should see:
- Desktop: a panel beside the list with "Close (Esc)". Phone: a full page with Back.
- The panel: "Opened", "Opened by" ("System · Vehicle problem" or the person), "Taken by" ("Nobody yet" or the name with
  the time), and "Deal with it" with Take, Add note, Resolve, Dismiss.
- 3: "Write what was done first: it becomes the resolution."; then "Issue resolved". The panel closes and the row
  changes in place, with no reload flash.
- The count is a badge on the Issues menu item (on a phone, on More). 25 a page.

### D14. The Overview's tiles open their lists (Part 4 §16)
1. Laptop: click each tile of "At a glance". Reload with a panel open.
2. Phone: tap each tile, then Back.

You should see:
- Laptop: a panel beside the Overview (`/?open=road` …), kept on reload, closed with X or Esc: "Vehicles on the road",
  "Free now", "In garage", "Tasks today", "Requests to approve" ("Waiting for a decision"), "Reminders due" ("Due in the
  next 14 days"), each with "Open the full page".
- Phone: the page itself (`/live?filter=road`, `/vehicles?filter=free`, `/vehicles?filter=garage`, `/tasks`,
  `/requests`, `/reminders`); Back returns to the Overview.
- Reminders: "Documents and services due", then "Also needs attention".

### D15. The notification centre and sounds (Hotfix 2 A, B, Hotfix 3 L4)
1. The tray icon in the top bar (the old bell is gone). On a phone: `/inbox`.
2. Show **Unread**; **Mark all read**.
3. With the page open, have the dispatcher propose a task; have a driver decline one.
4. Open a fresh tab and wait for a new item without clicking.
5. Settings → Notifications → "Sounds while Fame Fleet is open": Test sound; volume 0.

You should see:
- The unread count on the icon. The panel "Notifications": Show All / Unread, "Mark all read", groups Today /
  Yesterday / Earlier. An item opens its page and becomes read.
- 3: a banner "New notifications" with Open / Close, and a sound per kind: Urgent (a task to approve, a task that needs
  a driver), Alert (a request decided, a task declined), Soft (on the way, arrived), Alarm (a critical issue).
- 4: the strip "Click to turn on sounds" / "The browser keeps this page quiet until you click."
- 5: "Play sounds", "Volume", "Test sound" and Play per kind; at 0: "The volume is at 0: nothing plays."
- The notifications page: "Everything you were told about", with "History" for read items over 30 days old.

### D16. Remove and restore a place (Part 3 §15)
1. Places → a test place → **Remove** → **Yes, remove**.
2. Try the same on the base place (stop at the second step with **Keep it**).
3. Places → **Removed places** → **Restore**.

You should see:
- "It leaves every search, list and picker. Past tasks keep its name. Nothing is deleted: it can be restored."
- 2: the reasons above the second button, e.g. "Head office is the base place; 2 tasks today or later start or stop
  there."
- After: "Removed. It is listed under Removed places." Searches and pickers no longer offer it.
- 3: "<name> restored".

### D17. Mileage and Fuel over a range (Part 4 §8, Hotfix 3)
1. Mileage: the default, then Custom over three days.
2. Fuel: the default, then This month.

You should see:
- Mileage starts on This month. A range shows its own rows and totals, plus "<Month> (allowance)" / "The whole month
  that contains the last day chosen". "Personal km: … never charged to a job." when there are any.
- Fuel starts on This week (it was the month): "Fills", "Videos", "Without a video".

## E. The viewer (view only)

### E1. Overview, menu and bar (Hotfix 3)
1. Sign in as the Viewer on the laptop and the phone.

You should see:
- Overview: At a glance and On the road only. No Assign task, no New request.
- The menu: Today (Overview, Live locations, Requests) · Fleet (Vehicles, Drivers) · Admin (Projects, Settings).
- The phone bar: Home, Live, Vehicles, Drivers, More. Home's big button: "Live locations".

### E2. Reading, never acting (§12, Hotfix 2 F)
1. Live locations and Drivers.
2. Open by URL: `/drivers/board`, `/drivers/duty`, `/tasks/new`, `/settings/fleet`, `/drivers/test.driver`.
3. Settings → Notifications.

You should see:
- No phone numbers, no Call, no Clock out, no Move to vehicle.
- 2: "No access" / "Your account does not have this permission (…). Ask an admin for access." on each.
- 3: only the events about a vehicle the person looks after ("A vehicle you look after is booked", "A booking of your
  vehicle is cancelled", "A booking is changed by the office").

## F. The admin (Users and Settings)

### F1. Add an office user; view comes with every permission (Part 2 §12)
1. Settings → Users → **Add office user**: name, e-mail, Mobile. Tick Approve.
2. Untick Approve.
3. **Create account**.

You should see:
- With Approve ticked, View ticks itself, greyed and locked: "Needed by the other permissions". Unticked, View is free
  again.
- "Every other permission brings View with it. Fleet admin = everything but Users; Dispatcher assigns tasks; Requester
  asks for vehicles and sees what a viewer sees; Viewer only reads."
- "Account created" and the "Set-password link" ("Valid for 1 hour. …") with Copy / Share by WhatsApp.

### F2. Phone numbers (Hotfix 2 F)
1. As an approver with no number: look at the top of any page.
2. Settings → My profile → My phone number: `0771234567` → Save. Then `123`.
3. Settings → Users → a person → "Name, phone and permissions": change the Mobile.

You should see:
- 1: "Add your phone number so drivers can call you." with **Add my number**.
- 2: "Saved: 077 123 4567."; "Type a Sri Lankan number, e.g. 077 123 4567." for a bad one.
- 3: "User updated". Numbers show as "077 123 4567" everywhere (stored +94…).

### F3. Settings → Fleet: the Phase 7 settings (Parts 1–4, Hotfix 2)
1. Open Settings → Fleet and read each card. Change one value, Save, reload, put it back.

You should see:
- "Office phone number" ("Saved: …"; empty: "None saved: Call office is not shown.").
- "Time at a stop": pickup 5 min, drop 5 min, visit 1 h.
- "Accept window": "Accept within (min after sending)" 15, "Accept at the latest (min before leaving)" 30, "Reminder to
  the driver (min after sending)" 5.
- "End of the working day": "Clocked out at 21:00 (Colombo time)."; empty: "Empty: nobody is clocked out by the
  server."
- "Approval": "New tasks need the fleet admin's OK" (on).
- "Vehicle on the day": "Tasks may leave the vehicle to the day" (off).
- "Driver-started trips" → "Personal trips": "Allowed: Company work preselected, Personal offered", "Personal
  preselected", "Off: no Personal choice", "Ask first (not built yet: works as Allowed)".
- "Map package": the caps 430 a day for the map, place search and place details, 215 for road times and snap to roads.
- "Setting saved" after each Save.

### F4. A new driver needs a mobile (Part 3b G)
1. Drivers → **Add driver** without a mobile → save. Then with one.

You should see:
- The field "Mobile (needed)". Without: "Add the driver's mobile number."
- With: "Driver added" and the PIN shown once.

### F5. Switch on "Vehicle on the day" (Hotfix 2 J; only when both phones have the Hotfix 2 update or later)
1. Settings → Fleet → Vehicle on the day → on → Save.
2. Assign a task: open the vehicle field.
3. Then A23 on the phones.

You should see:
- The vehicle field offers "Driver's vehicle on the day" and "Any van" (and the other types) besides the plates, with
  "The driver confirms the vehicle they hold at Start task." / "The driver picks one at Start task."
- Saved tasks: "Vehicle: on the day" on the board and the task page until the driver confirms.
- While it is off, Claude's create_task with "on the day" is refused in words.

## G. Claude through the connector ("Fame Fleet", the shared key)

Ask in Claude Teams. The shared key is an admin key: it sees everything and its tasks go straight to the driver.

1. "Who is on duty now, and since when?" → `live_drivers`: each driver's duty (on a task, on duty, off duty), since
   when, the vehicle and since when.
2. "Show today's duty log" and "test.driver's duty this week" → `duty_log`.
3. "Move test.driver to WP KL-1234", then "Clock out test.driver" → `move_driver_vehicle`, `clock_out_driver`. With a
   task running, the clock-out is refused in words and the move is the swap of C7 (the readings typed, or left to the
   phone).
4. "Plan a trip tomorrow 09:00 from the head office to Kurunegala site with a 1 h 30 min stop there" → `plan_task`:
   the timeline (leave, legs, stops with their time there). A pickup at the start without "passengers get in here":
   the warning about ticking it.
5. "Create that task for test.driver" → `create_task`: `vehicle_used` with why ("Test Driver's vehicle today"), the
   conflicts as cards. No `waiting_for_approval` (the shared key has approve).
6. "Which tasks need a driver?" and "Who is free tomorrow 14:00–17:00 near Kadawatha?" → `task_board` `needs_driver`
   with the best match; `availability` with `best`, the ranks and "Not available · …".
7. "What waits for approval?" → `list_requests` (kind task) and `task_board` `waiting_approval`; "Send it as proposed"
   → `decide_request`.
8. "Reopen today's task <title>: wrong end reading" → `reopen_task`; "The old vehicle's end reading was 45,262" →
   `swap_reading`.
9. "List last week's tasks of test.driver, 25 at a time" → `list_tasks` with `limit`, then `next` for the rest; "Make
   that trip personal" → `set_trip_purpose`; "Personal km this month" → `mileage_summary` `personal_km`.
10. "What needs attention?" → `fleet_overview` `attention` (the groups) and `critical`; "Snooze the odometer group for a
    week" → `update_issue` with snooze.
11. "Show the drivers board for this week", "test.driver2 is not available tomorrow morning", "Ask the free drivers if
    they are free tomorrow 09:00–12:00", "What did they answer?" → `drivers_board`, `set_unavailability`,
    `ask_drivers`, `ask_answers`.
12. "Show test.driver's profile" → `driver_profile` (with the private part: the shared key is an admin). "Add a driver
    with no phone" → refused.
13. "Show my trips" / "my notifications" → refused as expected: "This is personal: it needs a signed-in person (the web
    app) or a personal connector key."
14. The Teams artifact, after Sahan's update from `docs/teams-artifact-update.md` (85 tools): the Overview by role with
    Needs a driver first, Tasks with "Waiting for approval", the Drivers board, Ask drivers (answers every 10 s), the
    drawn map with gap markers and plan pins ("Straight lines, not the road"). Each new tool asks the connector's
    permission once.

## Hotfix 4 (office web: one New request, back means back, Ask drivers as its own step)

Run on a laptop and on a phone's browser, after the web deploy.

### H4-1. One "New request"
1. Requests, as a fleet admin, on a laptop and on a phone.

You should see:
- One "New request": the header's on a laptop, the big button on a phone.

### H4-2. Give it a driver is one page
1. Make a driver decline a task. Open it from the Overview's Needs a driver.
2. Pick a driver by clicking their row, then tap "Give to <name> · <plate>".

You should see:
- The task on top (leave-by, stops with arrive-by, who asked, notes, the map), Who can take it below, "Open task →".
- After Give: back on the Overview; the task has left Needs a driver.

### H4-3. Back means back
1. Open Give it a driver from the push on a phone, then tap back.
2. Open it from Tasks, then tap back.

You should see:
- From the push: the Overview, never the task page. From Tasks: back to Tasks.

### H4-4. Ask drivers as its own step
1. Assign a task: Who's available has no tick boxes. Tap Ask drivers, then Send.
2. On the driver's phone answer Yes.
3. The same on Approve, Give it a driver and the Drivers board.

You should see:
- A sheet with the free drivers ticked and the trip's day and time filled in.
- "Yes" under that driver's row within seconds, with "Use this driver" (it fills the driver and the vehicle); on the board
  "Assign →".

### H4-5. No dead task links
1. As an approver without assign_tasks: open a request page, an issue and a fuel fill.

You should see:
- No "Open task" link (before, it led to No access).

## Part 6 (the 1.3.0 build)

The 1.3.0 build is the `drivers` profile: **one APK for every phone** (64-bit and 32-bit Android), with both maps (Google's
and the free map), four notification channels with sounds of their own, now called **Fame Fleet**, with what the stores ask
for. It is installed once on each phone, over 1.2.0. Everything above is tested on 1.2.0; after the install the tests below
run on 1.3.0.

**Every test below runs on the release build (the `drivers` APK from EAS), on both phones** (the OPPO CPH2119 and the
Samsung SM-A226B). If a phone running 32-bit Android is at the office, install the APK there too and run P1, P5 and P11 on it
(P6).

**Before any phone runs 1.3.0** the round has deployed the migration and push-task (the go order): a 1.3.0 phone deletes the
1.2.0 channels once the server has its new ones, so the server's push-task must already send on them.

Android versions: **minSdkVersion 24** (Android 7.0 Nougat and later install it) and **targetSdkVersion 36** (built for
Android 16's rules). A phone older than Android 7.0 cannot install it; the store build (`store`, an .aab) has the same two
levels.

### P1. Install over 1.2.0, still signed in
1. On the phone, open the EAS link of the `drivers` build in Chrome, download it and open the file. Allow installs from
   Chrome if Android asks.
2. Android asks "Do you want to install an update to this existing app?": Install.
3. Open Fame Fleet.

You should see:
- The download is about 79 MB (one file for every phone, 64-bit and 32-bit; 1.2.0 was 89 MB).
- **Still signed in**, the same duty state and vehicle; Me: "Everything is sent" (or the same "Waiting to be sent" as
  before), App version `1.3.0+…`.
- Today's task map is Google's map, as on 1.2.0.

### P2. A new task rings until it is opened
1. Turn the ring and notification volume up. Lock the OPPO.
2. From the office, send test.driver a new task.
3. Let it ring. Then send a second task and, while it rings, unlock the phone and tap the notification.
4. Send a third with the app open on Today, a fourth with the app in the background (Home), and a fifth after swiping the
   app away from the recent apps.

You should see:
- A two-tone ring, repeating, with a strong vibration, on the lock screen: "New tasks".
- Left alone it rings for 30 seconds, then stops; the notification stays in the tray.
- Tapping it opens the task and the ring stops at once. Opening the app from its icon also stops it.
- With the app open on Today when a task comes, it rings for about 6 seconds and the task shows on Today.
- In the background and swiped away it rings the same as locked; opening the task stops it.
- In Do not disturb the phone stays silent, as for every app.
- Note it if the OPPO cuts the ring after a few seconds.

### P3. A change and a cancellation have their own tone
1. From the office, change the time of test.driver's accepted task: once with the app open, once in the background, once
   swiped away.
2. Then cancel it.

You should see:
- Both times a short falling tone (three notes, twice) under "Changed and cancelled tasks", not the ring.
- A reassigned task that test.driver had accepted gives the same tone.

### P4. A question has its own tone
1. From the office, ask the free drivers if they are free tomorrow 09:00–12:00 (C12): with the app open, in the background
   and swiped away.

You should see:
- A short rising tone (two notes, twice) under "Questions from the office", and the question opens as before (A19).

### P4b. Reminders have their own channel
1. Give test.driver a task that leaves in 35 minutes and do not accept it.

You should see:
- The accept reminder and then the 30-minute leave reminder under **"Task reminders"**, with the new-task sound (not the
  ring), with the app open, in the background and swiped away.

### P5. Nothing lost on 1.3.0
Repeat on each phone, now on 1.3.0:
1. A3, A6, A8 and A9: start work, a new task, Accept, Start task, the map, Arrived, Done, Save & finish.
2. **The odometer photo's suggestion:** at Start task the photo suggests a number (ML Kit), once with mobile data on and
   once with it off.
3. **The fuel video:** a fuel fill with its video (the camera opens, records muted, saves); then Me → "Everything is sent"
   and the office's Fuel page plays it.
4. A2 (your photo) and A20 (a vehicle photo).
5. **Background location:** Start work, lock the phone and leave it 15 minutes with the screen off (in a vehicle that
   moves, or walking); then the driver page in the office.
6. **The offline queue:** airplane mode on, log a fuel fill (with its video), Me shows "Waiting to be sent"; airplane mode
   off. It uploads by itself within a minute ("Everything is sent"), and the office's Fuel page has it.
7. **Navigate, Call and WhatsApp:** on a running task, Navigate opens the Google Maps app with the route to the stop; Call
   contact rings the contact; the WhatsApp button opens the chat.
8. Me → Language: සිංහල, then back.
9. The start and finish sounds on Start task and Save & finish.
10. Settings → Apps → Fame Fleet → Notifications.
11. **An update for its runtime:** after the office says an update is out (`eas update` to the 1.3.0 runtime), open the app
    twice on Wi-Fi; Me → App version shows the new `1.3.0+…` id.

You should see:
- Everything as on 1.2.0, with no error and no "Something went wrong".
- 15 minutes with the screen off: the line on the driver page has no new hole, and the points arrived as they were
  recorded (not "uploaded later").
- In the notification settings, once each: **"New tasks"** ("A new task rings for up to 30 seconds, until you open it"),
  **"Changed and cancelled tasks"**, **"Task reminders"**, **"Questions from the office"**, "General" and "On duty"; in
  Sinhala on a Sinhala phone ("නව කාර්යයන්", "වෙනස් කළ සහ අවලංගු කළ කාර්යයන්", "කාර්ය සිහිකැඳවීම්"). The 1.2.0 "New
  tasks" (two of them), "Task changes" and the first "Questions from the office" are gone once the phone has registered
  with the office (the first open with a connection).

### P6. A 32-bit phone (if one is at the office)
- The same APK installs on 32-bit Android (armeabi-v7a; typically an Android Go phone). A CPU-info app shows the phone's
  ABI.
- Install it there and run P1, P5 and P11. Through Play (the `store` .aab) each phone gets only its own part.

### P7. The name, the icon and the splash
1. Look at the phone's home screen and app drawer, then open the app.
2. On Android 13 or later: Settings → Wallpaper & style → Themed icons on.

You should see:
- "Fame Fleet" under an amber icon with "FF" in dark letters (as on the office site), not "FD".
- Opening: the amber FF square on dark.
- A notification's small icon in the status bar is "FF".
- With themed icons on, the icon takes the phone's colours and keeps the FF shape.
- Me → Sign out asks "Sign out of Fame Fleet?"; Me → Phone setup's steps say "Fame Fleet".

### P8. The location disclosure
1. Sign in on a phone where this driver has not agreed yet (a new phone, or Settings → Apps → Fame Fleet → Storage →
   Clear data first). Permissions → Location → Allow.
2. Tap Not now. Then Allow again, and Agree.
3. Sign out, sign in as the other test driver on the same phone, and open Permissions.
4. On a phone where location is not allowed, answer an office question "Where are you now?" (A19).

You should see:
- Before Android's own question, a full screen "Your location while you are on duty" saying the app collects location to
  show the office where the vehicle is, record the trips and km and mark the stops, while on duty, "even when the app is
  closed or not in use"; "Off duty, the app does not follow where you are" (a photo keeps the place it was taken); the 90
  days; a "Privacy policy" link; Agree and Not now.
- Not now: back to Permissions, nothing asked.
- Agree: Android's question follows at once.
- The other driver sees the disclosure again (it is agreed per driver).
- "Where are you now?" shows the same screen first when Android would ask.
- In Sinhala: "රාජකාරියේ සිටින විට ඔබේ ස්ථානය", "එකඟයි", "දැන් නොවේ".

### P9. The privacy policy
1. The sign-in screen: the line under the form.
2. Me → Privacy policy.
3. On a laptop, signed out: https://fame-fleet.pages.dev/privacy, and the site's sign-in page.
4. Signed in as the admin: Settings → Fleet → Privacy contact e-mail: type an address, Save; open /privacy again. Remove it;
   open /privacy again. Add it again; open /privacy again.

You should see:
- Sign-in: "Fame Fleet 1.3.0" and "Privacy policy"; the link opens the policy in the browser.
- The policy opens without signing in: what is collected (location only while on duty, photos and videos, phone numbers),
  who sees it, how long it is kept (location points 90 days, fuel videos 12 months …), your choices, security, questions.
- The site's sign-in has a "Privacy policy" link.
- Questions: "Write to <the address>" as a mailto: link; after Remove, "Call the office on 011 …" instead; after adding it
  again, the address again. A wrong address ("fame@") is refused with "An e-mail address such as privacy@example.com."

### P10. The reviewers' account (after the round and docs/store-release.md step 3.2)
1. On the second phone, sign in as `store.review`. Start work, Accept a task, Start task.
2. On the OPPO, test.driver: Today → Change vehicle.
3. In the office: Overview, Tasks, Live, Drivers, the Drivers board, Who's available on Assign a task, Fuel, Issues.

You should see:
- The reviewer's Today has the demo tasks ("Demo · Station pickup" and others, every four hours), and Change vehicle offers
  only DEMO-0001.
- test.driver is never offered DEMO-0001.
- The office never shows the reviewer, their tasks or DEMO-0001 anywhere, and a decline or Running late from the reviewer
  brings no notification.

### P11. The same task on Google's map and on the free map
1. Open a running task (Start task) on the phone and stay on it at least a minute: the map. (If Google's map never said
   it finished loading on a real phone, it would switch to the free map here by itself: note it if it does.)
2. In the office: Settings → Fleet → Map package → Open. Wait a minute on the task screen.
3. Map package → Google again. Wait a minute.
4. In Claude: "set phone_map_wait_s to 1" (`update_settings`). On the phone close the app (swipe it away), open it and the
   task. Then in the office: Issues. Then set it back to 30, close and open the app again, open the task; after 5
   minutes, Issues again.
5. Turn on airplane mode, close and open the app, open the task. Then airplane mode off.

You should see:
- Google's map: the stops numbered with their times, the planned road line (blue; driven legs grey), the phone's blue
  dot, the compass when turned, **Follow me** (the round target button: the map follows the phone; a pan stops it).
- Within a minute of Open: the free map (OpenStreetMap's look) with the same stops, times, phone and Follow me; dashed
  straight lines join the stops; a Google place is not drawn and "A Google place: Navigate shows it in Google Maps" shows
  over the map. Within a minute of Google: Google's map again.
- With the 1 s wait: the free map by itself, and the office's issue "Google map failed on <the driver's name>'s phone;
  using the free map" (within 5 minutes). Back at 30 s and the app opened again: Google's map, and the issue resolves by itself.
- Offline: "Map not available" with the stops and "≈ N km straight line" to each stop still to do, and Try again; Start,
  Complete, the odometer, fuel, Report and Navigate all still work. With the connection back the map returns by itself.
  (A map can still draw offline from the tiles it kept: if it does, open a task in a place the phone has not shown before,
  or note it and go on.)
- The same on both phones, in English and in Sinhala.

## If something looks wrong

Note these before you try again, and send them with the section and test number:

- **The time** (Colombo, from the phone's clock), **which phone** (OPPO or the second one) and **which driver**, or
  which office account and the page's address.
- **A screenshot** of what you saw (on the phone: power + volume down), and one line on what you expected.
- **The phone's own state**, Me: "App version" (`1.2.0+…`), "Waiting to be sent: N" / "Everything is sent" / "Could
  not be sent: N" (with Send now / Try those again), and "Live updates" (Connected / Off).
- **What the office sees of the phone**: Live → the driver → the phone line "Phone 14:05: Location on · permission
  always · app 1.2.0+… · 12 points waiting on the phone" (and videos waiting), the duty chip, "App stopped by phone N×
  today", and "N points refused" when the server refused a batch.
- **The day's record**: the driver page (`/drivers/<username>`, that day): the timeline rows "App not running", "Stopped
  · no GPS signal" and "Offline here · uploaded 14:20" (recorded on time, uploaded later: not a recording gap), and the
  Gaps list. Compare the uploaded time with the recorded time before blaming the upload.
- **Issues** for that driver: "App stopped" (with the phone's make and model) and "Driver's signal".
- **A notification that did not come**: Settings → Notifications → "Browsers with notifications on" ("last delivered
  …" or "nothing delivered yet"). The tray lists everything you were told about even when the push did not arrive.
- In Claude: "Show test.driver's route today with the gaps" (`driver_route`) or "Who is on duty now?"
  (`live_drivers`) gives the same facts in words.
