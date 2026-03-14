// Screenshot capture — region select overlay for MAIN world
// eslint-disable-next-line no-unused-vars
function createScreenshotCapture(postMessage) {
  let regionSelectActive = false;
  let overlay = null;
  let startX = 0;
  let startY = 0;
  let selectionBox = null;

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

  function stop() {
    cleanupRegion();
  }

  return { requestElementScreenshot, requestFullPageScreenshot, startRegionSelect, stop };
}
