// Console capture module — hooks console.error, console.warn, window error events
// eslint-disable-next-line no-unused-vars
function createConsoleCapture(postLog) {
  let origError, origWarn;
  let errorListener, rejectionListener;
  const SKIP_MARKER = '__fe_debug_logger__';

  // Dedup: track last message per type to collapse repeated entries
  let lastEntry = { type: null, message: null, count: 0, key: null };

  function formatArg(arg) {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
    }
    if (arg instanceof HTMLElement) {
      const id = arg.id ? `#${arg.id}` : '';
      const cls = arg.className && typeof arg.className === 'string'
        ? '.' + arg.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      return `<${arg.tagName.toLowerCase()}${id}${cls}>`;
    }
    try {
      const str = JSON.stringify(arg, null, 2);
      return str && str.length > 500 ? str.substring(0, 500) + '...[truncated]' : str;
    } catch (_) {
      return String(arg);
    }
  }

  // Post log with dedup — collapses consecutive identical messages
  function postDeduped(entry) {
    if (entry.type === lastEntry.type && entry.message === lastEntry.message) {
      lastEntry.count++;
      // Update existing entry with repeat count + latest timestamp
      postLog('console', { ...entry, repeatCount: lastEntry.count, dedupKey: lastEntry.key });
      return;
    }
    // New unique message — reset tracker
    const key = `dedup_${Date.now()}`;
    lastEntry = { type: entry.type, message: entry.message, count: 1, key };
    postLog('console', { ...entry, repeatCount: 1, dedupKey: key });
  }

  function start() {
    origError = console.error;
    origWarn = console.warn;

    console.error = function (...args) {
      if (args[0] === SKIP_MARKER) {
        return origError.apply(console, args.slice(1));
      }
      postDeduped({
        timestamp: new Date().toISOString(),
        type: 'error',
        message: args.map(formatArg).join(' '),
        stack: new Error().stack?.split('\n').slice(2).join('\n') || '',
      });
      origError.apply(console, args);
    };

    console.warn = function (...args) {
      if (args[0] === SKIP_MARKER) {
        return origWarn.apply(console, args.slice(1));
      }
      postDeduped({
        timestamp: new Date().toISOString(),
        type: 'warn',
        message: args.map(formatArg).join(' '),
        stack: new Error().stack?.split('\n').slice(2).join('\n') || '',
      });
      origWarn.apply(console, args);
    };

    errorListener = (event) => {
      postLog('console', {
        timestamp: new Date().toISOString(),
        type: 'onerror',
        message: event.message || String(event),
        source: event.filename || '',
        lineno: event.lineno || 0,
        colno: event.colno || 0,
        stack: event.error?.stack || '',
      });
    };
    window.addEventListener('error', errorListener);

    rejectionListener = (event) => {
      const reason = event.reason;
      postLog('console', {
        timestamp: new Date().toISOString(),
        type: 'unhandledrejection',
        message: reason?.message || String(reason),
        stack: reason?.stack || '',
      });
    };
    window.addEventListener('unhandledrejection', rejectionListener);
  }

  function stop() {
    if (origError) console.error = origError;
    if (origWarn) console.warn = origWarn;
    if (errorListener) window.removeEventListener('error', errorListener);
    if (rejectionListener) window.removeEventListener('unhandledrejection', rejectionListener);
  }

  return { start, stop };
}
