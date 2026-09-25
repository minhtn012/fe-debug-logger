// Frozen shot — the tab screenshot taken the moment a picker starts, before the
// picker overlay or outline paints. Element crops for that picker come from this
// image, so they show the page exactly as it was frozen (open menus included).
// Stored in storage.local, not storage.session: retina PNGs run 2-5 MB and a
// picker can outlive the service worker.
const FROZEN_SHOT_PREFIX = 'frozen_shot_';

function frozenShotKey(tabId) {
  return FROZEN_SHOT_PREFIX + tabId;
}

// eslint-disable-next-line no-unused-vars
async function getFrozenShot(tabId) {
  if (tabId == null) return null;
  const key = frozenShotKey(tabId);
  const data = await chrome.storage.local.get([key]);
  return data[key] || null;
}

function clearFrozenShot(tabId) {
  if (tabId == null) return;
  chrome.storage.local.remove(frozenShotKey(tabId)).catch(() => {});
}

// Every picker entry point (hotkey, popup, floating button) goes through here.
// A shot already stored means a picker is live on this tab: the start message is
// then a toggle-off or a no-op in the page, and recapturing would bake the
// picker's own outline/form into the image.
// eslint-disable-next-line no-unused-vars
async function beginPicker(tabId, startMsg) {
  let frozen = false;
  try {
    if (await getFrozenShot(tabId)) {
      frozen = true;
    } else {
      const tab = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      await chrome.storage.local.set({ [frozenShotKey(tabId)]: { dataUrl, ts: Date.now() } });
      frozen = true;
    }
  } catch (err) {
    // chrome:// pages, missing permission, quota: the save falls back to a live capture
    console.warn('__fe_debug_logger__', 'Frozen shot unavailable:', err?.message || err);
  }
  chrome.tabs.sendMessage(tabId, { ...startMsg, frozen }).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => clearFrozenShot(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') clearFrozenShot(tabId);
});
