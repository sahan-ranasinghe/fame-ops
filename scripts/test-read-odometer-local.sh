#!/usr/bin/env bash
# Runs the read-odometer Edge Function on the LOCAL stack over a folder of
# photos and prints the status the app would get for each one. The photos stay
# where they are; nothing is copied into the repository or sent to the real
# project.
#
# Before running it, in other terminals:
#   npx supabase start
#   printf 'GEMINI_API_KEY=%s\nSERVER_KEY=%s\n' '<the Gemini key>' "$(openssl rand -hex 24)" > ~/odo-test/.env   # outside the repo
#   npx supabase functions serve read-odometer --env-file ~/odo-test/.env        # leave it running
#
# Then:
#   scripts/test-read-odometer-local.sh ~/odo-test [--last-km 195049] [--gps-km 12]

set -eo pipefail
cd "$(dirname "$0")/.."

folder="${1:-}"
if [ -z "$folder" ] || [ ! -d "$folder" ]; then
  echo "Usage: scripts/test-read-odometer-local.sh <folder with .jpg photos> [--last-km N] [--gps-km N]" >&2
  exit 2
fi
shift

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null
fi

status=$(npx supabase status -o env 2>/dev/null) || {
  echo "The local stack is not running. Start it with: npx supabase start" >&2
  exit 2
}
value() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}\$/\1/p" <<<"$status"; }
export API_URL=$(value API_URL)
export ANON_KEY=$(value ANON_KEY)
export SERVICE_ROLE_KEY=$(value SERVICE_ROLE_KEY)

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$API_URL/functions/v1/read-odometer" \
  -H 'Content-Type: application/json' --data '{"path":"x"}' || true)
if [ "$code" != "401" ]; then
  echo "read-odometer is not being served locally (got HTTP ${code:-none}). Run: npx supabase functions serve read-odometer --env-file <file>" >&2
  exit 2
fi

python3 -I scripts/test-read-odometer-local.py "$folder" "$@"
