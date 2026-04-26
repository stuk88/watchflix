#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$REPO_ROOT/api"
MOBILE_DIR="$REPO_ROOT/mobile"
BUNDLE_DIR="$MOBILE_DIR/nodejs"

echo "==> Bundling API for mobile (capacitor-nodejs)..."

# Keep the entry point, remove old bundle
rm -rf "$BUNDLE_DIR/api-bundle"
mkdir -p "$BUNDLE_DIR/api-bundle"

# Copy API source (skip node_modules, tests, env, data, native-only files)
cp -r "$API_DIR/src" "$BUNDLE_DIR/api-bundle/src"
cp "$API_DIR/package.json" "$BUNDLE_DIR/api-bundle/"

# Remove desktop-only files that won't work on mobile
rm -f "$BUNDLE_DIR/api-bundle/src/services/review-scraper.js"  # Playwright-based
rm -f "$BUNDLE_DIR/api-bundle/src/services/stream-extractor.js"  # Playwright-based
rm -f "$BUNDLE_DIR/api-bundle/src/services/hdrezka-extractor.js"  # Playwright-based
rm -f "$BUNDLE_DIR/api-bundle/src/services/seazonvar-extractor.js"  # Playwright-based
rm -f "$BUNDLE_DIR/api-bundle/src/services/filmix-extractor.js"  # Playwright-based
rm -f "$BUNDLE_DIR/api-bundle/src/debug-embed.js"
rm -f "$BUNDLE_DIR/api-bundle/src/backfill-country.js"
rm -f "$BUNDLE_DIR/api-bundle/src/extract-streams.js"
rm -f "$BUNDLE_DIR/api-bundle/src/clean-no-peers.js"
rm -f "$BUNDLE_DIR/api-bundle/src/scrape-deep.js"
rm -rf "$BUNDLE_DIR/api-bundle/src/scrapers"
rm -f "$BUNDLE_DIR/api-bundle/src/routes/sources.js"
rm -f "$BUNDLE_DIR/api-bundle/src/routes/russian-search.js"
rm -f "$BUNDLE_DIR/api-bundle/src/index.js"
rm -f "$BUNDLE_DIR/api-bundle/src/services/scheduler.js"

# Copy pre-populated database
echo "==> Copying pre-populated database..."
mkdir -p "$BUNDLE_DIR/api-bundle/data"
if [ -f "$API_DIR/data/watchflix.db" ]; then
  # Checkpoint WAL first
  if command -v sqlite3 &>/dev/null; then
    sqlite3 "$API_DIR/data/watchflix.db" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
  fi
  cp "$API_DIR/data/watchflix.db" "$BUNDLE_DIR/api-bundle/data/watchflix.db"
  echo "==> Database copied ($(du -h "$BUNDLE_DIR/api-bundle/data/watchflix.db" | cut -f1))"
else
  echo "==> WARNING: No database found at $API_DIR/data/watchflix.db"
fi

# Install mobile-compatible dependencies only
echo "==> Installing mobile dependencies..."
TEMP_DIR=$(mktemp -d)
cat > "$TEMP_DIR/package.json" << 'PKGJSON'
{
  "name": "watchflix-mobile-api-deps",
  "private": true,
  "type": "module",
  "dependencies": {
    "express": "^4.21.1",
    "cors": "^2.8.5",
    "axios": "^1.7.9",
    "cheerio": "^1.0.0",
    "sql.js": "^1.12.0",
    "webtorrent": "^2.8.5",
    "iconv-lite": "^0.7.2",
    "jschardet": "^3.1.4",
    "adm-zip": "^0.5.17",
    "node-cron": "^3.0.3"
  }
}
PKGJSON

cd "$TEMP_DIR"
npm install --production 2>&1 | tail -3
rm -rf "$BUNDLE_DIR/node_modules"
mv "$TEMP_DIR/node_modules" "$BUNDLE_DIR/node_modules"
rm -rf "$TEMP_DIR"

PKG_COUNT=$(ls "$BUNDLE_DIR/node_modules" | wc -l | tr -d ' ')
echo "==> Bundled $PKG_COUNT packages in nodejs/node_modules"

# Copy nodejs/ into the built UI dist so capacitor-nodejs can find it
UI_DIST="$REPO_ROOT/ui/dist"
if [ -d "$UI_DIST" ]; then
  echo "==> Copying nodejs bundle into ui/dist/nodejs/..."
  rm -rf "$UI_DIST/nodejs"
  cp -r "$BUNDLE_DIR" "$UI_DIST/nodejs"
  echo "==> Mobile API bundle complete ($(du -sh "$UI_DIST/nodejs" | cut -f1) in ui/dist/nodejs/)"
else
  echo "==> WARNING: ui/dist not found. Run 'npm run build -w ui' first."
  echo "==> Mobile API bundle complete"
fi
