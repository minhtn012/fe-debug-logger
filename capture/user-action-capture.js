// User action capture module — clicks, inputs, form submissions, navigation
// eslint-disable-next-line no-unused-vars
function createUserActionCapture(postLog) {
  const MAX_ENTRIES = 200;
  let entryCount = 0;
  const inputTimers = new Map();
  const listeners = [];

  const SENSITIVE_PATTERNS = /password|secret|token|key|credit|ssn|cvv|card/i;

  function truncate(str, maxLen) {
    if (!str) return '';
    const s = typeof str === 'string' ? str : String(str);
    return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
  }

  function maskIfSensitive(el, value) {
    if (el.type === 'password' || SENSITIVE_PATTERNS.test(el.name || '') || SENSITIVE_PATTERNS.test(el.id || '')) {
      return '[MASKED]';
    }
    return truncate(value, 100);
  }

  function getSelector(el) {
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current !== document && depth < 4) {
      let tag = current.tagName?.toLowerCase() || '';
      if (!tag) break;
      if (current.id) {
        tag += `#${current.id}`;
      } else if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length) tag += '.' + classes.join('.');
      }
      parts.unshift(tag);
      current = current.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function log(data) {
    if (entryCount >= MAX_ENTRIES) return;
    entryCount++;
    postLog('action', {
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  function addListener(event, handler) {
    document.addEventListener(event, handler, true);
    listeners.push([event, handler]);
  }

  function debounceInput(el) {
    if (inputTimers.has(el)) clearTimeout(inputTimers.get(el));
    inputTimers.set(el, setTimeout(() => {
      inputTimers.delete(el);
      log({
        event: 'input',
        selector: getSelector(el),
        tag: el.tagName,
        value: maskIfSensitive(el, el.value),
      });
    }, 300));
  }

  function onPopstate() {
    log({ event: 'navigate', url: window.location.href, navigationType: 'popstate' });
  }

  function onHashchange() {
    log({ event: 'navigate', url: window.location.href, navigationType: 'hashchange' });
  }

  function start() {
    entryCount = 0;

    addListener('click', (e) => {
      log({
        event: 'click',
        selector: getSelector(e.target),
        tag: e.target.tagName,
        text: truncate(e.target.textContent, 50),
      });
    });

    addListener('input', (e) => {
      debounceInput(e.target);
    });

    addListener('change', (e) => {
      log({
        event: 'change',
        selector: getSelector(e.target),
        tag: e.target.tagName,
        value: maskIfSensitive(e.target, e.target.value),
      });
    });

    addListener('submit', (e) => {
      log({
        event: 'submit',
        selector: getSelector(e.target),
        action: e.target.action || '',
        method: e.target.method || 'GET',
      });
    });

    addListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        log({ event: 'keydown', key: e.key, selector: getSelector(e.target) });
      }
    });

    window.addEventListener('popstate', onPopstate);
    window.addEventListener('hashchange', onHashchange);
  }

  function stop() {
    listeners.forEach(([evt, fn]) => document.removeEventListener(evt, fn, true));
    listeners.length = 0;
    window.removeEventListener('popstate', onPopstate);
    window.removeEventListener('hashchange', onHashchange);
    inputTimers.forEach((t) => clearTimeout(t));
    inputTimers.clear();
  }

  return { start, stop };
}
