// Markdown formatter — converts captured log entries into structured Markdown
// eslint-disable-next-line no-unused-vars
function formatMarkdown(logData) {
  const { meta, entries, screenshotMap } = logData;
  const sections = [];

  sections.push(formatHeader(meta));
  sections.push(formatMetadata(meta, entries));

  const annotations = entries.filter((e) => e.category === 'annotation');
  const actions = entries.filter((e) => e.category === 'action');
  const consoleEntries = entries.filter((e) => e.category === 'console');
  const networkEntries = entries.filter((e) => e.category === 'network');
  const stateEntries = entries.filter((e) => e.category === 'state');

  const annotationSection = formatAnnotations(annotations, entries, screenshotMap || {});
  if (annotationSection) sections.push(annotationSection);

  const actionSection = formatUserActions(actions);
  if (actionSection) sections.push(actionSection);

  const consoleSection = formatConsoleErrors(consoleEntries);
  if (consoleSection) sections.push(consoleSection);

  const networkSection = formatNetworkIssues(networkEntries);
  if (networkSection) sections.push(networkSection);

  const stateSection = formatComponentState(stateEntries);
  if (stateSection) sections.push(stateSection);

  return sections.join('\n\n---\n\n');
}

function formatHeader(meta) {
  const url = meta?.url || 'Unknown';
  const start = meta?.startTime ? formatTime(meta.startTime) : '?';
  const end = meta?.endTime ? formatTime(meta.endTime) : '?';
  const duration = (meta?.startTime && meta?.endTime) ? formatDuration(meta.startTime, meta.endTime) : '?';
  const ua = meta?.userAgent || 'Unknown';
  const viewport = meta?.viewport || 'Unknown';

  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge)\/(\d+[\d.]*)/);
  const browser = browserMatch ? `${browserMatch[1]} ${browserMatch[2]}` : ua.substring(0, 60);

  return `# FE Debug Log

## Session Info
| Field | Value |
|-------|-------|
| URL | ${url} |
| Time | ${start} → ${end} |
| Duration | ${duration} |
| Browser | ${browser} |
| Viewport | ${viewport} |`;
}

function formatMetadata(meta, entries) {
  const annotations = entries.filter((e) => e.category === 'annotation');
  const consoleErrors = entries.filter((e) => e.category === 'console');
  const networkIssues = entries.filter((e) => e.category === 'network');
  const screenshotCount = annotations.filter((e) => e.wantScreenshot).length;

  return `## Report Metadata
| Field | Value |
|-------|-------|
| Tool | FE Debug Logger v0.2.0 |
| Report Type | Frontend Bug Report |
| Annotations | ${annotations.length} |
| Screenshots | ${screenshotCount} |
| Console Errors | ${consoleErrors.length} |
| Network Issues | ${networkIssues.length} |
| Key Sections | Annotations (user-reported bugs with DOM context + identifiers for source grep) |`;
}

