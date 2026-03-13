# Phase 3: Screenshot Capture Module

## Overview
- **Priority**: P1
- **Status**: Pending
- **Effort**: 3h
- **Depends on**: Phase 2 (annotation triggers screenshot)

3 screenshot modes: element crop, full viewport, region select. Zero dependencies — dùng `chrome.tabs.captureVisibleTab()` + Canvas API crop trong offscreen document.

## Key Insights
- `captureVisibleTab()` chỉ capture visible viewport → element phải visible trên screen
- Canvas crop trong offscreen document: nhận dataUrl + cropRect → draw lên canvas → export cropped
- Region select cần overlay canvas trên page để user drag vùng chọn
- Screenshots lưu tạm trong `chrome.storage.local` dưới dạng dataUrl → export gom lại
- `captureVisibleTab` cần `activeTab` permission (đã có) — KHÔNG cần thêm `tabs` permission

## Requirements

### Functional
- **Element mode**: Capture + crop single element theo bounding rect
- **Full page mode**: Capture entire visible viewport as-is
- **Region mode**: User drag-select vùng trên page → capture + crop
- Screenshots lưu với reference ID mapping tới annotation
- Support capture khi KHÔNG có annotation (standalone screenshot từ popup)
- **Max 5 screenshots per session** — warn user khi đạt limit, block thêm

### Non-Functional
- Crop chính xác ±2px (account for devicePixelRatio)
- Không block page interaction ngoài region select mode
- Handle high-DPI screens (retina: devicePixelRatio = 2)

## Architecture

### Screenshot Pipeline
```
1. Content script gửi REQUEST_SCREENSHOT { mode, cropRect, annotationId }
     ↓
2. ISOLATED bridge relay → background
     ↓
3. Background: chrome.tabs.captureVisibleTab(null, { format: 'png' })
     → returns dataUrl of full viewport
     ↓
4. Background → offscreen: CROP_SCREENSHOT { dataUrl, cropRect, dpr, id }
     ↓
5. Offscreen: Canvas load image → crop → toDataURL('image/png')
     → sends SCREENSHOT_READY { croppedDataUrl, id }
     ↓
6. Background: store in chrome.storage.local as screenshot_<id>
```

### devicePixelRatio Handling
```
captureVisibleTab returns image at physical pixels (e.g., 2x on retina)
cropRect from getBoundingClientRect() is in CSS pixels

Conversion:
  canvas.width = cropRect.width * devicePixelRatio
  canvas.height = cropRect.height * devicePixelRatio
  ctx.drawImage(img,
    cropRect.x * dpr, cropRect.y * dpr,    // source position (physical)
    cropRect.width * dpr, cropRect.height * dpr,  // source size (physical)
    0, 0,                                    // dest position
    cropRect.width * dpr, cropRect.height * dpr   // dest size (physical)
  )
```

## Related Code Files

### Create
- `capture/screenshot-capture.js` (~120 LOC) — MAIN world coordinator for region select UI

### Modify
- `background.js` — handle REQUEST_SCREENSHOT, call captureVisibleTab, route to offscreen
- `offscreen.js` — add CROP_SCREENSHOT handler with Canvas crop logic
- `content-script.js` — relay REQUEST_SCREENSHOT message
- `content-script-main.js` — integrate screenshot module (region select overlay)

### Reference
- `capture/annotation-capture.js` (Phase 2) — triggers element screenshot
- `offscreen.js` — existing PROCESS_EXPORT pattern

## Implementation Steps

### Step 1: Screenshot Capture Module (MAIN world)
Create `capture/screenshot-capture.js`:
```javascript
function createScreenshotCapture(postMessage) {
  let regionSelectActive = false;
  // Region select overlay + drag logic
  return {
    requestElementScreenshot(element, annotationId) { },
    requestFullPageScreenshot() { },
    startRegionSelect() { },
    stop() { },
  };
}
```

### Step 2: Element Screenshot (with context padding)
- Receive element reference from annotation-capture
- Get `element.getBoundingClientRect()` → rawRect
- **Add proportional padding**: 30% of element size, min 20px, max 100px per side
  ```javascript
  function addContextPadding(rect) {
    const padX = Math.min(100, Math.max(20, rect.width * 0.3));
    const padY = Math.min(100, Math.max(20, rect.height * 0.3));
    return {
      x: Math.max(0, rect.x - padX),
      y: Math.max(0, rect.y - padY),
      width: Math.min(window.innerWidth - rect.x + padX, rect.width + padX * 2),
      height: Math.min(window.innerHeight - rect.y + padY, rect.height + padY * 2),
    };
  }
  ```
