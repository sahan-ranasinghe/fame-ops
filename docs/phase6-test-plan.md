# Phase 6 test plan: what to try, as whom, on a phone and on a desktop

15 October 2026, for after deploy round 3 (Parts 1 to 5b on the real project:
https://fame-fleet.pages.dev, the "Fame Fleet" connector and artifact in Claude Teams, the OPPO
test phone). Write down what you saw next to each item; "as expected" is enough when it matched.
The Sinhala of the new driver strings is in `docs/phase6-sinhala-strings.md`; the Google set-up,
caps and terms in `docs/google-maps-setup.md`.

## Before you start

- Web accounts: Sahan (admin), a **Fleet admin** (approve + assign tasks), a **Dispatcher**
  (view + assign tasks), a **Requester** (request only) and a **Viewer** (view only). Make the
  missing ones in Settings → Users; the set-password links go by WhatsApp.
- Two screens for the web: the laptop (Chrome, a wide window) and a phone (Chrome, or Fame Fleet
  installed from Chrome's menu). Phone items below say "phone".
- The driver: `test.driver` on the OPPO CPH2119. First the **1.1.0** build with the round's 1.1.0
  update (open the app twice on Wi-Fi; Me shows `1.1.0+…`), then the **1.2.0** build from the
  round's link (Me shows `1.2.0`), installed over it (the session stays).
- Settings → Fleet → Map package: **Google**, keys "map yes, server yes". Note the Map package
  card's counts before you start, and again at the end.

## A. Admin on the desktop (Sahan)

1. Settings → Fleet → Map package: the package Google; five rows (Google map, place search,
   place details, road times, snap to roads) with today / this month / the caps; snap to roads
   "off: its cap is 0". Change Google road times' day cap to 150, Save caps: it stays after a
   reload; set it back to 200.
2. Live: Google's map (Google's logo bottom left), the drivers as plate chips; open another page
   and come back: the map is there at once (the same map, no second load: the card's "Google
   map" today count went up by 1 only for the first page in this tab).
3. Settings → Import sites: drop the Dialog file right after the page opens: "Dialog site list"
   is picked by itself; a custom sheet maps by hand; Undo this import on a test import.
4. Settings → Fleet: change "Estimated lines over GPS gaps" to 250 and back to 300.
5. Choose Open in Map package: Live shows OpenFreeMap; a task's stop search has no Google rows
   (Map results credit openrouteservice). Choose Google again.

## B. Fleet admin on the desktop

1. Tasks → New task: in a stop type "Kandy City"; the list shows our places first, then rows
   badged **Google** and the line "Google Maps" at the bottom. Pick a Google row: the stop says
   "Google place: its pin is Google's, kept 30 days". Add a pickup at the head office and an
   arrive-by on the Google stop: the plan line says "road time · Google traffic" and gives a
   leave-by. Save. The card shows Leave by; the task detail's stop has the **Google Maps** tag.
2. Paste a Google Maps link into another stop: the pin confirm map is Google's; drag the pin;
   save the place (it becomes one of ours).
3. Requests → New request: From and To show our places and openrouteservice results, never
   Google rows. Assign now books a vehicle; the task's plan is Google's.
4. A task with stops, started by the driver (section E): the task detail shows "the driver
   arrived HH:MM near <town> · phone ±N m · map" under each reached stop. On the reached Google
   stop press **Save as our place**, type "Kandy City Centre" (Google's name): refused; type an
   own name: "Saved as our place: <name>"; Places shows it at the driver's arrival point.
5. The task's Route card: if the phone had a gap (no fix for over a minute while moving), a slate
   dashed line follows the road with "estimated · N km road", and the line under the map says
   the gaps are estimated, not counted in km. The km figure does not change.

## C. Dispatcher (view + assign tasks), on a phone

1. The tab bar: Home, Map, Tasks and More (no Settings → Fleet). Home's big button is New task.
2. New task on the phone: the stop's search box offers Google rows the same way; the form keeps
   a draft when you leave and come back ("Resume draft from HH:MM").
3. A task's detail is a full screen with a back arrow; the route map is Google's.
4. A driver page from Live: the map with the speed colours, a timeline row zooms the map; any
   estimated line is dashed slate and named in the legend.

## D. Requester and viewer

1. Requester on a phone: New request is the big button; From and To never show Google rows; a
   pasted pin shows the Google pin map to confirm (one map load); the request's timeline.
2. Viewer on the desktop: Live and the driver pages show Google's map; no New task, no
   Settings → Fleet; the Map package card is not reachable (a direct /settings/fleet says No access).

## E. The driver on the OPPO

With the **1.1.0** build and the round's 1.1.0 update:

1. Accept and start the task of B.1. On the task screen the OpenFreeMap map shows the phone,
   **not** the Google stop, and the line "A Google place: Navigate shows it in Google Maps" (in
   Sinhala too: switch the language on Me). Navigate opens Google Maps turn by turn to it.
2. Drive towards the stop: within about 150 m the notification "Arrived at <stop>? Tap to mark
   Arrived" comes once; tap Arrived on the stop, then Done.
3. Our own stop (the head office): its marker and the straight line are drawn as before.

With the **1.2.0** build:

4. Me shows 1.2.0. The task map is Google's: the phone, the stop (a Google stop too) and the
   straight line; no "A Google place" line. Under a Google stop's name (Today, the task, the
   stops list) a small "Google Maps".
5. Background location, the Phone setup card, the Fuel tab and its video, the odometer photo all
   work as before (the build changed only the map).

## F. Claude Teams (the Fame Fleet artifact and the connector)

1. The artifact after Sahan's update: Overview, Tasks, the driver page with the drawn map; a
   Google stop of a task is listed in the task, never drawn; the drawn route may show a slate
   dashed estimated line.
2. In chat: "Which stops of today's tasks are Google places?" (task_detail `google`), "How many
   Google calls today?" (get_settings google usage), "Show test.driver's route today with the
   estimated gaps" (driver_route estimate_gaps).

## G. The caps (Sahan, any time)

1. Settings → Fleet → Map package → set Google place details' day cap to the count already used
   today (e.g. 3), Save caps; in a new task pick a Google row: "Google place details limit
   reached for today… Pick one of our places, paste a pin or type the address instead."; the
   card shows the refused call. Set the cap back to 400.
2. Set Google map's day cap to today's count, open the web app in a **new tab**: the pages show
   "No map: Google map limit reached for today: back tomorrow. The lists show everything."; the
   first tab keeps its map. Set it back to 400.
3. At the end compare the card's counts with Google Cloud console → APIs & Services → each API's
   requests today (ours count every call before it is made, so ours are equal or a little higher).
