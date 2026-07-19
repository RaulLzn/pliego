#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_BINARY="$PROJECT_DIR/src-tauri/target/release/app"

if command -v pliego >/dev/null 2>&1; then
  exec pliego "$@"
fi

if [[ -x "$RELEASE_BINARY" ]]; then
  exec "$RELEASE_BINARY" "$@"
fi

echo "Pliego no está instalado ni compilado. Ejecuta 'npm ci && npm run tauri:dev'." >&2
exit 1
