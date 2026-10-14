# Route quality and offline reliability (14 October 2026)

How the driver app records positions, how they reach the server when mobile data comes
and goes, and how the office sees the route. Built on the branch `route-quality`; the
decisions behind it are Sahan's of 14 October (store raw, filter on the server; never
drop a batch; heartbeat history; full-resolution line for the web, thinned for Claude;
Realtime on location points; keep the reboot restore).

## 1. Recording (driver app, `apps/driver/src/lib/recording.ts`)

The phone asks Android for a fix every 5 s (High accuracy, delivered in batches of up to
15 s) and stores every fix unless:

| Rule | Dropped when | Counter |
|---|---|---|
| Accuracy | worse than 150 m (a cell-tower guess; a 20–40 m Wi-Fi fix stays) | `dropped_accuracy` |
| Jump | it would need over 150 km/h from the last stored fix. Three fixes in a row that agree with each other but not with the stored one mean the stored one was wrong: recording goes on from the third | `dropped_jump` |
| Duplicate | the same exact coordinates as the fix before, no speed, under a minute after the last stored point (a cached fix delivered again) | `dropped_duplicate` |
| Jitter | within max(10 m, its accuracy) of the anchor with a speed under 1 m/s. The anchor is where the vehicle stands: the last fix with a speed, then the running mean of the still fixes around it (so GPS scatter stays inside the radius). One such fix a minute is stored (the most accurate of the delivery) | `dropped_jitter` |

So a moving vehicle gives a point every 5 s, a walking driver too (1.1 m/s is a speed),
a parked one a point a minute. Nothing waits for a confirming fix. The drift filter
(`track.ts`, shared with the server) still runs on the phone, but only for the km counters
the screens show. The real 46-minute indoor recording from 8 October stores 46 points.

## 2. Uploads and the queue (`apps/driver/src/sync`)

- SQLite (`fame-driver-queue.db`, WAL): `ops`, `points` (with a rejected mark), `heartbeats`
  (the history, kept 30 days on the phone). Survives an app kill and a reboot.
- Triggers: every 60 s or 10+ points from the location task; every heartbeat; app open,
  foreground, pull to refresh, a connection returning (forced); the 15-minute WorkManager job.
- Batches of up to 500 points, oldest first, consecutive until empty, 45 s per request. The
  server keeps `on conflict (employee_id, recorded_at) do nothing`, so a lost answer is resent
  harmlessly; `driver_latest` keeps "only newer wins", so the live marker never jumps back.
- Backoff after a failed connection: 5 s, 30 s, 2 min, 5 min, then every 5 min (`BACKOFF_MS`),
  persisted in the phone's small store so every JS context honours it. A forced flush ignores it.
- Never dropped: a batch the server refuses for good (4xx twice, after registering the sharing
  period) is marked `rejected` with the HTTP status and message and stays. It is put back in
  line once a day, after every app update (new update id) and on pull to refresh
  (`maybeRetryRejected`). The heartbeat reports `rejected_points`; the office status line says
  "N points refused".
- Heartbeats: the newest one feeds `driver_latest` through `send_heartbeat()` (as before, one
  waiting at a time); every one is also appended to the history and uploaded in batches of 500
  into `driver_heartbeats`, so after an outage the server knows the app was alive.
- Today shows "Offline · N points waiting" while points wait and Android reports no data
  (or the last upload failed); it disappears when the queue drains.

## 3. Heartbeat (`apps/driver/src/lib/heartbeat.ts`)

Every 60 s on duty, at once on a Location/permission change, once at the end, and from the
background job: sharing, Location on/off, permission, battery, app version, queued and
rejected points, data available (expo-network), app state (foreground/background), seconds
since the last GPS fix, and the counters of section 1 since the last heartbeat.

## 4. Server (`supabase/migrations/20261014170000_route_quality.sql`, `_shared/fleet`)

- `driver_heartbeats` (drivers insert their own, office roles read, pruned after 30 days);
  `driver_latest` + `hb_rejected_points`, `hb_data_available`, `hb_app_state`, `hb_fix_age_s`,
  `heading`; `send_heartbeat()` replaced with four more optional arguments (an older app still
  matches); `location_points` readable by office roles through RLS and in the Realtime
  publication; `route_matched` (snapped legs, service role only); one nightly prune job
  `prune_location_data()` (points 90 days, heartbeats 30, matches 90).
- `route.ts` (shared by driver_route, the web app and the artifact):
  - `dropOutliers`: a fix over 150 km/h from the previous kept fix (three agreeing fixes in a
    row win against a wrong kept one) and an out-and-back spike (over 3 × its accuracy, at
    least 30 m, from both neighbours while they are within half of that of each other and under
    2 minutes apart). Used for the km and for the line alike.
  - km: the drift filter over the fixes under 50 m, raw positions, never smoothed. Confirmed by
    test: smoothing and the thinning tolerance change the line, never the km.
  - line: the filter's accepted positions with their accuracy; fixes of 50–150 m fill only the
    stretches with no precise fix within 2 minutes; display smoothing (3 points weighted by
    accuracy, each point moved at most its own accuracy, waits untouched); then Douglas–Peucker
    (`line_tolerance_m`, default 12; the web passes 3) to at most `max_line_points` (3000).
  - timeline kinds: driving, stopped, `no_gps` ("Stopped · no GPS signal": over 10 minutes
    without a precise fix while heartbeats kept coming, under 5 minutes apart) and `no_data`
    ("App not running": no heartbeats; a gap of 3 minutes or more with none at all). A driving
    leg whose points reached the server over 5 minutes after they were recorded is cut out as
    its own piece: "Offline here · uploaded HH:MM"; a stop only gets the mark.
  - holes: over 2 minutes between two line points at different places, with their kind: the
    map draws them dashed and labelled. The thinning keeps both ends of a hole.
