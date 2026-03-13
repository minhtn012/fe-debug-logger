# Phase 7: Integration Testing + Polish

## Context
- Depends on: All previous phases (1-6)
- Final phase before MVP release

## Overview
- **Priority:** P1
- **Status:** completed
- **Effort:** 0.5h

Wire all modules together, test end-to-end flow, fix edge cases, add error handling.

## Key Insights
- All capture modules are independent — integration mainly means ensuring message flow works end-to-end
- Main risk: service worker termination during recording. Mitigate with chrome.storage.session backup.
- Test on a real app (any React/Vue app) not just test pages

## Requirements
- All modules work together without conflicts
- Start → interact with page → Stop → Export produces valid Markdown
- Error handling: no crashes from unexpected page states
- Popup reflects accurate entry count during recording

## Implementation Steps

### 1. Wire All Capture Modules in `content-script-main.js`
```js
// Import all capture modules (concatenated or inline)
const captures = {
  console: createConsoleCapture(postLog),
  userAction: createUserActionCapture(postLog),
  network: createNetworkCapture(postLog),
  componentState: createComponentStateCapture(postLog),
};

function startCapture(config) {
  if (config.console) captures.console.start(config);
  if (config.userActions) captures.userAction.start(config);
  if (config.network) captures.network.start(config);
  if (config.componentState) captures.componentState.start();
}

// Wire: on console error → trigger component snapshot
// This is done by wrapping postLog or listening to log events in content-script-main.js
// so that console-capture does not need to know about componentState.

function stopCapture() {
  Object.values(captures).forEach(c => c.stop());
}
```

### 2. End-to-End Test Checklist
- [x] Load extension in Chrome (Developer mode, Load unpacked)
- [x] Open popup, verify all checkboxes checked
- [x] Click Start on a test page
- [x] Trigger: console.error, click elements, submit form, make failing API call
- [x] Click Stop
- [x] Click Export
- [x] Verify downloaded .md file has all sections populated
- [x] Verify sensitive values masked
- [x] Verify network bodies truncated
- [x] Verify component state captured (on React/Vue page)
- [x] Verify file is under 50KB

### 3. Error Handling Sweep
- [x] Wrap all capture module start/stop in try/catch
- [x] Handle edge cases:
  - Page with no interactive elements
  - Page with strict CSP (MAIN world injection blocked)
  - Page with no framework (component state gracefully skips)
  - Very rapid events (ensure debouncing works)
  - Page navigation during recording (content script re-injects)

### 4. Entry Count Updates
- [x] Background periodically (or on each LOG_ENTRY) updates badge/storage with count
- [x] Popup queries count on open to show "Recording... (42 events)"

### 5. Minor Polish
- [x] Add badge text on extension icon during recording ("REC" in red)
- [x] Clear log data on new Start (don't accumulate across sessions)
- [x] Add "Clear" button in popup to reset without exporting

## Todo
- [x] Wire all modules in content-script-main.js
- [x] Test end-to-end on a React app
- [x] Test end-to-end on a plain HTML page
- [x] Add try/catch error boundaries in all modules
- [x] Add badge text during recording
- [x] Add entry count display in popup
- [x] Add Clear button to popup
- [x] Verify CSP-restricted pages degrade gracefully
- [x] Final file size check on output

## Success Criteria
- Full flow works: Start → capture → Stop → Export → valid Markdown
- No console errors from extension itself
- Graceful degradation on restricted pages
- Entry count visible in popup during recording
- MVP ready for personal use

## Risk Assessment
- **Page navigation**: Content script may need re-injection. For MVP, recording supports SPA navigation (History/Hash API), but DOES NOT support full page reloads. Document this limitation.
- **Service worker sleep**: Long idle periods may terminate SW. For MVP (short sessions), this is acceptable.
