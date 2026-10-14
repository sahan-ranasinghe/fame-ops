# Phase 5 test plan: what to try, as whom, on which phone

14 October 2026, after deploy round 4. Everything below is on the real project
(https://fame-fleet.pages.dev, the "Fame Fleet" connector in Claude Teams, the OPPO test
phone). Write down what you saw next to each item; "as expected" is enough when it matched.

## Before you start

- Accounts on the web app: Sahan (admin), one account made from the **Fleet admin** preset
  (approve + assign tasks, no users), one from the **Requester** preset (request only). Make
  the last two in Settings → Users; the set-password links go by WhatsApp.
- The driver: `test.driver` on the OPPO CPH2119 with the 1.1.0 development build and the
  latest update (open the app once on Wi-Fi; Me shows the version `1.1.0+…`).
- Notifications: Windows Chrome on the laptop, and Android Chrome on Palitha's phone with
  Fame Fleet installed from Chrome's menu (Add to Home screen) before the test.
- The OPPO's battery and autostart settings stay as they were set in September; do not
  change them for these tests.

## A. The web app as Sahan (admin)

1. Settings → Users: the presets make a dispatcher; "Approve" ticked afterwards shows in the
   row; the locks in the menu follow the permissions when that person signs in.
2. Settings → Fleet: pick the real head office as the base place (a saved place with a map
   pin), set the dwell minutes and the buffer, and look at the rush-hour bands. Untick
   **Self-drive bookings allowed**, open New request: the "A driver is needed" box is gone;
   tick it again.
3. Settings → Notifications: Turn on in this browser → allow → "Notifications are on in this
   browser" and a row "Chrome on Windows"; untick one event and reload: it stays unticked.

## B. The web app as the fleet admin (approve + assign, no users)

1. Tasks → Assign a task with three stops and an arrive-by time on the last one; no leave
   time typed. The plan panel shows the legs, the leave-by time before the deadline minus the
   buffer, and "via expressway" where the road goes that way. Save: the card says "Leave by".
2. Open the task, edit the stops (one removed, one added), save: the leave-by moves, the
   removed stop is gone from the driver's phone, the history keeps it.
3. Requests: a request from the requester account appears with the bell count unchanged (it
   is not an issue yet); Review shows the four groups; approve with a vehicle and driver; the
   requester's timeline shows seen and approved by you.
4. New request → fill the day and time → **Assign now** lists Free, Assigned (ask first, with
   Call / WhatsApp), Busy, In the garage; pick a Free vehicle and a free driver → Book now:
   the booking card with the warnings and Open task. Tasks that day: the card with "Leave by".
5. Open that request from the Approved filter → Cancel booking with a reason: the request is
   Cancelled, the task is cancelled with "Request cancelled: …", the driver's phone shows the
   task as cancelled.
