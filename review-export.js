// Review export — builds the feedback Markdown and ZIP inside the review page.
// An extension page can download blobs itself, so this never goes through the
// offscreen document that Record export closes when it finishes.
// Needs feedback/feedback-store.js, formatter/markdown-formatter.js,
// formatter/feedback-formatter.js and lib/jszip.min.js loaded first.
// eslint-disable-next-line no-unused-vars
function createFeedbackExporter(store) {
  const URL_TTL_MS = 60000;

  // Reads screenshots one by one (never the whole storage) and names them in
  // display order, so a deleted item leaves no gap in item-001, item-002, ...
  async function buildFeedbackExport(sessionId) {
    const data = await store.getSession(sessionId);
    if (!data) throw new Error('no-session');
    const { session, items, logs } = data;

    const shots = {};
    for (const item of items) {
      const dataUrl = await store.getShot(item.shotKey);
      if (dataUrl) shots[item.seq] = dataUrl;
    }
    const shotNames = feedbackShotNames(items, (item) => !!shots[item.seq]);
    const markdown = formatFeedbackMarkdown({ session, items, logs, shotNames });
    const files = items
      .filter((item) => shotNames[item.seq])
      .map((item) => ({ name: shotNames[item.seq], dataUrl: shots[item.seq] }));
    return { markdown, files, baseName: feedbackExportBaseName(session) };
  }

  async function copyFeedbackMarkdown(sessionId) {
    const { markdown } = await buildFeedbackExport(sessionId);
    await navigator.clipboard.writeText(markdown);
    return markdown;
  }

  async function downloadFeedbackMd(sessionId) {
    const { markdown, baseName } = await buildFeedbackExport(sessionId);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    return download(blob, `${baseName}.md`);
  }

  async function downloadFeedbackZip(sessionId) {
    const { markdown, files, baseName } = await buildFeedbackExport(sessionId);
    const zip = new JSZip();
    zip.file('debug-log.md', markdown);
    if (files.length) {
      const folder = zip.folder('screenshots');
      for (const f of files) folder.file(f.name, f.dataUrl.split(',')[1], { base64: true });
    }
    return download(await zip.generateAsync({ type: 'blob' }), `${baseName}.zip`);
  }

  // The object URL outlives the call: Chrome reads it after download() resolves.
  async function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename, saveAs: false });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), URL_TTL_MS);
    }
    return filename;
  }

  return { buildFeedbackExport, copyFeedbackMarkdown, downloadFeedbackMd, downloadFeedbackZip };
}
