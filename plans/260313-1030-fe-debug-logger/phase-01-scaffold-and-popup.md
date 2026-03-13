# Phase 1: Extension Scaffold + Popup UI

## Context
- [Brainstorm report](../reports/brainstorm-260313-1030-fe-debug-logger.md)
- [Chrome Extension Manifest V3 docs](https://developer.chrome.com/docs/extensions/mv3/)

## Overview
- **Priority:** P1 — Foundation for all other phases
- **Status:** completed
- **Effort:** 1h

Set up Manifest V3 extension with popup UI (Start/Stop + toggle checkboxes), content script shell, and background service worker with message routing.

## Key Insights
- Manifest V3 uses service workers (not persistent background pages) — state must be stored in `chrome.storage.local` to survive SW termination
- Content script needs `"world": "MAIN"` to access page's JS context (console, fetch, etc.). MV3 supports declaring this directly in `manifest.json`, bypassing strict CSP injections!
- Popup closes when user clicks away — state must live in `chrome.storage`

## Requirements

### Functional
- Popup with Start/Stop recording button (toggle state)
- 4 checkboxes: Console, User Actions, Network, Component State (all checked by default)
- Recording state persisted in `chrome.storage.session`
- Log entries appended and persisted in `chrome.storage.local`
- Background service worker acts as message router and database appender

### Non-functional
- Minimal UI — functional, not pretty
- < 100ms popup open time

## Architecture

### Message Protocol
```javascript
// popup → background
{ type: "START_RECORDING", config: { console: true, userActions: true, network: true, componentState: true } }
{ type: "STOP_RECORDING" }
{ type: "EXPORT_LOG" }
{ type: "GET_STATUS" }

// content (MAIN world) → content (ISOLATED world) → background
// MUST include signature to avoid swallowing generic window.postMessage noise from 3rd party libs
{ __source: "fe-debug-logger", version: 1, type: "LOG_ENTRY", category: "...", data: {...} }

// background → popup
{ type: "STATUS", recording: true/false, entryCount: N }
```

### Dual Content Script Pattern
```
content-script-main.js   (world: MAIN)     → hooks page APIs, posts to window
content-script.js        (world: ISOLATED)  → listens window messages, forwards via chrome.runtime
```

## Files to Create

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest V3 |
| `popup.html` | Popup UI markup |
| `popup.js` | Popup logic (start/stop, toggles, state) |
| `popup.css` | Minimal popup styles |
| `background.js` | Service worker: message routing, log storage |
| `content-script.js` | ISOLATED world bridge script |
| `content-script-main.js` | MAIN world script loader/coordinator |
| `icons/` | Placeholder icons (can use simple colored squares) |

## Implementation Steps

### 1. Create `manifest.json`
```json
{
  "manifest_version": 3,
  "name": "FE Debug Logger",
  "version": "0.1.0",
  "description": "Capture frontend debug logs as structured Markdown",
  "permissions": ["activeTab", "storage", "downloads", "offscreen"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["<all_urls>"],
      "js": [
        "capture/console-capture.js",
        "capture/user-action-capture.js",
        "capture/network-capture.js",
        "capture/component-state-capture.js",
        "content-script-main.js"
      ],
      "world": "MAIN",
      "run_at": "document_start"
    }
  ],
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Note: By defining `"world": "MAIN"`, we bypass the need to inject `<script>` tags, preventing CSP violations out-of-the-box.

### 2. Create `popup.html` + `popup.css`
- Simple layout: title, status indicator, Start/Stop button, 4 checkboxes
- No framework, plain HTML
- Width ~300px

### 3. Create `popup.js`
- On open: query background for current status via `GET_STATUS`
- Start button: send `START_RECORDING` with checkbox config
- Stop button: send `STOP_RECORDING`
- Export button: send `EXPORT_LOG`
- Update UI state based on response

### 4. Create `background.js` (service worker)
- Listen for messages from popup and content scripts
- On `START_RECORDING`: Clear existing `log_*` keys in `chrome.storage.local`
- On `LOG_ENTRY`: Save entry individually using a unique key (e.g., `log_${Date.now()}_${id}`) to `chrome.storage.local` to avoid read-write race conditions.
- On `EXPORT_LOG`: Fetch all keys starting with `log_`, sort them chronologically, and open offscreen document to trigger format and download (Phase 6)
- On `GET_STATUS`: return current recording state + entry count
- Store recording state in `chrome.storage.session`

### 5. Create `content-script.js` (ISOLATED world)
- Listen for `window.postMessage` from MAIN world script
- Filter messages using the secure signature (`__source: "fe-debug-logger"`)
- Forward valid messages to background via `chrome.runtime.sendMessage`

### 6. Create `content-script-main.js` (shell)
- Empty shell for now — capture modules will be added in Phases 2-5
- Set up `window.postMessage` helper function
- Listen for config to know which captures to enable

### 7. Create placeholder icons
- Generate simple 16x16, 48x48, 128x128 PNG icons (solid color square is fine for MVP)

## Todo
- [x] manifest.json with correct permissions and scripts
- [x] popup.html with Start/Stop + 4 checkboxes
- [x] popup.js with message passing to background
- [x] popup.css minimal styles
- [x] background.js service worker with message routing
- [x] content-script.js (ISOLATED bridge)
- [x] content-script-main.js (MAIN world shell)
- [x] Placeholder icons
- [x] Test: extension loads in chrome://extensions
- [x] Test: Start/Stop toggles state correctly
- [x] Test: messages flow popup → background → content script

## Success Criteria
- Extension loads without errors in Chrome
- Popup opens, Start/Stop toggles recording state
- Checkbox states are read and sent with START message
- Content script bridge forwards messages to background
- Background stores entries and reports status

### Risk Assessment
- **Service worker lifecycle**: SW WILL be terminated by Chrome. DO NOT keep log arrays in memory. Append everything directly to `chrome.storage.local`.
- **Message Noise**: Unfiltered `window.postMessage` intercepts third-party code. Required `__source` signature eliminates this risk.

## Next Steps
→ Phase 2: Console capture module (hooks console.error/warn in MAIN world)
