# Fame Fleet for the office: one backend, several clients (plan)

Status: plan, written 9 October 2026, nothing built. It replaces
`docs/live-map-plan.md` (the live map is section 6 here). Decisions that
need the boss are marked **boss**; things Sahan sets up are marked **Sahan**.

## 1. What changes

Today the office works only through Claude: the connector `office-mcp` and
the Fame Fleet artifact. Staff who have no Claude account cannot use any of
it. The boss keeps Claude. Everyone else gets a web app at
`fleet.fameglobal.lk` with their own login and a role.

Nothing is duplicated: the same database, the same business rules (moved
into one shared module), the same screens (one source, two builds), the same
audit log with the person's name on every write. Hard rule 2 ("no hosted
office web app") is replaced (section 13).

```
                       ┌──────────────────────────────────────────────┐
                       │  Supabase (the only source of truth)         │
 Fame Driver (phones)──┤  Postgres + RLS · Auth (+TOTP) · Storage     │
                       │  Realtime · pg_cron · pg_net                  │
                       │                                               │
                       │  Edge Functions                               │
 Claude (boss) ───MCP──┤   office-mcp ─┐                               │
                       │               ├─ _shared/fleet (rules, tools) │
 Web app (staff) ─HTTP─┤   office-api ─┘   read-odometer  push-task    │
                       │                   zoho-sync (proposal)        │
                       └──────────────────────────────────────────────┘
```

## 2. Accounts and roles

Every person has their own login (Supabase Auth, e-mail + password set
through a one-time link, section 7). The role lives on the `employees` row
(`role`), which today allows `driver`, `office`, `admin`; it grows to:

| role | who | in one line |
|---|---|---|
| `admin` | Sahan, the boss | everything, plus accounts and settings |
| `fleet_admin` | the fleet admin | runs the fleet: tasks, requests, vehicles, drivers, projects, maintenance |
| `office` | coordinators | sees everything, creates tasks and requests, cannot change vehicles, drivers or decisions |
| `staff` | anyone who needs a vehicle | their own vehicle requests only |
| `viewer` | management, accounts | read-only everything, no personal data edits |
| `driver` | drivers | the driver app only (unchanged) |

### Permission table

A = admin, F = fleet_admin, O = office, S = staff, V = viewer. "own" = rows
the person created. The connector tool behind each action is in brackets.

