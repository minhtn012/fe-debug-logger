let entryCounter = 0;

// Restore entry count from storage on SW wake
chrome.storage.session.get(['recording', 'entryCounter'], (data) => {
  entryCounter = data.entryCounter || 0;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    chrome.storage.session.get(['recording', 'config'], (data) => {
      sendResponse({ recording: !!data.recording, entryCount: entryCounter, config: data.config || null });
    });
    return true;
  }

  if (msg.type === 'START_RECORDING') {
    // Clear previous log entries
    chrome.storage.local.get(null, (all) => {
      const logKeys = Object.keys(all).filter((k) => k.startsWith('log_'));
      chrome.storage.local.remove(logKeys, () => {
        entryCounter = 0;
        const sessionMeta = {
          url: '',
          startTime: new Date().toISOString(),
          endTime: null,
          userAgent: '',
          viewport: '',
        };
        chrome.storage.session.set({ recording: true, config: msg.config, entryCounter: 0 });
        chrome.storage.local.set({ sessionMeta });

        // Notify content script to start capturing
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            sessionMeta.url = tabs[0].url || '';
            chrome.storage.local.set({ sessionMeta });
            chrome.tabs.sendMessage(tabs[0].id, { type: 'START_CAPTURE', config: msg.config }).catch(() => {});
          }
        });

        // Set badge
        chrome.action.setBadgeText({ text: 'REC' });
        chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });

        sendResponse({ recording: true, entryCount: 0 });
      });
    });
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    chrome.storage.session.set({ recording: false });

    // Persist endTime BEFORE responding so export has it
    chrome.storage.local.get(['sessionMeta'], (data) => {
      const meta = data.sessionMeta || {};
      meta.endTime = new Date().toISOString();
      chrome.storage.local.set({ sessionMeta: meta }, () => {
        // Notify content script to stop
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_CAPTURE' }).catch(() => {});
          }
        });

        chrome.action.setBadgeText({ text: '' });
        sendResponse({ recording: false, entryCount: entryCounter });
      });
    });
    return true;
  }

  if (msg.type === 'LOG_ENTRY') {
    const key = `log_${Date.now()}_${entryCounter}`;
    // Strip bridge fields, keep only data payload
    const { __source, version, type, data, ...rest } = msg;
    const entry = { ...(data || rest), _key: key, _seq: entryCounter };
    chrome.storage.local.set({ [key]: entry });
    entryCounter++;
    chrome.storage.session.set({ entryCounter });
    return false;
  }

  if (msg.type === 'EXPORT_LOG') {
    exportLog();
    return false;
  }

  if (msg.type === 'CLEAR_LOG') {
    chrome.storage.local.get(null, (all) => {
      const logKeys = Object.keys(all).filter((k) => k.startsWith('log_'));
      chrome.storage.local.remove([...logKeys, 'sessionMeta'], () => {
        entryCounter = 0;
        chrome.storage.session.set({ entryCounter: 0 });
        sendResponse({ ok: true });
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
      // Close offscreen document after download
      chrome.offscreen.closeDocument().catch(() => {});
    }).catch((err) => {
      console.error('Download failed:', err);
    });
    return false;
  }

  // Handle page meta from content script
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
});

async function exportLog() {
  // Gather all log entries
  const all = await chrome.storage.local.get(null);
  const logKeys = Object.keys(all)
    .filter((k) => k.startsWith('log_'))
    .sort();
  const entries = logKeys.map((k) => all[k]);
  const sessionMeta = all.sessionMeta || {};

  // Create offscreen document
  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Generate and download large markdown debug files',
    });
  }

  chrome.runtime.sendMessage({
    type: 'PROCESS_EXPORT',
    data: { sessionMeta, entries },
  });
}
