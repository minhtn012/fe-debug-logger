// Page freeze — keeps the page exactly as it looked when a picker started, so an
// open dropdown / hover menu survives the pick and matches the frozen screenshot.
// Capture listeners on window swallow every user event before page code sees it.
// They are registered when the factory runs at document_start, ahead of any page
// listener on window, and do nothing until freeze(). Events inside the
// extension's own Shadow DOM hosts go to handlers.onOwn: when it claims one, the
// event stops here so page "click outside" listeners never see it; otherwise
// it passes through untouched. Used by every picker mode.
// eslint-disable-next-line no-unused-vars
function createPageFreeze() {
  const STYLE_ID = '__fe_freeze_style';
  const HOVER_CLASS = '__fe_freeze_hover';
  const MAX_HOVER_RULES = 2000;
  const SHIELD_EVENTS = [
    'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout',
    'pointerenter', 'pointerleave', 'pointercancel',
    'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'click', 'dblclick', 'auxclick', 'contextmenu', 'selectstart', 'dragstart',
    'focus', 'blur', 'focusin', 'focusout', 'keydown', 'keyup', 'keypress',
    'wheel', 'touchstart', 'touchmove', 'touchend',
  ];
  // Cancelling touchstart/touchend would also cancel the synthesized click the
  // picker needs on touch screens; propagation is still stopped for them.
  const NO_DEFAULT_PREVENT = new Set(['touchstart', 'touchend']);
  const LISTENER_OPTS = { capture: true, passive: false };

  let frozen = false;
  let handlers = {};
  let ownHosts = [];
  let styleEl = null;
  let hoverEls = [];
  let docScroll = null;
  let elementScroll = new Map();

  function isOwnEvent(e) {
    if (!ownHosts.length) return false;
    const path = e.composedPath();
    return ownHosts.some((host) => host && path.includes(host));
  }

  // Remember scroll offsets of scrollable ancestors the user touches, so a
  // scrollbar drag on an inner container (Odoo scrolls .o_content, not the page)
  // can be undone in the scroll listener.
  function rememberScrollers(target) {
    let el = target instanceof Element ? target : null;
    while (el && el !== document.documentElement) {
      if (!elementScroll.has(el) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
        elementScroll.set(el, { top: el.scrollTop, left: el.scrollLeft });
      }
      el = el.parentElement;
    }
  }

  function callHandler(name, e) {
    const fn = handlers[name];
    if (!fn) return;
    try { fn(e); } catch (err) { console.error('__fe_debug_logger__', 'Picker handler failed:', err); }
  }

  function onShieldEvent(e) {
    if (!frozen) return;
    if (isOwnEvent(e)) {
      let claimed = false;
      try { claimed = !!(handlers.onOwn && handlers.onOwn(e)); } catch (err) { console.error('__fe_debug_logger__', 'Picker own-event handler failed:', err); }
      if (claimed) e.stopImmediatePropagation();
      return;
    }
    if (e.type === 'pointerdown' || e.type === 'mousedown' || e.type === 'wheel' || e.type === 'touchstart') {
      rememberScrollers(e.target);
    }
    if (e.type === 'mousemove') callHandler('onMove', e);
    else if (e.type === 'click') callHandler('onClick', e);
    else if (e.type === 'keydown') callHandler('onKey', e);

    // Leave browser shortcuts (Cmd/Ctrl + key) alone; every other key would move
    // focus, scroll, or type into the page's focused input.
    const isShortcut = e.type.startsWith('key') && (e.metaKey || e.ctrlKey);
    if (e.cancelable && !isShortcut && !NO_DEFAULT_PREVENT.has(e.type)) e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onScroll(e) {
    if (!frozen) return;
    const target = e.target;
    if (target === document || target === document.documentElement || target === document.scrollingElement) {
      if (docScroll && (window.scrollX !== docScroll.x || window.scrollY !== docScroll.y)) {
        window.scrollTo({ left: docScroll.x, top: docScroll.y, behavior: 'instant' });
      }
      return;
    }
    const saved = elementScroll.get(target);
    if (saved && (target.scrollTop !== saved.top || target.scrollLeft !== saved.left)) {
      target.scrollTo({ top: saved.top, left: saved.left, behavior: 'instant' });
    }
  }

  // Copy every :hover rule as a class rule, then pin the class on the elements
  // hovered right now — CSS-only hover menus stay open after the pointer leaves.
  function collectHoverRules(rules, out) {
    for (const rule of rules) {
      if (out.length >= MAX_HOVER_RULES) return;
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText && rule.selectorText.includes(':hover')) {
          out.push(`${rule.selectorText.replace(/:hover/g, '.' + HOVER_CLASS)} { ${rule.style.cssText} }`);
        }
      } else if (rule.cssRules) {
        const inner = [];
        collectHoverRules(rule.cssRules, inner);
        if (!inner.length) continue;
        if (rule instanceof CSSMediaRule) out.push(`@media ${rule.media.mediaText} { ${inner.join('\n')} }`);
        else if (rule instanceof CSSSupportsRule) out.push(`@supports ${rule.conditionText} { ${inner.join('\n')} }`);
        else out.push(...inner); // @layer and other grouping rules: unwrapped copy wins the cascade anyway
      }
    }
  }

  function buildHoverCss() {
    const out = [];
    const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
    for (const sheet of sheets) {
      if (out.length >= MAX_HOVER_RULES) break;
      try { collectHoverRules(sheet.cssRules, out); } catch (_) { /* cross-origin sheet */ }
    }
    return out.slice(0, MAX_HOVER_RULES).join('\n');
  }

  function injectStyle() {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = [
      '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }',
      buildHoverCss(),
    ].join('\n');
    document.documentElement.appendChild(styleEl);
  }

  function pinHovered() {
    hoverEls = [...document.querySelectorAll(':hover')];
    hoverEls.forEach((el) => el.classList.add(HOVER_CLASS));
  }

  function freeze(pickerHandlers, hosts) {
    if (frozen) return;
    frozen = true;
    handlers = pickerHandlers || {};
    ownHosts = (hosts || []).filter(Boolean);
    docScroll = { x: window.scrollX, y: window.scrollY };
    elementScroll = new Map();
    // Pin hover before the style lands so the snapshot of :hover is untouched
    try { pinHovered(); } catch (e) { console.error('__fe_debug_logger__', 'Hover pin failed:', e); }
    try { injectStyle(); } catch (e) { console.error('__fe_debug_logger__', 'Freeze style failed:', e); }
  }

  function unfreeze() {
    if (!frozen) return;
    frozen = false;
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
    hoverEls.forEach((el) => el.classList.remove(HOVER_CLASS));
    hoverEls = [];
    handlers = {};
    ownHosts = [];
    docScroll = null;
    elementScroll = new Map();
  }

  function isFrozen() { return frozen; }

  SHIELD_EVENTS.forEach((type) => window.addEventListener(type, onShieldEvent, LISTENER_OPTS));
  window.addEventListener('scroll', onScroll, true);

  return { freeze, unfreeze, isFrozen };
}
