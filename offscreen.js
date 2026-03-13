// Offscreen document — formats log data to Markdown, returns data URL to background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'PROCESS_EXPORT') return false;

  try {
    const { sessionMeta, entries } = msg.data;
    const markdown = formatMarkdown({ meta: sessionMeta, entries });

    // Create data URL (offscreen can do Blob work, but download must happen in background)
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const reader = new FileReader();
    reader.onloadend = () => {
      let domain = 'unknown';
      try {
        domain = new URL(sessionMeta.url).hostname.replace(/\./g, '-');
      } catch (_) {}
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      // Send data URL back to background for download
      chrome.runtime.sendMessage({
        type: 'EXPORT_READY',
        dataUrl: reader.result,
        filename: `debug-log-${domain}-${timestamp}.md`,
      });
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    console.error('Export formatting failed:', err);
  }
  return false;
});
