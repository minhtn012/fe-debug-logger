# Phase 6: Markdown Formatter + Download

## Context
- Depends on: [Phase 1](./phase-01-scaffold-and-popup.md) (background.js infrastructure)
- Consumes data from: Phases 2-5 (all capture modules)
- Runs in: Service worker (`background.js`) AND Offscreen Document (`offscreen.html`/`offscreen.js`)

## Overview
- **Priority:** P1
- **Status:** completed
- **Effort:** 1.5h

Format collected log entries into structured Markdown optimized for Claude Code consumption, and trigger file download.

## Key Insights
- Markdown output must be scannable — Claude works best with clear headers, tables, and code blocks
- Group entries by category (console, actions, network, state) not chronologically
- Include metadata header for context (URL, time range, viewport, user agent)
- Service Workers cannot use `URL.createObjectURL` and Data URIs have strict size limits, causing crashes on large exports.
- **Solution:** Use MV3 Offscreen Documents to format and download massive files via standard DOM Blob APIs.
- Filename format: `debug-log-{domain}-{timestamp}.md`

## Requirements
- Format sections: Header, User Actions (table), Console Errors (code blocks), Network (per-request), Component State (tree)
- Header: page URL, recording start/end time, browser info, viewport size
- Download as .md file via Chrome downloads API
- Filename: `debug-log-{domain}-{YYYYMMDD-HHmmss}.md`
- Total output under 50KB target

## Files to Create/Modify

| File | Action |
|------|--------|
| `formatter/markdown-formatter.js` | Create |
| `background.js` | Modify — handle EXPORT_LOG message to create Offscreen Doc |
| `offscreen.html` | Create — HTML that includes `<script src="formatter/markdown-formatter.js"></script>` and `<script src="offscreen.js"></script>` |
| `offscreen.js` | Create — Receives exported logs, formats MD, downloads via blob |

## Implementation Steps

### 1. Markdown Template Structure

```markdown
# FE Debug Log

## Session Info
| Field | Value |
|-------|-------|
| URL | https://example.com/app |
| Time | 2026-03-13 10:30:00 → 10:35:42 |
| Duration | 5m 42s |
| Browser | Chrome 122.0.6261.94 |
| Viewport | 1920x1080 |

---

## User Actions (23 events)

| Time | Event | Element | Details |
|------|-------|---------|---------|
| 10:30:05 | click | `button.login-btn` | "Log In" |
| 10:30:08 | input | `input#email` | value: "user@..." |
| 10:30:12 | submit | `form.login-form` | POST /api/login |
| ... | ... | ... | ... |

---

## Console Errors (3 errors)

### Error 1 — TypeError at 10:30:15
```
TypeError: Cannot read property 'user' of undefined
    at AuthProvider.render (auth.js:42:15)
    at processChild (react-dom.js:1234:5)
```

### Error 2 — Unhandled Rejection at 10:30:15
```
Error: Network request failed
    at fetch.then.catch (api.js:88:11)
```

---

## Network Issues (2 requests)

### POST /api/login — 500 Internal Server Error (1234ms)
**Request Body:**
```json
{"email":"user@example.com","password":"[MASKED]"}
```
**Response Body:**
```json
{"error":"Database connection timeout","code":"DB_TIMEOUT"}
```

### GET /api/user/profile — 404 Not Found (89ms)
**Response Body:**
```json
{"error":"User not found"}
```

---

## Component State (React)

```
App
├─ AuthProvider { isLoggedIn: false, user: null }
│  └─ LoginForm { email: "user@...", submitting: true }
│     ├─ EmailInput { value: "user@...", error: null }
│     └─ PasswordInput { value: "[MASKED]", error: null }
└─ ErrorBoundary { hasError: true }
```
```

### 2. Formatter Functions

```js
// formatter/markdown-formatter.js

function formatMarkdown(logData) {
  const { meta, entries } = logData;
  const sections = [];

  sections.push(formatHeader(meta));
  sections.push(formatUserActions(entries.filter(e => e.category === 'action')));
  sections.push(formatConsoleErrors(entries.filter(e => e.category === 'console')));
  sections.push(formatNetworkIssues(entries.filter(e => e.category === 'network')));
  sections.push(formatComponentState(entries.filter(e => e.category === 'state')));

  return sections.filter(Boolean).join('\n\n---\n\n');
}

function formatHeader(meta) { /* session info table */ }
function formatUserActions(actions) { /* markdown table */ }
function formatConsoleErrors(errors) { /* heading + code blocks */ }
function formatNetworkIssues(requests) { /* per-request sections */ }
function formatComponentState(states) { /* ASCII tree */ }
```

### 3. ASCII Tree Renderer (for Component State)
```js
function renderTree(node, prefix = '', isLast = true) {
  const connector = isLast ? '└─ ' : '├─ ';
  const propsStr = node.props ? ' ' + JSON.stringify(node.props) : '';
  let result = prefix + connector + node.name + propsStr + '\n';

  const childPrefix = prefix + (isLast ? '   ' : '│  ');
  (node.children || []).forEach((child, i) => {
    result += renderTree(child, childPrefix, i === node.children.length - 1);
  });
  return result;
}
```

### 4. Download Trigger in `background.js` & `offscreen.js`

**In background.js:**
```js
// In background.js message handler:
case 'EXPORT_LOG':
  // Fetch logs from storage
  const data = await chrome.storage.local.get(['logs', 'sessionMeta']);

  // Create offscreen document
  if (!await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Generate and download large markdown debug files'
    });
  }

  // Send data to offscreen document
  chrome.runtime.sendMessage({
    type: 'PROCESS_EXPORT',
    data: data
  });
  break;
```

**In offscreen.js:**
```js
// Import formatter, then:
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === 'PROCESS_EXPORT') {
    const markdown = formatMarkdown({
      meta: msg.data.sessionMeta,
      entries: msg.data.logs,
    });

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const domain = new URL(msg.data.sessionMeta.url).hostname.replace(/\./g, '-');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    await chrome.downloads.download({
      url: url,
      filename: `debug-log-${domain}-${timestamp}.md`,
      saveAs: false,
    });

    // Close offscreen doc when done
    window.close();
  }
});
```

### 5. Time Formatting Helpers
```js
function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-US', { hour12: false });
}
function formatDuration(startISO, endISO) {
  const ms = new Date(endISO) - new Date(startISO);
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
```

## Todo
- [x] Create markdown-formatter.js with all section formatters
- [x] Implement header section (session info table)
- [x] Implement user actions table formatter
- [x] Implement console errors formatter (code blocks with stack traces)
- [x] Implement network issues formatter (per-request sections)
- [x] Implement component state ASCII tree renderer
- [x] Create `offscreen.html` and `offscreen.js`
- [x] Implement `background.js` Offscreen document creation
- [x] Implement ObjectURL blob generation inside `offscreen.js`
- [x] Test: format with all sections populated
- [x] Test: format with empty sections (graceful skip)
- [x] Test: output handles massive log array without crashing
- [x] Test: download triggers and file saves correctly

## Success Criteria
- Markdown output is well-structured and Claude-readable
- Empty sections omitted (no "0 entries" sections)
- Download works reliably via Chrome downloads API
- Filename is descriptive and unique
- Output stays under 50KB for typical 5-min debug session

## Risk Assessment
- **Offscreen Permissions**: Requires the `offscreen` permission in Manifest.
- **Service worker limitations**: We've bypassed the limitations regarding Data URLs and `URL.createObjectURL` by delegating Blob creation to the `offscreen.html` context.

## Next Steps
→ Phase 7: Integration testing + polish
