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
})();
