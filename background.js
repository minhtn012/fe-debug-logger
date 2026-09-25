importScripts('freeze-shot.js', 'feedback/feedback-store.js', 'feedback/feedback-background.js', 'feedback/feedback-review-entry.js');

let entryCounter = 0;
let annotationCounter = 0;
let screenshotCounter = 0;
const MAX_SCREENSHOTS = 5;
const MAX_ENTRIES = 2000; // Cap log entries to stay well under chrome.storage.local quota (~10MB)
let entryLimitWarned = false;

// Restore counters from storage on SW wake
chrome.storage.session.get(['recording', 'entryCounter', 'annotationCounter', 'screenshotCounter'], (data) => {
  entryCounter = data.entryCounter || 0;
  annotationCounter = data.annotationCounter || 0;
  screenshotCounter = data.screenshotCounter || 0;
  entryLimitWarned = entryCounter > MAX_ENTRIES; // already capped+warned if past the limit
});

// Versions with the Ask feature stored question packages under question_* / qshot_*;
// nothing reads them any more, so drop them on install or update.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null).then((all) => {
    const stale = Object.keys(all).filter((k) => k.startsWith('question_') || k.startsWith('qshot_'));
    if (stale.length) chrome.storage.local.remove(stale);
  }).catch(() => {});
});

// Gather log entries and screenshots for export/copy
async function gatherLogData() {
  const all = await chrome.storage.local.get(null);
  const logKeys = Object.keys(all).filter((k) => k.startsWith('log_')).sort();
  const entries = logKeys.map((k) => all[k]);
  // The offscreen document that formats the log cannot read the manifest
  const sessionMeta = { ...(all.sessionMeta || {}), toolVersion: chrome.runtime.getManifest().version };

  const screenshotKeys = Object.keys(all).filter((k) => k.startsWith('screenshot_')).sort();
  const screenshots = screenshotKeys.map((k) => ({ key: k, ...all[k] }));

  const screenshotMap = {};
  const screenshotFiles = [];
  let annotationIdx = 0;
  let fullIdx = 0;
  let regionIdx = 0;
  const shotList = [];

  for (const ss of screenshots) {
    let filename;
    if (ss.mode === 'full') {
      fullIdx++;
      filename = `full-page-${String(fullIdx).padStart(3, '0')}.png`;
    } else if (ss.mode === 'region') {
      regionIdx++;
      filename = `region-${String(regionIdx).padStart(3, '0')}.png`;
    } else {
      annotationIdx++;
      filename = `annotation-${String(annotationIdx).padStart(3, '0')}.png`;
    }
    screenshotFiles.push({ filename, dataUrl: ss.dataUrl });
    if (ss.annotationId) screenshotMap[ss.annotationId] = filename;
    else shotList.push({ filename, mode: ss.mode, note: ss.note || '', timestamp: ss.timestamp || null });
  }

  return {
    sessionMeta,
    entries,
    screenshotMap,
    screenshotKeys,
    screenshotFiles,
    screenshots: shotList,
  };
}

