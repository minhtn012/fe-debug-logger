importScripts('websocket-client.js');

let entryCounter = 0;
let annotationCounter = 0;
let screenshotCounter = 0;
const MAX_SCREENSHOTS = 5;
const STREAM_ALARM = 'stream-entries';
let lastStreamedSeq = -1;

// Restore counters from storage on SW wake
chrome.storage.session.get(['recording', 'entryCounter', 'annotationCounter', 'screenshotCounter', 'lastStreamedSeq'], (data) => {
  entryCounter = data.entryCounter || 0;
  annotationCounter = data.annotationCounter || 0;
  screenshotCounter = data.screenshotCounter || 0;
  lastStreamedSeq = data.lastStreamedSeq ?? -1;
});

// WebSocket client for MCP server communication
const wsClient = createWebSocketClient(handleWsCommand);
// Try connecting on SW start — silent fail if MCP server not running
wsClient.connect();

function handleWsCommand(msg) {
  const reqId = msg._requestId; // Echo back for response routing

  if (msg.type === 'START_RECORDING') {
    const config = msg.config || { console: true, userActions: true, network: true, componentState: true };
    startRecording(config, (resp) => {
      wsClient.send({ type: 'RECORDING_STARTED', _requestId: reqId, ...resp });
    });
    return;
  }

  if (msg.type === 'STOP_RECORDING') {
    stopRecording((resp) => {
      wsClient.send({ type: 'RECORDING_STOPPED', _requestId: reqId, entryCount: resp?.entryCount || entryCounter });
    });
    return;
  }

  if (msg.type === 'GET_STATUS') {
    chrome.storage.session.get(['recording', 'config'], (data) => {
      wsClient.send({
        type: 'STATUS',
        _requestId: reqId,
        recording: !!data.recording,
        entryCount: entryCounter,
        annotationCount: annotationCounter,
      });
    });
    return;
  }

  if (msg.type === 'GET_LOG') {
    gatherLogData().then((logData) => {
      wsClient.send({ type: 'LOG_DATA', _requestId: reqId, ...logData });
    });
    return;
  }
}

// Gather log entries and screenshots for WS/copy
async function gatherLogData() {
  const all = await chrome.storage.local.get(null);
  const logKeys = Object.keys(all).filter((k) => k.startsWith('log_')).sort();
  const entries = logKeys.map((k) => all[k]);
  const sessionMeta = all.sessionMeta || {};

  const screenshotKeys = Object.keys(all).filter((k) => k.startsWith('screenshot_')).sort();
  const screenshots = screenshotKeys.map((k) => ({ key: k, ...all[k] }));

  const screenshotMap = {};
  const screenshotFiles = [];
  let annotationIdx = 0;
  let fullIdx = 0;
  let regionIdx = 0;

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
  }

  return {
    sessionMeta,
    entries,
    screenshotMap,
    screenshotKeys,
    screenshotFiles,
    screenshots: screenshotFiles.map((sf) => ({
      name: sf.filename,
      base64: sf.dataUrl ? sf.dataUrl.split(',')[1] : '',
    })),
  };
}

// Stream alarm: batch-send entries to MCP server
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === STREAM_ALARM) {
    flushStreamEntries();
  }
});

