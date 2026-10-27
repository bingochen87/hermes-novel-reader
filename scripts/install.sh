#!/usr/bin/env bash
# Install the novel reader into the running Hermes desktop app.
#
#   bash scripts/install.sh              # copy into $HERMES_HOME/desktop-plugins
#   bash scripts/install.sh --link       # symlink instead (dev: edit src, rebuild, reload)
#
# The desktop app watches that folder and hot-reloads, so no restart is needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${HERMES_HOME:-$HOME/.hermes}"
TARGET="$HOME_DIR/desktop-plugins/novel-reader"
SOURCE="$ROOT/desktop/plugin.js"

if [[ ! -f "$SOURCE" ]]; then
  echo "install: $SOURCE is missing — run 'npm run build' first" >&2
  exit 1
fi

mkdir -p "$TARGET"

if [[ "${1:-}" == "--link" ]]; then
  rm -f "$TARGET/plugin.js"
  ln -s "$SOURCE" "$TARGET/plugin.js"
  echo "install: linked $TARGET/plugin.js -> $SOURCE"
else
  cp "$SOURCE" "$TARGET/plugin.js"
  echo "install: copied $TARGET/plugin.js"
fi

echo "install: done. If the pane does not appear, run ⌘K → Reload desktop plugins."
