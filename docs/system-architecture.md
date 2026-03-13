# System Architecture

## High-Level Overview

FE Debug Logger is a Chrome extension that captures frontend events across four categories (console, user actions, network, component state) and exports them as structured Markdown. The architecture uses a dual content script pattern to bridge the gap between page JavaScript execution and Chrome extension APIs.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION HOST                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    SERVICE WORKER (background.js)            │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ • Recording state management (session storage)              │ │
│  │ • Log entry aggregation (local storage)                     │ │
│  │ • Offscreen document orchestration                          │ │
│  │ • File download trigger                                     │ │
│  │ • Message routing (content → offscreen, popup → content)    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│         ▲                             ▲                    ▲        │
│         │ START/STOP_CAPTURE          │ PROCESS_EXPORT   │        │
│         │ (via tabs.sendMessage)      │ (via runtime)    │        │
│         │                             │                  │        │
│  ┌──────┴────────────────────────────┴─────────────────┬──────┐  │
│  │         POPUP UI (popup.html/js)                    │      │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │ • Start/Stop/Export/Clear buttons                    │      │  │
│  │ • Capture options checkboxes                         │      │  │
│  │ • Status indicator + entry counter                   │      │  │
│  │ • Message: GET_STATUS, START/STOP/EXPORT/CLEAR_LOG  │      │  │
│  └───────────────────────────────────────────────────────────┘  │
│         ▲                                                        │
│         │ chrome.runtime.sendMessage                            │
│         │                                                        │
│  ┌──────┴──────────────────────────────────────────────────┐   │
│  │         OFFSCREEN DOCUMENT (offscreen.html/js)          │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ • Receives: entries + sessionMeta                        │   │
│  │ • Calls: formatMarkdown() → Markdown string              │   │
│  │ • Creates: Blob → data URL                               │   │
│  │ • Sends: EXPORT_READY with data URL + filename           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ chrome.runtime.sendMessage (via content script bridge)
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        WEB PAGE CONTEXT                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │           ISOLATED WORLD (content-script.js)                │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ • Bridges MAIN ↔ Service Worker via postMessage/sendMessage │ │
│  │ • Receives LOG_ENTRY, PAGE_META from MAIN world             │ │
│  │ • Forwards to background via chrome.runtime.sendMessage     │ │
│  │ • Receives START/STOP_CAPTURE from background              │ │
│  │ • Relays to MAIN world via postMessage                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│         ▲                        ▲         │
│         │ postMessage            │         │ postMessage
│         │                        │         │
│  ┌──────┴────────────────────────┴─────────┴──────────────────┐ │
│  │  MAIN WORLD (content-script-main.js + capture modules)     │ │
│  ├──────────────────────────────────────────────────────────────┤ │
│  │ Coordinator (content-script-main.js):                        │ │
│  │  • Initialize capture modules                               │ │
│  │  • Start/Stop all captures                                  │ │
│  │  • Trigger component snapshots on errors                    │ │
│  │                                                             │ │
│  │ Capture Modules:                                            │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ Console Capture (console-capture.js)                 │   │ │
│  │ │ • Hook: console.error, console.warn                 │   │ │
│  │ │ • Hook: window.onerror, unhandledrejection          │   │ │
│  │ │ • Format args (errors, DOM elements, objects)       │   │ │
│  │ │ • Skip self-logging via __fe_debug_logger__ marker  │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ User Action Capture (user-action-capture.js)         │   │ │
│  │ │ • Listen: click, input, change, submit               │   │ │
│  │ │ • Listen: keydown (Enter/Escape), navigation         │   │ │
│  │ │ • Generate CSS selectors (4 levels deep)             │   │ │
│  │ │ • Mask sensitive fields (password, token, etc.)      │   │ │
│  │ │ • Debounce input events (300ms)                      │   │ │
│  │ │ • Limit entries to 200 (prune oldest)                │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ Network Capture (network-capture.js)                 │   │ │
│  │ │ • Intercept: fetch() calls                           │   │ │
│  │ │ • Intercept: XMLHttpRequest                          │   │ │
│  │ │ • Log: errors (status >= 400), slow (> 3s)           │   │ │
│  │ │ • Capture: request body (500 chars), response (1 KB) │   │ │
│  │ │ • Skip: chrome-extension:// URLs                     │   │ │
│  │ │ • Optional: logAll mode (debug)                      │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ Component State Capture (component-state-capture.js) │   │ │
│  │ │ • Auto-detect: React Fiber tree                      │   │ │
│  │ │ • Auto-detect: Vue 2 instance tree                   │   │ │
│  │ │ • Auto-detect: Vue 3 instance tree                   │   │ │
│  │ │ • Extract: props (5 keys, 100 char values)           │   │ │
│  │ │ • Extract: state (5 keys, 100 char values)           │   │ │
│  │ │ • Max depth: 5 levels (prevent infinite recursion)   │   │ │
│  │ │ • Trigger: snapshot on console.error                │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Message Flow Sequences

