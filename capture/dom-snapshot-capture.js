// DOM snapshot capture — outerHTML, computed styles, bounding rect, visibility, parent chain
// eslint-disable-next-line no-unused-vars
function createDomSnapshotCapture() {
  const STYLE_PROPS = [
    // Visibility
    'display', 'visibility', 'opacity', 'pointer-events', 'cursor', 'z-index',
    // Layout
    'position', 'overflow', 'flex-direction', 'justify-content', 'align-items', 'gap', 'flex-wrap',
    // Box Model
    'margin', 'padding', 'width', 'height', 'box-sizing',
    // Typography
    'font-size', 'line-height', 'color',
  ];

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

  function truncateHTML(html, max) {
    if (!html || html.length <= max) return html;
    return html.substring(0, max) + '... [truncated]';
  }

  function captureIdentifiers(el) {
    const ids = {};
    if (el.id) ids.id = el.id;
    if (el.getAttribute('name')) ids.name = el.getAttribute('name');
    if (el.getAttribute('role')) ids.role = el.getAttribute('role');
    if (el.getAttribute('aria-label')) ids['aria-label'] = el.getAttribute('aria-label');
    // Capture all data-* attributes
    if (el.dataset) {
      for (const [key, val] of Object.entries(el.dataset)) {
        ids[`data-${key}`] = val;
      }
    }
    return Object.keys(ids).length > 0 ? ids : null;
  }

  function captureStyles(el) {
    try {
      const computed = window.getComputedStyle(el);
      const styles = {};
      for (const prop of STYLE_PROPS) {
        styles[prop] = computed.getPropertyValue(prop);
      }
      return styles;
    } catch (_) {
      return null;
    }
  }

  function captureBoundingRect(el) {
    try {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    } catch (_) {
      return null;
    }
  }

  function checkVisibility(el) {
    try {
      const style = window.getComputedStyle(el);
      const isVisible = el.offsetParent !== null
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && parseFloat(style.opacity) > 0;
      return { isVisible, display: style.display, visibility: style.visibility, opacity: style.opacity };
    } catch (_) {
      return { isVisible: false };
    }
  }

  function captureParentChain(el, depth) {
    const chain = [];
    let current = el.parentElement;
    let level = 0;
    while (current && current !== document.documentElement && level < depth) {
      const entry = { tag: current.tagName?.toLowerCase() || '' };
      if (current.id) entry.id = current.id;
      if (current.className && typeof current.className === 'string') {
        entry.classes = current.className.trim().split(/\s+/).slice(0, 3).join(' ');
      }
      // Capture data-*, aria-label for source grep
      const ids = captureIdentifiers(current);
      if (ids) entry.identifiers = ids;
      chain.push(entry);
      current = current.parentElement;
      level++;
    }
    return chain;
  }

  function captureSnapshot(element) {
    if (!element) return null;
    try {
      return {
        selector: getSelector(element),
        outerHTML: truncateHTML(element.outerHTML, 2048),
        identifiers: captureIdentifiers(element),
        computedStyles: captureStyles(element),
        boundingRect: captureBoundingRect(element),
        visibility: checkVisibility(element),
        parentChain: captureParentChain(element, 7),
      };
    } catch (_) {
      return null;
    }
  }

  return { captureSnapshot };
}
