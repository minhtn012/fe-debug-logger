# Phase 4: Export Pipeline Update

## Overview
- **Priority**: P1
- **Status**: Pending
- **Effort**: 2h
- **Depends on**: Phase 2 (annotation entries) + Phase 3 (screenshot data)

Update export pipeline: output subfolder structure (`debug-log.md` + `screenshots/`), add Annotations section to markdown formatter, download PNG files riêng.

## Key Insights
- Current export: single MD file via offscreen Blob → data URL → chrome.downloads
- New export: multiple files (1 MD + N PNGs) → cần sequential downloads
- `chrome.downloads.download()` supports `filename` with subdirectory: `fe-debug-xxx/screenshots/img.png`
- Chrome auto-creates subdirectories trong download folder
- Data URLs cho PNG đã có sẵn trong chrome.storage.local từ Phase 3

## Requirements

### Functional
- Export tạo folder structure: `fe-debug-<domain>-<timestamp>/`
  - `debug-log.md` — full report với annotations section
  - `screenshots/annotation-001.png`, `screenshots/full-page-001.png`, etc.
- Annotations section trong MD: note, severity, tags, DOM snapshot, screenshot reference
- Screenshot references dùng relative path: `![](screenshots/annotation-001.png)`
- **LUÔN** tạo subfolder structure cho mọi export (không phân biệt có screenshot hay không)

### Non-Functional
- Export completes within 5 seconds cho typical session (5 screenshots max)
- Sequential downloads prevent race conditions

## Related Code Files

### Modify
- `background.js` — update `exportLog()` to handle multi-file export
- `offscreen.js` — update PROCESS_EXPORT to return annotations section, pass back screenshot mapping
- `formatter/markdown-formatter.js` — add `formatAnnotations()` section

## Implementation Steps

### Step 0: Add Structured Metadata Block
Thêm metadata block ở đầu MD file (sau header, trước sections):
```javascript
function formatMetadata(meta, entries) {
  const annotations = entries.filter(e => e.category === 'annotation');
  const consoleErrors = entries.filter(e => e.category === 'console');
  const networkIssues = entries.filter(e => e.category === 'network');
  const screenshots = entries.filter(e => e.screenshotRef);
  return `## Report Metadata
| Field | Value |
|-------|-------|
| Tool | FE Debug Logger v0.2.0 |
| Report Type | Frontend Bug Report |
| Annotations | ${annotations.length} |
| Screenshots | ${screenshots.length} |
| Console Errors | ${consoleErrors.length} |
| Network Issues | ${networkIssues.length} |
| Key Sections | Annotations (user-reported bugs with DOM context + identifiers for source grep) |`;
}
```

### Step 1: Update Markdown Formatter
Add `formatAnnotations()` to `formatter/markdown-formatter.js`:

```javascript
function formatAnnotations(annotations, screenshotMap) {
  if (!annotations.length) return null;
  let md = `## Annotations (${annotations.length})\n`;
  annotations.forEach((a, i) => {
    const idx = String(i + 1).padStart(3, '0');
    const severityBadge = `**[${a.severity?.toUpperCase() || 'MAJOR'}]**`;
    const tags = (a.tags || []).map(t => `\`${t}\``).join(' ');
    md += `\n### #${i + 1} ${severityBadge} ${tags}\n`;
    md += `**Element:** \`${a.selector || 'unknown'}\`\n`;
    md += `**Note:** ${a.note || ''}\n`;
    md += `**Time:** ${formatTime(a.timestamp)}\n`;
    // Temporal linking: find nearby events ±5 seconds
    const nearbyContext = findNearbyEvents(entries, a.timestamp, 5000);
    if (nearbyContext) {
      md += `\n**Context:** ${nearbyContext}\n`;
    }
    // Screenshot reference
    const screenshotFile = screenshotMap[a.annotationId];
    if (screenshotFile) {
      md += `\n![screenshot](screenshots/${screenshotFile})\n`;
    }
    // DOM Snapshot
    if (a.domSnapshot) {
      md += formatDomSnapshot(a.domSnapshot);
    }
  });
  return md;
}