### Sequence 1: Start Recording

```
User clicks "Start" in popup
        │
        ▼
popup.js: chrome.runtime.sendMessage({ type: 'START_RECORDING', config })
        │
        ▼
background.js:
  • Clear previous log entries (log_* keys)
  • Set recording=true in chrome.storage.session
  • Set config in chrome.storage.session
  • Send START_CAPTURE to content script
        │
        ▼
content-script.js (ISOLATED):
  • Receives chrome.runtime.onMessage
  • Relays via window.postMessage to MAIN world
        │
        ▼
content-script-main.js (MAIN):
  • Receives 'START_CAPTURE' message
  • Calls startCapture(config)
  • Initializes all 4 capture modules with config
  • Sends PAGE_META (URL, UA, viewport)
        │
        ▼
capture modules (MAIN):
  • Install hooks (console, network, event listeners)
  • Ready to log events
```

### Sequence 2: Log Entry Captured

```
page.js calls console.error("Something broke")
        │
        ▼
console-capture.js (hooked):
  • Format args
  • Call postLog('console', { type: 'error', message, stack })
        │
        ▼
content-script-main.js:
  • postLog() sends window.postMessage with __source signature
        │
        ▼
content-script.js (ISOLATED):
  • Receives 'LOG_ENTRY' message
  • Relays via chrome.runtime.sendMessage to background
        │
        ▼
background.js:
  • Receives 'LOG_ENTRY'
  • Store as log_<timestamp>_<seq> in chrome.storage.local
  • Increment entryCounter
  • Entry persists until user clicks "Clear" or starts new recording
```

### Sequence 3: Export

```
User clicks "Export" in popup
        │
        ▼
popup.js: chrome.runtime.sendMessage({ type: 'EXPORT_LOG' })
        │
        ▼
background.js:
  • Get all log_* keys from chrome.storage.local
  • Sort by key
  • Map to entry objects
  • Get sessionMeta (URL, time, UA, viewport)
  • Create or reuse offscreen document (BLOBS reason)
  • Send PROCESS_EXPORT to offscreen document
        │
        ▼
offscreen.js:
  • Receive PROCESS_EXPORT message
  • Call formatMarkdown({ meta: sessionMeta, entries })
  • Markdown formatter generates:
    - Session Info table
    - User Actions table
    - Console Errors sections
    - Network Issues sections
    - Component State tree
  • Create Blob from Markdown string
  • Generate data URL (blob:)
  • Send EXPORT_READY to background with dataUrl + filename
        │
        ▼
background.js:
  • Receive EXPORT_READY
  • Call chrome.downloads.download({ url: dataUrl, filename })
  • Close offscreen document
        │
        ▼
Browser downloads file to default Downloads folder
```

### Sequence 4: Stop Recording

```
User clicks "Stop" in popup
        │
        ▼
popup.js: chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
        │
        ▼
background.js:
  • Set recording=false in chrome.storage.session
  • Persist endTime to sessionMeta in chrome.storage.local
  • Send STOP_CAPTURE to content script
        │
        ▼
content-script.js (ISOLATED):
  • Receives chrome.runtime.onMessage
  • Relays via window.postMessage to MAIN world
        │
        ▼
content-script-main.js (MAIN):
  • Receives 'STOP_CAPTURE' message
  • Calls stopCapture()
  • Uninstall all hooks (console, network, event listeners)
  • Capture modules idle (no new entries logged)
```

## Data Flow: End-to-End

