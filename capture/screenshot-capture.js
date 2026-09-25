// Screenshot capture — region select overlay for MAIN world
// eslint-disable-next-line no-unused-vars
function createScreenshotCapture(postMessage) {
  let regionSelectActive = false;
  let overlay = null;
  let startX = 0;
  let startY = 0;
  let selectionBox = null;
  let lastRegion = null;
  let noteHost = null;

  function requestElementScreenshot(element, annotationId) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const padX = Math.min(100, Math.max(20, rect.width * 0.3));
    const padY = Math.min(100, Math.max(20, rect.height * 0.3));
    const cropRect = {
      x: Math.max(0, rect.x - padX),
      y: Math.max(0, rect.y - padY),
      width: Math.min(window.innerWidth - Math.max(0, rect.x - padX), rect.width + padX * 2),
      height: Math.min(window.innerHeight - Math.max(0, rect.y - padY), rect.height + padY * 2),
    };
    // Scroll into view if needed
    try { element.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    setTimeout(() => {
      postMessage({
        __source: 'fe-debug-logger',
        version: 1,
        type: 'REQUEST_SCREENSHOT',
        mode: 'element',
        cropRect,
        dpr: window.devicePixelRatio || 1,
        annotationId,
      });
    }, 50);
  }

  function requestFullPageScreenshot() {
    postMessage({
      __source: 'fe-debug-logger',
      version: 1,
      type: 'REQUEST_SCREENSHOT',
      mode: 'full',
      dpr: window.devicePixelRatio || 1,
    });
  }

  function startRegionSelect() {
    if (regionSelectActive) return;
    regionSelectActive = true;

    overlay = document.createElement('div');
    overlay.id = '__fe_debug_region_overlay__';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.2)', zIndex: '999998', cursor: 'crosshair',
    });

    selectionBox = document.createElement('div');
    Object.assign(selectionBox.style, {
      position: 'fixed', border: '2px dashed #3b82f6', background: 'rgba(59,130,246,0.1)',
      zIndex: '999999', display: 'none', pointerEvents: 'none',
    });
    overlay.appendChild(selectionBox);
    document.body.appendChild(overlay);

    overlay.addEventListener('mousedown', onRegionMouseDown);
    overlay.addEventListener('mousemove', onRegionMouseMove);
    overlay.addEventListener('mouseup', onRegionMouseUp);
    document.addEventListener('keydown', onRegionKeyDown, true);
  }

  function onRegionMouseDown(e) {
    startX = e.clientX;
    startY = e.clientY;
    selectionBox.style.display = 'block';
    selectionBox.style.left = startX + 'px';
    selectionBox.style.top = startY + 'px';
    selectionBox.style.width = '0';
    selectionBox.style.height = '0';
  }

  function onRegionMouseMove(e) {
    if (selectionBox.style.display === 'none') return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selectionBox.style.left = x + 'px';
    selectionBox.style.top = y + 'px';
    selectionBox.style.width = w + 'px';
    selectionBox.style.height = h + 'px';
  }

  function onRegionMouseUp(e) {
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    cleanupRegion();

    if (w < 10 || h < 10) return; // Too small, ignore
    lastRegion = { x, y, width: w, height: h };
    postMessage({
      __source: 'fe-debug-logger',
      version: 1,
      type: 'REQUEST_SCREENSHOT',
      mode: 'region',
      cropRect: { x, y, width: w, height: h },
      dpr: window.devicePixelRatio || 1,
    });
  }

  function onRegionKeyDown(e) {
    if (e.key === 'Escape' && regionSelectActive) {
      e.preventDefault();
      e.stopPropagation();
      cleanupRegion();
    }
  }

  function cleanupRegion() {
    regionSelectActive = false;
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', onRegionKeyDown, true);
    overlay = null;
    selectionBox = null;
  }

  // --- Note prompt, shown once background has stored a region or full-page shot ---
  function promptNote(screenshotId, mode) {
    closeNote();
    noteHost = document.createElement('div');
    noteHost.id = '__fe_debug_shot_note__';
    const root = noteHost.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; position: fixed; top: 0; left: 0; z-index: 999999; }
        .box {
          position: fixed; width: 280px; background: #fff; border: 2px solid #3b82f6; border-radius: 8px;
          padding: 12px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: #1a1a1a;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15); box-sizing: border-box;
        }
        .title { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
        textarea {
          width: 100%; border: 1px solid #d1d5db; border-radius: 4px; padding: 6px 8px; font: inherit;
          resize: vertical; margin-bottom: 8px; box-sizing: border-box;
        }
        textarea:focus { outline: none; border-color: #3b82f6; }
        .actions { display: flex; gap: 8px; }
        button { flex: 1; padding: 6px; border: none; border-radius: 4px; font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
        .save { background: #3b82f6; color: #fff; }
        .save:hover { background: #2563eb; }
        .skip { background: #e5e7eb; color: #374151; }
        .skip:hover { background: #d1d5db; }
      </style>
      <div class="box">
        <div class="title">${mode === 'full' ? 'Full page screenshot' : 'Region screenshot'} saved</div>
        <textarea id="note" rows="3" placeholder="Add a note (optional)"></textarea>
        <div class="actions">
          <button class="save" id="save">Save note</button>
          <button class="skip" id="skip">Skip</button>
        </div>
      </div>
    `;
    const box = root.querySelector('.box');
    const pos = notePosition();
    box.style.top = pos.top + 'px';
    box.style.left = pos.left + 'px';
    document.body.appendChild(noteHost);

    const input = root.getElementById('note');
    const save = () => {
      const note = input.value.trim();
      if (note) postMessage({ __source: 'fe-debug-logger', version: 1, type: 'SCREENSHOT_NOTE', screenshotId, note });
      closeNote();
    };
    root.getElementById('save').addEventListener('click', save);
    root.getElementById('skip').addEventListener('click', closeNote);
    // Keys typed in the note must not reach the page's own shortcuts
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeNote();
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
    });
    input.focus();
  }

  // Beside the selected region when there is room, else the top right corner
  function notePosition() {
    const W = 280, H = 170, gap = 10;
    const r = lastRegion;
    lastRegion = null;
    if (!r) return { top: 16, left: Math.max(10, window.innerWidth - W - 16) };
    let left = r.x + r.width + gap;
    if (left + W > window.innerWidth) left = r.x - W - gap;
    if (left < 10) left = Math.max(10, Math.min(r.x, window.innerWidth - W - 10));
    const top = Math.max(10, Math.min(r.y, window.innerHeight - H - 10));
    return { top, left };
  }

  function closeNote() {
    if (noteHost && noteHost.parentNode) noteHost.parentNode.removeChild(noteHost);
    noteHost = null;
  }

  function stop() {
    cleanupRegion();
    closeNote();
  }

  return { requestElementScreenshot, requestFullPageScreenshot, startRegionSelect, promptNote, stop };
}
