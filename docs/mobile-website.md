# The mobile website (Phase 8, O4)

The office site has two builds on the same address (https://fame-fleet.pages.dev, the Cloudflare Pages project
`fame-fleet`):

- **the desktop site** (`apps/office`, Vite + React) at `/`, as before;
- **the mobile site** at `/m/`: the web build of Office mode, the same screens the office uses in the Fame Fleet app
  (`apps/driver/src/app/office`), built with Expo for web (react-native-web). The driver's side of the app is never in it.

Held until Sahan has tested `/m/` on his phone (`apps/office/src/app/viewChoice.ts` `PHONE_REDIRECT = false`; on = `true` and a deploy): a phone stays on the desktop site and reaches the mobile site by its address or by "Switch to mobile view". Once on, a phone opening any page of the site is sent to the mobile site; "Switch to desktop view" (Profile and More) brings the
desktop site and is remembered on that browser; the desktop site has "Switch to mobile view" for a phone that chose it.

## Where it stands (20 October 2026)

Built: the web build of Office mode, the browser maps, the sign-in and session, the one domain with the switch both ways,
the deploy script (steps 1–4, deployed 20 October); installing it, the offline page, the favicon, web push and the
unsaved-form guards (step 5, branch `phase8-o4-s5`, not deployed yet). The phone redirect is ready and off.

## Signing in

The same office account as the desktop site: e-mail and password (and the 2-step code when it is on). The session stays in
the browser (the publishable key only; no secret ever reaches the browser). The rule for the network is the app's: a
401 or 403 signs out; office-api's 503 or no answer shows "Fame Fleet did not answer" with Try again, never "signed out".

## The maps

The desktop site's rule (21 October 2026): Google's map when the office's map package is google (`/me`, read again at every
start) and `register_map_load` allows it (the load counted first; the browser key handed out at run time, never in the
build); the free map (MapLibre GL JS, OpenFreeMap) otherwise, never mixed on one map; Google counts as failed only when its
script fails, Google refuses the key (`gm_authFailure`) or the script is not ready in 15 s, and then every map of the tab is
the free map; "Map not available" when both fail. Each map writes one line in the browser's console:
`[Fame Fleet map] Google used`, or `… refused: <why>` / `… failed: <why>`. Google's content is never drawn on the free map
(CLAUDE.md hard rule 10).

## Fonts

The app's own files (IBM Plex Sans 400/500/600/700, IBM Plex Mono 500/600, Archivo ExtraBold, Yaldevi 400/600, Gemunu
Libre ExtraBold; no Google Fonts request), each weight its own family as in the app. The export puts them under
`/m/assets/vendor/` (`scripts/web-vendor-assets.mjs`): Cloudflare's upload leaves out any `node_modules` folder, where Expo
puts them, so before 21 October they were never online and Chrome got the site's HTML instead.

## Install it on a phone

While the phone redirect is held, open **https://fame-fleet.pages.dev/m/** (or, on the desktop site on a phone, More →
**Switch to mobile view**). Once the redirect is on, the site's own address is enough.

### iPhone (iOS 16.4 or later)

1. Open the address above in **Safari** (only Safari adds a web app to the Home Screen with notifications).
2. Sign in.
3. Tap **Share** (the square with the arrow), then **Add to Home Screen**, then **Add**.
4. Open **Fame Fleet** from the Home Screen (notifications work only from the installed app, never from a Safari tab).
5. More → My profile → **Notifications** → under "This browser" tap **Turn on in this browser**, then **Allow**.

### Android (Chrome)

1. Open the address above in **Chrome**.
2. Sign in.
3. Tap **Install app** when Chrome offers it, or ⋮ → **Add to Home screen** → **Install**.
4. More → My profile → **Notifications** → **Turn on in this browser**, then **Allow**.

What it is, as built:
- **Install:** its own manifest (`/m/manifest.webmanifest`: name Fame Fleet, scope and start `/m/`, standalone, the site's FF
  icons, one maskable), the favicon and the iPhone icon in the page (`apps/driver/public/index.html`, Expo's page template).
- **Offline:** the worker `/m/sw.js` (scope `/m/`; the desktop site's `/sw.js` keeps `/`) keeps one file,
  `/m/offline` (the file `offline.html`; Pages serves it at that address): a page of the site opened with no connection shows "No connection" in English and Sinhala with Try
  again, and reloads by itself when the connection is back. Nothing else is cached (a deploy is never stale) and nothing
  works offline.
- **Web push:** the office's existing web push (the key from `my_notification_settings`, `register_web_push`,
  `remove_web_push`), on the mobile site's worker: Notifications has a "This browser" card (its state in words, Turn on or
  Turn off; `components/office/BrowserPush.web.tsx`, `lib/browserPush.ts`). A tap opens the notification's place: an open
  mobile window goes there (the desktop link mapped by `routeForUrl`), else `/m/?from=<link>`. The same browser on the
  desktop site has its own subscription (scope `/`): turned on in both, it gets each notification twice.
- **Unsaved forms:** a reload or a closed tab asks the browser's "Leave site?"; the browser's own Back (and an installed
  app's back gesture) inside the site asks "Discard changes?" like our back arrow (`components/navigation.ts`,
  `installWebFormGuards`: the router never hears that Back until Discard).

## The phone redirect

Off (`PHONE_REDIRECT = false` in `apps/office/src/app/viewChoice.ts`). To turn it on: set it to `true`, run the site's tests
(`viewChoice.test.ts`; the e2e `mobile-web` expects it off and needs its first step changed back), and deploy the site
(`scripts/deploy-pages.sh --deploy`, after Sahan's go). From then on a phone (a mobile browser, or a narrow touch screen; an
iPad and a laptop keep the desktop site) opening any page except `/privacy` and `/set-password` is sent to `/m/`, with the
page it asked for opened after the sign-in; "Switch to desktop view" still wins.

## Deploying (needs Sahan's go)

One step builds both and uploads them together: `apps/office/scripts/deploy-pages.sh` makes the desktop build, the
mobile build (`npm run web:export` in `apps/driver`) copied under `/m/` with `/m/*` routed to its own page, checks there is
no source map, runs the key and secret scan over everything that would be uploaded, and uploads with
`npx wrangler pages deploy --branch main` only when run with `--deploy`.

## Testing

- `apps/driver`: `npm run test:web` (the browser's confirmations, no temporary web file left), `npm run test:web-routes`
  (every Office mode screen has its web route), `npm run test:web-maps` (the browser maps' rules).
- `apps/office`: `src/app/viewChoice.test.ts` (who is sent to `/m/`, with the redirect on and held), and the e2e project
  `mobile-web` (`e2e/mobile.spec.ts`, a 412 × 915 Android browser): the site's address stays on the desktop site while the
  redirect is held → `/m/` sign-in → Home → Approve → Live → Switch to desktop view and back → a desktop task link → Give a
  driver; and step 5: the manifest and icons, the worker on `/m/`, "No connection" offline, the push card, an unsaved form
  asking on the browser's Back (Cancel keeps it, Discard leaves) and on a reload. `scripts/test-office-local.sh` builds the
  local mobile build and the dev server serves it under `/m/` (`FLEET_MOBILE_DIR`).
