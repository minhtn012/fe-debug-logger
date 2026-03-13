# Brainstorm: Annotation + Screenshot Features cho FE Debug Logger

## Problem Statement

Extension hiện tại chỉ capture passive data (console, network, actions, component state). FE dev cần cách **chủ động annotate bug** trên page — chỉ vào element cụ thể, ghi note, chụp ảnh — để Claude Code có context visual + semantic khi debug.

## Requirements

- Inspect mode element picker (giống DevTools)
- 3 screenshot modes: element crop, full viewport, region select
- Annotation form: note + severity + tags + DOM snapshot
- Output: subfolder structure với PNG riêng + MD reference
- Zero external dependencies (chỉ Chrome APIs)

## Feature 1: Element Annotation (Inspect Mode)

### UX Flow
1. Click "Annotate" button trên popup (hoặc keyboard shortcut)
2. Page vào inspect mode: cursor → crosshair, hover → blue border highlight
3. Click element → mini form overlay hiện cạnh element
4. Fill: note text, severity (critical/major/minor), tags (UI/Logic/API/Style/+custom)
5. Toggle: ☑ Screenshot, ☑ DOM snapshot
6. Save → entry thêm vào log, form đóng, tiếp tục annotate hoặc exit

### Form Fields
```
┌─────────────────────────┐
│ Bug Note                │
│ ┌─────────────────────┐ │
│ │ [textarea]          │ │
│ └─────────────────────┘ │
│ Severity: [Critical ▼]  │
│ Tags: [UI] [Logic] [+]  │
│ ☑ Screenshot  ☑ DOM     │
│ [Save]  [Cancel]        │
└─────────────────────────┘
```

### Technical Approach
- **Overlay injection**: Inject overlay div vào page (MAIN world) với z-index cao
- **Element picker**: `mousemove` listener + `outline` style trên hovered element
- **Form**: Injected div, positioned relative to element `getBoundingClientRect()`
- **CSS selector**: Reuse `buildSelector()` từ `user-action-capture.js`
- **ESC to exit**: Keyboard listener thoát inspect mode

### Data Output (Log Entry)
```javascript
{
  category: 'annotation',
  type: 'bug-note',
  selector: 'div.container > button.btn-submit',
  note: 'Click không phản hồi gì',
  severity: 'critical',
  tags: ['UI', 'Logic'],
  screenshotRef: 'screenshots/annotation-001.png',  // nếu có
  domSnapshot: {
    outerHTML: '<button class="btn-submit" disabled>...',  // truncated 2KB
    computedStyles: { display, visibility, opacity, pointerEvents, cursor, zIndex },
    boundingRect: { x, y, width, height },
    eventListeners: ['click', 'mousedown']  // nếu detect được
  },
  timestamp: '2026-03-13T13:09:00.000Z'
}
```

### DOM Snapshot Details
Capture khi toggle DOM = ON:
- `element.outerHTML` (truncated 2KB)
- Key computed styles: `display`, `visibility`, `opacity`, `pointer-events`, `cursor`, `z-index`, `position`, `overflow`
- `getBoundingClientRect()` → x, y, width, height
- Visibility check: `offsetParent !== null`, `opacity > 0`
- **Event listeners**: Khó detect native. Có thể check `getEventListeners()` (chỉ DevTools) hoặc skip. Alternative: check React/Vue event handlers qua fiber/instance.

## Feature 2: Screenshot Capture

### 3 Modes

#### Mode 1: Element Screenshot
- **Trigger**: Toggle "Screenshot" trong annotation form
- **API**: `chrome.tabs.captureVisibleTab()` → full viewport PNG
- **Crop**: Dùng OffscreenCanvas/Canvas API crop theo `element.getBoundingClientRect()`
- **Xử lý**: Content script gửi rect → background capture → offscreen crop → save

#### Mode 2: Full Page Screenshot
- **Trigger**: Nút riêng trên popup hoặc annotation form
- **API**: `chrome.tabs.captureVisibleTab()` → save nguyên
- **Đơn giản nhất**: Không cần crop

#### Mode 3: Region Select
- **Trigger**: Chọn "Region" mode
- **UX**: Cursor → crosshair, user drag vùng chọn (hiện selection overlay)
- **Capture**: `captureVisibleTab()` → crop theo user-selected rect
- **Implementation**: Overlay canvas, mousedown → mousemove → mouseup → rect coordinates

### Screenshot Pipeline
```
1. Content script gửi crop rect (hoặc "full") → background
2. Background: chrome.tabs.captureVisibleTab({ format: 'png' })
3. Background → offscreen document: dataUrl + cropRect
4. Offscreen: Canvas crop nếu cần → output cropped dataUrl
5. Background: chrome.downloads.download({ url: dataUrl, filename: ... })
```

### File Output Structure
```
~/Downloads/fe-debug-2026-03-13T130900/
├── debug-log.md
└── screenshots/
    ├── annotation-001.png     (element crop)
    ├── annotation-002.png     (element crop)
    ├── region-001.png         (region select)
    └── full-page-001.png      (viewport)
```

