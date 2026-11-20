#!/usr/bin/env bash
# Build the Rosca app (web-app/, deployed as app.rosca.exprmnts.fun): bundle the TypeScript, the faucet
# function, and copy the styles and fonts it shares with the site (web/). Run before every app deploy.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild web-src/app/main.ts --bundle --platform=browser --format=esm --target=es2022 --minify \
  --define:global=globalThis --outfile=web-app/js/app.js --log-level=warning
npx esbuild web-src/api/faucet.ts --bundle --platform=node --format=esm --target=node20 --outfile=web-app/api/faucet.mjs \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" --log-level=warning
cp web/css/base.css web/css/glass.css web/css/wallet.css web/css/ring.css web-app/css/
mkdir -p web-app/fonts && cp web/fonts/* web-app/fonts/
cp web/favicon.svg web-app/
echo "built web-app/ ($(du -h web-app/js/app.js | cut -f1) app bundle)"
