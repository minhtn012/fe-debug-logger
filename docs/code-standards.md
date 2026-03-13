# Code Standards & Conventions

## Language & Environment

- **Language**: Vanilla JavaScript (ES6+, no build tools or transpilers)
- **Runtime**: Chrome 88+ (Manifest V3)
- **Package Manager**: None (no npm dependencies)
- **Linting**: ESLint disabled by default (use `// eslint-disable-next-line` when necessary)

## File Organization

### Naming Conventions

| Type | Convention | Examples |
|------|-----------|----------|
| Scripts | kebab-case | `content-script.js`, `console-capture.js`, `markdown-formatter.js` |
| Modules (factories) | camelCase | `createConsoleCapture()`, `createUserActionCapture()` |
| Functions | camelCase | `formatArg()`, `escapeMarkdownCell()`, `postLog()` |
| Constants | UPPER_SNAKE_CASE | `SKIP_MARKER`, `MAX_DEPTH`, `DEBOUNCE_MS` |
| Variables | camelCase | `recording`, `config`, `entryCounter` |
| Private vars | prefix with `_` or closure scope | (preferred: closure scope) |

### Directory Structure

```
extension-debug/
├── capture/              # Capture modules (4 files)
├── formatter/            # Formatting modules (1 file)
├── icons/                # Extension icons
├── docs/                 # Documentation (this directory)
├── *.js                  # Core scripts (background, content-script, etc.)
├── *.html / *.css        # UI files
└── manifest.json         # Extension config
```

**Rule**: Max 200 lines per file. Split larger files into focused modules.

## Module Pattern

All capture modules use **factory function pattern**:

```javascript
// eslint-disable-next-line no-unused-vars
function createXxxCapture(postLog) {
  // Private state and helpers (not exposed)
  let enabled = false;
  function helper() { }

  // Return public API
  return {
    start(config) {
      enabled = true;
      // implementation
    },
    stop() {
      enabled = false;
      // cleanup
    },
    snapshot() {
      // optional method
    }
  };
}
```

**Rationale**:
- Encapsulation: Private state isolated in closure
- No globals: Each instance independent
- Reusable: Can initialize multiple times
- Clear API: Only exposed methods in return object

**ESLint disable comment**: Place at top of capture modules since they're factory functions called from coordinator.

## Function Design

### Error Handling

**Pattern**: Try-catch with fallback, never throw to caller.

```javascript
function safeFeatureX() {
  try {
    // risky operation
    return result;
  } catch (e) {
    console.error('__fe_debug_logger__', 'Feature X failed:', e);
    return null;  // or safe default
  }
}
```

**Self-skip marker**: Use `'__fe_debug_logger__'` as first console arg to avoid recursive logging:

```javascript
// In console-capture.js
console.error = function (...args) {
  if (args[0] === SKIP_MARKER) {
    return origError.apply(console, args.slice(1));  // Bypass logging
  }
  // Log normally
};

// Calling extension code:
console.error('__fe_debug_logger__', 'Some message');  // Not logged by capture
```

### Naming Clarity

- **get*** for retrieval: `getStatus()`, `getEntries()`
- **set*** for storage: `setRecording()`, `setConfig()`
- **format*** for transformation: `formatArg()`, `formatMarkdown()`
- **create*** for initialization: `createConsoleCapture()`
- **is*** / **has*** for predicates: `isErrorStatus()`, `hasDocument()`
- **post*** for async messaging: `postLog()`, `postMessage()`

## Data Structures

### Log Entry Format

All captured entries follow this schema:

```javascript
{
  category: 'console' | 'action' | 'network' | 'state',
  type: 'error' | 'warn' | 'click' | 'input' | ...,
  timestamp: ISO string,
  // ... category-specific fields
  _key: 'log_<timestamp>_<seq>',  // Added by background
  _seq: number                      // Added by background
}
```

### Message Envelope

Messages between contexts must include source signature:

```javascript
{
  __source: 'fe-debug-logger',  // Required for routing
  version: 1,                    // Protocol version
  type: 'LOG_ENTRY' | 'START_CAPTURE' | ...,
  data: { },                     // Payload
  // ... context-specific fields
}
```

## Variable Scope

### Storage Keys

- `log_<timestamp>_<seq>`: Individual log entries (chrome.storage.local)
- `sessionMeta`: Session metadata (chrome.storage.local)
- `recording`: Recording state bool (chrome.storage.session)
- `config`: Capture options (chrome.storage.session)
- `entryCounter`: Sequence counter (chrome.storage.session)

### Message Types

All message `type` strings are UPPER_SNAKE_CASE:
- `START_RECORDING`, `STOP_RECORDING`, `EXPORT_LOG`, `CLEAR_LOG`
- `START_CAPTURE`, `STOP_CAPTURE`
- `LOG_ENTRY`, `PAGE_META`
- `GET_STATUS`, `EXPORT_READY`, `PROCESS_EXPORT`

## Code Quality

### Readability Over Cleverness

