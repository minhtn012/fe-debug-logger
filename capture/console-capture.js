// Console capture module — hooks console.error, console.warn, window error events
// eslint-disable-next-line no-unused-vars
function createConsoleCapture(postLog) {
  let origError, origWarn;
  let errorListener, rejectionListener;
  const SKIP_MARKER = '__fe_debug_logger__';

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

  function start() {
    origError = console.error;
    origWarn = console.warn;

    console.error = function (...args) {
      if (args[0] === SKIP_MARKER) {
        return origError.apply(console, args.slice(1));
      }
      postLog('console', {
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
      postLog('console', {
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
