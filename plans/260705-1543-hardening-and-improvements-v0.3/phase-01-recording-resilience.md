# Phase 01: Recording Resilience (extension side)

**Ưu tiên**: Critical — bug lớn nhất hiện tại
**Status**: IMPLEMENTED (2026-07-05) — chờ manual validation (load unpacked)
**Files sở hữu**: `content-script.js`, `content-script-main.js`, `background.js`
**Không đụng**: `mcp-server/*` (phase 02/03 sở hữu)

## Kết quả triển khai (2026-07-05)

- Step 1: tái dùng handler `GET_STATUS` (đã trả kèm `config`) — không thêm handler mới.
- Step 2: `content-script.js` handshake `GET_STATUS` khi init → nếu `recording` → postMessage `START_CAPTURE` xuống MAIN.
- Step 3/4: `startRecording` broadcast `START_CAPTURE` tới các tab **trong cửa sổ recording** (`recordingWindowId` = windowId tab active; quyết định user: scope theo cửa sổ, không phủ mọi cửa sổ — privacy). `stopRecording` broadcast `STOP_CAPTURE` tới **mọi tab** (an toàn, đảm bảo tab từng resume đều dừng). Auto-resume (`GET_STATUS`) cũng scope theo `recordingWindowId`: content script cửa sổ khác không resume; popup/UI vẫn thấy state thật.
- Step 5: `MAX_ENTRIES = 2000` + cờ `entryLimitWarned` → ghi đúng 1 entry cảnh báo rồi drop; reset ở `startRecording`/`CLEAR_LOG`; khôi phục trên SW wake (`entryCounter > MAX_ENTRIES`).
- Step 6: PAGE_META đổi sang **first-url-wins** (giải quyết ý định plan "url đầu tiên thắng" — bản gốc thực chất last-wins → multi-tab sẽ clobber url phiên). userAgent/viewport để last-wins (không mang ý nghĩa theo tab).
- **Fix phát sinh từ code review (H1)**: thêm idempotency guard `if (recording) return` vào `startCapture()`/`stopCapture()` (MAIN world) — chặn double-wrap console/fetch khi broadcast đua với auto-resume handshake.

**Follow-up (không thuộc phase này)**:
- Capture giờ phủ mọi tab trong cửa sổ recording (không chỉ tab active) → PRIVACY.md nên phản ánh (phase-04).

## Vấn đề

1. **Recording chết sau reload/navigation**: state `recording` ở `content-script-main.js:5` chỉ nằm trong memory MAIN world. Reload trang → content script mới load → không ai gửi lại `START_CAPTURE` → capture âm thầm dừng dù badge vẫn REC. Đây cũng là gốc của known issue "timing gap trước khi recording bắt đầu".
2. **Chỉ ghi tab active lúc Start**: `startRecording()` (`background.js:384-390`) chỉ gửi `START_CAPTURE` cho tab active. User chuyển tab / mở tab mới → mất capture.
3. **Không giới hạn entries**: `storeNewEntry()` (`background.js:353`) ghi vô hạn vào `chrome.storage.local` (quota ~10MB) → tràn quota, ghi fail âm thầm.

## Thiết kế

**Auto-resume qua handshake khi content script init** (không cần permission mới):

```
Page load → content-script.js (ISOLATED) gửi GET_RECORDING_STATE → background
         → background trả { recording, config } từ chrome.storage.session
         → nếu recording: bridge postMessage START_CAPTURE xuống MAIN world
```

MAIN world modules đã load sẵn (manifest inject `document_start`) nên chỉ cần kích hoạt lại. Cách này đồng thời fix luôn multi-tab: MỌI tab có content script đều tự hỏi và tự start → recording phủ mọi tab đang mở + tab mở mới.

**Lưu ý thứ tự init**: content-script-main.js chạy ở `document_start`; message listener của nó phải đăng ký xong trước khi ISOLATED bridge gửi START_CAPTURE. Cả hai cùng `document_start` và ISOLATED phải chờ response async từ background nên thực tế MAIN luôn sẵn sàng trước — vẫn nên test edge case này.

## Steps

1. `background.js`: thêm handler `GET_RECORDING_STATE` trong `chrome.runtime.onMessage` — đọc `chrome.storage.session.get(['recording', 'config'])`, trả `{ recording, config }`. (Handler `GET_STATUS` hiện tại đã gần giống — có thể tái dùng, thêm `config` vào response nếu thiếu.)
2. `content-script.js` (ISOLATED bridge): khi init, gọi `chrome.runtime.sendMessage({ type: 'GET_STATUS' })`; nếu `recording === true` → `window.postMessage({ __source: 'fe-debug-logger', type: 'START_CAPTURE', config })`.
3. `background.js` `startRecording()`: đổi `chrome.tabs.query({ active: true, currentWindow: true })` → gửi `START_CAPTURE` tới **tất cả** tabs (`chrome.tabs.query({})`, loop + `.catch(() => {})` cho tab không có content script như chrome://). Giữ nguyên logic lấy `sessionMeta.url` từ tab active.
4. `background.js` `stopRecording()`: tương tự, gửi `STOP_CAPTURE` tới tất cả tabs.
5. `background.js` `storeNewEntry()`: thêm `MAX_ENTRIES = 2000`; khi `entryCounter >= MAX_ENTRIES` → bỏ qua entry mới, ghi 1 entry cảnh báo duy nhất "entry limit reached" (dedup để không lặp).
6. Cập nhật `sessionMeta.url`: khi tab khác gửi `PAGE_META` (đã có handler `background.js:257`), giữ hành vi hiện tại (url đầu tiên thắng) — không đổi.

## Validation

- Manual (load unpacked): Start recording → reload trang → gây `console.error` → Stop → entry sau reload có mặt trong export.
- Start recording → mở tab mới → gây lỗi ở tab mới → entry được ghi.
- Trang chrome:// / Web Store mở sẵn không gây lỗi khi Start (sendMessage catch).
- Ghi > MAX_ENTRIES entries (script vòng lặp console.error với message khác nhau) → dừng ở cap + 1 entry cảnh báo, không crash.

## Rủi ro & rollback

- Multi-tab capture có thể tăng volume entries đáng kể trên user có nhiều tab → cap MAX_ENTRIES (step 5) là guard. Nếu gây nhiễu, có thể thêm config `activeTabOnly` sau (không thuộc phase này).
- Rollback: revert commit — không có migration state.
