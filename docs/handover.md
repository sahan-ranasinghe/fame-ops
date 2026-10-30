# Fame Fleet: handover for a future developer

Everything a developer needs to keep Fame Fleet running and to change it safely. The rules that bind every change are
in **CLAUDE.md** (read it first); the history of every decision is in the plan files under docs/ (phase5 → phase8-plan.md,
newest sections at the top of phase8-plan.md). Section 6 is the account ownership checklist: settle it before the original
developer leaves.

## 1. What runs where

| Part | Code | Runs on | Users |
|---|---|---|---|
| Driver app "Fame Fleet" (Android, `com.fameglobal.driver`) | `apps/driver` (Expo, React Native, TypeScript) | the drivers' phones; built on EAS, updated over the air (EAS Update) | drivers (username + 6-digit PIN), and office people in **Office mode** |
| Office website | `apps/office` (Vite, React, TypeScript) | Cloudflare Pages, project `fame-fleet`, https://fame-fleet.pages.dev | office people (e-mail + password) |
| Phone website `/m/` | `apps/driver` built for the web (`npm run web:export`), served under the website | Cloudflare Pages (same upload) | office people on a phone browser |
| Claude artifact "Fame Fleet" | `apps/office` built as one file (`npm run build:artifact`) | claude.ai (Teams copy RsGzozM5V4qCv4UeAECatu, updated by hand) | the boss and Sahan in Claude |
| Backend | `supabase/` (migrations, Edge Functions, pgTAP tests) | Supabase project `hinurfsaxvplbyqgtozj` (Postgres 17, Auth, Storage, Edge Functions, pg_cron) | everything above |

