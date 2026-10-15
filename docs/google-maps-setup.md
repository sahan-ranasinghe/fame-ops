# Google Maps Platform for Fame Fleet (Phase 6, Part 5)

How the Google package is set up, what it costs, and the Google rules the code follows.
Checked against Google's pages on 15 October 2026 (links below; most show "Last updated
2026-10-13" or later).

## 1. What the package does, and the open package behind it

| Feature | Google (map package `google`) | Open package (the fallback, and the default with no keys) |
|---|---|---|
| Office map (web) | Maps JavaScript API, one map per browser tab | OpenFreeMap (MapLibre) |
| Place search for stops and the start | Places Autocomplete (New) + Place Details (New), Essentials fields | openrouteservice (Pelias) autocomplete |
| Road times (plans, live ETA) | Routes API `computeRoutes`, TRAFFIC_AWARE | openrouteservice directions, else the estimate |
| Snap to roads (driver page) | Roads API `snapToRoads` | OSRM if `OSRM_URL` is set, else the raw GPS line |
| Driver app task map | Maps SDK for Android (`react-native-maps`, a build with the key) | OpenFreeMap (MapLibre) |

Never mixed on one map: under `google` the web shows Google's map only. If a Google map load is
refused (a cap, the counter), the page shows its lists without a map, never OpenFreeMap. On any
map that is not Google's (the Teams artifact's drawn map, the driver app's OpenFreeMap map), a
stop that is a Google place is listed, not drawn.

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
| `map_loads` | Dynamic Maps | 10,000 | 400 | 9,500 |
| `places_autocomplete` | Autocomplete Requests | 10,000 | 400 | 9,500 |
| `places_details` | Place Details Essentials | 10,000 | 400 | 9,500 |
| `routes` | Compute Routes Pro (TRAFFIC_AWARE) | 5,000 | 200 | 4,750 |
| `roads` | Roads – Route Traveled (Snap to Roads) | 5,000 | 0 (off) | 0 (off) |

Prices after the free usage (https://developers.google.com/maps/billing-and-pricing/pricing):
Dynamic Maps $7.00, Autocomplete Requests $2.83, Place Details Essentials $5.00, Compute Routes
Pro $10.00, Roads $10.00 per 1,000. Maps SDK for Android: unlimited and free (without a map id).

- No setting goes above the 95 % ceilings (`update_settings` refuses it and the counter clamps it).
- Our month runs on Colombo time; Google's resets at midnight Pacific time on the 1st (about
  13:30 Colombo). The half day in between is covered by the 5 % margin: at most one day's cap
  (400 or 200) on top of 9,500 or 4,750 is still under the free 10,000 or 5,000.
- `roads` starts at 0 (off): Google's Roads policies say "If you intend to use the Roads API as
  part of an asset tracking application, you may be required to purchase an asset tracking
  license" (https://developers.google.com/maps/documentation/roads/policies). Raise its caps in
  Settings → Fleet only once that is settled with Google.
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
  field mask `routes.legs.duration,routes.legs.distanceMeters`.
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
- Driver app: `app.config.ts` (`GOOGLE_ANDROID_MAPS_KEY`, runtime `1.2.0-gmaps` with the key),
  `src/app/task/[id].tsx` (the Google task map), `src/lib/mapRule.ts` (a Google stop on the
  OpenFreeMap map: not drawn).
- Tests: Deno `google_test.ts` (call 401 to Place Details refused, a counter error refuses the
  call, the field masks, one Routes call per plan), pgTAP `google_package.test.sql` (the real
  counter, the marks, the 30-day clean-up), the connector suite (no keys: the open package),
  Vitest (the search box's Google results, no map at a refused load), `npm run test:nav`.