function formatDomSnapshot(snapshot) {
  let md = '\n**DOM Snapshot:**\n';
  if (snapshot.outerHTML) {
    md += '```html\n' + snapshot.outerHTML + '\n```\n';
  }
  if (snapshot.computedStyles) {
    md += '\n| Property | Value |\n|----------|-------|\n';
    for (const [prop, val] of Object.entries(snapshot.computedStyles)) {
      md += `| ${prop} | ${val} |\n`;
    }
  }
  if (snapshot.boundingRect) {
    const r = snapshot.boundingRect;
    md += `| bounding | ${r.width}x${r.height} @ (${Math.round(r.x)}, ${Math.round(r.y)}) |\n`;
  }
  if (snapshot.visibility) {
    md += `| visible | ${snapshot.visibility.isVisible ? 'yes' : 'NO'} |\n`;
  }
  return md;
}
```

### Step 2: Update formatMarkdown Entry Point
```javascript
function formatMarkdown(logData) {
  // ... existing sections ...
  const annotations = entries.filter((e) => e.category === 'annotation');
  const annotationSection = formatAnnotations(annotations, logData.screenshotMap || {});
  if (annotationSection) sections.push(annotationSection);
  // ... rest unchanged
}
```

### Step 3: Update Background Export
Modify `exportLog()` in `background.js`:

```javascript
async function exportLog() {
  const all = await chrome.storage.local.get(null);

  // Gather log entries
  const logKeys = Object.keys(all).filter(k => k.startsWith('log_')).sort();
  const entries = logKeys.map(k => all[k]);
  const sessionMeta = all.sessionMeta || {};

  // Gather screenshots
  const screenshotKeys = Object.keys(all).filter(k => k.startsWith('screenshot_'));
  const screenshots = screenshotKeys.map(k => ({ key: k, ...all[k] }));

  // Build screenshot filename map: annotationId → filename
  const screenshotMap = {};
  const screenshotFiles = []; // { filename, dataUrl }
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
    if (ss.annotationId) {
      screenshotMap[ss.annotationId] = filename;
    }
  }

  const hasScreenshots = screenshotFiles.length > 0;

  // Generate folder prefix
  let domain = 'unknown';
  try { domain = new URL(sessionMeta.url).hostname.replace(/\./g, '-'); } catch (_) {}
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const folderPrefix = hasScreenshots ? `fe-debug-${domain}-${timestamp}/` : '';

  // Create offscreen doc for MD formatting
  const hasDoc = await chrome.offscreen.hasDocument();
  if (!hasDoc) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: '...' });
  }

  // Send to offscreen with screenshotMap
  chrome.runtime.sendMessage({
    type: 'PROCESS_EXPORT',
    data: { sessionMeta, entries, screenshotMap },
    folderPrefix,
  });

  // Download screenshots after MD export
  for (const sf of screenshotFiles) {
    await chrome.downloads.download({
      url: sf.dataUrl,
      filename: `${folderPrefix}screenshots/${sf.filename}`,
      saveAs: false,
    });
  }
}
```

### Step 4: Update Offscreen EXPORT_READY
Pass `folderPrefix` through so MD file downloads into same folder:
```javascript
// In offscreen.js — update filename to use folderPrefix
chrome.runtime.sendMessage({
  type: 'EXPORT_READY',
  dataUrl: reader.result,
  filename: `${msg.folderPrefix || ''}debug-log.md`,
});
```

## Todo List
- [ ] Add `formatMetadata()` — structured report metadata block at top of MD
- [ ] Add `formatAnnotations()` to `formatter/markdown-formatter.js`
- [ ] Add `formatDomSnapshot()` helper — includes identifiers table (data-*, id, aria-label)
- [ ] Add `findNearbyEvents()` — temporal linking: find actions/errors ±5s of annotation timestamp
- [ ] Update `formatMarkdown()` to include annotations section
- [ ] Update `exportLog()` in `background.js` — multi-file export with folder structure
- [ ] Update `offscreen.js` — pass screenshotMap to formatter, handle folderPrefix
- [ ] Handle backward compat: no screenshots → single file export (no folder)
- [ ] Handle EXPORT_READY with folder prefix
- [ ] Clean up screenshot storage entries after export
- [ ] Syntax check all modified files

## Success Criteria
- Export with annotations + screenshots → creates subfolder với MD + screenshots/
- Export without annotations → single MD file (backward compat)
- MD contains Annotations section with correct screenshot references
- DOM snapshot rendered as HTML code block + properties table
- Screenshot PNGs download correctly vào screenshots/ subfolder
- All relative paths trong MD resolve correctly

## Risk Assessment
- **Sequential downloads**: Multiple `chrome.downloads.download()` calls might be slow. Mitigation: typical session has < 10 screenshots, acceptable.
- **Storage quota**: Many base64 screenshots in chrome.storage.local → close to 10MB limit. Mitigation: limit screenshots, clean up after export.
- **Download folder permissions**: Chrome may prompt user for download location. Mitigation: `saveAs: false` uses default download folder silently.