6. Vehicles: give one pooled vehicle a custodian (an office person's name or e-mail) and a
   note; the board's "Assigned to" column shows them with Call / WhatsApp; the availability
   line reads Free / Booked later today / On a task / In garage as the day goes on.
7. A booking for a custodian's vehicle with "A driver is needed" unticked: the custodian
   drives, no driver is asked for, the board says "Driven by … (custodian · no app)", and no
   accept reminder ever goes out for it.
8. Issues: the bell counts the open issues; the Issues page tabs; a vehicle problem reported
   from the test phone appears within a minute as a critical issue; Take, a note, Resolve:
   the driver's report is closed with the note (Maintenance shows it closed).
9. Live locations and the driver page as before (Phase 3): the test phone's marker moves
   within seconds while it is on duty.

## C. The web app as the requester-only account

1. The menu shows Overview, Live locations, Tasks, Vehicles … greyed with a lock; a direct URL
   to one shows "No access"; Home is My requests.
2. New request: no "Who needs it" field (it is in your own name); "A driver is needed" is
   there (while the self-drive switch is on); Save shows "Sent to the fleet admin · you'll be
   notified".
3. My requests: the row's status line reads "sent …", then "Seen by the office …" once the
   fleet admin opens it, then "Approved by …" or "Declined …" with the reason in the drawer,
   or "Cancelled" if the booking is cancelled later.
4. Settings → Notifications: three events (your request decided, a vehicle you look after
   booked, a booking cancelled). Turn on in this browser; the decision of your request arrives
   as a notification; tapping it opens My requests.

## D. The driver phone (OPPO, test.driver)

1. Today: "On duty" wording everywhere (the toggle, the notification, the cover when Location
   is off). Nothing on the phone says the office watches the driver.
2. A new task from the office: the push arrives with the ring, the Today card shows "Leave by
   HH:MM", the first two stops and "+N more", **Accept** and Start task. Tap Accept: "Accepted
   ✓ HH:MM"; the office's board says "Accepted HH:MM".
3. A task set 35 minutes ahead: "Leave by" reminder at −30 minutes and "Time to leave" at the
   leave-by time (two pushes, different sounds).
4. A task not accepted for 30 minutes after it was sent: "Please accept your task" arrives
   once; the office sees "Not accepted yet" on the board and in the issues.
5. Start the task: each stop in turn: Arrived → Done; Skip one with a reason and a note;
   Navigate opens Google Maps to the current stop. Complete task with a stop still open asks
   "N stops are not done · Finish the task anyway?"; the office's task detail shows the
   skipped stop with its reason and the unfinished one as not visited.
6. "Can't do this task" → Vehicle problem with a note: the task leaves the list; the office's
   board shows it under "Needs a driver" with the reason; Reassign to another driver: the
   first phone does not see it again; if the first driver taps decline again after that, the
   app says "This task was already given to another driver" once.
7. A booking where the custodian drives never reaches any phone.
8. Report a problem (breakdown) from the task screen: the office's bell shows it within a
   minute as a critical issue, and the person with the issues permission gets a notification
   if they turned them on.
9. Offline for ten minutes during a task: the stops, the accept and the points arrive when
   the signal is back, in the right order.

## E. The connector in Claude Teams ("Fame Fleet", the shared key)

1. "Plan a trip tomorrow 9:00 from head office to Kurunegala and back" → `plan_task` shows the
   legs and the leave-by time without creating anything.
2. "Book the van for Dilini on Friday 8:30 to Matara, Kasun drives" → `book_vehicle` makes
   the request and the task in one go and reads the warnings.
3. "What needs attention?" → `list_issues`; "take the breakdown and close it: fuel pump
   replaced" → `update_issue` closes the driver's report.
4. `my_notification_settings` on the shared key is refused with "needs a signed-in person":
   expected (the shared key has no person; the web app or a personal key has).
5. "Switch self-drive bookings off" → `update_settings self_drive_allowed false`; a request
   without a driver is then refused; switch it back on.

## F. Notifications, end to end

1. Windows Chrome (laptop): Settings → Notifications → Turn on. From another account make a
   vehicle request: "Vehicle request · name" arrives within seconds; tapping it opens the
   Requests page in the open window. Close the tab: the next notification still arrives and
   opens a window.
2. Android Chrome, Fame Fleet installed on Palitha's phone: the same, with the phone locked.
3. A critical issue (a breakdown report from the test phone): the people with the issues
   permission and notifications on get "Vehicle problem: breakdown"; tapping it opens the
   issue page.
4. Turn off in this browser: nothing arrives any more; the device row is gone.
5. If a notification does not arrive: in the database, `notifications.status` and `error`
   say why (dead with `no_subscription`, `subscription_gone` or `no_vapid_keys`, or failed
   with the push service's answer). Tell Sahan what it says.

## G. The test artifact in Claude (Sahan's copy)

The same screens on polling, without the live map, playback, Realtime or notifications
(those are the web app's): Overview with the attention items from the issues, Tasks with
the stops editor and the plan panel, Requests with the groups and Book now, Issues, Vehicles
with "Assigned to", Settings → Users and Fleet. Settings → Notifications points to the web
app. Every tool call shows the connector's permission prompt once.

## What to send back

Per section, the item numbers that did not match, with a sentence each and a screenshot
where it helps; and the OPPO's answer to D.3 and D.4 (the reminder times as the phone showed
them).
