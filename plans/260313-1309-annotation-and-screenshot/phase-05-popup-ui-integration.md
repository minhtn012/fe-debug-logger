# Phase 5: Popup UI + Integration

## Overview
- **Priority**: P2
- **Status**: Pending
- **Effort**: 1.5h
- **Depends on**: Phase 2 (annotation) + Phase 3 (screenshot)

Thêm Annotate button + Screenshot controls vào popup. Wire messages giữa popup ↔ background ↔ content script.

## Requirements

### Functional
- "Annotate" button: bật inspect mode trên active tab, popup đóng lại
- "Screenshot" button với dropdown: Full Page, Select Region
- Annotation count hiển thị cạnh entry count
- Annotate + Screenshot buttons hoạt động khi KHÔNG recording (standalone)
- Khi recording: annotate/screenshot entries merge vào log chung

### Non-Functional
- UI consistent với existing popup style
- Buttons disabled khi không có active tab

## Related Code Files

### Modify
- `popup.html` — add Annotate + Screenshot buttons
- `popup.js` — add button handlers, message sending
- `popup.css` — styles cho new buttons
- `background.js` — handle START_ANNOTATE, CAPTURE_FULL_PAGE from popup

## Implementation Steps

### Step 1: Update popup.html
Add sau `.controls` div:
```html
<div class="tools">
  <button id="annotateBtn" class="btn btn-annotate">Annotate</button>
  <div class="screenshot-group">
    <button id="screenshotBtn" class="btn btn-screenshot">Screenshot ▾</button>
    <div id="screenshotMenu" class="dropdown-menu hidden">
      <button id="ssFullPage" class="dropdown-item">Full Page</button>
      <button id="ssRegion" class="dropdown-item">Select Region</button>
    </div>
  </div>
</div>
```

### Step 2: Update popup.js
```javascript
// Annotate button — activates inspect mode
annotateBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_ANNOTATE' }, () => {
    window.close(); // Close popup so user can interact with page
  });
});

// Screenshot dropdown
screenshotBtn.addEventListener('click', () => {
  screenshotMenu.classList.toggle('hidden');
});
ssFullPage.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CAPTURE_FULL_PAGE' });
  window.close();
});
ssRegion.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'START_REGION_SELECT' });
  window.close();
});
```

### Step 3: Update popup.css
```css
.tools {
  display: flex; gap: 8px;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}
.btn-annotate { background: #8b5cf6; color: #fff; }
.btn-screenshot { background: #0ea5e9; color: #fff; }
.screenshot-group { position: relative; }
.dropdown-menu { position: absolute; top: 100%; /* ... */ }
.dropdown-menu.hidden { display: none; }
```

### Step 4: Update Background Message Handlers
Add handlers cho popup-triggered actions:
```javascript
if (msg.type === 'START_ANNOTATE') {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'START_ANNOTATE' });
  });
}
if (msg.type === 'CAPTURE_FULL_PAGE') {
  handleScreenshot({ mode: 'full' }, /* tabId */);
}
if (msg.type === 'START_REGION_SELECT') {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'START_REGION_SELECT' });
  });
}
```

### Step 5: Update GET_STATUS Response
Include annotation count:
```javascript
if (msg.type === 'GET_STATUS') {
  chrome.storage.session.get(['recording', 'config', 'annotationCount'], (data) => {
    sendResponse({
      recording: !!data.recording,
      entryCount: entryCounter,
      annotationCount: data.annotationCount || 0,
      config: data.config || null,
    });
  });
  return true;
}
```

### Step 6: Annotation Count Display
Show annotation count trong popup:
```javascript
const annotationCountEl = document.getElementById('annotationCount');
// In updateUI():
annotationCountEl.textContent = annotationCount > 0
  ? `${annotationCount} annotation${annotationCount !== 1 ? 's' : ''}`
  : '';
```

## Todo List
- [ ] Update `popup.html` — add Annotate + Screenshot buttons + dropdown
- [ ] Update `popup.js` — button handlers for annotate, full page, region
- [ ] Update `popup.css` — styles for new buttons + dropdown
- [ ] Update `background.js` — handle START_ANNOTATE, CAPTURE_FULL_PAGE, START_REGION_SELECT from popup
- [ ] Update GET_STATUS to include annotationCount
- [ ] Add annotation count display in popup
- [ ] Syntax check popup.js

## Success Criteria
- Annotate button activates inspect mode and closes popup
- Screenshot dropdown shows Full Page + Select Region options
- Full Page screenshot captures and stores correctly
- Region select activates overlay on page
- Annotation count updates in popup
- All buttons work both during recording and idle state
