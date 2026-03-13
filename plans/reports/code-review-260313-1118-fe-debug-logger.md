# Code Review: FE Debug Logger Chrome Extension

## Scope
- **Files:** 12 (manifest.json, popup.html/js/css, background.js, content-script.js, content-script-main.js, 4 capture modules, markdown-formatter.js, offscreen.html/js)
- **LOC:** ~530
- **Focus:** Full codebase review -- message flow, MV3 APIs, security, edge cases

## Overall Assessment

Solid architecture for a vanilla-JS MV3 extension. The MAIN/ISOLATED world bridge pattern is correctly implemented. Capture modules are well-separated. Several bugs will prevent correct operation in specific scenarios, and there are a few security gaps worth addressing.

---

## Critical Issues

### C1. STOP_RECORDING `sendResponse` called after listener returns

**File:** `background.js:67`

```js
if (msg.type === 'STOP_RECORDING') {
  chrome.storage.session.set({ recording: false });
  chrome.storage.local.get(['sessionMeta'], (data) => { ... });
  // ... async tab query ...
  chrome.action.setBadgeText({ text: '' });
  sendResponse({ recording: false, entryCount: entryCounter }); // sync
  return true; // signals async response
}
```

The `sendResponse` is called synchronously while `return true` tells Chrome to keep the channel open for an async response. This actually works but is misleading. The real bug: `sendResponse` fires before `chrome.storage.local.get` finishes writing `endTime`, so if popup immediately exports, `endTime` may be missing.

**Fix:** Await storage write, then send response:
```js
chrome.storage.local.get(['sessionMeta'], (data) => {
  const meta = data.sessionMeta || {};
  meta.endTime = new Date().toISOString();
  chrome.storage.local.set({ sessionMeta: meta }, () => {
    sendResponse({ recording: false, entryCount: entryCounter });
  });
});
```

### C2. `offscreen.js` cannot call `chrome.downloads.download()`

**File:** `offscreen.js:18`

Offscreen documents do NOT have access to `chrome.downloads` API. Only the service worker (background.js) does. This will throw a runtime error and the export will silently fail.

**Fix:** After formatting markdown in the offscreen doc, send the result back to background.js which then calls `chrome.downloads.download()`:

```js
// offscreen.js - send markdown back
chrome.runtime.sendMessage({
  type: 'DOWNLOAD_READY',
  markdown,
  domain,
  timestamp,
});

// background.js - handle download
if (msg.type === 'DOWNLOAD_READY') {
  const blob = new Blob([msg.markdown], { type: 'text/markdown' });
  // Use data URL or save via chrome.downloads
}
```

Alternatively, skip the offscreen document entirely -- the formatter is pure string manipulation and can run in the service worker. The offscreen doc was justified for BLOBS but that is unnecessary if downloads are triggered from background.js.

### C3. `chrome.storage.session` requires `"storage"` permission (already present) but also needs `setAccessLevel` for content scripts

**File:** `background.js:4`