- Get `window.devicePixelRatio` → dpr
- Scroll element into view nếu partially hidden: `element.scrollIntoViewIfNeeded()`
- Small delay (50ms) sau scroll để browser render
- Post message: `REQUEST_SCREENSHOT { mode: 'element', cropRect: paddedRect, dpr, annotationId }`

### Step 3: Full Page Screenshot
- Simplest mode: no crop needed
- Post message: `REQUEST_SCREENSHOT { mode: 'full', dpr }`
- Background captures + stores directly (skip offscreen crop)

### Step 4: Region Select
- Inject overlay canvas (full viewport, semi-transparent)
- `mousedown` → start point
- `mousemove` → draw selection rectangle (dashed border)
- `mouseup` → end point → calculate cropRect
- Remove overlay
- Post message: `REQUEST_SCREENSHOT { mode: 'region', cropRect, dpr }`
- ESC cancels region select

### Step 5: Background Handler
Add to `background.js`:
```javascript
if (msg.type === 'REQUEST_SCREENSHOT') {
  handleScreenshot(msg, sender.tab.id);
  return false;
}

async function handleScreenshot(msg, tabId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  if (msg.mode === 'full') {
    // Store directly
    const id = `screenshot_${Date.now()}`;
    await chrome.storage.local.set({ [id]: { dataUrl, mode: 'full', annotationId: msg.annotationId } });
    return;
  }
  // Send to offscreen for cropping
  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: '...' });
  }
  chrome.runtime.sendMessage({
    type: 'CROP_SCREENSHOT',
    dataUrl, cropRect: msg.cropRect, dpr: msg.dpr,
    screenshotId: `screenshot_${Date.now()}`,
    annotationId: msg.annotationId,
  });
}
```

### Step 6: Offscreen Crop Handler
Add to `offscreen.js`:
```javascript
if (msg.type === 'CROP_SCREENSHOT') {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const { x, y, width, height } = msg.cropRect;
    const dpr = msg.dpr || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img,
      x * dpr, y * dpr, width * dpr, height * dpr,
      0, 0, width * dpr, height * dpr
    );
    const croppedUrl = canvas.toDataURL('image/png');
    chrome.storage.local.set({
      [msg.screenshotId]: { dataUrl: croppedUrl, annotationId: msg.annotationId, mode: 'element' }
    });
  };
  img.src = msg.dataUrl;
}
```

### Step 7: Content Script Bridge Updates
Update `content-script.js` to relay `REQUEST_SCREENSHOT`.

## Storage Schema
```javascript
// Screenshot entries in chrome.storage.local
{
  "screenshot_1710324540000": {
    dataUrl: "data:image/png;base64,...",
    annotationId: "annotation_1710324539500",  // link to annotation entry
    mode: "element" | "full" | "region",
  }
}
```

## Todo List
- [ ] Create `capture/screenshot-capture.js` with factory pattern
- [ ] Implement `requestElementScreenshot()` — getBoundingClientRect + scrollIntoView + post message
- [ ] Implement `requestFullPageScreenshot()` — post message (no crop)
- [ ] Implement `startRegionSelect()` — overlay canvas + drag handlers
- [ ] Implement ESC to cancel region select
- [ ] Update `background.js` — REQUEST_SCREENSHOT handler + captureVisibleTab
- [ ] Update `offscreen.js` — CROP_SCREENSHOT handler with Canvas crop
- [ ] Update `content-script.js` — relay REQUEST_SCREENSHOT
- [ ] Update `content-script-main.js` — integrate screenshot module
- [ ] Add `capture/screenshot-capture.js` to manifest.json MAIN world scripts
- [ ] Handle devicePixelRatio for retina screens
- [ ] Syntax check all modified files

## Success Criteria
- Element screenshot crops accurately to element bounds (±2px)
- Full page screenshot captures entire viewport
- Region select: drag box visible, crop matches selection
- Retina screens: output at physical pixel resolution
- Screenshots stored in chrome.storage.local with annotation linkage
- No page interaction blocked outside region select mode

## Risk Assessment
- **captureVisibleTab timing**: Small delay between request and capture → element might change. Mitigation: 50ms is acceptable, not a major concern.
- **Storage size**: Base64 PNG screenshots are large (~500KB-2MB each). Mitigation: limit to 10 screenshots per session, warn user.
- **Region select UX**: Drag interaction complex. Mitigation: implement last, element + full page cover 90% use cases.
- **Cross-origin iframes**: Elements inside iframes won't be captured correctly by captureVisibleTab (captures top-level viewport). Accept limitation, document it.