| Screen / action | A | F | O | S | V |
|---|---|---|---|---|---|
| Overview (`fleet_overview`) | ✓ | ✓ | ✓ | – | ✓ |
| Live locations, live map, driver route (`live_drivers`, `driver_route`) | ✓ | ✓ | ✓ | – | ✓ |
| Tasks: board, detail (`task_board`, `task_detail`) | ✓ | ✓ | ✓ | own request's task | ✓ |
| Tasks: assign (`create_task`) | ✓ | ✓ | ✓ | – | – |
| Tasks: reassign, cancel (`reassign_task`, `cancel_task`) | ✓ | ✓ | – | – | – |
| Requests: new (`create_request`) | ✓ | ✓ | ✓ | own | – |
| Requests: list (`list_requests`) | ✓ | ✓ | ✓ | own | ✓ |
| Requests: suggest vehicles (`suggest_vehicles`) | ✓ | ✓ | ✓ | – | – |
| Requests: approve / decline (`decide_request`) | ✓ | ✓ | – | – | – |
| Vehicles: list (`list_vehicles`) | ✓ | ✓ | ✓ | – | ✓ |
| Vehicles: register, update, garage, rental company | ✓ | ✓ | – | – | – |
| Maintenance (service and document fields of `update_vehicle`) | ✓ | ✓ | – | – | – |
| Drivers: list (`list_drivers`) | ✓ | ✓ | ✓ | – | ✓ |
| Drivers: create, reset PIN, switch off, update | ✓ | ✓ | – | – | – |
| Places: list (`list_places`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Places: add (`add_place`) | ✓ | ✓ | ✓ | – | – |
| Projects: find (`find_project`) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Projects: import (`import_projects`, Zoho sync) | ✓ | ✓ | – | – | – |
| Mileage, km gaps, odometer checks (`mileage_summary`) | ✓ | ✓ | ✓ | – | ✓ |
| Vehicle reports: list / update | ✓ / ✓ | ✓ / ✓ | ✓ / – | – | ✓ / – |
| Project costs (Phase C) | ✓ | ✓ | ✓ | – | ✓ |
| Accounts: create office user, reset link, switch off, change role | ✓ | – | – | – | – |
| Audit log | ✓ | ✓ | – | – | – |
| Settings (Zoho sync, keys) | ✓ | – | – | – | – |

### Enforcement, in three layers

1. **Server checks (office-api and office-mcp).** Every tool declares the
   roles that may call it (`TOOL_ROLES` in the shared module). The function
   resolves the caller to an `employees` row and refuses with 403 before the
   tool runs. Hiding a button in the UI is never the only guard.
2. **Row Level Security** for everything a browser reads directly (Realtime
   on `driver_latest` and `tasks`, and the lists the web app may read
   without a round trip through the function): office roles read the fleet
   tables; `staff` read their own `vehicle_requests`, `places` and project
   names; `viewer` reads what office reads. No office role has insert or
   update through RLS: writes go through the functions, which run as
   service role after the role check. Drivers' policies are untouched.
3. **Second step.** 2-step sign-in is optional for every role (decided
   12 October 2026): the person turns it on in Settings and the web app then
   asks for the code at sign-in. No policy checks `aal2`. The office can make
   it compulsory for some roles later with one setting, the Edge Function
   secret `REQUIRE_MFA_ROLES` (empty by default); office-api then refuses
   those roles until the session has done the second step.

### How Claude reaches the fleet, and names in the audit log

Claude Teams has one org-wide custom connector named "Fame Fleet": `office-mcp`
with the shared `OFFICE_MCP_KEY`, an admin key, used by the boss and Sahan.
The artifact has no key of its own; it uses the viewer's "Fame Fleet"
connector. There is never a second connector named "Fame Fleet" in one
account. The test scripts use the same shared key.

Calls through the shared key are audited as "Office (shared key)". Personal
keys exist as well, `office_keys (id, employee_id, key_hash, label,
created_at, last_used_at, revoked_at)`, made with `create_office_key(email,
label)` (admin, the URL shown once): the function hashes the key, finds the
person and the role, and runs the tool as that person, channel `claude`.
They are for a person's own Claude account or for tests; the Teams workspace
keeps the shared key until the connector gets OAuth sign-in (section 11,
phase 7), after which each Teams member is named without any key and the
shared key is removed from Teams.

The web app uses no connector and no key: every person signs in with their
own account, and `office-api` checks the session and the role on every call.

### Leaving

`set_office_user_active(email, false)` marks the row inactive, revokes the
person's keys, and signs out their sessions (`auth.admin.signOut`). RLS and
the functions check `active`, so an old session is useless within seconds.

## 3. One set of business rules

Everything that is a rule today lives in `office-mcp` (4,500 lines across
`fleet.ts`, `geo.ts`, `track.ts`, `tools/*.ts`): assign warnings, reassign,
cancel, decide request, suggest vehicles, mileage, km gaps, odometer checks,
overview. It moves, unchanged, to `supabase/functions/_shared/fleet/`:

```
supabase/functions/_shared/fleet/
  index.ts      TOOLS (the 28 tools + the new account tools), TOOL_ROLES
  tool.ts       the Tool shape, zod helpers       (as today)
  db.ts  audit.ts  time.ts  format.ts  geo.ts  track.ts  photos.ts  fleet.ts
  tools/        drivers.ts  vehicles.ts  tasks.ts  requests.ts  mileage.ts
                locations.ts  overview.ts  places.ts  projects.ts  accounts.ts
supabase/functions/office-mcp/index.ts    key → person, MCP wrapper (server.ts)
supabase/functions/office-api/index.ts    session → person, HTTP wrapper
```

The Supabase CLI bundles `_shared` with each function (`../_shared/...`
imports). `track.ts` stays byte-identical to the driver app's copy;
`scripts/test-track.ts` keeps checking that.

**office-api**, the HTTP twin of the connector:

| route | does |
|---|---|
| `GET /office-api/me` | name, role, whether the second step is done (`mfa`) and whether the role must do it (`mfa_required`), which tools this person may call |
| `GET /office-api/tools` | the tool list with input schemas (zod → JSON Schema), for the UI's forms |
| `POST /office-api/tools/<name>` | body = the tool's arguments, exactly as the connector takes them; reply = the tool's result JSON, exactly as the connector returns it; errors as `{ error }` with 400 (input), 403 (role), 409 (tool refused) |

Auth: `Authorization: Bearer <session token>` → `auth.getUser` → the
`employees` row (active, role) → `aal2` only for the roles in `REQUIRE_MFA_ROLES` → `TOOL_ROLES` →
run with `ctx.actor = { employeeId, name, role, channel: 'web' }`. CORS
allows only the web app's origin. Rate limit: 120 calls a minute per person
(in the function) plus a Cloudflare rule in front.

**Audit.** `office_audit` gains `actor_employee_id`, `actor_name` and
`channel` (`claude`, `web`, `driver`). Both wrappers fill them from the
resolved person. The driver app channel comes from a trigger: a task
started, completed, a vehicle report sent, an odometer reading flagged, each
writes one audit row with the driver's name, so one query shows the whole
timeline of a task whoever touched it. Location points are not audited (they
are their own log).

## 4. One set of screens, two builds

**Decision: a new source builds both; the current artifact HTML becomes the
reference, not the source.** The artifact as it stands is one 128 KB file
of hand-written JavaScript (about 130 functions, no modules, no types, no
tests, a map drawn by hand), talking to the connector through the
`window.claude` runtime. It is a good prototype and a poor foundation: the
web app needs routing, sign-in, a real map, Realtime, forms built from tool
schemas and role-aware menus, and every screen would have to be edited
twice if the artifact file stayed the source. Porting its screens once into
`apps/office` (Vite + React + TypeScript, the Fame Fleet design tokens from
`CLAUDE.md`) gives:

- `npm run build:web` → the web app (many files, code-split, MapLibre) for
  Cloudflare Pages;
- `npm run build:artifact` → one self-contained HTML file
  (`vite-plugin-singlefile`) that is republished as the Fame Fleet artifact,
  so the boss keeps the same link.

Both builds share one `Transport` interface:

```ts
interface Transport {
  me(): Promise<{ name: string; role: Role; tools: string[] }>;
  call<T>(tool: string, args: unknown): Promise<T>;   // same JSON both ways
}
// ClaudeTransport: window.claude → the connector's tool (artifact build)
// ApiTransport:    fetch office-api with the Supabase session (web build)
```

and one `MapProvider` interface with two implementations: `DrawnMap` (the
artifact's SVG map, ported) and `MapLibreMap` (web only; artifacts cannot
load tiles). Screens: Overview, Live locations, Tasks (board, detail, assign),
Requests (list, decide, new), Vehicles (list, register, update), Projects,
Maintenance, Mileage (summary, gaps, odometer checks), Drivers, plus
Accounts and Audit for admins, and "My requests" for staff. Menus and
buttons follow the permission table, but the server is the guard.

## 5. Sign-in

As approved in the live-map plan:

- `create_office_user(name, email, role)` (admin) creates the Auth user with
  no password and the `employees` row, and returns a one-time set-password
  link (`auth.admin.generateLink`, type `recovery`). Sahan or the boss sends
  it by WhatsApp; the person opens `/set-password` on the web app and
  chooses a password. `reset_office_password(email)` returns a fresh link.
  No password ever appears in a chat, and Supabase's built-in e-mail (team
  members only, two an hour) is not used.
