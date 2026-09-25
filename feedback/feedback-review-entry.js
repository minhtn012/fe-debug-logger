// Ways into the review page: the Finish button, the toolbar icon's context menu
// (both builds) and the popup's "Xem feedback" button (full build). The toolbar
// icon click itself toggles the current site in builds without a popup.
// Loaded by background.js after feedback-background.js.
const FB_REVIEW_MENU = 'fb-open-review';

let fbReviewQueue = Promise.resolve();

// One review tab at a time: focus the open one, switching session only when asked,
// since a URL change reloads the page and drops a note not yet saved. Calls run one
// after another so a double click cannot query twice before the first tab exists.
function fbOpenReview(sessionId) {
  const run = fbReviewQueue.then(() => fbOpenReviewNow(sessionId));
  fbReviewQueue = run.catch(() => {});
  return run;
}

async function fbOpenReviewNow(sessionId) {
  const base = chrome.runtime.getURL('review.html');
  const url = sessionId ? `${base}?session=${encodeURIComponent(sessionId)}` : base;
  // Filter by hand: tabs.query's url match pattern does not reliably take chrome-extension://.
  // A tab created a moment ago has only pendingUrl, so a quick second call still finds it.
  const tab = (await chrome.tabs.query({})).find((t) => (t.pendingUrl || t.url || '').startsWith(base));
  if (!tab) { await chrome.tabs.create({ url }); return; }
  await chrome.tabs.update(tab.id, sessionId && (tab.pendingUrl || tab.url) !== url ? { active: true, url } : { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

FEEDBACK_HANDLERS.OPEN_FEEDBACK_REVIEW = async (msg, sender) => {
  if (!fbFromExtensionPage(sender)) return { error: 'forbidden' };
  await fbOpenReview();
  return { ok: true };
};

chrome.action.onClicked.addListener((tab) => {
  const origin = fbOriginOf(tab?.url);
  if (origin) fbToggleSite(origin).catch((err) => console.error('__fe_debug_logger__', 'Feedback toggle failed:', err));
});

// removeAll first: create() with an id left from the previous version throws.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: FB_REVIEW_MENU, title: 'Xem feedback đã lưu', contexts: ['action'] });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== FB_REVIEW_MENU) return;
  fbOpenReview().catch((err) => console.error('__fe_debug_logger__', 'Open review failed:', err));
});