// Keyboard shortcut (Alt+Shift+A annotate). chrome.commands is undefined in a
// build whose manifest declares no commands (FE Feedback); a throw here would stop
// every listener registered below.
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-annotate') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) beginPicker(tabs[0].id, { type: 'START_ANNOTATE' });
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const feedbackResult = handleFeedbackMessage(msg, sender, sendResponse);
  if (feedbackResult !== undefined) return feedbackResult;

  if (msg.type === 'GET_STATUS') {
    chrome.storage.session.get(['recording', 'config', 'recordingWindowId'], (data) => {
      // Scope auto-resume to the recording window: a content script in another window
      // must not resume capture. Popup/other senders (no sender.tab) always get the
      // true state for the badge/UI.
      const inScope =
        sender.tab == null ||
        data.recordingWindowId == null ||
        sender.tab.windowId === data.recordingWindowId;
      sendResponse({
        recording: !!data.recording && inScope,
        entryCount: entryCounter,
        annotationCount: annotationCounter,
        screenshotCount: screenshotCounter,
        config: data.config || null,
      });
    });
    return true;
  }

  if (msg.type === 'START_RECORDING') {
    startRecording(msg.config, sendResponse);
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    stopRecording(sendResponse);
    return true;
  }

  // Tabs on an origin with a live feedback session log into that session instead
  if (msg.type === 'LOG_ENTRY') {
    routeFeedbackLog(msg, sender)
      .then((handled) => { if (!handled) recordLogEntry(msg); })
      .catch((err) => console.error('__fe_debug_logger__', 'Log routing failed:', err));
    return false;
  }

  if (msg.type === 'ANNOTATION_COUNT') {
    annotationCounter = msg.count || annotationCounter + 1;
    chrome.storage.session.set({ annotationCounter });
    return false;
  }

  if (msg.type === 'REQUEST_SCREENSHOT') {
    if (screenshotCounter >= MAX_SCREENSHOTS) {
      console.warn('__fe_debug_logger__', `Screenshot limit reached (${MAX_SCREENSHOTS})`);
      return false;
    }
    const tabId = sender.tab?.id;
    if (tabId) handleScreenshot(msg, tabId);
    return false;
  }

  if (msg.type === 'COPY_LOG') {
    copyLog();
    return false;
  }

  if (msg.type === 'EXPORT_LOG') {
    exportLog();
    return false;
  }

  if (msg.type === 'CLEAR_LOG') {
    chrome.storage.local.get(null, (all) => {
      const logKeys = Object.keys(all).filter((k) => k.startsWith('log_'));
      const ssKeys = Object.keys(all).filter((k) => k.startsWith('screenshot_'));
      chrome.storage.local.remove([...logKeys, ...ssKeys, 'sessionMeta'], () => {
        entryCounter = 0;
        annotationCounter = 0;
        screenshotCounter = 0;
        entryLimitWarned = false;
        // Clear dedup keys from session storage
        chrome.storage.session.get(null, (sessionData) => {
          const dedupKeys = Object.keys(sessionData).filter((k) => k.startsWith('dedup_'));
          const clearObj = { entryCounter: 0, annotationCounter: 0, screenshotCounter: 0 };
          if (dedupKeys.length > 0) chrome.storage.session.remove(dedupKeys);
          chrome.storage.session.set(clearObj);
          sendResponse({ ok: true });
        });
      });
    });
    return true;
  }

  // Handle download from offscreen document
  if (msg.type === 'EXPORT_READY') {
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: msg.filename,
      saveAs: false,
    }).then(() => {
      chrome.offscreen.closeDocument().catch(() => {});
    }).catch((err) => {
      console.error('Download failed:', err);
      chrome.offscreen.closeDocument().catch(() => {});
    });
    return false;
  }

  // Handle clipboard copy from offscreen document
  if (msg.type === 'COPY_READY') {
    // offscreen.js already wrote to clipboard, just close doc
    chrome.offscreen.closeDocument().catch(() => {});
    return false;
  }

  // Handle cropped screenshot from offscreen
  if (msg.type === 'SCREENSHOT_CROPPED') {
    storeScreenshot(msg.screenshotId, {
      dataUrl: msg.croppedDataUrl, annotationId: msg.annotationId, mode: msg.mode || 'element',
    }, msg.tabId);
    return false;
  }

  // Note typed into the page's prompt after a region or full-page shot was stored
  if (msg.type === 'SCREENSHOT_NOTE') {
    const key = msg.screenshotId;
    const note = typeof msg.note === 'string' ? msg.note.trim().slice(0, 2000) : '';
    if (typeof key !== 'string' || !key.startsWith('screenshot_') || !note) return false;
    chrome.storage.local.get([key], (items) => {
      if (items[key]) chrome.storage.local.set({ [key]: { ...items[key], note } });
    });
    return false;
  }

  if (msg.type === 'PAGE_META') {
    routeFeedbackLog(msg, sender)
      .then((handled) => { if (!handled) recordPageMeta(msg); })
      .catch((err) => console.error('__fe_debug_logger__', 'Page meta routing failed:', err));
    return false;
  }

  // Popup-triggered actions
  if (msg.type === 'START_ANNOTATE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) beginPicker(tabs[0].id, { type: 'START_ANNOTATE' });
    });
    return false;
  }

  if (msg.type === 'ANNOTATE_STOPPED') {
    clearFrozenShot(sender.tab?.id);
    return false;
  }

  if (msg.type === 'STOP_ANNOTATE') {
    return false;
  }

  if (msg.type === 'CAPTURE_FULL_PAGE') {
    if (screenshotCounter >= MAX_SCREENSHOTS) {
      console.warn('__fe_debug_logger__', `Screenshot limit reached (${MAX_SCREENSHOTS})`);
      return false;
    }
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      handleScreenshot({ mode: 'full' }, tabs[0]?.id ?? null);
    });
    return false;
  }

  if (msg.type === 'START_REGION_SELECT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'START_REGION_SELECT' }).catch(() => {});
    });
    return false;
  }
});

