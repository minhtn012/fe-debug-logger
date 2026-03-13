# Phase 2: Console Capture Module

## Context
- Depends on: [Phase 1](./phase-01-scaffold-and-popup.md) (message infrastructure)
- Runs in: MAIN world (`content-script-main.js`)

## Overview
- **Priority:** P1
- **Status:** completed
- **Effort:** 1h

Hook `console.error`, `console.warn`, `window.onerror`, and `unhandledrejection` to capture errors with full stack traces.

## Key Insights
- Must save original console methods before overriding, restore on stop
- `window.onerror` provides file/line/col info directly
- `unhandledrejection` event gives promise rejection reason
- Stack traces from `Error.stack` are browser-specific but Chrome is consistent
- Need to avoid capturing our own extension's console calls (infinite loop prevention)

## Requirements
- Capture: console.error, console.warn (toggleable: errors only vs errors+warnings)
- Capture: window.onerror with file, line, column
- Capture: unhandledrejection with reason
- Each entry includes: timestamp, type (error/warn/onerror/rejection), message, stack trace, source location
- Prevent infinite loop from own logging

## Files to Create/Modify

| File | Action |
|------|--------|
| `capture/console-capture.js` | Create — capture module |
| `content-script-main.js` | Modify — import and init console capture |

## Implementation Steps

### 1. Create `capture/console-capture.js`

```js
// Module pattern — returns start/stop functions
function createConsoleCapture(postLog) {
  let origError, origWarn;
  let onerrorHandler, rejectionHandler;

  function start(config) {
    // Save originals
    origError = console.error;
    origWarn = console.warn;

    // Unique marker to skip own logs
    const SKIP_MARKER = '__fe_debug_logger__';

    // Hook console.error
    console.error = function(...args) {
      if (args[0] === SKIP_MARKER) {
        return origError.apply(console, args.slice(1));
      }
      const entry = {
        timestamp: new Date().toISOString(),
        type: 'error',
        message: args.map(a => formatArg(a)).join(' '),
        stack: new Error().stack?.split('\n').slice(2).join('\n') || '',
      };
      postLog('console', entry);
      origError.apply(console, args);
    };

    // Hook console.warn
    console.warn = function(...args) { /* similar pattern */ };

    // window.onerror
    onerrorHandler = (message, source, lineno, colno, error) => {
      postLog('console', {
        timestamp: new Date().toISOString(),
        type: 'onerror',
        message: String(message),
        source, lineno, colno,
        stack: error?.stack || '',
      });
    };
    window.addEventListener('error', onerrorHandler);

    // unhandledrejection
    rejectionHandler = (event) => {
      const reason = event.reason;
      postLog('console', {
        timestamp: new Date().toISOString(),
        type: 'unhandledrejection',
        message: reason?.message || String(reason),
        stack: reason?.stack || '',
      });
    };
    window.addEventListener('unhandledrejection', rejectionHandler);
  }

  function stop() {
    console.error = origError;
    console.warn = origWarn;
    window.removeEventListener('error', onerrorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  }

  return { start, stop };
}
```

### 2. Helper: `formatArg(arg)`
- Primitives: String(arg)
- Objects/Arrays: JSON.stringify(arg, null, 2) truncated to 500 chars
- Error objects: extract message + stack
- DOM elements: tagName + id/class summary

### 3. Wire into `content-script-main.js`
- Load `console-capture.js` via inline or concatenated script
- On start config: `if (config.console) consoleCapture.start(config)`
- On stop: `consoleCapture.stop()`

### 4. Entry Schema
```js
{
  timestamp: "2026-03-13T10:30:00.000Z",
  type: "error" | "warn" | "onerror" | "unhandledrejection",
  message: "TypeError: Cannot read property 'foo' of undefined",
  stack: "at Object.handleClick (app.js:42:15)\n...",
  source: "https://example.com/app.js",  // onerror only
  lineno: 42,                            // onerror only
  colno: 15,                             // onerror only
}
```

## Todo
- [x] Create console-capture.js with error/warn hooks
- [x] Implement window.onerror handler
- [x] Implement unhandledrejection handler
- [x] Add formatArg helper for safe serialization
- [x] Add infinite loop prevention (SKIP_MARKER)
- [x] Wire into content-script-main.js
- [x] Test: trigger console.error, verify entry logged
- [x] Test: trigger uncaught error, verify onerror captured
- [x] Test: trigger unhandled promise rejection
- [x] Test: stop restores original console methods

## Success Criteria
- Console errors/warnings captured with timestamp and stack trace
- window.onerror and unhandledrejection captured
- Original console methods restored on stop
- No infinite loops from own logging
- Entries forwarded to background via message bridge

## Next Steps
→ Phase 3: User action capture