- **2-step sign-in is optional for every role** (decided 12 October 2026).
  Everyone signs in with e-mail and password; a set-password link goes
  straight to Overview. Anyone turns 2-step on in Settings (Google
  Authenticator or any TOTP app, scan the QR code, type one code); from then
  on their sign-in asks for the code. Office passwords have at least 12
  characters, a rule of the set-password page only: the project's "Minimum
  password length" stays at 6 because drivers' 6-digit PINs are passwords in
  the same Auth project (`create_driver` and `reset_pin` fail with anything
  higher; checked on the local stack, 12 October 2026). To make 2-step
  compulsory later: set the secret
  `REQUIRE_MFA_ROLES` (for example `admin,fleet_admin,office`); office-api
  then answers `mfa_required` and the web app asks those people to set it
  up before anything loads. No RLS policy checks `aal2`.
- **Google / Microsoft sign-in later: worth it only if the company gives
  everyone a Google Workspace or Microsoft 365 account.** Then it removes
  passwords and set-password links, and leaving the company switches the
  person off centrally. It costs an OAuth app registration and one Supabase
  setting. Not now: today's five users have no such accounts.

## 6. Live map and today's route (web build only)

- MapLibre GL JS with OpenFreeMap tiles (`tiles.openfreemap.org/styles/
  liberty`, no key), the driver app's style. Sri Lanka on load, then fit to
  the vehicles.