**Prefer explicit**:
```javascript
// Good
if (args[0] === SKIP_MARKER) {
  return origError.apply(console, args.slice(1));
}

// Avoid
return args[0] === SKIP_MARKER && origError.apply(console, args.slice(1));
```

### Comment Guidelines

- **Self-documenting code**: Clear names eliminate need for comments
- **Why comments**: Explain *why* not what (code explains what)
- **Section headers**: Mark major blocks
  ```javascript
  // Restore entry count from storage on SW wake
  chrome.storage.session.get(['recording', 'entryCounter'], (data) => {
    entryCounter = data.entryCounter || 0;
  });
  ```

### Performance

- **Network capture**: Limit response body to 1 KB
  ```javascript
  const body = await response.text();
  const truncated = body.substring(0, 1024);
  ```

- **User actions**: Debounce high-frequency events (300ms)
  ```javascript
  let inputTimeout;
  element.addEventListener('input', () => {
    clearTimeout(inputTimeout);
    inputTimeout = setTimeout(() => { postLog(...); }, 300);
  });
  ```

- **Component state**: Limit depth (5 levels) and keys (5 per component)
  ```javascript
  if (depth > 5) return '...';  // Prevent infinite recursion
  const propsKeys = Object.keys(props).slice(0, 5);
  ```

- **User actions**: Prune old entries to max 200
  ```javascript
  if (entries.length > 200) {
    entries.shift();  // Remove oldest
  }
  ```

### Async Patterns

Use **callback-based** (not Promises) for chrome.storage API for consistency:

```javascript
// Standard pattern
chrome.storage.session.get(['recording'], (data) => {
  const recording = !!data.recording;
  // handle data
});

// For better readability with complex async:
function getStatus(callback) {
  chrome.storage.session.get(['recording', 'config'], (data) => {
    callback({ recording: !!data.recording, config: data.config });
  });
}
```

However, modern async/await is acceptable for Promises:

```javascript
async function exportLog() {
  const all = await chrome.storage.local.get(null);
  // ...
}
```

### Array/Object Handling

Use **destructuring** for clarity:

```javascript
// Good
const { __source, version, type, data, ...rest } = msg;
const entry = { ...(data || rest), _key: key, _seq: entryCounter };

// Over
const key = msg.__source;
const version = msg.version;
// ... etc
```

Use **filter + map** for transformations:

```javascript
const logKeys = Object.keys(all)
  .filter((k) => k.startsWith('log_'))
  .sort();
const entries = logKeys.map((k) => all[k]);
```

## Security

### Sensitive Data Masking

Mask these patterns in user action captures:

```javascript
const SENSITIVE_FIELDS = [
  'password', 'passwd', 'pass',
  'token', 'apikey', 'api_key',
  'secret', 'auth', 'authorization',
  'creditcard', 'ssn', 'pin'
];

function maskValue(fieldName, value) {
  if (SENSITIVE_FIELDS.some(s => fieldName.toLowerCase().includes(s))) {
    return '***MASKED***';
  }
  return value;
}
```

### URL Filtering

Skip chrome-extension:// URLs (extension traffic):

```javascript
if (url.startsWith('chrome-extension://')) {
  return;  // Skip internal URLs
}
```

## Testing & Validation

### Manual Testing Checklist

- [ ] Extension loads without errors in Chrome 88+
- [ ] Start button enables capture
- [ ] Stop button disables capture
- [ ] Export generates valid Markdown
- [ ] Console errors are captured
- [ ] User actions have correct selectors
- [ ] Network requests logged (errors + slow)
- [ ] Component state captures for React/Vue
- [ ] Sensitive fields masked
- [ ] No console pollution (only __fe_debug_logger__ logs)

### Code Verification

Run before commit:

```bash
# Check syntax (no build required)
node -c background.js
node -c content-script.js
# ... etc for all .js files

# Manual inspection
grep -r "console.log\|console.error" --exclude-dir=node_modules .
# Should find none except in capture modules (intentional)
```

## Formatting Rules

### Markdown in Export

- **Escape pipe characters**: `|` → `\|` (table cells)
- **Escape backticks**: `` ` `` → `` \` `` (code blocks)
- **Escape brackets**: `[` → `\[` (in table cells)

```javascript
function escapeMarkdownCell(str) {
  return String(str)
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}
```

### JSON Stringification

Use 2-space indent for readability in logs:

```javascript
const json = JSON.stringify(arg, null, 2);
```

### Time Formatting

ISO strings preferred for storage (`new Date().toISOString()`), human-readable for display:

```javascript
function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString();
}
```

## Breaking Changes

When modifying message formats or storage schema:

1. Update `version` field in message envelope
2. Document in changelog
3. Add backward compatibility check if needed:

```javascript
if (msg.version === 1) {
  // Handle v1 format
} else if (msg.version === 2) {
  // Handle v2 format
}
```

## Future Code Standards

As project grows:

- Consider TypeScript for type safety (requires build step)
- Implement unit testing framework (Jest recommended)
- Add ESLint with strict rules
- Establish PR review guidelines
- Document API contracts for each module
