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
# The laptop's Node comes from nvm (.nvmrc); on CI setup-node has put that version first already (nvm there has none).
if [ "$(node --version 2>/dev/null)" != "$(cat ../../.nvmrc)" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  source ~/.nvm/nvm.sh && nvm use >/dev/null
fi

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
# Part B: a design page (sample data, the e2e build only) never goes up.
if grep -rq "design-driver-task" dist/m; then echo "STOP: a design page is in the mobile build"; exit 1; fi

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
  NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler pages deploy --branch main 2>&1 | tee /tmp/fleet-pages-deploy.$$
  # The new deployment's own address (wrangler prints it): the alias may still serve the old one for a moment.
  site=$(grep -oE 'https://[a-z0-9]+\.fame-fleet\.pages\.dev' /tmp/fleet-pages-deploy.$$ | tail -1 || true)
  rm -f /tmp/fleet-pages-deploy.$$
  site="${site:-https://fame-fleet.pages.dev}"
  echo "== 6. The live /m/ files on $site: 200, their own type, no redirect (21 October 2026: the fonts were left out by"
  echo "   the upload and the offline page was redirected)"
  bad=0
  check() { # path, the start of the content type it must have; up to 3 tries over 30 s
    local got="" i
    for i in 1 2 3; do
      got=$(curl -s -o /dev/null --max-redirs 0 --max-time 20 -w '%{http_code} %{content_type}' "$site$1" || true)
      [[ "$got" == 200\ $2* ]] && break
      sleep 10
    done
    if [[ "$got" == 200\ $2* ]]; then echo "   ok   $1  ($got)"; else echo "   BAD  $1  (${got:-no answer})"; bad=1; fi
  }
  check /m/ text/html
  check /m/office/approve text/html
  check /m/offline text/html
  check /m/sw.js application/javascript
  check /m/manifest.webmanifest application/manifest+json
  # Pages sends font/<kind> for font files (font/woff2 for the desktop site's): any font/ type.
  for f in $(cd dist && find m/assets -name '*.ttf' | sort); do check "/$f" font/; done
  [ "$bad" = 0 ] || { echo "STOP: a /m/ file is not served as itself (above)"; exit 1; }
else
  echo "Built and checked; not uploaded (run with --deploy after the go)."
fi
