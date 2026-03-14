// Offscreen document — formats log data to Markdown + crops screenshots via Canvas
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PROCESS_EXPORT') {
    handleExport(msg);
    return false;
  }

  if (msg.type === 'PROCESS_COPY') {
    handleCopy(msg);
    return false;
  }

  if (msg.type === 'CROP_SCREENSHOT') {
    handleCrop(msg);
    return false;
  }

  return false;
});

async function handleCopy(msg) {
  try {
    const { sessionMeta, entries, screenshotMap } = msg.data;
    const markdown = formatMarkdown({ meta: sessionMeta, entries, screenshotMap: screenshotMap || {} });
    await navigator.clipboard.writeText(markdown);
    chrome.runtime.sendMessage({ type: 'COPY_READY' });
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
}

async function handleExport(msg) {
  try {
    const { sessionMeta, entries, screenshotMap, screenshotFiles } = msg.data;
    const markdown = formatMarkdown({ meta: sessionMeta, entries, screenshotMap: screenshotMap || {} });

    const zip = new JSZip();
    zip.file('debug-log.md', markdown);

    // Add screenshots to ZIP
    if (screenshotFiles && screenshotFiles.length > 0) {
      const screenshotsFolder = zip.folder('screenshots');
      for (const sf of screenshotFiles) {
        const base64 = sf.dataUrl.split(',')[1];
        screenshotsFolder.file(sf.filename, base64, { base64: true });
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const reader = new FileReader();
    reader.onloadend = () => {
      chrome.runtime.sendMessage({
        type: 'EXPORT_READY',
        dataUrl: reader.result,
        filename: msg.zipFilename || 'debug-log.zip',
      });
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    console.error('ZIP export failed:', err);
  }
}

function handleCrop(msg) {
  try {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const { x, y, width, height } = msg.cropRect;
      const dpr = msg.dpr || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,
        x * dpr, y * dpr, width * dpr, height * dpr,
        0, 0, width * dpr, height * dpr
      );
      const croppedDataUrl = canvas.toDataURL('image/png');
      chrome.runtime.sendMessage({
        type: 'SCREENSHOT_CROPPED',
        croppedDataUrl,
        screenshotId: msg.screenshotId,
        annotationId: msg.annotationId,
        mode: msg.mode,
      });
    };
    img.onerror = () => {
      console.error('__fe_debug_logger__', 'Failed to load screenshot for cropping');
    };
    img.src = msg.dataUrl;
  } catch (err) {
    console.error('Screenshot crop failed:', err);
  }
}
