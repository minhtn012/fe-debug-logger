# FE Debug Logger — Project Overview & Requirements

## Purpose

FE Debug Logger is a Chrome extension that automatically captures and exports frontend debugging information as structured Markdown. It enables developers to systematically document frontend issues—including console errors, user actions, network requests, and component state—in a format optimized for AI-assisted debugging with Claude Code.

## Target Users

- **Frontend Developers**: Debugging complex React/Vue applications with hard-to-reproduce issues
- **QA Engineers**: Documenting bug reports with complete frontend context
- **Technical Support**: Capturing user environment data for support tickets

## Key Features

### v0.1.0 (Current)

- **Console Capture**: Hooks `console.error`, `console.warn`, `window.onerror`, unhandled promise rejections
- **User Action Tracking**: Records clicks, form inputs, navigation, keyboard events with DOM selectors
- **Network Monitoring**: Logs HTTP errors (status >= 400) and slow requests (> 3 seconds)
- **Component State Snapshots**: Auto-detects React/Vue and captures component props/state trees
- **Markdown Export**: Generates structured debug log with session metadata, formatted tables, and error stacks
- **Selective Capture**: Toggle capture categories (console, actions, network, component state)
- **Sensitive Data Masking**: Automatically masks password/token fields in user inputs

### Data Export

- **Format**: Structured Markdown with sections for console errors, user actions, network issues, component state
- **Metadata**: Session info table (URL, time, duration, browser, viewport)
- **Storage**: Chrome Storage API (session state + local entries)
- **Download**: Automatic browser download with timestamp filename

## Functional Requirements

### FR1: Capture System
- Record multiple event types (console, network, UI, component) without impacting page performance
- Maintain configurable entry limits to prevent unbounded memory growth
- Preserve event sequence and timestamps for reconstruction
- Support both React and Vue framework detection

### FR2: UI Control
- Popup interface with Start/Stop/Export/Clear buttons
- Selectable capture categories (4 toggles)
- Real-time entry counter
- Visual status indicator (Idle/Recording/Exported)

### FR3: Data Export
- Generate valid Markdown with proper escaping and formatting
- Include session context (URL, time, browser, viewport, user agent)
- Format sections: Session Info (table), User Actions (table), Console Errors (code blocks), Network Issues (JSON), Component State (tree)
- Trigger browser download to user's default location

### FR4: Privacy & Performance
- Mask sensitive fields (password, token, secret, apiKey, etc.) in user inputs
- Skip chrome-extension:// URLs to avoid capturing extension traffic
- Limit individual entries (e.g., response body 1KB, network entries 200+)
- Use ISOLATED content script for Chrome API access without affecting page performance

## Non-Functional Requirements

### NFR1: Compatibility
- Chrome 88+ (Manifest V3)
- Works on all websites (<all_urls> content script)
- No external dependencies (vanilla JavaScript)

### NFR2: Performance
- Capture modules must not block main thread
- Network debouncing for high-frequency events
- Offscreen document for Blob creation (MV3 limitation)

### NFR3: Storage
- Session recording state survives service worker restart
- Log entries persist across popup closes
- Max reasonable storage per session: ~5-10 MB (typical debug logs)

### NFR4: User Experience
- Extension should be transparent to page functionality
- No console pollution (logs prefixed with __fe_debug_logger__)
- Export completes within 2 seconds for typical sessions

## Architecture Decisions

### Dual Content Script Pattern
- **ISOLATED world script** (content-script.js): Access to Chrome APIs, bridges to background
- **MAIN world scripts** (content-script-main.js + capture modules): Direct access to console, fetch, XMLHttpRequest, framework internals

### Storage Strategy
- `chrome.storage.session`: Recording state + entry counter (ephemeral, survives SW restart)
- `chrome.storage.local`: Log entries + session metadata (persistent across sessions)

### Export Pipeline
1. Background gathers all log entries from chrome.storage.local
2. Creates offscreen document (MV3 requirement for Blob creation)
3. Offscreen runs markdown-formatter to generate Markdown
4. Offscreen creates data URL from Blob
5. Background downloads file using chrome.downloads API

### Message Flow
- MAIN world (capture events) → ISOLATED world (postMessage) → Background (chrome.runtime.sendMessage)
- Background (commands) → ISOLATED world (chrome.runtime.onMessage) → MAIN world (postMessage)

## Success Metrics

- **Adoption**: Users export debug logs for 80%+ of reported issues
- **Quality**: Debug logs contain sufficient context to identify root cause without follow-up questions
- **Performance**: No measurable impact on page load/interaction metrics
- **Reliability**: 100% successful export for sessions under 10MB

## Technical Constraints

- **Manifest V3**: No content script page access to background context, no DOM in service worker
- **CORS**: Network capture limited to same-origin requests (XHR) or observable requests (fetch)
- **Framework Detection**: Limited to React Fiber trees and Vue instance trees; other frameworks not auto-detected
- **Storage Quota**: Limited to ~10 MB per extension (Chrome sync storage independent)

## Future Enhancements

- Local file storage option (without requiring Downloads permission)
- Custom field masking rules
- Network request body capture with size limits
- Screenshot/video capture integration
- Remote logging/webhook support
- Better support for Vue 2 vs 3 detection
- Support for other frameworks (Angular, Svelte, etc.)

## Dependencies

- **Chrome APIs**: tabs, runtime, storage (session + local), downloads, offscreen, action
- **No external npm packages** — vanilla JavaScript for portability

## Acceptance Criteria

✓ Extension loads without errors in Chrome 88+
✓ Start/Stop buttons control recording state
✓ Export generates valid Markdown with all sections populated
✓ Captured data survives service worker restart
✓ No console pollution (extension errors logged only)
✓ Sensitive fields masked in user action logs
✓ Component state captured for React and Vue apps
