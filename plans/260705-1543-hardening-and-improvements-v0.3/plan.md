# Plan: Hardening & Improvements v0.3.x

**Created**: 2026-07-05
**Status**: PENDING
**Context**: Extension đã publish lên Chrome Web Store (v0.2.1). Codebase review ngày 2026-07-05 phát hiện 1 bug nghiêm trọng (recording chết sau reload), 2 rủi ro bảo mật (WS không auth, kill process bừa), MCP responses tốn token, và thiếu test/CI.

## Phases

| # | Phase | Ưu tiên | Phụ thuộc | Status |
|---|-------|---------|-----------|--------|
| 01 | [Recording resilience](phase-01-recording-resilience.md) | Critical | — | IMPLEMENTED (chờ manual validation) |
| 02 | [WS security & server hardening](phase-02-ws-security-server-hardening.md) | Critical | — | DONE |
| 03 | [MCP token efficiency](phase-03-mcp-token-efficiency.md) | High | 02 (cùng file index.js) | PENDING |
| 04 | [Repo hygiene & docs](phase-04-repo-hygiene-docs.md) | Medium | 01–03 (version bump cuối) | PENDING |
| 05 | [Testing & CI](phase-05-testing-ci.md) | Medium | 01–03 (test code mới) | PENDING |
| 06 | [High-value features](phase-06-high-value-features.md) | Nice-to-have | 01, 02 | PENDING |

Phase 01 và 02 độc lập, có thể làm song song (khác file ownership: 01 = extension side, 02 = mcp-server side).

## Acceptance criteria tổng

- [ ] Reload/navigate giữa lúc recording → capture tự resume, không mất entry nào sau khi trang load xong
- [ ] Trang web lạ không thể connect vào ws://localhost:3456 (origin check)
- [ ] MCP server không kill process ngoài khi port bận
- [ ] `stop-recording`/`get-debug-log` mặc định trả tóm tắt gọn, screenshots opt-in
- [ ] Repo sạch: không zip release, không runtime output, README khớp code
- [ ] Có test cho pure functions + lint + CI chạy xanh
- [ ] Version bump 0.3.0, build zip mới sẵn sàng re-submit Web Store

## Ràng buộc

- **Đã publish Web Store**: extension ID đã cố định → dùng được cho origin check. Không thêm permission mới trong manifest nếu tránh được (thêm permission = re-review lâu + user thấy cảnh báo). Các phase hiện tại KHÔNG cần permission mới.
- Code style: vanilla JS, không build tool, không dependency mới phía extension.
- MCP server: giữ ESM, dependencies tối thiểu.

## Quyết định đã chốt (từ review 2026-07-05)

1. Auto-resume qua storage state + content script tự hỏi background khi init — không dùng `chrome.scripting.executeScript` (tránh thêm permission `scripting`).
2. WS auth bằng Origin header check (`chrome-extension://<id>`) — đủ cho threat model localhost, không cần token phức tạp.
3. Dedup 2 bản markdown-formatter bằng golden test so sánh output — không refactor chung module (importScripts vs ESM không share trực tiếp được, YAGNI).
