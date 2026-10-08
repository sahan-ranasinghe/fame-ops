# Live map web app (`apps/web`): plan

Status: plan only, written 8 October 2026, approved the same day with the account
change in section 2. Nothing is built. This is the one
allowed exception to "no hosted office web app" (CLAUDE.md): Claude artifacts
cannot load map tiles, so the live map needs a small page outside Claude.
Everything else the office does stays in Claude through the connector.

## 1. What it is

A small, mobile-first web app in the Fame Fleet look (the tokens in
`CLAUDE.md`: ink `#15181c`, page `#f3f2ee`, amber `#f2a900`, blue `#1e4fa0`,
IBM Plex Sans / Mono), hosted free on Cloudflare Pages, talking straight to
Supabase with the publishable key and the office user's session. Three
screens now, more later:

| Screen | Who | What |
|---|---|---|
| Sign in | office | email + password (Supabase Auth), optional second step (TOTP) |
| Live map | office | every driver's latest position, live, with vehicle plates |
| Today's route | office | one driver's day: where they went and stopped |
| (later) Vehicle requests | staff | ask for a vehicle, see the answer |

No polling anywhere: positions arrive through Supabase Realtime.

## 2. Sign-in and accounts

- Supabase Auth email + password, the same project as the driver app. Public
  sign-up stays off. An office user is an `employees` row with
  `role = 'office'` and an `auth_user_id`, like a driver with a different role.
- **Creating accounts (decided: one new connector tool, no password in
  chat).** `create_office_user(name, email, role = 'office' | 'staff')`
  creates the Auth user with no password (`auth.admin.createUser`, e-mail
  marked confirmed) and the `employees` row, then returns a one-time
  set-password link from `auth.admin.generateLink({ type: 'recovery' })`.
  Sahan sends the link by WhatsApp; the person opens it, lands on the web
  app's `/set-password` page (the link carries a recovery session) and
  chooses their own password (`supabase.auth.updateUser({ password })`).
  `reset_office_password(email)` returns a fresh link the same way, and
  `set_office_user_active(email, active)` switches a person off. No password
  ever appears in Claude's chat history, and Supabase's built-in e-mail is
  not used at all: it only delivers to project team members, two an hour, so
  a "forgot password" e-mail would never reach office staff. The link is
  valid for one hour (Auth setting `otp_expiry`); an expired link is simply
  replaced by asking for another. The tools run with service_role inside the
  connector, so no laptop needs the service key, and every creation is in
  `office_audit`.
- **Second step (TOTP): worth adding, in two stages.** The page shows every
  driver's position; a leaked password should not be enough. Supabase MFA
  (TOTP, Google Authenticator or similar) is free and takes a user two
  minutes to enrol. Stage 1: optional enrolment on a Settings screen. Stage
  2 (after the five users have enrolled): the map's RLS policies require
  `aal2` (`(select auth.jwt() ->> 'aal') = 'aal2'`), so a session without the
  second step cannot read positions at all, whatever the web app does.
  Drivers are not affected: their policies do not change.

## 3. Live map

- **Map**: MapLibre GL JS with OpenFreeMap tiles
  (`https://tiles.openfreemap.org/styles/liberty`, no key), the same style
  the driver app uses. Sri Lanka framed on load, then fit to the vehicles.
- **Data**: one Realtime channel on `driver_latest` (`postgres_changes`,
  UPDATE and INSERT), plus one read of the table on load. `driver_latest` is
  written by the trigger for every stored point: while driving every 5 s,
  parked once a minute. `tasks` in progress and `employees`/`vehicles` are
  read on load and refreshed on the existing `tasks` Realtime channel.
- **Markers**: one per vehicle (the driver's current vehicle, or the task's
  vehicle while a task runs), a rounded plate chip in mono (the design's
  plate style) above a dot. Colour from the same rule as the connector:
  blue = sharing (last point under 15 min), amber = stale, red/grey = not
  sharing. The age is recomputed every 30 s on the client so a marker goes
  amber without any new message.
- **Movement**: a new position is not jumped to; the marker is animated over
  about one second (requestAnimationFrame, linear interpolation of lat/lng,
  heading rotated when present).
- **Click**: a card with driver name, vehicle, task title and next stop,
  speed (km/h), battery %, last update ("2 min ago" and the time), and
  Call / WhatsApp links (`tel:`, `wa.me`, the same helpers as the connector).
- **Mobile**: the map fills the screen; the card slides up from the bottom;
  a list view (the same cards, sorted by state) for small screens and
  for the boss's "who is where" glance.

## 4. Today's route

- Reads `location_points` for one driver and one Colombo day (RLS lets the
  office read them), runs them through the GPS drift filter and draws the
  accepted fixes as a line, stops of 10+ minutes as circles with the
  duration, and the raw points faintly behind (toggle). Km and stops are the
  same numbers `driver_route` gives, because it is the same code.
- **Sharing `track.ts` without copying it**: the web app's bundler (Vite)
  gets an alias `@fleet/track` pointing at
  `../driver/src/lib/track.ts`, so the web app imports the driver app's file
  as it is. (The connector keeps its own copy because a Supabase function is
  bundled from its folder alone; `scripts/test-track.ts` already checks that
  copy is identical.) If a third consumer appears, the file moves to
  `packages/track` as a workspace package and all three import it.

