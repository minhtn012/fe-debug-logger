// Annotation capture — inspect mode element picker + overlay form via Shadow DOM.
// Two modes share the picker/overlay: 'annotate' (bug notes, default) and
// 'feedback' (note + kind for a feedback session), which hands its payload to
// opts.onSave.
// Page events reach the picker through pageFreeze's shield, never through
// listeners of this module, so the page stays frozen while picking.
// eslint-disable-next-line no-unused-vars
function createAnnotationCapture(postLog, pageFreeze) {
  const CONTAINER_ID = '__fe_debug_annotation_root__';
  let active = false;
  let mode = 'annotate';
  let modeOpts = null; // feedback: { onSave, onStop, ownHosts }
  let shadowRoot = null;
  let container = null;
  let selectedElement = null;
  // Rect at click time: the frozen screenshot shows the page at that moment, so
  // crops use it even if the element moved or vanished before Save.
  let clickRect = null;
  let highlightedElement = null;
  let formVisible = false;
  let annotationCount = 0;
  let domSnapshotCapture = null;

  // Lazy init DOM snapshot
  function getDomSnapshot() {
    if (!domSnapshotCapture) {
      try { domSnapshotCapture = createDomSnapshotCapture(); } catch (_) {}
    }
    return domSnapshotCapture;
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
        // Skip the extension's own classes (page-freeze hover pin)
        const classes = current.className.trim().split(/\s+/).filter((c) => c && !c.startsWith('__fe_')).slice(0, 2);
        if (classes.length) tag += '.' + classes.join('.');
      }
      parts.unshift(tag);
      current = current.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  // --- Shadow DOM overlay ---
  function injectOverlay() {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    shadowRoot = container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = `
      <style>${getOverlayCSS()}</style>
      <div class="annotation-form hidden" id="annotForm">
        <div class="form-header">
          <span class="form-title" id="formTitle">Annotation</span>
          <button class="close-btn" id="cancelBtn">&times;</button>
        </div>
        <textarea id="noteInput" placeholder="Describe the issue..." rows="3"></textarea>
        <div class="form-row fb-only">
          <label>Loại</label>
          <select id="kindSelect"><option value="bug" selected>Bug</option><option value="suggestion">Góp ý</option></select>
        </div>
        <div class="form-row annot-only">
          <label>Severity</label>
          <select id="severitySelect">
            <option value="critical">Critical</option>
            <option value="major" selected>Major</option>
            <option value="minor">Minor</option>
          </select>
        </div>
        <div class="form-row annot-only">
          <label>Tags</label>
          <div class="tags" id="tagContainer">
            <span class="tag active" data-tag="UI">UI</span>
            <span class="tag" data-tag="Logic">Logic</span>
            <span class="tag" data-tag="API">API</span>
            <span class="tag" data-tag="Style">Style</span>
          </div>
        </div>
        <div class="form-row options-row annot-only">
          <label><input type="checkbox" id="optScreenshot" checked> Screenshot</label>
          <label><input type="checkbox" id="optDomSnapshot" checked> DOM Snapshot</label>
        </div>
        <div class="form-actions">
          <button class="btn btn-save" id="saveBtn">Save</button>
          <button class="btn btn-cancel" id="cancelBtn2">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(container);
  }

  function getOverlayCSS() {
    return `
      :host { all: initial; position: fixed; top: 0; left: 0; z-index: 999999; pointer-events: none; }
      .annotation-form {
        position: fixed; background: #fff; border: 2px solid #3b82f6; border-radius: 8px;
        padding: 12px; width: 280px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px; color: #1a1a1a; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 999999; pointer-events: auto; line-height: 1.4;
      }
      .annotation-form.hidden { display: none; }
      .annotation-form.feedback-mode .annot-only, .fb-only { display: none; }
      .annotation-form.feedback-mode .fb-only { display: block; }
      .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .form-title { font-weight: 600; font-size: 14px; }
      .close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: #666; padding: 0 4px; }
      .close-btn:hover { color: #000; }
      textarea {
        width: 100%; border: 1px solid #d1d5db; border-radius: 4px; padding: 6px 8px;
        font-size: 13px; font-family: inherit; resize: vertical; margin-bottom: 8px;
        box-sizing: border-box;
      }
      textarea:focus { outline: none; border-color: #3b82f6; }
      .form-row { margin-bottom: 8px; }
      .form-row label { font-size: 12px; font-weight: 500; color: #374151; display: block; margin-bottom: 4px; }
      select {
        width: 100%; border: 1px solid #d1d5db; border-radius: 4px; padding: 4px 8px;
        font-size: 13px; background: #fff;
      }
      .tags { display: flex; gap: 4px; flex-wrap: wrap; }
      .tag {
        padding: 2px 8px; border-radius: 12px; border: 1px solid #d1d5db; font-size: 11px;
        cursor: pointer; user-select: none; background: #f9fafb; color: #374151;
      }
      .tag.active { background: #3b82f6; color: #fff; border-color: #3b82f6; }
      .tag:hover { border-color: #3b82f6; }
      .options-row { display: flex; gap: 12px; }
      .options-row label { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; margin-bottom: 0; }
      .form-actions { display: flex; gap: 8px; margin-top: 4px; }
      .btn {
        flex: 1; padding: 6px; border: none; border-radius: 4px; font-size: 13px;
        font-weight: 500; cursor: pointer;
      }
      .btn-save { background: #3b82f6; color: #fff; }
      .btn-save:hover { background: #2563eb; }
      .btn-cancel { background: #e5e7eb; color: #374151; }
      .btn-cancel:hover { background: #d1d5db; }
    `;
  }

  // --- Element picker ---
  function onMouseMove(e) {
    if (formVisible) return;
    const el = e.target;
    if (!el || el === container || container.contains(el)) return;
    if (highlightedElement && highlightedElement !== el) {
      highlightedElement.style.outline = highlightedElement.__feDebugOriginalOutline || '';
      delete highlightedElement.__feDebugOriginalOutline;
    }
    if (el !== highlightedElement) {
      highlightedElement = el;
      highlightedElement.__feDebugOriginalOutline = highlightedElement.style.outline;
      highlightedElement.style.outline = '2px dashed #3b82f6';
    }
  }

  function onMouseClick(e) {
    if (formVisible) return;
    // Skip clicks on our overlay
    if (e.target === container || container.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    selectedElement = e.target;
    const r = selectedElement.getBoundingClientRect();
    clickRect = { x: r.x, y: r.y, width: r.width, height: r.height };
    // Remove highlight
    if (highlightedElement) {
      highlightedElement.style.outline = highlightedElement.__feDebugOriginalOutline || '';
      delete highlightedElement.__feDebugOriginalOutline;
      highlightedElement = null;
    }
    showForm(selectedElement);
  }

  // --- Form ---
  function showForm(element) {
    formVisible = true;
    const form = shadowRoot.getElementById('annotForm');
    form.classList.remove('hidden');

    // Position form near element
    const rect = element.getBoundingClientRect();
    let top = rect.top;
    let left = rect.right + 10;
    // Fallback if overflows right
    if (left + 290 > window.innerWidth) left = Math.max(10, rect.left - 290);
    // Fallback if overflows bottom
    if (top + 300 > window.innerHeight) top = Math.max(10, window.innerHeight - 310);
    form.style.top = top + 'px';
    form.style.left = left + 'px';

    // Reset form
    shadowRoot.getElementById('noteInput').value = '';
    shadowRoot.getElementById('noteInput').style.borderColor = '';
    shadowRoot.getElementById('severitySelect').value = 'major';
    shadowRoot.getElementById('kindSelect').value = 'bug';
    shadowRoot.getElementById('noteInput').focus();
  }

  function closeForm() {
    formVisible = false;
    const form = shadowRoot.getElementById('annotForm');
    form.classList.add('hidden');
    selectedElement = null;
    clickRect = null;
  }

  // True when the picked element is gone or collapsed at save time — the crop
  // still comes from the click-time rect, but the DOM snapshot may not match it.
  function domChangedSinceClick(el) {
    if (!el || !el.isConnected) return true;
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0;
  }

  function getSelectedTags() {
    const tags = [];
    shadowRoot.querySelectorAll('.tag.active').forEach((t) => tags.push(t.dataset.tag));
    return tags;
  }

  function truncateText(str, maxLen) {
    if (!str) return '';
    const s = str.trim().replace(/\s+/g, ' ');
    return s.length > maxLen ? s.substring(0, maxLen) + '...' : s;
  }

  // Feedback mode save: kind + note + padded crop rect; the coordinator adds the
  // page URL and sends the item to background.
  function saveFeedback() {
    const noteEl = shadowRoot.getElementById('noteInput');
    const note = noteEl.value.trim();
    if (!note) {
      noteEl.style.borderColor = '#dc2626';
      return;
    }
    const el = selectedElement;
    handOff({
      kind: shadowRoot.getElementById('kindSelect').value,
      note,
      selector: getSelector(el),
      elementText: truncateText(el.textContent, 100),
      cropRect: paddedCropRect(clickRect),
      dpr: window.devicePixelRatio || 1,
      domChangedAfterFreeze: domChangedSinceClick(el),
    });
  }

  // Close the form, then give the payload to opts.onSave after the overlay
  // repaint (a live-capture fallback must not see the form). Inspect mode stays on.
  function handOff(payload) {
    const onSave = modeOpts && modeOpts.onSave;
    closeForm();
    if (!onSave) return;
    setTimeout(() => {
      try { onSave(payload); } catch (e) { console.error('__fe_debug_logger__', `${mode} save failed:`, e); }
    }, 100);
  }

  function saveAnnotation() {
    if (mode === 'feedback') return saveFeedback();

    const note = shadowRoot.getElementById('noteInput').value.trim();
    if (!note) {
      shadowRoot.getElementById('noteInput').style.borderColor = '#dc2626';
      return;
    }

    const wantScreenshot = shadowRoot.getElementById('optScreenshot').checked;
    const wantDomSnapshot = shadowRoot.getElementById('optDomSnapshot').checked;

    let domSnapshot = null;
    if (wantDomSnapshot) {
      const snap = getDomSnapshot();
      if (snap) domSnapshot = snap.captureSnapshot(selectedElement);
    }

    const annotationId = `annotation_${Date.now()}_${annotationCount}`;
    annotationCount++;

    const entry = {
      category: 'annotation',
      type: 'bug-note',
      annotationId,
      selector: getSelector(selectedElement),
      note,
      severity: shadowRoot.getElementById('severitySelect').value,
      tags: getSelectedTags(),
      wantScreenshot,
      domSnapshot,
      timestamp: new Date().toISOString(),
    };
    if (domChangedSinceClick(selectedElement)) entry.domChangedAfterFreeze = true;

    // Capture the click-time rect before closing the form resets it
    const screenshotRect = clickRect;

    postLog('annotation', entry);

    // Update count in session storage via message
    window.postMessage({
      __source: 'fe-debug-logger',
      version: 1,
      type: 'ANNOTATION_COUNT',
      count: annotationCount,
    }, '*');

    closeForm();

    // Delay screenshot to allow overlay removal + repaint
    if (wantScreenshot && screenshotRect) {
      setTimeout(() => requestScreenshot(screenshotRect, annotationId), 100);
    }
    // Stay in inspect mode for next annotation
  }

  // Proportional padding: 30%, min 20px, max 100px, clamped to the viewport
  function paddedCropRect(rect) {
    const padX = Math.min(100, Math.max(20, rect.width * 0.3));
    const padY = Math.min(100, Math.max(20, rect.height * 0.3));
    return {
      x: Math.max(0, rect.x - padX),
      y: Math.max(0, rect.y - padY),
      width: Math.min(window.innerWidth - Math.max(0, rect.x - padX), rect.width + padX * 2),
      height: Math.min(window.innerHeight - Math.max(0, rect.y - padY), rect.height + padY * 2),
    };
  }

  function requestScreenshot(rect, annotationId) {
    const cropRect = paddedCropRect(rect);
    window.postMessage({
      __source: 'fe-debug-logger',
      version: 1,
      type: 'REQUEST_SCREENSHOT',
      mode: 'element',
      cropRect,
      dpr: window.devicePixelRatio || 1,
      annotationId,
    }, '*');
  }

  // --- Key handler ---
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (formVisible) {
        closeForm();
      } else {
        stop();
      }
    }
  }

  // --- Form events ---
  // The freeze shield stops every event inside the overlay at window, so page
  // listeners never see clicks on the form (a menu open behind it stays open).
  // The form's own nodes get no listener calls either: the shield hands the
  // events here. Default actions (focus, typing, select, checkbox) still run.
  function onOwnEvent(e) {
    const path = e.composedPath();
    if (!container || !path.includes(container)) return false;
    const target = path[0];
    if (e.type === 'click' && target.id === 'saveBtn') saveAnnotation();
    else if (e.type === 'click' && (target.id === 'cancelBtn' || target.id === 'cancelBtn2')) closeForm();
    else if (e.type === 'click' && target.classList && target.classList.contains('tag')) target.classList.toggle('active');
    else if (e.type === 'keydown' && e.key === 'Escape') {
      e.preventDefault();
      closeForm();
    }
    return true;
  }

  // --- Public API ---
  function start(startMode, opts) {
    if (active) return;
    active = true;
    mode = startMode === 'feedback' ? 'feedback' : 'annotate';
    modeOpts = mode === 'annotate' ? null : (opts || {});
    injectOverlay();
    const form = shadowRoot.getElementById('annotForm');
    if (mode === 'feedback') {
      form.classList.add('feedback-mode');
      shadowRoot.getElementById('formTitle').textContent = 'Feedback';
      shadowRoot.getElementById('noteInput').placeholder = 'Mô tả bug hoặc góp ý...';
      shadowRoot.getElementById('saveBtn').textContent = 'Lưu';
      shadowRoot.getElementById('cancelBtn2').textContent = 'Huỷ';
    }
    const ownHosts = [container, ...((modeOpts && modeOpts.ownHosts) || [])];
    pageFreeze.freeze({ onMove: onMouseMove, onClick: onMouseClick, onKey: onKeyDown, onOwn: onOwnEvent }, ownHosts);
    document.body.style.cursor = 'crosshair';
  }

  function stop() {
    if (!active) return;
    active = false;
    formVisible = false;
    pageFreeze.unfreeze();
    document.body.style.cursor = '';
    // Clean up highlight
    if (highlightedElement) {
      highlightedElement.style.outline = highlightedElement.__feDebugOriginalOutline || '';
      delete highlightedElement.__feDebugOriginalOutline;
      highlightedElement = null;
    }
    // Remove overlay
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    shadowRoot = null;
    selectedElement = null;
    clickRect = null;
    const onStop = modeOpts && modeOpts.onStop;
    mode = 'annotate';
    modeOpts = null;

    // Notify stop
    window.postMessage({
      __source: 'fe-debug-logger',
      version: 1,
      type: 'ANNOTATE_STOPPED',
    }, '*');
    if (onStop) {
      try { onStop(); } catch (e) { console.error('__fe_debug_logger__', 'Picker stop callback failed:', e); }
    }
  }

  function isActive() { return active; }

  return { start, stop, isActive };
}