- One Realtime channel on `driver_latest` (plus the existing `tasks`
  channel), one read on load. A marker per vehicle: a mono plate chip over
  a dot, blue = sharing (last point under 15 minutes), amber = stale,
  grey = not sharing, recomputed every 30 s on the client. Moves are
  animated over about one second. Tap: driver, vehicle, task and next stop,
  speed, battery, last update, Call and WhatsApp.
- Today's route: the driver's `location_points` for one day through the
  shared drift filter (`track.ts`, imported through a Vite alias into
  `apps/driver/src/lib/track.ts`, so it is not copied), drawn as a line with
  stops of 10+ minutes; the same km and stops `driver_route` gives.
- Mobile first: the map fills the screen, the card slides up, a list view
  for small screens.
- Realtime load for 12 vehicles and 5 office users: a vehicle sends up to
  720 positions an hour driving and 60 parked; each becomes one message per
  open map. About 1 to 2 million messages a month with two maps open most
  of the day, inside Supabase Pro's 5 million.

## 7. Zoho: server-side sync (proposal, needs the boss: it changes hard rule 8)

Today the office's Claude reads Zoho Books and sends projects through
`import_projects`. Staff on the web app cannot do that, so projects would
go stale. Proposal: a scheduled, read-only sync run by the server.

- **Client**: the Zoho admin registers a *Self Client* in the Zoho API
  console with read-only scopes `ZohoBooks.projects.READ` and
  `ZohoBooks.contacts.READ`, generates a grant code, and the refresh token
  obtained from it is stored as Edge Function secrets (`ZOHO_CLIENT_ID`,
  `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`,
  `ZOHO_DC` = `com` / `in` / `eu`). Nothing Zoho-related ever reaches a
  browser or Claude.
- **Function `zoho-sync`**, run by pg_cron every 30 minutes between 07:00
  and 20:00 Colombo (27 runs a day): refresh the access token, list
  projects and contacts changed since the last run (`last_modified_time`
  filter, 200 per page), upsert into `projects` (matching rules of the
  Allowance Desk doc, section 7.2), write a `zoho_sync_runs` row (when,
  rows, errors). `import_projects` stays for a manual push.
- **API budget**: 2 to 4 calls per run, under 110 a day; a full first load
  of 1,000 projects is 5 pages. Zoho's daily limits (Free 1,000, Standard
  2,000, Professional 5,000, Premium and up 10,000) and the 100 calls a
  minute cap are far away. The function stops for the day at 80 % of the
  plan's limit, which an admin sets in Settings.
- **Later, with a separate OK**: pushing approved costs (fuel, rent share by
  km, per `task_projects`) to Zoho Books as expenses or bills needs write
  scopes (`ZohoBooks.expenses.CREATE` or `ZohoBooks.bills.CREATE`), a
  mapping from vehicles and drivers to Zoho accounts, and a review screen
  before anything is sent.

**What the Zoho admin must do (Sahan coordinates):**

1. Say which Zoho data centre the organisation is on (the sign-in URL:
   `accounts.zoho.com`, `.in`, `.eu`) and give the Zoho Books organisation
   ID (Settings → Organisation profile).
2. API console (`api-console.zoho.<dc>`) → Add client → **Self Client** →
   note Client ID and Client Secret.
3. Same page → Generate Code → scope
   `ZohoBooks.projects.READ,ZohoBooks.contacts.READ`, duration 10 minutes,
   description "Fame Fleet sync" → copy the code.
