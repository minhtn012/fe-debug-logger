# Phase 1: DOM Snapshot Module

## Overview
- **Priority**: P1 (foundation cho annotation)
- **Status**: Pending
- **Effort**: 1.5h

Capture outerHTML, computed styles, bounding rect, visibility state cho element được chọn. Module standalone, reusable bởi annotation capture.

## Key Insights
- `getComputedStyle()` trả về tất cả CSS props → capture ~20 key props covering visibility + layout + typography
- `outerHTML` có thể rất lớn (nested elements) → truncate 2KB
- Event listener detection ko khả thi without DevTools protocol → skip cho MVP
- Cần chạy trong MAIN world để access DOM
- **data-* attributes** (data-testid, data-cy, data-component...) là manh mối vàng cho Claude grep source code — bắt buộc capture
- Parent chain 7 levels (thay vì 3) kèm data-*/id/aria-label → selector unique hơn cho Claude

## Requirements

### Functional
- Capture `outerHTML` (truncated 2KB)
- Capture ~20 computed styles grouped by purpose:
  - **Visibility**: display, visibility, opacity, pointer-events, cursor, z-index
  - **Layout**: position, overflow, flex-direction, justify-content, align-items, gap, flex-wrap
  - **Box Model**: margin, padding, width, height, box-sizing
  - **Typography**: font-size, line-height, color
- Capture `getBoundingClientRect()` → x, y, width, height
- Visibility check: element visible hay hidden
- Parent chain: **7 levels up**, capture tag + classes + id + data-* + aria-label
- **Identifier attributes**: Capture tất cả `data-*` attributes, `id`, `name`, `aria-label`, `role` trên element — giúp Claude grep source code

### Non-Functional
- Không block main thread (snapshot nhanh < 10ms)
- Không throw error nếu element bị remove giữa chừng

## Related Code Files

### Create
- `capture/dom-snapshot-capture.js` (~80 LOC)

### Reference (existing patterns)
- `capture/component-state-capture.js` — factory pattern, depth limiting
- `capture/user-action-capture.js` — `getSelector()` function

## Implementation Steps

1. Tạo `capture/dom-snapshot-capture.js` với factory pattern `createDomSnapshotCapture()`
2. Implement `captureSnapshot(element)`:
   ```javascript
   function captureSnapshot(element) {
     return {
       selector: getSelector(element),
       outerHTML: truncateHTML(element.outerHTML, 2048),
       identifiers: captureIdentifiers(element),
       computedStyles: captureStyles(element),
       boundingRect: captureBoundingRect(element),
       visibility: checkVisibility(element),
       parentChain: captureParentChain(element, 7),
     };
   }
   ```
3. Implement helper functions:
   - `captureIdentifiers(el)` — collect id, name, data-*, aria-label, role attributes
   - `captureStyles(el)` — `getComputedStyle()` cho ~20 props (visibility + layout + box model + typography)
   - `captureBoundingRect(el)` — `getBoundingClientRect()` → plain object
   - `checkVisibility(el)` — offsetParent, opacity, display check
   - `captureParentChain(el, depth)` — walk up 7 levels, return tag + classes + id + data-* + aria-label
   - `truncateHTML(html, max)` — substring + close truncation marker
   - `getSelector(el)` — copy từ user-action-capture.js hoặc extract shared util
4. Return object: `{ captureSnapshot }`

### getSelector Duplication
`getSelector()` đã tồn tại trong `user-action-capture.js`. 2 options:
- **Option A**: Copy function (simple, DRY violation nhỏ, zero coupling)
- **Option B**: Extract thành shared `utils/selector.js`

**Decision**: Option A cho MVP. Function nhỏ (15 lines), duplication acceptable. Refactor later nếu cần.

## Todo List
- [ ] Create `capture/dom-snapshot-capture.js`
- [ ] Implement `captureSnapshot(element)` function
- [ ] Implement `captureStyles()` — 8 key computed styles
- [ ] Implement `captureBoundingRect()` — x, y, width, height
- [ ] Implement `checkVisibility()` — compound visibility check
- [ ] Implement `captureParentChain()` — 3 levels up
- [ ] Implement `truncateHTML()` — max 2KB
- [ ] Implement `getSelector()` — CSS selector path (copy from user-action-capture)
- [ ] Add to `manifest.json` content_scripts MAIN world array
- [ ] Syntax check: `node -c capture/dom-snapshot-capture.js`

## Success Criteria
- `captureSnapshot(document.querySelector('button'))` returns complete object
- outerHTML truncated at 2KB boundary
- Computed styles chỉ chứa 8 relevant props
- Không throw error khi element = null
- File < 100 LOC

## Risk Assessment
- **Low risk**: Straightforward DOM API usage, no async, no external deps
- **Edge case**: SVG elements, iframes, Shadow DOM elements → graceful fallback (return partial data)
