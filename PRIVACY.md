# Privacy Policy — FE Debug Logger

**Last updated:** March 14, 2026

## Data Collection

FE Debug Logger captures the following data **only when recording is actively started by the user**:

- Console errors and warnings
- User actions (clicks, form inputs, navigation events)
- Network requests (HTTP errors and slow responses)
- Component state snapshots (React and Vue frameworks)
- DOM annotations (user-created notes on page elements)
- Screenshots (full page or selected region)

## Data Storage

All captured data is stored **locally on your device** using the Chrome Storage API. No data is transmitted to external servers.

## Data Transmission

FE Debug Logger does **not** transmit any data to external services. There are no analytics, tracking pixels, or third-party integrations.

The extension includes an optional WebSocket client for local MCP (Model Context Protocol) server integration. This connection is:
- **Localhost only** — connects to a server running on your own machine
- **Optional** — the extension works fully without it
- **User-initiated** — no automatic data transmission

## Sensitive Data

The extension automatically masks sensitive form fields including passwords, tokens, secrets, and API keys. Masked fields appear as `[MASKED]` in exported logs.

## Data Retention

Captured data persists in Chrome Storage until the user clicks **Clear** or uninstalls the extension. Exported Markdown files are saved to the user's local filesystem via Chrome's download API.

## Permissions

| Permission | Purpose |
|-----------|---------|
| `activeTab` | Capture debug data from the active tab |
| `storage` | Store recording state and log entries locally |
| `downloads` | Export debug logs as Markdown files |
| `offscreen` | Create file blobs (Manifest V3 requirement) |
| `tabs` | Read current tab URL for session metadata |
| `alarms` | Manage screenshot/annotation timers |

Content scripts run on all URLs to enable debugging on any website.

## Contact

For privacy questions, please open an issue on the [GitHub repository](https://github.com/minhtn012/fe-debug-logger/issues).
