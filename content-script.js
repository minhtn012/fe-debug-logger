// ISOLATED world bridge — forwards messages between MAIN world and background
(function () {
  const SIGNATURE = 'fe-debug-logger';

  // Listen for messages from MAIN world content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.__source !== SIGNATURE) return;

    // Forward to background service worker
    chrome.runtime.sendMessage(msg).catch(() => {});
  });

  // Listen for commands from background/popup and relay to MAIN world
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_CAPTURE' || msg.type === 'STOP_CAPTURE') {
      window.postMessage({ __source: SIGNATURE, ...msg }, '*');
      sendResponse({ ok: true });
    }
    return false;
  });
})();
