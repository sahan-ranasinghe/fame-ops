# Fame Fleet

Driver app (Fame Driver) and fleet office tools for Fame Global Solutions.
This repository is private: `docs/` contains internal company IDs.

- `CLAUDE.md`: the specification (what we build, hard rules, data model).
- `design/`: the Fame Fleet screens (PNG and PDF).
- `docs/`: how the existing Allowance Desk artifact works.
- `supabase/migrations/`: the database (tables, Row Level Security, the private
  `driver-photos` bucket, towns).
- `supabase/tests/`: database tests for the access rules.
- `supabase/functions/office-mcp/`: the office connector (Edge Function).
- `scripts/`: connector tests.
- `apps/driver/`: the Fame Driver Android app (Expo).

## Driver app (`apps/driver`)

Expo SDK 57, Android only, package `com.fameglobal.driver`, Expo project
`@fame-global/fame-driver`. It is a development build, not Expo Go: background
location, the map and the other native modules need it.

- Every native module the app will use is already installed, so one cloud build
  is enough; after that, changes to screens and logic reload live.
- `app.json` holds the name, package, permissions and config plugins.
  The `android/` folder is generated and is not committed.
- `eas.json` has two build profiles, both producing an APK for internal
  installs: `development` (with the developer menu, loads code from the laptop)
  and `preview` (standalone, for trying on a driver's phone).
- The Supabase URL and the publishable key are public values. They are in
  `eas.json` for builds and in `apps/driver/.env` (not committed; see
  `.env.example`) for the dev server.
- `.easignore` (at the top of the repository) limits what a build uploads to
  Expo to `apps/`. Without it the whole repository would be uploaded,
  including `docs/` and the git history.

```bash
cd apps/driver
source ~/.nvm/nvm.sh && nvm use

npx expo-doctor                                       # 21/21 checks
npx tsc --noEmit                                      # type check
npx expo prebuild --platform android --no-install     # config check; then: rm -rf android

eas build --profile development --platform android    # cloud build (Sahan starts builds himself)
npx expo start --dev-client                           # then open the app on the phone
```

Known risk: `@react-native-ml-kit/text-recognition` (reads the odometer from a
photo) is listed as "untested on the New Architecture" and is excluded from
that one `expo-doctor` check in `package.json`. If a build fails in that
library, or reading a photo does not work, remove it: the odometer is always
typed or confirmed by hand anyway.

## Office connector (`office-mcp`)

The office (the boss and the fleet admin) works in Claude. Claude reaches the
fleet through this connector: an MCP server over Streamable HTTP with 28 tools
and nothing else (no raw SQL, no deletes). Every tool call is written to the
`office_audit` table.

- URL: `https://hinurfsaxvplbyqgtozj.supabase.co/functions/v1/office-mcp/<OFFICE_MCP_KEY>/mcp`
- The key in the URL is the only protection. A wrong or missing key answers 404.
  Treat the whole URL as a password: anyone who has it can use every tool.
- `index.ts` checks the key, `server.ts` lists the tools and writes the audit
  log, `tools/` holds the tools by area, the other files are shared helpers.
- `database.types.ts` is generated. After a schema change:
  `npx supabase gen types typescript --local --schema public > supabase/functions/office-mcp/database.types.ts`

Deploying (needs Sahan's go-ahead each time):

```bash
source ~/.nvm/nvm.sh && nvm use
npx supabase db push                                         # only when there is a new migration
npx supabase functions deploy office-mcp --no-verify-jwt     # the key in the URL replaces the JWT check
```

`OFFICE_MCP_KEY` is an Edge Function secret (at least 32 characters). Sahan
sets it himself with `npx supabase secrets set`; it is never committed.

Smoke test of the deployed connector (wrong key gives 404, lists the tools,
calls three read-only tools):

```bash
export OFFICE_MCP_KEY='...'    # in your own terminal
scripts/test-mcp.sh
```

## Tests

Everything here runs against a local Supabase stack in Docker and never
touches the real project.

```bash
source ~/.nvm/nvm.sh && nvm use
npx supabase start

# 1. Database access rules (needs an empty local database)
npx supabase db reset --local
npx supabase test db                 # last line: Result: PASS

# 2. The connector, end to end: every tool, plus what the driver app will do
printf 'OFFICE_MCP_KEY=%s\n' "$(openssl rand -hex 32)" > /tmp/office-mcp.env   # throwaway local key
npx supabase functions serve office-mcp --env-file /tmp/office-mcp.env        # leave running
scripts/test-mcp-local.sh /tmp/office-mcp.env                                 # in a second terminal

npx supabase stop                    # when finished
```

Type check and lint of the connector (Deno is not installed on the laptop, so
it runs in Docker):

```bash
docker run --rm -v "$PWD/supabase/functions/office-mcp:/app:ro" -w /app denoland/deno:alpine \
  sh -c 'deno check index.ts && deno lint && deno fmt --check'
```

## Data credits

The `towns` table (used for "Near <town>") holds names and coordinates of
populated places in Sri Lanka from the [GeoNames](https://www.geonames.org)
geographical database, licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

- Source file: <https://download.geonames.org/export/dump/LK.zip>, downloaded 2026-10-07.
- Kept: feature class P (populated places), 17,837 rows. Left out: 18 places
  marked abandoned (feature code PPLQ) and one entry that is a private house.
- Columns used: geonameid, name, latitude, longitude, population.