- `driver_route` adds the inputs `line_tolerance_m`, `max_line_points`, `snap` and the
  results `points_stored`, `points_shown`, `outlier_points`, `heartbeats`, `holes`,
  `uploaded_later`, `gaps[].kind`, `timeline[].uploaded`, `route.columns` + `acc`,
  `route_snapped`, `snapped`. Everything is additive (the contract in
  `scripts/tool-shapes.json` is rewritten with `SHAPES=write`).
- Status: `statusText` appends "· N points refused" from the last heartbeat.

## 5. Snap to roads (`_shared/fleet/matching.ts`)

Setting `map_matching` = `{ provider: none | google_roads | osrm }` (`update_settings`).
Secrets: `GOOGLE_ROADS_KEY` (Roads API snapToRoads, 100 points a call, interpolate=true) or
`OSRM_URL` (self-hosted `/match`, timestamps and radiuses from the accuracy, per-leg distance
annotations time the road vertices). A driving leg is cut at gaps of 2 minutes or more (never
bridged), thinned to 5 m, sent in chunks of 100 sharing a point; the answer is stored per leg
in `route_matched`; a leg that is still growing today is matched again at most every 2 minutes;
a failed leg is drawn raw and the legend says so. Calls are counted in `routing_calls` under
the provider's name (`routing_usage` shows them). Claude never triggers a call (`snap` is off
by default); the web passes `snap: true` behind the "Snap to roads" toggle (shown only when a
provider is set) with the legend "Snapped to roads · km from odometer".

## 6. Office web (`apps/office`)

- Driver page: full-resolution line (3 m), every new point through Realtime on
  `location_points` for that driver, inserted by `recorded_at` (a backlog fills its gap; a
  point older than the line is placed, not dropped), outliers checked against the neighbours;
  the 60-second refetch stays as the fallback and brings the numbers. Poor fixes (over 30 m)
  thin and lighter; holes dashed with "No GPS signal · N min" / "App not running · N min";
  timeline rows with the new words and "Offline here · uploaded HH:MM"; the snap toggle.
- Live map and driver page markers glide over the real time between two positions (0.3–10 s)
  and turn to the heading (`driver_latest.heading`, `live_drivers.heading`).
- The artifact (drawn map) shows the same data, polled.

## 7. Storage estimate

Measured on the local database (100,000 synthetic rows, rolled back): a stored point costs
196 bytes with its three indexes (126 heap + 70 index), a heartbeat row 233 bytes.

| What | Rows | Size |
|---|---|---|
| 10 drivers × 4 h driving × 720 points/h × 90 days | 2.6 M | 508 MB |
| Parked time, 10 drivers × 10 h × 60 points/h × 90 days | 0.5 M | 106 MB |
| Heartbeats, 10 drivers × 14 h × 60/h × 30 days | 0.25 M | 59 MB |
| Total | | about 0.7 GB |

## 8. Checks run (14 October 2026)

- Deno: 94 tests (`_shared/fleet`), incl. the new `route_rules_test.ts` and `matching_test.ts`;
  `deno check` of office-api and fleet-jobs.
- Driver: `npm run typecheck`, `test:track` (the new recording rules, the real indoor
  fixture), `test:sync` (batch order and size, backoff ladder, rejected points, heartbeat
  batches, ops first), `test:data` (the local stack).
- Office: typecheck, Vitest 87, both builds, the local e2e.
- Connector: `scripts/test-mcp-local.sh` with `SHAPES=write`.

## 9. Test steps on the phone (after the eas update, with Sahan's go)

1. Walk 5 minutes at a normal pace: the driver page draws a point about every 5 s (every fix;
   the line follows your path at walking pace).
2. A bus or three-wheeler ride at 10–30 km/h: the line follows the road and keeps the corners;
   the timeline shows one Driving row with km.
3. 10 minutes indoors with no GPS: the timeline shows "Stopped · no GPS signal", not "App not
   running"; the office status goes to "No signal since HH:MM" after 3 minutes without a point.
4. Mobile data and Wi-Fi off (not flight mode) for 15 minutes while moving: Today shows
   "Offline · N points waiting" (N grows); the office shows "No signal since HH:MM". Data back
   on: within 2 minutes the whole 15 minutes appears on the live map in the right place (point
   by point as the backlog lands), and the timeline has a Driving row with "Offline here ·
   uploaded HH:MM".
5. Force-stop the app during a walk, then reopen it: the queued points upload (the count on
   Today drains); nothing is missing on the driver page.
6. Reboot the phone while on duty: either sharing resumes by itself (expo-task-manager restarts
   the service on boot) or "Location sharing stopped. Tap to turn it back on" appears within
   15 minutes; the points recorded before the reboot are all there.
7. Watch the live map while someone walks: the line grows point by point and the marker glides
   and turns, it does not jump.
8. Me tab / the office: with `map_matching` set to a provider and its secret, the driver page
   shows the "Snap to roads" toggle and the legend; without, neither appears.

## 10. Strings added for the Sinhala check

| Key | English | Sinhala |
|---|---|---|
| `today.offlineWaiting` | Offline · {n} points waiting | සම්බන්ධතාවක් නැත · ස්ථාන {n}ක් යැවීමට ඇත |
