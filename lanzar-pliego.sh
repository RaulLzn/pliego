#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTABLE_DIR="$APP_DIR/src-tauri/target/release/bundle/appimage/Pliego.AppDir"
BINARIO="$APP_DIR/artifacts/Pliego"

if [[ -x "$PORTABLE_DIR/AppRun" ]]; then
  exec "$PORTABLE_DIR/AppRun"
fi

exec "$BINARIO"
