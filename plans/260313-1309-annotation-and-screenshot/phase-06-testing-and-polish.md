# Phase 6: Testing + Polish

## Overview
- **Priority**: P2
- **Status**: Pending
- **Effort**: 1h
- **Depends on**: All previous phases

Manual testing, edge case fixes, syntax validation.

## Testing Checklist

### Annotation Flow
- [ ] Click Annotate → inspect mode activates (cursor, highlight)
- [ ] Hover elements → blue border highlight follows
- [ ] Click element → annotation form appears cạnh element
- [ ] Fill note, select severity, toggle tags → Save
- [ ] Verify entry in chrome.storage.local
- [ ] ESC closes form → back to inspect mode
- [ ] ESC again → exits inspect mode
- [ ] Multiple annotations in single session
- [ ] Annotate works WITHOUT recording active
- [ ] Annotate works WITH recording active (merges entries)

### Screenshot Flow
- [ ] Element screenshot: crops to correct bounds
- [ ] Full page screenshot: captures entire viewport
- [ ] Region select: drag overlay works, crops correctly
- [ ] Retina screen: screenshot at correct resolution
- [ ] Screenshot stored in chrome.storage.local

### DOM Snapshot
- [ ] outerHTML captured and truncated at 2KB
- [ ] 8 computed styles present
- [ ] Bounding rect accurate
- [ ] Visibility check correct for hidden elements

### Export Flow
- [ ] Export with annotations → subfolder created
- [ ] debug-log.md contains Annotations section
- [ ] Screenshot references resolve correctly
- [ ] PNG files in screenshots/ folder
- [ ] Export WITHOUT annotations → single file (backward compat)

### Edge Cases
- [ ] Annotation on fixed position elements
- [ ] Annotation on elements near viewport edges (form repositioning)
- [ ] Very small elements (< 10px)
- [ ] SVG elements
- [ ] Elements inside Shadow DOM
- [ ] Page with no React/Vue (annotation still works)
- [ ] Rapid multiple annotations
- [ ] annotation overlay doesn't appear in user-action logs

### Cross-site Testing
- [ ] Test on React app (e.g., react.dev)
- [ ] Test on Vue app (e.g., vuejs.org)
- [ ] Test on plain HTML page
- [ ] Test on complex page (e.g., GitHub, Twitter)

## Syntax Validation
```bash
node -c background.js
node -c content-script.js
node -c content-script-main.js
node -c popup.js
node -c offscreen.js
node -c capture/dom-snapshot-capture.js
node -c capture/annotation-capture.js
node -c capture/screenshot-capture.js
node -c capture/console-capture.js
node -c capture/user-action-capture.js
node -c capture/network-capture.js
node -c capture/component-state-capture.js
node -c formatter/markdown-formatter.js
```

## Polish Items
- [ ] Consistent error handling (try-catch with __fe_debug_logger__ marker)
- [ ] Clean up console.log statements
- [ ] Verify no console pollution
- [ ] Update version in manifest.json → 0.2.0
- [ ] Screenshot storage cleanup after export

## Success Criteria
- All checklist items pass
- Zero syntax errors across all JS files
- Extension loads without errors in Chrome
- No console pollution on test pages
- Export produces valid, complete debug reports
