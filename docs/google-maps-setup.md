# Google Maps Platform for Fame Fleet (Phase 6, Part 5)

How the Google package is set up, what it costs, and the Google rules the code follows.
Checked against Google's pages on 15 October 2026 (links below; most show "Last updated
2026-10-13" or later).

## 1. What the package does, and the open package behind it

| Feature | Google (map package `google`) | Open package (the fallback, and the default with no keys) |
|---|---|---|
| Office map (web) | Maps JavaScript API, one map per browser tab | OpenFreeMap (MapLibre): with the setting open, and (Part 6) at the map-load cap or when Google's map fails (`gm_authFailure`, or not ready within 15 s) |
| Place search for stops and the start | Places Autocomplete (New) + Place Details (New), Essentials fields | openrouteservice (Pelias) autocomplete |
| Road times (plans, live ETA) | Routes API `computeRoutes`, TRAFFIC_AWARE | openrouteservice directions, else the estimate |
| Snap to roads (the driver page, Live, a task's route; Office mode and /m/ since Round 48) | Roads API `snapToRoads` (display only: never stored since Round 48) | OSRM if `OSRM_URL` is set, else the raw GPS line |
| Driver app task map | Maps SDK for Android (`react-native-maps`, a build with the key; free, uncounted) | OpenFreeMap (MapLibre), in the same build: the map package setting switches the phones, and a phone whose Google map fails switches by itself (section 8) |

Never mixed on one map: Google's content goes on Google's map only. Since Part 6 (Sahan, 19 October) the website works like
the phones: Google's map by default; refused (the map-load cap, the counter) or failed (Google refuses the key:
`gm_authFailure`; the script not ready within 15 s) the page shows the free map (MapLibre with OpenFreeMap) with one line
saying why, the lists as they were; the setting `open` always the free map. On any map that is not Google's (the free
map, the Teams artifact's drawn map, the driver app's free map) a stop that is a Google place is listed, not drawn, and
neither Google's road line nor snapped roads are drawn: openrouteservice's road line where the plan has one (ours), else
dashed straight lines between the stops, and for a recorded route the raw GPS line.

**Google place search is asked for, never the default.** `search_places` answers Google's places
only when the call passes `google: true` (with an optional `session` token); without it the map layer
is openrouteservice's, as before Part 5. Who passes it:

- The web app: only a task's stops and its start (the stops editor, New task, a booking's stops). A
  request's From and To never do: they are kept as text for good, and Google's names may not be kept.