4. Hand the code, Client ID, Client Secret and organisation ID to Sahan
   within 10 minutes (the code expires). Sahan exchanges the code for a
   refresh token with one curl call and sets the four secrets with
   `npx supabase secrets set`. The refresh token does not expire unless
   revoked; the admin can revoke it in the console at any time.
5. Later, for pushing costs: a new grant with the write scopes, same steps.

## 8. Hosting

- **Cloudflare Pages** (free): project `fame-fleet` built from the GitHub
  repository, root `apps/office`, build `npm run build:web`, output `dist`;
  `main` → production, other branches → preview URLs. Custom domain
  `fleet.fameglobal.lk` (**Sahan**: DNS for `fameglobal.lk` on Cloudflare,
  or a CNAME to the Pages host; Pages issues the certificate). One rate-limit
  rule in front of `/functions/v1/office-api`.
- **Supabase Pro** (the current project): Auth with MFA on, Site URL and
  redirect URLs set to the Pages domain, Realtime, daily backups.
- The artifact is republished from `build:artifact` by Sahan from his
  account, as today.

## 9. Security baseline

| requirement | how it is met |
|---|---|
| personal accounts | one Auth user per person, role on `employees`, personal connector keys |
| 2-step sign-in | optional per person (Settings); compulsory per role when `REQUIRE_MFA_ROLES` is set (office-api only, never RLS) |
| audit with names | `office_audit.actor_name` + `channel` on every write, driver events by trigger |
| switching off people who leave | `set_office_user_active(false)`: inactive row, keys revoked, sessions signed out |
| backups | Supabase Pro daily backups (7 days); a weekly `pg_dump` from the laptop into private storage until the boss wants PITR (USD 100/month add-on, not needed yet) |
| rate limits | Supabase Auth limits; office-api 120 calls/min per person; Cloudflare rule on the function path |
| no service key in the browser | the web app holds only the publishable key and the user's session; every write goes through office-api, which alone runs as service role |
| least privilege | roles per tool, RLS per role, read-only Zoho scopes first |
| secrets | Edge Function secrets and Vault only; `.env*` ignored; nothing in chat |

## 10. Database changes (one migration per phase, each with pgTAP tests)

1. `roles`: `employees.role` check grows to the six roles; `office_keys`;
   `office_audit` actor and channel columns; driver-side audit trigger.
2. `office_read_access`: `current_role()` helper; select policies for the
   office roles and for staff (own requests); no `aal2` condition anywhere;
   `driver_latest` in the Realtime publication; grants.
3. `accounts`: the three account tools' RPCs if any logic lands in SQL
   (otherwise none).
