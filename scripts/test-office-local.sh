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
if [ -s "$HOME/.nvm/nvm.sh" ]; then
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

echo "1. Typecheck"
./node_modules/.bin/tsc -p tsconfig.json --noEmit
echo "2. Unit tests"
./node_modules/.bin/vitest run
echo "3. Builds"
./node_modules/.bin/vite build >/dev/null
./node_modules/.bin/vite build --mode artifact >/dev/null
ls -la dist-artifact/index.html | awk '{print "   artifact: " $5 " bytes"}'
echo "4. End to end (Playwright)"
export OFFICE_MCP_URL="$API_URL/functions/v1/office-mcp" OFFICE_MCP_KEY API_URL ANON_KEY
if [ -z "${PW_CHROMIUM:-}" ] && [ ! -d "$HOME/.cache/ms-playwright" ] && [ -x /snap/bin/chromium ]; then
  export PW_CHROMIUM=/snap/bin/chromium
  export TMPDIR="$HOME/snap/chromium/common/pw-tmp"   # snap Chromium can only write inside its own folder
  mkdir -p "$TMPDIR"
fi
./node_modules/.bin/playwright test
echo "All office checks passed."