MD reference: `![annotation-001](screenshots/annotation-001.png)`

## Feature 3: DOM Snapshot (kèm Annotation)

### Captured Data
| Property | Source | Truncate |
|----------|--------|----------|
| outerHTML | `element.outerHTML` | 2KB |
| Computed styles | `getComputedStyle()` — 8 key props | No |
| Bounding rect | `getBoundingClientRect()` | No |
| Visibility | offsetParent, opacity check | No |
| Parent chain | 3 levels up, tag + classes only | No |

### MD Output Format
```markdown
### Annotation #1 — Critical [UI, Logic]

**Element:** `button.btn-submit`
**Note:** Click không phản hồi gì

**Screenshot:** ![](screenshots/annotation-001.png)

**DOM Snapshot:**
```html
<button class="btn-submit" disabled>Submit</button>
```

| Property | Value |
|----------|-------|
| display | flex |
| visibility | visible |
| opacity | 1 |
| pointer-events | none ← BUG! |
| cursor | pointer |
| z-index | auto |
| position | relative |
| overflow | visible |
| bounding | 120x40 @ (350, 620) |
```

## Architecture Changes

### New Files
```
capture/
├── annotation-capture.js       # Inspect mode + form + data collection
├── screenshot-capture.js       # 3 screenshot modes + crop logic
├── dom-snapshot-capture.js     # outerHTML + styles + rect capture
```

### Modified Files
- `manifest.json` — thêm permissions nếu cần
- `content-script-main.js` — integrate annotation module
- `background.js` — handle ANNOTATION_ENTRY, CAPTURE_SCREENSHOT messages
- `offscreen.js` — canvas crop logic
- `formatter/markdown-formatter.js` — thêm Annotations section
- `popup.html/js/css` — thêm Annotate button + screenshot controls

### New Message Types
| Type | Direction | Data |
|------|-----------|------|
| START_ANNOTATE | popup → bg → content | — |
| STOP_ANNOTATE | popup → bg → content | — |
| ANNOTATION_ENTRY | content → bg | annotation data |
| CAPTURE_SCREENSHOT | content → bg | mode, cropRect |
| SCREENSHOT_READY | offscreen → bg | dataUrl, filename |
| CAPTURE_FULL_PAGE | popup → bg | — |

### Permissions Check
- `chrome.tabs.captureVisibleTab()` — cần permission `activeTab` (đã có)
- `chrome.downloads.download()` — cần `downloads` permission (đã có)
- **Không cần thêm permissions mới**

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Element picker conflict với page event handlers | Annotation ko hoạt động trên một số pages | `stopPropagation` + `preventDefault` trong inspect mode, restore khi exit |
| `captureVisibleTab` chỉ capture visible viewport | Element nằm ngoài viewport ko crop đúng | Scroll element vào view trước khi capture, hoặc warn user |
| Region select UX phức tạp | User khó dùng | Fallback: element screenshot đủ cho hầu hết cases |
| Canvas crop trong offscreen document | MV3 restrictions | Canvas API hoạt động trong offscreen, đã test với export pipeline hiện tại |
| Form overlay bị page CSS override | Form hiển thị sai | Dùng Shadow DOM cho form isolation |
| Large screenshots (4K monitors) | File lớn, download chậm | Resize/compress PNG trước khi save, cap ở 1920px width |

## Implementation Priority

1. **P1: Element Annotation** — Inspect mode + form + annotation log entries
2. **P2: Element Screenshot** — Crop single element, save PNG
3. **P3: DOM Snapshot** — outerHTML + computed styles capture
4. **P4: Full Page Screenshot** — Simplest, just captureVisibleTab
5. **P5: Region Select** — Most complex UX, do last
6. **P6: Export Integration** — Subfolder structure + MD references

## KISS Considerations

- **Region select** là complex nhất → có thể defer sang v0.3 nếu element + full page đủ dùng
- **Shadow DOM** cho form overlay là nice-to-have nhưng thêm complexity → test trước với regular div + high specificity CSS
- **Event listener detection** rất khó without DevTools protocol → skip cho MVP, chỉ capture static DOM info
- **Screenshot compression** → defer, PNG raw đủ tốt cho debug purpose

## Success Metrics

- Annotate 1 element < 5 seconds (click → note → save)
- Screenshot crop chính xác ±2px
- DOM snapshot chứa đủ info để Claude identify CSS/layout bugs
- Export workflow: 1 click → folder with MD + screenshots
- Zero impact lên page functionality khi không ở inspect mode

## Next Steps

- Tạo implementation plan phased approach
- Phase 1: Annotation capture module + inspect mode UI
- Phase 2: Screenshot capture (element + full page)
- Phase 3: DOM snapshot integration
- Phase 4: Region select screenshot
- Phase 5: Export pipeline update (subfolder + MD formatter)
- Phase 6: Popup UI updates + polish