function formatAnnotations(annotations, allEntries, screenshotMap) {
  if (!annotations.length) return null;

  let md = `## Annotations (${annotations.length})\n`;

  annotations.forEach((a, i) => {
    const severityBadge = `**[${(a.severity || 'MAJOR').toUpperCase()}]**`;
    const tags = (a.tags || []).map((t) => `\`${t}\``).join(' ');
    md += `\n### #${i + 1} ${severityBadge} ${tags}\n`;
    md += `**Element:** \`${escapeCell(a.selector || 'unknown')}\`\n`;
    md += `**Note:** ${escapeCell(a.note || '')}\n`;
    md += `**Time:** ${formatTime(a.timestamp)}\n`;

    // Temporal linking: find nearby events ±5 seconds
    const nearbyContext = findNearbyEvents(allEntries, a.timestamp, 5000);
    if (nearbyContext) {
      md += `\n**Context (±5s):** ${nearbyContext}\n`;
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

  // Identifiers table (data-*, id, aria-label)
  if (snapshot.identifiers) {
    md += '\n**Identifiers:**\n| Attribute | Value |\n|-----------|-------|\n';
    for (const [attr, val] of Object.entries(snapshot.identifiers)) {
      md += `| ${attr} | ${escapeCell(String(val))} |\n`;
    }
  }

  if (snapshot.outerHTML) {
    md += '\n```html\n' + snapshot.outerHTML + '\n```\n';
  }

  if (snapshot.computedStyles) {
    md += '\n**Computed Styles:**\n| Property | Value |\n|----------|-------|\n';
    for (const [prop, val] of Object.entries(snapshot.computedStyles)) {
      md += `| ${prop} | ${escapeCell(String(val))} |\n`;
    }
  }

  if (snapshot.boundingRect) {
    const r = snapshot.boundingRect;
    md += `| bounding | ${r.width}x${r.height} @ (${r.x}, ${r.y}) |\n`;
  }

  if (snapshot.visibility) {
    md += `| visible | ${snapshot.visibility.isVisible ? 'yes' : 'NO'} |\n`;
  }

  if (snapshot.parentChain && snapshot.parentChain.length > 0) {
    md += '\n**Parent Chain:**\n';
    snapshot.parentChain.forEach((p, i) => {
      let desc = `${i + 1}. \`${p.tag}\``;
      if (p.id) desc += `#${p.id}`;
      if (p.classes) desc += `.${p.classes.replace(/\s+/g, '.')}`;
      if (p.identifiers) {
        const ids = Object.entries(p.identifiers).map(([k, v]) => `${k}="${v}"`).join(' ');
        if (ids) desc += ` [${ids}]`;
      }
      md += desc + '\n';
    });
  }

  return md;
}

function findNearbyEvents(entries, timestamp, windowMs) {
  if (!timestamp) return null;
  const t = new Date(timestamp).getTime();
  const nearby = entries.filter((e) => {
    if (e.category === 'annotation') return false;
    const et = new Date(e.timestamp).getTime();
    return Math.abs(et - t) <= windowMs;
  });

  if (!nearby.length) return null;

  const parts = [];
  const errors = nearby.filter((e) => e.category === 'console');
  const actions = nearby.filter((e) => e.category === 'action');
  const network = nearby.filter((e) => e.category === 'network');

  if (errors.length) parts.push(`${errors.length} console error(s)`);
  if (actions.length) parts.push(`${actions.length} user action(s)`);
  if (network.length) parts.push(`${network.length} network request(s)`);

  return parts.join(', ');
}

function formatUserActions(actions) {
  if (!actions.length) return null;

  let md = `## User Actions (${actions.length} events)\n\n`;
  md += '| Time | Event | Element | Details |\n';
  md += '|------|-------|---------|--------|\n';

  for (const a of actions) {
    const time = formatTime(a.timestamp);
    const selector = a.selector ? `\`${a.selector}\`` : '';
    let details = '';

    if (a.event === 'click') details = a.text ? `"${escapeCell(a.text)}"` : '';
    else if (a.event === 'input' || a.event === 'change') details = `value: ${escapeCell(a.value || '')}`;
    else if (a.event === 'submit') details = `${a.method || 'GET'} ${a.action || ''}`;
    else if (a.event === 'keydown') details = `key: ${a.key}`;
    else if (a.event === 'navigate') details = a.url || '';

    md += `| ${time} | ${a.event} | ${selector} | ${details} |\n`;
  }

  return md;
}

function formatConsoleErrors(entries) {
  if (!entries.length) return null;

  const errors = entries.filter((e) => e.type !== 'warn');
  const warnings = entries.filter((e) => e.type === 'warn');

  let md = `## Console Errors (${errors.length} error${errors.length !== 1 ? 's' : ''}`;
  if (warnings.length) md += `, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`;
  md += ')\n';

  errors.forEach((e, i) => {
    const typeLabel = e.type === 'onerror' ? 'Runtime Error'
      : e.type === 'unhandledrejection' ? 'Unhandled Rejection'
      : 'Error';
    md += `\n### ${typeLabel} ${i + 1} — at ${formatTime(e.timestamp)}\n`;
    if (e.source) md += `**Source:** ${e.source}:${e.lineno || 0}:${e.colno || 0}\n`;
    md += '```\n' + e.message + '\n';
    if (e.stack) md += e.stack + '\n';
    md += '```\n';
  });

  if (warnings.length) {
    md += '\n### Warnings\n';
    for (const w of warnings) {
      md += `- **${formatTime(w.timestamp)}**: ${w.message}\n`;
    }
  }

  return md;
}

function formatNetworkIssues(entries) {
  if (!entries.length) return null;

  let md = `## Network Issues (${entries.length} request${entries.length !== 1 ? 's' : ''})\n`;

  for (const req of entries) {
    const statusLabel = req.status === 0 ? 'Network Error'
      : `${req.status} ${req.statusText || ''}`;
    md += `\n### ${req.method} ${truncateUrl(req.url)} — ${statusLabel} (${req.duration}ms)\n`;

    if (req.error) md += `**Error:** ${req.error}\n`;

    if (req.requestBody) {
      md += '**Request Body:**\n```json\n' + req.requestBody + '\n```\n';
    }
    if (req.responseBody) {
      md += '**Response Body:**\n```json\n' + req.responseBody + '\n```\n';
    }
  }

  return md;
}

function formatComponentState(entries) {
  const snapshots = entries.filter((e) => e.type === 'component-snapshot');
  const detected = entries.find((e) => e.type === 'framework-detected');

  if (!snapshots.length && !detected) return null;

  const fw = detected?.framework || snapshots[0]?.framework || 'Unknown';
  let md = `## Component State (${fw})\n`;

  if (!snapshots.length) {
    md += '\nFramework detected but no component snapshots were captured.\n';
    return md;
  }

  const latest = snapshots[snapshots.length - 1];
  md += `\nSnapshot at ${formatTime(latest.timestamp)}:\n`;
  md += '```\n' + renderTree(latest.tree, '', true) + '```\n';

  return md;
}

function renderTree(node, prefix, isLast) {
  if (!node) return '';
  const connector = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
  const propsStr = node.props ? ' ' + compactProps(node.props) : '';
  let result = prefix + connector + node.name + propsStr + '\n';

  const childPrefix = prefix === '' ? '' : prefix + (isLast ? '   ' : '│  ');
  const children = node.children || [];
  children.forEach((child, i) => {
    result += renderTree(child, childPrefix, i === children.length - 1);
  });
  return result;
}

function compactProps(props) {
  if (!props) return '';
  const pairs = Object.entries(props)
    .filter(([k]) => k !== 'children')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return pairs ? `{ ${pairs} }` : '';
}

// --- Helpers ---

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString('en-US', { hour12: false });
  } catch (_) {
    return isoString || '?';
  }
}

function formatDuration(startISO, endISO) {
  const ms = new Date(endISO) - new Date(startISO);
  if (isNaN(ms) || ms < 0) return '?';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function escapeCell(str) {
  return (str || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').substring(0, 80);
}

function truncateUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search.substring(0, 30) : '');
  } catch (_) {
    return url.substring(0, 60);
  }
}