// Record log path. Dedup: an entry with dedupKey and repeatCount > 1 updates the
// stored first occurrence in place instead of adding a new entry.
function recordLogEntry(msg) {
  const { __source, version, type, data, ...rest } = msg;
  const entryData = data || rest;
  if (!entryData.dedupKey || !(entryData.repeatCount > 1)) {
    storeNewEntry(entryData);
    return;
  }
  const dedupStorageKey = `dedup_${entryData.dedupKey}`;
  chrome.storage.session.get([dedupStorageKey], (stored) => {
    const existingKey = stored[dedupStorageKey];
    if (!existingKey) {
      storeNewEntry(entryData); // first occurrence with repeatCount > 1
      return;
    }
    chrome.storage.local.get([existingKey], (items) => {
      if (items[existingKey]) {
        const updated = { ...items[existingKey], repeatCount: entryData.repeatCount, lastTimestamp: entryData.timestamp };
        chrome.storage.local.set({ [existingKey]: updated });
      }
    });
  });
}

function recordPageMeta(msg) {
  chrome.storage.local.get(['sessionMeta'], (data) => {
    const meta = data.sessionMeta || {};
    // First url wins: keep the primary/active-tab url. With multi-tab capture
    // PAGE_META arrives from every tab — without this guard a background tab would
    // clobber the session url. userAgent/viewport carry no per-tab meaning worth
    // pinning, so let the latest reporter fill them.
    if (!meta.url && msg.url) meta.url = msg.url;
    meta.userAgent = msg.userAgent || meta.userAgent || '';
    meta.viewport = msg.viewport || meta.viewport || '';
    chrome.storage.local.set({ sessionMeta: meta });
  });
}

// Store a new unique log entry and track its dedupKey
function storeNewEntry(entryData) {
  if (entryCounter >= MAX_ENTRIES) {
    if (entryLimitWarned) return; // cap reached — drop further entries silently
    // Write exactly one warning entry, then stop recording new entries.
    entryLimitWarned = true;
    entryData = {
      category: 'console',
      type: 'warn',
      message: `[fe-debug] Entry limit (${MAX_ENTRIES}) reached — further entries dropped.`,
      timestamp: new Date().toISOString(),
    };
  }
  const key = `log_${Date.now()}_${entryCounter}`;
  const entry = { ...entryData, _key: key, _seq: entryCounter };
  chrome.storage.local.set({ [key]: entry });
  if (entryData.dedupKey) {
    chrome.storage.session.set({ [`dedup_${entryData.dedupKey}`]: key });
  }
  entryCounter++;
  chrome.storage.session.set({ entryCounter });
}

async function startRecording(config, callback) {
  // Record and a feedback session both own START_CAPTURE on their tabs: one at a time
  if (await feedbackStore.hasActiveSession()) {
    if (callback) callback({ recording: false, error: 'feedback-active' });
    return;
  }
  chrome.storage.local.get(null, (all) => {
    const logKeys = Object.keys(all).filter((k) => k.startsWith('log_'));
    const ssKeys = Object.keys(all).filter((k) => k.startsWith('screenshot_'));
    chrome.storage.local.remove([...logKeys, ...ssKeys], () => {
      entryCounter = 0;
      annotationCounter = 0;
      screenshotCounter = 0;
      entryLimitWarned = false;
      const sessionMeta = {
        url: '',
        startTime: new Date().toISOString(),
        endTime: null,
        userAgent: '',
        viewport: '',
      };
      chrome.storage.session.set({ recording: true, config, entryCounter: 0, annotationCounter: 0, screenshotCounter: 0 });
      chrome.storage.local.set({ sessionMeta });

      // Scope capture to the window where recording started (privacy: don't span
      // unrelated windows). Seed sessionMeta.url from the active tab, remember its
      // windowId, and broadcast START_CAPTURE to every tab in that window — covering
      // all open tabs and any the user switches to within it. Tabs without our content
      // script (chrome://, Web Store) reject sendMessage — swallow per tab.
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (!activeTab) return;
        sessionMeta.url = activeTab.url || '';
        chrome.storage.local.set({ sessionMeta });
        const windowId = activeTab.windowId;
        chrome.storage.session.set({ recordingWindowId: windowId });
        chrome.tabs.query({ windowId }, (winTabs) => {
          for (const tab of winTabs) {
            if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'START_CAPTURE', config }).catch(() => {});
          }
        });
      });

      chrome.action.setBadgeText({ text: 'REC' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
      if (callback) callback({ recording: true, entryCount: 0 });
    });
  });
}

