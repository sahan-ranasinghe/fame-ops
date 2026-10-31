#!/usr/bin/env bash
# Checks the office web app (apps/office) against the LOCAL Supabase stack.
# It never touches the real project.
#
#   - typecheck, unit tests (Vitest), both builds (web, artifact)
#   Note: the local edge runtime (config.toml policy per_worker) retires a worker when its CPU
#   budget is used up and drops the responses still in flight; the web app retries a dropped
#   list load by itself, so one such drop does not fail the e2e.
#   - the end-to-end test (Playwright): set-password link → Overview →
#     assign a task → cancel it → the live map with a Realtime position →
#     2-step on in Settings → sign out → sign in with the code
#
# The local stack must include Realtime (plain `npx supabase start`; not `-x realtime`).
# The test runs its own dev server on port 5174, so `npm run dev:live` may keep port 5173.
#
# Before running it, in another terminal (same as scripts/test-mcp-local.sh):
#   npx supabase start
#   printf 'OFFICE_MCP_KEY=%s\n' "$(openssl rand -hex 32)" > /tmp/office-mcp.env   # a throwaway local key
#   npx supabase functions serve --env-file /tmp/office-mcp.env
#
# Then:
#   scripts/test-office-local.sh /tmp/office-mcp.env
#
# Only some tests (a fix that touches only tests, docs/ci.md): E2E_SPECS="e2e/bin.spec.ts e2e/mobile.spec.ts" and/or
# E2E_GREP="a title". The typecheck, the unit tests and the builds are left out, and the mobile website's build too unless a
# named spec needs it. Used by CI's scope specs and for a failed spec on the laptop.
#
# The browser: Playwright's own Chromium if it was installed
# (npx playwright install chromium, about 170 MB), else the Ubuntu snap
# Chromium through PW_CHROMIUM=/snap/bin/chromium (the default here).

set -eo pipefail
cd "$(dirname "$0")/.."

env_file="${1:-}"
if [ -z "$env_file" ] || [ ! -r "$env_file" ]; then
  echo "Usage: scripts/test-office-local.sh <the env file 'functions serve' was started with>" >&2
  exit 2
fi
# The laptop's Node comes from nvm (.nvmrc); on CI setup-node has put that version first already (nvm there has none).
if [ "$(node --version 2>/dev/null)" != "$(cat .nvmrc)" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null
fi

status=$(npx supabase status -o env 2>/dev/null) || { echo "The local stack is not running. Start it with: npx supabase start" >&2; exit 2; }
value() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" <<<"$status"; }
API_URL=$(value API_URL)
ANON_KEY=$(value ANON_KEY)
set -a
. "$env_file"
set +a
[ -n "$API_URL" ] && [ -n "$ANON_KEY" ] && [ -n "${OFFICE_MCP_KEY:-}" ] || { echo "Could not read API_URL / ANON_KEY from 'supabase status', or OFFICE_MCP_KEY from $env_file." >&2; exit 2; }
curl -sf -o /dev/null --max-time 10 "$API_URL/functions/v1/office-api/me" -w '' || true
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_URL/functions/v1/office-api/me")
[ "$code" = "401" ] || { echo "office-api is not being served locally (got $code). Run: npx supabase functions serve --env-file $env_file" >&2; exit 2; }

cd apps/office
[ -d node_modules ] || npm install --no-audit --no-fund
# The web app reads the local stack from .env.local (gitignored).
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' "$API_URL" "$ANON_KEY" > .env.local
chmod 600 .env.local

only="${E2E_SPECS:-}${E2E_GREP:-}"
if [ -z "$only" ]; then
  echo "1. Typecheck"
  ./node_modules/.bin/tsc -p tsconfig.json --noEmit
  echo "2. Unit tests"
  ./node_modules/.bin/vitest run
  echo "3. Builds"
  ./node_modules/.bin/vite build >/dev/null
  ./node_modules/.bin/vite build --mode artifact >/dev/null
  ls -la dist-artifact/index.html | awk '{print "   artifact: " $5 " bytes"}'
else
  echo "Only: ${E2E_SPECS:-all spec files} ${E2E_GREP:+(titles matching: $E2E_GREP)}"
fi
# The mobile website (O4): Office mode for the browser, built from the driver app against the local stack and served by the
# e2e's dev server under /m/ (FLEET_MOBILE_DIR). --clear: the EXPO_PUBLIC values are built in, a cached bundle keeps old ones.
# Named specs with none on /m/ skip this build (a few minutes). A title alone (E2E_GREP) may be in any spec: built.
if [ -z "${E2E_SPECS:-}" ] || [[ "$E2E_SPECS" =~ mobile|contrast|mockups ]]; then
  echo "   mobile website (local build)"
  (cd ../driver && [ -d node_modules ] || npm install --no-audit --no-fund) >/dev/null
  (cd ../driver && FLEET_DESIGN=1 node scripts/make-web-routes.mjs >/dev/null && EXPO_PUBLIC_SUPABASE_URL="$API_URL" EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
    FLEET_WEB=1 EXPO_NO_WEB_SETUP=1 npx expo export --platform web --output-dir dist-web-local --clear >/dev/null && node scripts/web-vendor-assets.mjs dist-web-local >/dev/null)
  export FLEET_MOBILE_DIR="$(cd ../driver && pwd)/dist-web-local"
fi
echo "4. End to end (Playwright)"
export OFFICE_MCP_URL="$API_URL/functions/v1/office-mcp" OFFICE_MCP_KEY API_URL ANON_KEY
# Realtime must be streaming changes before the live step: a database reset (the connector
# suite, pgTAP) restarts the Realtime container, and its change stream takes about half a
# minute more to come up, during which subscriptions succeed but nothing is delivered.
SERVICE_ROLE_KEY=$(value SERVICE_ROLE_KEY)
export SERVICE_ROLE_KEY
rt_ok=0
for attempt in 1 2 3 4 5 6; do
  if node e2e/realtime-check.mjs >/tmp/realtime-check.$$ 2>&1; then rt_ok=1; break; fi
  echo "   Realtime not delivering yet (attempt $attempt), waiting 15 s..."
  sleep 15
done
[ "$rt_ok" = 1 ] || { cat /tmp/realtime-check.$$; rm -f /tmp/realtime-check.$$; echo "Realtime is not delivering driver_latest changes. Restart the stack (npx supabase stop && npx supabase start ...) and run again." >&2; exit 1; }
rm -f /tmp/realtime-check.$$
echo "   Realtime delivers changes."
if [ -z "${PW_CHROMIUM:-}" ] && [ ! -d "$HOME/.cache/ms-playwright" ] && [ -x /snap/bin/chromium ]; then
  export PW_CHROMIUM=/snap/bin/chromium
  export TMPDIR="$HOME/snap/chromium/common/pw-tmp"   # snap Chromium can only write inside its own folder
  mkdir -p "$TMPDIR"
fi
# E2E_SPECS is split on spaces on purpose: each word is one spec file.
# shellcheck disable=SC2086
./node_modules/.bin/playwright test ${E2E_SPECS:-} ${E2E_GREP:+--grep "$E2E_GREP"}
[ -n "$only" ] && echo "The named tests passed (not the whole suite)." || echo "All office checks passed."
