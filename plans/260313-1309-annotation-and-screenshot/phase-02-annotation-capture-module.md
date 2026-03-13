# Phase 2: Annotation Capture Module

## Overview
- **Priority**: P1 (core feature)
- **Status**: Pending
- **Effort**: 3h
- **Depends on**: Phase 1 (DOM snapshot)

Inspect mode element picker + overlay annotation form. User hover → highlight → click → ghi note + severity + tags. Entry gửi về background qua existing message pipeline.

## Key Insights
- Form overlay phải isolate CSS từ host page → **Shadow DOM** là giải pháp tốt nhất
- Element picker cần `stopPropagation` + `preventDefault` để tránh trigger page handlers
- ESC key thoát inspect mode bất kỳ lúc nào
- Form position tính từ `getBoundingClientRect()` của element, adjust nếu overflow viewport
- Annotation entries có category riêng: `'annotation'` (tách biệt với existing categories)

## Requirements

### Functional
- Bật/tắt inspect mode từ popup hoặc keyboard shortcut
- Hover highlight: blue dashed border 2px trên element
- Click chọn element → mini form hiện cạnh element
- Form fields: textarea (note), severity dropdown (critical/major/minor), tag chips (UI/Logic/API/Style + custom)
- Checkboxes: Screenshot (default ON), DOM snapshot (default ON)
- Save → tạo annotation entry + trigger screenshot nếu checked
- Cancel / ESC → đóng form, quay lại inspect mode
- Multiple annotations trong 1 session
- Exit inspect mode: ESC khi không có form, hoặc nút X
- **Keyboard shortcut**: `Ctrl+Shift+A` (via `chrome.commands`) bật/tắt inspect mode không cần popup
- **Block navigation**: `preventDefault()` trên tất cả click events trong inspect mode để user không bị redirect

### Non-Functional
- Form không bị page CSS ảnh hưởng (Shadow DOM)
- Z-index cao (999999) để always on top
- Không capture annotation form interactions trong user-action-capture

## Architecture

### Message Flow
```
Popup → background → content-script (ISOLATED) → MAIN world
  START_ANNOTATE / STOP_ANNOTATE

MAIN world (annotation entry) → ISOLATED bridge → background
  ANNOTATION_ENTRY { annotation data + optional domSnapshot }

MAIN world → ISOLATED bridge → background
  REQUEST_SCREENSHOT { mode: 'element', cropRect: {...} }
```

### Overlay Structure
```
<div id="__fe_debug_annotation_root__">
  #shadow-root (open)
    <style>/* isolated CSS */</style>
    <div class="highlight-overlay"></div>  <!-- element highlight -->
    <div class="annotation-form">          <!-- form popup -->
      <textarea />
      <select /> (severity)
      <div class="tags" /> (chips)
      <div class="options" /> (checkboxes)
      <div class="actions" /> (Save/Cancel)
    </div>
</div>
```

## Related Code Files

### Create
- `capture/annotation-capture.js` (~180 LOC)
- `annotation-overlay.css` (inline trong JS via Shadow DOM, không cần file riêng)

### Modify
- `content-script-main.js` — add annotation module init + message handling
- `content-script.js` — relay START_ANNOTATE, STOP_ANNOTATE, ANNOTATION_ENTRY, REQUEST_SCREENSHOT
- `manifest.json` — add `capture/annotation-capture.js` to MAIN world scripts

### Reference
- `capture/dom-snapshot-capture.js` (Phase 1) — snapshot integration
- `capture/user-action-capture.js` — getSelector pattern, skip annotation interactions

## Implementation Steps

1. **Create `capture/annotation-capture.js`** với factory pattern:
   ```javascript
   function createAnnotationCapture(postLog) {
     let active = false;
     let shadowRoot = null;
     let selectedElement = null;
     // ...
     return { start, stop, isActive };
   }
   ```

2. **Implement Shadow DOM overlay injection**:
   - Create container div với id `__fe_debug_annotation_root__`
   - Attach shadow root (open mode)
   - Inject styles + form HTML vào shadow root
   - Append to `document.body`

3. **Implement element picker (inspect mode)**:
   - `mousemove` listener trên document (capture phase)
   - Highlight: apply outline style trên hovered element
   - Remove highlight khi move sang element khác
   - Skip annotation overlay elements (check `__fe_debug_annotation_root__`)
   - `click` listener: `preventDefault()` + `stopPropagation()` → select element

