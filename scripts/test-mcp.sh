#!/usr/bin/env bash
# Smoke test for the office connector (Edge Function office-mcp).
#
#   1. a wrong key (and a missing key) must answer 404
#   2. list the tools
#   3. call fleet_overview, live_drivers and list_vehicles
#   4. read-odometer refuses calls without a sign-in; mileage_summary lists odometer checks
#
# Usage:
#   export OFFICE_MCP_KEY='...'      # the same value that was set with: supabase secrets set
#   scripts/test-mcp.sh
#
# It talks to the real project by default. For a local stack (supabase start +
# supabase functions serve):
#   OFFICE_MCP_URL=http://127.0.0.1:54321/functions/v1/office-mcp scripts/test-mcp.sh
#
# The key is never printed. These three tools only read; each call still adds
# one row to office_audit.

set -euo pipefail

BASE="${OFFICE_MCP_URL:-https://hinurfsaxvplbyqgtozj.supabase.co/functions/v1/office-mcp}"
BASE="${BASE%/}"

if [ -z "${OFFICE_MCP_KEY:-}" ]; then
  echo "OFFICE_MCP_KEY is not set. Run: export OFFICE_MCP_KEY='...'" >&2
  exit 2
fi
for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "$tool is needed to run this script." >&2; exit 2; }
done

failures=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; failures=$((failures + 1)); }

# POST one JSON-RPC message; prints the HTTP status of the answer.
status_of() { # status_of <url>
  curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$1" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
}

# Calls an MCP method with the real key; prints the JSON-RPC answer.
# The server may answer as plain JSON or as an event stream ("data: {...}").
rpc() { # rpc <method> <params as JSON>
  local body
  body=$(jq -cn --arg method "$1" --argjson params "$2" '{jsonrpc: "2.0", id: 1, method: $method, params: $params}')
  curl -sS --max-time 60 -X POST "$BASE/$OFFICE_MCP_KEY/mcp" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H 'MCP-Protocol-Version: 2025-06-18' \
    --data "$body" |
    tr -d '\r' |
    awk '/^data: /{ sub(/^data: /, ""); print; next } /^[{[]/{ print }' |
    tail -n 1
}

# Calls a tool; prints the tool's own JSON result, or fails with its error text.
call_tool() { # call_tool <name> <arguments as JSON>
  local answer
  answer=$(rpc tools/call "$(jq -cn --arg name "$1" --argjson args "$2" '{name: $name, arguments: $args}')")
  if [ -z "$answer" ] || ! jq -e '.result.content[0].text' >/dev/null 2>&1 <<<"$answer"; then
    echo "no usable answer: $(jq -c '.error // .' 2>/dev/null <<<"$answer" || echo "$answer")" >&2
    return 1
  fi
  if jq -e '.result.isError == true' >/dev/null <<<"$answer"; then
    echo "tool error: $(jq -r '.result.content[0].text' <<<"$answer")" >&2
    return 1
  fi
  jq -r '.result.content[0].text' <<<"$answer"
}

echo "Connector: $BASE/<key>/mcp"
echo

echo "1. Keys"
code=$(status_of "$BASE/this-is-not-the-key-$(date +%s)/mcp")
[ "$code" = "404" ] && pass "wrong key answers 404" || fail "wrong key answered $code, expected 404"
code=$(status_of "$BASE/mcp")
[ "$code" = "404" ] && pass "missing key answers 404" || fail "missing key answered $code, expected 404"
code=$(status_of "$BASE/$OFFICE_MCP_KEY/mcp")
[ "$code" = "200" ] && pass "the real key answers 200" || fail "the real key answered $code, expected 200"
echo

echo "2. Tools"
hello=$(rpc initialize '{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test-mcp.sh","version":"1"}}')
if jq -e '.result.serverInfo.name' >/dev/null 2>&1 <<<"$hello"; then
  pass "server: $(jq -r '.result.serverInfo | "\(.name) \(.version)"' <<<"$hello"), protocol $(jq -r '.result.protocolVersion' <<<"$hello")"
else
  fail "initialize gave no server info"
fi
tools=$(rpc tools/list '{}')
count=$(jq -r '.result.tools | length' 2>/dev/null <<<"$tools" || echo 0)
if [ "${count:-0}" -gt 0 ]; then
  pass "$count tools listed"
  jq -r '.result.tools[] | "        \(.name)\(if .annotations.readOnlyHint then "" else "  (writes)" end)"' <<<"$tools"
else
  fail "no tools listed"
fi
echo

echo "3. Calls"
if out=$(call_tool fleet_overview '{}'); then
  pass "fleet_overview: $(jq -r '"\(.date): \(.vehicles.on_the_road)/\(.vehicles.total) vehicles on the road, \(.tasks.total) tasks (\(.tasks.in_progress) in progress, \(.tasks.done) done), \(.requests.waiting) requests waiting, \(.reminders.count) reminders"' <<<"$out")"
else
  fail "fleet_overview"
fi
if out=$(call_tool live_drivers '{}'); then
  pass "live_drivers: $(jq -r '"\(.counts.all) drivers (\(.counts.sharing) sharing, \(.counts.stale) stale, \(.counts.not_sharing) not sharing) as of \(.as_of)"' <<<"$out")"
else
  fail "live_drivers"
fi
if out=$(call_tool list_vehicles '{}'); then
  pass "list_vehicles: $(jq -r '"\(.counts.all) vehicles (\(.counts.on_task) on a task, \(.counts.available) available, \(.counts.in_garage) in garage, \(.counts.documents_expiring) with documents expiring)"' <<<"$out")"
  jq -r '.vehicles[] | "        \(.reg_no)  \(.status)  \(.km_this_month) km this month"' <<<"$out"
else
  fail "list_vehicles"
fi
echo

echo "4. Odometer"
FN_BASE="${BASE%/office-mcp}"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$FN_BASE/read-odometer" \
  -H 'Content-Type: application/json' --data '{"path":"x"}')
[ "$code" = "401" ] && pass "read-odometer without a sign-in answers 401" || fail "read-odometer without a sign-in answered $code, expected 401"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -X POST "$FN_BASE/read-odometer" \
  -H 'Content-Type: application/json' -H 'x-server-key: not-the-key' --data '{"log_id":"x"}')
[ "$code" = "401" ] && pass "read-odometer with a wrong server key answers 401" || fail "read-odometer with a wrong server key answered $code, expected 401"
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$FN_BASE/office-api/me")
[ "$code" = "401" ] && pass "office-api without a sign-in answers 401" || fail "office-api without a sign-in answered $code, expected 401"
if out=$(call_tool mileage_summary '{}'); then
  pass "mileage_summary: $(jq -r '"\(.month): \(.totals.tasks) tasks, \(.totals.task_km) task km, \(.totals.unlogged_km_flags) unlogged flags, \(.totals.check_odometer) odometer checks"' <<<"$out")"
else
  fail "mileage_summary"
fi
echo

if [ "$failures" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$failures check(s) failed."
  exit 1
fi
