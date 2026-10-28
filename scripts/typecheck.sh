#!/usr/bin/env bash
# The typecheck, the same on the laptop and on CI (office-suite.yml's "Typechecks" step runs this file): the website,
# then the driver app's two projects (the app and its scripts; `npx tsc --noEmit` alone misses the scripts). Sahan,
# 28 October 2026, after CI run 40645570848 failed on a script the laptop had not type-checked.
set -eo pipefail
cd "$(dirname "$0")/.."
if [ "$(node --version 2>/dev/null)" != "$(cat .nvmrc)" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh" && nvm use >/dev/null
fi
(cd apps/office && npm run typecheck)
(cd apps/driver && npm run typecheck)