`chrome.storage.session` defaults to service-worker-only access. If any content script tries to read session storage (currently they don't), it would fail. More importantly: if the SW restarts and the session store is cold, `entryCounter` resets to 0 causing duplicate `log_` keys with the same counter value.

**Impact:** Duplicate keys are unlikely in practice (Date.now() differs) but `_seq` ordering will restart from 0 mid-session.

**Fix:** Store `entryCounter` in `chrome.storage.local` alongside log entries, or accept the minor _seq gap.

---

## High Priority

### H1. Network response body reading can silently break Response streams

**File:** `capture/network-capture.js:44-46`

```js
const clone = response.clone();
resBody = truncateBody(await clone.text());
```

If the original response body is very large, `clone.text()` reads the entire body into memory before truncation. This could cause OOM on large file downloads. Also, `clone()` on a response that has already been consumed by a ReadableStream elsewhere can throw.

**Fix:** Add size check or use a streaming approach:
```js
const clone = response.clone();
const reader = clone.body.getReader();
let chunks = '';
let done = false;
while (!done && chunks.length < 600) {
  const result = await reader.read();
  done = result.done;
  if (result.value) chunks += new TextDecoder().decode(result.value);
}
reader.cancel();
resBody = truncateBody(chunks);
```

### H2. XHR `loadend` listener leaks -- never removed

**File:** `capture/network-capture.js:93`

Each XHR `send()` call adds a `loadend` listener. When `stop()` is called, only the prototype methods are restored -- existing in-flight XHRs still have listeners attached. This is minor for short sessions but could matter for long-running ones.

### H3. No `chrome.storage.local` quota awareness

**File:** `background.js:74`

Each `LOG_ENTRY` writes to `chrome.storage.local` without checking if we are near the 10MB quota (`QUOTA_BYTES`). If the user records a long session, storage silently fails and entries are lost.

**Fix:** Check `chrome.runtime.lastError` in the set callback, or maintain a running byte estimate and stop recording when near quota.

### H4. `content-script.js` bridge forwards ALL messages with matching signature to background

**File:** `content-script.js:12`

```js
chrome.runtime.sendMessage(msg).catch(() => {});
```

This forwards the raw `msg` including `__source` and `version` fields to the background. The background handler doesn't validate `msg.type` exhaustively -- unknown types fall through silently, which is fine, but the `__source` field pollutes storage entries.

**Fix:** Strip internal fields before forwarding:
```js
const { __source, version, ...payload } = msg;
chrome.runtime.sendMessage(payload).catch(() => {});
```

---

## Medium Priority

### M1. Markdown table cells not escaped

**File:** `formatter/markdown-formatter.js:62-71`

`selector` values containing `|` will break the table. The `escapeCell` helper exists but is only used for `a.text` and `a.value`, not for selectors or other fields.

**Fix:** Wrap selector output with `escapeCell()`:
```js
const selector = a.selector ? `\`${escapeCell(a.selector)}\`` : '';
```

### M2. `window.close()` in offscreen doc may not work

**File:** `offscreen.js:27`

`window.close()` is unreliable in offscreen documents. Use `chrome.offscreen.closeDocument()` from background.js instead (after receiving the download-ready signal).

### M3. `console.error` self-referencing hook potential

**File:** `capture/console-capture.js`

The `SKIP_MARKER` pattern works but is fragile. If any third-party library calls `console.error` with arguments that happen to stringify to the marker, legitimate errors are suppressed. Low risk but worth documenting.

### M4. `createComponentStateCapture.start()` ignores config

**File:** `capture/component-state-capture.js:154`

The `start()` method ignores the `config` parameter (doesn't receive one in `content-script-main.js:49`). If user unchecks "Component State" but an error triggers `postLogWithSnapshot`, the snapshot still fires because `snapshot()` doesn't check the config.

**Fix:** Pass config and check `config.componentState` in `postLogWithSnapshot` before calling `snapshot()`.

### M5. `formatMarkdown` and helpers are global functions

**File:** `formatter/markdown-formatter.js`

All functions (`formatMarkdown`, `formatHeader`, `formatTime`, `escapeCell`, etc.) are in global scope. If any page happens to define the same function names and MAIN world scripts interact, there could be collisions. Since the formatter only runs in the offscreen doc, this is acceptable but wrapping in an IIFE would be cleaner.

### M6. Missing `"downloads"` permission validation

**File:** `manifest.json:6`

The `"downloads"` permission is declared, which is correct. However, if the user denies optional permissions in the future (if converted to optional), the download call will fail silently.

---

## Low Priority

### L1. `popup.js` does not restore checkbox state from saved config

When the popup reopens during recording, `GET_STATUS` returns `config` but the checkboxes are never updated to reflect it. They always default to all-checked.

### L2. CSS `:hover` on disabled `.btn-start.active`

**File:** `popup.css:50`

`.btn-start.active:hover` has no `:not(:disabled)` guard. Cosmetic only.

### L3. `<all_urls>` match pattern is very broad

**File:** `manifest.json:20,26`

Content scripts inject into every page including internal Chrome pages where they aren't useful. Consider narrowing to `http://*/*` and `https://*/*`.

### L4. `performance.now()` vs `Date.now()` inconsistency

Network capture uses `performance.now()` for duration (correct) but log keys in background.js use `Date.now()`. This is fine but worth noting for anyone debugging timestamp ordering.

---

## Security

### S1. Request/response bodies may contain auth tokens

**File:** `capture/network-capture.js:51-59`

Request and response bodies are logged with only length truncation. Authorization headers, JWT tokens in response bodies, and API keys in request payloads will be captured in the markdown export.

**Recommendation:** Apply the same `SENSITIVE_PATTERNS` regex from `user-action-capture.js` to network body content. At minimum, redact `Authorization` header values and scan bodies for common token patterns.

### S2. `window.postMessage(..., '*')` target origin

**Files:** `content-script.js:18`, `content-script-main.js:13,43`

Using `'*'` as target origin is standard for same-window communication between MAIN and ISOLATED worlds (they share the same origin). However, any page script can also listen for these messages and see captured debug data. Since the extension is for dev use, this is acceptable but should be documented.

### S3. No CSP on popup or offscreen pages

**Files:** `popup.html`, `offscreen.html`

Neither includes a Content-Security-Policy meta tag. MV3 provides a default CSP but explicitly setting one adds defense in depth.

---

## Positive Observations

1. Clean MAIN/ISOLATED world separation with signature-based message filtering
2. Good use of `try/catch` around all capture module start/stop calls
3. Sensible sensitive field masking in user-action-capture (password, token, etc.)
4. Markdown output is well-structured and readable for LLM consumption
5. `SKIP_MARKER` pattern prevents infinite recursion in console hooks
6. Proper `response.clone()` before reading body in fetch interceptor
7. Debounced input capture prevents flooding
8. `MAX_ENTRIES` cap on user actions prevents runaway storage

---

## Recommended Actions (Priority Order)

1. **[CRITICAL]** Fix C2: Move `chrome.downloads.download()` from offscreen.js to background.js -- export is currently broken
2. **[CRITICAL]** Fix C1: Ensure `endTime` is persisted before `sendResponse` in STOP_RECORDING
3. **[HIGH]** Fix H1: Add size-limited response body reading to prevent OOM on large responses
4. **[HIGH]** Fix H3: Add storage quota checking or entry count limit in background.js
5. **[MEDIUM]** Fix M4: Respect componentState config flag in snapshot trigger
6. **[MEDIUM]** Fix M1: Apply `escapeCell` consistently in markdown table generation
7. **[LOW]** Fix L1: Restore checkbox state from config on popup reopen
8. **[LOW]** Fix L3: Narrow `<all_urls>` to `http(s)://*/*`

---

## Unresolved Questions

1. Is the offscreen document approach intentional for future features (e.g., large file handling), or can formatting simply run in the service worker? If the latter, the offscreen doc can be removed entirely, simplifying the architecture.
2. Should network captures include ALL requests (not just errors/slow) by default? Current default only logs failures and slow requests, which is good for signal-to-noise but may miss context.
3. Is there a target for how long sessions should be? A 10+ minute recording on a busy SPA could hit storage limits.
