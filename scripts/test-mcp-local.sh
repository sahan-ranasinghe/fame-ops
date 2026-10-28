#!/usr/bin/env bash
# Full test of the office connector on the LOCAL Supabase stack. It never
# touches the real project.
#
# It resets the local database, then runs
#   - scripts/test-mcp-local.py   every tool, plus the driver's side, end to end,
#                                 once through office-mcp and once through office-api
#   - scripts/snapshot-tool-shapes.py --check   the tool answers keep the shapes the artifact reads
#   - scripts/test-mcp.sh         the smoke test, pointed at the local functions
#
# Before running it, in another terminal:
#   npx supabase start
#   printf 'OFFICE_MCP_KEY=%s\nSERVER_KEY=%s\nFLEET_RATE_SCALE=50\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > /tmp/office-mcp.env
#   (throwaway local keys; FLEET_RATE_SCALE lifts the per-minute limits of Round 48 for the suite's hundreds of calls a minute)
#   npx supabase functions serve --env-file /tmp/office-mcp.env                   # all functions; leave it running
#
# Then:
#   scripts/test-mcp-local.sh /tmp/office-mcp.env
#   SHAPES=write scripts/test-mcp-local.sh /tmp/office-mcp.env   # after adding fields to a tool's answer: rewrite the contract

set -eo pipefail
cd "$(dirname "$0")/.."

env_file="${1:-}"
if [ -z "$env_file" ] || [ ! -r "$env_file" ]; then
  echo "Usage: scripts/test-mcp-local.sh <the env file 'functions serve' was started with>" >&2
  exit 2
fi

# The clock (Round 4–7): the suite checks live things against the real clocks of Postgres and the functions (a route of the
# last ~95 minutes, a point under 3 minutes old, "today"), which cannot be shifted without faketime in the containers. So
# it starts only in the window where a ~95-minute run cannot cross midnight in Colombo (01:40–21:15), and says when it can
# instead of failing half-way. FLEET_SUITE_ANY_TIME=1 runs it anyway.
hhmm=$(TZ=Asia/Colombo date +%H%M)
if [ "${FLEET_SUITE_ANY_TIME:-}" != "1" ] && { [ "$((10#$hhmm))" -ge 2115 ] || [ "$((10#$hhmm))" -lt 140 ]; }; then
  echo "It is $(TZ=Asia/Colombo date +%H:%M) in Colombo: the connector suite would cross midnight and its 'today' and route checks" >&2
  echo "would fail. Run it between 01:40 and 21:15 Colombo (or FLEET_SUITE_ANY_TIME=1 to run it anyway)." >&2
  exit 3
fi

# This repo's Node version (the Supabase CLI runs through npx).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null
fi

status=$(npx supabase status -o env 2>/dev/null) || {
  echo "The local stack is not running. Start it with: npx supabase start" >&2
  exit 2
}
value() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" <<<"$status"; }
API_URL=$(value API_URL)
ANON_KEY=$(value ANON_KEY)
set -a
. "$env_file"
set +a
if [ -z "$API_URL" ] || [ -z "$ANON_KEY" ] || [ -z "${OFFICE_MCP_KEY:-}" ]; then
  echo "Could not read API_URL / ANON_KEY from 'supabase status', or OFFICE_MCP_KEY from $env_file." >&2
  exit 2
fi
SERVICE_ROLE_KEY=$(value SERVICE_ROLE_KEY)
export API_URL ANON_KEY OFFICE_MCP_KEY SERVICE_ROLE_KEY

reset_db() {
  echo "Resetting the LOCAL database ($API_URL)..."
  npx supabase db reset --local >/dev/null 2>&1 || { echo "supabase db reset --local failed." >&2; exit 1; }
}
reset_db

# Wait until the services are back after the reset.
ready() { curl -sf -o /dev/null --retry 40 --retry-delay 2 --retry-all-errors --max-time 150 "$@"; }
ready "$API_URL/auth/v1/health" -H "apikey: $ANON_KEY"
ready "$API_URL/rest/v1/" -H "apikey: $ANON_KEY"
# PostgREST reloads its schema cache a moment after the reset: wait until a new column is known.
ready "$API_URL/rest/v1/employees?select=email&limit=1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
ready -X POST "$API_URL/functions/v1/office-mcp/$OFFICE_MCP_KEY/mcp" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"ping"}' || {
  echo "The function does not answer with this key. Is this running?" >&2
  echo "  npx supabase functions serve office-mcp --env-file $env_file" >&2
  exit 2
}

echo "== Channel 1: the connector (office-mcp, shared key) =="
CHANNEL=mcp python3 scripts/test-mcp-local.py
echo
echo "== The tool answers still have the shapes the artifact reads (scripts/tool-shapes.json) =="
# SHAPES=write records a deliberate, additive change of the answers (new fields) instead of checking.
python3 -I scripts/snapshot-tool-shapes.py "--${SHAPES:-check}" | grep -v "^  PASS.*as recorded$" | tail -40
echo
reset_db
ready "$API_URL/auth/v1/health" -H "apikey: $ANON_KEY"
ready "$API_URL/rest/v1/" -H "apikey: $ANON_KEY"
ready "$API_URL/rest/v1/employees?select=email&limit=1" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
echo "== Channel 2: the web app's API (office-api, signed-in admin; 2-step optional) =="
CHANNEL=api python3 scripts/test-mcp-local.py
echo
OFFICE_MCP_URL="$API_URL/functions/v1/office-mcp" scripts/test-mcp.sh
