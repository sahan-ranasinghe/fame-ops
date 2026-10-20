#!/bin/bash
# The office site on Cloudflare Pages (project fame-fleet) with the mobile website under /m/ (Phase 8, O4;
# docs/mobile-website.md). One step builds both and checks them; the upload happens only with --deploy, after Sahan's go.
#
#   scripts/deploy-pages.sh            build both into dist/ (dist/m/ = the mobile website) and scan them
#   scripts/deploy-pages.sh --deploy   the same, then `wrangler pages deploy --branch main`
#
# The desktop build reads .env.production.local; the mobile build apps/driver/.env (the URL and the publishable key only).
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.nvm/nvm.sh && nvm use >/dev/null

echo "== 1. The desktop site"
rm -rf dist
npm run -s build:web

echo "== 2. The mobile website (Office mode for the browser)"
(cd ../driver && rm -rf dist-web && npm run -s web:export)
mkdir -p dist/m
cp -R ../driver/dist-web/. dist/m/
# The Supabase address is built into the mobile bundle (EXPO_PUBLIC_*; web:export clears Metro's cache so a local e2e
# build's 127.0.0.1 cannot stay in it): the real project's address, never this laptop's.
if grep -rqE "127\.0\.0\.1:54321|localhost:54321" dist/m; then echo "STOP: the mobile build points at the local stack"; exit 1; fi
if ! grep -rq "hinurfsaxvplbyqgtozj.supabase.co" dist/m; then echo "STOP: the mobile build does not point at the real project"; exit 1; fi

echo "== 3. The routes: a /m/ page reloads on the mobile website, any other page on the desktop site"
# Only the mobile site's own pages (its files under /m/_expo and /m/assets are served as they are). The target is /m/, not
# /m/index.html: Pages answers /m/index.html with a 308 to /m/, and a rewrite to it fell through to the desktop page.
{ printf '/m/login  /m/  200\n/m/office  /m/  200\n/m/office/*  /m/  200\n'; cat public/_redirects; } > dist/_redirects
cat dist/_redirects

echo "== 4. No source map and no key or secret in what goes up"
maps=$(find dist -name '*.map' | wc -l)
if [ "$maps" -ne 0 ]; then echo "STOP: $maps source map(s) in dist"; exit 1; fi
if grep -rlE "sb_secret_[A-Za-z0-9_-]{20,}|service_role|OFFICE_MCP_KEY=|SERVER_KEY=|AIza[0-9A-Za-z_-]{30,}" dist; then
  echo "STOP: the scan found the files above; nothing uploaded"
  exit 1
fi
echo "scan: nothing found"

if [ "${1:-}" = "--deploy" ]; then
  echo "== 5. Upload"
  NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler pages deploy --branch main
else
  echo "Built and checked; not uploaded (run with --deploy after the go)."
fi