```
PAGE EVENTS                 MAIN WORLD              ISOLATED WORLD        BACKGROUND
─────────────              ──────────             ──────────────         ──────────
┌─────────────┐
│ console.log │ ──────────>┌──────────────────┐   ┌──────────────┐   ┌──────────────┐
│   error()   │            │ Capture hook:    │   │              │   │              │
└─────────────┘            │ Format args      │──>│ Relay via    │──>│ Store entry  │
                           │ postMessage      │   │ chrome       │   │ log_*        │
                           │ (__source sig)   │   │ runtime.     │   └──────────────┘
                           └──────────────────┘   │ sendMessage  │
                                                   └──────────────┘
                                                         ▲
                           ┌──────────────────┐         │
│ click event   │ ──────────>│ Capture hook:    │        │
└─────────────┘            │ Generate selector│   ┌──────────────┐
                           │ postMessage      │──>│              │
                           │ (__source sig)   │   │ Relay        │
                           └──────────────────┘   └──────────────┘
                                                         │
                           ┌──────────────────┐         │   ┌──────────────┐
│ fetch() call  │ ──────────>│ Capture hook:    │        └──>│ Store entry  │
└─────────────┘            │ Log status/time  │   ┌──────────────┐
                           │ postMessage      │──>│              │
                           │ (__source sig)   │   │ Relay        │
                           └──────────────────┘   └──────────────┘
                                                         │
                           ┌──────────────────┐         │   ┌──────────────┐
│ React render │ ──────────>│ Detect Fiber tree│        │   │ Store entry  │
└─────────────┘            │ Extract props    │   ┌──────────────┐
                           │ postMessage      │──>│              │
                           │ (__source sig)   │   │ Relay        │
                           └──────────────────┘   └──────────────┘


EXPORT PIPELINE
───────────────
BACKGROUND                              OFFSCREEN
──────────                              ─────────
Gather log_* entries
from chrome.storage.local
        │
        ▼
formatMarkdown(entries, meta)  ──────────────────>  Formatter:
                                                     • Session Info table
                                                     • User Actions table
                                                     • Console Errors
                                                     • Network Issues
                                                     • Component State
        │
        ▼                                            │
        │<──── Result: Markdown string ──────────────┘
        │
        ▼
Create Blob from Markdown
        │
        │<──── data URL ──────────────────────────────
        │
        ▼
Trigger download:
chrome.downloads.download({
  url: dataUrl,
  filename: 'fe-debug-log-<timestamp>.md'
})
        │
        ▼
Browser downloads .md file
```

## Storage Architecture

### chrome.storage.session
**Purpose**: Recording state (survives service worker restart within same session)

```javascript
{
  recording: boolean,          // Current recording state
  entryCounter: number,        // Sequence number for next entry
  config: {                    // Capture options
    console: boolean,
    userActions: boolean,
    network: boolean,
    componentState: boolean
  }
}
```

**Lifecycle**:
- Initialize on START_RECORDING
- Update on LOG_ENTRY (increment entryCounter)
- Clear on STOP_RECORDING
- Cleared on extension disable/update

### chrome.storage.local
**Purpose**: Persistent log entries and session metadata

```javascript
{
  sessionMeta: {
    url: string,              // Page URL when recording started
    startTime: ISO string,    // Recording start time
    endTime: ISO string,      // Recording end time (set on STOP)
    userAgent: string,        // Browser user agent
    viewport: string          // Window dimensions (WxH)
  },
  log_1710328934567_0: { ... },  // Entry 0
  log_1710328934568_1: { ... },  // Entry 1
  log_1710328934569_2: { ... },  // Entry 2
  // ... up to thousands of entries
}
```

**Cleanup**:
- All log_* entries deleted on START_RECORDING (fresh session)
- User-triggered CLEAR_LOG deletes all log_* and sessionMeta
- Entries NOT auto-deleted after export (user must clear manually)

### Storage Limits

- **Quota**: chrome.storage.local has ~10 MB limit per extension
- **Typical Session**: 500 entries ≈ 1-2 MB (varies by event complexity)
- **Mitigation**: User can export and clear between sessions

## Component Interactions

### Popup ↔ Background

| Message | Direction | Purpose |
|---------|-----------|---------|
| GET_STATUS | Popup → BG | Query recording state + entry count |
| START_RECORDING | Popup → BG | Begin capture with config |
| STOP_RECORDING | Popup → BG | Stop capture, persist end time |
| EXPORT_LOG | Popup → BG | Start export workflow |
| CLEAR_LOG | Popup → BG | Delete all entries + metadata |

### Background ↔ Content Script