4. **Implement annotation form**:
   - Position form cạnh selected element (prefer right, fallback left/top/bottom)
   - Fields:
     - `<textarea>` — bug note (required, placeholder "Describe the issue...")
     - `<select>` — severity: critical, major, minor (default: major)
     - Tag chips — preset: UI, Logic, API, Style. Click to toggle. "+" button for custom tag
     - `<input type="checkbox">` — Screenshot (default checked)
     - `<input type="checkbox">` — DOM Snapshot (default checked)
   - Buttons: Save, Cancel

5. **Implement Save handler**:
   ```javascript
   function saveAnnotation() {
     const domSnapshot = domSnapshotCheckbox.checked
       ? domSnapshotCapture.captureSnapshot(selectedElement)
       : null;
     const entry = {
       category: 'annotation',
       type: 'bug-note',
       selector: getSelector(selectedElement),
       note: textarea.value,
       severity: severitySelect.value,
       tags: getSelectedTags(),
       wantScreenshot: screenshotCheckbox.checked,
       domSnapshot: domSnapshot,
       timestamp: new Date().toISOString(),
     };
     postLog('annotation', entry);
     if (entry.wantScreenshot) {
       requestScreenshot(selectedElement);
     }
     closeForm();
     // Stay in inspect mode for next annotation
   }
   ```

6. **Implement screenshot request**:
   - Get element `getBoundingClientRect()`
   - Post message `REQUEST_SCREENSHOT` với cropRect + annotationIndex
   - Background handles actual capture (Phase 3)

7. **Implement ESC handler**:
   - If form open → close form, back to inspect mode
   - If inspect mode (no form) → exit annotation mode entirely

8. **Implement `stop()`**:
   - Remove all event listeners
   - Remove shadow root container from DOM
   - Reset state

9. **Skip annotation interactions**:
   - User-action-capture needs to ignore clicks/inputs inside annotation overlay
   - Add check: if `event.target` is inside `__fe_debug_annotation_root__`, skip logging

## Form CSS (Shadow DOM inline)

```css
:host { all: initial; }
.annotation-form {
  position: fixed;
  background: #fff;
  border: 2px solid #3b82f6;
  border-radius: 8px;
  padding: 12px;
  width: 280px;
  font-family: -apple-system, sans-serif;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 999999;
}
/* ... more styles */
```

## Todo List
- [ ] Create `capture/annotation-capture.js` with factory pattern
- [ ] Implement Shadow DOM overlay injection
- [ ] Implement element picker (mousemove highlight + click select)
- [ ] Implement annotation form (note + severity + tags + checkboxes)
- [ ] Implement form positioning logic (viewport-aware)
- [ ] Implement Save handler (create entry + trigger screenshot request)
- [ ] Implement Cancel / ESC handlers
- [ ] Implement stop() cleanup
- [ ] Update `content-script-main.js` — init annotation module, handle START/STOP_ANNOTATE
- [ ] Update `content-script.js` — relay START_ANNOTATE, STOP_ANNOTATE, ANNOTATION_ENTRY, REQUEST_SCREENSHOT
- [ ] Update `manifest.json` — add annotation-capture.js + dom-snapshot-capture.js to MAIN world
- [ ] Update `user-action-capture.js` — skip events inside annotation overlay
- [ ] Add `chrome.commands` to manifest.json — Ctrl+Shift+A shortcut
- [ ] Add command listener in `background.js` — toggle annotate mode
- [ ] Syntax check all modified files

## Success Criteria
- Click Annotate → inspect mode activates (crosshair cursor, highlight on hover)
- Click element → form appears cạnh element
- Fill note + save → entry logged (verify in chrome.storage)
- ESC closes form / exits mode
- Form CSS không bị page CSS override
- Multiple annotations trong 1 session

## Risk Assessment
- **Shadow DOM**: Well-supported Chrome 88+. Low risk.
- **Event interception**: `stopPropagation` trong capture phase có thể conflict với page frameworks → test on React/Vue apps
- **Form positioning**: Edge case khi element ở corner viewport → fallback centering
- **Large pages**: Element picker performance trên pages với nhiều elements → mousemove đã lightweight, low risk

## Security
- Note text: sanitize trước khi store (no script injection vào MD output)
- DOM snapshot outerHTML: truncate prevents excessive data
