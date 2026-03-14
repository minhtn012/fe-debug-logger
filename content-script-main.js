// MAIN world script — coordinates all capture modules
(function () {
  const SIGNATURE = 'fe-debug-logger';
  let recording = false;
  let config = {};

  // Post log entry to ISOLATED world bridge
  function postLog(category, data) {
    window.postMessage({
      __source: SIGNATURE,
      version: 1,
      type: 'LOG_ENTRY',
      data: { category, ...data },
    }, '*');
  }

  // Post generic message to ISOLATED world bridge
  function postMessage(msg) {
    window.postMessage(msg, '*');
  }

  // Wrap postLog for console errors to trigger component snapshot
  function postLogWithSnapshot(category, data) {
    postLog(category, data);
    if (config.componentState && category === 'console' && (data.type === 'error' || data.type === 'onerror' || data.type === 'unhandledrejection')) {
      try { captures.componentState.snapshot(); } catch (_) {}
    }
  }

  // Initialize capture modules
  const captures = {
    console: createConsoleCapture(postLogWithSnapshot),
    userAction: createUserActionCapture(postLog),
    network: createNetworkCapture(postLog),
    componentState: createComponentStateCapture(postLog),
    annotation: createAnnotationCapture(postLog),
    screenshot: createScreenshotCapture(postMessage),
  };

  function startCapture(cfg) {
    recording = true;
    config = cfg;

    // Send page metadata
    window.postMessage({
      __source: SIGNATURE,
      version: 1,
      type: 'PAGE_META',
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    }, '*');

    try { if (cfg.console) captures.console.start(cfg); } catch (e) { console.error('__fe_debug_logger__', 'Console capture failed:', e); }
    try { if (cfg.userActions) captures.userAction.start(cfg); } catch (e) { console.error('__fe_debug_logger__', 'User action capture failed:', e); }
    try { if (cfg.network) captures.network.start(cfg); } catch (e) { console.error('__fe_debug_logger__', 'Network capture failed:', e); }
    try { if (cfg.componentState) captures.componentState.start(); } catch (e) { console.error('__fe_debug_logger__', 'Component state capture failed:', e); }
  }

  function stopCapture() {
    recording = false;
    try { captures.console.stop(); } catch (_) {}
    try { captures.userAction.stop(); } catch (_) {}
    try { captures.network.stop(); } catch (_) {}
    try { captures.componentState.stop(); } catch (_) {}
    try { captures.annotation.stop(); } catch (_) {}
    try { captures.screenshot.stop(); } catch (_) {}
  }

  // Listen for commands from ISOLATED world bridge
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__source !== SIGNATURE) return;

    if (msg.type === 'START_CAPTURE') {
      startCapture(msg.config || {});
    } else if (msg.type === 'STOP_CAPTURE') {
      stopCapture();
    } else if (msg.type === 'START_ANNOTATE') {
      try { captures.annotation.start(); } catch (e) { console.error('__fe_debug_logger__', 'Annotation start failed:', e); }
    } else if (msg.type === 'STOP_ANNOTATE') {
      try { captures.annotation.stop(); } catch (_) {}
    } else if (msg.type === 'START_REGION_SELECT') {
      try { captures.screenshot.startRegionSelect(); } catch (e) { console.error('__fe_debug_logger__', 'Region select failed:', e); }
    }
  });
})();
