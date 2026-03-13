# Phase 5: Component State Capture Module

## Context
- Depends on: [Phase 1](./phase-01-scaffold-and-popup.md) (message infrastructure)
- Runs in: MAIN world (`content-script-main.js`)

## Overview
- **Priority:** P2 — nice-to-have, graceful skip if no framework
- **Status:** completed
- **Effort:** 1h

Auto-detect React/Vue and capture component tree state at error time. Provide useful context for debugging framework-specific issues.

## Key Insights
- React: `__REACT_DEVTOOLS_GLOBAL_HOOK__` presence indicates React. Fiber nodes accessible via `_reactFiber$*` or `__reactFiber$*` properties on DOM elements
- Vue: `__VUE_DEVTOOLS_GLOBAL_HOOK__` or `__vue__` / `__vue_app__` on root elements
- Don't capture continuously — only snapshot on demand (triggered by console error or manual export)
- Walking full component tree is expensive — limit depth to 5 levels, props truncated
- This module is optional — if detection fails, skip silently

## Requirements
- Auto-detect: React (16+), Vue (2.x, 3.x)
- On error/export: snapshot component tree from nearest error boundary or root
- Capture per component: name, props (top-level keys + truncated values), state (top-level keys)
- Max tree depth: 5 levels
- Graceful fallback: log "No framework detected" and skip

## Files to Create/Modify

| File | Action |
|------|--------|
| `capture/component-state-capture.js` | Create |
| `content-script-main.js` | Modify — register module |

## Implementation Steps

### 1. Framework Detection

```js
function detectFramework() {
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size > 0) return 'react';
  if (document.querySelector('[data-reactroot]') || document.querySelector('#__next')) return 'react';
  if (window.__VUE_DEVTOOLS_GLOBAL_HOOK__) return 'vue';
  if (document.querySelector('[data-v-]')) return 'vue';
  return null;
}
```

### 2. React Component Tree Walker

```js
function getReactTree(rootEl, maxDepth = 5) {
  // Find fiber node
  const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('_reactFiber$'));
  if (!fiberKey) return null;

  const fiber = rootEl[fiberKey];
  return walkFiber(fiber, 0, maxDepth);
}

function walkFiber(fiber, depth, maxDepth) {
  if (!fiber || depth >= maxDepth) return null;

  const isComponent = typeof fiber.type === 'function' || typeof fiber.type === 'object';
  const node = isComponent ? {
    name: fiber.type?.displayName || fiber.type?.name || 'Anonymous',
    props: summarizeObject(fiber.memoizedProps, 3),
    state: fiber.memoizedState ? summarizeState(fiber.memoizedState) : null,
    children: [],
  } : null;

  // Walk children
  let child = fiber.child;
  while (child) {
    const childNode = walkFiber(child, node ? depth + 1 : depth, maxDepth);
    if (childNode && node) node.children.push(childNode);
    child = child.sibling;
  }

  return node;
}
```

### 3. Vue Component Tree Walker

```js
function getVueTree(rootEl, maxDepth = 5) {
  // Vue 3
  const app = rootEl.__vue_app__;
  if (app) return walkVue3(app._instance, 0, maxDepth);

  // Vue 2
  const vm = rootEl.__vue__;
  if (vm) return walkVue2(vm, 0, maxDepth);

  return null;
}

function walkVue3(instance, depth, maxDepth) {
  if (!instance || depth >= maxDepth) return null;
  return {
    name: instance.type?.name || instance.type?.__name || 'Anonymous',
    props: summarizeObject(instance.props, 3),
    state: summarizeObject(instance.setupState || instance.data, 3),
    children: (instance.subTree?.children || [])
      .filter(c => c.component)
      .map(c => walkVue3(c.component, depth + 1, maxDepth))
      .filter(Boolean),
  };
}
```

### 4. Object Summarizer
```js
function summarizeObject(obj, maxKeys = 5) {
  if (!obj || typeof obj !== 'object') return null;
  const keys = Object.keys(obj).slice(0, maxKeys);
  const result = {};
  for (const key of keys) {
    if (key.startsWith('__') || key.startsWith('$$')) continue; // skip internals
    const val = obj[key];
    if (typeof val === 'function') result[key] = '[Function]';
    else if (typeof val === 'object' && val !== null) result[key] = `[${Array.isArray(val) ? `Array(${val.length})` : 'Object'}]`;
    else result[key] = String(val).substring(0, 100);
  }
  return result;
}
```

### 5. Capture Trigger

```js
function createComponentStateCapture(postLog) {
  let framework = null;

  function start() {
    framework = detectFramework();
    if (framework) {
      postLog('state', {
        timestamp: new Date().toISOString(),
        type: 'framework-detected',
        framework,
      });
    }
  }

  // Called on error or export — not continuous
  function snapshot() {
    if (!framework) return null;

    const root = document.getElementById('root') || document.getElementById('app') || document.getElementById('__next') || document.body.firstElementChild;
    if (!root) return null;

    const tree = framework === 'react' ? getReactTree(root) : getVueTree(root);
    if (tree) {
      postLog('state', {
        timestamp: new Date().toISOString(),
        type: 'component-snapshot',
        framework,
        tree,
      });
    }
    return tree;
  }

  function stop() { framework = null; }

  return { start, stop, snapshot };
}
```

### 6. Integration with Console Capture
- `content-script-main.js` will wrap the `postLog` method passed to `console-capture`.
- When `console-capture` emits an error log, the wrapper in `content-script-main.js` will automatically trigger `componentStateCapture.snapshot()`. This keeps the two capture modules fully independent.

## Todo
- [x] Create component-state-capture.js
- [x] Implement framework detection (React 16+, Vue 2/3)
- [x] Implement React fiber tree walker (depth-limited)
- [x] Implement Vue instance tree walker (v2 + v3)
- [x] Implement object summarizer with truncation
- [x] Wire snapshot trigger on console errors
- [x] Wire into content-script-main.js
- [x] Test: React app — component tree captured
- [x] Test: Vue app — component tree captured
- [x] Test: Plain HTML page — graceful skip
- [x] Test: snapshot triggered on console.error

## Success Criteria
- React and Vue detected automatically
- Component tree captured with props/state summaries
- Depth limited to 5 levels
- Graceful no-op when no framework detected
- Snapshot triggered on errors for contextual debugging

## Risk Assessment
- **React internals**: Fiber structure can change between versions. Wrap everything in try/catch.
- **Performance**: Tree walking on large apps could be slow. Depth limit + key limit mitigates this.
- **Private properties**: Accessing `_reactFiber$*` is undocumented. Works reliably but not guaranteed across all React versions.

## Next Steps
→ Phase 6: Markdown formatter + download