4. `zoho_sync` (after the boss's OK): `zoho_sync_runs`, `projects.customer_id`
   index, cron job.

Tests: each role reads exactly its rows and nothing more; no office role can
insert or update through RLS; a driver sees nothing new; anon sees nothing;
an inactive person reads nothing; audit rows carry the actor; the same
tool through office-mcp and office-api gives the same JSON (the local test
runs both channels).

## 11. Phases, effort, what to test, what Sahan sets up

Effort is for Sahan working with Claude Code, in working days.

| phase | days | builds | test | Sahan sets up |
|---|---|---|---|---|
| 1 Shared rules | 4–5 | `_shared/fleet`, office-api, roles, personal keys, audit actor and channel | pgTAP; Deno tests; the local python suite through both channels; smoke test on the live project | nothing new (deploy two functions, one migration) |
| 2 Web app core | 6–8 | `apps/office`: transports, sign-in, set-password, optional 2-step in Settings, Overview, Tasks, Requests; `build:artifact` replacing the current artifact (after phase 4) | Vitest on the transport and forms; Playwright sign-in and one task flow; the artifact rebuilt and compared screen by screen with the current one | Cloudflare account and Pages project; Auth Site URL and redirect URLs; the first admin accounts |
| 3 Live map | 3–4 | MapLibre map, Realtime markers, route of the day | the map against the phone's position on the OPPO; `driver_route` numbers equal the page's | `driver_latest` publication (in the migration) |
| 4 All screens and roles | 5–6 | Vehicles, Drivers, Projects, Maintenance, Mileage, Accounts, Audit, staff "My requests", viewer | role matrix walked through with one account per role; Playwright per role | the five accounts, by set-password link |
| 5 Zoho sync (**boss**) | 2–3 (+3–4 for push later) | `zoho-sync`, Settings page, `zoho_sync_runs` | first full load compared with Zoho Books; a changed project appears within 30 minutes; the daily budget stop | the Zoho admin's steps in section 7 |
| 6 Hardening and go-live | 2–3 | rate limits, backup check, off-boarding runbook, custom domain, CLAUDE.md | restore a backup into the local stack; switch a test user off and watch the session die; the Cloudflare rule | DNS for `fleet.fameglobal.lk`; the backup folder |

| 7 Connector sign-in (later) | 3–4 | OAuth sign-in for the "Fame Fleet" connector (Claude's "Sign in" option for custom connectors): `office-mcp` becomes an OAuth resource with Supabase Auth as the authorization server, the same Fame Fleet accounts and the same second step; each Teams member is then named in the audit log and the shared key is removed from Teams | each Teams member signs in once from Claude; a call from the boss's chat shows the boss's name in `office_audit`; a removed account is refused | enable the connector's "Sign in" in Claude Teams; remove the shared key from the Teams connector |

Status, 12 October 2026: phase 1 is live; phases 2 and 3 are built and green
locally (`scripts/test-office-local.sh`), not yet deployed to Cloudflare Pages;
the phase 3 migration `office_read_access` is not pushed yet. Today's route on
the web comes from `driver_route` (the same filtered points, thinned to ~300)
rather than from `location_points` in the browser: one implementation of the
drift filter, far less data per click.

About five working weeks before Zoho push and the connector sign-in. The
driver app does not change in any phase.

## 12. Monthly cost (12 vehicles, about 5 office users)

| item | USD / month |
|---|---|
| Supabase Pro (database, Auth with MFA, Storage, Realtime, functions, backups) | 25 (+10 if the small compute add-on is ever needed) |
| Cloudflare Pages, DNS, one rate-limit rule | 0 |
| Domain `fameglobal.lk` | already owned; a subdomain costs nothing |
| Gemini Flash-Lite for odometer photos | under 1 |
| Expo EAS (builds and updates at today's volume) | 0 |
| Zoho API | 0 (within the plan the company already has) |
| Google Maps | 0 (not used; free within its allowance if ever switched on) |
| **Total** | **about 25–35** |

## 13. Changes to `CLAUDE.md` (when the boss approves)

- Hard rule 2 becomes: "Office access = Claude (connector + artifact) for
  the boss, and the office web app `apps/office` at `fleet.fameglobal.lk`
  (Cloudflare Pages) for everyone else. Both call the same rules in
  `supabase/functions/_shared/fleet` through `office-mcp` and `office-api`.
  No other hosted app. Every person has their own account and role; writes
  are checked by the server and audited with the person's name."
- Hard rule 5 adds "and never in the browser: the web app holds only the
  publishable key and the user's session".
- Hard rule 8 (Zoho), only if section 7 is approved: "No Zoho calls from our
  code except the read-only `zoho-sync` function (projects and customers,
  scheduled, secrets in Edge Function secrets). The office's Claude Zoho
  connector and `import_projects` remain for manual pushes."
- Roles: the six roles and the permission table (section 2) replace the
  `employees.role` line in the data model; `office_keys` and the audit
  columns are added.
- Phase B becomes "the office web app and the artifact from one source
  (`apps/office`)"; the live-map exception text in rule 2 goes.
- Stack: `apps/office` (Vite + React + TypeScript, MapLibre, two builds).

## 14. Questions for the boss

1. The role names and the permission table: anything an `office` person
   should also be allowed (cancelling a task they created?).
2. Zoho sync, read-only, scheduled: yes or no. Pushing costs is a later
   decision.
3. ~~TOTP for the three strong roles from day one, or optional for the first
   month.~~ Decided 12 October 2026: optional for everyone, per person in
   Settings; `REQUIRE_MFA_ROLES` can make it compulsory later.
4. Domain name: `fleet.fameglobal.lk` or another.
