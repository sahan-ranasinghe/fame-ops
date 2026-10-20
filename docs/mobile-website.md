# The mobile website (Phase 8, O4)

The office site has two builds on the same address (https://fame-fleet.pages.dev, the Cloudflare Pages project
`fame-fleet`):

- **the desktop site** (`apps/office`, Vite + React) at `/`, as before;
- **the mobile site** at `/m/`: the web build of Office mode, the same screens the office uses in the Fame Fleet app
  (`apps/driver/src/app/office`), built with Expo for web (react-native-web). The driver's side of the app is never in it.

Held until Sahan has tested `/m/` on his phone (`apps/office/src/app/viewChoice.ts` `PHONE_REDIRECT = false`; on = `true` and a deploy): a phone stays on the desktop site and reaches the mobile site by its address or by "Switch to mobile view". Once on, a phone opening any page of the site is sent to the mobile site; "Switch to desktop view" (Profile and More) brings the
desktop site and is remembered on that browser; the desktop site has "Switch to mobile view" for a phone that chose it.

## Where it stands (20 October 2026)

Built (steps 1–4): the web build of Office mode, the browser maps, the sign-in and session, the one domain with the switch
both ways, the deploy script. Not built yet (step 5): installing it (manifest, icons, the offline "No connection" page) and
web push; the steps below for installing are the plan for step 5, not yet true. Until then a browser asks for
`/favicon.ico` on a mobile page and gets nothing.

## Signing in

The same office account as the desktop site: e-mail and password (and the 2-step code when it is on). The session stays in
the browser (the publishable key only; no secret ever reaches the browser). The rule for the network is the app's: a
401 or 403 signs out; office-api's 503 or no answer shows "Fame Fleet did not answer" with Try again, never "signed out".

## The maps

Google's map when the office's map package is Google and the website's Google map load is allowed (each load counted
against the website's cap through `register_map_load`, which hands out the browser key); otherwise, and when Google's map
does not load, the free map (MapLibre GL JS with OpenFreeMap's tiles). Google's content is never drawn on the free map
(CLAUDE.md hard rule 10).

## Install it on a phone (step 5, not built yet)

### iPhone (iOS 16.4 or later)

1. Open https://fame-fleet.pages.dev in **Safari** (not Chrome: only Safari can add a web app to the Home Screen with
   notifications).
2. Sign in.
3. Tap **Share** (the square with the arrow), then **Add to Home Screen**, then **Add**.
4. Open **Fame Fleet** from the Home Screen (notifications only work from the installed app, never from a Safari tab).
5. Profile → Notifications → **Turn on** and **Allow** when iOS asks.

### Android (Chrome)

1. Open https://fame-fleet.pages.dev in **Chrome**.
2. Sign in.
3. Tap **Install app** when Chrome offers it, or ⋮ → **Add to Home screen** → **Install**.
4. Profile → Notifications → **Turn on** and **Allow**.

With no connection the installed site opens to "No connection" with Try again; nothing is kept for offline work.

## Deploying (needs Sahan's go)

One step builds both and uploads them together: `apps/office/scripts/deploy-pages.sh` makes the desktop build, the
mobile build (`npm run web:export` in `apps/driver`) copied under `/m/` with `/m/*` routed to its own page, checks there is
no source map, runs the key and secret scan over everything that would be uploaded, and uploads with
`npx wrangler pages deploy --branch main` only when run with `--deploy`.

## Testing

- `apps/driver`: `npm run test:web` (the browser's confirmations, no temporary web file left), `npm run test:web-routes`
  (every Office mode screen has its web route), `npm run test:web-maps` (the browser maps' rules).
- `apps/office`: `src/app/viewChoice.test.ts` (who is sent to `/m/`), and the e2e project `mobile-web`
  (`e2e/mobile.spec.ts`, a 412 × 915 Android browser): the site's address → `/m/` sign-in → Home → Approve → a desktop
  task link kept across → Give a driver → Live → Switch to desktop view and back. `scripts/test-office-local.sh` builds
  the local mobile build and the dev server serves it under `/m/` (`FLEET_MOBILE_DIR`).