| Message | Direction | Purpose |
|---------|-----------|---------|
| START_CAPTURE | BG → Content | Initialize capture modules with config |
| STOP_CAPTURE | BG → Content | Clean up capture modules |
| LOG_ENTRY | Content → BG | Store individual log entry |
| PAGE_META | Content → BG | Store session metadata (URL, UA, viewport) |

### Background ↔ Offscreen

| Message | Direction | Purpose |
|---------|-----------|---------|
| PROCESS_EXPORT | BG → Offscreen | Format logs and generate data URL |
| EXPORT_READY | Offscreen → BG | Return formatted Markdown + filename |

## Concurrency & State Management

### Recording State Machine

```
    START_RECORDING
          │
          ▼
    [ RECORDING ]  ◄────── entryCounter increments with each LOG_ENTRY
          │
          ▼
    STOP_RECORDING
          │
          ▼
    [ STOPPED ]    ◄────── export allowed, clear allowed
          │
          ▼
    START_RECORDING (new session clears old logs)
```

### Entry Counter Synchronization

- Initialized in background.js: `let entryCounter = 0`
- Restored on SW wake from `chrome.storage.session`
- Incremented in background on each LOG_ENTRY
- Synced back to storage: `chrome.storage.session.set({ entryCounter })`
- Used as sequence number: `log_<timestamp>_<entryCounter>`

### Race Conditions Mitigated

1. **LOG_ENTRY during STOP**: Entries accepted until recording=false confirmed by content script
2. **Multiple popups**: Only one popup active per window, all route through background
3. **SW restart**: Recording state and counter restored from session storage
4. **Concurrent captures**: Each module independent, no shared mutable state

## Error Handling Strategy

### Graceful Degradation

- Capture modules wrapped in try-catch (content-script-main.js)
- Failed module doesn't prevent others from running
- All errors logged with `__fe_debug_logger__` marker
- Offscreen failures: Background closes document and alerts user

```javascript
try {
  if (cfg.console) captures.console.start(cfg);
} catch (e) {
  console.error('__fe_debug_logger__', 'Console capture failed:', e);
  // Continue to next module
}
```

### Message Failures

- Sending to dead content script: `.catch(() => {})` suppresses error
- Offscreen not created: Attempt to create before use
- Download failure: Logged to console, offscreen doc still closed

## Performance Considerations

### CPU Impact
- **Console hooks**: Minimal (only at error time)
- **Event listeners**: Debounced (input 300ms) or low-frequency (navigation)
- **Component tree walk**: Only on snapshot (console error), max depth 5
- **Network intercepts**: Fast path for success, slow for errors/timeouts

### Memory Impact
- **Log entries**: Limited to 200 user actions max (oldest pruned)
- **Network bodies**: 500 chars request, 1 KB response
- **Component state**: 5 props/keys per component, 100 char values
- **Blob creation**: Offscreen document (not main thread)

### Storage Impact
- **Typical session**: ~1-2 MB for 500 diverse entries
- **Heavy session**: Up to ~10 MB limit before quota exceeded
- **Cleanup**: Manual clear or restart recording to free space

## Security & Privacy

### Data Collection Scope
- Only frontend events (page-visible)
- No server-side network inspection (CORS limited)
- User must explicitly export (not auto-uploaded)

### Sensitive Field Masking
- Automatic detection: password, token, secret, apiKey, etc.
- User actions: field value → `***MASKED***`
- Console args: sensitive patterns masked in objects

### Extension Security
- ISOLATED world bridge prevents page from accessing extension APIs
- MAIN world scripts can't access chrome.* APIs
- Offscreen document isolated from page context
- Service worker protected by standard extension sandbox

## Extensibility Points

### Adding New Capture Module

1. Create `capture/new-capture.js` with factory function
2. Implement `start(config)`, `stop()`, optional `snapshot()`
3. Call `postLog(category, data)` to send entries
4. Add to `content-script-main.js` initialization
5. Add checkbox to `popup.html` for toggle

### Customizing Export Format

1. Modify `formatter/markdown-formatter.js`
2. Add new section formatters (e.g., `formatCustomSection()`)
3. Return sections joined by `---` separator
4. Update offscreen.js if Blob creation changes

### Adding New Storage Location

1. Use `chrome.storage.local` or `chrome.storage.session`
2. Prefix keys to avoid collisions (e.g., `custom_<key>`)
3. Update background.js cleanup routines
4. Document quota impact
