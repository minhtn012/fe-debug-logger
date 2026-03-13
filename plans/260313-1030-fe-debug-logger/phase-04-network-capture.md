# Phase 4: Network Capture Module

## Context
- Depends on: [Phase 1](./phase-01-scaffold-and-popup.md) (message infrastructure)
- Runs in: MAIN world (`content-script-main.js`)

## Overview
- **Priority:** P1
- **Status:** completed
- **Effort:** 1.5h

Intercept `fetch` and `XMLHttpRequest` to log network requests — focusing on failed (4xx/5xx) and slow (>3s) requests, with option to log all.

## Key Insights
- Must monkey-patch both `window.fetch` and `XMLHttpRequest.prototype.open/send`
- Save original references, restore on stop
- Clone response bodies before reading (response can only be read once for fetch)
- Truncate request/response bodies to 500 chars
- Calculate duration using performance.now() or Date.now()
- Filter: by default log only failed + slow. Config option `logAllNetwork: true` for everything.

## Requirements
- Intercept: fetch API and XMLHttpRequest
- Log: method, URL, status, duration (ms), request headers (select), request body (truncated), response body (truncated)
- Default filter: status >= 400 OR duration > 3000ms
- Config toggle: log all requests
- Truncate bodies to 500 chars
- Skip logging extension's own requests (chrome-extension:// URLs)

## Files to Create/Modify

| File | Action |
|------|--------|
| `capture/network-capture.js` | Create |
| `content-script-main.js` | Modify — register module |

## Implementation Steps

### 1. Fetch Interceptor

```js
function createNetworkCapture(postLog) {
  let origFetch, origXhrOpen, origXhrSend;
  const SLOW_THRESHOLD = 3000; // ms, configurable
  let logAll = false;

  function start(config) {
    logAll = config.logAllNetwork || false;

    // --- Fetch ---
    origFetch = window.fetch;
    window.fetch = async function(input, init = {}) {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('chrome-extension://')) {
        return origFetch.apply(this, arguments);
      }

      const method = init.method || (input.method) || 'GET';
      const reqBody = truncateBody(init.body);
      const startTime = performance.now();

      try {
        const response = await origFetch.apply(this, arguments);
        const duration = Math.round(performance.now() - startTime);
        const shouldLog = logAll || response.status >= 400 || duration > SLOW_THRESHOLD;

        if (shouldLog) {
          // Clone to read body without consuming
          const clone = response.clone();
          let resBody = '';
          try { resBody = truncateBody(await clone.text()); } catch {}

          postLog('network', {
            timestamp: new Date().toISOString(),
            type: 'fetch',
            method, url,
            status: response.status,
            statusText: response.statusText,
            duration,
            requestBody: reqBody,
            responseBody: resBody,
          });
        }
        return response;
      } catch (error) {
        // Network error (no response)
        postLog('network', {
          timestamp: new Date().toISOString(),
          type: 'fetch',
          method, url,
          status: 0,
          statusText: 'Network Error',
          duration: Math.round(performance.now() - startTime),
          requestBody: reqBody,
          responseBody: '',
          error: error.message,
        });
        throw error;
      }
    };
  }
}
```

### 2. XMLHttpRequest Interceptor

```js
// Inside start():
origXhrOpen = XMLHttpRequest.prototype.open;
origXhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._feDebug = { method, url, startTime: 0 };
  return origXhrOpen.apply(this, [method, url, ...rest]);
};

XMLHttpRequest.prototype.send = function(body) {
  if (this._feDebug && !this._feDebug.url.startsWith('chrome-extension://')) {
    this._feDebug.startTime = performance.now();
    this._feDebug.requestBody = truncateBody(body);

    this.addEventListener('loadend', () => {
      const duration = Math.round(performance.now() - this._feDebug.startTime);
      const shouldLog = logAll || this.status >= 400 || duration > SLOW_THRESHOLD;

      if (shouldLog) {
        postLog('network', {
          timestamp: new Date().toISOString(),
          type: 'xhr',
          method: this._feDebug.method,
          url: this._feDebug.url,
          status: this.status,
          statusText: this.statusText,
          duration,
          requestBody: this._feDebug.requestBody,
          responseBody: truncateBody(this.responseText),
        });
      }
    });
  }
  return origXhrSend.apply(this, arguments);
};
```

### 3. Body Truncation
```js
function truncateBody(body) {
  if (!body) return '';
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  if (!str) return '';
  return str.length > 500 ? str.substring(0, 500) + '...[truncated]' : str;
}
```

### 4. Stop / Restore
```js
function stop() {
  window.fetch = origFetch;
  XMLHttpRequest.prototype.open = origXhrOpen;
  XMLHttpRequest.prototype.send = origXhrSend;
}
```

### 5. Entry Schema
```js
{
  timestamp: "2026-03-13T10:30:00.000Z",
  type: "fetch" | "xhr",
  method: "POST",
  url: "https://api.example.com/users",
  status: 500,
  statusText: "Internal Server Error",
  duration: 1234,  // ms
  requestBody: '{"name":"John"}',
  responseBody: '{"error":"Database connection failed"}...[truncated]',
  error: "Network Error",  // only for fetch failures
}
```

## Todo
- [x] Create network-capture.js
- [x] Implement fetch interceptor with response cloning
- [x] Implement XHR interceptor (open + send)
- [x] Implement body truncation (500 chars)
- [x] Filter: failed (4xx/5xx) + slow (>3s) by default
- [x] Config toggle for logging all requests
- [x] Skip chrome-extension:// URLs
- [x] Restore originals on stop
- [x] Wire into content-script-main.js
- [x] Test: failed fetch request captured
- [x] Test: slow request captured
- [x] Test: successful fast request NOT captured (unless logAll)
- [x] Test: XHR requests captured
- [x] Test: network error (offline) captured

## Success Criteria
- Both fetch and XHR intercepted transparently
- Failed and slow requests logged by default
- Bodies truncated to prevent bloat
- Original functions restored cleanly on stop
- No interference with normal page network behavior

## Risk Assessment
- **Response body reading**: Some responses (blobs, streams) may fail to read as text — wrap in try/catch, log empty body
- **Service worker fetch**: Extension's own fetches won't go through page's fetch — no conflict

## Next Steps
→ Phase 5: Component state capture