## 5. Later: staff vehicle requests

The app is laid out so that a `staff` role fits without rework: a router that
gates screens by `employees.role`, an "Office" group (map, route) and a
"Staff" group (my requests, new request) that reuses `vehicle_requests`
through RLS policies "staff read and insert their own requests". The
connector's `create_request`/`decide_request` stay the office side.

## 6. Database changes (to write later, with tests)

Migration `office_read_access`:

- `employees.role` already allows `'office'` and `'admin'`; add `'staff'` to
  the check constraint.
- Helper `public.current_role()` (security definer, stable): the role of the
  signed-in user's employee row, or null.
- Policies (select only, no insert/update/delete for office anywhere):
  `driver_latest`, `location_points`, `duty_sessions`, `tasks`, `task_stops`,
  `vehicles` (all columns: the office may see rent and documents), `employees`
  (drivers and office), `places`. Each: `using (public.current_role() in
  ('office', 'admin'))`. The driver policies are untouched.
- Grants: `select` on `driver_latest` and `duty_sessions` to `authenticated`
  (drivers get nothing from them because their policies do not match).
- Realtime: add `driver_latest` to `supabase_realtime`.
- Stage 2 of MFA: the same policies with `and (select auth.jwt() ->> 'aal') = 'aal2'`.

Tests (pgTAP, in `access_rules.test.sql`): an office user reads every
driver's `driver_latest`, points, tasks, stops and the full vehicle rows;
cannot insert or update any of them (42501); a driver still sees only their
own rows; a `staff` user sees none of the positions; anon sees nothing;
`driver_latest` is in the publication.

## 7. Map provider swap (Google Maps later)

`src/map/provider.ts` defines the only interface the screens use:

```ts
interface MapProvider {
  mount(container: HTMLElement, options: { center; zoom }): Promise<void>;
  setMarkers(markers: VehicleMarker[]): void;      // add, move (animated), remove
  fitTo(points: LngLat[]): void;
  drawRoute(line: LngLat[], stops: Stop[]): void;
  clearRoute(): void;
  onMarkerClick(cb: (id: string) => void): void;
}
```

`MapLibreProvider` now; `GoogleMapsProvider` later behind the same interface,
chosen by an environment variable. Switching needs no screen changes.

If we switch, the Google Cloud steps are:

1. Google Cloud console → new project "Fame Fleet map" → enable **Maps
   JavaScript API** (and Billing: a card is required, but see the free
   tier below).
2. Credentials → Create API key → **Application restriction: HTTP referrers**
   with `https://fleet.<domain>/*` (and the `*.pages.dev` URL while
   testing) → **API restriction: Maps JavaScript API only**.
3. APIs & Services → Maps JavaScript API → Quotas → set a daily cap on
   "Map loads" (for example 500 per day: five users opening the map a few
   times each).
4. Billing → Budgets & alerts → budget of USD 10/month with e-mail alerts at
   50 % and 100 %.
5. Put the key in Cloudflare Pages as `VITE_GOOGLE_MAPS_KEY` and set
   `VITE_MAP_PROVIDER=google`.

Since March 2025 each Maps SKU has its own free monthly use (Dynamic Maps:
10,000 loads a month); with five office users that is free. A key leaked
from the page cannot be used elsewhere because of the referrer restriction.

## 8. What Sahan sets up, and the cost

- **Cloudflare**: a free account; Workers & Pages → create a Pages project
  from the GitHub repository (root `apps/web`, build command `npm run
  build`, output `dist`) or `npx wrangler pages deploy dist` from the
  laptop. Environment variables `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (both public values). Free plan: unlimited
  requests for static pages, 500 builds a month. Cost: **USD 0**.
- **Domain**: optional. `fame-fleet.pages.dev` works from day one. A custom
  name (for example `fleet.fameglobal.lk`) needs the DNS of that domain on
  Cloudflare (free) or a CNAME to the Pages host.
- **Supabase Auth**: add the Pages URL to Site URL / Redirect URLs (the
  set-password link redirects there); enable MFA (TOTP) in Auth settings.
  No e-mail provider is needed.
- **Supabase usage** for 12 vehicles and about 5 office users: Realtime
  messages are the only new load. A vehicle sends up to 720 positions an
  hour while driving and 60 while parked; each position becomes one message
  per *open* map. With the map open on two phones for most of the working
  day that is roughly 1 to 2 million messages a month, inside the Pro plan's
  5 million (then USD 2.50 per extra million). The Free plan's 2 million
  would be tight. Nothing else changes: the points are stored already.
- **Total**: USD 0 on Cloudflare, no change on Supabase Pro, Google Maps free
  within its monthly allowance if ever switched on.

## 9. Order of work (about 4 working days)

1. Migration + tests (office read access, Realtime on `driver_latest`).
2. Connector tools `create_office_user` (returns the set-password link),
   `reset_office_password` and `set_office_user_active`; the web app's
   `/set-password` page.
3. `apps/web`: Vite + React + TypeScript, Supabase client, sign-in,
   MapLibre provider, live map with markers and cards.
4. Today's route with the shared filter.
5. Cloudflare Pages deploy, domain, Auth URLs; the five accounts.
6. MFA stage 1, then stage 2 once everyone has enrolled.
