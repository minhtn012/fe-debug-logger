# FE Debug Logger Documentation

Welcome to the FE Debug Logger Chrome extension documentation. This directory contains comprehensive guides for developers, architects, and product managers.

## Quick Navigation

### For Product Managers & Stakeholders
**Start here**: [Project Overview & Requirements](./project-overview-pdr.md)
- Project purpose and target users
- v0.1.0 feature checklist
- Functional and non-functional requirements
- Success metrics and roadmap

### For New Developers
**Start here**: [Codebase Summary](./codebase-summary.md)
- File structure and organization
- Module responsibilities (14 files explained)
- Message types and data flow
- Module pattern explanation

Then read: [Code Standards](./code-standards.md)
- Naming conventions and best practices
- Function design patterns
- Security guidelines (sensitive field masking)
- Testing checklist

### For Architects & System Designers
**Start here**: [System Architecture](./system-architecture.md)
- High-level architecture diagram
- Component interactions
- 4 detailed sequence diagrams (start, log, export, stop)
- Storage strategy and concurrency management
- Extensibility points

### For Project Planning
**Start here**: [Project Roadmap](./project-roadmap.md)
- Current status (v0.1.0, released 2026-03-13)
- 6-phase roadmap (v0.2.0 → v1.0.0)
- Known limitations and future enhancements
- Risk assessment and success metrics

## Documentation Overview

| Document | Purpose | Audience | LOC |
|----------|---------|----------|-----|
| [project-overview-pdr.md](./project-overview-pdr.md) | Vision, requirements, acceptance criteria | PM, stakeholders, all developers | 138 |
| [codebase-summary.md](./codebase-summary.md) | File structure, modules, responsibilities | New developers, architects | 311 |
| [code-standards.md](./code-standards.md) | Conventions, patterns, security, quality | All developers, reviewers | 397 |
| [system-architecture.md](./system-architecture.md) | Architecture, message flows, interactions | Architects, lead developers | 517 |
| [project-roadmap.md](./project-roadmap.md) | Status, phases, timeline, metrics | PM, team leads, stakeholders | 387 |

## Key Concepts

### Dual Content Script Architecture

FE Debug Logger uses a two-layer content script pattern for Chrome MV3 compliance:

- **ISOLATED World** (`content-script.js`): Accesses Chrome APIs, bridges to service worker
- **MAIN World** (`content-script-main.js` + 4 capture modules): Direct page JS access

This separation enables capturing console, network, user actions, and component state without exposing extension internals to the page.

### Four Capture Modules

1. **Console Capture**: Hooks `console.error/warn`, `window.onerror`, unhandled rejections
2. **User Action Capture**: Clicks, form inputs, navigation with DOM selectors + sensitive field masking
3. **Network Capture**: Fetch/XHR monitoring for errors and slow requests
4. **Component State Capture**: Auto-detects React/Vue and captures component trees

### Storage Strategy

- **chrome.storage.session**: Recording state, entry counter (survives SW restart)
- **chrome.storage.local**: Log entries (`log_*` keys), session metadata (persistent)

### Export Pipeline

Popup → Background → Offscreen Document → Markdown Formatter → Blob → Download

## Getting Started

### I Want to...

**Understand the project**
→ Read [project-overview-pdr.md](./project-overview-pdr.md) (15 min)

**Start contributing code**
→ Read [codebase-summary.md](./codebase-summary.md) + [code-standards.md](./code-standards.md) (30 min)

**Debug a message flow issue**
→ Refer to [system-architecture.md](./system-architecture.md) sequence diagrams (10 min)

