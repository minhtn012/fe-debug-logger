#!/bin/bash
# Package FE Debug Logger for Chrome Web Store upload

set -e

VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')
ZIP_NAME="fe-debug-logger-v${VERSION}.zip"

# Remove old build if exists
rm -f "$ZIP_NAME"

zip -r "$ZIP_NAME" \
  manifest.json \
  background.js \
  content-script.js \
  content-script-main.js \
  offscreen.html \
  offscreen.js \
  popup.html \
  popup.css \
  popup.js \
  websocket-client.js \
  capture/ \
  formatter/ \
  lib/ \
  icons/icon-16.png \
  icons/icon-48.png \
  icons/icon-128.png \
  LICENSE \
  -x "*.DS_Store"

echo "Built: $ZIP_NAME ($(du -h "$ZIP_NAME" | cut -f1))"
