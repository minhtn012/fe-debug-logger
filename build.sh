#!/bin/bash
# Package the Chrome Web Store uploads from one source tree:
#   fe-debug-logger-v<ver>.zip  full build (popup, hotkeys, Record, Annotate, feedback)
#   fe-feedback-v<ver>.zip      feedback only (no popup, no hotkeys; the icon toggles the site)

set -e
cd "$(dirname "$0")"

VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')

# Shared by both builds; popup.* is added to the full build only.
COMMON_FILES=(
  background.js
  freeze-shot.js
  content-script.js
  content-script-main.js
  offscreen.html
  offscreen.js
  review.html
  review.css
  review.js
  review-render.js
  review-export.js
  capture/
  feedback/
  formatter/
  lib/
  icons/icon-16.png
  icons/icon-32.png
  icons/icon-48.png
  icons/icon-128.png
  LICENSE
)
POPUP_FILES=(popup.html popup.css popup.js)

STAGE=""
trap '[ -n "$STAGE" ] && rm -rf "$STAGE"' EXIT

# build_target <zip name> <manifest file> <include popup: yes|no>
# Files are staged in a temp dir so the chosen manifest lands as manifest.json.
build_target() {
  local zip_name="$1" manifest="$2" include_popup="$3"
  local files=("${COMMON_FILES[@]}")
  [ "$include_popup" = yes ] && files+=("${POPUP_FILES[@]}")

  STAGE=$(mktemp -d)
  rsync -aR --exclude '.DS_Store' "${files[@]}" "$STAGE/"
  cp "$manifest" "$STAGE/manifest.json"

  rm -f "$zip_name"
  (cd "$STAGE" && zip -qr "$OLDPWD/$zip_name" . -x "*.DS_Store")
  rm -rf "$STAGE"
  STAGE=""
  echo "Built: $zip_name ($(du -h "$zip_name" | cut -f1))"
}

build_target "fe-debug-logger-v${VERSION}.zip" manifest.json yes
build_target "fe-feedback-v${VERSION}.zip" manifest.feedback.json no
