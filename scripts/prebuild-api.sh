#!/bin/bash
# Stages the API with production dependencies for Electron packaging.
#
# npm workspaces hoist all deps to root/node_modules, leaving api/node_modules
# empty. This script creates desktop/.api-bundle/ with the API source + a full
# standalone node_modules, then rebuilds better-sqlite3 for Electron's Node ABI.
#
# This staging dir is what electron-builder bundles as extraResources.
# The real api/node_modules is never touched, so dev mode stays clean.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$REPO_ROOT/api"
BUNDLE_DIR="$REPO_ROOT/desktop/.api-bundle"
TEMP_DIR=$(mktemp -d)

echo "==> Staging API for Electron packaging..."

# 1. Clean previous bundle
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# 2. Checkpoint WAL so all data is in the main .db file before copying
if command -v sqlite3 &>/dev/null && [ -f "$API_DIR/data/watchflix.db" ]; then
  echo "==> Checkpointing SQLite WAL..."
  sqlite3 "$API_DIR/data/watchflix.db" "PRAGMA wal_checkpoint(TRUNCATE);"
fi

# 3. Copy API source (exclude tests, env files, and node_modules)
#    Uses cp + rm instead of rsync for portability (Windows CI has no rsync)
cp -r "$API_DIR/." "$BUNDLE_DIR/"
rm -rf "$BUNDLE_DIR/node_modules" "$BUNDLE_DIR/tests"
rm -f "$BUNDLE_DIR"/.env*

# 4. Install production deps in isolation (outside the workspace tree)
cp "$API_DIR/package.json" "$TEMP_DIR/"
cd "$TEMP_DIR"
npm install --production 2>&1 | tail -3

# 5. Move node_modules into the bundle
mv "$TEMP_DIR/node_modules" "$BUNDLE_DIR/node_modules"
rm -rf "$TEMP_DIR"

PKG_COUNT=$(ls "$BUNDLE_DIR/node_modules" | wc -l | tr -d ' ')
echo "==> Staged $PKG_COUNT packages in .api-bundle/node_modules"

# 6. Rebuild better-sqlite3 native module for Electron's Node ABI
echo "==> Rebuilding better-sqlite3 for Electron..."
cd "$REPO_ROOT/desktop"
npx @electron/rebuild --module-dir "$BUNDLE_DIR" --types prod --only better-sqlite3 2>&1 | tail -5

echo "==> API staging complete: $BUNDLE_DIR"