**Add a new capture module**
→ See "Adding New Capture Module" in [system-architecture.md](./system-architecture.md#extensibility-points) (20 min)

**Plan next quarter's work**
→ Review [project-roadmap.md](./project-roadmap.md) phases (30 min)

**Review code for compliance**
→ Use checklist in [code-standards.md](./code-standards.md#testing--validation) (5 min per review)

## Architecture at a Glance

```
┌─────────────────────────────────────────┐
│    CHROME EXTENSION (Service Worker)     │
│ • Recording state management             │
│ • Message routing & aggregation          │
│ • Export orchestration                   │
└────────────┬────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────┐
│    WEB PAGE (Dual Content Scripts)       │
│ ┌──────────────────────────────────────┐ │
│ │ MAIN World:                          │ │
│ │ • 4 Capture Modules                  │ │
│ │ • Direct page JS access              │ │
│ └────────────┬─────────────────────────┘ │
│              │                            │
│ ┌────────────▼─────────────────────────┐ │
│ │ ISOLATED World Bridge:               │ │
│ │ • Chrome API access                  │ │
│ │ • Message routing                    │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

See [system-architecture.md](./system-architecture.md) for detailed diagrams.

## Code Quality Standards

### Naming
- **Files**: kebab-case (e.g., `console-capture.js`)
- **Functions**: camelCase (e.g., `createConsoleCapture()`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `SKIP_MARKER`)

### Module Pattern
All capture modules use factory functions for encapsulation:

```javascript
function createXxxCapture(postLog) {
  // Private state
  let state = {};

  return {
    start(config) { },
    stop() { },
    snapshot() { }  // optional
  };
}
```

### Error Handling
Try-catch with fallback, never throw to caller:

```javascript
try {
  // risky operation
} catch (e) {
  console.error('__fe_debug_logger__', 'Error:', e);
  // continue gracefully
}
```

### Sensitive Data
Automatically mask these patterns in user actions:
- `password`, `passwd`, `pass`
- `token`, `apikey`, `api_key`, `secret`
- `auth`, `authorization`, `creditcard`, `ssn`, `pin`

See [code-standards.md](./code-standards.md) for complete guidelines.

## Roadmap Status

### Current: v0.1.0 (Released 2026-03-13)

**Status**: MVP Complete
- [x] Console capture
- [x] User action tracking
- [x] Network monitoring
- [x] Component state snapshots
- [x] Markdown export
- [x] Popup UI controls
- [x] Sensitive field masking

### Next: v0.2.0 (Q2 2026)

**Focus**: Stability & polish
- Vue 2/3 edge case fixes
- Performance optimization
- Error logging improvements

### Future: v0.3.0 → v1.0.0

See [project-roadmap.md](./project-roadmap.md) for:
- Phase details and effort estimates
- Risk assessments
- Success metrics
- Technical decisions log

## Testing & Validation

### Manual Testing Checklist

- [ ] Extension loads without errors in Chrome 88+
- [ ] Start button enables capture
- [ ] Stop button disables capture
- [ ] Export generates valid Markdown
- [ ] All capture categories working
- [ ] Sensitive fields masked
- [ ] No console pollution

See [code-standards.md](./code-standards.md#testing--validation) for complete checklist.

### Code Verification

Before committing:

```bash
# Check syntax for all JS files
node -c background.js
node -c content-script.js
# ... etc for all .js files

# Verify no unintended logging
grep -r "console.log\|console.error" --exclude-dir=node_modules .
# Should only find logs in capture modules (intentional)
```

## Message Types Reference

### Popup ↔ Background

| Type | Direction | Purpose |
|------|-----------|---------|
| GET_STATUS | Popup → BG | Query recording state |
| START_RECORDING | Popup → BG | Begin capture with options |
| STOP_RECORDING | Popup → BG | End capture |
| EXPORT_LOG | Popup → BG | Trigger export workflow |
| CLEAR_LOG | Popup → BG | Delete all entries |

### Background ↔ Content Script

| Type | Direction | Purpose |
|------|-----------|---------|
| START_CAPTURE | BG → Content | Initialize capture modules |
| STOP_CAPTURE | BG → Content | Clean up capture modules |
| LOG_ENTRY | Content → BG | Store log entry |
| PAGE_META | Content → BG | Store session metadata |

### Background ↔ Offscreen

| Type | Direction | Purpose |
|------|-----------|---------|
| PROCESS_EXPORT | BG → Offscreen | Format and generate export |
| EXPORT_READY | Offscreen → BG | Return download data |

See [codebase-summary.md](./codebase-summary.md#message-types) for complete reference.

## Storage Schema

### chrome.storage.session
```javascript
{
  recording: boolean,
  entryCounter: number,
  config: { console, userActions, network, componentState }
}
```

### chrome.storage.local
```javascript
{
  sessionMeta: { url, startTime, endTime, userAgent, viewport },
  log_<timestamp>_0: { category, type, ...data },
  log_<timestamp>_1: { ... },
  // ... up to thousands of entries
}
```

See [system-architecture.md](./system-architecture.md#storage-architecture) for details.

## Contributing

### Code Review Checklist

Before approving PRs:

1. **Naming**: Follow kebab-case (files), camelCase (functions), UPPER_SNAKE_CASE (constants)
2. **Module Pattern**: New modules use factory functions
3. **Error Handling**: Try-catch with `__fe_debug_logger__` marker
4. **Performance**: No memory leaks, reasonable time complexity
5. **Security**: Sensitive fields masked, no hardcoded secrets
6. **Tests**: Pass existing test suite
7. **Docs**: Update relevant documentation files

### Documentation Updates Required

When submitting code changes, also update:
- **New module**: Add to [codebase-summary.md](./codebase-summary.md)
- **New message type**: Update [codebase-summary.md](./codebase-summary.md#message-types) and [system-architecture.md](./system-architecture.md)
- **Breaking change**: Note in [code-standards.md](./code-standards.md#breaking-changes)
- **Completed roadmap phase**: Update [project-roadmap.md](./project-roadmap.md)

## FAQ

**Q: How do I add a new capture module?**
A: See "Extensibility Points" in [system-architecture.md](./system-architecture.md#extensibility-points)

**Q: What's the difference between ISOLATED and MAIN world scripts?**
A: See "Dual Content Script Pattern" in [system-architecture.md](./system-architecture.md#dual-content-script-architecture)

**Q: How do I debug message routing?**
A: See sequence diagrams in [system-architecture.md](./system-architecture.md#message-flow-sequences)

**Q: What framework detection methods are supported?**
A: See component-state-capture.js notes in [codebase-summary.md](./codebase-summary.md#component-state-capture-module)

**Q: What's the storage quota limit?**
A: ~10 MB per extension (see [system-architecture.md](./system-architecture.md#storage-limits))

**Q: Can I customize the export format?**
A: Yes, modify [formatter/markdown-formatter.js](../formatter/markdown-formatter.js) or see extensibility notes in [system-architecture.md](./system-architecture.md#customizing-export-format)

## Key Files to Know

### Essential
- `background.js` — Service worker, message hub, export orchestration
- `content-script.js` — ISOLATED bridge between MAIN world and extension
- `content-script-main.js` — Coordinator, initializes 4 capture modules
- `popup.html/js` — UI for start/stop/export/clear controls
- `manifest.json` — Extension configuration (MV3)

### Capture Modules
- `capture/console-capture.js` — Hook console methods and error events
- `capture/user-action-capture.js` — Track clicks, inputs, navigation
- `capture/network-capture.js` — Monitor fetch/XHR
- `capture/component-state-capture.js` — Detect React/Vue and capture state

### Formatting & Export
- `formatter/markdown-formatter.js` — Generate structured Markdown
- `offscreen.html/js` — Create Blob and data URL for download

See [codebase-summary.md](./codebase-summary.md#directory-structure) for complete structure.

## Performance Tips

### Recording
- Console capture has minimal overhead
- User action capture debounces input events (300ms)
- Network capture limits response body to 1 KB
- Component state capture limits depth to 5 levels

### Export
- Markdown generation happens in offscreen document (async)
- Blob creation doesn't block service worker
- Large sessions (5,000+ entries) export in <2 seconds

See [system-architecture.md](./system-architecture.md#performance-considerations) for details.

## Security Considerations

### Data Isolation
- ISOLATED content script prevents page access to extension APIs
- MAIN world scripts isolated from Chrome extension context
- Service worker protected by standard extension sandbox

### Sensitive Data
- User actions automatically mask passwords, tokens, API keys
- Console args with sensitive patterns truncated
- Network response bodies limited to prevent logging secrets

### Privacy
- No automatic upload or remote logging in v0.1.0
- All data stored locally until user exports
- User controls which categories to capture

See [system-architecture.md](./system-architecture.md#security--privacy) for details.

## Resources

- **Chrome Extension Documentation**: https://developer.chrome.com/docs/extensions/
- **Manifest V3 Guide**: https://developer.chrome.com/docs/extensions/mv3/
- **Chrome Storage API**: https://developer.chrome.com/docs/extensions/reference/storage/
- **Content Scripts**: https://developer.chrome.com/docs/extensions/mv3/content_scripts/

## Support & Questions

- **Bug Reports**: GitHub Issues
- **Feature Requests**: GitHub Discussions
- **Documentation Feedback**: Email team or open PR
- **Questions?**: Check FAQ above or search docs

---

**Last Updated**: 2026-03-13
**Version**: 0.1.0
**Maintained By**: Documentation Team

For contributions, see CONTRIBUTING.md (if available) or contact the team.
