---
title: "FE Debug Logger Chrome Extension"
description: "Chrome Extension that passively logs FE interactions and exports structured Markdown for Claude Code debugging"
status: completed
priority: P1
effort: 8h
branch: main
tags: [chrome-extension, debugging, developer-tools, mvp]
created: 2026-03-13
completed: 2026-03-13
---

# FE Debug Logger — Implementation Plan

## Overview

Chrome Extension (Manifest V3) that passively captures console errors, user actions, network requests, and component state, then exports a structured Markdown file optimized for Claude Code consumption.

**Architecture:**
```
popup.html/js       → UI: Start/Stop toggle + capture type checkboxes
content-script.js   → Injected into page, hooks console/events/network/framework
background.js       → Service worker: receives data, stores in chrome.storage.local
offscreen.html/js   → Creates Data URLs for massive file exports (bypassing SW limits)
```

**Key decisions:** Vanilla JS, no build tools, zero dependencies, download-based export.

## Phases

| # | Phase | Status | Effort | Files |
|---|-------|--------|--------|-------|
| 1 | [Extension scaffold + popup UI](./phase-01-scaffold-and-popup.md) | completed | 1h | manifest.json, popup.html, popup.js, popup.css, content-script.js, background.js |
| 2 | [Console capture module](./phase-02-console-capture.md) | completed | 1h | capture/console-capture.js |
| 3 | [User action capture module](./phase-03-user-action-capture.md) | completed | 1.5h | capture/user-action-capture.js |
| 4 | [Network capture module](./phase-04-network-capture.md) | completed | 1.5h | capture/network-capture.js |
| 5 | [Component state capture](./phase-05-component-state-capture.md) | completed | 1h | capture/component-state-capture.js |
| 6 | [Markdown formatter + download](./phase-06-markdown-formatter.md) | completed | 1.5h | formatter/markdown-formatter.js, background.js, offscreen.html, offscreen.js |
| 7 | [Integration + polish](./phase-07-integration-and-polish.md) | completed | 0.5h | all files |

## File Structure (Final)

```
extension-debug/
├── manifest.json
├── popup.html
├── popup.js
├── popup.css
├── background.js
├── offscreen.html
├── offscreen.js
├── content-script.js
├── content-script-main.js
├── capture/
│   ├── console-capture.js
│   ├── user-action-capture.js
│   ├── network-capture.js
│   └── component-state-capture.js
├── formatter/
│   └── markdown-formatter.js
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── plans/
```

## Data Flow

```
[Page] content-script-main.js (MAIN world) & content-script.js (ISOLATED world)
  ├─ console-capture.js     ─┐
  ├─ user-action-capture.js  ├─ chrome.runtime.sendMessage({...signature...}) ──→ background.js
  ├─ network-capture.js     ─┤                                    ├─ APPENDS to chrome.storage.local
  └─ component-state-capture ─┘                                    └─ triggers offscreen doc for EXPORT
                                                                              │
                                                                       offscreen.js
                                                                              ├─ formats to MD
                                                                              └─ triggers download via ObjectURL

popup.js ──→ chrome.tabs.sendMessage() ──→ content-script.js (start/stop)
popup.js ──→ chrome.runtime.sendMessage() ──→ background.js (export/status)
```

## Dependencies

- Phase 2-5 can be developed in parallel (independent capture modules)
- Phase 6 depends on Phase 1 (needs background.js message infrastructure)
- Phase 7 depends on all prior phases

## Constraints

- Manifest V3 (service worker, not background page)
- No external dependencies
- Mask sensitive inputs by default
- Truncate network bodies to 500 chars
- Target file size < 50KB per session