- Claude through the connector: it can, the same tool and the same rules, nothing is web-only. It
  passes `google: true` when asked for Google places ("find Kandy City on Google", "use Google's
  place for the drop"); an ordinary "find Kandy City" searches our places, the places used before
  and openrouteservice, which costs no Google call. A Google result has `layer: "google"`, a
  `google_place_id`, no pin and the credit "Google Maps" (Claude must show it with the names);
  `google_place` gives its pin (kept 30 days), and `create_task`, `plan_task`, `update_task_stops`
  and `book_vehicle` take the stop as `google_place_id` with the name as `place`. The connector's
  instructions say so. A Claude chat started before a deploy keeps the tool list it had (the new
  parameters appear in a new chat).
- The Teams artifact: never (its person has no Google package; its maps are the drawn one).

Switch it off: Settings → Fleet → Map package → Open (or `update_settings map_package open`).
Everything works with no Google key set; the package in use is shown in Settings → Fleet.

## 2. The Cloud console, step by step

1. A Google Cloud project for Fame Fleet, linked to the billing account.
2. **Upgrade the free trial to a paid account before day 90 (about mid-January 2027).**
   "If you don't upgrade to a Paid billing account before 90 days pass or if you spend the
   $300 in free credit, then your Free Trial billing account will be closed and all of its
   associated projects and resources will be stopped" (https://cloud.google.com/free/docs/free-cloud-features).
   The Maps FAQ calls it "a 91-day program"; take the earlier date. The monthly free usage per
   SKU is not tied to the trial: "each SKU provides free billable events every month… resets on
   the first day of each month, at midnight Pacific US time"
   (https://developers.google.com/maps/billing-and-pricing/overview).
3. Enable: Maps JavaScript API, Places API (New), Routes API, Roads API, Maps SDK for Android.
4. Three keys (Credentials → Create credentials → API key), each restricted:

| Key | Where it is set | Application restriction | API restriction |
|---|---|---|---|
| `GOOGLE_MAPS_JS_KEY` (browser) | Supabase Edge Function secret | Websites: `https://fame-fleet.pages.dev/*`, `https://fleet.famegroup.lk/*`, `http://localhost:5173/*` | Maps JavaScript API |
| `GOOGLE_SERVER_KEY` | Supabase Edge Function secret | none (Edge Functions have no fixed address) | Places API (New), Routes API, Roads API |
| `GOOGLE_ANDROID_MAPS_KEY` | EAS environment variable (secret), preview environment | Android apps: package `com.fameglobal.driver` + the signing key's SHA-1 | Maps SDK for Android |

   The browser key is handed to the web app by `register_map_load` only after the map load is
   counted; it is never in the web build. The Android key is written into the APK at build time
   (that is how Android map keys work: the package + SHA-1 restriction protects it); it is kept
   out of the update manifests. The server key never leaves the Edge Functions.

5. Quotas: Google does not let us lower the per-day quotas of Places API (New) (Edit quota is
   greyed out), so **our own caps are the only hard stop** (section 3).
6. Budget alert: $1 on the billing account, at 50 %, 90 % and 100 %, counting usage before
   credits. It only e-mails; it stops nothing.

## 3. The caps: counted before every call, fail closed

Every Google call is recorded in the database **before** it is made (`google_take(feature,
day_cap, month_cap)`: one row per feature and Colombo day in `google_calls`, under a lock per
feature). The call is made only when that answer says allowed. At the daily cap, at the monthly
ceiling, or when the counter cannot be read or answers anything unexpected, the call is refused
and the open package answers (for the map: no map), with a note saying why. A call that then
fails at Google stays counted (Google may bill it). Settings → Fleet shows each feature's count
today and this month against its caps, and the calls refused today.

| Feature (`google_caps`) | Google SKU | Free a month | Our day cap | Our month cap (95 %) |
|---|---|---|---|---|
| `map_loads` | Dynamic Maps | 10,000 | 430 | 9,500 |
| `places_autocomplete` | Autocomplete Requests | 10,000 | 430 | 9,500 |
| `places_details` | Place Details Essentials | 10,000 | 430 | 9,500 |
| `routes` | Compute Routes Pro (TRAFFIC_AWARE) | 5,000 | 215 | 4,750 |
| `roads` | Roads – Route Traveled (Snap to Roads) | 5,000 | 215 | 4,750 |

**The daily caps (Sahan, 17 October 2026):** each day's cap is the month's cap spread over 22
working days (9,500 ÷ 22 and 4,750 ÷ 22, rounded down to 430 and 215). Weekends get the same daily
cap. The month's cap stays the hard stop: a month with more than 22 busy days stops at the month's
cap, never above it.

Prices after the free usage (https://developers.google.com/maps/billing-and-pricing/pricing):
Dynamic Maps $7.00, Autocomplete Requests $2.83, Place Details Essentials $5.00, Compute Routes
Pro $10.00, Roads $10.00 per 1,000. Maps SDK for Android: unlimited and free (without a map id).

- No setting goes above the 95 % ceilings (`update_settings` refuses it and the counter clamps it).
- Our month runs on Colombo time; Google's resets at midnight Pacific time on the 1st (about
  13:30 Colombo). The half day in between is covered by the 5 % margin: at most one day's cap
  (430 or 215) on top of 9,500 or 4,750 (9,930 or 4,965) is still under the free 10,000 or 5,000.
- Round 48 snap hotfix (28 October 2026): a growing leg is snapped incrementally, at most every 3 minutes and once 30
  thinned points are waiting (about 14 calls for a two-hour drive, whoever watches); a per-driver-day budget
  (`roads_trip_daily_cap`, 20) is taken before the fleet counter, past it the driver's route shows the GPS line and one
  info issue opens; every Roads call is counted by source (`routing_usage` `sources_today`: site_route, site_live,
  site_task, app_route, app_live, app_task, claude, web, "_playback" for a past day). Google's lines are never stored.
- The snap cost fix (2 November 2026, branch `phase9-snap-cost`): Google's sparse method. Points up to 300 m apart with the
  turns kept and `interpolate=true` (`thinForRoads`; Google's guidance is consecutive points within 300 m), up to 100 points a
  request, and one request carries as many pieces as fit (`packForRoads`: legs and pauses that start within 300 m of the last
  point). A 100 km day is about 5 calls to open. The page keeps the line it was answered (`transport/snapHold.ts`, memory only)
  and a refresh says so (`snap_held`): the server sends only what came after it, once 50 sparse points wait (about 12 km) or 30
  minutes after its last call (Google only; never another provider's map). After a refused or failed call its next tries wait 10
  minutes. A point recorded inside the held line that arrives later asks for the whole line again. Also fixed:
  a finished leg whose end lay past its last line point was paid for again on every refresh, on any isolate.
- `roads` (snap to roads) is on within the free usage since Round A of Phase 7: 215 a day and 4,750 a
  month (95 % of the 5,000 free), counted before each call and refused at either cap or on a counter
  error (fail closed).
  - The Roads API overview (https://developers.google.com/maps/documentation/roads/overview) says
    "The Speed Limit service is available to all customers with an Asset Tracking license". We
    call only `snapToRoads`, never Speed Limits.
  - The Roads API policies (https://developers.google.com/maps/documentation/roads/policies) say,
    for the whole Roads API: "If you intend to use the Roads API as part of an asset tracking
    application, you may be required to purchase an asset tracking license." Drawing a fleet's
    driver routes is asset tracking.
  - **Fame's decision (Sahan, 16 October 2026):** use snap to roads within the free usage, at the
    caps above. If Google asks, set `google_caps.roads` to 0 (day and month) in Settings → Fleet,
    or with `update_settings`: that turns snap to roads off at once (no call is made, routes show
    the recorded points), with nothing else to change.
- What one action costs: a plan (Plan now, saving a task, changing its stops) = 1 Routes call
  for all its legs; a running task's ETA = 1 Routes call at most every 15 minutes while someone
  looks at it (the ETA stands 15 minutes so the Live page's 30-second refresh does not use the
  cap); picking a Google place = the session's autocomplete requests (each counted) + 1 Place
  Details call; opening the web app = 1 map load per browser tab, whatever pages are visited.

## 4. The SKUs we keep to

- **Place Details: Essentials fields only.** The field mask is exactly
  `location,formattedAddress,shortFormattedAddress,addressComponents`. Google's data-fields
  page lists "Address components", "Formatted address", "Location" and "Short formatted
  address" under Essentials and "Display name" under Pro
  (https://developers.google.com/maps/documentation/places/web-service/data-fields). The
  place's name is the autocomplete suggestion's main text, so `displayName` is never asked:
  with it every call would be Place Details Pro (5,000 free a month instead of 10,000), and a
  session ending in Pro fields "billed at SKU: Place Details Enterprise + Atmosphere,
  regardless of the fields requested" (1,000 free)
  (https://developers.google.com/maps/documentation/places/web-service/session-pricing).
- **Autocomplete sessions.** The box sends one session token per typing session and the pick's
  Details call carries it. With an Essentials pick, "First 12 Autocomplete (New) requests: You
  are billed for each Autocomplete (New) request… For Autocomplete (New) requests 13 and higher
  in the same session… there is no charge" (session-pricing page). So every autocomplete request
  is counted against `places_autocomplete`; an abandoned session is billed per request too.
  The box asks from 3 characters, 300 ms after the last key.
- **Routes:** TRAFFIC_AWARE makes every request Compute Routes Pro ("Set routingPreference to
  TRAFFIC_AWARE or TRAFFIC_AWARE_OPTIMAL", https://developers.google.com/maps/billing-and-pricing/sku-details);
  one request carries all of a plan's legs (the stops as intermediates, at most 25), with the
  field mask `routes.legs.duration,routes.legs.distanceMeters,routes.legs.polyline.encodedPolyline`.
  Phase 7 (§20, checked 16 October 2026): the leg lines come from the same request. A plain encoded
  polyline is not a trigger for any SKU on the SKU page; its Enterprise triggers are "Two-wheeled
  vehicle routing", "Toll calculation", "Traffic information on polylines" and "Large vehicle
  routing", and we never ask for traffic on polylines (`extraComputations` stays unset). So the
  request stays Compute Routes Pro. The line is kept with the plan for 30 days, then removed by the
  nightly `google_content` job, and drawn on Google's map only.
- **Map loads:** "A single map load is charged when… A web page or application displays a map
  using the Maps JavaScript API"; interactions "don't generate additional map loads"
  (https://developers.google.com/maps/faq). The web app makes one map per tab and moves it
  between pages ("Reuse a single map by updating its viewport, zoom, and markers as needed",
  https://developers.google.com/maps/billing-and-pricing/manage-costs). Markers are our own
  HTML overlays, so no map id is needed.
- **Android:** "Maps SDK | Unlimited", triggered by a map "not loaded with a map ID". With a
  map id Android loads are billed as Dynamic Maps, so the app never sets one.

## 5. The terms we follow

Google Maps Platform Terms of Service (https://cloud.google.com/maps-platform/terms, last
modified 26 August 2026) and Service Specific Terms
(https://cloud.google.com/maps-platform/terms/maps-service-terms, last modified 15 October 2026):

- **No Google content on a non-Google map.** ToS 3.2.3(e): "Customer will not use the Google
  Maps Core Services with or near a non-Google Map in a Customer Application. For example,
  Customer will not (i) display or use Places content on a non-Google Map". Places 14.2, Routes
  19.2 and Roads 17.2: "Customer must not use Google Maps Content from the [API] in conjunction
  with a non-Google map." Hence: Google's map only under `google`; no map at a cap; a Google
  stop listed, not drawn, on the artifact's and the old driver app's maps; snap to roads only
  for the web's Google map (never for Claude or the artifact).
- **Places caching.** Place ids "are exempt from the caching restrictions. You can therefore
  store place ID values indefinitely" (https://developers.google.com/maps/documentation/places/web-service/policies).
  Places 14.3: "Customer may temporarily cache latitude and longitude values from the Places
  API for up to 30 consecutive calendar days, after which Customer must delete the cached
  latitude and longitude values." Everything else is not cached (ToS 3.2.3(b); its examples
  include "copy and save business names, addresses"). So a Google pick is **never one of our
  places**: its pin and address wait in `google_pins` by place id for 30 days; a stop (or a
  task's start) on it is marked (`google_place_id`, `google_fetched_at`) and, 30 days after the
  fetch, loses its coordinates, address and name ("Google place (details removed after 30
  days)"), keeping the place id, its type, times and what the office wrote. The nightly job
  (`fleet-jobs google_content`, 03:30 Colombo) first fetches again the pins of stops still to
  be driven (from 23 days old; counted Details calls), then removes everything over 30 days old.
  "Used before" in the search never offers a Google stop. Where the driver actually arrived is
  ours: the stop keeps the phone's own position from the moment it was reached (`arrival_*`,
  from our location points), so after 30 days it reads "Google place · arrived near <town>
  HH:MM", and the office can save it as one of our places at that point under its own name
  ("Save as our place"; Google's name and address are refused).
- **Routes caching.** Routes 19.3: "Customer may temporarily cache latitude (lat) and longitude
  (lng) values from the Routes API for up to 30 consecutive calendar days". Durations and
  distances are not named, so Google road times are never put in the route cache
  (`route_legs`): each plan asks again. A task keeps its own plan (the leave-by time and the
  planned arrivals it was given, with each leg's minutes and km) as the record of what the
  driver was told; the live ETA stands 15 minutes (`task_eta`).
- **Instead of snap to roads** (off): a gap of over 300 m and 60 s between two GPS points is drawn
  along the likely road from openrouteservice (OpenStreetMap data, not Google content), dashed
  and labelled "estimated", never counted in km.
- **Roads caching.** Roads 17.3: latitude/longitude "for up to 30 consecutive calendar days";
  Google-snapped lines (`route_matched`, provider `google_roads`) are removed after 30 days.
- **Attribution.** "Attribution should take the form of the Google Maps logo whenever possible.
  In cases where space is limited, the text Google Maps is acceptable"; nothing more is needed
  "if the Content is shown on a Google Map" (Places policies). The search box's Google results
  end with the line "Google Maps" (not translated), in the same box.

## 6. Where it lives in the code

- Server: `supabase/functions/_shared/fleet/google.ts` (the gate, the requests),
  `googlePlaces.ts` (search, pick, pins, the nightly job), `routing.ts` (`googleLegs`,
  `memoLegFn`), `eta.ts`, `matching.ts`, `tools/google.ts` (`register_map_load`, usage),
  migration `20261015150000_google_package.sql` (`google_calls`, `google_take`, `google_pins`,
  the marks on stops and starts, `prune_google_content`).
- Web: `apps/office/src/map/google/*` (the loader, the one map, the overlays), `MapView`,
  `PinMap`, `NoMap`, `ui/LocationSearch.tsx` (`google`), Settings → Fleet (the Map package card).
- Driver app: `app.config.ts` (`GOOGLE_ANDROID_MAPS_KEY`, runtime `1.3.0-gmaps` with the key),
  `src/components/TaskMap.tsx` (one map, two engines: `GoogleTaskMap.tsx`, `OpenTaskMap.tsx`, the card
  `MapUnavailable.tsx`), `src/lib/mapEngine.ts` (which engine, the failure rule), `src/lib/mapReport.ts`
  (`report_map_state`), `src/lib/mapRule.ts` (a Google stop on the free map: not drawn). Server:
  migration `20261019180000_phase7_6_maps.sql` (`driver_map_state`, `report_map_state`,
  `get_driver_settings` with `map_package` and `phone_map_wait_s`), the issue `map_fallback` in `issues.ts`.
- Tests: Deno `google_test.ts` (call 401 to Place Details refused, a counter error refuses the
  call, the field masks, one Routes call per plan), pgTAP `google_package.test.sql` (the real
  counter, the marks, the 30-day clean-up), the connector suite (no keys: the open package),
  Vitest (the search box's Google results, no map at a refused load), `npm run test:nav`.

## 7. Every Google call, its cap and its fallback (checked 19 October 2026, Part 6)

Every paid Google call is made by our server (Supabase Edge Functions), counted in the database before it is made and
refused at its cap or on a counter error (section 3). **The driver app makes no paid Google web-service call from the
phone:** its place search goes through driver-api `/places/search`, a Google place's pin is fetched by the server
(driver-api `/trips`; `test-trips.ts` checks "Google's pin is never on the phone"), and its road line comes from the stored
plan. The only Google products on the phone are the Maps SDK for Android (free) and the Google Maps app links.

| Google product (SKU) | Called from | Key | Cap a day / a month | At the cap or on a counter error | The test that proves it |
|---|---|---|---|---|---|
| Maps JavaScript API (Dynamic Maps) | the office website (web build only): each map load counted by `register_map_load` before the script loads; one map per tab | `GOOGLE_MAPS_JS_KEY` (browser, websites only) | `map_loads` 430 / 9,500 | the free map (OpenFreeMap), with "The free map: Google map limit reached for today: back tomorrow."; Google's content never on it; the same when Google refuses the key or the script is not ready in 15 s (Part 6) | Vitest `MapView.test.tsx` (the cap, the key refused, the time limit, the setting open); pgTAP `google_package`; connector suite |
| Places API (New) Autocomplete (Autocomplete Requests) | `search_places` with `google: true`: the office's stops and start, Claude, driver-api `/places/search` (Start a trip, Add a stop) | `GOOGLE_SERVER_KEY` | `places_autocomplete` 430 / 9,500 | openrouteservice's search answers instead, with the note | Deno `google_test.ts` "autocomplete at its cap: no call reaches Google, and openrouteservice's search answers instead" |
| Places API (New) Place Details (Place Details Essentials: location, formattedAddress, shortFormattedAddress, addressComponents) | `google_place`; a stop or start with `google_place_id` (create_task, plan_task, update_task_stops, create_request, decide_request, book_vehicle, update_request); driver-api `/trips` and its stops; the nightly `google_content` refresh | `GOOGLE_SERVER_KEY` | `places_details` 430 / 9,500 | refused in words ("Pick one of our places, paste a pin or type the address"; a driver's trip 409); the nightly refresh skips the place | Deno `google_test.ts` "Place Details: 400 calls a day are made; call 401 is refused", "a counter error refuses the call" |
| Places API (New) Text Search, Nearby Search | not used | | | | grep: no `searchText`, `searchNearby` |
| Routes API `computeRoutes`, TRAFFIC_AWARE (Compute Routes Pro) | plans (create_task, plan_task, update_task_stops, update_task and redecide_request when the route changes, create_request with stops, decide_request, book_vehicle, update_request); a running task's ETA, asked only by `task_detail`, at most every 15 min a task. Only for road times: never called for a line (the line comes with the times; a map that may not show it draws openrouteservice's line or dashed straight lines) | `GOOGLE_SERVER_KEY` | `routes` 215 / 4,750 | openrouteservice (when `ROUTING_PROVIDER` is ors), else the estimate; the plan says why (`google_note`) | Deno `google_test.ts` "Routes at its cap: no call reaches Google; the plan's legs come from the open chain"; `eta_test.ts` |
| Roads API `snapToRoads` (Roads) | `driver_route` with snap, from the website (the driver page, Live, task detail) and, since Round 48 item 5, from Office mode and /m/ (a driver's day, a task's route, Live's shown route; `office/snapLogic.ts`), only while Google's map is the one drawn (`snapAllowed`; the open package snaps with OSRM): never for the free map shown instead of Google's. Display only: Google's answers are never stored (Sahan, 28 October 2026); the server keeps them 30 minutes in memory (`matching.ts` `googleRoadsStore`) so a page's refresh costs nothing, and a view after that, or on a new isolate, pays again: about one call per 100 sparse points (about 25 km of road), shared between legs; a page's refresh sends only what is new (`snap_held`) | `GOOGLE_SERVER_KEY` | `roads` 215 / 4,750 (0 = off) | the raw GPS line, tried again after 2 min | Deno `google_test.ts` "a refused Roads call is never sent"; `matching_test.ts` (Round 48: cached in memory, never written); Vitest `DriverPage.test.tsx` "Google's map refused (the cap): every route request is unsnapped"; the app's `npm run test:snap` and `tests/dayRoute.test.tsx` |
| Distance Matrix, Directions API (legacy), Geocoding API, Static Maps, Street View, Navigation SDK | not used | | | | grep: none; pgTAP: `google_take('street_view')` is an unknown feature |
| Maps SDK for Android (Mobile Native Dynamic Maps: no charge, unlimited; no map id) | the driver app's task map, the Google engine | `GOOGLE_ANDROID_MAPS_KEY` (in the APK; Android apps + SHA-1; Maps SDK for Android only) | none: free | the phone shows the free map by itself (section 8) | `npm run test:maps` |
| Google Maps URLs (Navigate, All stops) | the driver app's buttons, the office's links | none | free | | `npm run test:nav` |

Not Maps Platform, listed for completeness: Gemini (`read-odometer`, `GEMINI_API_KEY`: since Round 48 counted BEFORE each
call like the Google calls, `odometer_take` in `odometer_calls`: 60 reads a driver a day, and the server's own checks under
the setting `odometer_server_daily_cap`, 500; a counter that cannot be read refuses the call), Firebase Cloud Messaging
(push, free) and Google Fonts (the website's CSS, no key). Every counter here (Google, openrouteservice, Gemini) opens one
warning issue of kind `usage_cap` at 80 % of its day or month cap, critical at 100 % (`issues.ts` `usageCapIssues`). The
doors themselves are rate-limited (Round 48, `_shared/fleet/rateLimit.ts`): 30 calls a minute per person, driver or
connector key on the tools that can make one of these calls, on top of the general limits, and 20 refusals a minute per
address before Supabase Auth or the key lookup is asked; the site and the app stop a screen that asks one tool over 30
times a minute by themselves (the circuit breaker, `transport/breaker.ts` / `lib/breaker.ts`) and report it once.

Every fallback works on either map, on the phones and the website: the server's fallbacks (openrouteservice, the estimate)
answer the same whatever map shows; a plan leg's line is drawn where that map may show it (Google's on Google's map only,
openrouteservice's on any: since Part 6 a plan keeps openrouteservice's line with its leg, also from the leg cache), and a
leg with no line it may show gets a dashed straight line; a Google place found before the cap stays on Google's map only and
is listed on the free map. No Roads call is made for a line the free map draws or no map draws (Part 6).

## 8. The phones' two maps (Part 6, 1.3.0)

- Every 1.3.0 build carries both maps: Google's (Maps SDK for Android) and the free one (MapLibre with OpenFreeMap's tiles,
  no key). One map component draws the same stops, line, markers, Follow me and labels on both; Google's content (its
  road line, a Google place's pin) stays on Google's map only.
- **Google by default.** Settings → Fleet → Map package (`map_package`) switches the phones too: the open app reads it
  every minute, so a change reaches every phone within a minute, with no new build or update.
- **The automatic switch.** Android's SDK gives no "key refused" signal. A refused key, a billing or authorisation problem,
  Google Play services missing or Google down all leave a grey map that never finishes loading, so the phone waits for
  Google's "map loaded" signal (`onMapLoaded`, every tile drawn): none within `phone_map_wait_s` (30 s) while the phone
  is online and the map on screen, or the map failing to draw, and the phone shows the free map at once and tells the
  server. The phone tries Google again the next time the app opens (started afresh, or brought to the front 30 minutes or
  more later); a good load is reported. Offline, nothing is blamed on Google: the card below shows until the network is back.
- **The office's issue** "Google map failed on <driver>'s phone; using the free map" opens only when it is not one
  weak-signal trip (Sahan, 19 October): the same phone failed again on its next try, or two phones failed within an hour
  (a key or billing problem shows on every phone). It resolves when that phone's Google map loads again.
- **Is 30 s right on slow mobile data?** For 3G and 4G, yes, with room. `onMapLoaded` waits until every tile in view is
  drawn: a task's view is about 10 to 20 vector tiles, a few hundred KB the first time (less from the SDK's cache), plus
  1–3 s for the SDK to start. At 1 Mbit/s (ordinary 3G) that is about 2–5 s; at a weak 4G or a busy 3G cell (about
  250 kbit/s) about 6–20 s. It is not enough on EDGE/2G only (50–100 kbit/s: 25–100 s), which still counts as online:
  there the phone switches to the free map for that trip, whose tiles are no smaller, so the driver may see the card. With
  the two-try rule that no longer reaches the office. These are estimates, not measurements from our phones: P11 notes how
  long Google's map takes on each phone, and `phone_map_wait_s` (1 to 120) can be raised without a build if the free map
  shows too often.
- **Both fail** (OpenFreeMap down, or no network): "Map not available" with the stops and the straight-line distance;
  every button of the task still works, and Navigate opens the Google Maps app.
- To test the switch on a phone: `update_settings phone_map_wait_s 1` (Google cannot finish in 1 s), close the app fully
  (swipe it away), start it and open a task: the free map, and the issue within 5 minutes. Set it back to 30, close the app
  fully again and start it (bringing it back within 30 minutes keeps the free map): Google's map, the issue resolved.

## 9. The Android key and billing: check these

**The Android key's restrictions** (Google Cloud console):
1. https://console.cloud.google.com → the Fame Fleet project → APIs & Services → Credentials.
2. Open the Android key (the one saved in EAS as `GOOGLE_ANDROID_MAPS_KEY`; its name in the console is whatever it was
   given when made).
3. **Application restrictions:** "Android apps", with package `com.fameglobal.driver` and the SHA-1 of the key that signs
   the APK (`npx eas credentials -p android` → the profile → the keystore's SHA-1). Once Play App Signing is on, also the
   app signing key's SHA-1 from Play Console → Test and release → App integrity → App signing.
4. **API restrictions:** "Restrict key", with exactly one API ticked: **Maps SDK for Android**. Nothing else.
5. Save. A change takes up to 5 minutes.

If the signing key's SHA-1 ever changes (a new upload key, Play's app signing key), add the new SHA-1 to this list
**first**: a phone whose app is signed with a SHA-1 that is not listed gets a grey Google map (the phones then switch to the
free map by themselves, and the office sees the issue).

**Billing must stay active, even though the phone map is free.** Google stops every Maps API of a project whose billing
account is closed or suspended. If the card on the billing account expires (or a payment fails, or the free trial ends
without the upgrade in section 2), every Google service stops: the website's Google map, place search, road times and
snap to roads, and the phones' Google map. The server then answers from the open package (refused or failed calls), the website shows its lists without a
map (as at its cap), and the phones move to the free map by themselves, with an issue each. Keep a valid card on the billing
account, and keep the $1 budget alert on (50 %, 90 %, 100 %; it only e-mails).
