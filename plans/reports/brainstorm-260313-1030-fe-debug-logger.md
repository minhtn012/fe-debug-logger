# Brainstorm: FE Debug Logger Chrome Extension

## Problem Statement
Debug FE bugs nhanh hơn bằng cách capture structured logs từ browser, output dạng Markdown để Claude Code đọc trực tiếp. Không dùng browser-agent (chậm), chỉ cần passive logger.

## Requirements
- Chrome Extension, framework-agnostic
- Manual record (Start/Stop)
- Toggleable capture types: Console, User Actions, Network, Component State
- Output: Download .md file vào project directory
- Scope: MVP cho personal use

## Evaluated Approaches

### Output Format
| Approach | Pros | Cons |
|----------|------|------|
| JSON file | Machine-readable, structured | Khó đọc cho người, Claude xử lý OK nhưng không optimal |
| Structured text | Dễ đọc | Không có format chuẩn |
| **Markdown (chosen)** | Claude đọc tốt nhất, tables + code blocks, người cũng đọc được | Cần formatter logic |

### Tool Type
| Approach | Pros | Cons |
|----------|------|------|
| NPM package | Deep integration, access component internals | Cần install per project, invasive |
| Bookmarklet | Zero install | Limited capabilities, no persistent UI |
| **Chrome Extension (chosen)** | Persistent UI, no project dependency, powerful APIs | Cần install 1 lần |
| Script tag | Simple | Manual inject, no popup UI |

### File Write Mechanism
| Approach | Pros | Cons |
|----------|------|------|
| WebSocket dev server | Auto-write to project | Cần chạy server, thêm dependency |
| Clipboard copy | Zero dependency | Manual paste step |
| **Download file (chosen)** | Zero dependency, 1-click | User cần move file hoặc config download path |

## Final Solution

### Architecture
```
popup.html/js     → UI: Start/Stop + toggle checkboxes
content-script.js → Inject vào page, hook console/events/network/framework
background.js     → Nhận data, format MD, trigger download
```

### Capture Modules (toggleable)

1. **Console Capture**: Hook console.error/warn, window.onerror, unhandledrejection. Full stack trace + timestamp.
2. **User Action Capture**: Event delegation (click, input, change, submit, navigation). CSS selector path + value (masked sensitive).
3. **Network Capture**: Intercept fetch + XHR. Log failed (4xx/5xx) + slow (>3s). Truncate bodies (max 500 chars).
4. **Component State Capture**: Auto-detect React/Vue via devtools hooks. Capture component tree at error time. Graceful fallback if no framework detected.

### Output Format
Structured Markdown with:
- Header: URL, time range, browser, viewport
- User Actions: table format
- Console Errors: heading + stack trace code blocks
- Network: per-request sections with req/res bodies
- Component State: props + state at error time

### Risks & Mitigations
- **Sensitive data**: Mask password/token input fields by default
- **Log size**: Truncate network bodies, limit action log to last N events
- **Framework detection**: Graceful skip if no React/Vue detected
- **Performance**: Passive listeners only, no DOM mutation observers for MVP

## Success Metrics
- Capture đủ info để Claude debug mà không cần hỏi thêm
- Record + export < 5 seconds workflow
- File size < 50KB cho typical debug session

## Next Steps
- Create implementation plan with phased approach
- Phase 1: Extension scaffold + console capture
- Phase 2: User action + network capture
- Phase 3: Component state + MD formatter
- Phase 4: Polish popup UI + settings
