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

1. Navigate to the page you want to debug
2. Click the extension icon to open the popup
3. Toggle capture categories as needed (Console, User Actions, Network, Component State)
4. Click **Start** to begin recording
5. Reproduce the issue on the page
6. Click **Stop**, then **Export** to download a `.md` file
7. Feed the Markdown to Claude Code or your preferred AI tool

### Annotation Mode

- Click **Annotate** or press `Cmd+Shift+A` (Mac) / `Ctrl+Shift+A` (Windows/Linux)
- Click any element on the page to add a note
- Annotations are included in the exported Markdown

### Screenshots

- **Full Page** — captures the entire scrollable page
- **Select Region** — drag to capture a specific area
- Screenshots are embedded as base64 in the export

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