// Keyboard shortcut: Ctrl+Shift+A toggle annotate
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-annotate') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'START_ANNOTATE' }).catch(() => {});
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    chrome.storage.session.get(['recording', 'config'], (data) => {
      sendResponse({
        recording: !!data.recording,
        entryCount: entryCounter,
        annotationCount: annotationCounter,
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

  if (msg.type === 'LOG_ENTRY') {
    const { __source, version, type, data, ...rest } = msg;
    const entryData = data || rest;

    // Dedup: if entry has dedupKey and repeatCount > 1, try updating existing
    if (entryData.dedupKey && entryData.repeatCount > 1) {
      const dedupStorageKey = `dedup_${entryData.dedupKey}`;
      chrome.storage.session.get([dedupStorageKey], (stored) => {
        const existingKey = stored[dedupStorageKey];
        if (existingKey) {
          // Update existing entry in-place with new count + timestamp
          chrome.storage.local.get([existingKey], (items) => {
            if (items[existingKey]) {
              const updated = { ...items[existingKey], repeatCount: entryData.repeatCount, lastTimestamp: entryData.timestamp };
              chrome.storage.local.set({ [existingKey]: updated });
            }
          });
        } else {
          // First occurrence with repeatCount > 1: store as new entry
          storeNewEntry(entryData);
        }
      });
      return false;
    }

    storeNewEntry(entryData);
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
        lastStreamedSeq = -1;
        // Clear dedup keys from session storage
        chrome.storage.session.get(null, (sessionData) => {
          const dedupKeys = Object.keys(sessionData).filter((k) => k.startsWith('dedup_'));
          const clearObj = { entryCounter: 0, annotationCounter: 0, screenshotCounter: 0, lastStreamedSeq: -1 };
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
    // User download (existing behavior)
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: msg.filename,
      saveAs: false,
    }).catch((err) => {
      console.error('Download failed:', err);
    });

    // MCP auto-save: save ZIP to fe-debug/sessions/ for MCP server
    const mcpFilename = `fe-debug/sessions/${msg.filename}`;
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: mcpFilename,
      saveAs: false,
      conflictAction: 'overwrite',
    }).then(() => {
      chrome.offscreen.closeDocument().catch(() => {});
    }).catch((err) => {
      console.error('MCP save failed:', err);
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
    chrome.storage.local.set({
      [msg.screenshotId]: { dataUrl: msg.croppedDataUrl, annotationId: msg.annotationId, mode: msg.mode || 'element' },
    });
    screenshotCounter++;
    chrome.storage.session.set({ screenshotCounter });
    // Stream screenshot to MCP server
    streamScreenshot(msg.croppedDataUrl, msg.annotationId, msg.mode || 'element');
    return false;
  }

  if (msg.type === 'PAGE_META') {
    chrome.storage.local.get(['sessionMeta'], (data) => {
      const meta = data.sessionMeta || {};
      meta.url = msg.url || meta.url;
      meta.userAgent = msg.userAgent || '';
      meta.viewport = msg.viewport || '';
      chrome.storage.local.set({ sessionMeta: meta });
    });
    return false;
  }

  // Popup-triggered actions
  if (msg.type === 'START_ANNOTATE') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'START_ANNOTATE' }).catch(() => {});
    });
    return false;
  }

  if (msg.type === 'STOP_ANNOTATE' || msg.type === 'ANNOTATE_STOPPED') {
    return false;
  }

  if (msg.type === 'CAPTURE_FULL_PAGE') {
    handleScreenshot({ mode: 'full' }, null);
    return false;
  }

  if (msg.type === 'START_REGION_SELECT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'START_REGION_SELECT' }).catch(() => {});
    });
    return false;
  }
});

// Buffer new entries in-memory for streaming (avoids reading all storage each flush)
let streamBuffer = [];

// Stream: batch-send buffered entries to MCP server via WS
function flushStreamEntries() {
  if (!wsClient.isConnected() || streamBuffer.length === 0) return;
  // Get domain from session meta for file naming
  chrome.storage.local.get(['sessionMeta'], (data) => {
    const batch = streamBuffer.splice(0);
    wsClient.send({
      type: 'STREAM_ENTRIES',
      entries: batch,
      domain: data.sessionMeta?.url || 'unknown',
    });
    lastStreamedSeq = batch[batch.length - 1]._seq;
    chrome.storage.session.set({ lastStreamedSeq });
  });
}

function startStreaming() {
  lastStreamedSeq = -1;
  streamBuffer = [];
  streamScreenshotCounters = { annotation: 0, full: 0, region: 0 };
  chrome.storage.session.set({ lastStreamedSeq: -1 });
  // Chrome alarms min ~30s; use periodInMinutes for reliable SW wake
  chrome.alarms.create(STREAM_ALARM, { periodInMinutes: 0.1 }); // ~6s
}

function stopStreaming() {
  chrome.alarms.clear(STREAM_ALARM);
  // Final flush before stopping
  flushStreamEntries();
}

// Stream a screenshot to MCP server for live fe-debug/ folder
let streamScreenshotCounters = { annotation: 0, full: 0, region: 0 };

