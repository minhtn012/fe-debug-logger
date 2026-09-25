// Feedback background — message handlers for feedback sessions, plus routing of
// LOG_ENTRY / PAGE_META from a tab whose origin has a live session into that
// session instead of the Record log. Loaded by background.js after feedback-store.js.
const feedbackStore = createFeedbackStore();
const FB_CROP_RETRY_MS = 3000;
const FB_CONSOLE_TYPES = new Set(['error', 'onerror', 'unhandledrejection']);
const fbPendingCrops = new Map(); // shotKey -> retry timer

// fb_active mirrored in memory: LOG_ENTRY is the hot path, one storage read per
// entry would be wasteful. storage.onChanged keeps it fresh across contexts.
let fbActiveCache = null;
let fbActiveLoad = null;
function fbLoadActive() {
  if (fbActiveCache) return Promise.resolve(fbActiveCache);
  fbActiveLoad = fbActiveLoad || chrome.storage.local.get(['fb_active']).then((d) => (fbActiveCache = d.fb_active || {}));
  return fbActiveLoad;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.fb_active) fbActiveCache = changes.fb_active.newValue || {};
});

// Only http(s) pages can host a session; chrome://, file:, blank tabs cannot.
function fbOriginOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch (_) { return null; }
}

function fbFromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && !!sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
}

// eslint-disable-next-line no-unused-vars
async function isFeedbackTab(url) {
  const origin = fbOriginOf(url);
  return !!origin && !!(await fbLoadActive())[origin];
}

async function fbBroadcastState(origin) {
  const state = await feedbackStore.getStatus(origin);
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null && fbOriginOf(tab.url) === origin) {
      chrome.tabs.sendMessage(tab.id, { type: 'FEEDBACK_STATE', ...state }).catch(() => {});
    }
  }
  return state;
}

// Errors go to the tab that asked only: the fab lives in the MAIN world and gets
// no sendResponse through the relay.
async function fbReject(sender, origin, error) {
  if (sender.tab?.id != null && origin) {
    const state = await feedbackStore.getStatus(origin);
    chrome.tabs.sendMessage(sender.tab.id, { type: 'FEEDBACK_STATE', ...state, error }).catch(() => {});
  }
  return { error };
}

async function fbToggleSite(origin) {
  await feedbackStore.toggleSite(origin);
  return fbBroadcastState(origin);
}

async function fbEnsureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Crop screenshot via Canvas API' });
  } catch (_) { /* a concurrent caller created it first */ }
}

// Crop from the picker's frozen shot. Offscreen can be closed mid-crop by a Record
// export finishing (EXPORT_READY/COPY_READY), so resend once if no reply in 3 s.
async function fbCropShot(tabId, shotKey, cropRect, dpr) {
  if (!cropRect) return;
  const frozen = await getFrozenShot(tabId);
  const dataUrl = frozen?.dataUrl || await chrome.tabs.captureVisibleTab((await chrome.tabs.get(tabId)).windowId, { format: 'png' });
  const send = async () => {
    await fbEnsureOffscreen();
    chrome.runtime.sendMessage({ type: 'CROP_SCREENSHOT', mode: 'element', dataUrl, cropRect, dpr: dpr || 1, feedbackShotKey: shotKey }).catch(() => {});
  };
  await send();
  fbPendingCrops.set(shotKey, setTimeout(() => {
    fbPendingCrops.delete(shotKey);
    send().catch((err) => console.error('__fe_debug_logger__', 'Feedback crop retry failed:', err));
  }, FB_CROP_RETRY_MS));
}

