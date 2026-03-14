# FE Debug Logger

Chrome extension that captures frontend debug logs as structured Markdown — optimized for AI-assisted debugging with Claude Code.

## Features

- **Console Capture** — hooks `console.error`, `console.warn`, `window.onerror`, unhandled promise rejections
- **User Action Tracking** — records clicks, form inputs, navigation with DOM selectors
- **Network Monitoring** — logs HTTP errors (status >= 400) and slow requests (> 3s)
- **Component State Snapshots** — auto-detects React & Vue, captures props/state trees
- **DOM Annotation** — click elements to annotate with notes (`Cmd+Shift+A` / `Ctrl+Shift+A`)
- **Screenshot Capture** — full page or select region
- **Selective Capture** — toggle categories independently
- **Sensitive Data Masking** — auto-masks password/token/apiKey fields
- **Structured Markdown Export** — session metadata, formatted tables, code blocks

## Install

### Chrome Web Store

Coming soon.

### Manual Install (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/minhtn012/fe-debug-logger.git
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the cloned folder
5. Pin the extension from the toolbar

## Usage

### Basic Workflow

1. Navigate to the page you want to debug
2. Click the extension icon to open the popup
3. Toggle capture categories as needed:
   - **Console Errors** — `console.error`, `console.warn`, unhandled exceptions
   - **User Actions** — clicks, form inputs, navigation, keyboard events
   - **Network** — HTTP errors (4xx/5xx), slow requests (> 3s)
   - **Component State** — React/Vue component props & state trees
4. Click **Start** to begin recording
5. Reproduce the issue on the page
6. Click **Stop** when done
7. Choose an output method:
   - **Copy** — copies Markdown to clipboard (paste directly into Claude Code)
   - **Export** — downloads as `.md` file or `.zip` (if screenshots included)
8. **Clear** — resets all captured data for a new session

### Annotation Mode

Annotate specific UI elements with notes to highlight problem areas:

1. Click **Annotate** in the popup (or press `Cmd+Shift+A` / `Ctrl+Shift+A`)
2. Hover over elements — they'll be highlighted with a blue outline
3. Click an element to select it
4. Enter a note describing the issue (e.g., "This button doesn't respond on mobile")
5. The annotation captures: element tag, CSS selector, dimensions, and your note
6. Press `Esc` or click **Annotate** again to exit annotation mode
7. Annotations appear in the exported Markdown with element context

### Screenshot Capture

Capture visual evidence alongside your debug logs:

1. Click the **Screenshot** dropdown in the popup
2. Choose a capture mode:
   - **Full Page** — scrolls and stitches the entire page into one image
   - **Select Region** — drag a rectangle to capture a specific area
3. Screenshots are embedded as base64 images in the export
4. Maximum 5 screenshots per session to keep export size manageable

### Example: Debugging with Claude Code

```bash
# 1. Record a bug reproduction, then export/copy the Markdown

# 2. Paste or reference the file in Claude Code
claude "Here's a debug log from my app. The submit button throws an error
when the form has empty required fields. Please analyze and fix:

$(cat fe-debug-log-20260314-153022.md)"
```

The exported Markdown gives Claude Code full context: what the user did, what errors occurred, what network requests failed, and what the component state looked like — no manual copy-pasting from DevTools needed.

## Export Format

The exported Markdown includes:

| Section | Content |
|---------|---------|
| Session Info | URL, timestamp, duration, browser, viewport |
| Console Errors | Error messages with stack traces |
| User Actions | Click/input/navigation log with selectors |
| Network Issues | Failed requests, slow responses |
| Component State | React/Vue component tree snapshots |
| Annotations | Element annotations with notes |
| Screenshots | Captured images (base64) |

## Architecture

- **Manifest V3** — Chrome 88+
- **Vanilla JavaScript** — zero external dependencies (except bundled jszip)
- **Dual Content Script Pattern**:
  - ISOLATED world: Chrome API access, message bridge
  - MAIN world: Console/fetch/XHR hooks, framework detection
- **Offscreen Document** — Blob creation for MV3 file downloads
- **Chrome Storage API** — session state survives service worker restarts

## Advanced: MCP Integration

The extension optionally connects to a local WebSocket server for programmatic control via MCP (Model Context Protocol). If no server is running, the extension works normally — the connection fails silently.

Supported commands: `START_RECORDING`, `STOP_RECORDING`, `GET_ENTRIES`, `TAKE_SCREENSHOT`.

## Privacy

- All data is stored **locally** on your machine (Chrome Storage API)
- **No analytics**, no tracking, no external data transmission
- Sensitive fields (password, token, secret, apiKey) are **automatically masked**
- WebSocket/MCP connection is optional, localhost-only, and user-initiated
- Network capture skips `chrome-extension://` URLs

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit changes (`git commit -m "feat: add your feature"`)
4. Push to the branch (`git push origin feat/your-feature`)
5. Open a Pull Request

**Code style:** Vanilla JavaScript, no build tools, no external dependencies. Follow existing patterns.

## License

[MIT](LICENSE)