function stopRecording(callback) {
  chrome.storage.session.set({ recording: false, recordingWindowId: null });
  chrome.storage.local.get(['sessionMeta'], (data) => {
    const meta = data.sessionMeta || {};
    meta.endTime = new Date().toISOString();
    chrome.storage.local.set({ sessionMeta: meta }, () => {
      // Broadcast STOP_CAPTURE to every tab (all windows) so any tab that ever resumed
      // capture is guaranteed to stop, regardless of which window it is in now.
      // Tabs of a live feedback session keep capturing: that capture is not Record's.
      chrome.tabs.query({}, async (tabs) => {
        for (const tab of tabs) {
          if (tab.id == null || await isFeedbackTab(tab.url)) continue;
          chrome.tabs.sendMessage(tab.id, { type: 'STOP_CAPTURE' }).catch(() => {});
        }
      });
      chrome.action.setBadgeText({ text: '' });
      if (callback) {
        callback({ recording: false, entryCount: entryCounter, annotationCount: annotationCounter, screenshotCount: screenshotCounter });
      }
    });
  });
}

async function handleScreenshot(msg, tabId) {
  try {
    // Element crops use the picker's frozen shot when one exists: the page may
    // have changed since the click, the frozen image matches the click-time rect.
    const frozenShot = msg.mode === 'element' ? await getFrozenShot(tabId) : null;
    const dataUrl = frozenShot?.dataUrl || await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const screenshotId = `screenshot_${Date.now()}`;

    if (msg.mode === 'full') {
      // Store directly, no crop needed
      storeScreenshot(screenshotId, { dataUrl, annotationId: msg.annotationId || null, mode: 'full' }, tabId);
      return;
    }

    // Need crop — send to offscreen
    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Crop screenshot via Canvas API',
      });
    }
    chrome.runtime.sendMessage({
      type: 'CROP_SCREENSHOT',
      dataUrl,
      cropRect: msg.cropRect,
      dpr: msg.dpr || 1,
      screenshotId,
      annotationId: msg.annotationId || null,
      mode: msg.mode,
      tabId,
    });
  } catch (err) {
    console.error('__fe_debug_logger__', 'Screenshot capture failed:', err);
  }
}

// Region and full-page shots have no note of their own (element shots belong to an
// annotation), so once stored the page is asked to prompt for one. The prompt only
// appears after the capture, so it never ends up in the image.
function storeScreenshot(screenshotId, record, tabId) {
  chrome.storage.local.set({ [screenshotId]: { ...record, timestamp: new Date().toISOString() } }, () => {
    if (tabId == null || record.mode === 'element') return;
    chrome.tabs.sendMessage(tabId, { type: 'SCREENSHOT_TAKEN', screenshotId, mode: record.mode }).catch(() => {});
  });
  screenshotCounter++;
  chrome.storage.session.set({ screenshotCounter });
}

async function copyLog() {
  const { sessionMeta, entries, screenshots } = await gatherLogData();

  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Copy debug log markdown to clipboard',
    });
  }

  chrome.runtime.sendMessage({
    type: 'PROCESS_COPY',
    data: { sessionMeta, entries, screenshotMap: {}, screenshots: screenshots.map((s) => ({ ...s, filename: null })) },
  });
}

async function exportLog() {
  const logData = await gatherLogData();
  const { screenshotFiles, screenshotKeys } = logData;

  // ZIP filename
  let domain = 'unknown';
  try { domain = new URL(logData.sessionMeta.url).hostname.replace(/\./g, '-'); } catch (_) {}
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const zipFilename = `fe-debug-${domain}-${timestamp}.zip`;

  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Generate ZIP with debug log and screenshots',
    });
  }

  chrome.runtime.sendMessage({
    type: 'PROCESS_EXPORT',
    data: {
      sessionMeta: logData.sessionMeta, entries: logData.entries, screenshotMap: logData.screenshotMap,
      screenshots: logData.screenshots, screenshotFiles,
    },
    zipFilename,
  });

  // Clean up screenshot storage after export (reuse keys from gatherLogData)
  if (screenshotKeys.length > 0) {
    chrome.storage.local.remove(screenshotKeys);
  }
}