const FEEDBACK_HANDLERS = {
  async TOGGLE_FEEDBACK_SITE(msg, sender) {
    const origin = fbOriginOf(msg.origin);
    if (!fbFromExtensionPage(sender) || !origin) return { error: 'bad-origin' };
    return fbToggleSite(origin);
  },

  async GET_FEEDBACK_STATUS(msg, sender) {
    const origin = sender.tab ? fbOriginOf(sender.tab.url) : fbOriginOf(msg.origin);
    return origin ? feedbackStore.getStatus(origin) : { siteEnabled: false, session: null };
  },

  async START_FEEDBACK_SESSION(msg, sender) {
    const origin = fbOriginOf(sender.tab?.url);
    if (!origin) return { error: 'bad-origin' };
    if ((await chrome.storage.session.get(['recording'])).recording) return fbReject(sender, origin, 'recording-active');
    const res = await feedbackStore.startSession(origin, msg.name);
    if (res.error) return fbReject(sender, origin, res.error);
    return fbBroadcastState(origin);
  },

  async REQUEST_FEEDBACK_PICKER(msg, sender) {
    const origin = fbOriginOf(sender.tab?.url);
    if (!origin || !(await feedbackStore.getStatus(origin)).session) return fbReject(sender, origin, 'no-session');
    await beginPicker(sender.tab.id, { type: 'START_FEEDBACK_PICKER' });
    return { ok: true };
  },

  async FEEDBACK_ITEM(msg, sender) {
    const origin = fbOriginOf(sender.tab?.url);
    const sessionId = origin ? (await feedbackStore.getStatus(origin)).session?.id : null; // storage, not the lagging cache
    if (!sessionId) return fbReject(sender, origin, 'no-session');
    const res = await feedbackStore.addItem(sessionId, {
      kind: msg.kind === 'suggestion' ? 'suggestion' : 'bug',
      note: String(msg.note || ''),
      selector: msg.selector || '',
      elementText: msg.elementText || '',
      url: msg.url || sender.tab.url,
      domChangedAfterFreeze: !!msg.domChangedAfterFreeze,
    });
    if (res.error) return fbReject(sender, origin, res.error);
    fbCropShot(sender.tab.id, res.shotKey, msg.cropRect, msg.dpr)
      .catch((err) => console.error('__fe_debug_logger__', 'Feedback crop failed:', err));
    await fbBroadcastState(origin);
    return { ok: true, seq: res.seq };
  },

  async FINISH_FEEDBACK_SESSION(msg, sender) {
    const origin = fbOriginOf(sender.tab?.url);
    if (!origin) return { error: 'bad-origin' };
    const session = await feedbackStore.finishSession(origin);
    await fbBroadcastState(origin);
    if (session) fbOpenReview(session.id).catch((err) => console.error('__fe_debug_logger__', 'Open review failed:', err));
    return { ok: true, sessionId: session?.id || null };
  },

  async FEEDBACK_UPDATE_ITEM(msg, sender) { // review page only, like the two below
    if (!fbFromExtensionPage(sender)) return { error: 'forbidden' };
    return { ok: await feedbackStore.updateItem(msg.sessionId, msg.seq, msg.patch) };
  },

  async FEEDBACK_DELETE_ITEM(msg, sender) {
    if (!fbFromExtensionPage(sender)) return { error: 'forbidden' };
    const session = await feedbackStore.deleteItem(msg.sessionId, msg.seq);
    if (session && !session.finishedAt) await fbBroadcastState(session.origin);
    return { ok: !!session };
  },

  async FEEDBACK_DELETE_SESSION(msg, sender) {
    if (!fbFromExtensionPage(sender)) return { error: 'forbidden' };
    const { origin } = await feedbackStore.deleteSession(msg.sessionId);
    if (origin) await fbBroadcastState(origin);
    return { ok: true };
  },
};

// Returns true (async reply), false (handled, no reply) or undefined (not ours).
// eslint-disable-next-line no-unused-vars
function handleFeedbackMessage(msg, sender, sendResponse) {
  if (msg.type === 'SCREENSHOT_CROPPED' && msg.feedbackShotKey) {
    clearTimeout(fbPendingCrops.get(msg.feedbackShotKey)); // undefined timer is a no-op
    fbPendingCrops.delete(msg.feedbackShotKey);
    feedbackStore.setShot(msg.feedbackShotKey, msg.croppedDataUrl)
      .catch((err) => console.error('__fe_debug_logger__', 'Feedback shot store failed:', err));
    return false;
  }
  if (!FEEDBACK_HANDLERS[msg.type]) return undefined;
  FEEDBACK_HANDLERS[msg.type](msg, sender).then(sendResponse, (err) => {
    console.error('__fe_debug_logger__', `${msg.type} failed:`, err);
    sendResponse({ error: String(err?.message || err) });
  });
  return true;
}

// LOG_ENTRY / PAGE_META from a live feedback origin: store in the session and
// resolve true so the Record path skips it. Console warn is dropped (errors only).
// eslint-disable-next-line no-unused-vars
async function routeFeedbackLog(msg, sender) {
  const origin = fbOriginOf(sender.tab?.url);
  const sessionId = origin ? (await fbLoadActive())[origin] : null;
  if (!sessionId) return false;
  if (msg.type === 'PAGE_META') return feedbackStore.addPage(sessionId, msg.url, msg).then(() => true);
  const { __source, version, type, data, ...rest } = msg;
  const entry = data || rest;
  const keep = entry.category === 'network' || (entry.category === 'console' && FB_CONSOLE_TYPES.has(entry.type));
  if (keep) await feedbackStore.addLog(sessionId, entry);
  return true;
}