**Edge Functions** (`supabase/functions`): `office-api` (the website's and Office mode's API: every tool, with the
person's session), `office-mcp` (the same tools for Claude, the connector; never deletes), `driver-api` (the driver
app's trips and place search), `push-task` (Expo/FCM pushes to drivers), `notify-office` (web push to office browsers),
`read-odometer` (Gemini reads an odometer photo), `fleet-jobs` (the background work pg_cron asks for). All office rules
live once in `supabase/functions/_shared/fleet` (tools, permissions, the planner, issues, retention, the bin).

**pg_cron jobs** (in the migrations): task-reminders, request-reminders, fleet-sync, duty-jobs, day-summaries, retention
(nightly: also empties Recently deleted after 30 days), stop-arrivals, check-odometer-photos, fuel-videos-prune,
google-content, notify-retry, expire-requests, no-app-trips, demo-tasks, confirmed-visits and the prune jobs.

## 2. How to deploy (always from `main`, after CI passed)

Every command starts with `source ~/.nvm/nvm.sh && nvm use >/dev/null && ` (Node from `.nvmrc`). Order: database, then
functions, then the website, then main, then the app update; never a website or app before its server code.

1. **Database:** `npx supabase db push --linked --dry-run` (read the list), then `npx supabase db push --linked --yes`.
   Every schema change is a NEW file in `supabase/migrations`; never edit one that was pushed.
2. **Functions:** one at a time, `npx supabase functions deploy <name> --use-api --project-ref hinurfsaxvplbyqgtozj`,
   then `npx supabase functions list` to see the new version.
3. **Website + /m/:** `cd apps/office && bash scripts/deploy-pages.sh --deploy` (builds both, scans for source maps and
   keys, uploads, checks the /m/ files). It reads `apps/office/.env.production.local` and `apps/driver/.env` (the Supabase
   URL and the publishable key only; gitignored).
4. **Main:** fast-forward `main`, `python3 scripts/push-scan.py main` must print 0, `git push origin main`.
5. **App update (JavaScript only):** `cd apps/driver && npx eas update --channel preview --environment preview
   --non-interactive --message "…"`; it targets the runtime of the installed build (now `1.4.0-gmaps`).
6. **App build (native change only):** EAS, profile `drivers` (`npx eas build --profile drivers --platform android
   --no-wait`), 15 free builds a month; check the APK as docs/release-1.4.0.md says. No local native builds.

## 3. Tests and CI

- **Fast, while working:** `npm run typecheck` and `npx vitest run` (apps/office); `npm run typecheck`, `npx jest` and
  the `npm run test:*` scripts (apps/driver); Deno tests in Docker (CLAUDE.md, "Deno via Docker"); pgTAP with
  `npx supabase test db --local` on the local database.
- **CI decides** (`.github/workflows/office-suite.yml`, docs/ci.md): `gh workflow run office-suite.yml --ref <branch>`
  runs everything (the local stack, pgTAP, Deno, the connector suite, the website's e2e on Playwright, the app's
  suites). A checkpoint needs a green run with zero failed tests.

## 4. Where the secrets are (never in git, never printed)

| Secret | Where |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `OFFICE_MCP_KEY` (Claude's connector key), `SERVER_KEY` (pg_cron → functions), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (web push), `GOOGLE_SERVER_KEY`, `GOOGLE_MAPS_JS_KEY`, `ORS_KEY` (openrouteservice), `GEMINI_API_KEY`, `OFFICE_WEB_URL`, `OFFICE_FUNCTIONS_URL`, `REQUIRE_MFA_ROLES`, `ROUTING_PROVIDER`, `OSRM_URL` | Supabase → Edge Functions → Secrets (`npx supabase secrets list` shows names only) |
| `functions_url`, `server_key` | Supabase Vault (pg_cron uses them to call fleet-jobs) |
| `GOOGLE_ANDROID_MAPS_KEY` (secret), `GOOGLE_ANDROID_MAPS` (on/off), `GOOGLE_SERVICES_JSON` (Firebase file) | EAS → the project's environment variables (preview) |
| The Supabase URL and publishable key | `apps/office/.env.production.local`, `apps/driver/.env` (gitignored; public by design, protected by RLS) |
| The Android signing key | EAS credentials (managed by EAS) |

The service role key bypasses all security: it lives only in Edge Function secrets. The app and the website only ever
hold the publishable key.

## 5. Rules that keep it safe (from CLAUDE.md, in short)

Drivers never need a Claude account. Exactly one "Fame Fleet" connector per Claude account. Never the official Supabase
MCP connector. Never modify the "Fame Group Allowance Desk" artifact. Times stored UTC, shown Asia/Colombo; money in LKR
cents. Every Google call counted and capped before it is made (fail closed). The connector never deletes. Archive before
delete; delete only what has no history; the bin keeps it 30 days. Every push to GitHub after the key scan prints 0.

## 6. Account ownership checklist (settle this)

Every service below must be owned by a **Fame company account** (not a person's private account) and have **at least
two admins**, so the system never depends on one person. "Today" is what this repository knows; confirm each in the
service's own settings and fill in the last column.

| Service | What it holds | Today | Fame owner + two admins |
|---|---|---|---|
| **GitHub** | the code, CI, the history (`github.com/sahan-ranasinghe/fame-ops`, private) | Sahan Ranasinghe's personal account | ☐ transfer to a Fame GitHub organisation; ☐ two admins |
| **Supabase** | the database, sign-ins, photos, documents, videos, the functions and their secrets (project `hinurfsaxvplbyqgtozj`) | the organisation this CLI is logged into: confirm its owner | ☐ Fame organisation owner; ☐ two admins; ☐ billing on a company card |
| **Cloudflare** | the website and /m/ (Pages project `fame-fleet`, `fame-fleet.pages.dev`) | the account wrangler deploys with: confirm its owner | ☐ Fame account; ☐ two admins |
| **Expo / EAS** | the app's builds, updates, signing key, its environment variables (organisation `fame-global`; CLI user `fameops`) | organisation `fame-global` | ☐ confirm the owner is Fame; ☐ two admins |
| **Google Cloud** | the Maps keys, Places, Routes, Roads, and their billing (the "Fame Fleet" project, docs/google-maps-setup.md) | confirm the project owner and the billing account | ☐ Fame owner; ☐ two admins; ☐ billing alerts to a shared address |
| **Firebase** | push notifications to the phones (FCM; `google-services.json` for `com.fameglobal.driver`) | confirm the project owner | ☐ Fame owner; ☐ two admins |
| **Claude Teams** | the org-wide "Fame Fleet" connector (office-mcp with OFFICE_MCP_KEY) and the Teams artifact | the Fame Claude Teams workspace: confirm its owners | ☐ two workspace owners know where the connector key is set |
| **Google Play** (later) | the store listing (not published yet; docs/store-release.md) | none yet | ☐ a Fame developer account when it is published |

When an admin leaves: remove them from each service above, archive their Fame Fleet account (Settings → Users →
Archive), and rotate any secret they could see (Supabase secrets, the connector key: `npx supabase secrets set …`, then
update the Claude Teams connector URL).