function streamScreenshot(dataUrl, annotationId, mode) {
  if (!wsClient.isConnected() || !dataUrl) return;

  let filename;
  if (mode === 'full') {
    streamScreenshotCounters.full++;
    filename = `full-page-${String(streamScreenshotCounters.full).padStart(3, '0')}.png`;
  } else if (mode === 'region') {
    streamScreenshotCounters.region++;
    filename = `region-${String(streamScreenshotCounters.region).padStart(3, '0')}.png`;
  } else {
    streamScreenshotCounters.annotation++;
    filename = `annotation-${String(streamScreenshotCounters.annotation).padStart(3, '0')}.png`;
  }

  const base64 = dataUrl.split(',')[1] || '';
  wsClient.send({
    type: 'STREAM_SCREENSHOT',
    screenshot: { filename, base64, annotationId },
  });
}

// Store a new unique log entry and track its dedupKey
function storeNewEntry(entryData) {
  const key = `log_${Date.now()}_${entryCounter}`;
  const entry = { ...entryData, _key: key, _seq: entryCounter };
  chrome.storage.local.set({ [key]: entry });
  if (entryData.dedupKey) {
    chrome.storage.session.set({ [`dedup_${entryData.dedupKey}`]: key });
  }
  // Buffer for stream flush
  streamBuffer.push(entry);
  entryCounter++;
  chrome.storage.session.set({ entryCounter });
}

function startRecording(config, callback) {
  chrome.storage.local.get(null, (all) => {
    const logKeys = Object.keys(all).filter((k) => k.startsWith('log_'));
    const ssKeys = Object.keys(all).filter((k) => k.startsWith('screenshot_'));
    chrome.storage.local.remove([...logKeys, ...ssKeys], () => {
      entryCounter = 0;
      annotationCounter = 0;
      screenshotCounter = 0;
      const sessionMeta = {
        url: '',
        startTime: new Date().toISOString(),
        endTime: null,
        userAgent: '',
        viewport: '',
      };
      chrome.storage.session.set({ recording: true, config, entryCounter: 0, annotationCounter: 0, screenshotCounter: 0 });
      chrome.storage.local.set({ sessionMeta });

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          sessionMeta.url = tabs[0].url || '';
          chrome.storage.local.set({ sessionMeta });
          chrome.tabs.sendMessage(tabs[0].id, { type: 'START_CAPTURE', config }).catch(() => {});
        }
      });

      chrome.action.setBadgeText({ text: 'REC' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
      startStreaming();
      if (callback) callback({ recording: true, entryCount: 0 });
    });
  });
}

function stopRecording(callback) {
  stopStreaming();
  chrome.storage.session.set({ recording: false });
  chrome.storage.local.get(['sessionMeta'], (data) => {
    const meta = data.sessionMeta || {};
    meta.endTime = new Date().toISOString();
    chrome.storage.local.set({ sessionMeta: meta }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_CAPTURE' }).catch(() => {});
        }
      });
      chrome.action.setBadgeText({ text: '' });
      if (callback) callback({ recording: false, entryCount: entryCounter });
    });
  });
}

async function handleScreenshot(msg, tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const screenshotId = `screenshot_${Date.now()}`;

    if (msg.mode === 'full') {
      // Store directly, no crop needed
      chrome.storage.local.set({
        [screenshotId]: { dataUrl, annotationId: msg.annotationId || null, mode: 'full' },
      });
      screenshotCounter++;
      chrome.storage.session.set({ screenshotCounter });
      // Stream to MCP server
      streamScreenshot(dataUrl, msg.annotationId || null, 'full');
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
    });
  } catch (err) {
    console.error('__fe_debug_logger__', 'Screenshot capture failed:', err);
  }
}

async function copyLog() {
  const all = await chrome.storage.local.get(null);
  const logKeys = Object.keys(all).filter((k) => k.startsWith('log_')).sort();
  const entries = logKeys.map((k) => all[k]);
  const sessionMeta = all.sessionMeta || {};

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
    data: { sessionMeta, entries, screenshotMap: {} },
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
    data: { sessionMeta: logData.sessionMeta, entries: logData.entries, screenshotMap: logData.screenshotMap, screenshotFiles },
    zipFilename,
  });

  // Clean up screenshot storage after export (reuse keys from gatherLogData)
  if (screenshotKeys.length > 0) {
    chrome.storage.local.remove(screenshotKeys);
  }
}
