# Phase 03: MCP Token Efficiency

**Ưu tiên**: High — khớp mục tiêu token efficiency của project
**Status**: DONE (2026-07-06) — validated (default output = 9.1% JSON cũ; summary/filter/tail đúng)
**Files sở hữu**: `mcp-server/index.js`, `mcp-server/markdown-formatter.js`
**Phụ thuộc**: Phase 02 (cùng file `index.js`, tránh conflict)

## Kết quả triển khai (2026-07-06)

- Helpers thuần: `summarizeEntries(entries, shownCount)` (tổng quan full session + "Showing last N of M"), `filterEntries(entries, {tail=50, level})` (level chỉ áp console, non-console luôn giữ; rồi slice tail), `renderLogMarkdown()` (summary + markdown subset).
- `get-debug-log`: thêm zod params `tail`/`level`/`includeScreenshots`. Nhánh **live** (GET_LOG qua WS) → `renderLogMarkdown` thay `JSON.stringify`, screenshots opt-in. Nhánh **file-based (zip)**: zip chỉ chứa markdown render sẵn (không có entries) → tail/level **không áp được**, chỉ honor `includeScreenshots` (đã ghi rõ trong description).
- `get-live-log`: thêm `tail`/`level`/`includeScreenshots`; đọc `liveEntries` in-memory (filter/tail/summary) khi có, file `debug-log.md` chỉ là fallback.
- `stop-recording`: bỏ khối `JSON.stringify` → `renderLogMarkdown` tail 50 + hint text; `includeScreenshots` default false.
- `markdown-formatter.js` (mcp) hoá ra chỉ là wrapper load `formatter/markdown-formatter.js` chung — **không phải bản trùng**, không cần đụng.
- **Fix từ code review**:
  - **M1**: summary full-session vs count nội bộ của formatMarkdown (subset) mâu thuẫn → thêm 1 dòng disclaimer "_Section counts below reflect only the shown window_" khi bị cắt.
  - **L1**: "Showing last N" → "Showing last N of M" cho chính xác khi level lọc.

**Validation (ALL PASS)**: session 200 entries → default tail 50, summary số liệu đúng; `level:error` chỉ console error (network/action giữ); `level:warn` chỉ console warn; `includeScreenshots:false` default không kèm ảnh; output default = 9.1% JSON dump cũ (<20%).

## Vấn đề

- `stop-recording` và `get-debug-log` dump **toàn bộ** entries dạng `JSON.stringify(entries, null, 2)` — session vài trăm entries ngốn context rất nhiều.
- `stop-recording`, `get-debug-log`, `get-live-log` đính kèm **tất cả** screenshots dạng image mặc định — trái với nguyên tắc "screenshots opt-in" đã chốt trước đó.

## Thiết kế

**Nguyên tắc**: mặc định trả tóm tắt gọn; chi tiết và ảnh là opt-in qua params.

Params chung cho `get-debug-log` và `get-live-log` (và output của `stop-recording`):

| Param | Type | Default | Ý nghĩa |
|-------|------|---------|---------|
| `tail` | number | 50 | Chỉ trả N entries cuối |
| `level` | enum `all\|error\|warn` | `all` | Lọc console entries theo mức |
| `includeScreenshots` | boolean | `false` | Đính kèm ảnh dạng image content |

Format output: markdown qua `formatMarkdown()` (đã có, gọn hơn JSON pretty-print) thay vì raw JSON. Header luôn có tổng quan: tổng entries, số theo category (console/network/userAction/componentState), khoảng thời gian — để Claude biết đã bị cắt gì và gọi lại với param khác nếu cần.

## Steps

1. `index.js` — helper `summarizeEntries(entries)`: đếm theo category + level, trả chuỗi 2-3 dòng ("120 entries: 15 console (8 error, 7 warn), 90 userAction, 10 network, 5 componentState. Showing last 50.").
2. `index.js` — helper `filterEntries(entries, { tail, level })`: filter level (chỉ áp cho category console; category khác giữ nguyên) rồi slice tail.
3. `get-debug-log`: thêm 3 params vào zod schema; nhánh live (`GET_LOG` qua WS) và nhánh file-based (zip) đều đi qua filter + format markdown; bỏ `JSON.stringify(entries, null, 2)`. Screenshots chỉ đính khi `includeScreenshots: true`.
4. `get-live-log`: thêm `includeScreenshots` (default false) + `tail` (đọc markdown thì tail áp trên entries trước khi format — cần đọc từ `liveEntries` in-memory thay vì file khi có; file chỉ là fallback).
5. `stop-recording`: trả `summarizeEntries` + tail 50 entries dạng markdown; thêm param `includeScreenshots` default false. Nhắc trong text: "Use get-debug-log with tail/level/includeScreenshots for more."
6. Description của tools: cập nhật để Claude biết params tồn tại (schema tự expose, nhưng description nên nói rõ default gọn).

## Validation

- Session 200+ entries: `get-debug-log` mặc định trả ≤ tail 50 + summary đúng số liệu.
- `level: "error"` chỉ còn console error (network/userAction vẫn hiện).
- `includeScreenshots: false` (default) → không có image content nào; `true` → có.
- `stop-recording` không còn khối JSON pretty-print.
- Đo thô: output default của session 200 entries < 20% kích thước output cũ.

## Rủi ro & rollback

- Behavior change cho user đang quen output cũ → ghi vào README changelog (phase 04). Đây là thay đổi contract MCP tool có chủ đích, đã được user chấp nhận trong scope plan.
- `formatMarkdown` giữa extension và mcp-server đang là 2 bản — phase này chỉ đụng bản mcp-server; golden test so output thuộc phase 05.
- Rollback: revert commit.
