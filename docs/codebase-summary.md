# Codebase Summary

## Project Statistics

- **Total Files**: 14
- **Total LOC**: ~1,268 lines
- **Language**: Vanilla JavaScript (ES6+), HTML, CSS
- **Build Tools**: None (direct extension packaging)
- **Version**: 0.1.0

## Directory Structure

```
extension-debug/
├── manifest.json                 # Chrome extension configuration (MV3)
├── background.js                 # Service worker — recording state + message routing
├── content-script.js             # ISOLATED world bridge (Chrome API access)
├── content-script-main.js        # MAIN world coordinator (page JS access)
├── popup.html / popup.js / popup.css  # Extension popup UI
├── offscreen.html / offscreen.js # Offscreen doc for Blob creation
├── capture/
│   ├── console-capture.js        # Hook console.error/warn, onerror events
│   ├── user-action-capture.js    # Click/input/change/submit tracking
│   ├── network-capture.js        # Fetch/XHR monitoring
│   └── component-state-capture.js # React Fiber + Vue instance trees
├── formatter/
│   └── markdown-formatter.js     # Convert log entries to structured Markdown
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

## Core Modules

### Manifest & Configuration (`manifest.json`, 42 LOC)

**Purpose**: Chrome MV3 extension configuration.

**Key Settings**:
- Manifest version: 3
- Permissions: `activeTab`, `storage`, `downloads`, `offscreen`
- Action: Popup at `popup.html`
- Background: Service worker at `background.js`
- Content Scripts:
  - ISOLATED world: `content-script.js` (document_start)
  - MAIN world: `console-capture.js`, `user-action-capture.js`, `network-capture.js`, `component-state-capture.js`, `content-script-main.js` (document_start)

### Service Worker (`background.js`, 152 LOC)

**Purpose**: Manage recording state, message routing, log storage, and export orchestration.

**Key Responsibilities**:
1. Track recording state and entry counter (session + local storage)
2. Handle START_RECORDING: Clear previous logs, set recording flag, notify content script
3. Handle STOP_RECORDING: Clear recording flag, persist end time
4. Handle LOG_ENTRY: Store entries as `log_<timestamp>_<seq>` keys
5. Handle EXPORT_LOG: Gather entries, create offscreen document, format Markdown
6. Handle CLEAR_LOG: Remove all log entries
7. Handle EXPORT_READY: Download file from offscreen document
8. Handle PAGE_META: Store session metadata (URL, UA, viewport)

**Storage Strategy**:
- `chrome.storage.session`: `recording` (bool), `config` (capture options), `entryCounter` (int) — survives SW restart
- `chrome.storage.local`: `log_*` entries (individual), `sessionMeta` (table) — persistent

### ISOLATED World Bridge (`content-script.js`, 23 LOC)

**Purpose**: Bridge between MAIN world and background service worker.

**Message Flow**:
- Receives: LOG_ENTRY, PAGE_META from MAIN world → relays to background via `chrome.runtime.sendMessage`
- Receives: START_CAPTURE, STOP_CAPTURE from background → relays to MAIN world via `window.postMessage`

**Design Rationale**: ISOLATED world has Chrome API access; MAIN world has page JS access. This bridges the gap.

### MAIN World Coordinator (`content-script-main.js`, 72 LOC)

**Purpose**: Initialize capture modules, handle start/stop signals, trigger component snapshots.

**Key Functions**:
- `postLog(category, data)`: Send log entry to ISOLATED bridge
- `postLogWithSnapshot(category, data)`: Post log + trigger component snapshot on console errors
- `startCapture(config)`: Initialize all 4 capture modules with config
- `stopCapture()`: Clean up all capture modules
- Message listener for START_CAPTURE / STOP_CAPTURE from ISOLATED bridge

**Capture Modules Created**:
- `createConsoleCapture()` — provided by console-capture.js
- `createUserActionCapture()` — provided by user-action-capture.js
- `createNetworkCapture()` — provided by network-capture.js
- `createComponentStateCapture()` — provided by component-state-capture.js

### Console Capture Module (`capture/console-capture.js`, 94 LOC)

**Purpose**: Hook console methods and global error events.

**Events Captured**:
1. `console.error()` — logs errors with formatted args
2. `console.warn()` — logs warnings with formatted args
3. `window.onerror` — logs uncaught errors with stack trace
4. `unhandledrejection` — logs unhandled promise rejections

**Key Features**:
- `formatArg()`: Serialize args (strings, objects, errors, DOM elements)
- HTMLElement formatting: Shows tag, id, classes (max 2 classes)
- Error stack capture: Extracts stack trace, removes bridge frames
- Self-skip: Detects `__fe_debug_logger__` marker to avoid logging extension's own errors
- Start/stop methods: Install/uninstall hooks

**Message Format**:
```javascript
{ category: 'console', type: 'error'|'warn'|'onerror'|'unhandledrejection', message, stack, timestamp }
```

### User Action Capture Module (`capture/user-action-capture.js`, 133 LOC)

**Purpose**: Track user interactions (clicks, form inputs, navigation).

**Events Captured**:
1. `click` — element selector + closest parent (4 levels)
2. `input` — debounced 300ms, with field name + value (masked)
3. `change` — field name + value (masked)
4. `submit` — form selector
5. `keydown` — key (Enter/Escape only), target selector
6. `popstate` / `hashchange` — navigation events

**Key Features**:
- CSS selector generation: Build path from element to root (max 4 levels)
- Sensitive field detection: Masks password, token, secret, apiKey, etc.
- Max entries: 200 (oldest pruned to prevent unbounded growth)
- Debouncing: Input events throttled to 300ms intervals

**Message Format**:
```javascript
{ category: 'action', type: 'click'|'input'|'change'|'submit'|'keydown'|'navigation', target, value, timestamp }
```

### Network Capture Module (`capture/network-capture.js`, 131 LOC)

**Purpose**: Monitor HTTP requests (fetch, XMLHttpRequest).

**Requests Captured**:
1. Fetch: Errors (status >= 400) and slow requests (> 3s)
2. XMLHttpRequest: Errors and slow requests
3. Skipped: chrome-extension:// URLs

**Features**:
- Request body capture: First 500 chars logged
- Response body capture: First 1 KB read
- Response format detection: JSON parsed if possible
- Timing: Duration calculated from request start to response
- Optional `logAll` mode: Capture all requests (slow, debug only)

**Message Format**:
```javascript
{ category: 'network', type: 'error'|'slow', method, url, status, duration, requestBody, responseBody, error, timestamp }
```

### Component State Capture Module (`capture/component-state-capture.js`, 197 LOC)

**Purpose**: Auto-detect React/Vue and capture component state trees.

**Framework Detection**:
- **React**: Walks React Fiber tree via `__reactRootContainer` or `__reactInternalInstance`
- **Vue 2**: Accesses `__vue__` instance on DOM nodes
- **Vue 3**: Accesses `__vueParentComponent` on DOM nodes

**Data Capture**:
- Max depth: 5 levels (prevent infinite recursion)
- Props extraction: First 5 props, values truncated to 100 chars
- State extraction: First 5 keys from Vue data/state
- JSON serialization with fallback for circular references

**Snapshot Trigger**:
- Auto-triggered on console.error (via `postLogWithSnapshot`)
- Manual trigger via `snapshot()` method

**Message Format**:
```javascript
{ category: 'state', component, framework: 'react'|'vue2'|'vue3', props, state, timestamp }
```

### Markdown Formatter (`formatter/markdown-formatter.js`, 206 LOC)

**Purpose**: Convert log entries into structured Markdown for export.

**Sections Generated**:
1. **Session Info** (table): URL, time range, duration, browser, viewport, UA
2. **User Actions** (table): Type, target, value, timestamp (grouped by type)
3. **Console Errors** (sections): Error message + stack trace (one per error)
4. **Network Issues** (sections): Method/URL, status, request/response bodies
5. **Component State** (tree): Framework + component name, props, state

**Helper Functions**:
- `formatTime()`: Convert ISO timestamp to human-readable
- `formatDuration()`: Calculate elapsed time between start/end
- `truncateUrl()`: Shorten long URLs (max 60 chars)
- `escapeMarkdownCell()`: Escape special chars for table cells

**Output**: Single Markdown string with sections separated by `---`

### Popup UI (`popup.html`, `popup.js`, `popup.css`, 78 + 26 + 75 LOC)

**Purpose**: Control panel for start/stop/export/clear operations.

**HTML Structure**:
- Title: "FE Debug Logger"
- Status indicator: "Idle" (default) or "Recording"
- Control buttons: Start/Stop (toggle), Export, Clear
- Options checkboxes: Console Errors, User Actions, Network, Component State
- Entry counter display

**JavaScript Logic** (`popup.js`):
1. Query background for recording status on load
2. Toggle Start/Stop: Send START_RECORDING / STOP_RECORDING
3. Export: Send EXPORT_LOG (background orchestrates offscreen doc)
4. Clear: Send CLEAR_LOG
5. Checkboxes: Build config object, pass to START_RECORDING

**Styling** (`popup.css`):
- Compact layout: 300px width
- Status indicator: Green (recording), Gray (idle)
- Button states: Disabled when no log entries

### Offscreen Document (`offscreen.html`, `offscreen.js`, 8 + 31 LOC)

**Purpose**: Create Blob and data URL (MV3 restriction — no DOM in service worker).

**Process**:
1. Background sends PROCESS_EXPORT message with entries + metadata
2. Offscreen calls `formatMarkdown(logData)` to generate Markdown string
3. Creates Blob from Markdown, generates data URL
4. Sends EXPORT_READY message back to background with data URL + filename
5. Background downloads file

**Filename Format**: `fe-debug-log-<ISO-timestamp>.md`

## Message Types

### Content Script → Background

| Type | Source | Data | Purpose |
|------|--------|------|---------|
| LOG_ENTRY | capture modules (via MAIN bridge) | category, type, data | Store individual log entry |
| PAGE_META | content-script-main | url, userAgent, viewport | Store session metadata |
| EXPORT_READY | offscreen | dataUrl, filename | Trigger download |

### Background → Content Script

| Type | Source | Data | Purpose |
|------|--------|------|---------|
| START_CAPTURE | background (from popup) | config | Start all capture modules |
| STOP_CAPTURE | background (from popup) | — | Stop all capture modules |
| PROCESS_EXPORT | background | entries, sessionMeta | Format and export logs |

### Popup → Background

| Type | Purpose |
|------|---------|
| GET_STATUS | Query recording state + entry count |
| START_RECORDING | Begin capture with selected categories |
| STOP_RECORDING | End capture |
| EXPORT_LOG | Trigger export workflow |
| CLEAR_LOG | Delete all stored entries |

## Module Pattern

All capture modules use **factory function pattern** (no classes/prototypes):

```javascript
function createXxxCapture(postLog) {
  let state = { };  // Private state
  function helper() { }  // Private helpers
  return {
    start(config) { },  // Public API
    stop() { },
    snapshot() { }
  };
}
```

Benefits: Encapsulation, no global state, reusable initialization.

## Data Storage

### chrome.storage.session
- **Ephemeral**: Cleared when extension is disabled/updated
- **Survives**: Service worker restart within same session
- **Keys**: `recording` (bool), `config` (object), `entryCounter` (int)

### chrome.storage.local
- **Persistent**: Survives across browser sessions
- **Keys**:
  - `log_<timestamp>_<seq>`: Individual log entries (deleted on new recording)
  - `sessionMeta`: Session metadata (URL, time, UA, viewport)

## Performance Considerations

1. **Console Capture**: Minimal overhead (hook replacement, argument formatting)
2. **User Action Capture**: 300ms debouncing for high-frequency input events
3. **Network Capture**: Response body limited to 1 KB
4. **Component State**: Max depth 5, only 5 props/state keys per component
5. **Blob Creation**: Offscreen document prevents blocking background
6. **Storage**: Log entries limited to chrome.storage.local quota (~10 MB)

## Dependencies

- **Zero npm packages** — vanilla JavaScript
- **Browser APIs**: Chrome extension APIs (tabs, runtime, storage, downloads, offscreen, action)
- **ES6+ features**: Arrow functions, destructuring, async/await, template literals
