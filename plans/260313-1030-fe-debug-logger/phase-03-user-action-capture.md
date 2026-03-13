# Phase 3: User Action Capture Module

## Context
- Depends on: [Phase 1](./phase-01-scaffold-and-popup.md) (message infrastructure)
- Runs in: MAIN world (`content-script-main.js`)

## Overview
- **Priority:** P1
- **Status:** completed
- **Effort:** 1.5h

Capture user interactions via event delegation — clicks, input changes, form submissions, navigation events. Log as a sequential timeline.

## Key Insights
- Use event delegation on `document` with `capture: true` to catch all events before stopPropagation
- CSS selector path generation: walk up DOM tree, build `tag#id.class > tag.class` path
- Sensitive fields (type=password, name containing "token"/"secret"/"key") must be masked
- Debounce input events (user typing) — only log final value after 300ms pause
- Keep action log capped at last 200 entries to prevent memory bloat

## Requirements
- Capture events: click, input, change, submit, keydown (Enter/Escape only), popstate, hashchange
- Each entry: timestamp, event type, CSS selector path, tag name, text content (truncated), value (masked if sensitive)
- Input debouncing: 300ms, log only settled value
- Max 200 entries (FIFO)
- Mask inputs with type=password or name matching sensitive patterns

## Files to Create/Modify

| File | Action |
|------|--------|
| `capture/user-action-capture.js` | Create |
| `content-script-main.js` | Modify — register module |

## Implementation Steps

### 1. Create `capture/user-action-capture.js`

```js
function createUserActionCapture(postLog) {
  const MAX_ENTRIES = 200;
  let entries = [];
  let inputTimers = new Map(); // debounce per element
  let listeners = [];

  function start(config) {
    // Click
    addListener('click', (e) => {
      log({
        event: 'click',
        selector: getSelector(e.target),
        tag: e.target.tagName,
        text: truncate(e.target.textContent, 50),
      });
    });

    // Input (debounced)
    addListener('input', (e) => {
      debounceInput(e.target);
    });

    // Change
    addListener('change', (e) => {
      log({
        event: 'change',
        selector: getSelector(e.target),
        tag: e.target.tagName,
        value: maskIfSensitive(e.target, e.target.value),
      });
    });

    // Submit
    addListener('submit', (e) => {
      log({
        event: 'submit',
        selector: getSelector(e.target),
        action: e.target.action || '',
        method: e.target.method || 'GET',
      });
    });

    // Keydown (Enter/Escape only)
    addListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        log({ event: 'keydown', key: e.key, selector: getSelector(e.target) });
      }
    });

    // Navigation
    window.addEventListener('popstate', onPopstate);
    window.addEventListener('hashchange', onHashchange);
  }

  function stop() {
    listeners.forEach(([evt, fn]) => document.removeEventListener(evt, fn, true));
    listeners = [];
    window.removeEventListener('popstate', onPopstate);
    window.removeEventListener('hashchange', onHashchange);
    inputTimers.forEach(t => clearTimeout(t));
    inputTimers.clear();
  }

  return { start, stop };
}
```

### 2. CSS Selector Generator: `getSelector(el)`
- Walk up from target to document, collect up to 4 ancestors
- For each: `tagName` + `#id` (if exists) or `.className` (first 2 classes)
- Join with ` > `
- Example: `div#app > ul.nav-list > li.active > a`

### 3. Sensitive Field Detection: `maskIfSensitive(el, value)`
```js
const SENSITIVE_PATTERNS = /password|secret|token|key|credit|ssn|cvv/i;
function maskIfSensitive(el, value) {
  if (el.type === 'password' || SENSITIVE_PATTERNS.test(el.name) || SENSITIVE_PATTERNS.test(el.id)) {
    return '[MASKED]';
  }
  return truncate(value, 100);
}
```

### 4. Input Debouncer
- On each `input` event, clear previous timer for that element, set new 300ms timer
- On timer fire, log the settled value

### 5. Entry Schema
```js
{
  timestamp: "2026-03-13T10:30:00.000Z",
  event: "click" | "input" | "change" | "submit" | "keydown" | "navigate",
  selector: "div#app > button.submit-btn",
  tag: "BUTTON",
  text: "Submit Form",      // click only, truncated
  value: "[MASKED]",        // input/change only
  key: "Enter",             // keydown only
  url: "https://...",       // navigate only
}
```

## Todo
- [x] Create user-action-capture.js with event delegation
- [x] Implement CSS selector path generator
- [x] Implement sensitive field masking
- [x] Implement input debouncing (300ms)
- [x] Cap entries at 200 (FIFO)
- [x] Handle popstate/hashchange for SPA navigation
- [x] Wire into content-script-main.js
- [x] Test: click events capture correct selector
- [x] Test: password fields are masked
- [x] Test: rapid typing debounces to single entry

## Success Criteria
- All target events captured with readable selector paths
- Sensitive values masked automatically
- Input events debounced to reduce noise
- Action log stays under 200 entries
- SPA navigation changes logged

## Next Steps
→ Phase 4: Network capture
