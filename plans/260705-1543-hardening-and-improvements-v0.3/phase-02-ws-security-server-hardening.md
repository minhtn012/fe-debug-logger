# Phase 02: WS Security & Server Hardening (mcp-server side)

**Ưu tiên**: Critical — chặn prompt injection từ web page lạ
**Status**: DONE (2026-07-06) — validated end-to-end (origin reject + no-kill + loopback bind)
**Files sở hữu**: `mcp-server/index.js`
**Không đụng**: extension files (phase 01 sở hữu). Phase 03 chờ phase này xong (cùng file).

## Kết quả triển khai (2026-07-06)

- Step 1: `EXT_ID_ALLOWLIST` từ env `FE_DEBUG_EXT_IDS` + `isAllowedOrigin()`; origin check ở đầu `connection` event → non-`chrome-extension://` hoặc ID ngoài allowlist → `ws.close(1008)` + log. Empty env = accept mọi extension origin (chặn mọi web page).
- Step 2: xoá `import execSync` + khối `lsof/kill` — bind trực tiếp, retry 1 lần sau 1.5s.
- Step 3: `createWsServer` bắt riêng `EADDRINUSE` với message hướng dẫn `lsof -i :3456`.
- Step 4: README thêm row env `FE_DEBUG_EXT_IDS` + 2 dòng troubleshooting (origin reject, port busy no-kill).
- **Fix phát sinh từ code review**:
  - **H1 (High)**: server trước đó bind `*:3456` (mọi interface → LAN có thể giả origin) → đổi `host: '127.0.0.1'` (loopback-only). Origin check giờ đứng trên nền localhost thật. Extension connect `ws://localhost` vẫn hoạt động (đã verify).
  - **M2 (Medium)**: thêm `ws.on('error')` (cả accept + reject path) + `process.on('uncaughtException'|'unhandledRejection')` → socket RST giữa close handshake không còn crash cả server.

**Validation đã chạy (ALL PASS)**: evil https / no-origin → reject 1008; `chrome-extension://*` → accept khi env unset; allowlist set → chỉ ID khớp accept; instance 2 đụng port 3456 → log busy, **không kill** holder (server + Chrome vẫn sống); bind lsof = `127.0.0.1` only.

## Vấn đề

1. **WS server không xác thực** (`mcp-server/index.js` `setupWsHandlers`): accept mọi connection tới `ws://localhost:3456`. WebSocket không bị same-origin policy chặn → bất kỳ trang web nào user mở đều connect được, chiếm chỗ connection extension (code còn chủ động close connection cũ), bơm `STREAM_ENTRIES` giả vào `fe-debug/debug-log.md` → prompt injection vào context Claude.
2. **Kill process bừa** (`startWsServer()`): `lsof -ti :3456` + `kill` giết bất kỳ process nào giữ port — có thể là app khác của user; `lsof` không tồn tại trên Windows.

## Thiết kế

**Origin check khi handshake**: connection từ Chrome extension luôn mang header `Origin: chrome-extension://<extension-id>`. Trang web thường mang `Origin: https://...`. Verify origin trước khi accept.

- Extension đã publish Web Store → ID cố định. Lấy ID thật từ user hoặc từ trang Web Store listing khi implement.
- Cho phép override qua env `FE_DEBUG_EXT_IDS` (comma-separated) để dev với unpacked extension (ID khác bản store).
- Mặc định: accept mọi origin dạng `chrome-extension://*` nếu không set env — vẫn chặn được toàn bộ web page (threat chính), không làm khó dev. Nếu set env → chỉ accept đúng ID liệt kê.

**Port busy**: bỏ hoàn toàn khối `execSync(lsof)/kill`. Xử lý `EADDRINUSE`:
- Retry 1 lần sau 1.5s (giữ logic retry hiện có).
- Vẫn fail → log lỗi rõ ràng hướng dẫn `lsof -i :3456` và thoát WS setup gracefully (MCP stdio tools file-based như `get-live-log` vẫn hoạt động).

## Steps

1. `setupWsHandlers()`: dùng option `verifyClient` của `WebSocketServer` (hoặc check `req.headers.origin` trong event `connection` rồi `ws.close(1008)`):
   - Parse env `FE_DEBUG_EXT_IDS` → allowlist.
   - Origin thiếu hoặc không bắt đầu `chrome-extension://` → reject + log warn kèm origin.
   - Allowlist không rỗng → origin phải khớp `chrome-extension://<id>` trong list.
2. Xoá khối `execSync('lsof ...')` và import `execSync` khỏi `startWsServer()`.
3. `createWsServer()`: bắt lỗi `EADDRINUSE` riêng, message hướng dẫn cụ thể ("Port 3456 busy — check `lsof -i :3456`. Another MCP server instance running?").
4. Sửa README section Troubleshooting: thêm dòng về origin check + env `FE_DEBUG_EXT_IDS` (phase 04 sẽ rà toàn bộ README, nhưng dòng này thuộc contract của phase này).
5. Sửa doc mismatch nhân tiện đang trong file: comment `SESSIONS_DIR` đã đúng, chỉ cần README (để phase 04).

## Validation

- Node script test: `new WebSocket('ws://localhost:3456', { headers: { origin: 'https://evil.example' } })` → bị close 1008.
- Origin `chrome-extension://fakeid` khi `FE_DEBUG_EXT_IDS` set ID khác → reject; khi env không set → accept.
- Extension thật connect bình thường, start/stop recording qua MCP hoạt động.
- Chạy 2 instance MCP server → instance 2 log lỗi port busy rõ ràng, không kill instance 1, stdio tools vẫn trả lời.

## Rủi ro & rollback

- `ws` lib: một số version khuyến nghị check origin trong `connection` event thay vì `verifyClient` (deprecated-ish) — dùng cách check trong `connection` event cho an toàn.
- Nếu extension unpacked của user bị chặn ngoài ý muốn → hướng dẫn set `FE_DEBUG_EXT_IDS` hoặc bỏ env; default không set là permissive với mọi extension origin nên rủi ro thấp.
- Rollback: revert commit.
