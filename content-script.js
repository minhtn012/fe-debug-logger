// ISOLATED world bridge — forwards messages between MAIN world and background
(function () {
  const SIGNATURE = 'fe-debug-logger';

  // Message types that should be relayed from MAIN → background
  const RELAY_TO_BACKGROUND = ['LOG_ENTRY', 'PAGE_META', 'REQUEST_SCREENSHOT', 'ANNOTATION_COUNT', 'ANNOTATE_STOPPED'];

  // Message types that should be relayed from background → MAIN world
  const RELAY_TO_MAIN = ['START_CAPTURE', 'STOP_CAPTURE', 'START_ANNOTATE', 'STOP_ANNOTATE', 'START_REGION_SELECT'];

  // Listen for messages from MAIN world content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__source !== SIGNATURE) return;

    if (RELAY_TO_BACKGROUND.includes(msg.type)) {
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
  });

  // Listen for commands from background/popup and relay to MAIN world
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (RELAY_TO_MAIN.includes(msg.type)) {
      window.postMessage({ __source: SIGNATURE, ...msg }, '*');
      sendResponse({ ok: true });
    }
    return false;
  });

  // Auto-resume: on init (page load / reload / navigation / newly opened tab),
  // ask background whether a recording is active. If so, re-activate MAIN world
  // capture so it survives reloads and covers every tab — no new permission needed.
  // In practice the async round-trip to background far outlasts the synchronous MAIN
  // world injection at document_start, so its START_CAPTURE listener is ready by the
  // time we post. startCapture() is idempotent, so a duplicate START (this handshake
  // racing the Record broadcast) is harmless.
  chrome.runtime
    .sendMessage({ type: 'GET_STATUS' })
    .then((resp) => {
      if (resp && resp.recording) {
        window.postMessage({ __source: SIGNATURE, type: 'START_CAPTURE', config: resp.config || {} }, '*');
      }
    })
    .catch(() => {});
})();
